const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const sharp = require('sharp');

test('streamed reference uploads stay in the signed-in workspace and work for pose analysis and generation', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-upload-'));
  const bytes = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#cccccc' } }).png().toBuffer();
  const upstream = http.createServer(async (req, res) => {
    for await (const chunk of req) {}
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(req.url.endsWith('/chat/completions')
      ? { choices: [{ message: { content: JSON.stringify({ posePrompt: '身体正面站立，左腿支撑，右腿自然前迈' }) } }] }
      : { data: [{ b64_json: bytes.toString('base64') }] }));
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const port = 27000 + Math.floor(Math.random() * 1000);
  Object.assign(process.env, { CAISHEN_DATA_DIR: root, CAISHEN_WORKSPACE_ID: 'local', CAISHEN_HOST: '127.0.0.1', PORT: String(port), CAISHEN_API_BASE_URL: `http://127.0.0.1:${upstream.address().port}/v1`, CAISHEN_IMAGE_API_KEY: 'test-key', CAISHEN_IMAGE_MODEL: 'test-image', CAISHEN_IMAGE_RESPONSE_FORMAT: 'b64_json', CAISHEN_IMAGE_API_START_INTERVAL_MS: '0' });
  for (const id of ['../src/server', '../src/runtime', '../src/auth', '../src/billing']) delete require.cache[require.resolve(id)];
  const runtime = require('../src/runtime');
  const { startServer } = require('../src/server');
  const server = await startServer();
  t.after(async () => {
    server.closeAllConnections?.(); upstream.closeAllConnections?.();
    await Promise.all([new Promise(resolve => server.close(resolve)), new Promise(resolve => upstream.close(resolve))]);
    await fs.rm(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  async function json(url, payload, cookie = '') {
    const response = await fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(payload) });
    return { response, body: await response.json() };
  }
  const bootstrap = await json('/api/auth/bootstrap', { username: 'root', password: 'test-password-123' });
  const rootCookie = bootstrap.response.headers.get('set-cookie').split(';')[0];
  const created = await json('/api/auth/users', { username: 'designer', password: 'test-password-123', displayName: 'Designer', role: 'admin' }, rootCookie);
  assert.equal(created.response.status, 201);
  const workspaceId = created.body.data.workspaceId;
  const login = await json('/api/auth/login', { username: 'designer', password: 'test-password-123' });
  const cookie = login.response.headers.get('set-cookie').split(';')[0];
  const expectedRoot = path.join(root, 'workspaces', workspaceId);
  await runtime.runWithWorkspace(workspaceId, () => runtime.saveChildrenwearGenerationPromptSetting('childrenwearModelGeneration', '按商品款式、模特外观和动作描述生成图片'));

  async function upload(name, uploadCookie = cookie) {
    const boundary = 'test-boundary-' + Date.now();
    const body = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: image/png\r\n\r\n`), bytes, Buffer.from(`\r\n--${boundary}--\r\n`)]);
    return new Promise((resolve, reject) => {
      const request = http.request(base + '/api/upload/image', { method: 'POST', headers: { Cookie: uploadCookie, 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length } }, response => {
        const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('end', () => resolve(JSON.parse(Buffer.concat(chunks))));
      });
      request.on('error', reject);
      request.write(body.subarray(0, 25));
      setTimeout(() => request.end(body.subarray(25)), 10);
    });
  }
  const [uploads, rootUpload] = await Promise.all([
    Promise.all(['top.png', 'pants.png', 'model.png', 'pose.png'].map(name => upload(name))),
    upload('root.png', rootCookie)
  ]);
  assert.ok(rootUpload.path.startsWith(path.join(root, 'workspaces', 'local') + path.sep));
  assert.equal((await fetch(base + rootUpload.url, { headers: { Cookie: cookie } })).status, 404);
  for (const image of uploads) {
    assert.ok(image.path.startsWith(expectedRoot + path.sep), `upload escaped signed-in workspace: ${image.path}`);
    assert.equal((await fetch(base + image.url, { headers: { Cookie: cookie } })).status, 200, 'uploaded image preview must work');
    assert.equal((await fetch(base + image.url, { headers: { Cookie: rootCookie } })).status, 404, 'other workspaces cannot read the uploaded reference');
  }
  async function job(method, payload) {
    const queued = await json('/api/jobs', { method, args: [payload] }, cookie);
    assert.ok(queued.response.ok, JSON.stringify(queued.body));
    for (let i = 0; i < 100; i++) {
      const response = await fetch(base + '/api/jobs/' + queued.body.data.id, { headers: { Cookie: cookie } });
      const { data } = await response.json();
      if (data.status === 'completed') return data.result;
      if (data.status === 'failed') assert.fail(data.error);
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.fail('job did not finish');
  }
  assert.match((await job('analyzePoseReference', { imagePath: uploads[3].path })).posePrompt, /左腿支撑/);
  const generated = await job('generateChildrenwearModel', { topReferencePath: uploads[0].path, bottomReferencePath: uploads[1].path, modelReferencePath: uploads[2].path, poseReferencePath: uploads[3].path, backgroundMode: 'solid' });
  assert.ok(generated.modelOutputs[0].path.startsWith(expectedRoot));
});
