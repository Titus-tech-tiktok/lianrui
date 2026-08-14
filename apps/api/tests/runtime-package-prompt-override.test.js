const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');

async function createRuntimeFixture(t, workspaceId) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), `caishen-package-prompts-${workspaceId}-`));
  const imageBytes = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#4477aa' } }).png().toBuffer();
  const captured = { imageBodies: [], analysisBodies: [] };
  const server = http.createServer((req, res) => {
    if (req.url === '/v1/images/edits') {
      const chunks = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => {
        captured.imageBodies.push(Buffer.concat(chunks).toString('utf8'));
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ data: [{ b64_json: imageBytes.toString('base64') }] }));
      });
      return;
    }
    if (req.url === '/v1/chat/completions') {
      const chunks = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => {
        captured.analysisBodies.push(Buffer.concat(chunks).toString('utf8'));
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
          choices: [{
            message: {
              content: JSON.stringify({
                category: 'test',
                product_type: 'test',
                material: '',
                color: '',
                dimensions: '',
                selling_points: []
              })
            }
          }]
        }));
      });
      return;
    }
    res.writeHead(404).end();
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
    analysisKey: process.env.CAISHEN_ANALYSIS_API_KEY,
    responseFormat: process.env.CAISHEN_IMAGE_RESPONSE_FORMAT
  };
  process.env.CAISHEN_DATA_DIR = path.join(temp, 'data');
  process.env.CAISHEN_WORKSPACE_ID = workspaceId;
  process.env.CAISHEN_API_BASE_URL = `http://127.0.0.1:${server.address().port}/v1`;
  process.env.CAISHEN_API_KEY = 'global-key';
  process.env.CAISHEN_IMAGE_API_KEY = 'global-key';
  process.env.CAISHEN_ANALYSIS_API_KEY = 'global-key';
  process.env.CAISHEN_IMAGE_RESPONSE_FORMAT = 'b64_json';
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
    if (previousEnv.analysisKey === undefined) delete process.env.CAISHEN_ANALYSIS_API_KEY;
    else process.env.CAISHEN_ANALYSIS_API_KEY = previousEnv.analysisKey;
    if (previousEnv.responseFormat === undefined) delete process.env.CAISHEN_IMAGE_RESPONSE_FORMAT;
    else process.env.CAISHEN_IMAGE_RESPONSE_FORMAT = previousEnv.responseFormat;
  });

  const runtimePath = require.resolve('../src/runtime');
  delete require.cache[runtimePath];
  const runtime = require('../src/runtime');
  t.after(() => delete require.cache[runtimePath]);
  await runtime.initializeRuntime();
  await runtime.saveConfig({ outputPath: path.join(temp, 'output') });
  await runtime.saveApiSettings({
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    imageApiKey: 'global-key',
    analysisApiKey: 'global-key',
    imageModel: 'gpt-image-2',
    analysisModel: 'gpt-5-3',
    modelPackages: [
      {
        id: 'flagship',
        name: 'Flagship',
        enabled: true,
        default: true,
        apiBaseUrl: `http://127.0.0.1:${server.address().port}/v1`,
        analysisApiBaseUrl: `http://127.0.0.1:${server.address().port}/v1`,
        modelId: 'gpt-image-2',
        analysisModel: 'gpt-5-3',
        promptQuality: 'flagship',
        imagePrompt: 'FLAGSHIP PACKAGE PROMPT SHOULD NOT BE USED',
        analysisPrompt: 'FLAGSHIP ANALYSIS PROMPT SHOULD NOT BE USED',
        imagePriceMinor: 1,
        analysisPriceMinor: 1
      },
      {
        id: 'standard',
        name: 'Standard',
        enabled: true,
        default: false,
        apiBaseUrl: `http://127.0.0.1:${server.address().port}/v1`,
        analysisApiBaseUrl: `http://127.0.0.1:${server.address().port}/v1`,
        modelId: 'gpt-image-2',
        analysisModel: 'gpt-5-3',
        promptQuality: 'standard',
        imagePrompt: 'STANDARD PACKAGE IMAGE PROMPT ONLY',
        analysisPrompt: 'STANDARD PACKAGE ANALYSIS PROMPT ONLY',
        imagePriceMinor: 1,
        analysisPriceMinor: 1
      }
    ]
  });
  const sourcePath = path.join(temp, 'source.png');
  await fs.writeFile(sourcePath, imageBytes);
  return { runtime, captured, sourcePath };
}

test('standard package keeps the user image prompt and bills repeated requests independently', { concurrency: false }, async (t) => {
  const { runtime, captured, sourcePath } = await createRuntimeFixture(t, 'standard-package-prompts');
  await runtime.saveSelectedModelPackage('standard');
  await runtime.billing.saveRules({
    enabled: true,
    imageFeeMinMinor: 1,
    imageFeeMaxMinor: 1,
    llmFeeMinMinor: 0,
    llmFeeMaxMinor: 0,
    defaultBalanceMinor: 1000000
  });

  await runtime.generateFree({ sourcePath, prompt: 'ORIGINAL USER IMAGE PROMPT' });
  await runtime.generateFree({ sourcePath, prompt: 'ORIGINAL USER IMAGE PROMPT' });
  assert.match(captured.imageBodies[0], /ORIGINAL USER IMAGE PROMPT/);
  assert.doesNotMatch(captured.imageBodies[0], /STANDARD PACKAGE IMAGE PROMPT ONLY/);
  assert.equal(captured.imageBodies.length, 2);
  const transactions = await runtime.billing.listTransactions('standard-package-prompts', 20);
  assert.equal(transactions.filter(entry => entry.kind === 'image').length, 2);
});

test('flagship package keeps the user image prompt', { concurrency: false }, async (t) => {
  const { runtime, captured, sourcePath } = await createRuntimeFixture(t, 'flagship-package-prompts');
  await runtime.saveSelectedModelPackage('flagship');

  await runtime.generateFree({ sourcePath, prompt: 'ORIGINAL USER IMAGE PROMPT' });
  assert.match(captured.imageBodies[0], /ORIGINAL USER IMAGE PROMPT/);
  assert.doesNotMatch(captured.imageBodies[0], /FLAGSHIP PACKAGE PROMPT SHOULD NOT BE USED/);
});
