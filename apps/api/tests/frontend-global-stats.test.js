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
