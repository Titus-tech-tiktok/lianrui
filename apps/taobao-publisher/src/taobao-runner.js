const fs = require('node:fs/promises');
const path = require('node:path');

const DEFAULT_PUBLISH_URL = 'https://item.upload.taobao.com/sell/ai/category.htm';
const DEFAULT_STORE_CHECK_URL = 'https://myseller.taobao.com/';
const DEFAULT_SAVE_DRAFT_SELECTORS = [
  'button[data-testid="save-draft"]',
  'button[aria-label*="保存草稿"]',
  '.save-draft',
  '#saveDraft'
];

function safePartitionSegment(value) {
  return String(value || 'default').replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80) || 'default';
}

function storePartition(storeId) {
  return `persist:taobao-store-${safePartitionSegment(storeId)}`;
}

function normalizeTemplate(category = {}) {
  const defaults = category.defaults || {};
  return {
    publishUrl: defaults.publishUrl || DEFAULT_PUBLISH_URL,
    categoryKeyword: defaults.categoryKeyword || category.name || '',
    brandName: defaults.brandName || '其他家',
    modelName: defaults.modelName || '其他',
    titleRule: defaults.titleRule || '',
    price: defaults.price || '',
    stock: defaults.stock || '',
    shipFrom: defaults.shipFrom || '',
    freightTemplate: defaults.freightTemplate || '',
    serviceTemplate: defaults.serviceTemplate || '',
    attributes: defaults.attributes || {},
    customFields: Array.isArray(defaults.customFields) ? defaults.customFields : [],
    selectors: defaults.selectors || {},
    categoryPath: Array.isArray(defaults.categoryPath) ? defaults.categoryPath : [],
    saveDraftSelectors: defaults.saveDraftSelectors || DEFAULT_SAVE_DRAFT_SELECTORS
  };
}

function buildAdapterPayload({ task, store, storeId }) {
  const template = normalizeTemplate(task.category || {});
  return {
    taskId: task.id || '',
    title: task.title || task.name || '',
    categoryId: task.categoryId || task.category?.id || '',
    storeId,
    expectedStoreName: store.name || task.storeName || '',
    template,
    images: flattenTaskImages(task.images || task.assets?.images || [])
  };
}

function flattenTaskImages(images = []) {
  if (Array.isArray(images)) return images.map(image => ({ ...image, group: image.group || image.type || '' }));
  return ['mainImages', 'ratioImages', 'detailImages'].flatMap(group =>
    (Array.isArray(images[group]) ? images[group] : []).map(image => ({ ...image, group }))
  );
}

function normalizeImageGroup(value = '') {
  const group = String(value || '').trim();
  if (group === 'main') return 'mainImages';
  if (group === 'ratio' || group === 'ratioImage' || group === '3:4' || group === '3-4') return 'ratioImages';
  if (group === 'detail' || group === 'detailImage') return 'detailImages';
  return group;
}

function validateImagePackage(images = []) {
  const checks = [
    ['mainImages', '主图'],
    ['ratioImages', '3:4 图'],
    ['detailImages', '详情图']
  ];
  const missing = checks
    .filter(([group]) => !images.some(image => normalizeImageGroup(image.group) === group))
    .map(([, label]) => label);
  return { ok: missing.length === 0, missing };
}

function imageSourceLabel(image = {}) {
  return image.name || image.relativePath || normalizeImageGroup(image.group) || 'image';
}

function validateImageSources(images = []) {
  const missing = images
    .filter(image => !String(image.outputPath || image.localPath || image.url || image.outputUrl || '').trim())
    .map(imageSourceLabel);
  return { ok: missing.length === 0, missing };
}

async function validateLocalImageFiles(images = []) {
  const missing = [];
  for (const image of images) {
    const localPath = String(image.outputPath || image.localPath || '').trim();
    const fallbackUrl = String(image.url || image.outputUrl || '').trim();
    if (!localPath || fallbackUrl) continue;
    try {
      await fs.access(localPath);
    } catch {
      missing.push({
        label: imageSourceLabel(image),
        path: localPath
      });
    }
  }
  return { ok: missing.length === 0, missing };
}

function extensionFromContentType(contentType = '') {
  if (contentType.includes('png')) return '.png';
  if (contentType.includes('webp')) return '.webp';
  if (contentType.includes('gif')) return '.gif';
  return '.jpg';
}

async function defaultFetchBinary(url) {
  if (typeof fetch !== 'function') throw new Error('Current runtime cannot download remote images');
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Image download failed: ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  return { buffer, contentType: response.headers.get('content-type') || '' };
}

