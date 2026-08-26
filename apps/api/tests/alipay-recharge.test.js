const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createBillingService } = require('../src/billing');
const { createAlipayRechargeService } = require('../src/alipay-recharge');

test('Alipay 充值核验入账可重试，但不重复加钱', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'duoxiluka-alipay-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const billing = createBillingService(root);
  const recharge = createAlipayRechargeService(root, billing);
  await fs.mkdir(path.dirname(recharge.qrFile), { recursive: true });
  await fs.writeFile(recharge.qrFile, 'test');
  await recharge.saveSettings({ enabled: true, payeeName: '测试收款方' });
  const context = { userId: 'admin-user', workspaceId: 'workspace-admin', username: 'admin', displayName: '客户', relayId: 'relay-one', relayName: '服务一' };
  const payload = { amountUsd: '10.00', alipayOrderNo: '20260827000000000001' };
  const submitted = await recharge.createOrder(payload, context);
  const retried = await recharge.createOrder(payload, context);
  assert.equal(retried.id, submitted.id);
  const approved = await recharge.approve(submitted.id, { actualAmountUsd: '9.50' }, 'reviewer');
  assert.equal(approved.creditMinor, 9_500_000);
  await recharge.approve(submitted.id, { actualAmountUsd: '999.00' }, 'reviewer');
  const summary = await billing.getSummary('workspace-admin', 'relay-one');
  assert.equal(summary.account.balanceMinor, 9_500_000);
  assert.equal(summary.transactions.filter(entry => entry.description === 'Alipay 充值到账').length, 1);
});

test('Alipay 未上传收款码时不能启用', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'duoxiluka-alipay-empty-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const recharge = createAlipayRechargeService(root, createBillingService(root));
  await assert.rejects(recharge.saveSettings({ enabled: true }), /先上传支付宝收款码/);
});

