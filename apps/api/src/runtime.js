const crypto = require('node:crypto');
const { AsyncLocalStorage } = require('node:async_hooks');
const { execFile } = require('node:child_process');
const sharp = require('sharp');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  extractImageResult,
  isImagePath,
  safeFileName
} = require('./core/business');
const {
  createManualTemplateAnalysis,
  deserializeTemplateAnalysis,
  normalizeTemplateProcessingMode,
  parseTemplateAnalysisSummary,
  readValidTemplateAnalysisCache,
  resolveGenerationAction,
  templateCachePaths,
  writeTemplateAnalysisCache
} = require('./core/template-regions');
const {
  appendOperationLog,
  applyBatchApproval,
  deriveFolderStatus,
  deriveImageStatus,
  metadataPaths,
  normalizeOperationLogs,
  normalizeReviewMetadata,
  normalizeSourceMetadata,
  summarizeGenerationProgress,
  toMacReviewMetadata,
  toMacSourceMetadata,
  toWpfManualReviewState,
  toWpfOperationLogs,
  toWpfSourceMetadata
} = require('./core/review-engine');
const {
  getTaskProductProfileFile,
  normalizeProductProfile,
  readProductProfileFile
} = require('./core/product-profile');
const {
  definitionById: promptDefinitionById,
  normalizePromptValue,
  publicPromptSettings
} = require('./core/prompt-settings');
const {
  TEMPLATE_MASTER_PROMPT,
  TEMPLATE_PRINT_PROMPT
} = require('./core/prompts');
const { isSameOrChildPath } = require('./core/path-utils');
const {
  AdaptiveImageScheduler,
  MAX_IMAGE_API_CONCURRENCY,
  RetryableRequestError,
  parseRetryAfterMs
} = require('./core/adaptive-image-scheduler');
const { createImageReferenceCache } = require('./core/image-reference-cache');
const {
  buildChildrenwearCombinationPrompt,
  buildChildrenwearMasterPrompt,
  buildChildrenwearModelPrompt,
  childrenwearPieceCount,
  createChildrenwearCombination,
  createChildrenwearEvidence
} = require('./core/childrenwear');
const {
  ANALYSIS_SCHEMA_VERSION,
  ROLE_BY_LIBRARY_KEY,
  buildChildrenwearAssetAnalysisPrompt,
  normalizeAnalysisRole,
  normalizeChildrenwearAssetAnalysis
} = require('./core/childrenwear-analysis');
const {
  createTemplateEditMask,
  createTemplateRegionAnnotation,
  detectTemplateLightCabinetPanels,
  hasSemanticPrintableSurfaces
} = require('./core/template-mask');
const { createBillingService } = require('./billing');
const { createFinanceLedgerService } = require('./finance-ledger');


const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const configuredDataRoot = String(process.env.CAISHEN_DATA_DIR || 'data');
const DATA_ROOT = path.isAbsolute(configuredDataRoot) ? configuredDataRoot : path.resolve(PROJECT_ROOT, configuredDataRoot);
const SYSTEM_STATE_ROOT = path.join(DATA_ROOT, 'system');
const billing = createBillingService(DATA_ROOT);
const financeLedger = createFinanceLedgerService(DATA_ROOT);
const DEFAULT_WORKSPACE_ID = String(process.env.CAISHEN_WORKSPACE_ID || 'local').replace(/[^a-zA-Z0-9_-]/g, '') || 'local';
const workspaceContext = new AsyncLocalStorage();
const configuredOutputRoots = new Map();
const templateRegenerationQueues = new Map();
const childrenwearAnalysisBatchQueues = new Map();
const childrenwearTaskUpdateQueues = new Map();
const childrenwearAssetCopyQueues = new Map();

function waitForTemplateRegenerationTurn(previous, signal) {
  if (!signal) return previous;
  if (signal.aborted) return Promise.reject(new Error('任务已停止'));
  return new Promise((resolve, reject) => {
    const handleAbort = () => reject(new Error('任务已停止'));
    signal.addEventListener('abort', handleAbort, { once: true });
    previous.then(
      value => {
        signal.removeEventListener('abort', handleAbort);
        resolve(value);
      },
      error => {
        signal.removeEventListener('abort', handleAbort);
        reject(error);
      }
    );
  });
}

async function queueTemplateRegeneration(folder, signal, operation) {
  const key = path.resolve(folder).toLocaleLowerCase('en-US');
  const previous = templateRegenerationQueues.get(key) || Promise.resolve();
  let release;
  let acquired = false;
  const turn = new Promise(resolve => { release = resolve; });
  templateRegenerationQueues.set(key, turn);
  try {
    await waitForTemplateRegenerationTurn(previous, signal);
    acquired = true;
    if (signal?.aborted) throw new Error('任务已停止');
    return await operation();
  } finally {
    const finishTurn = () => {
      release();
      if (templateRegenerationQueues.get(key) === turn) templateRegenerationQueues.delete(key);
    };
    if (acquired) finishTurn();
    else previous.then(finishTurn);
  }
}

function normalizeWorkspaceId(value) {
  return String(value || DEFAULT_WORKSPACE_ID).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80) || DEFAULT_WORKSPACE_ID;
}

function currentWorkspaceId() {
  return normalizeWorkspaceId(workspaceContext.getStore()?.workspaceId || DEFAULT_WORKSPACE_ID);
}

function currentWorkspaceRoot() {
  return path.join(DATA_ROOT, 'workspaces', currentWorkspaceId());
}

function workspaceRoot(workspaceId) {
  return path.join(DATA_ROOT, 'workspaces', normalizeWorkspaceId(workspaceId));
}

function billingOnceKey(...parts) {
  const text = parts.map(part => String(part || '')).join('\u0000');
  return crypto.createHash('sha256').update(text).digest('hex');
}

function currentUserDataRoot() {
  return path.join(currentWorkspaceRoot(), 'state');
}

function currentDefaultOutputRoot() {
  return path.join(currentWorkspaceRoot(), 'outputs');
}

function runWithWorkspace(workspaceId, worker, context = {}) {
  return workspaceContext.run({
    ...context,
    workspaceId: normalizeWorkspaceId(workspaceId)
  }, worker);
}
const app = {
  getPath(name) {
    if (name === 'userData') return currentUserDataRoot();
    if (name === 'pictures') return currentDefaultOutputRoot();
    if (name === 'downloads') return path.join(currentWorkspaceRoot(), 'exports');
    return currentWorkspaceRoot();
  }
};

const ENV_API = Object.freeze({
  serviceUrl: String(process.env.CAISHEN_API_SERVICE_URL || '').trim(),
  baseUrl: String(process.env.CAISHEN_API_BASE_URL || '').trim(),
  key: String(process.env.CAISHEN_API_KEY || '').trim(),
  imageKey: String(process.env.CAISHEN_IMAGE_API_KEY || process.env.CAISHEN_API_KEY || '').trim(),
  imageModel: String(process.env.CAISHEN_IMAGE_MODEL || 'gpt-image-2').trim(),
  analysisModel: String(process.env.CAISHEN_ANALYSIS_MODEL || 'gpt-5-6').trim(),
  responseFormat: String(process.env.CAISHEN_IMAGE_RESPONSE_FORMAT || 'url').trim(),
  requestTimeoutSeconds: Number(process.env.CAISHEN_API_TIMEOUT_SECONDS || 300)
});
let runtimeApiSettings = { version: 4, ...ENV_API, activeRelayId: '', relays: [] };
const FILE_TOKEN_SECRET = String(process.env.CAISHEN_FILE_TOKEN_SECRET || ENV_API.imageKey || 'local-development-only');

function currentApiSettings() {
  return runtimeApiSettings;
}

function requireApiConfig() {
  const settings = currentApiSettings();
  if (!settings.baseUrl) throw new Error('请先在系统设置中配置 API 地址');
  if (!settings.imageKey) throw new Error('请先配置 Image2 生图 API 密钥');
  return settings;
}

const DEFAULT_IMAGE_API_CONCURRENCY = Math.min(MAX_IMAGE_API_CONCURRENCY, Math.max(1, Number(
  process.env.CAISHEN_IMAGE_API_MAX_CONCURRENCY
  || 30
)));
const DEFAULT_IMAGE_API_INITIAL_CONCURRENCY = Math.min(DEFAULT_IMAGE_API_CONCURRENCY, Math.max(1, Number(
  process.env.CAISHEN_IMAGE_API_INITIAL_CONCURRENCY || 8
)));
const DEFAULT_IMAGE_API_START_INTERVAL_MS = Math.max(0, Number(
  process.env.CAISHEN_IMAGE_API_START_INTERVAL_MS
  || 500
));
const IMAGE_API_MAX_ATTEMPTS = Math.max(1, Number(process.env.CAISHEN_IMAGE_API_MAX_ATTEMPTS || 8));
const IMAGE_API_BACKOFF_BASE_MS = Math.max(0, Number(
  process.env.CAISHEN_IMAGE_API_BACKOFF_BASE_MS
  || 1000
));
const IMAGE_API_BACKOFF_MAX_MS = Math.max(IMAGE_API_BACKOFF_BASE_MS, Number(
  process.env.CAISHEN_IMAGE_API_BACKOFF_MAX_MS
  || 120000
));
const IMAGE_API_TIMEOUT_MS = Math.max(1000, Number(process.env.CAISHEN_IMAGE_API_TIMEOUT_MS || 300000));
const IMAGE_URL_TIMEOUT_MS = Math.max(1000, Number(process.env.CAISHEN_IMAGE_URL_TIMEOUT_MS || 300000));
const imageApiScheduler = new AdaptiveImageScheduler({
  initialConcurrency: DEFAULT_IMAGE_API_INITIAL_CONCURRENCY,
  maxConcurrency: DEFAULT_IMAGE_API_CONCURRENCY,
  minStartIntervalMs: DEFAULT_IMAGE_API_START_INTERVAL_MS,
  healthyWindowSize: 10,
  healthySuccessRatio: 0.9,
  maxAttempts: IMAGE_API_MAX_ATTEMPTS,
  baseBackoffMs: IMAGE_API_BACKOFF_BASE_MS,
  maxBackoffMs: IMAGE_API_BACKOFF_MAX_MS
});
let appliedImageSchedulerSettingsKey = '';
const imageReferenceCache = createImageReferenceCache({
  cacheRoot: path.join(SYSTEM_STATE_ROOT, 'image-reference-cache'),
  maxEdge: 2048,
  jpegQuality: 92,
  conversionConcurrency: 2
});

function getImageSchedulerSnapshot() {
  return imageApiScheduler.snapshot();
}

let mainWindow;
let promptSettingsWriteChain = Promise.resolve();
let apiSettingsWriteChain = Promise.resolve();
const childrenwearAnalysisIndexWriteChains = new Map();
const childrenwearAnalysisInFlight = new Map();
const childrenwearAnalysisPathEpochs = new Map();

function localDateParts(date = new Date()) {
  const pad = value => String(value).padStart(2, '0');
  return {
    year: date.getFullYear(),
    month: pad(date.getMonth() + 1),
    day: pad(date.getDate()),
    hour: pad(date.getHours()),
    minute: pad(date.getMinutes()),
    second: pad(date.getSeconds())
  };
}

function localFileTimestamp(date = new Date()) {
  const value = localDateParts(date);
  return `${value.year}${value.month}${value.day}_${value.hour}${value.minute}${value.second}`;
}

function localDisplayTimestamp(date = new Date()) {
  const value = localDateParts(date);
  return `${value.year}-${value.month}-${value.day} ${value.hour}:${value.minute}:${value.second}`;
}

function configFile() {
  return path.join(app.getPath('userData'), 'config.json');
}

function promptSettingsFile() {
  return path.join(SYSTEM_STATE_ROOT, 'prompt-settings.json');
}

function apiSettingsFile() {
  return path.join(SYSTEM_STATE_ROOT, 'api-settings.json');
}

function childrenwearAnalysisRoot() {
  return path.join(currentUserDataRoot(), 'childrenwear-analysis');
}

function childrenwearAnalysisIndexFile() {
  return path.join(childrenwearAnalysisRoot(), 'asset-index.json');
}

function childrenwearAnalysisCacheFile(role, contentHash) {
  return path.join(childrenwearAnalysisRoot(), 'cache', `${role}-${contentHash}.json`);
}

function legacyAdminSettingFile(name) {
  return path.join(DATA_ROOT, 'workspaces', 'local', 'state', name);
}

async function readGlobalSettingWithLegacy(file, legacyName) {
  try { return JSON.parse(await fsp.readFile(file, 'utf8')); } catch {}
  try {
    const value = JSON.parse(await fsp.readFile(legacyAdminSettingFile(legacyName), 'utf8'));
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, JSON.stringify(value, null, 2), { encoding: 'utf8', mode: 0o600 });
    return value;
  } catch {
    return {};
  }
}

function normalizeApiBaseUrl(value) {
  const text = String(value || '').trim().replace(/\/+$/, '');
  if (!text) return '';
  if (text.length > 2000) throw new Error('API 地址过长');
  let parsed;
  try { parsed = new URL(text); } catch { throw new Error('API 地址格式不正确'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('API 地址只支持 http 或 https');
  return text;
}

function normalizeModelName(value, fallback) {
  const text = String(value || fallback || '').trim();
  if (!text || text.length > 120 || /[\r\n]/.test(text)) throw new Error('模型名称格式不正确');
  return text;
}

function normalizeOptionalModelName(value) {
  const text = String(value || '').trim();
  if (text.length > 120 || /[\r\n]/.test(text)) throw new Error('模型名称格式不正确');
  return text;
}

function normalizeResponseFormat(value, fallback = 'url') {
  const text = String(value || fallback || 'url').trim();
  if (!['b64_json', 'url'].includes(text)) throw new Error('图片响应格式不支持');
  return text;
}

function normalizeRequestTimeoutSeconds(value, fallback = 300) {
  const number = Number(value ?? fallback);
  if (!Number.isFinite(number) || number < 1 || number > 600) throw new Error('请求超时必须在 1 到 600 秒之间');
  return Math.round(number);
}

function normalizeImageConcurrencySettings(value = {}, fallback = {}) {
  const maxValue = Number(value.imageMaxConcurrency ?? value.ImageMaxConcurrency ?? fallback.imageMaxConcurrency ?? DEFAULT_IMAGE_API_CONCURRENCY);
  const initialValue = Number(value.imageInitialConcurrency ?? value.ImageInitialConcurrency ?? fallback.imageInitialConcurrency ?? DEFAULT_IMAGE_API_INITIAL_CONCURRENCY);
  const intervalValue = Number(value.imageStartIntervalMs ?? value.ImageStartIntervalMs ?? fallback.imageStartIntervalMs ?? DEFAULT_IMAGE_API_START_INTERVAL_MS);
  const maxConcurrency = Math.min(MAX_IMAGE_API_CONCURRENCY, Math.max(1, Math.trunc(Number.isFinite(maxValue) ? maxValue : DEFAULT_IMAGE_API_CONCURRENCY)));
  const initialConcurrency = Math.min(maxConcurrency, Math.max(1, Math.trunc(Number.isFinite(initialValue) ? initialValue : DEFAULT_IMAGE_API_INITIAL_CONCURRENCY)));
  const startInterval = Math.min(60000, Math.max(0, Math.trunc(Number.isFinite(intervalValue) ? intervalValue : DEFAULT_IMAGE_API_START_INTERVAL_MS)));
  return { imageInitialConcurrency: initialConcurrency, imageMaxConcurrency: maxConcurrency, imageStartIntervalMs: startInterval };
}

function applyImageSchedulerSettings(settings = {}) {
  const normalized = normalizeImageConcurrencySettings(settings);
  const settingsKey = `${normalized.imageInitialConcurrency}:${normalized.imageMaxConcurrency}:${normalized.imageStartIntervalMs}`;
  if (settingsKey === appliedImageSchedulerSettingsKey) return normalized;
  imageApiScheduler.configure({
    initialConcurrency: normalized.imageInitialConcurrency,
    maxConcurrency: normalized.imageMaxConcurrency,
    minStartIntervalMs: normalized.imageStartIntervalMs
  });
  appliedImageSchedulerSettingsKey = settingsKey;
  return normalized;
}

function apiConcurrencyLimit(total = Infinity) {
  const normalized = normalizeImageConcurrencySettings(currentApiSettings());
  const max = Math.max(1, normalized.imageMaxConcurrency || DEFAULT_IMAGE_API_CONCURRENCY);
  const count = Number(total);
  if (!Number.isFinite(count)) return max;
  return Math.min(max, Math.max(1, Math.trunc(count)));
}

function childrenwearAnalysisConcurrencyLimit(total = Infinity, settings = currentApiSettings()) {
  const normalized = normalizeImageConcurrencySettings(settings);
  const configured = Math.min(500, Math.max(1, normalized.imageInitialConcurrency || DEFAULT_IMAGE_API_INITIAL_CONCURRENCY));
  const count = Number(total);
  if (!Number.isFinite(count)) return configured;
  return Math.min(configured, Math.max(1, Math.trunc(count)));
}


function imageSchedulerSettingsForRequest(_relay = null, _options = {}, settings = currentApiSettings()) {
  const normalized = normalizeImageConcurrencySettings(settings);
  return {
    initialConcurrency: normalized.imageInitialConcurrency,
    maxConcurrency: normalized.imageMaxConcurrency,
    minStartIntervalMs: normalized.imageStartIntervalMs
  };
}

function publicApiConcurrencySettings(value = currentApiSettings()) {
  return normalizeImageConcurrencySettings(value);
}

function apiBaseRoot(baseUrl) {
  return String(baseUrl || '').replace(/\/+$/, '').replace(/\/v1(?:beta)?$/i, '');
}

function apiEndpoint(baseUrl, pathName) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  const pathText = String(pathName || '').startsWith('/') ? String(pathName || '') : `/${pathName || ''}`;
  if (/change2pro\.com/i.test(base)) {
    const root = apiBaseRoot(base);
    if (pathText === '/models' || pathText === '/usage') return `${root}/v1${pathText}`;
    return `${root}${pathText}`;
  }
  return `${base}${pathText}`;
}

function maskedApiKey(value) {
  const key = String(value || '');
  if (!key) return '';
  if (key.length <= 8) return `${key.slice(0, 2)}••••${key.slice(-2)}`;
  return `${key.slice(0, 4)}••••••${key.slice(-4)}`;
}

function normalizeRelayId(value, fallback) {
  const text = String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  return (text || fallback).slice(0, 80);
}

function normalizeRelayText(value, fallback = '', maxLength = 500) {
  return String(value || fallback || '').normalize('NFKC').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, maxLength);
}

