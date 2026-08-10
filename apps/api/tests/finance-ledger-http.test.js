const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

async function jsonFetch(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {})
    }
  });
  return { response, body: await response.json().catch(() => ({})) };
}

test('finance ledger HTTP API is superadmin-only and supports CRUD', async t => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'caishen-finance-http-'));
  const port = 23000 + Math.floor(Math.random() * 1000);
  process.env.CAISHEN_DATA_DIR = dataRoot;
  process.env.CAISHEN_WORKSPACE_ID = 'local';
  process.env.CAISHEN_HOST = '127.0.0.1';
  process.env.PORT = String(port);
  for (const modulePath of ['../src/server', '../src/runtime', '../src/auth', '../src/billing', '../src/finance-ledger']) {
    delete require.cache[require.resolve(modulePath)];
  }
  const { startServer } = require('../src/server');
  const server = await startServer();
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(dataRoot, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;

  const bootstrap = await jsonFetch(`${base}/api/auth/bootstrap`, {
    method: 'POST',
    body: JSON.stringify({ username: 'root', displayName: 'Root', password: 'abc147852' })
  });
  assert.equal(bootstrap.response.status, 201);
  const superCookie = bootstrap.response.headers.get('set-cookie')?.split(';')[0] || '';

  const admin = await jsonFetch(`${base}/api/auth/users`, {
    method: 'POST',
    headers: { Cookie: superCookie },
    body: JSON.stringify({ username: 'admin', displayName: 'Admin', password: 'abc147852', role: 'admin' })
  });
  assert.equal(admin.response.status, 201);
  const adminLogin = await jsonFetch(`${base}/api/auth/login`, {
    method: 'POST',
    body: JSON.stringify({ username: 'admin', password: 'abc147852' })
  });
  const adminCookie = adminLogin.response.headers.get('set-cookie')?.split(';')[0] || '';
  const forbidden = await jsonFetch(`${base}/api/finance/ledger?month=2026-08`, { headers: { Cookie: adminCookie } });
  assert.equal(forbidden.response.status, 403);

  const created = await jsonFetch(`${base}/api/finance/entries`, {
    method: 'POST',
    headers: { Cookie: superCookie },
    body: JSON.stringify({ date: '2026-08-10', category: 'client_payment', amount: '20', currency: 'USD', exchangeRate: 7 })
  });
  assert.equal(created.response.status, 201);
  assert.equal(created.body.data.amountCnyMinor, 14_000);

  const updated = await jsonFetch(`${base}/api/finance/entries/${created.body.data.id}`, {
    method: 'PUT',
    headers: { Cookie: superCookie },
    body: JSON.stringify({ amount: '25.50' })
  });
  assert.equal(updated.response.status, 200);
  assert.equal(updated.body.data.amountCnyMinor, 17_850);

  const listed = await jsonFetch(`${base}/api/finance/ledger?month=2026-08`, { headers: { Cookie: superCookie } });
  assert.equal(listed.response.status, 200);
  assert.equal(listed.body.data.entries.length, 1);
  assert.equal(listed.body.data.summary.monthlyRevenueCnyMinor, 17_850);

  const removed = await jsonFetch(`${base}/api/finance/entries/${created.body.data.id}`, {
    method: 'DELETE',
    headers: { Cookie: superCookie }
  });
  assert.equal(removed.response.status, 200);
  const empty = await jsonFetch(`${base}/api/finance/ledger?month=2026-08`, { headers: { Cookie: superCookie } });
  assert.equal(empty.body.data.entries.length, 0);
});
