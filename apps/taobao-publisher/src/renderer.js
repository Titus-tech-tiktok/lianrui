import { PublisherApi } from './publisher-api.js';

const api = new PublisherApi();
const state = {
  user: null,
  token: '',
  settings: null,
  stores: [],
  tasks: [],
  deviceId: localStorage.getItem('caishen.publisher.deviceId') || crypto.randomUUID(),
  appVersion: '',
  activeStoreId: '',
  activeTaskId: '',
  taskFilter: 'all',
  autoPublish: localStorage.getItem('caishen.publisher.autoPublish') !== 'false',
  dryRun: localStorage.getItem('caishen.publisher.dryRun') === 'true',
  runningTaskId: '',
  lastTemplateDiagnostics: null,
  templateSelectorChecks: {},
  syncStatus: {
    state: 'idle',
    startedAt: '',
    lastSuccessAt: '',
    lastError: ''
  },
  lastPublisherBlocker: ''
};

localStorage.setItem('caishen.publisher.deviceId', state.deviceId);

const $ = selector => document.querySelector(selector);
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const failedStatuses = new Set(['失败', '发布失败', '需要人工处理', '模板未配置', '已暂停']);
const skippedStatuses = new Set(['已跳过本地发布']);
const dryRunStatuses = new Set(['试运行通过']);
const runningStatuses = new Set(['插件已接收', '本地发布器已领取', '正在打开淘宝', '正在填写模板', '正在上传图片', '正在保存草稿']);
const waitingStatuses = new Set(['待发布', '等待插件接收', '等待本地发布器领取']);

function getActiveStore() {
  return state.stores.find(store => store.id === state.activeStoreId) || null;
}

function activeStoreStorageKey(userId = state.user?.id) {
  return userId ? `caishen.publisher.activeStoreId.${userId}` : 'caishen.publisher.activeStoreId';
}

function readSavedActiveStoreId(userId = state.user?.id) {
  if (!userId) return '';
  return localStorage.getItem(activeStoreStorageKey(userId)) || '';
}

function saveActiveStoreId(storeId = state.activeStoreId) {
  localStorage.removeItem('caishen.publisher.activeStoreId');
  if (!state.user?.id) return;
  const key = activeStoreStorageKey();
  if (storeId) {
    localStorage.setItem(key, storeId);
  } else {
    localStorage.removeItem(key);
  }
}

function formatSyncTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString();
}

function renderSyncStatus() {
  const card = $('#syncStatusCard');
  const label = $('#syncStatusLabel');
  const lastSuccess = $('#syncLastSuccessAt');
  const lastError = $('#syncLastError');
  if (!card || !label || !lastSuccess || !lastError) return;
  const status = state.syncStatus || {};
  card.classList.remove('sync-status-ok', 'sync-status-error', 'sync-status-running');
  if (!state.user) {
    label.textContent = '未登录';
    lastSuccess.textContent = '登录 Web 账号后开始同步';
    lastError.textContent = '';
    return;
  }
  if (status.state === 'running') {
    card.classList.add('sync-status-running');
    label.textContent = '同步中';
  } else if (status.state === 'error') {
    card.classList.add('sync-status-error');
    label.textContent = '同步失败';
  } else if (status.lastSuccessAt) {
    card.classList.add('sync-status-ok');
    label.textContent = '同步正常';
  } else {
    label.textContent = '等待同步';
  }
  lastSuccess.textContent = status.lastSuccessAt
    ? `上次成功：${formatSyncTime(status.lastSuccessAt)}`
    : '还没有成功同步';
  lastError.textContent = status.lastError ? `最近错误：${status.lastError}` : '';
}

function recordSyncStart() {
  state.syncStatus = {
    ...(state.syncStatus || {}),
    state: 'running',
    startedAt: new Date().toISOString()
  };
  renderSyncStatus();
}

function recordSyncSuccess() {
  state.syncStatus = {
    ...(state.syncStatus || {}),
    state: 'ok',
    lastSuccessAt: new Date().toISOString(),
    lastError: ''
  };
  renderSyncStatus();
}

function recordSyncFailure(error) {
  const message = error?.message || String(error || '同步失败');
  state.syncStatus = {
    ...(state.syncStatus || {}),
    state: 'error',
    lastError: message
  };
  renderSyncStatus();
  log(`同步失败：${message}`);
}

function filterStoresForCurrentUser(stores = []) {
  if (!state.user?.id) return [];
  return (stores || []).filter(store => !store.ownerUserId || store.ownerUserId === state.user?.id);
}

function chooseActiveStoreId(preferredStoreId = '') {
  const candidates = [state.activeStoreId, readSavedActiveStoreId(), preferredStoreId].filter(Boolean);
  const matched = candidates.find(storeId => state.stores.some(store => store.id === storeId));
  return matched || state.stores[0]?.id || '';
}

function setVisibleStores(stores = []) {
  state.stores = filterStoresForCurrentUser(stores || []);
  state.activeStoreId = chooseActiveStoreId();
  saveActiveStoreId();
}

function nextTemporaryStoreName() {
  const nextIndex = state.stores.filter(store => String(store.name || '').startsWith('未命名淘宝店铺')).length + 1;
  return `未命名淘宝店铺 ${nextIndex}`;
}

function publisherBlocker({ requireAuto = true } = {}) {
  if (!state.user) return '请先登录 Web 账号';
  if (!state.activeStoreId) return '请先添加并选择淘宝店铺';
  const activeStore = getActiveStore();
  if (!activeStore) return '请先添加并选择淘宝店铺';
  if (activeStore.online !== true) return '当前淘宝店铺未确认登录，请在店铺管理中登录并检查登录状态';
  if (requireAuto && activeStore.autoPublish === false) return '当前淘宝店铺已停用自动发布，只同步任务，不会领取发布';
  if (requireAuto && !state.autoPublish) return '自动发布已关闭，只同步任务，不会领取发布';
  return '';
}

function logPublisherBlocker(message) {
  if (!message || state.lastPublisherBlocker === message) return;
  state.lastPublisherBlocker = message;
  log(message);
}

function templateReadinessSummary() {
  const categories = state.settings?.categories || [];
  const requiredFields = ['brandName', 'modelName', 'price', 'stock'];
  const incomplete = categories.filter(category => {
    const defaults = category.defaults || {};
    return requiredFields.some(field => !String(defaults[field] || '').trim());
  });
  return {
    total: categories.length,
    ready: Math.max(0, categories.length - incomplete.length),
    incomplete
  };
}

function templateCalibrationSummary() {
  const categories = state.settings?.categories || [];
  const items = categories.map((category, index) => {
    const defaults = category.defaults || {};
    const selectorStatus = templateSelectorStatus(defaults);
    const selectorSignature = templateSelectorSignature(defaults);
    const checkKey = category.id || String(index);
    const savedCalibration = defaults.selectorCalibration?.[state.activeStoreId];
    const savedCalibrationStale = Boolean(savedCalibration?.selectorSignature && savedCalibration.selectorSignature !== selectorSignature);
    const check = state.templateSelectorChecks[checkKey] || (savedCalibrationStale ? null : savedCalibration);
    const missingFromPage = Array.isArray(check?.missing)
      ? check.missing.map(item => item.key || item.selector).filter(Boolean)
      : [];
    let status = 'unchecked';
    let label = '未检查';
    let detail = '需要打开对应淘宝发布页后检查一次控件';
    if (selectorStatus.missing.length) {
      status = 'missing';
      label = '未配置';
      detail = `缺少页面控件规则：${selectorStatus.missing.join('、')}`;
    } else if (savedCalibrationStale) {
      status = 'calibration-stale';
      label = '需重检';
      detail = '模板控件规则已变更，需要重新检查当前淘宝页面控件';
    } else if (check?.ok) {
      status = 'ok';
      label = '已通过';
      detail = `当前淘宝页面已找到 ${Array.isArray(check.found) ? check.found.length : selectorStatus.total}/${Number(check.total || selectorStatus.total)} 个控件`;
    } else if (check) {
      status = 'failed';
      label = '未通过';
      detail = `淘宝页面缺少：${missingFromPage.join('、') || '未知控件'}`;
    }
    return {
      id: checkKey,
      name: category.name || category.id || `类目 ${index + 1}`,
      status,
      label,
      detail
    };
  });
  return {
    total: items.length,
    passed: items.filter(item => item.status === 'ok').length,
    blocked: items.filter(item => item.status !== 'ok'),
    items
  };
}

async function persistTemplateSelectorCheck(categoryIndex, result = {}) {
  if (!state.activeStoreId || !state.settings?.categories?.[categoryIndex]) return;
  const categories = collectCategoryTemplates();
  const category = categories[categoryIndex];
  if (!category) return;
  category.defaults = { ...(category.defaults || {}) };
  category.defaults.selectorCalibration = {
    ...(category.defaults.selectorCalibration || {}),
    [state.activeStoreId]: {
      ok: Boolean(result.ok),
      selectorSignature: templateSelectorSignature(category.defaults),
      total: Number(result.total || 0),
      found: Array.isArray(result.found) ? result.found.map(item => ({ key: item.key, selector: item.selector, found: Boolean(item.found) })) : [],
      missing: Array.isArray(result.missing) ? result.missing.map(item => ({ key: item.key, selector: item.selector, found: Boolean(item.found), error: item.error || '' })) : [],
      url: result.url || '',
      title: result.title || '',
      checkedAt: new Date().toISOString()
    }
  };
  state.settings = await api.saveSettings({ ...(state.settings || {}), categories });
}

function buildReadinessItems() {
  const activeStore = getActiveStore();
  const templateSummary = templateReadinessSummary();
  const calibrationSummary = templateCalibrationSummary();
  const waitingTasks = (state.tasks || []).filter(task => waitingStatuses.has(task.status));
  const blockedTasks = (state.tasks || []).filter(task => failedStatuses.has(task.status));
  return [
    {
      ok: Boolean(state.user),
      label: 'Web 账号',
      detail: state.user ? `已登录：${state.user.displayName || state.user.username}` : '未登录，不能同步运营任务'
    },
    {
      ok: Boolean(state.appVersion),
      label: '发布器版本',
      detail: state.appVersion ? `当前版本：${state.appVersion}` : '未读取到本地发布器版本'
    },
    {
      ok: Boolean(activeStore),
      label: '当前淘宝店铺',
      detail: activeStore ? activeStore.name : '未选择店铺，不能领取发布任务'
    },
    {
      ok: Boolean(activeStore?.online),
      label: '淘宝登录状态',
      detail: activeStore?.online ? '已确认登录有效' : '需要在店铺管理里登录或检查登录'
    },
    {
      ok: Boolean(state.autoPublish && activeStore?.autoPublish !== false),
      label: '自动发布开关',
      detail: state.autoPublish && activeStore?.autoPublish !== false ? '已开启，满足条件后会自动领取' : '当前只同步任务，不会自动执行'
    },
    {
      ok: templateSummary.total > 0 && templateSummary.incomplete.length === 0,
      label: '类目模板',
      detail: templateSummary.total
        ? `${templateSummary.ready}/${templateSummary.total} 个模板已补齐必填字段`
        : '还没有可用类目模板'
    },
    {
      ok: calibrationSummary.total > 0 && calibrationSummary.blocked.length === 0,
      label: '页面控件校准',
      detail: calibrationSummary.total
        ? `${calibrationSummary.passed}/${calibrationSummary.total} 个模板已通过当前淘宝页面控件检查`
        : '还没有可校准的类目模板'
    },
    {
      ok: waitingTasks.length > 0,
      label: '待发布队列',
      detail: waitingTasks.length ? `${waitingTasks.length} 个任务等待发布` : '暂无匹配的待发布任务'
    },
    {
      ok: blockedTasks.length === 0,
      label: '异常任务',
      detail: blockedTasks.length ? `${blockedTasks.length} 个任务需要处理失败原因` : '没有需要处理的异常任务'
    }
  ];
}

function renderReadiness() {
  const list = $('#readinessList');
  if (!list) return;
  list.innerHTML = buildReadinessItems().map(item => `
    <article class="readiness-item ${item.ok ? 'ok' : 'warn'}">
      <b>${item.ok ? '通过' : '待处理'}</b>
      <span>${escapeHtml(item.label)}</span>
      <small>${escapeHtml(item.detail)}</small>
    </article>
  `).join('');
  renderTemplateCalibrationSummary();
  renderOperatorGuide();
}

function renderTemplateCalibrationSummary() {
  const list = $('#templateCalibrationList');
  if (!list) return;
  const summary = templateCalibrationSummary();
  if (!summary.total) {
    list.innerHTML = '<div class="empty">暂无类目模板。先同步或导入模板后，再做淘宝页面控件校准。</div>';
    return;
  }
  list.innerHTML = summary.items.map(item => `
    <article class="template-calibration-item ${escapeHtml(item.status)}">
      <b>${escapeHtml(item.label)}</b>
      <span>${escapeHtml(item.name)}</span>
      <small>${escapeHtml(item.detail)}</small>
      <button type="button" class="secondary" data-template-calibration-open="${escapeHtml(item.id)}">去校准</button>
    </article>
  `).join('');
}

