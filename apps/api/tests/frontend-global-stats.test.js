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
  assert.match(renderer, /团队可用余额/);
  assert.match(renderer, /formatMobileStatsMoney\(selectedStats\.balanceSummary\?\.totals\?\.availableMinor\)/);
});

test('mobile global stats omit the generation trend panel', async () => {
  const renderer = await fs.readFile(path.join(__dirname, '../../web/src/renderer.js'), 'utf8');
  const block = renderer.match(/function renderMobileStats\(\)[\s\S]*?\n\}/)?.[0] || '';

  assert.doesNotMatch(block, /生成趋势|mobile-stats-chart-panel|mobile-stats-chart-bar/);
});

test('mobile global stats use English labels, select one range and include current month', async () => {
  const renderer = await fs.readFile(path.join(__dirname, '../../web/src/renderer.js'), 'utf8');
  const renderBlock = renderer.match(/function renderMobileStats\(\)[\s\S]*?\n\}/)?.[0] || '';
  const loadBlock = renderer.match(/async function loadMobileStats\(\)[\s\S]*?\n\}/)?.[0] || '';

  assert.match(renderer, /mobileStatsRange: 'today'/);
  assert.match(renderBlock, /data-mobile-stats-range/);
  assert.match(renderBlock, /\{ key: 'month', label: 'This Month', dataKey: 'month' \}/);
  assert.match(renderBlock, /Account Ranking/);
  assert.match(renderer, /Global Analytics/);
  assert.doesNotMatch(renderer, /永沙全局统计/);
  assert.doesNotMatch(renderBlock, /mobile-stats-range-grid/);
  assert.match(loadBlock, /getGlobalStats\('month', relayId\)/);
  assert.doesNotMatch(loadBlock, /getGlobalStats\('30d'\)/);
});

test('mobile account ranking displays available balance', async () => {
  const renderer = await fs.readFile(path.join(__dirname, '../../web/src/renderer.js'), 'utf8');
  const block = renderer.match(/function renderMobileStats\(\)[\s\S]*?\n\}/)?.[0] || '';

  assert.match(block, /balanceSummary\?\.byAccount/);
  assert.match(block, /balanceByWorkspace\.get/);
  assert.match(block, /formatMobileStatsMoney\(balance\?\.availableMinor\)/);
  assert.match(block, /Balance/);
});

test('mobile accounting selects one relay and shows its independent ledger', async () => {
  const renderer = await fs.readFile(path.join(__dirname, '../../web/src/renderer.js'), 'utf8');
  const bridge = await fs.readFile(path.join(__dirname, '../../web/src/api-bridge.js'), 'utf8');
  const block = renderer.match(/function renderMobileStats\(\)[\s\S]*?\n\}/)?.[0] || '';
  const loadBlock = renderer.match(/async function loadMobileStats\(\)[\s\S]*?\n\}/)?.[0] || '';

  assert.match(renderer, /mobileStatsRelayId: ''/);
  assert.match(block, /id="mobileStatsRelay"/);
  assert.match(block, /各中转站账户互不通用/);
  assert.match(block, /费用流水/);
  assert.match(block, /selectedStats\.transactions/);
  assert.match(block, /balanceAccounts\.map/);
  assert.match(loadBlock, /getRelayChoices\(\)/);
  assert.match(loadBlock, /getGlobalStats\('today', relayId\)/);
  assert.match(bridge, /relayId=.*encodeURIComponent\(relayId\)/);
});
