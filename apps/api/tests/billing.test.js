const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createBillingService } = require('../src/billing');
const RELAY_ID = 'relay-one';

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'caishen-billing-'));
  return { root, billing: createBillingService(root) };
}

test('计费关闭时不占用也不扣除余额', async t => {
  const { root, billing } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const before = await billing.ensureAccount('local', RELAY_ID);
  const reservation = await billing.reserve('local', 'image', { relayId: RELAY_ID, description: '测试生图' });
  await billing.commit(reservation);
  const after = await billing.getSummary('local', RELAY_ID);
  assert.equal(reservation.billable, false);
  assert.equal(after.account.balanceMinor, before.balanceMinor);
  assert.equal(after.transactions.length, 0);
});

test('成功调用按规则扣费并写入流水', async t => {
  const { root, billing } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await billing.saveRules({ enabled: true });
  await billing.adjustBalance('user-one', RELAY_ID, 1000);
  assert.equal((await billing.ensureAccount('user-one', RELAY_ID)).balanceMinor, 1000);
  const reservation = await billing.reserve('user-one', 'image', { relayId: RELAY_ID, amountMinor: 125, description: '套图换印花生图', reference: '1.jpg' });
  assert.equal((await billing.getSummary('user-one', RELAY_ID)).account.availableMinor, 875);
  await billing.commit(reservation);
  const summary = await billing.getSummary('user-one', RELAY_ID);
  assert.equal(summary.account.balanceMinor, 875);
  assert.equal(summary.account.reservedMinor, 0);
  assert.equal(summary.transactions[0].kind, 'image');
  assert.equal(summary.transactions[0].amountMinor, -125);
  assert.equal(summary.transactions[0].reference, '1.jpg');
});

test('同一业务计费 key 只在首次成功时扣费', async t => {
  const { root, billing } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await billing.saveRules({ enabled: true });
  await billing.adjustBalance('user-once', RELAY_ID, 1000);
  const first = await billing.reserve('user-once', 'image', { relayId: RELAY_ID, amountMinor: 125, description: '套图换印花生图', reference: '1.jpg', onceKey: 'task-a/1.jpg' });
  await billing.commit(first);
  const second = await billing.reserve('user-once', 'image', { relayId: RELAY_ID, amountMinor: 125, description: '套图图片重新生成', reference: '1.jpg', onceKey: 'task-a/1.jpg' });
  await billing.commit(second);
  const summary = await billing.getSummary('user-once', RELAY_ID);
  assert.equal(first.billable, true);
  assert.equal(second.billable, false);
  assert.equal(second.alreadyCharged, true);
  assert.equal(summary.account.balanceMinor, 875);
  assert.equal(summary.transactions.filter(entry => entry.kind === 'image').length, 1);
});

test('成功调用按区间随机扣费并预占同一金额', async t => {
  const { root, billing } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await billing.saveRules({ enabled: true });
  await billing.adjustBalance('user-random', RELAY_ID, 1000);
  const reservation = await billing.reserve('user-random', 'image', { relayId: RELAY_ID, amountMinMinor: 120, amountMaxMinor: 150, description: '随机生图' });
  assert.equal(reservation.billable, true);
  assert.ok(reservation.amountMinor >= 120 && reservation.amountMinor <= 150);
  await billing.commit(reservation);
  const summary = await billing.getSummary('user-random', RELAY_ID);
  assert.equal(summary.account.balanceMinor, 1000 - reservation.amountMinor);
  assert.equal(summary.transactions[0].amountMinor, -reservation.amountMinor);
});

