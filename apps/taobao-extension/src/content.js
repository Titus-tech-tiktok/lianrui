const STATUS = {
  filling: '\u6b63\u5728\u586b\u5199\u5b57\u6bb5',
  uploading: '\u6b63\u5728\u4e0a\u4f20\u56fe\u7247',
  saving: '\u6b63\u5728\u4fdd\u5b58\u8349\u7a3f',
  saved: '\u5df2\u4fdd\u5b58\u8349\u7a3f',
  failed: '\u5931\u8d25'
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let runningTaskId = '';
let categoryAttempt = {};
let uploadAttempt = {};

chrome.runtime.sendMessage({ type: 'CAISHEN_TAOBAO_CONTENT_READY' });

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'CAISHEN_TAOBAO_COLLECT_DIAGNOSTICS') {
    sendResponse({ ok: true, detail: collectDiagnostics('manual-diagnostics') });
    return;
  }
  if (message?.type !== 'CAISHEN_TAOBAO_START') return;
  if (runningTaskId === message.task?.id) {
    sendResponse({ ok: true, duplicate: true });
    return;
  }
  runningTaskId = message.task?.id || '';
  runPublish(message.task).then(() => sendResponse({ ok: true })).catch(error => {
    report(message.task?.id, STATUS.failed, {
      failureReason: error.message,
      detail: collectDiagnostics(error.step || 'unknown')
    });
    sendResponse({ ok: false, error: error.message });
  }).finally(() => {
    runningTaskId = '';
  });
  return true;
});

async function report(taskId, status, detail = {}) {
  await chrome.runtime.sendMessage({ type: 'CAISHEN_TAOBAO_STATUS', taskId, status, detail });
}

function fail(message, step) {
  const error = new Error(message);
  error.step = step;
  return error;
}

function text(value) {
  return String(value || '').trim();
}

function selectors(task) {
  return task?.category?.defaults?.selectors && typeof task.category.defaults.selectors === 'object'
    ? task.category.defaults.selectors
    : {};
}

function query(selector) {
  if (!text(selector)) return null;
  try { return document.querySelector(selector); }
  catch { return null; }
}

function queryAll(selector) {
  if (!text(selector)) return [];
  try { return [...document.querySelectorAll(selector)]; }
  catch { return []; }
}

function visible(element) {
  if (!element) return false;
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
}

function disabled(element) {
  if (!element) return true;
  return Boolean(element.disabled)
    || element.getAttribute('aria-disabled') === 'true'
    || element.classList.contains('disabled')
    || /disabled/i.test(String(element.className || ''));
}

function clickElement(element) {
  if (!element || disabled(element)) return false;
  element.scrollIntoView?.({ block: 'center', inline: 'center' });
  element.focus?.();
  for (const type of ['pointerdown', 'mousedown', 'mouseup']) {
    element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
  }
  element.click?.();
  return true;
}

function trustedClickPoint(element, preferredText = '') {
  const wanted = text(preferredText).replace(/\s+/g, '').toLocaleLowerCase('zh-CN');
  let target = element;
  if (wanted) {
    const textTargets = [...target.querySelectorAll('*')]
      .filter(visible)
      .filter(candidate => text(candidate.innerText || candidate.textContent)
        .replace(/\s+/g, '')
        .toLocaleLowerCase('zh-CN') === wanted)
      .sort((left, right) => {
        const leftRect = left.getBoundingClientRect();
        const rightRect = right.getBoundingClientRect();
        return (leftRect.width * leftRect.height) - (rightRect.width * rightRect.height);
      });
    target = textTargets[0] || target;
  }
  const rect = target.getBoundingClientRect();
  let x = rect.left + (rect.width / 2);
  let y = rect.top + (rect.height / 2);
  let frameDepth = 0;
  let currentWindow = window;
  try {
    while (currentWindow !== currentWindow.top) {
      const frameElement = currentWindow.frameElement;
      if (!frameElement) break;
      const frameRect = frameElement.getBoundingClientRect();
      x += frameRect.left;
      y += frameRect.top;
      frameDepth += 1;
      currentWindow = currentWindow.parent;
    }
  } catch {}
  return {
    x,
    y,
    frameDepth,
    rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    targetSelector: cssSelectorForDiagnostics(target),
    topFrame: window === window.top
  };
}

async function trustedClickElement(element, preferredText = '') {
  if (!element || disabled(element)) return false;
  element.scrollIntoView?.({ block: 'center', inline: 'center' });
  await sleep(120);
  const point = trustedClickPoint(element, preferredText);
  const diagnostic = { ...point, selector: cssSelectorForDiagnostics(element) };
  try {
    const result = await chrome.runtime.sendMessage({ type: 'CAISHEN_TAOBAO_TRUSTED_CLICK', x: point.x, y: point.y });
    diagnostic.result = result;
    categoryAttempt.trustedClicks = [...(categoryAttempt.trustedClicks || []), diagnostic];
    if (result?.ok) return true;
  } catch (error) {
    diagnostic.error = error?.message || String(error);
    categoryAttempt.trustedClicks = [...(categoryAttempt.trustedClicks || []), diagnostic];
  }
  return clickElement(element);
}

async function trustedClickElementRightEdge(element) {
  if (!element || disabled(element)) return false;
  element.scrollIntoView?.({ block: 'center', inline: 'center' });
  await sleep(120);
  const point = trustedClickPoint(element);
  const x = point.x + (point.rect.width / 2) - 18;
  const diagnostic = {
    ...point,
    x,
    selector: cssSelectorForDiagnostics(element),
    edge: 'right'
  };
  try {
    const result = await chrome.runtime.sendMessage({ type: 'CAISHEN_TAOBAO_TRUSTED_CLICK', x, y: point.y });
    diagnostic.result = result;
    categoryAttempt.trustedClicks = [...(categoryAttempt.trustedClicks || []), diagnostic];
    if (result?.ok) return true;
  } catch (error) {
    diagnostic.error = error?.message || String(error);
    categoryAttempt.trustedClicks = [...(categoryAttempt.trustedClicks || []), diagnostic];
  }
  return clickElement(element);
}

function selectorForElement(element) {
  if (!element?.tagName) return '';
  const tag = element.tagName.toLowerCase();
  if (element.id) return `${tag}#${CSS.escape(element.id)}`;
  const name = element.getAttribute('name');
  if (name) return `${tag}[name="${CSS.escape(name)}"]`;
  const aria = element.getAttribute('aria-label');
  if (aria) return `${tag}[aria-label="${CSS.escape(aria)}"]`;
  const placeholder = element.getAttribute('placeholder');
  if (placeholder) return `${tag}[placeholder="${CSS.escape(placeholder)}"]`;
  const role = element.getAttribute('role');
  const type = element.getAttribute('type');
  const parts = [tag];
  if (type) parts.push(`[type="${CSS.escape(type)}"]`);
  if (role) parts.push(`[role="${CSS.escape(role)}"]`);
  const parent = element.parentElement;
  if (!parent || parent === document.body) return parts.join('');
  const siblings = [...parent.children].filter(item => item.tagName === element.tagName);
  const index = siblings.indexOf(element);
  return `${selectorForElement(parent)} > ${parts.join('')}${siblings.length > 1 && index >= 0 ? `:nth-of-type(${index + 1})` : ''}`;
}

function cssSelectorForDiagnostics(element) {
  const selector = selectorForElement(element);
  if (!selector) return '';
  try {
    return document.querySelector(selector) === element ? selector : '';
  } catch {
    return '';
  }
}

