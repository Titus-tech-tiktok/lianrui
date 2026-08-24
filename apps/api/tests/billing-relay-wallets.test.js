const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createBillingService } = require('../src/billing');

test('每个中转站使用独立钱包、独立价格和独立流水', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'caishen-relay-wallets-'));
  const billing = createBillingService(root);
  try {
    await billing.saveRules({ enabled: true });
    await billing.adjustBalance('admin', 'relay-one', 100_000_000, { relayName: '一号站' });

    const first = await billing.reserve('admin', 'image', {
      relayId: 'relay-one', relayName: '一号站', modelId: 'gpt-image-2', amountMinor: 300_000, reference: 'one.png'
    });
    await billing.commit(first);
    assert.equal((await billing.getSummary('admin', 'relay-one')).account.balanceMinor, 99_700_000);

    await assert.rejects(() => billing.reserve('admin', 'image', {
      relayId: 'relay-two', relayName: '二号站', modelId: 'gpt-image-2', amountMinor: 180_000, reference: 'two.png'
    }), /余额不足/);
    assert.equal((await billing.getSummary('admin', 'relay-two')).account.balanceMinor, 0);

    await billing.transferBalance('admin', 'member-a', 'relay-one', 20_000_000, { relayName: '一号站' });
    assert.equal((await billing.getSummary('admin', 'relay-one')).account.balanceMinor, 79_700_000);
    assert.equal((await billing.getSummary('member-a', 'relay-one')).account.balanceMinor, 20_000_000);
    assert.equal((await billing.getSummary('member-a', 'relay-two')).account.balanceMinor, 0);

    await billing.transferBalance('member-a', 'admin', 'relay-one', 5_000_000, { relayName: '一号站' });
    assert.equal((await billing.getSummary('admin', 'relay-one')).account.balanceMinor, 84_700_000);
    assert.equal((await billing.getSummary('member-a', 'relay-one')).account.balanceMinor, 15_000_000);

    const transactions = await billing.listTransactions('', 100);
    assert.ok(transactions.every(entry => ['relay-one', 'relay-two'].includes(entry.relayId)));
    assert.ok(transactions.some(entry => entry.relayId === 'relay-one' && entry.unitPriceMinor === 300_000));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('旧版单余额只迁移到当前中转站一次', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'caishen-relay-wallet-migration-'));
  const system = path.join(root, 'system');
  await fs.mkdir(system, { recursive: true });
  await fs.writeFile(path.join(system, 'billing-accounts.json'), JSON.stringify({
    version: 1, amountScale: 1_000_000, accounts: { legacy: { balanceMinor: 50_000_000, reservations: {}, chargedOnce: {} } }
  }), 'utf8');
  const billing = createBillingService(root);
  try {
    const migration = await billing.migrateLegacyBalances('relay-one');
    assert.equal(migration.migrated, 1);
    assert.equal((await billing.getSummary('legacy', 'relay-one')).account.balanceMinor, 50_000_000);
    assert.equal((await billing.getSummary('legacy', 'relay-two')).account.balanceMinor, 0);
    assert.equal((await billing.migrateLegacyBalances('relay-two')).migrated, 0);
    assert.equal((await billing.getSummary('legacy', 'relay-two')).account.balanceMinor, 0);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