function normalizeRelayPath(value, fallback) {
  const text = String(value || fallback || '').trim();
  if (!text) return '';
  if (text.length > 200 || /[\r\n?#]/.test(text)) throw new Error('中转站接口路径格式不正确');
  return text.startsWith('/') ? text : `/${text}`;
}

function normalizeRelayMinor(value, fallback = 0) {
  const number = Number(value ?? fallback);
  if (!Number.isFinite(number)) return 0;
  return Math.min(1_000_000_000_000, Math.max(0, Math.round(number)));
}

function normalizeRelayExchangeRate(value, fallback = 7) {
  const number = Number(value ?? fallback);
  if (!Number.isFinite(number) || number <= 0 || number > 1000) throw new Error('站内余额人民币折算汇率无效');
  return Number(number.toFixed(6));
}

function relayMinorRange(item, current, prefix) {
  const fixedKey = `${prefix}PriceMinor`;
  const minKey = `${prefix}PriceMinMinor`;
  const maxKey = `${prefix}PriceMaxMinor`;
  const candidates = [item?.[minKey], item?.[maxKey], item?.[fixedKey], current?.[minKey], current?.[maxKey], current?.[fixedKey]];
  if (!candidates.some(value => value !== undefined && value !== null && value !== '')) {
    return { min: null, max: null };
  }
  const min = normalizeRelayMinor(item?.[minKey] ?? item?.[fixedKey] ?? current?.[minKey] ?? current?.[fixedKey] ?? 0);
  const max = normalizeRelayMinor(item?.[maxKey] ?? item?.[fixedKey] ?? current?.[maxKey] ?? current?.[fixedKey] ?? min);
  if (max < min) throw new Error('中转站每张最高扣费不能低于最低扣费');
  return { min, max };
}

function legacyRelayFromSettings(saved = {}) {
  const packages = Array.isArray(saved.modelPackages) ? saved.modelPackages : [];
  const legacyPackage = packages.find(item => item?.id === 'flagship') || packages.find(item => item?.enabled !== false) || packages[0] || {};
  const baseUrl = saved.baseUrl || legacyPackage.apiBaseUrl || ENV_API.baseUrl || '';
  const imageKey = saved.imageKey || saved.key || legacyPackage.apiKey || ENV_API.imageKey || ENV_API.key || '';
  if (!baseUrl && !imageKey) return null;
  return {
    id: 'default-relay',
    name: '默认中转站',
    baseUrl,
    imageKey,
    imageModel: saved.imageModel || legacyPackage.modelId || ENV_API.imageModel,
    analysisModel: saved.analysisModel || ENV_API.analysisModel,
    imagePriceMinMinor: legacyPackage.imagePriceMinMinor ?? legacyPackage.imagePriceMinor,
    imagePriceMaxMinor: legacyPackage.imagePriceMaxMinor ?? legacyPackage.imagePriceMinor
  };
}

function normalizeRelays(value, currentSettings = {}) {
  const source = Array.isArray(value) ? value : [];
  const currentById = new Map((Array.isArray(currentSettings.relays) ? currentSettings.relays : [])
    .map(item => [normalizeRelayId(item?.id, ''), item]).filter(([id]) => id));
  const seen = new Set();
  return source.slice(0, 20).flatMap((item, index) => {
    const id = normalizeRelayId(item?.id, `relay-${index + 1}`);
    if (seen.has(id)) throw new Error(`中转站编号重复：${id}`);
    seen.add(id);
    const current = currentById.get(id) || {};
    const imageKeyInput = String(item?.imageApiKey ?? item?.imageKey ?? item?.apiKey ?? '').trim();
    const baseUrl = normalizeApiBaseUrl(item?.baseUrl || current.baseUrl || '');
    const imageRange = relayMinorRange(item, current, 'image');
    const llmRange = relayMinorRange(item, current, 'llm');
    return [{
      id,
      name: normalizeRelayText(item?.name, current.name || `中转站 ${index + 1}`, 48),
      description: normalizeRelayText(item?.description, current.description || '', 160),
      enabled: item?.enabled !== undefined ? item.enabled !== false : current.enabled !== false,
      baseUrl,
      imageKey: item?.clearImageKey === true ? '' : imageKeyInput || current.imageKey || '',
      imageModel: normalizeOptionalModelName(item?.imageModel ?? current.imageModel ?? ''),
      analysisModel: normalizeOptionalModelName(item?.analysisModel ?? current.analysisModel ?? ENV_API.analysisModel),
      healthPath: normalizeRelayPath(item?.healthPath || current.healthPath, '/models'),
      modelsPath: normalizeRelayPath(item?.modelsPath || current.modelsPath, '/models'),
      imagePriceMinMinor: imageRange.min,
      imagePriceMaxMinor: imageRange.max,
      llmPriceMinMinor: llmRange.min,
      llmPriceMaxMinor: llmRange.max,
      customerCnyPerUsd: normalizeRelayExchangeRate(item?.customerCnyPerUsd, current.customerCnyPerUsd ?? 7),
      upstreamImageCostCnyMicro: normalizeRelayMinor(item?.upstreamImageCostCnyMicro, current.upstreamImageCostCnyMicro ?? 0),
      upstreamAnalysisCostCnyMicro: normalizeRelayMinor(item?.upstreamAnalysisCostCnyMicro, current.upstreamAnalysisCostCnyMicro ?? 0)
    }];
  });
}

function publicRelay(item) {
  const { imageKey, ...rest } = item;
  return {
    ...rest,
    imageKeyConfigured: Boolean(imageKey),
    imageKeyMasked: maskedApiKey(imageKey)
  };
}

function publicRelayChoice(item) {
  return {
    id: item.id,
    name: item.name,
    description: item.description,
    enabled: item.enabled !== false,
    imagePriceMinMinor: item.imagePriceMinMinor,
    imagePriceMaxMinor: item.imagePriceMaxMinor,
    analysisModel: item.analysisModel
  };
}

function activeRelayFromSettings(settings = {}) {
  const relays = Array.isArray(settings.relays) ? settings.relays : [];
  return relays.find(item => item.enabled !== false && item.id === settings.activeRelayId)
    || relays.find(item => item.enabled !== false)
    || null;
}

function withActiveRelay(settings = {}) {
  const activeRelay = activeRelayFromSettings(settings);
  return {
    ...settings,
    activeRelayId: activeRelay?.id || '',
    activeRelay,
    baseUrl: activeRelay?.baseUrl || '',
    imageKey: activeRelay?.imageKey || '',
    imageModel: activeRelay?.imageModel || '',
    analysisModel: activeRelay?.analysisModel || ENV_API.analysisModel
  };
}

function storedApiSettings(value = {}) {
  return {
    version: 4,
    serviceUrl: String(value.serviceUrl || ''),
    activeRelayId: String(value.activeRelayId || ''),
    relays: Array.isArray(value.relays) ? value.relays : [],
    responseFormat: normalizeResponseFormat(value.responseFormat, ENV_API.responseFormat),
    requestTimeoutSeconds: normalizeRequestTimeoutSeconds(value.requestTimeoutSeconds, ENV_API.requestTimeoutSeconds),
    allowAdminPromptView: value.allowAdminPromptView === true,
    ...normalizeImageConcurrencySettings(value)
  };
}

async function readPrivateApiSettings() {
  const saved = await readGlobalSettingWithLegacy(apiSettingsFile(), 'api-settings.json');
  const concurrency = normalizeImageConcurrencySettings(saved);
  // An explicitly saved empty relay list is meaningful: it means the
  // superadministrator removed every relay. Only migrate the legacy
  // single-gateway fields when the saved document has no relay list at all.
  const relaySource = Array.isArray(saved.relays)
    ? saved.relays
    : [legacyRelayFromSettings(saved)].filter(Boolean);
  const relays = normalizeRelays(relaySource, { relays: relaySource });
  const requestedActiveRelayId = normalizeRelayId(saved.activeRelayId, '');
  const next = withActiveRelay({
    version: 4,
    serviceUrl: String(saved.serviceUrl || ENV_API.serviceUrl || '').trim(),
    activeRelayId: relays.some(item => item.id === requestedActiveRelayId) ? requestedActiveRelayId : relays[0]?.id || '',
    relays,
    responseFormat: normalizeResponseFormat(saved.responseFormat, ENV_API.responseFormat),
    requestTimeoutSeconds: normalizeRequestTimeoutSeconds(saved.requestTimeoutSeconds, ENV_API.requestTimeoutSeconds),
    allowAdminPromptView: saved.allowAdminPromptView === true,
    ...concurrency
  });
  runtimeApiSettings = next;
  applyImageSchedulerSettings(next);
  return next;
}

function publicApiSettings(value = currentApiSettings()) {
  const activeRelay = activeRelayFromSettings(value);
  const imageConfigured = Boolean(activeRelay?.baseUrl && activeRelay?.imageKey && activeRelay?.imageModel);
  return {
    version: 4,
    activeRelayId: activeRelay?.id || '',
    activeRelayName: activeRelay?.name || '',
    relays: (value.relays || []).map(publicRelay),
    responseFormat: normalizeResponseFormat(value.responseFormat, ENV_API.responseFormat),
    requestTimeoutSeconds: normalizeRequestTimeoutSeconds(value.requestTimeoutSeconds, ENV_API.requestTimeoutSeconds),
    allowAdminPromptView: value.allowAdminPromptView === true,
    ...normalizeImageConcurrencySettings(value),
    imageConfigured,
    configured: imageConfigured
  };
}

async function loadApiSettings() {
  return publicApiSettings(await readPrivateApiSettings());
}

async function saveApiSettings(payload = {}) {
  const operation = apiSettingsWriteChain.then(async () => {
    const current = await readPrivateApiSettings();
    const concurrency = normalizeImageConcurrencySettings(payload, current);
    // Accept the previous single-gateway payload during rolling upgrades, but
    // always persist it as the new relay-based format.
    const relayPayload = Array.isArray(payload.relays)
      ? payload.relays
      : [{
          ...(activeRelayFromSettings(current) || {}),
          id: current.activeRelayId || 'default-relay',
          name: activeRelayFromSettings(current)?.name || '默认中转站',
          baseUrl: payload.baseUrl ?? current.baseUrl,
          imageApiKey: payload.imageApiKey ?? payload.apiKey ?? '',
          imageModel: payload.imageModel ?? current.imageModel
        }];
    const relays = normalizeRelays(relayPayload, current);
    const nextRelayIds = new Set(relays.map(item => item.id));
    for (const removed of current.relays.filter(item => !nextRelayIds.has(item.id))) {
      const usage = await billing.getRelayUsageState(removed.id);
      if (usage.inUse) throw new Error(`中转站“${removed.name}”已有独立余额或流水，不能删除；请改为停用`);
    }
    const requestedActiveRelayId = normalizeRelayId(payload.activeRelayId, current.activeRelayId);
    const activeRelayId = relays.some(item => item.enabled !== false && item.id === requestedActiveRelayId)
      ? requestedActiveRelayId
      : relays.find(item => item.enabled !== false)?.id || '';
    const stored = {
      version: 4,
      serviceUrl: current.serviceUrl,
      activeRelayId,
      relays,
      responseFormat: normalizeResponseFormat(payload.responseFormat, current.responseFormat),
      requestTimeoutSeconds: normalizeRequestTimeoutSeconds(payload.requestTimeoutSeconds, current.requestTimeoutSeconds),
      allowAdminPromptView: payload.allowAdminPromptView === true,
      ...concurrency
    };
    const next = withActiveRelay(stored);
    if (activeRelayId && !next.baseUrl) throw new Error('请填写当前中转站的 API 地址');
    if (activeRelayId && !next.imageKey) throw new Error('请填写当前中转站的图片 API 密钥');
    await fsp.mkdir(path.dirname(apiSettingsFile()), { recursive: true });
    await fsp.writeFile(apiSettingsFile(), JSON.stringify(stored, null, 2), { encoding: 'utf8', mode: 0o600 });
    runtimeApiSettings = next;
    applyImageSchedulerSettings(next);
    return publicApiSettings(next);
  });
  apiSettingsWriteChain = operation.catch(() => {});
  return operation;
}

async function loadRelayChoices(includeDisabled = false) {
  const settings = await readPrivateApiSettings();
  return {
    activeRelayId: settings.activeRelayId,
    allowAdminPromptView: settings.allowAdminPromptView === true,
    relays: (settings.relays || []).filter(item => includeDisabled || item.enabled !== false).map(publicRelayChoice)
  };
}

async function saveActiveRelay(activeRelayId) {
  const operation = apiSettingsWriteChain.then(async () => {
    const current = await readPrivateApiSettings();
    const selected = normalizeRelayId(activeRelayId, '');
    if (!current.relays.some(item => item.enabled !== false && item.id === selected)) {
      throw new Error('中转站不存在或未启用');
    }
    const next = withActiveRelay({ ...current, activeRelayId: selected });
    await fsp.mkdir(path.dirname(apiSettingsFile()), { recursive: true });
    await fsp.writeFile(apiSettingsFile(), JSON.stringify(storedApiSettings(next), null, 2), { encoding: 'utf8', mode: 0o600 });
    runtimeApiSettings = next;
    return loadRelayChoices();
  });
  apiSettingsWriteChain = operation.catch(() => {});
  return operation;
}

async function activeApiConfig() {
  const settings = await readPrivateApiSettings();
  const relay = activeRelayFromSettings(settings);
  if (!relay) return requireApiConfig();
  const api = {
    ...settings,
    baseUrl: relay.baseUrl,
    imageKey: relay.imageKey,
    imageModel: relay.imageModel,
    analysisModel: relay.analysisModel || ENV_API.analysisModel,
    activeRelay: relay
  };
  if (!api.baseUrl) throw new Error('请先配置生图 API 地址');
  if (!api.imageKey) throw new Error('请先配置生图 API 密钥');
  return api;
}

function applyRelayPrompt(prompt) {
  return String(prompt || '');
}

function relayBillingRange(relay, prefix = 'image') {
  if (!relay) return {};
  if (relay[`${prefix}PriceMinMinor`] == null && relay[`${prefix}PriceMaxMinor`] == null) return {};
  const min = normalizeRelayMinor(relay[`${prefix}PriceMinMinor`], 0);
  const max = normalizeRelayMinor(relay[`${prefix}PriceMaxMinor`], min);
  return { amountMinMinor: min, amountMaxMinor: Math.max(min, max) };
}

function isComplexTemplatePrintAnalysis(analysis, job = {}) {
  const text = `${String(analysis || '')}\n${String(job?.relativePath || '')}`.toLowerCase();
  const signals = [
    'complex',
    'chinese title',
    'text label',
    'white label',
    'selling point',
    'open cabinet',
    'open door',
    'open drawer',
    'drawers open',
    'internal storage',
    'multi panel',
    'multi-panel',
    'props',
    '文字',
    '标题',
    '标签',
    '卖点',
    '开门',
    '柜门',
    '内部',
    '储物',
    '层板',
    '多扇',
    '多面板',
    '道具'
  ];
  return signals.some(signal => text.includes(signal));
}

function isOpenDrawerTemplatePrintAnalysis(analysis, job = {}) {
  const text = `${String(analysis || '')}\n${String(job?.relativePath || '')}`.toLowerCase();
  return ['open drawer', 'opened drawer', 'drawers open', 'drawer exterior front', '开抽屉', '抽屉打开', '开放抽屉']
    .some(signal => text.includes(signal));
}

function openDrawerRegisteredPrintPrompt() {
  return [
    'OPEN_DRAWER_REGISTERED_PRINT_MAPPING',
    'Apply the following rules only when image 1 contains one or more opened drawers; otherwise preserve the closed cabinet normally.',
    'An opened stack of drawers is one cabinet facade in different depth positions, not several independent print canvases.',
    'First map the complete reference artwork once onto the cabinet facade as if every drawer were closed. Divide that single mapped facade into ordered horizontal row bands from top drawer to bottom drawer.',
    'Each visible opened drawer front must receive only its own corresponding row band from that one closed-facade mapping: row 1 to drawer 1, row 2 to drawer 2, and so on. Preserve the same global artwork scale and vertical registration across all rows.',
    'Never restart, duplicate, independently center, independently scale, or fit the full artwork on every drawer front. A motif crossing a drawer seam must continue on the adjacent row at the matching horizontal position when mentally closed.',
    'After assigning the correct row band, project only that band onto the existing front board plane using its exact camera perspective, foreshortening, opening depth, occlusion and border. Do not alter drawer geometry, spacing, rails, interiors, stored objects or shadows.',
    'Keep print completely off the drawer interior, inner side walls, wooden box, slide rails, black top edge, black frame and all contents.',
    'A person, hand, arm, clothing, foreground chair, sofa or object crossing a drawer front is a protected foreground occluder. Preserve it exactly above the print and render only the currently visible exterior-front pixels behind it.',
    'Foreground piles of clothes, storage items, tabletop goods, boxes, mirrors, trays and merchandise remain above the cabinet print. Stop the print exactly at their true occlusion boundary; never invent cabinet panels, frames, legs, black blocks or rectangular patches over those foreground objects.',
    'Never print over an occluder, erase it, move it, redraw it, complete a hidden motif through it, or expose cabinet surface that is not visible in the first image.'
  ].join('\n');
}

function currentActorRole() {
  return String(workspaceContext.getStore()?.userRole || '').trim().toLowerCase();
}

function flagshipComplexTemplatePrintPrompt() {
  return [
    'FLAGSHIP_COMPLEX_TEMPLATE_PRINT_MODE',
    'Use the first input image as the final layout standard. The second image is the master product reference, the third is the original print pattern, and the fourth is the same template with operator-drawn red ROI boxes.',
    'For complex ecommerce templates, preserve every Chinese title, page number, white selling-point label, label position, font style, typography hierarchy and layout from the first input image. Do not rewrite, omit, add, translate or deform text.',
    'Preserve people, open cabinet doors, internal storage, shelves, bottles, cookware, coffee machine, tabletop objects, lamps, curtains, floor, wall, shadows and all props from the first input image.',
    'Within the operator-selected red ROI only, apply the print to visible cabinet or drawer front surfaces. Never cover cabinet interior, shelves, bottles, cookware, tabletop, wall, floor, legs, handles, black frames, black side panels, door seams, labels or text.',
    'The print must follow every door panel perspective, opening angle, seam split, occlusion and handle position. It must not look like one flat sticker pasted across the whole cabinet.',
    'Keep black cabinet frame, black tabletop, black side panels, black bottom edge, legs, handles and all seams crisp and visible above the print.',
    'Output one realistic finished ecommerce product image only.'
  ].join('\n');
}

function detailSliceLayoutProtectionPrompt() {
  return [
    'DETAIL_SLICE_LAYOUT_PROTECTION_MODE',
    'This template may be a sliced ecommerce detail page, a multi-grid detail card, or a cropped partial product close-up from a long page. Treat the first input image as a locked layout canvas.',
    'ORDERED_DETAIL_SLICE_CONTINUITY_MODE',
    'This output is one ordered detail-page slice, not a complete long detail page. Keep the original slice width, height, crop window, page background and layout exactly aligned to the first input image so adjacent slices can be uploaded to Taobao in order and visually reconnect.',
    'Do not perform any out-of-bounds completion: do not inpaint missing cabinets, do not recreate truncated boundaries, and do not infer or extend any geometry that is outside the visible crop of the first input image.',
    'Keep crop and composition as if coordinates are absolute: the final output must preserve the same left/right/top/bottom crop window and not switch to a different viewport.',
    'Keep the top edge and bottom edge bands stable: do not change, enlarge, remove or invent objects, text, backgrounds, borders, panel lines, shadows or product surfaces that touch a slice boundary.',
    'For this slice, keep the original coordinate system of the template: do not shift any text glyph baseline, margins, separators, frame lines, grid cards, icon positions, or white-space bands. If text crosses a boundary, keep it complete with its original x/y offset.',
    'Do not generate the full detail page, do not merge neighboring slices, do not create a new poster, and do not invent content above or below the current canvas.',
    'Do not enlarge, crop, move or restyle Chinese text, titles, subtitles, page numbers, badges, icons, separators, paper texture, rounded cards, background bands, margins or decorative borders from the first input image.',
    'Only apply the referenced print appearance to visible cabinet, drawer-front, door-front or exterior panel surfaces that are already present in the first input image. Never migrate master-product geometry.',
    'A cropped drawer front or partial cabinet surface is still a valid target when it visibly belongs to the exterior product surface. Process only the visible part inside the current canvas; never invent the missing off-canvas continuation.',
    'MASTER_COORDINATE_REGISTRATION_MODE',
    'Treat the second input image as a registered full-facade artwork coordinate map for this same cabinet. Infer where each visible fragment belongs on that complete facade by matching structural anchors in the first image: cabinet feet, bottom edge, top edge, outer corners, drawer order, drawer seams, frame curvature and adjacent side panels.',
    'Transfer only the corresponding spatial fragment from the master coordinate map. If the template shows only a cabinet foot and part of the bottom panel, use the bottom portion of the master artwork; never restart from the artwork top, center a full motif, or fit the entire artwork into that fragment.',
    'Likewise, a top-edge crop must use the master top portion, and a left/right edge crop must preserve the matching horizontal registration. Multiple close-ups from the same set must remain mutually consistent when mentally placed back onto the complete cabinet.',
    'For multi-grid pages, each small panel keeps its original crop, camera angle, text area and card frame. Do not merge panels, swap panel order, resize panels or turn the page into a new poster.',
    'Treat each red ROI or grid cell as a separate instance of the same cabinet. Register and apply the complete master facade independently to every complete cabinet instance; never stretch one artwork across cells or assign different artwork quarters to different cabinets.',
    'Within each independent cabinet instance, preserve one continuous top-to-bottom artwork registration across its own drawer rows. Do not confuse separate cabinet instances with separate drawers of one cabinet.',
    'A valid output keeps all card frames and all panel borders as-is, and must not output a single merged poster or scene that hides the original tile boundaries.',
    'Keep all non-product details from the first input image unchanged: hands, people, snacks, books, lamps, plants, labels, measurement text, icons, copywriting blocks, shadows, walls, floors and existing empty space.',
    'When piles of clothes, merchandise, boxes, mirrors, trays or tabletop objects hide the cabinet bottom or side, keep those foreground pixels exactly unchanged and stop the generated facade at the visible occlusion boundary. Do not place print, cabinet geometry, legs, frames, black fill or repair patches over foreground merchandise.',
    'Treat bright window streaks and lamp highlights as translucent lighting above an already printed facade. No selected exterior front may retain a vertical white strip, half-white panel, unprinted island or rectangular blank patch.',
    'Preserve occluder silhouettes with clean original edges. Do not create halos, color fringes, tears, holes, smears, duplicate outlines, displaced patches or doubled cabinet frames around people, hands, furniture or product boundaries.',
    'If a product surface is ambiguous, preserve that local area rather than expanding the print into text or background.'
  ].join('\n');
}

function isMultiGridTemplate(job = {}, analysis = '') {
  const text = `${String(job?.relativePath || '')}\n${String(job?.sectionName || '')}\n${String(analysis || '')}`.toLowerCase();
  return ['多宫格', '多图', '拼图', 'multi-grid', 'multi panel', 'multi-panel', 'multi_panel', 'grid'].some(signal => text.includes(signal));
}

function _sampleNormalizedBandDiff(templateImage, outputImage, width, height, region) {
  const sampleStep = 2;
  const half = Math.max(1, Math.min(Math.floor(height / 2), 64));
  let total = 0;
  let diffSum = 0;
  if (width <= 0 || height <= 0) return 1;

  const sampleBand = (x, y, limitX, limitY, getOffset) => {
    const yStart = Math.max(0, y);
    const yEnd = Math.min(height, limitY);
    const xStart = Math.max(0, x);
    const xEnd = Math.min(width, limitX);
    for (let py = yStart; py < yEnd; py += sampleStep) {
      for (let px = xStart; px < xEnd; px += sampleStep) {
        const offset = getOffset(px, py);
        const r1 = templateImage[offset];
        const g1 = templateImage[offset + 1];
        const b1 = templateImage[offset + 2];
        const r2 = outputImage[offset];
        const g2 = outputImage[offset + 1];
        const b2 = outputImage[offset + 2];
        const row = (Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2)) / 255 / 3;
        diffSum += row;
        total += 1;
      }
    }
  };

  switch (region) {
    case 'top': {
      const band = Math.max(1, Math.min(Math.floor(height * 0.08), 56));
      sampleBand(0, 0, width, band, (x, y) => (y * width + x) * 4);
      break;
    }
    case 'bottom': {
      const band = Math.max(1, Math.min(Math.floor(height * 0.08), 56));
      sampleBand(0, height - band, width, height, (x, y) => (y * width + x) * 4);
      break;
    }
    case 'left': {
      const band = Math.max(1, Math.min(Math.floor(width * 0.08), 56));
      sampleBand(0, 0, band, height, (x, y) => (y * width + x) * 4);
      break;
    }
    case 'right': {
      const band = Math.max(1, Math.min(Math.floor(width * 0.08), 56));
      sampleBand(width - band, 0, width, height, (x, y) => (y * width + x) * 4);
      break;
    }
    default: {
      return 0;
    }
  }

  if (!total) return 0;
  return diffSum / total;
}

function _sampleEdgeBlankRatio(image, width, height, region) {
  const band = Math.max(1, Math.min(Math.floor(height * 0.18), 180));
  const startY = region === 'top' ? 0 : Math.max(0, height - band);
  const endY = region === 'top' ? Math.min(height, band) : height;
  let total = 0;
  let blank = 0;
  for (let y = startY; y < endY; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const offset = (y * width + x) * 4;
      const r = image[offset];
      const g = image[offset + 1];
      const b = image[offset + 2];
      const brightest = Math.max(r, g, b);
      const darkest = Math.min(r, g, b);
      if (brightest >= 246 && brightest - darkest <= 10) blank += 1;
      total += 1;
    }
  }
  return total ? blank / total : 0;
}

async function validateTemplateOutputLayout(job, bytes, analysis = '') {
  const templatePath = job?.templatePath || '';
  if (!templatePath || !fs.existsSync(templatePath) || !bytes || bytes.length <= 0) return { passed: false, reason: '输出图像为空或模板缺失' };
  const templateMeta = await sharp(templatePath).metadata();
  const targetWidth = Math.max(1, Number(templateMeta.width) || 1);
  const targetHeight = Math.max(1, Number(templateMeta.height) || 1);

  const templateRaw = await sharp(templatePath)
    .resize({ width: targetWidth, height: targetHeight, fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer();
  const generatedRaw = await sharp(bytes)
    .resize({ width: targetWidth, height: targetHeight, fit: 'fill' })
    .ensureAlpha()
    .raw()
    .toBuffer();

  const metrics = {
    top: _sampleNormalizedBandDiff(templateRaw, generatedRaw, targetWidth, targetHeight, 'top'),
    bottom: _sampleNormalizedBandDiff(templateRaw, generatedRaw, targetWidth, targetHeight, 'bottom'),
    left: _sampleNormalizedBandDiff(templateRaw, generatedRaw, targetWidth, targetHeight, 'left'),
    right: _sampleNormalizedBandDiff(templateRaw, generatedRaw, targetWidth, targetHeight, 'right')
  };

  const isDetailSlice = isDetailSliceTemplate(job, analysis);
  const isMultiGrid = isMultiGridTemplate(job, analysis);
  const sideValues = [metrics.top, metrics.bottom, metrics.left, metrics.right];
  const sideMax = Math.max(...sideValues);
  const sideAvg = (metrics.top + metrics.bottom + metrics.left + metrics.right) / 4;
  const sideExceedCount = sideValues.filter(item => item > 0.24).length;
  // RGB differences at an edge are not proof of geometric drift: a valid
  // print migration can recolor a cabinet panel that touches that edge.
  // Reject only catastrophic, page-wide changes spanning at least three
  // boundaries. Missing bottom content has its own stricter blank check.
  const heavyBoundaryDrift = isDetailSlice && sideExceedCount >= 3 && sideMax > 0.55 && sideAvg > 0.42;
  const multiGridDrift = isMultiGrid && isDetailSlice && sideExceedCount >= 3 && sideMax > 0.48 && sideAvg > 0.38;
  const sourceBottomBlank = _sampleEdgeBlankRatio(templateRaw, targetWidth, targetHeight, 'bottom');
  const outputBottomBlank = _sampleEdgeBlankRatio(generatedRaw, targetWidth, targetHeight, 'bottom');
  const replacedByBlank = isDetailSlice && sourceBottomBlank < 0.72 && outputBottomBlank > 0.9;

  if (replacedByBlank) {
    return {
      passed: false,
      reason: `布局校验未通过：模板底部仍有页面内容，但生成结果变成大面积空白（源图空白比例:${sourceBottomBlank.toFixed(2)}，结果:${outputBottomBlank.toFixed(2)}）。`
    };
  }
  if (heavyBoundaryDrift) {
    return {
      passed: false,
      reason: `布局校验未通过：边界漂移过大（top:${metrics.top.toFixed(2)} bottom:${metrics.bottom.toFixed(2)} left:${metrics.left.toFixed(2)} right:${metrics.right.toFixed(2)}）。`
    };
  }
  if (multiGridDrift) {
    return {
      passed: false,
      reason: `多宫格校验未通过：边界与页面结构偏差过大（top:${metrics.top.toFixed(2)} bottom:${metrics.bottom.toFixed(2)} left:${metrics.left.toFixed(2)} right:${metrics.right.toFixed(2)}）。`
    };
  }
  return { passed: true };
}

function isDetailSliceTemplate(job = {}, analysis = '') {
  const text = `${String(job?.relativePath || '')}\n${String(job?.sectionName || '')}\n${String(analysis || '')}`.toLowerCase();
  const signals = [
    '详情',
    'detail',
    '细节',
    '材质',
    'sku',
    '参数',
    '图鉴',
    '多宫格',
    '多图',
    '拼图',
    '切片',
    '裁切',
    '局部',
    '抽屉',
    'drawer',
    'multi-grid',
    'multi panel',
    'multi-panel',
    'sliced ecommerce detail page'
  ];
  return signals.some(signal => text.includes(signal));
}

function relayForRequestPayload(payload = {}, current = currentApiSettings()) {
  const relayPayload = payload.relay && typeof payload.relay === 'object' ? payload.relay : payload;
  const relayId = normalizeRelayId(relayPayload.id || payload.relayId, current.activeRelayId || 'relay-test');
  const currentRelay = (current.relays || []).find(item => item.id === relayId) || {};
  return normalizeRelays([{ ...currentRelay, ...relayPayload, id: relayId }], { relays: [currentRelay] })[0];
}

async function testApiSettings(payload = {}) {
  const current = await readPrivateApiSettings();
  const relay = relayForRequestPayload(payload, current);
  const draft = {
    baseUrl: relay.baseUrl,
    key: relay.imageKey,
    modelsPath: relay.modelsPath || '/models',
    requestTimeoutSeconds: normalizeRequestTimeoutSeconds(payload.requestTimeoutSeconds, current.requestTimeoutSeconds)
  };
  if (!draft.baseUrl) throw new Error('请先填写 API 地址');
  if (!draft.key) throw new Error('请先配置 Image2 生图 API 密钥');
  const startedAt = Date.now();
  const body = await apiJson(apiEndpoint(draft.baseUrl, draft.modelsPath), {
    method: 'GET',
    headers: { Authorization: `Bearer ${draft.key}`, Accept: 'application/json' }
  }, Math.min(draft.requestTimeoutSeconds * 1000, 60000));
  const sourceModels = Array.isArray(body?.data) ? body.data
    : Array.isArray(body?.models) ? body.models
      : [];
  const models = sourceModels.slice(0, 500).map(item => ({
    id: String(item?.id || item?.name || '').replace(/^models\//, '').trim().slice(0, 200),
    object: String(item?.object || 'model').trim().slice(0, 80),
    created: Number.isFinite(Number(item?.created)) ? Number(item.created) : 0,
    ownedBy: String(item?.owned_by || '').trim().slice(0, 120)
  })).filter(item => item.id);
  return { ok: true, channel: 'image', latencyMs: Date.now() - startedAt, modelCount: models.length, models };
}

async function testRelayHealth(payload = {}) {
  const current = await readPrivateApiSettings();
  const relay = relayForRequestPayload(payload, current);
  if (!relay.baseUrl) throw new Error('请先填写中转站 API 地址');
  const key = relay.imageKey;
  if (!key) throw new Error('请先填写中转站 API 密钥');
  const startedAt = Date.now();
  await apiJson(apiEndpoint(relay.baseUrl, relay.healthPath || relay.modelsPath || '/models'), {
    method: 'GET',
    headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' }
  }, Math.min(normalizeRequestTimeoutSeconds(payload.requestTimeoutSeconds, current.requestTimeoutSeconds) * 1000, 60000));
  return { ok: true, relayId: relay.id, latencyMs: Date.now() - startedAt, checkedPath: relay.healthPath || relay.modelsPath || '/models' };
}

function apiSettingsStatus() {
  return publicApiSettings(currentApiSettings());
}

async function readSavedPromptSettings() {
  const value = await readGlobalSettingWithLegacy(promptSettingsFile(), 'prompt-settings.json');
  return value && typeof value === 'object' ? value : {};
}

async function loadPromptSettings() {
  return publicPromptSettings(await readSavedPromptSettings());
}

async function canAdminViewPromptSettings() {
  return (await readPrivateApiSettings()).allowAdminPromptView === true;
}

async function buildConfiguredChildrenwearPrompt(id, dynamicContract) {
  const settings = await loadPromptSettings();
  const prompt = settings.prompts.find(item => item.id === id);
  if (!prompt) throw new Error(`未知提示词：${id}`);
  const administratorGuidance = prompt.customized ? String(prompt.value || '').trim() : '';
  return [
    administratorGuidance ? `ADMINISTRATOR_CONFIGURED_GUIDANCE\n${administratorGuidance}` : '',
    'SYSTEM_DYNAMIC_EXECUTION_CONTRACT\nThe following task-specific image roles, product facts, counts and reference indices are mandatory and override any conflicting administrator guidance.',
    String(dynamicContract || '').trim()
  ].filter(Boolean).join('\n\n');
}

const CHILDRENWEAR_ANALYSIS_PROMPT_ID_BY_ROLE = Object.freeze({
  product: 'childrenwearProductAnalysis',
  flat_reference: 'childrenwearFlatReferenceAnalysis',
  model_reference: 'childrenwearModelReferenceAnalysis',
  combination_reference: 'childrenwearCombinationReferenceAnalysis'
});

async function configuredChildrenwearAnalysisPrompt(roleValue) {
  const role = normalizeAnalysisRole(roleValue);
  const id = CHILDRENWEAR_ANALYSIS_PROMPT_ID_BY_ROLE[role];
  const settings = await loadPromptSettings();
  const prompt = settings.prompts.find(item => item.id === id);
  const value = String(prompt?.value || '').trim();
  if (!value) throw new Error(`“${prompt?.title || id}”提示词不能为空`);
  return value;
}

async function savePromptSetting(id, value) {
  const operation = promptSettingsWriteChain.then(async () => {
    const text = normalizePromptValue(String(id || ''), value);
    const saved = await readSavedPromptSettings();
    const next = {
      prompts: { ...(saved.prompts || {}), [id]: text },
      updatedAt: new Date().toISOString()
    };
    await fsp.mkdir(path.dirname(promptSettingsFile()), { recursive: true });
    await fsp.writeFile(promptSettingsFile(), JSON.stringify(next, null, 2));
    return loadPromptSettings();
  });
  promptSettingsWriteChain = operation.catch(() => {});
  return operation;
}

async function resetPromptSetting(id = '') {
  const operation = promptSettingsWriteChain.then(async () => {
    const saved = await readSavedPromptSettings();
    if (!id) {
      await fsp.rm(promptSettingsFile(), { force: true });
      return loadPromptSettings();
    }
    if (!promptDefinitionById.has(id)) throw new Error(`未知提示词：${id}`);
    const prompts = { ...(saved.prompts || {}) };
    delete prompts[id];
    const next = { prompts, updatedAt: new Date().toISOString() };
    await fsp.mkdir(path.dirname(promptSettingsFile()), { recursive: true });
    await fsp.writeFile(promptSettingsFile(), JSON.stringify(next, null, 2));
    return loadPromptSettings();
  });
  promptSettingsWriteChain = operation.catch(() => {});
  return operation;
}

function defaultConfig() {
  return {
    operatorCode: 'ys',
    categoriesPath: '',
    printsPath: '',
    detailSetsPath: '',
    childrenwearRealAssetsPath: '',
    childrenwearReferenceAssetsPath: '',
    childrenwearModelAssetsPath: '',
    childrenwearCombinationAssetsPath: '',
    childrenwearAutoAnalysisEnabled: false,
    childrenwearAutoAnalysisIntervalMinutes: 5,
    outputPath: currentDefaultOutputRoot(),
    imageSize: '1024x1024',
    imageQuality: 'auto',
    auditMode: 'saving'
  };
}

async function loadConfig() {
  try {
    const config = { ...defaultConfig(), ...JSON.parse(await fsp.readFile(configFile(), 'utf8')) };
    configuredOutputRoots.set(currentWorkspaceId(), path.resolve(config.outputPath || currentDefaultOutputRoot()));
    return config;
  } catch {
    const config = defaultConfig();
    await saveConfig(config);
    return config;
  }
}

async function saveConfig(next) {
  const safe = {
    ...defaultConfig(),
    operatorCode: String(next.operatorCode || 'ys').trim().slice(0, 20),
    categoriesPath: String(next.categoriesPath || '').trim(),
    printsPath: String(next.printsPath || '').trim(),
    detailSetsPath: String(next.detailSetsPath || '').trim(),
    childrenwearRealAssetsPath: String(next.childrenwearRealAssetsPath || '').trim(),
    childrenwearReferenceAssetsPath: String(next.childrenwearReferenceAssetsPath || '').trim(),
    childrenwearModelAssetsPath: String(next.childrenwearModelAssetsPath || '').trim(),
    childrenwearCombinationAssetsPath: String(next.childrenwearCombinationAssetsPath || '').trim(),
    childrenwearAutoAnalysisEnabled: next.childrenwearAutoAnalysisEnabled === true,
    childrenwearAutoAnalysisIntervalMinutes: [1, 5, 10, 30, 60].includes(Number(next.childrenwearAutoAnalysisIntervalMinutes))
      ? Number(next.childrenwearAutoAnalysisIntervalMinutes)
      : 5,
    outputPath: String(next.outputPath || currentDefaultOutputRoot()).trim(),
    imageSize: String(next.imageSize || '1024x1024'),
    imageQuality: String(next.imageQuality || 'auto'),
    auditMode: next.auditMode === 'quality' ? 'quality' : 'saving'
  };
  await fsp.mkdir(safe.outputPath, { recursive: true });
  configuredOutputRoots.set(currentWorkspaceId(), path.resolve(safe.outputPath));
  await fsp.mkdir(path.dirname(configFile()), { recursive: true });
  await fsp.writeFile(configFile(), JSON.stringify(safe, null, 2));
  return safe;
}

function isWorkspacePath(file) {
  return isSameOrChildPath(currentWorkspaceRoot(), file);
}

function isOutputPath(file) {
  return isSameOrChildPath(configuredOutputRoots.get(currentWorkspaceId()) || currentDefaultOutputRoot(), file);
}

function isServablePath(file) {
  return isWorkspacePath(file) || isOutputPath(file);
}

function fileToken(file) {
  const resolved = path.resolve(String(file || ''));
  if (!isServablePath(resolved)) throw new Error('文件不属于当前工作区或成品输出目录');
  const payload = Buffer.from(resolved).toString('base64url');
  const signature = crypto.createHmac('sha256', FILE_TOKEN_SECRET).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function fileFromToken(tokenValue) {
  try {
    const [payload, signature] = String(tokenValue || '').split('.');
    if (!payload || !signature) return '';
    const expected = crypto.createHmac('sha256', FILE_TOKEN_SECRET).update(payload).digest('base64url');
    const actualBytes = Buffer.from(signature);
    const expectedBytes = Buffer.from(expected);
    if (actualBytes.length !== expectedBytes.length || !crypto.timingSafeEqual(actualBytes, expectedBytes)) return '';
    const file = Buffer.from(payload, 'base64url').toString();
    return isServablePath(file) ? path.resolve(file) : '';
  } catch {
    return '';
  }
}

function imageUrl(file) {
  return `/api/files/${fileToken(file)}`;
}

function thumbnailUrl(file, width, version) {
  return `/api/thumbnails/${fileToken(file)}?w=${width}&v=${encodeURIComponent(version)}`;
}

async function scanImages(root, query = '', limit = 10000) {
  if (!root) return [];
  const rootStat = await fsp.stat(root).catch(() => null);
  if (!rootStat?.isDirectory()) return [];
  const normalizedQuery = query.trim().toLocaleLowerCase('zh-CN');
  const files = [];

  async function walk(directory, depth) {
    if (files.length >= limit || depth > 24) return;
    let entries = [];
    try {
      entries = await fsp.readdir(directory, { withFileTypes: true });
    } catch { return; }
    entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));
    for (const entry of entries) {
      if (files.length >= limit) break;
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(fullPath, depth + 1);
      else if (entry.isFile() && isImagePath(fullPath) && (!normalizedQuery || fullPath.toLocaleLowerCase('zh-CN').includes(normalizedQuery))) {
        const stat = await fsp.stat(fullPath).catch(() => null);
        const version = stat ? `${Math.trunc(stat.mtimeMs)}-${stat.size}` : '1';
        files.push({
          path: fullPath,
          name: entry.name,
          folder: path.relative(root, directory) || '根目录',
          url: `${imageUrl(fullPath)}?v=${version}`,
          thumbnailUrl: thumbnailUrl(fullPath, 480, version),
          previewUrl: thumbnailUrl(fullPath, 1200, version)
        });
      }
    }
  }

  await walk(root, 0);
  return files;
}

const imageLibraryIndexCache = new Map();

function invalidateImageLibraryIndex(root) {
  if (!root) return;
  imageLibraryIndexCache.delete(path.resolve(root).toLocaleLowerCase('en-US'));
}

async function imageLibraryIndex(root) {
  const resolvedRoot = path.resolve(root);
  const cacheKey = resolvedRoot.toLocaleLowerCase('en-US');
  const cached = imageLibraryIndexCache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < 30_000) return cached.items;
  const items = [];

  async function walk(directory, depth) {
    if (depth > 24) return;
    const entries = await fsp.readdir(directory, { withFileTypes: true }).catch(() => []);
    entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }));
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(fullPath, depth + 1);
      else if (entry.isFile() && isImagePath(fullPath)) {
        const relativeFolder = path.relative(resolvedRoot, directory);
        const topFolder = relativeFolder ? relativeFolder.split(path.sep)[0] : '';
        items.push({
          path: fullPath,
          name: entry.name,
          folder: relativeFolder || '根目录',
          groupId: topFolder ? `folder:${topFolder}` : 'root',
          groupName: topFolder || '未分类文件'
        });
      }
    }
  }

  await walk(resolvedRoot, 0);
  imageLibraryIndexCache.set(cacheKey, { createdAt: Date.now(), items });
  return items;
}