function fields() {
  return [...document.querySelectorAll('input, textarea, [contenteditable="true"]')].filter(element => {
    if (element.type === 'file' || element.type === 'hidden') return false;
    return visible(element);
  });
}

function labelText(element) {
  const explicit = element.id ? document.querySelector(`label[for="${CSS.escape(element.id)}"]`)?.innerText : '';
  const parents = [];
  let node = element;
  for (let index = 0; node && index < 5; index += 1, node = node.parentElement) parents.push(node.innerText || '');
  return [explicit, element.placeholder, element.getAttribute('aria-label'), element.name, element.id, ...parents].join(' ');
}

function byKeywords(elements, keywords) {
  const wanted = keywords.map(item => item.toLocaleLowerCase('zh-CN'));
  return elements.find(element => {
    const label = labelText(element).toLocaleLowerCase('zh-CN');
    return wanted.some(keyword => label.includes(keyword));
  });
}

function findField(keywords, selector = '') {
  const selected = query(selector);
  if (selected) return selected;
  return byKeywords(fields(), keywords);
}

function isSelectLike(element) {
  if (!element) return false;
  return element.tagName === 'SELECT'
    || ['combobox', 'listbox'].includes(String(element.getAttribute('role') || '').toLowerCase())
    || ['listbox', 'menu'].includes(String(element.getAttribute('aria-haspopup') || '').toLowerCase());
}

async function setSelectValue(element, value) {
  const wanted = text(value);
  if (!element || !wanted) return false;
  if (element.tagName === 'SELECT') {
    const option = [...element.options].find(item => {
      const label = text(item.textContent || item.label || item.value).toLocaleLowerCase('zh-CN');
      const lower = wanted.toLocaleLowerCase('zh-CN');
      return label === lower || label.includes(lower);
    });
    if (!option) return false;
    element.value = option.value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    await sleep(180);
    return true;
  }
  clickElement(element);
  await sleep(260);
  return selectOptionByText(wanted);
}

function setNativeValue(element, value) {
  if (!element) return false;
  element.focus();
  if (element.isContentEditable) {
    element.textContent = value;
    element.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }));
  } else {
    const prototype = element.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (setter) setter.call(element, value);
    else element.value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }
  element.blur();
  return true;
}

async function fillField(keywords, value, selector = '') {
  if (!text(value)) return false;
  const field = findField(keywords, selector);
  if (!field) return false;
  if (isSelectLike(field)) return setSelectValue(field, value);
  setNativeValue(field, text(value));
  await sleep(180);
  return true;
}

async function selectOptionByText(value, selector = '') {
  const wanted = text(value).toLocaleLowerCase('zh-CN');
  if (!wanted) return false;
  const options = [
    ...queryAll(selector),
    ...document.querySelectorAll('[role="option"], [role="menuitem"], li, span, div')
  ].filter(visible);
  const option = options.find(element => {
    const label = text(element.innerText || element.textContent || element.getAttribute('aria-label') || element.title).toLocaleLowerCase('zh-CN');
    return label === wanted || label.includes(wanted);
  });
  if (!option) return false;
  clickElement(option);
  await sleep(220);
  return true;
}

async function clickFieldOrOption(keywords, value, selector = '') {
  if (!text(value)) return false;
  const selected = query(selector);
  if (selected) {
    if (isSelectLike(selected)) return setSelectValue(selected, value);
    clickElement(selected);
    await sleep(260);
    return selectOptionByText(value) || true;
  }
  const field = findButton(keywords);
  if (field) {
    clickElement(field);
    await sleep(260);
    if (await selectOptionByText(value)) return true;
  }
  const button = findButton([value]);
  if (!button) return false;
  clickElement(button);
  await sleep(180);
  return true;
}

function findButton(keywords, selector = '') {
  const selected = query(selector);
  if (selected && visible(selected) && !disabled(selected)) return selected;
  const wanted = keywords.map(item => item.toLocaleLowerCase('zh-CN'));
  return [...document.querySelectorAll('button, [role="button"], a, span, div')]
    .filter(visible)
    .filter(element => !disabled(element))
    .find(element => {
      const label = [element.innerText, element.textContent, element.getAttribute('aria-label'), element.title].join(' ').toLocaleLowerCase('zh-CN');
      return wanted.some(keyword => label.includes(keyword));
    });
}

async function waitForButton(keywords, selector = '', timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const button = findButton(keywords, selector);
    if (button) return button;
    await sleep(500);
  }
  return null;
}

function categoryKeyword(task) {
  return text(
    task?.category?.defaults?.categoryKeyword
    || task?.category?.product
    || task?.category?.name
    || task?.categoryName
  );
}

function isCategoryEntryPage() {
  return /\/sell\/ai\/category\.htm/i.test(location.pathname)
    || pageText().includes('搜索发品');
}

function isTaobaoLoginPage() {
  return /login\.taobao\.com/i.test(location.hostname)
    || /\/login\//i.test(location.pathname)
    || Boolean(document.querySelector('#fm-login-id, #login-form'));
}

function dispatchEnter(element) {
  for (const type of ['keydown', 'keypress', 'keyup']) {
    element.dispatchEvent(new KeyboardEvent(type, {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true
    }));
  }
}

function findCategorySearchInput(task) {
  const selected = query(selectors(task).categorySearch);
  if (selected) return selected;
  return findField(['产品名称', '类目关键词', '条码信息', '搜索发品', '搜索']) || fields()[0] || null;
}

const genericCategoryLabels = new Set([
  '\u5546\u54c1\u53d1\u5e03',
  '\u641c\u7d22\u53d1\u54c1',
  '\u70ed\u95e8\u63a8\u8350',
  '\u4e0b\u4e00\u6b65',
  '\u5f00\u59cb',
  '\u53d1\u5e03',
  '\u9009\u62e9',
  '\u9009\u62e9\u7c7b\u76ee'
]);

const categoryActionWords = ['\u53d1\u5e03', '\u9009\u62e9', '\u4e0b\u4e00\u6b65', '\u5f00\u59cb', '\u786e\u8ba4'];

function categoryCandidateText(element) {
  const chunks = [];
  let node = element;
  for (let index = 0; node && index < 4 && node !== document.body; index += 1, node = node.parentElement) {
    const value = text(node.innerText || node.textContent || node.getAttribute?.('aria-label') || node.title || '');
    if (value && value.length <= 600) chunks.push(value);
  }
  return [...new Set(chunks)].join(' ');
}

function categoryOwnLabelIncludesKeyword(element, keyword) {
  const label = text(
    element?.innerText
    || element?.textContent
    || element?.getAttribute?.('aria-label')
    || element?.title
  ).toLocaleLowerCase('zh-CN');
  const wanted = text(keyword).toLocaleLowerCase('zh-CN');
  return Boolean(wanted && label.includes(wanted));
}

function scoreCategoryCandidate(element, keyword) {
  if (!visible(element)) return 0;
  const ownLabel = text(element.innerText || element.textContent || element.getAttribute('aria-label') || element.title);
  const compactLabel = ownLabel.replace(/\s+/g, '');
  if (!compactLabel || genericCategoryLabels.has(compactLabel) || ownLabel.length > 600) return 0;
  const lowerKeyword = text(keyword).toLocaleLowerCase('zh-CN');
  const ownKeywordHit = categoryOwnLabelIncludesKeyword(element, keyword);
  const haystack = categoryCandidateText(element).toLocaleLowerCase('zh-CN');
  const keywordHit = lowerKeyword && haystack.includes(lowerKeyword);
  const actionHit = categoryActionWords.some(word => haystack.includes(word));
  if (!keywordHit) return 0;
  let score = 100;
  if (ownKeywordHit) score += 60;
  if (actionHit) score += 40;
  if (['BUTTON', 'A'].includes(element.tagName) || element.getAttribute('role') === 'button') score += 15;
  if (['LI', 'DIV'].includes(element.tagName)) score += 5;
  return score - Math.min(Math.floor(ownLabel.length / 20), 30);
}