function buildOperatorGuideSteps() {
  const activeStore = getActiveStore();
  const templateSummary = templateReadinessSummary();
  const calibrationSummary = templateCalibrationSummary();
  const waitingTasks = (state.tasks || []).filter(task => waitingStatuses.has(task.status));
  const failedTasks = (state.tasks || []).filter(task => failedStatuses.has(task.status));
  const runningTasks = (state.tasks || []).filter(task => runningStatuses.has(task.status));

  if (!state.user) {
    return [{
      status: '当前步骤',
      title: '登录 Web 账号',
      detail: '使用和 Web 端相同的运营账号密码登录，发布器只会同步这个账号名下的任务。',
      action: '',
      actionLabel: ''
    }];
  }
  if (!activeStore) {
    return [{
      status: '当前步骤',
      title: '添加淘宝店铺',
      detail: '进入店铺管理，添加店铺后在独立淘宝窗口里手动登录；发布器只保存登录状态，不保存淘宝密码。',
      action: 'stores',
      actionLabel: '去店铺管理'
    }];
  }
  if (activeStore.online !== true) {
    return [{
      status: '当前步骤',
      title: '确认淘宝店铺登录',
      detail: `当前选择的是 ${activeStore.name || '未命名店铺'}，需要打开淘宝登录窗口并检查登录状态后才能领取任务。`,
      action: 'stores',
      actionLabel: '去检查店铺'
    }];
  }
  if (!templateSummary.total || templateSummary.incomplete.length) {
    const missing = templateSummary.incomplete.slice(0, 3).map(item => item.name).filter(Boolean).join('、');
    return [{
      status: '当前步骤',
      title: '补齐类目模板',
      detail: missing ? `还有模板缺少必填字段或淘宝页面控件规则：${missing}` : '还没有可用类目模板，需要先配置价格、库存、图片上传和保存草稿规则。',
      action: 'templates',
      actionLabel: '去模板配置'
    }];
  }
  if (calibrationSummary.blocked.length) {
    const target = calibrationSummary.blocked[0];
    return [{
      status: '当前步骤',
      title: '校准淘宝页面控件',
      detail: `${target.name}：${target.detail}。打开对应淘宝发布页后，在模板配置里点击“检查控件”。`,
      action: 'templates',
      actionLabel: '去校准控件'
    }];
  }
  if (failedTasks.length) {
    return [{
      status: '需要处理',
      title: '处理失败或暂停任务',
      detail: `${failedTasks.length} 个任务需要查看失败原因。处理后可以重新发布、跳过或导出诊断包。`,
      action: 'tasks',
      actionLabel: '去任务队列'
    }];
  }
  if (runningTasks.length) {
    return [{
      status: '执行中',
      title: '等待当前任务完成',
      detail: '第一版一次只执行一个任务，避免多个淘宝发布页互相干扰。',
      action: 'tasks',
      actionLabel: '查看进度'
    }];
  }
  if (waitingTasks.length) {
    return [{
      status: state.autoPublish && activeStore.autoPublish !== false ? '可自动执行' : '等待开启',
      title: '发布待处理任务',
      detail: state.autoPublish && activeStore.autoPublish !== false
        ? `${waitingTasks.length} 个任务已满足发布条件，发布器会按队列自动领取。`
        : `${waitingTasks.length} 个任务已满足发布条件，但当前自动发布关闭，可以手动发布或重新打开自动发布。`,
      action: 'tasks',
      actionLabel: '查看任务'
    }];
  }
  return [{
    status: '已就绪',
    title: '等待 Web 端筛图',
    detail: '运营在 Web 端人工筛图通过并选择目标店铺后，任务会自动进入这里。',
    action: 'tasks',
    actionLabel: '刷新队列'
  }];
}

function renderOperatorGuide() {
  const list = $('#operatorGuideList');
  if (!list) return;
  list.innerHTML = buildOperatorGuideSteps().map(step => `
    <article class="operator-guide-card">
      <b>${escapeHtml(step.status)}</b>
      <span>${escapeHtml(step.title)}</span>
      <small>${escapeHtml(step.detail)}</small>
      ${step.action ? `<button type="button" class="secondary" data-guide-action="${escapeHtml(step.action)}">${escapeHtml(step.actionLabel)}</button>` : ''}
    </article>
  `).join('');
}

function handleOperatorGuideAction(action) {
  if (action === 'stores') {
    activateTab('stores');
    return;
  }
  if (action === 'templates') {
    activateTab('templates');
    return;
  }
  if (action === 'tasks') {
    activateTab('tasks');
    refreshTasks().catch(handleApiError);
  }
}

