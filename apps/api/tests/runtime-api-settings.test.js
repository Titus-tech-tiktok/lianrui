const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

function relay(overrides = {}) {
  return {
    id: 'primary', name: '主中转站', description: '生产线路', enabled: true,
    baseUrl: 'https://api.change2pro.com',
    imageApiKey: 'image-private-key', imageModel: 'gpt-image-custom',
    imagePriceMinMinor: 300000, imagePriceMaxMinor: 300000,
    customerCnyPerUsd: 7, upstreamImageCostCnyMicro: 20000,
    ...overrides
  };
}

async function withRuntime(name, worker) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), `caishen-relays-${name}-`));
  const previous = {
    dataDir: process.env.CAISHEN_DATA_DIR, workspaceId: process.env.CAISHEN_WORKSPACE_ID,
    baseUrl: process.env.CAISHEN_API_BASE_URL, apiKey: process.env.CAISHEN_API_KEY
  };
  process.env.CAISHEN_DATA_DIR = temp;
  process.env.CAISHEN_WORKSPACE_ID = name;
  process.env.CAISHEN_API_BASE_URL = 'https://api.change2pro.com';
  process.env.CAISHEN_API_KEY = 'legacy-image-secret-key';
  const runtimePath = require.resolve('../src/runtime');
  delete require.cache[runtimePath];
  const runtime = require('../src/runtime');
  try {
    await runtime.initializeRuntime();
    await worker(runtime, temp);
  } finally {
    delete require.cache[runtimePath];
    if (previous.dataDir === undefined) delete process.env.CAISHEN_DATA_DIR; else process.env.CAISHEN_DATA_DIR = previous.dataDir;
    if (previous.workspaceId === undefined) delete process.env.CAISHEN_WORKSPACE_ID; else process.env.CAISHEN_WORKSPACE_ID = previous.workspaceId;
    if (previous.baseUrl === undefined) delete process.env.CAISHEN_API_BASE_URL; else process.env.CAISHEN_API_BASE_URL = previous.baseUrl;
    if (previous.apiKey === undefined) delete process.env.CAISHEN_API_KEY; else process.env.CAISHEN_API_KEY = previous.apiKey;
    await fs.rm(temp, { recursive: true, force: true });
  }
}

