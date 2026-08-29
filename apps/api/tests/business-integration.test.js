const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { openBusinessData, requestBusiness, sealBusinessData, verifyBusinessRequest } = require('../src/business-link');
const { createBusinessSnapshotService } = require('../src/business-snapshot');

test('业务数据响应使用共享密钥加密并校验完整性', () => {
  const previous = process.env.CAISHEN_BUSINESS_LINK_SECRET;
  process.env.CAISHEN_BUSINESS_LINK_SECRET = 'test-secret-at-least-32-characters-long';
  try {
    const sealed = sealBusinessData({ amount: 123, name: '多嘻噜卡童装' });
    assert.equal(sealed.encrypted, true);
    assert.deepEqual(openBusinessData(sealed), { amount: 123, name: '多嘻噜卡童装' });
    assert.throws(() => openBusinessData({ ...sealed, ciphertext: sealed.ciphertext.slice(0, -2) + 'AA' }), /无法验证/);
  } finally {
    if (previous === undefined) delete process.env.CAISHEN_BUSINESS_LINK_SECRET;
    else process.env.CAISHEN_BUSINESS_LINK_SECRET = previous;
  }
});

test('业务服务器之间可以完成签名请求和加密响应', async t => {
  const previous = process.env.CAISHEN_BUSINESS_LINK_SECRET;
  process.env.CAISHEN_BUSINESS_LINK_SECRET = 'test-secret-at-least-32-characters-long';
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    const verification = verifyBusinessRequest({
      body,
      path: new URL(req.url, 'http://localhost').pathname,
      get: name => req.headers[String(name).toLowerCase()]
    });
    res.statusCode = verification.ok ? 200 : verification.status;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(verification.ok
      ? { data: sealBusinessData({ received: body.value }) }
      : { error: verification.error }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    if (previous === undefined) delete process.env.CAISHEN_BUSINESS_LINK_SECRET;
    else process.env.CAISHEN_BUSINESS_LINK_SECRET = previous;
  });
  const address = server.address();
  const result = await requestBusiness(`http://127.0.0.1:${address.port}`, '/api/internal/business/snapshot', { value: 42 });
  assert.deepEqual(result, { received: 42 });
});

