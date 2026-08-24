const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');

async function writeImage(file, color = '#dddddd') {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await sharp({ create: { width: 64, height: 64, channels: 3, background: color } }).png().toFile(file);
}

async function writeCabinetTemplate(file) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await sharp({ create: { width: 128, height: 128, channels: 3, background: '#2b2927' } })
    .composite([{ input: { create: { width: 84, height: 92, channels: 3, background: '#dedbd4' } }, left: 22, top: 18 }])
    .png()
    .toFile(file);
}

async function createFixture(t, workspaceId) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), `caishen-template-migration-${workspaceId}-`));
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
  await runtime.saveConfig({ outputPath: path.join(temp, 'output'), imageQuality: 'high', auditMode: 'economy' });
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
  const templatePath = path.join(templateRoot, 'sku', '1.png');
  const secondTemplatePath = path.join(templateRoot, 'sku', '2.png');
  const printPath = path.join(runtime.WORKSPACE_ROOT, 'assets', 'print', 'pattern.png');
  await Promise.all([
    writeCabinetTemplate(templatePath),
    writeCabinetTemplate(secondTemplatePath),
    writeImage(printPath, '#dd3366')
  ]);
  await runtime.saveTemplateRegions({
    folder: templateRoot,
    items: ['sku/1.png', 'sku/2.png'].map(relativePath => ({
      relativePath,
      action: 'replace_print',
      reason: 'sku card with labels and product layout',
      replaceArea: 'front cabinet panel',
      forbiddenArea: 'text labels, price tags, background, handle, seams and legs',
      regions: [{ x: 0.12, y: 0.08, width: 0.76, height: 0.84 }]
    }))
  });

  return { runtime, captured, templateRoot, printPath };
}

