function networkFailure(error) {
  return error instanceof TypeError || /failed to fetch|networkerror|load failed|network request failed/i.test(String(error?.message || error || ''));
}

function localServiceError(error) {
  if (!networkFailure(error)) return error;
  const friendly = new Error('暂时无法连接本机服务，系统已自动重试，请稍后再试');
  friendly.cause = error;
  return friendly;
}

async function fetchWithRecovery(url, options = {}, retries = 2) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try { return await fetch(url, options); }
    catch (error) {
      lastError = error;
      if (!networkFailure(error) || attempt >= retries) throw localServiceError(error);
      await sleep(250 * (attempt + 1));
    }
  }
  throw localServiceError(lastError);
}

function rpc(method, ...args) {
  return fetchWithRecovery('/api/rpc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, args })
  }, 0).then(async response => {
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `请求失败：HTTP ${response.status}`);
    return body.data;
  });
}

async function authRequest(url, options = {}) {
  const { retryNetwork = false, ...requestOptions } = options;
  const method = String(requestOptions.method || 'GET').toUpperCase();
  const retries = retryNetwork || ['GET', 'HEAD'].includes(method) ? 2 : 0;
  const response = await fetchWithRecovery(url, {
    ...requestOptions,
    headers: requestOptions.body ? { 'Content-Type': 'application/json', ...(requestOptions.headers || {}) } : requestOptions.headers
  }, retries);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `请求失败：HTTP ${response.status}`);
  return body.data;
}

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function createClientId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const activeJobPolls = new Map();
let activeJobPollTimer = null;
let activeJobPollRequest = null;

function notifyJobProgress(watcher, job) {
  const signature = JSON.stringify([job?.status || '', job?.error || '', job?.progress || {}]);
  if (signature === watcher.lastSignature) return;
  watcher.lastSignature = signature;
  try { watcher.onProgress(job?.progress || {}, job || {}); } catch {}
}

function finishJobPoll(jobId, job) {
  const watcher = activeJobPolls.get(jobId);
  if (!watcher) return;
  activeJobPolls.delete(jobId);
  window.dispatchEvent(new CustomEvent('caishen:billing-changed'));
  if (job.status === 'completed') watcher.resolve(job.result);
  else watcher.reject(new Error(job.error || '后台任务执行失败'));
}

function scheduleActiveJobPoll(delay = 0) {
  if (activeJobPollTimer || activeJobPollRequest || !activeJobPolls.size) return;
  activeJobPollTimer = setTimeout(() => {
    activeJobPollTimer = null;
    void pollActiveJobs();
  }, delay);
}

async function pollActiveJobs() {
  if (activeJobPollRequest || !activeJobPolls.size) return;
  const now = Date.now();
  for (const [jobId, watcher] of activeJobPolls) {
    if (now < watcher.deadline) continue;
    activeJobPolls.delete(jobId);
    watcher.reject(new Error('后台任务仍在执行，请稍后到对应页面刷新结果'));
  }
  const ids = [...activeJobPolls.keys()].slice(0, 500);
  if (!ids.length) return;
  activeJobPollRequest = (async () => {
    const response = await fetchWithRecovery('/api/jobs/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
      cache: 'no-store'
    }, 2);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `任务批量查询失败：HTTP ${response.status}`);
    return Array.isArray(body.data) ? body.data : [];
  })();
  try {
    const jobs = await activeJobPollRequest;
    const received = new Set();
    for (const job of jobs) {
      if (!job?.id || !activeJobPolls.has(job.id)) continue;
      received.add(job.id);
      const watcher = activeJobPolls.get(job.id);
      watcher.missingCount = 0;
      notifyJobProgress(watcher, job);
      if (job.status === 'completed' || job.status === 'failed') finishJobPoll(job.id, job);
    }
    for (const jobId of ids) {
      if (received.has(jobId) || !activeJobPolls.has(jobId)) continue;
      const watcher = activeJobPolls.get(jobId);
      watcher.missingCount += 1;
      if (watcher.missingCount < 3) continue;
      activeJobPolls.delete(jobId);
      watcher.reject(new Error('后台任务不存在或已被清理'));
    }
  } catch (error) {
    if (!networkFailure(error?.cause || error)) {
      for (const jobId of ids) {
        const watcher = activeJobPolls.get(jobId);
        if (!watcher) continue;
        activeJobPolls.delete(jobId);
        watcher.reject(error);
      }
    } else {
      for (const jobId of ids) {
        const watcher = activeJobPolls.get(jobId);
        if (!watcher) continue;
        notifyJobProgress(watcher, { id: jobId, status: 'running', progress: { phase: 'reconnecting', message: '本机服务短暂断开，正在重连…' } });
      }
    }
  } finally {
    activeJobPollRequest = null;
    if (activeJobPolls.size) scheduleActiveJobPoll(1000);
  }
}