test('只读业务快照返回稳定安全的练锐统计字段', async () => {
  let requestedOptions;
  let requestedWorkspaceIds;
  const service = createBusinessSnapshotService({
    businessId: 'duoxiluka',
    businessName: '练锐',
    auth: { listUsers: async () => [
      { workspaceId: 'workspace-1', username: 'tester', role: 'member' },
      { workspaceId: 'workspace-root', username: 'root', role: 'superadmin' }
    ] },
    runtime: {
      loadApiSettings: async () => ({ relays: [{ id: 'relay-a', apiKey: 'must-not-leak' }, { id: 'relay-b' }] }),
      billing: {
        getAccountingReport: async (_relays, _userLookup, options) => {
          requestedOptions = options;
          return {
            range: 'custom',
            startDate: '2026-08-01',
            endDate: '2026-08-27',
            relays: [
              { relayId: 'relay-a', customerCnyPerUsd: 7 },
              { relayId: 'relay-b', customerCnyPerUsd: 8 }
            ],
            daily: [
              { date: '2026-08-01', relayId: 'relay-a', revenueCnyMinor: 700, successfulImages: 2, successfulAnalyses: 1 },
              { date: '2026-08-01', relayId: 'relay-b', revenueCnyMinor: 300, successfulImages: 1, successfulAnalyses: 0 },
              { date: '2026-08-02', relayId: 'relay-a', revenueCnyMinor: 1300, successfulImages: 0, successfulAnalyses: 1 }
            ],
            totals: { confirmedRevenueCnyMinor: 2300, successfulImages: 3, successfulAnalyses: 2 }
          };
        },
        getGlobalStats: async () => ({ totals: { imageGenerated: 3, imageRegenerated: 2 } }),
        getLedgerReport: async () => ({ metrics: { imageCount: 7 } }),
        listAccounts: async workspaceIds => {
          requestedWorkspaceIds = workspaceIds;
          return [{
            workspaceId: 'workspace-1',
            wallets: [
              { relayId: 'relay-a', availableMinor: 2_000_000 },
              { relayId: 'relay-b', availableMinor: 500_000 }
            ]
          }];
        }
      },
      financeLedger: {
        listRange: async () => ({
          entries: [{ id: 'income-1', category: 'other_income' }],
          summary: { otherIncomeCnyMinor: 500 }
        })
      }
    },
    alipayRecharge: { listReview: async () => [{ id: 'ALI-1' }] }
  });
  const snapshot = await service.snapshot({ range: 'custom', startDate: '2026-08-01', endDate: '2026-08-27' });
  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(snapshot.businessId, 'duoxiluka');
  assert.equal(snapshot.businessName, '练锐');
  assert.equal(snapshot.id, 'duoxiluka');
  assert.equal(snapshot.name, '练锐');
  assert.match(snapshot.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(snapshot.currentTeamAvailableBalanceCnyMinor, 1800);
  assert.equal(snapshot.actualApiConsumptionCnyMinor, 2300);
  assert.equal(snapshot.apiRequestCount, 5);
  assert.deepEqual(snapshot.daily, [
    { date: '2026-08-01', apiConsumptionCnyMinor: 1000, apiRequestCount: 4, imageRequestCount: 3, analysisRequestCount: 1 },
    { date: '2026-08-02', apiConsumptionCnyMinor: 1300, apiRequestCount: 1, imageRequestCount: 0, analysisRequestCount: 1 }
  ]);
  assert.deepEqual(requestedOptions, { range: 'custom', startDate: '2026-08-01', endDate: '2026-08-27', relayId: '' });
  assert.deepEqual(requestedWorkspaceIds, ['workspace-1']);
  assert.equal(snapshot.accounting.totals.businessRevenueCnyMinor, 500);
  assert.equal(snapshot.accounting.totals.totalExpensesCnyMinor, 2300);
  assert.deepEqual(snapshot.stats.totals, { imageGenerated: 3, imageRegenerated: 2, upstreamRequestCount: 7 });
  assert.deepEqual(snapshot.upstreamRequests, {
    count: 7,
    source: 'project-attempt-ledger',
    description: '项目实际发起并进入计费流水的上游图片请求次数'
  });
  assert.equal(snapshot.accounting.daily.length, 3);
  assert.equal(snapshot.recharges[0].businessId, 'duoxiluka');
  assert.doesNotMatch(JSON.stringify(snapshot), /apiKey|password|material|lianrui/i);
});

test('练锐业务快照接口拒绝无签名请求并返回加密只读统计', async t => {
  const previous = {
    dataDir: process.env.CAISHEN_DATA_DIR,
    host: process.env.CAISHEN_HOST,
    port: process.env.PORT,
    secret: process.env.CAISHEN_BUSINESS_LINK_SECRET
  };
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'duoxiluka-business-snapshot-'));
  const port = 24000 + Math.floor(Math.random() * 1000);
  process.env.CAISHEN_DATA_DIR = temp;
  process.env.CAISHEN_HOST = '127.0.0.1';
  process.env.PORT = String(port);
  process.env.CAISHEN_BUSINESS_LINK_SECRET = 'test-secret-at-least-32-characters-long';
  for (const modulePath of ['../src/server', '../src/runtime', '../src/auth']) delete require.cache[require.resolve(modulePath)];
  const { startServer } = require('../src/server');
  const server = await startServer();
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(temp, { recursive: true, force: true });
    for (const [key, value] of Object.entries({
      CAISHEN_DATA_DIR: previous.dataDir,
      CAISHEN_HOST: previous.host,
      PORT: previous.port,
      CAISHEN_BUSINESS_LINK_SECRET: previous.secret
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  const unsigned = await fetch(`http://127.0.0.1:${port}/api/internal/business/snapshot`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ range: 'today' })
  });
  assert.equal(unsigned.status, 401);

  const snapshot = await requestBusiness(`http://127.0.0.1:${port}`, '/api/internal/business/snapshot', { range: 'today' });
  assert.equal(snapshot.businessId, 'duoxiluka');
  assert.equal(snapshot.businessName, '练锐');
  assert.equal(snapshot.schemaVersion, 1);
  assert.equal(typeof snapshot.currentTeamAvailableBalanceCnyMinor, 'number');
  assert.equal(typeof snapshot.actualApiConsumptionCnyMinor, 'number');
  assert.equal(typeof snapshot.apiRequestCount, 'number');
  assert.ok(Array.isArray(snapshot.daily));
  assert.equal(snapshot.id, 'duoxiluka');
  assert.ok(snapshot.accounting && snapshot.stats && snapshot.upstreamRequests);
  assert.doesNotMatch(JSON.stringify(snapshot), /lianrui/i);
});

test('业务收入操作只写入手工收入分类', async () => {
  const calls = [];
  const service = createBusinessSnapshotService({
    auth: {},
    runtime: {
      financeLedger: {
        create: async entry => { calls.push(['create', entry]); return { id: 'fin-1', ...entry }; },
        update: async (id, entry) => { calls.push(['update', id, entry]); return { id, ...entry }; },
        remove: async id => { calls.push(['delete', id]); return { id }; }
      }
    },
    alipayRecharge: {}
  });
  const created = await service.financeEntryAction({ action: 'create', entry: { category: 'server', amount: '100' } });
  const updated = await service.financeEntryAction({ action: 'update', id: 'fin-1', entry: { category: 'refund', amount: '80' } });
  await service.financeEntryAction({ action: 'delete', id: 'fin-1' });
  assert.equal(created.category, 'other_income');
  assert.equal(updated.category, 'other_income');
  assert.equal(calls[0][1].category, 'other_income');
  assert.equal(calls[1][2].category, 'other_income');
  assert.deepEqual(calls[2], ['delete', 'fin-1']);
});