test('API settings migrate to image-only relays and keep credentials private', async () => {
  await withRuntime('relay-settings', async (runtime, temp) => {
    const initial = await runtime.loadApiSettings();
    assert.equal(initial.version, 4);
    assert.equal(initial.relays.length, 1);
    assert.equal(initial.relays[0].imageKeyConfigured, true);
    assert.equal(Object.hasOwn(initial.relays[0], 'imageKey'), false);

    const saved = await runtime.saveApiSettings({
      activeRelayId: 'primary', relays: [relay()], responseFormat: 'url', requestTimeoutSeconds: 180,
      allowAdminPromptView: true, imageInitialConcurrency: 9, imageMaxConcurrency: 21, imageStartIntervalMs: 250
    });
    assert.equal(saved.version, 4);
    assert.equal(saved.activeRelayId, 'primary');
    assert.equal(saved.relays[0].imageKeyConfigured, true);
    assert.equal(saved.relays[0].customerCnyPerUsd, 7);
    assert.equal(saved.relays[0].upstreamImageCostCnyMicro, 20000);
    assert.equal(saved.configured, true);
    assert.equal(saved.imageMaxConcurrency, 21);

    const highConcurrency = await runtime.saveApiSettings({
      ...saved,
      relays: saved.relays.map(item => ({ ...item, imageApiKey: '' })),
      imageInitialConcurrency: 500,
      imageMaxConcurrency: 20000
    });
    assert.equal(highConcurrency.imageInitialConcurrency, 500);
    assert.equal(highConcurrency.imageMaxConcurrency, 20000);

    const preserved = await runtime.saveApiSettings({
      ...highConcurrency,
      relays: highConcurrency.relays.map(item => ({ ...item, imageApiKey: '' }))
    });
    assert.equal(preserved.relays[0].imageKeyConfigured, true);
    await assert.rejects(() => runtime.saveApiSettings({
      ...saved,
      relays: saved.relays.map(item => ({ ...item, imagePriceMinMinor: 300001, imagePriceMaxMinor: 300000 }))
    }), /最高扣费不能低于最低扣费/);

    const privateValue = JSON.parse(await fs.readFile(path.join(temp, 'system', 'api-settings.json'), 'utf8'));
    assert.equal(privateValue.version, 4);
    assert.equal(privateValue.relays[0].imageKey, 'image-private-key');
    for (const field of ['analysisKey', 'analysisBaseUrl', 'analysisModel', 'analysisWireApi', 'analysisPriceMinMinor']) {
      assert.equal(Object.hasOwn(privateValue.relays[0], field), false);
    }
    assert.equal(Object.hasOwn(privateValue, 'modelPackages'), false);
    assert.equal(typeof runtime.testAnalysisApi, 'undefined');

    const requests = [];
    const originalFetch = global.fetch;
    global.fetch = async (url, options = {}) => {
      const authorization = options.headers?.Authorization;
      requests.push({ url: String(url), authorization });
      return new Response(JSON.stringify({ data: [{ id: 'gpt-image-custom', object: 'model', owned_by: 'relay' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    };
    try {
      assert.deepEqual((await runtime.testApiSettings({ relayId: 'primary' })).models.map(item => item.id), ['gpt-image-custom']);
      assert.equal((await runtime.testRelayHealth({ relayId: 'primary' })).ok, true);
      assert.equal(requests.at(-1).authorization, 'Bearer image-private-key');
    } finally {
      global.fetch = originalFetch;
    }
  });
});

test('relay choices expose only names and descriptions while superadmin settings keep private fields', async () => {
  await withRuntime('relay-privacy', async runtime => {
    const saved = await runtime.saveApiSettings({
      activeRelayId: 'primary',
      relays: [
        relay(),
        relay({ id: 'backup', name: '备用中转站', description: '备用线路', baseUrl: 'https://backup.example/v1', imageApiKey: 'backup-secret' })
      ]
    });
    assert.equal(saved.relays.length, 2);
    assert.match(saved.relays[0].imageKeyMasked, /imag/);
    assert.equal(saved.relays[0].imagePriceMinMinor, 300000);
    assert.equal(Object.hasOwn(saved.relays[0], 'imageKey'), false);

    const choices = await runtime.loadRelayChoices();
    assert.equal(choices.activeRelayId, 'primary');
    assert.deepEqual(choices.relays.map(item => item.id), ['primary', 'backup']);
    assert.equal(choices.relays[0].name, '主中转站');
    assert.equal(choices.relays[0].imagePriceMinMinor, 300000);
    for (const field of ['baseUrl', 'imageKey', 'imageKeyMasked', 'imageModel', 'usagePath', 'customerCnyPerUsd', 'upstreamImageCostCnyMicro']) {
      assert.equal(Object.hasOwn(choices.relays[0], field), false);
    }

    const selected = await runtime.saveActiveRelay('backup');
    assert.equal(selected.activeRelayId, 'backup');
    assert.equal((await runtime.loadApiSettings()).activeRelayId, 'backup');
    await assert.rejects(() => runtime.saveActiveRelay('missing'), /中转站不存在|not found/i);

    const afterDelete = await runtime.saveApiSettings({
      ...saved,
      activeRelayId: 'backup',
      relays: saved.relays.filter(item => item.id === 'backup')
    });
    assert.deepEqual(afterDelete.relays.map(item => item.id), ['backup']);
    assert.deepEqual((await runtime.loadRelayChoices()).relays.map(item => item.id), ['backup']);

    const empty = await runtime.saveApiSettings({ ...afterDelete, activeRelayId: '', relays: [] });
    assert.equal(empty.activeRelayId, '');
    assert.equal(empty.configured, false);
    assert.deepEqual(empty.relays, []);
    assert.deepEqual((await runtime.loadRelayChoices()).relays, []);
    assert.deepEqual((await runtime.loadApiSettings()).relays, []);
  });
});
