const test = require('node:test');
const assert = require('node:assert/strict');
const runtime = require('../src/runtime');

test('all image generation uses the shared global concurrency settings', () => {
  const relay = { maxConcurrency: 3, startIntervalMs: 1200 };
  const settings = { imageInitialConcurrency: 8, imageMaxConcurrency: 24, imageStartIntervalMs: 125 };
  assert.deepEqual(runtime.imageSchedulerSettingsForRequest(relay, { bulkGeneration: true }, settings), {
    initialConcurrency: 8,
    maxConcurrency: 24,
    minStartIntervalMs: 125
  });
  assert.deepEqual(runtime.imageSchedulerSettingsForRequest(relay, {}, settings), {
    initialConcurrency: 8,
    maxConcurrency: 24,
    minStartIntervalMs: 125
  });
});