async function scanImageLibraryPage(root, options = {}) {
  if (!root) return { items: [], folders: [], folder: 'root', total: 0, page: 1, pageSize: 48, totalPages: 0 };
  const rootStat = await fsp.stat(root).catch(() => null);
  if (!rootStat?.isDirectory()) return { items: [], folders: [], folder: 'root', total: 0, page: 1, pageSize: 48, totalPages: 0 };
  if (options.refresh === true) invalidateImageLibraryIndex(root);
  const pageSize = Math.max(12, Math.min(120, Math.trunc(Number(options.pageSize) || 48)));
  const requestedPage = Math.max(1, Math.trunc(Number(options.page) || 1));
  const requestedGroupId = String(options.folder || 'auto');
  const query = String(options.query || '').trim().toLocaleLowerCase('zh-CN');
  let indexed = await imageLibraryIndex(root);
  const analysisRole = options.analysisRole ? normalizeAnalysisRole(options.analysisRole) : '';
  const analysisIndex = analysisRole ? await readChildrenwearAnalysisIndex() : null;
  if (analysisRole && options.analysisOnly === true) {
    const checked = await Promise.all(indexed.map(async item => ({
      item,
      status: await childrenwearAnalysisStatusForPath(item.path, analysisRole, analysisIndex)
    })));
    indexed = checked.filter(entry => entry.status.analyzed).map(entry => entry.item);
  }
  const folderLabels = await fsp.readFile(path.join(root, '.caishen-folder-labels.json'), 'utf8')
    .then(text => { try { return JSON.parse(text); } catch { return {}; } })
    .catch(() => ({}));
  const counts = new Map();
  for (const item of indexed) counts.set(item.groupId, (counts.get(item.groupId) || 0) + 1);
  const folders = [...counts.entries()].map(([id, count]) => {
    const source = indexed.find(item => item.groupId === id);
    return { id, name: String(folderLabels[id] || source?.groupName || id), count };
  }).sort((left, right) => {
    if (left.id === 'root') return -1;
    if (right.id === 'root') return 1;
    return left.name.localeCompare(right.name, 'zh-CN', { numeric: true });
  });
  const groupId = options.strictFolder === true && requestedGroupId && requestedGroupId !== 'auto'
    ? requestedGroupId
    : counts.has(requestedGroupId)
    ? requestedGroupId
    : (counts.has('root') ? 'root' : folders[0]?.id || 'root');
  const filtered = indexed.filter(item => item.groupId === groupId
    && (!query || `${item.folder}/${item.name}`.toLocaleLowerCase('zh-CN').includes(query)));
  const total = filtered.length;
  const totalPages = total ? Math.ceil(total / pageSize) : 0;
  const page = totalPages ? Math.min(requestedPage, totalPages) : 1;
  const selected = filtered.slice((page - 1) * pageSize, page * pageSize);
  const items = await Promise.all(selected.map(async item => {
    const stat = await fsp.stat(item.path).catch(() => null);
    const version = stat ? `${Math.trunc(stat.mtimeMs)}-${stat.size}` : '1';
    return {
      path: item.path,
      name: item.name,
      folder: item.folder,
      url: `${imageUrl(item.path)}?v=${version}`,
      thumbnailUrl: thumbnailUrl(item.path, 480, version),
      previewUrl: thumbnailUrl(item.path, 1200, version),
      ...(analysisRole ? { analysis: await childrenwearAnalysisStatusForPath(item.path, analysisRole, analysisIndex) } : {})
    };
  }));
  return { items, folders, folder: groupId, total, page, pageSize, totalPages };
}

function imageMimeType(file) {
  const extension = path.extname(file).toLowerCase();
  return extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg'
    : extension === '.webp' ? 'image/webp'
      : extension === '.gif' ? 'image/gif'
        : extension === '.bmp' ? 'image/bmp'
          : 'image/png';
}

async function imageAsDataUrl(file) {
  if (!isImagePath(file)) throw new Error('不支持的图片格式');
  const mime = imageMimeType(file);
  return `data:${mime};base64,${(await fsp.readFile(file)).toString('base64')}`;
}

async function imageAsAnalysisDataUrl(file) {
  if (!isImagePath(file)) throw new Error('不支持的图片格式');
  const bytes = await sharp(file, { failOn: 'none', animated: false, limitInputPixels: 120_000_000 })
    .rotate()
    .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 84, mozjpeg: true })
    .toBuffer();
  return `data:image/jpeg;base64,${bytes.toString('base64')}`;
}

function childrenwearAnalysisPathKey(file) {
  return path.resolve(String(file || '')).toLocaleLowerCase('en-US');
}

function childrenwearAnalysisEpochKey(file, workspaceId = currentWorkspaceId()) {
  return `${workspaceId}\u0000${childrenwearAnalysisPathKey(file)}`;
}

function childrenwearAnalysisPathEpoch(file, workspaceId = currentWorkspaceId()) {
  return childrenwearAnalysisPathEpochs.get(childrenwearAnalysisEpochKey(file, workspaceId)) || 0;
}

function invalidateChildrenwearAnalysisPathEpoch(file, workspaceId = currentWorkspaceId()) {
  const key = childrenwearAnalysisEpochKey(file, workspaceId);
  const next = (childrenwearAnalysisPathEpochs.get(key) || 0) + 1;
  childrenwearAnalysisPathEpochs.set(key, next);
  return next;
}

async function childrenwearFileFingerprint(file) {
  const resolved = path.resolve(String(file || ''));
  const stat = await fsp.stat(resolved).catch(() => null);
  if (!stat?.isFile() || !isImagePath(resolved)) throw new Error('素材图片不存在或格式不支持');
  const hash = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(resolved);
    stream.on('data', chunk => hash.update(chunk));
    stream.once('error', reject);
    stream.once('end', resolve);
  });
  return { path: resolved, size: stat.size, mtimeMs: Math.trunc(stat.mtimeMs), contentHash: hash.digest('hex') };
}

async function readChildrenwearAnalysisIndex() {
  const value = await readJsonFile(childrenwearAnalysisIndexFile(), {});
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

async function updateChildrenwearAnalysisIndex(updater) {
  const workspaceId = currentWorkspaceId();
  const previous = childrenwearAnalysisIndexWriteChains.get(workspaceId) || Promise.resolve();
  const operation = previous.then(async () => {
    const index = await readChildrenwearAnalysisIndex();
    const result = await updater(index);
    await writeJsonFile(childrenwearAnalysisIndexFile(), index);
    return result;
  });
  childrenwearAnalysisIndexWriteChains.set(workspaceId, operation.catch(() => {}));
  return operation;
}

function childrenwearAnalysisCacheMatches(cached, role, contentHash) {
  return cached?.schemaVersion === ANALYSIS_SCHEMA_VERSION
    && cached?.role === role
    && cached?.contentHash === contentHash
    && cached?.analysis
    && typeof cached.analysis === 'object';
}

async function childrenwearAnalysisFingerprintStillCurrent(expected, epoch, workspaceId = currentWorkspaceId()) {
  if (childrenwearAnalysisPathEpoch(expected.path, workspaceId) !== epoch) return false;
  const current = await childrenwearFileFingerprint(expected.path).catch(() => null);
  return Boolean(current
    && current.size === expected.size
    && current.mtimeMs === expected.mtimeMs
    && current.contentHash === expected.contentHash);
}

async function invalidateChildrenwearAnalysisPaths(paths = [], roleValue = '') {
  const workspaceId = currentWorkspaceId();
  const role = roleValue ? normalizeAnalysisRole(roleValue) : '';
  const resolvedPaths = [...new Set((paths || [])
    .map(value => String(value || '').trim())
    .filter(Boolean)
    .map(value => path.resolve(value)))];
  if (!resolvedPaths.length) return { invalidated: 0, cacheDeleted: 0 };

  // Bump the lifecycle first so an already-running request can never write its
  // result back after the user deletes or replaces this asset.
  for (const file of resolvedPaths) invalidateChildrenwearAnalysisPathEpoch(file, workspaceId);

  const fingerprints = new Map();
  await Promise.all(resolvedPaths.map(async file => {
    const fingerprint = await childrenwearFileFingerprint(file).catch(() => null);
    if (fingerprint) fingerprints.set(childrenwearAnalysisPathKey(file), fingerprint);
  }));

  const cacheCandidates = new Map();
  await updateChildrenwearAnalysisIndex(index => {
    for (const file of resolvedPaths) {
      const pathKey = childrenwearAnalysisPathKey(file);
      const record = index[pathKey];
      const candidateRole = record?.role || role;
      const candidateHash = record?.contentHash || fingerprints.get(pathKey)?.contentHash || '';
      if (candidateRole && candidateHash) cacheCandidates.set(`${candidateRole}\u0000${candidateHash}`, { role: candidateRole, contentHash: candidateHash });
      delete index[pathKey];
    }
  });

  let cacheDeleted = 0;
  for (const candidate of cacheCandidates.values()) {
    const cacheFile = childrenwearAnalysisCacheFile(candidate.role, candidate.contentHash);
    const existed = await fsp.stat(cacheFile).then(stat => stat.isFile()).catch(() => false);
    await fsp.rm(cacheFile, { force: true }).catch(() => {});
    if (existed) cacheDeleted += 1;
  }
  return { invalidated: resolvedPaths.length, cacheDeleted };
}

async function removeChildrenwearAnalysisCacheIfUnreferenced(role, contentHash) {
  const index = await readChildrenwearAnalysisIndex();
  const referenced = Object.values(index).some(record => record?.role === role && record?.contentHash === contentHash);
  if (!referenced) await fsp.rm(childrenwearAnalysisCacheFile(role, contentHash), { force: true }).catch(() => {});
}

function publicChildrenwearAnalysisRecord(record = null) {
  if (!record) return { status: 'pending', analyzed: false, error: '', analyzedAt: '', summary: '' };
  return {
    status: ['analyzing', 'analyzed', 'failed'].includes(record.status) ? record.status : 'pending',
    analyzed: record.status === 'analyzed',
    error: String(record.error || ''),
    analyzedAt: String(record.analyzedAt || ''),
    summary: String(record.summary || '')
  };
}

async function childrenwearAnalysisStatusForPath(file, roleValue, index = null) {
  const role = normalizeAnalysisRole(roleValue);
  const resolved = path.resolve(String(file || ''));
  const stat = await fsp.stat(resolved).catch(() => null);
  if (!stat?.isFile()) return { status: 'failed', analyzed: false, error: '素材文件不存在', analyzedAt: '', summary: '' };
  const source = index || await readChildrenwearAnalysisIndex();
  const record = source[childrenwearAnalysisPathKey(resolved)];
  if (!record || record.role !== role || Number(record.size) !== stat.size || Number(record.mtimeMs) !== Math.trunc(stat.mtimeMs) || record.schemaVersion !== ANALYSIS_SCHEMA_VERSION) {
    return { status: 'pending', analyzed: false, error: '', analyzedAt: '', summary: '' };
  }
  if (record.status === 'analyzed') {
    const cached = await readJsonFile(childrenwearAnalysisCacheFile(role, record.contentHash), null);
    if (!childrenwearAnalysisCacheMatches(cached, role, record.contentHash)) {
      return { status: 'pending', analyzed: false, error: '', analyzedAt: '', summary: '' };
    }
  }
  return publicChildrenwearAnalysisRecord(record);
}

function childrenwearAnalysisText(body) {
  const content = body?.choices?.[0]?.message?.content ?? body?.output_text ?? body?.output?.[0]?.content?.[0]?.text;
  if (Array.isArray(content)) return content.map(item => item?.text || item?.content || '').join('\n');
  return String(content || '');
}

async function requestChildrenwearAssetAnalysis(file, role, options = {}) {
  const api = await activeApiConfig();
  const model = String(api.analysisModel || ENV_API.analysisModel).trim();
  if (!model) throw new Error('请先配置素材分析模型');
  const reservation = currentActorRole() === 'superadmin' ? null : await billing.reserve(currentWorkspaceId(), 'llm', {
    relayId: api.activeRelay?.id,
    relayName: api.activeRelay?.name,
    modelId: model,
    ...relayBillingRange(api.activeRelay, 'llm'),
    ...(relayBillingRange(api.activeRelay, 'llm').amountMinMinor == null ? { amountMinMinor: 0, amountMaxMinor: 0 } : {}),
    description: '童装素材 AI 分析',
    reference: path.basename(file),
    recordUsage: true,
    onceKey: billingOnceKey('llm:childrenwear-analysis', currentWorkspaceId(), role, options.contentHash || '')
  });
  try {
    const dataUrl = await imageAsAnalysisDataUrl(file);
    const body = await apiJson(apiEndpoint(api.baseUrl, '/chat/completions'), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${api.imageKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: String(options.analysisPrompt || buildChildrenwearAssetAnalysisPrompt(role)) },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Analyze this image now. Return the required JSON object only.' },
              { type: 'image_url', image_url: { url: dataUrl, detail: 'high' } }
            ]
          }
        ]
      }),
      signal: options.signal
    }, Math.max(60_000, Number(api.requestTimeoutSeconds || 300) * 1000));
    const analysis = normalizeChildrenwearAssetAnalysis(role, childrenwearAnalysisText(body));
    if (reservation) await billing.commit(reservation);
    return { analysis, model, usage: body?.usage || null };
  } catch (error) {
    if (reservation) await billing.release(reservation).catch(() => {});
    throw error;
  }
}

async function analyzeChildrenwearAsset(file, roleValue, options = {}) {
  const role = normalizeAnalysisRole(roleValue);
  const fingerprint = await childrenwearFileFingerprint(file);
  const workspaceId = currentWorkspaceId();
  const lifecycleEpoch = childrenwearAnalysisPathEpoch(fingerprint.path, workspaceId);
  const cacheFile = childrenwearAnalysisCacheFile(role, fingerprint.contentHash);
  if (!options.force) {
    const cached = await readJsonFile(cacheFile, null);
    if (childrenwearAnalysisCacheMatches(cached, role, fingerprint.contentHash)) {
      if (!await childrenwearAnalysisFingerprintStillCurrent(fingerprint, lifecycleEpoch, workspaceId)) {
        throw new Error('素材已删除或替换，本次分析结果已作废');
      }
      const recorded = await updateChildrenwearAnalysisIndex(index => {
        if (childrenwearAnalysisPathEpoch(fingerprint.path, workspaceId) !== lifecycleEpoch) return false;
        index[childrenwearAnalysisPathKey(fingerprint.path)] = {
          ...fingerprint,
          role,
          status: 'analyzed',
          schemaVersion: ANALYSIS_SCHEMA_VERSION,
          model: cached.model || '',
          summary: String(cached.analysis.summary || '').slice(0, 1000),
          analyzedAt: cached.analyzedAt || new Date().toISOString(),
          error: ''
        };
        return true;
      });
      if (!recorded) throw new Error('素材已删除或替换，本次分析结果已作废');
      return { path: fingerprint.path, role, reused: true, analysis: cached.analysis };
    }
  }
  const inFlightKey = `${workspaceId}:${role}:${childrenwearAnalysisPathKey(fingerprint.path)}:${lifecycleEpoch}:${fingerprint.contentHash}`;
  if (childrenwearAnalysisInFlight.has(inFlightKey)) return childrenwearAnalysisInFlight.get(inFlightKey);
  const operation = (async () => {
    const markedAnalyzing = await updateChildrenwearAnalysisIndex(index => {
      if (childrenwearAnalysisPathEpoch(fingerprint.path, workspaceId) !== lifecycleEpoch) return false;
      index[childrenwearAnalysisPathKey(fingerprint.path)] = {
        ...fingerprint,
        role,
        status: 'analyzing',
        schemaVersion: ANALYSIS_SCHEMA_VERSION,
        analyzedAt: '',
        error: ''
      };
      return true;
    });
    if (!markedAnalyzing) throw new Error('素材已删除或替换，本次分析任务已取消');
    try {
      const result = await requestChildrenwearAssetAnalysis(fingerprint.path, role, { ...options, contentHash: fingerprint.contentHash });
      if (!await childrenwearAnalysisFingerprintStillCurrent(fingerprint, lifecycleEpoch, workspaceId)) {
        throw new Error('素材已删除或替换，本次分析结果已作废');
      }
      const analyzedAt = new Date().toISOString();
      await writeJsonFile(cacheFile, {
        schemaVersion: ANALYSIS_SCHEMA_VERSION,
        role,
        contentHash: fingerprint.contentHash,
        model: result.model,
        analyzedAt,
        analysis: result.analysis
      });
      if (!await childrenwearAnalysisFingerprintStillCurrent(fingerprint, lifecycleEpoch, workspaceId)) {
        await removeChildrenwearAnalysisCacheIfUnreferenced(role, fingerprint.contentHash);
        throw new Error('素材已删除或替换，本次分析结果已作废');
      }
      const recorded = await updateChildrenwearAnalysisIndex(index => {
        if (childrenwearAnalysisPathEpoch(fingerprint.path, workspaceId) !== lifecycleEpoch) return false;
        index[childrenwearAnalysisPathKey(fingerprint.path)] = {
          ...fingerprint,
          role,
          status: 'analyzed',
          schemaVersion: ANALYSIS_SCHEMA_VERSION,
          model: result.model,
          summary: String(result.analysis.summary || '').slice(0, 1000),
          analyzedAt,
          error: ''
        };
        return true;
      });
      if (!recorded) {
        await removeChildrenwearAnalysisCacheIfUnreferenced(role, fingerprint.contentHash);
        throw new Error('素材已删除或替换，本次分析结果已作废');
      }
      return { path: fingerprint.path, role, reused: false, analysis: result.analysis };
    } catch (error) {
      if (await childrenwearAnalysisFingerprintStillCurrent(fingerprint, lifecycleEpoch, workspaceId)) {
        await updateChildrenwearAnalysisIndex(index => {
          if (childrenwearAnalysisPathEpoch(fingerprint.path, workspaceId) !== lifecycleEpoch) return false;
          index[childrenwearAnalysisPathKey(fingerprint.path)] = {
            ...fingerprint,
            role,
            status: 'failed',
            schemaVersion: ANALYSIS_SCHEMA_VERSION,
            analyzedAt: '',
            error: String(error?.message || error).slice(0, 1000)
          };
          return true;
        });
      }
      throw error;
    }
  })().finally(() => childrenwearAnalysisInFlight.delete(inFlightKey));
  childrenwearAnalysisInFlight.set(inFlightKey, operation);
  return operation;
}

async function runChildrenwearAnalysisTasks(taskValues, payload = {}, options = {}) {
  const tasks = [...new Map((taskValues || []).map(item => {
    const role = normalizeAnalysisRole(item.role);
    const file = String(item.path || '');
    return [`${role}\u0000${path.resolve(file).toLocaleLowerCase('en-US')}`, { role, path: file }];
  })).values()].filter(item => item.path).slice(0, 5000);
  if (!tasks.length) return { total: 0, analyzed: 0, reused: 0, failed: 0, failures: [], concurrency: 0 };
  const concurrency = childrenwearAnalysisConcurrencyLimit(tasks.length);
  const analysisPrompts = new Map();
  await Promise.all([...new Set(tasks.map(item => item.role))].map(async role => {
    analysisPrompts.set(role, await configuredChildrenwearAnalysisPrompt(role));
  }));
  let completed = 0;
  let reused = 0;
  const failures = [];
  const results = await runWithConcurrency(tasks, concurrency, async task => {
    if (options.signal?.aborted) throw new Error('任务已停止');
    try {
      const result = await analyzeChildrenwearAsset(task.path, task.role, {
        force: payload.force === true,
        signal: options.signal,
        analysisPrompt: analysisPrompts.get(task.role)
      });
      if (result.reused) reused += 1;
      return result;
    } catch (error) {
      failures.push({ path: task.path, role: task.role, error: String(error?.message || error) });
      return null;
    } finally {
      completed += 1;
      options.reportProgress?.({
        phase: 'analyzing',
        current: completed,
        total: tasks.length,
        concurrency,
        percent: Math.round(completed / tasks.length * 100),
        message: `正在并发分析素材 ${completed}/${tasks.length}（并发 ${concurrency}）`
      });
    }
  });
  return {
    total: tasks.length,
    analyzed: results.filter(item => item?.ok && item.value).length,
    reused,
    failed: failures.length,
    failures,
    concurrency
  };
}

function enqueueChildrenwearAnalysisBatch(operation) {
  const workspaceId = currentWorkspaceId();
  const previous = childrenwearAnalysisBatchQueues.get(workspaceId) || Promise.resolve();
  const batch = previous.catch(() => {}).then(operation);
  const queued = batch.catch(() => {});
  childrenwearAnalysisBatchQueues.set(workspaceId, queued);
  return batch.finally(() => {
    if (childrenwearAnalysisBatchQueues.get(workspaceId) === queued) childrenwearAnalysisBatchQueues.delete(workspaceId);
  });
}

async function analyzeChildrenwearAssets(payload = {}, options = {}) {
  const role = normalizeAnalysisRole(payload.role);
  const paths = [...new Set((payload.paths || []).map(String).filter(Boolean))].slice(0, 5000);
  if (!paths.length) throw new Error('没有需要分析的素材');
  const result = await enqueueChildrenwearAnalysisBatch(() => runChildrenwearAnalysisTasks(
    paths.map(file => ({ path: file, role })),
    payload,
    options
  ));
  return { role, ...result };
}

async function scanPendingChildrenwearAnalysis(payload = {}, options = {}) {
  return enqueueChildrenwearAnalysisBatch(async () => {
    if (options.signal?.aborted) throw new Error('任务已停止');
    const config = await loadConfig();
    const analysisIndex = await readChildrenwearAnalysisIndex();
    const tasks = [];
    const byLibrary = {};
    for (const [configKey, role] of Object.entries(ROLE_BY_LIBRARY_KEY)) {
      const root = String(config[configKey] || '');
      const indexed = root ? await imageLibraryIndex(root) : [];
      let pending = 0;
      let failed = 0;
      for (const item of indexed) {
        const status = await childrenwearAnalysisStatusForPath(item.path, role, analysisIndex);
        if (status.status === 'analyzed' || status.status === 'analyzing') continue;
        if (status.status === 'failed') {
          failed += 1;
          if (payload.includeFailed !== true) continue;
        } else {
          pending += 1;
        }
        tasks.push({ path: item.path, role, configKey });
      }
      byLibrary[configKey] = { total: indexed.length, pending, failed };
    }
    if (!tasks.length) return { total: 0, analyzed: 0, reused: 0, failed: 0, failures: [], concurrency: 0, byLibrary };
    const result = await runChildrenwearAnalysisTasks(tasks, { force: false }, options);
    return { ...result, byLibrary };
  });
}

async function requireChildrenwearAssetAnalysis(file, roleValue) {
  const role = normalizeAnalysisRole(roleValue);
  const fingerprint = await childrenwearFileFingerprint(file);
  const cached = await readJsonFile(childrenwearAnalysisCacheFile(role, fingerprint.contentHash), null);
  if (!cached?.analysis || cached.schemaVersion !== ANALYSIS_SCHEMA_VERSION || cached.role !== role) {
    throw new Error('该素材尚未完成 AI 分析，请先在 01 素材资产中完成分析');
  }
  return { ...cached, path: fingerprint.path };
}