test('relay billing range is the only price source', async t => {
  const { root, billing } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await billing.saveRules({ enabled: true });
  await billing.adjustBalance('user-package-range', RELAY_ID, 1000);
  const reservation = await billing.reserve('user-package-range', 'image', {
    relayId: RELAY_ID,
    amountMinMinor: 300,
    amountMaxMinor: 350,
    description: '套餐生图区间'
  });
  assert.equal(reservation.billable, true);
  assert.ok(reservation.amountMinor >= 300 && reservation.amountMinor <= 350);
  await billing.commit(reservation);
  const summary = await billing.getSummary('user-package-range', RELAY_ID);
  assert.equal(summary.account.balanceMinor, 1000 - reservation.amountMinor);
});

test('失败调用释放预占且不产生扣费流水', async t => {
  const { root, billing } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await billing.saveRules({ enabled: true });
  await billing.adjustBalance('user-two', RELAY_ID, 200);
  const reservation = await billing.reserve('user-two', 'llm', { relayId: RELAY_ID, amountMinor: 20 });
  assert.equal((await billing.getSummary('user-two', RELAY_ID)).account.availableMinor, 180);
  await billing.release(reservation);
  const summary = await billing.getSummary('user-two', RELAY_ID);
  assert.equal(summary.account.balanceMinor, 200);
  assert.equal(summary.account.availableMinor, 200);
  assert.equal(summary.transactions.filter(entry => entry.kind === 'image' || entry.kind === 'llm').length, 0);
});

test('余额不足时在调用上游前拒绝', async t => {
  const { root, billing } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await billing.saveRules({ enabled: true });
  await billing.adjustBalance('user-three', RELAY_ID, 100);
  await assert.rejects(() => billing.reserve('user-three', 'image', { relayId: RELAY_ID, amountMinor: 101 }), /余额不足/);
});

test('管理员可充值和扣减但不能扣成负数', async t => {
  const { root, billing } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await billing.ensureAccount('user-four');
  await billing.adjustBalance('user-four', 500, { operatorUserId: 'admin' });
  await billing.adjustBalance('user-four', -120, { operatorUserId: 'admin' });
  assert.equal((await billing.getSummary('user-four')).account.balanceMinor, 380);
  await assert.rejects(() => billing.adjustBalance('user-four', -381), /不能超过当前余额/);
});

test('管理员可在同一中转站双向划拨', async t => {
  const { root, billing } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await billing.adjustBalance('admin-workspace', RELAY_ID, 1000);
  await billing.transferBalance('admin-workspace', 'member-workspace', RELAY_ID, 250, { operatorUserId: 'admin' });
  await billing.transferBalance('member-workspace', 'admin-workspace', RELAY_ID, 50, { operatorUserId: 'admin' });
  assert.equal((await billing.getSummary('admin-workspace', RELAY_ID)).account.balanceMinor, 800);
  assert.equal((await billing.getSummary('member-workspace', RELAY_ID)).account.balanceMinor, 200);
  await assert.rejects(() => billing.transferBalance('admin-workspace', 'member-workspace', RELAY_ID, -1), /必须是有效/);
  await assert.rejects(() => billing.transferBalance('admin-workspace', 'member-workspace', RELAY_ID, 801), /算力余额不足/);
});

test('新中转站钱包默认从零开始且互不复制余额', async t => {
  const { root, billing } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await billing.adjustBalance('user-five', RELAY_ID, 100);
  assert.equal((await billing.ensureAccount('user-five', 'relay-two')).balanceMinor, 0);
  assert.equal((await billing.getSummary('user-five', RELAY_ID)).account.balanceMinor, 100);
});

test('清空费用流水只删除明细，不改变账号余额', async t => {
  const { root, billing } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await billing.adjustBalance('user-clear', 500, { operatorUserId: 'superadmin' });
  assert.equal((await billing.listTransactions('', 10)).length, 1);

  const result = await billing.clearTransactions();

  assert.equal(result.cleared, 1);
  assert.equal((await billing.listTransactions('', 10)).length, 0);
  assert.equal((await billing.getSummary('user-clear')).account.balanceMinor, 500);
});

