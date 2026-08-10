const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createFinanceLedgerService } = require('../src/finance-ledger');

test('finance ledger separates profit expenses from gateway cash transfers', async t => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'caishen-finance-ledger-'));
  t.after(() => fs.rm(dataRoot, { recursive: true, force: true }));
  const ledger = createFinanceLedgerService(dataRoot);

  const income = await ledger.create({
    date: '2026-08-10',
    category: 'client_payment',
    counterparty: '测试客户',
    amount: '100.00',
    currency: 'USD',
    exchangeRate: '7'
  });
  assert.equal(income.amountCnyMinor, 70_000);

  await ledger.create({
    date: '2026-08-10',
    category: 'gateway_topup',
    amount: '200.00',
    currency: 'CNY'
  });
  const expense = await ledger.create({
    date: '2026-08-11',
    category: 'development',
    amount: '50.00',
    currency: 'CNY'
  });
  await ledger.create({
    date: '2026-07-31',
    category: 'other_income',
    amount: '10.00',
    currency: 'CNY'
  });

  const august = await ledger.list('2026-08');
  assert.equal(august.entries.length, 3);
  assert.equal(august.summary.monthlyRevenueCnyMinor, 70_000);
  assert.equal(august.summary.operatingExpensesCnyMinor, 5_000);
  assert.equal(august.summary.gatewayTopupsCnyMinor, 20_000);
  assert.equal(august.summary.manualCashFlowCnyMinor, 45_000);
  assert.equal(august.summary.totalRevenueCnyMinor, 71_000);

  const updated = await ledger.update(expense.id, { amount: '75.50', note: '调整后' });
  assert.equal(updated.amountCnyMinor, 7_550);
  assert.equal(updated.note, '调整后');
  await ledger.remove(income.id);
  const afterDelete = await ledger.list('2026-08');
  assert.equal(afterDelete.entries.length, 2);
  assert.equal(afterDelete.summary.monthlyRevenueCnyMinor, 0);
});

test('finance ledger rejects invalid categories and money values', async t => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'caishen-finance-validation-'));
  t.after(() => fs.rm(dataRoot, { recursive: true, force: true }));
  const ledger = createFinanceLedgerService(dataRoot);

  await assert.rejects(() => ledger.create({ date: '2026-08-10', category: 'unknown', amount: '1' }), /分类无效/);
  await assert.rejects(() => ledger.create({ date: '2026-08-10', category: 'membership', amount: '1.001' }), /最多两位小数/);
  await assert.rejects(() => ledger.list('2026-13'), /月份格式无效/);
});