function localFileHref(value) {
  const normalized = String(value || '').replaceAll('\\', '/');
  if (/^[a-zA-Z]:\//.test(normalized)) return `file:///${normalized}`;
  return normalized;
}

function taskMissingFields(task = {}) {
  const missing = task.detail?.missing;
  if (Array.isArray(missing)) return missing.map(item => String(item || '').trim()).filter(Boolean);
  return [];
}

function taskMissingSelectors(task = {}) {
  const missingSelectors = task.detail?.missingSelectors;
  if (Array.isArray(missingSelectors)) return missingSelectors.map(item => String(item || '').trim()).filter(Boolean);
  return [];
}

function renderMissingFields(task = {}) {
  const missing = taskMissingFields(task);
  const missingSelectors = taskMissingSelectors(task);
  if (!missing.length && !missingSelectors.length) return '';
  const fixButton = task.categoryId ? `<button type="button" class="secondary" data-task-open-template="${escapeHtml(task.id || '')}">\u53bb\u4fee\u6a21\u677f</button>` : '';
  const parts = [
    missing.length ? `<span>\u6a21\u677f\u7f3a\u5c11\u5b57\u6bb5\uff1a${missing.map(escapeHtml).join('\u3001')}</span>` : '',
    missingSelectors.length ? `<span class="missing-selectors">\u6a21\u677f\u7f3a\u5c11\u9875\u9762\u63a7\u4ef6\u89c4\u5219\uff1a${missingSelectors.map(escapeHtml).join('\u3001')}</span>` : ''
  ].filter(Boolean).join('');
  return `<p class="missing-fields">${parts}${fixButton}</p>`;
}

function taskResolutionHint(task = {}) {
  if (!failedStatuses.has(task.status)) return '';
  const step = String(task.detail?.step || '').trim();
  const reason = String(task.failureReason || task.detail?.reason || '').trim();
  const text = `${step} ${reason}`.toLowerCase();
  if (step === 'local-publisher-template-calibration-required') {
    return '先校准淘宝页面控件：打开当前店铺的淘宝发布页，到“模板配置”检查对应类目模板控件，通过后再重新发布。';
  }
  if (step === 'local-publisher-task-required-fields-missing') {
    return '回 Web 端补齐标题、目标淘宝店铺和类目模板，确认任务重新进入待发布队列后再发布。';
  }
  if (task.status === '\u5df2\u6682\u505c' || step.startsWith('taobao-runner-cancelled')) {
    return '\u5f53\u524d\u4efb\u52a1\u5df2\u6309\u8fd0\u8425\u8981\u6c42\u6682\u505c\uff0c\u786e\u8ba4\u6dd8\u5b9d\u9875\u9762\u72b6\u6001\u6b63\u5e38\u540e\uff0c\u70b9\u201c\u91cd\u65b0\u53d1\u5e03\u201d\u653e\u56de\u5f85\u53d1\u5e03\u961f\u5217\u3002';
  }
  if (
    task.status === '\u6a21\u677f\u672a\u914d\u7f6e' ||
    step === 'taobao-runner-template-incomplete' ||
    taskMissingFields(task).length ||
    taskMissingSelectors(task).length
  ) {
    return '\u5148\u70b9\u201c\u53bb\u4fee\u6a21\u677f\u201d\u8865\u9f50\u7c7b\u76ee\u6a21\u677f\u5b57\u6bb5\u548c\u9875\u9762\u63a7\u4ef6\u89c4\u5219\uff0c\u4fdd\u5b58\u540e\u518d\u91cd\u65b0\u53d1\u5e03\u3002';
  }
  if (step === 'taobao-runner-store-mismatch') {
    return '\u5207\u6362\u5230\u4efb\u52a1\u8981\u6c42\u7684\u6dd8\u5b9d\u5e97\u94fa\uff0c\u7136\u540e\u70b9\u201c\u68c0\u67e5\u767b\u5f55\u201d\u786e\u8ba4\u5e97\u94fa\u540d\u79f0\u4e00\u81f4\u3002';
  }
  if (step === 'taobao-runner-image-package-incomplete') {
    return '回到 Web 端检查任务图片分组，确认主图、3:4 图、详情图都已生成并通过筛图，再重新发布。';
  }
  if (step === 'taobao-runner-image-source-missing') {
    return '该任务图片记录缺少本地路径或下载 URL，先在 Web 端重新同步图片或重新生成图片，确认图片能预览后再重新发布。';
  }
  if (step === 'taobao-runner-local-image-missing') {
    return '本地图片文件已不存在，先重新同步图片，或让任务使用 Web 图片 URL 后再重新发布。';
  }
  if (step === 'taobao-runner-image-download-failed') {
    return '图片 URL 下载失败，检查网络和图片链接有效性，重新同步图片后再发布；需要排查时导出诊断。';
  }
  if (text.includes('captcha') || text.includes('risk') || text.includes('manual') || task.status === '\u9700\u8981\u4eba\u5de5\u5904\u7406') {
    return '\u5728\u5df2\u6253\u5f00\u7684\u6dd8\u5b9d\u7a97\u53e3\u5904\u7406\u9a8c\u8bc1\u7801\u3001\u98ce\u63a7\u6216\u4e8c\u6b21\u786e\u8ba4\uff0c\u5904\u7406\u540e\u518d\u624b\u52a8\u53d1\u5e03\u8be5\u4efb\u52a1\u3002';
  }
  if (text.includes('login') || text.includes('offline') || text.includes('\u767b\u5f55\u5931\u6548') || text.includes('\u672a\u767b\u5f55')) {
    return '\u5230\u201c\u6dd8\u5b9d\u5e97\u94fa\u7ba1\u7406\u201d\u91cd\u65b0\u6253\u5f00\u5e97\u94fa\u767b\u5f55\uff0c\u767b\u5f55\u6210\u529f\u540e\u70b9\u201c\u68c0\u67e5\u767b\u5f55\u201d\u3002';
  }
  if (text.includes('upload') || text.includes('\u4e0a\u4f20')) {
    return '\u5148\u68c0\u67e5\u4efb\u52a1\u56fe\u7247\u9884\u89c8\u548c\u4e0a\u4f20\u63a7\u4ef6\u89c4\u5219\uff0c\u518d\u5bfc\u51fa\u8bca\u65ad\u5305\u6392\u67e5\u4e0a\u4f20\u5931\u8d25\u539f\u56e0\u3002';
  }
  if (task.detail?.screenshotPath) {
    return '\u5148\u67e5\u770b\u8bca\u65ad\u622a\u56fe\uff0c\u5982\u679c\u662f\u9875\u9762\u63a7\u4ef6\u53d8\u5316\uff0c\u5230\u6a21\u677f\u914d\u7f6e\u91cc\u91cd\u65b0\u91c7\u96c6\u5e76\u5957\u7528\u5f53\u524d\u6dd8\u5b9d\u9875\u9762\u3002';
  }
  return '\u5148\u70b9\u201c\u590d\u5236\u8bca\u65ad\u201d\u6216\u201c\u5bfc\u51fa\u8bca\u65ad\u201d\u4fdd\u7559\u73b0\u573a\uff0c\u518d\u6839\u636e\u5931\u8d25\u539f\u56e0\u91cd\u8bd5\u3002';
}

function renderTaskResolutionHint(task = {}) {
  const hint = taskResolutionHint(task);
  if (!hint) return '';
  const requiresCalibration = task.detail?.step === 'local-publisher-template-calibration-required';
  const fixButton = requiresCalibration && task.categoryId
    ? `<button type="button" class="secondary" data-task-open-template="${escapeHtml(task.id || '')}">去校准模板</button>`
    : '';
  return `<p class="resolution-hint ${requiresCalibration ? 'template-calibration-required' : ''}"><b>\u5904\u7406\u5efa\u8bae</b><span>${escapeHtml(hint)}</span>${fixButton}</p>`;
}

function templateListValue(value) {
  if (Array.isArray(value)) return value.join('\n');
  return String(value || '');
}

function templateAttributesValue(value = {}) {
  return Object.entries(value || {})
    .map(([key, fieldValue]) => `${key}=${fieldValue}`)
    .join('\n');
}

function templateCustomFieldsValue(value = []) {
  return (Array.isArray(value) ? value : []).map(item => [
    `${item.label || item.name || item.field || ''}=${item.value || ''}`,
    item.selector || '',
    item.type || ''
  ].filter(Boolean).join('|')).join('\n');
}

function splitTemplateLine(line = '') {
  const normalized = String(line || '').trim();
  const separatorIndex = ['=', '：', ':'].map(char => normalized.indexOf(char)).filter(index => index >= 0).sort((a, b) => a - b)[0];
  if (separatorIndex == null) return ['', ''];
  return [
    normalized.slice(0, separatorIndex).trim(),
    normalized.slice(separatorIndex + 1).trim()
  ];
}

function parseTemplateAttributes(text = '') {
  return String(text || '').split('\n').reduce((result, line) => {
    const [key, value] = splitTemplateLine(line);
    if (key && value) result[key] = value;
    return result;
  }, {});
}

function parseTemplateCustomFields(text = '') {
  return String(text || '').split('\n').map(line => {
    const [label, rest] = splitTemplateLine(line);
    if (!label || !rest) return null;
    const [value, selector = '', type = ''] = rest.split('|').map(item => item.trim());
    return {
      label,
      value,
      ...(selector ? { selector } : {}),
      ...(type ? { type } : {})
    };
  }).filter(Boolean);
}

function templateSelectorInput(defaults, key, label) {
  return `<label>${escapeHtml(label)}<span class="selector-field"><input data-template-selector="${escapeHtml(key)}" value="${escapeHtml(defaults?.selectors?.[key] || '')}"><button type="button" class="secondary" data-template-pick-selector>读取当前淘宝控件</button></span></label>`;
}

function templateSelectorRequiredKeys() {
  return [
    ['title', '标题'],
    ['price', '价格'],
    ['stock', '库存'],
    ['mainImages', '主图'],
    ['ratioImages', '3:4 图'],
    ['detailImages', '详情图'],
    ['saveDraft', '保存草稿']
  ];
}

function templateSelectorStatus(defaults = {}) {
  const selectors = defaults.selectors || {};
  const required = templateSelectorRequiredKeys();
  const missing = required.filter(([key]) => !String(selectors[key] || '').trim());
  return {
    total: required.length,
    ready: required.length - missing.length,
    missing: missing.map(([, label]) => label)
  };
}

function templateSelectorSignature(defaults = {}) {
  const selectors = defaults.selectors || {};
  return templateSelectorRequiredKeys()
    .map(([key]) => `${key}:${String(selectors[key] || '').trim()}`)
    .join('|');
}

function renderTemplateSelectorStatus(defaults = {}) {
  const status = templateSelectorStatus(defaults);
  const stateClass = status.missing.length ? 'warn' : 'ok';
  const detail = status.missing.length ? `缺少：${status.missing.join('、')}` : '关键规则已齐全';
  return `<p class="selector-status ${stateClass}"><b>发布控件 ${status.ready}/${status.total}</b><span class="selector-missing">${escapeHtml(detail)}</span></p>`;
}

function renderTemplateSelectorCheckResult(categoryId = '') {
  const result = state.templateSelectorChecks[categoryId];
  if (!result) return '';
  const missing = Array.isArray(result.missing) ? result.missing : [];
  const found = Array.isArray(result.found) ? result.found : [];
  const stateClass = result.ok ? 'ok' : 'warn';
  const detail = result.ok
    ? `当前淘宝页面已找到 ${found.length}/${Number(result.total || found.length)} 个控件`
    : `当前淘宝页面缺少：${missing.map(item => item.key || item.selector).filter(Boolean).join('、') || '未知控件'}`;
  return `<p class="template-selector-check-result ${stateClass}"><b>${result.ok ? '校准通过' : '校准未通过'}</b><span>${escapeHtml(detail)}</span></p>`;
}

function taobaoDiagnosticText(item = {}) {
  return [
    item.label,
    item.text,
    item.placeholder,
    item.name,
    item.id,
    item.type,
    item.tagName
  ].map(value => String(value || '').trim()).filter(Boolean).join(' ');
}

function taobaoDiagnosticSelector(items = [], keywords = []) {
  const candidates = Array.isArray(items) ? items : [];
  const normalizedKeywords = keywords.map(keyword => String(keyword || '').trim()).filter(Boolean);
  const exact = candidates.find(item => {
    const text = taobaoDiagnosticText(item);
    return item?.selector && normalizedKeywords.some(keyword => text === keyword);
  });
  if (exact?.selector) return exact.selector;
  const matched = candidates.find(item => {
    const text = taobaoDiagnosticText(item);
    return item?.selector && normalizedKeywords.some(keyword => text.includes(keyword));
  });
  return matched?.selector || '';
}

function selectorsFromTemplateDiagnostics(payload = {}) {
  const detail = payload.detail || payload;
  const fields = Array.isArray(detail.visibleFields) ? detail.visibleFields : [];
  const buttons = Array.isArray(detail.visibleButtons) ? detail.visibleButtons : [];
  const fileInputs = Array.isArray(detail.fileInputs) ? detail.fileInputs : [];
  const onlyFileInput = fileInputs.length === 1 ? fileInputs[0]?.selector || '' : '';
  return {
    categorySearch: taobaoDiagnosticSelector(fields, ['搜索发品', '类目关键词', '产品名称', '条码信息', '搜索']),
    categorySearchButton: taobaoDiagnosticSelector(buttons, ['搜索', '查询']),
    categoryResult: taobaoDiagnosticSelector(buttons, ['选择', '下一步', '开始发布', '发布']),
    title: taobaoDiagnosticSelector(fields, ['标题', '宝贝标题', '商品标题']),
    brandName: taobaoDiagnosticSelector(fields, ['品牌', 'brand']),
    modelName: taobaoDiagnosticSelector(fields, ['型号', 'model']),
    price: taobaoDiagnosticSelector(fields, ['价格', '一口价', '销售价', 'price']),
    stock: taobaoDiagnosticSelector(fields, ['库存', '数量', 'stock']),
    shipFrom: taobaoDiagnosticSelector(fields, ['发货地']),
    freightTemplate: taobaoDiagnosticSelector(fields, ['运费模板', '运费']),
    serviceTemplate: taobaoDiagnosticSelector(fields, ['服务模板', '服务']),
    storeName: taobaoDiagnosticSelector(fields, ['当前店铺', '店铺名称', '店铺名', '卖家店铺']),
    mainImages: taobaoDiagnosticSelector(fileInputs, ['主图', '商品图片', '宝贝图片']) || onlyFileInput,
    ratioImages: taobaoDiagnosticSelector(fileInputs, ['3:4', '3-4', '长图', '竖图']) || onlyFileInput,
    detailImages: taobaoDiagnosticSelector(fileInputs, ['详情', '描述', '详情图']) || onlyFileInput,
    saveDraft: taobaoDiagnosticSelector(buttons, ['保存草稿', '存草稿', '保存'])
  };
}

function applyTemplateDiagnosticsSelectors(targetCard = null) {
  if (!state.lastTemplateDiagnostics) {
    log('请先采集当前淘宝页面诊断，再套用到模板');
    return;
  }
  const selectors = selectorsFromTemplateDiagnostics(state.lastTemplateDiagnostics);
  const cards = targetCard ? [targetCard] : Array.from(document.querySelectorAll('#templateList [data-template-index]'));
  let applied = 0;
  cards.forEach(card => {
    card.querySelectorAll('[data-template-selector]').forEach(input => {
      const key = input.dataset.templateSelector;
      const value = String(selectors[key] || '').trim();
      if (!value || input.value.trim()) return;
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      applied += 1;
    });
  });
  log(applied ? `已套用当前淘宝页面诊断：${applied} 个 selector` : '当前诊断没有可套用的空白 selector');
}

async function checkTemplateSelectors(card) {
  const activeStore = getActiveStore();
  if (!activeStore) {
    log('请先选择淘宝店铺，再检查模板控件');
    return;
  }
  if (!window.caishenPublisher?.checkTemplateSelectors) {
    log('当前运行环境无法检查淘宝页面控件');
    return;
  }
  const index = Number(card?.dataset?.templateIndex);
  if (!Number.isInteger(index)) return;
  const categories = collectCategoryTemplates();
  const category = categories[index];
  if (!category) return;
  const result = await window.caishenPublisher.checkTemplateSelectors({
    storeId: state.activeStoreId,
    category
  });
  state.templateSelectorChecks[category.id || String(index)] = result;
  await persistTemplateSelectorCheck(index, result);
  renderTemplates();
  const missing = Array.isArray(result?.missing) ? result.missing : [];
  log(result?.ok
    ? `模板控件校准通过：${category.name || category.id}`
    : `模板控件校准未通过：${category.name || category.id}，缺少 ${missing.map(item => item.key || item.selector).filter(Boolean).join('、') || '未知控件'}`);
}

async function openTemplatePublishPage(card) {
  const activeStore = getActiveStore();
  if (!activeStore) {
    log('请先选择淘宝店铺，再打开模板发布页');
    return;
  }
  if (!window.caishenPublisher?.openTemplatePublishPage) {
    log('当前运行环境无法打开模板发布页');
    return;
  }
  const index = Number(card?.dataset?.templateIndex);
  if (!Number.isInteger(index)) return;
  const categories = collectCategoryTemplates();
  const category = categories[index];
  const publishUrl = String(category?.defaults?.publishUrl || '').trim();
  if (!publishUrl) {
    log('请先填写该模板的淘宝发布入口');
    return;
  }
  const result = await window.caishenPublisher.openTemplatePublishPage({
    storeId: state.activeStoreId,
    store: activeStore,
    category,
    publishUrl
  });
  log(`已打开模板发布页：${category.name || category.id || index} ${result?.url || publishUrl}`);
}

function log(message) {
  const line = `[${new Date().toLocaleTimeString()}] ${message}`;
  $('#logOutput').textContent = `${line}\n${$('#logOutput').textContent || ''}`.slice(0, 12000);
  window.caishenPublisher?.appendLog?.(line).catch(() => {});
}

async function loadPersistedLogs() {
  const text = await window.caishenPublisher?.readLog?.();
  if (text) $('#logOutput').textContent = text.slice(-12000);
}

async function appendPublisherLog(message) {
  log(message);
}

async function clearPublisherLogs() {
  await window.caishenPublisher?.clearLog?.();
  $('#logOutput').textContent = '';
}

async function exportDiagnosticsBundle() {
  if (!window.caishenPublisher?.exportDiagnostics) {
    log('当前运行环境无法导出诊断包');
    return;
  }
  const result = await window.caishenPublisher.exportDiagnostics({
    appVersion: state.appVersion,
    apiBaseUrl: api.baseUrl,
    deviceId: state.deviceId,
    activeStoreId: state.activeStoreId,
    autoPublish: state.autoPublish,
    dryRun: state.dryRun,
    user: state.user ? {
      id: state.user.id,
      username: state.user.username,
      displayName: state.user.displayName
    } : null,
    stores: state.stores,
    tasks: state.tasks
  });
  log(`诊断包已导出：${result?.folder || ''}`);
}

async function exportTaskDiagnosticsBundle(taskId) {
  const task = (state.tasks || []).find(item => item.id === taskId);
  if (!task) return;
  if (!window.caishenPublisher?.exportDiagnostics) {
    log('当前运行环境无法导出任务诊断包');
    return;
  }
  const result = await window.caishenPublisher.exportDiagnostics({
    appVersion: state.appVersion,
    apiBaseUrl: api.baseUrl,
    deviceId: state.deviceId,
    activeStoreId: state.activeStoreId,
    autoPublish: state.autoPublish,
    dryRun: state.dryRun,
    user: state.user ? {
      id: state.user.id,
      username: state.user.username,
      displayName: state.user.displayName
    } : null,
    stores: state.stores,
    tasks: [task]
  });
  log(`任务诊断包已导出：${task.name || task.id} ${result?.folder || ''}`);
}

async function loadAppInfo() {
  try {
    const info = await window.caishenPublisher?.getAppInfo?.();
    state.appVersion = String(info?.appVersion || '').trim();
  } catch {
    state.appVersion = '';
  }
  renderShell();
}

function renderShell() {
  $('#deviceId').textContent = state.deviceId;
  const versionNode = $('#appVersion');
  if (versionNode) versionNode.textContent = state.appVersion || '读取中';
  $('#currentApiBaseUrl').textContent = api.baseUrl;
  $('#currentUser').textContent = state.user?.displayName || state.user?.username || '未登录';
  const activeStore = getActiveStore();
  $('#currentStore').textContent = activeStore?.name || '未选择店铺';
  $('#autoPublishToggle').checked = state.autoPublish;
  $('#dryRunToggle').checked = state.dryRun;
  $('#logoutButton').hidden = !state.user;
  $('#loginPanel').hidden = Boolean(state.user);
  const blocker = publisherBlocker();
  $('#publisherNotice').textContent = blocker || '自动发布就绪：将领取当前账号与当前店铺匹配的待发布任务';
  $('#publisherNotice').classList.toggle('ready', !blocker);
  renderSyncStatus();
  renderReadiness();
}

function renderStores() {
  const list = $('#storeList');
  if (!state.stores.length) {
    list.innerHTML = '<div class="empty">还没有绑定淘宝店铺。添加店铺后，运营需要自己在淘宝窗口登录。</div>';
    renderReadiness();
    return;
  }
  list.innerHTML = state.stores.map(store => `
    <article class="row ${store.id === state.activeStoreId ? 'selected' : ''}">
      <div><b>${escapeHtml(store.name)}</b><span>${store.online ? '已登录' : '未确认登录'} | ${store.autoPublish === false ? '未启用自动发布' : '可自动发布'}</span></div>
      <div class="row-actions"><button data-store-login="${escapeHtml(store.id)}">打开淘宝登录</button><button data-store-check="${escapeHtml(store.id)}">检查登录</button><button data-store-online="${escapeHtml(store.id)}">确认已登录</button><button data-store-active="${escapeHtml(store.id)}">设为当前店铺</button><button class="secondary" data-store-rename="${escapeHtml(store.id)}">重命名</button><button class="secondary" data-store-toggle-auto="${escapeHtml(store.id)}">${store.autoPublish === false ? '启用店铺自动发布' : '停用店铺自动发布'}</button><button class="secondary" data-store-clear="${escapeHtml(store.id)}">退出淘宝登录</button><button class="danger" data-store-delete="${escapeHtml(store.id)}">删除</button></div>
    </article>
  `).join('');
  renderReadiness();
}

function taskMatchesFilter(task = {}, filter = state.taskFilter) {
  const status = task.status || '';
  if (filter === 'waiting') return waitingStatuses.has(status);
  if (filter === 'running') return runningStatuses.has(status);
  if (filter === 'failed') return failedStatuses.has(status);
  if (filter === 'success') return status === '已保存草稿';
  if (filter === 'skipped') return skippedStatuses.has(status);
  return true;
}

function taskFilterLabel(filter) {
  return ({
    all: '全部',
    waiting: '待发布',
    running: '执行中',
    failed: '失败',
    success: '成功',
    skipped: '已跳过'
  })[filter] || '全部';
}

function renderTaskFilters(tasks = []) {
  const bar = $('#taskFilterBar');
  if (!bar) return;
  const counts = {
    all: tasks.length,
    waiting: tasks.filter(task => taskMatchesFilter(task, 'waiting')).length,
    running: tasks.filter(task => taskMatchesFilter(task, 'running')).length,
    failed: tasks.filter(task => taskMatchesFilter(task, 'failed')).length,
    success: tasks.filter(task => taskMatchesFilter(task, 'success')).length,
    skipped: tasks.filter(task => taskMatchesFilter(task, 'skipped')).length
  };
  bar.querySelectorAll('.task-filter-button[data-task-filter]').forEach(button => {
    const filter = button.dataset.taskFilter || 'all';
    button.classList.toggle('active', filter === state.taskFilter);
    button.textContent = `${taskFilterLabel(filter)} ${counts[filter] || 0}`;
  });
}

function renderTasks() {
  const list = $('#taskList');
  const tasks = state.tasks || [];
  const visibleTasks = tasks.filter(task => taskMatchesFilter(task));
  renderTaskFilters(tasks);
  $('#pendingCount').textContent = tasks.filter(task => waitingStatuses.has(task.status)).length;
  $('#runningCount').textContent = tasks.filter(task => runningStatuses.has(task.status)).length;
  $('#successCount').textContent = tasks.filter(task => task.status === '已保存草稿').length;
  $('#failedCount').textContent = tasks.filter(task => failedStatuses.has(task.status)).length;
  if (!tasks.length) {
    list.innerHTML = '<div class="empty">暂无可发布任务。Web 端人工筛图通过后会同步到这里。</div>';
    renderTaskDetail();
    renderReadiness();
    return;
  }
  if (!visibleTasks.length) {
    state.activeTaskId = '';
    list.innerHTML = `<div class="empty">当前筛选「${escapeHtml(taskFilterLabel(state.taskFilter))}」下没有任务。</div>`;
    renderTaskDetail();
    renderReadiness();
    return;
  }
  if (!visibleTasks.some(task => task.id === state.activeTaskId)) state.activeTaskId = visibleTasks[0]?.id || '';
  list.innerHTML = visibleTasks.map(task => `
    <article class="row ${task.id === state.activeTaskId ? 'selected' : ''}" data-task-select="${escapeHtml(task.id)}">
      <div><b>${escapeHtml(task.name)}</b><span>${escapeHtml(task.status || '待发布')} | ${escapeHtml(task.storeName || '未指定店铺')}</span></div>
      <small>${escapeHtml(task.title || '')}</small>
      ${task.failureReason ? `<p class="diagnostic">失败原因：${escapeHtml(task.failureReason)}</p>` : ''}
      ${renderMissingFields(task)}
      ${renderTaskPublishReadinessBlocker(task)}
      ${renderTaskResolutionHint(task)}
      ${task.detail?.screenshotPath ? `<a class="diagnostic-link" href="${escapeHtml(localFileHref(task.detail.screenshotPath))}">查看诊断截图</a>` : ''}
      ${runningStatuses.has(task.status) ? `<button class="secondary" data-task-pause="${escapeHtml(task.id)}">暂停任务</button>` : ''}
      ${waitingStatuses.has(task.status) ? `<button data-task-run="${escapeHtml(task.id)}">手动发布</button>` : ''}
      ${dryRunStatuses.has(task.status) ? `<button data-task-real-run="${escapeHtml(task.id)}">正式发布</button><button class="secondary" data-task-retry="${escapeHtml(task.id)}">重新试运行</button>` : ''}
      ${failedStatuses.has(task.status) ? `<button data-task-retry="${escapeHtml(task.id)}">重新发布</button><button class="secondary" data-task-open-publish-page="${escapeHtml(task.id)}">打开发布页</button><button class="secondary" data-task-open-store-login="${escapeHtml(task.id)}">打开店铺登录</button><button class="secondary" data-task-check-store-login="${escapeHtml(task.id)}">检查登录</button><button class="secondary" data-task-copy-diagnostic="${escapeHtml(task.id)}">复制诊断</button><button class="secondary" data-task-export-diagnostic="${escapeHtml(task.id)}">导出诊断</button><button class="secondary" data-task-skip="${escapeHtml(task.id)}">跳过</button>` : ''}
      ${skippedStatuses.has(task.status) ? '<small class="muted">已从本地发布队列跳过</small>' : ''}
    </article>
  `).join('');
  renderTaskDetail();
  renderReadiness();
}

function taskDetailRow(label, value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(text)}</dd></div>`;
}

function absoluteApiUrl(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (/^https?:\/\//i.test(text) || text.startsWith('file:')) return text;
  return `${api.baseUrl}${text.startsWith('/') ? '' : '/'}${text}`;
}

function renderTaskImageStrip(label, images = []) {
  const items = (Array.isArray(images) ? images : []).slice(0, 8);
  if (!items.length) return '';
  return `<section class="task-image-strip">
    <b>${escapeHtml(label)} <span>${images.length} 张</span></b>
    <div>${items.map(image => {
      const source = absoluteApiUrl(image.previewUrl || image.thumbnailUrl || image.url || image.outputUrl);
      return `<figure title="${escapeHtml(image.relativePath || image.name || '')}">
        <img src="${escapeHtml(source)}" alt="${escapeHtml(image.name || image.relativePath || label)}" loading="lazy">
        <figcaption>${escapeHtml(image.name || image.relativePath || '')}</figcaption>
      </figure>`;
    }).join('')}</div>
  </section>`;
}

function taskImageCoverage(task = {}) {
  const images = task.images || {};
  const groups = [
    ['mainImages', '主图'],
    ['ratioImages', '3:4 图'],
    ['detailImages', '详情图']
  ].map(([key, label]) => {
    const items = Array.isArray(images[key]) ? images[key] : [];
    return { key, label, count: items.length, missing: items.length === 0 };
  });
  return {
    groups,
    total: groups.reduce((sum, group) => sum + group.count, 0),
    missing: groups.filter(group => group.missing)
  };
}

function taskImageSourceIssues(task = {}) {
  const images = task.images || {};
  const groups = [
    ['mainImages', '主图'],
    ['ratioImages', '3:4 图'],
    ['detailImages', '详情图']
  ];
  const issues = [];
  for (const [key, label] of groups) {
    const items = Array.isArray(images[key]) ? images[key] : [];
    items.forEach((image, index) => {
      const hasSource = ['outputPath', 'localPath', 'url', 'outputUrl'].some(field => String(image?.[field] || '').trim());
      if (hasSource) return;
      issues.push({
        groupKey: key,
        groupLabel: label,
        index,
        name: image?.name || image?.relativePath || `${label}${index + 1}`
      });
    });
  }
  return issues;
}

async function taskLocalImageFileIssues(task = {}) {
  if (!window.caishenPublisher?.fileExists) return [];
  const images = task.images || {};
  const groups = [
    ['mainImages', '主图'],
    ['ratioImages', '3:4 图'],
    ['detailImages', '详情图']
  ];
  const issues = [];
  for (const [key, label] of groups) {
    const items = Array.isArray(images[key]) ? images[key] : [];
    for (const [index, image] of items.entries()) {
      const localPath = String(image?.outputPath || image?.localPath || '').trim();
      const fallbackUrl = String(image?.url || image?.outputUrl || '').trim();
      if (!localPath || fallbackUrl) continue;
      const exists = await window.caishenPublisher.fileExists(localPath).catch(() => false);
      if (exists) continue;
      issues.push({
        groupKey: key,
        groupLabel: label,
        index,
        name: image?.name || image?.relativePath || `${label}${index + 1}`,
        path: localPath
      });
    }
  }
  return issues;
}

function renderTaskImageCoverage(task = {}) {
  const coverage = taskImageCoverage(task);
  if (!coverage.total && !failedStatuses.has(task.status) && !waitingStatuses.has(task.status) && !runningStatuses.has(task.status)) return '';
  const missingText = coverage.missing.length
    ? `<strong>缺少图片分组：${coverage.missing.map(group => escapeHtml(group.label)).join('、')}</strong>`
    : '<span>图片分组已齐全</span>';
  return `<section class="task-image-coverage ${coverage.missing.length ? 'has-missing' : 'is-complete'}">
    <b>图片清单</b>
    <div>${coverage.groups.map(group => `<span class="${group.missing ? 'missing' : ''}">${escapeHtml(group.label)}：${group.count} 张</span>`).join('')}</div>
    ${missingText}
  </section>`;
}

function taskRequiredFieldIssues(task = {}) {
  const fields = [
    ['title', '标题'],
    ['storeId', '目标淘宝店铺'],
    ['categoryId', '类目模板']
  ];
  return fields
    .filter(([key]) => !String(task?.[key] || '').trim())
    .map(([key, label]) => ({ key, label }));
}

function taskPublishReadinessBlocker(task = {}) {
  if (!task?.id) return null;
  const requiredFieldIssues = taskRequiredFieldIssues(task);
  if (requiredFieldIssues.length) {
    const missingLabels = requiredFieldIssues.map(field => field.label).join('、');
    return {
      status: '发布失败',
      step: 'local-publisher-task-required-fields-missing',
      reason: `任务字段不完整：缺少${missingLabels}，请先回 Web 端补齐标题、目标店铺和类目模板`,
      detail: {
        step: 'local-publisher-task-required-fields-missing',
        missingFields: requiredFieldIssues
      }
    };
  }
  const coverage = taskImageCoverage(task);
  if (coverage.missing.length) {
    const missingImageGroups = coverage.missing.map(group => ({ key: group.key, label: group.label, count: group.count }));
    const missingLabels = missingImageGroups.map(group => group.label).join('、');
    return {
      status: '发布失败',
      step: 'taobao-runner-image-package-incomplete',
      reason: `图片未齐全：缺少${missingLabels}，请先回 Web 端重新同步图片或补齐筛图结果`,
      detail: {
        step: 'taobao-runner-image-package-incomplete',
        missingImageGroups,
        imageCoverage: coverage.groups
      }
    };
  }
  const sourceIssues = taskImageSourceIssues(task);
  if (sourceIssues.length) {
    const preview = sourceIssues.slice(0, 3).map(issue => `${issue.groupLabel}${issue.index + 1}`).join('、');
    return {
      status: '发布失败',
      step: 'taobao-runner-image-source-missing',
      reason: `图片来源缺失：${preview}${sourceIssues.length > 3 ? ` 等 ${sourceIssues.length} 张` : ''} 缺少本地路径或 Web URL，请先回 Web 端重新同步图片`,
      detail: {
        step: 'taobao-runner-image-source-missing',
        missingImageSources: sourceIssues
      }
    };
  }
  return null;
}

async function taskPublishPreflightBlocker(task = {}) {
  const readinessBlocker = taskPublishReadinessBlocker(task);
  if (readinessBlocker) return readinessBlocker;
  const localFileIssues = await taskLocalImageFileIssues(task);
  if (localFileIssues.length) {
    const preview = localFileIssues.slice(0, 3).map(issue => `${issue.groupLabel}${issue.index + 1}`).join('、');
    return {
      status: '发布失败',
      step: 'taobao-runner-local-image-missing',
      reason: `本地图片文件不存在：${preview}${localFileIssues.length > 3 ? ` 等 ${localFileIssues.length} 张` : ''}，请先重新同步图片或让任务使用 Web 图片 URL`,
      detail: {
        step: 'taobao-runner-local-image-missing',
        missingLocalImages: localFileIssues
      }
    };
  }
  return null;
}

function renderTaskPublishReadinessBlocker(task = {}) {
  if (!waitingStatuses.has(task.status) && !dryRunStatuses.has(task.status)) return '';
  const blocker = taskPublishReadinessBlocker(task);
  if (!blocker) return '';
  return `<p class="publish-readiness-blocker"><b>发布前阻断</b><span>${escapeHtml(blocker.reason)}</span></p>`;
}

function renderTaskImagePreview(task = {}) {
  const images = task.images || {};
  const sections = [
    renderTaskImageStrip('主图', images.mainImages),
    renderTaskImageStrip('3:4 主图', images.ratioImages),
    renderTaskImageStrip('详情图', images.detailImages)
  ].filter(Boolean);
  if (!sections.length) return '';
  return `<div class="task-image-preview">${sections.join('')}</div>`;
}

function formatTimelineTime(value) {
  const date = new Date(value || '');
  if (Number.isNaN(date.getTime())) return String(value || '');
  return date.toLocaleString();
}

function renderTaskTimeline(task = {}) {
  const timeline = Array.isArray(task.timeline) ? task.timeline : [];
  const items = timeline.slice(-12).reverse();
  if (!items.length) return '';
  return `<section class="task-timeline">
    <b>执行时间线 <span>${timeline.length} 条</span></b>
    <ol>${items.map(item => {
      const screenshotPath = item.screenshotPath || item.diagnosticScreenshotPath || '';
      const screenshotLink = screenshotPath
        ? `<a href="${escapeHtml(localFileHref(screenshotPath))}">截图</a>`
        : '';
      const meta = [
        item.at ? formatTimelineTime(item.at) : '',
        item.step,
        item.deviceId ? `设备：${item.deviceId}` : ''
      ].filter(Boolean).join(' · ');
      return `<li>
        <strong>${escapeHtml(item.status || '状态更新')}</strong>
        <span>${escapeHtml(meta)}</span>
        ${item.failureReason ? `<p>${escapeHtml(item.failureReason)}</p>` : ''}
        ${screenshotLink}
      </li>`;
    }).join('')}</ol>
  </section>`;
}

function renderTaskDiagnosticScreenshot(task = {}) {
  const detail = task.detail || {};
  const source = detail.diagnosticScreenshotUrl
    ? absoluteApiUrl(detail.diagnosticScreenshotUrl)
    : localFileHref(detail.diagnosticScreenshotPath || detail.screenshotPath || '');
  if (!source) return '';
  return `<section class="task-diagnostic-screenshot">
    <b>诊断截图</b>
    <a href="${escapeHtml(source)}"><img src="${escapeHtml(source)}" alt="任务失败诊断截图" loading="lazy"></a>
  </section>`;
}

function buildTaskDiagnosticText(task = {}) {
  return [
    '淘宝发布器诊断信息',
    `任务：${task.name || task.id || ''}`,
    `任务 ID：${task.id || ''}`,
    `状态：${task.status || ''}`,
    `目标店铺：${task.storeName || task.storeId || ''}`,
    `当前账号：${state.user?.displayName || state.user?.username || ''}`,
    `设备 ID：${state.deviceId}`,
    `图片清单：${taskImageCoverage(task).groups.map(group => `${group.label}${group.count}张`).join('，')}`,
    `失败原因：${task.failureReason || ''}`,
    `截图路径：${task.detail?.screenshotPath || ''}`,
    `发布步骤：${task.detail?.step || ''}`,
    `更新时间：${task.updatedAt || ''}`,
    `执行时间线：${JSON.stringify(task.timeline || [], null, 2)}`,
    `诊断 JSON：${JSON.stringify(task.detail || {}, null, 2)}`
  ].join('\n');
}

async function copyTaskDiagnostic(taskId) {
  const task = (state.tasks || []).find(item => item.id === taskId);
  if (!task) return;
  await navigator.clipboard.writeText(buildTaskDiagnosticText(task));
  log(`诊断信息已复制：${task.name || task.id}`);
}

function renderTaskDetail() {
  const panel = $('#taskDetailPanel');
  if (!panel) return;
  const task = (state.tasks || []).find(item => item.id === state.activeTaskId);
  if (!task) {
    panel.innerHTML = '<div class="empty">任务详情会在选择任务后显示。</div>';
    return;
  }
  const rows = [
    taskDetailRow('状态', task.status || '待发布'),
    taskDetailRow('目标店铺', task.storeName || task.storeId || '未指定店铺'),
    taskDetailRow('执行设备', task.deviceId || '未领取'),
    taskDetailRow('尝试次数', String(Number(task.attempts || 0))),
    taskDetailRow('主图', `${Number(task.mainImageCount || 0)} 张`),
    taskDetailRow('3:4 主图', `${Number(task.ratioImageCount || 0)} 张`),
    taskDetailRow('详情图', `${Number(task.detailImageCount || 0)} 张`)
  ].join('');
  panel.innerHTML = `<h3>任务详情</h3>
    <b>${escapeHtml(task.name || '未命名任务')}</b>
    <p>${escapeHtml(task.title || '未生成标题')}</p>
    <dl>${rows}</dl>
    ${task.failureReason ? `<p class="diagnostic">失败原因：${escapeHtml(task.failureReason)}</p>` : ''}
    ${renderMissingFields(task)}
    ${renderTaskPublishReadinessBlocker(task)}
    ${renderTaskResolutionHint(task)}
    ${renderTaskDiagnosticScreenshot(task)}
    ${renderTaskImageCoverage(task)}
    ${renderTaskImagePreview(task)}
    ${renderTaskTimeline(task)}
    ${task.detail?.screenshotPath ? `<a class="diagnostic-link" href="${escapeHtml(localFileHref(task.detail.screenshotPath))}">查看诊断截图</a>` : ''}
    ${runningStatuses.has(task.status) ? `<button class="secondary" data-task-pause="${escapeHtml(task.id)}">暂停任务</button>` : ''}
    ${waitingStatuses.has(task.status) ? `<button data-task-run="${escapeHtml(task.id)}">手动发布</button>` : ''}
    ${dryRunStatuses.has(task.status) ? `<button data-task-real-run="${escapeHtml(task.id)}">正式发布</button><button class="secondary" data-task-retry="${escapeHtml(task.id)}">重新试运行</button>` : ''}
    ${failedStatuses.has(task.status) ? `<button data-task-retry="${escapeHtml(task.id)}">重新发布</button><button class="secondary" data-task-open-publish-page="${escapeHtml(task.id)}">打开发布页</button><button class="secondary" data-task-open-store-login="${escapeHtml(task.id)}">打开店铺登录</button><button class="secondary" data-task-check-store-login="${escapeHtml(task.id)}">检查登录</button><button class="secondary" data-task-copy-diagnostic="${escapeHtml(task.id)}">复制诊断</button><button class="secondary" data-task-export-diagnostic="${escapeHtml(task.id)}">导出诊断</button><button class="secondary" data-task-skip="${escapeHtml(task.id)}">跳过</button>` : ''}
  `;
}

function renderTemplates() {
  const categories = state.settings?.categories || [];
  if (!categories.length) {
    $('#templateList').innerHTML = '<div class="empty">暂无类目模板。请先在 Web/API 后端创建类目配置。</div>';
    renderReadiness();
    return;
  }
  $('#templateList').innerHTML = categories.map((category, index) => {
    const defaults = category.defaults || {};
    return `
    <article data-template-index="${index}" data-template-category-id="${escapeHtml(category.id || '')}">
      <div class="template-title"><b>${escapeHtml(category.name)}</b><div class="row-actions"><button type="button" class="secondary" data-template-open-publish>打开发布页</button><button type="button" class="secondary" data-template-check-selectors>检查控件</button><button type="button" class="secondary" data-template-apply-diagnostics>套用当前诊断</button></div></div>
      ${renderTemplateSelectorStatus(defaults)}
      ${renderTemplateSelectorCheckResult(category.id || '')}
      <label>淘宝发布入口<input data-template-field="publishUrl" value="${escapeHtml(defaults.publishUrl || '')}"></label>
      <label>类目搜索关键词<input data-template-field="categoryKeyword" value="${escapeHtml(defaults.categoryKeyword || category.name || '')}"></label>
      <label>标题规则<input data-template-field="titleRule" value="${escapeHtml(defaults.titleRule || '')}"></label>
      <label>品牌<input data-template-field="brandName" value="${escapeHtml(defaults.brandName || '其他家')}"></label>
      <label>型号<input data-template-field="modelName" value="${escapeHtml(defaults.modelName || '其他')}"></label>
      <label>价格<input data-template-field="price" inputmode="decimal" value="${escapeHtml(defaults.price || '')}"></label>
      <label>库存<input data-template-field="stock" inputmode="numeric" value="${escapeHtml(defaults.stock || '')}"></label>
      <label>发货地<input data-template-field="shipFrom" value="${escapeHtml(defaults.shipFrom || '')}"></label>
      <label>运费模板<input data-template-field="freightTemplate" value="${escapeHtml(defaults.freightTemplate || '')}"></label>
      <label>服务模板<input data-template-field="serviceTemplate" value="${escapeHtml(defaults.serviceTemplate || '')}"></label>
      <label>固定属性<textarea data-template-field="attributesText" placeholder="材质=实木&#10;风格=中古风">${escapeHtml(templateAttributesValue(defaults.attributes || {}))}</textarea></label>
      <label>自定义字段<textarea data-template-field="customFieldsText" placeholder="发货时效=7天内发货|#delivery|select">${escapeHtml(templateCustomFieldsValue(defaults.customFields || []))}</textarea></label>
      <h4>淘宝页面规则</h4>
      ${templateSelectorInput(defaults, 'title', '标题输入框')}
      ${templateSelectorInput(defaults, 'categorySearch', '类目搜索框')}
      ${templateSelectorInput(defaults, 'categorySearchButton', '类目搜索按钮')}
      ${templateSelectorInput(defaults, 'categoryResult', '类目结果')}
      ${templateSelectorInput(defaults, 'brandName', '品牌输入框')}
      ${templateSelectorInput(defaults, 'modelName', '型号输入框')}
      ${templateSelectorInput(defaults, 'price', '价格输入框')}
      ${templateSelectorInput(defaults, 'stock', '库存输入框')}
      ${templateSelectorInput(defaults, 'shipFrom', '发货地控件')}
      ${templateSelectorInput(defaults, 'freightTemplate', '运费模板控件')}
      ${templateSelectorInput(defaults, 'serviceTemplate', '服务模板控件')}
      ${templateSelectorInput(defaults, 'mainImages', '主图上传框')}
      ${templateSelectorInput(defaults, 'ratioImages', '3:4 图上传框')}
      ${templateSelectorInput(defaults, 'detailImages', '详情图上传框')}
      ${templateSelectorInput(defaults, 'storeName', '当前店铺名称')}
      ${templateSelectorInput(defaults, 'saveDraft', '保存草稿按钮')}
      <label>保存草稿按钮规则<textarea data-template-field="saveDraftSelectors">${escapeHtml(templateListValue(defaults.saveDraftSelectors || []))}</textarea></label>
    </article>
  `;
  }).join('');
  renderReadiness();
}

function activateTab(tabId) {
  document.querySelectorAll('[data-tab]').forEach(item => item.classList.toggle('active', item.dataset.tab === tabId));
  document.querySelectorAll('.view').forEach(view => view.classList.toggle('active', view.id === tabId));
}

function openTaskTemplate(taskId) {
  const task = (state.tasks || []).find(item => item.id === taskId);
  if (!task?.categoryId) {
    log('当前任务没有关联类目模板');
    return;
  }
  activateTab('templates');
  const card = document.querySelector(`#templateList [data-template-category-id="${CSS.escape(task.categoryId)}"]`);
  if (!card) {
    log('没有找到当前任务对应的类目模板');
    return;
  }
  card.scrollIntoView({ block: 'start', behavior: 'smooth' });
  card.classList.add('template-focus');
  setTimeout(() => card.classList.remove('template-focus'), 1800);
}

