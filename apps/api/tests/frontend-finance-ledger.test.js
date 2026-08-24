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

  for (const label of ['财务账本', '已确认消费收入', '预计上游成本', '中转站毛利合计', '累计杂费', '总预估净利润', '客户未消费余额', '单站预估毛利', '本月现金流', '新增记录', '导出 CSV']) {
    assert.match(renderer, new RegExp(label));
  }
  assert.match(renderer, /成功生图数 × 单张采购成本/);
  assert.match(renderer, /各中转站毛利之和 - 全部杂费/);
  assert.doesNotMatch(renderer, /待成本同步|网关成本可用后/);
  assert.match(renderer, /getBillingAccounting\(\)/);
  assert.match(renderer, /data-finance-relay/);
  assert.match(renderer, /relayId: element\.querySelector/);
  assert.match(renderer, /exchangeRate: element\.querySelector/);
  assert.match(renderer, /getFinanceLedger\(state\.mobileFinanceMonth\)/);
  assert.match(bridge, /\/api\/billing\/accounting/);
  assert.match(bridge, /\/api\/finance\/ledger/);
  assert.match(bridge, /createFinanceEntry/);
  assert.match(bridge, /updateFinanceEntry/);
  assert.match(bridge, /deleteFinanceEntry/);
});