function waitForJob(job, onProgress) {
  return new Promise((resolve, reject) => {
    const watcher = { resolve, reject, onProgress, deadline: Date.now() + 30 * 60 * 1000, lastSignature: '', missingCount: 0 };
    activeJobPolls.set(job.id, watcher);
    notifyJobProgress(watcher, job);
    if (job.status === 'completed' || job.status === 'failed') return finishJobPoll(job.id, job);
    scheduleActiveJobPoll();
  });
}

async function runJob(method, args = [], clientKey = '', onProgress = () => {}) {
  const effectiveClientKey = clientKey || createClientId();
  const response = await fetchWithRecovery('/api/jobs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, args, clientKey: effectiveClientKey })
  }, 2);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `任务提交失败：HTTP ${response.status}`);
  const jobId = body.data?.id;
  if (!jobId) throw new Error('服务端没有返回任务编号');
  return waitForJob(body.data, onProgress);
}

async function cancelJob(jobId) {
  if (!jobId) return null;
  const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/cancel`, { method: 'POST' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `停止任务失败：HTTP ${response.status}`);
  return body.data;
}

async function cancelActiveJobs() {
  const response = await fetch('/api/jobs/cancel-active', { method: 'POST' });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `停止任务失败：HTTP ${response.status}`);
  return body.data;
}

function pickFiles({ accept = '', directory = false, multiple = false } = {}) {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple || directory;
    if (directory) {
      input.setAttribute('webkitdirectory', '');
      input.setAttribute('directory', '');
    }
    input.onchange = () => resolve([...input.files || []]);
    input.oncancel = () => resolve([]);
    input.click();
  });
}

function assetFileEntry(file, relativePath = '') {
  return { file, relativePath: String(relativePath || file?.webkitRelativePath || file?.name || '').replaceAll('\\', '/') };
}

async function readDirectoryHandle(directoryHandle, parent = '') {
  const entries = [];
  for await (const handle of directoryHandle.values()) {
    if (handle.kind === 'file') {
      const file = await handle.getFile();
      entries.push(assetFileEntry(file, `${parent}${file.name}`));
      continue;
    }
    if (handle.kind === 'directory') entries.push(...await readDirectoryHandle(handle, `${parent}${handle.name}/`));
  }
  return entries;
}

async function chooseDirectoryEntries() {
  if (typeof window.showDirectoryPicker === 'function' && window.isSecureContext) {
    try {
      const directory = await window.showDirectoryPicker({ mode: 'read' });
      return readDirectoryHandle(directory, `${directory.name}/`);
    } catch (error) {
      if (error?.name === 'AbortError') return [];
      throw error;
    }
  }
  return (await pickFiles({ accept: 'image/*', directory: true, multiple: true })).map(file => assetFileEntry(file));
}

async function readDroppedEntry(entry, parent = '') {
  if (!entry) return [];
  if (entry.isFile) {
    const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
    return [assetFileEntry(file, `${parent}${file.name}`)];
  }
  if (!entry.isDirectory) return [];
  const reader = entry.createReader();
  const children = [];
  while (true) {
    const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
    if (!batch.length) break;
    children.push(...batch);
  }
  const nested = await Promise.all(children.map(child => readDroppedEntry(child, `${parent}${entry.name}/`)));
  return nested.flat();
}

async function filesFromDrop(dataTransfer) {
  const items = [...(dataTransfer?.items || [])];
  const entries = items.map(item => item.webkitGetAsEntry?.()).filter(Boolean);
  const files = entries.length
    ? (await Promise.all(entries.map(entry => readDroppedEntry(entry)))).flat()
    : [...(dataTransfer?.files || [])].map(file => assetFileEntry(file));
  return files.filter(item => supportedImagePattern.test(item.file?.name || item.relativePath));
}

async function chooseAssetFiles() {
  return (await pickFiles({ accept: 'image/*', multiple: true })).map(file => assetFileEntry(file));
}

async function chooseAssetFolder() {
  return (await chooseDirectoryEntries())
    .filter(entry => supportedImagePattern.test(entry.file?.name || entry.relativePath || ''));
}

async function addAssetFiles(key, root, entries = []) {
  const valid = entries.filter(item => item?.file && supportedImagePattern.test(item.file.name || item.relativePath));
  if (!valid.length) throw new Error('请选择支持的图片文件');
  let currentRoot = root || '';
  let added = 0;
  let skipped = 0;
  const paths = [];
  const batchSize = 200;
  for (let start = 0; start < valid.length; start += batchSize) {
    const batch = valid.slice(start, start + batchSize);
    const form = new FormData();
    form.append('root', currentRoot);
    form.append('relativePaths', JSON.stringify(batch.map(item => item.relativePath || item.file.name)));
    for (const item of batch) form.append('files', item.file, item.file.name);
    const result = await responseJson(await fetch(`/api/assets/files/${assetKindFromKey(key)}`, { method: 'POST', body: form }), '添加素材失败');
    currentRoot = result.root;
    added += Number(result.added) || 0;
    skipped += Number(result.skipped) || 0;
    paths.push(...(Array.isArray(result.paths) ? result.paths : []));
  }
  return { root: currentRoot, added, skipped, paths };
}

async function deleteAssetFiles(key, root, paths) {
  return responseJson(await fetch(`/api/assets/files/${assetKindFromKey(key)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ root, paths })
  }), '删除素材失败');
}

