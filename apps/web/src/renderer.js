const QUEUE_STORAGE_KEY = 'caishen-web-task-queue-v1';
const TEMPLATE_MASTER_CANDIDATES_STORAGE_KEY = 'caishen-web-template-master-candidates-v1';
const ASSET_PREVIEW_SIZE_STORAGE_KEY = 'caishen-web-asset-preview-sizes-v1';
const REVIEW_VIEWED_STORAGE_KEY = 'caishen-web-viewed-review-jobs-v1';
const REVIEW_REGENERATION_RECORDS_STORAGE_KEY = 'caishen-web-review-regeneration-records-v1';
const SIDEBAR_COLLAPSED_STORAGE_KEY = 'caishen-web-sidebar-collapsed-v1';
const IMAGE_PREVIEW_SIZE_STORAGE_KEY = 'duoxiluka-image-preview-size-v1';
let storageScope = 'anonymous';
const scopedStorageKey = key => `${key}:${storageScope}`;

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

function loadStoredQueue() {
  try {
    const items = JSON.parse(localStorage.getItem(scopedStorageKey(QUEUE_STORAGE_KEY)) || '[]');
    if (!Array.isArray(items)) return [];
    return items.filter(item => item && item.id && item.printPath).map(item => ({
      ...item,
      selected: item.selected !== false,
      status: ['排队中', '生成中'].includes(item.status) ? '未开始' : (item.status || '未开始'),
      error: ['排队中', '生成中'].includes(item.status) ? '页面曾关闭，将继续查询原后台任务。' : (item.error || '')
    }));
  } catch {
    return [];
  }
}

function persistQueue() {
  try { localStorage.setItem(scopedStorageKey(QUEUE_STORAGE_KEY), JSON.stringify(state.queue.slice(-500))); } catch {}
}

function loadStoredTemplateMasterCandidates() {
  try {
    const items = JSON.parse(localStorage.getItem(scopedStorageKey(TEMPLATE_MASTER_CANDIDATES_STORAGE_KEY)) || '[]');
    if (!Array.isArray(items)) return [];
    return items.filter(item => item && item.id && (item.masterReferencePath || item.printPath || item.masterImagePath)).map(item => ({
      ...item,
      selected: Boolean(item.selected),
      masterStatus: ['生成中', '重新生成'].includes(item.masterStatus)
        ? (item.masterImagePath ? '已生成' : '未生成')
        : (item.masterStatus || '未生成'),
      masterProgress: ['生成中', '重新生成'].includes(item.masterStatus) ? null : (item.masterProgress || null),
      masterError: ['生成中', '重新生成'].includes(item.masterStatus) ? '页面曾关闭，请重新生成母版。' : (item.masterError || '')
    })).slice(-200);
  } catch {
    return [];
  }
}

function persistTemplateMasterCandidates() {
  try { localStorage.setItem(scopedStorageKey(TEMPLATE_MASTER_CANDIDATES_STORAGE_KEY), JSON.stringify(state.templateMasterCandidates.slice(-200))); } catch {}
}

function loadStoredAssetPreviewSizes() {
  try {
    const saved = JSON.parse(localStorage.getItem(scopedStorageKey(ASSET_PREVIEW_SIZE_STORAGE_KEY)) || '{}');
    return {
      printsPath: Math.max(110, Math.min(240, Number(saved.printsPath) || 138)),
      detailSetsPath: Math.max(110, Math.min(240, Number(saved.detailSetsPath) || 138))
    };
  } catch {
    return { printsPath: 138, detailSetsPath: 138 };
  }
}

function persistAssetPreviewSizes() {
  try { localStorage.setItem(scopedStorageKey(ASSET_PREVIEW_SIZE_STORAGE_KEY), JSON.stringify(state.assetPreviewSizes)); } catch {}
}

function loadImagePreviewSize() {
  try { return Math.max(28, Math.min(50, Number(localStorage.getItem(IMAGE_PREVIEW_SIZE_STORAGE_KEY)) || 38)); }
  catch { return 38; }
}

function loadViewedReviewJobs() {
  try {
    const saved = JSON.parse(localStorage.getItem(scopedStorageKey(REVIEW_VIEWED_STORAGE_KEY)) || '[]');
    return new Set(Array.isArray(saved) ? saved.map(String).slice(-3000) : []);
  } catch {
    return new Set();
  }
}

function persistViewedReviewJobs() {
  try { localStorage.setItem(scopedStorageKey(REVIEW_VIEWED_STORAGE_KEY), JSON.stringify([...state.viewedReviewJobs].slice(-3000))); } catch {}
}

function loadReviewRegenerationRecords() {
  try {
    const saved = JSON.parse(localStorage.getItem(scopedStorageKey(REVIEW_REGENERATION_RECORDS_STORAGE_KEY)) || '[]');
    if (!Array.isArray(saved)) return [];
    return saved.filter(record => record && record.id && record.folder && record.relativePath).slice(-300);
  } catch {
    return [];
  }
}

function persistReviewRegenerationRecords() {
  try { localStorage.setItem(scopedStorageKey(REVIEW_REGENERATION_RECORDS_STORAGE_KEY), JSON.stringify(state.reviewRegenerationRecords.slice(-300))); } catch {}
}

const state = {
  currentUser: null,
  teamUsers: [],
  billingSummary: null,
  billingDetailSummary: null,
  billingDetailRelayId: '',
  billingDetailUserId: '',
  billingDetailRange: 'today',
  billingDetailStartDate: '',
  billingDetailEndDate: '',
  billingAdmin: null,
  billingAdminFilter: '',
  billingAdminRelayId: '',
  alipayConfig: null,
  alipayRecharges: [],
  alipayReview: [],
  mobileStats: null,
  mobileStatsRange: 'today',
  mobileStatsRelayId: '',
  mobileAccounting: null,
  mobileFinanceExpanded: false,
  mobileFinanceRange: 'month',
  mobileFinanceRelayId: '',
  mobileFinanceStartDate: '',
  mobileFinanceEndDate: '',
  mobileFinanceDetailsExpanded: false,
  mobileFinanceFilter: 'all',
  mobileFinanceData: null,
  mobileFinanceLoading: false,
  mobileFinanceError: '',
  mobileStatsUpdatedAt: '',
  config: null,
  products: [],
  prints: [],
  productFolder: '',
  printFolder: '',
  selectedProduct: null,
  selectedPrint: null,
  queue: [],
  queueGroupExpanded: new Set(),
  templateItems: [],
  taskTemplateItems: [],
  templateFolders: [],
  taskTemplateFolderView: '',
  selectedTaskTemplatePaths: new Set(),
  templateMasterCandidates: [],
  activeTemplateMasterCandidateId: '',
  taskSourceTab: 'template',
  taskTemplateSelectionScope: '',
  taskTemplateExpandedGroups: new Set(),
  taskTemplateSort: 'name-asc',
  printSort: 'name-asc',
  templateFilter: 'all',
  templatePreparation: null,
  reviews: [],
  activeReview: null,
  reviewTaskActivated: false,
  activeReviewGenerationJobId: '',
  stopGenerationRequested: false,
  reviewLogFilter: 'all',
  viewedReviewJobs: new Set(),
  reviewRegenerationRecords: [],
  regeneratingReviewJobs: new Set(),
  reviewRegenerationJobIds: new Map(),
  selectedReviewFolders: new Set(),
  reviewRegenerationDialog: null,
  freeSource: null,
  freeResult: null,
  promptSettings: null,
  activePromptId: '',
  apiSettings: null,
  relayChoices: null,
  selectedRelayId: '',
  allowAdminPromptView: false,
  apiConcurrencySettings: null,
  imageApiModels: [],
  apiModelRelayId: '',
  selectedApiModelId: '',
  settingsTab: 'general',
  billingCustomDays: 30,
  assetStages: {},
  assetPreviewKey: 'detailSetsPath',
  templateFolderView: '',
  assetPreviewItems: [],
  assetPreviewCache: new Map(),
  assetPreviewLoadId: 0,
  assetPreviewSizes: { printsPath: 138, detailSetsPath: 138 },
  imagePreviewSize: loadImagePreviewSize(),
  assetTemplateFilter: 'all',
  selectedAssetPaths: new Set(),
  assetUploading: false,
  activeTemplatePath: '',
  childrenwearReal: null,
  childrenwearReference: null,
  childrenwearModelReference: null,
  childrenwearSceneReference: null,
  childrenwearActiveTask: null,
  childrenwearTasks: [],
  childrenwearCombinationSelection: new Set(),
  childrenwearCombinationResult: null,
  childrenwearLibraries: {
    childrenwearRealAssetsPath: [],
    childrenwearReferenceAssetsPath: [],
    childrenwearModelAssetsPath: [],
    childrenwearSceneAssetsPath: [],
    childrenwearCombinationAssetsPath: []
  },
  childrenwearProductionLibraries: {
    childrenwearRealAssetsPath: [],
    childrenwearReferenceAssetsPath: [],
    childrenwearModelAssetsPath: [],
    childrenwearSceneAssetsPath: [],
    childrenwearCombinationAssetsPath: []
  },
  childrenwearProductionFolders: {
    childrenwearRealAssetsPath: [],
    childrenwearReferenceAssetsPath: [],
    childrenwearModelAssetsPath: [],
    childrenwearSceneAssetsPath: [],
    childrenwearCombinationAssetsPath: []
  },
  childrenwearLibraryUploading: new Set(),
  childrenwearAnalysisScanRunning: false,
  childrenwearAnalysisLastScanAt: '',
  childrenwearAssetTab: 'childrenwearRealAssetsPath',
  childrenwearProductionTab: 'master',
  childrenwearSourceTabs: { master: 'master-real', model: 'model-master', combination: 'combination-master' },
  childrenwearModelBackgroundMode: 'model_reference',
  childrenwearDrafts: { master: [], model: [], combination: [] },
  childrenwearActiveDraft: { master: '', model: '', combination: '' },
  childrenwearQueueFilters: { master: 'all', model: 'all', combination: 'all' },
  childrenwearQueueVisibleLimits: { master: 36, model: 36, combination: 36 },
  childrenwearActivityCollapsed: { master: false, model: false, combination: false },
  childrenwearReviewSelection: new Set(),
  childrenwearReviewFilter: 'all',
  childrenwearReviewGroupLimits: new Map(),
  childrenwearReviewVisibleGroupLimit: 12,
  childrenwearCompareId: '',
  childrenwearCompareContext: 'review',
  childrenwearCompareZoom: 1,
  childrenwearComparePan: { x: 0, y: 0 },
  childrenwearCompareBusy: false,
  childrenwearCompareVisibility: {},
  childrenwearCompareOrder: {},
  childrenwearLibraryFolders: {
    childrenwearRealAssetsPath: [],
    childrenwearReferenceAssetsPath: [],
    childrenwearModelAssetsPath: [],
    childrenwearSceneAssetsPath: [],
    childrenwearCombinationAssetsPath: []
  },
  childrenwearLibraryFolder: {
    childrenwearRealAssetsPath: 'auto',
    childrenwearReferenceAssetsPath: 'auto',
    childrenwearModelAssetsPath: 'auto',
    childrenwearSceneAssetsPath: 'auto',
    childrenwearCombinationAssetsPath: 'auto'
  },
  childrenwearLibraryPage: {
    childrenwearRealAssetsPath: 1,
    childrenwearReferenceAssetsPath: 1,
    childrenwearModelAssetsPath: 1,
    childrenwearSceneAssetsPath: 1,
    childrenwearCombinationAssetsPath: 1
  },
  childrenwearLibraryTotals: {
    childrenwearRealAssetsPath: { total: 0, totalPages: 0, pageSize: 48 },
    childrenwearReferenceAssetsPath: { total: 0, totalPages: 0, pageSize: 48 },
    childrenwearModelAssetsPath: { total: 0, totalPages: 0, pageSize: 48 },
    childrenwearSceneAssetsPath: { total: 0, totalPages: 0, pageSize: 48 },
    childrenwearCombinationAssetsPath: { total: 0, totalPages: 0, pageSize: 48 }
  },
  childrenwearLibraryDeleteSelection: {
    childrenwearRealAssetsPath: new Set(),
    childrenwearReferenceAssetsPath: new Set(),
    childrenwearModelAssetsPath: new Set(),
    childrenwearSceneAssetsPath: new Set(),
    childrenwearCombinationAssetsPath: new Set()
  },
  childrenwearPickerKey: '',
  childrenwearPickerSelected: ''
};

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
let toastTimer;
let productSearchTimer;
let printSearchTimer;
let reviewRefreshTimer;
const cwQueueProgressTimers = new Map();
const cwQueueProgressDirty = new Map();
const cwActivityRenderTimers = new Map();
let childrenwearTaskRefreshPromise = null;
let childrenwearTaskRefreshPending = false;
let childrenwearTaskRefreshNeedsFull = false;
const childrenwearTaskRefreshFolders = new Set();
let billingRefreshTimer = null;
let billingSummaryPromise = null;
let billingSummaryRefreshPending = false;
let currentPage = 'assets';
const promptSaveTimers = new Map();
let activeBrandDialogResolve = null;

function toast(message, error = false) {
  const element = $('#toast');
  element.textContent = message;
  element.className = `toast show${error ? ' error' : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { element.className = 'toast'; }, 3200);
}

function closeBrandDialog(result) {
  const modal = $('#brandDialogModal');
  if (!modal || modal.hidden) return;
  modal.hidden = true;
  const resolve = activeBrandDialogResolve;
  activeBrandDialogResolve = null;
  resolve?.(result);
}

function openBrandDialog({
  title = '操作确认',
  message = '',
  input = false,
  value = '',
  inputLabel = '请输入',
  inputType = 'text',
  readOnly = false,
  confirmText = '确定',
  cancelText = '取消',
  danger = false
} = {}) {
  const modal = $('#brandDialogModal');
  if (!modal) return Promise.resolve(input ? null : false);
  if (activeBrandDialogResolve) closeBrandDialog(input ? null : false);
  const field = $('#brandDialogField');
  const control = $('#brandDialogInput');
  const cancel = $('#brandDialogCancelButton');
  const confirm = $('#brandDialogConfirmButton');
  $('#brandDialogTitle').textContent = title;
  $('#brandDialogMessage').textContent = message;
  $('#brandDialogFieldLabel').textContent = inputLabel;
  field.hidden = !input;
  control.type = inputType;
  control.value = String(value ?? '');
  control.readOnly = readOnly;
  cancel.hidden = !cancelText;
  cancel.textContent = cancelText || '取消';
  confirm.textContent = confirmText;
  confirm.classList.toggle('danger-button', danger);
  modal.hidden = false;
  return new Promise(resolve => {
    activeBrandDialogResolve = resolve;
    const cancelResult = input ? null : false;
    cancel.onclick = () => closeBrandDialog(cancelResult);
    confirm.onclick = () => closeBrandDialog(input ? control.value : true);
    modal.onclick = event => { if (event.target === modal) closeBrandDialog(cancelResult); };
    modal.onkeydown = event => {
      if (event.key === 'Escape') closeBrandDialog(cancelResult);
      if (event.key === 'Enter' && event.target === control && !readOnly) {
        event.preventDefault();
        closeBrandDialog(control.value);
      }
    };
    requestAnimationFrame(() => {
      if (input) {
        control.focus();
        control.select();
      } else confirm.focus();
    });
  });
}

function brandConfirm(message, options = {}) {
  return openBrandDialog({ title: options.title || '请确认操作', message, confirmText: options.confirmText || '确定', cancelText: options.cancelText || '取消', danger: options.danger === true });
}

function brandPrompt(title, value = '', options = {}) {
  return openBrandDialog({
    title,
    message: options.message || '',
    input: true,
    value,
    inputLabel: options.inputLabel || '请输入',
    inputType: options.inputType || 'text',
    readOnly: options.readOnly === true,
    confirmText: options.confirmText || '确定',
    cancelText: options.cancelText === undefined ? '取消' : options.cancelText
  });
}

function applySidebarCollapsed(collapsed) {
  const shell = $('#appShell');
  if (!shell) return;
  shell.classList.toggle('sidebar-collapsed', Boolean(collapsed));
  const button = $('#sidebarToggleButton');
  if (button) {
    button.setAttribute('aria-pressed', collapsed ? 'true' : 'false');
    button.setAttribute('aria-label', collapsed ? '展开边栏' : '隐藏边栏');
    button.title = collapsed ? '展开边栏' : '隐藏边栏';
    button.textContent = collapsed ? '›' : '‹';
  }
  const logo = $('.brand img');
  if (logo) logo.title = '多嘻噜卡科技';
  try { localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, collapsed ? '1' : '0'); } catch {}
}

function loadSidebarCollapsed() {
  try { return localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === '1'; } catch { return false; }
}

function errorText(error) {
  return error?.message || String(error || '未知错误');
}

function childrenwearFriendlyError(error) {
  const message = errorText(error);
  if (/fetch failed|ECONNRESET|socket|network/i.test(message)) {
    return '连接小恐龙中转站失败，系统已自动尝试备用上传方式。请稍后点击“重新生成这一张”；若持续失败，请到系统设置测试接口线路。';
  }
  return message;
}

let authBootstrapMode = false;

function showAuthGate(bootstrapRequired = false) {
  authBootstrapMode = bootstrapRequired;
  $('#authGate').hidden = false;
  $('#appShell').hidden = true;
  $('#authDisplayNameField').hidden = !bootstrapRequired;
  $('#authEyebrow').textContent = bootstrapRequired ? '首次使用' : '团队账号';
  $('#authTitle').textContent = bootstrapRequired ? '创建管理员账号' : '登录自己的工作区';
  $('#authDescription').textContent = bootstrapRequired
    ? '这个管理员会继续使用当前已有素材，并可为其他美工创建独立账号。'
    : '每位美工的素材、任务、提示词和输出配置互相独立。';
  $('#authSubmitButton').textContent = bootstrapRequired ? '创建并进入' : '登录';
  $('#authHint').textContent = bootstrapRequired ? '请记住管理员账号和密码。' : '账号由管理员在系统设置中创建。';
  $('#authHint').classList.remove('error');
  $('#authPassword').autocomplete = bootstrapRequired ? 'new-password' : 'current-password';
  requestAnimationFrame(() => $('#authUsername').focus());
}

function applyCurrentUser(user) {
  state.currentUser = user;
  storageScope = user.id;
  state.queue = loadStoredQueue();
  state.templateMasterCandidates = loadStoredTemplateMasterCandidates();
  state.viewedReviewJobs = loadViewedReviewJobs();
  state.reviewRegenerationRecords = loadReviewRegenerationRecords();
  state.assetPreviewSizes = loadStoredAssetPreviewSizes();
  $('#currentUserName').textContent = user.displayName || user.username;
  $('#currentUserName').title = `${user.username} · ${roleLabel(user.role)}`;
  $('#promptSettingsNav').hidden = true;
  $('[data-settings-tab="general"]').hidden = user.role === 'admin';
  $('#apiSettingsTab').hidden = !isTeamAdmin();
  const apiTabStatus = $('#apiTabStatus');
  $('#apiSettingsTab').firstChild.textContent = isSuperAdmin() ? 'API 设置 ' : '中转站 ';
  if (apiTabStatus) apiTabStatus.textContent = '未配置';
  $('#billingSettingsTab').hidden = !isSuperAdmin();
  $('#teamSettingsTab').hidden = !isTeamAdmin();
  $('#newUserRoleLabel').hidden = !isSuperAdmin();
  $('#authGate').hidden = true;
  $('#appShell').hidden = false;
}

async function submitAuth(event) {
  event.preventDefault();
  const button = $('#authSubmitButton');
  const payload = {
    username: $('#authUsername').value.trim(),
    password: $('#authPassword').value,
    displayName: $('#authDisplayName').value.trim()
  };
  button.disabled = true;
  button.textContent = authBootstrapMode ? '正在创建…' : '正在登录…';
  try {
    if (authBootstrapMode) await window.caishen.bootstrapAccount(payload);
    else await window.caishen.login(payload);
    window.location.reload();
  } catch (error) {
    $('#authHint').textContent = errorText(error);
    $('#authHint').classList.add('error');
    button.disabled = false;
    button.textContent = authBootstrapMode ? '创建并进入' : '登录';
  }
}

async function logout() {
  try { await window.caishen.logout(); } finally { window.location.reload(); }
}

function openChangePasswordModal() {
  const required = Boolean(state.currentUser?.passwordChangeRequired);
  $('#changePasswordModal').hidden = false;
  $('#changePasswordForm').reset();
  $('#changePasswordTitle').textContent = required ? '首次登录，请确认密码' : '修改登录密码';
  $('#changePasswordModal').querySelector('.modal-head p').textContent = required
    ? (state.currentUser?.passwordChangeReason || '为保障账号安全，请使用原密码验证身份并重新确认登录密码。新密码可以与原密码相同。')
    : '所有账号都可以修改自己的密码；保存后请使用新密码登录。';
  $('#closeChangePasswordButton').hidden = required;
  $('#cancelChangePasswordButton').hidden = required;
  $('#changePasswordStatus').className = '';
  $('#changePasswordStatus').textContent = required ? '完成后系统会记录改密时间。' : '密码仅用于当前登录账号。';
  requestAnimationFrame(() => $('#currentPasswordInput').focus());
}

function closeChangePasswordModal() {
  if (state.currentUser?.passwordChangeRequired) return;
  $('#changePasswordModal').hidden = true;
}

async function submitChangePassword(event) {
  event.preventDefault();
  const currentPassword = $('#currentPasswordInput').value;
  const newPassword = $('#newPasswordInput').value;
  const confirmPassword = $('#confirmPasswordInput').value;
  if (newPassword !== confirmPassword) {
    $('#changePasswordStatus').className = 'error';
    $('#changePasswordStatus').textContent = '两次输入的新密码不一致';
    return;
  }
  const button = $('#submitChangePasswordButton');
  button.disabled = true;
  button.textContent = '保存中…';
  $('#changePasswordStatus').className = 'saving';
  $('#changePasswordStatus').textContent = '正在修改密码…';
  try {
    const required = Boolean(state.currentUser?.passwordChangeRequired);
    await window.caishen.changePassword({ currentPassword, newPassword });
    $('#changePasswordStatus').className = 'saved';
    $('#changePasswordStatus').textContent = required ? '密码已确认，正在进入系统…' : '密码已修改';
    toast(required ? '密码已确认' : '密码已修改');
    if (required) return setTimeout(() => window.location.reload(), 350);
    setTimeout(closeChangePasswordModal, 450);
  } catch (error) {
    $('#changePasswordStatus').className = 'error';
    $('#changePasswordStatus').textContent = errorText(error);
  } finally {
    button.disabled = false;
    button.textContent = '保存新密码';
  }
}

const BILLING_AMOUNT_SCALE = 1000000;

function formatUsdAmount(amount = 0) {
  const fixed = Number(amount || 0).toFixed(6);
  const trimmed = fixed.replace(/0+$/, '').replace(/\.$/, '');
  return trimmed.includes('.') ? trimmed.replace(/(\.\d)$/, '$10') : `${trimmed}.00`;
}

function formatMoney(minor = 0) {
  return `$${formatUsdAmount(Math.max(0, Number(minor) || 0) / BILLING_AMOUNT_SCALE)}`;
}

function formatMobileStatsMoney(minor = 0) {
  const amount = Math.max(0, Number(minor) || 0) / BILLING_AMOUNT_SCALE;
  return `$${amount.toFixed(2)}`;
}

function formatMobileStatsSignedMoney(minor = 0) {
  const amount = Number(minor) || 0;
  const sign = amount > 0 ? '+' : amount < 0 ? '-' : '';
  return `${sign}$${(Math.abs(amount) / BILLING_AMOUNT_SCALE).toFixed(2)}`;
}

function formatDurationMs(ms = 0) {
  const totalSeconds = Math.max(0, Math.floor(Number(ms) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours) return `${hours}小时${String(minutes).padStart(2, '0')}分${String(seconds).padStart(2, '0')}秒`;
  if (minutes) return `${minutes}分${String(seconds).padStart(2, '0')}秒`;
  return `${seconds}秒`;
}

function formatLocalDateTime(value) {
  if (!value) return '';
  const date = typeof value === 'number' ? new Date(value) : new Date(String(value));
  if (!Number.isFinite(date.getTime())) return '';
  return date.toLocaleString('zh-CN', { hour12: false });
}

function formatInteger(value = 0) {
  return new Intl.NumberFormat('zh-CN').format(Math.max(0, Math.trunc(Number(value) || 0)));
}

function formatPercent(value = 0) {
  return `${(Math.max(0, Number(value) || 0) * 100).toFixed(1)}%`;
}

function shouldOpenMobileStats() {
  const pathname = window.location.pathname.replace(/\/+$/, '') || '/';
  const params = new URLSearchParams(window.location.search);
  return pathname === '/mobile-stats' || window.location.hash === '#mobile-stats' || params.get('view') === 'mobile-stats';
}

function ensureMobileStatsPage() {
  if ($('#page-mobile-stats')) return;
  const page = document.createElement('section');
  page.className = 'page mobile-stats-page';
  page.id = 'page-mobile-stats';
  page.setAttribute('aria-label', 'Global analytics');
  page.innerHTML = `
    <div class="mobile-stats-shell">
      <header class="mobile-stats-header">
        <div>
          <span>SUPER ADMIN</span>
          <h1>Global Analytics</h1>
          <p id="mobileStatsUpdatedAt">Loading latest data</p>
        </div>
        <button class="mobile-stats-icon-button" id="refreshMobileStatsButton" type="button" aria-label="Refresh">Refresh</button>
      </header>
      <div id="mobileStatsContent" class="mobile-stats-content">
        <div class="mobile-stats-loading">Loading analytics...</div>
      </div>
    </div>`;
  document.querySelector('main')?.append(page);
}

function mobileRangeLabel(range) {
  return ({ today: 'Today', yesterday: 'Yesterday', '7d': 'Last 7 Days', month: 'This Month', '30d': 'Last 30 Days' })[range] || range;
}

function mobileStatsTotalImages(totals = {}) {
  return (totals.imageGenerated || 0) + (totals.imageRegenerated || 0) + (totals.masterGenerated || 0) + (totals.freeGenerated || 0);
}

function currentChinaDate() {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

function currentChinaMonth() {
  return currentChinaDate().slice(0, 7);
}

function formatFinanceCny(minor = 0) {
  const amount = Number(minor) || 0;
  const sign = amount < 0 ? '-' : '';
  return `${sign}¥${(Math.abs(amount) / 100).toFixed(2)}`;
}

function formatFinanceCnyMicro(micro = 0) {
  return `¥${(Math.max(0, Number(micro) || 0) / BILLING_AMOUNT_SCALE).toFixed(6)}`;
}

function financeCategoryLabel(category) {
  return ({
    client_payment: '客户充值（旧手工记录）',
    other_income: '其他收入',
    gateway_topup: '上游充值',
    development: '开发费用',
    advertising: '推广费用',
    labor: '人工费用',
    membership: '会员费',
    server: '服务器费用',
    software: '软件费用',
    refund: '退款',
    other_expense: '其他支出'
  })[category] || category || '未分类';
}

function mobileFinanceRangeLabel(range = state.mobileFinanceRange) {
  return ({ today: '今天', '7d': '近 7 天', month: '本月', last_month: '上月', custom: '自定义日期' })[range] || '本月';
}

function mobileFinanceBusinessEntries(accounting = state.mobileAccounting || {}) {
  const rows = [];
  for (const point of accounting.daily || []) {
    if (Number(point.customerTopupCnyMinor) > 0) {
      rows.push({
        id: `income-${point.relayId}-${point.date}`,
        automatic: true,
        direction: 'income',
        date: point.date,
        relayId: point.relayId,
        relayName: point.relayName,
        title: '客户充值收入',
        detail: '站内充值自动同步，内部划拨已排除',
        amountCnyMinor: Number(point.customerTopupCnyMinor) || 0
      });
    }
    if (Number(point.successfulImages) > 0) {
      rows.push({
        id: `cost-${point.relayId}-${point.date}`,
        automatic: true,
        direction: 'expense',
        date: point.date,
        relayId: point.relayId,
        relayName: point.relayName,
        title: '上游生图成本',
        detail: point.imageCostConfigured ? `${formatInteger(point.successfulImages)} 张 × 单张采购成本` : '尚未配置单张采购成本',
        amountCnyMinor: Number(point.upstreamImageCostCnyMinor) || 0,
        amountPending: !point.imageCostConfigured
      });
    }
    if (Number(point.successfulAnalyses) > 0) {
      rows.push({
        id: `analysis-cost-${point.relayId}-${point.date}`,
        automatic: true,
        direction: 'expense',
        date: point.date,
        relayId: point.relayId,
        relayName: point.relayName,
        title: '上游 AI 分析成本',
        detail: point.analysisCostConfigured ? `${formatInteger(point.successfulAnalyses)} 次 × 单次分析成本` : '尚未配置单次 AI 分析成本',
        amountCnyMinor: Number(point.upstreamAnalysisCostCnyMinor) || 0,
        amountPending: !point.analysisCostConfigured
      });
    }
  }
  for (const entry of accounting.finance?.entries || []) {
    if (entry.direction !== 'expense' && entry.category !== 'other_income') continue;
    rows.push({
      ...entry,
      automatic: false,
      relayName: entry.relayId || '公共账目',
      title: entry.counterparty || financeCategoryLabel(entry.category),
      detail: `${financeCategoryLabel(entry.category)}${entry.note ? ` · ${entry.note}` : ''}`
    });
  }
  return rows.sort((left, right) => String(right.date || '').localeCompare(String(left.date || ''))
    || (left.direction === right.direction ? 0 : left.direction === 'income' ? -1 : 1));
}

function mobileFinancePanelHtml() {
  if (!state.mobileFinanceExpanded) return '';
  if (state.mobileFinanceLoading) {
    return '<section class="mobile-finance-panel"><div class="mobile-finance-loading">正在读取财务账本…</div></section>';
  }
  if (state.mobileFinanceError) {
    return `<section class="mobile-finance-panel"><div class="mobile-finance-loading error">${escapeHtml(state.mobileFinanceError)}</div></section>`;
  }
  const accounting = state.mobileAccounting || { relays: [], totals: {} };
  const accountingTotals = accounting.totals || {};
  const finance = accounting.finance || { entries: [], summary: {} };
  const financeSummary = finance.summary || {};
  const availableRelays = state.relayChoices?.relays || [];
  const relayNameById = new Map((accounting.relays || []).map(item => [item.relayId, item.relayName]));
  const relayCards = (accounting.relays || []).map(relay => {
    return `<article class="mobile-finance-relay-card">
      <header><div><span>中转站</span><h3>${escapeHtml(relay.relayName)}</h3></div><b>${formatInteger(relay.successfulImages)} 张 · ${formatInteger(relay.successfulAnalyses)} 次分析</b></header>
      <dl>
        <div><dt>客户累计充值</dt><dd>${formatFinanceCny(relay.customerRechargeCnyMinor)}</dd></div>
        <div><dt>客户未消费余额</dt><dd>${formatFinanceCny(relay.customerBalanceCnyMinor)}</dd></div>
        <div><dt>期间充值收入</dt><dd>${formatFinanceCny(relay.customerTopupCnyMinor)}</dd></div>
        <div><dt>期间客户已消费</dt><dd>${formatFinanceCny(relay.confirmedRevenueCnyMinor)}</dd></div>
        <div><dt>期间上游成本</dt><dd>${relay.costConfigured ? formatFinanceCny(relay.upstreamCostCnyMinor) : '待配置'}</dd></div>
      </dl>
      <p>站内折算 ${escapeHtml(relay.customerCnyPerUsd)} 元/美元 · 生图 ${formatFinanceCnyMicro(relay.upstreamImageCostCnyMicro)}/张 · AI 分析 ${formatFinanceCnyMicro(relay.upstreamAnalysisCostCnyMicro)}/次</p>
    </article>`;
  }).join('') || '<div class="mobile-finance-empty">暂无中转站经营数据</div>';
  const businessEntries = mobileFinanceBusinessEntries(accounting);
  const visibleEntries = businessEntries.filter(entry => state.mobileFinanceFilter === 'all' || entry.direction === state.mobileFinanceFilter);
  const entryHtml = visibleEntries.length ? visibleEntries.map(entry => `
    <${entry.automatic ? 'div' : 'button'} class="mobile-finance-entry"${entry.automatic ? '' : ` type="button" data-finance-entry-id="${escapeHtml(entry.id)}"`}>
      <span class="mobile-finance-entry-icon ${escapeHtml(entry.direction)}">${entry.direction === 'income' ? '+' : entry.direction === 'expense' ? '−' : '↔'}</span>
      <span class="mobile-finance-entry-copy"><b>${escapeHtml(entry.title)}</b><small>${escapeHtml(entry.date)} · ${escapeHtml(relayNameById.get(entry.relayId) || entry.relayName || '公共账目')} · ${escapeHtml(entry.detail)}</small></span>
      <span class="mobile-finance-entry-money ${escapeHtml(entry.direction)}"><b>${entry.amountPending ? '待配置' : `${entry.direction === 'income' ? '+' : '-'}${formatFinanceCny(entry.amountCnyMinor)}`}</b><small>${entry.automatic ? '系统自动统计' : '手工记录'}</small></span>
    </${entry.automatic ? 'div' : 'button'}>`).join('') : '<div class="mobile-finance-empty">所选时间暂时没有符合条件的收支记录</div>';
  const manualEntries = (finance.entries || []).map(entry => `
    <button class="mobile-finance-entry compact" type="button" data-finance-entry-id="${escapeHtml(entry.id)}">
      <span class="mobile-finance-entry-icon ${escapeHtml(entry.direction)}">${entry.direction === 'income' ? '+' : entry.direction === 'expense' ? '−' : '↔'}</span>
      <span class="mobile-finance-entry-copy"><b>${escapeHtml(entry.counterparty || financeCategoryLabel(entry.category))}</b><small>${escapeHtml(entry.date)} · ${escapeHtml(financeCategoryLabel(entry.category))}${entry.relayId ? ` · ${escapeHtml(relayNameById.get(entry.relayId) || entry.relayId)}` : ' · 公共账目'}</small></span>
      <span class="mobile-finance-entry-money ${escapeHtml(entry.direction)}"><b>${formatFinanceCny(entry.amountCnyMinor)}</b><small>点击编辑</small></span>
    </button>`).join('') || '<div class="mobile-finance-empty">所选时间没有手工资金记录</div>';
  const rangeOptions = Object.entries({ today: '今天', '7d': '近 7 天', month: '本月', last_month: '上月', custom: '自定义日期' });
  const hasMissingCost = !accounting.complete && (Number(accountingTotals.successfulImages) > 0 || Number(accountingTotals.successfulAnalyses) > 0);
  return `
    <section class="mobile-finance-panel">
      <header class="mobile-finance-head">
        <div><span>私密财务</span><h2>经营账本</h2><p>按时间查看收入、支出和利润</p></div>
        <div class="mobile-finance-selectors">
          <label><span>时间</span><select id="mobileFinanceRange">${rangeOptions.map(([value, label]) => `<option value="${value}"${value === state.mobileFinanceRange ? ' selected' : ''}>${label}</option>`).join('')}</select></label>
          <label><span>中转站</span><select id="mobileFinanceRelay"><option value="">全部中转站</option>${availableRelays.map(relay => `<option value="${escapeHtml(relay.id)}"${relay.id === state.mobileFinanceRelayId ? ' selected' : ''}>${escapeHtml(relay.name)}</option>`).join('')}</select></label>
        </div>
      </header>
      ${state.mobileFinanceRange === 'custom' ? `<div class="mobile-finance-custom-range"><label><span>开始日期</span><input id="mobileFinanceStartDate" type="date" value="${escapeHtml(state.mobileFinanceStartDate)}"></label><label><span>结束日期</span><input id="mobileFinanceEndDate" type="date" value="${escapeHtml(state.mobileFinanceEndDate)}"></label></div>` : ''}
      <div class="mobile-finance-kpis simple">
        <article><span>营业收入</span><strong>${formatFinanceCny(accountingTotals.businessRevenueCnyMinor)}</strong><small>客户充值 + 其他收入</small></article>
        <article><span>总支出</span><strong>${hasMissingCost ? '成本未配齐' : formatFinanceCny(accountingTotals.totalExpensesCnyMinor)}</strong><small>上游成本 + 杂费</small></article>
        <article class="profit"><span>预估利润</span><strong>${hasMissingCost ? '请补全成本' : formatFinanceCny(accountingTotals.netProfitCnyMinor)}</strong><small>收入 - 支出</small></article>
      </div>
      <p class="mobile-finance-brief">${escapeHtml(mobileFinanceRangeLabel())} · ${escapeHtml(state.mobileFinanceRelayId ? (availableRelays.find(relay => relay.id === state.mobileFinanceRelayId)?.name || '当前中转站') : '全部中转站')} · 成功生图 ${formatInteger(accountingTotals.successfulImages)} 张 · AI 分析 ${formatInteger(accountingTotals.successfulAnalyses)} 次</p>
      <div class="mobile-finance-toolbar">
        <div><button type="button" data-finance-filter="all" class="${state.mobileFinanceFilter === 'all' ? 'active' : ''}">全部</button><button type="button" data-finance-filter="income" class="${state.mobileFinanceFilter === 'income' ? 'active' : ''}">收入</button><button type="button" data-finance-filter="expense" class="${state.mobileFinanceFilter === 'expense' ? 'active' : ''}">支出</button></div>
        <button type="button" id="mobileFinanceAdd">记一笔</button>
      </div>
      <div class="mobile-finance-list-head"><h3>收支流水</h3><button type="button" id="mobileFinanceExport">导出 CSV</button></div>
      <div class="mobile-finance-list">${entryHtml}</div>
      <details class="mobile-finance-details" id="mobileFinanceDetails"${state.mobileFinanceDetailsExpanded ? ' open' : ''}>
        <summary>资金与成本详情</summary>
        <p class="mobile-finance-cost-note">站内客户充值会自动计入营业收入，管理员与员工之间的内部划拨不计收入；客户已消费金额只展示经营进度，不再重复算收入。上游充值属于预付资金，不重复算作经营支出。</p>
        <div class="mobile-finance-detail-totals">
          <div><span>客户已消费金额</span><strong>${formatFinanceCny(accountingTotals.confirmedRevenueCnyMinor)}</strong></div>
          <div><span>上游生图成本</span><strong>${accountingTotals.successfulImages && accountingTotals.upstreamImageCostCnyMinor === 0 ? '待配置' : formatFinanceCny(accountingTotals.upstreamImageCostCnyMinor)}</strong></div>
          <div><span>上游 AI 分析成本</span><strong>${accountingTotals.successfulAnalyses && accountingTotals.upstreamAnalysisCostCnyMinor === 0 ? '待配置' : formatFinanceCny(accountingTotals.upstreamAnalysisCostCnyMinor)}</strong></div>
          <div><span>期间杂费</span><strong>${formatFinanceCny(accountingTotals.operatingExpensesCnyMinor)}</strong></div>
          <div><span>期间上游充值</span><strong>${formatFinanceCny(financeSummary.gatewayTopupsCnyMinor)}</strong></div>
        </div>
        <div class="mobile-finance-relay-list">${relayCards}</div>
        <div class="mobile-finance-list-head"><h3>手工资金记录</h3><span>点击记录可编辑</span></div>
        <div class="mobile-finance-list">${manualEntries}</div>
      </details>
    </section>`;
}

async function loadMobileFinanceLedger() {
  state.mobileFinanceStartDate ||= `${currentChinaMonth()}-01`;
  state.mobileFinanceEndDate ||= currentChinaDate();
  state.mobileFinanceLoading = true;
  state.mobileFinanceError = '';
  renderMobileStats();
  try {
    state.mobileAccounting = await window.caishen.getBillingAccounting({
      range: state.mobileFinanceRange,
      relayId: state.mobileFinanceRelayId,
      startDate: state.mobileFinanceStartDate,
      endDate: state.mobileFinanceEndDate
    });
    state.mobileFinanceData = state.mobileAccounting.finance;
  } catch (error) {
    state.mobileFinanceError = errorText(error);
  } finally {
    state.mobileFinanceLoading = false;
    renderMobileStats();
  }
}

function exportMobileFinanceCsv() {
  const entries = mobileFinanceBusinessEntries();
  const rows = [['日期', '收支', '中转站', '项目', '人民币金额', '说明']];
  for (const entry of entries) {
    rows.push([
      entry.date,
      entry.direction === 'income' ? '收入' : '支出',
      entry.relayName || entry.relayId || '公共账目',
      entry.title,
      (Number(entry.amountCnyMinor || 0) / 100).toFixed(2),
      entry.detail || ''
    ]);
  }
  const csv = `\ufeff${rows.map(row => row.map(value => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n')}`;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `经营账本-${state.mobileAccounting?.startDate || currentChinaDate()}-${state.mobileAccounting?.endDate || currentChinaDate()}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function openMobileFinanceDialog(entry = null) {
  const editing = Boolean(entry?.id);
  const category = entry?.category || 'other_income';
  const currency = entry?.currency || 'CNY';
  const accountingRelays = state.relayChoices?.relays || state.mobileAccounting?.relays || [];
  const element = document.createElement('div');
  element.className = 'mobile-finance-modal-backdrop';
  element.innerHTML = `<section class="mobile-finance-modal" role="dialog" aria-modal="true" aria-labelledby="mobileFinanceDialogTitle">
    <header><div><span>多嘻噜卡科技</span><h2 id="mobileFinanceDialogTitle">${editing ? '编辑记录' : '新增记录'}</h2></div><button type="button" data-finance-close aria-label="关闭">×</button></header>
    <div class="mobile-finance-form">
      <label><span>日期</span><input data-finance-date type="date" value="${escapeHtml(entry?.date || currentChinaDate())}"></label>
      <label><span>分类</span><select data-finance-category>
        <optgroup label="收入"><option value="other_income" ${category === 'other_income' ? 'selected' : ''}>其他收入（非站内充值）</option></optgroup>
        <optgroup label="资金操作"><option value="gateway_topup" ${category === 'gateway_topup' ? 'selected' : ''}>上游充值（不计利润）</option></optgroup>
        <optgroup label="经营支出">${Object.entries({ development: '开发费用', advertising: '推广费用', labor: '人工费用', membership: '会员费', server: '服务器费用', software: '软件费用', refund: '退款', other_expense: '其他支出' }).map(([value, label]) => `<option value="${value}" ${value === category ? 'selected' : ''}>${label}</option>`).join('')}</optgroup>
        ${category === 'client_payment' ? '<optgroup label="历史记录"><option value="client_payment" selected>客户充值（旧手工记录，不计利润）</option></optgroup>' : ''}
      </select></label>
      <p class="wide mobile-finance-category-hint" data-finance-category-hint></p>
      <label class="wide"><span>项目或客户</span><input data-finance-counterparty maxlength="100" value="${escapeHtml(entry?.counterparty || '')}" placeholder="例如：张先生充值、8 月服务器"></label>
      <label><span>金额</span><input data-finance-amount inputmode="decimal" value="${editing ? (Number(entry.originalAmountMinor || 0) / 100).toFixed(2) : ''}" placeholder="0.00"></label>
      <label><span>币种</span><select data-finance-currency><option value="CNY" ${currency === 'CNY' ? 'selected' : ''}>人民币 CNY</option><option value="USD" ${currency === 'USD' ? 'selected' : ''}>美元 USD</option></select></label>
      <label><span>归属中转站</span><select data-finance-relay><option value="">公共账目 / 不分站</option>${accountingRelays.map(relay => { const relayId = relay.id || relay.relayId; return `<option value="${escapeHtml(relayId)}"${relayId === entry?.relayId ? ' selected' : ''}>${escapeHtml(relay.name || relay.relayName)}</option>`; }).join('')}</select></label>
      <label data-finance-rate-field><span>美元汇率</span><input data-finance-rate inputmode="decimal" value="${escapeHtml(entry?.exchangeRate || 7)}"></label>
      <label class="wide"><span>备注</span><textarea data-finance-note rows="3" maxlength="500" placeholder="可选">${escapeHtml(entry?.note || '')}</textarea></label>
    </div>
    <footer>${editing ? '<button class="danger" type="button" data-finance-delete>删除</button>' : '<span></span>'}<div><button class="secondary" type="button" data-finance-close>取消</button><button class="primary" type="button" data-finance-save>保存</button></div></footer>
  </section>`;
  document.body.appendChild(element);
  const currencyInput = element.querySelector('[data-finance-currency]');
  const categoryInput = element.querySelector('[data-finance-category]');
  const categoryHint = element.querySelector('[data-finance-category-hint]');
  const rateField = element.querySelector('[data-finance-rate-field]');
  const updateRateVisibility = () => { rateField.hidden = currencyInput.value !== 'USD'; };
  const updateCategoryHint = () => {
    categoryHint.textContent = categoryInput.value === 'gateway_topup'
      ? '上游充值只记录预付资金，不重复计入当期支出和利润。'
      : categoryInput.value === 'other_income'
        ? '站内客户充值已由系统自动统计，这里只记录其他收入，避免重复入账。'
        : categoryInput.value === 'client_payment'
          ? '这是旧版手工记录，保留查账，不再重复计入利润。'
          : '这笔记录会计入当期经营支出。';
  };
  updateRateVisibility();
  updateCategoryHint();
  currencyInput.onchange = updateRateVisibility;
  categoryInput.onchange = updateCategoryHint;
  const close = () => element.remove();
  element.addEventListener('click', async event => {
    if (event.target === element || event.target.closest('[data-finance-close]')) return close();
    if (event.target.closest('[data-finance-delete]')) {
      if (!await brandConfirm('确定删除这条财务记录吗？', { title: '删除财务记录', danger: true, confirmText: '删除' })) return;
      try {
        await window.caishen.deleteFinanceEntry(entry.id);
        close();
        await loadMobileFinanceLedger();
        toast('财务记录已删除');
      } catch (error) { toast(errorText(error), true); }
      return;
    }
    const saveButton = event.target.closest('[data-finance-save]');
    if (!saveButton) return;
    const payload = {
      date: element.querySelector('[data-finance-date]').value,
      category: element.querySelector('[data-finance-category]').value,
      counterparty: element.querySelector('[data-finance-counterparty]').value,
      amount: element.querySelector('[data-finance-amount]').value,
      currency: currencyInput.value,
      relayId: element.querySelector('[data-finance-relay]').value,
      exchangeRate: element.querySelector('[data-finance-rate]').value,
      note: element.querySelector('[data-finance-note]').value
    };
    saveButton.disabled = true;
    try {
      if (editing) await window.caishen.updateFinanceEntry(entry.id, payload);
      else await window.caishen.createFinanceEntry(payload);
      close();
      await loadMobileFinanceLedger();
      toast(editing ? '财务记录已更新' : '财务记录已添加');
    } catch (error) {
      saveButton.disabled = false;
      toast(errorText(error), true);
    }
  });
}

function renderMobileStats() {
  const container = $('#mobileStatsContent');
  if (!container) return;
  const stats = state.mobileStats;
  if (!stats) {
    container.innerHTML = '<div class="mobile-stats-loading">No analytics available</div>';
    return;
  }
  const ranges = [
    { key: 'today', label: 'Today', dataKey: 'today' },
    { key: 'yesterday', label: 'Yesterday', dataKey: 'yesterday' },
    { key: '7d', label: 'Last 7 Days', dataKey: 'd7' },
    { key: 'month', label: 'This Month', dataKey: 'month' }
  ];
  const selectedRange = ranges.find(item => item.key === state.mobileStatsRange) || ranges[0];
  const selectedStats = stats[selectedRange.dataKey] || {};
  const selectedTotals = selectedStats.totals || {};
  const relays = Array.isArray(stats.today?.relays) ? stats.today.relays : (state.relayChoices?.relays || []);
  const selectedRelay = relays.find(relay => relay.id === state.mobileStatsRelayId)
    || relays.find(relay => relay.id === selectedStats.relayId)
    || relays[0];
  const balanceAccounts = selectedStats.balanceSummary?.byAccount || [];
  const balanceByWorkspace = new Map(balanceAccounts.map(account => [String(account.workspaceId || ''), account]));
  const usageByWorkspace = new Map((selectedStats.byAccount || []).map(account => [String(account.workspaceId || ''), account]));
  const accountRows = balanceAccounts.map(balance => ({
    ...(usageByWorkspace.get(String(balance.workspaceId || '')) || {}),
    workspaceId: balance.workspaceId,
    username: balance.username,
    displayName: balance.displayName,
    balance
  }));
  for (const usage of selectedStats.byAccount || []) {
    if (!balanceByWorkspace.has(String(usage.workspaceId || ''))) accountRows.push({ ...usage, balance: null });
  }
  accountRows.sort((left, right) => (Number(right.totalCostMinor) || 0) - (Number(left.totalCostMinor) || 0)
    || (Number(right.balance?.availableMinor) || 0) - (Number(left.balance?.availableMinor) || 0));
  const maxAccountCost = Math.max(1, ...accountRows.map(item => Number(item.totalCostMinor) || 0));
  const accountHtml = accountRows.length ? accountRows.map((item, index) => {
    const width = Math.max(6, Math.round(((Number(item.totalCostMinor) || 0) / maxAccountCost) * 100));
    const balance = item.balance || balanceByWorkspace.get(String(item.workspaceId || ''));
    return `
      <div class="mobile-stats-account-row">
        <span class="mobile-stats-rank">${index + 1}</span>
        <div class="mobile-stats-account-name"><b>${escapeHtml(item.displayName || item.username || 'Unnamed account')}</b><i style="width:${width}%"></i></div>
        <strong>${formatMobileStatsMoney(item.totalCostMinor)}</strong>
        <strong class="mobile-stats-account-balance">${formatMobileStatsMoney(balance?.availableMinor)}</strong>
        <em>${formatPercent(item.successRate)}</em>
      </div>`;
  }).join('') : `<div class="mobile-stats-empty">No accounts are available for ${escapeHtml(selectedRelay?.name || 'this relay')}</div>`;
  const transactionHtml = (selectedStats.transactions || []).length ? selectedStats.transactions.map(entry => `
    <div class="mobile-stats-ledger-row">
      <span class="mobile-stats-ledger-dot ${Number(entry.amountMinor) < 0 ? 'debit' : 'credit'}"></span>
      <div><b>${escapeHtml(entry.displayName || entry.username || entry.workspaceId || 'Unknown account')}</b><small>${escapeHtml(entry.description || billingKindName(entry.kind))} · ${escapeHtml(formatLocalDateTime(entry.createdAt))}</small></div>
      <strong class="${Number(entry.amountMinor) < 0 ? 'debit' : 'credit'}">${formatMobileStatsSignedMoney(entry.amountMinor)}</strong>
    </div>`).join('') : `<div class="mobile-stats-empty">${escapeHtml(selectedRange.label)} 暂无费用流水</div>`;
  const totalImages = mobileStatsTotalImages(selectedTotals);
  const updated = state.mobileStatsUpdatedAt ? `Updated ${formatLocalDateTime(state.mobileStatsUpdatedAt)}` : 'Analytics are up to date';
  const updatedNode = $('#mobileStatsUpdatedAt');
  if (updatedNode) updatedNode.textContent = updated;
  container.innerHTML = `
    <section class="mobile-stats-relay-picker">
      <label for="mobileStatsRelay"><span>中转站账户</span><select id="mobileStatsRelay" ${relays.length < 2 ? 'disabled' : ''}>${relays.map(relay => `<option value="${escapeHtml(relay.id)}"${relay.id === selectedRelay?.id ? ' selected' : ''}>${escapeHtml(relay.name)}</option>`).join('')}</select></label>
      <p>${escapeHtml(selectedRelay?.description || '余额、消费和流水按中转站独立计算')}<small>各中转站账户互不通用</small></p>
    </section>
    <nav class="mobile-stats-range-switch" aria-label="Select analytics range">
      ${ranges.map(item => `<button type="button" data-mobile-stats-range="${item.key}" class="${item.key === selectedRange.key ? 'active' : ''}">${escapeHtml(item.label)}</button>`).join('')}
    </nav>
    <section class="mobile-stats-hero-card">
      <div>
        <span>${escapeHtml(selectedRelay?.name || '当前中转站')} · 团队可用余额</span>
        <strong>${formatMobileStatsMoney(selectedStats.balanceSummary?.totals?.availableMinor)}</strong>
        <p>${escapeHtml(selectedRange.label)} 已扣费 ${formatMobileStatsMoney(selectedTotals.totalCostMinor)} · 生成 ${formatInteger(totalImages)} 张</p>
      </div>
      <div class="mobile-stats-donut" style="--rate:${Math.round((Number(selectedTotals.successRate) || 0) * 360)}deg">
        <b>${formatPercent(selectedTotals.successRate)}</b>
        <small>First-pass success</small>
      </div>
    </section>
    <section class="mobile-stats-panel">
      <div class="mobile-stats-panel-head"><h2>Account Ranking</h2><span>${escapeHtml(selectedRange.label)} · ${formatInteger(accountRows.length)} accounts</span></div>
      <div class="mobile-stats-account-head"><span>Account</span><span>Spend</span><span>Balance</span><span>Success</span></div>
      <div class="mobile-stats-account-list">${accountHtml}</div>
    </section>
    <section class="mobile-stats-summary-strip">
      <div><span>Period Spend</span><b>${formatMobileStatsMoney(selectedTotals.totalCostMinor)}</b></div>
      <div><span>Total Images</span><b>${formatInteger(totalImages)}</b></div>
      <div><span>Average Cost</span><b>${formatMobileStatsMoney(selectedTotals.averageCostMinor)}</b></div>
    </section>
    <section class="mobile-stats-panel mobile-stats-ledger-panel">
      <div class="mobile-stats-panel-head"><h2>费用流水</h2><span>${escapeHtml(selectedRelay?.name || '')} · ${escapeHtml(selectedRange.label)}</span></div>
      <div class="mobile-stats-ledger-list">${transactionHtml}</div>
    </section>
    <button class="mobile-finance-more" id="mobileFinanceMore" type="button" aria-expanded="${state.mobileFinanceExpanded}">${state.mobileFinanceExpanded ? '收起财务账本' : 'More'}</button>
    ${mobileFinancePanelHtml()}`;
  const relaySelect = $('#mobileStatsRelay');
  if (relaySelect) {
    relaySelect.onchange = () => {
      state.mobileStatsRelayId = relaySelect.value;
      void loadMobileStats();
    };
  }
  container.querySelectorAll('[data-mobile-stats-range]').forEach(button => {
    button.onclick = () => {
      state.mobileStatsRange = button.dataset.mobileStatsRange || 'today';
      renderMobileStats();
    };
  });
  const financeMore = $('#mobileFinanceMore');
  if (financeMore) {
    financeMore.onclick = () => {
      state.mobileFinanceExpanded = !state.mobileFinanceExpanded;
      renderMobileStats();
      if (state.mobileFinanceExpanded) void loadMobileFinanceLedger();
    };
  }
  const financeRange = $('#mobileFinanceRange');
  if (financeRange) {
    financeRange.onchange = () => {
      state.mobileFinanceRange = financeRange.value || 'month';
      void loadMobileFinanceLedger();
    };
  }
  const financeRelay = $('#mobileFinanceRelay');
  if (financeRelay) {
    financeRelay.onchange = () => {
      state.mobileFinanceRelayId = financeRelay.value;
      void loadMobileFinanceLedger();
    };
  }
  const financeStartDate = $('#mobileFinanceStartDate');
  const financeEndDate = $('#mobileFinanceEndDate');
  const reloadCustomFinance = () => {
    state.mobileFinanceStartDate = financeStartDate?.value || state.mobileFinanceStartDate;
    state.mobileFinanceEndDate = financeEndDate?.value || state.mobileFinanceEndDate;
    if (state.mobileFinanceStartDate && state.mobileFinanceEndDate) void loadMobileFinanceLedger();
  };
  if (financeStartDate) financeStartDate.onchange = reloadCustomFinance;
  if (financeEndDate) financeEndDate.onchange = reloadCustomFinance;
  const financeDetails = $('#mobileFinanceDetails');
  if (financeDetails) financeDetails.ontoggle = () => { state.mobileFinanceDetailsExpanded = financeDetails.open; };
  container.querySelectorAll('[data-finance-filter]').forEach(button => {
    button.onclick = () => {
      state.mobileFinanceFilter = button.dataset.financeFilter || 'all';
      renderMobileStats();
    };
  });
  const addFinanceEntry = $('#mobileFinanceAdd');
  if (addFinanceEntry) addFinanceEntry.onclick = () => openMobileFinanceDialog();
  const exportFinance = $('#mobileFinanceExport');
  if (exportFinance) exportFinance.onclick = exportMobileFinanceCsv;
  container.querySelectorAll('[data-finance-entry-id]').forEach(button => {
    button.onclick = () => {
      const entry = state.mobileFinanceData?.entries?.find(item => item.id === button.dataset.financeEntryId);
      if (entry) openMobileFinanceDialog(entry);
    };
  });
}

async function loadMobileStats() {
  if (!isSuperAdmin()) return;
  const button = $('#refreshMobileStatsButton');
  if (button) button.disabled = true;
  try {
    const relayChoices = await window.caishen.getRelayChoices().catch(() => state.relayChoices);
    state.relayChoices = relayChoices || state.relayChoices;
    const relays = state.relayChoices?.relays || [];
    if (!relays.some(relay => relay.id === state.mobileStatsRelayId)) {
      state.mobileStatsRelayId = state.relayChoices?.activeRelayId || relays[0]?.id || '';
    }
    if (!state.mobileStatsRelayId) throw new Error('暂无可用中转站，请先在 API 设置中启用中转站');
    const relayId = state.mobileStatsRelayId;
    const [today, yesterday, d7, month] = await Promise.all([
      window.caishen.getGlobalStats('today', relayId),
      window.caishen.getGlobalStats('yesterday', relayId),
      window.caishen.getGlobalStats('7d', relayId),
      window.caishen.getGlobalStats('month', relayId)
    ]);
    state.mobileStats = { today, yesterday, d7, month };
    state.mobileStatsUpdatedAt = new Date().toISOString();
    renderMobileStats();
  } catch (error) {
    const container = $('#mobileStatsContent');
    if (container) container.innerHTML = `<div class="mobile-stats-loading error">${escapeHtml(errorText(error))}</div>`;
    toast(errorText(error), true);
  } finally {
    if (button) button.disabled = false;
  }
}

function reviewElapsedMs(summary, running = false) {
  if (Number(summary.elapsedMs) > 0) return Number(summary.elapsedMs);
  if (!summary.startedAt) return 0;
  const started = new Date(summary.startedAt).getTime();
  if (!Number.isFinite(started)) return 0;
  if (running) return Math.max(0, Date.now() - started);
  if (summary.completedAt) {
    const completed = new Date(summary.completedAt).getTime();
    return Number.isFinite(completed) ? Math.max(0, completed - started) : 0;
  }
  return 0;
}

function normalizeProgressMessage(message = '') {
  return String(message || '').replaceAll('等待上游恢复', '生图接口等待重试');
}

function roleLabel(role) {
  return { superadmin: '超级管理员', admin: '管理员', member: '成员' }[role] || '成员';
}

function isSuperAdmin() {
  return state.currentUser?.role === 'superadmin';
}

function isTeamAdmin() {
  return ['superadmin', 'admin'].includes(state.currentUser?.role);
}

function canManagePrompts() {
  return isSuperAdmin();
}

function canViewPrompts() {
  return canManagePrompts() || (state.currentUser?.role === 'admin' && state.allowAdminPromptView);
}

function feeRangeLabel(minorMin = 0, minorMax = 0) {
  const min = Math.max(0, Number(minorMin) || 0);
  const max = Math.max(min, Number(minorMax) || min);
  return min === max ? formatMoney(min) : `${formatMoney(min)}-${formatMoney(max)}`;
}

function moneyInputToMinor(value, label) {
  const text = String(value || '').trim();
  if (!/^\d+(?:\.\d{0,6})?$/.test(text)) throw new Error(`${label}金额最多支持 6 位小数`);
  const [whole, fraction = ''] = text.split('.');
  const major = Number(whole);
  if (!Number.isSafeInteger(major) || major > 1000000) throw new Error(`${label}金额无效`);
  const minor = major * BILLING_AMOUNT_SCALE + Number(fraction.padEnd(6, '0'));
  if (!Number.isSafeInteger(minor)) throw new Error(`${label}金额无效`);
  return minor;
}

function moneyMinorToInput(minor = 0) {
  return formatUsdAmount((Number(minor) || 0) / BILLING_AMOUNT_SCALE);
}

function moneyMinorToSixDecimalInput(minor = 0) {
  return (Math.max(0, Number(minor) || 0) / BILLING_AMOUNT_SCALE).toFixed(6);
}

function billingKindName(kind) {
  return { image: '上游生图请求', llm: 'AI 分析请求', adjustment: '账户充值到账', transfer: '账户划拨' }[kind] || '费用记录';
}

function renderBillingLedger(entries = [], userMap = new Map()) {
  if (!entries.length) return '<div class="empty-inline">暂无费用流水</div>';
  return entries.map(entry => {
    const amount = Number(entry.amountMinor) || 0;
    const usageDebit = (entry.kind === 'image' || entry.kind === 'llm') && amount <= 0;
    const debit = amount < 0 || usageDebit;
    const user = userMap.get(entry.workspaceId);
    const owner = user ? `${user.displayName || user.username} · ` : '';
    const label = entry.description || (entry.kind === 'adjustment' && amount < 0 ? '算力余额扣减' : billingKindName(entry.kind));
    const relayLabel = entry.relayName || entry.relayId || '旧版默认中转站';
    return `<div class="billing-ledger-row"><div><b>${escapeHtml(label)}</b><span>${escapeHtml(owner + relayLabel + ' · ' + billingKindName(entry.kind))}${entry.reference ? ` · ${escapeHtml(entry.reference)}` : ''}</span><small>${escapeHtml(new Date(entry.createdAt).toLocaleString('zh-CN', { hour12: false }))}</small></div><div class="billing-ledger-amount ${debit ? 'debit' : 'credit'}">${debit ? '-' : '+'}${formatMoney(Math.abs(amount))}</div></div>`;
  }).join('');
}

function renderBillingDetailMetrics(summary) {
  const metrics = summary?.metrics || {};
  return [
    `<div class="billing-rate-item billing-metric-primary"><span>生图消费</span><b>${formatMoney(metrics.imageSpendMinor || 0)}</b><small>所选范围实际扣费</small></div>`,
    `<div class="billing-rate-item"><span>生图请求</span><b>${Number(metrics.imageCount || 0).toLocaleString('zh-CN')} 次</b><small>实际完成的图片生成请求</small></div>`,
    `<div class="billing-rate-item billing-metric-analysis"><span>AI 分析消费</span><b>${formatMoney(metrics.analysisSpendMinor || 0)}</b><small>素材 AI 分析的站内扣费</small></div>`,
    `<div class="billing-rate-item"><span>AI 分析请求</span><b>${Number(metrics.analysisCount || 0).toLocaleString('zh-CN')} 次</b><small>真实完成并写入流水的分析请求</small></div>`,
    `<div class="billing-rate-item"><span>合计消费</span><b>${formatMoney(metrics.totalSpendMinor || 0)}</b><small>生图消费 + AI 分析消费</small></div>`,
    `<div class="billing-rate-item"><span>流水记录</span><b>${Number(metrics.transactionCount || 0).toLocaleString('zh-CN')} 条</b><small>${Number(metrics.activeUserCount || 0).toLocaleString('zh-CN')} 个账号有变动</small></div>`
  ].join('');
}

function billingRangeLabel(summary) {
  const labels = { today: '今天', yesterday: '昨天', '7d': '近 7 日', month: '本月', custom: '自定义日期' };
  return summary?.range === 'custom' ? `${summary.startDate || ''} 至 ${summary.endDate || ''}` : (labels[summary?.range] || '所选日期');
}

function chinaDateToday() {
  const parts = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function renderBillingSummary() {
  const summary = state.billingSummary;
  if (!summary) return;
  const relay = (summary.relays || []).find(item => item.id === summary.relayId) || {};
  $('#currentBalance').textContent = formatMoney(summary.account?.balanceMinor);
  $('#openBillingDetailButton span').textContent = '当前线路算力余额';
  $('#currentBillingHint').textContent = relay.name || '当前中转站';
}

function renderBillingDetail() {
  const summary = state.billingDetailSummary || state.billingSummary;
  if (!summary) return;
  const relays = summary.relays || state.billingSummary?.relays || [];
  const relay = relays.find(item => item.id === summary.relayId) || {};
  const viewedUser = summary.viewedUser || state.currentUser || {};
  const visibleUsers = summary.users || [viewedUser];
  const transactions = summary.transactions || [];
  const viewedName = viewedUser.id === 'team' ? '全团队' : (viewedUser.displayName || viewedUser.username || '当前账号');
  const relayName = summary.relayId === 'all' ? '全部服务' : (relay.name || '当前服务');
  const totalCount = Number(summary.metrics?.transactionCount || transactions.length);
  $('#billingDetailSummary').textContent = `${viewedName} · ${relayName} · ${billingRangeLabel(summary)} · ${totalCount.toLocaleString('zh-CN')} 条流水${summary.truncated ? `（显示最新 ${transactions.length} 条）` : ''}`;
  $('#billingDetailFilters').hidden = false;
  const teamOption = state.currentUser?.role === 'member' ? '' : `<option value="team"${viewedUser.id === 'team' ? ' selected' : ''}>全团队（合并流水）</option>`;
  $('#billingDetailUserFilter').innerHTML = teamOption + visibleUsers.map(user => `<option value="${escapeHtml(user.id)}"${user.id === viewedUser.id ? ' selected' : ''}>${escapeHtml(user.displayName || user.username)} · ${escapeHtml(user.username)}</option>`).join('');
  $('#billingDetailRelayFilter').innerHTML = `<option value="all"${summary.relayId === 'all' ? ' selected' : ''}>全部服务</option>` + relays.map(item => `<option value="${escapeHtml(item.id)}"${item.id === summary.relayId ? ' selected' : ''}>${escapeHtml(item.name)}</option>`).join('');
  $('#billingDetailRangeFilter').value = summary.range || state.billingDetailRange;
  $('#billingDetailCustomRange').hidden = (summary.range || state.billingDetailRange) !== 'custom';
  $('#billingDetailStartDate').value = state.billingDetailStartDate || summary.startDate || chinaDateToday();
  $('#billingDetailEndDate').value = state.billingDetailEndDate || summary.endDate || chinaDateToday();
  $('#billingDetailRates').innerHTML = renderBillingDetailMetrics(summary);
  $('#billingDetailRates').hidden = false;
  $('#billingDetailList').innerHTML = renderBillingLedger(transactions, new Map(visibleUsers.map(user => [user.workspaceId, user])));
}

async function loadBillingSummary() {
  if (billingSummaryPromise) {
    billingSummaryRefreshPending = true;
    return billingSummaryPromise;
  }
  billingSummaryPromise = (async () => {
    do {
      billingSummaryRefreshPending = false;
      state.billingSummary = await window.caishen.getBillingSummary(state.billingCustomDays);
      renderBillingSummary();
    } while (billingSummaryRefreshPending);
  })();
  try {
    await billingSummaryPromise;
  } catch (error) {
    $('#currentBalance').textContent = '读取失败';
    $('#currentBillingHint').textContent = errorText(error);
  } finally {
    billingSummaryPromise = null;
  }
}

function scheduleBillingSummaryRefresh() {
  clearTimeout(billingRefreshTimer);
  billingRefreshTimer = setTimeout(() => {
    billingRefreshTimer = null;
    void loadBillingSummary();
  }, 600);
}

async function openBillingDetail() {
  $('#billingDetailModal').hidden = false;
  await loadBillingSummary();
  state.billingDetailUserId = state.currentUser?.role === 'member' ? (state.currentUser?.id || '') : 'team';
  state.billingDetailRelayId = 'all';
  state.billingDetailRange = 'today';
  await loadBillingDetail('all', state.billingDetailUserId);
}

async function loadBillingDetail(relayId, userId = state.billingDetailUserId || state.currentUser?.id || '') {
  try {
    state.billingDetailSummary = await window.caishen.getBillingDetail({ relayId: relayId || state.billingDetailRelayId || 'all', userId, range: state.billingDetailRange, startDate: state.billingDetailRange === 'custom' ? state.billingDetailStartDate : '', endDate: state.billingDetailRange === 'custom' ? state.billingDetailEndDate : '' });
    state.billingDetailRelayId = state.billingDetailSummary.relayId || '';
    state.billingDetailUserId = state.billingDetailSummary.viewedUser?.id || userId;
    state.billingDetailRange = state.billingDetailSummary.range || state.billingDetailRange;
    renderBillingDetail();
  } catch (error) { toast(errorText(error), true); }
}

function closeBillingDetail() {
  $('#billingDetailModal').hidden = true;
  state.billingDetailSummary = null;
}

function formatRechargeMoney(minor) { return `$${((Number(minor) || 0) / BILLING_AMOUNT_SCALE).toFixed(2)}`; }
function formatCny(cents) { return `¥${((Number(cents) || 0) / 100).toFixed(2)}`; }
function rechargeStatusLabel(status) { return { pending: '到账核验中', approved: '充值成功', rejected: '未通过核验' }[status] || '处理中'; }

function renderAlipayHistory() {
  const list = $('#alipayHistoryList');
  if (!list) return;
  list.innerHTML = state.alipayRecharges.length ? state.alipayRecharges.slice(0, 10).map(order => `<div class="alipay-history-row ${escapeHtml(order.status)}"><div><b>${escapeHtml(rechargeStatusLabel(order.status))}</b><span>${escapeHtml(order.serviceName || '当前服务')} · ${escapeHtml(formatLocalDateTime(order.submittedAt))} · 订单号 ${escapeHtml(order.alipayOrderNo)}</span>${order.rejectionReason ? `<small>${escapeHtml(order.rejectionReason)}</small>` : ''}</div><strong>${order.status === 'approved' ? `${formatRechargeMoney(order.creditMinor)} 已入账` : formatRechargeMoney(order.requestedCreditMinor)}</strong></div>`).join('') : '<div class="empty-inline">暂无充值记录</div>';
}

async function loadAlipayEntry() {
  if (state.currentUser?.role !== 'admin') return;
  try {
    state.alipayConfig = await window.caishen.getAlipayConfig();
    $('#openAlipayButton').hidden = !state.alipayConfig.enabled;
  } catch { $('#openAlipayButton').hidden = true; }
}

function updateAlipayPaymentAmount() {
  const value = String($('#alipayAmountUsd')?.value || '').trim();
  const valid = /^\d{1,7}(?:\.\d{0,2})?$/.test(value) && Number(value) >= 1 && Number(value) <= 1_000_000;
  $('#alipayPaymentCny').textContent = valid ? `¥${(Number(value) * 7).toFixed(2)}` : '¥0.00';
  return valid;
}
async function loadAlipayHistory() { state.alipayRecharges = await window.caishen.getAlipayRecharges(); renderAlipayHistory(); }
async function openAlipay() {
  $('#alipayModal').hidden = false;
  $('#alipayCustomerStatus').textContent = '正在读取 Alipay 配置…';
  try {
    state.alipayConfig = await window.caishen.getAlipayConfig();
    if (!state.alipayConfig.enabled || !state.alipayConfig.qrAvailable) throw new Error('Alipay 当前暂不可用');
    $('#alipayService').innerHTML = '<option value="">请选择到账账户</option>' + (state.alipayConfig.services || []).map(service => `<option value="${escapeHtml(service.id)}">${escapeHtml(service.name)}</option>`).join('');
    $('#alipayQrImage').src = `${state.alipayConfig.qrUrl}?v=${Date.now()}`;
    $('#alipayQrImage').hidden = false;
    $('#alipayQrEmpty').hidden = true;
    $('#alipayCustomerStatus').textContent = state.alipayConfig.payeeName ? `收款方：${state.alipayConfig.payeeName}` : '请按页面显示金额完成付款。';
    await loadAlipayHistory();
  } catch (error) { $('#alipayQrImage').hidden = true; $('#alipayQrEmpty').hidden = false; $('#alipayCustomerStatus').textContent = errorText(error); }
}
function closeAlipay() { $('#alipayModal').hidden = true; }
async function submitAlipayRecharge() {
  const amountUsd = String($('#alipayAmountUsd').value || '').trim();
  const serviceId = String($('#alipayService').value || '').trim();
  const alipayOrderNo = String($('#alipayOrderNo').value || '').replace(/\s+/g, '');
  if (!serviceId) return toast('请选择充值到账账户', true);
  if (!updateAlipayPaymentAmount()) return toast('请输入正确的充值金额，最多保留两位小数', true);
  if (!/^\d{12,64}$/.test(alipayOrderNo)) return toast('请输入正确的支付宝订单号（12-64 位数字）', true);
  const button = $('#submitAlipayRechargeButton');
  button.disabled = true;
  try { await window.caishen.submitAlipayRecharge({ serviceId, amountUsd, alipayOrderNo }); $('#alipayOrderNo').value = ''; await loadAlipayHistory(); $('#alipayCustomerStatus').textContent = '已提交，正在进行到账核验。'; toast('已提交到账核验'); }
  catch (error) { toast(errorText(error), true); } finally { button.disabled = false; }
}

function renderAlipayReview() {
  const list = $('#alipayReviewList');
  if (!list) return;
  list.innerHTML = state.alipayReview.length ? state.alipayReview.map(order => `<div class="alipay-review-row ${escapeHtml(order.status)}" data-alipay-review="${escapeHtml(order.id)}"><div class="alipay-review-copy"><b>${escapeHtml(order.displayName || order.username)} · ${escapeHtml(rechargeStatusLabel(order.status))}</b><span>订单号 ${escapeHtml(order.alipayOrderNo)} · ${escapeHtml(formatLocalDateTime(order.submittedAt))}</span><small>申请 ${formatRechargeMoney(order.requestedCreditMinor)} · 应付 ${formatCny(order.requestedPaymentCnyCents)} · 服务 ${escapeHtml(order.serviceName || '当前服务')}</small></div>${order.status === 'pending' ? `<label>确认入账额度（USD）<input data-alipay-actual type="number" min="1" max="1000000" step="0.01" value="${(Number(order.requestedCreditMinor || 0) / BILLING_AMOUNT_SCALE).toFixed(2)}"></label><div class="inline-actions"><button class="secondary danger-outline" data-alipay-reject type="button">未核验到款</button><button class="primary" data-alipay-approve type="button">确认到账</button></div>` : `<strong>${order.status === 'approved' ? `已入账 ${formatRechargeMoney(order.creditMinor)}` : escapeHtml(order.rejectionReason || '未通过')}</strong>`}</div>`).join('') : '<div class="empty-inline">暂无到账核验记录</div>';
}
async function loadAlipayAdmin() {
  if (!isSuperAdmin()) return;
  try { const [settings, review] = await Promise.all([window.caishen.getAlipaySettings(), window.caishen.getAlipayReview()]); state.alipayReview = review; $('#alipayPayeeName').value = settings.payeeName || ''; $('#alipayEnabled').checked = settings.enabled === true; $('#alipayQrHint').textContent = settings.qrAvailable ? '已上传收款码' : '尚未上传收款码'; $('#alipayAdminStatus').textContent = settings.enabled ? '已启用' : '未启用'; renderAlipayReview(); }
  catch (error) { toast(errorText(error), true); }
}
async function saveAlipaySettings() { try { await window.caishen.saveAlipaySettings({ enabled: $('#alipayEnabled').checked, payeeName: $('#alipayPayeeName').value.trim() }); await loadAlipayAdmin(); await loadAlipayEntry(); toast('Alipay 配置已保存'); } catch (error) { toast(errorText(error), true); } }
async function uploadAlipayQr() { const file = $('#alipayQrFile').files?.[0]; if (!file) return toast('请选择支付宝收款码图片', true); try { await window.caishen.uploadAlipayQr(file); $('#alipayQrFile').value = ''; await loadAlipayAdmin(); toast('收款码已上传'); } catch (error) { toast(errorText(error), true); } }
async function handleAlipayReviewClick(event) {
  const row = event.target.closest('[data-alipay-review]');
  if (!row) return;
  if (event.target.closest('[data-alipay-reject]')) { const reason = await brandPrompt('填写未通过原因', '未核验到对应款项', { inputLabel: '原因' }); if (reason === null) return; try { await window.caishen.rejectAlipayRecharge(row.dataset.alipayReview, reason); await loadAlipayAdmin(); toast('已更新核验结果'); } catch (error) { toast(errorText(error), true); } return; }
  const approve = event.target.closest('[data-alipay-approve]');
  if (!approve) return;
  const actualAmountUsd = String(row.querySelector('[data-alipay-actual]')?.value || '').trim();
  if (!/^\d{1,7}(?:\.\d{1,2})?$/.test(actualAmountUsd) || Number(actualAmountUsd) < 1) return toast('请输入正确的实际入账额度', true);
  if (!await brandConfirm(`确认支付宝已到账，并按 $${Number(actualAmountUsd).toFixed(2)} 入账？`, { title: '确认到账', confirmText: '确认入账' })) return;
  approve.disabled = true;
  try { await window.caishen.approveAlipayRecharge(row.dataset.alipayReview, actualAmountUsd); await Promise.all([loadAlipayAdmin(), loadBillingAdmin(), loadBillingSummary()]); toast(`充值成功，$${Number(actualAmountUsd).toFixed(2)} 已入账`); }
  catch (error) { approve.disabled = false; toast(errorText(error), true); }
}

function apiTestErrorText(error) {
  const text = errorText(error);
  if (/token_expired|authentication token is expired/i.test(text)) return '上游登录 Token 已过期，请在 API 服务端重新登录后再测试。';
  if (/status=401|HTTP 401|unauthorized/i.test(text)) return '接口认证失败，请检查 API 密钥或上游登录状态。';
  return text;
}

function setImagePreviewSize(value) {
  const size = Math.max(28, Math.min(50, Number(value) || 38));
  state.imagePreviewSize = size;
  document.documentElement.style.setProperty('--image-preview-width', `${size}vw`);
  document.documentElement.style.setProperty('--image-preview-height', `${size}vh`);
  $$('[data-image-preview-size]').forEach(input => { if (Number(input.value) !== size) input.value = String(size); });
  $$('[data-image-preview-size-value]').forEach(label => { label.textContent = `${size}%`; });
  try { localStorage.setItem(IMAGE_PREVIEW_SIZE_STORAGE_KEY, String(size)); } catch {}
}

function bindImagePreviewSizeControls() {
  setImagePreviewSize(state.imagePreviewSize);
  $$('[data-image-preview-size]').forEach(input => {
    input.oninput = () => setImagePreviewSize(input.value);
  });
}

function bindImageHoverPreview() {
  bindImagePreviewSizeControls();
  if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  const preview = $('#imageHoverPreview');
  const viewport = $('#imageHoverPreviewViewport');
  const previewImage = $('#imageHoverPreviewImage');
  const caption = $('#imageHoverPreviewCaption');
  const lens = $('#imageHoverLens');
  let sourceImage = null;
  let pointerX = 0;
  let pointerY = 0;
  let positionFrame = 0;
  let positionAnimation = null;
  let hoverTimer = 0;
  let pendingImage = null;
  let pendingX = 0;
  let pendingY = 0;
  let pendingAnchorX = 0;
  let pendingAnchorY = 0;
  const zoomFactor = 1.7;
  const hoverDelayMs = 1000;

  const sizeMagnifierPane = () => {
    if (!sourceImage) return;
    const naturalWidth = Number(previewImage.naturalWidth) || Number(sourceImage.naturalWidth) || 1;
    const naturalHeight = Number(previewImage.naturalHeight) || Number(sourceImage.naturalHeight) || 1;
    const aspect = Math.max(.35, Math.min(2.8, naturalWidth / naturalHeight));
    const requestedWidth = window.innerWidth * Math.max(28, Math.min(50, Number(state.imagePreviewSize) || 38)) / 100;
    const maxWidth = window.innerWidth * .5;
    const maxHeight = window.innerHeight * .76;
    let paneWidth = Math.min(maxWidth, Math.max(Math.min(440, maxWidth), requestedWidth));
    let paneHeight = paneWidth / aspect;
    if (paneHeight > maxHeight) {
      paneHeight = maxHeight;
      paneWidth = paneHeight * aspect;
    }
    viewport.style.width = `${Math.round(paneWidth)}px`;
    viewport.style.height = `${Math.round(paneHeight)}px`;
    preview.style.width = `${Math.round(paneWidth + 16)}px`;
  };

  const sourceMetrics = () => {
    if (!sourceImage) return null;
    const rect = sourceImage.getBoundingClientRect();
    const naturalWidth = Number(previewImage.naturalWidth) || Number(sourceImage.naturalWidth) || 1;
    const naturalHeight = Number(previewImage.naturalHeight) || Number(sourceImage.naturalHeight) || 1;
    const fit = getComputedStyle(sourceImage).objectFit || 'fill';
    const scale = fit === 'contain'
      ? Math.min(rect.width / naturalWidth, rect.height / naturalHeight)
      : fit === 'cover'
        ? Math.max(rect.width / naturalWidth, rect.height / naturalHeight)
        : rect.width / naturalWidth;
    const displayedWidth = naturalWidth * scale;
    const displayedHeight = naturalHeight * scale;
    const offsetX = (rect.width - displayedWidth) / 2;
    const offsetY = (rect.height - displayedHeight) / 2;
    return { rect, naturalWidth, naturalHeight, scale, displayedWidth, displayedHeight, offsetX, offsetY };
  };

  const updateMagnifiedPreview = () => {
    const source = sourceMetrics();
    if (!source || !previewImage.naturalWidth || !viewport.clientWidth || !viewport.clientHeight) return;
    const localX = pointerX - source.rect.left;
    const localY = pointerY - source.rect.top;
    const imageX = Math.max(0, Math.min(1, (localX - source.offsetX) / source.displayedWidth));
    const imageY = Math.max(0, Math.min(1, (localY - source.offsetY) / source.displayedHeight));
    const paneWidth = viewport.clientWidth;
    const paneHeight = viewport.clientHeight;
    const baseScale = Math.max(paneWidth / source.naturalWidth, paneHeight / source.naturalHeight);
    const renderedScale = baseScale * zoomFactor;
    const renderedWidth = Math.ceil(source.naturalWidth * renderedScale);
    const renderedHeight = Math.ceil(source.naturalHeight * renderedScale);
    const left = Math.max(paneWidth - renderedWidth, Math.min(0, paneWidth / 2 - imageX * renderedWidth));
    const top = Math.max(paneHeight - renderedHeight, Math.min(0, paneHeight / 2 - imageY * renderedHeight));
    previewImage.style.width = `${renderedWidth}px`;
    previewImage.style.height = `${renderedHeight}px`;
    previewImage.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;

    const visibleLeft = Math.max(source.rect.left, source.rect.left + source.offsetX);
    const visibleTop = Math.max(source.rect.top, source.rect.top + source.offsetY);
    const visibleRight = Math.min(source.rect.right, source.rect.left + source.offsetX + source.displayedWidth);
    const visibleBottom = Math.min(source.rect.bottom, source.rect.top + source.offsetY + source.displayedHeight);
    const visibleWidth = Math.max(1, visibleRight - visibleLeft);
    const visibleHeight = Math.max(1, visibleBottom - visibleTop);
    let lensWidth = Math.max(72, paneWidth / renderedScale * source.scale);
    let lensHeight = Math.max(72, paneHeight / renderedScale * source.scale);
    lensWidth = Math.max(visibleWidth * .56, Math.min(lensWidth, visibleWidth * .7));
    lensHeight = Math.max(visibleHeight * .56, Math.min(lensHeight, visibleHeight * .7));
    const lensScale = Math.min(1, visibleWidth / lensWidth, visibleHeight / lensHeight);
    lensWidth *= lensScale;
    lensHeight *= lensScale;
    const lensLeft = Math.max(visibleLeft, Math.min(pointerX - lensWidth / 2, visibleRight - lensWidth));
    const lensTop = Math.max(visibleTop, Math.min(pointerY - lensHeight / 2, visibleBottom - lensHeight));
    lens.style.width = `${Math.round(lensWidth)}px`;
    lens.style.height = `${Math.round(lensHeight)}px`;
    lens.style.transform = `translate3d(${Math.round(lensLeft)}px, ${Math.round(lensTop)}px, 0)`;
  };

  const positionBesideSource = () => {
    cancelAnimationFrame(positionFrame);
    positionFrame = requestAnimationFrame(() => {
      if (!sourceImage?.isConnected) return;
      const sourceRect = sourceImage.getBoundingClientRect();
      const previewRect = preview.getBoundingClientRect();
      const edge = 16;
      const gap = 14;
      const rightSpace = window.innerWidth - sourceRect.right - gap - edge;
      const leftSpace = sourceRect.left - gap - edge;
      let placement = 'right';
      let left;
      let top;

      if (rightSpace >= previewRect.width) {
        left = sourceRect.right + gap;
        top = sourceRect.top + (sourceRect.height - previewRect.height) / 2;
      } else if (leftSpace >= previewRect.width) {
        placement = 'left';
        left = sourceRect.left - previewRect.width - gap;
        top = sourceRect.top + (sourceRect.height - previewRect.height) / 2;
      } else {
        const bottomSpace = window.innerHeight - sourceRect.bottom - gap - edge;
        const topSpace = sourceRect.top - gap - edge;
        placement = bottomSpace >= topSpace ? 'bottom' : 'top';
        left = sourceRect.left + (sourceRect.width - previewRect.width) / 2;
        top = placement === 'bottom'
          ? sourceRect.bottom + gap
          : sourceRect.top - previewRect.height - gap;
      }

      left = Math.max(edge, Math.min(left, window.innerWidth - previewRect.width - edge));
      top = Math.max(edge, Math.min(top, window.innerHeight - previewRect.height - edge));
      positionAnimation?.cancel();
      positionAnimation = preview.animate(
        [{ left: `${Math.round(left)}px`, top: `${Math.round(top)}px` }],
        { duration: 0, fill: 'forwards' }
      );
      preview.dataset.placement = placement;
      preview.classList.remove('positioning');
    });
  };

  const hide = () => {
    clearTimeout(hoverTimer);
    hoverTimer = 0;
    pendingImage = null;
    cancelAnimationFrame(positionFrame);
    positionAnimation?.cancel();
    positionAnimation = null;
    sourceImage = null;
    preview.classList.remove('show', 'positioning');
    lens.classList.remove('show');
    preview.setAttribute('aria-hidden', 'true');
    lens.setAttribute('aria-hidden', 'true');
  };

  const activate = image => {
    if (!image?.isConnected || pendingImage !== image || state.config?.imageHoverPreviewEnabled === false) return;
    if (document.documentElement.classList.contains('childrenwear-generation-active')) return;
    const source = image.dataset.previewSrc || image.currentSrc || image.src;
    if (!source) return;
    sourceImage = image;
    pointerX = pendingX;
    pointerY = pendingY;
    previewImage.src = source;
    previewImage.alt = image.alt || '图片放大预览';
    caption.textContent = image.alt || '图片放大预览';
    sizeMagnifierPane();
    preview.classList.add('show', 'positioning');
    preview.setAttribute('aria-hidden', 'false');
    lens.setAttribute('aria-hidden', 'false');
    if (previewImage.complete && previewImage.naturalWidth) {
      updateMagnifiedPreview();
      lens.classList.add('show');
    }
    positionBesideSource();
  };

  const scheduleActivation = image => {
    clearTimeout(hoverTimer);
    pendingAnchorX = pendingX;
    pendingAnchorY = pendingY;
    hoverTimer = setTimeout(() => {
      hoverTimer = 0;
      activate(image);
    }, hoverDelayMs);
  };

  document.addEventListener('mouseover', event => {
    if (state.config?.imageHoverPreviewEnabled === false) return;
    if (document.documentElement.classList.contains('childrenwear-generation-active')) return;
    const image = event.target.closest?.('img');
    if (!image || image.closest('.brand') || image.closest('#imageHoverPreview') || image.closest('#cwCompareModal')) return;
    if (!(image.dataset.previewSrc || image.currentSrc || image.src)) return;
    const sourceRect = image.getBoundingClientRect();
    pendingImage = image;
    pendingX = Number(event.clientX) || sourceRect.left + sourceRect.width / 2;
    pendingY = Number(event.clientY) || sourceRect.top + sourceRect.height / 2;
    scheduleActivation(image);
  });

  document.addEventListener('mousemove', event => {
    if (sourceImage && event.target === sourceImage) {
      pointerX = event.clientX;
      pointerY = event.clientY;
      updateMagnifiedPreview();
      lens.classList.add('show');
      return;
    }
    if (!pendingImage || event.target !== pendingImage) return;
    const moved = Math.hypot(event.clientX - pendingAnchorX, event.clientY - pendingAnchorY);
    pendingX = event.clientX;
    pendingY = event.clientY;
    if (moved > 6) scheduleActivation(pendingImage);
  });

  document.addEventListener('mouseout', event => {
    if ((event.target === sourceImage || event.target === pendingImage) && event.relatedTarget !== event.target) hide();
  });
  document.addEventListener('pointerdown', event => {
    if (sourceImage && event.target === sourceImage && !event.target.closest('[data-cw-review-compare]')) return;
    hide();
  }, true);
  document.addEventListener('keydown', event => { if (event.key === 'Escape') hide(); });
  window.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);
  previewImage.addEventListener('load', () => {
    if (!sourceImage) return;
    sizeMagnifierPane();
    updateMagnifiedPreview();
    lens.classList.add('show');
    positionBesideSource();
  });
  $('#imageHoverPreviewEnabled')?.addEventListener('change', event => {
    if (state.config) state.config.imageHoverPreviewEnabled = event.target.checked;
    document.documentElement.classList.toggle('image-hover-disabled', !event.target.checked);
    if (!event.target.checked) hide();
  });
}

function shortPath(value) {
  if (!value) return '尚未配置';
  const parts = value.split('/').filter(Boolean);
  return parts.length > 4 ? `…/${parts.slice(-4).join('/')}` : value;
}

function setPage(name) {
  if (name === 'prompts' && !canViewPrompts()) name = 'settings';
  if (name === 'mobile-stats' && !isSuperAdmin()) name = 'tasks';
  if (name === 'settings') {
    if (state.currentUser?.role === 'admin' && state.settingsTab === 'general') state.settingsTab = 'api';
    else if (state.settingsTab === 'api' && !isTeamAdmin()) state.settingsTab = 'general';
    else if (state.settingsTab === 'billing' && !isSuperAdmin()) state.settingsTab = 'general';
    else if (state.settingsTab === 'team' && !isTeamAdmin()) state.settingsTab = 'general';
  }
  const nextPage = $(`#page-${name}`);
  if (name === 'childrenwear-review' && currentPage !== name) {
    state.childrenwearReviewFilter = 'all';
    state.childrenwearReviewGroupLimits.clear();
    state.childrenwearReviewVisibleGroupLimit = 12;
  }
  const productionScrollLock = name === 'childrenwear' || name === 'childrenwear-review';
  if (productionScrollLock) {
    document.documentElement.classList.remove('production-scroll-lock');
    document.body.classList.remove('production-scroll-lock');
    document.scrollingElement.scrollTop = 0;
  }
  $('#appShell')?.classList.toggle('production-scroll-lock', productionScrollLock);
  document.body.classList.toggle('production-scroll-lock', productionScrollLock);
  document.documentElement.classList.toggle('production-scroll-lock', productionScrollLock);
  if (!nextPage || (name === currentPage && nextPage.classList.contains('active'))) return;
  currentPage = name;
  $('#appShell')?.classList.toggle('mobile-stats-mode', name === 'mobile-stats');
  if (name !== 'review') {
    clearTimeout(reviewRefreshTimer);
    reviewRefreshTimer = null;
  } else {
    state.activeReview = null;
    state.reviewTaskActivated = false;
  }
  $$('.nav-item').forEach(button => {
    const active = button.dataset.page === name
      && (name !== 'childrenwear' || !button.dataset.childrenwearProductionNav || button.dataset.childrenwearProductionNav === state.childrenwearProductionTab);
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  $$('.page').forEach(page => page.classList.toggle('active', page.id === `page-${name}`));
  requestAnimationFrame(() => {
    if (currentPage !== name) return;
    if (name === 'review') loadReviews({ silent: state.reviews.length > 0 });
    if (name === 'childrenwear') setChildrenwearProductionTab(state.childrenwearProductionTab);
    if (name === 'childrenwear-review') renderCwReview();
    if (name === 'prompts' && canViewPrompts() && !state.promptSettings) loadPromptSettings();
    if (name === 'assets') loadChildrenwearLibraries();
    if (name === 'mobile-stats') loadMobileStats();
    if (name === 'settings' && isTeamAdmin() && !state.relayChoices) loadRelayChoices();
    if (name === 'settings' && isSuperAdmin() && !state.apiSettings) loadApiSettings();
  });
}

function setTaskSourceTab(tab) {
  state.taskSourceTab = tab === 'print' ? 'print' : 'template';
  const layout = $('#page-tasks .task-layout');
  if (layout) layout.classList.toggle('template-source-print-active', state.taskSourceTab === 'print');
  $$('.template-source-tabs [data-template-source-tab]').forEach(button => {
    const active = button.dataset.templateSourceTab === state.taskSourceTab;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
  });
}

async function chooseFolder(key) {
  const selected = await window.caishen.chooseFolder(state.config?.[key], key);
  if (!selected) return;
  state.config[key] = selected;
  if (key === 'categoriesPath') state.productFolder = '';
  if (key === 'printsPath') state.printFolder = '';
  if (key === 'detailSetsPath') state.templatePreparation = null;
  state.config = await window.caishen.saveConfig(state.config);
  renderConfig();
  if (key === 'categoriesPath' || key === 'printsPath') await loadAssets(key);
  if (key === 'detailSetsPath') {
    state.templateFolderView = selected;
    state.taskTemplateFolderView = selected;
    await loadTemplateFolders();
    await loadTemplatePreparation({ autoPrepare: true });
  }
}

function renderConfig() {
  $('#operatorCode').value = state.config.operatorCode || 'ys';
  const hoverPreviewEnabled = state.config.imageHoverPreviewEnabled !== false;
  if ($('#imageHoverPreviewEnabled')) $('#imageHoverPreviewEnabled').checked = hoverPreviewEnabled;
  document.documentElement.classList.toggle('image-hover-disabled', !hoverPreviewEnabled);
  const fields = [
    ['categoriesPath', '#categoriesPathLabel', null],
    ['printsPath', '#printsPathLabel', '#settingPrintsPath'],
    ['detailSetsPath', null, '#settingDetailSetsPath']
  ];
  for (const [key, primary, settings] of fields) {
    const label = shortPath(state.config[key]);
    if (primary) { $(primary).textContent = label; $(primary).title = state.config[key] || ''; }
    if (settings) {
      $(settings).textContent = label;
      $(settings).title = state.config[key] || '';
    }
  }
  const outputInput = $('#settingOutputPathInput');
  if (outputInput && document.activeElement !== outputInput) outputInput.value = state.config.outputPath || state.config.defaultOutputPath || '';
  $('#settingWorkspaceRoot').textContent = shortPath(state.config.defaultOutputPath || '');
  $('#settingWorkspaceRoot').title = state.config.defaultOutputPath || '';
  $('#settingOutputPathHint').textContent = `填写主电脑可访问的绝对路径，建议使用单独文件夹。新任务按套图原目录和文件名输出；重新生成覆盖同名文件。`;
  $('#taskTemplatePath').textContent = state.config.detailSetsPath ? String(state.config.detailSetsPath).split(/[\\/]/).filter(Boolean).pop() : '尚未选择套图文件夹';
  $('#taskTemplatePath').title = state.config.detailSetsPath || '';
  $$('.audit-button').forEach(button => button.classList.toggle('active', button.dataset.audit === state.config.auditMode));
  $('#auditModeStatus').textContent = state.config.auditMode === 'quality'
    ? '当前：质检模式，生成后执行 AI 审核。'
    : '当前：省钱模式，生成后交给人工确认。';
  renderChildrenwearAnalysisAutomation();
  renderTemplateWorkflow();
}

function normalizeLocalPath(value = '') {
  return String(value || '').replaceAll('\\', '/').replace(/\/+$/, '').toLocaleLowerCase('zh-CN');
}

function isClientSubPath(root, candidate) {
  const base = normalizeLocalPath(root);
  const target = normalizeLocalPath(candidate);
  return Boolean(base && target && (target === base || target.startsWith(`${base}/`)));
}

async function sanitizeConfigWorkspacePaths() {
  if (!state.config?.workspaceRoot) return;
  let changed = false;
  for (const key of ['categoriesPath', 'printsPath', 'detailSetsPath', 'childrenwearRealAssetsPath', 'childrenwearReferenceAssetsPath', 'childrenwearModelAssetsPath', 'childrenwearSceneAssetsPath', 'childrenwearCombinationAssetsPath']) {
    if (state.config[key] && !isClientSubPath(state.config.workspaceRoot, state.config[key])) {
      state.config[key] = '';
      changed = true;
    }
  }
  if (changed) state.config = await window.caishen.saveConfig(state.config);
}

function currentTemplateFolderView() {
  return state.templateFolderView || state.config?.detailSetsPath || 'all';
}

function currentTaskTemplateFolderView() {
  return state.taskTemplateFolderView || state.config?.detailSetsPath || 'all';
}

function templateFolderName(folderPath) {
  return state.templateFolders.find(folder => folder.path === folderPath)?.name
    || String(folderPath || '').split(/[\\/]/).filter(Boolean).pop()
    || '未选择';
}

function templateFolderPathForItem(item) {
  return item?.templateFolderPath || state.config?.detailSetsPath || '';
}

function masterReferenceFromItem(item) {
  if (!item) return null;
  return {
    masterReferencePath: item.path || '',
    masterReferenceName: item.name || '',
    masterReferenceThumbnailUrl: item.thumbnailUrl || item.url || '',
    masterReferencePreviewUrl: item.previewUrl || item.url || '',
    masterReferenceRelativePath: item.relativePath || ''
  };
}

function templateMasterCandidateKey(referencePath, printPath) {
  return `${referencePath || ''}|${printPath || ''}`;
}

function templateMasterPrintFields(print) {
  return print ? {
    printPath: print.path,
    printName: print.name,
    printThumbnailUrl: print.thumbnailUrl || print.url || '',
    printPreviewUrl: print.previewUrl || print.url || ''
  } : {
    printPath: '',
    printName: '',
    printThumbnailUrl: '',
    printPreviewUrl: ''
  };
}

function createEmptyTemplateMasterCandidate(extra = {}) {
  return {
    id: createClientId(),
    key: '',
    generationMode: 'template_print',
    productPath: '',
    templateFolderPath: state.config?.detailSetsPath || currentTaskTemplateFolderView() || '',
    masterReferencePath: '',
    masterReferenceName: '',
    masterReferenceThumbnailUrl: '',
    masterReferencePreviewUrl: '',
    masterReferenceRelativePath: '',
    masterImagePath: '',
    masterImageUrl: '',
    masterImagePreviewUrl: '',
    masterStatus: '未生成',
    masterError: '',
    masterProgress: null,
    masterRunAttempt: 0,
    ...templateMasterPrintFields(null),
    ...extra
  };
}

function templateMasterCandidateFromItem(item, print = state.selectedPrint) {
  if (!item) return null;
  const reference = masterReferenceFromItem(item);
  return {
    ...createEmptyTemplateMasterCandidate({
      ...reference,
      ...templateMasterPrintFields(print),
      templateFolderPath: templateFolderPathForItem(item)
    })
  };
}

function templateMasterCandidateForPath(path) {
  return state.templateMasterCandidates.find(candidate => candidate.masterReferencePath === path);
}

function activeTemplateMasterCandidate() {
  return state.templateMasterCandidates.find(candidate => candidate.id === state.activeTemplateMasterCandidateId) || null;
}

function clearTemplateMasterGeneratedImage(candidate) {
  if (!candidate) return;
  candidate.masterImagePath = '';
  candidate.masterImageUrl = '';
  candidate.masterImagePreviewUrl = '';
  candidate.masterStatus = '未生成';
  candidate.masterError = '';
  candidate.masterProgress = null;
}

function upsertTemplateMasterCandidateFromItem(item) {
  const candidate = templateMasterCandidateFromItem(item);
  if (!candidate) return null;
  candidate.selected = true;
  state.templateMasterCandidates.push(candidate);
  persistTemplateMasterCandidates();
  toast(candidate.printPath
    ? `已创建母版任务：${candidate.masterReferenceName} + ${candidate.printName}`
    : `已创建母版任务：${candidate.masterReferenceName}，等待选择印花`);
  return candidate;
}

function lastIncompleteTemplateMasterCandidate() {
  for (let index = state.templateMasterCandidates.length - 1; index >= 0; index -= 1) {
    const candidate = state.templateMasterCandidates[index];
    if (!candidate.masterReferencePath || !candidate.printPath) return candidate;
  }
  return null;
}

function addTemplateMasterReference(item) {
  if (!item) return null;
  const active = activeTemplateMasterCandidate();
  if (active) {
    Object.assign(active, masterReferenceFromItem(item), {
      templateFolderPath: templateFolderPathForItem(item)
    });
    clearTemplateMasterGeneratedImage(active);
    active.selected = true;
    persistTemplateMasterCandidates();
    toast(`已更新母版底图：${active.masterReferenceName || ''}`);
    return active;
  }
  const incomplete = lastIncompleteTemplateMasterCandidate();
  if (incomplete && !incomplete.masterReferencePath) {
    Object.assign(incomplete, masterReferenceFromItem(item), {
      templateFolderPath: templateFolderPathForItem(item),
    });
    clearTemplateMasterGeneratedImage(incomplete);
    incomplete.selected = true;
    persistTemplateMasterCandidates();
    toast(incomplete.printPath
      ? `已补齐母版底图：${incomplete.masterReferenceName} + ${incomplete.printName}`
      : `已补齐母版底图：${incomplete.masterReferenceName}`);
    return incomplete;
  }
  return upsertTemplateMasterCandidateFromItem(item);
}

function addTemplateMasterPrint(print) {
  if (!print) return null;
  const active = activeTemplateMasterCandidate();
  if (active) {
    Object.assign(active, templateMasterPrintFields(print));
    clearTemplateMasterGeneratedImage(active);
    active.selected = true;
    persistTemplateMasterCandidates();
    toast(`已更新印花：${active.printName || ''}`);
    return active;
  }
  const incomplete = lastIncompleteTemplateMasterCandidate();
  if (incomplete && !incomplete.printPath) {
    Object.assign(incomplete, templateMasterPrintFields(print), {
    });
    clearTemplateMasterGeneratedImage(incomplete);
    incomplete.selected = true;
    persistTemplateMasterCandidates();
    toast(incomplete.masterReferencePath
      ? `已补齐印花：${incomplete.masterReferenceName} + ${incomplete.printName}`
      : `已加入印花：${incomplete.printName}，等待选择母版底图`);
    return incomplete;
  }
  const candidate = createEmptyTemplateMasterCandidate(templateMasterPrintFields(print));
  candidate.selected = true;
  state.templateMasterCandidates.push(candidate);
  persistTemplateMasterCandidates();
  toast(`已创建母版任务：${candidate.printName}，等待选择母版底图`);
  return candidate;
}

function removeTemplateMasterCandidate(id) {
  const index = state.templateMasterCandidates.findIndex(candidate => candidate.id === id);
  if (index < 0) return;
  const [candidate] = state.templateMasterCandidates.splice(index, 1);
  if (state.activeTemplateMasterCandidateId === id) state.activeTemplateMasterCandidateId = '';
  persistTemplateMasterCandidates();
  renderTemplateWorkflow();
  toast(`已移除母版底图：${candidate.masterReferenceName || ''}`);
}

function selectedTemplateMasterCandidates() {
  return state.templateMasterCandidates.filter(candidate => candidate.selected);
}

function selectAllTemplateMasterCandidates(selected = true) {
  state.templateMasterCandidates.forEach(candidate => { candidate.selected = selected; });
  persistTemplateMasterCandidates();
  renderTemplateWorkflow();
}

function removeSelectedTemplateMasterCandidates() {
  const selected = selectedTemplateMasterCandidates();
  if (!selected.length) return toast('请先勾选要删除的母版任务', true);
  const selectedIds = new Set(selected.map(candidate => candidate.id));
  state.templateMasterCandidates = state.templateMasterCandidates.filter(candidate => !selectedIds.has(candidate.id));
  if (selectedIds.has(state.activeTemplateMasterCandidateId)) state.activeTemplateMasterCandidateId = '';
  persistTemplateMasterCandidates();
  renderTemplateWorkflow();
  toast(`已删除 ${selected.length} 个母版任务`);
}

function templateMasterCandidateHasImage(candidate) {
  return Boolean(candidate?.masterImagePath) && !['生成中', '重新生成'].includes(candidate?.masterStatus);
}

function syncTemplateMasterCandidateToQueuedTasks(candidate) {
  if (!candidate?.id) return;
  for (const task of state.queue) {
    if (task.masterCandidateId !== candidate.id) continue;
    if (!['未开始', '失败'].includes(task.status)) continue;
    Object.assign(task, {
      masterReferencePath: candidate.masterReferencePath || '',
      masterReferenceName: candidate.masterReferenceName || '',
      masterReferenceThumbnailUrl: candidate.masterReferenceThumbnailUrl || '',
      masterReferencePreviewUrl: candidate.masterReferencePreviewUrl || '',
      masterReferenceRelativePath: candidate.masterReferenceRelativePath || '',
      masterImagePath: candidate.masterImagePath || '',
      masterImageUrl: candidate.masterImageUrl || '',
      masterImagePreviewUrl: candidate.masterImagePreviewUrl || '',
      masterStatus: candidate.masterStatus || '已生成',
      masterError: '',
      masterProgress: null
    });
  }
  persistQueue();
}

function resetTaskMaster(task, reference = null) {
  if (reference) Object.assign(task, reference);
  task.masterImagePath = '';
  task.masterImageUrl = '';
  task.masterImagePreviewUrl = '';
  task.masterStatus = '未生成';
  task.masterError = '';
  task.masterProgress = null;
}

function templateTaskHasMaster(task) {
  return task?.generationMode !== 'template_print'
    || (Boolean(task.masterImagePath) && !['生成中', '重新生成'].includes(task.masterStatus));
}

function relatedTemplatePrintTasks(sourceTask) {
  if (!sourceTask) return [];
  return state.queue.filter(task => task.generationMode === 'template_print'
    && task.printPath === sourceTask.printPath
    && task.templateFolderPath === sourceTask.templateFolderPath
    && (!sourceTask.batchId || task.batchId === sourceTask.batchId));
}

function syncTaskMasterToRelatedTasks(sourceTask) {
  for (const task of relatedTemplatePrintTasks(sourceTask)) {
    Object.assign(task, {
      masterReferencePath: sourceTask.masterReferencePath || '',
      masterReferenceName: sourceTask.masterReferenceName || '',
      masterReferenceThumbnailUrl: sourceTask.masterReferenceThumbnailUrl || '',
      masterReferencePreviewUrl: sourceTask.masterReferencePreviewUrl || '',
      masterImagePath: sourceTask.masterImagePath || '',
      masterImageUrl: sourceTask.masterImageUrl || '',
      masterImagePreviewUrl: sourceTask.masterImagePreviewUrl || '',
      masterStatus: sourceTask.masterStatus || '未生成',
      masterError: sourceTask.masterError || '',
      masterProgress: sourceTask.masterProgress || null
    });
  }
}

function applyMasterReferenceToQueuedTasks(reference) {
  return reference;
}

function expandTemplateTaskGroupToFullSet(task) {
  if (!task || task.generationMode !== 'template_print') return 0;
  const folderItems = state.taskTemplateItems.filter(item => item.action === 'replace_print' && templateFolderPathForItem(item) === task.templateFolderPath);
  if (!folderItems.length) return 0;
  const existing = new Set(state.queue
    .filter(item => item.generationMode === 'template_print' && item.templateFolderPath === task.templateFolderPath && item.printPath === task.printPath)
    .map(item => item.templateRelativePath));
  const missing = folderItems.filter(item => !existing.has(item.relativePath));
  if (!missing.length) return 0;
  let taskNumber = state.queue.reduce((maximum, item) => Math.max(maximum, Number(item.taskNumber) || 0), 0) + 1;
  const reference = task.masterReferencePath ? {
    masterReferencePath: task.masterReferencePath,
    masterReferenceName: task.masterReferenceName,
    masterReferenceThumbnailUrl: task.masterReferenceThumbnailUrl,
    masterReferencePreviewUrl: task.masterReferencePreviewUrl,
    masterReferenceRelativePath: task.masterReferenceRelativePath || ''
  } : {};
  const batchId = task.batchId || createClientId();
  task.batchId = batchId;
  state.queue.push(...missing.map(item => ({
    printPath: task.printPath,
    printName: task.printName,
    printThumbnailUrl: task.printThumbnailUrl || '',
    printPreviewUrl: task.printPreviewUrl || '',
    generationMode: 'template_print',
    note: task.note || '',
    selected: task.selected,
    status: '未开始',
    error: '',
    ...reference,
    masterImagePath: task.masterImagePath || '',
    masterImageUrl: task.masterImageUrl || '',
    masterImagePreviewUrl: task.masterImagePreviewUrl || '',
    masterStatus: task.masterStatus || '未生成',
    masterError: task.masterError || '',
    masterProgress: task.masterProgress || null,
    id: createClientId(),
    batchId,
    taskNumber: taskNumber++,
    productPath: '',
    productName: item.name,
    productThumbnailUrl: item.thumbnailUrl || item.url || '',
    productPreviewUrl: item.previewUrl || item.url || '',
    templateFolderPath: task.templateFolderPath,
    templateRelativePath: item.relativePath,
    templatePreviewName: item.name,
    templateThumbnailUrl: item.thumbnailUrl || item.url || '',
    templatePreviewUrl: item.previewUrl || item.url || ''
  })));
  return missing.length;
}

function annotateTemplateItems(items, folder) {
  return (items || []).map(item => ({
    ...item,
    templateFolderPath: folder.path,
    templateFolderName: folder.name
  }));
}

function sortByName(items, direction = 'name-asc', selector = item => item.name) {
  const multiplier = direction === 'name-desc' ? -1 : 1;
  return [...(items || [])].sort((left, right) =>
    multiplier * String(selector(left) || '').localeCompare(String(selector(right) || ''), 'zh-CN', { numeric: true })
  );
}

async function listTemplateItemsForCurrentView() {
  const view = currentTemplateFolderView();
  if (!state.templateFolders.length) return [];
  const folders = view === 'all'
    ? state.templateFolders
    : state.templateFolders.filter(folder => folder.path === view);
  if (!folders.length) return [];
  const results = await Promise.all(folders.map(async folder => annotateTemplateItems(await window.caishen.listTemplates(folder.path), folder)));
  return sortByName(results.flat(), 'name-asc', item => `${item.templateFolderName || ''}/${item.relativePath || item.name || ''}`);
}

async function listTaskTemplateItemsForCurrentView() {
  const view = currentTaskTemplateFolderView();
  if (!state.templateFolders.length) return [];
  const folders = view === 'all'
    ? state.templateFolders
    : state.templateFolders.filter(folder => folder.path === view);
  if (!folders.length) return [];
  const results = await Promise.all(folders.map(async folder => annotateTemplateItems(await window.caishen.listTemplates(folder.path), folder)));
  return sortByName(results.flat(), state.taskTemplateSort, item => `${item.templateFolderName || ''}/${item.relativePath || item.name || ''}`);
}

async function listTaskTemplateItemsForFolder(folderPath) {
  const folder = state.templateFolders.find(item => item.path === folderPath) || { path: folderPath, name: templateFolderName(folderPath) };
  return annotateTemplateItems(await window.caishen.listTemplates(folder.path), folder);
}

async function refreshTemplateMasterReference(candidate) {
  if (!candidate?.templateFolderPath) return candidate;
  const currentItems = state.taskTemplateItems.some(item => templateFolderPathForItem(item) === candidate.templateFolderPath)
    ? state.taskTemplateItems
    : await listTaskTemplateItemsForFolder(candidate.templateFolderPath);
  const match = currentItems.find(item =>
    templateFolderPathForItem(item) === candidate.templateFolderPath
    && candidate.masterReferenceRelativePath
    && item.relativePath === candidate.masterReferenceRelativePath
  ) || currentItems.find(item =>
    templateFolderPathForItem(item) === candidate.templateFolderPath
    && candidate.masterReferenceName
    && item.name === candidate.masterReferenceName
  );
  if (!match) return candidate;
  Object.assign(candidate, masterReferenceFromItem(match), {
    templateFolderPath: templateFolderPathForItem(match)
  });
  persistTemplateMasterCandidates();
  return candidate;
}

function taskTemplateRootKey(folderPath) {
  return `root:${folderPath}`;
}

function taskTemplateGroupName(item) {
  const normalized = String(item.relativePath || '').replaceAll('\\', '/');
  const parts = normalized.split('/').filter(Boolean);
  return parts.length > 1 ? parts.slice(0, -1).join('/') : '根目录';
}

function taskTemplateGroupKey(folderPath, groupName) {
  return `group:${folderPath}:${groupName}`;
}

function taskTemplateTreeData(items = state.taskTemplateItems) {
  const roots = new Map();
  for (const item of items.filter(entry => entry.action === 'replace_print')) {
    const folderPath = templateFolderPathForItem(item);
    if (!roots.has(folderPath)) roots.set(folderPath, {
      path: folderPath,
      name: item.templateFolderName || templateFolderName(folderPath),
      items: [],
      groups: new Map()
    });
    const root = roots.get(folderPath);
    const groupName = taskTemplateGroupName(item);
    root.items.push(item);
    if (!root.groups.has(groupName)) root.groups.set(groupName, []);
    root.groups.get(groupName).push(item);
  }
  return [...roots.values()];
}

function syncTaskTemplateSelection({ reset = false } = {}) {
  const eligible = state.taskTemplateItems.filter(item => item.action === 'replace_print');
  const validPaths = new Set(eligible.map(item => item.path));
  const scope = currentTaskTemplateFolderView();
  if (reset || state.taskTemplateSelectionScope !== scope) {
    state.selectedTaskTemplatePaths = new Set(validPaths);
    state.taskTemplateSelectionScope = scope;
    state.taskTemplateExpandedGroups = new Set(taskTemplateTreeData(eligible).map(root => taskTemplateRootKey(root.path)));
    return;
  }
  state.selectedTaskTemplatePaths = new Set([...state.selectedTaskTemplatePaths].filter(path => validPaths.has(path)));
}

function taskTemplateSelectionMark(items) {
  const selected = items.filter(item => state.selectedTaskTemplatePaths.has(item.path)).length;
  return selected === items.length ? '✓' : selected ? '—' : '';
}

function renderTaskTemplateTree(items, taskViewAll) {
  const sortedItems = sortByName(items, state.taskTemplateSort, item => `${taskViewAll ? item.templateFolderName || '' : ''}/${item.relativePath || item.name || ''}`);
  return `<div class="task-template-flat-grid" role="list">${sortedItems.map(item => {
    const sameReferenceCount = state.templateMasterCandidates.filter(candidate => candidate.masterReferencePath === item.path).length;
    const group = taskViewAll ? item.templateFolderName || templateFolderName(templateFolderPathForItem(item)) : taskTemplateGroupName(item);
    return `<button class="task-template-image" type="button" data-task-template-image="${escapeHtml(item.path)}" title="${escapeHtml(item.relativePath)}" role="listitem">
      <span class="task-template-image-check">${sameReferenceCount ? sameReferenceCount : ''}</span>
      <img loading="lazy" decoding="async" src="${escapeHtml(item.thumbnailUrl || item.url)}" data-preview-src="${escapeHtml(item.previewUrl || item.url)}" alt="${escapeHtml(item.name)}">
      <span><b>${escapeHtml(item.name)}</b><small>${escapeHtml(group)} · ${escapeHtml(item.relativePath)}</small></span>
    </button>`;
  }).join('')}</div>`;
}

function renderTemplateFolders() {
  const browser = $('#templateFolderBrowser');
  if (!browser) return;
  const activePath = state.config?.detailSetsPath || '';
  const view = currentTemplateFolderView();
  const allCount = state.templateFolders.reduce((total, folder) => total + Number(folder.count || 0), 0);
  $('#settingDetailSetsPath').textContent = state.templateFolders.length
    ? `已导入 ${state.templateFolders.length} 个文件夹${activePath ? ` · 当前：${state.templateFolders.find(item => item.path === activePath)?.name || '未选择'}` : ''}`
    : '尚未导入套图文件夹';
  $('#settingDetailSetsPath').title = activePath;
  const folders = sortByName(state.templateFolders, state.taskTemplateSort, folder => folder.name);
  browser.innerHTML = folders.length ? [`<div class="template-folder-card template-folder-all${view === 'all' ? ' active' : ''}" title="显示所有已导入文件夹的图片"><button class="template-folder-select" type="button" data-template-folder-view="all" aria-pressed="${view === 'all'}"><span class="template-all-icon" aria-hidden="true"></span><span><b>全部文件夹</b><small>${allCount} 张图片 · ${state.templateFolders.length} 个文件夹</small></span></button></div>`, ...folders.map(folder => {
    const active = view === folder.path;
    const current = folder.path === activePath;
    const preview = folder.preview?.thumbnailUrl
      ? `<img loading="lazy" decoding="async" src="${escapeHtml(folder.preview.thumbnailUrl)}" data-preview-src="${escapeHtml(folder.preview.previewUrl || folder.preview.url)}" alt="${escapeHtml(folder.name)}">`
      : '<span class="template-folder-icon" aria-hidden="true"></span>';
    return `<div class="template-folder-card${active ? ' active' : ''}${current ? ' current' : ''}" title="${escapeHtml(folder.path)}"><button class="template-folder-select" type="button" data-template-folder="${escapeHtml(folder.path)}" aria-pressed="${active}">${preview}<span><b>${escapeHtml(folder.name)}</b><small>${folder.count} 张图片${current ? ' · 当前使用' : ''}</small></span></button><button class="template-folder-delete" type="button" data-delete-template-folder="${escapeHtml(folder.path)}" aria-label="删除套图文件夹 ${escapeHtml(folder.name)}" title="删除此文件夹">删除</button></div>`;
  })].join('') : '<div class="template-folder-empty"><b>还没有套图文件夹</b><span>点击“导入新文件夹”，后续可以继续追加其他文件夹。</span></div>';
}

async function loadTemplateFolders() {
  try {
    state.templateFolders = await window.caishen.listTemplateFolders();
    const validPaths = new Set(state.templateFolders.map(folder => folder.path));
    if (!state.templateFolders.length) {
      state.templateFolderView = '';
      state.taskTemplateFolderView = '';
      state.templateItems = [];
      state.taskTemplateItems = [];
      state.templatePreparation = null;
      state.selectedTaskTemplatePaths.clear();
      state.taskTemplateExpandedGroups.clear();
      state.templateMasterCandidates = [];
      state.activeTemplateMasterCandidateId = '';
      state.assetPreviewCache.delete('detailSetsPath');
      persistTemplateMasterCandidates();
      renderTemplateWorkflow();
    }
    if (!state.templateFolderView) state.templateFolderView = validPaths.has(state.config?.detailSetsPath) ? state.config.detailSetsPath : 'all';
    else if (state.templateFolderView !== 'all' && !validPaths.has(state.templateFolderView)) {
      state.templateFolderView = validPaths.has(state.config?.detailSetsPath) ? state.config.detailSetsPath : 'all';
    }
    if (!state.taskTemplateFolderView) state.taskTemplateFolderView = validPaths.has(state.config?.detailSetsPath) ? state.config.detailSetsPath : 'all';
    else if (state.taskTemplateFolderView !== 'all' && !validPaths.has(state.taskTemplateFolderView)) {
      state.taskTemplateFolderView = validPaths.has(state.config?.detailSetsPath) ? state.config.detailSetsPath : 'all';
    }
    renderTemplateFolders();
    return state.templateFolders;
  } catch (error) {
    state.templateFolders = [];
    $('#templateFolderBrowser').innerHTML = `<div class="template-folder-empty">${escapeHtml(errorText(error))}</div>`;
    return [];
  }
}

async function selectTemplateFolder(folderPath) {
  if (!folderPath) return;
  state.templateFolderView = folderPath;
  state.taskTemplateFolderView = folderPath;
  state.assetTemplateFilter = 'all';
  state.selectedAssetPaths.clear();
  if (folderPath === state.config?.detailSetsPath) {
    renderTemplateFolders();
    await loadAssetLibraryPreview('detailSetsPath', { force: true });
    return toast(`正在查看套图：${state.templateFolders.find(item => item.path === folderPath)?.name || '当前文件夹'}`);
  }
  state.config.detailSetsPath = folderPath;
  state.templatePreparation = null;
  state.templateItems = [];
  state.config = await window.caishen.saveConfig(state.config);
  renderConfig();
  renderTemplateFolders();
  await Promise.all([
    loadTemplatePreparation(),
    loadAssetLibraryPreview('detailSetsPath', { force: true })
  ]);
  toast(`已切换套图：${state.templateFolders.find(item => item.path === folderPath)?.name || '当前文件夹'}`);
}

async function showAllTemplateFolders() {
  state.templateFolderView = 'all';
  state.assetTemplateFilter = 'all';
  state.selectedAssetPaths.clear();
  renderTemplateFolders();
  await loadAssetLibraryPreview('detailSetsPath', { force: true });
  toast(`正在显示全部 ${state.templateFolders.length} 个套图文件夹`);
}

function renderTaskTemplateFolderList() {
  const container = $('#taskTemplateFolderList');
  const activePath = state.config?.detailSetsPath || '';
  const view = currentTaskTemplateFolderView();
  const allCount = state.templateFolders.reduce((total, folder) => total + Number(folder.count || 0), 0);
  const folders = sortByName(state.templateFolders, state.taskTemplateSort, folder => folder.name);
  container.innerHTML = folders.length ? [`<button class="task-template-folder-option task-template-folder-all${view === 'all' ? ' active' : ''}" type="button" data-task-template-folder="all" aria-pressed="${view === 'all'}"><span class="template-all-icon" aria-hidden="true"></span><span><b>全部文件夹</b><small>${state.templateFolders.length} 个文件夹 · 共 ${allCount} 张图片</small></span><strong>${view === 'all' ? '当前查看' : '查看'}</strong></button>`, ...folders.map(folder => {
    const active = view === folder.path;
    const current = folder.path === activePath;
    const preview = folder.preview?.thumbnailUrl
      ? `<img loading="lazy" decoding="async" src="${escapeHtml(folder.preview.thumbnailUrl)}" data-preview-src="${escapeHtml(folder.preview.previewUrl || folder.preview.url)}" alt="${escapeHtml(folder.name)}">`
      : '<span class="template-folder-icon" aria-hidden="true"></span>';
    return `<button class="task-template-folder-option${active ? ' active' : ''}${current ? ' current' : ''}" type="button" data-task-template-folder="${escapeHtml(folder.path)}" aria-pressed="${active}">${preview}<span><b>${escapeHtml(folder.name)}</b><small>${folder.count} 张图片${current ? ' · 任务使用中' : ''}</small></span><strong>${active ? '当前查看' : current ? '任务使用' : '选择'}</strong></button>`;
  })].join('') : '<div class="empty-state"><b>还没有套图文件夹</b><span>请先到素材资产页面导入套图模板。</span></div>';
}

async function openTaskTemplateFolderModal() {
  $('#taskTemplateFolderModal').hidden = false;
  $('#taskTemplateFolderList').innerHTML = '<div class="empty-inline">正在读取套图文件夹…</div>';
  await loadTemplateFolders();
  renderTaskTemplateFolderList();
}

function closeTaskTemplateFolderModal() {
  $('#taskTemplateFolderModal').hidden = true;
}

async function chooseTaskTemplateFolder(folderPath) {
  if (!folderPath) return;
  closeTaskTemplateFolderModal();
  state.activeTemplateMasterCandidateId = '';
  if (folderPath === 'all') {
    state.taskTemplateFolderView = 'all';
    state.taskTemplateItems = await listTaskTemplateItemsForCurrentView();
    syncTaskTemplateSelection({ reset: true });
    renderTemplateWorkflow();
    return toast(`正在查看全部 ${state.templateFolders.length} 个套图文件夹`);
  }
  state.taskTemplateFolderView = folderPath;
  if (folderPath === state.config.detailSetsPath) {
    await loadTemplatePreparation();
    return toast('已刷新当前套图文件夹');
  }
  await selectTemplateFolder(folderPath);
}

async function deleteTemplateFolder(folderPath) {
  const folder = state.templateFolders.find(item => item.path === folderPath);
  if (!folder) return toast('套图文件夹不存在或已被删除', true);
  const runningTasks = state.queue.filter(task => task.templateFolderPath === folderPath && task.status === '生成中').length;
  if (runningTasks) return toast('该套图正在生成任务，完成后才能删除', true);
  const pendingTasks = state.queue.filter(task => task.templateFolderPath === folderPath).length;
  const taskNotice = pendingTasks ? `\n同时会移除使用该套图的 ${pendingTasks} 个待生成任务。` : '';
  if (!await brandConfirm(`确定删除套图文件夹“${folder.name}”及其中 ${folder.count} 张图片吗？${taskNotice}\n此操作不可撤销。`, { title: '删除套图文件夹', danger: true, confirmText: '删除' })) return;
  try {
    await window.caishen.deleteTemplateFolder(folderPath);
    state.queue = state.queue.filter(task => task.templateFolderPath !== folderPath);
    state.templateMasterCandidates = state.templateMasterCandidates.filter(candidate => candidate.templateFolderPath !== folderPath);
    persistTemplateMasterCandidates();
    state.assetPreviewCache.delete('detailSetsPath');
    state.selectedAssetPaths.clear();
    state.templatePreparation = null;
    state.templateItems = [];
    state.assetTemplateFilter = 'all';
    await loadTemplateFolders();
    if (state.config.detailSetsPath === folderPath) {
      state.config.detailSetsPath = state.templateFolders[0]?.path || '';
      state.config = await window.caishen.saveConfig(state.config);
      renderConfig();
      if (state.config.detailSetsPath) await loadTemplatePreparation();
    }
    if (state.assetPreviewKey === 'detailSetsPath') await loadAssetLibraryPreview('detailSetsPath', { force: true });
    renderTemplateFolders();
    renderQueue();
    toast(`已删除套图文件夹“${folder.name}”${pendingTasks ? `，并移除 ${pendingTasks} 个待生成任务` : ''}`);
  } catch (error) {
    toast(errorText(error), true);
    await loadTemplateFolders();
  }
}

function renderTemplateWorkflow() {
  if (!state.config) return;
  const hasTemplateFolders = state.templateFolders.length > 0;
  const folderReady = Boolean(state.config.detailSetsPath && hasTemplateFolders);
  const plan = state.templatePreparation;
  const analysisReady = Boolean(plan?.generationReady);
  const selectedTasks = state.queue.filter(task => task.selected);
  const runnableTasks = selectedTasks.length ? selectedTasks : state.queue;
  const allCompleted = runnableTasks.length > 0 && runnableTasks.every(task => task.status === '已完成');
  const runningTasks = runnableTasks.filter(task => ['排队中', '生成中'].includes(task.status));
  const individuallySelectedTemplates = runnableTasks.length > 0 && runnableTasks.every(task => task.generationMode === 'template_print' && task.templateRelativePath);

  const templatePreview = $('#taskTemplatePreview');
  const taskView = currentTaskTemplateFolderView();
  const taskViewAll = taskView === 'all';
  const activeFolderName = templateFolderName(state.config.detailSetsPath);
  const replaceItems = state.taskTemplateItems.filter(item => item.action === 'replace_print');
  $('#taskTemplateScopeLabel').textContent = hasTemplateFolders ? (taskViewAll ? '浏览范围' : '当前文件夹') : '当前文件夹';
  $('#taskTemplatePath').textContent = hasTemplateFolders ? (taskViewAll ? '全部文件夹' : templateFolderName(taskView)) : '尚未导入套图文件夹';
  $('#taskTemplatePath').title = hasTemplateFolders ? (taskViewAll ? state.templateFolders.map(folder => folder.name).join('、') : taskView) : '';
  $('#taskTemplateFolderHint').textContent = !hasTemplateFolders
    ? '请先到素材资产导入套图文件夹'
    : taskViewAll
      ? `当前显示 ${replaceItems.length} 张 · 默认整套任务文件夹：${activeFolderName}`
      : `当前显示 ${replaceItems.length} 张，可点击任意图片创建母版卡`;
  const candidateSignature = state.templateMasterCandidates.map(candidate => `${candidate.id}:${candidate.masterReferencePath}:${candidate.printPath}:${candidate.masterImagePath}:${candidate.masterStatus}:${candidate.selected ? 1 : 0}:${state.activeTemplateMasterCandidateId === candidate.id ? 1 : 0}`).join('|');
  const previewSignature = `${taskView}|${state.config.detailSetsPath || ''}|masters:${candidateSignature}|${replaceItems.map(item => `${item.path}:${item.thumbnailUrl || item.url}:${state.selectedTaskTemplatePaths.has(item.path)}`).join('|')}|${[...state.taskTemplateExpandedGroups].sort().join('|')}`;
  if (templatePreview.dataset.previewSignature !== previewSignature) {
    templatePreview.dataset.previewSignature = previewSignature;
    templatePreview.innerHTML = replaceItems.length
      ? renderTaskTemplateTree(replaceItems, taskViewAll)
      : `<div class="empty-state"><b>${folderReady ? '没有已框选的换印花图片' : '选择一个套图文件夹'}</b><span>${folderReady ? '请到素材资产中框选需要换印花的柜体，其余图片会保留原图。' : '点击右上角“更换文件夹”进行选择。'}</span></div>`;
  }

  $('#generateAllButton').textContent = runningTasks.length ? '正在生成…' : allCompleted ? '查看筛图结果' : '开始生成';
  $('#generateAllButton').disabled = Boolean(runningTasks.length) || !runnableTasks.length || (!allCompleted && !analysisReady && !individuallySelectedTemplates);
  $('#masterCandidateCount').textContent = `${state.templateMasterCandidates.length} 项`;
  renderTemplateMasterWorkflow();
}

function renderTemplateMasterWorkflow() {
  const panel = $('#templateMasterWorkflow');
  if (!panel) return;
  const candidates = state.templateMasterCandidates;
  const cards = candidates.map(candidate => {
    const progress = candidate.masterProgress || {};
    const percent = Math.max(0, Math.min(100, Number(progress.percent) || 0));
    const running = ['生成中', '重新生成'].includes(candidate.masterStatus);
    const canCreate = templateMasterCandidateHasImage(candidate);
    const complete = Boolean(candidate.masterReferencePath && candidate.printPath);
    const active = state.activeTemplateMasterCandidateId === candidate.id;
    return `<section class="template-master-card${candidate.selected ? ' is-selected' : ''}${active ? ' is-editing' : ''}" data-template-master-candidate="${escapeHtml(candidate.id)}">
      <div class="template-master-card-head">
        <label class="template-master-check"><input type="checkbox" data-template-master-select="${escapeHtml(candidate.id)}"${candidate.selected ? ' checked' : ''}><span aria-hidden="true"></span><b>${escapeHtml(candidate.masterReferenceName || candidate.printName || '母版任务')}</b></label>
        <div class="template-master-head-actions">
          <button class="secondary mini" type="button" data-template-master-edit="${escapeHtml(candidate.id)}">${active ? '编辑中' : '编辑'}</button>
          <button class="link-danger" type="button" data-template-master-remove="${escapeHtml(candidate.id)}"${running ? ' disabled' : ''}>删除</button>
        </div>
      </div>
      <div class="template-master-flow">
        ${queuePreviewFigure(candidate.masterReferenceThumbnailUrl || '', candidate.masterReferencePreviewUrl || '', candidate.masterReferenceName || '等待底图', '母版底图')}
        <span class="queue-preview-plus" aria-hidden="true">+</span>
        ${queuePreviewFigure(candidate.printThumbnailUrl || '', candidate.printPreviewUrl || '', candidate.printName || '等待印花', '印花')}
        <span class="queue-preview-plus" aria-hidden="true">→</span>
        ${queuePreviewFigure(candidate.masterImageUrl || candidate.masterImagePreviewUrl || '', candidate.masterImagePreviewUrl || candidate.masterImageUrl || '', candidate.masterImagePath ? '已生成母版' : '未生成母版', '母版图')}
      </div>
      <div class="template-master-copy">
        <span>底图：${escapeHtml(candidate.masterReferenceRelativePath || candidate.masterReferenceName || '待选择')}</span>
        <span>印花：${escapeHtml(candidate.printName || '待选择')}</span>
        <span>整套文件夹：${escapeHtml(templateFolderName(candidate.templateFolderPath || currentTaskTemplateFolderView()))} · ${state.taskTemplateItems.filter(item => item.action === 'replace_print' && templateFolderPathForItem(item) === (candidate.templateFolderPath || currentTaskTemplateFolderView())).length || state.taskTemplateItems.filter(item => item.action === 'replace_print').length} 张</span>
        ${running ? `<div class="queue-progress"><div><span>${escapeHtml(progress.message || '正在生成母版图…')}</span><b>${percent}%</b></div><progress max="100" value="${percent}"></progress></div>` : candidate.masterError ? `<span class="status error">${escapeHtml(candidate.masterError)}</span>` : ''}
        <button class="secondary" type="button" data-template-master-generate="${escapeHtml(candidate.id)}"${running || !complete ? ' disabled' : ''}>${candidate.masterImagePath ? '重新生成母版' : '生成母版'}</button>
        <button class="primary" type="button" data-template-master-create="${escapeHtml(candidate.id)}"${canCreate ? '' : ' disabled'}>开始生成整套</button>
      </div>
    </section>`;
  }).join('');
  panel.innerHTML = cards || '<div class="template-master-empty"><b>还没有母版任务</b><span>点击左侧底图或中间印花即可创建任务卡；顺序不限。</span></div>';
  const generateButton = $('#generateAllMastersButton');
  if (generateButton) {
    const selected = selectedTemplateMasterCandidates();
    const runnable = selected.filter(candidate => candidate.masterReferencePath && candidate.printPath && !['生成中', '重新生成'].includes(candidate.masterStatus));
    generateButton.disabled = !runnable.length;
    generateButton.textContent = runnable.length ? `生成选中母版（${runnable.length}）` : '生成选中母版';
  }
  const createAllButton = $('#createTasksFromAllMastersButton');
  if (createAllButton) {
    const selected = selectedTemplateMasterCandidates();
    const ready = selected.filter(templateMasterCandidateHasImage).length;
    createAllButton.disabled = !ready;
    createAllButton.textContent = ready ? `开始选中整套（${ready}）` : '开始选中整套';
  }
}

async function loadTemplatePreparation() {
  const folder = state.config?.detailSetsPath || '';
  if (!folder) {
    state.templatePreparation = null;
    state.taskTemplateItems = [];
    state.selectedTaskTemplatePaths.clear();
    state.taskTemplateSelectionScope = '';
    renderTemplateWorkflow();
    return null;
  }
  try {
    const [preparation, items] = await Promise.all([
      window.caishen.getTemplatePreparation(folder),
      listTaskTemplateItemsForCurrentView()
    ]);
    state.templatePreparation = preparation;
    state.taskTemplateItems = items;
    syncTaskTemplateSelection();
    renderTemplateWorkflow();
    return state.templatePreparation;
  } catch (error) {
    state.templatePreparation = null;
    state.taskTemplateItems = [];
    renderTemplateWorkflow();
    toast(errorText(error), true);
    return null;
  }
}

function formatBytes(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

function assetStageStatusElement(key) {
  const selector = key === 'printsPath' ? '#assetStagePrintsPath' : '#assetStageDetailSetsPath';
  return $(selector);
}

async function stageAssetFolder(key) {
  try {
    const stage = await window.caishen.stageAssetFolder(key);
    if (!stage) return;
    state.assetStages[key] = stage;
    assetStageStatusElement(key).textContent = key === 'detailSetsPath'
      ? `正在导入新文件夹“${stage.rootName}”：${stage.count} 张图片，共 ${formatBytes(stage.totalBytes)}。`
      : `正在扫描“${stage.rootName}”：${stage.count} 张图片，共 ${formatBytes(stage.totalBytes)}。`;
    $(`[data-sync-asset="${key}"]`).disabled = false;
    toast(`已读取 ${stage.count} 张图片，正在${key === 'detailSetsPath' ? '导入' : '扫描'}`);
    await syncAssetFolder(key);
  } catch (error) { toast(errorText(error), true); }
}

function updateAssetScanProgress(progress = {}) {
  const panel = $('#assetScanProgress');
  if (progress.phase === 'done') {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  $('#assetScanProgressTitle').textContent = progress.phase === 'done' ? '扫描完成' : '正在扫描素材';
  $('#assetScanProgressText').textContent = progress.message || '';
  const total = Math.max(0, Number(progress.total) || 0);
  const current = Math.max(0, Number(progress.current) || 0);
  $('#assetScanProgressBar').value = total ? Math.min(100, Math.round(current / total * 100)) : progress.phase === 'compare' ? 8 : 100;
}

async function syncAssetFolder(key) {
  const button = $(`[data-sync-asset="${key}"]`);
  if (!state.assetStages[key]) return toast('请先选择需要扫描的文件夹', true);
  button.disabled = true;
  button.textContent = key === 'detailSetsPath' ? '导入中…' : '扫描中…';
  try {
    const result = await window.caishen.syncAssetFolder(key, key === 'detailSetsPath' ? '' : state.config[key], updateAssetScanProgress);
    state.config[key] = result.root;
    if (key === 'detailSetsPath') {
      state.templatePreparation = null;
      state.templateFolderView = result.root;
      state.taskTemplateFolderView = result.root;
    }
    state.config = await window.caishen.saveConfig(state.config);
    renderConfig();
    assetStageStatusElement(key).textContent = `扫描完成：共 ${result.count} 张，新增或更新 ${result.uploaded} 张，跳过 ${result.skipped} 张。`;
    if (key === 'categoriesPath') state.productFolder = '';
    if (key === 'printsPath') state.printFolder = '';
    if (key === 'categoriesPath' || key === 'printsPath') await loadAssets(key);
    if (key === 'detailSetsPath') {
      await loadTemplateFolders();
      await loadTemplatePreparation();
    }
    state.assetPreviewKey = key;
    await loadAssetLibraryPreview(key, { force: true });
    if (key === 'detailSetsPath') delete state.assetStages[key];
    toast(key === 'detailSetsPath' ? `已导入套图文件夹“${result.name}”：${result.count} 张` : `素材扫描完成：新增或更新 ${result.uploaded} 张`);
  } catch (error) {
    $('#assetScanProgressTitle').textContent = '扫描失败';
    $('#assetScanProgressText').textContent = errorText(error);
    toast(errorText(error), true);
  } finally {
    button.disabled = !state.assetStages[key];
    button.textContent = key === 'detailSetsPath' ? '开始导入' : '开始扫描';
  }
}

function renderAssetSelectionState() {
  const count = state.selectedAssetPaths.size;
  const viewingAllTemplates = state.assetPreviewKey === 'detailSetsPath' && currentTemplateFolderView() === 'all';
  const visiblePaths = visibleAssetPreviewItems().map(item => item.path);
  const allVisibleSelected = visiblePaths.length > 0 && visiblePaths.every(path => state.selectedAssetPaths.has(path));
  $('#assetSelectedCount').textContent = count ? `已选择 ${count} 张` : '支持拖拽添加 · 未选择';
  $('#selectAllAssetsButton').textContent = allVisibleSelected ? '取消全选' : '全选';
  $('#selectAllAssetsButton').disabled = visiblePaths.length === 0 || state.assetUploading;
  $('#deleteSelectedAssetsButton').disabled = count === 0 || state.assetUploading;
  $('#addAssetFilesButton').disabled = state.assetUploading || viewingAllTemplates;
  $('#addAssetFilesButton').title = viewingAllTemplates ? '请先选择一个具体套图文件夹，再添加图片' : '';
}

function toggleAllVisibleAssets() {
  if (state.assetUploading) return;
  const visiblePaths = visibleAssetPreviewItems().map(item => item.path);
  if (!visiblePaths.length) return;
  const allSelected = visiblePaths.every(path => state.selectedAssetPaths.has(path));
  for (const path of visiblePaths) {
    if (allSelected) state.selectedAssetPaths.delete(path);
    else state.selectedAssetPaths.add(path);
  }
  renderAssetManagementGrid();
}

const ASSET_TEMPLATE_FILTERS = [
  ['all', '全部'],
  ['replace_print', '强制换印花'],
  ['copy_original', '保留原图'],
  ['exclude', '不输出'],
  ['manual_check', '人工确认']
];

function normalizeTemplateUiAction(action) {
  if (action === 'copy_template') return 'copy_original';
  if (action === 'skip_copy') return 'exclude';
  return action || 'manual_check';
}

function filteredAssetPreviewItems() {
  if (state.assetPreviewKey !== 'detailSetsPath' || state.assetTemplateFilter === 'all') return state.assetPreviewItems;
  return state.assetPreviewItems.filter(item => normalizeTemplateUiAction(item.action) === state.assetTemplateFilter);
}

function visibleAssetPreviewItems() {
  return filteredAssetPreviewItems().slice(0, 160);
}

function renderAssetTemplateFilters() {
  const filter = $('#assetTemplateFilter');
  const template = state.assetPreviewKey === 'detailSetsPath';
  filter.hidden = !template;
  if (!template) return;
  const counts = Object.fromEntries(ASSET_TEMPLATE_FILTERS.map(([value]) => [value, 0]));
  counts.all = state.assetPreviewItems.length;
  for (const item of state.assetPreviewItems) {
    const action = normalizeTemplateUiAction(item.action);
    if (counts[action] !== undefined) counts[action] += 1;
  }
  filter.querySelector('div').innerHTML = ASSET_TEMPLATE_FILTERS.map(([value, label]) => `<button class="asset-filter-button${state.assetTemplateFilter === value ? ' active' : ''}" type="button" data-asset-template-filter="${value}" aria-pressed="${state.assetTemplateFilter === value}"><span>${label}</span><b>${counts[value]}</b></button>`).join('');
}

function renderAssetManagementGrid() {
  const grid = $('#assetManagementGrid');
  const filtered = filteredAssetPreviewItems();
  const visible = filtered.slice(0, 160);
  const validPaths = new Set(state.assetPreviewItems.map(item => item.path));
  state.selectedAssetPaths = new Set([...state.selectedAssetPaths].filter(path => validPaths.has(path)));
  renderAssetTemplateFilters();
  if (state.assetPreviewKey === 'detailSetsPath' && state.assetTemplateFilter !== 'all') {
    $('#assetPreviewSummary').textContent = `当前显示 ${filtered.length} / ${state.assetPreviewItems.length} 张`;
  }
  grid.innerHTML = visible.length
    ? visible.map(item => {
      const selected = state.selectedAssetPaths.has(item.path);
      const template = state.assetPreviewKey === 'detailSetsPath';
      const actionLabel = ({ replace_print: '强制换印花', copy_original: '保留原图', exclude: '不输出', manual_check: '人工确认' })[normalizeTemplateUiAction(item.action)] || '待确认';
      const regionCount = Array.isArray(item.regions) ? item.regions.length : 0;
      const statusText = regionCount ? `已框选 ${regionCount} 个区域 · ${actionLabel}` : actionLabel;
      return `<article class="asset-management-card${selected ? ' selected' : ''}${template ? ' template-asset-card' : ''}" data-asset-path="${escapeHtml(item.path)}" title="${escapeHtml(item.path)}">
        <button class="asset-card-select" type="button" data-asset-select aria-pressed="${selected}"><span class="asset-select-mark">${selected ? '✓' : ''}</span><img loading="lazy" decoding="async" src="${escapeHtml(item.thumbnailUrl || item.url)}" data-preview-src="${escapeHtml(item.previewUrl || item.url)}" alt="${escapeHtml(item.name)}"><span class="asset-card-caption"><b>${escapeHtml(item.name)}</b><small>${escapeHtml(template && currentTemplateFolderView() === 'all' ? `${item.templateFolderName || '套图'} · ${item.folder}` : item.folder)}</small></span></button>
        ${template ? `<div class="asset-analysis-actions"><button class="secondary" type="button" data-template-result="${escapeHtml(item.path)}">框选区域</button></div><small class="asset-analysis-status manual">${escapeHtml(statusText)}</small>` : ''}
      </article>`;
    }).join('')
    : state.assetPreviewItems.length && state.assetPreviewKey === 'detailSetsPath'
      ? '<div class="empty-inline asset-empty-drop"><b>当前筛选没有图片</b><span>切换其他动作或选择“全部”。</span></div>'
      : '<div class="empty-inline asset-empty-drop"><b>拖入图片即可添加</b><span>也可以点击右上角“添加文件”。</span></div>';
  renderAssetSelectionState();
}

function resetAssetManagementScroll() {
  const grid = $('#assetManagementGrid');
  if (!grid) return;
  grid.scrollTop = 0;
  requestAnimationFrame(() => { grid.scrollTop = 0; });
}

async function refreshAssetConsumers(key) {
  if (key === 'categoriesPath') {
    state.productFolder = '';
    await loadAssets(key);
  } else if (key === 'printsPath') {
    state.printFolder = '';
    await loadAssets(key);
  } else {
    state.templatePreparation = null;
    await loadTemplateFolders();
    await loadTemplatePreparation();
  }
  renderSelection();
}

async function importAssetEntries(entries) {
  if (state.assetUploading || !entries?.length) return;
  const key = state.assetPreviewKey;
  const addButton = $('#addAssetFilesButton');
  state.assetUploading = true;
  addButton.disabled = true;
  addButton.textContent = '添加中…';
  $('#selectAllAssetsButton').disabled = true;
  $('#deleteSelectedAssetsButton').disabled = true;
  $('#assetPreviewSummary').textContent = `正在添加 ${entries.length} 张图片…`;
  try {
    const result = await window.caishen.addAssetFiles(key, state.config[key], entries);
    if (result.root !== state.config[key]) {
      state.config[key] = result.root;
      state.config = await window.caishen.saveConfig(state.config);
      renderConfig();
    }
    await refreshAssetConsumers(key);
    await loadAssetLibraryPreview(key, { preserveSelection: true, force: true });
    toast(`已添加 ${result.added} 张素材${result.skipped ? `，跳过 ${result.skipped} 个文件` : ''}`);
  } catch (error) {
    toast(errorText(error), true);
    await loadAssetLibraryPreview(key, { preserveSelection: true, force: true });
  } finally {
    state.assetUploading = false;
    addButton.disabled = false;
    addButton.textContent = '添加文件';
    renderAssetSelectionState();
  }
}

async function chooseAndAddAssetFiles() {
  if (state.assetPreviewKey === 'detailSetsPath' && currentTemplateFolderView() === 'all') return toast('请先选择一个具体套图文件夹，再添加图片', true);
  const entries = await window.caishen.chooseAssetFiles();
  if (entries.length) await importAssetEntries(entries);
}

async function deleteSelectedAssets() {
  const paths = [...state.selectedAssetPaths];
  if (!paths.length) return toast('请先选择需要删除的素材', true);
  if (!await brandConfirm(`确定删除选中的 ${paths.length} 张素材吗？此操作会删除主电脑工作区中的图片。`, { title: '删除素材', danger: true, confirmText: '删除' })) return;
  const key = state.assetPreviewKey;
  const button = $('#deleteSelectedAssetsButton');
  button.disabled = true;
  button.textContent = '删除中…';
  $('#selectAllAssetsButton').disabled = true;
  try {
    let deleted = 0;
    if (key === 'detailSetsPath') {
      const groups = new Map();
      for (const item of state.assetPreviewItems.filter(item => state.selectedAssetPaths.has(item.path))) {
        const root = templateFolderPathForItem(item);
        if (!groups.has(root)) groups.set(root, []);
        groups.get(root).push(item.path);
      }
      for (const [root, groupPaths] of groups) {
        const result = await window.caishen.deleteAssetFiles(key, root, groupPaths);
        deleted += Number(result.deleted || 0);
      }
    } else {
      const result = await window.caishen.deleteAssetFiles(key, state.config[key], paths);
      deleted = Number(result.deleted || 0);
    }
    if (state.selectedProduct && state.selectedAssetPaths.has(state.selectedProduct.path)) state.selectedProduct = null;
    if (state.selectedPrint && state.selectedAssetPaths.has(state.selectedPrint.path)) state.selectedPrint = null;
    state.selectedAssetPaths.clear();
    await refreshAssetConsumers(key);
    await loadAssetLibraryPreview(key, { force: true });
    toast(`已删除 ${deleted} 张素材`);
  } catch (error) {
    toast(errorText(error), true);
  } finally {
    button.textContent = '删除选中';
    renderAssetSelectionState();
  }
}

async function loadAssetLibraryPreview(key = 'printsPath', { preserveSelection = false, force = false } = {}) {
  if (!state.config) return;
  if (!['printsPath', 'detailSetsPath'].includes(key)) key = 'printsPath';
  const previousKey = state.assetPreviewKey;
  const shouldResetScroll = key !== previousKey || force || !preserveSelection;
  if (key !== previousKey || !preserveSelection) state.selectedAssetPaths.clear();
  state.assetPreviewKey = key;
  const loadId = ++state.assetPreviewLoadId;
  const labels = { printsPath: '印花素材', detailSetsPath: '套图模板' };
  $$('.asset-preview-tabs [data-asset-preview]').forEach(button => {
    const active = button.dataset.assetPreview === key;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  $$('[data-asset-source]').forEach(panel => { panel.hidden = panel.dataset.assetSource !== key; });
  $('#assetPreviewTitle').textContent = labels[key] || '素材内容';
  const grid = $('#assetManagementGrid');
  if (shouldResetScroll) resetAssetManagementScroll();
  const previewSize = state.assetPreviewSizes[key] || 138;
  $('#assetManagementPreviewSize').value = String(previewSize);
  grid.style.setProperty('--asset-management-card-size', `${previewSize}px`);
  const templateView = key === 'detailSetsPath' ? currentTemplateFolderView() : '';
  const root = key === 'detailSetsPath'
    ? templateView === 'all' ? `all:${state.templateFolders.map(folder => folder.path).join('|')}` : templateView
    : state.config[key];
  if (!root) {
    state.assetPreviewItems = [];
    state.assetPreviewCache.set(key, { root: '', items: state.assetPreviewItems });
    $('#assetPreviewSummary').textContent = '尚未配置素材库';
    renderAssetManagementGrid();
    return;
  }
  const cached = state.assetPreviewCache.get(key);
  if (!force && cached?.root === root) {
    const alreadyRendered = previousKey === key
      && state.assetPreviewItems === cached.items
      && grid.childElementCount > 0
      && !grid.querySelector('.empty-inline');
    state.assetPreviewItems = cached.items;
    if (key === 'detailSetsPath') state.templateItems = cached.items;
    const visible = cached.items.slice(0, 160);
    $('#assetPreviewSummary').textContent = `${key === 'detailSetsPath' && templateView === 'all' ? `${state.templateFolders.length} 个文件夹 · ` : ''}共 ${cached.items.length} 张${cached.items.length > visible.length ? `，当前显示前 ${visible.length} 张` : ''}`;
    if (alreadyRendered) renderAssetSelectionState();
    else renderAssetManagementGrid();
    return;
  }
  grid.innerHTML = '<div class="empty-inline">正在读取素材…</div>';
  try {
    const items = key === 'detailSetsPath'
      ? await listTemplateItemsForCurrentView()
      : await window.caishen.listImages(root, '');
    state.assetPreviewCache.set(key, { root, items });
    if (loadId !== state.assetPreviewLoadId || state.assetPreviewKey !== key) return;
    state.assetPreviewItems = items;
    if (key === 'detailSetsPath') state.templateItems = items;
    if (currentPage !== 'assets') return;
    const visible = items.slice(0, 160);
    $('#assetPreviewSummary').textContent = `${key === 'detailSetsPath' && templateView === 'all' ? `${state.templateFolders.length} 个文件夹 · ` : ''}共 ${items.length} 张${items.length > visible.length ? `，当前显示前 ${visible.length} 张` : ''}`;
    renderAssetManagementGrid();
  } catch (error) {
    if (loadId !== state.assetPreviewLoadId || state.assetPreviewKey !== key || currentPage !== 'assets') return;
    $('#assetPreviewSummary').textContent = '读取失败';
    grid.innerHTML = `<div class="empty-inline">${escapeHtml(errorText(error))}</div>`;
    renderAssetSelectionState();
  }
}

async function loadAssets(key, query = '') {
  const isProduct = key === 'categoriesPath';
  const grid = $(isProduct ? '#productGrid' : '#printGrid');
  grid.innerHTML = '<div class="empty-inline">正在扫描素材…</div>';
  try {
    const items = await window.caishen.listImages(state.config[key], query);
    if (isProduct) state.products = items; else state.prints = items;
    renderAssets(isProduct ? 'product' : 'print');
  } catch (error) {
    grid.innerHTML = `<div class="empty-inline">${escapeHtml(errorText(error))}</div>`;
  }
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>'"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
}

function normalizedRelativePath(value = '') {
  return String(value || '').replaceAll('\\', '/').toLocaleLowerCase('zh-CN');
}

function reviewRegenerationReferenceCandidates(item, currentJob) {
  const current = normalizedRelativePath(currentJob?.relativePath);
  return (item?.jobs || [])
    .filter(job => job?.outputUrl && normalizedRelativePath(job.relativePath) !== current)
    .filter(job => {
      const action = normalizeTemplateUiAction(job.action);
      return action !== 'exclude' && action !== 'copy_original';
    })
    .map(job => ({
      relativePath: job.relativePath,
      outputUrl: job.outputUrl,
      status: job.status || ''
    }));
}

function closeReviewRegenerationDialog(result = null) {
  const dialog = state.reviewRegenerationDialog;
  if (!dialog) return;
  state.reviewRegenerationDialog = null;
  dialog.element.remove();
  dialog.resolve(result);
}

function openReviewRegenerationDialog(item, job) {
  if (state.reviewRegenerationDialog) closeReviewRegenerationDialog(null);
  const candidates = reviewRegenerationReferenceCandidates(item, job);
  const element = document.createElement('div');
  element.className = 'review-regenerate-modal-backdrop';
  element.innerHTML = `<section class="review-regenerate-modal" role="dialog" aria-modal="true" aria-labelledby="reviewRegenerateTitle">
    <header>
      <div><span>多嘻噜卡科技</span><h2 id="reviewRegenerateTitle">重新生成图片</h2><p>当前图片：${escapeHtml(job.relativePath)}</p></div>
      <button class="icon-button" type="button" data-review-regenerate-close aria-label="关闭">×</button>
    </header>
    <div class="review-regenerate-body">
      <label class="review-regenerate-field"><b>本次额外要求</b><textarea data-review-regenerate-note rows="4" placeholder="例如：印花只能覆盖柜门面板，不能盖住黑色边框、台面、侧板、柜脚和场景物品。"></textarea></label>
      <label class="review-regenerate-check"><input type="checkbox" data-review-regenerate-previous ${job.outputUrl ? '' : 'disabled'}>参考当前这张不合格结果，只修正问题</label>
      <div class="review-regenerate-reference">
        <div><b>可选参考结果图</b><span>选择一张已经生成的效果图，只参考印花落位和柜体结构，不复制它的构图或尺寸。</span></div>
        <div class="review-regenerate-reference-list">
          <label class="review-regenerate-reference-card selected">
            <input type="radio" name="review-regenerate-reference" value="" checked>
            <span>不使用其他参考图</span>
          </label>
          ${candidates.map(candidate => `<label class="review-regenerate-reference-card">
            <input type="radio" name="review-regenerate-reference" value="${escapeHtml(candidate.relativePath)}">
            <img src="${escapeHtml(candidate.outputUrl)}" data-preview-src="${escapeHtml(candidate.outputUrl)}" alt="${escapeHtml(candidate.relativePath)} 参考结果">
            <span><b>${escapeHtml(candidate.relativePath)}</b><small>${escapeHtml(candidate.status || '已生成')}</small></span>
          </label>`).join('')}
        </div>
      </div>
      <p class="review-regenerate-note">基础输入仍固定为套图原图、母版图、印花原图、红框标注图；所选结果图只作为追加参考。</p>
    </div>
    <footer><button class="secondary" type="button" data-review-regenerate-cancel>取消</button><button class="primary" type="button" data-review-regenerate-submit>提交重新生成</button></footer>
  </section>`;
  document.body.appendChild(element);
  const promise = new Promise(resolve => { state.reviewRegenerationDialog = { element, resolve }; });
  element.addEventListener('click', event => {
    if (event.target === element || event.target.closest('[data-review-regenerate-close], [data-review-regenerate-cancel]')) {
      closeReviewRegenerationDialog(null);
      return;
    }
    const card = event.target.closest('.review-regenerate-reference-card');
    if (card) {
      element.querySelectorAll('.review-regenerate-reference-card').forEach(item => item.classList.remove('selected'));
      card.classList.add('selected');
      const input = card.querySelector('input[type="radio"]');
      if (input) input.checked = true;
    }
    if (event.target.closest('[data-review-regenerate-submit]')) {
      const reference = element.querySelector('input[name="review-regenerate-reference"]:checked')?.value || '';
      closeReviewRegenerationDialog({
        extraInstruction: element.querySelector('[data-review-regenerate-note]')?.value || '',
        includePreviousResult: Boolean(element.querySelector('[data-review-regenerate-previous]')?.checked),
        referenceResultRelativePath: reference
      });
    }
  });
  return promise;
}

function renderAssetFolders(type, items) {
  const isProduct = type === 'product';
  const selectedFolder = isProduct ? state.productFolder : state.printFolder;
  const folders = [...new Set(items.map(item => item.folder).filter(folder => folder && folder !== '根目录'))]
    .sort((left, right) => (isProduct || state.printSort !== 'name-desc' ? 1 : -1) * left.localeCompare(right, 'zh-CN', { numeric: true }));
  const list = $(isProduct ? '#productFolderList' : '#printFolderList');
  list.innerHTML = [`<button class="asset-folder-button${selectedFolder ? '' : ' active'}" data-asset-folder="" data-folder-type="${type}">全部素材</button>`, ...folders.map(folder => `<button class="asset-folder-button${selectedFolder === folder ? ' active' : ''}" data-asset-folder="${escapeHtml(folder)}" data-folder-type="${type}" title="${escapeHtml(folder)}">${escapeHtml(folder)}</button>`)].join('');
  $(isProduct ? '#productFolderLabel' : '#printFolderLabel').textContent = selectedFolder || '全部文件夹';
}

function renderAssets(type) {
  const isProduct = type === 'product';
  const allItems = isProduct ? state.products : state.prints;
  const selectedFolder = isProduct ? state.productFolder : state.printFolder;
  const matchingItems = selectedFolder ? allItems.filter(item => item.folder === selectedFolder || item.folder.startsWith(`${selectedFolder}/`)) : allItems;
  const items = sortByName(matchingItems, isProduct ? 'name-asc' : state.printSort, item => item.name).slice(0, 240);
  const selected = isProduct ? state.selectedProduct : state.selectedPrint;
  const grid = $(isProduct ? '#productGrid' : '#printGrid');
  renderAssetFolders(type, allItems);
  if (!items.length) {
    grid.innerHTML = `<div class="empty-inline">${state.config[isProduct ? 'categoriesPath' : 'printsPath'] ? '没有找到支持的图片' : '先选择素材文件夹'}</div>`;
    return;
  }
  grid.innerHTML = items.map(item => `<button class="asset-card${selected?.path === item.path ? ' selected' : ''}" data-type="${type}" data-index="${allItems.indexOf(item)}" title="${escapeHtml(item.path)}"><img loading="lazy" decoding="async" src="${escapeHtml(item.thumbnailUrl || item.url)}" data-preview-src="${escapeHtml(item.previewUrl || item.url)}" alt="${escapeHtml(item.name)}"><span>${escapeHtml(item.name)}</span></button>`).join('')
    + (matchingItems.length > items.length ? `<div class="empty-inline">当前显示前 ${items.length} 张，请使用搜索或左侧文件夹缩小范围。</div>` : '');
}

function renderSelection() {
  $('#selectedProduct').innerHTML = `<span>款式</span><b>${escapeHtml(state.selectedProduct?.name || '未选择')}</b>`;
  $('#selectedPrint').innerHTML = `<span>印花</span><b>${escapeHtml(state.selectedPrint?.name || '未选择')}</b>`;
  renderTemplateWorkflow();
}

function updateGenerationModeUi() {
  const direct = $('#generationMode').value === 'template_print';
  $('.task-layout').classList.toggle('template-print-mode', direct);
  $('#generationModeHint').textContent = direct
    ? '母版任务卡生成完成后，可直接开始对应套图文件夹的整套任务。'
    : '先生成母版图，再到人工筛图生成套图。';
  $('#addTaskButton').textContent = direct ? '按母版卡生成整套任务' : '加入排队任务';
  renderTemplateWorkflow();
}

function addTask(silent = false) {
  const generationMode = $('#generationMode').value;
  if (!state.selectedPrint) return toast('请先选择印花图', true);
  if (generationMode === 'master' && !state.selectedProduct) return toast('母版模式需要先选择款式图', true);
  if (!state.config.detailSetsPath) return toast('请先选择套图文件夹', true);
  const baseTaskNumber = state.queue.reduce((maximum, task) => Math.max(maximum, Number(task.taskNumber) || 0), 0) + 1;
  const batchId = createClientId();
  const note = $('#taskNote').value.trim();
  const common = {
    printPath: state.selectedPrint.path,
    printName: state.selectedPrint.name,
    printThumbnailUrl: state.selectedPrint.thumbnailUrl || state.selectedPrint.url || '',
    printPreviewUrl: state.selectedPrint.previewUrl || state.selectedPrint.url || '',
    generationMode,
    note,
    selected: true,
    status: '未开始',
    error: ''
  };
  let tasks = [];
  if (generationMode === 'template_print') {
    const readyCandidates = state.templateMasterCandidates.filter(candidate => candidate.printPath === state.selectedPrint.path && templateMasterCandidateHasImage(candidate));
    if (readyCandidates.length === 1) return createTemplateTasksFromMasterCandidate(readyCandidates[0].id, { silent });
    if (readyCandidates.length > 1) return toast('请在对应母版任务卡里点击“开始生成整套”', true);
    return toast('请先创建并生成一张母版任务卡', true);
  } else {
    tasks = [{
      ...common,
      id: createClientId(),
      taskNumber: baseTaskNumber,
      productPath: state.selectedProduct?.path || '',
      productName: state.selectedProduct?.name || '模板原款',
      productThumbnailUrl: state.selectedProduct?.thumbnailUrl || state.selectedProduct?.url || '',
      productPreviewUrl: state.selectedProduct?.previewUrl || state.selectedProduct?.url || '',
      templateFolderPath: state.config.detailSetsPath || '',
      templatePreviewName: state.templatePreparation?.preview?.name || '',
      templateThumbnailUrl: state.templatePreparation?.preview?.thumbnailUrl || '',
      templatePreviewUrl: state.templatePreparation?.preview?.previewUrl || state.templatePreparation?.preview?.url || ''
    }];
  }
  if (!tasks.length) return toast('这些套图与印花已经在待生成列表中', true);
  state.queue.push(...tasks);
  if (tasks[0]?.generationMode === 'template_print') state.queueGroupExpanded.add(queueGroupKey(tasks[0]));
  $('#taskNote').value = '';
  renderQueue();
  if (!silent) toast(`已加入 ${tasks.length} 个待生成任务`);
  return tasks.length;
}

function createTemplateTasksFromMasterCandidate(candidateId, { silent = false } = {}) {
  const candidate = state.templateMasterCandidates.find(item => item.id === candidateId);
  if (!candidate) return toast('母版候选不存在', true);
  if (!templateMasterCandidateHasImage(candidate)) return toast('请先生成这张母版图', true);
  const candidateFolder = candidate.templateFolderPath || currentTaskTemplateFolderView();
  const templates = state.taskTemplateItems.filter(item => item.action === 'replace_print' && templateFolderPathForItem(item) === candidateFolder);
  if (!templates.length) return toast('当前套图范围内没有需要换印花的图片', true);
  const existing = new Set(state.queue.map(task => `${task.templateFolderPath}|${task.templateRelativePath || ''}|${task.printPath}|${task.masterCandidateId || task.masterImagePath || ''}`));
  const batchId = createClientId();
  const note = $('#taskNote').value.trim();
  const baseTaskNumber = state.queue.reduce((maximum, task) => Math.max(maximum, Number(task.taskNumber) || 0), 0) + 1;
  const tasks = templates.filter(item => !existing.has(`${templateFolderPathForItem(item)}|${item.relativePath}|${candidate.printPath}|${candidate.id}`)).map((item, index) => ({
    printPath: candidate.printPath,
    printName: candidate.printName,
    printThumbnailUrl: candidate.printThumbnailUrl || '',
    printPreviewUrl: candidate.printPreviewUrl || '',
    generationMode: 'template_print',
    note,
    selected: true,
    status: '未开始',
    error: '',
    masterCandidateId: candidate.id,
    masterReferencePath: candidate.masterReferencePath || '',
    masterReferenceName: candidate.masterReferenceName || '',
    masterReferenceThumbnailUrl: candidate.masterReferenceThumbnailUrl || '',
    masterReferencePreviewUrl: candidate.masterReferencePreviewUrl || '',
    masterReferenceRelativePath: candidate.masterReferenceRelativePath || '',
    masterImagePath: candidate.masterImagePath || '',
    masterImageUrl: candidate.masterImageUrl || '',
    masterImagePreviewUrl: candidate.masterImagePreviewUrl || '',
    masterStatus: candidate.masterStatus || '已生成',
    masterError: '',
    masterProgress: null,
    id: createClientId(),
    batchId,
    taskNumber: baseTaskNumber + index,
    productPath: '',
    productName: item.name,
    productThumbnailUrl: item.thumbnailUrl || item.url || '',
    productPreviewUrl: item.previewUrl || item.url || '',
    templateFolderPath: templateFolderPathForItem(item),
    templateRelativePath: item.relativePath,
    templatePreviewName: item.name,
    templateThumbnailUrl: item.thumbnailUrl || item.url || '',
    templatePreviewUrl: item.previewUrl || item.url || ''
  }));
  if (!tasks.length) return toast('这张母版图对应的整套任务已经在待生成列表中', true);
  state.queue.push(...tasks);
  state.queueGroupExpanded.add(queueGroupKey(tasks[0]));
  $('#taskNote').value = '';
  renderQueue();
  if (!silent) toast(`已用母版图创建 ${tasks.length} 个整套任务`);
  return tasks.length;
}

async function ensureTaskTemplateItemsForCandidate(candidate) {
  const folder = candidate?.templateFolderPath || '';
  if (!folder) return;
  const hasFolderItems = state.taskTemplateItems.some(item => templateFolderPathForItem(item) === folder);
  if (hasFolderItems) return;
  state.taskTemplateItems = await window.caishen.listTemplates(folder);
  state.taskTemplateFolderView = folder;
  syncTaskTemplateSelection({ reset: true });
}

function selectQueueTasksForMasterCandidates(candidateIds) {
  const ids = new Set(Array.isArray(candidateIds) ? candidateIds : [candidateIds]);
  let selected = 0;
  state.queue.forEach(task => {
    const match = ids.has(task.masterCandidateId) && task.status !== '已完成';
    task.selected = match;
    if (match) selected += 1;
  });
  return selected;
}

async function startTemplateSetFromMasterCandidate(candidateId) {
  const candidate = state.templateMasterCandidates.find(item => item.id === candidateId);
  if (!candidate) return toast('母版任务不存在', true);
  if (!templateMasterCandidateHasImage(candidate)) return toast('请先生成母版图', true);
  await ensureTaskTemplateItemsForCandidate(candidate);
  createTemplateTasksFromMasterCandidate(candidateId, { silent: true });
  const selected = selectQueueTasksForMasterCandidates(candidateId);
  renderQueue();
  if (!selected) return toast('这张母版对应的整套任务已生成完成，去人工筛图查看结果', true);
  await generateQueue({ redirectOnStart: true });
}

async function startTemplateSetsFromAllMasters() {
  const selectedMasters = selectedTemplateMasterCandidates();
  if (!selectedMasters.length) return toast('请先勾选要开始的母版任务', true);
  const ready = selectedMasters.filter(templateMasterCandidateHasImage);
  if (!ready.length) return toast('选中的任务还没有已生成母版图', true);
  for (const candidate of ready) {
    await ensureTaskTemplateItemsForCandidate(candidate);
    createTemplateTasksFromMasterCandidate(candidate.id, { silent: true });
  }
  const selectedTasks = selectQueueTasksForMasterCandidates(ready.map(candidate => candidate.id));
  renderQueue();
  if (!selectedTasks) return toast('全部已生成母版对应的整套任务都已完成', true);
  await generateQueue({ notifyOnStart: true });
}

async function generateAllTemplateMasterCandidates() {
  const selected = selectedTemplateMasterCandidates();
  if (!selected.length) return toast('请先勾选要生成的母版任务', true);
  await runClientConcurrency(selected, await apiBatchConcurrencyLimit(selected.length), refreshTemplateMasterReference);
  const runnable = selected.filter(candidate =>
    candidate.masterReferencePath
    && candidate.printPath
    && !['生成中', '重新生成'].includes(candidate.masterStatus)
  );
  if (!runnable.length) return toast('没有可生成的母版任务卡', true);
  await runClientConcurrency(runnable, await apiBatchConcurrencyLimit(runnable.length), candidate => generateTemplateMasterCandidate(candidate.id));
}

async function apiBatchConcurrencyLimit(total = Infinity) {
  if (!state.apiConcurrencySettings) {
    try {
      state.apiConcurrencySettings = await window.caishen.getApiConcurrencySettings();
    } catch {
      state.apiConcurrencySettings = { imageInitialConcurrency: 8, imageMaxConcurrency: 8, imageStartIntervalMs: 500 };
    }
  }
  const configured = Number(state.apiConcurrencySettings?.imageMaxConcurrency);
  const max = Math.min(20000, Math.max(1, Math.trunc(Number.isFinite(configured) ? configured : 8)));
  const count = Number(total);
  return Number.isFinite(count) ? Math.min(max, Math.max(1, Math.trunc(count))) : max;
}

async function runClientConcurrency(items, limit, worker) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return [];
  const results = new Array(list.length);
  let cursor = 0;
  async function run() {
    while (cursor < list.length) {
      const index = cursor++;
      results[index] = await worker(list[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, Number(limit) || 1), list.length) }, run));
  return results;
}

function queueTaskPreviews(task) {
  const print = state.prints.find(item => item.path === task.printPath);
  const product = state.products.find(item => item.path === task.productPath);
  const currentTemplate = task.templateFolderPath === state.templatePreparation?.folder
    ? state.templatePreparation?.preview : null;
  const templateMode = task.generationMode === 'template_print';
  return {
    sourceName: templateMode
      ? task.templatePreviewName || currentTemplate?.name || '套图模板'
      : task.productName || product?.name || '款式图',
    sourceThumbnailUrl: templateMode
      ? task.templateThumbnailUrl || currentTemplate?.thumbnailUrl || ''
      : task.productThumbnailUrl || product?.thumbnailUrl || product?.url || '',
    sourcePreviewUrl: templateMode
      ? task.templatePreviewUrl || currentTemplate?.previewUrl || currentTemplate?.url || ''
      : task.productPreviewUrl || product?.previewUrl || product?.url || '',
    printThumbnailUrl: task.printThumbnailUrl || print?.thumbnailUrl || print?.url || '',
    printPreviewUrl: task.printPreviewUrl || print?.previewUrl || print?.url || ''
  };
}

function queuePreviewFigure(url, previewUrl, name, label) {
  const content = url
    ? `<img loading="lazy" decoding="async" src="${escapeHtml(url)}" data-preview-src="${escapeHtml(previewUrl || url)}" alt="${escapeHtml(name)}">`
    : `<span class="queue-preview-placeholder">${escapeHtml(label)}</span>`;
  return `<figure class="queue-preview-figure">${content}<figcaption>${escapeHtml(label)}</figcaption></figure>`;
}

function queueGroupKey(task) {
  return task.generationMode === 'template_print' && task.batchId && task.templateRelativePath
    ? `batch:${task.batchId}:${task.templateFolderPath}`
    : `task:${task.id}`;
}

function queueGroupTitle(tasks) {
  const folder = tasks.find(item => item.result?.folder)?.result?.folder
    || tasks.find(item => item.progress?.folder)?.progress?.folder
    || '';
  if (folder) return shortPath(folder);
  const firstNumber = Math.min(...tasks.map(item => Number(item.taskNumber) || 0).filter(Boolean));
  if (Number.isFinite(firstNumber)) return `批量任务 ${String(firstNumber).padStart(4, '0')}`;
  return tasks[0]?.printName || '批量任务';
}

function queueGroupStatus(tasks) {
  const running = tasks.filter(task => ['排队中', '生成中'].includes(task.status)).length;
  const failed = tasks.filter(task => task.status === '失败').length;
  const completed = tasks.filter(task => task.status === '已完成').length;
  if (running) return '任务进行中';
  if (failed) return '有失败';
  if (completed === tasks.length) return '已完成';
  return '未开始';
}

function renderQueueItem(task, index) {
  const previews = queueTaskPreviews(task);
  const progress = task.progress || {};
  const summary = task.result?.summary || {};
  const total = Math.max(0, Number(progress.total) || 0);
  const current = Math.max(0, Number(progress.current) || 0);
  const percent = total ? Math.min(100, Math.round(current / total * 100)) : Math.max(0, Number(progress.percent) || 0);
  const completedSummary = task.status === '已完成' && Number(summary.total)
    ? task.templateRelativePath ? '当前套图生成完成' : `API 生成 ${summary.apiGenerated || 0} · 直接复制 ${summary.copied || 0} · 跳过 ${summary.skipped || 0}`
    : '';
  const progressMarkup = ['排队中', '生成中'].includes(task.status)
    ? `<div class="queue-progress"><div><span>${escapeHtml(progress.message || (task.status === '排队中' ? '等待服务器处理' : '正在处理…'))}</span><b>${total ? `${current}/${total}` : `${percent}%`}</b></div><progress max="100" value="${percent}"></progress></div>`
    : completedSummary ? `<div class="queue-result-summary">${escapeHtml(completedSummary)}</div>` : '';
  const previewPair = task.generationMode === 'template_print'
    ? `<div class="queue-preview-pair">${queuePreviewFigure(task.masterImageUrl || task.masterImagePreviewUrl || '', task.masterImagePreviewUrl || task.masterImageUrl || '', task.masterImagePath ? '已生成母版' : '未生成母版', '母版图')}<span class="queue-preview-plus" aria-hidden="true">+</span>${queuePreviewFigure(previews.sourceThumbnailUrl, previews.sourcePreviewUrl, previews.sourceName, '套图页')}</div>`
    : `<div class="queue-preview-pair">${queuePreviewFigure(previews.sourceThumbnailUrl, previews.sourcePreviewUrl, previews.sourceName, '款式')}<span class="queue-preview-plus" aria-hidden="true">+</span>${queuePreviewFigure(previews.printThumbnailUrl, previews.printPreviewUrl, task.printName, '印花')}</div>`;
  const templateControl = task.templateRelativePath ? '' : `<div class="queue-template-row"><span>已选择套图</span><button class="secondary" data-queue-template-index="${index}">更换套图</button></div>`;
  return `<div class="queue-item" data-queue-index="${index}"><div class="queue-item-head"><input type="checkbox" aria-label="选择任务 ${index + 1}" title="勾选后参与批量操作" data-queue-select="${index}"${task.selected ? ' checked' : ''}><b>${String(index + 1).padStart(2, '0')} · ${escapeHtml(task.productName)}</b><button class="queue-delete-button" type="button" data-queue-delete="${index}"${task.status === '生成中' ? ' disabled title="生成中的任务暂不能删除"' : ''}>删除</button></div><div class="queue-item-body">${previewPair}<div class="queue-item-copy"><span>${task.generationMode === 'template_print' ? '按人工框选区域换印花' : '母版生成'}</span>${templateControl}${progressMarkup}<span class="status${task.status === '失败' ? ' error' : ''}">${escapeHtml(task.error || task.status)}</span></div></div></div>`;
}

function renderQueue() {
  persistQueue();
  const list = $('#queueList');
  $('#queueCount').textContent = `${state.queue.length} 项`;
  $('#queueManageDetails').hidden = state.queue.length === 0;
  if (!state.queue.length) {
    list.innerHTML = '<div class="empty-inline">选择套图文件夹或单张图片，再点击印花创建任务。</div>';
    renderTemplateWorkflow();
    return;
  }
  const groups = new Map();
  state.queue.forEach((task, index) => {
    const key = queueGroupKey(task);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ task, index });
  });
  list.innerHTML = [...groups.entries()].map(([key, entries]) => {
    if (entries.length === 1) return renderQueueItem(entries[0].task, entries[0].index);
    const tasks = entries.map(entry => entry.task);
    const expanded = state.queueGroupExpanded.has(key);
    const selectedCount = tasks.filter(task => task.selected).length;
    const runningCount = tasks.filter(task => ['排队中', '生成中'].includes(task.status)).length;
    const completedCount = tasks.filter(task => task.status === '已完成').length;
    const failedCount = tasks.filter(task => task.status === '失败').length;
    const progress = tasks.find(task => task.progress?.total)?.progress || {};
    const total = Math.max(tasks.length, Number(progress.total) || 0);
    const current = Math.max(0, Number(progress.current) || completedCount || 0);
    const percent = total ? Math.min(100, Math.round(current / total * 100)) : 0;
    const details = expanded ? `<div class="queue-group-items">${entries.map(entry => renderQueueItem(entry.task, entry.index)).join('')}</div>` : '';
    return `<section class="queue-group${expanded ? ' expanded' : ''}" data-queue-group="${escapeHtml(key)}"><div class="queue-group-head"><input type="checkbox" aria-label="选择整组任务" data-queue-group-select="${escapeHtml(key)}"${selectedCount === tasks.length ? ' checked' : ''}><button type="button" class="queue-group-toggle" data-queue-group-toggle="${escapeHtml(key)}" aria-expanded="${expanded}"><span>${expanded ? '▾' : '▸'}</span><b>${escapeHtml(queueGroupTitle(tasks))}</b><small>${escapeHtml(queueGroupStatus(tasks))} · ${tasks.length} 张</small></button></div><div class="queue-group-summary"><span>处理中 ${runningCount}/${tasks.length}</span><span>完成 ${completedCount}</span><span>失败 ${failedCount}</span></div><progress max="100" value="${percent}"></progress>${details}</section>`;
  }).join('');
  renderTemplateWorkflow();
}

function deleteQueueTask(index) {
  const task = state.queue[index];
  if (!task) return;
  if (task.status === '生成中') return toast('任务正在生成，完成后才能删除', true);
  state.queue.splice(index, 1);
  renderQueue();
  toast(`已删除任务：${task.printName || task.productName}`);
}

async function applyCurrentTemplateFolderToQueue(selectedOnly) {
  try {
    let folder = state.config?.detailSetsPath || '';
    if (!folder) {
      const selected = await window.caishen.chooseFolder('', 'detailSetsPath');
      if (!selected) return;
      state.config.detailSetsPath = selected;
      state.config = await window.caishen.saveConfig(state.config);
      renderConfig();
      folder = state.config.detailSetsPath || selected;
      await loadTemplatePreparation({ autoPrepare: true });
    }
    const tasks = selectedOnly ? state.queue.filter(task => task.selected) : state.queue;
    if (!tasks.length) return toast(selectedOnly ? '请先勾选要套用的任务' : '当前没有任务', true);
    for (const task of tasks) {
      task.templateFolderPath = folder;
      task.templatePreviewName = state.templatePreparation?.preview?.name || '';
      task.templateThumbnailUrl = state.templatePreparation?.preview?.thumbnailUrl || '';
      task.templatePreviewUrl = state.templatePreparation?.preview?.previewUrl || state.templatePreparation?.preview?.url || '';
      if (task.generationMode === 'template_print') resetTaskMaster(task);
    }
    renderQueue();
    toast(`已将当前套图套用到${selectedOnly ? '选中' : '全部'} ${tasks.length} 个任务`);
  } catch (error) {
    toast(errorText(error), true);
  }
}

async function changeQueueTaskTemplate(index) {
  const task = state.queue[index];
  if (!task) return;
  try {
    const selected = await window.caishen.chooseFolder(task.templateFolderPath || state.config?.detailSetsPath || '', 'detailSetsPath');
    if (!selected) return;
    task.templateFolderPath = selected;
    state.config.detailSetsPath = selected;
    state.templatePreparation = null;
    state.config = await window.caishen.saveConfig(state.config);
    renderConfig();
    await loadTemplatePreparation({ autoPrepare: true });
    await loadTemplateFolders();
    task.templatePreviewName = state.templatePreparation?.preview?.name || '';
    task.templateThumbnailUrl = state.templatePreparation?.preview?.thumbnailUrl || '';
    task.templatePreviewUrl = state.templatePreparation?.preview?.previewUrl || state.templatePreparation?.preview?.url || '';
    if (task.generationMode === 'template_print') resetTaskMaster(task);
    renderQueue();
    toast(`任务 ${String(task.taskNumber || index + 1).padStart(4, '0')} 已更换套图`);
  } catch (error) {
    toast(errorText(error), true);
  }
}

async function generateQueueTaskMaster(index) {
  const task = state.queue[index];
  if (!task || task.generationMode !== 'template_print') return;
  if (!task.printPath) return toast('请先选择印花图', true);
  if (!task.masterReferencePath) {
    if (!task.masterReferencePath) return toast('没有找到可用于生成母版的参考图', true);
  }
  task.masterRunAttempt = Math.max(0, Number(task.masterRunAttempt) || 0) + 1;
  task.masterStatus = task.masterImagePath ? '重新生成' : '生成中';
  task.masterError = '';
  task.masterProgress = { phase: 'queued', percent: 0, message: '等待生成母版图' };
  syncTaskMasterToRelatedTasks(task);
  renderQueue();
  try {
    const result = await window.caishen.generateTemplateMaster(task, progress => {
      task.masterProgress = { ...(task.masterProgress || {}), ...(progress || {}) };
      task.masterStatus = task.masterImagePath ? '重新生成' : '生成中';
      syncTaskMasterToRelatedTasks(task);
      renderQueue();
    });
    task.masterImagePath = result?.outputPath || '';
    task.masterImageUrl = result?.url || '';
    task.masterImagePreviewUrl = result?.url || '';
    task.masterReferencePath = result?.referencePath || task.masterReferencePath || '';
    task.masterReferenceName = result?.referenceName || task.masterReferenceName || '';
    task.masterStatus = '已生成';
    task.masterError = '';
    task.masterProgress = { ...(task.masterProgress || {}), phase: 'completed', percent: 100, message: '母版图生成完成' };
    syncTaskMasterToRelatedTasks(task);
    renderQueue();
    toast('母版图已生成，可开始正式生成');
  } catch (error) {
    task.masterStatus = task.masterImagePath ? '已生成' : '未生成';
    task.masterError = errorText(error);
    task.masterProgress = { ...(task.masterProgress || {}), phase: 'failed', message: task.masterError };
    syncTaskMasterToRelatedTasks(task);
    renderQueue();
    toast(task.masterError, true);
  }
}

async function generateTemplateMasterCandidate(candidateId) {
  const candidate = state.templateMasterCandidates.find(item => item.id === candidateId);
  if (!candidate) return toast('母版候选不存在', true);
  if (!candidate.printPath) return toast('请先选择印花图', true);
  await refreshTemplateMasterReference(candidate);
  if (!candidate.masterReferencePath) return toast('请先选择母版底图', true);
  candidate.masterRunAttempt = Math.max(0, Number(candidate.masterRunAttempt) || 0) + 1;
  candidate.masterStatus = candidate.masterImagePath ? '重新生成' : '生成中';
  candidate.masterError = '';
  candidate.masterProgress = { phase: 'queued', percent: 0, message: '等待生成母版图' };
  persistTemplateMasterCandidates();
  renderTemplateWorkflow();
  try {
    const result = await window.caishen.generateTemplateMaster(candidate, progress => {
      candidate.masterProgress = { ...(candidate.masterProgress || {}), ...(progress || {}) };
      candidate.masterStatus = candidate.masterImagePath ? '重新生成' : '生成中';
      persistTemplateMasterCandidates();
      renderTemplateWorkflow();
    });
    candidate.masterImagePath = result?.outputPath || '';
    candidate.masterImageUrl = result?.url || '';
    candidate.masterImagePreviewUrl = result?.url || '';
    candidate.masterReferencePath = result?.referencePath || candidate.masterReferencePath || '';
    candidate.masterReferenceName = result?.referenceName || candidate.masterReferenceName || '';
    candidate.masterStatus = '已生成';
    candidate.masterError = '';
    candidate.masterProgress = { ...(candidate.masterProgress || {}), phase: 'completed', percent: 100, message: '母版图生成完成' };
    syncTemplateMasterCandidateToQueuedTasks(candidate);
    persistTemplateMasterCandidates();
    renderQueue();
    renderTemplateWorkflow();
    toast('母版图已生成，可以创建整套任务');
  } catch (error) {
    candidate.masterStatus = candidate.masterImagePath ? '已生成' : '未生成';
    candidate.masterError = errorText(error);
    candidate.masterProgress = { ...(candidate.masterProgress || {}), phase: 'failed', message: candidate.masterError };
    persistTemplateMasterCandidates();
    renderTemplateWorkflow();
    toast(candidate.masterError, true);
  }
}

async function generateQueue(options = {}) {
  state.stopGenerationRequested = false;
  const selected = state.queue.filter(task => task.selected);
  let source = selected.length ? selected : state.queue;
  if (source.length && source.every(task => task.status === '已完成')) {
    setPage('review');
    return;
  }
  const incompleteTemplateTask = source.find(task => {
    if (task.generationMode !== 'template_print') return false;
    const fullCount = state.taskTemplateItems.filter(item => item.action === 'replace_print' && templateFolderPathForItem(item) === task.templateFolderPath).length;
    const queuedCount = state.queue.filter(item => item.generationMode === 'template_print' && item.templateFolderPath === task.templateFolderPath && item.printPath === task.printPath).length;
    return fullCount > queuedCount;
  });
  if (incompleteTemplateTask) {
    const fullCount = state.taskTemplateItems.filter(item => item.action === 'replace_print' && templateFolderPathForItem(item) === incompleteTemplateTask.templateFolderPath).length;
    const queuedCount = state.queue.filter(item => item.generationMode === 'template_print' && item.templateFolderPath === incompleteTemplateTask.templateFolderPath && item.printPath === incompleteTemplateTask.printPath).length;
    if (await brandConfirm(`当前任务只包含 ${queuedCount}/${fullCount} 张换印花图片，是否补齐为整套后再生成？`, { title: '补齐整套任务', confirmText: '补齐并生成' })) {
      const added = expandTemplateTaskGroupToFullSet(incompleteTemplateTask);
      if (added) {
        toast(`已补齐 ${added} 张整套任务`);
        renderQueue();
        source = selected.length ? state.queue.filter(task => task.selected) : state.queue;
      }
    }
  }
  const pending = source.filter(task => task.status === '未开始' || task.status === '失败');
  if (!pending.length) return toast('没有待生成任务', true);
  const missingMaster = pending.filter(task => task.generationMode === 'template_print' && !templateTaskHasMaster(task));
  const runnable = pending.filter(templateTaskHasMaster);
  if (!runnable.length) return toast('请先为任务生成母版图', true);
  if (missingMaster.length) toast(`已跳过 ${missingMaster.length} 个未生成母版的任务`);
  if (runnable.some(task => task.generationMode === 'template_print' && !task.templateRelativePath) && !state.templatePreparation?.ready) {
    return toast(state.templatePreparation?.counts?.manualCheck ? '套图中还有未确认处理方式的图片，请先完成人工框选' : '请先在素材资产中保存人工框选结果', true);
  }
  $('#generateAllButton').disabled = true;
  runnable.forEach(task => {
    const continuing = task.error === '页面曾关闭，将继续查询原后台任务。';
    if (!continuing) task.runAttempt = Math.max(0, Number(task.runAttempt) || 0) + 1;
    task.status = '排队中';
    task.error = '';
    task.progress = { phase: 'queued', current: 0, total: 0, percent: 0, message: '等待服务器处理' };
  });
  renderQueue();
  if (options.redirectOnStart) {
    toast('已开始生成整套，正在跳转到人工筛图页面查看进度');
    setPage('review');
  } else if (options.notifyOnStart) {
    toast('已开始生成整套任务，可以到人工筛图页面查看进度');
  }
  const grouped = new Map();
  for (const task of runnable) {
    const groupKey = queueGroupKey(task);
    if (!grouped.has(groupKey)) grouped.set(groupKey, []);
    grouped.get(groupKey).push(task);
  }
  const taskGroups = [...grouped.values()];
  const groupConcurrency = await apiBatchConcurrencyLimit(taskGroups.length);
  await runClientConcurrency(taskGroups, groupConcurrency, async tasks => {
    if (state.stopGenerationRequested) {
      tasks.forEach(item => {
        if (item.status === '排队中') {
          item.status = '未开始';
          item.progress = { ...(item.progress || {}), phase: 'stopped', message: '已停止，重新点击生成后再处理' };
        }
      });
      renderQueue();
      return;
    }
    const task = tasks[0];
    const payload = tasks.length > 1
      ? { ...task, templateRelativePaths: tasks.map(item => item.templateRelativePath).filter(Boolean) }
      : { ...task, templateRelativePaths: task.templateRelativePath ? [task.templateRelativePath] : [] };
    tasks.forEach(item => { item.status = '生成中'; });
    renderQueue();
    try {
      const result = await window.caishen.generateTask(payload, progress => {
        tasks.forEach(item => {
          item.progress = { ...(item.progress || {}), ...(progress || {}) };
          item.status = item.progress.phase === 'queued' ? '排队中' : '生成中';
        });
        renderQueue();
      });
      tasks.forEach(item => {
        item.result = result;
        item.status = '已完成';
        item.progress = { ...(item.progress || {}), ...(result?.summary || {}), phase: 'completed', percent: 100, message: '处理完成' };
      });
    } catch (error) {
      tasks.forEach(item => {
        item.status = '失败';
        item.error = errorText(error);
        item.progress = { ...(item.progress || {}), phase: 'failed', message: item.error };
      });
      if (state.stopGenerationRequested || /手动停止|强制停止/.test(errorText(error))) {
        state.stopGenerationRequested = true;
      }
    }
    renderQueue();
  });
  if (state.stopGenerationRequested) {
    runnable.forEach(item => {
      if (item.status === '排队中') {
        item.status = '未开始';
        item.progress = { ...(item.progress || {}), phase: 'stopped', message: '已停止，重新点击生成后再处理' };
      }
    });
    renderQueue();
  }
  $('#generateAllButton').disabled = false;
  const failed = runnable.filter(task => task.status === '失败').length;
  const uniqueResults = new Map();
  for (const task of runnable) {
    if (!task.result) continue;
    uniqueResults.set(task.result.folder || task.id, task.result);
  }
  const totals = [...uniqueResults.values()].reduce((result, taskResult) => {
    const summary = taskResult.summary || {};
    result.apiGenerated += Number(summary.apiGenerated) || 0;
    result.copied += Number(summary.copied) || 0;
    result.skipped += Number(summary.skipped) || 0;
    return result;
  }, { apiGenerated: 0, copied: 0, skipped: 0 });
  toast(failed
    ? `任务结束，${failed} 个失败，可修正后重试`
    : `处理完成：API 生成 ${totals.apiGenerated}，直接复制 ${totals.copied}，跳过 ${totals.skipped}。点击“查看筛图结果”继续。`, failed > 0);
  renderTemplateWorkflow();
}

function reviewGenerationSummary(item) {
  const saved = item?.generationProgress || {};
  if (Number(saved.total) > 0) return {
    total: Number(saved.total) || 0,
    current: Number(saved.current) || 0,
    percent: Number(saved.percent) || 0,
    apiGenerated: Number(saved.apiGenerated) || 0,
    copied: Number(saved.copied) || 0,
    skipped: Number(saved.skipped) || 0,
    failed: Number(saved.failed) || 0,
    waitingUpstream: Number(saved.waitingUpstream) || 0,
    pending: Number(saved.pending) || 0,
    billingCostMinor: Number(saved.billingCostMinor) || 0,
    phase: saved.phase || 'completed',
    message: normalizeProgressMessage(saved.message || ''),
    startedAt: saved.startedAt || '',
    completedAt: saved.completedAt || '',
    elapsedMs: Number(saved.elapsedMs) || 0,
    updatedAt: saved.updatedAt || '',
    activeRelativePath: saved.activeRelativePath || ''
  };
  const jobs = item?.jobs || [];
  const summary = { total: jobs.length, current: 0, percent: 0, apiGenerated: 0, copied: 0, skipped: 0, failed: 0, waitingUpstream: 0, pending: 0, billingCostMinor: 0, phase: 'completed', message: '', startedAt: '', completedAt: '', elapsedMs: 0, updatedAt: '', activeRelativePath: '' };
  for (const job of jobs) {
    const action = normalizeTemplateUiAction(job.action);
    if (job.status === '已跳过' || action === 'exclude') summary.skipped += 1;
    else if (!job.outputUrl) summary.pending += 1;
    else if (job.status === '直接套模板' || action === 'copy_original') summary.copied += 1;
    else summary.apiGenerated += 1;
  }
  summary.current = summary.total - summary.pending;
  summary.percent = summary.total ? Math.round(summary.current / summary.total * 100) : 0;
  summary.phase = summary.pending ? 'attention' : 'completed';
  return summary;
}

function renderReviewGenerationControls() {
  const stopButton = $('#stopReviewGenerationButton');
  if (!stopButton) return;
  stopButton.disabled = false;
  stopButton.textContent = '强制停止全部任务';
}

async function stopCurrentReviewGeneration() {
  const button = $('#stopReviewGenerationButton');
  button.disabled = true;
  button.textContent = '正在停止…';
  try {
    const result = await window.caishen.cancelActiveJobs();
    state.stopGenerationRequested = true;
    state.activeReviewGenerationJobId = '';
    state.regeneratingReviewJobs.clear();
    state.reviewRegenerationJobIds.clear();
    let recordsChanged = false;
    state.reviewRegenerationRecords.forEach(record => {
      if (record.status !== 'running') return;
      record.status = 'stopped';
      record.updatedAt = new Date().toISOString();
      recordsChanged = true;
    });
    if (recordsChanged) persistReviewRegenerationRecords();
    if (state.activeReview?.generationProgress) {
      state.activeReview.generationProgress = {
        ...state.activeReview.generationProgress,
        phase: 'failed',
        pending: 0,
        waitingUpstream: 0,
        message: '任务已手动停止',
        completedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
    }
    renderReviewList();
    renderReviewStagePreservingScroll();
    toast(Number(result?.count) > 0 ? `已强制停止 ${result.count} 个后台任务` : '已发送停止指令，当前没有排队或运行中的后台任务');
    await loadReviews();
  } catch (error) {
    toast(errorText(error), true);
  } finally {
    renderReviewGenerationControls();
  }
}

async function downloadSelectedReviewFolders() {
  const selected = [...state.selectedReviewFolders];
  const folders = selected.length ? selected : (state.reviewTaskActivated && state.activeReview ? [state.activeReview.folder] : []);
  if (!folders.length) return toast('请先选择要下载的任务', true);
  try {
    toast(folders.length > 1 ? `开始下载 ${folders.length} 个任务 ZIP` : '开始下载当前任务 ZIP');
    for (const folder of folders) {
      await window.caishen.downloadFolder(folder);
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  } catch (error) {
    toast(errorText(error), true);
  }
}

function scheduleReviewRefresh() {
  clearTimeout(reviewRefreshTimer);
  reviewRefreshTimer = null;
  const running = state.reviews.some(item => ['queued', 'preparing', 'generating', 'auditing', 'running'].includes(reviewGenerationSummary(item).phase));
  if (currentPage === 'review' && running) {
    reviewRefreshTimer = setTimeout(() => loadReviews({ silent: true }), 1500);
  }
}

function friendlyGenerationError(value) {
  const message = String(value || '').trim();
  const lower = message.toLocaleLowerCase('en-US');
  if (!message) return '';
  if (lower.includes('upstream image generation is busy') || lower.includes('server is busy')) return '生图服务繁忙，请稍后重新生成';
  if (lower.includes('token') && (lower.includes('expired') || lower.includes('invalid'))) return 'API 登录已过期，请先到系统设置检查连接';
  if (lower.includes('401') || lower.includes('unauthorized')) return 'API 认证失败，请检查密钥或登录状态';
  if (lower.includes('timeout') || lower.includes('timed out')) return '生成等待超时，可以稍后重新生成';
  if (lower.includes('econnrefused') || lower.includes('fetch failed')) return '暂时无法连接生图服务';
  return message.length > 90 ? `${message.slice(0, 90)}…` : message;
}

function reviewJobTrackingState(job, running) {
  if (job.regenerating) return { key: 'pending', label: '重新生成中', detail: `正在重新生成图片：${job.relativePath || ''}` };
  if (job.generationError && !job.outputUrl) return { key: 'failed', label: '生成失败', detail: friendlyGenerationError(job.generationError) };
  if (job.status === '已跳过' || normalizeTemplateUiAction(job.action) === 'exclude') return { key: 'completed', label: '已跳过', detail: '按套图规则不输出此图' };
  if (job.outputUrl) return { key: 'completed', label: '生成完成', detail: job.status === '已通过' ? '已通过人工确认' : '点击查看并确认图片' };
  if (running) return { key: 'pending', label: '生成中', detail: '正在等待生成结果' };
  return { key: 'pending', label: '待处理', detail: '尚未生成，可单独重新生成' };
}

function reviewJobActionKey(item, job) {
  return `${item?.folder || ''}\u0000${job?.relativePath || ''}`;
}

function reviewJobViewedKey(item, job) {
  return `${item?.folder || ''}\u0000${job?.relativePath || ''}\u0000${Number(job?.outputModifiedAt) || 0}\u0000${job?.generationError || ''}`;
}

function reviewJobMatchKey(item, job) {
  return `${item?.folder || ''}\u0000${normalizedRelativePath(job?.relativePath)}`;
}

function markReviewJobViewed(item, job) {
  const key = reviewJobViewedKey(item, job);
  if (!key || state.viewedReviewJobs.has(key)) return;
  state.viewedReviewJobs.add(key);
  persistViewedReviewJobs();
}

function markReviewItemViewed(item) {
  let changed = false;
  (item?.jobs || []).forEach(job => {
    const key = reviewJobViewedKey(item, job);
    if (key && !state.viewedReviewJobs.has(key)) {
      state.viewedReviewJobs.add(key);
      changed = true;
    }
  });
  if (changed) persistViewedReviewJobs();
}

function formatRegenerationAttempt(value) {
  const number = Number(value) || 1;
  const zh = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
  if (number > 0 && number <= 10) return `第${zh[number]}次`;
  return `第${number}次`;
}

function createReviewRegenerationRecord(item, job) {
  const matchKey = reviewJobMatchKey(item, job);
  const attempt = state.reviewRegenerationRecords.filter(record => `${record.folder || ''}\u0000${normalizedRelativePath(record.relativePath)}` === matchKey).length + 1;
  const record = {
    id: createClientId(),
    folder: item.folder,
    relativePath: job.relativePath,
    attempt,
    status: 'running',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  state.reviewRegenerationRecords.push(record);
  state.reviewRegenerationRecords = state.reviewRegenerationRecords.slice(-300);
  persistReviewRegenerationRecords();
  return record;
}

function updateReviewRegenerationRecord(record, status) {
  if (!record?.id) return;
  const target = state.reviewRegenerationRecords.find(item => item.id === record.id);
  if (!target) return;
  target.status = status;
  target.updatedAt = new Date().toISOString();
  persistReviewRegenerationRecords();
}

function runningReviewRegenerationRecord(item, job) {
  return state.reviewRegenerationRecords.slice().reverse().find(record => (
    record.folder === item.folder
    && normalizedRelativePath(record.relativePath) === normalizedRelativePath(job.relativePath)
    && record.status === 'running'
  ));
}

async function stopReviewRegeneration(item, job) {
  const key = reviewJobActionKey(item, job);
  const jobId = state.reviewRegenerationJobIds.get(key);
  if (!jobId) return toast('任务正在提交，请稍后再点停止', true);
  try {
    await window.caishen.cancelJob(jobId);
    state.reviewRegenerationJobIds.delete(key);
    state.regeneratingReviewJobs.delete(key);
    updateReviewRegenerationRecord(runningReviewRegenerationRecord(item, job), 'stopped');
    if (state.activeReview?.folder === item.folder) {
      state.activeReview.generationProgress = {
        ...(state.activeReview.generationProgress || {}),
        phase: 'failed',
        pending: 0,
        waitingUpstream: 0,
        message: `已停止重新生成：${job.relativePath}`,
        completedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      renderReviewStagePreservingScroll();
    }
    toast(`已停止重新生成：${job.relativePath}`);
  } catch (error) {
    toast(errorText(error), true);
  }
}

function renderReviewStagePreservingScroll() {
  const stage = $('#reviewStage');
  const top = stage ? stage.scrollTop : 0;
  renderReviewStage();
  if (stage) stage.scrollTop = top;
}

function setReviewTrackingLogVisible(visible, folder = '') {
  const panel = $('#reviewLogPanel');
  if (!panel) return;
  panel.hidden = !visible;
  panel.dataset.reviewFolder = visible ? String(folder || '') : '';
  panel.closest('.review-layout')?.classList.toggle('review-log-hidden', !visible);
}

function renderReviewTrackingLog(item, summary, running) {
  const isCurrentTask = Boolean(
    state.reviewTaskActivated
    && state.activeReview?.folder
    && item?.folder
    && state.activeReview.folder === item.folder
  );
  if (!isCurrentTask) {
    renderEmptyReviewTrackingLog();
    return;
  }
  setReviewTrackingLogVisible(true, item.folder);
  const jobs = item?.jobs || [];
  const activeRelativePath = normalizedRelativePath(summary?.activeRelativePath);
  const jobEntries = jobs.map((job, index) => ({
    job: { ...job, regenerating: state.regeneratingReviewJobs.has(reviewJobActionKey(item, job)) || (running && activeRelativePath && normalizedRelativePath(job.relativePath) === activeRelativePath) },
    index,
    type: 'job',
    state: reviewJobTrackingState({ ...job, regenerating: state.regeneratingReviewJobs.has(reviewJobActionKey(item, job)) || (running && activeRelativePath && normalizedRelativePath(job.relativePath) === activeRelativePath) }, running),
    viewed: state.viewedReviewJobs.has(reviewJobViewedKey(item, job))
  }));
  const regenerationEntries = state.reviewRegenerationRecords
    .filter(record => record.folder === item?.folder)
    .slice()
    .reverse()
    .map((record, recordIndex) => {
      const index = jobs.findIndex(job => normalizedRelativePath(job.relativePath) === normalizedRelativePath(record.relativePath));
      const job = jobs[index] || { relativePath: record.relativePath };
      const status = ['failed', 'stopped'].includes(record.status) ? 'failed' : record.status === 'completed' ? 'completed' : 'pending';
      const label = record.status === 'stopped' ? '重新生成已停止' : record.status === 'failed' ? '重新生成失败' : record.status === 'completed' ? '重新生成完成' : '重新生成中';
      const updated = formatLocalDateTime(record.updatedAt || record.createdAt);
      return {
        job,
        index,
        record,
        recordIndex,
        type: 'regeneration',
        state: {
          key: status,
          label,
          detail: `${formatRegenerationAttempt(record.attempt)} · ${updated ? `更新 ${updated}` : '等待结果'}`
        },
        viewed: index >= 0 ? state.viewedReviewJobs.has(reviewJobViewedKey(item, job)) : true
      };
    });
  const entries = [...regenerationEntries, ...jobEntries];
  const stateRank = entry => entry.state.key === 'pending' ? 0 : entry.state.key === 'failed' ? 1 : 2;
  const counts = entries.reduce((result, entry) => {
    result[entry.state.key] += 1;
    if (!entry.viewed) result.unread += 1;
    return result;
  }, { completed: 0, failed: 0, pending: 0, unread: 0 });
  const activeFilter = ['all', 'unread', 'completed', 'failed', 'pending'].includes(state.reviewLogFilter) ? state.reviewLogFilter : 'all';
  const visible = activeFilter === 'all'
    ? entries.slice().sort((left, right) => stateRank(left) - stateRank(right) || left.index - right.index)
    : activeFilter === 'unread' ? entries.filter(entry => !entry.viewed) : entries.filter(entry => entry.state.key === activeFilter);
  const logs = item.logs?.length
    ? item.logs.map(log => ({ time: log.time || log.Time || '', message: log.message || log.Message || '' }))
    : [{ time: '', message: `${item.status}：${item.name}` }];
  const filterButton = (key, label, count) => `<button type="button" class="review-log-filter${activeFilter === key ? ' active' : ''}" data-review-log-filter="${key}">${label}<b>${count}</b></button>`;
  const jobTimeText = entry => {
    if (entry.type === 'regeneration') return '';
    if (entry.job.regenerating) {
      const updated = formatLocalDateTime(summary.updatedAt || Date.now());
      return updated ? `更新 ${updated}` : '';
    }
    if (entry.job.outputModifiedAt) {
      const completed = formatLocalDateTime(Number(entry.job.outputModifiedAt));
      return completed ? `完成 ${completed}` : '';
    }
    const reviewedAt = entry.job.manualReview?.updatedAt || entry.job.reviewedAt || '';
    if (reviewedAt) {
      const reviewed = formatLocalDateTime(reviewedAt);
      return reviewed ? `确认 ${reviewed}` : '';
    }
    if (running && activeRelativePath && normalizedRelativePath(entry.job.relativePath) === activeRelativePath) {
      const updated = formatLocalDateTime(summary.updatedAt || Date.now());
      return updated ? `更新 ${updated}` : '';
    }
    if ((running || entry.state.key === 'pending') && summary.updatedAt) {
      const updated = formatLocalDateTime(summary.updatedAt);
      return updated ? `更新 ${updated}` : '';
    }
    return '';
  };
  const items = visible.length
    ? visible.map(entry => {
      const timeText = jobTimeText(entry);
      const detail = timeText ? `${entry.state.detail} · ${timeText}` : entry.state.detail;
      const title = entry.type === 'regeneration'
        ? `重新生成 ${entry.job.relativePath} ${formatRegenerationAttempt(entry.record?.attempt)}`
        : entry.job.relativePath;
      const data = entry.index >= 0 ? ` data-review-log-job="${entry.index}"` : '';
      return `<button type="button" class="review-track-item ${entry.type === 'regeneration' ? 'regeneration ' : ''}${entry.state.key} ${entry.viewed ? 'viewed' : 'unread'}"${data} title="跳转到 ${escapeHtml(entry.job.relativePath)}"><i aria-hidden="true"></i><span><b>${escapeHtml(title)}</b><small>${escapeHtml(detail)}</small></span><span class="review-track-badges"><em>${escapeHtml(entry.state.label)}</em><u>${entry.viewed ? '已查看' : '未查看'}</u></span></button>`;
    }).join('')
    : '<div class="review-track-empty">当前筛选没有图片</div>';
  const history = logs.slice().reverse().slice(0, 20).map(log => `<div class="review-log-entry"><span>${escapeHtml(log.time ? new Date(log.time).toLocaleString('zh-CN', { hour12: false }) : '')}</span><div>${escapeHtml(log.message)}</div></div>`).join('');
  const summaryTimes = [
    summary.startedAt ? `开始 ${formatLocalDateTime(summary.startedAt)}` : '',
    summary.completedAt ? `完成 ${formatLocalDateTime(summary.completedAt)}` : '',
    !summary.completedAt && summary.updatedAt ? `更新 ${formatLocalDateTime(summary.updatedAt)}` : ''
  ].filter(Boolean).join(' · ');
  const log = $('#reviewOperationLog');
  const scrollTop = log.scrollTop;
  const historyOpen = Boolean(log.querySelector('.review-log-history')?.open);
  log.innerHTML = `<div class="review-log-summary"><b>${running ? '当前任务正在处理' : counts.failed ? '当前任务需要处理' : '当前任务处理完成'}</b><span>${summary.current}/${summary.total} 张已处理</span><small>完成 ${counts.completed} · 失败 ${counts.failed} · 待处理 ${counts.pending} · 未查看 ${counts.unread}${summary.billingCostMinor ? ` · 成本 ${formatMoney(summary.billingCostMinor)}` : ''}${summaryTimes ? ` · ${escapeHtml(summaryTimes)}` : ''}</small></div><div class="review-log-filters">${filterButton('all', '当前任务全部', entries.length)}${filterButton('unread', '未查看', counts.unread)}${filterButton('completed', '完成', counts.completed)}${filterButton('failed', '失败', counts.failed)}${filterButton('pending', '待处理', counts.pending)}</div><div class="review-track-list">${items}</div><details class="review-log-history"><summary>查看当前任务记录</summary>${history}</details>`;
  const nextHistory = log.querySelector('.review-log-history');
  if (nextHistory) nextHistory.open = historyOpen;
  log.scrollTop = Math.min(scrollTop, Math.max(0, log.scrollHeight - log.clientHeight));
}

function renderEmptyReviewTrackingLog() {
  const log = $('#reviewOperationLog');
  if (!log) return;
  state.reviewLogFilter = 'all';
  log.innerHTML = '';
  setReviewTrackingLogVisible(false);
}

async function loadReviews({ silent = false } = {}) {
  if (!silent) $('#reviewList').innerHTML = '<div class="empty-inline">正在读取结果…</div>';
  try {
    state.reviews = await window.caishen.listReviews();
    if (state.reviewTaskActivated && state.activeReview) {
      state.activeReview = state.reviews.find(item => item.folder === state.activeReview.folder) || null;
    }
    state.selectedReviewFolders = new Set([...state.selectedReviewFolders].filter(folder => state.reviews.some(item => item.folder === folder)));
    const visible = visibleReviewEntries();
    if (!state.reviewTaskActivated || !visible.some(({ item }) => item.folder === state.activeReview?.folder)) {
      state.activeReview = null;
      state.reviewTaskActivated = false;
    }
    renderReviewList();
    if (silent) renderReviewStagePreservingScroll();
    else renderReviewStage();
    renderReviewGenerationControls();
    scheduleReviewRefresh();
  } catch (error) {
    toast(errorText(error), true);
    renderReviewGenerationControls();
    scheduleReviewRefresh();
  }
}

function visibleReviewEntries() {
  const query = ($('#reviewSearch')?.value || '').trim().toLocaleLowerCase('zh-CN');
  const filter = $('#reviewFilter')?.value || '全部图片';
  return state.reviews.map((item, index) => ({ item, index })).filter(({ item }) => {
    if (query && !item.name.toLocaleLowerCase('zh-CN').includes(query)) return false;
    const jobs = item.jobs || [];
    const reviewableJobs = jobs.filter(job => job.status !== '已跳过');
    const fullyApproved = reviewableJobs.length > 0 && reviewableJobs.every(job => job.status === '已通过');
    if (filter === '人工不通过') {
      return jobs.some(job => String(job.manualReview?.Status || job.manualReview?.status || '') === '人工不通过');
    }
    if (filter === '触发过重新生成') {
      const hasClientRecord = state.reviewRegenerationRecords.some(record => record.folder === item.folder);
      const hasOperationLog = (item.logs || []).some(log => String(log.message || log.Message || '').includes('重新生成单张'));
      return hasClientRecord || hasOperationLog;
    }
    if (filter === '已通过') return fullyApproved;
    return filter === '全部图片' || item.status === filter || jobs.some(job => job.status === filter);
  });
}

function pendingReviewQueueEntries() {
  const query = ($('#reviewSearch')?.value || '').trim().toLocaleLowerCase('zh-CN');
  const filter = $('#reviewFilter')?.value || '全部图片';
  if (filter !== '全部图片' && filter !== '待生成') return [];
  const grouped = new Map();
  for (const task of state.queue) {
    if (task.generationMode !== 'template_print') continue;
    if (!['排队中', '生成中'].includes(task.status)) continue;
    if (task.result?.folder || task.progress?.folder) continue;
    const key = queueGroupKey(task);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(task);
  }
  return [...grouped.values()].map(tasks => {
    const title = queueGroupTitle(tasks);
    const running = tasks.some(task => task.status === '生成中');
    const selectedCount = tasks.filter(task => task.selected).length;
    const total = Math.max(1, tasks.length);
    const current = tasks.reduce((sum, task) => sum + (Number(task.progress?.current) || 0), 0);
    const progressTotal = tasks.reduce((sum, task) => sum + (Number(task.progress?.total) || 0), 0);
    const percent = progressTotal ? Math.min(100, Math.round(current / progressTotal * 100)) : running ? 5 : 0;
    return { title, running, selectedCount, total, percent };
  }).filter(entry => !query || entry.title.toLocaleLowerCase('zh-CN').includes(query));
}

function renderReviewList() {
  const visible = visibleReviewEntries();
  if (!state.reviewTaskActivated || (state.activeReview && !visible.some(({ item }) => item.folder === state.activeReview.folder))) {
    state.activeReview = null;
    state.reviewTaskActivated = false;
  }
  const pendingQueue = pendingReviewQueueEntries();
  const reviewMarkup = visible.length ? visible.map(({ item, index }) => {
    const summary = reviewGenerationSummary(item);
    const reviewableJobs = (item.jobs || []).filter(job => job.status !== '已跳过');
    const fullyApproved = reviewableJobs.length > 0 && reviewableJobs.every(job => job.status === '已通过');
    const running = ['queued', 'preparing', 'generating', 'auditing', 'running'].includes(summary.phase);
    const detail = running
      ? `处理中 ${summary.current}/${summary.total}`
      : fullyApproved
        ? `已人工筛过 · API ${summary.apiGenerated} · 复制 ${summary.copied} · 跳过 ${summary.skipped}`
        : `API ${summary.apiGenerated} · 复制 ${summary.copied} · 跳过 ${summary.skipped}`;
    const cost = summary.billingCostMinor ? ` · 成本 ${formatMoney(summary.billingCostMinor)}` : '';
    const elapsed = reviewElapsedMs(summary, running);
    const duration = elapsed ? ` · ${running ? '已用时' : '总耗时'} ${formatDurationMs(elapsed)}` : '';
    return `<div class="review-row${state.activeReview?.folder === item.folder ? ' active' : ''}${fullyApproved ? ' approved' : ''}"><input type="checkbox" data-review-select="${index}"${state.selectedReviewFolders.has(item.folder) ? ' checked' : ''}><button class="review-row-main" data-review-index="${index}"><b>${escapeHtml(item.name)}</b><span>${escapeHtml(fullyApproved ? '已人工筛过' : item.status)} · ${summary.total || item.images.length} 张${escapeHtml(duration)}</span><small>${escapeHtml(detail + cost)}</small><progress max="100" value="${Math.max(0, Math.min(100, summary.percent))}"></progress></button></div>`;
  }).join('') : '';
  const pendingMarkup = pendingQueue.length
    ? `<div class="review-queued-section"><span>待启动任务</span>${pendingQueue.map(entry => `<div class="review-row queued"><i aria-hidden="true"></i><div class="review-row-main"><b>${escapeHtml(entry.title)}</b><span>${entry.running ? '正在创建人工筛图任务' : '等待前序任务完成'} · ${entry.total} 张${entry.selectedCount ? ` · 已选 ${entry.selectedCount}` : ''}</span><small>系统会按任务卡片顺序启动，当前任务完成后自动处理。</small><progress max="100" value="${Math.max(0, Math.min(100, entry.percent))}"></progress></div></div>`).join('')}</div>`
    : '';
  $('#reviewList').innerHTML = reviewMarkup || pendingMarkup
    ? `${reviewMarkup}${pendingMarkup}`
    : '<div class="empty-inline">没有匹配的任务</div>';
}

function renderReviewStage() {
  const stage = $('#reviewStage');
  const item = state.activeReview;
  if (!state.reviewTaskActivated || !item) renderEmptyReviewTrackingLog();
  if (!state.reviewTaskActivated || !item) {
    stage.innerHTML = '<div class="empty-state"><b>选择一个任务</b><span>这里会显示任务内的母版和套图结果。</span></div>';
    return;
  }
  const summary = reviewGenerationSummary(item);
  let running = ['queued', 'preparing', 'generating', 'auditing', 'running'].includes(summary.phase);
  const needsAttention = summary.failed > 0 || summary.pending > 0;
  const noApiGeneration = !running && summary.total > 0 && summary.apiGenerated === 0 && (summary.copied > 0 || summary.skipped > 0);
  const jobs = item.jobs || [];
  const activeRegeneratingPath = normalizedRelativePath(summary.activeRelativePath);
  const isReviewJobRegenerating = job => state.regeneratingReviewJobs.has(reviewJobActionKey(item, job))
    || (running && activeRegeneratingPath && normalizedRelativePath(job.relativePath) === activeRegeneratingPath);
  const localRegenerating = jobs.filter(isReviewJobRegenerating).length;
  if (localRegenerating) {
    running = true;
    summary.phase = 'generating';
    summary.pending = Math.max(summary.pending, localRegenerating);
    summary.message = `正在重新生成 ${localRegenerating} 张图片，完成后会自动刷新`;
  }
  const imageMarkup = jobs.length
    ? jobs.map((job, index) => {
      const regenerating = isReviewJobRegenerating(job);
      const action = normalizeTemplateUiAction(job.action);
      const skipped = job.status === '已跳过' || action === 'exclude';
      const copied = !skipped && (job.status === '直接套模板' || action === 'copy_original');
      const resultLabel = job.generationError && !job.outputUrl ? '生成失败' : skipped ? '不输出' : copied ? '保留原图' : job.outputUrl ? '生成结果' : running ? '生成中' : '待生成';
      const displayResultLabel = regenerating ? '重新生成中' : resultLabel;
      const resultPreview = job.outputUrl
        ? `<img loading="lazy" decoding="async" src="${job.outputUrl}" data-preview-src="${job.outputUrl}" alt="${escapeHtml(job.relativePath)} 生成结果">`
        : `<div class="review-compare-placeholder${job.generationError ? ' failed' : running && !skipped ? ' running' : ''}"><span>${escapeHtml(job.generationError ? '生成失败' : skipped ? '按规则不输出' : running ? '正在生成' : '待生成')}</span>${running && !skipped && !job.generationError ? '<i aria-hidden="true"></i>' : ''}</div>`;
      const templatePreviewUrl = job.templatePreviewUrl || job.templateThumbnailUrl || job.templateUrl;
      const templateThumbUrl = job.templateThumbnailUrl || job.templatePreviewUrl || job.templateUrl;
      const wholeSetRunning = running && localRegenerating === 0;
      const regenerationJobId = state.reviewRegenerationJobIds.get(reviewJobActionKey(item, job));
      const generationActionDisabled = regenerating ? !regenerationJobId : (wholeSetRunning && !copied);
      const generationActionLabel = regenerating ? (regenerationJobId ? '停止重新生成' : '正在提交…') : wholeSetRunning && !copied ? '整套生成中' : copied ? '检查规则' : '重新生成';
      const generationAction = regenerating ? 'stop-regenerate' : copied ? 'configure' : 'regenerate';
      const actions = skipped
        ? `<div class="review-image-actions review-image-skipped"><span>按套图规则不输出，不进入最终图片</span><button class="text-button" data-job-action="configure" data-job-index="${index}">检查规则</button></div>`
        : `<div class="review-image-actions"><button class="secondary" data-job-action="pass" data-job-index="${index}"${!job.outputUrl || regenerating ? ' disabled' : ''}>通过</button><button class="secondary danger-outline" data-job-action="reject" data-job-index="${index}"${!job.outputUrl || regenerating ? ' disabled' : ''}>不通过</button><button class="secondary${regenerating ? ' danger-outline' : ''}" data-job-action="${generationAction}" data-job-index="${index}"${generationActionDisabled ? ' disabled' : ''}>${generationActionLabel}</button></div>`;
      return `<figure class="review-image comparison${skipped ? ' skipped' : ''}${copied ? ' copied' : ''}${regenerating ? ' regenerating' : ''}" data-review-job="${index}"><div class="review-image-status"><b>${escapeHtml(job.relativePath)}</b><span>${escapeHtml(regenerating ? '重新生成中' : job.status)}</span></div><div class="review-compare"><div class="review-compare-side"><span>原套图模板</span><div class="review-compare-frame"><img loading="lazy" decoding="async" src="${templateThumbUrl}" data-preview-src="${templatePreviewUrl}" alt="${escapeHtml(job.relativePath)} 原套图模板"></div></div><div class="review-compare-side result"><span>${escapeHtml(displayResultLabel)}</span><div class="review-compare-frame">${resultPreview}</div></div></div><figcaption>${regenerating ? '已提交重新生成，完成后会自动刷新右侧结果' : skipped ? '此图按规则不输出，不进入最终套图' : job.outputUrl ? (copied ? '原图直接复制，未调用 API' : '左侧原模板，右侧本次生成结果') : '生成完成后会在右侧自动显示结果'}</figcaption>${actions}</figure>`;
    }).join('')
    : item.images.map(image => `<figure class="review-image legacy"><img loading="lazy" decoding="async" src="${image.url}" data-preview-src="${image.url}" alt="${escapeHtml(image.name)}"><figcaption>${escapeHtml(image.name)}</figcaption></figure>`).join('');
  const master = item.masterImage ? `<section class="master-review-strip"><img src="${item.masterImage.url}" alt="母版图"><div><b>母版图</b><span>${escapeHtml(item.masterStatus || '母版已生成')}</span></div></section>` : '';
  const progressTitle = running ? '正在处理套图' : needsAttention ? '套图处理完成，但有图片需要处理' : noApiGeneration ? '本任务没有调用生图 API' : '套图已生成，请逐张确认';
  const progressDetail = running
    ? (summary.message || (summary.waitingUpstream
      ? `生图接口等待重试 ${summary.waitingUpstream} 张，已处理 ${summary.current}/${summary.total} 张`
      : `已处理 ${summary.current}/${summary.total} 张，页面会自动刷新`))
    : noApiGeneration
      ? `套图识别规则将 ${summary.copied} 张判定为直接复制，${summary.skipped} 张判定为跳过，所以很快完成。`
      : needsAttention
        ? `失败 ${summary.failed} 张，待处理 ${summary.pending} 张。先处理异常图片，再确认整套。`
        : `共 ${summary.total} 张：API 生成 ${summary.apiGenerated}，直接复制 ${summary.copied}，跳过 ${summary.skipped}。`;
  const elapsed = reviewElapsedMs(summary, running);
  const durationMetric = elapsed ? `<span><i class="pending"></i>${running ? '已用时' : '总耗时'} <b>${formatDurationMs(elapsed)}</b></span>` : '';
  const progressCard = `<section class="review-progress-card${running ? ' running' : needsAttention || noApiGeneration ? ' attention' : ' complete'}"><div class="review-progress-head"><div><span>${running ? '生成进度' : '本次处理摘要'}</span><b>${escapeHtml(progressTitle)}</b><p>${escapeHtml(progressDetail)}</p></div><strong>${summary.current}/${summary.total}</strong></div><progress class="review-progress-track" aria-label="套图处理进度" max="${Math.max(1, summary.total)}" value="${Math.max(0, summary.current)}"></progress><div class="review-progress-metrics"><span><i class="api"></i>API 生成 <b>${summary.apiGenerated}</b></span><span><i class="copied"></i>直接复制 <b>${summary.copied}</b></span><span><i class="skipped"></i>跳过 <b>${summary.skipped}</b></span><span><i class="cost"></i>任务成本 <b>${formatMoney(summary.billingCostMinor)}</b></span>${durationMetric}${summary.waitingUpstream ? `<span><i class="waiting"></i>生图接口等待重试 <b>${summary.waitingUpstream}</b></span>` : ''}${summary.failed ? `<span><i class="failed"></i>失败 <b>${summary.failed}</b></span>` : ''}${summary.pending ? `<span><i class="pending"></i>待处理 <b>${summary.pending}</b></span>` : ''}</div>${noApiGeneration ? '<div class="review-progress-guidance"><span>如果原本期望替换印花，说明当前套图识别规则不符合预期。</span><button class="secondary" data-review-configure>返回检查套图规则</button></div>' : ''}</section>`;
  stage.innerHTML = `<div class="review-toolbar"><div><b>${escapeHtml(item.name)}</b><span class="index">${escapeHtml(item.status)}</span></div><div><button class="primary" id="approveReview"${running || needsAttention ? ' disabled' : ''}>确认整套通过</button></div></div>${progressCard}${master}<div class="review-images">${imageMarkup}</div>`;
  renderReviewTrackingLog(item, summary, running);
  stage.querySelectorAll('[data-review-job]').forEach((card, index) => {
    card.addEventListener('click', () => {
      if (!jobs[index]) return;
      markReviewJobViewed(item, jobs[index]);
      renderReviewTrackingLog(item, summary, running);
    });
  });
  stage.querySelectorAll('[data-review-configure]').forEach(button => {
    button.onclick = async () => {
      setPage('tasks');
      await loadTemplatePreparation();
      openTemplateConfig();
    };
  });
  $('#approveReview').onclick = async () => {
    try {
      const result = await window.caishen.approveReview(item.folder);
      toast(result?.approved ? '任务已通过' : (result?.reason || '任务尚未满足通过条件'), !result?.approved);
      await loadReviews();
    } catch (error) { toast(errorText(error), true); }
  };
  stage.querySelectorAll('[data-job-action]').forEach(button => {
    button.onclick = async () => {
      const job = jobs[Number(button.dataset.jobIndex)];
      if (!job) return;
      markReviewJobViewed(item, job);
      renderReviewTrackingLog(item, summary, running);
      button.disabled = true;
      try {
        if (button.dataset.jobAction === 'stop-regenerate') {
          await stopReviewRegeneration(item, job);
          return;
        }
        if (button.dataset.jobAction === 'configure') {
          setPage('tasks');
          await loadTemplatePreparation();
          openTemplateConfig();
          return;
        }
        if (button.dataset.jobAction === 'regenerate') {
          const regenerationOptions = await openReviewRegenerationDialog(item, job);
          if (!regenerationOptions) return;
          const regenExtraInstruction = regenerationOptions.extraInstruction || '';
          const reviewRegenerateKey = reviewJobActionKey(item, job);
          const regenerationRecord = createReviewRegenerationRecord(item, job);
          state.regeneratingReviewJobs.add(reviewRegenerateKey);
          renderReviewStagePreservingScroll();
          toast(`已提交重新生成：${job.relativePath} ${formatRegenerationAttempt(regenerationRecord.attempt)}`);
          await window.caishen.regenerateTemplate({
            folder: item.folder,
            relativePath: job.relativePath,
            extraInstruction: regenExtraInstruction,
            includePreviousResult: Boolean(regenerationOptions.includePreviousResult),
            referenceResultRelativePath: regenerationOptions.referenceResultRelativePath || ''
          }, (progress, backgroundJob) => {
            if (backgroundJob?.id && ['queued', 'running'].includes(backgroundJob.status)) {
              state.reviewRegenerationJobIds.set(reviewRegenerateKey, backgroundJob.id);
            }
            if (!state.activeReview || state.activeReview.folder !== item.folder) return;
            updateReviewRegenerationRecord(regenerationRecord, 'running');
            state.activeReview.generationProgress = {
              ...(state.activeReview.generationProgress || {}),
              ...(progress || {}),
              phase: progress?.phase || 'generating',
              pending: Math.max(1, Number(progress?.pending) || 1),
              activeRelativePath: progress?.activeRelativePath || job.relativePath,
              message: progress?.message || `正在重新生成图片：${job.relativePath}`
            };
            renderReviewStagePreservingScroll();
          });
          state.reviewRegenerationJobIds.delete(reviewRegenerateKey);
          state.regeneratingReviewJobs.delete(reviewRegenerateKey);
          updateReviewRegenerationRecord(regenerationRecord, 'completed');
          toast(`已重新生成：${job.relativePath}`);
          await loadReviews();
        } else {
          await window.caishen.setReviewStatus({ folder: item.folder, relativePath: job.relativePath, status: button.dataset.jobAction === 'pass' ? '人工通过' : '人工不通过' });
          toast(button.dataset.jobAction === 'pass' ? '已标记通过' : '已标记不通过');
        }
        await loadReviews();
      } catch (error) {
        const stoppedRecord = state.reviewRegenerationRecords.slice().reverse().find(itemRecord => itemRecord.folder === item.folder && normalizedRelativePath(itemRecord.relativePath) === normalizedRelativePath(job.relativePath) && itemRecord.status === 'stopped');
        const record = state.reviewRegenerationRecords.slice().reverse().find(itemRecord => itemRecord.folder === item.folder && normalizedRelativePath(itemRecord.relativePath) === normalizedRelativePath(job.relativePath) && itemRecord.status === 'running');
        updateReviewRegenerationRecord(record, 'failed');
        state.reviewRegenerationJobIds.delete(reviewJobActionKey(item, job));
        state.regeneratingReviewJobs.delete(reviewJobActionKey(item, job));
        if (state.activeReview?.folder === item.folder) renderReviewStage();
        if (!stoppedRecord) toast(errorText(error), true);
      } finally {
        button.disabled = false;
      }
    };
  });
}

async function chooseFreeImage() {
  const image = await window.caishen.chooseImage();
  if (!image) return;
  state.freeSource = image;
  $('#freeSource').innerHTML = `<img src="${image.url}" alt="源图片">`;
}

async function generateFree() {
  if (!state.freeSource) return toast('请先选择源图片', true);
  const prompt = $('#freePrompt').value.trim();
  if (!prompt) return toast('请输入修改要求', true);
  $('#freeGenerateButton').disabled = true;
  $('#freeResult').innerHTML = '<div class="empty-state"><b>正在生成</b><span>请保持页面打开。</span></div>';
  try {
    state.freeResult = await window.caishen.generateFree({ sourcePath: state.freeSource.path, prompt });
    $('#freeResult').innerHTML = `<img src="${state.freeResult.url}" alt="生成结果">`;
    $('#freeResult img').onclick = () => window.caishen.revealFile(state.freeResult.outputPath);
    $('#revealFreeResultButton').disabled = false;
    toast('自由生图完成，点击结果即可下载');
  } catch (error) {
    $('#freeResult').innerHTML = `<div class="empty-state"><b>生成失败</b><span>${escapeHtml(errorText(error))}</span></div>`;
    toast(errorText(error), true);
  } finally {
    $('#freeGenerateButton').disabled = false;
  }
}

const TEMPLATE_ACTIONS = [
  ['replace_print', '强制换印花'],
  ['copy_original', '保留原图'],
  ['exclude', '不输出'],
  ['manual_check', '人工确认']
];

function templateActionHint(action) {
  action = normalizeTemplateUiAction(action);
  if (action === 'replace_print') return '强制换印花：调用生图 API，用母版商品迁移到当前套图页面。';
  if (action === 'copy_original') return '直接复制原套图，不消耗生图 API。';
  if (action === 'exclude') return '不生成也不复制，最终套图不包含这张图。';
  return '暂不生成，等运营确认动作。';
}

function weakManualTemplateText(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return true;
  return ['不确定', '无', '没有', '模板分析失败', '需要人工确认', 'manual', 'uncertain', 'unknown', 'none']
    .some(token => text.includes(token));
}

function applyTemplateActionDefaults(item, card) {
  if (!item || item.action !== 'replace_print') return;
  if (weakManualTemplateText(item.reason)) item.reason = '运营手动确认该图需要替换家具留白面板印花。';
  if (weakManualTemplateText(item.replaceArea)) item.replaceArea = '运营确认的留白家具面板或柜门外表面。';
  if (weakManualTemplateText(item.forbiddenArea)) {
    item.forbiddenArea = '背景、人物、文字、墙面地面、柜脚、把手、边框、门缝、抽屉内侧、柜门内侧、包装和道具均保持不变。';
  }
  const reason = card.querySelector('[data-template-field="reason"]');
  const replaceArea = card.querySelector('[data-template-field="replaceArea"]');
  const forbiddenArea = card.querySelector('[data-template-field="forbiddenArea"]');
  if (reason) reason.value = item.reason;
  if (replaceArea) replaceArea.value = item.replaceArea;
  if (forbiddenArea) forbiddenArea.value = item.forbiddenArea;
}

async function openTemplateConfig() {
  if (!state.config.detailSetsPath) return toast('请先选择套图文件夹', true);
  setPage('assets');
  await loadAssetLibraryPreview('detailSetsPath');
  toast('请打开每张套图，拖拽框选需要换印花的柜体');
}

function closeTemplateConfig() {
  state.activeTemplatePath = '';
  $('#templateConfigModal').hidden = true;
}

function activeTemplateItem() {
  return state.templateItems.find(item => item.path === state.activeTemplatePath) || null;
}

function drawTemplateRegions(canvas, regions, protectedRegions, draft = null, draftMode = 'print') {
  if (!canvas) return;
  const context = canvas.getContext('2d');
  const ratio = window.devicePixelRatio || 1;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.save();
  context.scale(ratio, ratio);
  const draw = (values, strokeStyle, fillStyle) => {
    context.strokeStyle = strokeStyle;
    context.fillStyle = fillStyle;
    context.lineWidth = 3;
    for (const region of values || []) {
      const x = region.x * canvas.clientWidth;
      const y = region.y * canvas.clientHeight;
      const width = region.width * canvas.clientWidth;
      const height = region.height * canvas.clientHeight;
      context.fillRect(x, y, width, height);
      context.strokeRect(x, y, width, height);
    }
  };
  draw(regions, '#ff4d4f', 'rgba(255, 77, 79, 0.12)');
  draw(protectedRegions, '#00b8c8', 'rgba(0, 184, 200, 0.14)');
  if (draft) {
    if (draftMode === 'protected') draw([draft], '#00b8c8', 'rgba(0, 184, 200, 0.14)');
    else draw([draft], '#ff4d4f', 'rgba(255, 77, 79, 0.12)');
  }
  context.restore();
}

function initializeTemplateRegionEditor(item) {
  const image = $('#templateRegionImage');
  const canvas = $('#templateRegionCanvas');
  if (!image || !canvas) return;
  const editor = image.closest('.template-region-editor');
  const figure = image.closest('.template-region-figure');
  item.regions = Array.isArray(item.regions) ? item.regions : [];
  item.protectedRegions = Array.isArray(item.protectedRegions) ? item.protectedRegions : [];
  item.regionMode = item.regionMode === 'protected' ? 'protected' : 'print';
  const syncCanvas = () => {
    const rectangle = image.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    canvas.style.width = `${rectangle.width}px`;
    canvas.style.height = `${rectangle.height}px`;
    canvas.width = Math.max(1, Math.round(rectangle.width * ratio));
    canvas.height = Math.max(1, Math.round(rectangle.height * ratio));
    drawTemplateRegions(canvas, item.regions, item.protectedRegions);
  };
  const fitEditorToViewport = () => {
    if (!editor || !figure || !image.naturalWidth || !image.naturalHeight) return;
    const layout = figure.closest('.template-result-layout');
    const caption = figure.querySelector('figcaption');
    const availableWidth = Math.max(1, figure.clientWidth);
    const availableHeight = Math.max(160, (layout?.clientHeight || figure.clientHeight) - (caption?.offsetHeight || 0) - 10);
    const sourceRatio = image.naturalWidth / image.naturalHeight;
    let width = Math.min(availableWidth, availableHeight * sourceRatio);
    let height = width / sourceRatio;
    if (height > availableHeight) {
      height = availableHeight;
      width = height * sourceRatio;
    }
    editor.style.width = `${Math.max(1, Math.floor(width))}px`;
    editor.style.height = `${Math.max(1, Math.floor(height))}px`;
    image.style.width = '100%';
    image.style.height = '100%';
    syncCanvas();
  };
  if (image.complete) requestAnimationFrame(fitEditorToViewport);
  else image.addEventListener('load', fitEditorToViewport, { once: true });
  const observer = new ResizeObserver(fitEditorToViewport);
  observer.observe(figure || image);

  let start = null;
  const pointForEvent = event => {
    const rectangle = canvas.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rectangle.left) / Math.max(1, rectangle.width))),
      y: Math.max(0, Math.min(1, (event.clientY - rectangle.top) / Math.max(1, rectangle.height)))
    };
  };
  const regionFromPoints = (first, second) => ({
    x: Math.min(first.x, second.x),
    y: Math.min(first.y, second.y),
    width: Math.abs(first.x - second.x),
    height: Math.abs(first.y - second.y)
  });
  const startRegion = event => {
    start = pointForEvent(event);
    canvas.setPointerCapture?.(event.pointerId);
  };
  const moveRegion = event => {
    if (!start) return;
    drawTemplateRegions(canvas, item.regions, item.protectedRegions, regionFromPoints(start, pointForEvent(event)), item.regionMode);
  };
  const finishRegion = event => {
    if (!start) return;
    const region = regionFromPoints(start, pointForEvent(event));
    start = null;
    if (region.width >= 0.01 && region.height >= 0.01) {
      if (item.regionMode === 'protected') item.protectedRegions.push(region);
      else {
        item.regions.push(region);
        item.action = 'replace_print';
      }
      applyTemplateActionDefaults(item, document.querySelector('#templateRegionResult [data-template-index]'));
      renderTemplateRegionResult();
    } else {
      drawTemplateRegions(canvas, item.regions, item.protectedRegions);
    }
  };
  const cancelRegion = () => {
    start = null;
    drawTemplateRegions(canvas, item.regions, item.protectedRegions);
  };
  if (typeof window.PointerEvent === 'function') {
    canvas.onpointerdown = startRegion;
    canvas.onpointermove = moveRegion;
    canvas.onpointerup = finishRegion;
    canvas.onpointercancel = cancelRegion;
  } else {
    canvas.onmousedown = event => {
      startRegion(event);
      window.addEventListener('mouseup', finishRegion, { once: true });
    };
    canvas.onmousemove = moveRegion;
    canvas.onmouseup = finishRegion;
    canvas.onmouseleave = event => {
      if (start && event.buttons === 0) cancelRegion();
    };
  }
}

function renderTemplateRegionResult() {
  const item = activeTemplateItem();
  const container = $('#templateRegionResult');
  if (!item) {
    container.innerHTML = '<div class="empty-state"><b>没有找到这张套图</b><span>请关闭后刷新素材库。</span></div>';
    $('#templateConfigStatus').textContent = '套图不存在';
    $('#saveTemplateRegionsButton').disabled = true;
    return;
  }
  const itemIndex = state.templateItems.indexOf(item);
  item.regions = Array.isArray(item.regions) ? item.regions : [];
  item.protectedRegions = Array.isArray(item.protectedRegions) ? item.protectedRegions : [];
  item.regionMode = item.regionMode === 'protected' ? 'protected' : 'print';
  $('#templateConfigTitle').textContent = `框选区域 · ${item.name}`;
  $('#templateConfigPath').textContent = item.relativePath;
  $('#templateConfigStatus').textContent = item.regions.length
    ? `已框选 ${item.regions.length} 个区域，Image2 将识别框内可见柜面`
    : normalizeTemplateUiAction(item.action) === 'exclude' ? '这张图片不会输出' : '未框选，将原图直接复制到成品';
  $('#saveTemplateRegionsButton').disabled = false;
  container.innerHTML = `<div class="template-result-layout">
    <figure class="template-region-figure"><div class="template-region-editor"><img id="templateRegionImage" src="${escapeHtml(item.previewUrl || item.templateUrl)}" alt="${escapeHtml(item.relativePath)}"><canvas id="templateRegionCanvas" aria-label="拖拽框选柜体区域"></canvas></div><figcaption>${escapeHtml(item.relativePath)}</figcaption></figure>
    <section class="template-region-tools" data-template-index="${itemIndex}">
      <span class="eyebrow">MANUAL ROI</span><h3>先框柜面，再保护把手</h3>
      <p>红框用于定位需要套印花的柜门或抽屉正面；青框用于标记必须原样保留的把手、旋钮、锁具和五金。两类框都只是语义提示，不会作为矩形贴片覆盖原图。</p>
      <div class="template-region-mode"><button class="${item.regionMode === 'print' ? 'primary' : 'secondary'}" type="button" data-region-mode="print">红框：印花柜面</button><button class="${item.regionMode === 'protected' ? 'primary' : 'secondary'}" type="button" data-region-mode="protected">青框：把手/五金</button></div>
      <div class="template-region-count"><b>${item.regions.length}</b><span>个印花区</span><b class="protected">${item.protectedRegions.length}</b><span>个五金保护区</span></div>
      <div class="template-region-actions"><button class="secondary" type="button" data-region-undo${(item.regionMode === 'protected' ? item.protectedRegions : item.regions).length ? '' : ' disabled'}>撤销当前类型</button><button class="secondary" type="button" data-region-clear${item.regions.length || item.protectedRegions.length ? '' : ' disabled'}>清空全部框选</button></div>
      <div class="template-region-output-actions"><button class="${normalizeTemplateUiAction(item.action) === 'copy_original' && !item.regions.length ? 'primary' : 'secondary'}" type="button" data-template-set-action="copy_original">保留原图</button><button class="${normalizeTemplateUiAction(item.action) === 'exclude' ? 'primary' : 'secondary'}" type="button" data-template-set-action="exclude">不输出</button></div>
      <small>建议：闭合柜体用一个红框；开抽屉按每个可见抽屉外立面分别画红框；每个把手单独画紧凑青框。无红框时逐字节复制原图，不调用生图 API。</small>
    </section>
  </div>`;
  initializeTemplateRegionEditor(item);
}

async function openTemplateRegionEditor(pathValue) {
  const path = String(pathValue || '');
  if (!path) return;
  if (!state.templateItems.some(item => item.path === path)) {
    await loadAssetLibraryPreview('detailSetsPath', { preserveSelection: true, force: true });
  }
  state.activeTemplatePath = path;
  $('#templateConfigModal').hidden = false;
  renderTemplateRegionResult();
}

async function saveTemplateRegions() {
  const item = activeTemplateItem();
  if (!item) return toast('没有可保存的框选结果', true);
  $('#saveTemplateRegionsButton').disabled = true;
  try {
    const folder = templateFolderPathForItem(item);
    await window.caishen.saveTemplateRegions({
      folder,
      items: [{
        relativePath: item.relativePath,
        action: item.regions?.length ? 'replace_print' : normalizeTemplateUiAction(item.action),
        reason: item.reason,
        replaceArea: item.replaceArea,
        forbiddenArea: item.forbiddenArea,
        regions: item.regions,
        protectedRegions: item.protectedRegions
      }]
    });
    state.assetPreviewCache.delete('detailSetsPath');
    await loadAssetLibraryPreview('detailSetsPath', { preserveSelection: true, force: true });
    renderTemplateRegionResult();
    if (folder === state.config.detailSetsPath) await loadTemplatePreparation();
    $('#templateConfigStatus').textContent = '框选结果已保存';
    toast('框选结果已保存');
  } catch (error) {
    toast(errorText(error), true);
  } finally {
    $('#saveTemplateRegionsButton').disabled = false;
  }
}

async function runReviewGeneration(onlyMissing, folders) {
  state.stopGenerationRequested = false;
  const targets = Array.isArray(folders)
    ? [...new Set(folders)]
    : state.reviewTaskActivated && state.activeReview ? [state.activeReview.folder] : [];
  if (!targets.length) return toast('请先选择任务', true);
  const now = new Date().toISOString();
  const applyLocalProgress = (folder, update = {}) => {
    const review = state.reviews.find(item => item.folder === folder) || (state.activeReview?.folder === folder ? state.activeReview : null);
    if (!review) return;
    const existing = review.generationProgress || {};
    const total = Math.max(1, Number(update.total) || Number(existing.total) || review.jobs?.length || review.images?.length || 1);
    review.generationProgress = {
      ...existing,
      folder,
      total,
      current: Math.max(0, Number(update.current ?? existing.current) || 0),
      percent: Math.max(0, Math.min(100, Number(update.percent ?? existing.percent) || 0)),
      pending: Math.max(0, Number(update.pending ?? total) || 0),
      phase: update.phase || existing.phase || 'preparing',
      message: normalizeProgressMessage(update.message || existing.message || (onlyMissing ? '正在补生成缺失图片' : '正在重新生成整套图')),
      startedAt: update.startedAt || existing.startedAt || now,
      updatedAt: update.updatedAt || now,
      activeRelativePath: update.activeRelativePath || existing.activeRelativePath || ''
    };
    if (state.activeReview?.folder === folder) state.activeReview = review;
  };
  try {
    applyLocalProgress(targets[0], {
      phase: 'preparing',
      current: 0,
      percent: 0,
      pending: Math.max(1, state.reviews.find(item => item.folder === targets[0])?.jobs?.length || 1),
      message: onlyMissing ? '正在补生成缺失图片，任务已提交' : '正在重新生成整套图，任务已提交'
    });
    renderReviewList();
    renderReviewStagePreservingScroll();
    renderReviewGenerationControls();
    toast(onlyMissing ? '正在生成缺失套图' : '正在重新生成整套图');
    const results = await window.caishen.generateTemplates({ folders: targets, onlyMissing }, (_progress, job) => {
      const progress = _progress || {};
      const folder = progress.folder || targets[0];
      if (folder) {
        applyLocalProgress(folder, {
          ...progress,
          phase: progress.phase || (job?.status === 'queued' ? 'preparing' : 'generating'),
          message: progress.message || (onlyMissing ? '正在补生成缺失图片' : '正在重新生成整套图'),
          updatedAt: progress.updatedAt || new Date().toISOString()
        });
        renderReviewList();
        renderReviewStagePreservingScroll();
      }
      if (job?.id && ['queued', 'running'].includes(job.status)) {
        state.activeReviewGenerationJobId = job.id;
        renderReviewGenerationControls();
      }
    });
    state.activeReviewGenerationJobId = '';
    renderReviewGenerationControls();
    await loadReviews();
    const failures = (results || []).flatMap(result => result?.failures || []);
    if (failures.length) toast(`生成结束，${failures.length} 张失败：${failures[0]}`, true);
    else toast(onlyMissing ? '缺失套图生成完成' : '整套图重新生成完成');
  } catch (error) {
    state.activeReviewGenerationJobId = '';
    renderReviewGenerationControls();
    toast(errorText(error), true);
    await loadReviews();
  }
}

function activePrompt() {
  return state.promptSettings?.prompts?.find(item => item.id === state.activePromptId) || null;
}

function renderPromptSettingList() {
  const prompts = state.promptSettings?.prompts || [];
  $('#promptCount').textContent = `${prompts.length} 项`;
  $('#promptSettingList').innerHTML = prompts.length
    ? prompts.map(item => `<button class="prompt-setting-item${item.id === state.activePromptId ? ' active' : ''}" data-prompt-id="${escapeHtml(item.id)}"><b>${escapeHtml(item.title)}</b><span>${escapeHtml(item.group)}${item.customized ? '<em class="customized"> · 已修改</em>' : ''}</span></button>`).join('')
    : '<div class="empty-inline">没有可配置的提示词</div>';
}

function renderPromptEditor() {
  const prompt = activePrompt();
  const canEdit = canManagePrompts();
  $('#promptEditor').disabled = !prompt || !canEdit;
  $('#resetCurrentPromptButton').hidden = !canEdit;
  $('#resetAllPromptsButton').hidden = !canEdit;
  $('#resetCurrentPromptButton').disabled = !prompt || !prompt.customized || !canEdit;
  $('#promptEditorTitle').textContent = prompt?.title || '选择一条提示词';
  $('#promptEditorGroup').textContent = prompt?.group || 'PROMPT';
  $('#promptEditorDescription').textContent = prompt?.description || '左侧列出网站当前实际使用的固定提示词。';
  $('#promptEditor').value = prompt?.value || '';
  $('#promptCharacterCount').textContent = `${prompt?.value?.length || 0} 字`;
  const placeholders = prompt?.placeholders || [];
  $('#promptPlaceholderRow').hidden = placeholders.length === 0;
  $('#promptPlaceholderList').innerHTML = placeholders.map(value => `<code class="prompt-placeholder">${escapeHtml(value)}</code>`).join('');
  $('#promptSaveStatus').className = '';
  $('#promptSaveStatus').textContent = prompt
    ? canEdit
      ? (prompt.customized ? '已使用自定义内容' : '当前使用系统默认')
      : '只读查看'
    : '尚未选择';
}

async function loadPromptSettings() {
  if (!canViewPrompts()) return;
  try {
    state.promptSettings = await window.caishen.getPromptSettings();
    if (!state.activePromptId || !state.promptSettings.prompts.some(item => item.id === state.activePromptId)) {
      state.activePromptId = state.promptSettings.prompts[0]?.id || '';
    }
    renderPromptSettingList();
    renderPromptEditor();
  } catch (error) {
    $('#promptSettingList').innerHTML = `<div class="empty-inline">${escapeHtml(errorText(error))}</div>`;
    toast(errorText(error), true);
  }
}

function selectPromptSetting(id) {
  if (!state.promptSettings?.prompts.some(item => item.id === id)) return;
  state.activePromptId = id;
  renderPromptSettingList();
  renderPromptEditor();
}

function schedulePromptSave(prompt, value) {
  if (!canManagePrompts()) {
    renderPromptEditor();
    return;
  }
  const previousValue = prompt.value;
  prompt.value = value;
  prompt.customized = true;
  $('#promptCharacterCount').textContent = `${value.length} 字`;
  $('#promptSaveStatus').className = 'saving';
  $('#promptSaveStatus').textContent = '等待自动保存…';
  renderPromptSettingList();
  clearTimeout(promptSaveTimers.get(prompt.id));
  promptSaveTimers.set(prompt.id, setTimeout(async () => {
    promptSaveTimers.delete(prompt.id);
    if (state.activePromptId === prompt.id) {
      $('#promptSaveStatus').className = 'saving';
      $('#promptSaveStatus').textContent = '正在保存…';
    }
    try {
      await window.caishen.savePromptSetting(prompt.id, value);
      if (state.activePromptId === prompt.id && activePrompt()?.value === value) {
        $('#promptSaveStatus').className = 'saved';
        $('#promptSaveStatus').textContent = '已自动保存 · 新任务立即生效';
        $('#resetCurrentPromptButton').disabled = false;
      }
    } catch (error) {
      if (state.activePromptId === prompt.id) {
        $('#promptSaveStatus').className = 'error';
        $('#promptSaveStatus').textContent = `保存失败：${errorText(error)}`;
      }
    }
  }, 650));
}

async function resetCurrentPrompt() {
  if (!canManagePrompts()) return toast('只有超级管理员可以修改提示词', true);
  const prompt = activePrompt();
  if (!prompt || !await brandConfirm(`确定将“${prompt.title}”恢复为系统默认吗？`, { title: '恢复默认提示词' })) return;
  clearTimeout(promptSaveTimers.get(prompt.id));
  promptSaveTimers.delete(prompt.id);
  try {
    state.promptSettings = await window.caishen.resetPromptSetting(prompt.id);
    renderPromptSettingList();
    renderPromptEditor();
    toast('已恢复系统默认提示词');
  } catch (error) { toast(errorText(error), true); }
}

async function resetAllPrompts() {
  if (!canManagePrompts()) return toast('只有超级管理员可以修改提示词', true);
  if (!await brandConfirm('确定将全部提示词恢复为系统默认吗？当前自定义内容会被清除。', { title: '恢复全部提示词', danger: true, confirmText: '恢复默认' })) return;
  for (const timer of promptSaveTimers.values()) clearTimeout(timer);
  promptSaveTimers.clear();
  try {
    state.promptSettings = await window.caishen.resetPromptSetting('');
    state.activePromptId = state.promptSettings.prompts[0]?.id || '';
    renderPromptSettingList();
    renderPromptEditor();
    toast('全部提示词已恢复默认');
  } catch (error) { toast(errorText(error), true); }
}

function renderSettingsTabs(name = state.settingsTab) {
  if (state.currentUser?.role === 'admin' && name === 'general') name = 'api';
  else if (name === 'api' && !isTeamAdmin()) name = 'general';
  else if (name === 'billing' && !isSuperAdmin()) name = 'general';
  else if (name === 'team' && !isTeamAdmin()) name = 'general';
  state.settingsTab = name;
  $$('[data-settings-tab]').forEach(button => {
    const active = button.dataset.settingsTab === name;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  $$('[data-settings-panel]').forEach(panel => {
    panel.hidden = panel.dataset.settingsPanel !== name;
  });
  $('.settings-toolbar-actions').hidden = ['billing', 'team'].includes(name) || !isSuperAdmin();
  if (name === 'api' && isTeamAdmin()) {
    if (!isSuperAdmin()) renderApiSettings();
    loadRelayChoices();
  }
  if (name === 'team') loadTeamUsers();
  if (name === 'billing') Promise.all([loadBillingAdmin(), loadAlipayAdmin()]);
}

function renderBillingAdmin() {
  const data = state.billingAdmin;
  if (!data) return;
  const rules = data.rules || {};
  const users = data.users || [];
  const relays = data.relays || [];
  if (!relays.some(relay => relay.id === state.billingAdminRelayId)) state.billingAdminRelayId = data.activeRelayId || relays[0]?.id || '';
  const activeRelay = relays.find(relay => relay.id === state.billingAdminRelayId) || {};
  if (state.billingAdminFilter && !users.some(user => user.id === state.billingAdminFilter)) state.billingAdminFilter = '';
  const filteredUsers = state.billingAdminFilter ? users.filter(user => user.id === state.billingAdminFilter) : users;
  const visibleWorkspaceIds = new Set(filteredUsers.map(user => user.workspaceId));
  const filteredTransactions = state.billingAdminFilter
    ? (data.transactions || []).filter(entry => visibleWorkspaceIds.has(entry.workspaceId) && entry.relayId === state.billingAdminRelayId)
    : (data.transactions || []).filter(entry => entry.relayId === state.billingAdminRelayId);
  $('.billing-settings-grid').hidden = false;
  $('.billing-rule-card').hidden = !isSuperAdmin();
  $('#clearBillingLedgerButton').hidden = !isSuperAdmin();
  $('#billingEnabled').checked = rules.enabled === true;
  $('#billingStatusBadge').textContent = isSuperAdmin() ? (rules.enabled ? '计费中' : '未启用') : '余额查看';
  $('#billingStatusBadge').classList.toggle('ready', Boolean(rules.enabled));
  $('#billingUserFilter').innerHTML = `<option value="">全部人员</option>${users.map(user => `<option value="${escapeHtml(user.id)}"${user.id === state.billingAdminFilter ? ' selected' : ''}>${escapeHtml(user.displayName || user.username)} · ${roleLabel(user.role)}</option>`).join('')}`;
  const relayFilter = $('#billingRelayFilter');
  relayFilter.innerHTML = relays.length
    ? relays.map(relay => `<option value="${escapeHtml(relay.id)}"${relay.id === state.billingAdminRelayId ? ' selected' : ''}>${escapeHtml(relay.name)} · ${feeRangeLabel(relay.imagePriceMinMinor, relay.imagePriceMaxMinor)}/张</option>`).join('')
    : '<option value="">暂无可用中转站</option>';
  relayFilter.disabled = relays.length === 0;
  $('#billingAccountCount').textContent = state.billingAdminFilter ? `${filteredUsers.length}/${users.length} 个账号` : `${users.length} 个账号`;
  $('#billingAccountList').innerHTML = filteredUsers.map(user => {
    const canAdjust = isSuperAdmin() || (state.currentUser?.role === 'admin' && user.role === 'member' && (!user.parentUserId || user.parentUserId === state.currentUser.id));
    const wallet = user.billing?.wallets?.find(item => item.relayId === state.billingAdminRelayId) || { balanceMinor: 0 };
    return `
    <div class="billing-account-row" data-billing-user="${escapeHtml(user.id)}">
      <div class="billing-account-copy"><b>${escapeHtml(user.displayName || user.username)}${user.id === state.currentUser?.id ? '（当前）' : ''}</b><span>${escapeHtml(user.username)} · ${roleLabel(user.role)}${user.active ? '' : ' · 已停用'}</span></div>
      <div class="billing-account-balance"><small>${escapeHtml(activeRelay.name || '中转站')}</small>${formatMoney(wallet.balanceMinor)}</div>
      ${canAdjust ? `<div class="billing-adjust-controls"><input type="number" step="0.000001" min="-${moneyMinorToInput(wallet.balanceMinor)}" placeholder="充值或扣减金额" aria-label="调整金额"><button class="secondary" type="button" data-adjust-billing="${escapeHtml(user.id)}">确认调整</button></div>` : '<div class="billing-adjust-note">仅查看</div>'}
    </div>`;
  }).join('') || '<div class="empty-inline">没有符合筛选的账号</div>';
  const userMap = new Map(users.map(user => [user.workspaceId, user]));
  $('#billingLedgerList').innerHTML = renderBillingLedger(filteredTransactions, userMap);
}

function billingAdminWithRelayFallback(billing, relayChoices) {
  const data = billing || {};
  const primaryRelays = Array.isArray(data.relays) ? data.relays : [];
  const fallbackRelays = Array.isArray(relayChoices?.relays) ? relayChoices.relays : [];
  if (primaryRelays.length || !fallbackRelays.length) return data;
  return {
    ...data,
    relays: fallbackRelays,
    activeRelayId: data.activeRelayId || relayChoices.activeRelayId || fallbackRelays[0]?.id || ''
  };
}

async function loadBillingAdmin() {
  if (!isTeamAdmin()) return;
  try {
    const [billing, relayChoices] = await Promise.all([
      window.caishen.getBillingAdmin(),
      window.caishen.getRelayChoices().catch(() => state.relayChoices)
    ]);
    state.relayChoices = relayChoices || state.relayChoices;
    state.billingAdmin = billingAdminWithRelayFallback(billing, state.relayChoices);
    renderBillingAdmin();
  } catch (error) { toast(errorText(error), true); }
}

async function saveBillingRules() {
  if (!isSuperAdmin()) return toast('只有超级管理员可以修改计费规则', true);
  const button = $('#saveBillingRulesButton');
  button.disabled = true;
  button.textContent = '保存中…';
  try {
    await window.caishen.saveBillingRules({
      enabled: $('#billingEnabled').checked
    });
    await Promise.all([loadBillingAdmin(), loadBillingSummary()]);
    toast('计费规则已保存');
  } catch (error) { toast(errorText(error), true); }
  finally {
    button.disabled = false;
    button.textContent = '保存计费开关';
  }
}

async function clearBillingLedger() {
  if (!isSuperAdmin()) return toast('只有超级管理员可以清空费用流水', true);
  if (!await brandConfirm('确定清空全部费用流水吗？此操作只删除明细记录，不会修改任何账号算力余额。', { title: '清空费用流水', danger: true, confirmText: '确认清空' })) return;
  const button = $('#clearBillingLedgerButton');
  button.disabled = true;
  try {
    const result = await window.caishen.clearBillingLedger();
    await Promise.all([loadBillingAdmin(), loadBillingSummary()]);
    toast(`已清空 ${Number(result?.cleared || 0)} 条费用流水`);
  } catch (error) {
    toast(errorText(error), true);
  } finally {
    button.disabled = false;
  }
}

async function adjustBillingBalance(button) {
  const row = button.closest('[data-billing-user]');
  const input = row?.querySelector('input');
  const amount = Number(input?.value);
  if (!Number.isFinite(amount) || amount === 0) return toast('请输入非零调整金额', true);
  if (!isSuperAdmin() && amount <= 0) return toast('管理员只能划拨正数算力余额', true);
  const amountMinor = Math.round(amount * BILLING_AMOUNT_SCALE);
  button.disabled = true;
  try {
    await window.caishen.adjustBillingBalance({
      userId: button.dataset.adjustBilling,
      relayId: state.billingAdminRelayId,
      amountMinor,
      amountUsd: amount,
      description: amountMinor > 0 ? '账户充值到账' : '算力余额扣减'
    });
    await Promise.all([loadBillingAdmin(), loadBillingSummary()]);
    toast(amountMinor > 0 ? '算力余额已充值' : '算力余额已扣减');
  } catch (error) {
    button.disabled = false;
    toast(errorText(error), true);
  }
}

function renderTeamUsers() {
  const activeRelayId = state.billingAdmin?.activeRelayId || state.relayChoices?.activeRelayId || '';
  $('#teamUserCount').textContent = `${state.teamUsers.length} 人`;
  $('#requireAllPasswordChangesButton').hidden = !isSuperAdmin();
  $('#teamUserList').innerHTML = state.teamUsers.length ? state.teamUsers.map(user => `
    <div class="team-user-row${user.active ? '' : ' inactive'}" data-team-user="${escapeHtml(user.id)}">
      <div><b>${escapeHtml(user.displayName || user.username)}${user.id === state.currentUser?.id ? '（当前）' : ''}</b><span>${escapeHtml(user.username)} · ${roleLabel(user.role)} · ${user.active ? '可登录' : '已停用'}${user.billing ? ` · 当前线路 ${formatMoney(user.billing.wallets?.find(wallet => wallet.relayId === activeRelayId)?.balanceMinor || 0)}` : ''}</span>${isSuperAdmin() ? `<span class="team-user-password-status">${user.role === 'superadmin' ? '密码：安全加密 · 请使用右下角改密' : user.passwordChangeRequired ? `密码状态：下次登录必须用原密码确认${user.passwordRecorded ? ' · 当前记录可查' : ' · 完成后可查'}` : `密码状态：用户已完成改密 · 已加密记录${user.passwordChangedAt ? ` · ${escapeHtml(formatLocalDateTime(user.passwordChangedAt))}` : ''}`}</span>${user.role === 'superadmin' ? '' : `<span class="team-user-password-reason">改密原因：${escapeHtml(user.passwordChangeReason || '账号安全升级')}</span>`}` : ''}</div>
      <div class="team-user-actions">
        ${user.id === state.currentUser?.id ? '' : `${isSuperAdmin() ? `${user.passwordRecorded ? `<button class="secondary" type="button" data-team-user-view-password="${escapeHtml(user.id)}">查看密码</button>` : ''}<button class="secondary" type="button" data-team-user-require-password="${escapeHtml(user.id)}">强制下次登录改密</button>` : ''}<button class="secondary" type="button" data-team-user-edit="${escapeHtml(user.id)}">编辑</button><button class="secondary${user.active ? ' danger-outline' : ''}" type="button" data-team-user-active="${escapeHtml(user.id)}" data-active="${user.active ? 'false' : 'true'}">${user.active ? '停用' : '恢复'}</button><button class="secondary danger-outline" type="button" data-team-user-delete="${escapeHtml(user.id)}">删除</button>`}
      </div>
    </div>`).join('') : '<div class="empty-inline">还没有团队账号</div>';
  renderTeamBalanceTransfer();
}

function renderTeamBalanceTransfer() {
  const card = $('#teamBalanceTransferCard');
  if (!card) return;
  const enabled = state.currentUser?.role === 'admin';
  card.hidden = !enabled;
  if (!enabled) return;
  const users = state.teamUsers.filter(user => user.id === state.currentUser?.id || user.role === 'member');
  const transferForm = card.querySelector('.team-balance-transfer-form');
  const emptyHint = $('#teamBalanceTransferEmpty');
  transferForm.hidden = users.length < 2;
  emptyHint.hidden = users.length >= 2;
  if (users.length < 2) return;
  const relays = state.billingAdmin?.relays || [];
  const relaySelect = $('#teamTransferRelay');
  const previousRelayId = relaySelect.value;
  relaySelect.innerHTML = relays.map(relay => `<option value="${escapeHtml(relay.id)}">${escapeHtml(relay.name)} · ${feeRangeLabel(relay.imagePriceMinMinor, relay.imagePriceMaxMinor)}/张</option>`).join('');
  relaySelect.value = relays.some(relay => relay.id === previousRelayId) ? previousRelayId : state.billingAdmin?.activeRelayId || relays[0]?.id || '';
  const relayId = relaySelect.value;
  const fromSelect = $('#teamTransferFrom');
  const toSelect = $('#teamTransferTo');
  const previousFrom = fromSelect.value;
  const previousTo = toSelect.value;
  const optionForUser = user => {
    const wallet = user.billing?.wallets?.find(item => item.relayId === relayId);
    return `<option value="${escapeHtml(user.id)}">${escapeHtml(user.displayName || user.username)}${user.id === state.currentUser?.id ? '（管理员）' : ''} · ${formatMoney(wallet?.balanceMinor || 0)}</option>`;
  };
  fromSelect.innerHTML = users.map(optionForUser).join('');
  fromSelect.value = users.some(user => user.id === previousFrom) ? previousFrom : state.currentUser?.id || users[0]?.id || '';
  const targetUsers = users.filter(user => user.id !== fromSelect.value);
  toSelect.innerHTML = targetUsers.map(optionForUser).join('');
  toSelect.value = targetUsers.some(user => user.id === previousTo) ? previousTo : targetUsers[0]?.id || '';
  $('#teamTransferButton').disabled = false;
  relaySelect.onchange = renderTeamBalanceTransfer;
  fromSelect.onchange = renderTeamBalanceTransfer;
}

async function loadTeamUsers() {
  if (!isTeamAdmin()) return;
  try {
    const [users, billing, relayChoices] = await Promise.all([
      window.caishen.listUsers(),
      window.caishen.getBillingAdmin().catch(() => null),
      window.caishen.getRelayChoices().catch(() => state.relayChoices)
    ]);
    state.relayChoices = relayChoices || state.relayChoices;
    state.billingAdmin = billingAdminWithRelayFallback(billing, state.relayChoices);
    const byId = new Map((billing?.users || []).map(user => [user.id, user.billing]));
    state.teamUsers = users.map(user => ({ ...user, billing: byId.get(user.id) }));
    renderTeamUsers();
  } catch (error) { toast(errorText(error), true); }
}

async function createTeamUser(event) {
  event.preventDefault();
  const button = $('#createUserButton');
  button.disabled = true;
  button.textContent = '创建中…';
  try {
    await window.caishen.createUser({
      displayName: $('#newUserDisplayName').value.trim(),
      username: $('#newUsername').value.trim(),
      password: $('#newUserPassword').value,
      role: isSuperAdmin() ? $('#newUserRole').value : 'member'
    });
    $('#createUserForm').reset();
    await loadTeamUsers();
    toast('团队账号已创建');
  } catch (error) { toast(errorText(error), true); }
  finally {
    button.disabled = false;
    button.textContent = '创建账号';
  }
}

async function toggleTeamUser(button) {
  button.disabled = true;
  try {
    await window.caishen.updateUser(button.dataset.teamUserActive, { active: button.dataset.active === 'true' });
    await loadTeamUsers();
  } catch (error) {
    button.disabled = false;
    toast(errorText(error), true);
  }
}

async function editTeamUser(id) {
  const user = state.teamUsers.find(item => item.id === id);
  if (!user) return;
  const displayName = await brandPrompt('修改姓名或昵称', user.displayName || user.username, { inputLabel: '姓名或昵称' });
  if (displayName === null) return;
  let role = user.role;
  if (isSuperAdmin() && user.role !== 'superadmin') {
    const nextRole = await brandPrompt('修改账号角色', user.role, { inputLabel: '请输入 admin 或 member' });
    if (nextRole === null) return;
    role = String(nextRole).trim();
    if (!['admin', 'member'].includes(role)) return toast('角色只能填写 admin 或 member', true);
  }
  const payload = { displayName: displayName.trim(), role };
  try {
    await window.caishen.updateUser(id, payload);
    await loadTeamUsers();
    toast('账号已更新');
  } catch (error) {
    toast(errorText(error), true);
  }
}

async function requireTeamUserPasswordChange(id) {
  if (!isSuperAdmin()) return toast('只有超级管理员可以要求用户强制改密', true);
  const user = state.teamUsers.find(item => item.id === id);
  if (!user || user.id === state.currentUser?.id) return;
  if (!await brandConfirm(`确定要求 ${user.displayName || user.username} 下次登录时强制改密吗？\n用户需要输入原账号、原密码和新密码。`, { title: '要求用户修改密码' })) return;
  try {
    await window.caishen.requireUserPasswordChange(id);
    await loadTeamUsers();
    toast('已设置为下次登录强制改密');
  } catch (error) {
    toast(errorText(error), true);
  }
}

async function viewTeamUserPassword(id) {
  if (!isSuperAdmin()) return;
  const user = state.teamUsers.find(item => item.id === id);
  if (!user?.passwordRecorded) return toast('该账号还没有可查看的密码记录', true);
  const currentPassword = await brandPrompt('验证超级管理员身份', '', { inputLabel: '当前超级管理员密码', inputType: 'password' });
  if (currentPassword === null) return;
  try {
    const result = await window.caishen.revealUserPassword(id, currentPassword);
    let copied = false;
    try {
      await window.caishen.copyText(result.password);
      copied = true;
    } catch {}
    await brandPrompt(`${user.displayName || user.username} 的已记录密码`, result.password, { message: copied ? '密码已复制到剪贴板。' : '可手动复制下方密码。', inputLabel: '登录密码', readOnly: true, confirmText: '关闭', cancelText: '' });
  } catch (error) {
    toast(errorText(error), true);
  }
}

async function requireAllTeamPasswordChanges() {
  if (!isSuperAdmin()) return;
  if (!await brandConfirm('确定要求所有管理员和成员下次登录时强制改密吗？\n超级管理员自身不受影响。', { title: '批量要求修改密码' })) return;
  try {
    const result = await window.caishen.requireAllPasswordChanges();
    await loadTeamUsers();
    toast(`已要求 ${Number(result?.affected || 0)} 个账号下次登录强制改密`);
  } catch (error) {
    toast(errorText(error), true);
  }
}

async function deleteTeamUser(id) {
  const user = state.teamUsers.find(item => item.id === id);
  if (!user || user.id === state.currentUser?.id) return;
  const name = user.displayName || user.username || '该账号';
  if (!await brandConfirm(`确定删除 ${name}？\n只删除登录账号，不删除素材和历史任务。`, { title: '删除团队账号', danger: true, confirmText: '删除账号' })) return;
  try {
    await window.caishen.deleteUser(id);
    await loadTeamUsers();
    toast('账号已删除');
  } catch (error) {
    toast(errorText(error), true);
  }
}

async function transferTeamBalance() {
  if (state.currentUser?.role !== 'admin') return toast('只有管理员可以划拨员工余额', true);
  const fromUserId = $('#teamTransferFrom').value;
  const toUserId = $('#teamTransferTo').value;
  const relayId = $('#teamTransferRelay').value;
  const amountInput = $('#teamTransferAmount');
  const amount = Number(amountInput?.value);
  if (!relayId || !fromUserId || !toUserId) return toast('请选择中转站、转出和转入账号', true);
  if (fromUserId === toUserId) return toast('转出和转入账号不能相同', true);
  if (!Number.isFinite(amount) || amount <= 0) return toast('请输入大于 0 的划拨金额', true);
  const fromUser = state.teamUsers.find(user => user.id === fromUserId);
  const toUser = state.teamUsers.find(user => user.id === toUserId);
  const message = `确定从“${fromUser?.displayName || fromUser?.username || '转出账号'}”划拨 $${amount.toFixed(6)} 给“${toUser?.displayName || toUser?.username || '转入账号'}”吗？`;
  if (!await brandConfirm(message, { title: '确认算力划拨', confirmText: '确认划拨' })) return;
  const button = $('#teamTransferButton');
  button.disabled = true;
  button.textContent = '划拨中…';
  try {
    await window.caishen.transferBillingBalance({
      fromUserId,
      toUserId,
      relayId,
      amountMinor: Math.round(amount * BILLING_AMOUNT_SCALE),
      amountUsd: amount
    });
    amountInput.value = '';
    await Promise.all([loadTeamUsers(), loadBillingSummary()]);
    toast('划拨完成：转出账号已扣减，转入账号已到账');
  } catch (error) {
    toast(errorText(error), true);
  } finally {
    button.disabled = false;
    button.textContent = '确认划拨';
  }
}

function newRelayDraft() {
  return {
    _unsaved: true,
    id: `relay-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    name: '新中转站', description: '', enabled: true, baseUrl: '', imageModel: '', analysisModel: 'gpt-5-6',
    healthPath: '/models', modelsPath: '/models',
    imagePriceMinMinor: 0, imagePriceMaxMinor: 0,
    llmPriceMinMinor: 0, llmPriceMaxMinor: 0,
    customerCnyPerUsd: 7, upstreamImageCostCnyMicro: 0, upstreamAnalysisCostCnyMicro: 0
  };
}

function relayRowPayload(row) {
  const read = field => row.querySelector(`[data-relay-field="${field}"]`);
  const imagePriceMinMinor = moneyInputToMinor(read('imagePriceMinMinor')?.value || '0', '最低扣费');
  const imagePriceMaxMinor = moneyInputToMinor(read('imagePriceMaxMinor')?.value || '0', '最高扣费');
  if (imagePriceMaxMinor < imagePriceMinMinor) throw new Error('最高扣费不能低于最低扣费');
  const llmPriceMinMinor = moneyInputToMinor(read('llmPriceMinMinor')?.value || '0', 'AI 分析最低扣费');
  const llmPriceMaxMinor = moneyInputToMinor(read('llmPriceMaxMinor')?.value || '0', 'AI 分析最高扣费');
  if (llmPriceMaxMinor < llmPriceMinMinor) throw new Error('AI 分析最高扣费不能低于最低扣费');
  const customerCnyPerUsd = Number(read('customerCnyPerUsd')?.value || 0);
  if (!Number.isFinite(customerCnyPerUsd) || customerCnyPerUsd <= 0 || customerCnyPerUsd > 1000) throw new Error('请填写有效的站内余额人民币折算汇率');
  const upstreamImageCostCnyMicro = moneyInputToMinor(read('upstreamImageCostCnyMicro')?.value || '0', '上游每张采购成本');
  const upstreamAnalysisCostCnyMicro = moneyInputToMinor(read('upstreamAnalysisCostCnyMicro')?.value || '0', '上游每次 AI 分析成本');
  return {
    id: row.dataset.relayId,
    name: read('name')?.value.trim() || '未命名中转站',
    description: read('description')?.value.trim() || '',
    enabled: read('enabled')?.checked !== false,
    baseUrl: read('baseUrl')?.value.trim() || '',
    imageApiKey: read('imageKey')?.value.trim() || '',
    imageModel: read('imageModel')?.value.trim() || '',
    analysisModel: read('analysisModel')?.value.trim() || '',
    healthPath: read('healthPath')?.value.trim() || '/models',
    modelsPath: read('modelsPath')?.value.trim() || '/models',
    imagePriceMinMinor,
    imagePriceMaxMinor,
    llmPriceMinMinor,
    llmPriceMaxMinor,
    customerCnyPerUsd: Number(customerCnyPerUsd.toFixed(6)),
    upstreamImageCostCnyMicro,
    upstreamAnalysisCostCnyMicro
  };
}

function collectRelaysFromForm() {
  const currentById = new Map((state.apiSettings?.relays || []).map(item => [item.id, item]));
  return $$('.relay-station-editor').map(row => ({
    ...(currentById.get(row.dataset.relayId) || {}),
    ...relayRowPayload(row)
  }));
}

function currentRelayChoices() {
  if (isSuperAdmin()) return state.apiSettings?.relays || [];
  return state.relayChoices?.relays || [];
}

function renderRelayStations() {
  const list = $('#relayStationList');
  if (!list) return;
  const relays = currentRelayChoices();
  const activeId = isSuperAdmin() ? state.apiSettings?.activeRelayId : state.relayChoices?.activeRelayId;
  state.selectedRelayId = activeId || '';
  if (!relays.length) {
    list.innerHTML = isSuperAdmin() ? '<div class="empty-inline">请添加第一个中转站。</div>' : '<div class="empty-inline">超级管理员尚未启用中转站。</div>';
    return;
  }
  if (!isSuperAdmin()) {
    list.innerHTML = relays.map(item => `
      <button class="relay-station-choice${item.id === activeId ? ' active' : ''}" type="button" data-select-relay="${escapeHtml(item.id)}">
        <span><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.description || '可用中转站')}</small></span>
        <em>${item.id === activeId ? '当前使用' : '切换'}</em>
      </button>`).join('');
    return;
  }
  list.innerHTML = relays.map(item => {
    return `
      <article class="relay-station-editor${item.id === activeId ? ' active' : ''}" data-relay-id="${escapeHtml(item.id)}">
        <div class="relay-station-editor-head">
          <div><b>${escapeHtml(item.name || '未命名中转站')}</b><span>${item.id === activeId ? '当前中转站' : escapeHtml(item.id)}</span></div>
          <div class="inline-actions"><button class="secondary" type="button" data-select-relay="${escapeHtml(item.id)}">${item.id === activeId ? '当前使用' : '设为当前'}</button><button class="danger-outline" type="button" data-delete-relay="${escapeHtml(item.id)}">删除</button></div>
        </div>
        <div class="relay-station-form-grid">
          <label>管理员看到的名称<input data-relay-field="name" value="${escapeHtml(item.name || '')}"></label>
          <label>管理员看到的介绍<input data-relay-field="description" value="${escapeHtml(item.description || '')}"></label>
          <label>OpenAI Base URL<input data-relay-field="baseUrl" type="url" value="${escapeHtml(item.baseUrl || '')}" placeholder="https://example.com/v1" spellcheck="false"></label>
          <label>图片 API Key<input data-relay-field="imageKey" type="password" placeholder="${item.imageKeyConfigured ? `已保存：${escapeHtml(item.imageKeyMasked || '')}` : '输入图片 API Key'}" autocomplete="new-password"></label>
          <label>图片模型（读取后选择）<input data-relay-field="imageModel" value="${escapeHtml(item.imageModel || '')}" readonly placeholder="请点击读取图片模型"></label>
          <label>素材分析模型<input data-relay-field="analysisModel" value="${escapeHtml(item.analysisModel || 'gpt-5-6')}" placeholder="支持图片理解的多模态模型" spellcheck="false"></label>
          <label>健康检测接口<input data-relay-field="healthPath" value="${escapeHtml(item.healthPath || '/models')}" placeholder="/models" spellcheck="false"></label>
          <label>模型列表接口<input data-relay-field="modelsPath" value="${escapeHtml(item.modelsPath || '/models')}" placeholder="/models" spellcheck="false"></label>
          <label>每张最低扣费<div class="money-input"><span>$</span><input data-relay-field="imagePriceMinMinor" type="number" min="0" max="1000000" step="0.000001" inputmode="decimal" placeholder="0.000000" value="${moneyMinorToSixDecimalInput(item.imagePriceMinMinor ?? 0)}"></div></label>
          <label>每张最高扣费<div class="money-input"><span>$</span><input data-relay-field="imagePriceMaxMinor" type="number" min="0" max="1000000" step="0.000001" inputmode="decimal" placeholder="0.000000" value="${moneyMinorToSixDecimalInput(item.imagePriceMaxMinor ?? item.imagePriceMinMinor ?? 0)}"></div></label>
          <label>站内 AI 分析最低扣费<div class="money-input"><span>$</span><input data-relay-field="llmPriceMinMinor" type="number" min="0" max="1000000" step="0.000001" inputmode="decimal" placeholder="0.000000" value="${moneyMinorToSixDecimalInput(item.llmPriceMinMinor ?? 0)}"></div></label>
          <label>站内 AI 分析最高扣费<div class="money-input"><span>$</span><input data-relay-field="llmPriceMaxMinor" type="number" min="0" max="1000000" step="0.000001" inputmode="decimal" placeholder="0.000000" value="${moneyMinorToSixDecimalInput(item.llmPriceMaxMinor ?? item.llmPriceMinMinor ?? 0)}"></div></label>
          <label>站内美元余额折算（人民币/美元）<input data-relay-field="customerCnyPerUsd" type="number" min="0.000001" max="1000" step="0.000001" inputmode="decimal" value="${escapeHtml(item.customerCnyPerUsd ?? 7)}" placeholder="7.000000"></label>
          <label>上游每张采购成本<div class="money-input"><span>¥</span><input data-relay-field="upstreamImageCostCnyMicro" type="number" min="0" max="1000000" step="0.000001" inputmode="decimal" placeholder="0.020000" value="${moneyMinorToSixDecimalInput(item.upstreamImageCostCnyMicro ?? 0)}"></div></label>
          <label>上游每次 AI 分析成本<div class="money-input"><span>¥</span><input data-relay-field="upstreamAnalysisCostCnyMicro" type="number" min="0" max="1000000" step="0.000001" inputmode="decimal" placeholder="0.000000" value="${moneyMinorToSixDecimalInput(item.upstreamAnalysisCostCnyMicro ?? 0)}"></div></label>
        </div>
        <div class="relay-station-actions">
          <button class="secondary" type="button" data-relay-health>健康检测</button>
          <button class="secondary" type="button" data-relay-models>读取图片模型</button>
          <label><input data-relay-field="enabled" type="checkbox"${item.enabled !== false ? ' checked' : ''}> 启用</label>
        </div>
        <div class="relay-station-status" data-relay-status>请使用健康检测和模型读取验证本站配置。</div>
      </article>`;
  }).join('');
}

function addRelay() {
  if (!isSuperAdmin()) return;
  state.apiSettings = { ...(state.apiSettings || {}), relays: [...collectRelaysFromForm(), newRelayDraft()] };
  renderRelayStations();
}

async function deleteRelay(button) {
  if (!isSuperAdmin()) return;
  if (!await brandConfirm('确定删除这个中转站吗？删除后立即生效。', { title: '删除中转站', danger: true, confirmText: '删除' })) return;
  const relays = collectRelaysFromForm().filter(item => item.id !== button.dataset.deleteRelay);
  const activeRelayId = state.apiSettings?.activeRelayId === button.dataset.deleteRelay
    ? relays.find(item => item.enabled !== false)?.id || ''
    : state.apiSettings?.activeRelayId;
  button.disabled = true;
  try {
    state.apiSettings = await window.caishen.saveApiSettings({ ...apiSettingsPayload(), relays, activeRelayId });
    state.relayChoices = await window.caishen.getRelayChoices().catch(() => state.relayChoices);
    state.selectedRelayId = state.apiSettings.activeRelayId || '';
    renderApiSettings();
    await loadBillingSummary();
    toast('中转站已删除');
  } catch (error) {
    button.disabled = false;
    toast(`删除失败：${errorText(error)}`, true);
  }
}

async function loadRelayChoices() {
  if (!isTeamAdmin()) return;
  try {
    state.relayChoices = await window.caishen.getRelayChoices();
    state.selectedRelayId = state.relayChoices?.activeRelayId || '';
    state.allowAdminPromptView = state.relayChoices?.allowAdminPromptView === true;
    $('#promptSettingsNav').hidden = !canViewPrompts();
    if (!isSuperAdmin()) renderApiSettings();
  } catch (error) {
    toast(`读取中转站失败：${errorText(error)}`, true);
  }
}

async function selectRelay(relayId) {
  if (!isTeamAdmin() || !relayId) return;
  if (isSuperAdmin()) {
    state.apiSettings = { ...(state.apiSettings || {}), relays: collectRelaysFromForm(), activeRelayId: relayId };
    renderApiSettings();
    toast('已设为当前中转站，保存设置后生效');
    return;
  }
  try {
    state.relayChoices = await window.caishen.saveActiveRelay(relayId);
    state.selectedRelayId = state.relayChoices.activeRelayId;
    renderApiSettings();
    await loadBillingSummary();
    toast('中转站已切换');
  } catch (error) {
    toast(errorText(error), true);
  }
}

function renderApiSettings() {
  const settings = state.apiSettings || {};
  const superAdmin = isSuperAdmin();
  const heading = $('.api-panel-head h2');
  const description = $('.api-panel-head p');
  const relayHeading = $('#relayStationCard .settings-card-head h3');
  const relayDescription = $('#relayStationCard .settings-card-head p');
  const footnote = $('#apiSettingsFootnote span');
  const footnoteRow = $('#apiSettingsFootnote');
  if (!superAdmin) {
    if (heading) heading.textContent = '中转站选择';
    if (description) {
      description.textContent = '管理员只能查看名称和介绍，并切换当前中转站。';
      description.hidden = false;
    }
    if (footnoteRow) footnoteRow.hidden = true;
    if (relayHeading) relayHeading.textContent = '可用中转站';
    if (relayDescription) relayDescription.textContent = '选择后，后续任务将使用这个中转站。';
    $('.api-layout-grid').hidden = true;
    $('.api-advanced-settings').hidden = true;
    $('#addRelayButton').hidden = true;
    renderRelayStations();
    const active = state.relayChoices?.relays?.find(item => item.id === state.relayChoices?.activeRelayId);
    $('#apiStatusBadge').textContent = active ? `当前：${active.name}` : '未选择';
    $('#apiStatusBadge').classList.toggle('ready', Boolean(active));
    $('#apiTabStatus').textContent = active?.name || '未选择';
    $('#apiTabStatus').classList.toggle('ready', Boolean(active));
    return;
  }
  if (heading) heading.textContent = 'API 设置';
  if (description) {
    description.hidden = false;
    description.textContent = '配置中转站、接口健康、模型、余额和独立计费规则。';
  }
  if (footnoteRow) footnoteRow.hidden = false;
  if (relayHeading) relayHeading.textContent = '中转站';
  if (relayDescription) relayDescription.textContent = '每个中转站独立保存地址、密钥、模型和本站扣费标准；不依赖上游余额接口。';
  if (footnote) footnote.textContent = '保存后，当前中转站的新配置会立即用于后续任务。';
  $('.api-layout-grid').hidden = false;
  $('.api-advanced-settings').hidden = false;
  $('#addRelayButton').hidden = false;
  $('#apiResponseFormat').value = settings.responseFormat || 'url';
  $('#apiRequestTimeout').value = String(settings.requestTimeoutSeconds || 300);
  $('#imageInitialConcurrency').value = String(settings.imageInitialConcurrency || 8);
  $('#imageMaxConcurrency').value = String(settings.imageMaxConcurrency || 30);
  $('#imageStartIntervalMs').value = String(settings.imageStartIntervalMs ?? 500);
  $('#allowAdminPromptView').checked = settings.allowAdminPromptView === true;
  $('#imageSize').value = state.config?.imageSize || '1024x1024';
  $('#imageQuality').value = state.config?.imageQuality || 'auto';

  const statusText = settings.configured ? `当前：${settings.activeRelayName || '已配置'}` : settings.activeRelayName ? `${settings.activeRelayName} 待完善` : '未配置';
  const statusBadge = $('#apiStatusBadge');
  statusBadge.textContent = statusText;
  statusBadge.classList.toggle('ready', Boolean(settings.imageConfigured));
  const tabStatus = $('#apiTabStatus');
  tabStatus.textContent = statusText;
  tabStatus.classList.toggle('ready', Boolean(settings.imageConfigured));
  renderRelayStations();
  renderApiModelList();
}

function apiModelMeta(model) {
  const parts = [model.object || 'model'];
  if (model.ownedBy) parts.push(model.ownedBy);
  if (model.created) {
    const milliseconds = model.created > 1e12 ? model.created : model.created * 1000;
    const date = new Date(milliseconds);
    if (!Number.isNaN(date.getTime())) parts.push(date.toLocaleDateString('zh-CN'));
  }
  return parts.join(' · ');
}

function renderApiModelList() {
  const models = state.imageApiModels;
  const browser = $('#apiModelBrowser');
  browser.hidden = models.length === 0;
  $('#imageModelOptions').innerHTML = state.imageApiModels.map(model => `<option value="${escapeHtml(model.id)}"></option>`).join('');
  if (!models.length) return;
  if (!models.some(model => model.id === state.selectedApiModelId)) {
    const row = $(`.relay-station-editor[data-relay-id="${CSS.escape(state.apiModelRelayId || '')}"]`);
    const configuredModel = row?.querySelector('[data-relay-field="imageModel"]')?.value || '';
    const configured = models.find(model => model.id === configuredModel);
    state.selectedApiModelId = configured?.id || models[0].id;
  }
  const query = $('#apiModelSearch').value.trim().toLocaleLowerCase('zh-CN');
  const visibleModels = query
    ? models.filter(model => `${model.id} ${model.object} ${model.ownedBy}`.toLocaleLowerCase('zh-CN').includes(query))
    : models;
  $('#apiModelCount').textContent = query ? `${visibleModels.length} / ${models.length}` : `${models.length} 个`;
  $('#apiModelList').innerHTML = visibleModels.length ? visibleModels.map(model => `
    <button class="api-model-option${model.id === state.selectedApiModelId ? ' active' : ''}" type="button" data-api-model="${escapeHtml(model.id)}">
      <span><b>${escapeHtml(model.id)}</b><small>${escapeHtml(apiModelMeta(model))}</small></span><em>${model.id === state.selectedApiModelId ? '已选择' : '选择'}</em>
    </button>`).join('') : '<div class="empty-inline">没有匹配的模型</div>';
  $('#selectedApiModel').textContent = `当前选择：${state.selectedApiModelId}`;
  $('#applyApiModelButton').disabled = !state.selectedApiModelId;
}

function openApiModelModal(relayId = state.apiModelRelayId) {
  state.apiModelRelayId = relayId || '';
  const models = state.imageApiModels;
  if (!models.length) return toast('请先读取图片模型列表', true);
  state.selectedApiModelId = '';
  $('#apiModelModalTitle').textContent = '选择图片模型';
  $('#apiModelModalDescription').textContent = '显示当前中转站图片密钥返回的全部模型。';
  $('#apiModelModal').hidden = false;
  $('#apiModelSearch').focus();
  renderApiModelList();
}

function closeApiModelModal() {
  $('#apiModelModal').hidden = true;
}

function applySelectedApiModel() {
  if (!state.selectedApiModelId) return toast('请先选择一个模型', true);
  const row = $(`.relay-station-editor[data-relay-id="${CSS.escape(state.apiModelRelayId || '')}"]`);
  const input = row?.querySelector('[data-relay-field="imageModel"]');
  if (!input) return toast('中转站配置已变化，请重新读取模型', true);
  input.value = state.selectedApiModelId;
  closeApiModelModal();
  toast('图片模型已选择，保存设置后生效');
}

async function loadApiSettings() {
  if (!isSuperAdmin()) return;
  try {
    const [apiSettings, relayChoices] = await Promise.all([
      window.caishen.getApiSettings(),
      window.caishen.getRelayChoices().catch(() => null)
    ]);
    state.apiSettings = apiSettings;
    state.allowAdminPromptView = apiSettings.allowAdminPromptView === true;
    state.relayChoices = relayChoices || state.relayChoices;
    state.selectedRelayId = apiSettings.activeRelayId || '';
    $('#promptSettingsNav').hidden = !canViewPrompts();
    renderApiSettings();
  } catch (error) {
    toast(`读取 API 设置失败：${errorText(error)}`, true);
  }
}

function apiSettingsPayload() {
  return {
    activeRelayId: state.apiSettings?.activeRelayId || '',
    relays: collectRelaysFromForm(),
    responseFormat: $('#apiResponseFormat').value,
    requestTimeoutSeconds: Number($('#apiRequestTimeout').value),
    imageInitialConcurrency: Number($('#imageInitialConcurrency').value),
    imageMaxConcurrency: Number($('#imageMaxConcurrency').value),
    imageStartIntervalMs: Number($('#imageStartIntervalMs').value),
    allowAdminPromptView: $('#allowAdminPromptView')?.checked === true
  };
}

function setRelayStatus(row, message, error = false) {
  const status = row?.querySelector('[data-relay-status]');
  if (!status) return;
  status.textContent = message;
  status.classList.toggle('error', error);
  status.classList.toggle('success', !error);
}

async function testRelayHealth(row, button) {
  setRelayStatus(row, '正在检测健康接口…');
  button.disabled = true;
  try {
    const result = await window.caishen.testRelayHealth({ relay: relayRowPayload(row), requestTimeoutSeconds: Number($('#apiRequestTimeout').value) });
    setRelayStatus(row, `健康正常 · ${result.checkedPath} · ${result.latencyMs ?? 0} ms`);
    toast('中转站健康检测通过');
  } catch (error) {
    setRelayStatus(row, `健康检测失败：${apiTestErrorText(error)}`, true);
    toast(errorText(error), true);
  } finally {
    button.disabled = false;
  }
}

async function readRelayModels(row, button) {
  setRelayStatus(row, '正在读取图片模型…');
  button.disabled = true;
  try {
    const result = await window.caishen.testApiSettings({ relay: relayRowPayload(row), requestTimeoutSeconds: Number($('#apiRequestTimeout').value) });
    state.imageApiModels = result.models || [];
    state.apiModelRelayId = row.dataset.relayId;
    setRelayStatus(row, `图片模型读取成功 · ${result.modelCount || 0} 个 · ${result.latencyMs ?? 0} ms`);
    if (result.modelCount) openApiModelModal(row.dataset.relayId);
    else toast('接口正常，但没有返回可用模型', true);
  } catch (error) {
    setRelayStatus(row, `图片模型读取失败：${apiTestErrorText(error)}`, true);
    toast(errorText(error), true);
  } finally {
    button.disabled = false;
  }
}

async function saveSettings() {
  const button = $('#saveSettingsButton');
  button.disabled = true;
  button.textContent = '保存中…';
  try {
    if (state.settingsTab === 'api') {
      if (isSuperAdmin()) {
        state.apiSettings = await window.caishen.saveApiSettings(apiSettingsPayload());
        state.allowAdminPromptView = state.apiSettings.allowAdminPromptView === true;
        state.relayChoices = await window.caishen.getRelayChoices().catch(() => state.relayChoices);
        state.selectedRelayId = state.apiSettings.activeRelayId || '';
        $('#promptSettingsNav').hidden = !canViewPrompts();
        renderApiSettings();
        await loadBillingSummary();
        toast('中转站与 API 设置已保存');
      }
      return;
    }
    state.config.operatorCode = $('#operatorCode').value.trim();
    state.config.outputPath = $('#settingOutputPathInput').value.trim();
    state.config.imageHoverPreviewEnabled = $('#imageHoverPreviewEnabled')?.checked !== false;
    const canSaveSystemSettings = isSuperAdmin();
    if (canSaveSystemSettings) {
      state.config.imageSize = $('#imageSize').value;
      state.config.imageQuality = $('#imageQuality').value;
    }
    const apiPayload = canSaveSystemSettings ? apiSettingsPayload() : {};
    const shouldSaveApi = canSaveSystemSettings && Boolean(
      apiPayload.relays?.length
      || state.apiSettings?.relays?.length
    );
    if (shouldSaveApi) {
      state.apiSettings = await window.caishen.saveApiSettings(apiPayload);
      state.allowAdminPromptView = state.apiSettings.allowAdminPromptView === true;
      $('#promptSettingsNav').hidden = !canViewPrompts();
      state.apiConcurrencySettings = {
        imageInitialConcurrency: state.apiSettings.imageInitialConcurrency,
        imageMaxConcurrency: state.apiSettings.imageMaxConcurrency,
        imageStartIntervalMs: state.apiSettings.imageStartIntervalMs
      };
    }
    state.config = await window.caishen.saveConfig(state.config);
    renderConfig();
    if (canSaveSystemSettings) renderApiSettings();
    toast(shouldSaveApi ? '基础设置和 API 设置已保存' : '基础设置已保存');
  } catch (error) {
    toast(errorText(error), true);
  } finally {
    button.disabled = false;
    button.textContent = '保存设置';
  }
}

async function resetSettings() {
  if (!await brandConfirm('确定重置系统设置吗？已上传的素材和素材映射会保留。', { title: '重置系统设置', danger: true, confirmText: '确认重置' })) return;
  const assetSettings = {
    categoriesPath: state.config.categoriesPath,
    printsPath: state.config.printsPath,
    detailSetsPath: state.config.detailSetsPath,
    childrenwearRealAssetsPath: state.config.childrenwearRealAssetsPath,
    childrenwearReferenceAssetsPath: state.config.childrenwearReferenceAssetsPath,
    childrenwearModelAssetsPath: state.config.childrenwearModelAssetsPath,
    childrenwearSceneAssetsPath: state.config.childrenwearSceneAssetsPath,
    childrenwearCombinationAssetsPath: state.config.childrenwearCombinationAssetsPath
  };
  state.config = await window.caishen.resetConfig();
  state.config = await window.caishen.saveConfig({ ...state.config, ...assetSettings });
  renderConfig();
  if (isSuperAdmin()) renderApiSettings();
  toast('基础设置已重置，API 和素材保持不变');
}

const CHILDRENWEAR_LIBRARY_META = Object.freeze({
  childrenwearRealAssetsPath: {
    grid: '#childrenwearRealAssetsGrid',
    summary: '#childrenwearRealAssetsSummary',
    stateKey: 'childrenwearReal',
    empty: '尚未上传实拍图',
    selected: '当前实拍图',
    analysisRole: 'product'
  },
  childrenwearReferenceAssetsPath: {
    grid: '#childrenwearReferenceAssetsGrid',
    summary: '#childrenwearReferenceAssetsSummary',
    stateKey: 'childrenwearReference',
    empty: '尚未上传参考图',
    selected: '当前成品参考图',
    analysisRole: 'flat_reference'
  },
  childrenwearModelAssetsPath: {
    grid: '#childrenwearModelAssetsGrid',
    summary: '#childrenwearModelAssetsSummary',
    stateKey: 'childrenwearModelReference',
    empty: '尚未上传模特图',
    selected: '当前模特参考图',
    analysisRole: 'model_reference'
  },
  childrenwearSceneAssetsPath: {
    grid: '#childrenwearSceneAssetsGrid',
    summary: '#childrenwearSceneAssetsSummary',
    stateKey: 'childrenwearSceneReference',
    empty: '尚未上传场景图',
    selected: '当前场景参考图',
    analysisRole: 'scene_reference'
  },
  childrenwearCombinationAssetsPath: {
    grid: '#childrenwearCombinationAssetsGrid',
    summary: '#childrenwearCombinationAssetsSummary',
    empty: '尚未上传组合图',
    selected: '当前组合图',
    analysisRole: 'combination_reference'
  }
});

function childrenwearAnalysisLabel(value) {
  const status = value?.status || 'pending';
  if (status === 'analyzed') return 'AI 已分析';
  if (status === 'analyzing') return 'AI 分析中';
  if (status === 'failed') return '分析失败';
  return '待 AI 分析';
}

function renderChildrenwearLibrary(key) {
  const meta = CHILDRENWEAR_LIBRARY_META[key];
  const grid = meta && $(meta.grid);
  const summary = meta && $(meta.summary);
  if (!meta || !grid || !summary) return;
  const items = state.childrenwearLibraries[key] || [];
  const folders = state.childrenwearLibraryFolders[key] || [];
  const activeFolder = state.childrenwearLibraryFolder[key] || 'root';
  const totals = state.childrenwearLibraryTotals[key] || { total: items.length, totalPages: 0, pageSize: 48 };
  const page = state.childrenwearLibraryPage[key] || 1;
  const deleteSelection = state.childrenwearLibraryDeleteSelection[key] || new Set();
  const analyzedCount = items.filter(item => item.analysis?.analyzed).length;
  const failedCount = items.filter(item => item.analysis?.status === 'failed').length;
  summary.textContent = `${totals.total} 张素材${totals.totalPages > 1 ? ` · 第 ${page}/${totals.totalPages} 页` : ''} · 本页已分析 ${analyzedCount}${failedCount ? ` · 失败 ${failedCount}` : ''}${deleteSelection.size ? ` · 已勾选 ${deleteSelection.size} 张` : ''}`;
  const folderList = $(`[data-childrenwear-folder-list="${key}"]`);
  if (folderList) {
    folderList.innerHTML = folders.length ? folders.map(folder => `
      <div class="childrenwear-folder-entry">
        <button class="childrenwear-folder-card${folder.id === activeFolder ? ' active' : ''}" type="button" data-childrenwear-folder-key="${key}" data-childrenwear-folder-id="${escapeHtml(folder.id)}">
          <span aria-hidden="true"></span><b>${escapeHtml(folder.name)}</b><small>${Number(folder.count) || 0} 张图片</small>
        </button>
        ${folder.id === 'root' ? '' : `<button class="childrenwear-folder-rename" type="button" data-rename-childrenwear-folder="${key}" data-childrenwear-folder-id="${escapeHtml(folder.id)}" data-childrenwear-folder-name="${escapeHtml(folder.name)}" aria-label="重命名 ${escapeHtml(folder.name)}">改名</button>`}
      </div>`).join('') : '<div class="childrenwear-folder-empty">尚无素材文件夹</div>';
  }
  grid.innerHTML = items.length ? items.map(item => {
    const checked = deleteSelection.has(item.path);
    const analysisStatus = item.analysis?.status || 'pending';
    const analysisTitle = item.analysis?.error || item.analysis?.summary || childrenwearAnalysisLabel(item.analysis);
    return `<article class="childrenwear-library-item analysis-${escapeHtml(analysisStatus)}${checked ? ' selected' : ''}" title="${escapeHtml(item.name)}">
      <button class="childrenwear-library-select" type="button" data-childrenwear-delete-key="${key}" data-childrenwear-delete-path="${escapeHtml(item.path)}" aria-pressed="${checked}"><span class="childrenwear-select-mark">${checked ? '✓' : ''}</span><span class="childrenwear-analysis-badge" title="${escapeHtml(analysisTitle)}">${escapeHtml(childrenwearAnalysisLabel(item.analysis))}</span><img loading="lazy" decoding="async" src="${escapeHtml(item.thumbnailUrl || item.url)}" data-preview-src="${escapeHtml(item.previewUrl || item.url)}" alt="${escapeHtml(item.name)}"><span class="childrenwear-library-caption"><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.folder && item.folder !== '根目录' ? item.folder : '未分类文件')}</small></span></button>
    </article>`;
  }).join('') : `<div class="empty-inline"><b>${meta.empty}</b><span>点击右上角按钮，可添加文件或上传整个文件夹。</span></div>`;
  const pagination = $(`[data-childrenwear-pagination="${key}"]`);
  if (pagination) {
    pagination.innerHTML = totals.totalPages > 1 ? `
      <button class="secondary" type="button" data-childrenwear-page-key="${key}" data-childrenwear-page="${page - 1}"${page <= 1 ? ' disabled' : ''}>上一页</button>
      <span>第 ${page} 页，共 ${totals.totalPages} 页 · 每页 ${totals.pageSize} 张</span>
      <button class="secondary" type="button" data-childrenwear-page-key="${key}" data-childrenwear-page="${page + 1}"${page >= totals.totalPages ? ' disabled' : ''}>下一页</button>` : '';
  }
  const deleteButton = $(`[data-delete-childrenwear-library="${key}"]`);
  if (deleteButton) {
    deleteButton.disabled = deleteSelection.size === 0;
    deleteButton.textContent = deleteSelection.size ? `删除选中（${deleteSelection.size}）` : '删除选中';
  }
  const selectAllButton = $(`[data-select-all-childrenwear-library="${key}"]`);
  if (selectAllButton) {
    const allVisibleSelected = items.length > 0 && items.every(item => deleteSelection.has(item.path));
    selectAllButton.disabled = items.length === 0;
    selectAllButton.textContent = allVisibleSelected ? '取消全选' : '全选';
  }
  const analyzeButton = $(`[data-analyze-childrenwear-library="${key}"]`);
  if (analyzeButton && !state.childrenwearLibraryUploading.has(key)) {
    const selectedPending = items.filter(item => deleteSelection.has(item.path) && item.analysis?.status !== 'analyzed').length;
    const pagePending = items.filter(item => item.analysis?.status !== 'analyzed').length;
    analyzeButton.disabled = (selectedPending || pagePending) === 0;
    analyzeButton.textContent = selectedPending ? `AI 分析选中（${selectedPending}）` : `AI 分析未完成（${pagePending}）`;
  }
}

function setChildrenwearAssetTab(key) {
  if (!CHILDRENWEAR_LIBRARY_META[key]) return;
  state.childrenwearAssetTab = key;
  $$('[data-childrenwear-library-tab]').forEach(button => {
    const active = button.dataset.childrenwearLibraryTab === key;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  $$('[data-childrenwear-library]').forEach(panel => {
    const active = panel.dataset.childrenwearLibrary === key;
    panel.hidden = !active;
    panel.classList.toggle('active', active);
  });
}

const CHILDRENWEAR_PRODUCTION_HINTS = Object.freeze({
  master: '实拍产品图 + 成品参考图 → 平铺图',
  model: '已审核平铺图 + 参考模特图 → 模特上身图',
  combination: '选择 2～4 个已审核平铺图 → 多 SKU 组合图'
});

function setChildrenwearProductionTabLegacy(tab) {
  const next = CHILDRENWEAR_PRODUCTION_HINTS[tab] ? tab : 'master';
  state.childrenwearProductionTab = next;
  $$('[data-childrenwear-production-tab]').forEach(button => {
    const active = button.dataset.childrenwearProductionTab === next;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  $$('[data-childrenwear-production-panel]').forEach(panel => {
    panel.hidden = panel.dataset.childrenwearProductionPanel !== next;
  });
  $$('[data-childrenwear-production-nav]').forEach(button => {
    const active = currentPage === 'childrenwear' && button.dataset.childrenwearProductionNav === next;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  const taskPanel = $('#childrenwearMasterTaskPanel');
  if (taskPanel) taskPanel.hidden = next !== 'master';
  $('#page-childrenwear')?.classList.toggle('childrenwear-master-mode', next === 'master');
  const hint = $('#childrenwearProductionTabHint');
  if (hint) hint.textContent = CHILDRENWEAR_PRODUCTION_HINTS[next];
}

function openChildrenwearProduction(tab) {
  setChildrenwearProductionTab(tab);
  setPage('childrenwear');
  setChildrenwearProductionTab(tab);
}

function openChildrenwearLibrary(key) {
  setChildrenwearAssetTab(key);
  setPage('assets');
}

const CHILDRENWEAR_PICKER_COPY = Object.freeze({
  childrenwearRealAssetsPath: ['选择实拍产品图', '实拍图决定商品版型、颜色、材质和全部细节。'],
  childrenwearReferenceAssetsPath: ['选择成品参考图', '参考图只决定平铺姿态、背景、光影和构图。'],
  childrenwearModelAssetsPath: ['选择参考模特图', '模特参考图决定人物、动作、服装受力、褶皱和细节展示姿势。'],
  childrenwearSceneAssetsPath: ['选择场景参考图', '场景图只决定背景环境、道具、灯光和接地阴影。']
});

function closeChildrenwearPicker() {
  $('#childrenwearAssetPickerModal').hidden = true;
  state.childrenwearPickerKey = '';
  state.childrenwearPickerSelected = '';
}

function renderChildrenwearPicker() {
  const key = state.childrenwearPickerKey;
  const meta = CHILDRENWEAR_LIBRARY_META[key];
  if (!meta) return;
  const items = state.childrenwearProductionLibraries[key] || [];
  const folders = state.childrenwearProductionFolders[key] || [];
  const activeFolder = state.childrenwearLibraryFolder[key] || 'root';
  const totals = state.childrenwearLibraryTotals[key] || { total: 0, totalPages: 0, pageSize: 48 };
  const page = state.childrenwearLibraryPage[key] || 1;
  $('#childrenwearPickerFolders').innerHTML = folders.length ? folders.map(folder => `
    <button class="childrenwear-picker-folder${folder.id === activeFolder ? ' active' : ''}" type="button" data-picker-folder-id="${escapeHtml(folder.id)}"><b>${escapeHtml(folder.name)}</b><span>${Number(folder.count) || 0}</span></button>`).join('') : '<span>暂无素材文件夹</span>';
  $('#childrenwearPickerGrid').innerHTML = items.length ? items.map(item => `
    <button class="childrenwear-picker-item${item.path === state.childrenwearPickerSelected ? ' selected' : ''}" type="button" data-picker-asset-path="${escapeHtml(item.path)}">
      <img loading="lazy" decoding="async" src="${escapeHtml(item.thumbnailUrl || item.url)}" data-preview-src="${escapeHtml(item.previewUrl || item.url)}" alt="${escapeHtml(item.name)}"><span><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.folder || '未分类文件')}</small></span>
    </button>`).join('') : '<div class="empty-inline">当前文件夹没有素材</div>';
  $('#childrenwearPickerPagination').innerHTML = totals.totalPages > 1 ? `
    <button class="secondary" type="button" data-picker-page="${page - 1}"${page <= 1 ? ' disabled' : ''}>上一页</button><span>${page} / ${totals.totalPages}</span><button class="secondary" type="button" data-picker-page="${page + 1}"${page >= totals.totalPages ? ' disabled' : ''}>下一页</button>` : '';
  $('#childrenwearPickerStatus').textContent = state.childrenwearPickerSelected ? '已选中 1 张素材' : `当前文件夹 ${totals.total} 张，请选择 1 张`;
  $('#applyChildrenwearPickerButton').disabled = !state.childrenwearPickerSelected;
}

async function openChildrenwearPicker(key) {
  const meta = CHILDRENWEAR_LIBRARY_META[key];
  if (!meta) return;
  state.childrenwearPickerKey = key;
  state.childrenwearPickerSelected = state[meta.stateKey]?.path || '';
  const copy = CHILDRENWEAR_PICKER_COPY[key];
  $('#childrenwearPickerTitle').textContent = copy[0];
  $('#childrenwearPickerDescription').textContent = copy[1];
  $('#childrenwearAssetPickerModal').hidden = false;
  $('#childrenwearPickerGrid').innerHTML = '<div class="empty-inline">正在读取素材…</div>';
  await loadChildrenwearLibrary(key);
  renderChildrenwearPicker();
}

function applyChildrenwearPicker() {
  const key = state.childrenwearPickerKey;
  const meta = CHILDRENWEAR_LIBRARY_META[key];
  const item = (state.childrenwearProductionLibraries[key] || []).find(candidate => candidate.path === state.childrenwearPickerSelected);
  if (!meta || !item) return;
  state[meta.stateKey] = item;
  if (key !== 'childrenwearModelAssetsPath') state.childrenwearActiveTask = null;
  closeChildrenwearPicker();
  renderChildrenwear();
  toast(`已选择${meta.selected}`);
}

async function loadChildrenwearLibrary(key, options = {}) {
  const meta = CHILDRENWEAR_LIBRARY_META[key];
  if (!meta || !state.config) return;
  const root = state.config[key] || '';
  if (!root) {
    state.childrenwearLibraries[key] = [];
    state.childrenwearProductionLibraries[key] = [];
    state.childrenwearLibraryFolders[key] = [];
    state.childrenwearProductionFolders[key] = [];
    state.childrenwearLibraryTotals[key] = { total: 0, totalPages: 0, pageSize: 48 };
    renderChildrenwearLibrary(key);
    if (state.childrenwearPickerKey === key) renderChildrenwearPicker();
    return;
  }
  try {
    const [result, productionResult] = await Promise.all([
      window.caishen.listImageLibrary(root, {
        folder: state.childrenwearLibraryFolder[key],
        page: state.childrenwearLibraryPage[key],
        pageSize: 48,
        analysisRole: meta.analysisRole,
        refresh: options.refresh === true
      }),
      window.caishen.listImageLibrary(root, {
        folder: state.childrenwearLibraryFolder[key],
        page: 1,
        pageSize: 120,
        analysisRole: meta.analysisRole,
        analysisOnly: true,
        strictFolder: true,
        refresh: options.refresh === true
      })
    ]);
    state.childrenwearLibraries[key] = result.items || [];
    state.childrenwearProductionLibraries[key] = productionResult.items || [];
    state.childrenwearLibraryFolders[key] = result.folders || [];
    state.childrenwearProductionFolders[key] = productionResult.folders || [];
    state.childrenwearLibraryFolder[key] = result.folder || 'root';
    state.childrenwearLibraryPage[key] = result.page || 1;
    state.childrenwearLibraryTotals[key] = {
      total: Number(result.total) || 0,
      totalPages: Number(result.totalPages) || 0,
      pageSize: Number(result.pageSize) || 48
    };
  } catch (error) {
    state.childrenwearLibraries[key] = [];
    state.childrenwearProductionLibraries[key] = [];
    const summary = $(meta.summary);
    if (summary) summary.textContent = `读取失败：${errorText(error)}`;
    if (options.throwOnError === true) throw error;
  }
  renderChildrenwearLibrary(key);
  if (state.childrenwearPickerKey === key) renderChildrenwearPicker();
  return {
    items: state.childrenwearLibraries[key] || [],
    folders: state.childrenwearLibraryFolders[key] || [],
    totals: state.childrenwearLibraryTotals[key] || { total: 0 }
  };
}

async function refreshChildrenwearLibraryAfterImport(key) {
  let result;
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      result = await loadChildrenwearLibrary(key, { refresh: true, throwOnError: true });
      return result;
    } catch (error) {
      lastError = error;
      if (attempt < 2) await sleep(150 * (attempt + 1));
    }
  }
  throw lastError || new Error('素材已导入，但页面刷新失败，请稍后重试');
}

async function selectChildrenwearLibraryFolder(key, folderId) {
  if (!CHILDRENWEAR_LIBRARY_META[key]) return;
  state.childrenwearLibraryFolder[key] = folderId || 'root';
  state.childrenwearLibraryPage[key] = 1;
  const grid = $(CHILDRENWEAR_LIBRARY_META[key].grid);
  if (grid) grid.innerHTML = '<div class="empty-inline">正在读取文件夹…</div>';
  await loadChildrenwearLibrary(key);
}

async function changeChildrenwearLibraryPage(key, page) {
  const totals = state.childrenwearLibraryTotals[key];
  const next = Math.max(1, Math.min(Number(totals?.totalPages) || 1, Number(page) || 1));
  if (next === state.childrenwearLibraryPage[key]) return;
  state.childrenwearLibraryPage[key] = next;
  await loadChildrenwearLibrary(key);
}

async function loadChildrenwearLibraries() {
  await Promise.all(Object.keys(CHILDRENWEAR_LIBRARY_META).map(loadChildrenwearLibrary));
}

function renderChildrenwearAnalysisAutomation() {
  const enabled = state.config?.childrenwearAutoAnalysisEnabled === true;
  const interval = [1, 5, 10, 30, 60].includes(Number(state.config?.childrenwearAutoAnalysisIntervalMinutes))
    ? Number(state.config.childrenwearAutoAnalysisIntervalMinutes)
    : 5;
  const enabledInput = $('#childrenwearAutoAnalysisEnabled');
  const intervalInput = $('#childrenwearAutoAnalysisInterval');
  const runButton = $('#runChildrenwearAnalysisScanButton');
  const status = $('#childrenwearAnalysisScanStatus');
  if (enabledInput) enabledInput.checked = enabled;
  if (intervalInput) {
    intervalInput.value = String(interval);
    intervalInput.disabled = false;
  }
  if (runButton) {
    runButton.disabled = state.childrenwearAnalysisScanRunning;
    runButton.textContent = state.childrenwearAnalysisScanRunning ? '正在并发分析…' : '立即扫描分析';
  }
  if (status && !state.childrenwearAnalysisScanRunning) {
    status.textContent = state.childrenwearAnalysisLastScanAt
      ? `上次 ${formatLocalDateTime(state.childrenwearAnalysisLastScanAt)}`
      : enabled ? `已开启 · 每 ${interval} 分钟` : '自动扫描已关闭';
  }
}

function scheduleChildrenwearAutoAnalysis(options = {}) {
  renderChildrenwearAnalysisAutomation();
  if (state.config?.childrenwearAutoAnalysisEnabled !== true) return;
  if (options.runNow === true) void runChildrenwearAnalysisScan({ manual: false });
}

async function saveChildrenwearAnalysisAutomation(changes, options = {}) {
  const previous = state.config;
  state.config = { ...state.config, ...changes };
  renderChildrenwearAnalysisAutomation();
  try {
    state.config = await window.caishen.saveConfig(state.config);
    scheduleChildrenwearAutoAnalysis({ runNow: options.runNow === true });
  } catch (error) {
    state.config = previous;
    renderChildrenwearAnalysisAutomation();
    toast(errorText(error), true);
  }
}

async function runChildrenwearAnalysisScan(options = {}) {
  if (state.childrenwearAnalysisScanRunning) return null;
  state.childrenwearAnalysisScanRunning = true;
  const status = $('#childrenwearAnalysisScanStatus');
  renderChildrenwearAnalysisAutomation();
  if (status) status.textContent = '正在查找未分析素材…';
  try {
    const result = await window.caishen.scanPendingChildrenwearAnalysis({
      includeFailed: options.manual === true
    }, progress => {
      if (status) status.textContent = progress.message || `已处理 ${progress.current || 0}/${progress.total || 0}`;
    });
    state.childrenwearAnalysisLastScanAt = new Date().toISOString();
    if (result.total > 0) await loadChildrenwearLibraries();
    if (options.manual === true) {
      if (!result.total) toast('扫描完成：没有需要 AI 分析的新素材');
      else if (result.failed) toast(`AI 分析完成 ${result.analyzed}/${result.total}，失败 ${result.failed}`, true);
      else toast(`AI 分析完成：${result.analyzed} 张，并发数 ${result.concurrency}`);
    }
    return result;
  } catch (error) {
    if (options.manual === true) toast(errorText(error), true);
    if (status) status.textContent = `扫描失败：${errorText(error)}`;
    throw error;
  } finally {
    state.childrenwearAnalysisScanRunning = false;
    renderChildrenwearAnalysisAutomation();
  }
}

async function analyzeChildrenwearPaths(key, paths, options = {}) {
  const meta = CHILDRENWEAR_LIBRARY_META[key];
  const uniquePaths = [...new Set((paths || []).filter(Boolean))];
  if (!meta || !uniquePaths.length) return { total: 0, analyzed: 0, reused: 0, failed: 0, failures: [] };
  const button = options.button || null;
  const originalText = button?.textContent || '';
  if (button) button.disabled = true;
  try {
    const result = await window.caishen.analyzeChildrenwearAssets({
      role: meta.analysisRole,
      paths: uniquePaths,
      force: options.force === true
    }, progress => {
      if (button) button.textContent = progress.message || `正在 AI 分析 ${progress.current || 0}/${progress.total || uniquePaths.length}`;
    });
    return result;
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalText;
    }
  }
}

async function analyzeChildrenwearLibrarySelection(key, button) {
  const items = state.childrenwearLibraries[key] || [];
  const selection = state.childrenwearLibraryDeleteSelection[key] || new Set();
  const selected = items.filter(item => selection.has(item.path));
  const targets = (selected.length
    ? selected
    : items.filter(item => item.analysis?.status !== 'analyzed'))
    .map(item => item.path);
  if (!targets.length) return toast('当前页素材均已完成 AI 分析；如需按新提示词重新分析，请先勾选素材');
  try {
    const result = await analyzeChildrenwearPaths(key, targets, { button, force: selected.length > 0 });
    await loadChildrenwearLibrary(key);
    if (result.failed) toast(`AI 分析完成 ${result.analyzed}/${result.total}，失败 ${result.failed}；失败素材不会进入生成选材区`, true);
    else toast(`AI 分析完成：${result.analyzed} 张素材已可用于生成`);
  } catch (error) {
    await loadChildrenwearLibrary(key).catch(() => {});
    toast(errorText(error), true);
  }
}

function validChildrenwearFolderName(value) {
  const name = String(value || '').trim();
  return name && name !== '.' && name !== '..' && !/[\\/:*?"<>|]/.test(name) && !/[. ]$/.test(name) && name.length <= 80;
}

async function prepareChildrenwearFolderUpload(key, entries) {
  const firstParts = String(entries[0]?.relativePath || '').replaceAll('\\', '/').split('/').filter(Boolean);
  const sourceName = firstParts.length > 1 ? firstParts[0] : '新建文件夹';
  const existingNames = new Set((state.childrenwearLibraryFolders[key] || [])
    .filter(folder => folder.id !== 'root')
    .flatMap(folder => [folder.name, String(folder.id || '').replace(/^folder:/, '')])
    .map(name => String(name || '').toLocaleLowerCase('zh-CN')));
  let suggested = sourceName;
  for (let suffix = 2; existingNames.has(suggested.toLocaleLowerCase('zh-CN')); suffix += 1) suggested = `${sourceName} (${suffix})`;
  const requested = await brandPrompt('设置款式或分组名称', suggested, {
    message: '这是按当前用途导入。若选择的是“实拍图、成品图、模特图或组合图”文件夹，请在这里填写它所属的款式名称。',
    inputLabel: '款式/分组名称'
  });
  if (requested === null) return null;
  const folderName = requested.trim();
  if (!validChildrenwearFolderName(folderName)) {
    toast('文件夹名称不能为空，且不能包含 \\ / : * ? " < > |', true);
    return null;
  }
  if (existingNames.has(folderName.toLocaleLowerCase('zh-CN'))) {
    toast(`文件夹“${folderName}”已存在，请换一个名称，避免素材被合并`, true);
    return null;
  }
  return {
    folderName,
    entries: entries.map(entry => {
      const parts = String(entry.relativePath || entry.file?.name || '').replaceAll('\\', '/').split('/').filter(Boolean);
      const tail = parts.length > 1 ? parts.slice(1) : [entry.file?.name || parts[0]];
      return { ...entry, relativePath: [folderName, ...tail].filter(Boolean).join('/') };
    })
  };
}

const CHILDRENWEAR_STYLE_PACKAGE_KINDS = Object.freeze({
  实拍图: 'childrenwearRealAssetsPath',
  实拍产品图: 'childrenwearRealAssetsPath',
  成品图: 'childrenwearReferenceAssetsPath',
  成品参考图: 'childrenwearReferenceAssetsPath',
  模特图: 'childrenwearModelAssetsPath',
  参考模特图: 'childrenwearModelAssetsPath',
  场景图: 'childrenwearSceneAssetsPath',
  场景参考图: 'childrenwearSceneAssetsPath',
  组合图: 'childrenwearCombinationAssetsPath',
  SKU组合图: 'childrenwearCombinationAssetsPath'
});

const CHILDRENWEAR_STYLE_PACKAGE_LABELS = Object.freeze({
  childrenwearRealAssetsPath: '实拍图',
  childrenwearReferenceAssetsPath: '成品图',
  childrenwearModelAssetsPath: '模特图',
  childrenwearSceneAssetsPath: '场景图',
  childrenwearCombinationAssetsPath: '组合图'
});

function childrenwearLibraryRoot(key) {
  const root = state.config[key] || '';
  return isClientSubPath(state.config.workspaceRoot, root) ? root : '';
}

function childrenwearLibraryRootName(key) {
  return `${CHILDRENWEAR_STYLE_PACKAGE_LABELS[key] || '童装'}素材`;
}

function childrenwearPackageKind(folderName) {
  const normalized = String(folderName || '').replaceAll(' ', '').trim();
  return CHILDRENWEAR_STYLE_PACKAGE_KINDS[normalized] || '';
}

function parseChildrenwearStylePackage(entries) {
  const groups = new Map(Object.keys(CHILDRENWEAR_LIBRARY_META).map(key => [key, []]));
  const styles = new Map();
  const ignored = [];
  for (const entry of entries) {
    const parts = String(entry.relativePath || entry.file?.name || '').replaceAll('\\', '/').split('/').filter(Boolean);
    const kindIndex = parts.findIndex(part => childrenwearPackageKind(part));
    if (kindIndex < 1 || kindIndex >= parts.length - 1) {
      ignored.push(entry);
      continue;
    }
    const styleName = parts[kindIndex - 1]?.trim();
    const key = childrenwearPackageKind(parts[kindIndex]);
    if (!key || !validChildrenwearFolderName(styleName)) {
      ignored.push(entry);
      continue;
    }
    const relativePath = [styleName, ...parts.slice(kindIndex + 1)].join('/');
    groups.get(key).push({ ...entry, relativePath });
    if (!styles.has(styleName)) styles.set(styleName, Object.fromEntries(Object.keys(CHILDRENWEAR_LIBRARY_META).map(item => [item, 0])));
    styles.get(styleName)[key] += 1;
  }
  return { groups, styles, ignored };
}

function childrenwearStylePackageSummary(parsed) {
  const lines = [...parsed.styles].map(([styleName, counts]) => {
    const detail = Object.entries(CHILDRENWEAR_STYLE_PACKAGE_LABELS).map(([key, label]) => `${label} ${counts[key] || 0} 张`).join('，');
    return `${styleName}：${detail}`;
  });
  if (parsed.ignored.length) lines.push(`未识别图片：${parsed.ignored.length} 张（不会导入）`);
  return lines.join('\n');
}

async function importChildrenwearStylePackage(button) {
  if (!button || state.childrenwearLibraryUploading.size) return;
  const entries = await window.caishen.chooseAssetFolder();
  if (!entries.length) return;
  const parsed = parseChildrenwearStylePackage(entries);
  const recognized = [...parsed.groups.values()].reduce((total, items) => total + items.length, 0);
  if (!recognized || !parsed.styles.size) {
    return toast('没有识别到“款式文件夹 → 实拍图/成品图/模特图/组合图 → 图片”的目录结构', true);
  }
  const confirmed = await brandConfirm(`识别到 ${parsed.styles.size} 个款式、${recognized} 张图片：\n\n${childrenwearStylePackageSummary(parsed)}\n\n系统会按四种用途分别归档，并保留款式名称。`, {
    title: '按款式整包导入',
    confirmText: '确认导入'
  });
  if (!confirmed) return;
  const activeKeys = [...parsed.groups].filter(([, items]) => items.length).map(([key]) => key);
  const previousRoots = Object.fromEntries(activeKeys.map(key => [key, state.config[key] || '']));
  const completed = [];
  activeKeys.forEach(key => state.childrenwearLibraryUploading.add(key));
  button.disabled = true;
  button.textContent = `正在处理 ${recognized} 张，请稍候…`;
  try {
    let added = 0;
    let skipped = 0;
    for (const key of activeKeys) {
      const result = await window.caishen.syncAssetEntries(key, childrenwearLibraryRoot(key), parsed.groups.get(key), {
        rootName: childrenwearLibraryRootName(key)
      });
      state.config[key] = result.root;
      completed.push({ key, result });
      added += Number(result.added) || 0;
      skipped += Number(result.skipped) || 0;
    }
    state.config = await window.caishen.saveConfig(state.config);
    const onlyStyle = parsed.styles.size === 1 ? [...parsed.styles.keys()][0] : '';
    for (const key of activeKeys) {
      state.childrenwearLibraryFolder[key] = onlyStyle ? `folder:${onlyStyle}` : 'auto';
      state.childrenwearLibraryPage[key] = 1;
    }
    await Promise.all(activeKeys.map(refreshChildrenwearLibraryAfterImport));
    const analysis = await window.caishen.scanPendingChildrenwearAnalysis({ includeFailed: false });
    const analyzed = Number(analysis.analyzed) || 0;
    const failed = Number(analysis.failed) || 0;
    await Promise.all(activeKeys.map(refreshChildrenwearLibraryAfterImport));
    toast(`款式整包导入完成：${parsed.styles.size} 个款式，${added} 张素材，AI 已分析 ${analyzed} 张${failed ? `，失败 ${failed} 张（不会进入生成选材区）` : ''}${skipped ? `，跳过 ${skipped} 张` : ''}`, failed > 0);
  } catch (error) {
    let rollbackFailed = false;
    for (const item of completed.reverse()) {
      try {
        const uploadedPaths = item.result.uploadedPaths || [];
        if (uploadedPaths.length) await window.caishen.deleteAssetFiles(item.key, item.result.root, uploadedPaths);
        state.config[item.key] = previousRoots[item.key];
      } catch { rollbackFailed = true; }
    }
    await window.caishen.saveConfig(state.config).catch(() => { rollbackFailed = true; });
    toast(`${errorText(error)}${completed.length ? rollbackFailed ? '；部分已导入文件未能自动回滚，请检查素材库' : '；本次已导入内容已自动回滚' : ''}`, true);
  } finally {
    activeKeys.forEach(key => state.childrenwearLibraryUploading.delete(key));
    button.disabled = false;
    button.textContent = '按款式整包导入';
  }
}

async function renameChildrenwearLibraryFolder(key, folderId, currentName) {
  if (!CHILDRENWEAR_LIBRARY_META[key] || folderId === 'root') return;
  const requested = await brandPrompt('修改文件夹名称', currentName || '', { inputLabel: '新的文件夹名称' });
  if (requested === null) return;
  const nextName = requested.trim();
  if (nextName === currentName) return;
  if (!validChildrenwearFolderName(nextName)) return toast('文件夹名称不能为空，且不能包含 \\ / : * ? " < > |', true);
  const duplicate = (state.childrenwearLibraryFolders[key] || []).some(folder => folder.id !== folderId
    && String(folder.name || '').toLocaleLowerCase('zh-CN') === nextName.toLocaleLowerCase('zh-CN'));
  if (duplicate) return toast(`文件夹“${nextName}”已存在，请换一个名称`, true);
  try {
    await window.caishen.renameAssetFolder(key, state.config[key], folderId, nextName);
    await loadChildrenwearLibrary(key);
    toast(`文件夹已重命名为“${nextName}”`);
  } catch (error) { toast(errorText(error), true); }
}

async function uploadChildrenwearLibrary(key, source = 'files') {
  const meta = CHILDRENWEAR_LIBRARY_META[key];
  if (!meta || state.childrenwearLibraryUploading.has(key)) return;
  const isFolder = source === 'folder';
  let entries = isFolder ? await window.caishen.chooseAssetFolder() : await window.caishen.chooseAssetFiles();
  if (!entries.length) return;
  let uploadedFolderName = '';
  if (isFolder) {
    const prepared = await prepareChildrenwearFolderUpload(key, entries);
    if (!prepared) return;
    entries = prepared.entries;
    uploadedFolderName = prepared.folderName;
  }
  state.childrenwearLibraryUploading.add(key);
  const button = $(`[data-childrenwear-library-${isFolder ? 'folder' : 'upload'}="${key}"]`);
  if (button) {
    button.disabled = true;
    button.textContent = `正在处理 ${entries.length} 张，请稍候…`;
  }
  try {
    const result = await window.caishen.syncAssetEntries(key, childrenwearLibraryRoot(key), entries, {
      rootName: childrenwearLibraryRootName(key)
    });
    state.config[key] = result.root;
    state.config = await window.caishen.saveConfig(state.config);
    if (isFolder) state.childrenwearLibraryFolder[key] = uploadedFolderName ? `folder:${uploadedFolderName}` : 'root';
    else state.childrenwearLibraryFolder[key] = 'root';
    state.childrenwearLibraryPage[key] = 1;
    await refreshChildrenwearLibraryAfterImport(key);
    const analysis = await analyzeChildrenwearPaths(key, result.paths || []);
    await refreshChildrenwearLibraryAfterImport(key);
    const latest = (state.childrenwearLibraries[key] || []).find(item => result.paths?.includes?.(item.path))
      || state.childrenwearLibraries[key]?.at(-1);
    if (latest && meta.stateKey && !state[meta.stateKey]) state[meta.stateKey] = latest;
    renderChildrenwear();
    toast(`${isFolder ? '文件夹导入完成' : '上传完成'}：${result.added} 张素材，AI 已分析 ${analysis.analyzed} 张${analysis.failed ? `，失败 ${analysis.failed} 张（不会进入生成选材区）` : ''}${result.skipped ? `，跳过 ${result.skipped} 个文件` : ''}`, analysis.failed > 0);
  } catch (error) {
    toast(errorText(error), true);
  } finally {
    state.childrenwearLibraryUploading.delete(key);
    if (button) {
      button.disabled = false;
      button.textContent = isFolder ? '按用途文件夹导入' : '添加文件';
    }
  }
}

function toggleChildrenwearLibraryDelete(key, assetPath, checked) {
  const meta = CHILDRENWEAR_LIBRARY_META[key];
  const selection = state.childrenwearLibraryDeleteSelection[key];
  if (!meta || !selection) return;
  if (checked) selection.add(assetPath);
  else selection.delete(assetPath);
  renderChildrenwearLibrary(key);
}

function toggleAllChildrenwearLibraryItems(key) {
  const items = state.childrenwearLibraries[key] || [];
  const selection = state.childrenwearLibraryDeleteSelection[key];
  if (!items.length || !selection) return;
  const allVisibleSelected = items.every(item => selection.has(item.path));
  for (const item of items) {
    if (allVisibleSelected) selection.delete(item.path);
    else selection.add(item.path);
  }
  renderChildrenwearLibrary(key);
}

async function deleteChildrenwearLibrarySelection(key) {
  const selection = state.childrenwearLibraryDeleteSelection[key];
  if (!selection?.size || !state.config?.[key]) return;
  if (!await brandConfirm(`确定删除选中的 ${selection.size} 张素材吗？此操作不可撤销。`, { title: '删除素材', danger: true, confirmText: '删除' })) return;
  try {
    const result = await window.caishen.deleteAssetFiles(key, state.config[key], [...selection]);
    selection.clear();
    await loadChildrenwearLibrary(key);
    toast(`已删除 ${result.deleted} 张素材`);
  } catch (error) { toast(errorText(error), true); }
}

function bindChildrenwearLibraryEvents() {
  $('#childrenwearAutoAnalysisEnabled').onchange = event => saveChildrenwearAnalysisAutomation({
    childrenwearAutoAnalysisEnabled: event.target.checked
  }, { runNow: event.target.checked });
  $('#childrenwearAutoAnalysisInterval').onchange = event => saveChildrenwearAnalysisAutomation({
    childrenwearAutoAnalysisIntervalMinutes: Number(event.target.value) || 5
  });
  $('#runChildrenwearAnalysisScanButton').onclick = () => runChildrenwearAnalysisScan({ manual: true });
  $$('[data-import-childrenwear-style-package]').forEach(button => {
    button.onclick = () => importChildrenwearStylePackage(button).catch(error => toast(errorText(error), true));
  });
  $$('[data-childrenwear-library-tab]').forEach(button => {
    button.onclick = () => setChildrenwearAssetTab(button.dataset.childrenwearLibraryTab);
  });
  $$('[data-childrenwear-library-upload]').forEach(button => {
    button.onclick = () => uploadChildrenwearLibrary(button.dataset.childrenwearLibraryUpload);
  });
  $$('[data-childrenwear-library-folder]').forEach(button => {
    button.onclick = () => uploadChildrenwearLibrary(button.dataset.childrenwearLibraryFolder, 'folder');
  });
  $$('[data-analyze-childrenwear-library]').forEach(button => {
    button.onclick = () => analyzeChildrenwearLibrarySelection(button.dataset.analyzeChildrenwearLibrary, button);
  });
  $$('[data-delete-childrenwear-library]').forEach(button => {
    button.onclick = () => deleteChildrenwearLibrarySelection(button.dataset.deleteChildrenwearLibrary);
  });
  $$('[data-select-all-childrenwear-library]').forEach(button => {
    button.onclick = () => toggleAllChildrenwearLibraryItems(button.dataset.selectAllChildrenwearLibrary);
  });
  $$('.childrenwear-folder-browser').forEach(container => {
    container.onclick = event => {
      const renameButton = event.target.closest('[data-rename-childrenwear-folder]');
      if (renameButton) {
        renameChildrenwearLibraryFolder(
          renameButton.dataset.renameChildrenwearFolder,
          renameButton.dataset.childrenwearFolderId,
          renameButton.dataset.childrenwearFolderName
        );
        return;
      }
      const button = event.target.closest('[data-childrenwear-folder-id]');
      if (button) selectChildrenwearLibraryFolder(button.dataset.childrenwearFolderKey, button.dataset.childrenwearFolderId).catch(error => toast(errorText(error), true));
    };
  });
  $$('.childrenwear-library-pagination').forEach(container => {
    container.onclick = event => {
      const button = event.target.closest('[data-childrenwear-page]');
      if (button && !button.disabled) changeChildrenwearLibraryPage(button.dataset.childrenwearPageKey, button.dataset.childrenwearPage).catch(error => toast(errorText(error), true));
    };
  });
  $$('[data-open-childrenwear-library]').forEach(button => {
    button.onclick = () => openChildrenwearLibrary(button.dataset.openChildrenwearLibrary);
  });
  $$('[data-open-childrenwear-picker]').forEach(button => {
    button.onclick = () => openChildrenwearPicker(button.dataset.openChildrenwearPicker).catch(error => toast(errorText(error), true));
  });
  $('#closeChildrenwearPickerButton').onclick = closeChildrenwearPicker;
  $('#cancelChildrenwearPickerButton').onclick = closeChildrenwearPicker;
  $('#childrenwearAssetPickerModal').onclick = event => { if (event.target === $('#childrenwearAssetPickerModal')) closeChildrenwearPicker(); };
  $('#childrenwearPickerFolders').onclick = event => {
    const button = event.target.closest('[data-picker-folder-id]');
    if (!button || !state.childrenwearPickerKey) return;
    state.childrenwearPickerSelected = '';
    selectChildrenwearLibraryFolder(state.childrenwearPickerKey, button.dataset.pickerFolderId).catch(error => toast(errorText(error), true));
  };
  $('#childrenwearPickerGrid').onclick = event => {
    const button = event.target.closest('[data-picker-asset-path]');
    if (!button) return;
    state.childrenwearPickerSelected = button.dataset.pickerAssetPath;
    renderChildrenwearPicker();
  };
  $('#childrenwearPickerPagination').onclick = event => {
    const button = event.target.closest('[data-picker-page]');
    if (!button || button.disabled || !state.childrenwearPickerKey) return;
    state.childrenwearPickerSelected = '';
    changeChildrenwearLibraryPage(state.childrenwearPickerKey, button.dataset.pickerPage).catch(error => toast(errorText(error), true));
  };
  $('#applyChildrenwearPickerButton').onclick = applyChildrenwearPicker;
  $$('.childrenwear-library-items').forEach(grid => {
    grid.onclick = event => {
      const button = event.target.closest('[data-childrenwear-delete-path]');
      if (!button) return;
      const selection = state.childrenwearLibraryDeleteSelection[button.dataset.childrenwearDeleteKey];
      toggleChildrenwearLibraryDelete(button.dataset.childrenwearDeleteKey, button.dataset.childrenwearDeletePath, !selection.has(button.dataset.childrenwearDeletePath));
    };
  });
}

function childrenwearCategoryMaterial(category) {
  const text = String(category || '');
  if (text.includes('梭织')) return '纯棉梭织';
  if (text.includes('套装') || text.includes('长爬')) return '纯棉针织';
  return $('#childrenwearMaterial')?.value || '纯棉';
}

function setChildrenwearPreview(imageSelector, emptySelector, source) {
  const image = $(imageSelector);
  const empty = $(emptySelector);
  if (!image || !empty) return;
  const url = source?.url || '';
  image.hidden = !url;
  empty.hidden = Boolean(url);
  if (url) image.src = url;
  else image.removeAttribute('src');
}

function childrenwearInputFromTask(pathKey, urlKey, nameFallback) {
  const task = state.childrenwearActiveTask;
  if (!task?.[pathKey]) return null;
  return {
    path: task[pathKey],
    url: task[urlKey] || '',
    name: task[pathKey].split(/[\\/]/).at(-1) || nameFallback
  };
}

function renderChildrenwearModelResults() {
  const container = $('#childrenwearModelResults');
  if (!container) return;
  const outputs = state.childrenwearActiveTask?.modelOutputs || [];
  container.innerHTML = outputs.length ? outputs.slice().reverse().map(output => `
    <article class="childrenwear-model-result${output.approved ? ' approved' : ''}" data-childrenwear-model-id="${escapeHtml(output.id)}">
      <img src="${escapeHtml(output.url)}" alt="模特上身图">
      <div><b>${output.approved ? '已审核模特图' : '模特图候选'}</b><span>${escapeHtml(formatLocalDateTime(output.createdAt))}</span><div><button class="${output.approved ? 'secondary' : 'primary'}" type="button" data-approve-childrenwear-model="${escapeHtml(output.id)}">${output.approved ? '取消通过' : '审核通过'}</button><button class="text-button" type="button" data-open-childrenwear-model="${escapeHtml(output.path)}">查看原图</button></div></div>
    </article>`).join('') : '<div class="empty-inline">还没有模特图</div>';
}

function renderChildrenwearMasterLibrary() {
  const container = $('#childrenwearMasterLibrary');
  if (!container) return;
  const tasks = state.childrenwearTasks.filter(task => task.masterApproved && task.masterPath && task.masterUrl);
  const availablePaths = new Set(tasks.map(task => task.masterPath));
  for (const selected of [...state.childrenwearCombinationSelection]) {
    if (!availablePaths.has(selected)) state.childrenwearCombinationSelection.delete(selected);
  }
  container.innerHTML = tasks.length ? tasks.map(task => `
    <label class="childrenwear-master-option${state.childrenwearCombinationSelection.has(task.masterPath) ? ' selected' : ''}">
      <input type="checkbox" data-childrenwear-master-path="${escapeHtml(task.masterPath)}"${state.childrenwearCombinationSelection.has(task.masterPath) ? ' checked' : ''}>
      <img src="${escapeHtml(task.masterUrl)}" alt="${escapeHtml(task.category || '童装平铺图')}">
      <span><b>${escapeHtml(task.category || '童装')}</b><small>${escapeHtml(task.material || '材质未标注')} · 平铺图 v${Number(task.masterVersion) || 1}</small></span>
    </label>`).join('') : '<div class="empty-inline">还没有已审核平铺图</div>';
  const count = state.childrenwearCombinationSelection.size;
  $('#childrenwearCombinationStatus').textContent = count ? `已选择 ${count}/4 个平铺图` : '请选择 2～4 个平铺图';
}

function childrenwearTaskStatus(task) {
  if (task.masterApproved) return '平铺图已审核';
  if (task.masterPath) return '等待成品审核';
  return '等待生成';
}

function renderChildrenwearMasterTasks() {
  const container = $('#childrenwearMasterTaskList');
  const count = $('#childrenwearMasterTaskCount');
  if (!container || !count) return;
  count.textContent = `${state.childrenwearTasks.length} 项`;
  container.innerHTML = state.childrenwearTasks.length ? state.childrenwearTasks.map(task => `
    <button class="childrenwear-task-item${task.folder === state.childrenwearActiveTask?.folder ? ' active' : ''}" type="button" data-childrenwear-task-folder="${escapeHtml(task.folder)}">
      <img loading="lazy" src="${escapeHtml(task.masterUrl || task.realPhotoUrl || '')}" alt="${escapeHtml(task.category || '平铺图任务')}">
      <span><b>${escapeHtml(task.category || '童装平铺图')}</b><small>${escapeHtml(task.material || '材质未填写')}</small><em>${childrenwearTaskStatus(task)}</em></span>
    </button>`).join('') : '<div class="empty-inline"><b>还没有平铺图任务</b><span>选择实拍图和参考图后生成第一项任务。</span></div>';
}

function selectChildrenwearTask(folder) {
  const task = state.childrenwearTasks.find(item => item.folder === folder);
  if (!task) return;
  state.childrenwearActiveTask = task;
  state.childrenwearReal = childrenwearInputFromTask('realPhotoPath', 'realPhotoUrl', '实拍图');
  state.childrenwearReference = childrenwearInputFromTask('referencePath', 'referenceUrl', '参考图');
  renderChildrenwear();
}

function newChildrenwearMasterTask() {
  state.childrenwearActiveTask = null;
  state.childrenwearReal = null;
  state.childrenwearReference = null;
  $('#childrenwearCraft').value = '';
  $('#childrenwearMasterNote').value = '';
  $('#childrenwearMasterStatus').textContent = '请从素材库选择实拍产品图和成品参考图';
  renderChildrenwear();
}

function renderChildrenwearApprovedMasters() {
  const container = $('#childrenwearApprovedMasterList');
  if (!container) return;
  const tasks = state.childrenwearTasks.filter(task => task.masterApproved && task.masterUrl);
  container.innerHTML = tasks.length ? `<div class="childrenwear-approved-master-head"><b>选择已审核平铺图</b><span>${tasks.length} 个可用</span></div><div>` + tasks.map(task => `
    <button class="childrenwear-approved-master${task.folder === state.childrenwearActiveTask?.folder ? ' active' : ''}" type="button" data-childrenwear-model-task-folder="${escapeHtml(task.folder)}"><img loading="lazy" src="${escapeHtml(task.masterUrl)}" alt="${escapeHtml(task.category || '平铺图')}"><span><b>${escapeHtml(task.category || '童装')}</b><small>${escapeHtml(task.material || '')}</small></span></button>`).join('') + '</div>' : '<div class="empty-inline">还没有已审核平铺图，请先在 02 完成审核。</div>';
}

function renderChildrenwearLegacy() {
  const task = state.childrenwearActiveTask;
  if (task) {
    state.childrenwearReal ||= childrenwearInputFromTask('realPhotoPath', 'realPhotoUrl', '实拍图');
    state.childrenwearReference ||= childrenwearInputFromTask('referencePath', 'referenceUrl', '参考图');
    $('#childrenwearCategory').value = [...$('#childrenwearCategory').options].some(option => option.value === task.category) ? task.category : '其他童装';
    $('#childrenwearMaterial').value = task.material || $('#childrenwearMaterial').value;
    $('#childrenwearCraft').value = task.craft || '';
    $('#childrenwearMasterNote').value = task.note || '';
  }
  setChildrenwearPreview('#childrenwearRealPreview', '#childrenwearRealEmpty', state.childrenwearReal);
  setChildrenwearPreview('#childrenwearReferencePreview', '#childrenwearReferenceEmpty', state.childrenwearReference);
  setChildrenwearPreview('#childrenwearModelReferencePreview', '#childrenwearModelReferenceEmpty', state.childrenwearModelReference);
  $('#childrenwearRealName').textContent = state.childrenwearReal?.name || '尚未上传';
  $('#childrenwearReferenceName').textContent = state.childrenwearReference?.name || '尚未上传';
  $('#childrenwearModelReferenceName').textContent = state.childrenwearModelReference?.name || '尚未上传';

  const hasMaster = Boolean(task?.masterPath && task?.masterUrl);
  $('#childrenwearMasterResult').hidden = !hasMaster;
  if (hasMaster) $('#childrenwearMasterImage').src = task.masterUrl;
  $('#approveChildrenwearMasterButton').textContent = task?.masterApproved ? '已确认正式平铺图' : '确认正式平铺图';
  $('#approveChildrenwearMasterButton').disabled = Boolean(task?.masterApproved);
  $('#childrenwearMasterStage').classList.toggle('is-complete', Boolean(task?.masterApproved));
  $('#childrenwearModelStage').classList.toggle('is-active', Boolean(task?.masterApproved));
  $('#generateChildrenwearModelButton').disabled = !(task?.masterApproved && state.childrenwearModelReference?.path);
  if (task?.masterApproved) {
    $('#childrenwearMasterStatus').textContent = `正式平铺图已确认 · v${Number(task.masterVersion) || 1}`;
    $('#childrenwearModelStatus').textContent = state.childrenwearModelReference?.path ? '可以生成模特图' : '请上传模特或姿势参考图';
  }
  renderChildrenwearModelResults();
  renderChildrenwearMasterLibrary();
  renderChildrenwearMasterTasks();
  renderChildrenwearApprovedMasters();
}

async function chooseChildrenwearImage(kind) {
  try {
    const selected = await window.caishen.chooseImage();
    if (!selected) return;
    const value = { path: selected.path, url: selected.url, name: selected.name || selected.path.split(/[\\/]/).at(-1) };
    if (kind === 'real') {
      state.childrenwearReal = value;
      state.childrenwearActiveTask = null;
    } else if (kind === 'reference') {
      state.childrenwearReference = value;
      state.childrenwearActiveTask = null;
    } else {
      state.childrenwearModelReference = value;
    }
    renderChildrenwear();
  } catch (error) { toast(errorText(error), true); }
}

async function runChildrenwearMasterGeneration() {
  if (!state.childrenwearReal?.path || !state.childrenwearReference?.path) return toast('请先上传实拍图和参考成品图', true);
  const button = $('#generateChildrenwearMasterButton');
  button.disabled = true;
  button.textContent = '正在生成…';
  try {
    const payload = {
      folder: state.childrenwearActiveTask?.folder || '',
      realPhotoPath: state.childrenwearReal.path,
      referencePath: state.childrenwearReference.path,
      category: $('#childrenwearCategory').value,
      material: $('#childrenwearMaterial').value.trim(),
      craft: $('#childrenwearCraft').value.trim(),
      extraInstruction: $('#childrenwearMasterNote').value.trim()
    };
    state.childrenwearActiveTask = await window.caishen.generateChildrenwearMaster(payload, progress => {
      $('#childrenwearMasterStatus').textContent = progress.message || '正在生成平铺图';
    });
    await loadChildrenwearTasks();
    toast('平铺图候选已生成，请人工核对');
  } catch (error) {
    $('#childrenwearMasterStatus').textContent = errorText(error);
    toast(errorText(error), true);
  } finally {
    button.disabled = false;
    button.textContent = '生成平铺图候选';
    renderChildrenwear();
  }
}

async function approveChildrenwearMaster() {
  const task = state.childrenwearActiveTask;
  if (!task?.folder) return;
  try {
    state.childrenwearActiveTask = await window.caishen.approveChildrenwearOutput({ folder: task.folder, stage: 'master', approved: true });
    await loadChildrenwearTasks();
    setChildrenwearProductionTab('model');
    toast('正式平铺图已确认，可以进入模特图生产');
  } catch (error) { toast(errorText(error), true); }
  renderChildrenwear();
}

async function runChildrenwearModelGeneration() {
  const task = state.childrenwearActiveTask;
  if (!task?.masterApproved || !state.childrenwearModelReference?.path) return toast('请先确认平铺图并上传模特参考图', true);
  const button = $('#generateChildrenwearModelButton');
  button.disabled = true;
  button.textContent = '正在生成…';
  try {
    state.childrenwearActiveTask = await window.caishen.generateChildrenwearModel({
      folder: task.folder,
      modelReferencePath: state.childrenwearModelReference.path,
      extraInstruction: $('#childrenwearModelNote').value.trim()
    }, progress => { $('#childrenwearModelStatus').textContent = progress.message || '正在生成模特图'; });
    await loadChildrenwearTasks();
    $('#childrenwearModelStatus').textContent = '模特图生成完成，等待成品审核';
    toast('模特图候选已生成');
  } catch (error) {
    $('#childrenwearModelStatus').textContent = errorText(error);
    toast(errorText(error), true);
  } finally {
    button.textContent = '生成模特图';
    renderChildrenwear();
  }
}

async function toggleChildrenwearModelApproval(outputId) {
  const task = state.childrenwearActiveTask;
  const output = task?.modelOutputs?.find(item => item.id === outputId);
  if (!task || !output) return;
  try {
    state.childrenwearActiveTask = await window.caishen.approveChildrenwearOutput({
      folder: task.folder,
      stage: 'model',
      outputId,
      approved: !output.approved
    });
    await loadChildrenwearTasks();
  } catch (error) { toast(errorText(error), true); }
  renderChildrenwear();
}

function randomChildrenwearCombination() {
  const paths = state.childrenwearTasks.filter(task => task.masterApproved && task.masterPath).map(task => task.masterPath);
  if (paths.length < 2) return toast('至少需要两个已审核平铺图', true);
  for (let index = paths.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [paths[index], paths[swap]] = [paths[swap], paths[index]];
  }
  state.childrenwearCombinationSelection = new Set(paths.slice(0, Math.min(4, paths.length)));
  renderChildrenwearMasterLibrary();
}

async function runChildrenwearCombination() {
  const masterPaths = [...state.childrenwearCombinationSelection];
  if (masterPaths.length < 2 || masterPaths.length > 4) return toast('请选择 2～4 个已审核平铺图', true);
  const button = $('#generateChildrenwearCombinationButton');
  button.disabled = true;
  button.textContent = '正在排版…';
  try {
    state.childrenwearCombinationResult = await window.caishen.generateChildrenwearCombination({
      masterPaths,
      background: $('#childrenwearCombinationBackground').value,
      size: 1600
    }, progress => { $('#childrenwearCombinationStatus').textContent = progress.message || '正在生成组合图'; });
    $('#childrenwearCombinationResult').hidden = false;
    $('#childrenwearCombinationImage').src = state.childrenwearCombinationResult.url;
    $('#childrenwearCombinationStatus').textContent = '组合图已生成';
    toast('SKU 组合图已生成');
  } catch (error) {
    $('#childrenwearCombinationStatus').textContent = errorText(error);
    toast(errorText(error), true);
  } finally {
    button.disabled = false;
    button.textContent = '生成组合图';
  }
}

async function loadChildrenwearTasksLegacy() {
  try {
    const activeFolder = state.childrenwearActiveTask?.folder || '';
    state.childrenwearTasks = await window.caishen.listChildrenwearTasks();
    if (activeFolder) state.childrenwearActiveTask = state.childrenwearTasks.find(task => task.folder === activeFolder) || state.childrenwearActiveTask;
    if (!state.childrenwearActiveTask && state.childrenwearTasks.length) state.childrenwearActiveTask = state.childrenwearTasks[0];
    renderChildrenwear();
  } catch (error) {
    $('#childrenwearMasterStatus').textContent = `任务读取失败：${errorText(error)}`;
  }
}

function bindChildrenwearEventsLegacy() {
  $$('[data-childrenwear-production-tab]').forEach(button => {
    button.onclick = () => setChildrenwearProductionTab(button.dataset.childrenwearProductionTab);
  });
  $('#chooseChildrenwearRealButton').onclick = () => chooseChildrenwearImage('real');
  $('#chooseChildrenwearReferenceButton').onclick = () => chooseChildrenwearImage('reference');
  $('#chooseChildrenwearModelReferenceButton').onclick = () => chooseChildrenwearImage('model');
  $('#newChildrenwearMasterTaskButton').onclick = newChildrenwearMasterTask;
  $('#childrenwearMasterTaskList').onclick = event => {
    const button = event.target.closest('[data-childrenwear-task-folder]');
    if (button) selectChildrenwearTask(button.dataset.childrenwearTaskFolder);
  };
  $('#childrenwearApprovedMasterList').onclick = event => {
    const button = event.target.closest('[data-childrenwear-model-task-folder]');
    if (button) selectChildrenwearTask(button.dataset.childrenwearModelTaskFolder);
  };
  $('#childrenwearCategory').onchange = event => { $('#childrenwearMaterial').value = childrenwearCategoryMaterial(event.target.value); };
  $('#generateChildrenwearMasterButton').onclick = runChildrenwearMasterGeneration;
  $('#regenerateChildrenwearMasterButton').onclick = runChildrenwearMasterGeneration;
  $('#approveChildrenwearMasterButton').onclick = approveChildrenwearMaster;
  $('#openChildrenwearMasterButton').onclick = () => state.childrenwearActiveTask?.masterPath && window.caishen.revealFile(state.childrenwearActiveTask.masterPath);
  $('#generateChildrenwearModelButton').onclick = runChildrenwearModelGeneration;
  $('#childrenwearModelResults').onclick = event => {
    const approval = event.target.closest('[data-approve-childrenwear-model]');
    if (approval) return toggleChildrenwearModelApproval(approval.dataset.approveChildrenwearModel);
    const open = event.target.closest('[data-open-childrenwear-model]');
    if (open) return window.caishen.revealFile(open.dataset.openChildrenwearModel);
  };
  $('#childrenwearMasterLibrary').onchange = event => {
    const input = event.target.closest('[data-childrenwear-master-path]');
    if (!input) return;
    if (input.checked) {
      if (state.childrenwearCombinationSelection.size >= 4) {
        input.checked = false;
        return toast('组合图最多选择 4 个平铺图', true);
      }
      state.childrenwearCombinationSelection.add(input.dataset.childrenwearMasterPath);
    } else state.childrenwearCombinationSelection.delete(input.dataset.childrenwearMasterPath);
    renderChildrenwearMasterLibrary();
  };
  $('#randomChildrenwearCombinationButton').onclick = randomChildrenwearCombination;
  $('#generateChildrenwearCombinationButton').onclick = runChildrenwearCombination;
  $('#openChildrenwearCombinationButton').onclick = () => state.childrenwearCombinationResult?.outputPath && window.caishen.revealFile(state.childrenwearCombinationResult.outputPath);
  setChildrenwearProductionTab(state.childrenwearProductionTab);
  setChildrenwearAssetTab(state.childrenwearAssetTab);
}

// 多嘻噜卡生产台：永沙式左侧选材 + 右侧任务卡。提示词仅从后台设置读取，生产页不暴露内容。
const CW_STAGE_META = Object.freeze({
  master: { queue: '#cwMasterQueue', count: '#cwMasterCount', activity: '#cwMasterActivity', label: '平铺母版图' },
  model: { queue: '#cwModelQueue', count: '#cwModelCount', activity: '#cwModelActivity', label: '模特上身图' },
  combination: { queue: '#cwCombinationQueue', count: '#cwCombinationCount', activity: '#cwCombinationActivity', label: '多 SKU 组合图' }
});

function cwTodayCode() {
  const now = new Date();
  return `${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
}

function cwNextTaskCode() {
  const stamp = cwTodayCode();
  const codes = [
    ...state.childrenwearTasks.map(task => task.taskCode),
    ...state.childrenwearDrafts.master.map(draft => draft.taskCode)
  ].map(String).filter(code => code.startsWith(`${stamp}-`) && /^\d{4}-\d{3}$/.test(code));
  const sequence = codes.reduce((max, code) => Math.max(max, Number(code.slice(-3)) || 0), 0) + 1;
  return `${stamp}-${String(Math.min(999, sequence)).padStart(3, '0')}`;
}

function cwTaskDisplayName(styleName, taskCode) {
  const style = String(styleName || '童装款式').trim().replace(/^\d{4}-\d{3}\s*[-·｜|]?\s*/, '').replace(/\d{4}-\d{3}\s*$/, '').trim() || '童装款式';
  return taskCode ? `${taskCode} ${style}` : style;
}

function cwNewDraft(stage) {
  const now = new Date().toISOString();
  const draft = { id: createClientId(), stage, title: '', taskCode: '', styleName: '', selected: true, status: '待补齐素材', progress: '', result: null, createdAt: now, updatedAt: now };
  if (stage === 'model') draft.backgroundMode = state.childrenwearModelBackgroundMode || 'model_reference';
  if (stage === 'combination') draft.masters = [];
  state.childrenwearDrafts[stage].unshift(draft);
  state.childrenwearActiveDraft[stage] = draft.id;
  return draft;
}

function cwDraft(stage) {
  const drafts = state.childrenwearDrafts[stage];
  return drafts.find(item => item.id === state.childrenwearActiveDraft[stage]) || drafts[0] || cwNewDraft(stage);
}

function cwOldestDraft(stage, predicate) {
  return [...(state.childrenwearDrafts[stage] || [])].reverse().find(predicate);
}

function cwImage(value, fallback = '待选择') {
  const url = value?.thumbnailUrl || value?.url || '';
  const preview = value?.previewUrl || value?.url || '';
  return `<figure class="cw-flow-figure${url ? '' : ' empty'}">${url ? `<img loading="lazy" decoding="async" src="${escapeHtml(url)}" data-preview-src="${escapeHtml(preview)}" alt="${escapeHtml(value.name || fallback)}">` : '<span>+</span>'}<figcaption>${escapeHtml(value?.name || fallback)}</figcaption></figure>`;
}

function cwDraftReady(draft) {
  if (draft.stage === 'master') return Boolean(draft.real?.path && draft.reference?.path);
  if (draft.stage === 'model') return Boolean(draft.master?.path && draft.reference?.path
    && (draft.backgroundMode !== 'scene_reference' || draft.scene?.path));
  return Boolean(draft.masters?.length >= 2 && draft.reference?.path);
}

function cwDraftFlow(draft) {
  if (draft.stage === 'master') return `${cwImage(draft.real, '实拍产品图')}<i>+</i>${cwImage(draft.reference, '成品参考图')}<i>→</i>${cwImage(draft.result, '平铺母版图')}`;
  if (draft.stage === 'model') {
    const backgroundMode = draft.backgroundMode || 'model_reference';
    const background = backgroundMode === 'white'
      ? '<figure class="cw-flow-figure cw-background-mode"><span>白</span><figcaption>纯白背景</figcaption></figure>'
      : backgroundMode === 'scene_reference'
        ? cwImage(draft.scene, '场景参考图')
        : '<figure class="cw-flow-figure cw-background-mode"><span>同</span><figcaption>跟随模特背景</figcaption></figure>';
    return `${cwImage(draft.master, '已审核平铺图')}<i>+</i>${cwImage(draft.reference, '参考模特图')}<i>+</i>${background}<i>→</i>${cwImage(draft.result, '模特上身图')}`;
  }
  const masters = draft.masters?.length ? draft.masters.map((item, index) => `${index ? '<i>+</i>' : ''}<div class="cw-ordered-sku"><em>SKU ${String.fromCharCode(65 + index)}</em>${cwImage(item, `平铺图 ${index + 1}`)}<div><button type="button" data-cw-master-move="-1" data-cw-master-index="${index}"${index === 0 ? ' disabled' : ''}>←</button><button type="button" data-cw-master-move="1" data-cw-master-index="${index}"${index === draft.masters.length - 1 ? ' disabled' : ''}>→</button></div></div>`).join('') : cwImage(null, '选择 2～4 张平铺图');
  return `${masters}<i>+</i>${cwImage(draft.reference, '组合参考图')}<i>→</i>${cwImage(draft.result, '多 SKU 组合图')}`;
}

function cwTaskForDraft(draft) {
  return draft?.taskFolder ? state.childrenwearTasks.find(task => task.folder === draft.taskFolder) : null;
}

function cwReviewStatus(item) {
  if (!item) return 'pending';
  if (item.approved) return 'approved';
  const value = item.stage === 'master' ? item.task?.masterReviewStatus : item.output?.reviewStatus;
  return value === 'needs_regeneration' ? 'needs_regeneration' : 'pending';
}

function cwDraftStatusKey(draft) {
  if (draft.status === '生成中') return 'running';
  if (draft.status === '失败') return 'needs_regeneration';
  if (!cwDraftReady(draft)) return 'incomplete';
  const task = cwTaskForDraft(draft);
  if (draft.result?.path || (draft.stage === 'master' && task?.masterPath)) {
    const output = draft.stage === 'model'
      ? (task?.modelOutputs || []).find(item => item.id === draft.outputId || item.path === draft.result?.path)
      : draft.stage === 'combination'
        ? (task?.combinationOutputs || []).find(item => item.id === draft.outputId || item.path === draft.result?.path)
        : null;
    const approved = draft.stage === 'master' ? task?.masterApproved : output?.approved;
    const reviewStatus = draft.stage === 'master' ? task?.masterReviewStatus : output?.reviewStatus;
    if (approved || draft.status === '已通过') return 'approved';
    if (reviewStatus === 'needs_regeneration' || draft.status === '需重生成') return 'needs_regeneration';
    return 'pending';
  }
  return cwDraftReady(draft) ? 'ready' : 'incomplete';
}

function cwDraftStatusLabel(draft) {
  return ({ incomplete: '缺少素材', ready: '待生成', running: '生成中', pending: '待审核', needs_regeneration: '需重生成', approved: '已通过' })[cwDraftStatusKey(draft)] || '待处理';
}

function cwDraftMissingLabels(draft) {
  const missing = [];
  if (draft.stage === 'master') {
    if (!draft.real?.path) missing.push('实拍产品图');
    if (!draft.reference?.path) missing.push('成品参考图');
  } else if (draft.stage === 'model') {
    if (!draft.master?.path) missing.push('已审核平铺图');
    if (!draft.reference?.path) missing.push('参考模特图');
    if (draft.backgroundMode === 'scene_reference' && !draft.scene?.path) missing.push('场景参考图');
  } else {
    if ((draft.masters?.length || 0) < 2) missing.push(`平铺图（还需 ${2 - (draft.masters?.length || 0)} 张）`);
    if (!draft.reference?.path) missing.push('组合参考图');
  }
  return missing;
}

function cwDraftStatusText(draft) {
  const status = cwDraftStatusKey(draft);
  if (status === 'approved') return '审核已通过，已解锁后续步骤';
  if (status === 'needs_regeneration') return draft.progress || '生成失败或结果待重新生成';
  if (status === 'pending') return `${CW_STAGE_META[draft.stage]?.label || '图片'}已生成，等待审核`;
  if (status === 'running') return draft.progress || '正在生成';
  if (status === 'ready') return '素材已齐全，可以生成';
  return draft.status || '待补齐素材';
}

function cwDraftActivityTime(draft) {
  const task = cwTaskForDraft(draft);
  const output = draft.stage === 'model'
    ? (task?.modelOutputs || []).find(item => item.id === draft.outputId || item.path === draft.result?.path)
    : draft.stage === 'combination'
      ? (task?.combinationOutputs || []).find(item => item.id === draft.outputId || item.path === draft.result?.path)
      : null;
  return output?.createdAt || task?.masterMetrics?.completedAt || task?.updatedAt || task?.createdAt || draft.updatedAt || draft.createdAt || '';
}

function cwActivityClock(value) {
  if (!value) return '刚刚';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '刚刚';
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

function cwPersistedOutputKey(stage, folder, outputId) {
  return `${stage}\u0000${String(folder || '').toLocaleLowerCase('en-US')}\u0000${String(outputId || '')}`;
}

function cwPersistedStatus(approved, reviewStatus) {
  if (approved) return '已通过';
  return reviewStatus === 'needs_regeneration' ? '需重生成' : '等待成品审核';
}

function cwTaskMasterImage(task, masterPath = task?.masterPath, index = -1, taskByMasterPath = null) {
  if (!masterPath) return null;
  const sourceTask = taskByMasterPath?.get(masterPath) || state.childrenwearTasks.find(item => item.masterPath === masterPath);
  const taskIndex = index >= 0 ? index : (task?.masterPaths || []).indexOf(masterPath);
  return {
    path: masterPath,
    url: sourceTask?.masterUrl || (taskIndex >= 0 ? task?.masterUrls?.[taskIndex] : '') || (masterPath === task?.masterPath ? task?.masterUrl : ''),
    thumbnailUrl: sourceTask?.masterThumbnailUrl || (taskIndex >= 0 ? task?.masterThumbnailUrls?.[taskIndex] : '') || (masterPath === task?.masterPath ? task?.masterThumbnailUrl : ''),
    previewUrl: sourceTask?.masterPreviewUrl || (taskIndex >= 0 ? task?.masterPreviewUrls?.[taskIndex] : '') || (masterPath === task?.masterPath ? task?.masterPreviewUrl : ''),
    name: sourceTask?.taskName || task?.taskName || `已审核平铺图${taskIndex >= 0 ? ` ${taskIndex + 1}` : ''}`,
    folder: sourceTask?.material || task?.material || '',
    taskFolder: sourceTask?.folder || task?.folder || '',
    taskName: sourceTask?.taskName || task?.taskName || ''
  };
}

function syncCwDraftsFromTasks() {
  const taskFolders = new Set(state.childrenwearTasks.map(task => String(task.folder || '').toLocaleLowerCase('en-US')));
  const taskByMasterPath = new Map(state.childrenwearTasks.filter(task => task.masterPath).map(task => [task.masterPath, task]));
  state.childrenwearDrafts.master = state.childrenwearDrafts.master.filter(draft => {
    if (!draft.taskFolder || draft.status === '生成中') return true;
    return taskFolders.has(String(draft.taskFolder).toLocaleLowerCase('en-US'));
  });
  const drafts = state.childrenwearDrafts.master;
  const masterDraftByFolder = new Map(drafts.filter(draft => draft.taskFolder).map(draft => [draft.taskFolder, draft]));
  for (const task of state.childrenwearTasks) {
    if (!task.masterPath || !task.masterUrl) continue;
    let draft = masterDraftByFolder.get(task.folder);
    if (!draft) {
      draft = {
        id: `saved-master:${task.folder}`,
        stage: 'master',
        title: task.taskName || task.category || '平铺母版任务',
        taskCode: task.taskCode || '',
        styleName: task.styleName || task.category || '',
        selected: false,
        status: '等待成品审核',
        progress: '',
        result: null,
        taskFolder: task.folder,
        createdAt: task.createdAt || '',
        updatedAt: task.updatedAt || task.createdAt || ''
      };
      drafts.push(draft);
      masterDraftByFolder.set(task.folder, draft);
    }
    if (draft.status !== '生成中') {
      draft.title = task.taskName || draft.title;
      draft.taskCode = task.taskCode || draft.taskCode;
      draft.styleName = task.styleName || draft.styleName;
      draft.real = { path: task.realPhotoPath, url: task.realPhotoUrl, thumbnailUrl: task.realPhotoThumbnailUrl, previewUrl: task.realPhotoPreviewUrl, name: task.realPhotoPath?.split(/[\\/]/).at(-1) || '实拍产品图', folder: task.category || '' };
      draft.reference = { path: task.referencePath, url: task.referenceUrl, thumbnailUrl: task.referenceThumbnailUrl, previewUrl: task.referencePreviewUrl, name: task.referencePath?.split(/[\\/]/).at(-1) || '成品参考图', folder: '' };
      draft.result = { path: task.masterPath, url: task.masterUrl, thumbnailUrl: task.masterThumbnailUrl, previewUrl: task.masterPreviewUrl, name: `平铺母版 v${task.masterVersion || 1}` };
      draft.status = cwPersistedStatus(task.masterApproved, task.masterReviewStatus);
      draft.progress = '';
      draft.updatedAt = task.updatedAt || task.createdAt || draft.updatedAt;
    }
  }

  for (const stage of ['model', 'combination']) {
    const records = state.childrenwearTasks.flatMap(task => ((stage === 'model' ? task.modelOutputs : task.combinationOutputs) || []).map(output => ({ task, output })));
    const outputKeys = new Set(records.map(({ task, output }) => cwPersistedOutputKey(stage, task.folder, output.id)));
    state.childrenwearDrafts[stage] = state.childrenwearDrafts[stage].filter(draft => {
      if (!draft.outputId || draft.status === '生成中') return true;
      return outputKeys.has(cwPersistedOutputKey(stage, draft.taskFolder, draft.outputId));
    });
    const stageDrafts = state.childrenwearDrafts[stage];
    const draftByOutputKey = new Map(stageDrafts.filter(draft => draft.outputId).map(draft => [cwPersistedOutputKey(stage, draft.taskFolder, draft.outputId), draft]));
    const draftByResultPath = new Map(stageDrafts.filter(draft => draft.result?.path).map(draft => [draft.result.path, draft]));
    for (const { task, output } of records) {
      if (!output?.id || !output.path || !output.url) continue;
      const outputKey = cwPersistedOutputKey(stage, task.folder, output.id);
      let draft = draftByOutputKey.get(outputKey) || draftByResultPath.get(output.path);
      if (!draft) {
        draft = {
          id: `saved-${stage}:${task.folder}:${output.id}`,
          stage,
          title: output.taskName || task.taskName || task.category || CW_STAGE_META[stage].label,
          taskCode: task.taskCode || '',
          styleName: task.styleName || task.category || '',
          selected: false,
          status: '等待成品审核',
          progress: '',
          result: null,
          taskFolder: task.folder,
          outputId: output.id,
          createdAt: output.createdAt || task.createdAt || '',
          updatedAt: output.createdAt || task.updatedAt || task.createdAt || ''
        };
        if (stage === 'combination') draft.masters = [];
        stageDrafts.push(draft);
        draftByOutputKey.set(outputKey, draft);
        draftByResultPath.set(output.path, draft);
      }
      if (draft.status === '生成中') continue;
      draft.title = output.taskName || task.taskName || draft.title;
      draft.taskCode = task.taskCode || draft.taskCode;
      draft.styleName = task.styleName || task.category || draft.styleName;
      draft.taskFolder = task.folder;
      draft.outputId = output.id;
      draft.result = { path: output.path, url: output.url, thumbnailUrl: output.thumbnailUrl, previewUrl: output.previewUrl, name: stage === 'model' ? '模特图候选' : '组合图候选' };
      draft.status = cwPersistedStatus(output.approved, output.reviewStatus);
      draft.progress = '';
      draft.updatedAt = output.createdAt || task.updatedAt || draft.updatedAt;
      if (stage === 'model') {
        draft.master = cwTaskMasterImage(task, output.masterPath || task.masterPath, -1, taskByMasterPath);
        draft.reference = {
          path: output.modelReferencePath,
          url: output.modelReferenceUrl,
          thumbnailUrl: output.modelReferenceThumbnailUrl,
          previewUrl: output.modelReferencePreviewUrl,
          name: output.modelReferencePath?.split(/[\\/]/).at(-1) || '参考模特图',
          folder: ''
        };
        draft.backgroundMode = output.backgroundMode || 'model_reference';
        draft.scene = output.sceneReferencePath ? {
          path: output.sceneReferencePath,
          url: output.sceneReferenceUrl,
          thumbnailUrl: output.sceneReferenceThumbnailUrl,
          previewUrl: output.sceneReferencePreviewUrl,
          name: output.sceneReferencePath.split(/[\\/]/).at(-1) || '场景参考图',
          folder: ''
        } : null;
      } else {
        const masterPaths = output.masterPaths?.length ? output.masterPaths : (task.masterPaths || []);
        const imageTask = output.masterPaths?.length ? {
          ...task,
          masterPaths,
          masterUrls: output.masterUrls,
          masterThumbnailUrls: output.masterThumbnailUrls,
          masterPreviewUrls: output.masterPreviewUrls
        } : task;
        draft.masters = masterPaths.map((masterPath, index) => cwTaskMasterImage(imageTask, masterPath, index, taskByMasterPath)).filter(Boolean);
        draft.reference = {
          path: output.combinationReferencePath || task.combinationReferencePath,
          url: output.combinationReferenceUrl || task.combinationReferenceUrl,
          thumbnailUrl: output.combinationReferenceThumbnailUrl || task.combinationReferenceThumbnailUrl,
          previewUrl: output.combinationReferencePreviewUrl || task.combinationReferencePreviewUrl,
          name: (output.combinationReferencePath || task.combinationReferencePath)?.split(/[\\/]/).at(-1) || '组合参考图',
          folder: ''
        };
      }
    }
    if (!stageDrafts.some(draft => draft.id === state.childrenwearActiveDraft[stage])) state.childrenwearActiveDraft[stage] = stageDrafts[0]?.id || '';
  }
  if (!state.childrenwearDrafts.master.some(draft => draft.id === state.childrenwearActiveDraft.master)) state.childrenwearActiveDraft.master = state.childrenwearDrafts.master[0]?.id || '';
}

function cwFilteredDrafts(stage) {
  const drafts = state.childrenwearDrafts[stage] || [];
  const filter = state.childrenwearQueueFilters[stage] || 'all';
  return filter !== 'all' ? drafts.filter(draft => cwDraftStatusKey(draft) === filter) : drafts;
}

function updateCwQueueProgress(stage, draft) {
  if (!cwQueueProgressDirty.has(stage)) cwQueueProgressDirty.set(stage, new Map());
  cwQueueProgressDirty.get(stage).set(draft.id, draft);
  if (cwQueueProgressTimers.has(stage)) return;
  cwQueueProgressTimers.set(stage, setTimeout(() => {
    cwQueueProgressTimers.delete(stage);
    const panel = $(CW_STAGE_META[stage]?.queue);
    const cards = panel ? new Map([...panel.querySelectorAll('[data-cw-draft]')].map(card => [card.dataset.cwDraft, card])) : new Map();
    const dirty = cwQueueProgressDirty.get(stage) || new Map();
    cwQueueProgressDirty.set(stage, new Map());
    for (const changedDraft of dirty.values()) {
      const status = cards.get(changedDraft.id)?.querySelector('.cw-task-status');
      if (!status) continue;
      const next = changedDraft.progress || cwDraftStatusText(changedDraft);
      if (status.textContent !== next) status.textContent = next;
      status.classList.toggle('error', changedDraft.status === '失败' || cwDraftStatusKey(changedDraft) === 'needs_regeneration');
    }
    scheduleCwActivityRender(stage);
  }, 250));
}

function scheduleCwActivityRender(stage) {
  if (cwActivityRenderTimers.has(stage)) return;
  cwActivityRenderTimers.set(stage, setTimeout(() => {
    cwActivityRenderTimers.delete(stage);
    renderCwActivity(stage);
  }, 800));
}

function cwReviewItemForDraft(stage, draft, reviewIndex = null) {
  if (!draft?.taskFolder) return null;
  if (reviewIndex) {
    const id = stage === 'master' ? `master:${draft.taskFolder}` : (draft.outputId ? `${stage}:${draft.taskFolder}:${draft.outputId}` : '');
    return (id && reviewIndex.byId.get(id)) || (draft.result?.path && reviewIndex.byPath.get(draft.result.path)) || null;
  }
  return cwReviewItems().find(item => item.stage === stage && item.folder === draft.taskFolder
    && (stage === 'master' || (draft.outputId && item.outputId === draft.outputId) || (draft.result?.path && item.path === draft.result.path)));
}

function cwTaskReviewIndex() {
  const reviewItems = cwReviewItems();
  return {
    byId: new Map(reviewItems.map(item => [item.id, item])),
    byPath: new Map(reviewItems.filter(item => item.path).map(item => [item.path, item]))
  };
}

function syncCwGenerationPreviewState() {
  const generationActive = Object.values(state.childrenwearDrafts).some(items => items.some(item => item.status === '生成中'));
  document.documentElement.classList.toggle('childrenwear-generation-active', generationActive);
  if (!generationActive) return;
  $('#imageHoverPreview')?.classList.remove('show', 'positioning');
  $('#imageHoverLens')?.classList.remove('show');
}

function cwTaskCardMarkup(stage, draft, index, reviewIndex) {
  const meta = CW_STAGE_META[stage];
  const running = draft.status === '生成中';
  const ready = cwDraftReady(draft);
  const reviewItem = cwReviewItemForDraft(stage, draft, reviewIndex);
  const reviewStatus = reviewItem ? cwReviewStatus(reviewItem) : '';
  const title = draft.title || `${meta.label}任务 ${index + 1}`;
  const statusKey = cwDraftStatusKey(draft);
  const missing = cwDraftMissingLabels(draft);
  return `<article class="cw-task-card ${statusKey}${draft.selected ? ' selected' : ''}${draft.id === state.childrenwearActiveDraft[stage] ? ' editing' : ''}${reviewStatus === 'approved' ? ' approved' : ''}${reviewStatus === 'needs_regeneration' ? ' needs-regeneration' : ''}" data-cw-draft="${escapeHtml(draft.id)}" data-stage="${stage}">
      <header><label><input type="checkbox" data-cw-select-draft="${escapeHtml(draft.id)}"${draft.selected ? ' checked' : ''}><span></span><span class="cw-task-title-line"><b title="${escapeHtml(title)}">${escapeHtml(title)}</b><em class="cw-task-state-badge ${statusKey}">${escapeHtml(cwDraftStatusLabel(draft))}</em></span></label><div><button class="secondary mini" type="button" data-cw-edit="${escapeHtml(draft.id)}">改名</button><button class="link-danger" type="button" data-cw-remove="${escapeHtml(draft.id)}"${running ? ' disabled' : ''}>删除</button></div></header>
      <div class="cw-task-flow">${cwDraftFlow(draft)}</div>
      ${missing.length ? `<div class="cw-task-missing">还缺：${escapeHtml(missing.join('、'))}</div>` : ''}
      <footer><span class="cw-task-status${statusKey === 'needs_regeneration' ? ' error' : ''}">${escapeHtml(draft.progress || cwDraftStatusText(draft))}</span><div class="cw-task-card-actions">${reviewItem ? `<button class="secondary" type="button" data-cw-inline-compare="${escapeHtml(reviewItem.id)}">高清审核</button>${stage === 'master' && !reviewItem.approved ? `<button class="secondary" type="button" data-cw-inline-approve="${escapeHtml(reviewItem.id)}">通过</button>` : ''}` : ''}<button class="secondary" type="button" data-cw-generate-one="${escapeHtml(draft.id)}"${!ready || running ? ' disabled' : ''}>${draft.result || draft.status === '失败' ? '重新生成' : `生成${escapeHtml(meta.label)}`}</button></div></footer>
    </article>`;
}

function renderCwQueueFilters(stage) {
  const panel = document.querySelector(`[data-childrenwear-production-panel="${stage}"]`);
  if (!panel) return;
  const filterBar = panel.querySelector('.cw-queue-filters');
  if (!filterBar) return;
  filterBar.hidden = false;
  filterBar.setAttribute('data-stage', stage);
  const drafts = state.childrenwearDrafts[stage] || [];
  const counts = drafts.reduce((result, draft) => {
    const key = cwDraftStatusKey(draft);
    result[key] = (result[key] || 0) + 1;
    return result;
  }, { all: drafts.length });
  filterBar.querySelectorAll('[data-cw-queue-filter]').forEach(button => {
    const key = button.dataset.cwQueueFilter;
    button.innerHTML = `${escapeHtml(button.dataset.label || key)}<small>${Number(counts[key]) || 0}</small>`;
    button.classList.toggle('active', (state.childrenwearQueueFilters[stage] || 'all') === key);
  });
}

function renderCwActivity(stage) {
  const meta = CW_STAGE_META[stage];
  const list = $(meta?.activity);
  const panel = document.querySelector(`[data-childrenwear-production-panel="${stage}"]`);
  if (!list || !panel) return;
  panel.classList.toggle('activity-collapsed', Boolean(state.childrenwearActivityCollapsed[stage]));
  const drafts = [...(state.childrenwearDrafts[stage] || [])].sort((a, b) => String(cwDraftActivityTime(b)).localeCompare(String(cwDraftActivityTime(a))));
  list.innerHTML = drafts.length ? drafts.slice(0, 120).map(draft => {
    const key = cwDraftStatusKey(draft);
    const title = draft.title || `${meta.label}任务`;
    const missing = cwDraftMissingLabels(draft);
    const detail = missing.length ? `缺少：${missing.join('、')}` : (draft.progress || cwDraftStatusText(draft));
    return `<button class="cw-activity-item ${key}" type="button" data-cw-activity-jump="${escapeHtml(draft.id)}" data-stage="${stage}"><span><b title="${escapeHtml(title)}">${escapeHtml(title)}</b><em>${escapeHtml(cwActivityClock(cwDraftActivityTime(draft)))}</em></span><small>${escapeHtml(cwDraftStatusLabel(draft))} · ${escapeHtml(detail)}</small></button>`;
  }).join('') : '<div class="cw-activity-empty">暂无任务动态</div>';
}

function renderCwQueue(stage) {
  const meta = CW_STAGE_META[stage];
  const panel = $(meta.queue);
  if (!panel) return;
  const drafts = state.childrenwearDrafts[stage];
  syncCwGenerationPreviewState();
  const filter = state.childrenwearQueueFilters[stage] || 'all';
  const visibleDrafts = cwFilteredDrafts(stage);
  const visibleLimit = Math.max(12, Number(state.childrenwearQueueVisibleLimits[stage]) || 36);
  const renderedDrafts = visibleDrafts.slice(0, visibleLimit);
  const remainingDrafts = Math.max(0, visibleDrafts.length - renderedDrafts.length);
  const reviewIndex = cwTaskReviewIndex();
  $(meta.count).textContent = filter !== 'all' ? `${visibleDrafts.length} / ${drafts.length} 项` : `${drafts.length} 项`;
  const cards = renderedDrafts.map((draft, index) => cwTaskCardMarkup(stage, draft, index, reviewIndex)).join('');
  panel.innerHTML = visibleDrafts.length
    ? `${cards}${remainingDrafts ? `<button class="cw-review-load-more" type="button" data-cw-queue-more="${stage}">继续显示 ${Math.min(36, remainingDrafts)} 个任务（剩余 ${remainingDrafts} 个）</button>` : ''}`
    : `<div class="cw-task-empty"><b>${drafts.length ? '当前筛选没有任务' : `还没有${escapeHtml(meta.label)}任务`}</b><span>${drafts.length ? '切换其他状态查看任务。' : '点击左侧素材，系统会自动创建并补齐任务卡片。'}</span></div>`;
  renderCwQueueFilters(stage);
  renderCwActivity(stage);
}

function patchCwQueueTaskResults(stage, changedFolderKeys) {
  const meta = CW_STAGE_META[stage];
  const panel = $(meta.queue);
  if (!panel || !(changedFolderKeys instanceof Set) || !changedFolderKeys.size) return renderCwQueue(stage);
  const drafts = state.childrenwearDrafts[stage];
  const visibleDrafts = cwFilteredDrafts(stage);
  const visibleLimit = Math.max(12, Number(state.childrenwearQueueVisibleLimits[stage]) || 36);
  const renderedDrafts = visibleDrafts.slice(0, visibleLimit);
  const reviewIndex = cwTaskReviewIndex();
  const currentCards = new Map([...panel.querySelectorAll('[data-cw-draft]')].map(card => [card.dataset.cwDraft, card]));
  const renderedIds = new Set(renderedDrafts.map(draft => draft.id));
  for (const [id, card] of currentCards) {
    if (renderedIds.has(id)) continue;
    const draft = drafts.find(item => item.id === id);
    if (draft && changedFolderKeys.has(cwFolderKey(draft.taskFolder))) card.remove();
  }
  for (let index = 0; index < renderedDrafts.length; index += 1) {
    const draft = renderedDrafts[index];
    if (!changedFolderKeys.has(cwFolderKey(draft.taskFolder))) continue;
    const current = currentCards.get(draft.id);
    const holder = document.createElement('template');
    holder.innerHTML = cwTaskCardMarkup(stage, draft, index, reviewIndex).trim();
    const replacement = holder.content.firstElementChild;
    if (!replacement) continue;
    if (!current) {
      const nextDraft = renderedDrafts.slice(index + 1).find(item => currentCards.has(item.id));
      const nextCard = nextDraft ? currentCards.get(nextDraft.id) : panel.querySelector('[data-cw-queue-more]');
      panel.insertBefore(replacement, nextCard || null);
      currentCards.set(draft.id, replacement);
      continue;
    }
    // Preserve source <img> nodes whose URL did not change. Replacing the whole
    // card forced Chromium to decode every source/reference image again whenever
    // one result completed, which was especially costly during concurrent runs.
    const oldFigures = [...current.querySelectorAll('.cw-flow-figure')];
    const newFigures = [...replacement.querySelectorAll('.cw-flow-figure')];
    for (let figureIndex = 0; figureIndex < Math.min(oldFigures.length, newFigures.length); figureIndex += 1) {
      const oldImage = oldFigures[figureIndex].querySelector('img');
      const newImage = newFigures[figureIndex].querySelector('img');
      if (!oldImage || !newImage || oldImage.getAttribute('src') !== newImage.getAttribute('src')) continue;
      newImage.replaceWith(oldImage);
    }
    current.replaceWith(replacement);
    currentCards.set(draft.id, replacement);
  }
  syncCwGenerationPreviewState();
  const filter = state.childrenwearQueueFilters[stage] || 'all';
  $(meta.count).textContent = filter !== 'all' ? `${visibleDrafts.length} / ${drafts.length} 项` : `${drafts.length} 项`;
  renderCwQueueFilters(stage);
  renderCwActivity(stage);
}

function cwLibrarySource(stage) {
  const tab = state.childrenwearSourceTabs[stage];
  if (tab === 'master-real') return { key: 'childrenwearRealAssetsPath', role: 'real', folders: '#cwMasterSourceFolders', grid: '#cwMasterSourceGrid' };
  if (tab === 'master-reference') return { key: 'childrenwearReferenceAssetsPath', role: 'reference', folders: '#cwMasterSourceFolders', grid: '#cwMasterSourceGrid' };
  if (tab === 'model-reference') return { key: 'childrenwearModelAssetsPath', role: 'reference', folders: '#cwModelSourceFolders', grid: '#cwModelSourceGrid' };
  if (tab === 'model-scene') return { key: 'childrenwearSceneAssetsPath', role: 'scene', folders: '#cwModelSourceFolders', grid: '#cwModelSourceGrid' };
  if (tab === 'combination-reference') return { key: 'childrenwearCombinationAssetsPath', role: 'reference', folders: '#cwCombinationSourceFolders', grid: '#cwCombinationSourceGrid' };
  if (tab === 'model-master') return { approved: true, role: 'master', folders: '#cwModelSourceFolders', grid: '#cwModelSourceGrid' };
  return { approved: true, role: 'master', folders: '#cwCombinationSourceFolders', grid: '#cwCombinationSourceGrid' };
}

function renderCwSource(stage) {
  const source = cwLibrarySource(stage);
  const folders = $(source.folders);
  const grid = $(source.grid);
  if (!folders || !grid) return;
  if (source.approved) {
    const items = state.childrenwearTasks.filter(task => task.masterApproved && task.masterPath && task.masterUrl).map(task => ({ path: task.masterPath, url: task.masterUrl, thumbnailUrl: task.masterThumbnailUrl, previewUrl: task.masterPreviewUrl, name: task.taskName || task.category || '已审核平铺图', folder: task.material || '', taskFolder: task.folder, taskName: task.taskName || task.category || '' }));
    folders.innerHTML = `<span>已审核平铺图</span><b>${items.length} 张可用</b>`;
    grid.innerHTML = items.length ? items.map(item => `<button class="cw-source-item" type="button" data-cw-source-path="${escapeHtml(item.path)}" data-cw-source-role="master"><img loading="lazy" decoding="async" src="${escapeHtml(item.thumbnailUrl || item.url)}" data-preview-src="${escapeHtml(item.previewUrl || item.url)}" alt="${escapeHtml(item.name)}"><span><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.folder)}</small></span></button>`).join('') : '<div class="cw-source-empty">平铺图审核通过后才会显示在这里，可在 02 就地审核或到 05 集中处理。</div>';
    return;
  }
  const active = state.childrenwearLibraryFolder[source.key] || 'root';
  const libraryFolders = state.childrenwearProductionFolders[source.key] || [];
  folders.innerHTML = libraryFolders.length ? libraryFolders.map(folder => `<button class="${folder.id === active ? 'active' : ''}" type="button" data-cw-source-folder="${escapeHtml(folder.id)}" data-cw-source-key="${source.key}">${escapeHtml(folder.name)}<small>${Number(folder.count) || 0}</small></button>`).join('') : '<span>暂无文件夹</span>';
  const items = state.childrenwearProductionLibraries[source.key] || [];
  grid.innerHTML = items.length ? items.map(item => `<button class="cw-source-item" type="button" data-cw-source-path="${escapeHtml(item.path)}" data-cw-source-role="${source.role}"><img loading="lazy" decoding="async" src="${escapeHtml(item.thumbnailUrl || item.url)}" data-preview-src="${escapeHtml(item.previewUrl || item.url)}" alt="${escapeHtml(item.name)}"><span><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.folder || '')}</small></span></button>`).join('') : '<div class="cw-source-empty">当前文件夹没有已完成 AI 分析的素材，请先到 01 素材资产完成分析。</div>';
}

function cwFindSource(stage, role, pathValue) {
  if (role === 'master') {
    const task = state.childrenwearTasks.find(item => item.masterPath === pathValue);
    return task ? { path: task.masterPath, url: task.masterUrl, thumbnailUrl: task.masterThumbnailUrl, previewUrl: task.masterPreviewUrl, name: task.taskName || task.category || '已审核平铺图', folder: task.material || '', taskFolder: task.folder, taskName: task.taskName || task.category || '' } : null;
  }
  const source = cwLibrarySource(stage);
  return (state.childrenwearProductionLibraries[source.key] || []).find(item => item.path === pathValue) || null;
}

function cwRememberSelection(draft, role, source) {
  draft.selectionHistory ||= [];
  draft.selectionHistory.push({ role: draft.stage === 'combination' && role === 'master' ? 'master-item' : role, path: source.path });
  draft.selectionHistory = draft.selectionHistory.slice(-20);
  draft.updatedAt = new Date().toISOString();
}

function cwRemoveLastSelectedSource(stage, draft) {
  if (!draft || draft.status === '生成中') return false;
  const history = draft.selectionHistory || [];
  let removed = false;
  while (history.length && !removed) {
    const entry = history.pop();
    if (entry.role === 'master-item') {
      const before = draft.masters?.length || 0;
      draft.masters = (draft.masters || []).filter(item => item.path !== entry.path);
      removed = draft.masters.length !== before;
    } else if (draft[entry.role]?.path === entry.path) {
      draft[entry.role] = null;
      removed = true;
    }
  }
  if (!removed) {
    if (stage === 'combination' && draft.reference?.path) { draft.reference = null; removed = true; }
    else if (stage === 'combination' && draft.masters?.length) { draft.masters.pop(); removed = true; }
    else {
      const fallback = stage === 'master' ? ['reference', 'real'] : ['scene', 'reference', 'master'];
      const role = fallback.find(key => draft[key]?.path);
      if (role) { draft[role] = null; removed = true; }
    }
  }
  if (!removed) return false;
  draft.status = cwDraftReady(draft) ? '待生成' : '待补齐素材';
  draft.selected = true;
  draft.updatedAt = new Date().toISOString();
  return true;
}

function addCwSource(stage, role, pathValue) {
  const source = cwFindSource(stage, role, pathValue);
  if (!source) return;
  let draft;
  let selectionAdded = true;
  if (stage === 'master') {
    // 永沙式顺序配对：同类素材每点一次占用一张卡，另一类素材再从第一张空卡开始补齐。
    draft = cwOldestDraft(stage, item => !item[role]?.path) || cwNewDraft(stage);
    draft[role] = source;
  } else if (stage === 'model') {
    if (role === 'scene') {
      state.childrenwearModelBackgroundMode = 'scene_reference';
      draft = cwOldestDraft(stage, item => item.backgroundMode === 'scene_reference' && !item.scene?.path) || cwDraft(stage);
      draft.backgroundMode = 'scene_reference';
      draft.scene = source;
    } else {
      draft = cwOldestDraft(stage, item => !item[role]?.path) || cwNewDraft(stage);
      draft[role] = source;
      draft.backgroundMode ||= state.childrenwearModelBackgroundMode || 'model_reference';
    }
  } else if (role === 'reference') {
    draft = cwOldestDraft(stage, item => !item.reference?.path) || cwNewDraft(stage);
    draft.reference = source;
  } else {
    draft = cwDraft(stage);
    const exists = draft.masters.some(item => item.path === source.path);
    if (exists) {
      draft.masters = draft.masters.filter(item => item.path !== source.path);
      draft.selectionHistory = (draft.selectionHistory || []).filter(item => !(item.role === 'master-item' && item.path === source.path));
      selectionAdded = false;
    }
    else if (draft.masters.length < 4) draft.masters.push(source);
    else {
      draft = cwNewDraft(stage);
      draft.masters.push(source);
    }
  }
  if (!draft.title) {
    if (stage === 'master' && role === 'real') {
      const style = source.folder && source.folder !== '根目录' ? source.folder : '童装款式';
      draft.styleName = style;
      draft.taskCode = draft.taskCode || cwNextTaskCode();
      draft.title = cwTaskDisplayName(style, draft.taskCode);
    } else if (role === 'master') {
      draft.title = source.taskName || source.name || CW_STAGE_META[stage].label;
    }
  }
  if (stage === 'combination' && draft.masters?.length) {
    const participants = draft.masters.map(item => item.taskName || item.name).filter(Boolean);
    draft.title = `${participants[0]}｜多组合SKU：${participants.join(' + ')}`;
  }
  state.childrenwearActiveDraft[stage] = draft.id;
  if (selectionAdded) cwRememberSelection(draft, role, source);
  draft.status = cwDraftReady(draft) ? '待生成' : '待补齐素材';
  draft.selected = true;
  draft.updatedAt = new Date().toISOString();
  renderCwQueue(stage);
}

function setChildrenwearProductionTab(tab) {
  const next = CW_STAGE_META[tab] ? tab : 'master';
  state.childrenwearProductionTab = next;
  $$('[data-childrenwear-production-panel]').forEach(panel => { panel.hidden = panel.dataset.childrenwearProductionPanel !== next; });
  $$('[data-childrenwear-production-nav]').forEach(button => {
    const active = currentPage === 'childrenwear' && button.dataset.childrenwearProductionNav === next;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
  renderCwSource(next);
  renderCwQueue(next);
}

function cwDraftGenerationPayload(stage, draft) {
  if (stage === 'master') return {
    folder: draft.taskFolder || '', realPhotoPath: draft.real.path, referencePath: draft.reference.path,
    taskName: draft.title, taskCode: draft.taskCode, category: draft.real.folder || '童装', material: '以实拍图为准', craft: '', extraInstruction: ''
  };
  if (stage === 'model') return {
    folder: draft.master.taskFolder, taskName: draft.title,
    modelReferencePath: draft.reference.path,
    backgroundMode: draft.backgroundMode || 'model_reference',
    sceneReferencePath: draft.backgroundMode === 'scene_reference' ? draft.scene?.path || '' : '',
    extraInstruction: ''
  };
  return {
    folder: draft.taskFolder || draft.masters[0]?.taskFolder || '', taskName: draft.title,
    masterPaths: draft.masters.map(item => item.path), combinationReferencePath: draft.reference.path
  };
}

function applyCwDraftGenerationResult(stage, draft, result) {
  draft.taskFolder = result.folder;
  draft.taskCode = result.taskCode || draft.taskCode;
  draft.styleName = result.styleName || draft.styleName;
  draft.title = result.taskName || draft.title || cwTaskDisplayName(draft.styleName, draft.taskCode);
  if (stage === 'master') {
    draft.result = { path: result.masterPath, url: result.masterUrl, thumbnailUrl: result.masterThumbnailUrl, previewUrl: result.masterPreviewUrl, name: `平铺母版 v${result.masterVersion || 1}` };
  } else {
    const output = (stage === 'model' ? result.modelOutputs : result.combinationOutputs)?.at(-1);
    draft.outputId = output?.id;
    draft.result = output ? {
      path: output.path, url: output.url, thumbnailUrl: output.thumbnailUrl, previewUrl: output.previewUrl,
      name: stage === 'model' ? '模特图候选' : '组合图候选'
    } : null;
  }
  draft.status = '等待成品审核';
  draft.progress = stage === 'master' ? '平铺图已生成，请在当前页面高清审核' : '已进入 05 成品审核与下载';
  draft.updatedAt = new Date().toISOString();
}

function mergeCwGeneratedTaskSnapshot(snapshot) {
  if (!snapshot?.folder) return;
  const key = cwFolderKey(snapshot.folder);
  const index = state.childrenwearTasks.findIndex(item => cwFolderKey(item.folder) === key);
  const previous = index >= 0 ? state.childrenwearTasks[index] : {};
  const mergeOutputs = (oldItems, newItems) => {
    const merged = new Map((Array.isArray(oldItems) ? oldItems : []).filter(item => item?.id).map(item => [item.id, item]));
    for (const item of Array.isArray(newItems) ? newItems : []) if (item?.id) merged.set(item.id, item);
    return [...merged.values()];
  };
  const next = {
    ...previous,
    ...snapshot,
    modelOutputs: mergeOutputs(previous.modelOutputs, snapshot.modelOutputs),
    combinationOutputs: mergeOutputs(previous.combinationOutputs, snapshot.combinationOutputs)
  };
  if (index >= 0) state.childrenwearTasks[index] = next;
  else state.childrenwearTasks.push(next);
}

function applyCwBatchTaskResult(stage, draft, result) {
  if (!draft || !result?.folder) return;
  applyCwDraftGenerationResult(stage, draft, result);
  mergeCwGeneratedTaskSnapshot(result);
  patchCwQueueTaskResults(stage, new Set([cwFolderKey(result.folder)]));
}

async function runCwDraft(stage, draft, options = {}) {
  if (!cwDraftReady(draft) || (draft.status === '生成中' && !options.prepared)) return;
  if (!options.prepared) {
    draft.status = '生成中';
    draft.progress = '正在提交生成任务…';
    draft.updatedAt = new Date().toISOString();
  }
  if (!options.deferRender) renderCwQueue(stage);
  try {
    const generator = stage === 'master'
      ? window.caishen.generateChildrenwearMaster
      : stage === 'model'
        ? window.caishen.generateChildrenwearModel
        : window.caishen.generateChildrenwearCombination;
    const result = await generator(cwDraftGenerationPayload(stage, draft), progress => {
      draft.progress = progress.message || `正在生成${CW_STAGE_META[stage].label}`;
      updateCwQueueProgress(stage, draft);
    });
    applyCwDraftGenerationResult(stage, draft, result);
    applyChildrenwearTaskSnapshots([result]);
    if (options.liveRefresh && result?.folder) void scheduleChildrenwearTaskRefresh(result.folder);
    else if (!options.deferReload && !result?.folder) await loadChildrenwearTasks();
    if (!options.silent) toast(stage === 'master' ? '平铺图生成完成，请在当前页面审核' : `${CW_STAGE_META[stage].label}生成完成，已进入 05 成品审核与下载`);
    return true;
  } catch (error) {
    draft.status = '失败';
    draft.progress = childrenwearFriendlyError(error);
    draft.updatedAt = new Date().toISOString();
    if (!options.silent) toast(childrenwearFriendlyError(error), true);
    return false;
  }
  finally {
    if (options.deferRender) updateCwQueueProgress(stage, draft);
    else renderCwQueue(stage);
  }
}

async function runCwBatch(stage, mode = 'generate') {
  const selected = cwFilteredDrafts(stage).filter(item => item.selected && item.status !== '生成中');
  const drafts = selected.filter(item => {
    if (!cwDraftReady(item)) return false;
    const hasResult = Boolean(item.result?.path);
    return mode === 'regenerate' ? (hasResult || item.status === '失败' || cwDraftStatusKey(item) === 'needs_regeneration') : (!hasResult && cwDraftStatusKey(item) === 'ready');
  });
  if (!drafts.length) return toast(mode === 'regenerate' ? '选中任务中没有可重新生成的结果或失败任务' : '选中任务中没有尚未出图且素材齐全的任务', true);
  const skipped = selected.length - drafts.length;
  const confirmed = await brandConfirm(
    `${mode === 'regenerate' ? '重新生成' : '首次生成'} ${drafts.length} 个任务？${skipped > 0 ? `\n\n已自动跳过 ${skipped} 个不符合本次操作的选中任务。` : ''}`,
    { title: mode === 'regenerate' ? '确认批量重新生成' : '确认批量生成', confirmText: mode === 'regenerate' ? '重新生成' : '开始生成' }
  );
  if (!confirmed) return;
  for (const draft of drafts) {
    draft.status = '生成中';
    draft.progress = '正在提交整批任务…';
    draft.updatedAt = new Date().toISOString();
  }
  renderCwQueue(stage);
  const processedCompletedIndexes = new Set();
  try {
    const progressHandler = progress => {
      for (const completed of Array.isArray(progress.completedItems) ? progress.completedItems : []) {
        if (processedCompletedIndexes.has(Number(completed.index))) continue;
        const completedDraft = drafts[Number(completed.index)];
        if (!completedDraft || completed.failed) continue;
        if (Number(progress.itemIndex) !== Number(completed.index) || !progress.itemResult) continue;
        processedCompletedIndexes.add(Number(completed.index));
        applyCwBatchTaskResult(stage, completedDraft, progress.itemResult);
      }
      const index = Number(progress.itemIndex);
      const draft = Number.isInteger(index) ? drafts[index] : null;
      if (!draft) return;
      if (progress.itemState === 'failed') {
        draft.status = '失败';
        draft.progress = childrenwearFriendlyError(progress.itemError || progress.message);
        draft.updatedAt = new Date().toISOString();
      } else if (progress.itemState !== 'completed') {
        draft.progress = progress.message || `服务端并发处理中（${progress.concurrency || '-'} 路）`;
      }
      updateCwQueueProgress(stage, draft);
    };
    const batch = await window.caishen.generateChildrenwearBatch({
      stage,
      items: drafts.map(draft => cwDraftGenerationPayload(stage, draft))
    }, progressHandler);
    for (const record of batch.results || []) {
      const draft = drafts[record.index];
      if (!draft) continue;
      if (record.ok) {
        if (!processedCompletedIndexes.has(Number(record.index))) applyCwBatchTaskResult(stage, draft, record.value);
      } else {
        draft.status = '失败';
        draft.progress = childrenwearFriendlyError(record.error);
        draft.updatedAt = new Date().toISOString();
        updateCwQueueProgress(stage, draft);
      }
    }
    const failed = Number(batch.failed) || drafts.filter(draft => draft.status === '失败').length;
    const succeeded = drafts.length - failed;
    if (failed) return toast(`批量任务完成：成功 ${succeeded} 个，失败 ${failed} 个；失败卡片可单独重新生成`, true);
    toast(stage === 'master' ? `${succeeded} 个平铺图任务已并发生成，请继续批量审核` : `${succeeded} 个任务已并发生成并进入成品审核与下载`);
  } catch (error) {
    for (const draft of drafts.filter(item => item.status === '生成中')) {
      draft.status = '失败';
      draft.progress = childrenwearFriendlyError(error);
      draft.updatedAt = new Date().toISOString();
      updateCwQueueProgress(stage, draft);
    }
    toast(`批量任务失败：${childrenwearFriendlyError(error)}`, true);
  }
}

function cwFolderKey(value) {
  return String(value || '').replaceAll('/', '\\').toLocaleLowerCase('en-US');
}

function cwDraftReferencesFolder(draft, folderKeys) {
  if (folderKeys.has(cwFolderKey(draft.taskFolder))) return true;
  if (folderKeys.has(cwFolderKey(draft.master?.taskFolder))) return true;
  return (draft.masters || []).some(item => folderKeys.has(cwFolderKey(item.taskFolder)));
}

async function deleteCwDraftCards(stage, drafts) {
  const removable = (drafts || []).filter(draft => draft && draft.status !== '生成中');
  if (!removable.length) return toast('没有可以删除的任务卡片', true);
  const persistentFolders = [...new Set(removable.map(draft => draft.taskFolder).filter(Boolean))];
  const transientCount = removable.filter(draft => !draft.taskFolder).length;
  const message = persistentFolders.length
    ? `确定永久删除 ${persistentFolders.length} 个款式任务吗？对应的平铺图、模特图、组合图、任务素材、生成证据和人工审核记录都会从本地工作区中真实删除。此操作不可撤销。${transientCount ? `\n\n另外会移除 ${transientCount} 个尚未生成的草稿卡片。` : ''}`
    : `确定删除 ${transientCount} 个尚未生成的任务卡片吗？`;
  if (!await brandConfirm(message, { title: '永久删除任务', danger: true, confirmText: '永久删除' })) return;
  try {
    let deleted = 0;
    let deletedFolderKeys = new Set();
    if (persistentFolders.length) {
      const result = await window.caishen.deleteChildrenwearTasks(persistentFolders);
      deleted = Number(result?.deleted) || 0;
      deletedFolderKeys = new Set((result?.folders || persistentFolders).map(cwFolderKey));
    }
    const localIds = new Set(removable.filter(draft => !draft.taskFolder).map(draft => draft.id));
    for (const draftStage of Object.keys(state.childrenwearDrafts)) {
      state.childrenwearDrafts[draftStage] = state.childrenwearDrafts[draftStage].filter(draft => {
        if (draftStage === stage && localIds.has(draft.id)) return false;
        return !cwDraftReferencesFolder(draft, deletedFolderKeys);
      });
      state.childrenwearActiveDraft[draftStage] = state.childrenwearDrafts[draftStage][0]?.id || '';
    }
    if (state.childrenwearActiveTask && deletedFolderKeys.has(cwFolderKey(state.childrenwearActiveTask.folder))) state.childrenwearActiveTask = null;
    state.childrenwearTasks = state.childrenwearTasks.filter(task => !deletedFolderKeys.has(cwFolderKey(task.folder)));
    state.childrenwearReviewSelection.clear();
    await loadChildrenwearTasks();
    toast(persistentFolders.length ? `已永久删除 ${deleted} 个款式任务${transientCount ? `，并移除 ${transientCount} 个草稿` : ''}` : `已删除 ${transientCount} 个草稿卡片`);
  } catch (error) {
    toast(`删除失败：${childrenwearFriendlyError(error)}`, true);
  }
}

function cwReviewItems() {
  const items = [];
  for (const task of state.childrenwearTasks) {
    const currentMasterHistory = (task.masterHistory || []).find(item => item.path === task.masterPath) || (task.masterHistory || []).at(-1) || {};
    const masterMetrics = Object.keys(task.masterGeneration || {}).length ? task.masterGeneration : currentMasterHistory;
    if (task.masterPath && task.masterUrl) items.push({ id: `master:${task.folder}`, stage: 'master', stageLabel: '平铺母版图', folder: task.folder, outputId: '', path: task.masterPath, url: task.masterUrl, thumbnailUrl: task.masterThumbnailUrl, previewUrl: task.masterPreviewUrl, approved: Boolean(task.masterApproved), task, output: masterMetrics, createdAt: masterMetrics.completedAt || currentMasterHistory.createdAt || task.createdAt });
    for (const output of task.modelOutputs || []) items.push({ id: `model:${task.folder}:${output.id}`, stage: 'model', stageLabel: '模特上身图', folder: task.folder, outputId: output.id, path: output.path, url: output.url, thumbnailUrl: output.thumbnailUrl, previewUrl: output.previewUrl, approved: Boolean(output.approved), task, output, createdAt: output.createdAt });
    for (const output of task.combinationOutputs || []) items.push({ id: `combination:${task.folder}:${output.id}`, stage: 'combination', stageLabel: '多 SKU 组合图', folder: task.folder, outputId: output.id, path: output.path, url: output.url, thumbnailUrl: output.thumbnailUrl, previewUrl: output.previewUrl, approved: Boolean(output.approved), task, output, createdAt: output.createdAt });
  }
  return items.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

function cwReviewMetrics(item) {
  const source = item.output || {};
  return {
    completedAt: source.completedAt || item.createdAt || '',
    elapsedMs: Math.max(0, Number(source.elapsedMs) || 0),
    billingCostMinor: Math.max(0, Number(source.billingCostMinor) || 0),
    upstreamCostCnyMicro: Math.max(0, Number(source.upstreamCostCnyMicro) || 0),
    apiRequestCount: Math.max(0, Number(source.apiRequestCount) || 0),
    modelId: String(source.modelId || ''),
    relayName: String(source.relayName || '')
  };
}

function cwReviewTaskMetrics(items) {
  const metrics = items.map(item => ({ ...cwReviewMetrics(item), startedAt: item.output?.startedAt || '' }));
  const intervals = metrics.map(metric => {
    const end = new Date(metric.completedAt).getTime();
    let start = new Date(metric.startedAt).getTime();
    if (!Number.isFinite(start) && Number.isFinite(end) && metric.elapsedMs) start = end - metric.elapsedMs;
    return Number.isFinite(start) && Number.isFinite(end) && end >= start ? [start, end] : null;
  }).filter(Boolean).sort((a, b) => a[0] - b[0]);
  let activeElapsedMs = 0;
  let current = null;
  for (const interval of intervals) {
    if (!current) current = interval.slice();
    else if (interval[0] <= current[1]) current[1] = Math.max(current[1], interval[1]);
    else { activeElapsedMs += current[1] - current[0]; current = interval.slice(); }
  }
  if (current) activeElapsedMs += current[1] - current[0];
  if (!activeElapsedMs) activeElapsedMs = metrics.reduce((total, metric) => total + metric.elapsedMs, 0);
  const completedTimes = metrics.map(metric => new Date(metric.completedAt).getTime()).filter(Number.isFinite);
  return {
    outputCount: items.length,
    apiRequestCount: metrics.reduce((total, metric) => total + metric.apiRequestCount, 0),
    billingCostMinor: metrics.reduce((total, metric) => total + metric.billingCostMinor, 0),
    upstreamCostCnyMicro: metrics.reduce((total, metric) => total + metric.upstreamCostCnyMicro, 0),
    activeElapsedMs,
    completedAt: completedTimes.length ? new Date(Math.max(...completedTimes)).toISOString() : '',
    recorded: metrics.some(metric => metric.elapsedMs || metric.apiRequestCount || metric.billingCostMinor || metric.modelId)
  };
}

function cwReviewTaskMetricsHtml(items) {
  const metrics = cwReviewTaskMetrics(items);
  return `<div class="cw-review-task-summary"><span><i>生成图片</i><b>${metrics.outputCount}</b></span><span title="包含重试在内的实际 API 请求次数"><i>API 请求</i><b>${metrics.apiRequestCount || '未记录'}</b></span><span title="整个款式任务的累计站内扣费"><i>任务扣费</i><b>${metrics.recorded ? escapeHtml(formatMoney(metrics.billingCostMinor)) : '未记录'}</b></span><span title="合并并发重叠时间后的实际生成处理时长，不包含等待人工审核的空闲时间"><i>总耗时</i><b>${metrics.activeElapsedMs ? escapeHtml(formatDurationMs(metrics.activeElapsedMs)) : '未记录'}</b></span>${metrics.completedAt ? `<span><i>最近完成</i><b>${escapeHtml(formatLocalDateTime(metrics.completedAt))}</b></span>` : ''}${isSuperAdmin() && metrics.recorded ? `<span title="整个款式任务的累计上游采购成本"><i>上游成本</i><b>${escapeHtml(formatFinanceCnyMicro(metrics.upstreamCostCnyMicro))}</b></span>` : ''}</div>`;
}

function cwVisibleReviewItems() {
  const items = cwReviewItems();
  if (state.childrenwearReviewFilter === 'pending') return items.filter(item => cwReviewStatus(item) === 'pending');
  if (state.childrenwearReviewFilter === 'needs_regeneration') return items.filter(item => cwReviewStatus(item) === 'needs_regeneration');
  if (state.childrenwearReviewFilter === 'approved') return items.filter(item => item.approved);
  return items;
}

function cwCompareQueue() {
  if (state.childrenwearCompareContext === 'review-selection') {
    return cwVisibleReviewItems().filter(item => state.childrenwearReviewSelection.has(item.id));
  }
  if (state.childrenwearCompareContext !== 'master') return cwVisibleReviewItems();
  let items = cwReviewItems().filter(item => item.stage === 'master');
  const filter = state.childrenwearQueueFilters.master || 'all';
  if (filter === 'pending') items = items.filter(item => cwReviewStatus(item) === 'pending');
  if (filter === 'needs_regeneration') items = items.filter(item => cwReviewStatus(item) === 'needs_regeneration');
  if (filter === 'approved') items = items.filter(item => item.approved);
  return items;
}

function cwCompareSources(item) {
  const task = item.task || {};
  const sources = [];
  const add = (key, label, url, kind = 'source', primary = false, previewUrl = '') => {
    if (url) sources.push({ key, label, url, previewUrl: previewUrl || url, kind, primary });
  };
  if (item.stage === 'master') {
    add('result', '生成平铺母版图', item.url, 'result', true, item.previewUrl);
    add('real', '实拍产品图', task.realPhotoUrl, 'source', false, task.realPhotoPreviewUrl);
    add('reference', '成品参考图', task.referenceUrl, 'source', false, task.referencePreviewUrl);
    (task.masterHistory || []).filter(history => history.url && history.path !== item.path).slice().reverse().forEach(history => add(`history-${history.version}`, `历史平铺图 v${history.version}`, history.url, 'history', false, history.previewUrl));
  } else if (item.stage === 'model') {
    add('master', '已审核平铺母版', item.output?.masterUrl || task.masterUrl, 'source', true, item.output?.masterPreviewUrl || task.masterPreviewUrl);
    add('real', '实拍产品图', task.realPhotoUrl, 'source', false, task.realPhotoPreviewUrl);
    add('reference', '成品参考图', task.referenceUrl, 'source', false, task.referencePreviewUrl);
    add('model-reference', '参考模特图', item.output?.modelReferenceUrl, 'source', false, item.output?.modelReferencePreviewUrl);
    add('result', '生成模特上身图', item.url, 'result', false, item.previewUrl);
  } else {
    const masterUrls = item.output?.masterUrls?.length ? item.output.masterUrls : (task.masterUrls || []);
    const masterPreviewUrls = item.output?.masterPreviewUrls?.length ? item.output.masterPreviewUrls : (task.masterPreviewUrls || []);
    masterUrls.forEach((url, index) => add(`master-${index}`, `已审核平铺图 ${String.fromCharCode(65 + index)}`, url, 'source', index === 0, masterPreviewUrls[index]));
    add('combination-reference', '组合参考图', item.output?.combinationReferenceUrl || task.combinationReferenceUrl, 'source', false, item.output?.combinationReferencePreviewUrl || task.combinationReferencePreviewUrl);
    add('result', '生成多 SKU 组合图', item.url, 'result', false, item.previewUrl);
  }
  return sources;
}

function orderedCwCompareSources(item) {
  const sources = cwCompareSources(item);
  const sourceMap = new Map(sources.map(source => [source.key, source]));
  const savedOrder = Array.isArray(state.childrenwearCompareOrder[item.stage]) ? state.childrenwearCompareOrder[item.stage] : [];
  const primaryKey = sources.find(source => source.primary)?.key;
  const order = [primaryKey, ...savedOrder.filter(key => key !== primaryKey && sourceMap.has(key)), ...sources.map(source => source.key).filter(key => key !== primaryKey && !savedOrder.includes(key))].filter(Boolean);
  state.childrenwearCompareOrder[item.stage] = order;
  return order.map(key => sourceMap.get(key)).filter(Boolean);
}

function visibleCwCompareKeys(item, sources) {
  const available = sources.map(source => source.key);
  const saved = state.childrenwearCompareVisibility[item.stage];
  if (!Array.isArray(saved)) return sources.filter(source => source.kind !== 'history').map(source => source.key);
  const visible = saved.filter(key => available.includes(key));
  return visible.length ? visible : [available[0]].filter(Boolean);
}

function toggleCwCompareSource(stage, key, checked) {
  const item = cwReviewItems().find(candidate => candidate.id === state.childrenwearCompareId);
  if (!item || item.stage !== stage) return;
  const sources = orderedCwCompareSources(item);
  const visible = new Set(visibleCwCompareKeys(item, sources));
  if (checked) visible.add(key);
  else if (visible.size > 1) visible.delete(key);
  else {
    toast('高清审核至少需要保留一张图片');
    renderCwCompare();
    return;
  }
  state.childrenwearCompareVisibility[stage] = sources.map(source => source.key).filter(sourceKey => visible.has(sourceKey));
  state.childrenwearComparePan = { x: 0, y: 0 };
  renderCwCompare();
}

function reorderCwCompareSource(stage, draggedKey, targetKey) {
  if (!draggedKey || !targetKey || draggedKey === targetKey) return;
  const item = cwReviewItems().find(candidate => candidate.id === state.childrenwearCompareId);
  if (!item || item.stage !== stage) return;
  const order = orderedCwCompareSources(item).map(source => source.key);
  const from = order.indexOf(draggedKey);
  const to = order.indexOf(targetKey);
  if (from < 0 || to < 0) return;
  order.splice(to, 0, order.splice(from, 1)[0]);
  state.childrenwearCompareOrder[stage] = order;
  renderCwCompare();
}

function applyCwCompareTransform() {
  const zoom = Math.max(1, Math.min(8, Number(state.childrenwearCompareZoom) || 1));
  state.childrenwearCompareZoom = zoom;
  const primaryFrame = $('#cwComparePanes .cw-compare-pane.result .cw-compare-frame') || $('#cwComparePanes .cw-compare-frame');
  const maxX = primaryFrame ? primaryFrame.clientWidth * (zoom - 1) / 2 : 0;
  const maxY = primaryFrame ? primaryFrame.clientHeight * (zoom - 1) / 2 : 0;
  state.childrenwearComparePan.x = Math.max(-maxX, Math.min(maxX, Number(state.childrenwearComparePan.x) || 0));
  state.childrenwearComparePan.y = Math.max(-maxY, Math.min(maxY, Number(state.childrenwearComparePan.y) || 0));
  $$('#cwComparePanes [data-cw-compare-image]').forEach(image => {
    image.style.transform = `translate3d(${Math.round(state.childrenwearComparePan.x)}px, ${Math.round(state.childrenwearComparePan.y)}px, 0) scale(${zoom})`;
  });
  $$('#cwComparePanes .cw-compare-frame').forEach(frame => frame.classList.toggle('zoomed', zoom > 1.01));
  $('#cwCompareZoomValue').textContent = `${Math.round(zoom * 100)}%`;
}

function setCwCompareZoom(value, anchor = null) {
  const previous = state.childrenwearCompareZoom;
  state.childrenwearCompareZoom = Math.max(1, Math.min(8, Number(value) || 1));
  if (anchor && previous > 0) {
    const ratio = state.childrenwearCompareZoom / previous;
    state.childrenwearComparePan.x = (state.childrenwearComparePan.x - anchor.x) * ratio + anchor.x;
    state.childrenwearComparePan.y = (state.childrenwearComparePan.y - anchor.y) * ratio + anchor.y;
  }
  applyCwCompareTransform();
}

function resetCwCompareView() {
  state.childrenwearCompareZoom = 1;
  state.childrenwearComparePan = { x: 0, y: 0 };
  applyCwCompareTransform();
}

async function loadCwCompareOriginal(target) {
  const originalUrl = target?.dataset.originalSrc || '';
  if (!target || !originalUrl || target.dataset.originalLoaded === 'true') return target;
  const compareId = state.childrenwearCompareId;
  const button = $('#cwCompareActual');
  if (button) {
    button.disabled = true;
    button.textContent = '正在加载原图…';
  }
  try {
    const preload = new Image();
    preload.decoding = 'async';
    preload.src = originalUrl;
    if (typeof preload.decode === 'function') await preload.decode();
    else await new Promise((resolve, reject) => { preload.onload = resolve; preload.onerror = reject; });
    if (!target.isConnected || state.childrenwearCompareId !== compareId) return null;
    target.src = originalUrl;
    target.dataset.originalLoaded = 'true';
    if (typeof target.decode === 'function') await target.decode().catch(() => {});
    return target;
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = '原始像素 1:1';
    }
  }
}

async function setCwCompareActual(image = null) {
  let target = image || $('#cwComparePanes .cw-compare-pane.result [data-cw-compare-image]') || $('#cwComparePanes [data-cw-compare-image]');
  target = await loadCwCompareOriginal(target).catch(() => {
    toast('原始图片加载失败，请稍后重试', true);
    return null;
  });
  const frame = target?.closest('.cw-compare-frame');
  if (!target?.naturalWidth || !frame?.clientWidth || !frame?.clientHeight) return;
  const fitScale = Math.min(frame.clientWidth / target.naturalWidth, frame.clientHeight / target.naturalHeight);
  state.childrenwearComparePan = { x: 0, y: 0 };
  setCwCompareZoom(Math.max(1, Math.min(8, 1 / Math.max(.001, fitScale))));
}

function renderCwCompare() {
  const modal = $('#cwCompareModal');
  if (!modal || modal.hidden || !state.childrenwearCompareId) return;
  const queue = cwCompareQueue();
  let index = queue.findIndex(item => item.id === state.childrenwearCompareId);
  if (index < 0) {
    const fallback = cwReviewItems().find(item => item.id === state.childrenwearCompareId);
    if (!fallback) return closeCwCompare();
    index = 0;
  }
  const item = queue[index] || cwReviewItems().find(candidate => candidate.id === state.childrenwearCompareId);
  if (!item) return closeCwCompare();
  const allSources = orderedCwCompareSources(item);
  const visibleKeys = visibleCwCompareKeys(item, allSources);
  const visibleSet = new Set(visibleKeys);
  const sources = allSources.filter(source => visibleSet.has(source.key));
  const taskName = item.task.taskName || item.task.category || '未命名款式';
  $('#cwCompareTitle').textContent = taskName;
  $('#cwCompareStage').textContent = `${item.stageLabel} · ${item.approved ? '已通过' : '待审核'}`;
  $('#cwCompareCounter').textContent = queue.length ? `${index + 1} / ${queue.length}` : '1 / 1';
  $('#cwComparePrevious').disabled = state.childrenwearCompareBusy || index <= 0;
  $('#cwCompareNext').disabled = state.childrenwearCompareBusy || index < 0 || index >= queue.length - 1;
  $('#cwCompareApprove').disabled = state.childrenwearCompareBusy || item.approved;
  $('#cwCompareApprove').textContent = item.approved ? '审核已通过' : '审核通过并查看下一张';
  $('#cwCompareRegenerate').disabled = state.childrenwearCompareBusy;
  $('#cwCompareSourcePicker').innerHTML = `<strong>对比图片</strong><div>${allSources.map(source => `<label class="${visibleSet.has(source.key) ? 'selected' : ''}"><input type="checkbox" data-cw-compare-toggle="${escapeHtml(source.key)}" data-stage="${escapeHtml(item.stage)}" ${visibleSet.has(source.key) ? 'checked' : ''}><span>${escapeHtml(source.label)}</span></label>`).join('')}</div><small>勾选显示，拖动下方标题调整顺序</small>`;
  const panes = $('#cwComparePanes');
  panes.style.setProperty('--cw-compare-count', String(sources.length));
  panes.style.setProperty('--cw-compare-column-width', `${(92 / Math.min(3, Math.max(1, sources.length))).toFixed(3)}vw`);
  panes.innerHTML = sources.map((source, sourceIndex) => {
    const previewUrl = source.previewUrl || source.url;
    return `<figure class="cw-compare-pane ${source.kind === 'result' ? 'result' : ''}" data-cw-source-key="${escapeHtml(source.key)}"><figcaption draggable="true" title="按住拖动调整对比顺序"><i aria-hidden="true">⠿</i><span>${String(sourceIndex + 1).padStart(2, '0')}</span><b>${escapeHtml(source.label)}</b>${source.kind === 'result' ? '<em>生成结果</em>' : source.kind === 'history' ? '<em>历史版本</em>' : '<em>参考依据</em>'}</figcaption><div class="cw-compare-frame"><img draggable="false" decoding="async" src="${escapeHtml(previewUrl)}" data-original-src="${escapeHtml(source.url)}" data-original-loaded="${previewUrl === source.url ? 'true' : 'false'}" data-cw-compare-image alt="${escapeHtml(source.label)}高清预览图"></div></figure>`;
  }).join('');
  applyCwCompareTransform();
}

function openCwCompare(id, context = 'review') {
  const item = cwReviewItems().find(candidate => candidate.id === id);
  if (!item) return;
  state.childrenwearCompareId = id;
  state.childrenwearCompareContext = context;
  state.childrenwearCompareBusy = false;
  state.childrenwearCompareZoom = 1;
  state.childrenwearComparePan = { x: 0, y: 0 };
  $('#cwCompareModal').hidden = false;
  document.body.classList.add('cw-compare-open');
  renderCwCompare();
}

function closeCwCompare() {
  const modal = $('#cwCompareModal');
  if (modal) modal.hidden = true;
  state.childrenwearCompareId = '';
  state.childrenwearCompareContext = 'review';
  state.childrenwearCompareBusy = false;
  document.body.classList.remove('cw-compare-open');
}

function navigateCwCompare(step) {
  const queue = cwCompareQueue();
  const index = queue.findIndex(item => item.id === state.childrenwearCompareId);
  const next = queue[index + step];
  if (!next) return;
  state.childrenwearCompareId = next.id;
  state.childrenwearCompareZoom = 1;
  state.childrenwearComparePan = { x: 0, y: 0 };
  renderCwCompare();
}

async function approveCurrentCwCompare() {
  const item = cwReviewItems().find(candidate => candidate.id === state.childrenwearCompareId);
  if (!item || item.approved || state.childrenwearCompareBusy) return;
  const queue = cwCompareQueue();
  const index = queue.findIndex(candidate => candidate.id === item.id);
  const nextId = queue[index + 1]?.id || queue[index - 1]?.id || '';
  state.childrenwearCompareBusy = true;
  renderCwCompare();
  try {
    await approveCwReviewItem(item);
    await loadChildrenwearTasks();
    if (nextId && cwReviewItems().some(candidate => candidate.id === nextId)) {
      state.childrenwearCompareId = nextId;
      state.childrenwearCompareBusy = false;
      resetCwCompareView();
      renderCwCompare();
    } else closeCwCompare();
    toast('审核已通过，已切换到下一张');
  } catch (error) {
    state.childrenwearCompareBusy = false;
    renderCwCompare();
    toast(childrenwearFriendlyError(error), true);
  }
}

async function regenerateCurrentCwCompare() {
  const item = cwReviewItems().find(candidate => candidate.id === state.childrenwearCompareId);
  if (!item || state.childrenwearCompareBusy) return;
  state.childrenwearCompareBusy = true;
  renderCwCompare();
  try {
    await regenerateCwReviewItem(item);
    await loadChildrenwearTasks();
    const newest = cwReviewItems().find(candidate => candidate.folder === item.folder && candidate.stage === item.stage);
    if (newest) state.childrenwearCompareId = newest.id;
    state.childrenwearCompareBusy = false;
    resetCwCompareView();
    renderCwCompare();
    toast('已重新生成并加载最新结果');
  } catch (error) {
    state.childrenwearCompareBusy = false;
    renderCwCompare();
    toast(childrenwearFriendlyError(error), true);
  }
}

function renderCwReview() {
  const grid = $('#cwReviewGrid');
  if (!grid) return;
  $$('.cw-review-filters [data-cw-review-filter]').forEach(button => {
    button.classList.toggle('active', button.dataset.cwReviewFilter === state.childrenwearReviewFilter);
  });
  const allItems = cwReviewItems();
  let items = allItems;
  if (state.childrenwearReviewFilter === 'pending') items = items.filter(item => cwReviewStatus(item) === 'pending');
  if (state.childrenwearReviewFilter === 'needs_regeneration') items = items.filter(item => cwReviewStatus(item) === 'needs_regeneration');
  if (state.childrenwearReviewFilter === 'approved') items = items.filter(item => item.approved);
  const availableIds = new Set(items.map(item => item.id));
  for (const id of [...state.childrenwearReviewSelection]) if (!availableIds.has(id)) state.childrenwearReviewSelection.delete(id);
  const groups = new Map();
  for (const item of items) {
    if (!groups.has(item.folder)) groups.set(item.folder, []);
    groups.get(item.folder).push(item);
  }
  $('#cwReviewCount').textContent = `${groups.size} 个款式 · ${items.length} 张图片${state.childrenwearReviewSelection.size ? ` · 已选 ${state.childrenwearReviewSelection.size}` : ''}`;
  const hasSelection = state.childrenwearReviewSelection.size > 0;
  $('#cwReviewCompareSelected').disabled = !hasSelection;
  $('#cwReviewApproveSelected').disabled = !hasSelection;
  $('#cwReviewRegenerateSelected').disabled = !hasSelection;
  $('#cwReviewDownloadSelected').disabled = !hasSelection;
  const card = item => {
    const status = cwReviewStatus(item);
    return `<article class="cw-review-card${item.approved ? ' approved' : ''}${status === 'needs_regeneration' ? ' needs-regeneration' : ''}${state.childrenwearReviewSelection.has(item.id) ? ' selected' : ''}" data-cw-review-id="${escapeHtml(item.id)}"><label><input type="checkbox" data-cw-review-select="${escapeHtml(item.id)}"${state.childrenwearReviewSelection.has(item.id) ? ' checked' : ''}><span></span><b>${escapeHtml(item.stageLabel)}</b><em>${status === 'approved' ? '已通过' : status === 'needs_regeneration' ? '需重生成' : '待审核'}</em></label><button class="cw-review-image-button" type="button" data-cw-review-compare="${escapeHtml(item.id)}" title="点击进入高清对比审核"><img loading="lazy" decoding="async" src="${escapeHtml(item.thumbnailUrl || item.url)}" data-preview-src="${escapeHtml(item.previewUrl || item.url)}" alt="${escapeHtml(item.stageLabel)}"></button></article>`;
  };
  const allItemsByFolder = new Map();
  for (const item of allItems) {
    if (!allItemsByFolder.has(item.folder)) allItemsByFolder.set(item.folder, []);
    allItemsByFolder.get(item.folder).push(item);
  }
  const groupEntries = [...groups.entries()];
  const visibleGroupLimit = Math.max(4, Number(state.childrenwearReviewVisibleGroupLimit) || 12);
  const visibleGroupEntries = groupEntries.slice(0, visibleGroupLimit);
  const remainingGroups = Math.max(0, groupEntries.length - visibleGroupEntries.length);
  const groupsMarkup = visibleGroupEntries.map(([folder, groupItems]) => {
    const task = groupItems[0].task;
    const taskItems = allItemsByFolder.get(folder) || groupItems;
    const groupName = task.taskName || task.category || String(folder).split(/[\\/]/).at(-1) || '未命名款式';
    const totals = ['master', 'model', 'combination'].map(stage => `${CW_STAGE_META[stage].label} ${taskItems.filter(item => item.stage === stage).length}`).join(' · ');
    const limit = Math.max(24, Number(state.childrenwearReviewGroupLimits.get(folder)) || 48);
    const visibleItems = groupItems.slice(0, limit);
    const remaining = Math.max(0, groupItems.length - visibleItems.length);
    return `<section class="cw-review-group" data-cw-review-folder="${escapeHtml(folder)}"><header class="cw-review-group-head"><div><span>款式任务</span><h3>${escapeHtml(groupName)}</h3><small>${escapeHtml(totals)}</small></div><div><button class="secondary mini" type="button" data-cw-review-rename-folder="${escapeHtml(folder)}">改名</button><button class="primary mini" type="button" data-cw-review-download-folder="${escapeHtml(folder)}">下载款式文件夹</button></div></header>${cwReviewTaskMetricsHtml(taskItems)}<div class="cw-review-group-items">${visibleItems.map(card).join('')}</div>${remaining ? `<button class="cw-review-load-more" type="button" data-cw-review-more="${escapeHtml(folder)}">继续显示 ${Math.min(48, remaining)} 张（剩余 ${remaining} 张）</button>` : ''}</section>`;
  }).join('');
  grid.innerHTML = groups.size
    ? `${groupsMarkup}${remainingGroups ? `<button class="cw-review-load-more" type="button" data-cw-review-more-groups>继续显示 ${Math.min(12, remainingGroups)} 个款式（剩余 ${remainingGroups} 个）</button>` : ''}`
    : '<div class="cw-task-empty"><b>当前没有需要审核的图片</b><span>02、03、04 生成完成后会自动进入这里。</span></div>';
}

async function approveCwReviewItem(item) {
  await window.caishen.approveChildrenwearOutput({ folder: item.folder, stage: item.stage, outputId: item.outputId, approved: true });
}

async function regenerateCwReviewItem(item) {
  if (item.stage === 'master') return window.caishen.generateChildrenwearMaster({ folder: item.folder, taskName: item.task.taskName, realPhotoPath: item.task.realPhotoPath, referencePath: item.task.referencePath, category: item.task.category, material: item.task.material, craft: item.task.craft, extraInstruction: '' });
  if (item.stage === 'model') return window.caishen.generateChildrenwearModel({ folder: item.folder, taskName: item.task.taskName, modelReferencePath: item.output.modelReferencePath, backgroundMode: item.output.backgroundMode || 'model_reference', sceneReferencePath: item.output.sceneReferencePath || '', extraInstruction: '' });
  return window.caishen.generateChildrenwearCombination({ folder: item.folder, taskName: item.task.taskName, masterPaths: item.task.masterPaths, combinationReferencePath: item.task.combinationReferencePath });
}

function renderChildrenwear() {
  if (currentPage === 'childrenwear') {
    renderCwSource(state.childrenwearProductionTab);
    renderCwQueue(state.childrenwearProductionTab);
  }
  if (currentPage === 'childrenwear-review') renderCwReview();
}

function mergeChildrenwearTaskSnapshot(task) {
  if (!task?.folder) return false;
  const key = cwFolderKey(task.folder);
  const index = state.childrenwearTasks.findIndex(item => cwFolderKey(item.folder) === key);
  if (index >= 0) state.childrenwearTasks[index] = task;
  else state.childrenwearTasks.push(task);
  return true;
}

function renderChildrenwearTaskResults(changedFolderKeys = null) {
  if (currentPage === 'childrenwear') {
    if (changedFolderKeys?.size) patchCwQueueTaskResults(state.childrenwearProductionTab, changedFolderKeys);
    else renderCwQueue(state.childrenwearProductionTab);
  }
  if (currentPage === 'childrenwear-review') renderCwReview();
  if (!$('#cwCompareModal')?.hidden) renderCwCompare();
}

function applyChildrenwearTaskSnapshots(tasks = []) {
  let changed = false;
  const changedFolderKeys = new Set();
  for (const task of tasks) {
    if (!mergeChildrenwearTaskSnapshot(task)) continue;
    changed = true;
    changedFolderKeys.add(cwFolderKey(task.folder));
  }
  if (!changed) return false;
  syncCwDraftsFromTasks();
  renderChildrenwearTaskResults(changedFolderKeys);
  return true;
}

async function loadChildrenwearTasks(options = {}) {
  try {
    state.childrenwearTasks = await window.caishen.listChildrenwearTasks();
    syncCwDraftsFromTasks();
    if (options.resultsOnly) {
      if (currentPage === 'childrenwear') renderCwQueue(state.childrenwearProductionTab);
      if (currentPage === 'childrenwear-review') renderCwReview();
    } else {
      renderChildrenwear();
    }
    if (!$('#cwCompareModal')?.hidden) renderCwCompare();
    return state.childrenwearTasks;
  } catch (error) {
    if (options.silent !== true) toast(`任务读取失败：${errorText(error)}`, true);
    if (options.throwOnError === true) throw error;
    return state.childrenwearTasks;
  }
}

function scheduleChildrenwearTaskRefresh(folder) {
  if (typeof folder === 'string' && folder) childrenwearTaskRefreshFolders.add(folder);
  else if (folder === undefined) childrenwearTaskRefreshNeedsFull = true;
  childrenwearTaskRefreshPending = true;
  if (childrenwearTaskRefreshPromise) return childrenwearTaskRefreshPromise;
  childrenwearTaskRefreshPromise = (async () => {
    await sleep(250);
    while (childrenwearTaskRefreshPending) {
      childrenwearTaskRefreshPending = false;
      const needsFull = childrenwearTaskRefreshNeedsFull;
      childrenwearTaskRefreshNeedsFull = false;
      const folders = [...childrenwearTaskRefreshFolders];
      childrenwearTaskRefreshFolders.clear();
      if (needsFull) {
        await loadChildrenwearTasks({ silent: true, throwOnError: true, resultsOnly: true });
      } else if (folders.length) {
        const snapshots = await Promise.all(folders.map(value => window.caishen.getChildrenwearTask(value)));
        applyChildrenwearTaskSnapshots(snapshots.filter(Boolean));
      }
      if (childrenwearTaskRefreshPending) await sleep(250);
    }
  })().catch(error => {
    toast(`生成结果刷新失败：${errorText(error)}`, true);
  }).finally(() => {
    childrenwearTaskRefreshPromise = null;
    if (childrenwearTaskRefreshPending) void scheduleChildrenwearTaskRefresh(false);
  });
  return childrenwearTaskRefreshPromise;
}

async function flushChildrenwearTaskRefresh() {
  while (childrenwearTaskRefreshPromise || childrenwearTaskRefreshPending) {
    if (!childrenwearTaskRefreshPromise) scheduleChildrenwearTaskRefresh(false);
    await childrenwearTaskRefreshPromise;
  }
}

function bindChildrenwearEvents() {
  let compareDrag = null;
  const taskContextMenu = document.createElement('div');
  taskContextMenu.className = 'cw-task-context-menu';
  taskContextMenu.hidden = true;
  taskContextMenu.innerHTML = '<button type="button" data-cw-remove-last-source>撤销最后选择的图片</button>';
  document.body.appendChild(taskContextMenu);
  const closeTaskContextMenu = () => { taskContextMenu.hidden = true; };
  taskContextMenu.onclick = event => {
    if (!event.target.closest('[data-cw-remove-last-source]')) return;
    const stage = taskContextMenu.dataset.stage;
    const draft = state.childrenwearDrafts[stage]?.find(item => item.id === taskContextMenu.dataset.draftId);
    closeTaskContextMenu();
    if (!cwRemoveLastSelectedSource(stage, draft)) return toast('这张任务卡片没有可撤销的已选图片', true);
    renderCwQueue(stage);
    toast('已撤销最后选择的图片');
  };
  document.addEventListener('click', event => { if (!event.target.closest('.cw-task-context-menu')) closeTaskContextMenu(); });
  $$('.cw-source-tabs [data-cw-source-tab]').forEach(button => button.onclick = async () => {
    const stage = button.dataset.cwSourceTab.split('-')[0];
    state.childrenwearSourceTabs[stage] = button.dataset.cwSourceTab;
    button.parentElement.querySelectorAll('button').forEach(item => item.classList.toggle('active', item === button));
    const source = cwLibrarySource(stage);
    if (source.key) await loadChildrenwearLibrary(source.key);
    renderCwSource(stage);
  });
  $$('[data-cw-model-background]').forEach(button => button.onclick = () => {
    const mode = button.dataset.cwModelBackground;
    if (!['model_reference', 'white', 'scene_reference'].includes(mode)) return;
    state.childrenwearModelBackgroundMode = mode;
    const draft = cwDraft('model');
    draft.backgroundMode = mode;
    draft.status = cwDraftReady(draft) ? '待生成' : '待补齐素材';
    button.parentElement.querySelectorAll('[data-cw-model-background]').forEach(item => item.classList.toggle('active', item === button));
    if (mode === 'scene_reference') {
      state.childrenwearSourceTabs.model = 'model-scene';
      const tab = $('[data-cw-source-tab="model-scene"]');
      tab?.parentElement.querySelectorAll('[data-cw-source-tab]').forEach(item => item.classList.toggle('active', item === tab));
      void loadChildrenwearLibrary('childrenwearSceneAssetsPath').then(() => renderCwSource('model'));
    }
    renderCwQueue('model');
  });
  $$('.cw-source-column').forEach(column => column.onclick = async event => {
    const folder = event.target.closest('[data-cw-source-folder]');
    if (folder) {
      await selectChildrenwearLibraryFolder(folder.dataset.cwSourceKey, folder.dataset.cwSourceFolder);
      return renderCwSource(state.childrenwearProductionTab);
    }
    const asset = event.target.closest('[data-cw-source-path]');
    if (asset) addCwSource(state.childrenwearProductionTab, asset.dataset.cwSourceRole, asset.dataset.cwSourcePath);
  });
  $$('.cw-task-column').forEach(column => {
    column.oncontextmenu = event => {
      const card = event.target.closest('[data-cw-draft]');
      if (!card || event.target.closest('button,input,a')) return;
      event.preventDefault();
      taskContextMenu.dataset.stage = card.dataset.stage;
      taskContextMenu.dataset.draftId = card.dataset.cwDraft;
      taskContextMenu.style.left = `${Math.min(event.clientX, window.innerWidth - 230)}px`;
      taskContextMenu.style.top = `${Math.min(event.clientY, window.innerHeight - 60)}px`;
      taskContextMenu.hidden = false;
    };
    column.onchange = event => {
      const input = event.target.closest('[data-cw-select-draft]');
      if (!input) return;
      const stage = input.closest('[data-stage]').dataset.stage;
      const draft = state.childrenwearDrafts[stage].find(item => item.id === input.dataset.cwSelectDraft);
      if (draft) draft.selected = input.checked;
      renderCwQueue(stage);
    };
    column.onclick = async event => {
      const more = event.target.closest('[data-cw-queue-more]');
      if (more) {
        const stage = more.dataset.cwQueueMore;
        state.childrenwearQueueVisibleLimits[stage] = (Number(state.childrenwearQueueVisibleLimits[stage]) || 36) + 36;
        return renderCwQueue(stage);
      }
      const card = event.target.closest('[data-cw-draft]');
      const stage = card?.dataset.stage;
      const id = card?.dataset.cwDraft;
      if (!stage || !id) return;
      const move = event.target.closest('[data-cw-master-move]');
      if (move && stage === 'combination') {
        const draft = state.childrenwearDrafts.combination.find(item => item.id === id);
        const from = Number(move.dataset.cwMasterIndex);
        const to = from + Number(move.dataset.cwMasterMove);
        if (draft?.masters?.[from] && to >= 0 && to < draft.masters.length) {
          [draft.masters[from], draft.masters[to]] = [draft.masters[to], draft.masters[from]];
          draft.selected = true;
          return renderCwQueue('combination');
        }
      }
      const inlineCompare = event.target.closest('[data-cw-inline-compare]');
      if (inlineCompare) return openCwCompare(inlineCompare.dataset.cwInlineCompare, stage === 'master' ? 'master' : 'review');
      const inlineApprove = event.target.closest('[data-cw-inline-approve]');
      if (inlineApprove) {
        const reviewId = inlineApprove.dataset.cwInlineApprove;
        const item = cwReviewItems().find(candidate => candidate.id === reviewId);
        if (!item) return;
        try {
          await approveCwReviewItem(item);
          await loadChildrenwearTasks();
          return toast('平铺图已通过，已解锁 03、04 后续步骤');
        } catch (error) { return toast(childrenwearFriendlyError(error), true); }
      }
      if (event.target.closest('[data-cw-edit]')) {
        const draft = state.childrenwearDrafts[stage].find(item => item.id === id);
        if (!draft) return;
        state.childrenwearActiveDraft[stage] = id;
        const value = await brandPrompt('修改任务名称', draft.title || `${CW_STAGE_META[stage].label}任务`, { message: '同一款式的平铺图、模特图和组合图会以这个名称集中显示在 05 成品审核与下载。', inputLabel: '任务/款式名称' });
        if (value === null) return renderCwQueue(stage);
        if (!String(value).trim()) return toast('任务名称不能为空', true);
        const requestedName = String(value).trim().slice(0, 80);
        draft.styleName = stage === 'master' ? requestedName : draft.styleName;
        draft.title = stage === 'master' && draft.taskCode ? cwTaskDisplayName(requestedName, draft.taskCode) : requestedName;
        try {
          if (draft.taskFolder) {
            const renamed = await window.caishen.renameChildrenwearTask({ folder: draft.taskFolder, taskName: requestedName });
            draft.title = renamed.taskName || draft.title;
            draft.styleName = renamed.styleName || draft.styleName;
            draft.taskCode = renamed.taskCode || draft.taskCode;
          }
          await loadChildrenwearTasks();
        } catch (error) { return toast(childrenwearFriendlyError(error), true); }
        return renderCwQueue(stage);
      }
      if (event.target.closest('[data-cw-remove]')) {
        const draft = state.childrenwearDrafts[stage].find(item => item.id === id);
        return deleteCwDraftCards(stage, [draft]);
      }
      if (event.target.closest('[data-cw-generate-one]')) return runCwDraft(stage, state.childrenwearDrafts[stage].find(item => item.id === id));
      if (!event.target.closest('button,input,label')) {
        state.childrenwearActiveDraft[stage] = id;
        if (stage === 'model') {
          const draft = state.childrenwearDrafts.model.find(item => item.id === id);
          state.childrenwearModelBackgroundMode = draft?.backgroundMode || 'model_reference';
          $$('[data-cw-model-background]').forEach(item => item.classList.toggle('active', item.dataset.cwModelBackground === state.childrenwearModelBackgroundMode));
        }
        renderCwQueue(stage);
      }
    };
  });
  $$('[data-cw-batch]').forEach(button => button.onclick = async () => {
    const stage = button.dataset.stage;
    const action = button.dataset.cwBatch;
    if (action === 'generate' || action === 'regenerate') return runCwBatch(stage, action);
    if (action === 'approve') {
      const items = cwFilteredDrafts(stage)
        .filter(draft => draft.selected && draft.taskFolder)
        .map(draft => cwReviewItems().find(item => item.stage === stage && item.folder === draft.taskFolder))
        .filter(item => item && !item.approved);
      if (!items.length) return toast('请先勾选已生成且未通过的平铺图任务', true);
      try {
        for (const item of items) {
          await approveCwReviewItem(item);
        }
        state.childrenwearDrafts[stage].forEach(draft => { if (draft.selected) draft.selected = false; });
        await loadChildrenwearTasks();
        return toast(`已批量通过 ${items.length} 张平铺图`);
      } catch (error) { return toast(childrenwearFriendlyError(error), true); }
    }
    if (action === 'select-all') cwFilteredDrafts(stage).forEach(item => { item.selected = true; });
    if (action === 'clear') cwFilteredDrafts(stage).forEach(item => { item.selected = false; });
    if (action === 'delete') {
      const selected = cwFilteredDrafts(stage).filter(item => item.selected && item.status !== '生成中');
      return deleteCwDraftCards(stage, selected);
    }
    renderCwQueue(stage);
  });
  $$('.cw-queue-filters [data-cw-queue-filter]').forEach(button => button.onclick = () => {
    const stage = button.closest('[data-childrenwear-production-panel]')?.dataset.childrenwearProductionPanel;
    if (!stage) return;
    state.childrenwearQueueFilters[stage] = button.dataset.cwQueueFilter;
    state.childrenwearQueueVisibleLimits[stage] = 36;
    renderCwQueue(stage);
  });
  $$('[data-cw-activity-toggle]').forEach(button => button.onclick = () => {
    const stage = button.dataset.cwActivityToggle;
    state.childrenwearActivityCollapsed[stage] = !state.childrenwearActivityCollapsed[stage];
    renderCwActivity(stage);
    button.setAttribute('aria-label', state.childrenwearActivityCollapsed[stage] ? '展开任务动态' : '收起任务动态');
    button.title = button.getAttribute('aria-label');
  });
  $$('.cw-activity-list').forEach(list => list.onclick = event => {
    const entry = event.target.closest('[data-cw-activity-jump]');
    if (!entry) return;
    const stage = entry.dataset.stage;
    const id = entry.dataset.cwActivityJump;
    state.childrenwearQueueFilters[stage] = 'all';
    const draftIndex = Math.max(0, state.childrenwearDrafts[stage]?.findIndex(item => item.id === id) ?? 0);
    state.childrenwearQueueVisibleLimits[stage] = Math.max(36, draftIndex + 1);
    state.childrenwearActiveDraft[stage] = id;
    renderCwQueue(stage);
    requestAnimationFrame(() => {
      const card = [...($(CW_STAGE_META[stage].queue)?.querySelectorAll('[data-cw-draft]') || [])].find(item => item.dataset.cwDraft === id);
      if (!card) return;
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.classList.add('log-target');
      setTimeout(() => card.classList.remove('log-target'), 2500);
    });
  });
  $('#cwReviewGrid').onchange = event => {
    const input = event.target.closest('[data-cw-review-select]');
    if (!input) return;
    if (input.checked) state.childrenwearReviewSelection.add(input.dataset.cwReviewSelect); else state.childrenwearReviewSelection.delete(input.dataset.cwReviewSelect);
    renderCwReview();
  };
  $('#cwReviewGrid').onclick = async event => {
    const moreGroups = event.target.closest('[data-cw-review-more-groups]');
    if (moreGroups) {
      state.childrenwearReviewVisibleGroupLimit = (Number(state.childrenwearReviewVisibleGroupLimit) || 12) + 12;
      return renderCwReview();
    }
    const more = event.target.closest('[data-cw-review-more]');
    if (more) {
      const folder = more.dataset.cwReviewMore;
      state.childrenwearReviewGroupLimits.set(folder, (Number(state.childrenwearReviewGroupLimits.get(folder)) || 48) + 48);
      return renderCwReview();
    }
    const compare = event.target.closest('[data-cw-review-compare]');
    if (compare) return openCwCompare(compare.dataset.cwReviewCompare);
    const downloadFolder = event.target.closest('[data-cw-review-download-folder]');
    if (downloadFolder) {
      await window.caishen.downloadFolder(downloadFolder.dataset.cwReviewDownloadFolder);
      return toast('已开始打包下载整个款式文件夹');
    }
    const renameFolder = event.target.closest('[data-cw-review-rename-folder]');
    if (renameFolder) {
      const folder = renameFolder.dataset.cwReviewRenameFolder;
      const task = state.childrenwearTasks.find(item => item.folder === folder);
      const value = await brandPrompt('修改款式任务名称', task?.styleName || task?.category || task?.taskName || '', { message: `只需填写款式名称，任务编号 ${task?.taskCode || ''} 会自动保留，并同步用于审核分组和整包下载文件名。`, inputLabel: '款式名称' });
      if (value === null) return;
      if (!String(value).trim()) return toast('任务名称不能为空', true);
      try {
        await window.caishen.renameChildrenwearTask({ folder, taskName: String(value).trim() });
        await loadChildrenwearTasks();
        return toast('款式任务名称已修改');
      } catch (error) { return toast(childrenwearFriendlyError(error), true); }
    }
  };
  $$('.cw-review-filters [data-cw-review-filter]').forEach(button => button.onclick = () => {
    state.childrenwearReviewFilter = button.dataset.cwReviewFilter;
    state.childrenwearReviewGroupLimits.clear();
    state.childrenwearReviewVisibleGroupLimit = 12;
    button.parentElement.querySelectorAll('button').forEach(item => item.classList.toggle('active', item === button));
    renderCwReview();
  });
  $('#cwReviewSelectAll').onclick = () => { cwVisibleReviewItems().forEach(item => state.childrenwearReviewSelection.add(item.id)); renderCwReview(); };
  $('#cwReviewClear').onclick = () => { state.childrenwearReviewSelection.clear(); renderCwReview(); };
  $('#cwReviewCompareSelected').onclick = () => {
    const first = cwVisibleReviewItems().find(item => state.childrenwearReviewSelection.has(item.id));
    if (!first) return toast('请先勾选需要审核的图片', true);
    openCwCompare(first.id, 'review-selection');
  };
  $('#cwReviewApproveSelected').onclick = async () => {
    const items = cwReviewItems().filter(item => state.childrenwearReviewSelection.has(item.id) && !item.approved);
    for (const item of items) await approveCwReviewItem(item);
    state.childrenwearReviewSelection.clear(); await loadChildrenwearTasks(); toast(`已通过 ${items.length} 张图片`);
  };
  $('#cwReviewRegenerateSelected').onclick = async () => {
    const items = cwReviewItems().filter(item => state.childrenwearReviewSelection.has(item.id));
    const concurrency = await apiBatchConcurrencyLimit(items.length);
    await runClientConcurrency(items, concurrency, async item => {
      await regenerateCwReviewItem(item);
      void scheduleChildrenwearTaskRefresh();
    });
    state.childrenwearReviewSelection.clear();
    await flushChildrenwearTaskRefresh();
    toast(`已重新生成 ${items.length} 张图片`);
  };
  $('#cwReviewDownloadSelected').onclick = async () => {
    const folders = [...new Set(cwReviewItems().filter(item => state.childrenwearReviewSelection.has(item.id)).map(item => item.folder))];
    if (!folders.length) return toast('请先勾选需要下载的任务卡片', true);
    try {
      await window.caishen.downloadFolders(folders);
      toast(`已开始打包下载 ${folders.length} 个款式任务`);
    } catch (error) { toast(childrenwearFriendlyError(error), true); }
  };
  $('#cwCompareClose').onclick = closeCwCompare;
  $('#cwComparePrevious').onclick = () => navigateCwCompare(-1);
  $('#cwCompareNext').onclick = () => navigateCwCompare(1);
  $('#cwCompareFit').onclick = resetCwCompareView;
  $('#cwCompareActual').onclick = () => setCwCompareActual();
  $('#cwCompareZoomOut').onclick = () => setCwCompareZoom(state.childrenwearCompareZoom - .25);
  $('#cwCompareZoomIn').onclick = () => setCwCompareZoom(state.childrenwearCompareZoom + .25);
  $('#cwCompareApprove').onclick = approveCurrentCwCompare;
  $('#cwCompareRegenerate').onclick = regenerateCurrentCwCompare;
  $('#cwCompareSourcePicker').onchange = event => {
    const input = event.target.closest('[data-cw-compare-toggle]');
    if (!input) return;
    toggleCwCompareSource(input.dataset.stage, input.dataset.cwCompareToggle, input.checked);
  };
  $('#cwCompareModal').onclick = event => { if (event.target === $('#cwCompareModal')) closeCwCompare(); };
  $('#cwComparePanes').addEventListener('wheel', event => {
    if ($('#cwCompareModal').hidden) return;
    event.preventDefault();
    const frame = event.target.closest('.cw-compare-frame');
    const rect = frame?.getBoundingClientRect();
    const anchor = rect ? { x: event.clientX - rect.left - rect.width / 2, y: event.clientY - rect.top - rect.height / 2 } : null;
    setCwCompareZoom(state.childrenwearCompareZoom + (event.deltaY < 0 ? .2 : -.2), anchor);
  }, { passive: false });
  $('#cwComparePanes').ondblclick = event => {
    const image = event.target.closest('[data-cw-compare-image]');
    if (!image) return;
    if (state.childrenwearCompareZoom > 1.05) resetCwCompareView(); else setCwCompareActual(image);
  };
  $('#cwComparePanes').ondragstart = event => {
    const caption = event.target.closest('.cw-compare-pane figcaption');
    const pane = caption?.closest('[data-cw-source-key]');
    if (!pane || !event.dataTransfer) return event.preventDefault();
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', pane.dataset.cwSourceKey);
    pane.classList.add('reordering');
  };
  $('#cwComparePanes').ondragover = event => {
    const pane = event.target.closest('[data-cw-source-key]');
    if (!pane) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    $$('#cwComparePanes .cw-compare-pane').forEach(candidate => candidate.classList.toggle('drop-target', candidate === pane));
  };
  $('#cwComparePanes').ondrop = event => {
    const pane = event.target.closest('[data-cw-source-key]');
    if (!pane) return;
    event.preventDefault();
    const draggedKey = event.dataTransfer?.getData('text/plain');
    const item = cwReviewItems().find(candidate => candidate.id === state.childrenwearCompareId);
    reorderCwCompareSource(item?.stage, draggedKey, pane.dataset.cwSourceKey);
  };
  $('#cwComparePanes').ondragend = () => $$('#cwComparePanes .cw-compare-pane').forEach(pane => pane.classList.remove('reordering', 'drop-target'));
  $('#cwComparePanes').onpointerdown = event => {
    if (!event.target.closest('.cw-compare-frame') || event.button !== 0) return;
    compareDrag = { startX: event.clientX, startY: event.clientY, panX: state.childrenwearComparePan.x, panY: state.childrenwearComparePan.y };
    $('#cwComparePanes').classList.add('dragging');
    event.preventDefault();
  };
  $('#cwCompareModal').onpointermove = event => {
    if (!compareDrag) return;
    state.childrenwearComparePan.x = compareDrag.panX + event.clientX - compareDrag.startX;
    state.childrenwearComparePan.y = compareDrag.panY + event.clientY - compareDrag.startY;
    applyCwCompareTransform();
  };
  const stopCompareDrag = () => { compareDrag = null; $('#cwComparePanes').classList.remove('dragging'); };
  $('#cwCompareModal').onpointerup = stopCompareDrag;
  $('#cwCompareModal').onpointercancel = stopCompareDrag;
  document.addEventListener('keydown', event => {
    if ($('#cwCompareModal').hidden || event.target.closest('input,textarea,select')) return;
    if (event.key === 'Escape') closeCwCompare();
    else if (event.key === 'ArrowLeft') navigateCwCompare(-1);
    else if (event.key === 'ArrowRight') navigateCwCompare(1);
    else if (event.key === '+' || event.key === '=') setCwCompareZoom(state.childrenwearCompareZoom + .25);
    else if (event.key === '-') setCwCompareZoom(state.childrenwearCompareZoom - .25);
    else if (event.key.toLowerCase() === 'r') regenerateCurrentCwCompare();
  });
  setChildrenwearProductionTab(state.childrenwearProductionTab);
  setChildrenwearAssetTab(state.childrenwearAssetTab);
}

function bindEvents() {
  bindChildrenwearLibraryEvents();
  bindChildrenwearEvents();
  $('#logoutButton').onclick = logout;
  $('#changePasswordButton').onclick = openChangePasswordModal;
  $('#closeChangePasswordButton').onclick = closeChangePasswordModal;
  $('#cancelChangePasswordButton').onclick = closeChangePasswordModal;
  $('#changePasswordForm').onsubmit = submitChangePassword;
  $('#sidebarToggleButton').onclick = () => applySidebarCollapsed(!$('#appShell').classList.contains('sidebar-collapsed'));
  $('.topbar').onclick = event => {
    if ($('#appShell').classList.contains('sidebar-collapsed')) return;
    if (event.target.closest('button, input, label, .nav, .sidebar-finance, .brand')) return;
    applySidebarCollapsed(true);
  };
  $('#createUserForm').onsubmit = createTeamUser;
  $('#teamUserList').onclick = event => {
    const button = event.target.closest('[data-team-user-active]');
    if (button) return toggleTeamUser(button);
    const passwordButton = event.target.closest('[data-team-user-require-password]');
    if (passwordButton) return requireTeamUserPasswordChange(passwordButton.dataset.teamUserRequirePassword);
    const viewPasswordButton = event.target.closest('[data-team-user-view-password]');
    if (viewPasswordButton) return viewTeamUserPassword(viewPasswordButton.dataset.teamUserViewPassword);
    const editButton = event.target.closest('[data-team-user-edit]');
    if (editButton) return editTeamUser(editButton.dataset.teamUserEdit);
    const deleteButton = event.target.closest('[data-team-user-delete]');
    if (deleteButton) return deleteTeamUser(deleteButton.dataset.teamUserDelete);
  };
  $('#requireAllPasswordChangesButton').onclick = requireAllTeamPasswordChanges;
  $('#teamTransferButton').onclick = transferTeamBalance;
  $$('.nav-item').forEach(button => {
    button.onclick = () => button.dataset.childrenwearProductionNav
      ? openChildrenwearProduction(button.dataset.childrenwearProductionNav)
      : setPage(button.dataset.page);
  });
  $$('[data-page-link]').forEach(button => button.onclick = () => setPage(button.dataset.pageLink));
  $$('[data-open-childrenwear-production]').forEach(button => button.onclick = () => openChildrenwearProduction(button.dataset.openChildrenwearProduction));
  $$('.template-source-tabs [data-template-source-tab]').forEach(button => button.onclick = () => setTaskSourceTab(button.dataset.templateSourceTab));
  $$('[data-choose]').forEach(button => button.onclick = () => chooseFolder(button.dataset.choose));
  $$('[data-stage-asset]').forEach(button => button.onclick = () => stageAssetFolder(button.dataset.stageAsset));
  $$('[data-sync-asset]').forEach(button => button.onclick = () => syncAssetFolder(button.dataset.syncAsset));
  $$('.asset-preview-tabs [data-asset-preview]').forEach(button => button.onclick = () => loadAssetLibraryPreview(button.dataset.assetPreview));
  $('#templateFolderBrowser').onclick = event => {
    const deleteButton = event.target.closest('[data-delete-template-folder]');
    if (deleteButton) return deleteTemplateFolder(deleteButton.dataset.deleteTemplateFolder);
    const allButton = event.target.closest('[data-template-folder-view="all"]');
    if (allButton) return showAllTemplateFolders().catch(error => toast(errorText(error), true));
    const button = event.target.closest('[data-template-folder]');
    if (button) selectTemplateFolder(button.dataset.templateFolder).catch(error => toast(errorText(error), true));
  };
  $('#changeTaskTemplateFolderButton').onclick = () => openTaskTemplateFolderModal().catch(error => toast(errorText(error), true));
  $('#closeTaskTemplateFolderModalButton').onclick = closeTaskTemplateFolderModal;
  $('#taskTemplateFolderModal').onclick = event => { if (event.target === $('#taskTemplateFolderModal')) closeTaskTemplateFolderModal(); };
  $('#taskTemplateFolderList').onclick = event => {
    const button = event.target.closest('[data-task-template-folder]');
    if (button) chooseTaskTemplateFolder(button.dataset.taskTemplateFolder).catch(error => toast(errorText(error), true));
  };
  $('#openTemplateAssetsButton').onclick = () => {
    closeTaskTemplateFolderModal();
    state.assetPreviewKey = 'detailSetsPath';
    state.templateFolderView = state.config.detailSetsPath || 'all';
    setPage('assets');
  };
  $('#taskTemplatePreview').onclick = event => {
    const toggle = event.target.closest('[data-task-tree-toggle]');
    if (toggle) {
      const key = toggle.dataset.taskTreeToggle;
      if (state.taskTemplateExpandedGroups.has(key)) state.taskTemplateExpandedGroups.delete(key);
      else state.taskTemplateExpandedGroups.add(key);
      return renderTemplateWorkflow();
    }
    const rootButton = event.target.closest('[data-task-tree-select-root]');
    const groupButton = event.target.closest('[data-task-tree-select-group]');
    const imageButton = event.target.closest('[data-task-template-image]');
    let items = [];
    if (rootButton) items = state.taskTemplateItems.filter(item => item.action === 'replace_print' && templateFolderPathForItem(item) === rootButton.dataset.taskTreeSelectRoot);
    else if (groupButton) items = state.taskTemplateItems.filter(item => item.action === 'replace_print' && taskTemplateGroupKey(templateFolderPathForItem(item), taskTemplateGroupName(item)) === groupButton.dataset.taskTreeSelectGroup);
    else if (imageButton) {
      addTemplateMasterReference(state.taskTemplateItems.find(item => item.path === imageButton.dataset.taskTemplateImage));
      return renderTemplateWorkflow();
    }
    if (!items.length) return;
    const allSelected = items.every(item => state.selectedTaskTemplatePaths.has(item.path));
    for (const item of items) {
      if (allSelected) state.selectedTaskTemplatePaths.delete(item.path);
      else state.selectedTaskTemplatePaths.add(item.path);
    }
    renderTemplateWorkflow();
  };
  $('#assetManagementPreviewSize').oninput = event => {
    const size = Math.max(110, Math.min(240, Number(event.target.value) || 138));
    state.assetPreviewSizes[state.assetPreviewKey] = size;
    $('#assetManagementGrid').style.setProperty('--asset-management-card-size', `${size}px`);
    persistAssetPreviewSizes();
  };
  $('#assetTemplateFilter').onclick = event => {
    const button = event.target.closest('[data-asset-template-filter]');
    if (!button) return;
    if (state.assetTemplateFilter === button.dataset.assetTemplateFilter) return;
    state.assetTemplateFilter = button.dataset.assetTemplateFilter;
    renderAssetManagementGrid();
    resetAssetManagementScroll();
  };
  $('#selectAllAssetsButton').onclick = toggleAllVisibleAssets;
  $('#addAssetFilesButton').onclick = chooseAndAddAssetFiles;
  $('#deleteSelectedAssetsButton').onclick = deleteSelectedAssets;
  $('#assetManagementGrid').onclick = event => {
    const resultButton = event.target.closest('[data-template-result]');
    if (resultButton) return openTemplateRegionEditor(resultButton.dataset.templateResult);
    const selectButton = event.target.closest('[data-asset-select]');
    const card = event.target.closest('[data-asset-path]');
    if (!selectButton || !card || state.assetUploading) return;
    const assetPath = card.dataset.assetPath;
    if (state.selectedAssetPaths.has(assetPath)) state.selectedAssetPaths.delete(assetPath);
    else state.selectedAssetPaths.add(assetPath);
    renderAssetManagementGrid();
  };
  $('#assetManagementGrid').ondragenter = event => {
    if (![...(event.dataTransfer?.types || [])].includes('Files')) return;
    event.preventDefault();
    $('#assetManagementGrid').classList.add('drag-active');
  };
  $('#assetManagementGrid').ondragover = event => {
    if (![...(event.dataTransfer?.types || [])].includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  };
  $('#assetManagementGrid').ondragleave = event => {
    if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.classList.remove('drag-active');
  };
  $('#assetManagementGrid').ondrop = async event => {
    event.preventDefault();
    event.currentTarget.classList.remove('drag-active');
    if (state.assetPreviewKey === 'detailSetsPath' && currentTemplateFolderView() === 'all') return toast('请先选择一个具体套图文件夹，再拖入图片', true);
    try {
      const entries = await window.caishen.filesFromDrop(event.dataTransfer);
      if (!entries.length) return toast('拖入内容中没有支持的图片', true);
      await importAssetEntries(entries);
    } catch (error) { toast(errorText(error), true); }
  };
  $('#addTaskButton').onclick = () => addTask(false);
  $('#selectAllMastersButton').onclick = () => selectAllTemplateMasterCandidates(true);
  $('#clearMasterSelectionButton').onclick = () => selectAllTemplateMasterCandidates(false);
  $('#deleteSelectedMastersButton').onclick = removeSelectedTemplateMasterCandidates;
  $('#generateAllMastersButton').onclick = generateAllTemplateMasterCandidates;
  $('#createTasksFromAllMastersButton').onclick = startTemplateSetsFromAllMasters;
  $('#templateMasterWorkflow').onclick = event => {
    const selectInput = event.target.closest('[data-template-master-select]');
    if (selectInput) {
      const candidate = state.templateMasterCandidates.find(item => item.id === selectInput.dataset.templateMasterSelect);
      if (candidate) {
        candidate.selected = selectInput.checked;
        persistTemplateMasterCandidates();
        renderTemplateWorkflow();
      }
      return;
    }
    const editButton = event.target.closest('[data-template-master-edit]');
    if (editButton) {
      const id = editButton.dataset.templateMasterEdit;
      state.activeTemplateMasterCandidateId = state.activeTemplateMasterCandidateId === id ? '' : id;
      const candidate = state.templateMasterCandidates.find(item => item.id === id);
      if (candidate) candidate.selected = true;
      persistTemplateMasterCandidates();
      renderTemplateWorkflow();
      return;
    }
    const removeButton = event.target.closest('[data-template-master-remove]');
    if (removeButton) return removeTemplateMasterCandidate(removeButton.dataset.templateMasterRemove);
    const generateButton = event.target.closest('[data-template-master-generate]');
    if (generateButton) return generateTemplateMasterCandidate(generateButton.dataset.templateMasterGenerate);
    const createButton = event.target.closest('[data-template-master-create]');
    if (createButton) return startTemplateSetFromMasterCandidate(createButton.dataset.templateMasterCreate);
  };
  $('#clearQueueButton').onclick = () => { state.queue = []; renderQueue(); };
  $('#duplicateQueueButton').onclick = () => {
    const selected = state.queue.filter(task => task.selected);
    if (!selected.length) return toast('请先选择要复制的任务', true);
    let taskNumber = state.queue.reduce((maximum, task) => Math.max(maximum, Number(task.taskNumber) || 0), 0) + 1;
    const duplicatedBatches = new Map();
    for (const task of selected) {
      if (task.batchId && !duplicatedBatches.has(task.batchId)) duplicatedBatches.set(task.batchId, createClientId());
      state.queue.push({
        ...task,
        id: createClientId(),
        batchId: task.batchId ? duplicatedBatches.get(task.batchId) : undefined,
        taskNumber: taskNumber++,
        selected: false,
        status: '未开始',
        error: '',
        result: null,
        progress: null
      });
    }
    renderQueue();
  };
  $('#deleteSelectedQueueButton').onclick = () => { state.queue = state.queue.filter(task => !task.selected); renderQueue(); };
  $('#selectAllQueueButton').onclick = () => { state.queue.forEach(task => { task.selected = true; }); renderQueue(); };
  $('#clearQueueSelectionButton').onclick = () => { state.queue.forEach(task => { task.selected = false; }); renderQueue(); };
  $('#applyTemplateToSelectedQueueButton').onclick = () => applyCurrentTemplateFolderToQueue(true);
  $('#applyTemplateToAllQueueButton').onclick = () => applyCurrentTemplateFolderToQueue(false);
  $('#queueList').onclick = event => {
    const groupToggle = event.target.closest('[data-queue-group-toggle]');
    if (groupToggle) {
      const key = groupToggle.dataset.queueGroupToggle;
      if (state.queueGroupExpanded.has(key)) state.queueGroupExpanded.delete(key);
      else state.queueGroupExpanded.add(key);
      renderQueue();
      return;
    }
    const deleteButton = event.target.closest('[data-queue-delete]');
    if (deleteButton) return deleteQueueTask(Number(deleteButton.dataset.queueDelete));
    const masterButton = event.target.closest('[data-queue-master-index]');
    if (masterButton) return generateQueueTaskMaster(Number(masterButton.dataset.queueMasterIndex));
    const button = event.target.closest('[data-queue-template-index]');
    if (button) changeQueueTaskTemplate(Number(button.dataset.queueTemplateIndex));
  };
  $('#queueList').onchange = event => {
    const groupInput = event.target.closest('[data-queue-group-select]');
    if (groupInput) {
      const key = groupInput.dataset.queueGroupSelect;
      state.queue.forEach(task => {
        if (queueGroupKey(task) === key) task.selected = groupInput.checked;
      });
      renderQueue();
      return;
    }
    const input = event.target.closest('[data-queue-select]');
    if (!input) return;
    const task = state.queue[Number(input.dataset.queueSelect)];
    if (task) task.selected = input.checked;
  };
  $('#generationMode').onchange = event => {
    updateGenerationModeUi();
  };
  $('#generateAllButton').onclick = generateQueue;
  $('#refreshReviewsButton').onclick = loadReviews;
  $('#openCurrentReviewButton').onclick = () => { if (state.activeReview) window.caishen.openFolder(state.activeReview.folder); else toast('请先选择任务', true); };
  $('#selectAllReviewButton').onclick = () => { visibleReviewEntries().forEach(({ item }) => state.selectedReviewFolders.add(item.folder)); renderReviewList(); };
  $('#clearReviewSelectionButton').onclick = () => { state.selectedReviewFolders.clear(); renderReviewList(); };
  $('#deleteSelectedReviewsButton').onclick = async () => {
    const folders = [...state.selectedReviewFolders];
    if (!folders.length) return toast('请先选择要删除的任务', true);
    if (!await brandConfirm(`确定删除 ${folders.length} 个任务？母版图、套图和审核记录会一起删除。`, { title: '删除生产任务', danger: true, confirmText: '删除任务' })) return;
    try {
      const deleted = await window.caishen.deleteReviews(folders);
      if (deleted) { state.selectedReviewFolders.clear(); await loadReviews(); toast(`已删除 ${deleted} 个任务`); }
    } catch (error) { toast(errorText(error), true); }
  };
  $('#generateMissingTemplatesButton').onclick = () => runReviewGeneration(true);
  $('#regenerateTemplateSetButton').onclick = () => runReviewGeneration(false);
  $('#batchGenerateMissingButton').onclick = () => runReviewGeneration(true, visibleReviewEntries().map(({ item }) => item.folder));
  $('#stopReviewGenerationButton').onclick = stopCurrentReviewGeneration;
  $('#downloadSelectedReviewsButton').onclick = downloadSelectedReviewFolders;
  $('#batchApproveReviewsButton').onclick = async () => {
    const folders = visibleReviewEntries().map(({ item }) => item.folder);
    if (!folders.length) return toast('当前没有可见任务', true);
    try {
      const results = await window.caishen.batchApproveReviews(folders);
      const approved = (results || []).filter(result => result.approved).length;
      if (approved) {
        const approvedFolders = new Set((results || []).filter(result => result.approved).map(result => result.folder));
        state.reviews.filter(item => approvedFolders.has(item.folder)).forEach(markReviewItemViewed);
      }
      await loadReviews();
      toast(approved ? `已通过 ${approved}/${folders.length} 个可见任务` : '当前可见任务均缺图，未完成归档', approved === 0);
    } catch (error) { toast(errorText(error), true); }
  };
  $('#chooseFreeImageButton').onclick = chooseFreeImage;
  $('#freeGenerateButton').onclick = generateFree;
  $('#saveSettingsButton').onclick = saveSettings;
  $('#resetSettingsButton').onclick = resetSettings;
  $('#openBillingDetailButton').onclick = openBillingDetail;
  $('#openAlipayButton').onclick = openAlipay;
  $('#closeAlipayButton').onclick = closeAlipay;
  $('#alipayModal').onclick = event => { if (event.target === $('#alipayModal')) closeAlipay(); };
  $('#alipayAmountUsd').oninput = updateAlipayPaymentAmount;
  $('#submitAlipayRechargeButton').onclick = submitAlipayRecharge;
  $('#refreshAlipayHistoryButton').onclick = loadAlipayHistory;
  $('#saveAlipaySettingsButton').onclick = saveAlipaySettings;
  $('#uploadAlipayQrButton').onclick = uploadAlipayQr;
  $('#refreshAlipayReviewButton').onclick = loadAlipayAdmin;
  $('#alipayReviewList').onclick = handleAlipayReviewClick;
  $('#closeBillingDetailButton').onclick = closeBillingDetail;
  $('#refreshBillingDetailButton').onclick = () => loadBillingDetail(state.billingDetailRelayId, state.billingDetailUserId);
  $('#billingDetailUserFilter').onchange = event => loadBillingDetail(state.billingDetailRelayId, event.target.value);
  $('#billingDetailRelayFilter').onchange = event => loadBillingDetail(event.target.value, state.billingDetailUserId);
  $('#billingDetailRangeFilter').onchange = event => {
    state.billingDetailRange = String(event.target.value || 'today');
    if (state.billingDetailRange === 'custom') { state.billingDetailStartDate ||= chinaDateToday(); state.billingDetailEndDate ||= chinaDateToday(); }
    loadBillingDetail(state.billingDetailRelayId, state.billingDetailUserId);
  };
  $('#applyBillingDetailDateButton').onclick = () => { state.billingDetailStartDate = $('#billingDetailStartDate').value; state.billingDetailEndDate = $('#billingDetailEndDate').value; loadBillingDetail(state.billingDetailRelayId, state.billingDetailUserId); };
  $('#billingDetailModal').onclick = event => { if (event.target === $('#billingDetailModal')) closeBillingDetail(); };
  $('#saveBillingRulesButton').onclick = saveBillingRules;
  $('#refreshBillingButton').onclick = loadBillingAdmin;
  $('#clearBillingLedgerButton').onclick = clearBillingLedger;
  if ($('#refreshMobileStatsButton')) $('#refreshMobileStatsButton').onclick = loadMobileStats;
  $('#billingUserFilter').onchange = event => {
    state.billingAdminFilter = String(event.target.value || '');
    renderBillingAdmin();
  };
  $('#billingRelayFilter').onchange = event => {
    state.billingAdminRelayId = String(event.target.value || '');
    renderBillingAdmin();
  };
  $('#billingAccountList').onclick = event => {
    const button = event.target.closest('[data-adjust-billing]');
    if (button) adjustBillingBalance(button);
  };
  $('#resetOutputPathButton').onclick = () => {
    $('#settingOutputPathInput').value = state.config.defaultOutputPath || state.config.outputPath || '';
  };
  $$('[data-settings-tab]').forEach(button => button.onclick = () => renderSettingsTabs(button.dataset.settingsTab));
  $('#apiSettingsForm').onsubmit = event => { event.preventDefault(); saveSettings(); };
  $('#addRelayButton').onclick = addRelay;
  $('#relayStationList').onclick = event => {
    const row = event.target.closest('.relay-station-editor');
    const choice = event.target.closest('[data-select-relay]');
    if (choice) return selectRelay(choice.dataset.selectRelay);
    const remove = event.target.closest('[data-delete-relay]');
    if (remove && isSuperAdmin()) return deleteRelay(remove);
    if (!row) return;
    const health = event.target.closest('[data-relay-health]');
    if (health) return testRelayHealth(row, health);
    const models = event.target.closest('[data-relay-models]');
    if (models) return readRelayModels(row, models);
  };
  $('#apiModelList').onclick = event => {
    const button = event.target.closest('[data-api-model]');
    if (!button) return;
    state.selectedApiModelId = button.dataset.apiModel;
    renderApiModelList();
  };
  $('#apiModelSearch').oninput = renderApiModelList;
  $('#closeApiModelModalButton').onclick = closeApiModelModal;
  $('#apiModelModal').onclick = event => { if (event.target === $('#apiModelModal')) closeApiModelModal(); };
  $('#applyApiModelButton').onclick = applySelectedApiModel;
  $$('[data-toggle-secret]').forEach(button => button.onclick = () => {
    const input = $(`#${button.dataset.toggleSecret}`);
    const visible = input.type === 'text';
    input.type = visible ? 'password' : 'text';
    button.textContent = visible ? '显示' : '隐藏';
  });
  $('#promptSettingList').onclick = event => {
    const button = event.target.closest('[data-prompt-id]');
    if (button) selectPromptSetting(button.dataset.promptId);
  };
  $('#promptEditor').oninput = event => {
    if (!canManagePrompts()) return;
    const prompt = activePrompt();
    if (prompt) schedulePromptSave(prompt, event.target.value);
  };
  $('#resetCurrentPromptButton').onclick = resetCurrentPrompt;
  $('#resetAllPromptsButton').onclick = resetAllPrompts;
  $('#revealFreeResultButton').onclick = () => { if (state.freeResult) window.caishen.revealFile(state.freeResult.outputPath); };
  $$('.audit-button').forEach(button => button.onclick = async () => {
    const previous = state.config.auditMode;
    state.config.auditMode = button.dataset.audit;
    renderConfig();
    try { state.config = await window.caishen.saveConfig(state.config); }
    catch (error) { state.config.auditMode = previous; renderConfig(); toast(errorText(error), true); }
  });
  $('#closeTemplateConfigButton').onclick = closeTemplateConfig;
  $('#saveTemplateRegionsButton').onclick = saveTemplateRegions;
  const handleTemplateRegionFieldChange = event => {
    const field = event.target.dataset.templateField;
    const card = event.target.closest('[data-template-index]');
    if (!field || !card) return;
    const item = state.templateItems[Number(card.dataset.templateIndex)];
    if (!item) return;
    item[field] = field === 'action' ? normalizeTemplateUiAction(event.target.value) : event.target.value;
    if (field === 'action') {
      applyTemplateActionDefaults(item, card);
      card.querySelector('.template-action-hint').textContent = templateActionHint(item.action);
    }
  };
  $('#templateRegionResult').oninput = handleTemplateRegionFieldChange;
  $('#templateRegionResult').onchange = handleTemplateRegionFieldChange;
  $('#templateRegionResult').onclick = event => {
    const actionQuickButton = event.target.closest('[data-template-set-action]');
    if (actionQuickButton) {
      const path = state.activeTemplatePath;
      const quickItem = state.templateItems.find((entry) => entry.path === path);
      if (!quickItem) return;
      quickItem.action = actionQuickButton.dataset.templateSetAction;
      if (quickItem.action !== 'replace_print') {
        quickItem.regions = [];
        quickItem.protectedRegions = [];
      }
      const card = document.querySelector('#templateRegionResult [data-template-index]');
      applyTemplateActionDefaults(quickItem, card);
      renderTemplateRegionResult();
      return;
    }
    const modeButton = event.target.closest('[data-region-mode]');
    if (modeButton) {
      const quickItem = activeTemplateItem();
      if (!quickItem) return;
      quickItem.regionMode = modeButton.dataset.regionMode === 'protected' ? 'protected' : 'print';
      renderTemplateRegionResult();
      return;
    }
    const undoButton = event.target.closest('[data-region-undo]');
    if (undoButton) {
      const quickItem = activeTemplateItem();
      if (quickItem?.regionMode === 'protected') quickItem.protectedRegions?.pop();
      else quickItem?.regions?.pop();
      if (quickItem && !quickItem.regions.length) quickItem.action = 'copy_original';
      renderTemplateRegionResult();
      return;
    }
    const clearButton = event.target.closest('[data-region-clear]');
    if (clearButton) {
      const quickItem = activeTemplateItem();
      if (quickItem) {
        quickItem.regions = [];
        quickItem.protectedRegions = [];
        quickItem.action = 'copy_original';
      }
      renderTemplateRegionResult();
      return;
    }
  };
  $('#productGrid').onclick = event => {
    const card = event.target.closest('[data-type="product"]');
    if (!card) return;
    state.selectedProduct = state.products[Number(card.dataset.index)]; renderAssets('product'); renderSelection();
  };
  $('#printGrid').onclick = event => {
    const card = event.target.closest('[data-type="print"]');
    if (!card) return;
    state.selectedPrint = state.prints[Number(card.dataset.index)]; renderAssets('print'); renderSelection();
    if ($('#generationMode').value === 'template_print') {
      addTemplateMasterPrint(state.selectedPrint);
      renderTemplateWorkflow();
    }
  };
  $('#productFolderList').onclick = event => {
    const button = event.target.closest('[data-asset-folder]');
    if (!button) return;
    state.productFolder = button.dataset.assetFolder;
    renderAssets('product');
  };
  $('#printFolderList').onclick = event => {
    const button = event.target.closest('[data-asset-folder]');
    if (!button) return;
    state.printFolder = button.dataset.assetFolder;
    renderAssets('print');
  };
  $('#taskTemplateSort').onchange = async event => {
    state.taskTemplateSort = event.target.value === 'name-desc' ? 'name-desc' : 'name-asc';
    state.assetPreviewCache.delete('detailSetsPath');
    state.taskTemplateItems = await listTaskTemplateItemsForCurrentView();
    syncTaskTemplateSelection();
    renderTemplateFolders();
    renderTaskTemplateFolderList();
    renderTemplateWorkflow();
  };
  $('#printSort').onchange = event => {
    state.printSort = event.target.value === 'name-desc' ? 'name-desc' : 'name-asc';
    renderAssets('print');
  };
  if ($('#productPreviewSize')) $('#productPreviewSize').oninput = event => { $('#productGrid').style.setProperty('--asset-card-size', `${event.target.value}px`); };
  $('#reviewList').onclick = event => {
    const row = event.target.closest('[data-review-index]');
    if (!row) return;
    state.activeReview = state.reviews[Number(row.dataset.reviewIndex)];
    state.reviewTaskActivated = true;
    state.reviewLogFilter = 'all';
    renderReviewList(); renderReviewStage();
  };
  $('#reviewOperationLog').onclick = event => {
    const filterButton = event.target.closest('[data-review-log-filter]');
    if (filterButton) {
      state.reviewLogFilter = filterButton.dataset.reviewLogFilter;
      if (state.activeReview) {
        const summary = reviewGenerationSummary(state.activeReview);
        const running = ['queued', 'preparing', 'generating', 'auditing', 'running'].includes(summary.phase);
        renderReviewTrackingLog(state.activeReview, summary, running);
      }
      return;
    }
    const jobButton = event.target.closest('[data-review-log-job]');
    if (!jobButton) return;
    const jobIndex = Number(jobButton.dataset.reviewLogJob);
    const job = state.activeReview?.jobs?.[jobIndex];
    if (job) markReviewJobViewed(state.activeReview, job);
    const card = $('#reviewStage').querySelector(`[data-review-job="${jobIndex}"]`);
    if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.classList.remove('log-target');
    requestAnimationFrame(() => card.classList.add('log-target'));
    clearTimeout(card._logTargetTimer);
    card._logTargetTimer = setTimeout(() => card.classList.remove('log-target'), 2600);
    const summary = reviewGenerationSummary(state.activeReview);
    renderReviewTrackingLog(state.activeReview, summary, ['queued', 'preparing', 'generating', 'auditing', 'running'].includes(summary.phase));
  };
  $('#reviewList').onchange = event => {
    const input = event.target.closest('[data-review-select]');
    if (!input) return;
    const item = state.reviews[Number(input.dataset.reviewSelect)];
    if (!item) return;
    if (input.checked) state.selectedReviewFolders.add(item.folder); else state.selectedReviewFolders.delete(item.folder);
    renderReviewList();
  };
  $('#productSearch').oninput = event => { clearTimeout(productSearchTimer); productSearchTimer = setTimeout(() => loadAssets('categoriesPath', event.target.value), 300); };
  $('#printSearch').oninput = event => { clearTimeout(printSearchTimer); printSearchTimer = setTimeout(() => loadAssets('printsPath', event.target.value), 300); };
  $('#reviewSearch').oninput = () => { renderReviewList(); renderReviewStage(); };
  $('#reviewFilter').onchange = () => { renderReviewList(); renderReviewStage(); };
}

async function start() {
  $('#authForm').onsubmit = submitAuth;
  const authStatus = await window.caishen.authStatus();
  if (!authStatus.authenticated) {
    showAuthGate(authStatus.bootstrapRequired);
    return;
  }
  ensureMobileStatsPage();
  applyCurrentUser(authStatus.user);
  applySidebarCollapsed(loadSidebarCollapsed());
  bindEvents();
  if (authStatus.user.passwordChangeRequired) {
    openChangePasswordModal();
    return;
  }
  setTaskSourceTab(state.taskSourceTab);
  window.addEventListener('caishen:billing-changed', scheduleBillingSummaryRefresh);
  if (shouldOpenMobileStats()) setPage('mobile-stats');
  bindImageHoverPreview();
  updateGenerationModeUi();
  renderQueue();
  state.config = await window.caishen.getConfig();
  await sanitizeConfigWorkspacePaths();
  renderConfig();
  renderChildrenwear();
  await loadChildrenwearLibraries();
  scheduleChildrenwearAutoAnalysis();
  renderSettingsTabs();
  await loadTemplateFolders();
  const adminLoads = [
    ...(canViewPrompts() ? [loadPromptSettings()] : []),
    ...(isTeamAdmin() ? [loadRelayChoices()] : []),
    ...(isSuperAdmin() ? [loadApiSettings()] : [])
  ];
  await Promise.all([loadTemplatePreparation(), loadBillingSummary(), loadChildrenwearTasks(), loadAlipayEntry(), ...adminLoads]);
  await Promise.all([loadAssets('categoriesPath'), loadAssets('printsPath')]);
  renderQueue();
}

start().catch(error => {
  showAuthGate(false);
  $('#authHint').textContent = `无法连接服务器：${errorText(error)}`;
  $('#authHint').classList.add('error');
});
