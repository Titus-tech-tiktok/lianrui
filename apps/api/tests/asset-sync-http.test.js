const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function removeTempWithRetry(target) {
  let lastError;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await fs.rm(target, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      if (!['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(error?.code) || attempt === 4) break;
      await wait(100 * (attempt + 1));
    }
  }
  throw lastError;
}

test('multipart asset sync keeps the member workspace context', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'caishen-asset-sync-http-'));
  const port = 19000 + Math.floor(Math.random() * 1000);
  process.env.CAISHEN_DATA_DIR = temp;
  process.env.CAISHEN_WORKSPACE_ID = 'local';
  process.env.CAISHEN_HOST = '127.0.0.1';
  process.env.PORT = String(port);
  for (const modulePath of ['../src/server', '../src/runtime', '../src/auth']) {
    delete require.cache[require.resolve(modulePath)];
  }
  const { startServer } = require('../src/server');
  const server = await startServer();
  const base = `http://127.0.0.1:${port}`;
  let cookie = '';
  try {
    const bootstrap = await fetch(`${base}/api/auth/bootstrap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', displayName: 'Admin', password: 'abc147852' })
    });
    cookie = bootstrap.headers.get('set-cookie')?.split(';')[0] || '';
    assert.equal(bootstrap.status, 201);

    const memberResponse = await fetch(`${base}/api/auth/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ username: 'member', displayName: 'Member', password: 'abc147852' })
    });
    assert.equal(memberResponse.status, 201);
    const member = (await memberResponse.json()).data;

    const login = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'member', password: 'abc147852' })
    });
    cookie = login.headers.get('set-cookie')?.split(';')[0] || '';
    assert.equal(login.status, 200);

    const prepare = await fetch(`${base}/api/assets/sync/prepare/print`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        rootName: 'prints',
        files: [{ name: 'flower.png', relativePath: 'flower.png', size: 5, lastModified: 1000 }]
      })
    });
    assert.equal(prepare.status, 200);
    const prepared = (await prepare.json()).data;

    const form = new FormData();
    form.append('files', new Blob([Buffer.from('first')], { type: 'image/png' }), 'flower.png');
    form.append('relativePaths', JSON.stringify(['flower.png']));
    form.append('lastModified', JSON.stringify([1000]));
    const upload = await fetch(`${base}/api/assets/sync/upload/${prepared.sessionId}`, {
      method: 'POST',
      headers: { Cookie: cookie },
      body: form
    });
    if (upload.status !== 200) assert.fail(await upload.text());

    const finish = await fetch(`${base}/api/assets/sync/finish/${prepared.sessionId}`, {
      method: 'POST',
      headers: { Cookie: cookie }
    });
    if (finish.status !== 200) assert.fail(await finish.text());
    const result = (await finish.json()).data;
    assert.equal(result.root.includes(member.workspaceId), true);
    assert.equal(result.added, 1);
    assert.deepEqual(result.paths, [path.join(result.root, 'flower.png')]);
    assert.deepEqual(result.uploadedPaths, result.paths);

    const repeatPrepare = await fetch(`${base}/api/assets/sync/prepare/print`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        currentRoot: result.root,
        rootName: 'prints',
        files: [{ name: 'flower.png', relativePath: 'flower.png', size: 5, lastModified: 1000 }]
      })
    });
    assert.equal(repeatPrepare.status, 200);
    const repeated = (await repeatPrepare.json()).data;
    assert.deepEqual(repeated.neededRelativePaths, []);

    const repeatFinish = await fetch(`${base}/api/assets/sync/finish/${repeated.sessionId}`, {
      method: 'POST',
      headers: { Cookie: cookie }
    });
    assert.equal(repeatFinish.status, 200);
    const repeatResult = (await repeatFinish.json()).data;
    assert.equal(repeatResult.added, 0);
    assert.equal(repeatResult.skipped, 1);
    assert.deepEqual(repeatResult.paths, result.paths);
    assert.deepEqual(repeatResult.uploadedPaths, []);

    const cachedLibraryResponse = await fetch(`${base}/api/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        method: 'listImageLibrary',
        args: [result.root, { folder: 'auto', page: 1, pageSize: 48 }]
      })
    });
    if (cachedLibraryResponse.status !== 200) assert.fail(await cachedLibraryResponse.text());
    assert.equal((await cachedLibraryResponse.json()).data.total, 1);

    const appendPrepare = await fetch(`${base}/api/assets/sync/prepare/print`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        currentRoot: result.root,
        rootName: 'prints',
        files: [{ name: 'leaf.png', relativePath: 'leaf.png', size: 6, lastModified: 2000 }]
      })
    });
    assert.equal(appendPrepare.status, 200);
    const appendPrepared = (await appendPrepare.json()).data;

    const appendForm = new FormData();
    appendForm.append('files', new Blob([Buffer.from('second')], { type: 'image/png' }), 'leaf.png');
    appendForm.append('relativePaths', JSON.stringify(['leaf.png']));
    appendForm.append('lastModified', JSON.stringify([2000]));
    const appendUpload = await fetch(`${base}/api/assets/sync/upload/${appendPrepared.sessionId}`, {
      method: 'POST',
      headers: { Cookie: cookie },
      body: appendForm
    });
    if (appendUpload.status !== 200) assert.fail(await appendUpload.text());

    const appendFinish = await fetch(`${base}/api/assets/sync/finish/${appendPrepared.sessionId}`, {
      method: 'POST',
      headers: { Cookie: cookie }
    });
    if (appendFinish.status !== 200) assert.fail(await appendFinish.text());

    const refreshedLibraryResponse = await fetch(`${base}/api/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        method: 'listImageLibrary',
        args: [result.root, { folder: 'auto', page: 1, pageSize: 48 }]
      })
    });
    if (refreshedLibraryResponse.status !== 200) assert.fail(await refreshedLibraryResponse.text());
    const refreshedLibrary = (await refreshedLibraryResponse.json()).data;
    assert.equal(refreshedLibrary.total, 2);
    assert.deepEqual(refreshedLibrary.items.map(item => item.name).sort(), ['flower.png', 'leaf.png']);

    const configResponse = await fetch(`${base}/api/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ method: 'getConfig', args: [] })
    });
    assert.equal(configResponse.status, 200);
    const config = (await configResponse.json()).data;
    const saveResponse = await fetch(`${base}/api/rpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({
        method: 'saveConfig',
        args: [{ ...config, childrenwearRealAssetsPath: path.join(temp, 'stale-workspace', 'assets') }]
      })
    });
    if (saveResponse.status !== 200) assert.fail(await saveResponse.text());
    assert.equal((await saveResponse.json()).data.childrenwearRealAssetsPath, '');
  } finally {
    await new Promise(resolve => server.close(resolve));
    await removeTempWithRetry(temp);
  }
});

