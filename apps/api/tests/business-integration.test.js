const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const { openBusinessData, requestBusiness, sealBusinessData, verifyBusinessRequest } = require('../src/business-link');
const { createBusinessSnapshotService } = require('../src/business-snapshot');

test('业务数据响应使用共享密钥加密并校验完整性', () => {
  const previous = process.env.CAISHEN_BUSINESS_LINK_SECRET;
  process.env.CAISHEN_BUSINESS_LINK_SECRET = 'test-secret-at-least-32-characters-long';
  try {
    const sealed = sealBusinessData({ amount: 123, name: '多嘻噜卡科技' });
    assert.equal(sealed.encrypted, true);
    assert.deepEqual(openBusinessData(sealed), { amount: 123, name: '多嘻噜卡科技' });
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

test('业务快照汇总上游请求和经营账目', async () => {
  const service = createBusinessSnapshotService({
    businessId: 'demo',
    businessName: '示例业务',
    auth: { listUsers: async () => [{ workspaceId: 'workspace-1', username: 'tester' }] },
    runtime: {
      loadApiSettings: async () => ({ relays: [] }),
      billing: {
        getAccountingReport: async () => ({
          startDate: '2026-08-01',
          endDate: '2026-08-27',
          relays: [],
          daily: [],
          totals: { customerTopupCnyMinor: 10000, upstreamCostCnyMinor: 2000 }
        }),
        getGlobalStats: async () => ({
          totals: { imageGenerated: 3, imageRegenerated: 2, masterGenerated: 1, freeGenerated: 4 }
        }),
        getLedgerReport: async () => ({ metrics: { imageCount: 10 } })
      },
      financeLedger: {
        listRange: async () => ({
          entries: [],
          summary: { otherIncomeCnyMinor: 500, operatingExpensesCnyMinor: 300 }
        })
      }
    },
    alipayRecharge: {
      listReview: async () => [{ id: 'ALI-1', submittedAt: '2026-08-27T00:00:00.000Z' }]
    }
  });
  const snapshot = await service.snapshot({ range: 'month' });
  assert.equal(snapshot.id, 'demo');
  assert.equal(snapshot.upstreamRequests.count, 10);
  assert.equal(snapshot.accounting.totals.businessRevenueCnyMinor, 10500);
  assert.equal(snapshot.accounting.totals.totalExpensesCnyMinor, 2300);
  assert.equal(snapshot.accounting.totals.netProfitCnyMinor, 8200);
  assert.equal(snapshot.recharges[0].businessName, '示例业务');
});