const stagedAssetFolders = new Map();
const supportedImagePattern = /\.(jpe?g|png|webp|bmp|gif|tiff?)$/i;

function assetKindFromKey(key) {
  return ({
    categoriesPath: 'product',
    printsPath: 'print',
    detailSetsPath: 'template',
    childrenwearRealAssetsPath: 'childrenwear-real',
    childrenwearReferenceAssetsPath: 'childrenwear-reference',
    childrenwearModelAssetsPath: 'childrenwear-model',
    childrenwearCombinationAssetsPath: 'childrenwear-combination'
  })[key] || 'template';
}

async function renameAssetFolder(key, root, folder, name) {
  return responseJson(await fetch(`/api/assets/folders/${assetKindFromKey(key)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ root, folder, name })
  }), '修改文件夹名称失败');
}

function stagedRelativePath(entry, rootName) {
  const value = String(entry.relativePath || entry.file?.webkitRelativePath || entry.file?.name || '').replaceAll('\\', '/');
  const parts = value.split('/').filter(Boolean);
  if (parts[0] === rootName) parts.shift();
  return parts.join('/') || entry.file?.name || '';
}

async function stageAssetFolder(key) {
  const selected = await chooseDirectoryEntries();
  if (!selected.length) return null;
  const firstPath = String(selected[0].relativePath || selected[0].file?.name || '').replaceAll('\\', '/');
  const rootName = firstPath.split('/').filter(Boolean)[0] || '素材';
  const files = selected
    .filter(entry => supportedImagePattern.test(entry.file?.name || entry.relativePath || ''))
    .map(entry => ({ file: entry.file, relativePath: stagedRelativePath(entry, rootName) }))
    .filter(item => key !== 'printsPath' || !item.relativePath.includes('/'));
  if (!files.length) throw new Error('选择的文件夹里没有支持的图片');
  const stage = {
    key,
    kind: assetKindFromKey(key),
    rootName,
    files,
    totalBytes: files.reduce((total, item) => total + item.file.size, 0)
  };
  stagedAssetFolders.set(key, stage);
  return { key, rootName, count: files.length, totalBytes: stage.totalBytes };
}

async function responseJson(response, fallbackMessage) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `${fallbackMessage}：HTTP ${response.status}`);
  return body.data ?? body;
}

async function syncAssetFolder(key, currentRoot, onProgress = () => {}) {
  const stage = stagedAssetFolders.get(key);
  if (!stage) throw new Error('请先选择需要扫描的文件夹');
  return syncAssetEntries(key, currentRoot, stage.files, { rootName: stage.rootName, onProgress });
}

async function syncAssetEntries(key, currentRoot, entries = [], options = {}) {
  const files = entries
    .filter(item => item?.file && supportedImagePattern.test(item.file.name || item.relativePath || ''))
    .map(item => ({
      file: item.file,
      relativePath: String(item.relativePath || item.file.name || '').replaceAll('\\', '/')
    }))
    .filter(item => item.relativePath);
  if (!files.length) throw new Error('请选择支持的图片文件');
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : () => {};
  const rootName = String(options.rootName || '素材').trim() || '素材';
  onProgress({ phase: 'compare', current: 0, total: files.length, message: '正在对比素材库…' });
  const prepared = await responseJson(await fetch(`/api/assets/sync/prepare/${assetKindFromKey(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      currentRoot: currentRoot || '',
      rootName,
      files: files.map(item => ({
        name: item.file.name,
        relativePath: item.relativePath,
        size: item.file.size,
        lastModified: item.file.lastModified
      }))
    })
  }), '扫描准备失败');

  const needed = new Set(prepared.neededRelativePaths || []);
  const pending = files.filter(item => needed.has(item.relativePath));
  const batchSize = 40;
  let uploaded = 0;
  onProgress({ phase: 'upload', current: 0, total: pending.length, skipped: prepared.skipped, message: pending.length ? '开始导入新增和变化素材…' : '素材没有变化' });
  for (let start = 0; start < pending.length; start += batchSize) {
    const batch = pending.slice(start, start + batchSize);
    const form = new FormData();
    for (const item of batch) form.append('files', item.file, item.file.name);
    form.append('relativePaths', JSON.stringify(batch.map(item => item.relativePath)));
    form.append('lastModified', JSON.stringify(batch.map(item => item.file.lastModified)));
    await responseJson(await fetch(`/api/assets/sync/upload/${encodeURIComponent(prepared.sessionId)}`, { method: 'POST', body: form }), '素材上传失败');
    uploaded += batch.length;
    onProgress({ phase: 'upload', current: uploaded, total: pending.length, skipped: prepared.skipped, message: `正在导入 ${uploaded}/${pending.length}` });
  }
  const result = await responseJson(await fetch(`/api/assets/sync/finish/${encodeURIComponent(prepared.sessionId)}`, { method: 'POST' }), '完成扫描失败');
  onProgress({ phase: 'done', current: result.count, total: result.count, skipped: result.skipped, uploaded: result.uploaded, message: '扫描完成' });
  return result;
}

