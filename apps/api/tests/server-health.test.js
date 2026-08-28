const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

test('health endpoint exposes deployment, queue and signed snapshot capability only', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'caishen-health-'));
  const port = 22000 + Math.floor(Math.random() * 1000);
  const previousBusinessSecret = process.env.CAISHEN_BUSINESS_LINK_SECRET;
  process.env.CAISHEN_DATA_DIR = temp;
  process.env.CAISHEN_WORKSPACE_ID = 'local';
  process.env.CAISHEN_HOST = '127.0.0.1';
  process.env.PORT = String(port);
  process.env.APP_COMMIT_SHA = 'test-commit';
  delete process.env.CAISHEN_BUSINESS_LINK_SECRET;
  for (const modulePath of ['../src/server', '../src/runtime', '../src/auth']) {
    delete require.cache[require.resolve(modulePath)];
  }

  const { startServer } = require('../src/server');
  const server = await startServer();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(Object.keys(body).sort(), [
      'activeImageRequests',
      'activeBackgroundJobs',
      'businessSnapshot',
      'commit',
      'currentImageConcurrency',
      'imageStartIntervalMs',
      'maxBackgroundJobs',
      'maxImageConcurrency',
      'ok',
      'queuedBackgroundJobs',
      'queuedImageRequests',
      'uptimeSeconds'
    ].sort());
    assert.equal(body.ok, true);
    assert.equal(body.commit, 'test-commit');
    assert.equal(body.activeImageRequests, 0);
    assert.equal(body.queuedImageRequests, 0);
    assert.deepEqual(body.businessSnapshot, {
      configured: false,
      schemaVersion: 1,
      signedOnly: true
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(temp, { recursive: true, force: true });
    delete process.env.APP_COMMIT_SHA;
    if (previousBusinessSecret === undefined) delete process.env.CAISHEN_BUSINESS_LINK_SECRET;
    else process.env.CAISHEN_BUSINESS_LINK_SECRET = previousBusinessSecret;
  }
});
