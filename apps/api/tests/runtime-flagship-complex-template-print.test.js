const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');

async function writeImage(file, color = '#dddddd') {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await sharp({ create: { width: 96, height: 96, channels: 3, background: color } }).png().toFile(file);
}

async function writeCabinetTemplate(file) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const cabinet = Buffer.from('<svg width="144" height="192"><rect width="144" height="192" rx="10" fill="#171717"/><rect x="8" y="8" width="128" height="38" fill="#e2e2e2"/><rect x="8" y="52" width="128" height="38" fill="#e8e8e8"/><rect x="8" y="96" width="128" height="38" fill="#dedede"/><rect x="8" y="140" width="128" height="44" fill="#e5e5e5"/></svg>');
  await sharp({ create: { width: 240, height: 240, channels: 3, background: '#b9aa98' } })
    .composite([{ input: cabinet, left: 48, top: 24 }])
    .png()
    .toFile(file);
}

async function createFixture(t, workspaceId) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), `caishen-flagship-complex-${workspaceId}-`));
  const imageBytes = await sharp({ create: { width: 48, height: 48, channels: 3, background: '#55aaee' } }).png().toBuffer();
  const captured = { imageBodies: [] };
  const server = http.createServer((req, res) => {
    if (req.url !== '/v1/images/edits') return res.writeHead(404).end();
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      captured.imageBodies.push(Buffer.concat(chunks).toString('utf8'));
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ data: [{ b64_json: imageBytes.toString('base64') }] }));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(temp, { recursive: true, force: true });
  });

  const previousEnv = {
    dataDir: process.env.CAISHEN_DATA_DIR,
    workspaceId: process.env.CAISHEN_WORKSPACE_ID,
    baseUrl: process.env.CAISHEN_API_BASE_URL,
    apiKey: process.env.CAISHEN_API_KEY,
    imageKey: process.env.CAISHEN_IMAGE_API_KEY,
    responseFormat: process.env.CAISHEN_IMAGE_RESPONSE_FORMAT,
    startInterval: process.env.CAISHEN_IMAGE_API_START_INTERVAL_MS
  };
  process.env.CAISHEN_DATA_DIR = path.join(temp, 'data');
  process.env.CAISHEN_WORKSPACE_ID = workspaceId;
  process.env.CAISHEN_API_BASE_URL = `http://127.0.0.1:${server.address().port}/v1`;
  process.env.CAISHEN_API_KEY = 'image-key';
  process.env.CAISHEN_IMAGE_API_KEY = 'image-key';
  process.env.CAISHEN_IMAGE_RESPONSE_FORMAT = 'b64_json';
  process.env.CAISHEN_IMAGE_API_START_INTERVAL_MS = '0';
  t.after(() => {
    if (previousEnv.dataDir === undefined) delete process.env.CAISHEN_DATA_DIR;
    else process.env.CAISHEN_DATA_DIR = previousEnv.dataDir;
    if (previousEnv.workspaceId === undefined) delete process.env.CAISHEN_WORKSPACE_ID;
    else process.env.CAISHEN_WORKSPACE_ID = previousEnv.workspaceId;
    if (previousEnv.baseUrl === undefined) delete process.env.CAISHEN_API_BASE_URL;
    else process.env.CAISHEN_API_BASE_URL = previousEnv.baseUrl;
    if (previousEnv.apiKey === undefined) delete process.env.CAISHEN_API_KEY;
    else process.env.CAISHEN_API_KEY = previousEnv.apiKey;
    if (previousEnv.imageKey === undefined) delete process.env.CAISHEN_IMAGE_API_KEY;
    else process.env.CAISHEN_IMAGE_API_KEY = previousEnv.imageKey;
    if (previousEnv.responseFormat === undefined) delete process.env.CAISHEN_IMAGE_RESPONSE_FORMAT;
    else process.env.CAISHEN_IMAGE_RESPONSE_FORMAT = previousEnv.responseFormat;
    if (previousEnv.startInterval === undefined) delete process.env.CAISHEN_IMAGE_API_START_INTERVAL_MS;
    else process.env.CAISHEN_IMAGE_API_START_INTERVAL_MS = previousEnv.startInterval;
  });

  const runtimePath = require.resolve('../src/runtime');
  delete require.cache[runtimePath];
  const runtime = require('../src/runtime');
  t.after(() => delete require.cache[runtimePath]);
  await runtime.initializeRuntime();
  await runtime.saveConfig({ outputPath: path.join(temp, 'output'), imageQuality: 'high' });
  await runtime.billing.saveRules({ enabled: true });
  await runtime.saveApiSettings({
    activeRelayId: 'primary',
    relays: [{
      id: 'primary', name: 'Primary relay', description: 'Test relay', enabled: true,
      baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
      imageApiKey: 'image-key', imageModel: 'gpt-image-2',
      imagePriceMinMinor: 300000, imagePriceMaxMinor: 300000
    }]
  });
  await runtime.billing.adjustBalance(workspaceId, 'primary', 100000000);

  const templateRoot = path.join(runtime.WORKSPACE_ROOT, 'assets', 'template', 'set');
  const templatePath = path.join(templateRoot, '01-complex.png');
  const printPath = path.join(runtime.WORKSPACE_ROOT, 'assets', 'print', 'pattern.png');
  const masterImagePath = path.join(runtime.WORKSPACE_ROOT, 'assets', 'master', 'master.png');
  await Promise.all([
    writeCabinetTemplate(templatePath),
    writeImage(printPath, '#dd3366'),
    writeImage(masterImagePath, '#3366dd')
  ]);
  await runtime.saveTemplateRegions({
    folder: templateRoot,
    items: [{
      relativePath: '01-complex.png',
      action: 'replace_print',
      reason: 'complex ecommerce page with Chinese title text, white selling point labels, open cabinet door, internal storage, multi panel cabinet doors, props and text labels',
      replaceArea: 'visible cabinet door fronts',
      forbiddenArea: 'Chinese text, white labels, open cabinet interior, props, black frame, seams, handles and legs',
      regions: [{ x: 0.18, y: 0.08, width: 0.64, height: 0.84 }]
    }]
  });

  return { runtime, captured, templateRoot, printPath, masterImagePath, baseUrl: `http://127.0.0.1:${server.address().port}/v1` };
}

