import { DEFAULT_PUBLISH_URL, STATUS, apiFetch, ensureToken, readOptions, refreshToken, writeOptions } from './shared.js';

let activeTask = null;
let activeTabId = 0;
let activeFrameId = 0;
let activeTaskDispatched = false;
let lastFrameCandidates = [];
let pollTimer = 0;
let debuggerTabId = 0;
const uploadDownloadPath = 'C:\\Users\\Public\\Downloads\\caishen-taobao-upload-cache';

chrome.runtime.onInstalled.addListener(async () => {
  const options = await writeOptions({});
  refreshToken().catch(error => setLastError(error));
  schedulePoll(options);
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'poll-taobao-publish') pollOnce().catch(error => setLastError(error));
});

chrome.tabs.onRemoved.addListener(tabId => {
  if (tabId === activeTabId) {
    clearActiveTask('淘宝发布页已关闭，任务未完成').catch(error => setLastError(error));
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (tabId === activeTabId && changeInfo.status === 'complete') {
    trySendTaskToActiveTab().catch(error => setLastError(error));
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch(error => sendResponse({ ok: false, error: error.message }));
  return true;
});

async function setLastError(error) {
  await chrome.storage.local.set({ lastError: error?.message || String(error), lastErrorAt: new Date().toISOString() });
}

async function clearLastError() {
  await chrome.storage.local.remove(['lastError', 'lastErrorAt']);
}

async function detachDebugger() {
  if (!debuggerTabId) return;
  const tabId = debuggerTabId;
  debuggerTabId = 0;
  await chrome.debugger.detach({ tabId }).catch(() => {});
}

async function ensureDebuggerAttached(tabId) {
  if (debuggerTabId === tabId) return;
  await detachDebugger();
  await chrome.debugger.attach({ tabId }, '1.3');
  debuggerTabId = tabId;
}

async function allowPageDownloads(tabId) {
  const target = { tabId };
  await ensureDebuggerAttached(tabId);
  await chrome.debugger.sendCommand(target, 'Page.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: uploadDownloadPath
  }).catch(() => {});
  await chrome.debugger.sendCommand(target, 'Browser.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: uploadDownloadPath,
    eventsEnabled: true
  }).catch(() => {});
}

function schedulePoll(options) {
  clearTimeout(pollTimer);
  chrome.alarms.create('poll-taobao-publish', { periodInMinutes: 1 });
  if (!options?.enabled) return;
  pollTimer = setTimeout(async () => {
    try {
      await pollOnce();
    } catch (error) {
      await setLastError(error);
    } finally {
      schedulePoll(await readOptions());
    }
  }, Math.max(30000, options.pollSeconds * 1000));
}

async function updateStatus(taskId, status, detail = {}) {
  const options = await ensureToken();
  if (!taskId || !options.token) return;
  await apiFetch(`/api/taobao/publish/tasks/${encodeURIComponent(taskId)}/status`, {
    method: 'POST',
    body: JSON.stringify({ token: options.token, status, ...detail })
  });
}

async function clearActiveTask(reason = '') {
  const taskId = activeTask?.id;
  await detachDebugger();
  activeTask = null;
  activeTabId = 0;
  activeFrameId = 0;
  activeTaskDispatched = false;
  lastFrameCandidates = [];
  if (taskId && reason) {
    await updateStatus(taskId, STATUS.failed, {
      failureReason: reason,
      detail: { step: 'tab-closed', closedAt: new Date().toISOString() }
    });
  }
}

async function blobToDataUrl(blob) {
  const buffer = await blob.arrayBuffer();
  let binary = '';
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
  return `data:${blob.type || 'image/jpeg'};base64,${btoa(binary)}`;
}

