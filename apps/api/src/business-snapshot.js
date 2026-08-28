const BUSINESS_SNAPSHOT_SCHEMA_VERSION = 1;
const BILLING_AMOUNT_SCALE = 1_000_000;

function nonNegativeInteger(value) {
  return Math.max(0, Math.trunc(Number(value) || 0));
}

function aggregateSnapshotDaily(points = []) {
  const byDate = new Map();
  for (const point of Array.isArray(points) ? points : []) {
    const date = String(point?.date || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const current = byDate.get(date) || {
      date,
      apiConsumptionCnyMinor: 0,
      apiRequestCount: 0,
      imageRequestCount: 0,
      analysisRequestCount: 0
    };
    const imageRequestCount = nonNegativeInteger(point?.successfulImages);
    const analysisRequestCount = nonNegativeInteger(point?.successfulAnalyses);
    current.apiConsumptionCnyMinor += nonNegativeInteger(point?.revenueCnyMinor);
    current.imageRequestCount += imageRequestCount;
    current.analysisRequestCount += analysisRequestCount;
    current.apiRequestCount += imageRequestCount + analysisRequestCount;
    byDate.set(date, current);
  }
  return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
}

function createBusinessSnapshotService(options) {
  const { auth, runtime, alipayRecharge } = options;
  const businessId = String(options.businessId || 'business').trim();
  const businessName = String(options.businessName || businessId).trim();

  async function accounting(query = {}) {
    const [users, apiSettings] = await Promise.all([auth.listUsers(), runtime.loadApiSettings()]);
    const userLookup = new Map(users.map(user => [user.workspaceId, user]));
    const report = await runtime.billing.getAccountingReport(apiSettings.relays || [], userLookup, {
      range: String(query.range || 'month'),
      startDate: String(query.startDate || ''),
      endDate: String(query.endDate || ''),
      relayId: String(query.relayId || '')
    });
    const finance = await runtime.financeLedger.listRange({
      startDate: report.startDate,
      endDate: report.endDate,
      relayId: report.relayId
    });
    const manualIncomeCnyMinor = Number(finance.summary.otherIncomeCnyMinor) || 0;
    const actualConsumptionCnyMinor = Number(report.totals.confirmedRevenueCnyMinor) || 0;
    return {
      ...report,
      finance,
      totals: {
        ...report.totals,
        otherIncomeCnyMinor: manualIncomeCnyMinor,
        manualIncomeCnyMinor,
        actualConsumptionCnyMinor,
        businessRevenueCnyMinor: manualIncomeCnyMinor,
        totalExpensesCnyMinor: actualConsumptionCnyMinor,
        netProfitCnyMinor: manualIncomeCnyMinor - actualConsumptionCnyMinor
      }
    };
  }

  async function snapshot(query = {}) {
    const users = await auth.listUsers();
    const userLookup = new Map(users.map(user => [user.workspaceId, user]));
    const [accountingData, stats, requestReport, recharges] = await Promise.all([
      accounting(query),
      runtime.billing.getGlobalStats(String(query.range || 'month'), userLookup, ''),
      runtime.billing.getLedgerReport(userLookup, {
        range: String(query.range || 'month'),
        startDate: String(query.startDate || ''),
        endDate: String(query.endDate || ''),
        relayId: '',
        limit: 1
      }),
      query.includeRecharges === false ? Promise.resolve([]) : alipayRecharge.listReview()
    ]);
    const relayRates = new Map((Array.isArray(accountingData.relays) ? accountingData.relays : []).map(relay => [
      String(relay?.relayId || ''),
      Math.max(0.000001, Number(relay?.customerCnyPerUsd) || 7)
    ]));
    const teamWorkspaceIds = users
      .filter(user => user?.role !== 'superadmin')
      .map(user => String(user?.workspaceId || '').trim())
      .filter(Boolean);
    const accounts = await runtime.billing.listAccounts(teamWorkspaceIds, [...relayRates.keys()]);
    const currentTeamAvailableBalanceCnyMinor = (Array.isArray(accounts) ? accounts : []).reduce((total, account) => {
      return total + (Array.isArray(account?.wallets) ? account.wallets : []).reduce((walletTotal, wallet) => {
        const rate = relayRates.get(String(wallet?.relayId || ''));
        if (!rate) return walletTotal;
        return walletTotal + Math.round((nonNegativeInteger(wallet?.availableMinor) / BILLING_AMOUNT_SCALE) * rate * 100);
      }, 0);
    }, 0);
    const daily = aggregateSnapshotDaily(accountingData.daily);
    const actualApiConsumptionCnyMinor = nonNegativeInteger(accountingData?.totals?.confirmedRevenueCnyMinor);
    const apiRequestCount = nonNegativeInteger(accountingData?.totals?.successfulImages)
      + nonNegativeInteger(accountingData?.totals?.successfulAnalyses);
    const upstreamRequestCount = nonNegativeInteger(requestReport?.metrics?.imageCount);
    const statsTotals = stats?.totals || {};

    // Stable internal contract v1: retain all compatibility fields and only add fields in future versions.
    return {
      schemaVersion: BUSINESS_SNAPSHOT_SCHEMA_VERSION,
      businessId,
      businessName,
      id: businessId,
      name: businessName,
      generatedAt: new Date().toISOString(),
      currency: 'CNY',
      range: String(accountingData.range || query.range || 'month'),
      startDate: String(accountingData.startDate || ''),
      endDate: String(accountingData.endDate || ''),
      currentTeamAvailableBalanceCnyMinor,
      actualApiConsumptionCnyMinor,
      apiRequestCount,
      daily,
      accounting: accountingData,
      stats: {
        ...stats,
        totals: { ...statsTotals, upstreamRequestCount }
      },
      upstreamRequests: {
        count: upstreamRequestCount,
        source: 'project-attempt-ledger',
        description: '项目实际发起并进入计费流水的上游图片请求次数'
      },
      recharges: recharges.map(order => ({ ...order, businessId, businessName }))
    };
  }

  async function rechargeAction(payload = {}, actorUserId = 'business-link') {
    const action = String(payload.action || '');
    const id = String(payload.id || '');
    if (!id) throw new Error('充值记录编号不能为空');
    if (action === 'approve') return alipayRecharge.approve(id, { actualAmountUsd: payload.actualAmountUsd }, actorUserId);
    if (action === 'reject') return alipayRecharge.reject(id, payload.reason);
    throw new Error('不支持的充值核验操作');
  }

  async function financeEntryAction(payload = {}) {
    const action = String(payload.action || '');
    const id = String(payload.id || '');
    const entry = { ...(payload.entry || {}), category: 'other_income' };
    if (action === 'create') return runtime.financeLedger.create(entry);
    if (!id) throw new Error('收入记录编号不能为空');
    if (action === 'update') return runtime.financeLedger.update(id, entry);
    if (action === 'delete') return runtime.financeLedger.remove(id);
    throw new Error('不支持的收入记录操作');
  }

  return { accounting, financeEntryAction, rechargeAction, snapshot };
}

module.exports = { BUSINESS_SNAPSHOT_SCHEMA_VERSION, aggregateSnapshotDaily, createBusinessSnapshotService };