function categoryClickTarget(element, keyword) {
  if (!element) return null;
  const wanted = text(keyword).toLocaleLowerCase('zh-CN');
  const candidates = [];
  let node = element;
  for (let depth = 0; node && depth < 6 && node !== document.body; depth += 1, node = node.parentElement) {
    const label = text(node.innerText || node.textContent || node.getAttribute?.('aria-label') || node.title)
      .toLocaleLowerCase('zh-CN');
    const rect = node.getBoundingClientRect?.();
    if (!label.includes(wanted) || !rect || rect.height < 20 || rect.height > 120 || rect.width <= 0) continue;
    const role = String(node.getAttribute?.('role') || '').toLowerCase();
    const semantic = ['LI', 'BUTTON', 'A'].includes(node.tagName)
      || ['option', 'radio', 'menuitem', 'treeitem', 'button'].includes(role);
    if (!semantic && node.tagName !== 'DIV') continue;
    candidates.push({ node, semantic, width: rect.width, depth });
  }
  candidates.sort((left, right) => Number(right.semantic) - Number(left.semantic)
    || right.width - left.width
    || left.depth - right.depth);
  return candidates[0]?.node || element;
}

function findCategoryCandidate(keyword) {
  const candidates = [...document.querySelectorAll('button, [role="button"], a, li, div, span')]
    .map(element => ({ element, score: scoreCategoryCandidate(element, keyword) }))
    .filter(item => item.score > 0)
    .sort((left, right) => right.score - left.score);
  const directCandidates = candidates.filter(item => categoryOwnLabelIncludesKeyword(item.element, keyword));
  const clickableCandidates = directCandidates.map(item => ({
    ...item,
    element: categoryClickTarget(item.element, keyword)
  }));
  return clickableCandidates[0]?.element || null;
}

function findConfiguredCategoryCandidate(task, keyword) {
  const selected = query(selectors(task).categoryResult);
  if (!selected || !visible(selected) || disabled(selected)) return null;
  return categoryOwnLabelIncludesKeyword(selected, keyword) ? categoryClickTarget(selected, keyword) : null;
}

function findCategoryResultRadio(selected) {
  let node = selected;
  for (let depth = 0; node && depth < 8 && node !== document.body; depth += 1, node = node.parentElement) {
    const radios = [...node.querySelectorAll('input[type="radio"]')].filter(visible).filter(element => !disabled(element));
    if (radios.length === 1) return radios[0];
    if (radios.length > 1) return null;
  }
  return null;
}

function findManualCategoryCandidate(keyword, excluded) {
  const wanted = text(keyword).replace(/\s+/g, '').toLocaleLowerCase('zh-CN');
  const candidates = [...document.querySelectorAll('li, [role="option"], [role="menuitem"], [role="treeitem"]')]
    .filter(element => element !== excluded && visible(element) && !disabled(element))
    .filter(element => element.getAttribute('role') !== 'tab' && !element.closest('[role="tablist"]'))
    .filter(element => text(element.innerText || element.textContent || element.getAttribute('aria-label') || element.title)
      .replace(/\s+/g, '')
      .toLocaleLowerCase('zh-CN') === wanted)
    .map(element => categoryClickTarget(element, keyword));
  return candidates[0] || null;
}

function findExactVisibleOption(value) {
  const wanted = text(value).replace(/\s+/g, '').toLocaleLowerCase('zh-CN');
  return [...document.querySelectorAll('[role="option"], [role="menuitem"], li, div, span')]
    .filter(visible)
    .filter(element => !disabled(element))
    .filter(element => text(element.innerText || element.textContent || element.getAttribute('aria-label') || element.title)
      .replace(/\s+/g, '')
      .toLocaleLowerCase('zh-CN') === wanted)
    .sort((left, right) => {
      const leftRect = left.getBoundingClientRect();
      const rightRect = right.getBoundingClientRect();
      return (leftRect.width * leftRect.height) - (rightRect.width * rightRect.height);
    })[0] || null;
}

function findFirstVisibleBrandOption() {
  return [...document.querySelectorAll('[role="option"], [role="menuitem"], li, div, span')]
    .filter(visible)
    .filter(element => !disabled(element))
    .filter(element => {
      const label = text(element.innerText || element.textContent || element.getAttribute('aria-label') || element.title);
      return label && label.length <= 120 && !label.includes('[新增品牌]') && !label.includes('请选择');
    })
    .sort((left, right) => {
      const leftRect = left.getBoundingClientRect();
      const rightRect = right.getBoundingClientRect();
      return (leftRect.width * leftRect.height) - (rightRect.width * rightRect.height);
    })[0] || null;
}

async function waitForExactVisibleOption(value, timeoutMs = 5000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const option = findExactVisibleOption(value);
    if (option) return option;
    await sleep(200);
  }
  return null;
}

async function ensureCategorySearchMode(task) {
  const searchMode = findExactVisibleOption('\u641c\u7d22\u53d1\u54c1');
  if (searchMode) {
    await trustedClickElement(searchMode, '\u641c\u7d22\u53d1\u54c1');
    await sleep(600);
  }
  const started = Date.now();
  while (Date.now() - started < 5000) {
    const field = findCategorySearchInput(task);
    if (field) return field;
    await sleep(200);
  }
  throw fail('\u672a\u627e\u5230\u6dd8\u5b9d\u7c7b\u76ee\u641c\u7d22\u8f93\u5165\u6846', 'select-category');
}

function findCategoryBrandField(task) {
  const configured = query(selectors(task).categoryBrand);
  if (configured && visible(configured) && !disabled(configured)) return configured;
  const candidates = fields().filter(element => {
    const placeholder = text(element.getAttribute('placeholder'));
    return placeholder === '\u8bf7\u9009\u62e9' || element.getAttribute('role') === 'combobox';
  });
  const brandCandidate = candidates.find(element => {
    let node = element;
    for (let depth = 0; node && depth < 8 && node !== document.body; depth += 1, node = node.parentElement) {
      const context = text(node.innerText || node.textContent);
      if (context.includes('\u54c1\u724c') && context.length < 1200) return true;
    }
    return false;
  });
  return brandCandidate || (candidates.length === 1 ? candidates[0] : null);
}

function findCategoryBrandSearchInput(field) {
  const active = document.activeElement;
  if (active && active !== field && fields().includes(active) && !disabled(active)) return active;
  const fieldRect = field.getBoundingClientRect();
  return fields()
    .filter(element => element !== field && !disabled(element))
    .filter(element => {
      const placeholder = text(element.getAttribute('placeholder'));
      return !placeholder.includes('\u4ea7\u54c1\u540d\u79f0') && !placeholder.includes('\u7c7b\u76ee\u5173\u952e\u8bcd');
    })
    .map(element => {
      const rect = element.getBoundingClientRect();
      const horizontalOverlap = Math.max(0, Math.min(rect.right, fieldRect.right) - Math.max(rect.left, fieldRect.left));
      const verticalDistance = rect.top - fieldRect.bottom;
      const popupSearchShape = rect.top >= fieldRect.bottom - 8
        && rect.top <= fieldRect.bottom + 140
        && rect.width >= Math.min(120, fieldRect.width * 0.5)
        && rect.height >= 24;
      return { element, horizontalOverlap, verticalDistance: Math.abs(verticalDistance), popupSearchShape };
    })
    .filter(item => item.horizontalOverlap > 0 && item.popupSearchShape)
    .sort((left, right) => right.horizontalOverlap - left.horizontalOverlap || left.verticalDistance - right.verticalDistance)[0]?.element || null;
}