async function fetchTaskImage(message = {}) {
  const options = await ensureToken();
  if (!options.token) throw new Error('插件连接令牌未配置');
  const taskId = encodeURIComponent(String(message.taskId || activeTask?.id || ''));
  const group = encodeURIComponent(String(message.group || 'main'));
  const index = Math.max(0, Math.trunc(Number(message.index) || 0));
  if (!taskId) throw new Error('缺少发布任务 ID');
  const url = `${options.baseUrl}/api/taobao/publish/tasks/${taskId}/images/${group}/${index}?token=${encodeURIComponent(options.token)}`;
  const response = await fetch(url);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `图片下载失败 HTTP ${response.status}`);
  }
  const blob = await response.blob();
  return {
    dataUrl: await blobToDataUrl(blob),
    type: blob.type || 'image/jpeg',
    name: String(message.name || `image-${group}-${index}.jpg`)
  };
}

async function dispatchTrustedClick(message, sender) {
  const tabId = sender.tab?.id;
  const x = Number(message.x);
  const y = Number(message.y);
  if (!tabId || !Number.isFinite(x) || !Number.isFinite(y)) {
    throw new Error('Invalid trusted click target');
  }
  const target = { tabId };
  await ensureDebuggerAttached(tabId);
  await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x,
    y
  });
  await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x,
    y,
    button: 'left',
    buttons: 1,
    clickCount: 1
  });
  await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x,
    y,
    button: 'left',
    buttons: 0,
    clickCount: 1
  });
  return { ok: true };
}

function safeDownloadSegment(value, fallback = 'image') {
  const normalized = String(value || '')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized || fallback;
}

async function waitForDownload(downloadId, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const [item] = await chrome.downloads.search({ id: downloadId });
    if (item?.state === 'complete' && item.filename) return item.filename;
    if (item?.state === 'interrupted') throw new Error(item.error || '图片下载中断');
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error('等待淘宝上传图片下载超时');
}

function waitForPageDownload(tabId, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const downloads = new Map();
    const timer = setTimeout(() => {
      chrome.debugger.onEvent.removeListener(onEvent);
      reject(new Error('等待页面下载图片超时'));
    }, timeoutMs);
    function onEvent(source, method, params) {
      if (source.tabId !== tabId) return;
      if (method === 'Browser.downloadWillBegin') {
        downloads.set(params.guid, params.suggestedFilename || '');
      }
      if (method !== 'Browser.downloadProgress') return;
      if (params.state === 'completed') {
        clearTimeout(timer);
        chrome.debugger.onEvent.removeListener(onEvent);
        resolve(downloads.get(params.guid) || params.guid || '');
      }
      if (params.state === 'canceled') {
        clearTimeout(timer);
        chrome.debugger.onEvent.removeListener(onEvent);
        reject(new Error('页面下载图片已取消'));
      }
    }
    chrome.debugger.onEvent.addListener(onEvent);
  });
}

async function downloadDataUrlInPage(tabId, dataUrl, fileName) {
  await allowPageDownloads(tabId);
  const downloadPromise = waitForPageDownload(tabId);
  await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
    awaitPromise: true,
    expression: `(() => {
      const dataUrl = ${JSON.stringify(dataUrl)};
      const fileName = ${JSON.stringify(fileName)};
      const anchor = document.createElement('a');
      anchor.href = dataUrl;
      anchor.download = fileName;
      anchor.style.display = 'none';
      document.documentElement.appendChild(anchor);
      anchor.click();
      setTimeout(() => anchor.remove(), 1000);
      return true;
    })()`
  });
  const suggested = await downloadPromise;
  return `${uploadDownloadPath}\\${suggested || fileName}`;
}

async function downloadUploadFile(message, image, index, tabId) {
  const cachedFileName = safeDownloadSegment(`${safeDownloadSegment(message.taskId, 'task')}-${safeDownloadSegment(message.group, 'images')}-${index + 1}-${image.name || `image-${index + 1}.jpg`}`, `image-${index + 1}.jpg`);
  if (message.useCachedUploadFiles) return `${uploadDownloadPath}\\${cachedFileName}`;
  const response = await fetchTaskImage({
    taskId: message.taskId,
    group: image._group || message.group,
    index: Number.isInteger(image._index) ? image._index : index,
    name: image.name
  });
  const taskFolder = safeDownloadSegment(message.taskId, 'task');
  const groupFolder = safeDownloadSegment(message.group, 'images');
  const fileName = safeDownloadSegment(`${taskFolder}-${groupFolder}-${index + 1}-${response.name}`, `image-${index + 1}.jpg`);
  return downloadDataUrlInPage(tabId, response.dataUrl, fileName);
}