async function openTaskPublishPage(taskId) {
  const task = (state.tasks || []).find(item => item.id === taskId);
  if (!task) return;
  const category = (state.settings?.categories || []).find(item => item.id === task.categoryId);
  if (!category) {
    log('没有找到当前任务对应的类目模板');
    return;
  }
  const publishUrl = String(category.defaults?.publishUrl || '').trim();
  if (!publishUrl) {
    log('请先填写该任务类目模板的淘宝发布入口');
    openTaskTemplate(taskId);
    return;
  }
  const storeId = task.storeId || state.activeStoreId;
  const store = state.stores.find(item => item.id === storeId) || getActiveStore();
  if (!storeId || !store) {
    log('没有找到该任务对应的淘宝店铺');
    return;
  }
  if (!window.caishenPublisher?.openTemplatePublishPage) {
    log('当前运行环境无法打开任务发布页');
    return;
  }
  const result = await window.caishenPublisher.openTemplatePublishPage({
    storeId,
    store,
    category,
    publishUrl,
    taskId: task.id,
    detail: { step: 'task-publish-page-opened', taskId: task.id, storeId }
  });
  log(`已打开任务发布页：${task.name || task.id} ${result?.url || publishUrl}`);
}

async function openTaskStoreLogin(taskId) {
  const task = (state.tasks || []).find(item => item.id === taskId);
  if (!task) return;
  const storeId = task.storeId || state.activeStoreId;
  const store = state.stores.find(item => item.id === storeId) || getActiveStore();
  if (!storeId || !store) {
    log('没有找到该任务对应的淘宝店铺');
    return;
  }
  if (!window.caishenPublisher?.openStoreLogin) {
    log('当前运行环境无法打开淘宝登录窗口');
    return;
  }
  await window.caishenPublisher.openStoreLogin({
    ...store,
    id: storeId,
    detail: { step: 'task-store-login-opened', taskId: task.id, storeId }
  });
  log(`已打开任务店铺登录窗口：${store.name || storeId}`);
}

