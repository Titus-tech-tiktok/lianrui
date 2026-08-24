const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { createBillingService } = require('../src/billing');

test('billing supports USD micro amounts with six decimal places', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'caishen-billing-usd-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const billing = createBillingService(root);

  await billing.saveRules({ enabled: true });
  await billing.adjustBalance('usd-user', 'relay-usd', 1_000_000);

  const account = await billing.ensureAccount('usd-user', 'relay-usd');
  assert.equal(account.balanceMinor, 1_000_000);

  const reservation = await billing.reserve('usd-user', 'image', { relayId: 'relay-usd', amountMinor: 2362, description: 'micro image' });
  assert.equal(reservation.amountMinor, 2362);
  await billing.commit(reservation);

  const summary = await billing.getSummary('usd-user', 'relay-usd');
  assert.equal(summary.rules.currency, 'USD');
  assert.equal(summary.rules.amountScale, 1_000_000);
  assert.equal(summary.account.balanceMinor, 997_638);
  assert.equal(summary.transactions[0].amountMinor, -2362);
});

test('billing accepts large USD balance adjustments in micro units', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'caishen-billing-usd-adjust-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const billing = createBillingService(root);

  const result = await billing.adjustBalance('usd-admin', 130_000_000, { description: 'top up' });

  assert.equal(result.account.balanceMinor, 130_000_000);
  assert.equal(result.transaction.currency, 'USD');
  assert.equal(result.transaction.amountScale, 1_000_000);
  assert.equal(result.transaction.amountMinor, 130_000_000);
});