async function prepareUploadImages({ app, storeId, taskId, images = [], fetchBinary = defaultFetchBinary }) {
  const prepared = [];
  const cacheDir = path.join(app.getPath('userData'), 'taobao-upload-images', safePartitionSegment(storeId), safePartitionSegment(taskId));
  await fs.mkdir(cacheDir, { recursive: true });
  for (const [index, image] of images.entries()) {
    const outputPath = String(image.outputPath || image.localPath || '').trim();
    if (outputPath) {
      try {
        await fs.access(outputPath);
        prepared.push({ ...image, localPath: outputPath });
        continue;
      } catch {}
    }
    const url = String(image.url || image.outputUrl || '').trim();
    if (!url) {
      prepared.push({ ...image, localPath: '', downloadError: 'Missing image URL or local path' });
      continue;
    }
    try {
      const downloaded = await fetchBinary(url);
      const file = path.join(cacheDir, `${String(index + 1).padStart(2, '0')}-${safePartitionSegment(image.group || 'image')}${extensionFromContentType(downloaded.contentType || '')}`);
      await fs.writeFile(file, downloaded.buffer);
      prepared.push({ ...image, localPath: file });
    } catch (error) {
      prepared.push({
        ...image,
        localPath: '',
        downloadError: error?.message || String(error || 'Image download failed')
      });
    }
  }
  return prepared;
}

async function setFileInputFiles(webContents, expression, files = []) {
  if (!files.length) return { ok: true, files, skipped: true };
  const protocol = webContents?.debugger;
  const evaluated = await protocol.sendCommand('Runtime.evaluate', {
    expression,
    objectGroup: 'caishen-taobao-upload',
    returnByValue: false
  });
  const objectId = evaluated?.result?.objectId;
  if (!objectId) return { ok: false, files, reason: 'No visible file input found' };
  const requested = await protocol.sendCommand('DOM.requestNode', { objectId });
  const nodeId = requested?.nodeId;
  if (!nodeId) return { ok: false, files, reason: 'Unable to resolve file input node' };
  await protocol.sendCommand('DOM.setFileInputFiles', { nodeId, files });
  return { ok: true, files, nodeId };
}

function visibleFileInputExpression(selector = '') {
  const safeSelector = JSON.stringify(String(selector || ''));
  if (selector) {
    return `
      (() => {
        const node = document.querySelector(${safeSelector});
        if (!node || node.disabled) return null;
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 ? node : null;
      })()
    `;
  }
  return `
    Array.from(document.querySelectorAll('input[type="file"]'))
      .find(input => {
        const rect = input.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && !input.disabled;
      })
  `;
}

async function uploadPreparedFilesWithDebugger(webContents, images = [], selectors = {}) {
  const files = images.map(image => String(image.localPath || '').trim()).filter(Boolean);
  if (!files.length) return { ok: true, files: [], skipped: true };
  const protocol = webContents?.debugger;
  if (!protocol?.sendCommand) return { ok: false, files, reason: 'Electron debugger API is unavailable' };
  if (!protocol.isAttached?.()) await protocol.attach('1.3');
  const groupSelectors = [
    ['mainImages', selectors.mainImages],
    ['ratioImages', selectors.ratioImages],
    ['detailImages', selectors.detailImages]
  ].filter(([, selector]) => String(selector || '').trim());
  if (groupSelectors.length) {
    const uploads = [];
    for (const [group, selector] of groupSelectors) {
      const groupFiles = images
        .filter(image => image.group === group)
        .map(image => String(image.localPath || '').trim())
        .filter(Boolean);
      if (!groupFiles.length) continue;
      uploads.push(await setFileInputFiles(webContents, visibleFileInputExpression(selector), groupFiles));
    }
    const failed = uploads.find(item => !item.ok);
    return {
      ok: !failed,
      files,
      grouped: true,
      uploads,
      reason: failed?.reason || ''
    };
  }
  return setFileInputFiles(webContents, visibleFileInputExpression(), files);
}

function validateTemplate(template = {}) {
  const required = ['brandName', 'modelName', 'price', 'stock'];
  const missing = required.filter(field => !String(template[field] || '').trim());
  const requiredSelectors = ['title', 'price', 'stock', 'mainImages', 'ratioImages', 'detailImages', 'saveDraft'];
  const selectors = template.selectors || {};
  const missingSelectors = requiredSelectors.filter(field => !String(selectors[field] || '').trim());
  return { ok: missing.length === 0 && missingSelectors.length === 0, missing, missingSelectors };
}