async function setRelayImagePrice(runtime, priceMinor) {
  const settings = await runtime.loadApiSettings();
  await runtime.saveApiSettings({
    ...settings,
    relays: settings.relays.map(relay => ({
      ...relay,
      imagePriceMinMinor: priceMinor,
      imagePriceMaxMinor: priceMinor
    }))
  });
}

test('relay template-print uses the shared fixed four-image contract', { concurrency: false }, async (t) => {
  const { runtime, captured, templateRoot, printPath, masterImagePath } = await createFixture(t, 'relay');

  const result = await runtime.generateTask({
    taskNumber: 1,
    generationMode: 'template_print',
    printPath,
    masterImagePath,
    templateFolderPath: templateRoot,
    templateRelativePaths: ['01-complex.png']
  });

  assert.equal(result.summary.billingCostMinor, 300000);
  const events = await fs.readFile(path.join(result.folder, '.caishen-meta', 'image-api-events.jsonl'), 'utf8');
  assert.match(events, /"maxConcurrency":30/);
  assert.match(captured.imageBodies[0], /CURRENT_REQUEST_EXECUTION_CONTRACT/);
  assert.match(captured.imageBodies[0], /Use image 1 as the locked output canvas/);
  assert.doesNotMatch(captured.imageBodies[0], /FLAGSHIP_COMPLEX_TEMPLATE_PRINT_MODE|DETAIL_SLICE_LAYOUT_PROTECTION_MODE/);
  assert.equal((captured.imageBodies[0].match(/name="image\[\]"/g) || []).length, 4);
  assert.equal((captured.imageBodies[0].match(/name="mask"/g) || []).length, 0);
  assert.match(captured.imageBodies[0], /filename="01-complex/);
  assert.match(captured.imageBodies[0], /filename="master/);
  assert.match(captured.imageBodies[0], /filename="pattern/);
  assert.match(captured.imageBodies[0], /\.regions\.png/);
});

test('relay template-print uses the shared prompt without an old package override', { concurrency: false }, async (t) => {
  const { runtime, captured, templateRoot, printPath, masterImagePath } = await createFixture(t, 'shared-prompt');

  await runtime.generateTask({
    taskNumber: 1,
    generationMode: 'template_print',
    printPath,
    masterImagePath,
    templateFolderPath: templateRoot,
    templateRelativePaths: ['01-complex.png']
  });

  assert.doesNotMatch(captured.imageBodies[0], /STANDARD ONLY PROMPT/);
  assert.match(captured.imageBodies[0], /CURRENT_REQUEST_EXECUTION_CONTRACT/);
  assert.doesNotMatch(captured.imageBodies[0], /FLAGSHIP_COMPLEX_TEMPLATE_PRINT_MODE/);
});

test('relay template-print bills its image price and uses global concurrency', { concurrency: false }, async (t) => {
  const { runtime, captured, templateRoot, printPath, masterImagePath } = await createFixture(t, 'relay-billing-concurrency');
  await setRelayImagePrice(runtime, 50000);

  const result = await runtime.generateTask({
    taskNumber: 1,
    generationMode: 'template_print',
    printPath,
    masterImagePath,
    templateFolderPath: templateRoot,
    templateRelativePaths: ['01-complex.png']
  });

  assert.doesNotMatch(captured.imageBodies[0], /FAST ONLY PROMPT/);
  assert.match(captured.imageBodies[0], /CURRENT_REQUEST_EXECUTION_CONTRACT/);
  assert.doesNotMatch(captured.imageBodies[0], /FLAGSHIP_COMPLEX_TEMPLATE_PRINT_MODE/);
  assert.equal(result.summary.billingCostMinor, 50000);
  const events = await fs.readFile(path.join(result.folder, '.caishen-meta', 'image-api-events.jsonl'), 'utf8');
  assert.match(events, /"maxConcurrency":30/);
});

test('review regeneration paths charge the current relay image price', { concurrency: false }, async (t) => {
  const { runtime, templateRoot, printPath, masterImagePath } = await createFixture(t, 'relay-review-billing');

  const initial = await runtime.generateTask({
    taskNumber: 1,
    generationMode: 'template_print',
    printPath,
    masterImagePath,
    templateFolderPath: templateRoot,
    templateRelativePaths: ['01-complex.png']
  });
  const outputFile = path.join(initial.folder, '01-complex.png');
  await fs.rm(outputFile, { force: true });

  await setRelayImagePrice(runtime, 50000);
  const before = await runtime.billing.getSummary('relay-review-billing', 'primary');
  const regeneratedSet = await runtime.generateTemplateSetForFolder(initial.folder, true);
  const afterMissing = await runtime.billing.getSummary('relay-review-billing', 'primary');
  assert.equal(regeneratedSet.summary.billingCostMinor, 50000);
  assert.equal(before.account.balanceMinor - afterMissing.account.balanceMinor, 50000);

  await runtime.regenerateSingleTemplate({
    folder: initial.folder,
    relativePath: '01-complex.png',
    extraInstruction: 'keep cabinet labels unchanged'
  });
  const afterSingle = await runtime.billing.getSummary('relay-review-billing', 'primary');
  assert.equal(afterMissing.account.balanceMinor - afterSingle.account.balanceMinor, 50000);
});

test('changing a relay price applies to every later regeneration', { concurrency: false }, async (t) => {
  const { runtime, templateRoot, printPath, masterImagePath } = await createFixture(t, 'changed-relay-review-billing');

  const initial = await runtime.generateTask({
    taskNumber: 1,
    generationMode: 'template_print',
    printPath,
    masterImagePath,
    templateFolderPath: templateRoot,
    templateRelativePaths: ['01-complex.png']
  });
  const outputFile = path.join(initial.folder, '01-complex.png');
  await fs.rm(outputFile, { force: true });

  await setRelayImagePrice(runtime, 70000);
  const before = await runtime.billing.getSummary('changed-relay-review-billing', 'primary');
  const regeneratedSet = await runtime.generateTemplateSetForFolder(initial.folder, true);
  const afterMissing = await runtime.billing.getSummary('changed-relay-review-billing', 'primary');
  assert.equal(regeneratedSet.summary.billingCostMinor, 70000);
  assert.equal(before.account.balanceMinor - afterMissing.account.balanceMinor, 70000);

  await runtime.regenerateSingleTemplate({
    folder: initial.folder,
    relativePath: '01-complex.png',
    extraInstruction: 'keep cabinet labels unchanged'
  });
  const afterSingle = await runtime.billing.getSummary('changed-relay-review-billing', 'primary');
  assert.equal(afterMissing.account.balanceMinor - afterSingle.account.balanceMinor, 70000);
});

test('relay review regeneration charges every image API request', { concurrency: false }, async (t) => {
  const { runtime, templateRoot, printPath, masterImagePath } = await createFixture(t, 'relay-every-request-billing');

  const initial = await runtime.generateTask({
    taskNumber: 1,
    generationMode: 'template_print',
    printPath,
    masterImagePath,
    templateFolderPath: templateRoot,
    templateRelativePaths: ['01-complex.png']
  });
  assert.equal(initial.summary.billingCostMinor, 300000);
  const afterInitial = await runtime.billing.getSummary('relay-every-request-billing', 'primary');

  await runtime.generateTemplateSetForFolder(initial.folder, false);
  const afterSetRegeneration = await runtime.billing.getSummary('relay-every-request-billing', 'primary');
  assert.equal(afterInitial.account.balanceMinor - afterSetRegeneration.account.balanceMinor, 300000);

  await runtime.regenerateSingleTemplate({
    folder: initial.folder,
    relativePath: '01-complex.png',
    extraInstruction: 'keep cabinet labels unchanged'
  });
  const afterSingle = await runtime.billing.getSummary('relay-every-request-billing', 'primary');
  assert.equal(afterSetRegeneration.account.balanceMinor - afterSingle.account.balanceMinor, 300000);
});

test('relay template-print includes the required master reference', { concurrency: false }, async (t) => {
  const { runtime, captured, templateRoot, printPath, masterImagePath } = await createFixture(t, 'relay-master-reference');

  await runtime.generateTask({
    taskNumber: 1,
    generationMode: 'template_print',
    printPath,
    masterImagePath,
    templateFolderPath: templateRoot,
    templateRelativePaths: ['01-complex.png']
  });

  assert.match(captured.imageBodies[0], /CURRENT_REQUEST_EXECUTION_CONTRACT/);
  assert.doesNotMatch(captured.imageBodies[0], /FLAGSHIP_COMPLEX_TEMPLATE_PRINT_MODE/);
  assert.equal((captured.imageBodies[0].match(/name="image\[\]"/g) || []).length, 4);
  assert.equal((captured.imageBodies[0].match(/name="mask"/g) || []).length, 0);
  assert.match(captured.imageBodies[0], /filename="01-complex/);
  assert.match(captured.imageBodies[0], /filename="master/);
  assert.match(captured.imageBodies[0], /filename="pattern/);
});