async function childrenwearAssetAnalysisForTask(file, roleValue, candidates = []) {
  const role = normalizeAnalysisRole(roleValue);
  const fingerprint = await childrenwearFileFingerprint(file);
  for (const candidate of candidates) {
    const analysis = candidate?.analysis;
    const contentHash = String(candidate?.contentHash || '');
    if (!analysis || typeof analysis !== 'object' || !contentHash) continue;
    if (candidate.schemaVersion && candidate.schemaVersion !== ANALYSIS_SCHEMA_VERSION) continue;
    if (contentHash !== fingerprint.contentHash) continue;
    return {
      schemaVersion: ANALYSIS_SCHEMA_VERSION,
      role,
      contentHash,
      analysis,
      path: fingerprint.path,
      embeddedTaskAnalysis: true
    };
  }
  return requireChildrenwearAssetAnalysis(fingerprint.path, role);
}

function shouldUsePowerShellApiFallback(url, error) {
  if (process.platform !== 'win32') return false;
  let protocol = '';
  try { protocol = new URL(String(url || '')).protocol; } catch { return false; }
  return ['http:', 'https:'].includes(protocol)
    && /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|UND_ERR|socket|network/i.test(`${error?.message || ''} ${error?.cause?.code || ''}`);
}

async function powershellJsonRequest(url, options = {}, timeoutMs = 120000) {
  const method = String(options.method || 'GET').toUpperCase();
  const headers = options.headers || {};
  const body = typeof options.body === 'string' ? options.body : '';
  const payload = JSON.stringify({
    url,
    method,
    headers,
    body,
    timeoutSeconds: Math.max(15, Math.ceil(timeoutMs / 1000))
  });
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'caishen-api-'));
  const payloadFile = path.join(tempRoot, 'payload.json');
  const scriptFile = path.join(tempRoot, 'request.ps1');
  const script = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$payload = [IO.File]::ReadAllText($args[0], [Text.Encoding]::UTF8) | ConvertFrom-Json
$headers = @{}
$contentType = ''
$payload.headers.PSObject.Properties | ForEach-Object {
  if ($_.Name -ieq 'Content-Type') { $contentType = [string]$_.Value }
  else { $headers[$_.Name] = [string]$_.Value }
}
$params = @{ Uri = [string]$payload.url; Method = [string]$payload.method; Headers = $headers; TimeoutSec = [int]$payload.timeoutSeconds }
if ($contentType) { $params.ContentType = $contentType }
if ([string]$payload.body) { $params.Body = [Text.Encoding]::UTF8.GetBytes([string]$payload.body) }
try {
  $response = Invoke-WebRequest @params -UseBasicParsing
  [Console]::Out.Write((@{ status = [int]$response.StatusCode; body = [string]$response.Content } | ConvertTo-Json -Compress -Depth 5))
} catch {
  $status = 0
  $content = ''
  if ($_.Exception.Response) {
    $status = [int]$_.Exception.Response.StatusCode
    try {
      $stream = $_.Exception.Response.GetResponseStream()
      if ($stream) {
        $reader = New-Object IO.StreamReader($stream)
        $content = $reader.ReadToEnd()
      }
    } catch {}
  }
  if (-not $content) { $content = $_.ErrorDetails.Message }
  if (-not $content) { $content = $_.Exception.Message }
  [Console]::Out.Write((@{ status = $status; body = [string]$content } | ConvertTo-Json -Compress -Depth 5))
}
`;
  await fsp.writeFile(payloadFile, payload, 'utf8');
  await fsp.writeFile(scriptFile, script, 'utf8');
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptFile, payloadFile], {
      timeout: timeoutMs + 5000,
      windowsHide: true,
      encoding: 'buffer',
      maxBuffer: 20 * 1024 * 1024
    }, (error, stdout, stderr) => {
      fsp.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
      const outputText = Buffer.isBuffer(stdout) ? stdout.toString('utf8') : String(stdout || '');
      const errorText = Buffer.isBuffer(stderr) ? stderr.toString('utf8') : String(stderr || '');
      if (error) return reject(new Error(errorText || error.message));
      try { return resolve(JSON.parse(outputText || '{}')); }
      catch { return reject(new Error(outputText || errorText || 'PowerShell API request failed')); }
    });
  });
}

async function powershellMultipartJsonRequest(url, request = {}, timeoutMs = 120000) {
  const payload = JSON.stringify({
    url,
    headers: request.headers || {},
    fields: request.fields || [],
    files: request.files || [],
    timeoutSeconds: Math.max(15, Math.ceil(timeoutMs / 1000))
  });
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'caishen-image-api-'));
  const payloadFile = path.join(tempRoot, 'payload.json');
  const scriptFile = path.join(tempRoot, 'request.ps1');
  const script = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.Net.Http
$payload = [IO.File]::ReadAllText($args[0], [Text.Encoding]::UTF8) | ConvertFrom-Json
$client = [System.Net.Http.HttpClient]::new()
$client.Timeout = [TimeSpan]::FromSeconds([int]$payload.timeoutSeconds)
$payload.headers.PSObject.Properties | ForEach-Object {
  if ($_.Name -ine 'Content-Type') {
    [void]$client.DefaultRequestHeaders.TryAddWithoutValidation([string]$_.Name, [string]$_.Value)
  }
}
$content = [System.Net.Http.MultipartFormDataContent]::new()
foreach ($field in @($payload.fields)) {
  $part = [System.Net.Http.StringContent]::new([string]$field.value, [Text.Encoding]::UTF8)
  $content.Add($part, [string]$field.name)
}
foreach ($file in @($payload.files)) {
  $bytes = [IO.File]::ReadAllBytes([string]$file.path)
  $part = [System.Net.Http.ByteArrayContent]::new($bytes)
  if ([string]$file.contentType) {
    $part.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse([string]$file.contentType)
  }
  $content.Add($part, [string]$file.name, [string]$file.fileName)
}
try {
  $response = $client.PostAsync([string]$payload.url, $content).GetAwaiter().GetResult()
  $responseBody = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
  [Console]::Out.Write((@{ status = [int]$response.StatusCode; body = [string]$responseBody } | ConvertTo-Json -Compress -Depth 5))
} catch {
  $responseBody = $_.Exception.Message
  [Console]::Out.Write((@{ status = 0; body = [string]$responseBody } | ConvertTo-Json -Compress -Depth 5))
} finally {
  if ($content) { $content.Dispose() }
  if ($client) { $client.Dispose() }
}
`;
  await fsp.writeFile(payloadFile, payload, 'utf8');
  await fsp.writeFile(scriptFile, script, 'utf8');
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptFile, payloadFile], {
      timeout: timeoutMs + 5000,
      windowsHide: true,
      encoding: 'buffer',
      maxBuffer: 20 * 1024 * 1024
    }, (error, stdout, stderr) => {
      fsp.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
      const outputText = Buffer.isBuffer(stdout) ? stdout.toString('utf8') : String(stdout || '');
      const errorText = Buffer.isBuffer(stderr) ? stderr.toString('utf8') : String(stderr || '');
      if (error) return reject(new Error(errorText || error.message));
      try { return resolve(JSON.parse(outputText || '{}')); }
      catch { return reject(new Error(outputText || errorText || 'PowerShell image API request failed')); }
    });
  });
}

async function powershellDownloadBuffer(url, timeoutMs = IMAGE_URL_TIMEOUT_MS) {
  const tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'caishen-image-download-'));
  const outputFile = path.join(tempRoot, 'image.bin');
  const scriptFile = path.join(tempRoot, 'download.ps1');
  const script = `
$ErrorActionPreference = 'Stop'
$params = @{ Uri = [string]$args[0]; OutFile = [string]$args[1]; TimeoutSec = [int]$args[2]; UseBasicParsing = $true }
Invoke-WebRequest @params
`;
  await fsp.writeFile(scriptFile, script, 'utf8');
  return new Promise((resolve, reject) => {
    execFile('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', scriptFile, url, outputFile, String(Math.max(15, Math.ceil(timeoutMs / 1000)))], {
      timeout: timeoutMs + 5000,
      windowsHide: true,
      encoding: 'buffer',
      maxBuffer: 2 * 1024 * 1024
    }, async (error, _stdout, stderr) => {
      try {
        if (error) {
          const detail = Buffer.isBuffer(stderr) ? stderr.toString('utf8') : String(stderr || '');
          return reject(new Error(detail || error.message));
        }
        return resolve(await fsp.readFile(outputFile));
      } catch (readError) {
        return reject(readError);
      } finally {
        fsp.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
      }
    });
  });
}

async function apiJson(url, options = {}, timeoutMs = 120000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let response;
    try {
      response = await fetch(url, { ...options, signal: controller.signal });
    } catch (error) {
      if (!shouldUsePowerShellApiFallback(url, error)) throw error;
      const fallback = await powershellJsonRequest(url, options, timeoutMs);
      const text = fallback.body || '';
      let body;
      try { body = JSON.parse(text); } catch { body = { error: { message: text || `HTTP ${fallback.status}` } }; }
      if (fallback.status < 200 || fallback.status >= 300) {
        const error = new Error(body?.error?.message || body?.message || text || `HTTP ${fallback.status}`);
        error.status = fallback.status;
        throw error;
      }
      return body;
    }
    const text = await response.text();
    let body;
    try { body = JSON.parse(text); } catch { body = { error: { message: text || `HTTP ${response.status}` } }; }
    if (!response.ok) {
      const error = new Error(body?.error?.message || body?.message || text || `HTTP ${response.status}`);
      error.status = response.status;
      error.retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'));
      throw error;
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

function randomDelay(minimumMs, maximumMs, signal = null) {
  const minimum = Math.max(0, Math.trunc(minimumMs));
  const maximum = Math.max(minimum, Math.trunc(maximumMs));
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('任务已停止'));
    const timer = setTimeout(resolve, minimum + Math.floor(Math.random() * (maximum - minimum + 1)));
    signal?.addEventListener?.('abort', () => {
      clearTimeout(timer);
      reject(new Error('任务已停止'));
    }, { once: true });
  });
}

function isRetryableImageApiFailure(status, value) {
  const numericStatus = Number(status) || 0;
  if (numericStatus === 0 || [408, 409, 425, 429].includes(numericStatus) || numericStatus >= 500) return true;
  const text = typeof value === 'string' ? value : JSON.stringify(value || '');
  return /system_cpu_overloaded|cpu overloaded|temporar(?:y|ily) unavailable|upstream service|server is busy|service unavailable|rate limit|too many requests|try again|timeout/i.test(text);
}

function imageApiFailureMessage(status, value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value || '');
  return text.trim().slice(0, 500) || `HTTP ${status}`;
}

