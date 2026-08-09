const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

test('mobile global stats display USD values with exactly two decimal places', async () => {
  const renderer = await fs.readFile(path.join(__dirname, '../../web/src/renderer.js'), 'utf8');

  assert.match(renderer, /function formatMobileStatsMoney\(minor = 0\)/);
  assert.match(renderer, /return `\$\$\{amount\.toFixed\(2\)\}`/);
  assert.match(renderer, /formatMobileStatsMoney\(item\.totalCostMinor\)/);
  assert.match(renderer, /formatMobileStatsMoney\(selectedTotals\.totalCostMinor\)/);
  assert.match(renderer, /formatMobileStatsMoney\(selectedTotals\.averageCostMinor\)/);
});

test('mobile global stats omit the generation trend panel', async () => {
  const renderer = await fs.readFile(path.join(__dirname, '../../web/src/renderer.js'), 'utf8');
  const block = renderer.match(/function renderMobileStats\(\)[\s\S]*?\n\}/)?.[0] || '';

  assert.doesNotMatch(block, /生成趋势|mobile-stats-chart-panel|mobile-stats-chart-bar/);
});

test('mobile global stats select one range and include current month', async () => {
  const renderer = await fs.readFile(path.join(__dirname, '../../web/src/renderer.js'), 'utf8');
  const renderBlock = renderer.match(/function renderMobileStats\(\)[\s\S]*?\n\}/)?.[0] || '';
  const loadBlock = renderer.match(/async function loadMobileStats\(\)[\s\S]*?\n\}/)?.[0] || '';

  assert.match(renderer, /mobileStatsRange: 'today'/);
  assert.match(renderBlock, /data-mobile-stats-range/);
  assert.match(renderBlock, /\{ key: 'month', label: '本月', dataKey: 'month' \}/);
  assert.doesNotMatch(renderBlock, /mobile-stats-range-grid/);
  assert.match(loadBlock, /getGlobalStats\('month'\)/);
  assert.doesNotMatch(loadBlock, /getGlobalStats\('30d'\)/);
});

test('mobile account ranking displays available balance', async () => {
  const renderer = await fs.readFile(path.join(__dirname, '../../web/src/renderer.js'), 'utf8');
  const block = renderer.match(/function renderMobileStats\(\)[\s\S]*?\n\}/)?.[0] || '';

  assert.match(block, /balanceSummary\?\.byAccount/);
  assert.match(block, /balanceByWorkspace\.get/);
  assert.match(block, /formatMobileStatsMoney\(balance\?\.availableMinor\)/);
  assert.match(block, /可用余额/);
});

test('mobile global stats display gateway contract balance without exposing provider name', async () => {
  const renderer = await fs.readFile(path.join(__dirname, '../../web/src/renderer.js'), 'utf8');
  const block = renderer.match(/function renderMobileStats\(\)[\s\S]*?\n\}/)?.[0] || '';

  assert.match(renderer, /function formatGatewayContractBalance\(value\)/);
  assert.match(renderer, /amount\.toFixed\(2\)/);
  assert.match(block, /网关合约费用/);
  assert.match(block, /mobileGatewayUsage\?\.balance/);
  assert.doesNotMatch(block, /change2pro/i);
  assert.match(renderer, /getGatewayUsage\(\)\.catch\(\(\) => null\)/);
});