function taobaoPageAdapter(payload) {
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const textSelector = 'input,textarea,[contenteditable="true"]';
  const manualSignals = ['验证码', '滑块', '二次验证', '二次确认', '风险', '风控', '安全验证', '登录', '扫码'];
  const visible = node => {
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const findByLabels = labels => {
    const normalized = labels.map(label => String(label).toLowerCase());
    return Array.from(document.querySelectorAll(textSelector)).find(control => {
      if (!visible(control)) return false;
      const aria = control.getAttribute('aria-label') || '';
      const placeholder = control.getAttribute('placeholder') || '';
      const name = control.getAttribute('name') || '';
      const id = control.id || '';
      const text = `${aria} ${placeholder} ${name} ${id}`.toLowerCase();
      return normalized.some(label => text.includes(label.toLowerCase()));
    });
  };
  const findBySelector = selector => {
    if (!selector) return null;
    const control = document.querySelector(selector);
    return control && visible(control) ? control : null;
  };
  const setValue = (control, value) => {
    if (!control || value === undefined || value === null || value === '') return false;
    if (String(control.tagName || '').toLowerCase() === 'select') {
      const wanted = String(value).trim();
      const options = Array.from(control.options || []);
      const option = options.find(item => String(item.value || '').trim() === wanted)
        || options.find(item => String(item.textContent || '').trim() === wanted)
        || options.find(item => String(item.textContent || '').includes(wanted));
      if (!option) return false;
      control.value = option.value;
      control.dispatchEvent(new Event('input', { bubbles: true }));
      control.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    const tagName = String(control.tagName || '').toLowerCase();
    const textLike = control.matches
      ? control.matches('input,textarea,[contenteditable="true"]')
      : (!tagName || tagName === 'input' || tagName === 'textarea' || control.isContentEditable);
    if (!textLike) {
      const wanted = String(value).trim();
      control.click();
      const option = Array.from(document.querySelectorAll('[role="option"],li,div,span,button,a'))
        .find(node => visible(node) && (node.innerText || node.textContent || '').trim().includes(wanted));
      if (!option) return false;
      option.click();
      return true;
    }
    if (control.isContentEditable) {
      control.textContent = String(value);
    } else {
      control.value = String(value);
    }
    control.dispatchEvent(new Event('input', { bubbles: true }));
    control.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  };
  const fillTextByLabels = entries => entries.map(entry => ({
    field: entry.field,
    filled: setValue(findBySelector(entry.selector) || findByLabels(entry.labels), entry.value)
  }));
  const uploadImageFiles = images => {
    const inputs = Array.from(document.querySelectorAll('input[type="file"]')).filter(visible);
    const readyImages = images.filter(image => image.localPath);
    inputs.forEach((input, index) => {
      input.dataset.caishenUploadPath = readyImages[index]?.localPath || '';
    });
    return {
      ready: readyImages.length,
      fileInputs: inputs.length,
      localPaths: readyImages.map(image => image.localPath)
    };
  };
  const detectManualIntervention = () => {
    const bodyText = document.body?.innerText || '';
    const signal = manualSignals.find(item => bodyText.includes(item));
    return signal ? { needsManualIntervention: true, reason: `检测到${signal}` } : { needsManualIntervention: false, reason: '' };
  };
  const clickableText = text => Array.from(document.querySelectorAll('button,a,[role="button"]'))
    .find(node => visible(node) && (node.innerText || node.textContent || '').trim().includes(text));
  const clickFirstSelector = selectors => {
    for (const selector of selectors) {
      const node = document.querySelector(selector);
      if (node && visible(node)) {
        node.click();
        return selector;
      }
    }
    const textButton = clickableText('保存草稿') || clickableText('保存');
    if (textButton) {
      textButton.click();
      return 'text:保存草稿';
    }
    return '';
  };
  const readTextBySelector = selector => {
    const node = findBySelector(selector);
    return node ? String(node.innerText || node.textContent || node.value || '').trim() : '';
  };
  const template = payload.template || {};
  const selectors = template.selectors || {};
  const currentStoreName = readTextBySelector(selectors.storeName);
  const manualCheck = detectManualIntervention();
  if (manualCheck.needsManualIntervention) {
    return {
      ok: false,
      ...manualCheck,
      stages: ['打开淘宝发布页']
    };
  }
  const attributeFields = Object.entries(template.attributes || {}).map(([name, value]) => ({
    field: `attribute.${name}`,
    labels: [name],
    selector: selectors[`attribute.${name}`],
    value
  }));
  const customFields = (Array.isArray(template.customFields) ? template.customFields : []).map((item, index) => ({
    field: item.label || item.name || `customField.${index + 1}`,
    labels: [item.label, item.name, item.field].filter(Boolean),
    selector: item.selector,
    value: item.value
  }));
  const filledFields = fillTextByLabels([
    { field: 'title', labels: ['title', '标题', '商品标题'], selector: selectors.title, value: payload.title },
    { field: 'categorySearch', labels: ['搜索发品', '类目关键词', '产品名称', '搜索'], selector: selectors.categorySearch, value: template.categoryKeyword },
    { field: 'brandName', labels: ['brand', '品牌'], selector: selectors.brandName, value: template.brandName },
    { field: 'modelName', labels: ['model', '型号'], selector: selectors.modelName, value: template.modelName },
    { field: 'price', labels: ['price', '价格', '一口价'], selector: selectors.price, value: template.price },
    { field: 'stock', labels: ['stock', '库存', '数量'], selector: selectors.stock, value: template.stock },
    { field: 'shipFrom', labels: ['ship', '发货地'], selector: selectors.shipFrom, value: template.shipFrom },
    { field: 'freightTemplate', labels: ['freight', '运费'], selector: selectors.freightTemplate, value: template.freightTemplate },
    { field: 'serviceTemplate', labels: ['service', '服务'], selector: selectors.serviceTemplate, value: template.serviceTemplate },
    ...attributeFields,
    ...customFields
  ]);
  [selectors.categorySearchButton, selectors.categoryResult].filter(Boolean).forEach(selector => {
    const button = findBySelector(selector);
    if (button) button.click();
  });
  const missingRequired = filledFields
    .filter(item => ['title', 'brandName', 'modelName', 'price', 'stock'].includes(item.field) && !item.filled)
    .map(item => item.field);
  const uploadedImages = uploadImageFiles(payload.images || []);
  const fileInputs = uploadedImages.fileInputs;
  const saveDraftSelectors = [selectors.saveDraft, ...(template.saveDraftSelectors || [])].filter(Boolean);
  const clickedSave = clickFirstSelector(saveDraftSelectors);

  return wait(200).then(() => ({
    ok: Boolean(clickedSave) && missingRequired.length === 0,
    stages: ['打开淘宝发布页', '填写类目模板', '上传图片', '保存草稿'],
    filledFields,
    uploadedImages,
    fileInputs,
    clickedSave,
    missingRequired,
    saveDraftSelectors,
    currentStoreName
  }));
}

function taobaoLoginCheckAdapter() {
  const text = document.body?.innerText || '';
  const detectStoreName = source => {
    const lines = String(source || '').split(/\n+/)
      .map(line => line.trim().replace(/\s+/g, ' '))
      .filter(Boolean);
    const noisy = ['登录', '扫码', '验证码', '卖家中心', '商品管理', '交易管理', '宝贝管理'];
    return lines.find(line => {
      if (line.length > 40) return false;
      if (!/(旗舰店|专卖店|专营店|企业店|工厂店|淘宝店|店铺)/.test(line)) return false;
      return !noisy.some(word => line.includes(word));
    })?.replace(/^店铺[:：\s]*/, '') || '';
  };
  return {
    text,
    storeName: detectStoreName(text),
    url: location.href
  };
}

function activeElementSelectorAdapter() {
  const node = document.activeElement;
  const escapeCss = value => {
    if (globalThis.CSS?.escape) return CSS.escape(String(value));
    return String(value).replace(/["\\#.:,[\]>+~*]/g, '\\$&');
  };
  if (!node || node === document.body) {
    return { ok: false, reason: '当前淘宝页面没有选中的输入控件' };
  }
  const tagName = String(node.tagName || '').toLowerCase();
  const id = String(node.id || '').trim();
  if (id) {
    return {
      ok: true,
      selector: `#${escapeCss(id)}`,
      tagName,
      label: String(node.getAttribute?.('placeholder') || node.getAttribute?.('aria-label') || node.getAttribute?.('name') || '').trim()
    };
  }
  const stableAttributes = ['data-testid', 'data-spm', 'name', 'aria-label', 'placeholder'];
  for (const attribute of stableAttributes) {
    const value = String(node.getAttribute?.(attribute) || '').trim();
    if (value) {
      return {
        ok: true,
        selector: `${tagName || '*'}[${attribute}="${escapeCss(value)}"]`,
        tagName,
        label: value
      };
    }
  }
  const siblings = Array.from(node.parentElement?.children || []).filter(item => String(item.tagName || '').toLowerCase() === tagName);
  const index = Math.max(0, siblings.indexOf(node)) + 1;
  return {
    ok: true,
    selector: `${tagName || '*'}:nth-of-type(${index || 1})`,
    tagName,
    label: ''
  };
}

function taobaoPageDiagnosticsAdapter() {
  const escapeCss = value => {
    if (globalThis.CSS?.escape) return CSS.escape(String(value));
    return String(value).replace(/["\\#.:,[\]>+~*]/g, '\\$&');
  };
  const visible = node => {
    if (!node) return false;
    const rect = node.getBoundingClientRect?.();
    const style = globalThis.getComputedStyle?.(node);
    return Boolean(rect && rect.width > 0 && rect.height > 0 && style?.display !== 'none' && style?.visibility !== 'hidden');
  };
  const labelOf = node => String(
    node.getAttribute?.('aria-label')
    || node.getAttribute?.('placeholder')
    || node.getAttribute?.('name')
    || node.id
    || node.textContent
    || ''
  ).trim().replace(/\s+/g, ' ').slice(0, 80);
  const selectorOf = node => {
    const tagName = String(node.tagName || '').toLowerCase() || '*';
    const id = String(node.id || '').trim();
    if (id) return `#${escapeCss(id)}`;
    for (const attribute of ['data-testid', 'data-spm', 'name', 'aria-label', 'placeholder', 'type']) {
      const value = String(node.getAttribute?.(attribute) || '').trim();
      if (value) return `${tagName}[${attribute}="${escapeCss(value)}"]`;
    }
    const siblings = Array.from(node.parentElement?.children || []).filter(item => String(item.tagName || '').toLowerCase() === tagName);
    return `${tagName}:nth-of-type(${Math.max(1, siblings.indexOf(node) + 1)})`;
  };
  const summarize = node => ({
    selector: selectorOf(node),
    tagName: String(node.tagName || '').toLowerCase(),
    label: labelOf(node),
    text: String(node.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 80),
    placeholder: String(node.getAttribute?.('placeholder') || '').trim(),
    name: String(node.getAttribute?.('name') || '').trim(),
    id: String(node.id || '').trim(),
    type: String(node.getAttribute?.('type') || '').trim()
  });
  const fields = Array.from(document.querySelectorAll('input:not([type="hidden"]), textarea, select')).filter(visible);
  const buttons = Array.from(document.querySelectorAll('button, [role="button"], a')).filter(visible);
  const fileInputs = fields.filter(node => String(node.getAttribute?.('type') || '').toLowerCase() === 'file');
  return {
    url: location.href,
    title: document.title || '',
    visibleFields: fields.slice(0, 80).map(summarize),
    visibleButtons: buttons.slice(0, 80).map(summarize),
    fileInputs: fileInputs.slice(0, 40).map(summarize),
    textSample: String(document.body?.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 1200)
  };
}

function checkTemplateSelectorsAdapter(selectors = {}) {
  const manualSignals = ['\u9a8c\u8bc1\u7801', '\u6ed1\u5757', '\u4e8c\u6b21\u9a8c\u8bc1', '\u4e8c\u6b21\u786e\u8ba4', '\u98ce\u9669', '\u98ce\u63a7', '\u5b89\u5168\u9a8c\u8bc1', '\u767b\u5f55', '\u626b\u7801'];
  const bodyText = String(document.body?.innerText || '');
  const manualSignal = manualSignals.find(item => bodyText.includes(item));
  if (manualSignal) {
    return {
      ok: false,
      needsManualIntervention: true,
      reason: `\u68c0\u6d4b\u5230${manualSignal}`,
      total: 0,
      found: [],
      missing: [],
      url: location.href,
      title: document.title || ''
    };
  }
  const entries = Object.entries(selectors || {})
    .map(([key, selector]) => [key, String(selector || '').trim()])
    .filter(([, selector]) => selector);
  const visible = node => {
    if (!node) return false;
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const results = entries.map(([key, selector]) => {
    let node = null;
    let error = '';
    try {
      node = document.querySelector(selector);
    } catch (selectorError) {
      error = selectorError?.message || String(selectorError);
    }
    return {
      key,
      selector,
      found: Boolean(node && visible(node)),
      tagName: node?.tagName || '',
      text: String(node?.innerText || node?.textContent || node?.getAttribute?.('aria-label') || '').trim().slice(0, 120),
      error
    };
  });
  return {
    ok: results.every(item => item.found),
    total: results.length,
    found: results.filter(item => item.found),
    missing: results.filter(item => !item.found),
    url: location.href,
    title: document.title || ''
  };
}

function createTaobaoRunner({ electron, app }) {
  const { BrowserWindow } = electron;
  const session = electron.session;
  const windows = new Map();
  const cancelledTasks = new Set();

  function profileDirectory(storeId) {
    return path.join(app.getPath('userData'), 'taobao-profiles', safePartitionSegment(storeId));
  }

  async function openStoreLogin(store = {}) {
    const storeId = String(store.id || '').trim();
    if (!storeId) throw new Error('Missing Taobao store ID');
    const existing = windows.get(storeId);
    if (existing && !existing.isDestroyed()) {
      existing.focus();
      return { ok: true, storeId, reused: true, profileDir: profileDirectory(storeId) };
    }
    const win = new BrowserWindow({
      width: 1180,
      height: 780,
      title: store.name ? `Taobao login - ${store.name}` : 'Taobao login',
      webPreferences: {
        partition: storePartition(storeId),
        contextIsolation: true,
        nodeIntegration: false
      }
    });
    windows.set(storeId, win);
    win.on('closed', () => windows.delete(storeId));
    await win.loadURL(store.loginUrl || 'https://login.taobao.com/');
    return { ok: true, storeId, profileDir: profileDirectory(storeId), loginUrl: win.webContents.getURL() };
  }

  async function openTemplatePublishPage(payload = {}) {
    const store = payload.store || {};
    const storeId = String(payload.storeId || store.id || '').trim();
    const publishUrl = String(payload.publishUrl || payload.category?.defaults?.publishUrl || '').trim();
    if (!storeId) throw new Error('Missing Taobao store ID');
    if (!publishUrl) throw new Error('Missing Taobao publish URL');
    await openStoreLogin({ ...store, id: storeId });
    const win = windows.get(storeId);
    await win.loadURL(publishUrl);
    win.focus();
    return {
      ok: true,
      storeId,
      publishUrl,
      url: win.webContents.getURL(),
      profileDir: profileDirectory(storeId)
    };
  }

  async function checkStoreLogin(store = {}) {
    const storeId = String(store.id || '').trim();
    if (!storeId) throw new Error('Missing Taobao store ID');
    await openStoreLogin({ ...store, id: storeId, loginUrl: store.checkUrl || DEFAULT_STORE_CHECK_URL });
    const win = windows.get(storeId);
    const result = await win.webContents.executeJavaScript(`(${taobaoLoginCheckAdapter.toString()})()`);
    const text = String(result?.text || '');
    const offlineSignal = ['登录', '扫码登录', '账号密码登录', '验证码', '安全验证', '滑块', '风险', '风控'].find(item => text.includes(item));
    const onlineSignal = ['卖家中心', '千牛', '店铺', '商品管理', '宝贝管理', '交易管理'].find(item => text.includes(item));
    return {
      ok: true,
      storeId,
      online: Boolean(onlineSignal && !offlineSignal),
      reason: offlineSignal ? `检测到${offlineSignal}` : (onlineSignal ? `检测到${onlineSignal}` : '未识别到淘宝卖家登录状态'),
      storeName: String(result?.storeName || '').trim(),
      url: result?.url || win.webContents.getURL(),
      profileDir: profileDirectory(storeId)
    };
  }

  async function clearStoreLogin(store = {}) {
    const storeId = String(store.id || '').trim();
    if (!storeId) throw new Error('Missing Taobao store ID');
    const win = windows.get(storeId);
    if (win && !win.isDestroyed()) {
      win.close();
      windows.delete(storeId);
    }
    const partition = storePartition(storeId);
    const storeSession = session?.fromPartition?.(partition);
    if (storeSession?.clearStorageData) await storeSession.clearStorageData();
    if (storeSession?.clearCache) await storeSession.clearCache();
    if (storeSession?.clearAuthCache) await storeSession.clearAuthCache();
    return { ok: true, storeId, partition, profileDir: profileDirectory(storeId) };
  }

  async function capturePage(payload = {}) {
    const storeId = String(payload.storeId || '').trim();
    const win = windows.get(storeId);
    if (!win || win.isDestroyed()) return { ok: false, reason: 'Taobao window is not open' };
    const image = await win.webContents.capturePage();
    const file = path.join(app.getPath('userData'), 'taobao-logs', `${Date.now()}-${safePartitionSegment(storeId)}.png`);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, image.toPNG());
    const detail = await win.webContents.executeJavaScript(`(${taobaoPageDiagnosticsAdapter.toString()})()`, true).catch(error => ({
      error: error?.message || String(error)
    }));
    return { ok: true, file, detail };
  }

  async function getActiveElementSelector(store = {}) {
    const storeId = String(store.id || store.storeId || '').trim();
    if (!storeId) throw new Error('Missing Taobao store ID');
    const win = windows.get(storeId);
    if (!win || win.isDestroyed()) return { ok: false, storeId, reason: 'Taobao window is not open' };
    const result = await win.webContents.executeJavaScript(`(${activeElementSelectorAdapter.toString()})()`);
    return { ...(result || {}), storeId };
  }

  async function checkTemplateSelectors(payload = {}) {
    const storeId = String(payload.storeId || '').trim();
    if (!storeId) throw new Error('Missing Taobao store ID');
    const win = windows.get(storeId);
    if (!win || win.isDestroyed()) return { ok: false, storeId, reason: 'Taobao window is not open', total: 0, found: [], missing: [] };
    const template = normalizeTemplate(payload.category || {});
    const selectors = template.selectors || {};
    const result = await win.webContents.executeJavaScript(`(${checkTemplateSelectorsAdapter.toString()})(${JSON.stringify(selectors)})`, true);
    return {
      ...(result || {}),
      ok: Boolean(result?.ok),
      storeId,
      url: result?.url || win.webContents.getURL()
    };
  }

  async function captureDiagnostics(storeId) {
    try {
      const result = await capturePage({ storeId });
      return result.ok ? result.file : '';
    } catch {
      return '';
    }
  }

  async function runTaobaoTask(payload = {}) {
    const task = payload.task || {};
    const store = payload.store || task.store || {};
    const onStage = typeof payload.onStage === 'function' ? payload.onStage : async () => {};
    const storeId = String(payload.storeId || task.storeId || store.id || '').trim();
    if (!storeId) throw new Error('Task is missing a target Taobao store');
    const taskId = String(task.id || payload.taskId || '').trim();
    if (taskId) cancelledTasks.delete(taskId);
    const cancelledResult = step => ({
      ok: false,
      status: '\u5df2\u6682\u505c',
      failureReason: '\u8fd0\u8425\u5df2\u6682\u505c\u5f53\u524d\u53d1\u5e03\u4efb\u52a1',
      detail: {
        step,
        storeId,
        taskId
      }
    });
    const returnIfCancelled = step => {
      if (!taskId || !cancelledTasks.has(taskId)) return null;
      cancelledTasks.delete(taskId);
      return cancelledResult(step);
    };
    const adapterPayload = buildAdapterPayload({ task, store, storeId });
    const templateValidation = validateTemplate(adapterPayload.template);
    if (!templateValidation.ok) {
      const missingParts = [
        templateValidation.missing.length ? `\u5fc5\u586b\u5b57\u6bb5\uff1a${templateValidation.missing.join(', ')}` : '',
        templateValidation.missingSelectors.length ? `\u9875\u9762\u63a7\u4ef6\u89c4\u5219\uff1a${templateValidation.missingSelectors.join(', ')}` : ''
      ].filter(Boolean);
      return {
        ok: false,
        status: '\u6a21\u677f\u672a\u914d\u7f6e',
        failureReason: `\u7c7b\u76ee\u6a21\u677f\u7f3a\u5c11${missingParts.join('\uff1b')}`,
        detail: {
          step: 'taobao-runner-template-incomplete',
          storeId,
          missing: templateValidation.missing,
          missingSelectors: templateValidation.missingSelectors
        }
      };
    }
    const imageValidation = validateImagePackage(adapterPayload.images);
    if (!imageValidation.ok) {
      return {
        ok: false,
        status: '发布失败',
        failureReason: `任务缺少图片分组：${imageValidation.missing.join('、')}`,
        detail: {
          step: 'taobao-runner-image-package-incomplete',
          storeId,
          taskId,
          missingImageGroups: imageValidation.missing,
          imageCount: adapterPayload.images.length
        }
      };
    }
    const imageSourceValidation = validateImageSources(adapterPayload.images);
    if (!imageSourceValidation.ok) {
      return {
        ok: false,
        status: '发布失败',
        failureReason: `任务图片缺少本地路径或下载 URL：${imageSourceValidation.missing.join('、')}`,
        detail: {
          step: 'taobao-runner-image-source-missing',
          storeId,
          taskId,
          missingImageSources: imageSourceValidation.missing,
          imageCount: adapterPayload.images.length
        }
      };
    }
    const localImageValidation = await validateLocalImageFiles(adapterPayload.images);
    if (!localImageValidation.ok) {
      return {
        ok: false,
        status: '发布失败',
        failureReason: `本地图片文件不存在：${localImageValidation.missing.map(item => item.label).join('、')}`,
        detail: {
          step: 'taobao-runner-local-image-missing',
          storeId,
          taskId,
          missingLocalImages: localImageValidation.missing,
          imageCount: adapterPayload.images.length
        }
      };
    }
    if (payload.dryRun) {
      const imageCount = adapterPayload.images.length;
      const missingLocalImages = adapterPayload.images
        .filter(image => !String(image.outputPath || image.localPath || image.url || image.outputUrl || '').trim())
        .map(image => image.name || image.relativePath || image.group || 'image');
      await onStage({
        status: '\u8bd5\u8fd0\u884c\u901a\u8fc7',
        step: 'dry-run',
        storeId,
        taskId: task.id || '',
        dryRun: true,
        imageCount,
        missingLocalImages
      });
      return {
        ok: true,
        status: '\u8bd5\u8fd0\u884c\u901a\u8fc7',
        detail: {
          step: 'local-publisher-dry-run-complete',
          storeId,
          taskId,
          dryRun: true,
          imageCount,
          missingLocalImages,
          template: {
            categoryId: adapterPayload.categoryId,
            publishUrl: adapterPayload.template.publishUrl,
            selectorCount: Object.keys(adapterPayload.template.selectors || {}).length
          }
        }
      };
    }
    await onStage({ status: '正在打开淘宝', step: 'open-taobao', storeId, taskId: task.id || '' });
    {
      const cancelled = returnIfCancelled('taobao-runner-cancelled');
      if (cancelled) return cancelled;
    }
    await openStoreLogin({ ...store, id: storeId });
    {
      const cancelled = returnIfCancelled('taobao-runner-cancelled-after-open');
      if (cancelled) return cancelled;
    }
    const win = windows.get(storeId);
    const publishUrl = adapterPayload.template.publishUrl;
    await win.loadURL(publishUrl);
    const selectorCheckScript = `(${checkTemplateSelectorsAdapter.toString()})(${JSON.stringify(adapterPayload.template.selectors || {})})`;
    const selectorCheck = await win.webContents.executeJavaScript(selectorCheckScript, true);
    if (selectorCheck?.needsManualIntervention) {
      const screenshotPath = await captureDiagnostics(storeId);
      return {
        ok: false,
        status: '\u9700\u8981\u4eba\u5de5\u5904\u7406',
        failureReason: selectorCheck.reason || '\u6dd8\u5b9d\u9875\u9762\u9700\u8981\u4eba\u5de5\u5904\u7406',
        detail: {
          step: 'taobao-runner-manual-intervention',
          screenshotPath,
          publishUrl,
          diagnostics: {
            taskId: task.id || '',
            storeId,
            title: task.title || '',
            categoryId: task.categoryId || '',
            stages: ['\u6253\u5f00\u6dd8\u5b9d\u53d1\u5e03\u9875'],
            selectorCheck
          }
        }
      };
    }
    if (selectorCheck && selectorCheck.ok === false) {
      const missingSelectors = (Array.isArray(selectorCheck.missing) ? selectorCheck.missing : [])
        .map(item => item?.key || item?.selector)
        .filter(Boolean);
      const screenshotPath = await captureDiagnostics(storeId);
      return {
        ok: false,
        status: '\u6a21\u677f\u672a\u914d\u7f6e',
        failureReason: `\u6dd8\u5b9d\u9875\u9762\u63a7\u4ef6\u6821\u9a8c\u672a\u901a\u8fc7\uff1a${missingSelectors.join(', ') || '\u672a\u627e\u5230\u5df2\u914d\u7f6e\u7684\u63a7\u4ef6'}`,
        detail: {
          step: 'taobao-runner-selector-check-failed',
          storeId,
          taskId,
          screenshotPath,
          publishUrl,
          missingSelectors,
          selectorCheck
        }
      };
    }
    await onStage({ status: '正在填写模板', step: 'fill-template', storeId, taskId: task.id || '' });
    {
      const cancelled = returnIfCancelled('taobao-runner-cancelled-before-fill');
      if (cancelled) return cancelled;
    }
    await onStage({ status: '正在上传图片', step: 'upload-images', storeId, taskId: task.id || '', imageCount: adapterPayload.images.length });
    {
      const cancelled = returnIfCancelled('taobao-runner-cancelled-before-upload');
      if (cancelled) return cancelled;
    }
    adapterPayload.images = await prepareUploadImages({
      app,
      storeId,
      taskId: task.id || 'task',
      images: adapterPayload.images,
      fetchBinary: payload.fetchBinary || defaultFetchBinary
    });
    const failedDownloads = adapterPayload.images
      .filter(image => image.downloadError)
      .map(image => ({
        label: imageSourceLabel(image),
        url: image.url || image.outputUrl || '',
        error: image.downloadError
      }));
    if (failedDownloads.length) {
      const screenshotPath = await captureDiagnostics(storeId);
      return {
        ok: false,
        status: '发布失败',
        failureReason: `图片下载失败：${failedDownloads.map(item => item.label).join('、')}`,
        detail: {
          step: 'taobao-runner-image-download-failed',
          storeId,
          taskId,
          screenshotPath,
          publishUrl,
          failedDownloads
        }
      };
    }
    {
      const cancelled = returnIfCancelled('taobao-runner-cancelled-after-prepare-images');
      if (cancelled) return cancelled;
    }
    const uploadResult = await uploadPreparedFilesWithDebugger(win.webContents, adapterPayload.images, adapterPayload.template.selectors || {});
    {
      const cancelled = returnIfCancelled('taobao-runner-cancelled-after-upload');
      if (cancelled) return cancelled;
    }
    const script = `(${taobaoPageAdapter.toString()})(${JSON.stringify(adapterPayload)})`;
    const adapterResult = await win.webContents.executeJavaScript(script, true);
    await onStage({ status: '正在保存草稿', step: 'save-draft', storeId, taskId: task.id || '' });
    {
      const cancelled = returnIfCancelled('taobao-runner-cancelled-after-adapter');
      if (cancelled) return cancelled;
    }
    const diagnostics = {
      taskId: task.id || '',
      storeId,
      title: task.title || '',
      categoryId: task.categoryId || '',
      stages: adapterResult?.stages || ['打开淘宝发布页', '填写类目模板', '上传图片', '保存草稿'],
      uploadResult,
      adapterResult
    };
    if (uploadResult && uploadResult.ok === false) {
      const screenshotPath = await captureDiagnostics(storeId);
      return {
        ok: false,
        status: '发布失败',
        failureReason: `图片上传失败：${uploadResult.reason || '未找到可用上传控件'}`,
        detail: {
          step: 'taobao-runner-upload-failed',
          screenshotPath,
          publishUrl,
          diagnostics
        }
      };
    }
    const expectedStoreName = String(adapterPayload.expectedStoreName || '').trim();
    const currentStoreName = String(adapterResult?.currentStoreName || '').trim();
    if (expectedStoreName && currentStoreName && currentStoreName !== expectedStoreName) {
      const screenshotPath = await captureDiagnostics(storeId);
      return {
        ok: false,
        status: '需要人工处理',
        failureReason: '当前淘宝店铺不匹配，请切换店铺',
        detail: {
          step: 'taobao-runner-store-mismatch',
          screenshotPath,
          publishUrl,
          expectedStoreName,
          currentStoreName,
          diagnostics
        }
      };
    }
    if (adapterResult?.ok) {
      return {
        ok: true,
        status: '已保存草稿',
        detail: {
          step: 'taobao-runner-draft-saved',
          publishUrl,
          diagnostics
        }
      };
    }
    if (adapterResult?.needsManualIntervention) {
      const screenshotPath = await captureDiagnostics(storeId);
      return {
        ok: false,
        status: '需要人工处理',
        failureReason: adapterResult.reason || '淘宝页面需要人工处理',
        detail: {
          step: 'taobao-runner-manual-intervention',
          screenshotPath,
          publishUrl,
          diagnostics
        }
      };
    }
    const screenshotPath = await captureDiagnostics(storeId);
    return {
      ok: false,
      status: '发布失败',
      failureReason: adapterResult?.missingRequired?.length
        ? `淘宝发布页缺少必要字段：${adapterResult.missingRequired.join(', ')}`
        : '淘宝发布页适配器没有找到保存草稿入口，请检查页面结构或模板规则',
      detail: {
        step: 'taobao-runner-adapter-incomplete',
        screenshotPath,
        publishUrl,
        diagnostics,
        requiredAction: '检查类目、品牌“其他家”、型号“其他”、图片上传和保存草稿页面规则'
      }
    };
  }

  return {
    cancelTask: taskId => {
      const id = String(taskId || '').trim();
      if (!id) return { ok: false, reason: 'Missing task ID' };
      cancelledTasks.add(id);
      return { ok: true, taskId: id };
    },
    capturePage,
    checkStoreLogin,
    clearStoreLogin,
    getActiveElementSelector,
    checkTemplateSelectors,
    openTemplatePublishPage,
    openStoreLogin,
    runTaobaoTask
  };
}

module.exports = { createTaobaoRunner, storePartition, buildAdapterPayload, normalizeTemplate, validateTemplate, flattenTaskImages, prepareUploadImages, uploadPreparedFilesWithDebugger, taobaoPageAdapter, activeElementSelectorAdapter, taobaoPageDiagnosticsAdapter, checkTemplateSelectorsAdapter };