async function adaptiveImageApiJsonOnce(url, options, timeoutMs, externalSignal) {
  const controller = new AbortController();
  const abortFromExternal = () => controller.abort();
  if (externalSignal?.aborted) controller.abort();
  else externalSignal?.addEventListener?.('abort', abortFromExternal, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const { signal: _ignoredSignal, _powershellMultipart, ...fetchOptions } = options || {};
  try {
    let response;
    try {
      response = await fetch(url, { ...fetchOptions, signal: controller.signal });
    } catch (error) {
      if (!_powershellMultipart || !shouldUsePowerShellApiFallback(url, error)) throw error;
      const fallback = await powershellMultipartJsonRequest(url, {
        headers: fetchOptions.headers || {},
        ..._powershellMultipart
      }, timeoutMs);
      const fallbackText = fallback.body || '';
      let fallbackBody;
      try { fallbackBody = JSON.parse(fallbackText); }
      catch { fallbackBody = { error: { message: fallbackText || `HTTP ${fallback.status}` } }; }
      if (fallback.status >= 200 && fallback.status < 300) return fallbackBody;
      const message = fallbackBody?.error?.message || fallbackBody?.message || imageApiFailureMessage(fallback.status, fallbackText);
      if (isRetryableImageApiFailure(fallback.status, fallbackText || fallbackBody)) {
        throw new RetryableRequestError(message, { status: fallback.status });
      }
      const failure = new Error(message);
      failure.status = fallback.status;
      throw failure;
    }

    const text = await response.text();
    let body;
    try { body = JSON.parse(text); }
    catch { body = { error: { message: text || `HTTP ${response.status}` } }; }
    if (response.ok) return body;
    const message = body?.error?.message || body?.message || imageApiFailureMessage(response.status, text);
    if (isRetryableImageApiFailure(response.status, text || body)) {
      throw new RetryableRequestError(message, {
        status: response.status,
        retryAfterMs: parseRetryAfterMs(response.headers.get('retry-after'))
      });
    }
    const failure = new Error(message);
    failure.status = response.status;
    throw failure;
  } catch (error) {
    if (error instanceof RetryableRequestError || externalSignal?.aborted) throw error;
    const description = `${error?.name || ''} ${error?.message || error}`;
    if (/AbortError|fetch failed|network|socket|ECONN|ENOTFOUND|EAI_AGAIN|temporar(?:y|ily) unavailable|upstream service|server is busy|service unavailable|rate limit|too many requests|timeout/i.test(description)) {
      throw new RetryableRequestError(error?.message || String(error), { code: error?.code });
    }
    throw error;
  } finally {
    externalSignal?.removeEventListener?.('abort', abortFromExternal);
    clearTimeout(timer);
  }
}

async function adaptiveImageApiJson(url, optionsOrFactory = {}, timeoutMs = IMAGE_API_TIMEOUT_MS, scheduling = {}) {
  return imageApiScheduler.schedule(async ({ attempt, signal }) => {
    const options = typeof optionsOrFactory === 'function'
      ? await optionsOrFactory({ attempt, signal })
      : optionsOrFactory;
    return adaptiveImageApiJsonOnce(url, options, timeoutMs, signal);
  }, {
    signal: scheduling.signal,
    onState: scheduling.onState
  });
}

async function downloadGeneratedImage(url, signal) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const controller = new AbortController();
    const abortFromExternal = () => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener?.('abort', abortFromExternal, { once: true });
    const timer = setTimeout(() => controller.abort(), IMAGE_URL_TIMEOUT_MS);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`Image download failed: HTTP ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      lastError = error;
      if (process.platform === 'win32' && /fetch failed|ECONNRESET|socket|network/i.test(`${error?.message || ''} ${error?.cause?.code || ''}`)) {
        try { return await powershellDownloadBuffer(url, IMAGE_URL_TIMEOUT_MS); }
        catch (fallbackError) { lastError = fallbackError; }
      }
      if (signal?.aborted || attempt >= 3) throw error;
      await randomDelay(500 * attempt, 1000 * attempt, signal);
    } finally {
      signal?.removeEventListener?.('abort', abortFromExternal);
      clearTimeout(timer);
    }
  }
  throw lastError || new Error('Image download failed');
}

async function generateImage(prompt, imagePaths, options = {}) {
  const api = await activeApiConfig();
  applyImageSchedulerSettings(api);
  const preparedImages = await Promise.all(imagePaths.map(file => {
    if (!isImagePath(file)) throw new Error(`Unsupported image format: ${path.basename(file)}`);
    return imageReferenceCache.prepare(file);
  }));
  const imageFieldName = preparedImages.length > 1 ? 'image[]' : 'image';
  const maskPath = options.maskPath && fs.existsSync(options.maskPath) ? options.maskPath : '';
  const preparation = {
    originalBytes: preparedImages.reduce((total, item) => total + item.originalBytes, 0),
    preparedBytes: preparedImages.reduce((total, item) => total + item.preparedBytes, 0)
  };
  const billingExempt = options.skipBilling || currentActorRole() === 'superadmin';
  const attemptBillingKey = options.billingOnceKey
    || billingOnceKey('image:api-request', currentWorkspaceId(), Date.now(), crypto.randomUUID());
  let billingAmountMinor = 0;
  let apiRequestCount = 0;
  try {
    const attemptStartedAt = new Map();
    const endpoint = apiEndpoint(api.baseUrl, '/images/edits');
    const body = await imageApiScheduler.schedule(async ({ attempt, signal }) => {
      if (signal?.aborted) throw new Error('Task stopped');
      const fields = [
        { name: 'model', value: api.imageModel },
        { name: 'prompt', value: applyRelayPrompt(prompt) },
        { name: 'n', value: '1' },
        { name: 'size', value: options.size || '1024x1024' },
        { name: 'quality', value: options.quality || 'high' },
        { name: 'response_format', value: api.responseFormat || 'url' }
      ];
      const files = [];
      for (const prepared of preparedImages) {
        const file = prepared.path;
        files.push({
          name: imageFieldName,
          path: file,
          fileName: `${path.basename(prepared.sourcePath, path.extname(prepared.sourcePath))}${path.extname(file)}`,
          contentType: imageMimeType(file)
        });
      }
      if (maskPath) files.push({ name: 'mask', path: maskPath, fileName: 'template-edit-mask.png', contentType: 'image/png' });
      const form = new FormData();
      for (const field of fields) form.set(field.name, String(field.value));
      for (const prepared of preparedImages) {
        const bytes = await fsp.readFile(prepared.path);
        const uploadName = `${path.basename(prepared.sourcePath, path.extname(prepared.sourcePath))}${path.extname(prepared.path)}`;
        form.append(imageFieldName, new Blob([bytes], { type: imageMimeType(prepared.path) }), uploadName);
      }
      if (maskPath) {
        const maskBytes = await fsp.readFile(maskPath);
        form.append('mask', new Blob([maskBytes], { type: 'image/png' }), 'template-edit-mask.png');
      }
      const requestOptions = {
        method: 'POST',
        headers: { Authorization: `Bearer ${api.imageKey}` },
        body: form,
        signal,
        _powershellMultipart: { fields, files }
      };
      const reservation = billingExempt ? null : await billing.reserve(currentWorkspaceId(), 'image', {
        relayId: api.activeRelay?.id,
        relayName: api.activeRelay?.name,
        modelId: api.imageModel,
        ...relayBillingRange(api.activeRelay),
        description: options.billingDescription || 'Image generation',
        reference: options.billingReference || '',
        onceKey: `${attemptBillingKey}:attempt:${attempt}`
      });
      try {
        return await adaptiveImageApiJsonOnce(endpoint, requestOptions, IMAGE_API_TIMEOUT_MS, signal);
      } finally {
        const billingEntry = reservation ? await billing.commit(reservation) : null;
        billingAmountMinor += Math.abs(Number(billingEntry?.amountMinor) || 0);
      }
    }, {
      signal: options.signal,
      onState: event => {
        if (event.state === 'running') {
          attemptStartedAt.set(event.attempt, Date.now());
          apiRequestCount += 1;
        }
        const startedAt = attemptStartedAt.get(event.attempt);
        options.onRequestState?.({
          ...event,
          ...preparation,
          apiElapsedMs: startedAt ? Math.max(0, Date.now() - startedAt) : 0
        });
      }
    });
    const result = extractImageResult(body, api.responseFormat || 'url');
    const downloadStartedAt = Date.now();
    const bytes = result.type === 'base64'
      ? Buffer.from(result.value, 'base64')
      : await downloadGeneratedImage(result.value, options.signal);
    options.onRequestState?.({
      state: result.type === 'base64' ? 'decoded' : 'downloaded',
      attempt: 0,
      ...getImageSchedulerSnapshot(),
      ...preparation,
      downloadElapsedMs: Math.max(0, Date.now() - downloadStartedAt)
    });
    bytes.billingAmountMinor = billingAmountMinor;
    bytes.apiRequestCount = apiRequestCount;
    bytes.imageModel = api.imageModel || '';
    bytes.relayId = api.activeRelay?.id || '';
    bytes.relayName = api.activeRelay?.name || '';
    bytes.upstreamCostCnyMicro = apiRequestCount * Math.max(0, Number(api.activeRelay?.upstreamImageCostCnyMicro) || 0);
    return bytes;
  } catch (error) {
    error.billingAmountMinor = Math.max(0, Number(error?.billingAmountMinor) || 0) + billingAmountMinor;
    throw error;
  }
}

async function nextTaskFolder(config) {
  const outputRoot = config.outputPath || defaultConfig().outputPath;
  await fsp.mkdir(outputRoot, { recursive: true });
  const today = new Date();
  const prefix = `${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}-`;
  const entries = await fsp.readdir(outputRoot, { withFileTypes: true }).catch(() => []);
  let serial = entries
    .filter(entry => entry.isDirectory() && entry.name.startsWith(prefix))
    .map(entry => Number(entry.name.slice(prefix.length)) || 0)
    .reduce((maximum, value) => Math.max(maximum, value), 0) + 1;
  let folder = path.join(outputRoot, `${prefix}${String(serial).padStart(4, '0')}`);
  while (true) {
    try {
      await fsp.mkdir(folder);
      break;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      serial += 1;
      folder = path.join(outputRoot, `${prefix}${String(serial).padStart(4, '0')}`);
    }
  }
  return folder;
}

async function readJsonFile(file, fallback = null) {
  try { return JSON.parse(await fsp.readFile(file, 'utf8')); } catch { return fallback; }
}

async function writeJsonFile(file, value) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, JSON.stringify(value, null, 2), 'utf8');
}

async function writeTaskSource(folder, task, generationMode) {
  const templateRelativePaths = [...new Set((Array.isArray(task.templateRelativePaths)
    ? task.templateRelativePaths
    : task.templateRelativePath ? [task.templateRelativePath] : [])
    .map(value => String(value || '').trim())
    .filter(Boolean))];
  const source = {
    productPath: task.productPath || '',
    printPath: task.printPath || '',
    masterImagePath: task.masterImagePath || '',
    masterReferencePath: task.masterReferencePath || '',
    templateFolderPath: task.templateFolderPath || '',
    templateRelativePaths,
    generationMode: generationMode || task.generationMode || 'master',
    taskNumber: Number(task.taskNumber || 0),
    note: task.note || '',
    createdAt: new Date().toISOString(),
    status: '待人工筛图'
  };
  const paths = metadataPaths(folder);
  await Promise.all([
    writeJsonFile(paths.macSource, toMacSourceMetadata(source, { status: '待人工筛图', createdAt: source.createdAt })),
    writeJsonFile(paths.wpfSource, toWpfSourceMetadata(source))
  ]);
}

async function readOperationLogs(folder) {
  const raw = await readJsonFile(metadataPaths(folder).operationLog, []);
  return normalizeOperationLogs(raw);
}

async function addOperationLog(folder, message) {
  const logs = appendOperationLog(await readOperationLogs(folder), { folderName: path.basename(folder), message });
  await writeJsonFile(metadataPaths(folder).operationLog, toWpfOperationLogs(logs));
  return logs;
}

function resolveInside(root, relativePath) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, String(relativePath || ''));
  if (!isSameOrChildPath(resolvedRoot, resolved)) throw new Error('模板相对路径无效');
  return resolved;
}

const STRUCTURED_TEMPLATE_SECTIONS = Object.freeze({
  main: new Set(['主图', '1-1主图', '1:1主图', '1_1主图', '1/1主图']),
  ratio: new Set(['3-4主图', '3:4主图', '3_4主图', '3/4主图']),
  sku: new Set(['sku', 'SKU']),
  detail: new Set(['详情页', '详情'])
});
const DETAIL_FULL_FILE_NAMES = new Set(['detail-full', 'detail_full', '完整详情页', '详情页']);
const DETAIL_FULL_SLICE_HEIGHT = Number(process.env.CAISHEN_DETAIL_FULL_SLICE_HEIGHT || 0);
const DETAIL_FULL_SLICE_HEIGHT_MIN = 700;
const DETAIL_FULL_SLICE_RATIO = 1.5;
const DETAIL_FULL_SLICE_OVERLAP = Math.max(0, Number(process.env.CAISHEN_DETAIL_FULL_SLICE_OVERLAP || 0));
const TEMPLATE_INTERNAL_DIRS = new Set(['.caishen-template-cache', '.caishen-meta']);

function normalizeTemplateRelativePath(value) {
  return String(value || '').replaceAll('\\', '/');
}

function templateSectionName(relativePath) {
  const normalized = normalizeTemplateRelativePath(relativePath);
  const [section = ''] = normalized.split('/');
  return section || path.basename(path.dirname(relativePath));
}

function templateRelativePathParts(templateRoot, filePath) {
  return normalizeTemplateRelativePath(path.relative(templateRoot, filePath)).split('/').filter(Boolean);
}

function isStructuredTemplateFolder(templateRoot, imagePaths) {
  let hasMainOrRatio = false;
  let hasDetail = false;
  for (const file of imagePaths) {
    const [section] = templateRelativePathParts(templateRoot, file);
    if (STRUCTURED_TEMPLATE_SECTIONS.main.has(section) || STRUCTURED_TEMPLATE_SECTIONS.ratio.has(section)) hasMainOrRatio = true;
    if (STRUCTURED_TEMPLATE_SECTIONS.detail.has(section)) hasDetail = true;
    if (hasMainOrRatio && hasDetail) return true;
  }
  return false;
}

function detailFullRelativePath(relativePath) {
  const parts = normalizeTemplateRelativePath(relativePath).split('/').filter(Boolean);
  if (parts.length < 2 || !STRUCTURED_TEMPLATE_SECTIONS.detail.has(parts[0])) return false;
  return DETAIL_FULL_FILE_NAMES.has(path.basename(parts.at(-1), path.extname(parts.at(-1))).toLocaleLowerCase('zh-CN'));
}

function detailSliceRelativePath(sectionName, index) {
  return `${sectionName}/${String(index + 1).padStart(2, '0')}.jpg`;
}

function resolveDetailFullSliceHeight(width) {
  const explicitHeight = DETAIL_FULL_SLICE_HEIGHT;
  if (Number.isFinite(explicitHeight) && explicitHeight > 0) {
    return Math.max(DETAIL_FULL_SLICE_HEIGHT_MIN, Math.floor(explicitHeight));
  }
  const safeWidth = Math.max(1, Math.floor(Number(width) || 790));
  return Math.max(DETAIL_FULL_SLICE_HEIGHT_MIN, Math.round(safeWidth * DETAIL_FULL_SLICE_RATIO));
}

async function ensureDetailFullSliceSpecs(templateRoot, fullPath) {
  const sourceRelativePath = normalizeTemplateRelativePath(path.relative(templateRoot, fullPath));
  const detailSectionName = templateSectionName(sourceRelativePath);
  const sourceStat = await fsp.stat(fullPath);
  const metadata = await sharp(fullPath).metadata();
  const width = Math.max(1, Number(metadata.width) || 1);
  const height = Math.max(1, Number(metadata.height) || 1);
  const sliceHeight = resolveDetailFullSliceHeight(width);
  const sliceCount = Math.max(1, Math.ceil(height / sliceHeight));
  const effectiveOverlap = Math.max(0, Math.min(Math.floor(DETAIL_FULL_SLICE_OVERLAP), Math.max(0, Math.floor(sliceHeight / 2) - 1)));
  const cacheKey = crypto.createHash('sha1').update(sourceRelativePath).digest('hex').slice(0, 16);
  const sliceRoot = path.join(templateRoot, '.caishen-meta', 'detail-full-slices', cacheKey);
  const manifestFile = path.join(sliceRoot, 'manifest.json');
  const manifest = {
    sourceRelativePath,
    size: sourceStat.size,
    mtimeMs: Math.trunc(sourceStat.mtimeMs),
    width,
    height,
    sliceHeight,
    sliceOverlap: effectiveOverlap,
    sliceCount
  };
  const existing = await readJsonFile(manifestFile, null);
  const sliceFiles = Array.from({ length: sliceCount }, (_, index) => path.join(sliceRoot, `${String(index + 1).padStart(2, '0')}.jpg`));
  const filesReady = await Promise.all(sliceFiles.map(file => fsp.stat(file).then(stat => stat.isFile(), () => false)));
  const cacheValid = existing && JSON.stringify(existing) === JSON.stringify(manifest) && filesReady.every(Boolean);
  if (!cacheValid) {
    await fsp.rm(sliceRoot, { recursive: true, force: true });
    await fsp.mkdir(sliceRoot, { recursive: true });
    for (let index = 0; index < sliceCount; index += 1) {
      const baseTop = index * sliceHeight;
      const top = Math.max(0, index === 0 ? baseTop : baseTop - effectiveOverlap);
      const nextBaseTop = Math.min(height, (index + 1) * sliceHeight);
      const nextTop = index < sliceCount - 1 ? nextBaseTop + effectiveOverlap : nextBaseTop;
      const currentSliceHeight = Math.max(1, Math.min(height, nextTop) - top);
      await sharp(fullPath)
        .extract({ left: 0, top, width, height: currentSliceHeight })
        .jpeg({ quality: 95 })
        .toFile(sliceFiles[index]);
    }
    await writeJsonFile(manifestFile, manifest);
  }
  const specs = sliceFiles.map((templatePath, index) => {
    const isFirst = index === 0;
    const isLast = index === sliceCount - 1;
    const trimTopPx = isFirst ? 0 : effectiveOverlap;
    const trimBottomPx = isLast ? 0 : effectiveOverlap;
    return {
      templatePath,
      relativePath: detailSliceRelativePath(detailSectionName, index),
      sourceRelativePath,
      sectionName: detailSectionName,
      trimPixels: {
        top: trimTopPx,
        bottom: trimBottomPx
      }
    };
  });
  for (let index = 0; index < specs.length; index += 1) {
    specs[index].neighborImages = [
      index > 0 ? { label: 'previous slice', relativePath: specs[index - 1].relativePath, templatePath: specs[index - 1].templatePath } : null,
      index < specs.length - 1 ? { label: 'next slice', relativePath: specs[index + 1].relativePath, templatePath: specs[index + 1].templatePath } : null
    ].filter(Boolean);
  }
  return specs;
}

async function buildStructuredTemplateJobSpecs(templateRoot, imagePaths) {
  const mainSpecs = [];
  const ratioSpecs = [];
  const skuSpecs = [];
  const detailSpecs = [];
  for (const templatePath of imagePaths) {
    const relativePath = normalizeTemplateRelativePath(path.relative(templateRoot, templatePath));
    const sectionName = templateSectionName(relativePath);
    if (STRUCTURED_TEMPLATE_SECTIONS.main.has(sectionName)) {
      mainSpecs.push({ templatePath, relativePath, sectionName });
      continue;
    }
    if (STRUCTURED_TEMPLATE_SECTIONS.ratio.has(sectionName)) {
      ratioSpecs.push({ templatePath, relativePath, sectionName });
      continue;
    }
    if (STRUCTURED_TEMPLATE_SECTIONS.sku.has(sectionName)) {
      skuSpecs.push({ templatePath, relativePath, sectionName });
      continue;
    }
    if (STRUCTURED_TEMPLATE_SECTIONS.detail.has(sectionName)) {
      // Detail pages are supplied by designers as final ordered slices. Never
      // split or rename them in the backend, regardless of filename or height.
      detailSpecs.push({ templatePath, relativePath, sectionName });
    }
  }
  return [...mainSpecs, ...ratioSpecs, ...skuSpecs, ...detailSpecs];
}

async function listTemplateImagePaths(templateRoot) {
  const rootStat = await fsp.stat(templateRoot).catch(() => null);
  if (!rootStat?.isDirectory()) throw new Error('套图文件夹不存在');
  const files = [];
  async function walk(directory) {
    const entries = await fsp.readdir(directory, { withFileTypes: true }).catch(() => []);
    entries.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN', { numeric: true }));
    for (const entry of entries) {
      if (entry.name.startsWith('.') || TEMPLATE_INTERNAL_DIRS.has(entry.name)) continue;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(fullPath);
      else if (entry.isFile() && isImagePath(fullPath)) files.push(fullPath);
    }
  }
  await walk(templateRoot);
  return files;
}

async function buildTemplateJobs(templateRoot, outputRoot = templateRoot) {
  const imagePaths = await listTemplateImagePaths(templateRoot);
  const specs = isStructuredTemplateFolder(templateRoot, imagePaths)
    ? await buildStructuredTemplateJobSpecs(templateRoot, imagePaths)
    : imagePaths.map(templatePath => ({
      templatePath,
      relativePath: normalizeTemplateRelativePath(path.relative(templateRoot, templatePath)),
      sectionName: templateSectionName(path.relative(templateRoot, templatePath))
    }));
  return specs.map(spec => {
    const relativePath = normalizeTemplateRelativePath(spec.relativePath);
    return {
      templateRoot,
      templatePath: spec.templatePath,
      relativePath,
      outputRoot,
      outputPath: path.join(outputRoot, relativePath),
      trimPixels: spec.trimPixels || null,
      sourceRelativePath: spec.sourceRelativePath || relativePath,
      neighborImages: spec.neighborImages || null,
      sectionName: spec.sectionName || templateSectionName(relativePath)
    };
  });
}

async function detailSliceNeighborImages(job) {
  if (Array.isArray(job.neighborImages)) return job.neighborImages;
  if (!isDetailSliceTemplate(job, '')) return [];
  const currentPath = path.resolve(job.templatePath);
  const currentDirectory = path.dirname(currentPath);
  const images = (await listTemplateImagePaths(job.templateRoot).catch(() => []))
    .filter(file => path.dirname(path.resolve(file)) === currentDirectory);
  const currentIndex = images.findIndex(file => path.resolve(file) === currentPath);
  if (currentIndex < 0) return [];
  const neighbors = [];
  if (currentIndex > 0) {
    const previous = images[currentIndex - 1];
    neighbors.push({
      label: 'previous slice',
      relativePath: path.relative(job.templateRoot, previous),
      templatePath: previous
    });
  }
  if (currentIndex < images.length - 1) {
    const next = images[currentIndex + 1];
    neighbors.push({
      label: 'next slice',
      relativePath: path.relative(job.templateRoot, next),
      templatePath: next
    });
  }
  return neighbors;
}

async function templateConfigurationForJob(job) {
  const cache = templateCachePaths(job.templateRoot, job.relativePath);
  const savedConfiguration = await readValidTemplateAnalysisCache({ cacheFile: cache.analysisFile, templateImagePath: job.templatePath });
  const value = savedConfiguration || JSON.stringify(createManualTemplateAnalysis({
    action: 'copy_original',
    reason: '未框选区域，按原图复制'
  }));
  return {
    cache,
    configuration: value,
    summary: parseTemplateAnalysisSummary(value),
    saved: Boolean(savedConfiguration)
  };
}

function templateRelativeKey(value) {
  return String(value || '').replaceAll('\\', '/').toLocaleLowerCase('zh-CN');
}

async function planTemplateOutputJobs(templateFolderPath, selectedPaths = null) {
  const jobs = await buildTemplateJobs(templateFolderPath);
  if (!jobs.length) throw new Error('套图文件夹里没有可用图片');
  const selected = new Set((Array.isArray(selectedPaths) ? selectedPaths : [])
    .map(templateRelativeKey)
    .filter(Boolean));
  const planned = [];
  const excluded = [];
  const unresolved = [];
  let matchedSelection = selected.size === 0;

  for (const job of jobs) {
    const details = await templateConfigurationForJob(job);
    const action = normalizeTemplateProcessingMode(details.summary.action);
    const relativeKey = templateRelativeKey(job.relativePath);
    if (selected.has(relativeKey)) matchedSelection = true;
    const enriched = { ...job, ...details, action };
    if (action === 'manual_check') {
      if (selected.size && !selected.has(relativeKey)) continue;
      unresolved.push(job.relativePath);
      continue;
    }
    if (action === 'exclude') {
      excluded.push(enriched);
      continue;
    }
    if (action === 'copy_original') {
      planned.push(enriched);
      continue;
    }
    if (selected.size && !selected.has(relativeKey)) continue;
    planned.push(enriched);
  }

  if (unresolved.length) {
    throw new Error(`仍有图片需要人工确认：${unresolved.join('、')}`);
  }
  if (!matchedSelection) throw new Error('选中的套图图片不存在或已被移除');
  if (!planned.length) throw new Error('没有可输出的套图图片');
  return {
    jobs: planned,
    relativePaths: planned.map(job => job.relativePath),
    excludedRelativePaths: excluded.map(job => job.relativePath),
    counts: {
      replacePrint: planned.filter(job => job.action === 'replace_print').length,
      copyOriginal: planned.filter(job => job.action === 'copy_original').length,
      excluded: excluded.length,
      manualCheck: unresolved.length
    }
  };
}

async function collectTemplateItems(templateRoot) {
  const jobs = await buildTemplateJobs(templateRoot);
  const items = [];
  for (const job of jobs) {
    const { summary } = await templateConfigurationForJob(job);
    const stat = await fsp.stat(job.templatePath).catch(() => null);
    const version = stat ? `${Math.trunc(stat.mtimeMs)}-${stat.size}` : '1';
    const displayFolder = path.dirname(normalizeTemplateRelativePath(job.relativePath));
    items.push({
      relativePath: job.relativePath,
      templatePath: job.templatePath,
      path: job.templatePath,
      name: path.basename(job.relativePath),
      folder: displayFolder && displayFolder !== '.' ? displayFolder : '根目录',
      templateUrl: `${imageUrl(job.templatePath)}?v=${version}`,
      url: `${imageUrl(job.templatePath)}?v=${version}`,
      thumbnailUrl: thumbnailUrl(job.templatePath, 480, version),
      previewUrl: thumbnailUrl(job.templatePath, 1200, version),
      action: summary.action,
      confidence: summary.confidence,
      reason: summary.reason,
      replaceArea: summary.replaceArea,
      forbiddenArea: summary.forbiddenArea,
      regions: summary.regions,
      protectedRegions: summary.protectedRegions
    });
  }
  return { jobs, items };
}

async function listTemplates(templateRoot) {
  const { items } = await collectTemplateItems(templateRoot);
  return items;
}

async function templateFolderImageSummary(root) {
  let count = 0;
  let previewFile = '';
  async function walk(directory, depth) {
    if (depth > 24) return;
    let entries = [];
    try { entries = await fsp.readdir(directory, { withFileTypes: true }); } catch { return; }
    entries.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN', { numeric: true }));
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(file, depth + 1);
      else if (entry.isFile() && isImagePath(file)) {
        count += 1;
        if (!previewFile) previewFile = file;
      }
    }
  }
  await walk(root, 0);
  if (!previewFile) return { count, preview: null };
  const stat = await fsp.stat(previewFile).catch(() => null);
  const version = stat ? `${Math.trunc(stat.mtimeMs)}-${stat.size}` : '1';
  return {
    count,
    preview: {
      name: path.basename(previewFile),
      thumbnailUrl: thumbnailUrl(previewFile, 480, version),
      previewUrl: thumbnailUrl(previewFile, 1200, version),
      url: `${imageUrl(previewFile)}?v=${version}`
    }
  };
}

async function templateFolderJobSummary(root) {
  const jobs = await buildTemplateJobs(root);
  const previewJob = jobs[0] || null;
  if (!previewJob) return { count: 0, preview: null };
  const stat = await fsp.stat(previewJob.templatePath).catch(() => null);
  const version = stat ? `${Math.trunc(stat.mtimeMs)}-${stat.size}` : '1';
  return {
    count: jobs.length,
    preview: {
      name: path.basename(previewJob.templatePath),
      thumbnailUrl: thumbnailUrl(previewJob.templatePath, 480, version),
      previewUrl: thumbnailUrl(previewJob.templatePath, 1200, version),
      url: `${imageUrl(previewJob.templatePath)}?v=${version}`
    }
  };
}

async function prepareTemplateStructure(folderValue) {
  const folder = String(folderValue || '');
  if (!folder || !fs.existsSync(folder)) throw new Error('Template folder does not exist');
  await buildTemplateJobs(folder);
  return listTemplates(folder);
}

async function listTemplateFolders() {
  const libraryRoot = path.join(currentWorkspaceRoot(), 'assets', 'template');
  let collections = [];
  try { collections = await fsp.readdir(libraryRoot, { withFileTypes: true }); } catch { return []; }
  const folders = [];
  for (const collection of collections) {
    if (!collection.isDirectory() || collection.name.startsWith('.')) continue;
    const collectionRoot = path.join(libraryRoot, collection.name);
    let children = [];
    try { children = await fsp.readdir(collectionRoot, { withFileTypes: true }); } catch { continue; }
    for (const child of children) {
      if (!child.isDirectory() || child.name.startsWith('.')) continue;
      const folder = path.join(collectionRoot, child.name);
      const [summary, stat] = await Promise.all([
        templateFolderJobSummary(folder).catch(() => templateFolderImageSummary(folder)),
        fsp.stat(folder).catch(() => null)
      ]);
      folders.push({
        id: `${collection.name}/${child.name}`,
        name: child.name,
        path: folder,
        count: summary.count,
        preview: summary.preview,
        modifiedAt: stat?.mtimeMs || 0
      });
    }
  }
  return folders.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN', { numeric: true }) || right.modifiedAt - left.modifiedAt);
}

async function deleteTemplateFolder(folderValue) {
  const libraryRoot = path.resolve(currentWorkspaceRoot(), 'assets', 'template');
  const folder = path.resolve(String(folderValue || ''));
  const relative = path.relative(libraryRoot, folder);
  const segments = relative.split(path.sep).filter(Boolean);
  if (!relative || !isSameOrChildPath(libraryRoot, folder) || segments.length !== 2) {
    throw new Error('只能删除已导入的套图文件夹');
  }
  const stat = await fsp.lstat(folder).catch(() => null);
  if (!stat?.isDirectory()) throw new Error('套图文件夹不存在或已被删除');
  const summary = await templateFolderImageSummary(folder);
  await fsp.rm(folder, { recursive: true, force: true });
  const collectionRoot = path.dirname(folder);
  if (!(await fsp.readdir(collectionRoot).catch(() => [])).length) await fsp.rmdir(collectionRoot).catch(() => {});
  return { path: folder, deleted: true, count: summary.count };
}

function summarizeTemplatePreparation(folder, items, extra = {}) {
  const previewItem = items.find(item => item.action === 'replace_print') || items[0] || null;
  const counts = {
    replacePrint: items.filter(item => item.action === 'replace_print').length,
    copyOriginal: items.filter(item => item.action === 'copy_original').length,
    exclude: items.filter(item => item.action === 'exclude').length,
    manualCheck: items.filter(item => item.action === 'manual_check').length
  };
  counts.copyTemplate = counts.copyOriginal;
  counts.skipCopy = counts.exclude;
  const pending = 0;
  return {
    folder,
    total: items.length,
    cached: items.length - pending,
    pending,
    ready: items.length > 0 && pending === 0,
    generationReady: items.length > 0 && pending === 0 && counts.manualCheck === 0,
    counts,
    preview: previewItem ? {
      name: previewItem.name,
      relativePath: previewItem.relativePath,
      thumbnailUrl: previewItem.thumbnailUrl,
      previewUrl: previewItem.previewUrl,
      url: previewItem.url
    } : null,
    ...extra
  };
}

async function getTemplatePreparation(folderValue) {
  const folder = String(folderValue || '');
  const { items } = await collectTemplateItems(folder);
  return summarizeTemplatePreparation(folder, items);
}

async function prepareTemplateFolder(folderValue) {
  const folder = String(folderValue || '');
  if (!folder || !fs.existsSync(folder)) throw new Error('套图文件夹不存在');
  const { jobs } = await collectTemplateItems(folder);
  if (!jobs.length) return summarizeTemplatePreparation(folder, [], { analyzed: 0, reused: 0, failed: 0 });
  const { items } = await collectTemplateItems(folder);
  return summarizeTemplatePreparation(folder, items, {
    analyzed: 0,
    reused: jobs.length,
    failed: 0,
    failures: []
  });
}

async function saveTemplateRegions(payload) {
  const folder = String(payload?.folder || '');
  const jobs = await buildTemplateJobs(folder);
  const byRelative = new Map(jobs.map(job => [templateRelativeKey(job.relativePath), job]));
  for (const item of payload?.items || []) {
    const job = byRelative.get(templateRelativeKey(item.relativePath));
    if (!job) throw new Error(`模板不存在：${item.relativePath}`);
    const regions = Array.isArray(item.regions) ? item.regions : [];
    const protectedRegions = Array.isArray(item.protectedRegions) ? item.protectedRegions : [];
    const requestedAction = normalizeTemplateProcessingMode(item.action);
    const action = regions.length ? 'replace_print' : requestedAction === 'exclude' ? 'exclude' : 'copy_original';
    const analysis = createManualTemplateAnalysis({
      action,
      reason: regions.length ? '运营人工框选柜体区域' : action === 'exclude' ? '运营人工排除' : '未框选区域，按原图复制',
      replaceArea: regions.length ? '人工粗框内由 Image2 判断的可见柜门或抽屉正面' : '无',
      forbiddenArea: '粗框外全部区域，以及框内背景、人物、文字、边框、门缝、柜脚、内侧和道具；青框内把手、旋钮、锁具和五金必须原样保留',
      regions,
      protectedRegions
    });
    const cache = templateCachePaths(folder, job.relativePath);
    await writeTemplateAnalysisCache({
      cacheFile: cache.analysisFile,
      templateRoot: folder,
      templateImagePath: job.templatePath,
      relativeTemplatePath: job.relativePath,
      analysis: JSON.stringify(analysis),
      manualOverride: true
    });
  }
  return listTemplates(folder);
}

async function loadManualTemplateConfigForJob(job) {
  const current = await templateConfigurationForJob(job);
  // Generation reads only the saved operator decision and regions. It never
  // starts template analysis or waits for AI-generated coordinates.
  return current;
}

async function templateOutputSize(job) {
  const metadata = await sharp(job.templatePath, { failOn: 'none' }).metadata();
  const align = value => Math.max(16, Math.ceil(Math.max(1, Number(value) || 1) / 16) * 16);
  return `${align(metadata.width)}x${align(metadata.height)}`;
}


function parseImageCanvasSize(value) {
  const match = String(value || '').match(/^(\d+)x(\d+)$/i);
  if (!match) throw new Error('Unsupported image canvas size: ' + value);
  return { width: Math.max(1, Number(match[1])), height: Math.max(1, Number(match[2])) };
}

async function prepareTemplateGenerationCanvas(job, maskPath = '') {
  const size = await templateOutputSize(job);
  const canvas = parseImageCanvasSize(size);
  const metadata = await sharp(job.templatePath, { failOn: 'none' }).metadata();
  const sourceWidth = Math.max(1, Number(metadata.width) || 1);
  const sourceHeight = Math.max(1, Number(metadata.height) || 1);
  // Never enlarge a designer-prepared slice before sending it to the API.
  // Detail text therefore keeps its original pixel scale; only oversized
  // source files are reduced to fit the supported transport canvas.
  // Custom Image2 canvases preserve designer pixels at 1:1 scale. Dimensions
  // that are not divisible by 16 receive only a centered transport margin.
  const safeInsetX = 0;
  const safeInsetY = 0;
  const scale = Math.min(
    1,
    Math.max(1, canvas.width - safeInsetX * 2) / sourceWidth,
    Math.max(1, canvas.height - safeInsetY * 2) / sourceHeight
  );
  const contentWidth = Math.max(1, Math.min(canvas.width, Math.round(sourceWidth * scale)));
  const contentHeight = Math.max(1, Math.min(canvas.height, Math.round(sourceHeight * scale)));
  const left = Math.floor((canvas.width - contentWidth) / 2);
  const top = Math.floor((canvas.height - contentHeight) / 2);
  const templateStat = await fsp.stat(job.templatePath);
  const maskStat = maskPath && fs.existsSync(maskPath) ? await fsp.stat(maskPath) : null;
  const fingerprint = crypto.createHash('sha1').update(JSON.stringify({
    version: 2,
    templatePath: path.resolve(job.templatePath),
    templateSize: templateStat.size,
    templateMtimeMs: templateStat.mtimeMs,
    maskPath: maskPath ? path.resolve(maskPath) : '',
    maskSize: maskStat?.size || 0,
    maskMtimeMs: maskStat?.mtimeMs || 0,
    size,
    sourceWidth,
    sourceHeight,
    contentWidth,
    contentHeight,
    left,
    top
  })).digest('hex').slice(0, 16);
  const cache = templateCachePaths(job.templateRoot || path.dirname(job.templatePath), job.relativePath || path.basename(job.templatePath));
  const transportFolder = path.join(cache.cacheFolder, 'generation-canvas');
  const templatePath = path.join(transportFolder, fingerprint + '.template.png');
  const preparedMaskPath = path.join(transportFolder, fingerprint + '.mask.png');
  await fsp.mkdir(transportFolder, { recursive: true });
  if (!fs.existsSync(templatePath)) {
    const input = await sharp(job.templatePath, { failOn: 'none' })
      .rotate()
      .resize({ width: contentWidth, height: contentHeight, fit: 'fill' })
      .png()
      .toBuffer();
    await sharp({ create: { width: canvas.width, height: canvas.height, channels: 4, background: { r: 245, g: 241, b: 233, alpha: 1 } } })
      .composite([{ input, left, top }])
      .png()
      .toFile(templatePath);
  }
  if (!fs.existsSync(preparedMaskPath)) {
    if (maskStat) {
      await sharp(maskPath, { failOn: 'none' })
        .resize({ width: contentWidth, height: contentHeight, fit: 'fill' })
        .extend({
          left,
          right: canvas.width - contentWidth - left,
          top,
          bottom: canvas.height - contentHeight - top,
          background: { r: 255, g: 255, b: 255, alpha: 1 }
        })
        .png()
        .toFile(preparedMaskPath);
    } else {
      const registrationMask = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}" viewBox="0 0 ${canvas.width} ${canvas.height}"><defs><mask id="content-cutout"><rect width="100%" height="100%" fill="#ffffff"/><rect x="${left}" y="${top}" width="${contentWidth}" height="${contentHeight}" fill="#000000"/></mask></defs><rect width="100%" height="100%" fill="#ffffff" mask="url(#content-cutout)"/></svg>`;
      await sharp(Buffer.from(registrationMask)).png().toFile(preparedMaskPath);
    }
  }
  return {
    size,
    templatePath,
    maskPath: preparedMaskPath,
    sourceWidth,
    sourceHeight,
    canvasWidth: canvas.width,
    canvasHeight: canvas.height,
    contentWidth,
    contentHeight,
    left,
    top
  };
}

async function restoreTemplateGenerationCanvas(bytes, plan) {
  const billingAmountMinor = Math.max(0, Number(bytes?.billingAmountMinor) || 0);
  // Keep normalization and extraction in separate Sharp pipelines. Sharp may
  // otherwise reorder an extract around resize and reject valid crop bounds.
  const normalized = await sharp(bytes, { failOn: 'none' })
    .resize({ width: plan.canvasWidth, height: plan.canvasHeight, fit: 'fill' })
    .png()
    .toBuffer();
  const restored = await sharp(normalized, { failOn: 'none' })
    .extract({ left: plan.left, top: plan.top, width: plan.contentWidth, height: plan.contentHeight })
    .resize({ width: plan.sourceWidth, height: plan.sourceHeight, fit: 'fill' })
    .png()
    .toBuffer();
  restored.billingAmountMinor = billingAmountMinor;
  return restored;
}

async function replaceOutputFile(outputPath, writeNext) {
  await fsp.mkdir(path.dirname(outputPath), { recursive: true });
  const extension = path.extname(outputPath);
  const stem = path.basename(outputPath, extension);
  const nonce = crypto.randomUUID();
  const nextPath = path.join(path.dirname(outputPath), `.${stem}.caishen-next-${nonce}${extension}`);
  const backupPath = path.join(path.dirname(outputPath), `.${stem}.caishen-old-${nonce}.bak`);
  let backedUp = false;
  try {
    await writeNext(nextPath);
    if (fs.existsSync(outputPath)) {
      await fsp.rename(outputPath, backupPath);
      backedUp = true;
    }
    await fsp.rename(nextPath, outputPath);
    if (backedUp) {
      backedUp = false;
      await fsp.rm(backupPath, { force: true }).catch(() => {});
    }
  } catch (error) {
    await fsp.rm(nextPath, { force: true }).catch(() => {});
    if (backedUp && !fs.existsSync(outputPath)) {
      await fsp.rename(backupPath, outputPath);
      backedUp = false;
    }
    throw error;
  } finally {
    if (!backedUp) await fsp.rm(backupPath, { force: true }).catch(() => {});
  }
}

async function writeTemplateSizedImage(job, bytes, trimPixels = null) {
  const metadata = await sharp(job.templatePath).metadata();
  const width = Number(metadata.width || 0);
  const height = Number(metadata.height || 0);
  const trimTop = Math.max(0, Number(trimPixels?.top || 0) | 0);
  const trimBottom = Math.max(0, Number(trimPixels?.bottom || 0) | 0);
  let image = sharp(bytes);
  if (width && height) {
    image = image.resize({
      width,
      height,
      // Generation results are restored from a transport canvas before this
      // final write. This is normally a no-op and must never crop/zoom the page.
      fit: 'fill',
      withoutEnlargement: false
    });
  }
  if (trimTop || trimBottom) {
    const trimmedHeight = Math.max(1, height - trimTop - trimBottom);
    image = image.extract({ left: 0, top: trimTop, width, height: trimmedHeight });
  }
  const extension = path.extname(job.outputPath).toLowerCase();
  if (extension === '.jpg' || extension === '.jpeg') image = image.jpeg({ quality: 94 });
  else image = image.png();
  await replaceOutputFile(job.outputPath, nextPath => image.toFile(nextPath));
}

async function readSourceMetadata(folder) {
  const paths = metadataPaths(folder);
  const value = await readJsonFile(paths.wpfSource, null) || await readJsonFile(paths.macSource, {});
  return normalizeSourceMetadata(value);
}

async function writeTemplateAudit(job, value) {
  await writeJsonFile(metadataPaths(job.outputRoot, job.relativePath).templateAudit, value);
}

async function generateTemplateJob(job, source, config, options = {}) {
  if (source.generationMode !== 'template_print') throw new Error('只支持人工框选套图生成流程');
  const { configuration, cache } = await loadManualTemplateConfigForJob(job);
  const action = normalizeTemplateProcessingMode(resolveGenerationAction(configuration));
  const paths = metadataPaths(job.outputRoot, job.relativePath);
  await fsp.rm(paths.manualReview, { force: true }).catch(() => {});
  if (action === 'manual_check') {
    await writeTemplateAudit(job, { passed: false, reason: '尚未保存人工处理方式，未自动生成。', retry_instruction: '请人工框选需要换印花的柜体，或明确选择保留原图/不输出。', action });
    await fsp.mkdir(path.dirname(paths.manualReview), { recursive: true });
    await fsp.writeFile(paths.manualReview, configuration, 'utf8');
    throw new Error(`需要人工确认：${job.relativePath}`);
  }
  if (action === 'exclude') {
    await writeTemplateAudit(job, { passed: true, reason: '已由运营明确排除，不进入成品输出。', retry_instruction: '', action });
    return { action, outputPath: '' };
  }
  if (action === 'copy_original') {
    await replaceOutputFile(job.outputPath, nextPath => fsp.copyFile(job.templatePath, nextPath));
    await writeTemplateAudit(job, { passed: true, reason: '保留原图：逐字节复制套图源文件，不调用生图 API。', retry_instruction: '', action });
    return { action, outputPath: job.outputPath };
  }
  if (action === 'skip_copy') {
    await writeTemplateAudit(job, { passed: true, reason: '已按模板配置跳过，不自动生成。', retry_instruction: '', action });
    return { action, outputPath: '' };
  }
  if (action === 'copy_template') {
    await replaceOutputFile(job.outputPath, nextPath => fsp.copyFile(job.templatePath, nextPath));
    await writeTemplateAudit(job, { passed: true, reason: '模板换印花直接复制：copy_template', retry_instruction: '', action });
    return { action, outputPath: job.outputPath };
  }

  if (!source.printPath || !fs.existsSync(source.printPath)) throw new Error('原始印花图不存在');
  if (!source.masterImagePath || !fs.existsSync(source.masterImagePath)) throw new Error('请先生成当前任务的母版图');
  let prompt = TEMPLATE_PRINT_PROMPT({
    relativeTemplatePath: job.relativePath,
    templateImagePath: job.relativePath
  });
  let imagePaths = [job.templatePath, source.masterImagePath, source.printPath];
  if (options.extraInstruction) prompt += `\n\n本次运营补充要求：${String(options.extraInstruction).trim()}`;
  const summary = parseTemplateAnalysisSummary(configuration);
  const regions = Array.isArray(summary.regions) ? summary.regions : [];
  if (!regions.length) throw new Error(`未框选需要换印花的柜体区域：${job.relativePath}`);
  const maskPath = await createTemplateEditMask(job, configuration);
  if (!maskPath) throw new Error(`框选区域无法形成有效保护范围，请人工复核：${job.relativePath}`);
  const generationCanvas = await prepareTemplateGenerationCanvas(job, maskPath);
  imagePaths[0] = generationCanvas.templatePath;
  const annotationPath = await createTemplateRegionAnnotation(job, configuration, generationCanvas);
  imagePaths = imagePaths.slice(0, 3);
  imagePaths.push(annotationPath);
  const requestImageContract = 'The request contains exactly four images in this fixed order: locked template canvas, print master reference, original print artwork, and ROI annotation. Never swap, omit, duplicate or reinterpret their roles.';
  prompt += `\n\nCURRENT_REQUEST_EXECUTION_CONTRACT\n${requestImageContract} Use image 1 as the locked output canvas. Use image 2 to understand the complete print placement on this cabinet and image 3 as the original artwork source. In image 4, red boxes mark approximate printable cabinet search areas and cyan boxes mark handles, knobs, locks or metal hardware that must remain identical to image 1. The colored boxes are guidance only, are not paste rectangles and must not appear in the output. Apply the complete registered print only to visible cabinet-door or drawer exterior-front surface pixels inside red areas. Never print inside cyan areas. Preserve the original canvas, crop, layout, text, labels, background, people, props, foreground occluders, cabinet frame, seams, handles, knobs, locks, hardware, legs, sides, drawer interiors and lighting. For partial cabinet views, transfer only the matching master-image fragment. Never paste a flat rectangle, redraw the page, change cabinet geometry, zoom, crop, pad or outpaint. Output one finished image at the same composition and dimensions as image 1.\n\n${openDrawerRegisteredPrintPrompt()}`;
  if (options.includePreviousResult && fs.existsSync(job.outputPath)) {
    imagePaths.push(job.outputPath);
    prompt += `\n\nImage ${imagePaths.length} is the current rejected result. Use it only to identify what should be corrected. Do not copy its defects, altered layout, geometry, text, background or artifacts.`;
  }
  if (options.referenceResultPath && fs.existsSync(options.referenceResultPath)) {
    imagePaths.push(options.referenceResultPath);
    prompt += `\n\nImage ${imagePaths.length} is an operator-selected generated reference. Use it only as a positive reference for print placement, cabinet-front continuity, preserved frame, seams, sides and legs. Do not copy its composition, dimensions, scene, text or pixels. Image 1 remains the locked output canvas.`;
  }
  const isRegeneration = Boolean(options.isRegeneration || options.extraInstruction);
  let bytes = await generateImage(prompt, imagePaths, {
    size: generationCanvas.size,
    quality: config.imageQuality || 'high',
    bulkGeneration: options.bulkGeneration === true,
    billingDescription: isRegeneration ? '套图图片重新生成' : '套图换印花生图',
    billingReference: job.relativePath,
    billingOnceKey: isRegeneration
      ? billingOnceKey('image:template-job-regenerate', job.outputRoot, job.relativePath, Date.now(), crypto.randomUUID())
      : billingOnceKey('image:template-job', job.outputRoot, job.relativePath, Date.now(), crypto.randomUUID()),
    signal: options.signal,
    onRequestState: options.onRequestState
  });
  const billedMinor = Math.max(0, Number(bytes.billingAmountMinor) || 0);
  bytes = await restoreTemplateGenerationCanvas(bytes, generationCanvas);
  const strictLayoutCheck = isDetailSliceTemplate(job, configuration);
  if (strictLayoutCheck) {
    const check = await validateTemplateOutputLayout(job, bytes, configuration);
    if (!check.passed) {
      await writeTemplateAudit(job, { passed: false, reason: `生成结果不满足固定版式约束：${check.reason}`, retry_instruction: '请重新生图；不要改版式和边界裁切。', action });
      throw new Error(check.reason);
    }
  }
  await writeTemplateSizedImage(job, bytes, job.trimPixels);
  await fsp.rm(paths.templateAudit, { force: true }).catch(() => {});
  return { action, outputPath: job.outputPath, billedMinor };
}