async function uploadFolder(kind) {
  const entries = await chooseDirectoryEntries();
  if (!entries.length) return '';
  const form = new FormData();
  for (const entry of entries) form.append('files', entry.file, entry.file.name);
  form.append('relativePaths', JSON.stringify(entries.map(entry => entry.relativePath || entry.file.name)));
  const response = await fetch(`/api/upload/folder/${kind}`, { method: 'POST', body: form });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `上传失败：HTTP ${response.status}`);
  return body.root;
}

async function uploadSingle(endpoint, accept) {
  const [file] = await pickFiles({ accept });
  if (!file) return null;
  const form = new FormData();
  form.append('file', file, file.name);
  const response = await fetch(endpoint, { method: 'POST', body: form });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `上传失败：HTTP ${response.status}`);
  return body;
}

function downloadFrom(url) {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

async function openWorkspacePath(target, kind) {
  const popup = kind === 'folder' ? window.open('about:blank', '_blank') : null;
  try {
    const url = await rpc('getFileLink', target, kind);
    if (kind === 'folder') {
      if (popup) popup.location.href = url;
      else window.location.href = url;
    } else downloadFrom(url);
  } catch (error) {
    popup?.close();
    throw error;
  }
}

async function downloadWorkspaceFolder(target) {
  const url = await rpc('getFileLink', target, 'zip');
  downloadFrom(url);
}

function responseDownloadName(response, fallback) {
  const disposition = String(response.headers.get('Content-Disposition') || '');
  const encoded = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (encoded) {
    try { return decodeURIComponent(encoded); } catch {}
  }
  return fallback;
}

async function downloadChildrenwearFolders(targets) {
  const folders = [...new Set((targets || []).map(String).filter(Boolean))];
  if (!folders.length) throw new Error('请先选择需要下载的款式任务');
  const response = await fetch('/api/zip/childrenwear-batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folders })
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `批量下载失败：HTTP ${response.status}`);
  }
  const objectUrl = URL.createObjectURL(await response.blob());
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = responseDownloadName(response, `童装任务-${folders.length}款.zip`);
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
}