async function waitForCategoryBrandSearchInput(field, timeoutMs = 4000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const input = findCategoryBrandSearchInput(field);
    if (input) return input;
    await sleep(200);
  }
  return null;
}

async function waitForBrandModelField(timeoutMs = 4000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const field = query('input[name="p-20000~1"]') || findField(['\u578b\u53f7']);
    if (field) return field;
    await sleep(200);
  }
  return null;
}

function fieldValueText(field) {
  if (!field) return '';
  const own = text(field.value || field.getAttribute?.('aria-valuetext') || field.getAttribute?.('title'));
  const chunks = [own];
  let node = field;
  for (let depth = 0; node && depth < 4 && node !== document.body; depth += 1, node = node.parentElement) {
    const label = text(node.innerText || node.textContent);
    if (label && label.length < 300) chunks.push(label);
  }
  return chunks.join(' ');
}

async function waitForFieldValue(field, expected, timeoutMs = 5000) {
  const wanted = text(expected);
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (fieldValueText(field).includes(wanted)) return true;
    await sleep(200);
  }
  return false;
}

async function selectCategoryBrand(task) {
  const configuredBrand = text(task?.category?.defaults?.brand || task?.category?.defaults?.brandName) || '\u5176\u4ed6';
  const brand = configuredBrand === '\u5176\u4ed6' ? '\u5176\u4ed6\u5bb6' : configuredBrand;
  const field = findCategoryBrandField(task);
  if (!field) return false;
  if (field.tagName === 'SELECT') {
    if (!(await setSelectValue(field, brand))) throw fail(`\u672a\u627e\u5230\u6dd8\u5b9d\u54c1\u724c\u9009\u9879\uff1a${brand}`, 'select-category');
  } else {
    await trustedClickElement(field);
    clickElement(field);
    let searchInput = await waitForCategoryBrandSearchInput(field);
    if (!searchInput) {
      await trustedClickElementRightEdge(field);
      searchInput = await waitForCategoryBrandSearchInput(field, 5000);
    }
    if (!searchInput) throw fail('\u672a\u627e\u5230\u6dd8\u5b9d\u54c1\u724c\u641c\u7d22\u6846', 'select-category');
    setNativeValue(searchInput, brand);
    searchInput.focus();
    const option = await waitForExactVisibleOption('\u5176\u4ed6\u5bb6') || findFirstVisibleBrandOption();
    if (!option) throw fail(`\u672a\u627e\u5230\u6dd8\u5b9d\u54c1\u724c\u9009\u9879\uff1a${brand}`, 'select-category');
    const optionTarget = option.closest('[role="option"], [role="menuitem"], li') || option;
    await trustedClickElement(optionTarget, brand);
    clickElement(optionTarget);
    await sleep(500);
    if (!(await waitForFieldValue(field, brand))) {
      categoryAttempt.brandSelectionError = {
        expected: brand,
        actual: fieldValueText(field).slice(0, 160),
        selector: cssSelectorForDiagnostics(field)
      };
      throw fail(`\u6dd8\u5b9d\u54c1\u724c\u672a\u9009\u4e2d\uff1a${brand}`, 'select-category');
    }
    const modelField = await waitForBrandModelField();
    const modelValue = text(task?.category?.defaults?.modelName || task?.category?.defaults?.model || '\u5176\u4ed6');
    if (modelField && modelValue) {
      setNativeValue(modelField, modelValue);
      await sleep(300);
      if (!(await waitForFieldValue(modelField, modelValue, 3000))) {
        categoryAttempt.brandModelError = {
          expected: modelValue,
          actual: fieldValueText(modelField).slice(0, 160),
          selector: cssSelectorForDiagnostics(modelField)
        };
        throw fail(`\u6dd8\u5b9d\u578b\u53f7\u672a\u586b\u5199\uff1a${modelValue}`, 'select-category');
      }
      categoryAttempt.brandModel = {
        value: modelValue,
        selector: cssSelectorForDiagnostics(modelField)
      };
    }
    categoryAttempt.brandSearch = {
      query: '\u5176\u4ed6',
      selector: cssSelectorForDiagnostics(searchInput),
      option: cssSelectorForDiagnostics(optionTarget)
    };
  }
  categoryAttempt.brand = {
    value: brand,
    selector: cssSelectorForDiagnostics(field)
  };
  return true;
}

async function openManualCategorySelector(task, keyword) {
  const selectorLabel = findExactVisibleOption('\u9009\u62e9\u7c7b\u76ee');
  const selectorButton = selectorLabel?.closest('button, [role="button"], a') || selectorLabel;
  if (!selectorButton) return false;
  await trustedClickElement(selectorButton, '\u9009\u62e9\u7c7b\u76ee');
  clickElement(selectorButton);
  await sleep(600);
  const configuredPath = task?.category?.defaults?.categoryPath;
  const categoryPath = Array.isArray(configuredPath) && configuredPath.length
    ? configuredPath.map(text).filter(Boolean)
    : ['\u4f4f\u5b85\u5bb6\u5177', '\u67dc\u7c7b', keyword];
  categoryAttempt.manualPath = [];
  for (const label of categoryPath) {
    const option = await waitForExactVisibleOption(label);
    if (!option) throw fail(`\u672a\u627e\u5230\u6dd8\u5b9d\u624b\u52a8\u7c7b\u76ee\u8282\u70b9\uff1a${label}`, 'select-category');
    const optionTarget = categoryClickTarget(option, label);
    categoryAttempt.manualPath.push({ label, selector: cssSelectorForDiagnostics(optionTarget) });
    await trustedClickElement(optionTarget, label);
    clickElement(optionTarget);
    await sleep(450);
  }
  return true;
}

async function selectSearchCategoryCandidate(task, keyword) {
  const selected = findConfiguredCategoryCandidate(task, keyword) || findCategoryCandidate(keyword);
  if (!selected) return false;
  categoryAttempt.selected = {
    selector: cssSelectorForDiagnostics(selected),
    tag: selected.tagName?.toLowerCase() || '',
    text: categoryActionLabel(selected).slice(0, 240),
    href: selected.href || ''
  };
  const resultRadio = findCategoryResultRadio(selected);
  if (resultRadio) {
    categoryAttempt.resultRadio = {
      selector: cssSelectorForDiagnostics(resultRadio),
      checked: Boolean(resultRadio.checked)
    };
    await trustedClickElement(resultRadio);
    await sleep(600);
  } else {
    await trustedClickElement(selected, keyword);
    await sleep(600);
    if (await waitForPublishForm(1500)) return true;
    const manualSelected = findManualCategoryCandidate(keyword, selected);
    if (manualSelected) {
      categoryAttempt.manualSelected = {
        selector: cssSelectorForDiagnostics(manualSelected),
        tag: manualSelected.tagName?.toLowerCase() || '',
        text: categoryActionLabel(manualSelected).slice(0, 240)
      };
      await trustedClickElement(manualSelected, keyword);
      await sleep(600);
    }
  }
  await selectCategoryBrand(task);
  const continuation = await waitForCategoryContinuation(selected, selected);
  if (continuation) {
    categoryAttempt.continuation = {
      selector: cssSelectorForDiagnostics(continuation),
      text: categoryActionLabel(continuation),
      href: continuation.href || ''
    };
    await trustedClickElement(continuation);
    if (await waitForPublishForm(3500)) return true;
  }
  const fallbackAction = findCategoryAction(selected, keyword);
  if (fallbackAction && fallbackAction !== selected && fallbackAction !== continuation) {
    categoryAttempt.fallback = {
      selector: cssSelectorForDiagnostics(fallbackAction),
      text: categoryActionLabel(fallbackAction),
      href: fallbackAction.href || ''
    };
    clickElement(fallbackAction);
    await sleep(1200);
    if (await waitForPublishForm(3500)) return true;
  }
  return false;
}