async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      try { results[index] = { ok: true, value: await worker(items[index], index) }; }
      catch (error) { results[index] = { ok: false, error }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), Math.max(1, items.length)) }, run));
  return results;
}

async function generateTemplateSetForFolder(folder, onlyMissing = true, relativePaths = null, options = {}) {
  const source = await readSourceMetadata(folder);
  if (source.generationMode !== 'template_print') throw new Error('只支持人工框选套图生成流程');
  if (!source.templateFolderPath || !fs.existsSync(source.templateFolderPath)) throw new Error('任务缺少套图文件夹');
  const config = await loadConfig();
  let jobs = await buildTemplateJobs(source.templateFolderPath, folder);
  const selectedPaths = relativePaths?.length ? relativePaths : source.templateRelativePaths;
  if (selectedPaths?.length) {
    const wanted = new Set(selectedPaths.map(value => String(value).replaceAll('\\', '/').toLocaleLowerCase('zh-CN')));
    jobs = jobs.filter(job => wanted.has(job.relativePath.replaceAll('\\', '/').toLocaleLowerCase('zh-CN')));
    if (!jobs.length) throw new Error('选中的套图图片不存在或已被移除。');
  }
  if (onlyMissing) jobs = jobs.filter(job => !fs.existsSync(job.outputPath));
  let progressWrite = Promise.resolve();
  const lastProgressByPhase = new Map();
  const generationStartedAt = new Date();
  const generationStartedAtIso = generationStartedAt.toISOString();
  const publishProgress = progress => {
    const phase = progress.phase || 'generating';
    const requestedCurrent = Math.max(0, Number(progress.current) || 0);
    const monotonicCurrent = Math.max(requestedCurrent, lastProgressByPhase.get(phase) || 0);
    lastProgressByPhase.set(phase, monotonicCurrent);
    const completedAt = progress.completedAt || (['completed', 'completed_with_errors', 'failed'].includes(phase) ? new Date().toISOString() : '');
    const elapsedMs = completedAt
      ? Math.max(0, new Date(completedAt).getTime() - generationStartedAt.getTime())
      : Math.max(0, Number(progress.elapsedMs) || 0);
    const next = {
      folder,
      phase,
      current: monotonicCurrent,
      total: Math.max(0, Number(progress.total) || jobs.length),
      percent: Math.max(0, Math.min(100, Number(progress.percent) || 0)),
      apiGenerated: Math.max(0, Number(progress.apiGenerated) || 0),
      copied: Math.max(0, Number(progress.copied) || 0),
      excluded: Math.max(0, Number(progress.excluded) || 0),
      skipped: Math.max(0, Number(progress.skipped) || 0),
      failed: Math.max(0, Number(progress.failed) || 0),
      waitingUpstream: Math.max(0, Number(progress.waitingUpstream) || 0),
      pending: Math.max(0, Number(progress.pending) || 0),
      billingCostMinor: Math.max(0, Number(progress.billingCostMinor) || 0),
      message: String(progress.message || ''),
      startedAt: String(progress.startedAt || generationStartedAtIso),
      completedAt,
      elapsedMs,
      updatedAt: new Date().toISOString()
    };
    progressWrite = progressWrite.then(async () => {
      await writeJsonFile(metadataPaths(folder).generationProgress, next);
      if (typeof options.reportProgress === 'function') await options.reportProgress(next);
    });
    return progressWrite;
  };
  if (!jobs.length) {
    if (!onlyMissing && !selectedPaths?.length) throw new Error('套图文件夹里没有可用图片。');
    const summary = { total: 0, current: 0, percent: 100, apiGenerated: 0, copied: 0, excluded: Math.max(0, Number(options.excludedCount) || 0), skipped: 0, failed: 0, waitingUpstream: 0, pending: 0, billingCostMinor: 0 };
    await publishProgress({ ...summary, phase: 'completed', message: '没有需要处理的图片' });
    return { folder, generated: 0, failures: [], summary };
  }
  if (options.signal?.aborted) throw new Error('任务已取消');
  const startLabel = options.initial ? '开始生成套图' : onlyMissing ? '开始补生成缺失套图' : '开始重新生成整套图';
  await addOperationLog(folder, `${startLabel}：${jobs.length} 张`);
  const live = { total: jobs.length, current: 0, apiGenerated: 0, copied: 0, excluded: Math.max(0, Number(options.excludedCount) || 0), skipped: 0, failed: 0, waitingUpstream: 0, billingCostMinor: 0 };
  const liveFailures = [];
  const isRegeneration = !onlyMissing && !options.initial;
  await publishProgress({ ...live, pending: jobs.length, phase: 'preparing', message: `准备处理 ${jobs.length} 张图片` });
  const waitingUpstream = new Set();
  let imageEventWrite = Promise.resolve();
  const recordImageRequestState = (job, event) => {
    if (event.state === 'retrying') waitingUpstream.add(job.relativePath);
    else if (['running', 'succeeded', 'failed'].includes(event.state)) waitingUpstream.delete(job.relativePath);
    live.waitingUpstream = waitingUpstream.size;
    const diagnostic = {
      at: new Date().toISOString(),
      relativePath: job.relativePath,
      attempt: Number(event.attempt) || 0,
      state: String(event.state || ''),
      status: Number(event.status) || undefined,
      error: event.error ? String(event.error).slice(0, 500) : undefined,
      currentConcurrency: Number(event.currentConcurrency) || 0,
      maxConcurrency: Number(event.maxConcurrency) || 0,
      active: Number(event.active) || 0,
      queued: Number(event.queued) || 0,
      originalBytes: Number(event.originalBytes) || 0,
      preparedBytes: Number(event.preparedBytes) || 0,
      apiElapsedMs: Number(event.apiElapsedMs) || 0,
      downloadElapsedMs: Number(event.downloadElapsedMs) || 0
    };
    imageEventWrite = imageEventWrite.then(async () => {
      const eventFile = metadataPaths(folder).imageApiEvents;
      await fsp.mkdir(path.dirname(eventFile), { recursive: true });
      await fsp.appendFile(eventFile, `${JSON.stringify(diagnostic)}\n`, 'utf8');
    });
    void publishProgress({
      ...live,
      phase: 'generating',
      pending: Math.max(0, live.total - live.current),
      percent: live.total ? Math.round(live.current / live.total * 100) : 0,
      message: live.waitingUpstream
        ? `生图接口等待重试 ${live.waitingUpstream} 张，已完成 ${live.current}/${live.total}`
        : `正在处理 ${live.current}/${live.total}`
    }).catch(() => {});
  };
  const results = await runWithConcurrency(jobs, apiConcurrencyLimit(jobs.length), async job => {
    try {
      if (options.signal?.aborted) throw new Error('任务已停止');
      const result = await generateTemplateJob(job, source, config, {
        extraInstruction: options.extraInstruction,
        isRegeneration,
        bulkGeneration: true,
        signal: options.signal,
        onRequestState: event => recordImageRequestState(job, event)
      });
      if (result.action === 'exclude' || result.action === 'skip_copy') live.skipped += 1;
      else if (result.action === 'copy_original' || result.action === 'copy_template') live.copied += 1;
      else live.apiGenerated += 1;
      live.billingCostMinor += Math.max(0, Number(result.billedMinor) || 0);
      return result;
    } catch (error) {
      live.billingCostMinor += Math.max(0, Number(error?.billingAmountMinor) || 0);
      live.failed += 1;
      liveFailures.push(`${job.relativePath}: ${error?.message || error}`);
      await writeJsonFile(metadataPaths(folder).generationErrors, {
        updated_at: new Date().toISOString(),
        count: liveFailures.length,
        failures: liveFailures.slice()
      });
      throw error;
    } finally {
      live.current += 1;
      await publishProgress({
        ...live,
        phase: 'generating',
        pending: Math.max(0, live.total - live.current),
        percent: Math.round(live.current / live.total * 100),
        message: `正在处理 ${live.current}/${live.total}：API 生成 ${live.apiGenerated}，直接复制 ${live.copied}，跳过 ${live.skipped}`
      });
    }
  });
  await imageEventWrite;
  const failures = results.map((result, index) => result.ok ? null : `${jobs[index].relativePath}: ${result.error?.message || result.error}`).filter(Boolean);
  const rejected = 0;
  if (failures.length) {
    await writeJsonFile(metadataPaths(folder).generationErrors, { updated_at: new Date().toISOString(), count: failures.length, failures });
    await addOperationLog(folder, `套图生成完成，但有 ${failures.length} 张失败：${failures.slice(0, 3).join('；')}`);
  } else {
    await fsp.rm(metadataPaths(folder).generationErrors, { force: true }).catch(() => {});
    const breakdown = `API 生成 ${live.apiGenerated} 张，直接复制 ${live.copied} 张，跳过 ${live.skipped} 张`;
    await addOperationLog(folder, `套图处理完成：${breakdown}，待人工确认`);
  }
  const summary = {
    total: live.total,
    current: live.current,
    percent: 100,
    apiGenerated: live.apiGenerated,
    copied: live.copied,
    excluded: live.excluded,
    skipped: live.skipped,
    failed: live.failed,
    waitingUpstream: 0,
    pending: 0,
    billingCostMinor: live.billingCostMinor
  };
  await publishProgress({
    ...summary,
    phase: failures.length ? 'completed_with_errors' : 'completed',
    message: failures.length
      ? `处理完成，${failures.length} 张失败`
      : `处理完成：API 生成 ${summary.apiGenerated}，直接复制 ${summary.copied}，跳过 ${summary.skipped}`
  });
  return { folder, generated: jobs.length - failures.length, failures, rejected, summary };
}

async function regenerateSingleTemplateUnlocked(payload, options = {}) {
  const folder = String(payload?.folder || '');
  const source = await readSourceMetadata(folder);
  if (source.generationMode !== 'template_print') throw new Error('只支持人工框选套图生成流程');
  const job = await findReviewJob(folder, payload?.relativePath);
  const config = await loadConfig();
  const extraInstruction = String(payload?.extraInstruction || '').trim();
  const referenceResultPath = await resolveReviewReferenceResultPath(folder, payload?.referenceResultRelativePath || '');
  const progressFile = metadataPaths(folder).generationProgress;
  const activeProgress = await readJsonFile(progressFile, {});
  const activePhase = String(activeProgress?.phase || '');
  const progressAgeMs = Date.now() - new Date(activeProgress?.updatedAt || 0).getTime();
  if (['queued', 'preparing', 'analyzing', 'generating', 'auditing', 'running'].includes(activePhase)
      && !activeProgress?.activeRelativePath
      && Number.isFinite(progressAgeMs)
      && progressAgeMs < 20 * 60 * 1000) {
    throw new Error('当前整套任务仍在生成，请等待整套完成后再重新生成单张图片。');
  }
  const startedAt = new Date().toISOString();
  const publishSingleProgress = async update => {
    const existing = await readJsonFile(progressFile, {});
    const total = Math.max(1, Number(existing?.total) || Number(source.templateRelativePaths?.length) || 1);
    const current = Math.max(0, Number(existing?.current) || total);
    const next = {
      ...(existing && typeof existing === 'object' ? existing : {}),
      folder,
      total,
      current,
      percent: Math.max(0, Math.min(100, Number(existing?.percent) || (total ? Math.round(current / total * 100) : 0))),
      apiGenerated: Math.max(0, Number(existing?.apiGenerated) || 0),
      copied: Math.max(0, Number(existing?.copied) || 0),
      skipped: Math.max(0, Number(existing?.skipped) || 0),
      failed: Math.max(0, Number(existing?.failed) || 0),
      billingCostMinor: Math.max(0, Number(existing?.billingCostMinor) || 0),
      ...(update || {}),
      message: String(update?.message || `正在重新生成图片：${job.relativePath}`),
      activeRelativePath: job.relativePath,
      startedAt: existing?.startedAt || startedAt,
      completedAt: ['queued', 'preparing', 'analyzing', 'generating', 'auditing', 'running'].includes(String(update?.phase || ''))
        ? ''
        : String(update?.completedAt || existing?.completedAt || ''),
      updatedAt: new Date().toISOString()
    };
    await writeJsonFile(progressFile, next);
    if (typeof options.reportProgress === 'function') await options.reportProgress(next);
    return next;
  };
  await addOperationLog(folder, `开始重新生成单张：${job.relativePath}${extraInstruction ? '（含修正要求）' : ''}`);
  await publishSingleProgress({
    phase: 'generating',
    pending: 1,
    message: `正在重新生成：${job.relativePath}`
  });
  let generated;
  try {
    generated = await generateTemplateJob(job, source, config, {
      extraInstruction,
      isRegeneration: true,
      includePreviousResult: Boolean(payload?.includePreviousResult),
      referenceResultPath,
      signal: options.signal,
      onRequestState: event => {
        void publishSingleProgress({
          phase: 'generating',
          pending: 1,
          waitingUpstream: event?.state === 'retrying' ? 1 : 0,
          message: event?.state === 'retrying'
            ? `生图接口等待重试：${job.relativePath}`
            : `正在重新生成：${job.relativePath}`
        }).catch(() => {});
      }
    });
  } catch (error) {
    const stopped = Boolean(options.signal?.aborted);
    const failedBilledMinor = Math.max(0, Number(error?.billingAmountMinor) || 0);
    const failedProgress = failedBilledMinor > 0 ? await readJsonFile(progressFile, {}) : null;
    await addOperationLog(folder, stopped ? `已停止重新生成：${job.relativePath}` : `重新生成失败：${job.relativePath}`);
    await publishSingleProgress({
      phase: 'failed',
      pending: 0,
      waitingUpstream: 0,
      billingCostMinor: Math.max(0, Number(failedProgress?.billingCostMinor) || 0) + failedBilledMinor,
      message: stopped ? `已停止重新生成：${job.relativePath}` : `重新生成失败：${job.relativePath}`,
      completedAt: new Date().toISOString()
    });
    throw error;
  }
  const generationErrorsFile = metadataPaths(folder).generationErrors;
  const generationErrors = await readJsonFile(generationErrorsFile, {});
  const failurePrefix = `${job.relativePath}:`;
  const remainingFailures = (Array.isArray(generationErrors?.failures) ? generationErrors.failures : [])
    .map(String)
    .filter(message => !message.startsWith(failurePrefix));
  if (remainingFailures.length) {
    await writeJsonFile(generationErrorsFile, { ...generationErrors, updated_at: new Date().toISOString(), count: remainingFailures.length, failures: remainingFailures });
  } else await fsp.rm(generationErrorsFile, { force: true }).catch(() => {});
  const billedMinor = Math.max(0, Number(generated.billedMinor) || 0);
  if (billedMinor > 0) {
    const progress = await readJsonFile(progressFile, {});
    await writeJsonFile(progressFile, {
      ...(progress && typeof progress === 'object' ? progress : {}),
      billingCostMinor: Math.max(0, Number(progress?.billingCostMinor) || 0) + billedMinor,
      updatedAt: new Date().toISOString()
    });
  }
  await addOperationLog(folder, `重新生成完成：${job.relativePath}`);
  await publishSingleProgress({
    phase: 'completed',
    pending: 0,
    waitingUpstream: 0,
    message: `重新生成完成：${job.relativePath}`,
    completedAt: new Date().toISOString()
  });
  return { folder, relativePath: job.relativePath, outputPath: job.outputPath };
}

async function regenerateSingleTemplate(payload, options = {}) {
  const folder = String(payload?.folder || '');
  return queueTemplateRegeneration(folder, options.signal, () => regenerateSingleTemplateUnlocked(payload, options));
}

async function generateDirectTemplateTask(task, options = {}) {
  if (!task?.printPath || !fs.existsSync(task.printPath)) throw new Error('印花图不存在');
  if (!task?.templateFolderPath || !fs.existsSync(task.templateFolderPath)) throw new Error('套图文件夹不存在');
  if (!task?.masterImagePath || !fs.existsSync(task.masterImagePath)) throw new Error('请先生成当前任务的母版图');
  const requestedPaths = Array.isArray(task.templateRelativePaths)
    ? task.templateRelativePaths
    : task.templateRelativePath ? [task.templateRelativePath] : null;
  const plan = await planTemplateOutputJobs(task.templateFolderPath, requestedPaths);
  const plannedTask = { ...task, templateRelativePaths: plan.relativePaths };
  const config = await loadConfig();
  if (typeof options.reportProgress === 'function') {
    await options.reportProgress({ phase: 'preparing', current: 0, total: 0, percent: 0, message: '正在创建任务目录…' });
  }
  const folder = await nextTaskFolder(config);
  await fsp.mkdir(folder, { recursive: true });
  await writeTaskSource(folder, plannedTask, 'template_print');
  const result = await generateTemplateSetForFolder(folder, false, null, {
    ...options,
    initial: true,
    excludedCount: plan.excludedRelativePaths.length
  });
  if (result.failures.length) throw new Error(`有 ${result.failures.length} 张失败：${result.failures[0]}`);
  return { folder, outputPath: folder, url: '', summary: result.summary };
}

async function generateTemplateTaskMaster(task = {}, options = {}) {
  if (!task?.printPath || !fs.existsSync(task.printPath)) throw new Error('印花图不存在');
  let referencePath = task.masterReferencePath || task.productPath || task.templateImagePath || '';
  if ((!referencePath || !fs.existsSync(referencePath)) && task.templateFolderPath && task.masterReferenceRelativePath) {
    const fallback = resolveTemplateFile(task.templateFolderPath, task.masterReferenceRelativePath);
    if (fs.existsSync(fallback)) referencePath = fallback;
  }
  if (!referencePath || !fs.existsSync(referencePath)) throw new Error('请先选择母版参考图');
  const config = await loadConfig();
  if (typeof options.reportProgress === 'function') {
    await options.reportProgress({ phase: 'generating', current: 0, total: 1, percent: 10, message: '正在生成母版图…' });
  }
  let prompt = TEMPLATE_MASTER_PROMPT.trim();
  prompt = `${prompt || '根据第一张产品参考图和第二张印花图生成标准电商母版图。'}\n\nCURRENT_MASTER_REQUEST_CONTRACT\nThe request contains exactly two images in this fixed order: image 1 is the cabinet product reference and image 2 is the original print artwork. Never swap their roles. Image 1 may contain a living room, bedroom, furniture, curtains, floor, wall, plants, lamps, speakers, props, people, text or labels. Preserve only the same complete cabinet structure from image 1, remove every environmental element, apply image 2 only to the cabinet's printable exterior fronts with physical perspective and continuous registration, and output a centered complete cabinet on a uniform pure white RGB(255,255,255) background with only a subtle natural grounding shadow. Never preserve, recreate or extend the source scene. This contract overrides any conflicting optional instruction.`;
  const bytes = await generateImage(prompt, [referencePath, task.printPath], {
    size: config.imageSize || '1024x1024',
    quality: config.imageQuality || 'high',
    billingDescription: '套图母版生成',
    billingReference: task.id || path.basename(referencePath),
    signal: options.signal,
    onRequestState: options.onRequestState
  });
  const masterRoot = path.join(currentWorkspaceRoot(), 'masters', localFileTimestamp());
  await fsp.mkdir(masterRoot, { recursive: true });
  const outputPath = path.join(masterRoot, `${safeFileName(task.id || task.printName || 'template-master')}.png`);
  await fsp.writeFile(outputPath, bytes);
  const result = {
    outputPath,
    url: imageUrl(outputPath),
    referencePath,
    referenceName: path.basename(referencePath),
    billingCostMinor: Math.max(0, Number(bytes.billingAmountMinor) || 0)
  };
  if (typeof options.reportProgress === 'function') {
    await options.reportProgress({ phase: 'completed', current: 1, total: 1, percent: 100, message: '母版图生成完成', billingCostMinor: result.billingCostMinor });
  }
  return result;
}

async function generateTask(task, options = {}) {
  if (task?.generationMode !== 'template_print') throw new Error('只支持人工框选套图生成流程');
  if (typeof options.reportProgress === 'function') {
    await options.reportProgress({ phase: 'queued', current: 0, total: 0, percent: 0, message: '已进入套图处理队列' });
  }
  return generateDirectTemplateTask(task, options);
}

async function reviewFolders() {
  const config = await loadConfig();
  const outputRoot = config.outputPath || defaultConfig().outputPath;
  const entries = await fsp.readdir(outputRoot, { withFileTypes: true }).catch(() => []);
  const folders = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const folder = path.join(outputRoot, entry.name);
    const images = await scanImages(folder, '', 80);
    const source = await readSourceMetadata(folder);
    const paths = metadataPaths(folder);
    const review = normalizeReviewMetadata(await readJsonFile(paths.macReview, {}));
    const legacyReviewImages = new Map(review.images.map(image => [String(image.relativePath || '').replaceAll('\\', '/').toLocaleLowerCase('zh-CN'), image]));
    const jobs = [];
    if (source.templateFolderPath && fs.existsSync(source.templateFolderPath)) {
      const selectedPaths = new Set((source.templateRelativePaths || []).map(value => String(value).replaceAll('\\', '/').toLocaleLowerCase('zh-CN')));
      const templateJobs = (await buildTemplateJobs(source.templateFolderPath, folder))
        .filter(job => !selectedPaths.size || selectedPaths.has(job.relativePath.replaceAll('\\', '/').toLocaleLowerCase('zh-CN')));
      for (const job of templateJobs) {
        const jobPaths = metadataPaths(folder, job.relativePath);
        let manualReview = await readJsonFile(jobPaths.manualReview, {});
        let audit = await readJsonFile(jobPaths.templateAudit, {});
        const legacyImage = legacyReviewImages.get(job.relativePath.replaceAll('\\', '/').toLocaleLowerCase('zh-CN'));
        if (!Object.keys(manualReview || {}).length && legacyImage?.manualStatus) manualReview = { status: legacyImage.manualStatus, updatedAt: legacyImage.reviewedAt };
        if (!Object.keys(audit || {}).length && legacyImage?.auditStatus) audit = { status: legacyImage.auditStatus };
        const { summary } = await templateConfigurationForJob(job);
        const record = {
          relativePath: job.relativePath,
          templateImagePath: job.templatePath,
          outputPath: job.outputPath,
          outputExists: fs.existsSync(job.outputPath),
          manualReview,
          audit,
          generationAction: summary.action
        };
        const rawStatus = deriveImageStatus(record, config.auditMode);
        const status = rawStatus === '人工通过' ? '已通过'
          : rawStatus === '人工不通过' || rawStatus === '审核不通过' ? 'AI不通过'
            : rawStatus === '直接套模板-自动通过' ? '直接套模板'
              : rawStatus;
        const templateStat = await fsp.stat(job.templatePath).catch(() => null);
        const templateModifiedAt = templateStat?.mtimeMs || 0;
        const templateVersion = templateStat ? `${Math.trunc(templateStat.mtimeMs)}-${templateStat.size}` : String(templateModifiedAt || 0);
        const outputModifiedAt = record.outputExists ? (await fsp.stat(job.outputPath).catch(() => null))?.mtimeMs || 0 : 0;
        jobs.push({
          ...record,
          status,
          action: summary.action,
          templateUrl: `${imageUrl(job.templatePath)}?v=${encodeURIComponent(templateModifiedAt)}`,
          templateThumbnailUrl: thumbnailUrl(job.templatePath, 480, templateVersion),
          templatePreviewUrl: thumbnailUrl(job.templatePath, 1200, templateVersion),
          outputUrl: record.outputExists ? `${imageUrl(job.outputPath)}?v=${encodeURIComponent(outputModifiedAt)}` : '',
          outputModifiedAt
        });
      }
    }
    if (!images.length && !jobs.length) continue;
    const stat = await fsp.stat(folder);
    const masterImage = images.find(image => path.basename(image.path, path.extname(image.path)) === '母版图') || null;
    const generationErrors = await readJsonFile(paths.generationErrors, {});
    const generationFailures = Array.isArray(generationErrors?.failures) ? generationErrors.failures.map(String) : [];
    for (const job of jobs) {
      const prefix = `${job.relativePath}:`;
      const failure = generationFailures.find(message => message.startsWith(prefix));
      job.generationError = failure ? failure.slice(prefix.length).trim() : '';
      if (job.generationError && !job.outputUrl) job.status = '生成失败';
    }
    const storedProgress = await readJsonFile(paths.generationProgress, {});
    const derivedProgress = summarizeGenerationProgress(jobs, generationErrors?.count || 0);
    const runningPhases = new Set(['queued', 'preparing', 'generating', 'auditing']);
    const taskRunning = runningPhases.has(String(storedProgress?.phase || ''));
    const generationProgress = {
      ...derivedProgress,
      ...(storedProgress && typeof storedProgress === 'object' ? storedProgress : {}),
      total: derivedProgress.total,
      current: taskRunning ? Math.min(derivedProgress.total, Math.max(0, Number(storedProgress.current) || 0)) : derivedProgress.current,
      percent: taskRunning ? Math.max(0, Math.min(100, Number(storedProgress.percent) || 0)) : derivedProgress.percent,
      pending: taskRunning ? Math.max(0, derivedProgress.total - (Number(storedProgress.current) || 0)) : derivedProgress.pending,
      phase: String(storedProgress?.phase || (derivedProgress.pending || derivedProgress.failed ? 'attention' : 'completed')),
      message: String(storedProgress?.message || '')
    };
    const folderRecord = {
      folder,
      name: entry.name,
      source,
      review,
      jobs,
      images,
      masterExists: Boolean(masterImage),
      templateAvailable: Boolean(source.templateFolderPath && fs.existsSync(source.templateFolderPath)),
      legacyStatus: review.status || source.status,
      progress: taskRunning ? (generationProgress.message || '正在处理套图') : '',
      taskRunning,
      logs: await readOperationLogs(folder),
      modifiedAt: stat.mtimeMs
    };
    folders.push({
      folder,
      name: entry.name,
      images,
      jobs,
      source,
      logs: folderRecord.logs,
      masterImage,
      masterStatus: masterImage ? '母版已生成' : '',
      status: deriveFolderStatus(folderRecord, config.auditMode),
      generationProgress,
      modifiedAt: stat.mtimeMs
    });
  }
  return folders.sort((a, b) => b.modifiedAt - a.modifiedAt);
}