async function copyText(text) {
  const value = String(text || '');
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch {}
  }
  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  textarea.style.top = '0';
  document.body.append(textarea);
  textarea.focus();
  textarea.select();
  const copied = document.execCommand('copy');
  textarea.remove();
  if (!copied) throw new Error('浏览器拒绝复制，请手动选中文本复制');
  return true;
}

window.caishen = {
  authStatus: () => authRequest('/api/auth/status'),
  bootstrapAccount: payload => authRequest('/api/auth/bootstrap', { method: 'POST', body: JSON.stringify(payload) }),
  login: payload => authRequest('/api/auth/login', { method: 'POST', body: JSON.stringify(payload) }),
  logout: () => authRequest('/api/auth/logout', { method: 'POST' }),
  changePassword: payload => authRequest('/api/auth/password', {
    method: 'POST',
    body: JSON.stringify({ ...payload, requestId: payload?.requestId || createClientId() }),
    retryNetwork: true
  }),
  listUsers: () => authRequest('/api/auth/users'),
  createUser: payload => authRequest('/api/auth/users', { method: 'POST', body: JSON.stringify(payload) }),
  setUserActive: (id, active) => authRequest(`/api/auth/users/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ active }) }),
  updateUser: (id, payload) => authRequest(`/api/auth/users/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(payload) }),
  requireUserPasswordChange: id => authRequest(`/api/auth/users/${encodeURIComponent(id)}/require-password-change`, { method: 'POST' }),
  revealUserPassword: (id, currentPassword) => authRequest(`/api/auth/users/${encodeURIComponent(id)}/reveal-password`, { method: 'POST', body: JSON.stringify({ currentPassword }) }),
  requireAllPasswordChanges: () => authRequest('/api/auth/password-policy/require-all', { method: 'POST' }),
  deleteUser: id => authRequest(`/api/auth/users/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  getBillingSummary: (days, relayId = '') => authRequest(`/api/billing/me?days=${encodeURIComponent(Math.max(1, Math.trunc(Number(days) || 30)))}${relayId ? `&relayId=${encodeURIComponent(relayId)}` : ''}`),
  getBillingDetail: (options = {}) => {
    const query = new URLSearchParams({ range: String(options.range || 'today'), relayId: String(options.relayId || 'all'), userId: String(options.userId || '') });
    if (options.startDate) query.set('startDate', String(options.startDate));
    if (options.endDate) query.set('endDate', String(options.endDate));
    return authRequest(`/api/billing/detail?${query.toString()}`);
  },
  getBillingAdmin: () => authRequest('/api/billing/admin'),
  getAlipayConfig: () => authRequest('/api/alipay/config'),
  getAlipayRecharges: () => authRequest('/api/alipay/recharges'),
  submitAlipayRecharge: payload => authRequest('/api/alipay/recharges', { method: 'POST', body: JSON.stringify(payload) }),
  getAlipaySettings: () => authRequest('/api/alipay/settings'),
  saveAlipaySettings: payload => authRequest('/api/alipay/settings', { method: 'PUT', body: JSON.stringify(payload) }),
  uploadAlipayQr: async file => {
    const form = new FormData();
    form.append('qr', file);
    const response = await fetchWithRecovery('/api/alipay/settings/qr', { method: 'POST', body: form }, 0);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `请求失败：HTTP ${response.status}`);
    return body.data;
  },
  getAlipayReview: () => authRequest('/api/alipay/review'),
  approveAlipayRecharge: (id, actualAmountUsd) => authRequest(`/api/alipay/recharges/${encodeURIComponent(id)}/approve`, { method: 'POST', body: JSON.stringify({ actualAmountUsd }) }),
  rejectAlipayRecharge: (id, reason) => authRequest(`/api/alipay/recharges/${encodeURIComponent(id)}/reject`, { method: 'POST', body: JSON.stringify({ reason }) }),
  getBillingAccounting: (options = {}) => {
    const query = new URLSearchParams();
    query.set('range', options.range || 'month');
    if (options.relayId) query.set('relayId', options.relayId);
    if (options.startDate) query.set('startDate', options.startDate);
    if (options.endDate) query.set('endDate', options.endDate);
    return authRequest(`/api/billing/accounting?${query}`);
  },
  getGlobalStats: (range, relayId = '') => authRequest(`/api/billing/global-stats?range=${encodeURIComponent(range || 'today')}${relayId ? `&relayId=${encodeURIComponent(relayId)}` : ''}`),
  getFinanceLedger: month => authRequest(`/api/finance/ledger?month=${encodeURIComponent(month || '')}`),
  createFinanceEntry: payload => authRequest('/api/finance/entries', { method: 'POST', body: JSON.stringify(payload) }),
  updateFinanceEntry: (id, payload) => authRequest(`/api/finance/entries/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(payload) }),
  deleteFinanceEntry: id => authRequest(`/api/finance/entries/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  saveBillingRules: payload => authRequest('/api/billing/rules', { method: 'PUT', body: JSON.stringify(payload) }),
  adjustBillingBalance: payload => authRequest('/api/billing/adjust', { method: 'POST', body: JSON.stringify(payload) }),
  transferBillingBalance: payload => authRequest('/api/billing/transfer', { method: 'POST', body: JSON.stringify(payload) }),
  clearBillingLedger: () => authRequest('/api/billing/ledger', { method: 'DELETE' }),
  getRelayChoices: () => authRequest('/api/relays'),
  saveActiveRelay: activeRelayId => authRequest('/api/relays/selection', { method: 'PUT', body: JSON.stringify({ activeRelayId }) }),
  cancelJob,
  cancelActiveJobs,
  getConfig: () => rpc('getConfig'),
  getApiConcurrencySettings: () => rpc('getApiConcurrencySettings'),
  getApiSettings: () => rpc('getApiSettings'),
  saveApiSettings: payload => rpc('saveApiSettings', payload),
  testApiSettings: payload => rpc('testApiSettings', payload),
  testRelayHealth: payload => rpc('testRelayHealth', payload),
  saveConfig: config => rpc('saveConfig', config),
  resetConfig: () => rpc('resetConfig'),
  getPromptSettings: () => rpc('getPromptSettings'),
  savePromptSetting: (id, value) => rpc('savePromptSetting', id, value),
  resetPromptSetting: id => rpc('resetPromptSetting', id),
  stageAssetFolder,
  syncAssetFolder,
  syncAssetEntries,
  chooseAssetFiles,
  chooseAssetFolder,
  filesFromDrop,
  addAssetFiles,
  deleteAssetFiles,
  renameAssetFolder,
  chooseFolder: async (currentPath, key) => {
    if (key === 'outputPath') return currentPath || (await rpc('getConfig')).outputPath;
    const kind = key === 'categoriesPath' ? 'product' : key === 'printsPath' ? 'print' : 'template';
    return uploadFolder(kind);
  },
  chooseImage: async () => uploadSingle('/api/upload/image', 'image/*'),
  listImages: (root, query) => rpc('listImages', root, query),
  listImageLibrary: (root, options) => rpc('listImageLibrary', root, options || {}),
  analyzeChildrenwearAssets: (payload, onProgress) => runJob(
    'analyzeChildrenwearAssets',
    [payload],
    `childrenwear-analysis:${payload?.role || 'unknown'}:${Date.now()}:${createClientId()}`,
    onProgress
  ),
  scanPendingChildrenwearAnalysis: (payload, onProgress) => runJob(
    'scanPendingChildrenwearAnalysis',
    [payload || {}],
    `childrenwear-analysis-scan:${Date.now()}:${createClientId()}`,
    onProgress
  ),
  listTemplateFolders: () => rpc('listTemplateFolders'),
  deleteTemplateFolder: folder => rpc('deleteTemplateFolder', folder),
  generateTask: (task, onProgress) => runJob('generateTask', [task], `${task?.id || createClientId()}:${task?.runAttempt || 1}`, onProgress),
  generateTemplateMaster: (task, onProgress) => runJob('generateTemplateMaster', [task], `template-master:${task?.id || createClientId()}:${task?.masterRunAttempt || 1}`, onProgress),
  listTemplates: folder => rpc('listTemplates', folder),
  getTemplatePreparation: folder => rpc('getTemplatePreparation', folder),
  prepareTemplates: folder => runJob('prepareTemplates', [folder]),
  saveTemplateRegions: payload => rpc('saveTemplateRegions', payload),
  generateFree: payload => runJob('generateFree', [payload]),
  generateChildrenwearMaster: (payload, onProgress) => runJob(
    'generateChildrenwearMaster',
    [payload],
    `childrenwear-master:${payload?.folder || payload?.realPhotoPath || createClientId()}:${Date.now()}`,
    onProgress
  ),
  approveChildrenwearOutput: payload => rpc('approveChildrenwearOutput', payload),
  generateChildrenwearModel: (payload, onProgress) => runJob(
    'generateChildrenwearModel',
    [payload],
    `childrenwear-model:${payload?.folder || createClientId()}:${Date.now()}`,
    onProgress
  ),
  generateChildrenwearCombination: (payload, onProgress) => runJob(
    'generateChildrenwearCombination',
    [payload],
    `childrenwear-combination:${Date.now()}:${createClientId()}`,
    onProgress
  ),
  generateChildrenwearBatch: (payload, onProgress) => runJob(
    'generateChildrenwearBatch',
    [payload],
    `childrenwear-batch:${payload?.stage || 'unknown'}:${Date.now()}:${createClientId()}`,
    onProgress
  ),
  listChildrenwearTasks: () => rpc('listChildrenwearTasks'),
  renameChildrenwearTask: payload => rpc('renameChildrenwearTask', payload),
  deleteChildrenwearTasks: folders => rpc('deleteChildrenwearTasks', folders),
  listReviews: () => rpc('listReviews'),
  approveReview: folder => rpc('approveReview', folder),
  setReviewStatus: payload => rpc('setReviewStatus', payload),
  generateTemplates: (payload, onProgress) => runJob('generateTemplates', [payload], `review-generation:${Date.now()}:${createClientId()}`, onProgress),
  regenerateTemplate: (payload, onProgress) => runJob('regenerateTemplate', [payload], `regenerate-template:${payload?.folder || ''}:${payload?.relativePath || ''}:${Date.now()}`, onProgress),
  batchApproveReviews: folders => rpc('batchApproveReviews', folders),
  deleteReviews: folders => rpc('deleteReviews', folders),
  revealFile: file => openWorkspacePath(file, 'file'),
  openFolder: folder => openWorkspacePath(folder, 'folder'),
  downloadFolder: folder => downloadWorkspaceFolder(folder),
  downloadFolders: folders => downloadChildrenwearFolders(folders),
  copyText
};