async function selectManualCategoryPath(task, keyword) {
  if (!(await openManualCategorySelector(task, keyword))) return false;
  if (!(await selectCategoryBrand(task))) throw fail('未找到淘宝品牌必填控件', 'select-category');
  const manualContinuation = await waitForCategoryContinuation(null, null);
  if (!manualContinuation) throw fail('未找到淘宝类目确认按钮', 'select-category');
  categoryAttempt.continuation = {
    selector: cssSelectorForDiagnostics(manualContinuation),
    text: categoryActionLabel(manualContinuation),
    href: manualContinuation.href || ''
  };
  await trustedClickElement(manualContinuation);
  clickElement(manualContinuation);
  return waitForPublishForm(5000);
}

function categoryActionLabel(element) {
  return text(element?.innerText || element?.textContent || element?.getAttribute?.('aria-label') || element?.title)
    .replace(/\s+/g, '');
}

function isCategoryAction(element) {
  if (!element || !visible(element) || disabled(element)) return false;
  if (!['BUTTON', 'A'].includes(element.tagName) && element.getAttribute('role') !== 'button') return false;
  if (String(element.href || '').includes('copyItem=true')) return false;
  const label = categoryActionLabel(element);
  return label && !label.includes('\u641c\u7d22') && categoryActionWords.some(word => label.includes(word));
}

function categoryResultRoots(selected, keyword) {
  const lowerKeyword = text(keyword).toLocaleLowerCase('zh-CN');
  const roots = [];
  let node = selected;
  for (let index = 0; node && index < 6 && node !== document.body; index += 1, node = node.parentElement) {
    const label = text(node.innerText || node.textContent).toLocaleLowerCase('zh-CN');
    if (label.includes(lowerKeyword) && label.length <= 1200) roots.push(node);
  }
  return roots;
}

function findCategoryAction(selected, keyword) {
  for (const root of categoryResultRoots(selected, keyword)) {
    const candidates = [root, ...root.querySelectorAll('button, [role="button"], a')]
      .filter(isCategoryAction)
      .sort((left, right) => categoryActionLabel(left).length - categoryActionLabel(right).length);
    if (candidates[0]) return candidates[0];
  }
  return null;
}

function findCategoryContinuation(selected, excluded) {
  const confirmationOnly = label => label.includes('\u4e0b\u4e00\u6b65') || label.includes('\u786e\u8ba4');
  const candidates = [...document.querySelectorAll('button, [role="button"], a, span, div')]
    .filter(element => element !== excluded)
    .filter(element => visible(element) && !disabled(element))
    .filter(element => confirmationOnly(categoryActionLabel(element)))
    .map(element => element.closest('button, [role="button"], a') || element)
    .filter((element, index, list) => list.indexOf(element) === index)
    .filter(isCategoryAction)
    .sort((left, right) => {
      const preferred = label => {
        if (label.includes('\u4e0b\u4e00\u6b65') || label.includes('\u786e\u8ba4')) return 0;
        return 1;
      };
      return preferred(categoryActionLabel(left)) - preferred(categoryActionLabel(right))
        || categoryActionLabel(left).length - categoryActionLabel(right).length;
    });
  return candidates[0] || null;
}

async function waitForCategoryContinuation(selected, excluded, timeoutMs = 5000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const continuation = findCategoryContinuation(selected, excluded);
    if (continuation) return continuation;
    await sleep(200);
  }
  return null;
}

async function waitForPublishForm(timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (!isCategoryEntryPage()) return true;
    if (findField(['标题', '宝贝标题', '商品标题'])) return true;
    await sleep(500);
  }
  return false;
}

async function selectTaobaoCategory(task) {
  const keyword = categoryKeyword(task);
  if (!keyword) throw fail('缺少淘宝类目搜索词', 'select-category');
  const field = await ensureCategorySearchMode(task);
  if (!field) throw fail('未找到淘宝类目搜索输入框', 'select-category');
  setNativeValue(field, keyword);
  field.focus();
  dispatchEnter(field);
  await sleep(1200);
  const searchButton = findButton(['搜索', '查询'], selectors(task).categorySearchButton);
  if (searchButton) {
    clickElement(searchButton);
    await sleep(1200);
  }
  categoryAttempt = { keyword };
  categoryAttempt.mode = 'search';
  if (await selectSearchCategoryCandidate(task, keyword)) return;
  categoryAttempt.mode = 'manual-fallback';
  if (await selectManualCategoryPath(task, keyword)) return;
  throw fail(`已尝试搜索关键词和备用路径，但未进入淘宝发布表单：${keyword}`, 'select-category');
}

async function preparePublishForm(task) {
  if (isTaobaoLoginPage()) throw fail('淘宝登录已失效，请先登录淘宝后重试', 'login');
  if (!isCategoryEntryPage()) return false;
  await report(task.id, STATUS.filling, { detail: { step: 'select-category', url: location.href } });
  await selectTaobaoCategory(task);
  await sleep(800);
  return false;
}

function pageText() {
  return text(document.body?.innerText || document.body?.textContent || '');
}

function findValidationError() {
  const keywords = [
    '\u5fc5\u586b',
    '\u4e0d\u80fd\u4e3a\u7a7a',
    '\u8bf7\u9009\u62e9',
    '\u672a\u586b\u5199',
    '\u9519\u8bef',
    '\u5931\u8d25',
    '\u6821\u9a8c',
    '\u8fdd\u89c4'
  ];
  const allText = pageText();
  const keyword = keywords.find(item => allText.includes(item));
  if (!keyword) return '';
  const lines = allText.split('\n').map(line => text(line)).filter(Boolean);
  return lines.find(line => line.includes(keyword)) || keyword;
}

async function waitForDraftSaved(timeoutMs = 10000) {
  const successKeywords = [
    '\u4fdd\u5b58\u6210\u529f',
    '\u5df2\u4fdd\u5b58',
    '\u63d0\u4ea4\u6210\u529f'
  ];
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const validationError = findValidationError();
    if (validationError) {
      return { ok: false, reason: validationError };
    }
    const allText = pageText();
    const matched = successKeywords.find(item => allText.includes(item));
    if (matched || /draft/i.test(location.href)) {
      return { ok: true, confirmation: matched || 'url:draft' };
    }
    await sleep(500);
  }
  return { ok: false, reason: '\u4fdd\u5b58\u6309\u94ae\u5df2\u70b9\u51fb\uff0c\u4f46\u672a\u68c0\u6d4b\u5230\u8349\u7a3f\u4fdd\u5b58\u6210\u529f\u63d0\u793a' };
}