async function findReviewJob(folder, relativePath) {
  const source = await readSourceMetadata(folder);
  if (!source.templateFolderPath || !fs.existsSync(source.templateFolderPath)) throw new Error('任务缺少套图文件夹');
  const wanted = String(relativePath || '').replaceAll('\\', '/').toLocaleLowerCase('zh-CN');
  const selectedPaths = new Set((source.templateRelativePaths || []).map(value => String(value).replaceAll('\\', '/').toLocaleLowerCase('zh-CN')));
  const job = (await buildTemplateJobs(source.templateFolderPath, folder)).find(item => {
    const normalized = item.relativePath.replaceAll('\\', '/').toLocaleLowerCase('zh-CN');
    return normalized === wanted && (!selectedPaths.size || selectedPaths.has(normalized));
  });
  if (!job) throw new Error(`未找到套图图片：${relativePath}`);
  return job;
}

async function resolveReviewReferenceResultPath(folder, relativePath) {
  const value = String(relativePath || '').trim();
  if (!value) return '';
  const referenceJob = await findReviewJob(folder, value);
  if (!referenceJob.outputPath || !fs.existsSync(referenceJob.outputPath)) {
    throw new Error(`参考结果图尚未生成：${referenceJob.relativePath}`);
  }
  return referenceJob.outputPath;
}

async function setTemplateManualStatus(payload) {
  const folder = String(payload?.folder || '');
  if (!folder || !fs.existsSync(folder)) throw new Error('任务文件夹不存在');
  const job = await findReviewJob(folder, payload?.relativePath);
  const status = payload?.status === '人工不通过' ? '人工不通过' : '人工通过';
  const updatedAt = new Date().toISOString();
  const paths = metadataPaths(folder, job.relativePath);
  await writeJsonFile(paths.manualReview, toWpfManualReviewState(status, updatedAt));
  const reviewPaths = metadataPaths(folder);
  const current = normalizeReviewMetadata(await readJsonFile(reviewPaths.macReview, {}));
  const images = current.images.filter(image => image.relativePath.replaceAll('\\', '/').toLocaleLowerCase('zh-CN') !== job.relativePath.replaceAll('\\', '/').toLocaleLowerCase('zh-CN'));
  images.push({ relativePath: job.relativePath, outputPath: job.outputPath, outputExists: fs.existsSync(job.outputPath), manualStatus: status, reviewedAt: updatedAt });
  await writeJsonFile(reviewPaths.macReview, toMacReviewMetadata(current, { images, reviewedAt: updatedAt }));
  await addOperationLog(folder, `${status === '人工通过' ? '人工标记通过' : '人工标记不通过'}：${job.relativePath}`);
  return true;
}

async function approveReviewFolder(folder, allowSkip = false) {
  if (!folder || !fs.existsSync(folder)) throw new Error('任务文件夹不存在');
  const source = await readSourceMetadata(folder);
  if (!source.templateFolderPath || !fs.existsSync(source.templateFolderPath)) {
    await writeJsonFile(metadataPaths(folder).macReview, { status: '已通过', reviewedAt: new Date().toISOString() });
    await addOperationLog(folder, '人工通过任务');
    return { approved: true, changed: 0 };
  }
  const selectedPaths = new Set((source.templateRelativePaths || []).map(value => String(value).replaceAll('\\', '/').toLocaleLowerCase('zh-CN')));
  const jobs = (await buildTemplateJobs(source.templateFolderPath, folder))
    .filter(job => !selectedPaths.size || selectedPaths.has(job.relativePath.replaceAll('\\', '/').toLocaleLowerCase('zh-CN')));
  const actionableJobs = [];
  for (const job of jobs) {
    const { summary } = await templateConfigurationForJob(job);
    if (summary.action !== 'skip_copy') actionableJobs.push(job);
  }
  const missing = actionableJobs.filter(job => !fs.existsSync(job.outputPath));
  if (missing.length) {
    await addOperationLog(folder, `批量通过任务列表：还有 ${missing.length} 张未生成，未归档`);
    if (allowSkip) return { approved: false, missing: missing.length };
    throw new Error(`还有 ${missing.length} 张套图未生成`);
  }
  const updatedAt = new Date().toISOString();
  for (const job of actionableJobs) await writeJsonFile(metadataPaths(folder, job.relativePath).manualReview, toWpfManualReviewState('人工通过', updatedAt));
  const images = actionableJobs.map(job => ({ relativePath: job.relativePath, outputPath: job.outputPath, outputExists: true, manualStatus: '人工通过', reviewedAt: updatedAt }));
  await writeJsonFile(metadataPaths(folder).macReview, toMacReviewMetadata({ status: '已通过' }, { status: '已通过', reviewedAt: updatedAt, images }));
  await addOperationLog(folder, `批量通过任务列表：已标记 ${actionableJobs.length} 张图片为通过，并归档任务`);
  return { approved: true, changed: actionableJobs.length };
}

async function batchApproveReviewFolders(folders) {
  const results = [];
  for (const folder of [...new Set((folders || []).map(String))]) results.push({ folder, ...(await approveReviewFolder(folder, true)) });
  return results;
}

async function deleteReviewFolders(folders) {
  const outputRoot = path.resolve((await loadConfig()).outputPath || currentDefaultOutputRoot());
  const existing = [...new Set((folders || []).map(String))].filter(folder => {
    const resolved = path.resolve(folder);
    return fs.existsSync(resolved) && resolved !== outputRoot && isSameOrChildPath(outputRoot, resolved);
  });
  let deleted = 0;
  for (const folder of existing) {
    await fsp.rm(folder, { recursive: true, force: true });
    deleted += 1;
  }
  return deleted;
}


async function resetConfig() {
  await fsp.rm(configFile(), { force: true });
  return saveConfig(defaultConfig());
}

async function generateFree(payload = {}, options = {}) {
  if (!payload.sourcePath || !fs.existsSync(payload.sourcePath)) throw new Error('请选择源图片');
  if (!String(payload.prompt || '').trim()) throw new Error('请输入生图提示词');
  const config = await loadConfig();
  const folder = path.join(config.outputPath || currentDefaultOutputRoot(), '自由生图');
  await fsp.mkdir(folder, { recursive: true });
  const outputPath = path.join(folder, `自由生图_${localFileTimestamp()}.png`);
  await fsp.writeFile(outputPath, await generateImage(String(payload.prompt).trim(), [payload.sourcePath], {
    size: config.imageSize || '1024x1024',
    quality: config.imageQuality || 'auto',
    billingDescription: '自由生图',
    billingReference: path.basename(payload.sourcePath),
    billingOnceKey: billingOnceKey('image:free', payload.sourcePath, String(payload.prompt).trim(), Date.now(), crypto.randomUUID()),
    signal: options.signal
  }));
  return { outputPath, url: imageUrl(outputPath) };
}

function childrenwearMetadataFile(folder) {
  return path.join(folder, 'childrenwear-task.json');
}

function childrenwearDateCode(input = new Date()) {
  const date = input instanceof Date ? input : new Date(input);
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  return `${String(safeDate.getMonth() + 1).padStart(2, '0')}${String(safeDate.getDate()).padStart(2, '0')}`;
}

function normalizedChildrenwearTaskCode(value) {
  const match = String(value || '').trim().match(/^(\d{4})-(\d{3})$/);
  return match ? `${match[1]}-${match[2]}` : '';
}

function childrenwearTaskCodeFromFolder(folder) {
  const match = path.basename(String(folder || '')).match(/^(\d{4}-\d{3})(?:-|$)/);
  return normalizedChildrenwearTaskCode(match?.[1]);
}

function childrenwearStyleName(value, fallback = '童装款式') {
  const text = String(value || '').trim().replace(/^\d{4}-\d{3}\s*[-·｜|]?\s*/, '').replace(/\d{4}-\d{3}\s*$/, '').replace(/[·｜|]\s*[^·｜|]+$/, '').trim();
  return (text || fallback).slice(0, 50);
}

function childrenwearTaskDisplayName(styleName, taskCode) {
  const style = childrenwearStyleName(styleName);
  const code = normalizedChildrenwearTaskCode(taskCode);
  return code ? `${code} ${style}` : style;
}

function childrenwearOutputDisplayName(value, taskCode, fallback = '童装款式') {
  const code = normalizedChildrenwearTaskCode(taskCode);
  const text = String(value || fallback).trim().replace(/^\d{4}-\d{3}\s*[-·｜|]?\s*/, '').replace(/\d{4}-\d{3}\s*$/, '').trim() || fallback;
  return code ? `${code} ${text}` : text;
}

function publicChildrenwearTask(value = {}) {
  const models = Array.isArray(value.modelOutputs) ? value.modelOutputs : [];
  const combinations = Array.isArray(value.combinationOutputs) ? value.combinationOutputs : [];
  const masterHistory = Array.isArray(value.masterHistory) ? value.masterHistory : [];
  return {
    ...value,
    realPhotoUrl: value.realPhotoPath ? imageUrl(value.realPhotoPath) : '',
    realPhotoThumbnailUrl: value.realPhotoPath ? thumbnailUrl(value.realPhotoPath, 480, '') : '',
    realPhotoPreviewUrl: value.realPhotoPath ? thumbnailUrl(value.realPhotoPath, 1200, '') : '',
    referenceUrl: value.referencePath ? imageUrl(value.referencePath) : '',
    referenceThumbnailUrl: value.referencePath ? thumbnailUrl(value.referencePath, 480, '') : '',
    referencePreviewUrl: value.referencePath ? thumbnailUrl(value.referencePath, 1200, '') : '',
    masterUrl: value.masterPath ? imageUrl(value.masterPath) : '',
    masterThumbnailUrl: value.masterPath ? thumbnailUrl(value.masterPath, 480, '') : '',
    masterPreviewUrl: value.masterPath ? thumbnailUrl(value.masterPath, 1200, '') : '',
    masterHistory: masterHistory.map(item => ({
      ...item,
      url: item.path ? imageUrl(item.path) : '',
      thumbnailUrl: item.path ? thumbnailUrl(item.path, 480, '') : '',
      previewUrl: item.path ? thumbnailUrl(item.path, 1200, '') : ''
    })),
    masterUrls: (value.masterPaths || []).map(item => item ? imageUrl(item) : ''),
    masterThumbnailUrls: (value.masterPaths || []).map(item => item ? thumbnailUrl(item, 480, '') : ''),
    masterPreviewUrls: (value.masterPaths || []).map(item => item ? thumbnailUrl(item, 1200, '') : ''),
    modelOutputs: models.map(item => ({
      ...item,
      url: item.path ? imageUrl(item.path) : '',
      thumbnailUrl: item.path ? thumbnailUrl(item.path, 480, '') : '',
      previewUrl: item.path ? thumbnailUrl(item.path, 1200, '') : '',
      masterUrl: item.masterPath ? imageUrl(item.masterPath) : '',
      masterThumbnailUrl: item.masterPath ? thumbnailUrl(item.masterPath, 480, '') : '',
      masterPreviewUrl: item.masterPath ? thumbnailUrl(item.masterPath, 1200, '') : '',
      modelReferenceUrl: item.modelReferencePath ? imageUrl(item.modelReferencePath) : '',
      modelReferenceThumbnailUrl: item.modelReferencePath ? thumbnailUrl(item.modelReferencePath, 480, '') : '',
      modelReferencePreviewUrl: item.modelReferencePath ? thumbnailUrl(item.modelReferencePath, 1200, '') : ''
    })),
    combinationReferenceUrl: value.combinationReferencePath ? imageUrl(value.combinationReferencePath) : '',
    combinationReferenceThumbnailUrl: value.combinationReferencePath ? thumbnailUrl(value.combinationReferencePath, 480, '') : '',
    combinationReferencePreviewUrl: value.combinationReferencePath ? thumbnailUrl(value.combinationReferencePath, 1200, '') : '',
    combinationOutputs: combinations.map(item => ({
      ...item,
      url: item.path ? imageUrl(item.path) : '',
      thumbnailUrl: item.path ? thumbnailUrl(item.path, 480, '') : '',
      previewUrl: item.path ? thumbnailUrl(item.path, 1200, '') : '',
      masterUrls: (item.masterPaths || []).map(masterPath => masterPath ? imageUrl(masterPath) : ''),
      masterThumbnailUrls: (item.masterPaths || []).map(masterPath => masterPath ? thumbnailUrl(masterPath, 480, '') : ''),
      masterPreviewUrls: (item.masterPaths || []).map(masterPath => masterPath ? thumbnailUrl(masterPath, 1200, '') : ''),
      combinationReferenceUrl: item.combinationReferencePath ? imageUrl(item.combinationReferencePath) : '',
      combinationReferenceThumbnailUrl: item.combinationReferencePath ? thumbnailUrl(item.combinationReferencePath, 480, '') : '',
      combinationReferencePreviewUrl: item.combinationReferencePath ? thumbnailUrl(item.combinationReferencePath, 1200, '') : ''
    }))
  };
}

async function readChildrenwearTask(folder) {
  const value = await readJsonFile(childrenwearMetadataFile(folder), null);
  return value && typeof value === 'object' ? value : null;
}

async function readChildrenwearTaskForOutput(file) {
  let folder = path.dirname(String(file || ''));
  for (let depth = 0; depth < 4; depth += 1) {
    const task = await readChildrenwearTask(folder);
    if (task) return task;
    const parent = path.dirname(folder);
    if (parent === folder) break;
    folder = parent;
  }
  return null;
}

async function writeChildrenwearTask(folder, value) {
  const next = { ...value, folder, updatedAt: new Date().toISOString() };
  await writeJsonFile(childrenwearMetadataFile(folder), next);
  return publicChildrenwearTask(next);
}

async function updateChildrenwearTask(folder, updater) {
  const key = `${currentWorkspaceId()}\u0000${path.resolve(folder).toLocaleLowerCase('en-US')}`;
  const previous = childrenwearTaskUpdateQueues.get(key) || Promise.resolve();
  const operation = previous.catch(() => {}).then(async () => {
    const current = await readChildrenwearTask(folder);
    if (!current) throw new Error('童装任务不存在');
    const next = await updater(current);
    return writeChildrenwearTask(folder, next);
  });
  const queued = operation.catch(() => {});
  childrenwearTaskUpdateQueues.set(key, queued);
  return operation.finally(() => {
    if (childrenwearTaskUpdateQueues.get(key) === queued) childrenwearTaskUpdateQueues.delete(key);
  });
}

async function renameChildrenwearTask(payload = {}) {
  const folder = String(payload.folder || '');
  const task = await readChildrenwearTask(folder);
  if (!task) throw new Error('款式任务不存在');
  const taskName = String(payload.taskName || '').trim();
  if (!taskName) throw new Error('任务名称不能为空');
  task.styleName = childrenwearStyleName(taskName, task.styleName || task.category || '童装款式');
  task.taskName = childrenwearTaskDisplayName(task.styleName, task.taskCode).slice(0, 80);
  return writeChildrenwearTask(folder, task);
}

async function deleteChildrenwearTasks(folders = []) {
  const config = await loadConfig();
  const taskRoot = path.resolve(config.outputPath || currentDefaultOutputRoot(), '童装任务');
  const requested = [...new Set((folders || []).map(value => path.resolve(String(value || ''))).filter(Boolean))];
  let deleted = 0;
  const deletedFolders = [];
  for (const folder of requested) {
    // A childrenwear task is always one direct child of the dedicated task root.
    // Refuse broader output folders and nested asset/output paths.
    if (path.dirname(folder).toLocaleLowerCase('en-US') !== taskRoot.toLocaleLowerCase('en-US')) {
      throw new Error('只能删除童装任务根目录下的完整款式任务');
    }
    const stat = await fsp.stat(folder).catch(() => null);
    if (!stat) continue;
    if (!stat.isDirectory() || !await readChildrenwearTask(folder)) throw new Error('目标不是有效的款式任务目录');
    await fsp.rm(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    deleted += 1;
    deletedFolders.push(folder);
  }
  return { deleted, folders: deletedFolders };
}

async function nextChildrenwearTaskFolder(category = '', requestedCode = '') {
  const config = await loadConfig();
  const root = path.join(config.outputPath || currentDefaultOutputRoot(), '童装任务');
  await fsp.mkdir(root, { recursive: true });
  const label = safeFileName(category || '童装').slice(0, 24);
  const today = childrenwearDateCode();
  const preferred = normalizedChildrenwearTaskCode(requestedCode);
  const entries = await fsp.readdir(root, { withFileTypes: true }).catch(() => []);
  const used = new Set();
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const folderCode = childrenwearTaskCodeFromFolder(entry.name);
    if (folderCode) used.add(folderCode);
    const task = await readJsonFile(childrenwearMetadataFile(path.join(root, entry.name)), null);
    const taskCode = normalizedChildrenwearTaskCode(task?.taskCode);
    if (taskCode) used.add(taskCode);
  }
  let sequence = preferred?.startsWith(`${today}-`) ? Number(preferred.slice(-3)) : 1;
  while (sequence <= 999) {
    const taskCode = `${today}-${String(sequence).padStart(3, '0')}`;
    if (!used.has(taskCode)) {
      const folder = path.join(root, `${taskCode}-${label}`);
      try {
        await fsp.mkdir(folder);
        return folder;
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
      }
    }
    sequence += 1;
  }
  throw new Error('当天任务编号已达到 999，请联系管理员');
}

async function fileContentDigest(filePath) {
  const hash = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on('data', chunk => hash.update(chunk));
    stream.once('error', reject);
    stream.once('end', resolve);
  });
  return hash.digest('hex');
}

async function sameFileContent(firstPath, secondPath) {
  const [first, second] = await Promise.all([
    fsp.stat(firstPath).catch(() => null),
    fsp.stat(secondPath).catch(() => null)
  ]);
  if (!first?.isFile() || !second?.isFile() || first.size !== second.size) return false;
  const [firstDigest, secondDigest] = await Promise.all([
    fileContentDigest(firstPath),
    fileContentDigest(secondPath)
  ]);
  return firstDigest === secondDigest;
}

async function copyChildrenwearTaskAsset(sourcePath, folder, groupName, targetName = '') {
  if (!sourcePath || !fs.existsSync(sourcePath)) return '';
  const targetFolder = path.join(folder, '素材', safeFileName(groupName || '参考素材'));
  await fsp.mkdir(targetFolder, { recursive: true });
  const target = path.join(targetFolder, safeFileName(targetName || path.basename(sourcePath)));
  if (path.resolve(sourcePath) === path.resolve(target)) return target;
  const queueKey = path.resolve(target).toLocaleLowerCase('en-US');
  const sourceKey = path.resolve(sourcePath).toLocaleLowerCase('en-US');
  const activeCopy = childrenwearAssetCopyQueues.get(queueKey);
  if (activeCopy?.sourceKey === sourceKey) return activeCopy.promise;
  const previous = activeCopy?.promise || Promise.resolve();
  const operation = previous.catch(() => undefined).then(async () => {
    if (await sameFileContent(sourcePath, target)) return target;
    await fsp.copyFile(sourcePath, target);
    return target;
  });
  childrenwearAssetCopyQueues.set(queueKey, { sourceKey, promise: operation });
  try {
    return await operation;
  } finally {
    if (childrenwearAssetCopyQueues.get(queueKey)?.promise === operation) childrenwearAssetCopyQueues.delete(queueKey);
  }
}

