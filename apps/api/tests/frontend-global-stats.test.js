const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

test('mobile global stats display USD values with exactly two decimal places', async () => {
  const renderer = await fs.readFile(path.join(__dirname, '../../web/src/renderer.js'), 'utf8');

  assert.match(renderer, /function formatMobileStatsMoney\(minor = 0\)/);
  assert.match(renderer, /return `\$\$\{amount\.toFixed\(2\)\}`/);
  assert.match(renderer, /formatMobileStatsMoney\(totals\.totalCostMinor\)/);
  assert.match(renderer, /formatMobileStatsMoney\(item\.totalCostMinor\)/);
  assert.match(renderer, /formatMobileStatsMoney\(d30Totals\.totalCostMinor\)/);
  assert.match(renderer, /formatMobileStatsMoney\(d30Totals\.averageCostMinor\)/);
});

test('mobile global stats omit the generation trend panel', async () => {
  const renderer = await fs.readFile(path.join(__dirname, '../../web/src/renderer.js'), 'utf8');
  const block = renderer.match(/function renderMobileStats\(\)[\s\S]*?\n\}/)?.[0] || '';

  assert.doesNotMatch(block, /生成趋势|mobile-stats-chart-panel|mobile-stats-chart-bar/);
});
