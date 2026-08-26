const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');

test('删除中的素材会使旧 AI 请求失效，重新导入后必须重新分析', { concurrency: false }, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'childrenwear-analysis-lifecycle-'));
  let releaseFirstResponse;
  let firstRequestStarted;
  const firstStarted = new Promise(resolve => { firstRequestStarted = resolve; });
  const releaseFirst = new Promise(resolve => { releaseFirstResponse = resolve; });
  let requestCount = 0;
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', async () => {
      if (req.url !== '/v1/chat/completions') return res.writeHead(404).end();
      requestCount += 1;
      if (requestCount === 1) {
        firstRequestStarted();
        await releaseFirst;
      }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          summary: `真实分析-${requestCount}`,
          category_guess: '开放品类测试',
          piece_count: 1,
          pieces: [{ piece_id: 'piece_1', piece_type: '测试童装', material: {}, construction: {}, decorations: [] }],
          must_preserve: [],
          uncertain_regions: []
        }) } }],
        usage: {}
      }));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  });

  process.env.CAISHEN_DATA_DIR = path.join(root, 'data');
  process.env.CAISHEN_WORKSPACE_ID = 'analysis-lifecycle-test';
  process.env.CAISHEN_API_BASE_URL = `http://127.0.0.1:${server.address().port}/v1`;
  process.env.CAISHEN_IMAGE_API_KEY = 'test-key';
  process.env.CAISHEN_ANALYSIS_MODEL = 'gpt-test-analysis';
  const runtimePath = require.resolve('../src/runtime');
  delete require.cache[runtimePath];
  const runtime = require('../src/runtime');
  t.after(() => delete require.cache[runtimePath]);

  const library = path.join(runtime.WORKSPACE_ROOT, 'assets', 'childrenwear-real', 'test-library');
  const file = path.join(library, 'same.png');
  await fs.mkdir(library, { recursive: true });
  const bytes = await sharp({ create: { width: 160, height: 200, channels: 3, background: '#e8d9b8' } }).png().toBuffer();
  await fs.writeFile(file, bytes);

  const oldRequest = runtime.analyzeChildrenwearAssets({ role: 'product', paths: [file] });
  await firstStarted;
  await runtime.invalidateChildrenwearAnalysisPaths([file], 'product');
  await fs.rm(file);
  await fs.writeFile(file, bytes);
  releaseFirstResponse();
  const oldResult = await oldRequest;
  assert.equal(oldResult.analyzed, 0);
  assert.equal(oldResult.failed, 1);

  const pendingPage = await runtime.scanImageLibraryPage(library, { analysisRole: 'product', folder: 'root' });
  assert.equal(pendingPage.items[0].analysis.status, 'pending');
  assert.equal(pendingPage.items[0].analysis.analyzed, false);

  const freshResult = await runtime.analyzeChildrenwearAssets({ role: 'product', paths: [file] });
  assert.equal(freshResult.analyzed, 1);
  assert.equal(freshResult.reused, 0);
  assert.equal(requestCount, 2);
  const analyzedPage = await runtime.scanImageLibraryPage(library, { analysisRole: 'product', folder: 'root' });
  assert.equal(analyzedPage.items[0].analysis.status, 'analyzed');
  assert.match(analyzedPage.items[0].analysis.summary, /真实分析-2/);

  const serverPath = require.resolve('../src/server');
  delete require.cache[serverPath];
  const { deleteAssetFiles } = require('../src/server');
  t.after(() => delete require.cache[serverPath]);
  const deleted = await deleteAssetFiles('childrenwear-real', library, [file]);
  assert.equal(deleted.deleted, 1);
  await fs.writeFile(file, bytes);
  const reimportedPage = await runtime.scanImageLibraryPage(library, { analysisRole: 'product', folder: 'root' });
  assert.equal(reimportedPage.items[0].analysis.status, 'pending');
  assert.equal(reimportedPage.items[0].analysis.analyzed, false);
});