function waitForFileChooser(tabId, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.debugger.onEvent.removeListener(onEvent);
      reject(new Error('点击上传图片后未出现文件选择器'));
    }, timeoutMs);
    function onEvent(source, method, params) {
      if (source.tabId !== tabId || method !== 'Page.fileChooserOpened') return;
      clearTimeout(timer);
      chrome.debugger.onEvent.removeListener(onEvent);
      resolve(params || {});
    }
    chrome.debugger.onEvent.addListener(onEvent);
  });
}

async function clickPickerUploadEntryInFrames(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: () => {
      const text = value => String(value || '').trim().replace(/\s+/g, '');
      const visible = element => {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      const disabled = element => Boolean(element.disabled)
        || element.getAttribute('aria-disabled') === 'true'
        || element.classList.contains('disabled')
        || /disabled/i.test(String(element.className || ''));
      const wanted = ['本地上传', '上传本地图片', '点击上传'];
      const candidates = [...document.querySelectorAll('button, [role="button"], a, label, div, span')]
        .filter(visible)
        .filter(element => {
          const label = text(element.innerText || element.textContent || element.getAttribute('aria-label') || element.title);
          return wanted.some(item => label === item || label.includes(item));
        })
        .map(element => {
          const label = text(element.innerText || element.textContent || element.getAttribute('aria-label') || element.title);
          const target = element.closest('button, [role="button"], label, a') || element;
          const localUpload = label === '本地上传' || label.includes('上传本地图片');
          const upload = label === '点击上传';
          return { target, label, score: (localUpload ? 100 : 0) + (upload ? 20 : 0) };
        })
        .filter(item => !disabled(item.target))
        .sort((left, right) => {
          const leftRect = left.target.getBoundingClientRect();
          const rightRect = right.target.getBoundingClientRect();
          return right.score - left.score || (leftRect.width * leftRect.height) - (rightRect.width * rightRect.height);
        });
      const candidate = candidates[0];
      if (!candidate) return { clicked: false };
      candidate.target.scrollIntoView?.({ block: 'center', inline: 'center' });
      candidate.target.focus?.();
      for (const type of ['pointerdown', 'mousedown', 'mouseup']) {
        candidate.target.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
      }
      candidate.target.click?.();
      return { clicked: true, label: candidate.label, title: document.title, href: location.href };
    }
  });
  return results.find(item => item.result?.clicked)?.result || { clicked: false };
}

async function uploadFilesThroughChooser(message, sender) {
  const tabId = sender.tab?.id;
  const images = Array.isArray(message.images) ? message.images : [];
  if (!tabId || !images.length) throw new Error('缺少淘宝上传目标或图片');
  let uploadStage = 'download';
  const target = { tabId };
  const files = [];
  try {
    await allowPageDownloads(tabId);
    for (let index = 0; index < images.length; index += 1) {
      files.push(await downloadUploadFile(message, images[index], index, tabId));
    }
    uploadStage = 'file-chooser';
    await ensureDebuggerAttached(tabId);
    await chrome.debugger.sendCommand(target, 'Page.setInterceptFileChooserDialog', { enabled: true });
    const chooserPromise = waitForFileChooser(tabId);
    await dispatchTrustedClick(message, sender);
    let chooser;
    try {
      chooser = await chooserPromise;
    } catch (firstError) {
      const fallbackPromise = waitForFileChooser(tabId);
      const pickerClick = await clickPickerUploadEntryInFrames(tabId);
      if (!pickerClick.clicked) throw firstError;
      chooser = await fallbackPromise;
    }
    if (!chooser.backendNodeId) throw new Error('淘宝文件选择器缺少上传节点');
    uploadStage = 'set-files';
    await chrome.debugger.sendCommand(target, 'DOM.setFileInputFiles', {
      files,
      backendNodeId: chooser.backendNodeId
    });
    return { ok: true, files: files.length, mode: chooser.mode || '' };
  } catch (error) {
    const stage = uploadStage;
    const message = error?.message || String(error);
    throw new Error(`${stage}: ${message}`);
  } finally {
    await chrome.debugger.sendCommand(target, 'Page.setInterceptFileChooserDialog', { enabled: false }).catch(() => {});
  }
}