async function checkTaskStoreLogin(taskId) {
  const task = (state.tasks || []).find(item => item.id === taskId);
  if (!task) return;
  const storeId = task.storeId || state.activeStoreId;
  const store = state.stores.find(item => item.id === storeId);
  if (!storeId || !store) {
    log('没有找到该任务对应的淘宝店铺');
    return;
  }
  await checkStoreLogin(storeId);
  log(`任务店铺登录已检查：${task.name || task.id} task-store-login-checked`);
}

function openTemplateCalibration(categoryId) {
  activateTab('templates');
  const card = document.querySelector(`#templateList [data-template-category-id="${CSS.escape(categoryId)}"]`);
  if (!card) {
    log('没有找到要校准的类目模板');
    return;
  }
  card.scrollIntoView({ block: 'start', behavior: 'smooth' });
  card.classList.add('template-focus');
  setTimeout(() => card.classList.remove('template-focus'), 1800);
}

async function syncOptions() {
  const data = await api.extensionOptions();
  state.user = data.user;
  state.token = data.token || '';
  state.settings = data;
  state.stores = filterStoresForCurrentUser(data.stores || []);
  state.activeStoreId = chooseActiveStoreId(data.localPublisher?.activeStoreId);
  saveActiveStoreId();
  renderShell();
  renderStores();
  renderTemplates();
}

