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

  for (const label of ['经营账本', '营业收入', '总支出', '预估利润', '今天', '近 7 天', '本月', '上月', '自定义日期', '全部中转站', '收支流水', '收入', '支出', '资金与成本详情', '记一笔', '导出 CSV']) {
    assert.match(renderer, new RegExp(label));
  }
  assert.match(renderer, /客户成功生图实际扣费/);
  assert.match(renderer, /上游成本 \+ 杂费/);
  assert.match(renderer, /客户充值和未消费余额不算营业收入/);
  assert.doesNotMatch(renderer, /待成本同步|网关成本可用后/);
  assert.match(renderer, /getBillingAccounting\(\{/);
  assert.match(renderer, /mobileFinanceRange: 'month'/);
  assert.match(renderer, /mobileFinanceRelayId: ''/);
  assert.match(renderer, /id="mobileFinanceStartDate"/);
  assert.match(renderer, /id="mobileFinanceEndDate"/);
  assert.match(renderer, /data-finance-relay/);
  assert.match(renderer, /relayId: element\.querySelector/);
  assert.match(renderer, /exchangeRate: element\.querySelector/);
  assert.doesNotMatch(renderer, /getFinanceLedger\(state\.mobileFinanceMonth\)/);
  assert.match(bridge, /\/api\/billing\/accounting/);
  assert.match(bridge, /query\.set\('range'/);
  assert.match(bridge, /query\.set\('relayId'/);
  assert.match(bridge, /query\.set\('startDate'/);
  assert.match(bridge, /query\.set\('endDate'/);
  assert.match(bridge, /\/api\/finance\/ledger/);
  assert.match(bridge, /createFinanceEntry/);
  assert.match(bridge, /updateFinanceEntry/);
  assert.match(bridge, /deleteFinanceEntry/);
});