test('spend totals only include successful model charges', async t => {
  const { root, billing } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await billing.saveRules({ enabled: true });
  await billing.adjustBalance('user-total', RELAY_ID, 500, { operatorUserId: 'admin' });
  await billing.commit(await billing.reserve('user-total', 'image', { relayId: RELAY_ID, amountMinor: 100, reference: 'img' }));
  await billing.commit(await billing.reserve('user-total', 'llm', { relayId: RELAY_ID, amountMinor: 20, reference: 'text' }));

  const summary = await billing.getSummary('user-total', RELAY_ID);

  assert.equal(summary.spendTotals['1'], 120);
  assert.equal(summary.spendTotals['7'], 120);
  assert.equal(summary.spendTotals['30'], 120);
});

test('global stats exclude superadmin account usage', async t => {
  const { root, billing } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await billing.saveRules({ enabled: true });
  await billing.adjustBalance('super-workspace', RELAY_ID, 1000);
  await billing.adjustBalance('member-workspace', RELAY_ID, 1000);
  await billing.commit(await billing.reserve('super-workspace', 'image', { relayId: RELAY_ID, amountMinor: 100, description: '超级管理员生图' }));
  await billing.commit(await billing.reserve('member-workspace', 'image', { relayId: RELAY_ID, amountMinor: 100, description: '成员生图' }));
  await billing.commit(await billing.reserve('member-workspace', 'llm', { relayId: RELAY_ID, amountMinor: 20, description: '成员套图模板分析' }));

  const stats = await billing.getGlobalStats('today', new Map([
    ['super-workspace', { role: 'superadmin', username: 'root' }],
    ['member-workspace', { role: 'member', username: 'seller' }]
  ]));

  assert.equal(stats.totals.totalCostMinor, 120);
  assert.equal(stats.totals.imageGenerated, 1);
  assert.equal(stats.totals.analysisCalls, 1);
  assert.equal(stats.totals.activeWorkspaces, 1);
  assert.deepEqual(stats.byAccount.map(account => account.workspaceId), ['member-workspace']);
  assert.equal(stats.byOperation.reduce((total, item) => total + item.totalCostMinor, 0), 120);
  assert.equal(stats.trend.reduce((total, item) => total + item.costMinor, 0), 120);
});

test('global stats use total generated count and actual retry success rate', async t => {
  const { root, billing } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await billing.saveRules({ enabled: true });
  await billing.adjustBalance('member-workspace', RELAY_ID, 1000);
  await billing.commit(await billing.reserve('member-workspace', 'image', { relayId: RELAY_ID, amountMinor: 100, description: '套图换印花生图' }));
  await billing.commit(await billing.reserve('member-workspace', 'image', { relayId: RELAY_ID, amountMinor: 100, description: '套图图片重新生成' }));
  await billing.commit(await billing.reserve('member-workspace', 'image', { relayId: RELAY_ID, amountMinor: 100, description: '母版图生成' }));

  const stats = await billing.getGlobalStats('today', new Map([
    ['member-workspace', { role: 'member', username: 'seller' }]
  ]));

  assert.equal(stats.totals.totalCostMinor, 300);
  assert.equal(stats.totals.imageGenerated, 1);
  assert.equal(stats.totals.imageRegenerated, 1);
  assert.equal(stats.totals.masterGenerated, 1);
  assert.equal(stats.totals.firstPassImages, 1);
  assert.equal(stats.totals.successRate, 0.5);
  assert.equal(stats.totals.averageCostMinor, 100);
  assert.equal(stats.byAccount[0].averageCostMinor, 100);
});