async function logout() {
  try {
    await api.logout();
  } catch (error) {
    log(error.message || String(error));
  } finally {
    state.user = null;
    state.token = '';
    state.settings = null;
    state.stores = [];
    state.tasks = [];
    state.activeStoreId = '';
    state.activeTaskId = '';
    state.runningTaskId = '';
    state.syncStatus = { state: 'idle', startedAt: '', lastSuccessAt: '', lastError: '' };
    state.autoPublish = false;
    localStorage.removeItem('caishen.publisher.activeStoreId');
    localStorage.setItem('caishen.publisher.autoPublish', 'false');
    renderShell();
    renderStores();
    renderTasks();
    $('#templateList').innerHTML = '';
    log('Web 账号已退出，请重新登录后再发布任务');
  }
}

async function handleSessionExpired() {
  state.user = null;
  state.token = '';
  state.settings = null;
  state.stores = [];
  state.tasks = [];
  state.activeStoreId = '';
  state.activeTaskId = '';
  state.runningTaskId = '';
  state.taskFilter = 'all';
  state.syncStatus = { state: 'idle', startedAt: '', lastSuccessAt: '', lastError: '' };
  state.autoPublish = false;
  localStorage.removeItem('caishen.publisher.activeStoreId');
  localStorage.setItem('caishen.publisher.autoPublish', 'false');
  renderShell();
  renderStores();
  renderTasks();
  $('#templateList').innerHTML = '';
  log('Web 登录已失效，请重新登录后再发布任务');
}

async function handleApiError(error) {
  if (error && error.status === 401) {
    await handleSessionExpired();
    return;
  }
  log(error?.message || String(error));
}

async function runOperatorAction(action) {
  try {
    await action();
    return true;
  } catch (error) {
    await handleApiError(error);
    return false;
  }
}

async function refreshTasks() {
  if (!state.token || !state.user?.id || !state.activeStoreId) return;
  const data = await api.listTasks({
    token: state.token,
    userId: state.user.id,
    storeId: state.activeStoreId,
    deviceId: state.deviceId
  });
  state.tasks = data.tasks || [];
  renderTasks();
}

async function sendHeartbeat() {
  if (!state.user?.id) return;
  const next = await api.heartbeat({
    userId: state.user.id,
    deviceId: state.deviceId,
    deviceName: navigator.userAgent.includes('Windows') ? 'Windows 本地发布器' : '本地发布器',
    appVersion: state.appVersion,
    activeStoreId: state.activeStoreId,
    autoPublish: state.autoPublish
  });
  state.settings = next;
  state.stores = filterStoresForCurrentUser(next.stores || []);
  state.activeStoreId = chooseActiveStoreId(next.localPublisher?.activeStoreId);
  saveActiveStoreId();
  log('发布器状态已同步');
  renderShell();
  renderStores();
}

function publisherActorPayload() {
  return {
    userId: state.user?.id || '',
    storeId: state.activeStoreId || '',
    deviceId: state.deviceId || ''
  };
}

function isLoginManualIntervention(result = {}) {
  const text = [
    result.status,
    result.failureReason,
    result.detail?.step,
    result.detail?.diagnostics?.selectorCheck?.reason,
    result.detail?.diagnostics?.adapterResult?.reason
  ].filter(Boolean).join(' ');
  return /登录|扫码|安全验证|二次验证|验证码|滑块|风控|risk|captcha|login/i.test(text);
}

async function markActiveStoreOfflineForLoginIntervention(result) {
  if (!state.activeStoreId || !state.settings?.stores || !isLoginManualIntervention(result)) return;
  const stores = (state.settings.stores || []).map(store => store.id === state.activeStoreId
    ? {
        ...store,
        online: false,
        loginInvalidatedAt: new Date().toISOString(),
        loginInvalidatedReason: result?.failureReason || '淘宝登录状态需要重新确认'
      }
    : store);
  state.settings = await api.saveSettings({
    ...(state.settings || {}),
    stores,
    detail: {
      step: 'store-login-invalidated',
      storeId: state.activeStoreId,
      reason: result?.failureReason || ''
    }
  });
  setVisibleStores(state.settings.stores || stores);
  renderShell();
  renderStores();
  log('当前淘宝店铺登录状态已标记为失效，请重新登录并检查登录状态');
}

async function pauseAutoPublishForManualIntervention(result) {
  if (!result) return;
  const shouldPause = result.status === '需要人工处理';
  if (!shouldPause) return;
  await markActiveStoreOfflineForLoginIntervention(result);
  if (!state.autoPublish) return;
  state.autoPublish = false;
  localStorage.setItem('caishen.publisher.autoPublish', 'false');
  renderShell();
  await sendHeartbeat();
  log(`检测到需要人工处理，已暂停自动发布：${result.failureReason || '请处理当前淘宝窗口后再手动开启自动发布'}`);
}

async function attachDiagnosticScreenshot(detail = {}) {
  const screenshotPath = detail?.screenshotPath;
  if (!screenshotPath || !window.caishenPublisher?.readDiagnosticScreenshot) return detail || {};
  try {
    const diagnosticScreenshot = await window.caishenPublisher.readDiagnosticScreenshot(screenshotPath);
    if (!diagnosticScreenshot?.base64) return detail || {};
    return { ...(detail || {}), diagnosticScreenshot };
  } catch {
    return detail || {};
  }
}

function collectCategoryTemplates() {
  const categories = (state.settings?.categories || []).map(category => ({
    ...category,
    defaults: { ...(category.defaults || {}) }
  }));
  document.querySelectorAll('#templateList [data-template-index]').forEach(card => {
    const index = Number(card.dataset.templateIndex);
    if (!Number.isInteger(index) || !categories[index]) return;
    card.querySelectorAll('[data-template-field]').forEach(input => {
      if (input.dataset.templateField === 'saveDraftSelectors') {
        categories[index].defaults[input.dataset.templateField] = input.value.split('\n').map(item => item.trim()).filter(Boolean);
        return;
      }
      if (input.dataset.templateField === 'attributesText') {
        categories[index].defaults.attributes = parseTemplateAttributes(input.value);
        return;
      }
      if (input.dataset.templateField === 'customFieldsText') {
        categories[index].defaults.customFields = parseTemplateCustomFields(input.value);
        return;
      }
      categories[index].defaults[input.dataset.templateField] = input.value.trim();
    });
    categories[index].defaults.selectors = { ...(categories[index].defaults.selectors || {}) };
    card.querySelectorAll('[data-template-selector]').forEach(input => {
      const key = input.dataset.templateSelector;
      const value = input.value.trim();
      if (value) categories[index].defaults.selectors[key] = value;
      else delete categories[index].defaults.selectors[key];
    });
  });
  return categories;
}

async function saveCategoryTemplates() {
  const categories = collectCategoryTemplates();
  state.settings = await api.saveSettings({ ...(state.settings || {}), categories });
  renderTemplates();
  log('类目模板已保存');
}

async function exportCategoryTemplates() {
  if (!window.caishenPublisher?.exportTemplates) {
    log('\u5f53\u524d\u8fd0\u884c\u73af\u5883\u65e0\u6cd5\u5bfc\u51fa\u6a21\u677f');
    return;
  }
  const result = await window.caishenPublisher.exportTemplates({
    settings: { ...(state.settings || {}), categories: collectCategoryTemplates() }
  });
  if (result?.canceled) return;
  log(`\u6a21\u677f\u5df2\u5bfc\u51fa\uff1a${result?.filePath || ''}`);
}

async function importCategoryTemplates() {
  if (!window.caishenPublisher?.importTemplates) {
    log('\u5f53\u524d\u8fd0\u884c\u73af\u5883\u65e0\u6cd5\u5bfc\u5165\u6a21\u677f');
    return;
  }
  const result = await window.caishenPublisher.importTemplates();
  if (result?.canceled) return;
  const categories = Array.isArray(result?.categories) ? result.categories : [];
  if (!categories.length) {
    log('\u6a21\u677f\u6587\u4ef6\u6ca1\u6709\u53ef\u5bfc\u5165\u7684\u7c7b\u76ee');
    return;
  }
  state.settings = await api.saveSettings({ ...(state.settings || {}), categories });
  renderTemplates();
  log(`\u5df2\u5bfc\u5165 ${categories.length} \u4e2a\u7c7b\u76ee\u6a21\u677f\uff0c\u5e76\u540c\u6b65\u5230 Web/API`);
}

function installTemplateTransferButtons() {
  const saveButton = $('#saveTemplatesButton');
  if (!saveButton || $('#exportTemplatesButton')) return;
  const importButton = document.createElement('button');
  importButton.id = 'importTemplatesButton';
  importButton.type = 'button';
  importButton.className = 'secondary';
  importButton.textContent = '\u5bfc\u5165\u6a21\u677f';
  const exportButton = document.createElement('button');
  exportButton.id = 'exportTemplatesButton';
  exportButton.type = 'button';
  exportButton.className = 'secondary';
  exportButton.textContent = '\u5bfc\u51fa\u6a21\u677f';
  saveButton.before(importButton, exportButton);
}

async function pickTemplateSelector(input) {
  const activeStore = getActiveStore();
  if (!activeStore) {
    log('请先选择淘宝店铺，再读取页面控件');
    return;
  }
  if (!window.caishenPublisher?.getActiveElementSelector) {
    log('当前运行环境无法读取淘宝页面控件');
    return;
  }
  const result = await window.caishenPublisher.getActiveElementSelector(activeStore);
  if (!result?.ok || !result.selector) {
    log(result?.reason || '没有读取到淘宝页面控件，请先在淘宝窗口点击目标输入框');
    return;
  }
  input.value = result.selector;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  log(`已读取淘宝控件选择器：${result.selector}${result.label ? `（${result.label}）` : ''}`);
}

async function captureTemplateDiagnostics() {
  if (!state.activeStoreId) {
    log('请先选择淘宝店铺，再采集当前淘宝页面');
    return;
  }
  if (!window.caishenPublisher?.capturePage) {
    log('当前运行环境无法采集淘宝页面诊断');
    return;
  }
  const result = await window.caishenPublisher.capturePage({ storeId: state.activeStoreId });
  if (!result?.ok) {
    log(result?.reason || '淘宝窗口未打开，请先在店铺管理中打开淘宝登录窗口');
    return;
  }
  const payload = {
    storeId: state.activeStoreId,
    storeName: getActiveStore()?.name || '',
    screenshotPath: result.file || '',
    detail: result.detail || {},
    capturedAt: new Date().toISOString()
  };
  state.lastTemplateDiagnostics = payload;
  await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
  const fieldCount = Array.isArray(payload.detail.visibleFields) ? payload.detail.visibleFields.length : 0;
  const buttonCount = Array.isArray(payload.detail.visibleButtons) ? payload.detail.visibleButtons.length : 0;
  log(`当前淘宝页面诊断已复制：${fieldCount} 个输入控件，${buttonCount} 个按钮，截图 ${result.file || '未生成'}`);
}

function taskTemplateCalibrationBlocker(task = {}) {
  if (!task?.categoryId) return null;
  const category = (state.settings?.categories || []).find(item => item.id === task.categoryId);
  if (!category) {
    return {
      reason: '任务类目模板不存在，请先同步或创建模板',
      status: 'missing',
      categoryName: task.categoryId
    };
  }
  const item = templateCalibrationSummary().items.find(entry => entry.id === category.id);
  if (!item || item.status !== 'ok') {
    return {
      reason: item?.detail || '类目模板控件还没有通过当前淘宝店铺校准',
      status: item?.status || 'unchecked',
      categoryName: category.name || category.id
    };
  }
  return null;
}