test('relay-backed master migration sends exactly four semantic reference images', { concurrency: false }, async (t) => {
    const { runtime, captured, templateRoot, printPath } = await createFixture(t, 'primary-relay');

    const master = await runtime.generateTemplateTaskMaster({
      taskNumber: 1,
      masterReferencePath: path.join(templateRoot, 'sku', '1.png'),
      printPath,
      templateFolderPath: templateRoot
    });
    await runtime.generateTask({
      taskNumber: 1,
      generationMode: 'template_print',
      masterImagePath: master.outputPath,
      printPath,
      templateFolderPath: templateRoot,
      templateRelativePaths: ['sku/1.png']
    });

    assert.equal(captured.imageBodies.length, 2);
    const masterBody = captured.imageBodies[0];
    assert.equal((masterBody.match(/name="image\[\]"/g) || []).length, 2);
    const masterReferenceIndex = masterBody.search(/filename="1\.(?:jpg|png)"/);
    const masterPrintIndex = masterBody.search(/filename="pattern\.(?:jpg|png)"/);
    assert.ok(masterReferenceIndex >= 0 && masterReferenceIndex < masterPrintIndex);
    assert.match(masterBody, /TWO_IMAGE_WHITE_BACKGROUND_MASTER/);
    assert.match(masterBody, /CURRENT_MASTER_REQUEST_CONTRACT/);
    assert.match(masterBody, /exactly two images in this fixed order/);
    assert.match(masterBody, /Never swap their roles/);
    assert.match(masterBody, /RGB\(255,255,255\)/);
    const templateBody = captured.imageBodies[1];
    assert.equal((templateBody.match(/name="image\[\]"/g) || []).length, 4);
    assert.equal((templateBody.match(/name="mask"/g) || []).length, 0);
    assert.match(templateBody, /filename="[a-f0-9]+\.template\.png/);
    assert.match(templateBody, /filename="template-master/);
    assert.match(templateBody, /filename="pattern/);
    assert.match(templateBody, /filename="sku_1\.template-analysis-[a-f0-9]+\.regions\.png/);
    const templateIndex = templateBody.indexOf('.template.png"');
    const masterIndex = templateBody.indexOf('filename="template-master');
    const printIndex = templateBody.indexOf('filename="pattern');
    const annotationIndex = templateBody.indexOf('.regions.png"');
    assert.ok(templateIndex >= 0 && templateIndex < masterIndex);
    assert.ok(masterIndex < printIndex);
    assert.ok(printIndex < annotationIndex);
    assert.match(templateBody, /FOUR_IMAGE_RED_ROI_TEMPLATE_EDIT/);
    assert.match(templateBody, /CURRENT_REQUEST_EXECUTION_CONTRACT/);
    assert.match(templateBody, /locked template canvas, print master reference, original print artwork, and ROI annotation/);
    assert.match(templateBody, /Use image 1 as the locked output canvas/);
    assert.match(templateBody, /colored boxes are guidance only, are not paste rectangles/);
    assert.match(templateBody, /Apply the complete registered print only to visible cabinet-door or drawer exterior-front surface pixels inside red areas/);
    assert.match(templateBody, /cyan boxes mark handles, knobs, locks or metal hardware that must remain identical to image 1/);
    assert.match(templateBody, /For partial cabinet views, transfer only the matching master-image fragment/);
    assert.match(templateBody, /Never paste a flat rectangle/);
    assert.match(templateBody, /same composition and dimensions as image 1/);
    assert.match(templateBody, /OPEN_DRAWER_REGISTERED_PRINT_MAPPING/);
    assert.match(templateBody, /Apply the following rules only when image 1 contains one or more opened drawers/);
    assert.doesNotMatch(templateBody, /FLAGSHIP_COMPLEX_TEMPLATE_PRINT_MODE|DETAIL_SLICE_LAYOUT_PROTECTION_MODE/);
});

test('single regeneration sends the same fixed four semantic reference images', { concurrency: false }, async (t) => {
  const { runtime, captured, templateRoot, printPath } = await createFixture(t, 'regeneration-four-images');

  const master = await runtime.generateTemplateTaskMaster({
    taskNumber: 1,
    masterReferencePath: path.join(templateRoot, 'sku', '1.png'),
    printPath,
    templateFolderPath: templateRoot
  });
  const task = await runtime.generateTask({
    taskNumber: 1,
    generationMode: 'template_print',
    masterImagePath: master.outputPath,
    printPath,
    templateFolderPath: templateRoot,
    templateRelativePaths: ['sku/1.png']
  });

  await runtime.regenerateSingleTemplate({
    folder: task.folder,
    relativePath: 'sku/1.png',
    extraInstruction: '只修正柜面印花落位'
  });

  assert.equal(captured.imageBodies.length, 3);
  const regenerationBody = captured.imageBodies[2];
  const filenames = [...regenerationBody.matchAll(/name="image\[\]"; filename="([^"]+)"/g)].map(match => match[1]);
  assert.equal(filenames.length, 4);
  assert.match(filenames[0], /\.template\.png$/);
  assert.match(filenames[1], /^template-master/);
  assert.match(filenames[2], /^pattern/);
  assert.match(filenames[3], /\.regions\.png$/);
  assert.match(regenerationBody, /exactly four images in this fixed order/);
  assert.match(regenerationBody, /Never swap, omit, duplicate or reinterpret their roles/);
  assert.doesNotMatch(regenerationBody, /Image 5|exactly five images/);
});

test('single regeneration appends current and selected generated references after the fixed four images', { concurrency: false }, async (t) => {
  const { runtime, captured, templateRoot, printPath } = await createFixture(t, 'regeneration-result-reference');

  const master = await runtime.generateTemplateTaskMaster({
    taskNumber: 1,
    masterReferencePath: path.join(templateRoot, 'sku', '1.png'),
    printPath,
    templateFolderPath: templateRoot
  });
  const task = await runtime.generateTask({
    taskNumber: 1,
    generationMode: 'template_print',
    masterImagePath: master.outputPath,
    printPath,
    templateFolderPath: templateRoot,
    templateRelativePaths: ['sku/1.png', 'sku/2.png']
  });

  await runtime.regenerateSingleTemplate({
    folder: task.folder,
    relativePath: 'sku/1.png',
    includePreviousResult: true,
    referenceResultRelativePath: 'sku/2.png'
  });

  assert.equal(captured.imageBodies.length, 4);
  const regenerationBody = captured.imageBodies[3];
  const filenames = [...regenerationBody.matchAll(/name="image\[\]"; filename="([^"]+)"/g)].map(match => match[1]);
  assert.equal(filenames.length, 6);
  assert.match(filenames[0], /\.template\.png$/);
  assert.match(filenames[1], /^template-master/);
  assert.match(filenames[2], /^pattern/);
  assert.match(filenames[3], /\.regions\.png$/);
  assert.match(filenames[4], /^1\.(?:jpg|png)$/);
  assert.match(filenames[5], /^2\.(?:jpg|png)$/);
  assert.match(regenerationBody, /Image 5 is the current rejected result/);
  assert.match(regenerationBody, /Image 6 is an operator-selected generated reference/);
  assert.match(regenerationBody, /Image 1 remains the locked output canvas/);
});