function dataUrlToFile(dataUrl, name, type) {
  const [header, payload] = String(dataUrl || '').split(',');
  if (!payload || !/^data:/i.test(header)) throw fail(`图片数据无效：${name}`, 'fetch-image');
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new File([bytes], name || 'image.jpg', { type: type || header.match(/^data:([^;]+)/i)?.[1] || 'image/jpeg' });
}

async function fetchFile(task, image, group, index) {
  const response = await chrome.runtime.sendMessage({
    type: 'CAISHEN_TAOBAO_FETCH_IMAGE',
    taskId: task.id,
    group: image._group || group,
    index: Number.isInteger(image._index) ? image._index : index,
    name: image.name
  });
  if (!response?.ok || !response.image?.dataUrl) throw fail(response?.error || `图片读取失败：${image.name}`, 'fetch-image');
  return dataUrlToFile(response.image.dataUrl, response.image.name || image.name, response.image.type);
}

async function assignFiles(task, input, images, group, step) {
  if (!input || !images.length) return false;
  const transfer = new DataTransfer();
  for (let index = 0; index < images.length; index += 1) transfer.items.add(await fetchFile(task, images[index], group, index));
  input.files = transfer.files;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(800);
  await report(task.id, STATUS.uploading, { detail: { step, files: transfer.files.length } });
  return true;
}

function uploadBusyElements() {
  const candidates = [
    ...document.querySelectorAll('[aria-busy="true"], [role="progressbar"], .ant-upload-list-item-uploading, .next-upload-list-item-uploading, .uploading, .loading, .spinner, .ant-spin, .next-loading')
  ];
  const busyText = /上传中|处理中|正在上传|等待上传|解析中|uploading|processing/i;
  candidates.push(...[...document.querySelectorAll('[class], [id], span, div')]
    .filter(element => {
      const marker = `${element.className || ''} ${element.id || ''}`.toLocaleLowerCase('zh-CN');
      if (!/(upload|progress|loading|spin)/i.test(marker)) return false;
      return busyText.test(text(element.innerText || element.textContent || element.getAttribute('aria-label') || ''));
    }));
  return candidates.filter(visible);
}

async function waitForUploadSettled(task, timeoutMs = 60000) {
  const started = Date.now();
  let quietChecks = 0;
  let lastBusyCount = 0;
  while (Date.now() - started < timeoutMs) {
    const busy = uploadBusyElements();
    lastBusyCount = busy.length;
    if (!busy.length) quietChecks += 1;
    else quietChecks = 0;
    if (quietChecks >= 3) {
      await report(task.id, STATUS.uploading, { detail: { step: 'upload-settled', waitedMs: Date.now() - started } });
      return;
    }
    await sleep(1000);
  }
  throw fail(`图片上传仍在处理中，已等待 ${Math.round((Date.now() - started) / 1000)} 秒，忙碌控件 ${lastBusyCount} 个`, 'upload-settled');
}

function fileInputs() {
  return [...document.querySelectorAll('input[type="file"]')];
}

function fileInputFromSelector(selector = '') {
  const selected = query(selector);
  if (!selected) return null;
  if (selected.matches?.('input[type="file"]')) return selected;
  return selected.querySelector?.('input[type="file"]') || null;
}

function queryFileInput(task, selectorKey) {
  return fileInputFromSelector(selectors(task)[selectorKey]);
}

function findFileInput(task, selectorKey, keywords) {
  const selected = queryFileInput(task, selectorKey);
  if (selected) return selected;
  const candidates = fileInputs();
  return byKeywords(candidates, keywords) || null;
}

function uploadTriggerTarget(element, section) {
  let best = element;
  let node = element;
  for (let depth = 0; node && node !== section && depth < 6; depth += 1, node = node.parentElement) {
    const rect = node.getBoundingClientRect?.();
    if (!rect || rect.width <= 0 || rect.height <= 0 || rect.width > 260 || rect.height > 260) continue;
    best = node;
  }
  return best;
}

function findUploadTrigger(sectionSelector) {
  const section = query(sectionSelector);
  if (!section) return null;
  const wanted = ['上传图片', '添加图片', '选择图片'];
  const matches = [...section.querySelectorAll('button, [role="button"], a, label, div, span')]
    .filter(visible)
    .filter(element => wanted.includes(text(element.innerText || element.textContent).replace(/\s+/g, '')))
    .sort((left, right) => {
      const leftRect = left.getBoundingClientRect();
      const rightRect = right.getBoundingClientRect();
      return (leftRect.width * leftRect.height) - (rightRect.width * rightRect.height);
    });
  if (matches[0]) return uploadTriggerTarget(matches[0], section);
  const structural = [...section.querySelectorAll('button, [role="button"], label, div')]
    .filter(visible)
    .filter(element => !disabled(element))
    .map(element => {
      const rect = element.getBoundingClientRect();
      const marker = `${element.className || ''} ${element.id || ''} ${element.getAttribute('aria-label') || ''}`.toLocaleLowerCase('zh-CN');
      const label = text(element.innerText || element.textContent).replace(/\s+/g, '');
      const uploadHint = /(upload|uploader|image|img|pic|picture|file|media)/i.test(marker);
      const emptyUploadCard = rect.width >= 44 && rect.width <= 220 && rect.height >= 44 && rect.height <= 220 && label.length <= 30;
      return { element, rect, score: (uploadHint ? 20 : 0) + (emptyUploadCard ? 12 : 0) };
    })
    .filter(item => item.score > 0)
    .sort((left, right) => right.score - left.score || (left.rect.width * left.rect.height) - (right.rect.width * right.rect.height));
  return structural[0]?.element || null;
}

function uploadEvidenceCount(sectionSelector) {
  const section = query(sectionSelector);
  if (!section) return 0;
  return [
    ...section.querySelectorAll('img, [style*="background-image"], .ant-upload-list-item, .next-upload-list-item')
  ].filter(visible).length;
}

async function waitForUploadEvidence(sectionSelector, beforeCount, timeoutMs = 3500) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (uploadEvidenceCount(sectionSelector) > beforeCount) return true;
    await sleep(250);
  }
  return false;
}

async function waitForNewFileInput(existingInputs = [], timeoutMs = 2500) {
  const existing = new Set(existingInputs);
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const input = fileInputs().find(item => !existing.has(item));
    if (input) return input;
    await sleep(120);
  }
  return null;
}

async function uploadWithDynamicInput(task, trigger, images, group, step) {
  if (!trigger || !images.length) return false;
  const before = fileInputs();
  trigger.scrollIntoView?.({ block: 'center', inline: 'center' });
  await sleep(120);
  clickElement(trigger);
  const input = await waitForNewFileInput(before);
  if (!(await assignFiles(task, input, images, group, step))) return false;
  await report(task.id, STATUS.uploading, {
    detail: { step, files: images.length, uploadMode: 'dynamic-input' }
  });
  return true;
}

