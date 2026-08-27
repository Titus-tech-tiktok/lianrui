const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createBillingService } = require('../src/billing');

test('账户流水报表可按账号和线路聚合', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'duoxiluka-ledger-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const billing = createBillingService(root);
  await billing.saveRules({ enabled: true });
  await billing.adjustBalance('workspace-admin', 'relay-one', 1_000_000, { description: '充值' });
  const reservation = await billing.reserve('workspace-admin', 'image', { relayId: 'relay-one', amountMinor: 15_000 });
  await billing.commit(reservation, { description: '成功生图' });
  const analysisReservation = await billing.reserve('workspace-admin', 'llm', { relayId: 'relay-one', amountMinor: 2_000, recordUsage: true, description: '童装素材 AI 分析' });
  await billing.commit(analysisReservation);
  const report = await billing.getLedgerReport(new Map([['workspace-admin', { username: 'admin' }]]), { range: 'today', relayId: 'relay-one' });
  assert.equal(report.metrics.imageCount, 1);
  assert.equal(report.metrics.imageSpendMinor, 15_000);
  assert.equal(report.metrics.analysisCount, 1);
  assert.equal(report.metrics.analysisSpendMinor, 2_000);
  assert.equal(report.metrics.totalSpendMinor, 17_000);
  assert.equal(report.transactions.length, 3);
});
