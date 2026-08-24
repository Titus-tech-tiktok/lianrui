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
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

function relay(id, name, key) {
  return {
    id,
    name,
    description: `${name}说明`,
    enabled: true,
    baseUrl: `https://${id}.example/v1`,
    imageApiKey: key,
    imageModel: 'gpt-image-2',
    healthPath: '/models',
    modelsPath: '/models',
    imagePriceMinMinor: 100000,
    imagePriceMaxMinor: 200000
  };
}

test('超级管理员可保存、删除中转站，管理员只看公开列表', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'caishen-relay-admin-http-'));
  const port = 22000 + Math.floor(Math.random() * 1000);
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

    const adminCreate = await jsonFetch(`${base}/api/auth/users`, {
      method: 'POST',
      headers: { Cookie: superCookie },
      body: JSON.stringify({ username: 'teamadmin', displayName: 'Team Admin', password: 'abc147852', role: 'admin' })
    });
    assert.equal(adminCreate.response.status, 201);
    const adminLogin = await jsonFetch(`${base}/api/auth/login`, {
      method: 'POST',
      body: JSON.stringify({ username: 'teamadmin', password: 'abc147852' })
    });
    assert.equal(adminLogin.response.status, 200);
    const adminCookie = adminLogin.response.headers.get('set-cookie')?.split(';')[0] || '';

    const saveTwo = await jsonFetch(`${base}/api/rpc`, {
      method: 'POST',
      headers: { Cookie: superCookie },
      body: JSON.stringify({
        method: 'saveApiSettings',
        args: [{ activeRelayId: 'primary', relays: [relay('primary', '主线路', 'primary-secret'), relay('backup', '备用线路', 'backup-secret')] }]
      })
    });
    assert.equal(saveTwo.response.status, 200);
    assert.deepEqual(saveTwo.body.data.relays.map(item => item.id), ['primary', 'backup']);

    const adminChoices = await jsonFetch(`${base}/api/relays`, { headers: { Cookie: adminCookie } });
    assert.equal(adminChoices.response.status, 200);
    assert.deepEqual(adminChoices.body.data.relays.map(item => item.name), ['主线路', '备用线路']);
    assert.equal(Object.hasOwn(adminChoices.body.data.relays[0], 'baseUrl'), false);
    assert.equal(Object.hasOwn(adminChoices.body.data.relays[0], 'imageKey'), false);

    const forbiddenAdminSave = await jsonFetch(`${base}/api/rpc`, {
      method: 'POST',
      headers: { Cookie: adminCookie },
      body: JSON.stringify({ method: 'saveApiSettings', args: [{ relays: [] }] })
    });
    assert.equal(forbiddenAdminSave.response.status, 403);

    const deletePrimary = await jsonFetch(`${base}/api/rpc`, {
      method: 'POST',
      headers: { Cookie: superCookie },
      body: JSON.stringify({
        method: 'saveApiSettings',
        args: [{ activeRelayId: 'backup', relays: [relay('backup', '备用线路', '')] }]
      })
    });
    assert.equal(deletePrimary.response.status, 200);
    assert.deepEqual(deletePrimary.body.data.relays.map(item => item.id), ['backup']);

    const backupRecharge = await jsonFetch(`${base}/api/billing/adjust`, {
      method: 'POST',
      headers: { Cookie: superCookie },
      body: JSON.stringify({ userId: adminCreate.body.data.id, relayId: 'backup', amountMinor: 1000000 })
    });
    assert.equal(backupRecharge.response.status, 200);

    const deleteUsedRelay = await jsonFetch(`${base}/api/rpc`, {
      method: 'POST',
      headers: { Cookie: superCookie },
      body: JSON.stringify({ method: 'saveApiSettings', args: [{ activeRelayId: '', relays: [] }] })
    });
    assert.equal(deleteUsedRelay.response.status, 400);
    assert.match(deleteUsedRelay.body.error, /不能删除；请改为停用/);

    const disableUsedRelay = await jsonFetch(`${base}/api/rpc`, {
      method: 'POST',
      headers: { Cookie: superCookie },
      body: JSON.stringify({
        method: 'saveApiSettings',
        args: [{ activeRelayId: '', relays: [{ ...relay('backup', '备用线路', ''), enabled: false }] }]
      })
    });
    assert.equal(disableUsedRelay.response.status, 200);
    assert.equal(disableUsedRelay.body.data.relays[0].enabled, false);

    const emptyChoices = await jsonFetch(`${base}/api/relays`, { headers: { Cookie: adminCookie } });
    assert.equal(emptyChoices.response.status, 200);
    assert.deepEqual(emptyChoices.body.data.relays, []);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(temp, { recursive: true, force: true });
  }
});
