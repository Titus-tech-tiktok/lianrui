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
  await runtime.billing.saveRules({
    enabled: true,
    imageFeeMinMinor: 1,
    imageFeeMaxMinor: 1,
    llmFeeMinMinor: 0,
    llmFeeMaxMinor: 0,
    defaultBalanceMinor: 100000000
  });
  await runtime.saveApiSettings({
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    imageApiKey: 'image-key',
    analysisApiKey: 'image-key',
    imageModel: 'gpt-image-2',
    analysisModel: 'gpt-5-3',
    modelPackages: [
      { id: 'flagship', name: 'Flagship', enabled: true, default: true, promptQuality: 'flagship', modelId: 'gpt-image-2', maxConcurrency: 14, startIntervalMs: 200, imagePriceMinMinor: 300000, imagePriceMaxMinor: 300000 },
      { id: 'fast', name: 'Fast', enabled: true, default: false, promptQuality: 'basic', imagePrompt: 'FAST PACKAGE PROMPT', modelId: 'gpt-image-2', maxConcurrency: 6, startIntervalMs: 1000, imagePriceMinMinor: 50000, imagePriceMaxMinor: 50000 },
      { id: 'standard', name: 'Standard', enabled: true, default: false, promptQuality: 'standard', imagePrompt: 'STANDARD PACKAGE PROMPT', modelId: 'gpt-image-2', maxConcurrency: 4, startIntervalMs: 1000, imagePriceMinMinor: 70000, imagePriceMaxMinor: 70000 }
    ]
  });

  const templateRoot = path.join(runtime.WORKSPACE_ROOT, 'assets', 'template', 'set');
  const templatePath = path.join(templateRoot, 'sku', '1.png');
  const printPath = path.join(runtime.WORKSPACE_ROOT, 'assets', 'print', 'pattern.png');
  await Promise.all([
    writeImage(templatePath, '#eeeeee'),
    writeImage(printPath, '#dd3366')
  ]);
  await runtime.saveTemplateConfiguration({
    folder: templateRoot,
    items: [{
      relativePath: 'sku/1.png',
      action: 'replace_print',
      reason: 'sku card with labels and product layout',
      replaceArea: 'front cabinet panel',
      forbiddenArea: 'text labels, price tags, background, handle, seams and legs'
    }]
  });

  return { runtime, captured, templateRoot, printPath };
}

for (const packageId of ['flagship', 'standard', 'fast']) {
  test(`${packageId} master migration sends template, master and print images`, { concurrency: false }, async (t) => {
    const { runtime, captured, templateRoot, printPath } = await createFixture(t, packageId);
    await runtime.saveSelectedModelPackage(packageId);

    const task = await runtime.generateTask({
      taskNumber: 1,
      productPath: path.join(templateRoot, 'sku', '1.png'),
      printPath,
      templateFolderPath: templateRoot,
      templateRelativePaths: ['sku/1.png']
    });
    await runtime.generateTemplateSetForFolder(task.folder, false);

    assert.equal(captured.imageBodies.length, 2);
    const templateBody = captured.imageBodies[1];
    assert.equal((templateBody.match(/name="image"/g) || []).length, 3);
    assert.match(templateBody, /filename="1/);
    assert.match(templateBody, /filename="母版图/);
    assert.match(templateBody, /filename="pattern/);
    assert.match(templateBody, /第一张输入图是当前套图模板图/);
    assert.match(templateBody, /第二张输入图是已生成的母版产品图/);
    assert.match(templateBody, /第三张输入图是原始印花图/);
  });
}