async function markTaskTemplateCalibrationRequired(task = {}, blocker = {}) {
  if (!task?.id || !state.token) return;
  const failureReason = `模板控件未校准：${blocker.categoryName || task.categoryId || '未知类目'}，${blocker.reason || '请先检查淘宝页面控件'}`;
  await api.updateTaskStatus(task.id, {
    token: state.token,
    ...publisherActorPayload(),
    status: '模板未配置',
    failureReason,
    detail: {
      step: 'local-publisher-template-calibration-required',
      storeId: state.activeStoreId,
      deviceId: state.deviceId,
      categoryId: task.categoryId || '',
      calibrationStatus: blocker.status || 'unchecked',
      requiredAction: '打开当前淘宝店铺的发布页，在模板配置中点击检查控件'
    }
  });
  log(failureReason);
  await refreshTasks();
}

async function markTaskPublishReadinessFailed(task = {}, blocker = {}) {
  if (!task?.id || !state.token) return;
  const failureReason = blocker.reason || '任务发布前检查未通过';
  await api.updateTaskStatus(task.id, {
    token: state.token,
    ...publisherActorPayload(),
    status: blocker.status || '发布失败',
    failureReason,
    detail: {
      ...(blocker.detail || {}),
      step: blocker.step || blocker.detail?.step || 'local-publisher-readiness-blocked',
      storeId: state.activeStoreId,
      deviceId: state.deviceId,
      requiredAction: '先处理任务发布前阻断原因，再重新发布'
    }
  });
  log(failureReason);
  await refreshTasks();
}

async function claimNextTask() {
  if (state.runningTaskId || !state.token || !state.user?.id) return;
  const blocker = publisherBlocker();
  if (blocker) {
    logPublisherBlocker(blocker);
    return;
  }
  const nextLocalTask = (state.tasks || []).find(task => waitingStatuses.has(task.status) && (!task.storeId || task.storeId === state.activeStoreId));
  const calibrationBlocker = taskTemplateCalibrationBlocker(nextLocalTask);
  if (calibrationBlocker) {
    await markTaskTemplateCalibrationRequired(nextLocalTask, calibrationBlocker);
    return;
  }
  const readinessBlocker = await taskPublishPreflightBlocker(nextLocalTask);
  if (readinessBlocker) {
    await markTaskPublishReadinessFailed(nextLocalTask, readinessBlocker);
    return;
  }
  state.lastPublisherBlocker = '';
  const task = await api.claimNextTask({
    token: state.token,
    userId: state.user.id,
    storeId: state.activeStoreId,
    deviceId: state.deviceId
  });
  if (!task) return;
  await executeClaimedTask(task);
}

async function executeClaimedTask(task) {
  if (!task || state.runningTaskId) return;
  state.runningTaskId = task.id;
  try {
    log(`已领取任务：${task.name}`);
    const activeStore = state.stores.find(store => store.id === state.activeStoreId) || task.store || {};
    await api.updateTaskStatus(task.id, {
      token: state.token,
      ...publisherActorPayload(),
      status: '正在打开淘宝',
      detail: { step: 'local-publisher-runner-start', storeId: state.activeStoreId, deviceId: state.deviceId }
    });
    const result = await runTaobaoTask({
      task,
      store: activeStore,
      storeId: state.activeStoreId,
      deviceId: state.deviceId,
      dryRun: state.dryRun,
      onStage: async stage => {
        log(`${task.name}: ${stage.status}`);
        await api.updateTaskStatus(task.id, {
          token: state.token,
          ...publisherActorPayload(),
          status: stage.status,
          detail: { ...stage, storeId: state.activeStoreId, deviceId: state.deviceId }
        });
        state.tasks = state.tasks.map(item => item.id === task.id ? { ...item, status: stage.status } : item);
        renderTasks();
      }
    });
    await api.updateTaskStatus(task.id, {
      token: state.token,
      ...publisherActorPayload(),
      status: result.status || (result.ok ? '已保存草稿' : '发布失败'),
      failureReason: result.failureReason || '',
      detail: await attachDiagnosticScreenshot(result.detail || { step: 'local-publisher-runner-complete', storeId: state.activeStoreId, deviceId: state.deviceId })
    });
    if (result.detail?.step === 'local-publisher-dry-run-complete') {
      log(`\u8bd5\u8fd0\u884c\u5b8c\u6210\uff1a${task.name}\uff0c\u672a\u6253\u5f00\u6dd8\u5b9d\uff0c\u672a\u4fdd\u5b58\u8349\u7a3f`);
    }
    await pauseAutoPublishForManualIntervention(result);
  } finally {
    state.runningTaskId = '';
    await refreshTasks();
  }
}

async function manualRunTask(taskId) {
  if (state.runningTaskId || !state.token || !state.user?.id) return;
  const blocker = publisherBlocker({ requireAuto: false });
  if (blocker) {
    logPublisherBlocker(blocker);
    return;
  }
  const localTask = (state.tasks || []).find(item => item.id === taskId);
  const calibrationBlocker = taskTemplateCalibrationBlocker(localTask);
  if (calibrationBlocker) {
    await markTaskTemplateCalibrationRequired(localTask, calibrationBlocker);
    return;
  }
  const readinessBlocker = await taskPublishPreflightBlocker(localTask);
  if (readinessBlocker) {
    await markTaskPublishReadinessFailed(localTask, readinessBlocker);
    return;
  }
  const task = await api.claimSpecificTask({
    token: state.token,
    userId: state.user.id,
    storeId: state.activeStoreId,
    deviceId: state.deviceId,
    taskId
  });
  if (!task) {
    log('没有领取到选中的任务，请刷新队列后再试');
    await refreshTasks();
    return;
  }
  state.lastPublisherBlocker = '';
  await executeClaimedTask(task);
}

async function runTaobaoTask(payload) {
  if (!window.caishenPublisher?.runTaobaoTask) {
    return {
      ok: false,
      status: '发布失败',
      failureReason: '当前运行环境不是桌面发布器，无法打开独立淘宝窗口。',
      detail: { step: 'desktop-bridge-missing' }
    };
  }
  return window.caishenPublisher.runTaobaoTask(payload);
}

async function requestRunningTaskPause(taskId = state.runningTaskId) {
  if (!taskId || !window.caishenPublisher?.cancelTaobaoTask) return;
  const result = await window.caishenPublisher.cancelTaobaoTask(taskId);
  if (result?.ok) log(`\u5df2\u8bf7\u6c42\u6682\u505c\u5f53\u524d\u4efb\u52a1\uff1a${taskId}`);
}

async function pauseRunningTaskFromOperator(taskId) {
  if (!state.token || !taskId) return;
  const task = (state.tasks || []).find(item => item.id === taskId);
  if (!task || !runningStatuses.has(task.status)) return;
  if (!confirm(`暂停任务「${task.name || task.id}」？当前淘宝窗口会在下一个安全步骤停下。`)) return;
  await requestRunningTaskPause(taskId);
  await api.updateTaskStatus(taskId, {
    token: state.token,
    ...publisherActorPayload(),
    status: '已暂停',
    failureReason: '运营已暂停当前发布任务',
    detail: {
      ...(task.detail || {}),
      step: 'taobao-runner-cancelled',
      pauseReason: 'operator clicked pause',
      storeId: state.activeStoreId,
      deviceId: state.deviceId,
      pausedAt: new Date().toISOString()
    }
  });
  if (state.runningTaskId === taskId) state.runningTaskId = '';
  log(`任务已暂停：${task.name || task.id}`);
  await refreshTasks();
}

async function confirmStoreLoggedIn(storeId) {
  const stores = (state.settings?.stores || []).map(store => store.id === storeId ? { ...store, online: true } : store);
  state.settings = await api.saveSettings({ ...(state.settings || {}), stores });
  setVisibleStores(state.settings.stores || []);
  renderShell();
  renderStores();
  log('淘宝店铺登录状态已确认');
}

async function checkStoreLogin(storeId) {
  const store = state.stores.find(item => item.id === storeId);
  if (!store) return;
  if (!window.caishenPublisher?.checkStoreLogin) {
    log('当前运行环境无法检查淘宝登录状态');
    return;
  }
  const result = await window.caishenPublisher.checkStoreLogin(store);
  const stores = (state.settings?.stores || []).map(item => item.id === storeId
    ? { ...item, name: result.storeName || item.name, online: Boolean(result.online) }
    : item);
  state.settings = await api.saveSettings({ ...(state.settings || {}), stores });
  setVisibleStores(state.settings.stores || []);
  renderShell();
  renderStores();
  log(`${store.name}：${result.online ? '淘宝登录有效' : `淘宝登录失效，${result.reason || '请重新登录'}`}`);
}

async function clearStoreLogin(storeId) {
  const store = state.stores.find(item => item.id === storeId);
  if (!store) return;
  if (!window.caishenPublisher?.clearStoreLogin) {
    log('当前运行环境无法清除淘宝登录态');
    return;
  }
  await window.caishenPublisher.clearStoreLogin(store);
  const stores = (state.settings?.stores || []).map(item => item.id === storeId ? { ...item, online: false } : item);
  state.settings = await api.saveSettings({ ...(state.settings || {}), stores });
  setVisibleStores(state.settings.stores || []);
  renderShell();
  renderStores();
  log(`${store.name}：淘宝登录态已清除，需要重新登录后才能自动发布`);
}

async function toggleStoreAutoPublish(storeId) {
  const store = state.stores.find(item => item.id === storeId);
  if (!store) return;
  const nextEnabled = store.autoPublish === false;
  const stores = (state.settings?.stores || []).map(item => item.id === storeId ? { ...item, autoPublish: nextEnabled } : item);
  state.settings = await api.saveSettings({ ...(state.settings || {}), stores });
  setVisibleStores(state.settings.stores || []);
  renderShell();
  renderStores();
  log(`${store.name}：店铺自动发布已${nextEnabled ? '启用' : '停用'}`);
}

async function renameStore(storeId) {
  const store = state.stores.find(item => item.id === storeId);
  if (!store) return;
  const nextName = String(prompt('请输入新的淘宝店铺名称', store.name || '') || '').trim();
  if (!nextName || nextName === store.name) return;
  const stores = (state.settings?.stores || []).map(item => item.id === storeId ? { ...item, name: nextName } : item);
  state.settings = await api.saveSettings({ ...(state.settings || {}), stores });
  setVisibleStores(state.settings.stores || []);
  renderShell();
  renderStores();
  log(`店铺名称已更新：${store.name} -> ${nextName}`);
}

async function deleteStore(storeId) {
  const store = state.stores.find(item => item.id === storeId);
  if (!store) return;
  if (!confirm(`删除店铺「${store.name}」？这会移除本发布器中的店铺档案，淘宝密码不会被保存。`)) return;
  const stores = (state.settings?.stores || []).filter(item => item.id !== storeId);
  if (state.activeStoreId === storeId) {
    state.activeStoreId = stores[0]?.id || '';
    saveActiveStoreId();
  }
  state.settings = await api.saveSettings({ ...(state.settings || {}), stores });
  setVisibleStores(state.settings.stores || []);
  renderShell();
  renderStores();
  log(`已删除店铺：${store.name}`);
}

async function retryTask(taskId) {
  if (!state.token) return;
  await api.updateTaskStatus(taskId, {
    token: state.token,
    ...publisherActorPayload(),
    status: '等待插件接收',
    detail: {
      step: 'local-publisher-retry-requested',
      retryReason: 'operator clicked retry',
      storeId: state.activeStoreId,
      deviceId: state.deviceId
    }
  });
  log('任务已重新放回待发布队列');
  await refreshTasks();
}

async function realRunTask(taskId) {
  state.dryRun = false;
  localStorage.setItem('caishen.publisher.dryRun', 'false');
  renderShell();
  log('试运行已关闭，任务将进入正式发布流程');
  await retryTask(taskId);
}

async function skipTask(taskId) {
  if (!state.token) return;
  const task = (state.tasks || []).find(item => item.id === taskId);
  const message = task?.name ? `跳过任务：${task.name}` : '跳过任务';
  if (!confirm(`${message}？跳过后不会被本地发布器自动领取。`)) return;
  await api.updateTaskStatus(taskId, {
    token: state.token,
    ...publisherActorPayload(),
    status: '已跳过本地发布',
    detail: {
      step: 'local-publisher-skip-requested',
      skipReason: 'operator clicked skip',
      storeId: state.activeStoreId,
      deviceId: state.deviceId,
      skippedAt: new Date().toISOString()
    }
  });
  log('任务已跳过本地发布，不会自动领取');
  await refreshTasks();
}

async function tick() {
  try {
    if (state.user) {
      recordSyncStart();
      await sendHeartbeat();
      await refreshTasks();
      await claimNextTask();
      recordSyncSuccess();
    }
  } catch (error) {
    recordSyncFailure(error);
    await handleApiError(error);
  }
}

$('#loginForm').addEventListener('submit', async event => {
  event.preventDefault();
  const data = new FormData(event.currentTarget);
  try {
    api.setBaseUrl(data.get('baseUrl'));
    renderShell();
    const result = await api.login(data.get('username'), data.get('password'));
    state.user = result.user;
    await syncOptions();
    await sendHeartbeat();
    await refreshTasks();
    recordSyncSuccess();
    log('Web account signed in');
  } catch (error) {
    recordSyncFailure(error);
    log(error.message || String(error));
  }
});