test('single asset upload reports a clear error when the image exceeds the configured limit', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'caishen-asset-upload-limit-'));
  const port = 20000 + Math.floor(Math.random() * 1000);
  process.env.CAISHEN_DATA_DIR = temp;
  process.env.CAISHEN_WORKSPACE_ID = 'upload-limit';
  process.env.CAISHEN_HOST = '127.0.0.1';
  process.env.CAISHEN_UPLOAD_FILE_LIMIT_MB = '1';
  process.env.PORT = String(port);
  for (const modulePath of ['../src/server', '../src/runtime', '../src/auth']) {
    delete require.cache[require.resolve(modulePath)];
  }
  const { startServer } = require('../src/server');
  const server = await startServer();
  const base = `http://127.0.0.1:${port}`;
  try {
    const bootstrap = await fetch(`${base}/api/auth/bootstrap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', displayName: 'Admin', password: 'abc147852' })
    });
    const cookie = bootstrap.headers.get('set-cookie')?.split(';')[0] || '';
    assert.equal(bootstrap.status, 201);

    const form = new FormData();
    form.append('files', new Blob([Buffer.alloc(1024 * 1024 + 1)], { type: 'image/png' }), 'too-large.png');
    form.append('relativePaths', JSON.stringify(['too-large.png']));
    const upload = await fetch(`${base}/api/assets/files/print`, {
      method: 'POST',
      headers: { Cookie: cookie },
      body: form
    });
    assert.equal(upload.status, 413);
    assert.match((await upload.json()).error, /单个文件不能超过 1MB/);
  } finally {
    await new Promise(resolve => server.close(resolve));
    delete process.env.CAISHEN_UPLOAD_FILE_LIMIT_MB;
    await removeTempWithRetry(temp);
  }
});
