const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const RESERVATION_TTL_MS = 2 * 60 * 60 * 1000;
const BILLING_TYPES = new Set(['image', 'llm']);
const BILLING_CURRENCY = 'USD';
const BILLING_SCALE = 1_000_000;
const LEGACY_CENT_TO_MICRO = 10_000;
const DEFAULT_RELAY_ID = 'default-relay';

function createBillingService(dataRoot) {
  const root = path.join(dataRoot, 'system');
  const rulesFile = path.join(root, 'billing-rules.json');
  const accountsFile = path.join(root, 'billing-accounts.json');
  const ledgerFile = path.join(root, 'billing-ledger.jsonl');
  let mutationChain = Promise.resolve();
  let legacyRelayId = DEFAULT_RELAY_ID;

  const defaultRules = () => ({
    version: 2,
    enabled: false,
    currency: BILLING_CURRENCY,
    amountScale: BILLING_SCALE,
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

  function normalizeRelayId(value) {
    const relayId = String(value || '').trim().toLowerCase();
    if (!/^[a-z0-9_-]{1,80}$/.test(relayId)) throw new Error('中转站编号无效');
    return relayId;
  }

  function setLegacyRelayId(value) {
    legacyRelayId = normalizeRelayId(value || DEFAULT_RELAY_ID);
    return legacyRelayId;
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
    return {
      ...defaultRules(),
      enabled: value?.enabled === true,
      currency: BILLING_CURRENCY,
      amountScale: BILLING_SCALE,
      updatedAt: String(value?.updatedAt || '')
    };
  }

  async function readAccounts() {
    const value = await readJson(accountsFile, { version: 1, accounts: {} });
    const sourceScale = value?.amountScale === BILLING_SCALE ? BILLING_SCALE : 100;
    const accounts = value?.accounts && typeof value.accounts === 'object' ? value.accounts : {};
    if (sourceScale !== BILLING_SCALE) {
      for (const record of Object.values(accounts)) {
        if (!record || typeof record !== 'object') continue;
        const wallets = record.wallets && typeof record.wallets === 'object' ? Object.values(record.wallets) : [record];
        for (const wallet of wallets) {
          wallet.balanceMinor = migrateMoney(wallet.balanceMinor, sourceScale);
          for (const reservation of Object.values(wallet.reservations || {})) {
            if (reservation && typeof reservation === 'object') reservation.amountMinor = migrateMoney(reservation.amountMinor, sourceScale);
          }
        }
      }
    }
    return { version: 2, currency: BILLING_CURRENCY, amountScale: BILLING_SCALE, accounts };
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

  function normalizeWallet(account, initialBalance = 0) {
    const value = account && typeof account === 'object' ? account : {};
    const existingBalance = Number(value.balanceMinor);
    value.balanceMinor = Number.isFinite(existingBalance) && existingBalance >= 0
      ? existingBalance
      : Math.max(0, Number(initialBalance) || 0);
    value.reservations = value.reservations && typeof value.reservations === 'object' ? value.reservations : {};
    value.chargedOnce = value.chargedOnce && typeof value.chargedOnce === 'object' ? value.chargedOnce : {};
    value.adjustedOnce = value.adjustedOnce && typeof value.adjustedOnce === 'object' ? value.adjustedOnce : {};
    value.createdAt ||= new Date().toISOString();
    value.updatedAt ||= value.createdAt;
    cleanReservations(value);
    return value;
  }

  function normalizeAccountRecord(record) {
    const source = record && typeof record === 'object' ? record : {};
    if (!source.wallets || typeof source.wallets !== 'object') {
      const legacyWallet = normalizeWallet({
        balanceMinor: source.balanceMinor,
        reservations: source.reservations,
        chargedOnce: source.chargedOnce,
        adjustedOnce: source.adjustedOnce,
        createdAt: source.createdAt,
        updatedAt: source.updatedAt
      });
      source.wallets = { [legacyRelayId]: legacyWallet };
      delete source.balanceMinor;
      delete source.reservations;
      delete source.chargedOnce;
      delete source.adjustedOnce;
    }
    source.createdAt ||= new Date().toISOString();
    source.updatedAt ||= source.createdAt;
    for (const [relayId, wallet] of Object.entries(source.wallets)) {
      source.wallets[normalizeRelayId(relayId)] = normalizeWallet(wallet);
    }
    return source;
  }

  function accountWallet(state, workspaceId, relayIdValue, create = true) {
    const relayId = normalizeRelayId(relayIdValue || legacyRelayId);
    const record = normalizeAccountRecord(state.accounts[workspaceId]);
    state.accounts[workspaceId] = record;
    if (!record.wallets[relayId] && create) record.wallets[relayId] = normalizeWallet({});
    return { record, relayId, wallet: record.wallets[relayId] || null };
  }

  function reservedMinor(account) {
    return Object.values(account.reservations || {}).reduce((total, item) => total + Math.max(0, Number(item?.amountMinor) || 0), 0);
  }

  function publicAccount(workspaceId, relayId, account) {
    const reserved = reservedMinor(account);
    return {
      workspaceId,
      relayId,
      balanceMinor: account.balanceMinor,
      reservedMinor: reserved,
      availableMinor: Math.max(0, account.balanceMinor - reserved),
      updatedAt: account.updatedAt || ''
    };
  }

  function publicWorkspaceAccount(workspaceId, record) {
    const wallets = Object.entries(normalizeAccountRecord(record).wallets).map(([relayId, wallet]) => publicAccount(workspaceId, relayId, wallet));
    return {
      workspaceId,
      wallets,
      balanceMinor: wallets.reduce((total, wallet) => total + wallet.balanceMinor, 0),
      reservedMinor: wallets.reduce((total, wallet) => total + wallet.reservedMinor, 0),
      availableMinor: wallets.reduce((total, wallet) => total + wallet.availableMinor, 0),
      updatedAt: wallets.map(wallet => wallet.updatedAt).sort().at(-1) || ''
    };
  }

  async function appendLedger(entry) {
    await fs.mkdir(root, { recursive: true });
    await fs.appendFile(ledgerFile, `${JSON.stringify(entry)}\n`, { encoding: 'utf8', mode: 0o600 });
  }

  async function ensureAccount(workspaceIdValue, relayIdValue = legacyRelayId) {
    const workspaceId = normalizeWorkspaceId(workspaceIdValue);
    return mutate(async () => {
      const state = await readAccounts();
      const existed = Boolean(state.accounts[workspaceId] && normalizeAccountRecord(state.accounts[workspaceId]).wallets?.[normalizeRelayId(relayIdValue)]);
      const { relayId, wallet } = accountWallet(state, workspaceId, relayIdValue);
      if (!existed) await writeJson(accountsFile, state);
      return publicAccount(workspaceId, relayId, wallet);
    });
  }

  async function getSummary(workspaceIdValue, relayIdValue = legacyRelayId, limitValue = 20) {
    const workspaceId = normalizeWorkspaceId(workspaceIdValue);
    if (typeof relayIdValue === 'number') {
      limitValue = relayIdValue;
      relayIdValue = legacyRelayId;
    }
    const relayId = normalizeRelayId(relayIdValue || legacyRelayId);
    const [rules, account, transactions, allTransactions] = await Promise.all([
      readRules(),
      ensureAccount(workspaceId, relayId),
      listTransactions(workspaceId, limitValue, relayId),
      listTransactions(workspaceId, Math.max(100, limitValue))
    ]);
    const state = await readAccounts();
    const record = normalizeAccountRecord(state.accounts[workspaceId]);
    const wallets = Object.entries(record.wallets).map(([walletRelayId, wallet]) => publicAccount(workspaceId, walletRelayId, wallet));
    const spendTotals = await getSpendTotals(workspaceId, [1, 7, 30], relayId);
    return { rules, relayId, account, wallets, transactions, allTransactions, spendTotals };
  }

  async function getSpendTotals(workspaceIdValue = '', daysValues = [1, 7, 30], relayIdValue = '') {
    const workspaceId = workspaceIdValue ? normalizeWorkspaceId(workspaceIdValue) : '';
    const relayId = relayIdValue ? normalizeRelayId(relayIdValue) : '';
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
        const entryRelayId = String(entry.relayId || legacyRelayId);
        if (relayId && entryRelayId !== relayId) continue;
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
    if (range === 'month') {
      const chinaNow = new Date(nowMs + chinaOffsetMs);
      const monthStartMs = Date.UTC(chinaNow.getUTCFullYear(), chinaNow.getUTCMonth(), 1) - chinaOffsetMs;
      return { range, startMs: monthStartMs, endMs: nowMs };
    }
    return { range: 'today', startMs: todayStartMs, endMs: nowMs };
  }

  function accountingWindowRange(options = {}) {
    const nowMs = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const chinaOffsetMs = 8 * 60 * 60 * 1000;
    const todayStartMs = Math.floor((nowMs + chinaOffsetMs) / dayMs) * dayMs - chinaOffsetMs;
    const range = String(options.range || 'month');
    const chinaDate = ms => new Date(ms + chinaOffsetMs).toISOString().slice(0, 10);
    const dateStart = value => {
      const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!match) return NaN;
      const year = Number(match[1]);
      const month = Number(match[2]);
      const day = Number(match[3]);
      const utc = Date.UTC(year, month - 1, day);
      const parsed = new Date(utc);
      if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return NaN;
      return utc - chinaOffsetMs;
    };
    let startMs = todayStartMs;
    let endMs = nowMs;
    let normalizedRange = range;
    if (range === 'yesterday') {
      startMs = todayStartMs - dayMs;
      endMs = todayStartMs;
    } else if (range === '7d') startMs = todayStartMs - 6 * dayMs;
    else if (range === 'month') {
      const chinaNow = new Date(nowMs + chinaOffsetMs);
      startMs = Date.UTC(chinaNow.getUTCFullYear(), chinaNow.getUTCMonth(), 1) - chinaOffsetMs;
    } else if (range === 'last_month') {
      const chinaNow = new Date(nowMs + chinaOffsetMs);
      endMs = Date.UTC(chinaNow.getUTCFullYear(), chinaNow.getUTCMonth(), 1) - chinaOffsetMs;
      startMs = Date.UTC(chinaNow.getUTCFullYear(), chinaNow.getUTCMonth() - 1, 1) - chinaOffsetMs;
    } else if (range === 'custom') {
      startMs = dateStart(options.startDate);
      const inclusiveEndMs = dateStart(options.endDate);
      if (!Number.isFinite(startMs) || !Number.isFinite(inclusiveEndMs) || inclusiveEndMs < startMs) throw new Error('自定义账目日期范围无效');
      endMs = inclusiveEndMs + dayMs;
      if (endMs - startMs > 3660 * dayMs) throw new Error('自定义账目日期范围不能超过十年');
    } else if (range !== 'today') {
      normalizedRange = 'month';
      const chinaNow = new Date(nowMs + chinaOffsetMs);
      startMs = Date.UTC(chinaNow.getUTCFullYear(), chinaNow.getUTCMonth(), 1) - chinaOffsetMs;
    }
    return {
      range: normalizedRange,
      startMs,
      endMs,
      startDate: chinaDate(startMs),
      endDate: chinaDate(Math.max(startMs, endMs - 1))
    };
  }

  async function getLedgerReport(userLookup = new Map(), options = {}) {
    const windowRange = accountingWindowRange({ range: options.range || 'today', startDate: options.startDate, endDate: options.endDate });
    const requestedRelayId = String(options.relayId || '').trim();
    const relayId = requestedRelayId ? normalizeRelayId(requestedRelayId) : '';
    const limit = Math.max(1, Math.min(500, Math.trunc(Number(options.limit) || 500)));
    let text = '';
    try { text = await fs.readFile(ledgerFile, 'utf8'); } catch { text = ''; }
    const transactions = [];
    const activeWorkspaces = new Set();
    let transactionCount = 0;
    let imageSpendMinor = 0;
    let imageCount = 0;
    let analysisSpendMinor = 0;
    let analysisCount = 0;
    for (const line of text.trim().split('\n').filter(Boolean)) {
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }
      const workspaceId = String(entry.workspaceId || '');
      if (!userLookup.has(workspaceId)) continue;
      const entryRelayId = String(entry.relayId || legacyRelayId);
      if (relayId && entryRelayId !== relayId) continue;
      const created = new Date(entry.createdAt).getTime();
      if (!Number.isFinite(created) || created < windowRange.startMs || created >= windowRange.endMs) continue;
      const sourceScale = entry?.amountScale === BILLING_SCALE ? BILLING_SCALE : 100;
      const amountMinor = sourceScale === BILLING_SCALE ? Math.trunc(Number(entry.amountMinor) || 0) : migrateMoney(entry.amountMinor, sourceScale);
      transactionCount += 1;
      activeWorkspaces.add(workspaceId);
      if (entry.kind === 'image' && amountMinor < 0) {
        imageSpendMinor += Math.abs(amountMinor);
        imageCount += 1;
      }
      if (entry.kind === 'llm' && amountMinor <= 0) {
        analysisSpendMinor += Math.abs(amountMinor);
        analysisCount += 1;
      }
      transactions.push({ ...entry, relayId: entryRelayId, currency: BILLING_CURRENCY, amountScale: BILLING_SCALE, amountMinor, balanceMinor: sourceScale === BILLING_SCALE ? Math.trunc(Number(entry.balanceMinor) || 0) : migrateMoney(entry.balanceMinor, sourceScale) });
    }
    transactions.reverse();
    return {
      relayId,
      range: windowRange.range,
      startDate: windowRange.startDate,
      endDate: windowRange.endDate,
      startedAt: new Date(windowRange.startMs).toISOString(),
      endedAt: new Date(windowRange.endMs).toISOString(),
      metrics: {
        imageSpendMinor,
        imageCount,
        averageImageCostMinor: imageCount ? Math.round(imageSpendMinor / imageCount) : 0,
        analysisSpendMinor,
        analysisCount,
        averageAnalysisCostMinor: analysisCount ? Math.round(analysisSpendMinor / analysisCount) : 0,
        totalSpendMinor: imageSpendMinor + analysisSpendMinor,
        transactionCount,
        activeUserCount: activeWorkspaces.size
      },
      transactions: transactions.slice(0, limit),
      truncated: transactions.length > limit
    };
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

  async function buildBalanceSummary(userLookup = new Map(), relayIdValue = '') {
    const relayId = relayIdValue ? normalizeRelayId(relayIdValue) : '';
    const state = await readAccounts();
    const totals = { count: 0, balanceMinor: 0, availableMinor: 0, reservedMinor: 0 };
    const byRole = new Map();
    const byAccount = [];
    for (const [lookupWorkspaceId, user] of userLookup.entries()) {
      const workspaceId = String(user?.workspaceId || lookupWorkspaceId || '').trim();
      if (!workspaceId || user?.role === 'superadmin') continue;
      const record = normalizeAccountRecord(state.accounts[workspaceId]);
      const publicValue = relayId
        ? publicAccount(workspaceId, relayId, record.wallets[relayId] || normalizeWallet({}))
        : publicWorkspaceAccount(workspaceId, record);
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

  async function getGlobalStats(rangeValue = 'today', userLookup = new Map(), relayIdValue = '') {
    const relayId = relayIdValue ? normalizeRelayId(relayIdValue) : '';
    const balanceSummary = await buildBalanceSummary(userLookup, relayId);
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
      const entryRelayId = String(entry.relayId || legacyRelayId);
      if (relayId && entryRelayId !== relayId) continue;
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
      relayId,
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

  async function getAccountingReport(relayValues = [], userLookup = new Map(), options = {}) {
    const windowRange = accountingWindowRange(options);
    const requestedRelayId = String(options.relayId || '').trim();
    const relays = (Array.isArray(relayValues) ? relayValues : []).map(relay => ({
      id: normalizeRelayId(relay?.id),
      name: String(relay?.name || relay?.id || '未命名中转站').slice(0, 80),
      enabled: relay?.enabled !== false,
      customerCnyPerUsd: Math.max(0.000001, Number(relay?.customerCnyPerUsd) || 7),
      upstreamImageCostCnyMicro: Math.max(0, Math.trunc(Number(relay?.upstreamImageCostCnyMicro) || 0)),
      upstreamAnalysisCostCnyMicro: Math.max(0, Math.trunc(Number(relay?.upstreamAnalysisCostCnyMicro) || 0))
    })).filter(relay => !requestedRelayId || relay.id === requestedRelayId);
    if (requestedRelayId && !relays.length) throw new Error('中转站不存在');
    const byRelay = new Map(relays.map(relay => [relay.id, {
      ...relay,
      lifetimeSpendUsdMinor: 0,
      customerTopupUsdMinor: 0,
      confirmedSpendUsdMinor: 0,
      successfulImages: 0,
      successfulAnalyses: 0,
      daily: new Map()
    }]));
    let text = '';
    try { text = await fs.readFile(ledgerFile, 'utf8'); } catch { text = ''; }
    for (const line of text.trim().split('\n').filter(Boolean)) {
      let entry;
      try { entry = JSON.parse(line); } catch { continue; }
      if (userLookup.get(entry.workspaceId)?.role === 'superadmin') continue;
      const relayId = String(entry.relayId || legacyRelayId);
      const report = byRelay.get(relayId);
      if (!report) continue;
      const sourceScale = entry?.amountScale === BILLING_SCALE ? BILLING_SCALE : 100;
      const amountMinor = sourceScale === BILLING_SCALE
        ? Math.trunc(Number(entry.amountMinor) || 0)
        : migrateMoney(entry.amountMinor, sourceScale);
      const createdAt = new Date(entry.createdAt).getTime();
      const inWindow = Number.isFinite(createdAt) && createdAt >= windowRange.startMs && createdAt < windowRange.endMs;
      const kind = String(entry.kind || '');
      if ((kind === 'image' || kind === 'llm') && amountMinor < 0) report.lifetimeSpendUsdMinor += Math.abs(amountMinor);
      if (!inWindow) continue;
      const day = new Date(createdAt + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const point = report.daily.get(day) || { date: day, topupUsdMinor: 0, spendUsdMinor: 0, successfulImages: 0, successfulAnalyses: 0 };
      if (kind === 'adjustment' && amountMinor > 0) {
        report.customerTopupUsdMinor += amountMinor;
        point.topupUsdMinor += amountMinor;
      } else if (kind === 'image' && amountMinor < 0) {
        report.confirmedSpendUsdMinor += Math.abs(amountMinor);
        report.successfulImages += 1;
        point.spendUsdMinor += Math.abs(amountMinor);
        point.successfulImages += 1;
      } else if (kind === 'llm' && amountMinor <= 0) {
        report.confirmedSpendUsdMinor += Math.abs(amountMinor);
        report.successfulAnalyses += 1;
        point.spendUsdMinor += Math.abs(amountMinor);
        point.successfulAnalyses += 1;
      } else {
        continue;
      }
      report.daily.set(day, point);
    }
    const reports = [];
    const daily = [];
    for (const relay of relays) {
      const report = byRelay.get(relay.id);
      const balanceSummary = await buildBalanceSummary(userLookup, relay.id);
      const customerBalanceUsdMinor = balanceSummary.totals.balanceMinor;
      const customerRechargeUsdMinor = customerBalanceUsdMinor + report.lifetimeSpendUsdMinor;
      const usdMicroToCnyMinor = amount => Math.round((Math.max(0, Number(amount) || 0) / BILLING_SCALE) * relay.customerCnyPerUsd * 100);
      const customerRechargeCnyMinor = usdMicroToCnyMinor(customerRechargeUsdMinor);
      const customerBalanceCnyMinor = usdMicroToCnyMinor(customerBalanceUsdMinor);
      const customerTopupCnyMinor = usdMicroToCnyMinor(report.customerTopupUsdMinor);
      const confirmedRevenueCnyMinor = usdMicroToCnyMinor(report.confirmedSpendUsdMinor);
      const upstreamImageCostCnyMinor = Math.round((report.successfulImages * relay.upstreamImageCostCnyMicro) / 10_000);
      const upstreamAnalysisCostCnyMinor = Math.round((report.successfulAnalyses * relay.upstreamAnalysisCostCnyMicro) / 10_000);
      const upstreamCostCnyMinor = upstreamImageCostCnyMinor + upstreamAnalysisCostCnyMinor;
      const imageCostConfigured = relay.upstreamImageCostCnyMicro > 0 || report.successfulImages === 0;
      const analysisCostConfigured = relay.upstreamAnalysisCostCnyMicro > 0 || report.successfulAnalyses === 0;
      const costConfigured = imageCostConfigured && analysisCostConfigured;
      reports.push({
        relayId: relay.id,
        relayName: relay.name,
        enabled: relay.enabled,
        customerCnyPerUsd: relay.customerCnyPerUsd,
        upstreamImageCostCnyMicro: relay.upstreamImageCostCnyMicro,
        upstreamAnalysisCostCnyMicro: relay.upstreamAnalysisCostCnyMicro,
        costConfigured,
        imageCostConfigured,
        analysisCostConfigured,
        successfulImages: report.successfulImages,
        successfulAnalyses: report.successfulAnalyses,
        customerRechargeUsdMinor,
        customerBalanceUsdMinor,
        customerTopupUsdMinor: report.customerTopupUsdMinor,
        confirmedSpendUsdMinor: report.confirmedSpendUsdMinor,
        customerRechargeCnyMinor,
        customerBalanceCnyMinor,
        customerTopupCnyMinor,
        confirmedRevenueCnyMinor,
        upstreamImageCostCnyMinor,
        upstreamAnalysisCostCnyMinor,
        upstreamCostCnyMinor,
        grossProfitCnyMinor: confirmedRevenueCnyMinor - upstreamCostCnyMinor
      });
      for (const point of report.daily.values()) {
        const customerTopupCnyMinor = usdMicroToCnyMinor(point.topupUsdMinor);
        const revenueCnyMinor = usdMicroToCnyMinor(point.spendUsdMinor);
        const upstreamImageCostCnyMinor = Math.round((point.successfulImages * relay.upstreamImageCostCnyMicro) / 10_000);
        const upstreamAnalysisCostCnyMinor = Math.round((point.successfulAnalyses * relay.upstreamAnalysisCostCnyMicro) / 10_000);
        const upstreamCostCnyMinor = upstreamImageCostCnyMinor + upstreamAnalysisCostCnyMinor;
        daily.push({
          date: point.date,
          relayId: relay.id,
          relayName: relay.name,
          successfulImages: point.successfulImages,
          successfulAnalyses: point.successfulAnalyses,
          customerTopupCnyMinor,
          revenueCnyMinor,
          upstreamImageCostCnyMinor,
          upstreamAnalysisCostCnyMinor,
          upstreamCostCnyMinor,
          imageCostConfigured: relay.upstreamImageCostCnyMicro > 0 || point.successfulImages === 0,
          analysisCostConfigured: relay.upstreamAnalysisCostCnyMicro > 0 || point.successfulAnalyses === 0,
          costConfigured: (relay.upstreamImageCostCnyMicro > 0 || point.successfulImages === 0)
            && (relay.upstreamAnalysisCostCnyMicro > 0 || point.successfulAnalyses === 0)
        });
      }
    }
    return {
      currency: 'CNY',
      range: windowRange.range,
      startedAt: new Date(windowRange.startMs).toISOString(),
      endedAt: new Date(windowRange.endMs).toISOString(),
      startDate: windowRange.startDate,
      endDate: windowRange.endDate,
      relayId: requestedRelayId,
      relays: reports,
      daily: daily.sort((left, right) => right.date.localeCompare(left.date) || left.relayName.localeCompare(right.relayName, 'zh-CN')),
      complete: reports.every(report => report.costConfigured),
      totals: {
        customerRechargeCnyMinor: reports.reduce((sum, report) => sum + report.customerRechargeCnyMinor, 0),
        customerBalanceCnyMinor: reports.reduce((sum, report) => sum + report.customerBalanceCnyMinor, 0),
        customerTopupCnyMinor: reports.reduce((sum, report) => sum + report.customerTopupCnyMinor, 0),
        confirmedRevenueCnyMinor: reports.reduce((sum, report) => sum + report.confirmedRevenueCnyMinor, 0),
        upstreamCostCnyMinor: reports.reduce((sum, report) => sum + report.upstreamCostCnyMinor, 0),
        grossProfitCnyMinor: reports.reduce((sum, report) => sum + report.grossProfitCnyMinor, 0),
        successfulImages: reports.reduce((sum, report) => sum + report.successfulImages, 0),
        successfulAnalyses: reports.reduce((sum, report) => sum + report.successfulAnalyses, 0),
        upstreamImageCostCnyMinor: reports.reduce((sum, report) => sum + report.upstreamImageCostCnyMinor, 0),
        upstreamAnalysisCostCnyMinor: reports.reduce((sum, report) => sum + report.upstreamAnalysisCostCnyMinor, 0)
      }
    };
  }

  async function saveRules(payload = {}) {
    return mutate(async () => {
      const rules = {
        ...defaultRules(),
        enabled: payload.enabled === true,
        updatedAt: new Date().toISOString()
      };
      await writeJson(rulesFile, rules);
      return rules;
    });
  }

  async function listAccounts(workspaceIds = [], relayIds = []) {
    return mutate(async () => {
      const state = await readAccounts();
      let changed = false;
      const result = [];
      for (const value of workspaceIds) {
        const workspaceId = normalizeWorkspaceId(value);
        const record = normalizeAccountRecord(state.accounts[workspaceId]);
        state.accounts[workspaceId] = record;
        for (const relayIdValue of relayIds) {
          const relayId = normalizeRelayId(relayIdValue);
          if (!record.wallets[relayId]) {
            record.wallets[relayId] = normalizeWallet({});
            changed = true;
          }
        }
        result.push(publicWorkspaceAccount(workspaceId, record));
      }
      if (changed) await writeJson(accountsFile, state);
      return result;
    });
  }

  async function adjustBalance(workspaceIdValue, relayIdValue, amountMinorValue, metadata = {}) {
    const workspaceId = normalizeWorkspaceId(workspaceIdValue);
    if (typeof relayIdValue === 'number') {
      metadata = amountMinorValue || {};
      amountMinorValue = relayIdValue;
      relayIdValue = legacyRelayId;
    }
    const relayId = normalizeRelayId(relayIdValue || legacyRelayId);
    const amountMinor = Number(amountMinorValue);
    if (!Number.isSafeInteger(amountMinor) || amountMinor === 0 || Math.abs(amountMinor) > 1_000_000_000_000) {
      throw new Error('账户金额变更必须是非零的美元 6 位小数单位整数');
    }
    return mutate(async () => {
      const state = await readAccounts();
      const { record, wallet: account } = accountWallet(state, workspaceId, relayId);
      const onceKey = normalizeBillingOnceKey(metadata.onceKey || metadata.adjustmentOnceKey);
      if (onceKey && account.adjustedOnce?.[onceKey]) {
        return { account: publicAccount(workspaceId, relayId, account), transaction: null, adjustmentId: account.adjustedOnce[onceKey], alreadyAdjusted: true };
      }
      const next = account.balanceMinor + amountMinor;
      if (next < 0) throw new Error('扣减金额不能超过当前余额');
      account.balanceMinor = next;
      account.updatedAt = new Date().toISOString();
      record.updatedAt = account.updatedAt;
      const entry = {
        id: crypto.randomUUID(),
        workspaceId,
        relayId,
        relayName: String(metadata.relayName || '').slice(0, 80),
        kind: 'adjustment',
        currency: BILLING_CURRENCY,
        amountScale: BILLING_SCALE,
        amountMinor,
        balanceMinor: next,
        description: String(metadata.description || (amountMinor > 0 ? '账户充值到账' : '算力余额扣减')).slice(0, 160),
        reference: String(metadata.reference || '').slice(0, 240),
        onceKey,
        operatorUserId: String(metadata.operatorUserId || '').slice(0, 80),
        createdAt: account.updatedAt
      };
      if (onceKey) account.adjustedOnce[onceKey] = entry.id;
      await writeJson(accountsFile, state);
      await appendLedger(entry);
      return { account: publicAccount(workspaceId, relayId, account), transaction: entry };
    });
  }

  async function reserve(workspaceIdValue, typeValue, metadata = {}) {
    const workspaceId = normalizeWorkspaceId(workspaceIdValue);
    const type = String(typeValue || '');
    if (!BILLING_TYPES.has(type)) throw new Error('未知计费类型');
    const relayId = normalizeRelayId(metadata.relayId || legacyRelayId);
    return mutate(async () => {
      const rules = await readRules();
      if (!rules.enabled) return { billable: false, workspaceId, relayId, type, amountMinor: 0 };
      const overrideAmount = Number(metadata.amountMinor ?? metadata.billingAmountMinor);
      const overrideMin = Number(metadata.amountMinMinor ?? metadata.billingAmountMinMinor);
      const overrideMax = Number(metadata.amountMaxMinor ?? metadata.billingAmountMaxMinor);
      const hasOverrideRange = Number.isSafeInteger(overrideMin) && Number.isSafeInteger(overrideMax) && overrideMin >= 0 && overrideMax >= overrideMin;
      const min = hasOverrideRange ? overrideMin : (Number.isSafeInteger(overrideAmount) && overrideAmount >= 0 ? overrideAmount : NaN);
      const max = hasOverrideRange ? overrideMax : min;
      if (!Number.isSafeInteger(min) || !Number.isSafeInteger(max)) throw new Error('当前中转站未配置扣费标准');
      const amountMinor = Number.isSafeInteger(overrideAmount) && overrideAmount >= 0
        ? overrideAmount
        : (min === max ? min : min + crypto.randomInt(max - min + 1));
      if (amountMinor <= 0 && metadata.recordUsage !== true) return { billable: false, workspaceId, relayId, type, amountMinor: 0 };
      const state = await readAccounts();
      const { record, wallet: account } = accountWallet(state, workspaceId, relayId);
      const onceKey = normalizeBillingOnceKey(metadata.onceKey || metadata.billingOnceKey);
      if (onceKey && account.chargedOnce?.[onceKey]) return { billable: false, workspaceId, relayId, type, amountMinor: 0, onceKey, alreadyCharged: true };
      if (onceKey && Object.values(account.reservations || {}).some(reservation => reservation?.onceKey === onceKey)) {
        return { billable: false, workspaceId, relayId, type, amountMinor: 0, onceKey, alreadyReserved: true };
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
        relayId,
        relayName: String(metadata.relayName || '').slice(0, 80),
        modelId: String(metadata.modelId || '').slice(0, 120),
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
      record.updatedAt = account.updatedAt;
      await writeJson(accountsFile, state);
      return { billable: true, id, workspaceId, relayId, type, amountMinor };
    });
  }

  async function commit(reservation) {
    if (!reservation?.billable) return null;
    return mutate(async () => {
      const state = await readAccounts();
      const relayId = normalizeRelayId(reservation.relayId || legacyRelayId);
      const { record, wallet: account } = accountWallet(state, reservation.workspaceId, relayId, false);
      if (!account) return null;
      const stored = account.reservations?.[reservation.id];
      if (!stored) return null;
      const amountMinor = Math.max(0, Number(stored.amountMinor) || 0);
      account.balanceMinor = Math.max(0, account.balanceMinor - amountMinor);
      delete account.reservations[reservation.id];
      account.updatedAt = new Date().toISOString();
      if (stored.onceKey) account.chargedOnce ||= {};
      if (stored.onceKey) account.chargedOnce[stored.onceKey] = account.updatedAt;
      record.updatedAt = account.updatedAt;
      const entry = {
        id: crypto.randomUUID(),
        workspaceId: reservation.workspaceId,
        relayId,
        relayName: stored.relayName || '',
        modelId: stored.modelId || '',
        unitPriceMinor: amountMinor,
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
      const relayId = normalizeRelayId(reservation.relayId || legacyRelayId);
      const { record, wallet: account } = accountWallet(state, reservation.workspaceId, relayId, false);
      if (!account) return false;
      if (!account.reservations?.[reservation.id]) return false;
      delete account.reservations[reservation.id];
      account.updatedAt = new Date().toISOString();
      record.updatedAt = account.updatedAt;
      await writeJson(accountsFile, state);
      return true;
    });
  }

  async function transferBalance(fromWorkspaceIdValue, toWorkspaceIdValue, relayIdValue, amountMinorValue, metadata = {}) {
    const fromWorkspaceId = normalizeWorkspaceId(fromWorkspaceIdValue);
    const toWorkspaceId = normalizeWorkspaceId(toWorkspaceIdValue);
    if (typeof relayIdValue === 'number') {
      metadata = amountMinorValue || {};
      amountMinorValue = relayIdValue;
      relayIdValue = legacyRelayId;
    }
    const relayId = normalizeRelayId(relayIdValue || legacyRelayId);
    if (fromWorkspaceId === toWorkspaceId) throw new Error('不能给自己划拨算力余额');
    const amountMinor = normalizeMinor(amountMinorValue, '划拨金额');
    if (amountMinor <= 0) throw new Error('划拨金额必须大于 0');
    return mutate(async () => {
      const state = await readAccounts();
      const { record: fromRecord, wallet: from } = accountWallet(state, fromWorkspaceId, relayId);
      const { record: toRecord, wallet: to } = accountWallet(state, toWorkspaceId, relayId);
      if (from.balanceMinor - reservedMinor(from) < amountMinor) throw new Error('转出账户可用算力余额不足，无法划拨');
      const now = new Date().toISOString();
      const transferId = crypto.randomUUID();
      from.balanceMinor -= amountMinor;
      to.balanceMinor += amountMinor;
      from.updatedAt = now;
      to.updatedAt = now;
      fromRecord.updatedAt = now;
      toRecord.updatedAt = now;
      const debit = {
        id: crypto.randomUUID(),
        transferId,
        workspaceId: fromWorkspaceId,
        relayId,
        relayName: String(metadata.relayName || '').slice(0, 80),
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
        transferId,
        workspaceId: toWorkspaceId,
        relayId,
        relayName: String(metadata.relayName || '').slice(0, 80),
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
        relayId,
        from: publicAccount(fromWorkspaceId, relayId, from),
        to: publicAccount(toWorkspaceId, relayId, to),
        transactions: [debit, credit]
      };
    });
  }

  async function listTransactions(workspaceIdValue = '', limitValue = 50, relayIdValue = '') {
    const workspaceId = workspaceIdValue ? normalizeWorkspaceId(workspaceIdValue) : '';
    const limit = Math.max(1, Math.min(500, Number(limitValue) || 50));
    const relayId = relayIdValue ? normalizeRelayId(relayIdValue) : '';
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
        entry.relayId = String(entry.relayId || legacyRelayId);
        if ((!workspaceId || entry.workspaceId === workspaceId) && (!relayId || entry.relayId === relayId)) result.push(entry);
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

  async function getRelayUsageState(relayIdValue) {
    const relayId = normalizeRelayId(relayIdValue);
    const state = await readAccounts();
    let balanceMinor = 0;
    let reserved = 0;
    let walletCount = 0;
    for (const record of Object.values(state.accounts)) {
      const wallet = record?.wallets?.[relayId];
      if (!wallet) continue;
      walletCount += 1;
      balanceMinor += Math.max(0, Number(wallet.balanceMinor) || 0);
      reserved += reservedMinor(wallet);
    }
    const transactions = await listTransactions('', 500);
    return {
      relayId,
      walletCount,
      balanceMinor,
      reservedMinor: reserved,
      transactionCount: transactions.filter(entry => entry.relayId === relayId).length,
      inUse: balanceMinor > 0 || reserved > 0 || transactions.some(entry => entry.relayId === relayId)
    };
  }

  async function migrateLegacyBalances(relayIdValue) {
    const relayId = setLegacyRelayId(relayIdValue || DEFAULT_RELAY_ID);
    return mutate(async () => {
      const state = await readAccounts();
      let migrated = 0;
      for (const [workspaceId, value] of Object.entries(state.accounts)) {
        if (value?.wallets && typeof value.wallets === 'object') continue;
        state.accounts[workspaceId] = normalizeAccountRecord(value);
        migrated += 1;
      }
      if (migrated) await writeJson(accountsFile, state);
      return { relayId, migrated };
    });
  }

  return {
    adjustBalance,
    clearTransactions,
    commit,
    ensureAccount,
    getAccountingReport,
    getGlobalStats,
    getLedgerReport,
    getRelayUsageState,
    getRules: readRules,
    getSummary,
    getSpendTotals,
    listAccounts,
    listTransactions,
    migrateLegacyBalances,
    release,
    reserve,
    saveRules,
    setLegacyRelayId,
    transferBalance
  };
}

module.exports = { createBillingService };