async function claimTask() {
  const options = await ensureToken();
  if (!options.enabled || !options.token) return null;
  return apiFetch('/api/taobao/publish/claim', {
    method: 'POST',
    body: JSON.stringify({ token: options.token, extensionId: chrome.runtime.id })
  });
}

async function findExistingPublishTab() {
  const tabs = await chrome.tabs.query({ url: 'https://item.upload.taobao.com/*' });
  return tabs.find(item => /\/sell\/ai\/category\.htm/i.test(item.url || '')) || null;
}

async function openPublishTab(task) {
  const options = await readOptions();
  const publishUrl = task?.category?.defaults?.publishUrl || DEFAULT_PUBLISH_URL;
  await updateStatus(task.id, STATUS.opening);
  const existingTab = await findExistingPublishTab();
  const tab = existingTab
    ? await chrome.tabs.update(existingTab.id, { url: publishUrl, active: true })
    : await chrome.tabs.create({ url: publishUrl, active: true });
  if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
  activeTabId = tab.id;
  activeTask = { ...task, caishenBaseUrl: options.baseUrl };
  setTimeout(() => trySendTaskToActiveTab().catch(error => setLastError(error)), 2000);
}

function publishFrameProbe() {
  const bodyText = String(document.body?.innerText || document.body?.textContent || '');
  const fieldText = [...document.querySelectorAll('input, textarea, [contenteditable="true"], select, button, [role="button"]')]
    .slice(0, 120)
    .map(element => [
      element.placeholder,
      element.getAttribute('aria-label'),
      element.name,
      element.id,
      element.innerText,
      element.textContent
    ].filter(Boolean).join(' '))
    .join('\n');
  const combined = `${bodyText}\n${fieldText}`;
  const hasFileInputs = document.querySelectorAll('input[type="file"]').length > 0;
  const hasTitleField = /标题|宝贝标题|商品标题/.test(combined);
  const hasSaveDraft = /保存草稿|存草稿|保存/.test(combined);
  const hasCategorySearch = /搜索发品|类目关键词|产品名称|条码信息/.test(combined);
  const isTaobaoUpload = /item\.upload\.taobao\.com/i.test(location.href);
  const isCategoryEntry = /\/sell\/ai\/category\.htm/i.test(location.href) || /category\.htm/i.test(location.href);
  const score = [
    isTaobaoUpload ? 10 : 0,
    isCategoryEntry ? 30 : 0,
    hasCategorySearch ? 25 : 0,
    hasTitleField ? 45 : 0,
    hasFileInputs ? 45 : 0,
    hasSaveDraft ? 20 : 0
  ].reduce((sum, value) => sum + value, 0);
  return {
    href: location.href,
    title: document.title,
    hasFileInputs,
    hasTitleField,
    hasSaveDraft,
    hasCategorySearch,
    isCategoryEntry,
    score
  };
}

async function findPublishFrame(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: publishFrameProbe
  });
  const frames = (results || [])
    .map(result => ({ frameId: result.frameId || 0, ...(result.result || {}) }))
    .filter(frame => frame.score > 0)
    .sort((left, right) => right.score - left.score);
  lastFrameCandidates = frames.slice(0, 8);
  return frames[0] || { frameId: 0, score: 0 };
}

async function sendTaskToTab(tabId, task) {
  if (activeTaskDispatched) return;
  await ensureDebuggerAttached(tabId);
  await new Promise(resolve => setTimeout(resolve, 300));
  const frame = await findPublishFrame(tabId).catch(() => ({ frameId: 0, score: 0 }));
  activeFrameId = frame.frameId || 0;
  await updateStatus(task.id, STATUS.opening, {
    detail: {
      step: 'frame-selected',
      frameId: activeFrameId,
      frame: {
        href: frame.href || '',
        title: frame.title || '',
        score: frame.score || 0,
        hasFileInputs: Boolean(frame.hasFileInputs),
        hasTitleField: Boolean(frame.hasTitleField),
        hasSaveDraft: Boolean(frame.hasSaveDraft),
        hasCategorySearch: Boolean(frame.hasCategorySearch),
        isCategoryEntry: Boolean(frame.isCategoryEntry)
      },
      frameCandidates: lastFrameCandidates
    }
  });
  activeTaskDispatched = true;
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'CAISHEN_TAOBAO_START', task }, { frameId: activeFrameId });
  } catch (error) {
    activeTaskDispatched = false;
    throw error;
  }
}