async function uploadWithChooserTarget(task, target, images, group, step, mode = '') {
  if (!target || !images.length) return false;
  target.scrollIntoView?.({ block: 'center', inline: 'center' });
  await sleep(200);
  const point = trustedClickPoint(target);
  uploadAttempt.lastChooserTarget = {
    mode,
    group,
    step,
    selector: cssSelectorForDiagnostics(target),
    text: text(target.innerText || target.textContent || target.getAttribute?.('aria-label') || target.title).slice(0, 120),
    point
  };
  const response = await chrome.runtime.sendMessage({
    type: 'CAISHEN_TAOBAO_UPLOAD_FILES',
    taskId: task.id,
    group,
    useCachedUploadFiles: true,
    images: images.map(image => ({
      name: image.name,
      _group: image._group,
      _index: image._index
    })),
    x: point.x,
    y: point.y
  });
  if (!response?.ok) throw fail(response?.error || `淘宝${step}上传失败`, step);
  await report(task.id, STATUS.uploading, {
    detail: { step, files: response.files || images.length, chooserMode: response.mode || mode }
  });
  await sleep(1200);
  return true;
}

function findTaobaoPickerUploadTrigger(originalTrigger) {
  const wanted = ['本地上传', '上传本地图片', '点击上传'];
  const pageUploadSections = [
    '#struct-mainImagesGroup',
    '#struct-threeToFourImages',
    '#sell-field-threeToFourImages'
  ].map(selector => query(selector)).filter(Boolean);
  const originalSection = originalTrigger?.closest?.('#struct-mainImagesGroup, #struct-threeToFourImages, #sell-field-threeToFourImages');
  return [...document.querySelectorAll('button, [role="button"], a, label, div, span')]
    .filter(visible)
    .filter(element => !originalSection || !originalSection.contains(element))
    .filter(element => !pageUploadSections.some(section => section.contains(element)))
    .filter(element => {
      const label = text(element.innerText || element.textContent || element.getAttribute('aria-label') || element.title).replace(/\s+/g, '');
      return wanted.some(item => label === item || label.includes(item));
    })
    .map(element => {
      const label = text(element.innerText || element.textContent || element.getAttribute('aria-label') || element.title).replace(/\s+/g, '');
      const target = element.closest('button, [role="button"], label, a') || element;
      const localUpload = label === '本地上传' || label.includes('上传本地图片');
      const upload = label === '点击上传';
      return { element: target, label, score: (localUpload ? 100 : 0) + (upload ? 20 : 0) };
    })
    .sort((left, right) => {
      const leftRect = left.element.getBoundingClientRect();
      const rightRect = right.element.getBoundingClientRect();
      return right.score - left.score || (leftRect.width * leftRect.height) - (rightRect.width * rightRect.height);
    })[0]?.element || null;
}

function collectTaobaoPickerUploadCandidates(originalTrigger) {
  const pageUploadSections = [
    '#struct-mainImagesGroup',
    '#struct-threeToFourImages',
    '#sell-field-threeToFourImages'
  ].map(selector => query(selector)).filter(Boolean);
  const originalSection = originalTrigger?.closest?.('#struct-mainImagesGroup, #struct-threeToFourImages, #sell-field-threeToFourImages');
  return [...document.querySelectorAll('button, [role="button"], a, label, div, span')]
    .filter(visible)
    .filter(element => !originalSection || !originalSection.contains(element))
    .filter(element => !pageUploadSections.some(section => section.contains(element)))
    .map(element => ({
      selector: cssSelectorForDiagnostics(element),
      text: text(element.innerText || element.textContent || element.getAttribute('aria-label') || element.title).slice(0, 80)
    }))
    .filter(item => item.text && item.text.length <= 80 && /上传|本地|选择图片|图片空间/.test(item.text))
    .slice(0, 20);
}

async function waitForTaobaoPickerUploadTrigger(originalTrigger, timeoutMs = 12000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const trigger = findTaobaoPickerUploadTrigger(originalTrigger);
    if (trigger) return trigger;
    await sleep(200);
  }
  return null;
}

async function uploadWithTaobaoPicker(task, trigger, images, group, step) {
  if (!trigger || !images.length) return false;
  const before = fileInputs();
  await trustedClickElement(trigger, '上传图片');
  clickElement(trigger);
  await sleep(900);
  const uploadEntry = await waitForTaobaoPickerUploadTrigger(trigger);
  uploadAttempt.taobaoPicker = {
    group,
    step,
    trigger: cssSelectorForDiagnostics(trigger),
    uploadEntry: uploadEntry ? {
      selector: cssSelectorForDiagnostics(uploadEntry),
      text: text(uploadEntry.innerText || uploadEntry.textContent || uploadEntry.getAttribute?.('aria-label') || uploadEntry.title).slice(0, 120)
    } : null,
    candidates: collectTaobaoPickerUploadCandidates(trigger)
  };
  if (uploadEntry) {
    if (await uploadWithChooserTarget(task, uploadEntry, images, group, step, 'taobao-picker')) return true;
  }
  const input = await waitForNewFileInput(before, 5000);
  if (!(await assignFiles(task, input, images, group, step))) return false;
  await report(task.id, STATUS.uploading, {
    detail: { step, files: images.length, uploadMode: 'taobao-picker' }
  });
  return true;
}

async function uploadWithDrop(task, trigger, images, group, step, sectionSelector) {
  if (!trigger || !images.length) return false;
  const beforeCount = uploadEvidenceCount(sectionSelector);
  trigger.scrollIntoView?.({ block: 'center', inline: 'center' });
  await sleep(160);
  const transfer = new DataTransfer();
  for (let index = 0; index < images.length; index += 1) {
    transfer.items.add(await fetchFile(task, images[index], group, index));
  }
  for (const type of ['dragenter', 'dragover', 'drop']) {
    trigger.dispatchEvent(new DragEvent(type, {
      bubbles: true,
      cancelable: true,
      dataTransfer: transfer
    }));
    await sleep(type === 'drop' ? 600 : 80);
  }
  if (!(await waitForUploadEvidence(sectionSelector, beforeCount))) return false;
  await report(task.id, STATUS.uploading, {
    detail: { step, files: transfer.files.length, uploadMode: 'drop' }
  });
  return true;
}

async function uploadWithFileChooser(task, trigger, images, group, step) {
  return uploadWithChooserTarget(task, trigger, images, group, step, 'direct');
}

async function revealUploadControls(task) {
  const uploadButton = findButton(['上传图片', '上传', '选择图片', '添加图片', '图片空间'], selectors(task).uploadButton);
  if (uploadButton) {
    clickElement(uploadButton);
    await sleep(800);
  }
}

