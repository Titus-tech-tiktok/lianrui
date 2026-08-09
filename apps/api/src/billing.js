const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const RESERVATION_TTL_MS = 2 * 60 * 60 * 1000;
const BILLING_TYPES = new Set(['image', 'llm']);
const BILLING_CURRENCY = 'USD';
const BILLING_SCALE = 1_000_000;
const LEGACY_CENT_TO_MICRO = 10_000;

function createBillingService(dataRoot) {
  const root = path.join(dataRoot, 'system');
  const rulesFile = path.join(root, 'billing-rules.json');
  const accountsFile = path.join(root, 'billing-accounts.json');
  const ledgerFile = path.join(root, 'billing-ledger.jsonl');
  let mutationChain = Promise.resolve();

  const defaultRules = () => ({
    version: 1,
    enabled: false,
    currency: BILLING_CURRENCY,
    amountScale: BILLING_SCALE,
    imageFeeMinor: 0,
    imageFeeMinMinor: 0,
    imageFeeMaxMinor: 0,
    llmFeeMinor: 0,
    llmFeeMinMinor: 0,
    llmFeeMaxMinor: 0,
    defaultBalanceMinor: 0,
    updatedAt: ''
  });

  function normalizeMinor(value, name, maximum = 1_000_000_000_000) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 0 || number > maximum) {
      throw new Error(`${name}必须是有效的美元 6 位小数单位整数`);
    }
    return number;
  }

  function migrateMoney(value, sourceScale = BILLING_SCALE) {
    const number = Number(value) || 0;
    if (sourceScale === BILLING_SCALE) return Math.trunc(number);
    return Math.trunc(number * LEGACY_CENT_TO_MICRO);
  }

  function normalizeWorkspaceId(value) {
    const workspaceId = String(value || '').trim();
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(workspaceId)) throw new Error('计费工作区无效');
    return workspaceId;
  }

  function normalizeBillingOnceKey(value) {
    const text = String(value || '').trim();
    return text ? crypto.createHash('sha256').update(text).digest('hex') : '';
  }

  async function readJson(file, fallback) {
    try { return JSON.parse(await fs.readFile(file, 'utf8')); }
    catch { return fallback; }
  }

  async function writeJson(file, value) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}-${crypto.randomBytes(4).toString('hex')}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temporary, file);
  }

  async function readRules() {
    const value = await readJson(rulesFile, {});
    const sourceScale = value?.amountScale === BILLING_SCALE ? BILLING_SCALE : 100;
    const imageFee = Math.max(0, migrateMoney(value?.imageFeeMinor, sourceScale));
    const llmFee = Math.max(0, migrateMoney(value?.llmFeeMinor, sourceScale));
    const imageMin = Math.max(0, value?.imageFeeMinMinor === undefined ? imageFee : migrateMoney(value?.imageFeeMinMinor, sourceScale));
    const imageMax = Math.max(imageMin, value?.imageFeeMaxMinor === undefined ? (imageFee || imageMin) : migrateMoney(value?.imageFeeMaxMinor, sourceScale));
    const llmMin = Math.max(0, value?.llmFeeMinMinor === undefined ? llmFee : migrateMoney(value?.llmFeeMinMinor, sourceScale));
    const llmMax = Math.max(llmMin, value?.llmFeeMaxMinor === undefined ? (llmFee || llmMin) : migrateMoney(value?.llmFeeMaxMinor, sourceScale));
    return {
      ...defaultRules(),
      enabled: value?.enabled === true,
      currency: BILLING_CURRENCY,
      amountScale: BILLING_SCALE,
      imageFeeMinor: imageMax,
      imageFeeMinMinor: imageMin,
      imageFeeMaxMinor: imageMax,
      llmFeeMinor: llmMax,
      llmFeeMinMinor: llmMin,
      llmFeeMaxMinor: llmMax,
      defaultBalanceMinor: Math.max(0, migrateMoney(value?.defaultBalanceMinor, sourceScale)),
      updatedAt: String(value?.updatedAt || '')
    };
  }

  async function readAccounts() {
    const value = await readJson(accountsFile, { version: 1, accounts: {} });
    const sourceScale = value?.amountScale === BILLING_SCALE ? BILLING_SCALE : 100;
    const accounts = value?.accounts && typeof value.accounts === 'object' ? value.accounts : {};
    if (sourceScale !== BILLING_SCALE) {
      for (const account of Object.values(accounts)) {
        if (!account || typeof account !== 'object') continue;
        account.balanceMinor = migrateMoney(account.balanceMinor, sourceScale);
        for (const reservation of Object.values(account.reservations || {})) {
          if (reservation && typeof reservation === 'object') reservation.amountMinor = migrateMoney(reservation.amountMinor, sourceScale);
        }
      }
    }
    return { version: 1, currency: BILLING_CURRENCY, amountScale: BILLING_SCALE, accounts };
  }

  function mutate(worker) {
    const operation = mutationChain.then(worker);
    mutationChain = operation.catch(() => {});
    return operation;
  }

  function cleanReservations(account, now = Date.now()) {
    account.reservations ||= {};
    for (const [id, reservation] of Object.entries(account.reservations)) {
      if (now - Number(reservation?.createdAt || 0) > RESERVATION_TTL_MS) delete account.reservations[id];
    }
  }

  function normalizeAccount(account, initialBalance = 0) {
    const value = account && typeof account === 'object' ? account : {};
    const existingBalance = Number(value.balanceMinor);
    value.balanceMinor = Number.isFinite(existingBalance) && existingBalance >= 0
      ? existingBalance
      : Math.max(0, Number(initialBalance) || 0);
    value.reservations = value.reservations && typeof value.reservations === 'object' ? value.reservations : {};
    value.chargedOnce = value.chargedOnce && typeof value.chargedOnce === 'object' ? value.chargedOnce : {};
    value.createdAt ||= new Date().toISOString();
    value.updatedAt ||= value.createdAt;
    cleanReservations(value);
    return value;
  }

  function reservedMinor(account) {
    return Object.values(account.reservations || {}).reduce((total, item) => total + Math.max(0, Number(item?.amountMinor) || 0), 0);
  }

  function publicAccount(workspaceId, account) {
    const reserved = reservedMinor(account);
    return {
      workspaceId,
      balanceMinor: account.balanceMinor,
      reservedMinor: reserved,
      availableMinor: Math.max(0, account.balanceMinor - reserved),
      updatedAt: account.updatedAt || ''
    };
  }

  async function appendLedger(entry) {
    await fs.mkdir(root, { recursive: true });
    await fs.appendFile(ledgerFile, `${JSON.stringify(entry)}\n`, { encoding: 'utf8', mode: 0o600 });
  }

  async function ensureAccount(workspaceIdValue) {
    const workspaceId = normalizeWorkspaceId(workspaceIdValue);
    return mutate(async () => {
      const [rules, state] = await Promise.all([readRules(), readAccounts()]);
      const existed = Boolean(state.accounts[workspaceId]);
      const account = normalizeAccount(state.accounts[workspaceId], rules.defaultBalanceMinor);
      state.accounts[workspaceId] = account;
      if (!existed) await writeJson(accountsFile, state);
      return publicAccount(workspaceId, account);
    });
  }

  async function getSummary(workspaceIdValue, limit = 20) {
    const workspaceId = normalizeWorkspaceId(workspaceIdValue);
    const [rules, account, transactions] = await Promise.all([
      readRules(),
      ensureAccount(workspaceId),
      listTransactions(workspaceId, limit)
    ]);
    const spendTotals = await getSpendTotals(workspaceId, [1, 7, 30]);
    return { rules, account, transactions, spendTotals };
  }

  async function getSpendTotals(workspaceIdValue = '', daysValues = [1, 7, 30]) {
    const workspaceId = workspaceIdValue ? normalizeWorkspaceId(workspaceIdValue) : '';
    const days = [...new Set((Array.isArray(daysValues) ? daysValues : [daysValues])
      .map(value => Math.max(1, Math.min(3660, Math.trunc(Number(value) || 0))))
      .filter(Boolean))];
    const totals = Object.fromEntries(days.map(day => [String(day), 0]));
    const now = Date.now();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStart = today.getTime();
    const windows = Object.fromEntries(days.map(day => [String(day), day === 1 ? todayStart : now - day * 24 * 60 * 60 * 1000]));
    let text = '';
    try { text = await fs.readFile(ledgerFile, 'utf8'); } catch { return totals; }
    for (const line of text.trim().split('\n').filter(Boolean)) {
      try {
        const entry = JSON.parse(line);
        if (workspaceId && entry.workspaceId !== workspaceId) continue;
        if (!BILLING_TYPES.has(String(entry.kind || ''))) continue;
        const created = new Date(entry.createdAt).getTime();
        if (!Number.isFinite(created)) continue;
        const sourceScale = entry?.amountScale === BILLING_SCALE ? BILLING_SCALE : 100;
        const amountMinor = sourceScale === BILLING_SCALE ? Math.trunc(Number(entry.amountMinor) || 0) : migrateMoney(entry.amountMinor, sourceScale);
        if (amountMinor >= 0) continue;
        for (const day of days) {
          if (created >= windows[String(day)]) totals[String(day)] += Math.abs(amountMinor);
        }
      } catch {}
    }
    return totals;
  }

  function statsWindowRange(rangeValue = 'today') {
    const nowMs = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const chinaOffsetMs = 8 * 60 * 60 * 1000;
    const todayStartMs = Math.floor((nowMs + chinaOffsetMs) / dayMs) * dayMs - chinaOffsetMs;
    const range = String(rangeValue || 'today');
    if (range === 'yesterday') {
      return { range, startMs: todayStartMs - dayMs, endMs: todayStartMs };
    }
    if (range === '7d' || range === '30d') {
      const days = range === '7d' ? 7 : 30;
      return { range, startMs: nowMs - days * dayMs, endMs: nowMs };
    }
    return { range: 'today', startMs: todayStartMs, endMs: nowMs };
  }

  function operationBucket(entry) {
    const text = `${entry.description || ''} ${entry.reference || ''}`;
    if (entry.kind === 'image') {
      if (text.includes('重新生成')) return 'regeneration';
      if (text.includes('母版')) return 'master';
      if (text.includes('自由')) return 'free';
      return 'generation';
    }
    if (entry.kind === 'llm') {
      if (text.includes('套图模板') || text.includes('模板') || text.includes('分析')) return 'analysis';
      return 'llm';
    }
    return String(entry.kind || 'other');
  }

  function dayHourKey(ms) {
    const date = new Date(ms);
    date.setMinutes(0, 0, 0);
    return date.toISOString();
  }

  async function buildBalanceSummary(userLookup = new Map()) {
    const [rules, state] = await Promise.all([readRules(), readAccounts()]);
    const totals = { count: 0, balanceMinor: 0, availableMinor: 0, reservedMinor: 0 };
    const byRole = new Map();
    const byAccount = [];
    for (const [lookupWorkspaceId, user] of userLookup.entries()) {
      const workspaceId = String(user?.workspaceId || lookupWorkspaceId || '').trim();
      if (!workspaceId || user?.role === 'superadmin') continue;
      const account = normalizeAccount(state.accounts[workspaceId], rules.defaultBalanceMinor);
      const publicValue = publicAccount(workspaceId, account);
      const role = String(user?.role || 'member');
      const roleSummary = byRole.get(role) || { role, count: 0, balanceMinor: 0, availableMinor: 0, reservedMinor: 0 };
      roleSummary.count += 1;
      roleSummary.balanceMinor += publicValue.balanceMinor;
      roleSummary.availableMinor += publicValue.availableMinor;
      roleSummary.reservedMinor += publicValue.reservedMinor;
      byRole.set(role, roleSummary);
      totals.count += 1;
      totals.balanceMinor += publicValue.balanceMinor;
      totals.availableMinor += publicValue.availableMinor;
      totals.reservedMinor += publicValue.reservedMinor;
      byAccount.push({
        workspaceId,
        username: user?.username || '',
        displayName: user?.displayName || '',
        role,
        active: user?.active !== false,
        balanceMinor: publicValue.balanceMinor,
        availableMinor: publicValue.availableMinor,
        reservedMinor: publicValue.reservedMinor,
        updatedAt: publicValue.updatedAt
      });
    }
    byAccount.sort((left, right) => right.balanceMinor - left.balanceMinor);
    return {
      totals,
      byRole: [...byRole.values()].sort((left, right) => right.balanceMinor - left.balanceMinor),
      byAccount
    };
  }

  async function getGlobalStats(rangeValue = 'today', userLookup = new Map()) {
    const balanceSummary = await buildBalanceSummary(userLookup);
    const windowRange = statsWindowRange(rangeValue);
    let text = '';
    try { text = await fs.readFile(ledgerFile, 'utf8'); } catch {
      text = '';
    }
    const totals = {
      totalCostMinor: 0,
      imageGenerated: 0,
      imageRegenerated: 0,
      masterGenerated: 0,
      freeGenerated: 0,
      analysisCalls: 0,
      templateAnalysisCalls: 0,
      activeWorkspaces: new Set(),
      failedOrRetry: 0
    };
    const byAccount = new Map();
    const byOperation = new Map();
    const trend = new Map();
    const templateAnalysisGroups = new Set();
    for (const line of text.trim().split('\n').filter(Boolean)) {
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }
      if (!BILLING_TYPES.has(String(entry.kind || ''))) continue;
      if (userLookup.get(entry.workspaceId)?.role === 'superadmin') continue;
      const created = new Date(entry.createdAt).getTime();
      if (!Number.isFinite(created) || created < windowRange.startMs || created >= windowRange.endMs) continue;
      const sourceScale = entry?.amountScale === BILLING_SCALE ? BILLING_SCALE : 100;
      const amountMinor = sourceScale === BILLING_SCALE ? Math.trunc(Number(entry.amountMinor) || 0) : migrateMoney(entry.amountMinor, sourceScale);
      const spendMinor = amountMinor < 0 ? Math.abs(amountMinor) : 0;
      const bucket = operationBucket(entry);
      const workspaceId = String(entry.workspaceId || '');
      if (spendMinor > 0) totals.totalCostMinor += spendMinor;
      if (workspaceId) totals.activeWorkspaces.add(workspaceId);
      if (bucket === 'generation') totals.imageGenerated += 1;
      if (bucket === 'regeneration') totals.imageRegenerated += 1;
      if (bucket === 'master') totals.masterGenerated += 1;
      if (bucket === 'free') totals.freeGenerated += 1;
      if (entry.kind === 'llm') totals.analysisCalls += 1;
      if (bucket === 'analysis') {
        totals.templateAnalysisCalls += 1;
        const referenceRoot = String(entry.reference || '').split(/[\\/]/).filter(Boolean)[0] || '';
        templateAnalysisGroups.add(`${workspaceId}|${new Date(created).toISOString().slice(0, 10)}|${referenceRoot || 'default'}`);
      }
      const user = userLookup.get(workspaceId) || {};
      const account = byAccount.get(workspaceId) || {
        workspaceId,
        username: user.username || workspaceId || 'unknown',
        displayName: user.displayName || user.username || workspaceId || 'unknown',
        role: user.role || '',
        totalCostMinor: 0,
        imageGenerated: 0,
        imageRegenerated: 0,
        masterGenerated: 0,
        freeGenerated: 0,
        analysisCalls: 0
      };
      account.totalCostMinor += spendMinor;
      if (bucket === 'generation') account.imageGenerated += 1;
      if (bucket === 'regeneration') account.imageRegenerated += 1;
      if (bucket === 'master') account.masterGenerated += 1;
      if (bucket === 'free') account.freeGenerated += 1;
      if (entry.kind === 'llm') account.analysisCalls += 1;
      byAccount.set(workspaceId, account);
      const operation = byOperation.get(bucket) || { key: bucket, count: 0, totalCostMinor: 0 };
      operation.count += 1;
      operation.totalCostMinor += spendMinor;
      byOperation.set(bucket, operation);
      const hour = dayHourKey(created);
      const point = trend.get(hour) || { time: hour, generated: 0, costMinor: 0 };
      if (entry.kind === 'image') point.generated += 1;
      point.costMinor += spendMinor;
      trend.set(hour, point);
    }
    const deliveredImages = totals.imageGenerated + totals.imageRegenerated + totals.masterGenerated + totals.freeGenerated;
    const firstPassImages = totals.imageGenerated;
    const successBase = totals.imageGenerated + totals.imageRegenerated;
    const successRate = successBase > 0 ? totals.imageGenerated / successBase : 0;
    const averageCostMinor = deliveredImages > 0 ? Math.round(totals.totalCostMinor / deliveredImages) : 0;
    const decorateAccount = account => ({
      ...account,
      successRate: (account.imageGenerated + account.imageRegenerated) > 0
        ? account.imageGenerated / (account.imageGenerated + account.imageRegenerated)
        : 0,
      averageCostMinor: (account.imageGenerated + account.imageRegenerated + account.masterGenerated + account.freeGenerated) > 0
        ? Math.round(account.totalCostMinor / (account.imageGenerated + account.imageRegenerated + account.masterGenerated + account.freeGenerated))
        : 0
    });
    return {
      range: windowRange.range,
      startedAt: new Date(windowRange.startMs).toISOString(),
      endedAt: new Date(windowRange.endMs).toISOString(),
      totals: {
        totalCostMinor: totals.totalCostMinor,
        averageCostMinor,
        imageGenerated: totals.imageGenerated,
        imageRegenerated: totals.imageRegenerated,
        firstPassImages,
        successRate,
        masterGenerated: totals.masterGenerated,
        freeGenerated: totals.freeGenerated,
        analysisCalls: totals.analysisCalls,
        templateAnalysisCalls: totals.templateAnalysisCalls,
        templateAnalysisFolders: templateAnalysisGroups.size,
        activeWorkspaces: totals.activeWorkspaces.size,
        failedOrRetry: totals.failedOrRetry
      },
      balanceSummary,
      byAccount: [...byAccount.values()].map(decorateAccount).sort((a, b) => b.totalCostMinor - a.totalCostMinor),
      byOperation: [...byOperation.values()].sort((a, b) => b.totalCostMinor - a.totalCostMinor),
      trend: [...trend.values()].sort((a, b) => a.time.localeCompare(b.time))
    };
  }

  async function saveRules(payload = {}) {
    return mutate(async () => {
      const imageMin = normalizeMinor(payload.imageFeeMinMinor ?? payload.imageFeeMinor, '成功生图最低单价');
      const imageMax = normalizeMinor(payload.imageFeeMaxMinor ?? payload.imageFeeMinor, '成功生图最高单价');
      const llmMin = normalizeMinor(payload.llmFeeMinMinor ?? payload.llmFeeMinor, '语言模型最低单价');
      const llmMax = normalizeMinor(payload.llmFeeMaxMinor ?? payload.llmFeeMinor, '语言模型最高单价');
      if (imageMax < imageMin) throw new Error('成功生图最高扣费不能低于最低扣费');
      if (llmMax < llmMin) throw new Error('语言模型最高扣费不能低于最低扣费');
      const rules = {
        ...defaultRules(),
        enabled: payload.enabled === true,
        imageFeeMinor: imageMax,
        imageFeeMinMinor: imageMin,
        imageFeeMaxMinor: imageMax,
        llmFeeMinor: llmMax,
        llmFeeMinMinor: llmMin,
        llmFeeMaxMinor: llmMax,
        defaultBalanceMinor: normalizeMinor(payload.defaultBalanceMinor, '新账号初始算力余额'),
        updatedAt: new Date().toISOString()
      };
      await writeJson(rulesFile, rules);
      return rules;
    });
  }

  async function listAccounts(workspaceIds = []) {
    const rules = await readRules();
    return mutate(async () => {
      const state = await readAccounts();
      let changed = false;
      const result = [];
      for (const value of workspaceIds) {
        const workspaceId = normalizeWorkspaceId(value);
        if (!state.accounts[workspaceId]) changed = true;
        const account = normalizeAccount(state.accounts[workspaceId], rules.defaultBalanceMinor);
        state.accounts[workspaceId] = account;
        result.push(publicAccount(workspaceId, account));
      }
      if (changed) await writeJson(accountsFile, state);
      return result;
    });
  }

  async function adjustBalance(workspaceIdValue, amountMinorValue, metadata = {}) {
    const workspaceId = normalizeWorkspaceId(workspaceIdValue);
    const amountMinor = Number(amountMinorValue);
    if (!Number.isSafeInteger(amountMinor) || amountMinor === 0 || Math.abs(amountMinor) > 1_000_000_000_000) {
      throw new Error('账户金额变更必须是非零的美元 6 位小数单位整数');
    }
    return mutate(async () => {
      const [rules, state] = await Promise.all([readRules(), readAccounts()]);
      const account = normalizeAccount(state.accounts[workspaceId], rules.defaultBalanceMinor);
      const next = account.balanceMinor + amountMinor;
      if (next < 0) throw new Error('扣减金额不能超过当前余额');
      account.balanceMinor = next;
      account.updatedAt = new Date().toISOString();
      state.accounts[workspaceId] = account;
      const entry = {
        id: crypto.randomUUID(),
        workspaceId,
        kind: 'adjustment',
        currency: BILLING_CURRENCY,
        amountScale: BILLING_SCALE,
        amountMinor,
        balanceMinor: next,
        description: String(metadata.description || (amountMinor > 0 ? '账户充值到账' : '算力余额扣减')).slice(0, 160),
        operatorUserId: String(metadata.operatorUserId || '').slice(0, 80),
        createdAt: account.updatedAt
      };
      await writeJson(accountsFile, state);
      await appendLedger(entry);
      return { account: publicAccount(workspaceId, account), transaction: entry };
    });
  }

  async function reserve(workspaceIdValue, typeValue, metadata = {}) {
    const workspaceId = normalizeWorkspaceId(workspaceIdValue);
    const type = String(typeValue || '');
    if (!BILLING_TYPES.has(type)) throw new Error('未知计费类型');
    return mutate(async () => {
      const rules = await readRules();
      const overrideAmount = Number(metadata.amountMinor ?? metadata.billingAmountMinor);
      const overrideMin = Number(metadata.amountMinMinor ?? metadata.billingAmountMinMinor);
      const overrideMax = Number(metadata.amountMaxMinor ?? metadata.billingAmountMaxMinor);
      const globalMin = type === 'image' ? rules.imageFeeMinMinor : rules.llmFeeMinMinor;
      const globalMax = type === 'image' ? rules.imageFeeMaxMinor : rules.llmFeeMaxMinor;
      const hasOverrideRange = Number.isSafeInteger(overrideMin) && Number.isSafeInteger(overrideMax) && overrideMin >= 0 && overrideMax >= overrideMin;
      const min = hasOverrideRange ? overrideMin : globalMin;
      const max = hasOverrideRange ? overrideMax : globalMax;
      const amountMinor = Number.isSafeInteger(overrideAmount) && overrideAmount >= 0
        ? overrideAmount
        : (min === max ? min : min + crypto.randomInt(max - min + 1));
      if (!rules.enabled || amountMinor <= 0) return { billable: false, workspaceId, type, amountMinor: 0 };
      const state = await readAccounts();
      const account = normalizeAccount(state.accounts[workspaceId], rules.defaultBalanceMinor);
      const onceKey = normalizeBillingOnceKey(metadata.onceKey || metadata.billingOnceKey);
      if (onceKey && account.chargedOnce?.[onceKey]) return { billable: false, workspaceId, type, amountMinor: 0, onceKey, alreadyCharged: true };
      if (onceKey && Object.values(account.reservations || {}).some(reservation => reservation?.onceKey === onceKey)) {
        return { billable: false, workspaceId, type, amountMinor: 0, onceKey, alreadyReserved: true };
      }
      const available = account.balanceMinor - reservedMinor(account);
      if (available < amountMinor) {
        const required = (amountMinor / BILLING_SCALE).toFixed(6).replace(/0+$/, '').replace(/\.$/, '.00');
        const current = (Math.max(0, available) / BILLING_SCALE).toFixed(6).replace(/0+$/, '').replace(/\.$/, '.00');
        throw new Error(`算力余额不足：本次${type === 'image' ? '生图' : '模型分析'}需要 $${required}，当前可用 $${current}`);
      }
      const id = crypto.randomUUID();
      account.reservations[id] = {
        id,
        type,
        amountMinor,
        currency: BILLING_CURRENCY,
        amountScale: BILLING_SCALE,
        description: String(metadata.description || (type === 'image' ? '图片生成' : '语言模型调用')).slice(0, 160),
        reference: String(metadata.reference || '').slice(0, 240),
        onceKey,
        createdAt: Date.now()
      };
      account.updatedAt = new Date().toISOString();
      state.accounts[workspaceId] = account;
      await writeJson(accountsFile, state);
      return { billable: true, id, workspaceId, type, amountMinor };
    });
  }

  async function commit(reservation) {
    if (!reservation?.billable) return null;
    return mutate(async () => {
      const state = await readAccounts();
      const account = normalizeAccount(state.accounts[reservation.workspaceId]);
      const stored = account.reservations?.[reservation.id];
      if (!stored) return null;
      const amountMinor = Math.max(0, Number(stored.amountMinor) || 0);
      account.balanceMinor = Math.max(0, account.balanceMinor - amountMinor);
      delete account.reservations[reservation.id];
      account.updatedAt = new Date().toISOString();
      if (stored.onceKey) account.chargedOnce ||= {};
      if (stored.onceKey) account.chargedOnce[stored.onceKey] = account.updatedAt;
      state.accounts[reservation.workspaceId] = account;
      const entry = {
        id: crypto.randomUUID(),
        workspaceId: reservation.workspaceId,
        kind: stored.type,
        currency: BILLING_CURRENCY,
        amountScale: BILLING_SCALE,
        amountMinor: -amountMinor,
        balanceMinor: account.balanceMinor,
        description: stored.description,
        reference: stored.reference,
        onceKey: stored.onceKey || '',
        createdAt: account.updatedAt
      };
      await writeJson(accountsFile, state);
      await appendLedger(entry);
      return entry;
    });
  }

  async function release(reservation) {
    if (!reservation?.billable) return false;
    return mutate(async () => {
      const state = await readAccounts();
      const account = normalizeAccount(state.accounts[reservation.workspaceId]);
      if (!account.reservations?.[reservation.id]) return false;
      delete account.reservations[reservation.id];
      account.updatedAt = new Date().toISOString();
      state.accounts[reservation.workspaceId] = account;
      await writeJson(accountsFile, state);
      return true;
    });
  }

  async function transferBalance(fromWorkspaceIdValue, toWorkspaceIdValue, amountMinorValue, metadata = {}) {
    const fromWorkspaceId = normalizeWorkspaceId(fromWorkspaceIdValue);
    const toWorkspaceId = normalizeWorkspaceId(toWorkspaceIdValue);
    if (fromWorkspaceId === toWorkspaceId) throw new Error('不能给自己划拨算力余额');
    const amountMinor = normalizeMinor(amountMinorValue, '划拨金额');
    if (amountMinor <= 0) throw new Error('划拨金额必须大于 0');
    return mutate(async () => {
      const [rules, state] = await Promise.all([readRules(), readAccounts()]);
      const from = normalizeAccount(state.accounts[fromWorkspaceId], rules.defaultBalanceMinor);
      const to = normalizeAccount(state.accounts[toWorkspaceId], rules.defaultBalanceMinor);
      if (from.balanceMinor - reservedMinor(from) < amountMinor) throw new Error('管理员可用算力余额不足，无法划拨');
      const now = new Date().toISOString();
      from.balanceMinor -= amountMinor;
      to.balanceMinor += amountMinor;
      from.updatedAt = now;
      to.updatedAt = now;
      state.accounts[fromWorkspaceId] = from;
      state.accounts[toWorkspaceId] = to;
      const debit = {
        id: crypto.randomUUID(),
        workspaceId: fromWorkspaceId,
        kind: 'transfer',
        currency: BILLING_CURRENCY,
        amountScale: BILLING_SCALE,
        amountMinor: -amountMinor,
        balanceMinor: from.balanceMinor,
        description: String(metadata.debitDescription || metadata.description || '成员账户划拨').slice(0, 160),
        operatorUserId: String(metadata.operatorUserId || '').slice(0, 80),
        targetWorkspaceId: toWorkspaceId,
        createdAt: now
      };
      const credit = {
        id: crypto.randomUUID(),
        workspaceId: toWorkspaceId,
        kind: 'transfer',
        currency: BILLING_CURRENCY,
        amountScale: BILLING_SCALE,
        amountMinor,
        balanceMinor: to.balanceMinor,
        description: String(metadata.creditDescription || metadata.description || '账户充值到账').slice(0, 160),
        operatorUserId: String(metadata.operatorUserId || '').slice(0, 80),
        sourceWorkspaceId: fromWorkspaceId,
        createdAt: now
      };
      await writeJson(accountsFile, state);
      await appendLedger(debit);
      await appendLedger(credit);
      return {
        from: publicAccount(fromWorkspaceId, from),
        to: publicAccount(toWorkspaceId, to),
        transactions: [debit, credit]
      };
    });
  }

  async function listTransactions(workspaceIdValue = '', limitValue = 50) {
    const workspaceId = workspaceIdValue ? normalizeWorkspaceId(workspaceIdValue) : '';
    const limit = Math.max(1, Math.min(500, Number(limitValue) || 50));
    let text = '';
    try { text = await fs.readFile(ledgerFile, 'utf8'); } catch { return []; }
    const entries = text.trim().split('\n').filter(Boolean).reverse();
    const result = [];
    for (const line of entries) {
      try {
        const entry = JSON.parse(line);
        const sourceScale = entry?.amountScale === BILLING_SCALE ? BILLING_SCALE : 100;
        if (sourceScale !== BILLING_SCALE) {
          entry.amountMinor = migrateMoney(entry.amountMinor, sourceScale);
          entry.balanceMinor = migrateMoney(entry.balanceMinor, sourceScale);
        }
        entry.currency = BILLING_CURRENCY;
        entry.amountScale = BILLING_SCALE;
        if (!workspaceId || entry.workspaceId === workspaceId) result.push(entry);
      } catch {}
      if (result.length >= limit) break;
    }
    return result;
  }

  async function clearTransactions() {
    let cleared = 0;
    try {
      const text = await fs.readFile(ledgerFile, 'utf8');
      cleared = text.trim().split('\n').filter(Boolean).length;
    } catch {}
    await fs.mkdir(path.dirname(ledgerFile), { recursive: true });
    await fs.writeFile(ledgerFile, '', 'utf8');
    return { cleared };
  }

  return {
    adjustBalance,
    clearTransactions,
    commit,
    ensureAccount,
    getGlobalStats,
    getRules: readRules,
    getSummary,
    getSpendTotals,
    listAccounts,
    listTransactions,
    release,
    reserve,
    saveRules,
    transferBalance
  };
}

module.exports = { createBillingService };