document.querySelectorAll('[data-tab]').forEach(button => {
  button.addEventListener('click', () => activateTab(button.dataset.tab));
});

$('#operatorGuideList').addEventListener('click', event => {
  const button = event.target.closest('[data-guide-action]');
  if (!button) return;
  handleOperatorGuideAction(button.dataset.guideAction);
});

$('#autoPublishToggle').addEventListener('change', event => runOperatorAction(async () => {
  state.autoPublish = event.target.checked;
  localStorage.setItem('caishen.publisher.autoPublish', String(state.autoPublish));
  renderShell();
  if (!state.autoPublish) await requestRunningTaskPause();
  log(state.autoPublish ? '自动发布已开启' : '自动发布已暂停，不会领取新的发布任务');
  await sendHeartbeat();
}));

$('#dryRunToggle').addEventListener('change', event => {
  state.dryRun = event.target.checked;
  localStorage.setItem('caishen.publisher.dryRun', String(state.dryRun));
  renderShell();
  log(state.dryRun
    ? '\u8bd5\u8fd0\u884c\u5df2\u5f00\u542f\uff1a\u4f1a\u9886\u53d6\u5e76\u68c0\u67e5\u4efb\u52a1\uff0c\u4e0d\u4f1a\u6253\u5f00\u6dd8\u5b9d\u6216\u4fdd\u5b58\u8349\u7a3f'
    : '\u8bd5\u8fd0\u884c\u5df2\u5173\u95ed\uff1a\u540e\u7eed\u4efb\u52a1\u5c06\u6309\u6b63\u5e38\u6d41\u7a0b\u6253\u5f00\u6dd8\u5b9d\u4fdd\u5b58\u8349\u7a3f');
});

$('#storeList').addEventListener('click', async event => {
  const loginButton = event.target.closest('[data-store-login]');
  if (loginButton) {
    const store = state.stores.find(item => item.id === loginButton.dataset.storeLogin);
    if (!store) return;
    try {
      await window.caishenPublisher?.openStoreLogin?.(store);
      log(`已打开淘宝登录窗口：${store.name}`);
    } catch (error) {
      await handleApiError(error);
    }
    return;
  }
  const onlineButton = event.target.closest('[data-store-online]');
  if (onlineButton) {
    await runOperatorAction(() => confirmStoreLoggedIn(onlineButton.dataset.storeOnline));
    return;
  }
  const checkButton = event.target.closest('[data-store-check]');
  if (checkButton) {
    await runOperatorAction(() => checkStoreLogin(checkButton.dataset.storeCheck));
    return;
  }
  const clearButton = event.target.closest('[data-store-clear]');
  if (clearButton) {
    await runOperatorAction(() => clearStoreLogin(clearButton.dataset.storeClear));
    return;
  }
  const toggleAutoButton = event.target.closest('[data-store-toggle-auto]');
  if (toggleAutoButton) {
    await runOperatorAction(() => toggleStoreAutoPublish(toggleAutoButton.dataset.storeToggleAuto));
    return;
  }
  const renameButton = event.target.closest('[data-store-rename]');
  if (renameButton) {
    await runOperatorAction(() => renameStore(renameButton.dataset.storeRename));
    return;
  }
  const deleteButton = event.target.closest('[data-store-delete]');
  if (deleteButton) {
    await runOperatorAction(() => deleteStore(deleteButton.dataset.storeDelete));
    return;
  }
  const button = event.target.closest('[data-store-active]');
  if (!button) return;
  state.activeStoreId = button.dataset.storeActive;
  saveActiveStoreId();
  renderShell();
  renderStores();
  await runOperatorAction(() => sendHeartbeat());
});

$('#taskList').addEventListener('click', async event => {
  const openTemplateButton = event.target.closest('[data-task-open-template]');
  if (openTemplateButton) {
    openTaskTemplate(openTemplateButton.dataset.taskOpenTemplate);
    return;
  }
  const runButton = event.target.closest('[data-task-run]');
  if (runButton) {
    await runOperatorAction(() => manualRunTask(runButton.dataset.taskRun));
    return;
  }
  const retryButton = event.target.closest('[data-task-retry]');
  if (retryButton) {
    await runOperatorAction(() => retryTask(retryButton.dataset.taskRetry));
    return;
  }
  const realRunButton = event.target.closest('[data-task-real-run]');
  if (realRunButton) {
    await runOperatorAction(() => realRunTask(realRunButton.dataset.taskRealRun));
    return;
  }
  const pauseButton = event.target.closest('[data-task-pause]');
  if (pauseButton) {
    await runOperatorAction(() => pauseRunningTaskFromOperator(pauseButton.dataset.taskPause));
    return;
  }
  const openPublishPageButton = event.target.closest('[data-task-open-publish-page]');
  if (openPublishPageButton) {
    await runOperatorAction(() => openTaskPublishPage(openPublishPageButton.dataset.taskOpenPublishPage));
    return;
  }
  const openStoreLoginButton = event.target.closest('[data-task-open-store-login]');
  if (openStoreLoginButton) {
    await runOperatorAction(() => openTaskStoreLogin(openStoreLoginButton.dataset.taskOpenStoreLogin));
    return;
  }
  const checkStoreLoginButton = event.target.closest('[data-task-check-store-login]');
  if (checkStoreLoginButton) {
    await runOperatorAction(() => checkTaskStoreLogin(checkStoreLoginButton.dataset.taskCheckStoreLogin));
    return;
  }
  const copyDiagnosticButton = event.target.closest('[data-task-copy-diagnostic]');
  if (copyDiagnosticButton) {
    await runOperatorAction(() => copyTaskDiagnostic(copyDiagnosticButton.dataset.taskCopyDiagnostic));
    return;
  }
  const exportDiagnosticButton = event.target.closest('[data-task-export-diagnostic]');
  if (exportDiagnosticButton) {
    await runOperatorAction(() => exportTaskDiagnosticsBundle(exportDiagnosticButton.dataset.taskExportDiagnostic));
    return;
  }
  const skipButton = event.target.closest('[data-task-skip]');
  if (skipButton) {
    await runOperatorAction(() => skipTask(skipButton.dataset.taskSkip));
    return;
  }
  const taskCard = event.target.closest('[data-task-select]');
  if (!taskCard) return;
  state.activeTaskId = taskCard.dataset.taskSelect;
  renderTasks();
});

$('#taskFilterBar')?.addEventListener('click', event => {
  const button = event.target.closest('[data-task-filter]');
  if (!button) return;
  state.taskFilter = button.dataset.taskFilter || 'all';
  renderTasks();
});

$('#taskDetailPanel').addEventListener('click', event => {
  const openTemplateButton = event.target.closest('[data-task-open-template]');
  if (openTemplateButton) {
    openTaskTemplate(openTemplateButton.dataset.taskOpenTemplate);
    return;
  }
  const runButton = event.target.closest('[data-task-run]');
  if (runButton) {
    runOperatorAction(() => manualRunTask(runButton.dataset.taskRun));
    return;
  }
  const retryButton = event.target.closest('[data-task-retry]');
  if (retryButton) {
    runOperatorAction(() => retryTask(retryButton.dataset.taskRetry));
    return;
  }
  const realRunButton = event.target.closest('[data-task-real-run]');
  if (realRunButton) {
    runOperatorAction(() => realRunTask(realRunButton.dataset.taskRealRun));
    return;
  }
  const pauseButton = event.target.closest('[data-task-pause]');
  if (pauseButton) {
    runOperatorAction(() => pauseRunningTaskFromOperator(pauseButton.dataset.taskPause));
    return;
  }
  const openPublishPageButton = event.target.closest('[data-task-open-publish-page]');
  if (openPublishPageButton) {
    runOperatorAction(() => openTaskPublishPage(openPublishPageButton.dataset.taskOpenPublishPage));
    return;
  }
  const openStoreLoginButton = event.target.closest('[data-task-open-store-login]');
  if (openStoreLoginButton) {
    runOperatorAction(() => openTaskStoreLogin(openStoreLoginButton.dataset.taskOpenStoreLogin));
    return;
  }
  const checkStoreLoginButton = event.target.closest('[data-task-check-store-login]');
  if (checkStoreLoginButton) {
    runOperatorAction(() => checkTaskStoreLogin(checkStoreLoginButton.dataset.taskCheckStoreLogin));
    return;
  }
  const copyDiagnosticButton = event.target.closest('[data-task-copy-diagnostic]');
  if (copyDiagnosticButton) {
    runOperatorAction(() => copyTaskDiagnostic(copyDiagnosticButton.dataset.taskCopyDiagnostic));
    return;
  }
  const exportDiagnosticButton = event.target.closest('[data-task-export-diagnostic]');
  if (!exportDiagnosticButton) return;
  runOperatorAction(() => exportTaskDiagnosticsBundle(exportDiagnosticButton.dataset.taskExportDiagnostic));
});

$('#templateCalibrationList')?.addEventListener('click', event => {
  const openButton = event.target.closest('[data-template-calibration-open]');
  if (!openButton) return;
  openTemplateCalibration(openButton.dataset.templateCalibrationOpen);
});

$('#templateList').addEventListener('click', async event => {
  const openPublishButton = event.target.closest('[data-template-open-publish]');
  if (openPublishButton) {
    await runOperatorAction(() => openTemplatePublishPage(openPublishButton.closest('[data-template-index]')));
    return;
  }
  const checkButton = event.target.closest('[data-template-check-selectors]');
  if (checkButton) {
    await runOperatorAction(() => checkTemplateSelectors(checkButton.closest('[data-template-index]')));
    return;
  }
  const applyButton = event.target.closest('[data-template-apply-diagnostics]');
  if (applyButton) {
    await runOperatorAction(() => applyTemplateDiagnosticsSelectors(applyButton.closest('[data-template-index]')));
    return;
  }
  const pickButton = event.target.closest('[data-template-pick-selector]');
  if (!pickButton) return;
  const input = pickButton.closest('.selector-field')?.querySelector('[data-template-selector]');
  if (!input) return;
  try {
    await pickTemplateSelector(input);
  } catch (error) {
    log(error.message || String(error));
  }
});

$('#addStoreButton').addEventListener('click', async () => {
  if (!state.user?.id) {
    log('请先登录 Web 账号，再添加淘宝店铺');
    return;
  }
  const name = nextTemporaryStoreName();
  const id = `store-${crypto.randomUUID()}`;
  const newStore = {
    id,
    name,
    ownerUserId: state.user.id,
    ownerUsername: state.user?.username || '',
    ownerDisplayName: state.user?.displayName || '',
    profileDir: `profiles/${id}`,
    autoPublish: true,
    online: false,
    createdAt: new Date().toISOString()
  };
  const stores = [
    ...(state.settings?.stores || []),
    newStore
  ];
  const saved = await runOperatorAction(async () => {
    state.settings = await api.saveSettings({ ...(state.settings || {}), stores });
    setVisibleStores(state.settings.stores || []);
    state.activeStoreId = id;
    saveActiveStoreId();
    renderShell();
    renderStores();
    renderTemplates();
    await sendHeartbeat();
    log(`已添加店铺：${name}`);
  });
  if (!saved) return;
  try {
    await window.caishenPublisher?.openStoreLogin?.(newStore);
    log(`已打开淘宝登录窗口：${name}`);
  } catch (error) {
    await handleApiError(error);
  }
});

$('#logoutButton').addEventListener('click', logout);
$('#refreshTasksButton').addEventListener('click', () => runOperatorAction(async () => {
  recordSyncStart();
  await refreshTasks();
  recordSyncSuccess();
}));
$('#clearLogsButton').addEventListener('click', clearPublisherLogs);
$('#exportDiagnosticsButton').addEventListener('click', () => runOperatorAction(() => exportDiagnosticsBundle()));
$('#exportLogsButton').addEventListener('click', async () => {
  try {
    await window.caishenPublisher?.openLog?.();
  } catch (error) {
    await handleApiError(error);
  }
});
$('#captureTemplateDiagnosticsButton').addEventListener('click', () => runOperatorAction(() => captureTemplateDiagnostics()));
$('#applyTemplateDiagnosticsButton').addEventListener('click', () => runOperatorAction(() => applyTemplateDiagnosticsSelectors()));
installTemplateTransferButtons();
$('#importTemplatesButton')?.addEventListener('click', () => runOperatorAction(() => importCategoryTemplates()));
$('#exportTemplatesButton')?.addEventListener('click', () => runOperatorAction(() => exportCategoryTemplates()));
$('#saveTemplatesButton').addEventListener('click', () => runOperatorAction(() => saveCategoryTemplates()));

$('#loginForm [name="baseUrl"]').value = localStorage.getItem('caishen.publisher.baseUrl') || api.baseUrl;
renderShell();
loadAppInfo().catch(() => {});
loadPersistedLogs().catch(() => {});
setInterval(tick, 5000);
api.status().then(data => {
  if (data.authenticated) return syncOptions().then(sendHeartbeat).then(refreshTasks);
}).catch(() => {});
