const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

test('mobile finance ledger stays collapsed until More is selected', async () => {
  const renderer = await fs.readFile(path.join(__dirname, '../../web/src/renderer.js'), 'utf8');

  assert.match(renderer, /mobileFinanceExpanded: false/);
  assert.match(renderer, /id="mobileFinanceMore"/);
  assert.match(renderer, /state\.mobileFinanceExpanded \? '收起财务账本' : 'More'/);
  assert.match(renderer, /if \(!state\.mobileFinanceExpanded\) return ''/);
});

test('mobile finance ledger uses Chinese labels and independent finance APIs', async () => {
  const renderer = await fs.readFile(path.join(__dirname, '../../web/src/renderer.js'), 'utf8');
  const bridge = await fs.readFile(path.join(__dirname, '../../web/src/api-bridge.js'), 'utf8');

  for (const label of ['财务账本', '本月收入', 'API 实际成本', '经营支出', '本月净利润', '累计总利润', '本月现金流', '新增记录', '导出 CSV']) {
    assert.match(renderer, new RegExp(label));
  }
  assert.match(renderer, /totalRevenue - totalOperatingExpenses - cumulativeGatewayCost\.minor/);
  assert.match(renderer, /function financeGatewayCost\(month\)/);
  assert.match(renderer, /return \{ available: false, minor: 0 \}/);
  assert.match(renderer, /exchangeRate: element\.querySelector/);
  assert.match(renderer, /getFinanceLedger\(state\.mobileFinanceMonth\)/);
  assert.match(bridge, /\/api\/finance\/ledger/);
  assert.match(bridge, /createFinanceEntry/);
  assert.match(bridge, /updateFinanceEntry/);
  assert.match(bridge, /deleteFinanceEntry/);
});