async function uploadImages(task) {
  const images = task.images || {};
  const mainImages = images.mainImages || [];
  const ratioImages = images.ratioImages || [];
  const detailImages = images.detailImages || [];
  const taggedMainImages = mainImages.map((image, index) => ({ ...image, _group: 'main', _index: index }));
  const taggedRatioImages = ratioImages.map((image, index) => ({ ...image, _group: 'ratio', _index: index }));
  const taggedDetailImages = detailImages.map((image, index) => ({ ...image, _group: 'detail', _index: index }));
  const allImages = [...taggedMainImages, ...taggedRatioImages, ...taggedDetailImages];
  if (!allImages.length) throw fail('任务包没有可上传图片', 'upload');

  await revealUploadControls(task);
  if (!fileInputs().length) {
    const uploaded = [];
    const mainTrigger = findUploadTrigger('#struct-mainImagesGroup');
    if (await uploadWithDrop(task, mainTrigger, taggedMainImages, 'main', 'mainImages', '#struct-mainImagesGroup')
      || await uploadWithDynamicInput(task, mainTrigger, taggedMainImages, 'main', 'mainImages')
      || await uploadWithTaobaoPicker(task, mainTrigger, taggedMainImages, 'main', 'mainImages')
      || await uploadWithFileChooser(task, mainTrigger, taggedMainImages, 'main', 'mainImages')) uploaded.push('main');
    const ratioTrigger = findUploadTrigger('#sell-field-threeToFourImages');
    if (await uploadWithDrop(task, ratioTrigger, taggedRatioImages, 'ratio', 'ratioImages', '#sell-field-threeToFourImages')
      || await uploadWithDynamicInput(task, ratioTrigger, taggedRatioImages, 'ratio', 'ratioImages')
      || await uploadWithTaobaoPicker(task, ratioTrigger, taggedRatioImages, 'ratio', 'ratioImages')
      || await uploadWithFileChooser(task, ratioTrigger, taggedRatioImages, 'ratio', 'ratioImages')) uploaded.push('ratio');
    if (!uploaded.length) throw fail('未找到淘宝图片上传控件', 'upload');
    return;
  }

  const allSelector = selectors(task).allImages;
  if (allSelector) {
    const target = fileInputFromSelector(allSelector);
    if (await assignFiles(task, target, allImages, 'main', 'allImages')) return;
  }

  const uploaded = [];
  const mainInput = findFileInput(task, 'mainImages', ['主图', '商品图片', '宝贝图片']);
  if (await assignFiles(task, mainInput, taggedMainImages, 'main', 'mainImages')) uploaded.push('main');

  const ratioInput = findFileInput(task, 'ratioImages', ['3:4', '3-4', '长图', '竖图']);
  if (await assignFiles(task, ratioInput, taggedRatioImages, 'ratio', 'ratioImages')) uploaded.push('ratio');

  const detailInput = findFileInput(task, 'detailImages', ['详情', '描述', '详情图']);
  if (await assignFiles(task, detailInput, taggedDetailImages, 'detail', 'detailImages')) uploaded.push('detail');

  if (uploaded.length) return;

  const fallback = fileInputs()[0];
  if (!(await assignFiles(task, fallback, allImages, 'main', 'fallbackAllImages'))) {
    throw fail('图片上传控件存在，但无法写入文件', 'upload');
  }
}

async function fillDefaults(task) {
  const defaults = task.category?.defaults || {};
  const map = selectors(task);
  await fillField(['标题', '宝贝标题', '商品标题'], task.title, map.title);
  await fillField(['价格', '一口价', '销售价'], defaults.price, map.price);
  await fillField(['库存', '数量'], defaults.stock, map.stock);
  await fillField(['发货地'], defaults.shipFrom, map.shipFrom);
  await clickFieldOrOption(['运费模板'], defaults.freightTemplate, map.freightTemplate);
  await clickFieldOrOption(['服务模板'], defaults.serviceTemplate, map.serviceTemplate);
  for (const [key, value] of Object.entries(defaults.attributes || {})) {
    await fillField([key], value, map[`attribute.${key}`]);
  }
  await fillCustomFields(task);
}

async function fillCustomFields(task) {
  const customFields = Array.isArray(task.category?.defaults?.customFields) ? task.category.defaults.customFields : [];
  for (const item of customFields) {
    const label = text(item?.label);
    const value = text(item?.value);
    const selector = text(item?.selector);
    const type = text(item?.type || 'text');
    if (!label || !value) continue;
    if (type === 'click') {
      await clickFieldOrOption([label], value, selector);
    } else if (type === 'select') {
      const field = findField([label], selector);
      if (field) await setSelectValue(field, value);
      else await clickFieldOrOption([label], value, selector);
    } else {
      await fillField([label], value, selector);
    }
  }
}

async function confirmSaveDraftIfPrompted(excludedButton) {
  await sleep(300);
  const dialog = [...document.querySelectorAll('[role="dialog"], .ant-modal, .next-dialog, .el-dialog')].find(visible);
  const candidates = [...(dialog || document).querySelectorAll('button, [role="button"], a')]
    .filter(element => element !== excludedButton)
    .filter(visible)
    .filter(element => !disabled(element));
  const keywords = dialog
    ? ['确认', '确定', '继续', '保存']
    : ['确认保存', '继续保存', '仍要保存'];
  const confirmButton = candidates.find(element => {
    const label = text(element.innerText || element.textContent || element.getAttribute('aria-label') || element.title);
    return keywords.some(keyword => label.includes(keyword));
  });
  if (!confirmButton) return false;
  clickElement(confirmButton);
  await sleep(800);
  return true;
}

async function saveDraft(task) {
  const button = await waitForButton(['保存草稿', '存草稿', '保存'], selectors(task).saveDraft);
  if (!button) throw fail('未找到保存草稿按钮', 'save-draft');
  clickElement(button);
  await confirmSaveDraftIfPrompted(button);
  const result = await waitForDraftSaved();
  if (!result.ok) throw fail(result.reason, 'save-draft');
  await report(task.id, STATUS.saved, { detail: { savedAt: new Date().toISOString(), confirmation: result.confirmation } });
}

function collectVisibleFields() {
  return fields().slice(0, 40).map((element, index) => ({
    index,
    selector: cssSelectorForDiagnostics(element),
    tag: element.tagName.toLowerCase(),
    type: element.type || '',
    id: element.id || '',
    name: element.name || '',
    placeholder: element.placeholder || '',
    value: text(element.isContentEditable ? element.textContent : element.value).slice(0, 80),
    label: text(labelText(element)).slice(0, 160)
  }));
}

function collectVisibleSelects() {
  return [...document.querySelectorAll('select, [role="combobox"], [aria-haspopup="listbox"], [aria-haspopup="menu"]')]
    .filter(visible)
    .slice(0, 40)
    .map((element, index) => ({
      index,
      selector: cssSelectorForDiagnostics(element),
      tag: element.tagName.toLowerCase(),
      id: element.id || '',
      name: element.name || '',
      value: text(element.value || element.getAttribute('aria-valuetext') || '').slice(0, 80),
      label: text(labelText(element)).slice(0, 160),
      text: text(element.innerText || element.textContent || '').slice(0, 160)
    }));
}

function collectDiagnostics(step) {
  const buttons = [...document.querySelectorAll('button, [role="button"], a')]
    .filter(visible)
    .slice(0, 40)
    .map(element => ({
      selector: cssSelectorForDiagnostics(element),
      text: text(element.innerText || element.textContent || element.getAttribute('aria-label') || element.title),
      href: element.href || ''
    }))
    .filter(item => item.text);
  const inputs = fileInputs().map((input, index) => ({
    index,
    selector: cssSelectorForDiagnostics(input),
    id: input.id || '',
    name: input.name || '',
    accept: input.accept || '',
    label: text(labelText(input)).slice(0, 160)
  }));
  return {
    step,
    url: location.href,
    title: document.title,
    validationError: findValidationError(),
    fileInputs: inputs,
    visibleFields: collectVisibleFields(),
    visibleSelects: collectVisibleSelects(),
    visibleButtons: buttons,
    categoryAttempt,
    uploadAttempt
  };
}

async function runPublish(task) {
  if (!task?.id) throw fail('任务包缺少 ID', 'start');
  uploadAttempt = {};
  await preparePublishForm(task);
  await report(task.id, STATUS.filling, { detail: { step: 'fill' } });
  await fillDefaults(task);
  await report(task.id, STATUS.uploading, { detail: { step: 'upload' } });
  await uploadImages(task);
  await waitForUploadSettled(task);
  await report(task.id, STATUS.saving, { detail: { step: 'save' } });
  await saveDraft(task);
}
