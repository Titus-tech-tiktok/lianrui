const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');

const CNY_PER_USD = 7;

function createAlipayRechargeService(dataRoot, billing) {
  const root = path.join(dataRoot, 'system');
  const settingsFile = path.join(root, 'alipay-settings.json');
  const ordersFile = path.join(root, 'alipay-recharges.json');
  const qrFile = path.join(root, 'alipay-qr.png');
  let mutationChain = Promise.resolve();
  const mutate = worker => {
    const operation = mutationChain.then(worker);
    mutationChain = operation.catch(() => {});
    return operation;
  };
  async function readJson(file, fallback) {
    try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch { return fallback; }
  }
  async function writeJson(file, value) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}-${crypto.randomBytes(4).toString('hex')}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
    await fs.rename(temporary, file);
  }
  function parseUsd(value) {
    const text = String(value ?? '').trim();
    if (!/^\d{1,7}(?:\.\d{1,2})?$/.test(text)) throw new Error('请输入正确的充值金额，最多保留两位小数');
    const [whole, fraction = ''] = text.split('.');
    const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
    if (!Number.isSafeInteger(cents) || cents < 100 || cents > 100_000_000) throw new Error('充值金额需在 $1.00 至 $1,000,000.00 之间');
    return { cents, creditMinor: cents * 10_000, paymentCnyCents: cents * CNY_PER_USD };
  }
  function normalizeOrderNo(value) {
    const orderNo = String(value || '').replace(/\s+/g, '');
    if (!/^\d{12,64}$/.test(orderNo)) throw new Error('请输入正确的支付宝订单号（12-64 位数字）');
    return orderNo;
  }
  async function getSettings() {
    const value = await readJson(settingsFile, {});
    const qrAvailable = Boolean(await fs.stat(qrFile).catch(() => null));
    return { enabled: value.enabled === true, payeeName: String(value.payeeName || '').slice(0, 80), qrAvailable, updatedAt: String(value.updatedAt || '') };
  }
  async function saveSettings(payload = {}) {
    const qrAvailable = Boolean(await fs.stat(qrFile).catch(() => null));
    if (payload.enabled === true && !qrAvailable) throw new Error('请先上传支付宝收款码');
    await writeJson(settingsFile, { enabled: payload.enabled === true, payeeName: String(payload.payeeName || '').trim().slice(0, 80), updatedAt: new Date().toISOString() });
    return getSettings();
  }
  async function readOrders() {
    const state = await readJson(ordersFile, { version: 1, orders: [] });
    return { version: 1, orders: Array.isArray(state.orders) ? state.orders : [] };
  }
  const publicOrder = order => ({ id: order.id, creditMinor: order.creditMinor, requestedCreditMinor: order.requestedCreditMinor, paymentCnyCents: order.paymentCnyCents, requestedPaymentCnyCents: order.requestedPaymentCnyCents, alipayOrderNo: order.alipayOrderNo, status: order.status, submittedAt: order.submittedAt, reviewedAt: order.reviewedAt || '', rejectionReason: order.rejectionReason || '', serviceName: order.relayName || '' });
  const reviewOrder = order => ({ ...publicOrder(order), userId: order.userId, workspaceId: order.workspaceId, username: order.username, displayName: order.displayName, serviceName: order.relayName });
  async function createOrder(payload, context) {
    const settings = await getSettings();
    if (!settings.enabled || !settings.qrAvailable) throw new Error('Alipay 当前暂不可用');
    const money = parseUsd(payload.amountUsd);
    const alipayOrderNo = normalizeOrderNo(payload.alipayOrderNo);
    return mutate(async () => {
      const state = await readOrders();
      const existing = state.orders.find(order => order.alipayOrderNo === alipayOrderNo && order.status !== 'rejected');
      if (existing?.userId === context.userId) return publicOrder(existing);
      if (existing) throw new Error('该支付宝订单号已经提交，请勿重复提交');
      if (state.orders.filter(order => order.userId === context.userId && order.status === 'pending').length >= 10) throw new Error('待核验记录较多，请等待处理后再提交');
      const now = new Date().toISOString();
      const order = { id: `ALI-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`, userId: context.userId, workspaceId: context.workspaceId, username: String(context.username || '').slice(0, 80), displayName: String(context.displayName || '').slice(0, 80), relayId: context.relayId, relayName: String(context.relayName || '').slice(0, 80), requestedCreditMinor: money.creditMinor, requestedPaymentCnyCents: money.paymentCnyCents, creditMinor: money.creditMinor, paymentCnyCents: money.paymentCnyCents, alipayOrderNo, status: 'pending', submittedAt: now, updatedAt: now };
      state.orders.unshift(order);
      await writeJson(ordersFile, state);
      return publicOrder(order);
    });
  }
  async function listMine(userId) { return (await readOrders()).orders.filter(order => order.userId === userId).slice(0, 50).map(publicOrder); }
  async function listReview() { return (await readOrders()).orders.slice(0, 300).map(reviewOrder); }
  async function approve(id, payload, actorUserId) {
    const actual = parseUsd(payload.actualAmountUsd);
    return mutate(async () => {
      const state = await readOrders();
      const order = state.orders.find(item => item.id === id);
      if (!order) throw new Error('充值记录不存在');
      if (order.status === 'approved') return reviewOrder(order);
      if (order.status !== 'pending') throw new Error('该记录已经处理');
      const result = await billing.adjustBalance(order.workspaceId, order.relayId, actual.creditMinor, { relayName: order.relayName, description: 'Alipay 充值到账', operatorUserId: actorUserId, reference: order.id, onceKey: `alipay-recharge:${order.id}` });
      Object.assign(order, { creditMinor: actual.creditMinor, paymentCnyCents: actual.paymentCnyCents, status: 'approved', reviewedAt: new Date().toISOString(), transactionId: result.transaction?.id || result.adjustmentId || '' });
      order.updatedAt = order.reviewedAt;
      await writeJson(ordersFile, state);
      return reviewOrder(order);
    });
  }
  async function reject(id, reason) {
    return mutate(async () => {
      const state = await readOrders();
      const order = state.orders.find(item => item.id === id);
      if (!order) throw new Error('充值记录不存在');
      if (order.status !== 'pending') throw new Error('该记录已经处理');
      Object.assign(order, { status: 'rejected', rejectionReason: String(reason || '未核验到对应款项').trim().slice(0, 160), reviewedAt: new Date().toISOString() });
      order.updatedAt = order.reviewedAt;
      await writeJson(ordersFile, state);
      return reviewOrder(order);
    });
  }
  return { approve, createOrder, getSettings, listMine, listReview, parseUsd, qrFile, reject, saveSettings };
}

module.exports = { createAlipayRechargeService };
