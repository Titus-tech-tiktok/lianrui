const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const FINANCE_CATEGORIES = Object.freeze({
  client_payment: { direction: 'income', label: '客户充值' },
  other_income: { direction: 'income', label: '其他收入' },
  gateway_topup: { direction: 'transfer', label: '上游充值' },
  development: { direction: 'expense', label: '开发费用' },
  membership: { direction: 'expense', label: '会员费' },
  server: { direction: 'expense', label: '服务器费用' },
  software: { direction: 'expense', label: '软件费用' },
  refund: { direction: 'expense', label: '退款' },
  other_expense: { direction: 'expense', label: '其他支出' }
});

function createFinanceLedgerService(dataRoot) {
  const ledgerFile = path.join(dataRoot, 'system', 'finance-ledger.json');
  let mutationChain = Promise.resolve();

  function mutate(worker) {
    const operation = mutationChain.then(worker);
    mutationChain = operation.catch(() => {});
    return operation;
  }

  async function readLedger() {
    try {
      const value = JSON.parse(await fs.readFile(ledgerFile, 'utf8'));
      return {
        version: 1,
        entries: Array.isArray(value?.entries) ? value.entries.filter(Boolean) : []
      };
    } catch (error) {
      if (error?.code !== 'ENOENT') throw new Error('财务账本无法读取，请检查数据文件');
      return { version: 1, entries: [] };
    }
  }

  async function writeLedger(value) {
    await fs.mkdir(path.dirname(ledgerFile), { recursive: true });
    const temporary = `${ledgerFile}.${process.pid}-${crypto.randomBytes(4).toString('hex')}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temporary, ledgerFile);
  }

  function normalizeDate(value) {
    const date = String(value || '').trim();
    const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const parsed = match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : null;
    if (!parsed
      || parsed.getUTCFullYear() !== Number(match[1])
      || parsed.getUTCMonth() !== Number(match[2]) - 1
      || parsed.getUTCDate() !== Number(match[3])) {
      throw new Error('日期格式无效');
    }
    return date;
  }

  function normalizeMonth(value) {
    const chinaNow = new Date(Date.now() + 8 * 60 * 60 * 1000);
    const month = String(value || chinaNow.toISOString().slice(0, 7)).trim();
    if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('月份格式无效');
    const monthNumber = Number(month.slice(5));
    if (monthNumber < 1 || monthNumber > 12) throw new Error('月份格式无效');
    return month;
  }

  function parseMoneyToMinor(value, name = '金额') {
    const text = String(value ?? '').trim();
    if (!/^\d+(?:\.\d{1,2})?$/.test(text)) throw new Error(`${name}必须是最多两位小数的正数`);
    const [whole, fraction = ''] = text.split('.');
    const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
    if (!Number.isSafeInteger(minor) || minor <= 0 || minor > 100_000_000_000) {
      throw new Error(`${name}超出有效范围`);
    }
    return minor;
  }

  function normalizeEntry(input = {}, existing = {}) {
    const category = String(input.category ?? existing.category ?? '').trim();
    const categoryDefinition = FINANCE_CATEGORIES[category];
    if (!categoryDefinition) throw new Error('收支分类无效');
    const currency = String(input.currency ?? existing.currency ?? 'CNY').trim().toUpperCase();
    if (!['CNY', 'USD'].includes(currency)) throw new Error('币种只支持 CNY 或 USD');
    const originalAmountMinor = input.amount === undefined
      ? Number(existing.originalAmountMinor)
      : parseMoneyToMinor(input.amount);
    if (!Number.isSafeInteger(originalAmountMinor) || originalAmountMinor <= 0) throw new Error('金额无效');
    const exchangeRate = currency === 'USD'
      ? Number(input.exchangeRate ?? existing.exchangeRate ?? 7)
      : 1;
    if (!Number.isFinite(exchangeRate) || exchangeRate <= 0 || exchangeRate > 1000) throw new Error('汇率无效');
    const amountCnyMinor = Math.round(originalAmountMinor * exchangeRate);
    if (!Number.isSafeInteger(amountCnyMinor) || amountCnyMinor <= 0) throw new Error('人民币换算金额超出有效范围');
    const relayId = String(input.relayId ?? existing.relayId ?? '').trim().toLowerCase();
    if (relayId && !/^[a-z0-9_-]{1,80}$/.test(relayId)) throw new Error('中转站编号无效');
    const now = new Date().toISOString();
    return {
      id: existing.id || `fin_${crypto.randomUUID()}`,
      date: normalizeDate(input.date ?? existing.date),
      category,
      categoryLabel: categoryDefinition.label,
      direction: categoryDefinition.direction,
      counterparty: String(input.counterparty ?? existing.counterparty ?? '').trim().slice(0, 100),
      currency,
      originalAmountMinor,
      exchangeRate: Number(exchangeRate.toFixed(6)),
      amountCnyMinor,
      relayId,
      note: String(input.note ?? existing.note ?? '').trim().slice(0, 500),
      createdAt: existing.createdAt || now,
      updatedAt: now
    };
  }

  function summarize(entries, month) {
    const monthly = entries.filter(entry => String(entry.date || '').startsWith(`${month}-`));
    const sum = (items, predicate) => items.reduce(
      (total, entry) => predicate(entry) ? total + Math.max(0, Number(entry.amountCnyMinor) || 0) : total,
      0
    );
    const monthlyRevenueCnyMinor = sum(monthly, entry => entry.direction === 'income');
    const operatingExpensesCnyMinor = sum(monthly, entry => entry.direction === 'expense');
    const gatewayTopupsCnyMinor = sum(monthly, entry => entry.category === 'gateway_topup');
    const totalRevenueCnyMinor = sum(entries, entry => entry.direction === 'income');
    const totalOperatingExpensesCnyMinor = sum(entries, entry => entry.direction === 'expense');
    const totalGatewayTopupsCnyMinor = sum(entries, entry => entry.category === 'gateway_topup');
    const relayIds = [...new Set(entries.map(entry => String(entry.relayId || '')).filter(Boolean))];
    const byRelay = relayIds.map(relayId => ({
      relayId,
      monthlyGatewayTopupsCnyMinor: sum(monthly, entry => entry.relayId === relayId && entry.category === 'gateway_topup'),
      totalGatewayTopupsCnyMinor: sum(entries, entry => entry.relayId === relayId && entry.category === 'gateway_topup'),
      monthlyOperatingExpensesCnyMinor: sum(monthly, entry => entry.relayId === relayId && entry.direction === 'expense'),
      totalOperatingExpensesCnyMinor: sum(entries, entry => entry.relayId === relayId && entry.direction === 'expense')
    }));
    return {
      monthlyRevenueCnyMinor,
      operatingExpensesCnyMinor,
      gatewayTopupsCnyMinor,
      manualCashFlowCnyMinor: monthlyRevenueCnyMinor - operatingExpensesCnyMinor - gatewayTopupsCnyMinor,
      totalRevenueCnyMinor,
      totalOperatingExpensesCnyMinor,
      totalGatewayTopupsCnyMinor,
      byRelay
    };
  }

  async function list(monthValue) {
    const month = normalizeMonth(monthValue);
    const state = await readLedger();
    const entries = [...state.entries]
      .filter(entry => String(entry.date || '').startsWith(`${month}-`))
      .sort((left, right) => String(right.date || '').localeCompare(String(left.date || ''))
        || String(right.createdAt || '').localeCompare(String(left.createdAt || '')));
    return { month, entries, summary: summarize(state.entries, month) };
  }

  async function create(input) {
    return mutate(async () => {
      const state = await readLedger();
      const entry = normalizeEntry(input);
      state.entries.push(entry);
      await writeLedger(state);
      return entry;
    });
  }

  async function update(idValue, input) {
    const id = String(idValue || '').trim();
    return mutate(async () => {
      const state = await readLedger();
      const index = state.entries.findIndex(entry => entry.id === id);
      if (index < 0) throw new Error('记账记录不存在');
      const entry = normalizeEntry(input, state.entries[index]);
      state.entries[index] = entry;
      await writeLedger(state);
      return entry;
    });
  }

  async function remove(idValue) {
    const id = String(idValue || '').trim();
    return mutate(async () => {
      const state = await readLedger();
      const index = state.entries.findIndex(entry => entry.id === id);
      if (index < 0) throw new Error('记账记录不存在');
      const [entry] = state.entries.splice(index, 1);
      await writeLedger(state);
      return entry;
    });
  }

  return { create, list, remove, update };
}

module.exports = { createFinanceLedgerService, FINANCE_CATEGORIES };
