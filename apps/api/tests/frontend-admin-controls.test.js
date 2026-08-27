const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const webRoot = path.join(__dirname, '../../web');

test('管理员余额划拨界面支持选择转出和转入账号', async () => {
  const [html, renderer, bridge] = await Promise.all([
    fs.readFile(path.join(webRoot, 'index.html'), 'utf8'),
    fs.readFile(path.join(webRoot, 'src/renderer.js'), 'utf8'),
    fs.readFile(path.join(webRoot, 'src/api-bridge.js'), 'utf8')
  ]);
  assert.match(html, /id="teamTransferFrom"/);
  assert.match(html, /id="teamTransferTo"/);
  assert.match(html, /id="teamTransferRelay"/);
  assert.match(html, /id="teamBalanceTransferEmpty"/);
  assert.match(html, /id="teamTransferAmount"/);
  assert.match(bridge, /transferBillingBalance:[\s\S]*\/api\/billing\/transfer/);
  assert.match(renderer, /window\.caishen\.transferBillingBalance\(\{[\s\S]*fromUserId,[\s\S]*toUserId,[\s\S]*relayId/);
  assert.match(renderer, /targetUsers = users\.filter\(user => user\.id !== fromSelect\.value\)/);
  assert.doesNotMatch(renderer, /data-transfer-billing=/);
});

test('超级管理员可强制用户下次登录改密并查看加密记录', async () => {
  const [html, renderer, bridge] = await Promise.all([
    fs.readFile(path.join(webRoot, 'index.html'), 'utf8'),
    fs.readFile(path.join(webRoot, 'src/renderer.js'), 'utf8'),
    fs.readFile(path.join(webRoot, 'src/api-bridge.js'), 'utf8')
  ]);
  assert.match(html, /id="requireAllPasswordChangesButton"/);
  assert.match(renderer, /data-team-user-require-password/);
  assert.match(renderer, /async function requireTeamUserPasswordChange/);
  assert.match(renderer, /async function requireAllTeamPasswordChanges/);
  assert.match(renderer, /data-team-user-view-password/);
  assert.match(renderer, /async function viewTeamUserPassword/);
  assert.match(renderer, /新密码可以与原密码相同/);
  assert.match(renderer, /改密原因/);
  assert.match(renderer, /authStatus\.user\.passwordChangeRequired/);
  assert.match(bridge, /requireUserPasswordChange:[\s\S]*require-password-change/);
  assert.match(bridge, /requireAllPasswordChanges:[\s\S]*password-policy\/require-all/);
  assert.match(bridge, /revealUserPassword:[\s\S]*reveal-password/);
});

test('全局价格和上游余额接口已从界面移除', async () => {
  const [html, renderer, bridge] = await Promise.all([
    fs.readFile(path.join(webRoot, 'index.html'), 'utf8'),
    fs.readFile(path.join(webRoot, 'src/renderer.js'), 'utf8'),
    fs.readFile(path.join(webRoot, 'src/api-bridge.js'), 'utf8')
  ]);
  assert.doesNotMatch(html, /id="billingImageFeeMin"|id="billingImageFeeMax"|id="billingDefaultBalance"/);
  assert.doesNotMatch(renderer, /getGatewayUsage|usagePath|data-relay-usage/);
  assert.doesNotMatch(bridge, /billing\/gateway-usage/);
  assert.match(renderer, /data-relay-field="imagePriceMinMinor"/);
  assert.match(renderer, /data-relay-field="imagePriceMaxMinor"/);
  assert.match(renderer, /step="0\.000001"/);
  assert.match(renderer, /最高扣费不能低于最低扣费/);
});

test('中转站删除会立即保存到服务器', async () => {
  const renderer = await fs.readFile(path.join(webRoot, 'src/renderer.js'), 'utf8');
  const deleteFunction = renderer.slice(renderer.indexOf('async function deleteRelay(button)'), renderer.indexOf('async function loadRelayChoices'));
  assert.match(deleteFunction, /saveApiSettings\(\{ \.\.\.apiSettingsPayload\(\), relays, activeRelayId \}\)/);
  assert.match(deleteFunction, /删除后立即生效/);
  assert.doesNotMatch(deleteFunction, /保存设置后生效/);
});

test('团队余额中转站筛选不会被压缩成空白下拉框', async () => {
  const [renderer, styles] = await Promise.all([
    fs.readFile(path.join(webRoot, 'src/renderer.js'), 'utf8'),
    fs.readFile(path.join(webRoot, 'src/styles.css'), 'utf8')
  ]);
  assert.match(styles, /\.billing-filter-grid \.billing-user-filter \{[^}]*flex:\s*1 1 240px;[^}]*min-width:\s*220px;/s);
  assert.match(renderer, /暂无可用中转站/);
  assert.match(renderer, /relayFilter\.disabled = relays\.length === 0/);
  assert.match(renderer, /function billingAdminWithRelayFallback\(billing, relayChoices\)/);
  assert.match(renderer, /window\.caishen\.getBillingAdmin\(\),[\s\S]*window\.caishen\.getRelayChoices\(\)/);
});

test('管理员线路选择和侧边栏不公开中转站单价', async () => {
  const renderer = await fs.readFile(path.join(webRoot, 'src/renderer.js'), 'utf8');
  const billingSummary = renderer.slice(renderer.indexOf('function renderBillingSummary()'), renderer.indexOf('function renderBillingDetail()'));
  const relayStations = renderer.slice(renderer.indexOf('function renderRelayStations()'), renderer.indexOf('async function deleteRelay(button)'));
  assert.match(billingSummary, /currentBillingHint'\)\.textContent = relay\.name \|\| '当前中转站'/);
  assert.doesNotMatch(billingSummary, /feeRangeLabel|\/张/);
  const adminChoices = relayStations.slice(relayStations.indexOf("if (!isSuperAdmin())"), relayStations.indexOf('return;', relayStations.indexOf("if (!isSuperAdmin())")));
  assert.match(adminChoices, /item\.description \|\| '可用中转站'/);
  assert.doesNotMatch(adminChoices, /feeRangeLabel|\/张/);
});

test('流水明细统计生图和 AI 分析且后台刷新不重绘明细整表', async () => {
  const renderer = await fs.readFile(path.join(webRoot, 'src/renderer.js'), 'utf8');
  assert.match(renderer, /AI 分析消费/);
  assert.match(renderer, /metrics\.analysisSpendMinor/);
  assert.match(renderer, /AI 分析请求/);
  assert.match(renderer, /metrics\.analysisCount/);
  assert.match(renderer, /window\.addEventListener\('caishen:billing-changed', scheduleBillingSummaryRefresh\)/);
  const summaryRenderer = renderer.slice(renderer.indexOf('function renderBillingSummary()'), renderer.indexOf('function renderBillingDetail()'));
  assert.doesNotMatch(summaryRenderer, /renderBillingDetail\(\)/);
});
