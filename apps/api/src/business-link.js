const crypto = require('node:crypto');

const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const seenNonces = new Map();

function linkSecret() {
  return String(process.env.CAISHEN_BUSINESS_LINK_SECRET || '').trim();
}

function bodyText(value) {
  return JSON.stringify(value ?? {});
}

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function signature(secret, timestamp, nonce, pathname, body) {
  return crypto.createHmac('sha256', secret)
    .update(`${timestamp}\n${nonce}\nPOST\n${pathname}\n${digest(body)}`)
    .digest('hex');
}

function secureEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function encryptionKey(secret) {
  return crypto.createHash('sha256').update(secret).digest();
}

function sealBusinessData(value) {
  const secret = linkSecret();
  if (!secret) throw new Error('业务数据连接尚未配置');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(secret), iv);
  const encrypted = Buffer.concat([cipher.update(bodyText(value), 'utf8'), cipher.final()]);
  return {
    encrypted: true,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: encrypted.toString('base64')
  };
}

function openBusinessData(value) {
  if (!value?.encrypted) return value;
  const secret = linkSecret();
  if (!secret) throw new Error('业务数据连接尚未配置');
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(secret), Buffer.from(value.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
    return JSON.parse(Buffer.concat([
      decipher.update(Buffer.from(value.ciphertext, 'base64')),
      decipher.final()
    ]).toString('utf8'));
  } catch {
    throw new Error('业务数据响应无法验证');
  }
}

function pruneNonces(now = Date.now()) {
  for (const [nonce, expiresAt] of seenNonces) {
    if (expiresAt <= now) seenNonces.delete(nonce);
  }
}

function verifyBusinessRequest(req) {
  const secret = linkSecret();
  if (!secret) return { ok: false, status: 503, error: '业务数据连接尚未配置' };
  const timestamp = String(req.get('x-caishen-timestamp') || '');
  const nonce = String(req.get('x-caishen-nonce') || '');
  const supplied = String(req.get('x-caishen-signature') || '');
  const numericTimestamp = Number(timestamp);
  const now = Date.now();
  if (!/^\d{13}$/.test(timestamp) || Math.abs(now - numericTimestamp) > MAX_CLOCK_SKEW_MS) {
    return { ok: false, status: 401, error: '业务数据连接签名已过期' };
  }
  if (!/^[a-f0-9-]{20,80}$/i.test(nonce)) return { ok: false, status: 401, error: '业务数据连接签名无效' };
  pruneNonces(now);
  if (seenNonces.has(nonce)) return { ok: false, status: 409, error: '业务数据连接请求已处理' };
  const rawBody = bodyText(req.body);
  const expected = signature(secret, timestamp, nonce, req.path, rawBody);
  if (!secureEqual(supplied, expected)) return { ok: false, status: 401, error: '业务数据连接签名无效' };
  seenNonces.set(nonce, now + MAX_CLOCK_SKEW_MS);
  return { ok: true };
}

async function requestBusiness(baseUrl, pathname, payload = {}, timeoutMs = 15000) {
  const secret = linkSecret();
  if (!secret) throw new Error('业务数据连接尚未配置');
  const root = String(baseUrl || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(root)) throw new Error('业务数据服务地址无效');
  const timestamp = String(Date.now());
  const nonce = crypto.randomUUID();
  const body = bodyText(payload);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${root}${pathname}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-caishen-timestamp': timestamp,
        'x-caishen-nonce': nonce,
        'x-caishen-signature': signature(secret, timestamp, nonce, pathname, body)
      },
      body,
      signal: controller.signal
    });
    const text = await response.text();
    let value;
    try { value = JSON.parse(text); } catch { value = {}; }
    if (!response.ok) throw new Error(value?.error || text || `业务数据服务返回 HTTP ${response.status}`);
    return openBusinessData(value?.data);
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('业务数据服务响应超时');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { openBusinessData, requestBusiness, sealBusinessData, verifyBusinessRequest };
