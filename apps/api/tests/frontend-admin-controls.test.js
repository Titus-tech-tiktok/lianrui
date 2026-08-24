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
