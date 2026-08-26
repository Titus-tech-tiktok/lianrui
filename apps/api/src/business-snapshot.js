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
    const otherIncomeCnyMinor = Number(finance.summary.otherIncomeCnyMinor) || 0;
    const customerTopupCnyMinor = Number(report.totals.customerTopupCnyMinor) || 0;
    const businessRevenueCnyMinor = customerTopupCnyMinor + otherIncomeCnyMinor;
    const operatingExpensesCnyMinor = Number(finance.summary.operatingExpensesCnyMinor) || 0;
    const upstreamCostCnyMinor = Number(report.totals.upstreamCostCnyMinor) || 0;
    const totalExpensesCnyMinor = upstreamCostCnyMinor + operatingExpensesCnyMinor;
    return {
      ...report,
      finance,
      totals: {
        ...report.totals,
        otherIncomeCnyMinor,
        businessRevenueCnyMinor,
        operatingExpensesCnyMinor,
        totalExpensesCnyMinor,
        netProfitCnyMinor: businessRevenueCnyMinor - totalExpensesCnyMinor
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
    const totals = stats?.totals || {};
    const upstreamRequestCount = Math.max(0, Number(requestReport?.metrics?.imageCount) || 0);
    return {
      id: businessId,
      name: businessName,
      generatedAt: new Date().toISOString(),
      accounting: accountingData,
      stats: {
        ...stats,
        totals: { ...totals, upstreamRequestCount }
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

  return { accounting, rechargeAction, snapshot };
}

module.exports = { createBusinessSnapshotService };