test('global stats include current non-superadmin balances by role', async t => {
  const { root, billing } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await billing.saveRules({ enabled: true });
  await billing.adjustBalance('super-workspace', 999, { operatorUserId: 'root' });
  await billing.adjustBalance('admin-workspace', 300, { operatorUserId: 'root' });
  await billing.adjustBalance('member-workspace', 200, { operatorUserId: 'root' });

  const stats = await billing.getGlobalStats('today', new Map([
    ['super-workspace', { role: 'superadmin', username: 'root' }],
    ['admin-workspace', { role: 'admin', username: 'manager' }],
    ['member-workspace', { role: 'member', username: 'seller' }]
  ]));

  assert.equal(stats.balanceSummary.totals.count, 2);
  assert.equal(stats.balanceSummary.totals.balanceMinor, 500);
  assert.equal(stats.balanceSummary.totals.availableMinor, 500);
  assert.deepEqual(stats.balanceSummary.byRole.map(item => [item.role, item.count, item.balanceMinor]), [
    ['admin', 1, 300],
    ['member', 1, 200]
  ]);
  assert.deepEqual(stats.balanceSummary.byAccount.map(item => item.workspaceId), ['admin-workspace', 'member-workspace']);
});

test('global stats keep relay balances and usage isolated', async t => {
  const { root, billing } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const secondRelayId = 'relay-two';
  const users = new Map([['member-workspace', { role: 'member', username: 'seller' }]]);
  await billing.saveRules({ enabled: true });
  await billing.adjustBalance('member-workspace', RELAY_ID, 1_000_000);
  await billing.adjustBalance('member-workspace', secondRelayId, 2_000_000);
  await billing.commit(await billing.reserve('member-workspace', 'image', {
    relayId: RELAY_ID,
    amountMinor: 150_000,
    description: '一号站生图'
  }));
  await billing.commit(await billing.reserve('member-workspace', 'image', {
    relayId: secondRelayId,
    amountMinor: 180_000,
    description: '二号站生图'
  }));

  const first = await billing.getGlobalStats('today', users, RELAY_ID);
  const second = await billing.getGlobalStats('today', users, secondRelayId);

  assert.equal(first.relayId, RELAY_ID);
  assert.equal(first.totals.totalCostMinor, 150_000);
  assert.equal(first.balanceSummary.totals.availableMinor, 850_000);
  assert.equal(second.relayId, secondRelayId);
  assert.equal(second.totals.totalCostMinor, 180_000);
  assert.equal(second.balanceSummary.totals.availableMinor, 1_820_000);
});

test('global stats current month excludes entries before Beijing month start', async t => {
  const { root, billing } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await billing.saveRules({ enabled: true });
  await billing.adjustBalance('current-workspace', RELAY_ID, 1000);
  await billing.adjustBalance('previous-workspace', RELAY_ID, 1000);
  await billing.commit(await billing.reserve('current-workspace', 'image', { relayId: RELAY_ID, amountMinor: 100, description: '本月生图' }));
  await billing.commit(await billing.reserve('previous-workspace', 'image', { relayId: RELAY_ID, amountMinor: 100, description: '上月生图' }));

  const ledgerFile = path.join(root, 'system', 'billing-ledger.jsonl');
  const entries = (await fs.readFile(ledgerFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const chinaOffsetMs = 8 * 60 * 60 * 1000;
  const chinaNow = new Date(Date.now() + chinaOffsetMs);
  const monthStartMs = Date.UTC(chinaNow.getUTCFullYear(), chinaNow.getUTCMonth(), 1) - chinaOffsetMs;
  for (const entry of entries) {
    if (entry.workspaceId === 'previous-workspace') entry.createdAt = new Date(monthStartMs - 1).toISOString();
  }
  await fs.writeFile(ledgerFile, `${entries.map(entry => JSON.stringify(entry)).join('\n')}\n`, 'utf8');

  const stats = await billing.getGlobalStats('month', new Map([
    ['current-workspace', { role: 'member', username: 'current' }],
    ['previous-workspace', { role: 'member', username: 'previous' }]
  ]));

  assert.equal(stats.range, 'month');
  assert.equal(stats.totals.totalCostMinor, 100);
  assert.deepEqual(stats.byAccount.map(account => account.workspaceId), ['current-workspace']);
  assert.equal(new Date(stats.startedAt).getTime(), monthStartMs);
});