function childrenwearAssetFolderHint(file) {
  return path.basename(path.dirname(String(file || '')))
    .normalize('NFKC')
    .replace(/(?:[-_\s]*(?:实拍产品图|实拍图|成品参考图|成品图|参考图|参考模特图|模特图|组合参考图|组合图))$/u, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .toLocaleLowerCase('zh-CN');
}

function childrenwearPathWithin(root, target) {
  const relative = path.relative(path.resolve(String(root || '')), path.resolve(String(target || '')));
  return Boolean(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function findChildrenwearAssetReplacement(missingPath, roots = []) {
  const expectedName = path.basename(String(missingPath || '')).toLocaleLowerCase('zh-CN');
  if (!expectedName) return '';
  const candidatePaths = new Map();
  for (const root of [...new Set(roots.map(value => String(value || '').trim()).filter(Boolean))]) {
    const stat = await fsp.stat(root).catch(() => null);
    if (!stat?.isDirectory()) continue;
    const indexed = await imageLibraryIndex(root);
    for (const item of indexed) {
      if (item.name.toLocaleLowerCase('zh-CN') !== expectedName) continue;
      const resolved = path.resolve(item.path);
      candidatePaths.set(resolved.toLocaleLowerCase('en-US'), resolved);
    }
  }
  const candidates = [...candidatePaths.values()];
  if (candidates.length === 1) return candidates[0];
  if (!candidates.length) return '';
  const expectedHint = childrenwearAssetFolderHint(missingPath);
  const ranked = candidates.map(candidate => {
    const hint = childrenwearAssetFolderHint(candidate);
    const score = expectedHint && hint === expectedHint ? 100 : expectedHint && hint && (expectedHint.includes(hint) || hint.includes(expectedHint)) ? 50 : 0;
    return { candidate, score };
  }).sort((left, right) => right.score - left.score || left.candidate.localeCompare(right.candidate, 'zh-CN', { numeric: true }));
  return ranked[0].score > (ranked[1]?.score || 0) ? ranked[0].candidate : '';
}

async function resolveChildrenwearTaskAsset(currentPath, taskFolder, groupName, searchRoots = [], targetName = '') {
  const existing = String(currentPath || '');
  if (existing && fs.existsSync(existing)) return copyChildrenwearTaskAsset(existing, taskFolder, groupName, targetName);
  const localRoot = path.join(taskFolder, '素材', safeFileName(groupName));
  const replacement = await findChildrenwearAssetReplacement(existing, [localRoot, ...searchRoots]);
  return replacement ? copyChildrenwearTaskAsset(replacement, taskFolder, groupName, targetName) : '';
}

async function repairChildrenwearTaskAssets(task, config = {}) {
  const folder = String(task?.folder || '');
  if (!folder) return { changed: false, missing: [] };
  const workspaceAssets = path.join(currentWorkspaceRoot(), 'assets');
  const roots = {
    real: [config.childrenwearRealAssetsPath, path.join(workspaceAssets, 'childrenwear-real')],
    reference: [config.childrenwearReferenceAssetsPath, path.join(workspaceAssets, 'childrenwear-reference')],
    model: [config.childrenwearModelAssetsPath, path.join(workspaceAssets, 'childrenwear-model')],
    combination: [config.childrenwearCombinationAssetsPath, path.join(workspaceAssets, 'childrenwear-combination')]
  };
  let changed = false;
  const missing = [];
  const repairField = async (holder, key, groupName, searchRoots, targetName = '') => {
    const previous = String(holder?.[key] || '');
    if (!previous) return;
    const resolved = await resolveChildrenwearTaskAsset(previous, folder, groupName, searchRoots, targetName);
    if (!resolved) {
      missing.push({ key, path: previous });
      return;
    }
    if (path.resolve(previous).toLocaleLowerCase('en-US') !== path.resolve(resolved).toLocaleLowerCase('en-US')) {
      holder[key] = resolved;
      changed = true;
    }
  };
  await repairField(task, 'realPhotoPath', '实拍图', roots.real);
  await repairField(task, 'referencePath', '成品参考图', roots.reference);
  for (const output of task.modelOutputs || []) await repairField(output, 'modelReferencePath', '参考模特图', roots.model);
  await repairField(task, 'combinationReferencePath', '组合参考图', roots.combination);
  if (Array.isArray(task.masterPaths)) {
    const repairedMasters = [];
    for (let index = 0; index < task.masterPaths.length; index += 1) {
      const source = String(task.masterPaths[index] || '');
      const extension = path.extname(source) || '.png';
      const targetName = `平铺图${String(index + 1).padStart(2, '0')}${extension}`;
      const resolved = await resolveChildrenwearTaskAsset(source, folder, '组合平铺图', [], targetName);
      repairedMasters.push(resolved || source);
      if (!resolved) missing.push({ key: `masterPaths.${index}`, path: source });
      else if (path.resolve(source).toLocaleLowerCase('en-US') !== path.resolve(resolved).toLocaleLowerCase('en-US')) changed = true;
    }
    task.masterPaths = repairedMasters;
  }
  task.assetHealth = { missing, checkedAt: new Date().toISOString() };
  return { changed, missing };
}

async function generateChildrenwearMaster(payload = {}, options = {}) {
  const generationStartedAt = new Date();
  if (!payload.realPhotoPath || !fs.existsSync(payload.realPhotoPath)) throw new Error('请上传一张实拍产品图');
  if (!payload.referencePath || !fs.existsSync(payload.referencePath)) throw new Error('请选择一张参考成品图');
  const folder = payload.folder || await nextChildrenwearTaskFolder(payload.category, payload.taskCode);
  const existing = await readChildrenwearTask(folder) || {};
  options.reportProgress?.({ phase: 'preparing', percent: 5, message: '正在读取素材 AI 分析缓存' });
  const [productAnalysis, referenceAnalysis] = await Promise.all([
    childrenwearAssetAnalysisForTask(payload.realPhotoPath, 'product', [{
      schemaVersion: existing.analysisSchemaVersion,
      contentHash: existing.productAnalysisHash,
      analysis: existing.productManifest
    }]),
    childrenwearAssetAnalysisForTask(payload.referencePath, 'flat_reference', [{
      schemaVersion: existing.analysisSchemaVersion,
      contentHash: existing.flatReferenceAnalysisHash,
      analysis: existing.flatReferenceSpec
    }])
  ]);
  await fsp.mkdir(folder, { recursive: true });
  const [realPhotoPath, referencePath] = await Promise.all([
    copyChildrenwearTaskAsset(payload.realPhotoPath, folder, '实拍图'),
    copyChildrenwearTaskAsset(payload.referencePath, folder, '成品参考图')
  ]);
  const version = Math.max(1, Number(existing.masterVersion || 0) + 1);
  const evidenceFolder = path.join(folder, '.evidence', `master-v${version}`);
  await fsp.mkdir(evidenceFolder, { recursive: true });
  const pieceCount = childrenwearPieceCount({ productManifest: productAnalysis.analysis });
  const prompt = await buildConfiguredChildrenwearPrompt('childrenwearMasterGeneration', buildChildrenwearMasterPrompt({
    ...payload,
    pieceCount,
    productManifest: productAnalysis.analysis,
    referenceSpec: referenceAnalysis.analysis
  }));
  await fsp.writeFile(path.join(evidenceFolder, 'prompt.txt'), prompt, 'utf8');
  options.reportProgress?.({ phase: 'generating', percent: 18, message: '正在生成童装平铺母版' });
  const config = await loadConfig();
  const bytes = await generateImage(prompt, [realPhotoPath, referencePath], {
    size: config.imageSize || '1024x1024',
    quality: config.imageQuality || 'high',
    billingDescription: '童装平铺母版生成',
    billingReference: path.basename(realPhotoPath),
    billingOnceKey: billingOnceKey('image:childrenwear-master', folder, version, Date.now(), crypto.randomUUID()),
    signal: options.signal,
    onRequestState: event => {
      const waiting = event.state === 'retry_wait';
      options.reportProgress?.({
        phase: waiting ? 'waiting_upstream' : 'generating',
        percent: waiting ? 35 : 55,
        message: waiting ? '生图接口等待重试' : '生图接口正在处理母版'
      });
    }
  });
  const generationCompletedAt = new Date();
  const generationMetrics = {
    startedAt: generationStartedAt.toISOString(),
    completedAt: generationCompletedAt.toISOString(),
    elapsedMs: Math.max(0, generationCompletedAt.getTime() - generationStartedAt.getTime()),
    billingCostMinor: Math.max(0, Number(bytes.billingAmountMinor) || 0),
    upstreamCostCnyMicro: Math.max(0, Number(bytes.upstreamCostCnyMicro) || 0),
    apiRequestCount: Math.max(1, Number(bytes.apiRequestCount) || 1),
    modelId: String(bytes.imageModel || config.imageModel || ''),
    relayId: String(bytes.relayId || ''),
    relayName: String(bytes.relayName || '')
  };
  const masterOutputFolder = path.join(folder, '平铺图');
  await fsp.mkdir(masterOutputFolder, { recursive: true });
  const masterPath = path.join(masterOutputFolder, `平铺母版-v${version}.png`);
  await sharp(bytes, { failOn: 'none' }).png({ compressionLevel: 9 }).toFile(masterPath);
  const now = new Date().toISOString();
  const history = Array.isArray(existing.masterHistory) ? existing.masterHistory : [];
  const task = {
    ...existing,
    id: existing.id || path.basename(folder),
    folder,
    taskCode: normalizedChildrenwearTaskCode(existing.taskCode || payload.taskCode) || childrenwearTaskCodeFromFolder(folder),
    styleName: childrenwearStyleName(existing.styleName || payload.taskName || payload.category || '童装款式'),
    taskName: '',
    category: String(payload.category || existing.category || '童装').trim(),
    material: String(payload.material || existing.material || '').trim(),
    pieceCount,
    craft: String(payload.craft || existing.craft || '').trim(),
    note: String(payload.extraInstruction || existing.note || '').trim(),
    realPhotoPath,
    referencePath,
    evidencePaths: [],
    analysisSchemaVersion: ANALYSIS_SCHEMA_VERSION,
    productManifest: productAnalysis.analysis,
    flatReferenceSpec: referenceAnalysis.analysis,
    productAnalysisHash: productAnalysis.contentHash,
    flatReferenceAnalysisHash: referenceAnalysis.contentHash,
    masterPath,
    masterVersion: version,
    masterApproved: false,
    masterApprovedAt: '',
    masterReviewStatus: 'pending',
    masterIssueNote: '',
    masterGeneration: generationMetrics,
    masterHistory: [...history, { version, path: masterPath, createdAt: now, ...generationMetrics }].slice(-20),
    modelOutputs: Array.isArray(existing.modelOutputs) ? existing.modelOutputs : [],
    createdAt: existing.createdAt || now
  };
  task.taskName = childrenwearTaskDisplayName(task.styleName, task.taskCode).slice(0, 80);
  options.reportProgress?.({ phase: 'completed', percent: 100, message: '母版生成完成，等待成品审核' });
  return writeChildrenwearTask(folder, task);
}

async function approveChildrenwearOutput(payload = {}) {
  const folder = String(payload.folder || '');
  const task = await readChildrenwearTask(folder);
  if (!task) throw new Error('童装任务不存在');
  const now = new Date().toISOString();
  if (payload.stage === 'master') {
    if (!task.masterPath || !fs.existsSync(task.masterPath)) throw new Error('母版文件不存在');
    task.masterApproved = payload.approved !== false;
    task.masterApprovedAt = task.masterApproved ? now : '';
    task.masterReviewStatus = task.masterApproved ? 'approved' : (payload.reviewStatus === 'needs_regeneration' ? 'needs_regeneration' : 'pending');
    task.masterIssueNote = task.masterReviewStatus === 'needs_regeneration' ? String(payload.issueNote || '').trim().slice(0, 300) : '';
  } else if (payload.stage === 'model') {
    const output = (task.modelOutputs || []).find(item => item.id === String(payload.outputId || ''));
    if (!output) throw new Error('模特图不存在');
    output.approved = payload.approved !== false;
    output.approvedAt = output.approved ? now : '';
    output.reviewStatus = output.approved ? 'approved' : (payload.reviewStatus === 'needs_regeneration' ? 'needs_regeneration' : 'pending');
    output.issueNote = output.reviewStatus === 'needs_regeneration' ? String(payload.issueNote || '').trim().slice(0, 300) : '';
  } else if (payload.stage === 'combination') {
    const output = (task.combinationOutputs || []).find(item => item.id === String(payload.outputId || ''));
    if (!output) throw new Error('组合图不存在');
    output.approved = payload.approved !== false;
    output.approvedAt = output.approved ? now : '';
    output.reviewStatus = output.approved ? 'approved' : (payload.reviewStatus === 'needs_regeneration' ? 'needs_regeneration' : 'pending');
    output.issueNote = output.reviewStatus === 'needs_regeneration' ? String(payload.issueNote || '').trim().slice(0, 300) : '';
  } else {
    throw new Error('审核阶段无效');
  }
  return writeChildrenwearTask(folder, task);
}

async function generateChildrenwearModel(payload = {}, options = {}) {
  const generationStartedAt = new Date();
  const folder = String(payload.folder || '');
  const task = await readChildrenwearTask(folder);
  if (!task) throw new Error('童装任务不存在');
  const config = await loadConfig();
  await repairChildrenwearTaskAssets(task, config);
  if (!task.masterApproved) throw new Error('请先人工确认母版图');
  if (!payload.modelReferencePath || !fs.existsSync(payload.modelReferencePath)) throw new Error('请上传模特或姿势参考图');
  if (!task.masterPath || !fs.existsSync(task.masterPath)) throw new Error('已审核母版文件不存在');
  if (!task.realPhotoPath || !fs.existsSync(task.realPhotoPath)) throw new Error('任务实拍图已丢失，请重新选择实拍图后再生成');
  const matchingModelOutputs = (task.modelOutputs || []).filter(output => output.modelReferenceSpec
    && output.modelReferenceAnalysisHash
    && output.modelReferencePath
    && path.resolve(output.modelReferencePath) === path.resolve(payload.modelReferencePath));
  const modelReferenceAnalysis = await childrenwearAssetAnalysisForTask(payload.modelReferencePath, 'model_reference', matchingModelOutputs.map(output => ({
    schemaVersion: task.analysisSchemaVersion,
    contentHash: output.modelReferenceAnalysisHash,
    analysis: output.modelReferenceSpec
  })));
  const modelReferencePath = await copyChildrenwearTaskAsset(payload.modelReferencePath, folder, '参考模特图');
  task.taskName = childrenwearTaskDisplayName(task.styleName || task.category || task.taskName, task.taskCode).slice(0, 80);
  const productManifest = task.productManifest || (await requireChildrenwearAssetAnalysis(task.realPhotoPath, 'product')).analysis;
  const prompt = await buildConfiguredChildrenwearPrompt('childrenwearModelGeneration', buildChildrenwearModelPrompt({
    productManifest,
    referenceSpec: modelReferenceAnalysis.analysis,
    extraInstruction: payload.extraInstruction
  }));
  const outputId = `model-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const evidenceFolder = path.join(folder, '.evidence', outputId);
  await fsp.mkdir(evidenceFolder, { recursive: true });
  await fsp.writeFile(path.join(evidenceFolder, 'prompt.txt'), prompt, 'utf8');
  options.reportProgress?.({ phase: 'generating', percent: 15, message: '正在将已审核母版生成模特上身图' });
  const bytes = await generateImage(prompt, [task.masterPath, modelReferencePath], {
    size: config.imageSize || '1024x1024',
    quality: config.imageQuality || 'high',
    billingDescription: '童装模特上身图生成',
    billingReference: path.basename(task.masterPath),
    billingOnceKey: billingOnceKey('image:childrenwear-model', folder, outputId, Date.now(), crypto.randomUUID()),
    signal: options.signal,
    onRequestState: event => options.reportProgress?.({
      phase: event.state === 'retry_wait' ? 'waiting_upstream' : 'generating',
      percent: event.state === 'retry_wait' ? 35 : 58,
      message: event.state === 'retry_wait' ? '生图接口等待重试' : '生图接口正在处理模特图'
    })
  });
  const generationCompletedAt = new Date();
  const modelOutputFolder = path.join(folder, '模特图');
  await fsp.mkdir(modelOutputFolder, { recursive: true });
  const outputPath = path.join(modelOutputFolder, `${outputId}.png`);
  await sharp(bytes, { failOn: 'none' }).png({ compressionLevel: 9 }).toFile(outputPath);
  const output = {
    id: outputId,
    path: outputPath,
    taskName: childrenwearOutputDisplayName(payload.taskName || task.taskName, task.taskCode, task.styleName || task.category).slice(0, 80),
    masterPath: task.masterPath,
    modelReferencePath,
    modelReferenceSpec: modelReferenceAnalysis.analysis,
    modelReferenceAnalysisHash: modelReferenceAnalysis.contentHash,
    approved: false,
    approvedAt: '',
    reviewStatus: 'pending',
    issueNote: '',
    createdAt: generationCompletedAt.toISOString(),
    startedAt: generationStartedAt.toISOString(),
    completedAt: generationCompletedAt.toISOString(),
    elapsedMs: Math.max(0, generationCompletedAt.getTime() - generationStartedAt.getTime()),
    billingCostMinor: Math.max(0, Number(bytes.billingAmountMinor) || 0),
    upstreamCostCnyMicro: Math.max(0, Number(bytes.upstreamCostCnyMicro) || 0),
    apiRequestCount: Math.max(1, Number(bytes.apiRequestCount) || 1),
    modelId: String(bytes.imageModel || config.imageModel || ''),
    relayId: String(bytes.relayId || ''),
    relayName: String(bytes.relayName || '')
  };
  options.reportProgress?.({ phase: 'completed', percent: 100, message: '模特图生成完成，等待成品审核' });
  // API generation is allowed to run concurrently even for the same style.
  // Serialize only the final metadata merge so one completion cannot overwrite
  // another completion's output record.
  return updateChildrenwearTask(folder, current => ({
    ...current,
    taskName: childrenwearTaskDisplayName(current.styleName || current.category || current.taskName, current.taskCode).slice(0, 80),
    productManifest: current.productManifest || productManifest,
    modelOutputs: [...(current.modelOutputs || []), output].slice(-50)
  }));
}

async function listChildrenwearTasks() {
  const config = await loadConfig();
  const root = path.join(config.outputPath || currentDefaultOutputRoot(), '童装任务');
  const entries = await fsp.readdir(root, { withFileTypes: true }).catch(() => []);
  const tasks = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const task = await readChildrenwearTask(path.join(root, entry.name));
    if (task) tasks.push(task);
  }
  const usedByDate = new Map();
  for (const task of tasks) {
    const code = normalizedChildrenwearTaskCode(task.taskCode);
    if (!code) continue;
    const stamp = code.slice(0, 4);
    if (!usedByDate.has(stamp)) usedByDate.set(stamp, new Set());
    usedByDate.get(stamp).add(Number(code.slice(-3)));
  }
  for (const task of [...tasks].sort((left, right) => String(left.createdAt || '').localeCompare(String(right.createdAt || '')))) {
    let changed = false;
    const assetRepair = await repairChildrenwearTaskAssets(task, config);
    if (assetRepair.changed) changed = true;
    if (!normalizedChildrenwearTaskCode(task.taskCode)) {
      const stamp = childrenwearDateCode(task.createdAt || task.updatedAt || new Date());
      if (!usedByDate.has(stamp)) usedByDate.set(stamp, new Set());
      const used = usedByDate.get(stamp);
      let sequence = 1;
      while (used.has(sequence) && sequence < 999) sequence += 1;
      used.add(sequence);
      task.taskCode = `${stamp}-${String(sequence).padStart(3, '0')}`;
      changed = true;
    }
    const styleName = childrenwearStyleName(task.styleName || task.category || task.taskName || '童装款式');
    const taskName = childrenwearTaskDisplayName(styleName, task.taskCode);
    if (task.styleName !== styleName || task.taskName !== taskName) {
      task.styleName = styleName;
      task.taskName = taskName;
      changed = true;
    }
    if (changed) await writeJsonFile(childrenwearMetadataFile(task.folder), task);
  }
  return tasks.map(publicChildrenwearTask).sort((left, right) => String(right.updatedAt || '').localeCompare(String(left.updatedAt || '')));
}

async function generateChildrenwearCombination(payload = {}, options = {}) {
  const generationStartedAt = new Date();
  const masterPaths = [...new Set((payload.masterPaths || []).map(String))].slice(0, 4);
  if (masterPaths.length < 2) throw new Error('组合图至少需要选择 2 个已审核母版');
  const folder = payload.folder || await nextChildrenwearTaskFolder('多SKU组合', payload.taskCode);
  await fsp.mkdir(folder, { recursive: true });
  const existing = await readChildrenwearTask(folder) || {};
  const config = await loadConfig();
  if (existing.folder) await repairChildrenwearTaskAssets(existing, config);
  const skuManifest = [];
  for (let index = 0; index < masterPaths.length; index += 1) {
    const masterPath = masterPaths[index];
    const sourceTask = await readChildrenwearTaskForOutput(masterPath);
    const approvedCurrentMaster = sourceTask?.masterApproved && path.resolve(sourceTask.masterPath) === path.resolve(masterPath);
    const existingSnapshot = (existing.masterPaths || []).some(item => path.resolve(item) === path.resolve(masterPath))
      && childrenwearPathWithin(path.join(folder, '素材', '组合平铺图'), masterPath)
      && fs.existsSync(masterPath);
    if (!approvedCurrentMaster && !existingSnapshot) {
      throw new Error('组合图只能使用已人工审核的当前母版');
    }
    const previousItem = Array.isArray(existing.skuManifest) ? existing.skuManifest[index] : null;
    const source = approvedCurrentMaster ? sourceTask : previousItem || sourceTask || {};
    const productManifest = source.productManifest || (source.realPhotoPath
      ? (await requireChildrenwearAssetAnalysis(source.realPhotoPath, 'product')).analysis
      : null);
    if (!productManifest) throw new Error(`第 ${index + 1} 个平铺图缺少商品身份分析，请重新从已分析素材生成母版`);
    skuManifest.push({
      taskName: String(source.taskName || source.styleName || `SKU ${index + 1}`),
      category: String(source.category || '童装 SKU'),
      material: String(source.material || '以对应母版为准'),
      pieceCount: childrenwearPieceCount({ productManifest }),
      productManifest
    });
  }
  if (!payload.combinationReferencePath || !fs.existsSync(payload.combinationReferencePath)) throw new Error('请选择一张组合参考图');
  const combinationReferenceAnalysis = await childrenwearAssetAnalysisForTask(payload.combinationReferencePath, 'combination_reference', [{
    schemaVersion: existing.analysisSchemaVersion,
    contentHash: existing.combinationReferenceAnalysisHash,
    analysis: existing.combinationReferenceSpec
  }]);
  const localMasterPaths = [];
  for (let index = 0; index < masterPaths.length; index += 1) {
    const source = masterPaths[index];
    const extension = path.extname(source) || '.png';
    localMasterPaths.push(await copyChildrenwearTaskAsset(source, folder, '组合平铺图', `平铺图${String(index + 1).padStart(2, '0')}${extension}`));
  }
  const combinationReferencePath = await copyChildrenwearTaskAsset(payload.combinationReferencePath, folder, '组合参考图');
  const version = Math.max(1, Number(existing.combinationVersion || 0) + 1);
  const outputId = `combination-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const prompt = await buildConfiguredChildrenwearPrompt('childrenwearCombinationGeneration', buildChildrenwearCombinationPrompt({
    count: localMasterPaths.length,
    items: skuManifest,
    referenceSpec: combinationReferenceAnalysis.analysis
  }));
  const evidenceFolder = path.join(folder, '.evidence', outputId);
  await fsp.mkdir(evidenceFolder, { recursive: true });
  await fsp.writeFile(path.join(evidenceFolder, 'prompt.txt'), prompt, 'utf8');
  options.reportProgress?.({ phase: 'generating', percent: 15, message: '正在生成多 SKU 组合图' });
  const bytes = await generateImage(prompt, [...localMasterPaths, combinationReferencePath], {
    size: config.imageSize || '1024x1024',
    quality: config.imageQuality || 'high',
    billingDescription: '童装多 SKU 组合图生成',
    billingReference: localMasterPaths.map(value => path.basename(value)).join(' + '),
    billingOnceKey: billingOnceKey('image:childrenwear-combination', folder, outputId, Date.now(), crypto.randomUUID()),
    signal: options.signal,
    onRequestState: event => options.reportProgress?.({
      phase: event.state === 'retry_wait' ? 'waiting_upstream' : 'generating',
      percent: event.state === 'retry_wait' ? 35 : 58,
      message: event.state === 'retry_wait' ? '生图接口等待重试' : '生图接口正在处理组合图'
    })
  });
  const generationCompletedAt = new Date();
  const combinationOutputFolder = path.join(folder, '组合图');
  await fsp.mkdir(combinationOutputFolder, { recursive: true });
  const outputPath = path.join(combinationOutputFolder, `${outputId}.png`);
  await sharp(bytes, { failOn: 'none' }).png({ compressionLevel: 9 }).toFile(outputPath);
  const now = new Date().toISOString();
  const output = {
    id: outputId,
    path: outputPath,
    taskName: childrenwearOutputDisplayName(payload.taskName || existing.taskName, existing.taskCode || childrenwearTaskCodeFromFolder(folder), existing.styleName || existing.category || '多SKU组合').slice(0, 80),
    masterPaths: localMasterPaths,
    combinationReferencePath,
    approved: false,
    approvedAt: '',
    reviewStatus: 'pending',
    issueNote: '',
    createdAt: now,
    startedAt: generationStartedAt.toISOString(),
    completedAt: generationCompletedAt.toISOString(),
    elapsedMs: Math.max(0, generationCompletedAt.getTime() - generationStartedAt.getTime()),
    billingCostMinor: Math.max(0, Number(bytes.billingAmountMinor) || 0),
    upstreamCostCnyMicro: Math.max(0, Number(bytes.upstreamCostCnyMicro) || 0),
    apiRequestCount: Math.max(1, Number(bytes.apiRequestCount) || 1),
    modelId: String(bytes.imageModel || config.imageModel || ''),
    relayId: String(bytes.relayId || ''),
    relayName: String(bytes.relayName || '')
  };
  const task = {
    ...existing,
    id: existing.id || path.basename(folder),
    folder,
    type: existing.type || 'combination',
    taskCode: normalizedChildrenwearTaskCode(existing.taskCode || payload.taskCode) || childrenwearTaskCodeFromFolder(folder),
    styleName: childrenwearStyleName(existing.styleName || existing.category || payload.taskName || '多SKU组合'),
    taskName: '',
    category: existing.category || '多 SKU 组合图',
    masterPaths: localMasterPaths,
    skuManifest,
    combinationReferencePath,
    combinationReferenceSpec: combinationReferenceAnalysis.analysis,
    combinationReferenceAnalysisHash: combinationReferenceAnalysis.contentHash,
    combinationVersion: version,
    combinationOutputs: [...(existing.combinationOutputs || []), output].slice(-50),
    createdAt: existing.createdAt || now
  };
  task.taskName = childrenwearTaskDisplayName(task.styleName, task.taskCode).slice(0, 80);
  options.reportProgress?.({ phase: 'completed', percent: 100, message: '组合图生成完成，等待成品审核' });
  return writeChildrenwearTask(folder, task);
}

async function getChildrenwearTask(folder) {
  const task = await readChildrenwearTask(String(folder || ''));
  return task ? publicChildrenwearTask(task) : null;
}

function compactChildrenwearBatchTask(stage, value = {}) {
  const common = {
    id: value.id || '',
    folder: value.folder || '',
    type: value.type || '',
    taskCode: value.taskCode || '',
    styleName: value.styleName || '',
    taskName: value.taskName || '',
    category: value.category || '',
    material: value.material || '',
    craft: value.craft || '',
    createdAt: value.createdAt || '',
    updatedAt: value.updatedAt || ''
  };
  if (stage === 'master') return {
    ...common,
    realPhotoPath: value.realPhotoPath || '',
    realPhotoUrl: value.realPhotoUrl || '',
    realPhotoThumbnailUrl: value.realPhotoThumbnailUrl || '',
    realPhotoPreviewUrl: value.realPhotoPreviewUrl || '',
    referencePath: value.referencePath || '',
    referenceUrl: value.referenceUrl || '',
    referenceThumbnailUrl: value.referenceThumbnailUrl || '',
    referencePreviewUrl: value.referencePreviewUrl || '',
    masterPath: value.masterPath || '',
    masterUrl: value.masterUrl || '',
    masterThumbnailUrl: value.masterThumbnailUrl || '',
    masterPreviewUrl: value.masterPreviewUrl || '',
    masterVersion: Number(value.masterVersion) || 1,
    masterApproved: value.masterApproved === true,
    masterApprovedAt: value.masterApprovedAt || '',
    masterReviewStatus: value.masterReviewStatus || 'pending'
  };
  if (stage === 'model') return {
    ...common,
    masterPath: value.masterPath || '',
    masterUrl: value.masterUrl || '',
    masterThumbnailUrl: value.masterThumbnailUrl || '',
    masterPreviewUrl: value.masterPreviewUrl || '',
    modelOutputs: Array.isArray(value.modelOutputs) && value.modelOutputs.length ? [value.modelOutputs.at(-1)] : []
  };
  return {
    ...common,
    masterPaths: Array.isArray(value.masterPaths) ? value.masterPaths : [],
    masterUrls: Array.isArray(value.masterUrls) ? value.masterUrls : [],
    masterThumbnailUrls: Array.isArray(value.masterThumbnailUrls) ? value.masterThumbnailUrls : [],
    masterPreviewUrls: Array.isArray(value.masterPreviewUrls) ? value.masterPreviewUrls : [],
    combinationReferencePath: value.combinationReferencePath || '',
    combinationReferenceUrl: value.combinationReferenceUrl || '',
    combinationReferenceThumbnailUrl: value.combinationReferenceThumbnailUrl || '',
    combinationReferencePreviewUrl: value.combinationReferencePreviewUrl || '',
    combinationOutputs: Array.isArray(value.combinationOutputs) && value.combinationOutputs.length ? [value.combinationOutputs.at(-1)] : []
  };
}

async function generateChildrenwearBatch(payload = {}, options = {}) {
  const stage = ['master', 'model', 'combination'].includes(payload.stage) ? payload.stage : '';
  if (!stage) throw new Error('童装批量生成阶段无效');
  const items = (Array.isArray(payload.items) ? payload.items : []).slice(0, 500);
  if (!items.length) throw new Error('没有可以生成的童装任务');
  const records = items.map((item, index) => ({ index, item: item || {} }));
  const groups = new Map();
  for (const record of records) {
    const folder = String(record.item.folder || '');
    const key = stage === 'model'
      ? `model:${record.index}`
      : folder
        ? `${stage}:${path.resolve(folder).toLocaleLowerCase('en-US')}`
        : `${stage}:new:${record.index}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  const results = new Array(records.length);
  const completedItems = [];
  let completed = 0;
  let failed = 0;
  const total = records.length;
  const concurrency = childrenwearAnalysisConcurrencyLimit(groups.size);
  const generate = stage === 'master'
    ? generateChildrenwearMaster
    : stage === 'model'
      ? generateChildrenwearModel
      : generateChildrenwearCombination;
  await options.reportProgress?.({ phase: 'running', current: 0, total, percent: 0, concurrency, message: `已提交 ${total} 个任务，服务端并发处理中` });
  await runWithConcurrency([...groups.values()], concurrency, async group => {
    for (const record of group) {
      const itemProgress = update => options.reportProgress?.({
        ...(update || {}),
        current: completed,
        total,
        concurrency,
        itemIndex: record.index,
        itemState: 'running',
        percent: Math.min(99, Math.round((completed / total) * 100)),
        message: update?.message || `正在处理第 ${record.index + 1} 个任务`
      });
      try {
        const value = await generate(record.item, { signal: options.signal, reportProgress: itemProgress });
        completed += 1;
        // The complete public task can contain the AI analysis manifests and all
        // historical outputs. Returning that object for every item makes the
        // browser parse a rapidly growing multi-megabyte job response. Return
        // only the current stage result so the UI can patch that one card in
        // place without another full-task request.
        const compactValue = compactChildrenwearBatchTask(stage, value);
        results[record.index] = {
          index: record.index,
          ok: true,
          value: compactValue
        };
        completedItems.push({ index: record.index, folder: value?.folder || '' });
        await options.reportProgress?.({
          phase: 'generating', current: completed, total, concurrency,
          itemIndex: record.index, itemState: 'completed',
          itemFolder: value?.folder || '', itemResult: compactValue, completedItems: completedItems.slice(),
          percent: Math.round((completed / total) * 100),
          message: `已完成 ${completed}/${total}`
        });
      } catch (error) {
        completed += 1;
        failed += 1;
        results[record.index] = { index: record.index, ok: false, error: error?.message || String(error) };
        completedItems.push({ index: record.index, folder: '', failed: true });
        await options.reportProgress?.({
          phase: 'generating', current: completed, total, concurrency,
          itemIndex: record.index, itemState: 'failed', itemError: error?.message || String(error),
          completedItems: completedItems.slice(),
          percent: Math.round((completed / total) * 100),
          message: `已完成 ${completed}/${total}，失败 ${failed}`
        });
      }
    }
  });
  return { stage, total, completed: total - failed, failed, concurrency, results };
}

async function initializeRuntime() {
  await Promise.all([
    fsp.mkdir(currentUserDataRoot(), { recursive: true }),
    fsp.mkdir(currentDefaultOutputRoot(), { recursive: true }),
    fsp.mkdir(path.join(currentWorkspaceRoot(), 'exports'), { recursive: true })
  ]);
  const [, apiSettings] = await Promise.all([loadConfig(), loadApiSettings()]);
  await billing.migrateLegacyBalances(apiSettings.activeRelayId || 'default-relay');
}

const runtimeExports = {
  DATA_ROOT,
  apiSettingsStatus,
  analyzeChildrenwearAssets,
  childrenwearAnalysisConcurrencyLimit,
  scanPendingChildrenwearAnalysis,
  approveReviewFolder,
  batchApproveReviewFolders,
  billing,
  financeLedger,
  createTemplateEditMask,
  deleteTemplateFolder,
  detectTemplateLightCabinetPanels,
  hasSemanticPrintableSurfaces,
  imageSchedulerSettingsForRequest,
  isOpenDrawerTemplatePrintAnalysis,
  openDrawerRegisteredPrintPrompt,
  deleteReviewFolders,
  deleteChildrenwearTasks,
  fileFromToken,
  fileToken,
  approveChildrenwearOutput,
  generateChildrenwearBatch,
  generateChildrenwearCombination,
  generateChildrenwearMaster,
  generateChildrenwearModel,
  generateFree,
  generateTask,
  generateTemplateTaskMaster,
  generateTemplateSetForFolder,
  getImageSchedulerSnapshot,
  getChildrenwearTask,
  getTemplatePreparation,
  imageUrl,
  invalidateImageLibraryIndex,
  invalidateChildrenwearAnalysisPaths,
  initializeRuntime,
  isOutputPath,
  isWorkspacePath,
  listTemplateFolders,
  listTemplates,
  listChildrenwearTasks,
  renameChildrenwearTask,
  loadApiSettings,
  loadConfig,
  loadPromptSettings,
  loadRelayChoices,
  planTemplateOutputJobs,
  runWithWorkspace,
  prepareTemplateFolder,
  prepareTemplateStructure,
  regenerateSingleTemplate,
  resetConfig,
  resetPromptSetting,
  reviewFolders,
  saveConfig,
  saveApiSettings,
  saveActiveRelay,
  publicApiConcurrencySettings,
  savePromptSetting,
  canAdminViewPromptSettings,
  saveTemplateRegions,
  scanImages,
  scanImageLibraryPage,
  setTemplateManualStatus,
  testApiSettings,
  testRelayHealth,
  validateTemplateOutputLayout,
  prepareTemplateGenerationCanvas,
  restoreTemplateGenerationCanvas,
  writeTemplateSizedImage
};

Object.defineProperties(runtimeExports, {
  OUTPUT_ROOT: { enumerable: true, get: currentDefaultOutputRoot },
  USER_DATA_ROOT: { enumerable: true, get: currentUserDataRoot },
  WORKSPACE_ID: { enumerable: true, get: currentWorkspaceId },
  WORKSPACE_ROOT: { enumerable: true, get: currentWorkspaceRoot }
});

module.exports = runtimeExports;