async function injectContentScript(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files: ['src/content.js']
  });
}

async function trySendTaskToActiveTab() {
  if (!activeTask || !activeTabId || activeTaskDispatched) return false;
  try {
    await sendTaskToTab(activeTabId, activeTask);
    return true;
  } catch (error) {
    if (/Receiving end does not exist|Could not establish connection/i.test(error?.message || '')) {
      await injectContentScript(activeTabId);
      await sendTaskToTab(activeTabId, activeTask);
      return true;
    }
    throw error;
  }
}

async function pollOnce() {
  if (activeTask) return { ok: true, active: true };
  const task = await claimTask();
  await clearLastError();
  if (!task) return { ok: true, claimed: false };
  await openPublishTab(task);
  return { ok: true, claimed: true, taskId: task.id };
}

async function collectActiveTaobaoDiagnostics() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const tab = tabs.find(item => /item\.upload\.taobao\.com/i.test(item.url || '')) || tabs[0];
  if (!tab?.id || !/item\.upload\.taobao\.com/i.test(tab.url || '')) {
    throw new Error('请先切换到淘宝商品发布页面');
  }
  return chrome.tabs.sendMessage(tab.id, { type: 'CAISHEN_TAOBAO_COLLECT_DIAGNOSTICS' });
}

async function handleMessage(message, sender) {
  if (message?.type === 'CAISHEN_TAOBAO_POPUP_GET') {
    return { ok: true, options: await readOptions(), activeTask, activeTabId, activeFrameId, frameCandidates: lastFrameCandidates, ...(await chrome.storage.local.get(['lastError', 'lastErrorAt'])) };
  }
  if (message?.type === 'CAISHEN_TAOBAO_POPUP_REFRESH_TOKEN') {
    const options = await refreshToken();
    await clearLastError();
    return { ok: true, options };
  }
  if (message?.type === 'CAISHEN_TAOBAO_POPUP_SAVE') {
    const options = await writeOptions(message.options || {});
    if (options.token) await clearLastError();
    schedulePoll(options);
    if (options.enabled) pollOnce().catch(error => setLastError(error));
    return { ok: true, options };
  }
  if (message?.type === 'CAISHEN_TAOBAO_POPUP_POLL') return pollOnce();
  if (message?.type === 'CAISHEN_TAOBAO_POPUP_DIAGNOSTICS') return collectActiveTaobaoDiagnostics();
  if (message?.type === 'CAISHEN_TAOBAO_TRIGGER_POLL') return pollOnce();
  if (message?.type === 'CAISHEN_TAOBAO_FETCH_IMAGE') return { ok: true, image: await fetchTaskImage(message) };
  if (message?.type === 'CAISHEN_TAOBAO_TRUSTED_CLICK') return dispatchTrustedClick(message, sender);
  if (message?.type === 'CAISHEN_TAOBAO_UPLOAD_FILES') return uploadFilesThroughChooser(message, sender);
  if (message?.type === 'CAISHEN_TAOBAO_CONTENT_READY') {
    if (activeTask && sender.tab?.id === activeTabId && !activeTaskDispatched) await trySendTaskToActiveTab();
    return { ok: true };
  }
  if (message?.type === 'CAISHEN_TAOBAO_STATUS') {
    await updateStatus(message.taskId || activeTask?.id, message.status, message.detail || {});
    await clearLastError();
    if ([STATUS.saved, STATUS.failed].includes(message.status)) {
      await clearActiveTask();
    }
    return { ok: true };
  }
  return { ok: false, error: 'unknown message' };
}
