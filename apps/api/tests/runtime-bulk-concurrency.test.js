const test = require('node:test');
const assert = require('node:assert/strict');
const runtime = require('../src/runtime');

test('bulk template generation uses shared image concurrency instead of package throttling', () => {
  const pack = { maxConcurrency: 3, startIntervalMs: 1200 };
  const settings = { imageInitialConcurrency: 8, imageMaxConcurrency: 24, imageStartIntervalMs: 125 };
  assert.deepEqual(runtime.imageSchedulerSettingsForRequest(pack, { bulkGeneration: true }, settings), {
    initialConcurrency: 24,
    maxConcurrency: 24,
    minStartIntervalMs: 125
  });
  assert.deepEqual(runtime.imageSchedulerSettingsForRequest(pack, {}, settings), {
    initialConcurrency: 3,
    maxConcurrency: 3,
    minStartIntervalMs: 1200
  });
});
