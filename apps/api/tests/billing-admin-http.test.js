const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function removeTempWithRetry(target) {
  let lastError;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await fs.rm(target, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      if (!['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(error?.code) || attempt === 4) break;
      await wait(100 * (attempt + 1));
    }
  }
  throw lastError;
}

async function jsonFetch(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

test('admin billing endpoint hides platform ledger and backend actors', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'caishen-billing-admin-http-'));
  const port = 21000 + Math.floor(Math.random() * 1000);
  process.env.CAISHEN_DATA_DIR = temp;
  process.env.CAISHEN_WORKSPACE_ID = 'local';
  process.env.CAISHEN_HOST = '127.0.0.1';
  process.env.PORT = String(port);
  for (const modulePath of ['../src/server', '../src/runtime', '../src/auth', '../src/billing']) {
    delete require.cache[require.resolve(modulePath)];
  }
  const { startServer } = require('../src/server');
  const server = await startServer();
  const base = `http://127.0.0.1:${port}`;
  try {
    const bootstrap = await jsonFetch(`${base}/api/auth/bootstrap`, {
      method: 'POST',
      body: JSON.stringify({ username: 'root', displayName: 'Root', password: 'abc147852' })
    });
    assert.equal(bootstrap.response.status, 201);
    const superCookie = bootstrap.response.headers.get('set-cookie')?.split(';')[0] || '';
    const relaySave = await jsonFetch(`${base}/api/rpc`, {
      method: 'POST', headers: { Cookie: superCookie },
      body: JSON.stringify({ method: 'saveApiSettings', args: [{ activeRelayId: 'relay-one', relays: [{
        id: 'relay-one', name: '一号站', enabled: true, baseUrl: 'https://one.example/v1', imageApiKey: 'secret', imageModel: 'gpt-image-2', imagePriceMinMinor: 300000, imagePriceMaxMinor: 300000,
        customerCnyPerUsd: 7, upstreamImageCostCnyMicro: 20000
      }, {
        id: 'relay-two', name: '二号站', enabled: true, baseUrl: 'https://two.example/v1', imageApiKey: 'secret-two', imageModel: 'gpt-image-2', imagePriceMinMinor: 180000, imagePriceMaxMinor: 180000,
        customerCnyPerUsd: 7, upstreamImageCostCnyMicro: 15000
      }] }] })
    });
    assert.equal(relaySave.response.status, 200);

    const adminCreate = await jsonFetch(`${base}/api/auth/users`, {
      method: 'POST',
      headers: { Cookie: superCookie },
      body: JSON.stringify({ username: 'teamadmin', displayName: 'Team Admin', password: 'abc147852', role: 'admin' })
    });
    assert.equal(adminCreate.response.status, 201);
    const admin = adminCreate.body.data;

    const outsiderCreate = await jsonFetch(`${base}/api/auth/users`, {
      method: 'POST',
      headers: { Cookie: superCookie },
      body: JSON.stringify({ username: 'otheradmin', displayName: 'Other Admin', password: 'abc147852', role: 'admin' })
    });
    assert.equal(outsiderCreate.response.status, 201);
    const outsider = outsiderCreate.body.data;

    const adminRecharge = await jsonFetch(`${base}/api/billing/adjust`, {
      method: 'POST',
      headers: { Cookie: superCookie },
      body: JSON.stringify({ userId: admin.id, relayId: 'relay-one', amountMinor: 1000 })
    });
    assert.equal(adminRecharge.response.status, 200);
    await jsonFetch(`${base}/api/billing/adjust`, {
      method: 'POST',
      headers: { Cookie: superCookie },
      body: JSON.stringify({ userId: outsider.id, relayId: 'relay-one', amountMinor: 2000, description: 'outsider ledger' })
    });

    const superBilling = await jsonFetch(`${base}/api/billing/admin`, {
      headers: { Cookie: superCookie }
    });
    assert.equal(superBilling.response.status, 200);
    assert.equal(superBilling.body.data.activeRelayId, 'relay-one');
    assert.deepEqual(superBilling.body.data.relays.map(relay => relay.id), ['relay-one', 'relay-two']);
    assert.deepEqual(
      superBilling.body.data.relays.map(relay => [relay.imagePriceMinMinor, relay.imagePriceMaxMinor]),
      [[300000, 300000], [180000, 180000]]
    );
    assert.deepEqual(
      superBilling.body.data.users.map(user => user.id).sort(),
      [bootstrap.body.data.user.id, admin.id, outsider.id].sort()
    );
    assert.ok(superBilling.body.data.transactions.some(entry => entry.description === 'outsider ledger'));

    const login = await jsonFetch(`${base}/api/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ username: 'teamadmin', password: 'abc147852' })
    });
    assert.equal(login.response.status, 200);
    const adminCookie = login.response.headers.get('set-cookie')?.split(';')[0] || '';

    const forbiddenAccounting = await jsonFetch(`${base}/api/billing/accounting`, {
      headers: { Cookie: adminCookie }
    });
    assert.equal(forbiddenAccounting.response.status, 403);

    const billing = await jsonFetch(`${base}/api/billing/admin`, {
      headers: { Cookie: adminCookie }
    });
    assert.equal(billing.response.status, 200);
    const data = billing.body.data;
    assert.equal(data.activeRelayId, 'relay-one');
    assert.deepEqual(data.relays.map(relay => relay.id), ['relay-one', 'relay-two']);
    assert.equal(data.rules, undefined);
    assert.deepEqual(data.users.map(user => user.id), [admin.id]);
    assert.ok(data.transactions.some(entry => entry.description === '账户充值到账' && entry.workspaceId === admin.workspaceId));
    assert.equal(data.transactions.some(entry => entry.workspaceId === outsider.workspaceId), false);
    assert.equal(data.transactions.some(entry => entry.workspaceId === 'local'), false);
    assert.deepEqual((data.transactionUsers || []).map(user => user.id), [admin.id]);

    const summary = await jsonFetch(`${base}/api/billing/me`, {
      headers: { Cookie: adminCookie }
    });
    assert.equal(summary.response.status, 200);
    assert.ok(summary.body.data.transactions.some(entry => entry.description === '账户充值到账'));

    const memberCreate = await jsonFetch(`${base}/api/auth/users`, {
      method: 'POST',
      headers: { Cookie: adminCookie },
      body: JSON.stringify({ username: 'seller', displayName: 'Seller', password: 'abc147852', role: 'member' })
    });
    assert.equal(memberCreate.response.status, 201);
    const member = memberCreate.body.data;

    const secondMemberCreate = await jsonFetch(`${base}/api/auth/users`, {
      method: 'POST',
      headers: { Cookie: adminCookie },
      body: JSON.stringify({ username: 'designer', displayName: 'Designer', password: 'abc147852', role: 'member' })
    });
    assert.equal(secondMemberCreate.response.status, 201);
    const secondMember = secondMemberCreate.body.data;

    const memberTransfer = await jsonFetch(`${base}/api/billing/adjust`, {
      method: 'POST',
      headers: { Cookie: adminCookie },
      body: JSON.stringify({ userId: member.id, relayId: 'relay-one', amountMinor: 500 })
    });
    assert.equal(memberTransfer.response.status, 200);
    assert.equal(memberTransfer.body.data.from.balanceMinor, 500);
    assert.equal(memberTransfer.body.data.to.balanceMinor, 500);

    const emptySecondRelayTransfer = await jsonFetch(`${base}/api/billing/transfer`, {
      method: 'POST', headers: { Cookie: adminCookie },
      body: JSON.stringify({ fromUserId: admin.id, toUserId: member.id, relayId: 'relay-two', amountMinor: 1 })
    });
    assert.equal(emptySecondRelayTransfer.response.status, 400);
    assert.match(emptySecondRelayTransfer.body.error, /余额不足/);
    const secondRelaySummary = await jsonFetch(`${base}/api/billing/me?relayId=relay-two`, { headers: { Cookie: adminCookie } });
    assert.equal(secondRelaySummary.response.status, 200);
    assert.equal(secondRelaySummary.body.data.account.balanceMinor, 0);

    const memberToMember = await jsonFetch(`${base}/api/billing/transfer`, {
      method: 'POST',
      headers: { Cookie: adminCookie },
      body: JSON.stringify({ fromUserId: member.id, toUserId: secondMember.id, relayId: 'relay-one', amountMinor: 200 })
    });
    assert.equal(memberToMember.response.status, 200);
    assert.equal(memberToMember.body.data.from.balanceMinor, 300);
    assert.equal(memberToMember.body.data.to.balanceMinor, 200);

    const memberReturn = await jsonFetch(`${base}/api/billing/transfer`, {
      method: 'POST',
      headers: { Cookie: adminCookie },
      body: JSON.stringify({ fromUserId: secondMember.id, toUserId: admin.id, relayId: 'relay-one', amountMinor: 150 })
    });
    assert.equal(memberReturn.response.status, 200);
    assert.equal(memberReturn.body.data.from.balanceMinor, 50);
    assert.equal(memberReturn.body.data.to.balanceMinor, 650);
    assert.equal(memberReturn.body.data.transactions[0].transferId, memberReturn.body.data.transactions[1].transferId);
    assert.equal(650 + 300 + 50, 1000);

    const forbiddenCrossTeam = await jsonFetch(`${base}/api/billing/transfer`, {
      method: 'POST',
      headers: { Cookie: adminCookie },
      body: JSON.stringify({ fromUserId: admin.id, toUserId: outsider.id, relayId: 'relay-one', amountMinor: 1 })
    });
    assert.equal(forbiddenCrossTeam.response.status, 403);

    const memberLogin = await jsonFetch(`${base}/api/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ username: 'seller', password: 'abc147852' })
    });
    assert.equal(memberLogin.response.status, 200);
    const memberCookie = memberLogin.response.headers.get('set-cookie')?.split(';')[0] || '';

    const memberSummary = await jsonFetch(`${base}/api/billing/me`, {
      headers: { Cookie: memberCookie }
    });
    assert.equal(memberSummary.response.status, 200);
    assert.equal(memberSummary.body.data.account.balanceMinor, 300);
    assert.equal(memberSummary.body.data.transactions[0].description, '划拨给 Designer');
    assert.ok(memberSummary.body.data.transactions.some(entry => entry.description === '账户充值到账'));

    const adminSummaryAfterTransfer = await jsonFetch(`${base}/api/billing/me`, {
      headers: { Cookie: adminCookie }
    });
    assert.equal(adminSummaryAfterTransfer.response.status, 200);
    assert.equal(adminSummaryAfterTransfer.body.data.account.balanceMinor, 650);
    assert.equal(adminSummaryAfterTransfer.body.data.transactions[0].description, '收到 Designer 划拨');

    const accounting = await jsonFetch(`${base}/api/billing/accounting`, {
      headers: { Cookie: superCookie }
    });
    assert.equal(accounting.response.status, 200);
    assert.deepEqual(accounting.body.data.relays.map(relay => relay.relayName), ['一号站', '二号站']);
    assert.deepEqual(accounting.body.data.relays.map(relay => relay.upstreamImageCostCnyMicro), [20000, 15000]);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await removeTempWithRetry(temp);
  }
});
