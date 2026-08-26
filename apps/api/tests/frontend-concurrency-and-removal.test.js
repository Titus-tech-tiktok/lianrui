const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const root = path.resolve(__dirname, '../../..');

test('web concurrency follows the saved limit and task groups run in parallel', async () => {
  const [index, renderer] = await Promise.all([
    fs.readFile(path.join(root, 'apps/web/index.html'), 'utf8'),
    fs.readFile(path.join(root, 'apps/web/src/renderer.js'), 'utf8')
  ]);
  assert.match(index, /id="imageInitialConcurrency"[^>]+max="20000"/);
  assert.match(index, /id="imageMaxConcurrency"[^>]+max="20000"/);
  assert.match(renderer, /runClientConcurrency\(taskGroups, groupConcurrency/);
  assert.doesNotMatch(renderer, /for \(let groupIndex = 0; groupIndex < taskGroups\.length/);
});

test('removed desktop features are not exposed by pages or browser RPC methods', async () => {
  const [index, renderer, bridge] = await Promise.all([
    fs.readFile(path.join(root, 'apps/web/index.html'), 'utf8'),
    fs.readFile(path.join(root, 'apps/web/src/renderer.js'), 'utf8'),
    fs.readFile(path.join(root, 'apps/web/src/api-bridge.js'), 'utf8')
  ]);
  for (const removed of ['page-titles', 'page-taobao-publish', 'globalStatsNav']) {
    assert.doesNotMatch(index + renderer, new RegExp(removed));
  }
  assert.doesNotMatch(bridge, /getTitleLibrary|generateTitles|TaobaoPublish/);
});
