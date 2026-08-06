const crypto = require('node:crypto');
const { AsyncLocalStorage } = require('node:async_hooks');
const { execFile } = require('node:child_process');
const sharp = require('sharp');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const XLSX = require('@e965/xlsx');
const {
  extractImageResult,
  isImagePath,
  safeFileName
} = require('./core/business');
const {
  generateStandaloneTitles,
  generateTaobaoTitle,
  getTitleRootCandidates,
  mergeImportedTitleLibrary,
  normalizeHeader,
  normalizeTitleText,
  parseTitleKeywordRows,
  parseTitlePrefixRoots,
  parseTitleNumber,
  splitTitleRoots
} = require('./core/title-engine');
const {
  createFallbackTemplateAnalysis,
  createManualTemplateAnalysis,
  normalizeTemplateProcessingMode,
  parseTemplateAnalysisSummary,
  readValidTemplateAnalysisCache,
  resolveGenerationAction,
  templateCachePaths,
  validateTemplateAnalysis,
  writeTemplateAnalysisCache
} = require('./core/template-regions');
const {
  appendOperationLog,
  applyBatchApproval,
  deriveFolderStatus,
  deriveImageStatus,
  isFolderReadyForTitle,
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
  advanceTitleGenerationState,
  createTitleWorkbookRows,
  getTitleCategoryForReviewFolder
} = require('./core/title-task-engine');
const { createDefaultTitleLibrary } = require('./core/default-title-library');
const {
  applyMasterPromptTemplate
} = require('./core/prompts');
const {
  buildTemplateAuditPayload,
  buildTemplateAuditRecheckPayload,
  isInvalidAuditRequestingProductReplacement,
  parseTemplateAuditResult
} = require('./core/template-audit');
const {
  buildProductProfileAnalysisRequest,
  createTaskProductProfilePayload,
  getTaskProductProfileFile,
  getTemplateProductProfileFile,
  loadProductProfileForJob,
  loadTemplateProductProfile,
  normalizeProductProfile,
  parseProductProfileChatResponse,
  readProductProfileFile,
  shouldRefreshTaskProductProfile,
  toPromptText,
  writeProductProfileFile
} = require('./core/product-profile');
const {
  definitionById: promptDefinitionById,
  normalizePromptValue,
  publicPromptSettings,
  renderPromptTemplate
} = require('./core/prompt-settings');
const { isSameOrChildPath } = require('./core/path-utils');
const {
  AdaptiveImageScheduler,
  RetryableRequestError,
  parseRetryAfterMs
} = require('./core/adaptive-image-scheduler');
const {
  createImageReferenceCache,
  imageApiSizeForDimensions
} = require('./core/image-reference-cache');
const {
  TAOBAO_CATEGORY_TEMPLATES,
  classifyTaobaoImages,
  isReviewReadyForTaobao,
  taobaoReviewBlockers,
  validateTaobaoImagePackage,
  templateById: taobaoTemplateById
} = require('./core/taobao-publish');
const { createBillingService } = require('./billing');


const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const configuredDataRoot = String(process.env.CAISHEN_DATA_DIR || 'data');
const DATA_ROOT = path.isAbsolute(configuredDataRoot) ? configuredDataRoot : path.resolve(PROJECT_ROOT, configuredDataRoot);
const SYSTEM_STATE_ROOT = path.join(DATA_ROOT, 'system');
const billing = createBillingService(DATA_ROOT);
const DEFAULT_WORKSPACE_ID = String(process.env.CAISHEN_WORKSPACE_ID || 'local').replace(/[^a-zA-Z0-9_-]/g, '') || 'local';
const workspaceContext = new AsyncLocalStorage();
const configuredOutputRoots = new Map();

function normalizeWorkspaceId(value) {
  return String(value || DEFAULT_WORKSPACE_ID).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80) || DEFAULT_WORKSPACE_ID;
}

function currentWorkspaceId() {
  return normalizeWorkspaceId(workspaceContext.getStore()?.workspaceId || DEFAULT_WORKSPACE_ID);
}

function currentModelPackageWorkspaceId() {
  return normalizeWorkspaceId(workspaceContext.getStore()?.modelPackageWorkspaceId || currentWorkspaceId());
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

function workspaceUserDataRoot(workspaceId) {
  return path.join(workspaceRoot(workspaceId), 'state');
}

function currentDefaultOutputRoot() {
  return path.join(currentWorkspaceRoot(), 'outputs');
}

function runWithWorkspace(workspaceId, worker, context = {}) {
  return workspaceContext.run({
    ...context,
    workspaceId: normalizeWorkspaceId(workspaceId),
    modelPackageWorkspaceId: normalizeWorkspaceId(context.modelPackageWorkspaceId || workspaceId)
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
  analysisKey: String(process.env.CAISHEN_ANALYSIS_API_KEY || '').trim(),
  imageModel: String(process.env.CAISHEN_IMAGE_MODEL || 'gpt-image-2').trim(),
  analysisModel: String(process.env.CAISHEN_REVERSE_PROMPT_MODEL || '').trim(),
  analysisWireApi: String(process.env.CAISHEN_ANALYSIS_WIRE_API || 'chat_completions').trim(),
  responseFormat: String(process.env.CAISHEN_IMAGE_RESPONSE_FORMAT || 'url').trim(),
  requestTimeoutSeconds: Number(process.env.CAISHEN_API_TIMEOUT_SECONDS || 300)
});
let runtimeApiSettings = { version: 2, ...ENV_API };
const FILE_TOKEN_SECRET = String(process.env.CAISHEN_FILE_TOKEN_SECRET || ENV_API.imageKey || 'local-development-only');

function currentApiSettings() {
  return runtimeApiSettings;
}

function requireApiConfig(channel = 'image') {
  const settings = currentApiSettings();
  if (!settings.baseUrl) throw new Error('è¯·å…ˆåœ¨ç³»ç»Ÿè®¾ç½®ä¸­é…ç½® API åœ°å€');
  if (channel === 'analysis' && !settings.analysisKey) throw new Error('è¯·å…ˆé…ç½®æ–‡å­—åˆ†æž API å¯†é’¥');
  if (channel === 'image' && !settings.imageKey) throw new Error('è¯·å…ˆé…ç½® Image2 ç”Ÿå›¾ API å¯†é’¥');
  return settings;
}

const DEFAULT_IMAGE_API_CONCURRENCY = Math.min(50, Math.max(1, Number(
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
const ANALYSIS_RETRY_BASE_MS = Math.max(1, Number(process.env.CAISHEN_ANALYSIS_RETRY_BASE_MS || 600));
const DEFAULT_ANALYSIS_API_CONCURRENCY = Math.min(12, Math.max(1, Number(
  process.env.CAISHEN_ANALYSIS_API_MAX_CONCURRENCY || 4
)));
const DEFAULT_ANALYSIS_API_INITIAL_CONCURRENCY = Math.min(DEFAULT_ANALYSIS_API_CONCURRENCY, Math.max(1, Number(
  process.env.CAISHEN_ANALYSIS_API_INITIAL_CONCURRENCY || 2
)));
const DEFAULT_ANALYSIS_API_START_INTERVAL_MS = Math.max(0, Number(
  process.env.CAISHEN_ANALYSIS_API_START_INTERVAL_MS || 500
));
const ANALYSIS_API_MAX_ATTEMPTS = Math.max(1, Number(process.env.CAISHEN_ANALYSIS_API_MAX_ATTEMPTS || 5));
const ANALYSIS_API_BACKOFF_BASE_MS = Math.max(250, Number(
  process.env.CAISHEN_ANALYSIS_API_BACKOFF_BASE_MS || 1500
));
const ANALYSIS_API_BACKOFF_MAX_MS = Math.max(ANALYSIS_API_BACKOFF_BASE_MS, Number(
  process.env.CAISHEN_ANALYSIS_API_BACKOFF_MAX_MS || 60000
));
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
// Text analysis has a lower, independent ceiling: image-package concurrency can be far too high for vision LLM requests.
const analysisApiScheduler = new AdaptiveImageScheduler({
  initialConcurrency: DEFAULT_ANALYSIS_API_INITIAL_CONCURRENCY,
  maxConcurrency: DEFAULT_ANALYSIS_API_CONCURRENCY,
  minStartIntervalMs: DEFAULT_ANALYSIS_API_START_INTERVAL_MS,
  healthyWindowSize: 8,
  healthySuccessRatio: 0.9,
  maxAttempts: ANALYSIS_API_MAX_ATTEMPTS,
  baseBackoffMs: ANALYSIS_API_BACKOFF_BASE_MS,
  maxBackoffMs: ANALYSIS_API_BACKOFF_MAX_MS
});
const imageReferenceCache = createImageReferenceCache({
  cacheRoot: path.join(SYSTEM_STATE_ROOT, 'image-reference-cache'),
  maxEdge: 2048,
  jpegQuality: 92,
  conversionConcurrency: 2
});
const warmingTemplateFolders = new Set();

function getImageSchedulerSnapshot() {
  return imageApiScheduler.snapshot();
}

let mainWindow;
let promptSettingsWriteChain = Promise.resolve();
let apiSettingsWriteChain = Promise.resolve();

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

function modelPackageSelectionFile() {
  return path.join(workspaceUserDataRoot(currentModelPackageWorkspaceId()), 'model-package-selection.json');
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
  if (text.length > 2000) throw new Error('API åœ°å€è¿‡é•¿');
  let parsed;
  try { parsed = new URL(text); } catch { throw new Error('API åœ°å€æ ¼å¼ä¸æ­£ç¡®'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('API åœ°å€åªæ”¯æŒ http æˆ– https');
  return text;
}

function normalizeModelName(value, fallback) {
  const text = String(value || fallback || '').trim();
  if (!text || text.length > 120 || /[\r\n]/.test(text)) throw new Error('æ¨¡åž‹åç§°æ ¼å¼ä¸æ­£ç¡®');
  return text;
}

function normalizeOptionalModelName(value) {
  const text = String(value || '').trim();
  if (text.length > 120 || /[\r\n]/.test(text)) throw new Error('æ¨¡åž‹åç§°æ ¼å¼ä¸æ­£ç¡®');
  return text;
}

function normalizeResponseFormat(value, fallback = 'url') {
  const text = String(value || fallback || 'url').trim();
  if (!['b64_json', 'url'].includes(text)) throw new Error('å›¾ç‰‡å“åº”æ ¼å¼ä¸æ”¯æŒ');
  return text;
}

function normalizeRequestTimeoutSeconds(value, fallback = 300) {
  const number = Number(value ?? fallback);
  if (!Number.isFinite(number) || number < 1 || number > 600) throw new Error('è¯·æ±‚è¶…æ—¶å¿…é¡»åœ¨ 1 åˆ° 600 ç§’ä¹‹é—´');
  return Math.round(number);
}

function normalizeImageConcurrencySettings(value = {}, fallback = {}) {
  const maxValue = Number(value.imageMaxConcurrency ?? value.ImageMaxConcurrency ?? fallback.imageMaxConcurrency ?? DEFAULT_IMAGE_API_CONCURRENCY);
  const initialValue = Number(value.imageInitialConcurrency ?? value.ImageInitialConcurrency ?? fallback.imageInitialConcurrency ?? DEFAULT_IMAGE_API_INITIAL_CONCURRENCY);
  const intervalValue = Number(value.imageStartIntervalMs ?? value.ImageStartIntervalMs ?? fallback.imageStartIntervalMs ?? DEFAULT_IMAGE_API_START_INTERVAL_MS);
  const maxConcurrency = Math.min(50, Math.max(1, Math.trunc(Number.isFinite(maxValue) ? maxValue : DEFAULT_IMAGE_API_CONCURRENCY)));
  const initialConcurrency = Math.min(maxConcurrency, Math.max(1, Math.trunc(Number.isFinite(initialValue) ? initialValue : DEFAULT_IMAGE_API_INITIAL_CONCURRENCY)));
  const startInterval = Math.min(60000, Math.max(0, Math.trunc(Number.isFinite(intervalValue) ? intervalValue : DEFAULT_IMAGE_API_START_INTERVAL_MS)));
  return { imageInitialConcurrency: initialConcurrency, imageMaxConcurrency: maxConcurrency, imageStartIntervalMs: startInterval };
}

function applyImageSchedulerSettings(settings = {}) {
  const normalized = normalizeImageConcurrencySettings(settings);
  imageApiScheduler.configure({
    initialConcurrency: normalized.imageInitialConcurrency,
    maxConcurrency: normalized.imageMaxConcurrency,
    minStartIntervalMs: normalized.imageStartIntervalMs
  });
  return normalized;
}

function apiConcurrencyLimit(total = Infinity) {
  const normalized = normalizeImageConcurrencySettings(currentApiSettings());
  const max = Math.max(1, normalized.imageMaxConcurrency || DEFAULT_IMAGE_API_CONCURRENCY);
  const count = Number(total);
  if (!Number.isFinite(count)) return max;
  return Math.min(max, Math.max(1, Math.trunc(count)));
}

function publicApiConcurrencySettië÷æÚ$z{-®éÜj×F—FÆUF6³òæf—'7EF—FÆR’F‡&÷ræWrW'&÷"‚~K»¾Xª{Ë®[	j~š)ŽûÈÎŠû~XXŽyIþh‰j~š)‚r“°¢6öç7B–ÖvW2Ò6Æ76–g•Fö&ô–ÖvW2‡&Wf–Wræ¦ö'2ÇÂµÒ“°¢6öç7B–ÖvU6¶vRÒfÆ–FFUFö&ô–ÖvU6¶vR†–ÖvW2“°¢–b‚–ÖvU6¶vRæö²’F‡&÷ræWrW'&÷"†Xù[ˆ>K»¾Xª{Ë®[	G¶–ÖvU6¶vRæÖ—76–æræ¦ö–â‚~8r—Ö“°¢6öç7Bæ÷rÒæWrFFR‚’çFô•4õ7G&–ær‚“°¢6öç7B–BÒFö&õV&Æ—6…F6´–B†föÆFW"Â6FVv÷'”–B“°¢6öç7B7FFRÒv—B&VEFö&õV&Æ—6…7FFR‚“°¢6öç7BW†—7F–æt–æFW‚Ò7FFRçF6·2æf–æD–æFW‚†—FVÒÓâ—FVÒæ–BÓÓÒ–BÇÂF‚ç&W6öÇfR†—FVÒæföÆFW"ÇÂrr’ÓÓÒF‚ç&W6öÇfR†föÆFW"’“°¢6öç7B&V6÷&BÒ°¢–BÀ¢föÆFW"À¢6FVv÷'”–BÀ¢7FGW3¢~zØž[è^hù.K»nhê^iKbrÀ¢f–ÇW&U&V6öã¢rrÀ¢VWVVDC¢æ÷rÀ¢WFFVDC¢æ÷rÀ¢GFV×G3¢W†—7F–æt–æFW‚ãÒòçVÖ&W"‡7FFRçF6·5¶W†—7F–æt–æFW…ÒæGFV×G2ÇÂ’²¢¢Ó°¢–b†W†—7F–æt–æFW‚ãÒ’7FFRçF6·2ç7Æ–6R†W†—7F–æt–æFW‚ÂÂ&V6÷&B“°¢VÇ6R7FFRçF6·2çW6‚‡&V6÷&B“°¢v—Bw&—FUFö&õV&Æ—6…7FFR‡7FFR“°¢&WGW&â†v—BFö&õV&Æ—6„&6UF6·2‚’’æf–æB†—FVÒÓâ—FVÒæ–BÓÓÒ–B’ÇÂ&V6÷&C°§Ð ¦7–æ2gVæ7F–öâvWEFö&õV&Æ—6…6¶vR†–B’°¢6öç7B7FFRÒv—B&VEFö&õV&Æ—6…7FFR‚“°¢6öç7B&V6÷&BÒ7FFRçF6·2æf–æB†—FVÒÓâ—FVÒæ–BÓÓÒ–B“°¢–b‚&V6÷&B’F‡&÷ræWrW'&÷"‚~Xù[ˆ>K»¾XªKˆÞZÙŽYÊ‚r“°¢6öç7B6WGF–æw2Òv—BvWEFö&õV&Æ—6…6WGF–æw2‚“°¢6öç7B6FVv÷'’Ò6WGF–æw2æ6FVv÷&–W2æf–æB†—FVÒÓâ—FVÒæ–BÓÓÒ&V6÷&Bæ6FVv÷'”–B“°¢–b‚6FVv÷'’’F‡&÷ræWrW'&÷"‚~Xù[ˆ>{¾yºîKˆÞZÙŽYÊ‚r“°¢6öç7B&Wf–WrÒ†v—B&Wf–WtföÆFW'2‚’’æf–æB†—FVÒÓâF‚ç&W6öÇfR†—FVÒæföÆFW"’ÓÓÒF‚ç&W6öÇfR‡&V6÷&BæföÆFW"’“°¢–b‚&Wf–WrÇÂ—5&Wf–Wu&VG”f÷%Fö&ò‡&Wf–Wr’’F‡&÷ræWrW'&÷"‚~K»¾XªKˆÞXhÞkº‹k>Xù[ˆ>iÚK»br“°¢6öç7BF—FÆUF6²Ò†v—BÆ—7E&VG•F—FÆUF6·2‚’’æf–æB†—FVÒÓâF‚ç&W6öÇfR†—FVÒæföÆFW"’ÓÓÒF‚ç&W6öÇfR‡&V6÷&BæföÆFW"’“°¢–b‚F—FÆUF6³òæf—'7EF—FÆR’F‡&÷ræWrW'&÷"‚~K»¾Xª{Ë®[	j~š)‚r“°¢6öç7B–ÖvW2Ò6Æ76–g•Fö&ô–ÖvW2‡&Wf–Wræ¦ö'2ÇÂµÒ“°¢6öç7B–ÖvU6¶vRÒfÆ–FFUFö&ô–ÖvU6¶vR†–ÖvW2“°¢–b‚–ÖvU6¶vRæö²’F‡&÷ræWrW'&÷"†Xù[ˆ>K»¾Xª{Ë®[	G¶–ÖvU6¶vRæÖ—76–æræ¦ö–â‚~8r—Ö“°¢&WGW&â°¢–C¢&V6÷&Bæ–BÀ¢föÆFW#¢&V6÷&BæföÆFW"À¢æÖS¢&Wf–WrææÖRÀ¢6FVv÷'”–C¢&V6÷&Bæ6FVv÷'”–BÀ¢6FVv÷'’À¢F—FÆS¢F—FÆUF6²æf—'7EF—FÆRÀ¢–ÖvW2À¢7&VFVDC¢&V6÷&BçVWVVDBÇÂ&V6÷&BçWFFVDBÇÂæWrFFR‚’çFô•4õ7G&–ær‚¢Ó°§Ð ¦7–æ2gVæ7F–öâ6Æ–ÕFö&õV&Æ—6…F6²‡–ÆöBÒ·Ò’°¢6öç7B6WGF–æw2Òv—BvWEFö&õV&Æ—6…6WGF–æw2‚“°¢–b…7G&–ær‡–ÆöBçFö¶VâÇÂrr’ÓÒ6WGF–æw2çFö¶Vâ’F‡&÷ræWrW'&÷"‚~kyŽZéÞXù[ˆ>Xªžh˜¾KºNx˜ÎiziX‚r“°¢6öç7B7FFRÒv—B&VEFö&õV&Æ—6…7FFR‚“°¢6öç7B&V6÷&BÒ7FFRçF6·2æf–æB†—FVÒÓâ—FVÒç7FGW2ÓÓÒ~zØž[è^hù.K»nhê^iKbr“°¢–b‚&V6÷&B’&WGW&âçVÆÃ°¢6öç7Bæ÷rÒæWrFFR‚’çFô•4õ7G&–ær‚“°¢&V6÷&Bç7FGW2Ò~hù.K»n[{.hê^iKbs°¢&V6÷&BæW‡FVç6–öä–BÒ7G&–ær‡–ÆöBæW‡FVç6–öä–BÇÂrr“°¢&V6÷&BçWFFVDBÒæ÷s°¢v—Bw&—FUFö&õV&Æ—6…7FFR‡7FFR“°¢&WGW&âvWEFö&õV&Æ—6…6¶vR‡&V6÷&Bæ–B“°§Ð ¦7–æ2gVæ7F–öâWFFUFö&õV&Æ—6…7FGW2†–BÂ–ÆöBÒ·Ò’°¢6öç7B6WGF–æw2Òv—BvWEFö&õV&Æ—6…6WGF–æw2‚“°¢–b‡–ÆöBçFö¶VâÒçVÆÂbb7G&–ær‡–ÆöBçFö¶VâÇÂrr’ÓÒ6WGF–æw2çFö¶Vâ’F‡&÷ræWrW'&÷"‚~kyŽZéÞXù[ˆ>Xªžh˜¾KºNx˜ÎiziX‚r“°¢6öç7BÆÆ÷vVBÒæWr6WB…²~zØž[è^hù.K»nhê^iKbrÂ~hù.K»n[{.hê^iKbrÂ~jÚ>YÊŽh™>[ÈkyŽZéÞš^™Ú"rÂ~jÚ>YÊŽZ¾XižZÙ~jëRrÂ~jÚ>YÊŽKˆ®KÊY»îx˜rrÂ~jÚ>YÊŽKùÞZÙŽˆØžz‹òrÂ~[{.KùÞZÙŽˆØžz‹òrÂ~ZK‹JRuÒ“°¢6öç7B7FFRÒv—B&VEFö&õV&Æ—6…7FFR‚“°¢6öç7B&V6÷&BÒ7FFRçF6·2æf–æB†—FVÒÓâ—FVÒæ–BÓÓÒ–B“°¢–b‚&V6÷&B’F‡&÷ræWrW'&÷"‚~Xù[ˆ>K»¾XªKˆÞZÙŽYÊ‚r“°¢6öç7B7FGW2Ò7G&–ær‡–ÆöBç7FGW2ÇÂ&V6÷&Bç7FGW2“°¢–b†ÆÆ÷vVBæ†2‡7FGW2’’&V6÷&Bç7FGW2Ò7FGW3°¢&V6÷&Bæf–ÇW&U&V6öâÒ7G&–ær‡–ÆöBæf–ÇW&U&V6öâÇÂ–ÆöBæW'&÷"ÇÂrr“°¢&V6÷&BæFWF–ÂÒ–ÆöBæFWF–ÂbbG—Vöb–ÆöBæFWF–ÂÓÓÒvö&¦V7Brò–ÆöBæFWF–Â¢&V6÷&BæFWF–ÂÇÂ·Ó°¢&V6÷&BçWFFVDBÒæWrFFR‚’çFô•4õ7G&–ær‚“°¢v—Bw&—FUFö&õV&Æ—6…7FFR‡7FFR“°¢&WGW&â&V6÷&C°§Ð ¦7–æ2gVæ7F–öâf–æE&Wf–Wt¦ö"†föÆFW"Â&VÆF—fUF‚’°¢6öç7B6÷W&6RÒv—B&VE6÷W&6TÖWFFF†föÆFW"“°¢–b‚6÷W&6RçFV×ÆFTföÆFW%F‚ÇÂg2æW†—7G57–æ2‡6÷W&6RçFV×ÆFTföÆFW%F‚’’F‡&÷ræWrW'&÷"‚~K»¾Xª{Ë®[	ZY~Y»îih~K»nZK’r“°¢6öç7BvçFVBÒ7G&–ær‡&VÆF—fUF‚ÇÂrr’ç&WÆ6TÆÂ‚uÅÂrÂròr’çFôÆö6ÆTÆ÷vW$66R‚w¦‚Ô4âr“°¢6öç7B6VÆV7FVEF‡2ÒæWr6WB‚‡6÷W&6RçFV×ÆFU&VÆF—fUF‡2ÇÂµÒ’æÖ‡fÇVRÓâ7G&–ær‡fÇVR’ç&WÆ6TÆÂ‚uÅÂrÂròr’çFôÆö6ÆTÆ÷vW$66R‚w¦‚Ô4âr’’“°¢6öç7B¦ö"Ò†v—B'V–ÆEFV×ÆFT¦ö'2‡6÷W&6RçFV×ÆFTföÆFW%F‚ÂföÆFW"’’æf–æB†—FVÒÓâ°¢6öç7Bæ÷&ÖÆ—¦VBÒ—FVÒç&VÆF—fUF‚ç&WÆ6TÆÂ‚uÅÂrÂròr’çFôÆö6ÆTÆ÷vW$66R‚w¦‚Ô4âr“°¢&WGW&âæ÷&ÖÆ—¦VBÓÓÒvçFVBbb‚6VÆV7FVEF‡2ç6—¦RÇÂ6VÆV7FVEF‡2æ†2†æ÷&ÖÆ—¦VB’“°¢Ò“°¢–b‚¦ö"’F‡&÷ræWrW'&÷"†iÊ®h›îX‹ZY~Y»îY»îx˜~ûÉ¢G·&VÆF—fUF‡Ö“°¢&WGW&â¦ö#°§Ð ¦7–æ2gVæ7F–öâ&W6öÇfU&Wf–Wu&VfW&Væ6U&W7VÇEF‚†föÆFW"Â&VÆF—fUF‚’°¢6öç7BfÇVRÒ7G&–ær‡&VÆF—fUF‚ÇÂrr’çG&–Ò‚“°¢–b‚fÇVR’&WGW&ârs°¢6öç7B&VfW&Væ6T¦ö"Òv—Bf–æE&Wf–Wt¦ö"†föÆFW"ÂfÇVR“°¢–b‚&VfW&Væ6T¦ö"æ÷WGWEF‚ÇÂg2æW†—7G57–æ2‡&VfW&Væ6T¦ö"æ÷WGWEF‚’’°¢F‡&÷ræWrW'&÷"†Xø.ˆ>{¹>iéÎY»î[	®iÊ®yIþh‰ûÉ¢G·&VfW&Væ6T¦ö"ç&VÆF—fUF‡Ö“°¢Ð¢&WGW&â&VfW&Væ6T¦ö"æ÷WGWEFƒ°§Ð ¦7–æ2gVæ7F–öâ6WEFV×ÆFTÖçVÅ7FGW2‡–ÆöB’°¢6öç7BföÆFW"Ò7G&–ær‡–ÆöCòæföÆFW"ÇÂrr“°¢–b‚föÆFW"ÇÂg2æW†—7G57–æ2†föÆFW"’’F‡&÷ræWrW'&÷"‚~K»¾Xªih~K»nZKžKˆÞZÙŽYÊ‚r“°¢6öç7B¦ö"Òv—Bf–æE&Wf–Wt¦ö"†föÆFW"Â–ÆöCòç&VÆF—fUF‚“°¢6öç7B7FGW2Ò–ÆöCòç7FGW2ÓÓÒ~K«®[z^KˆÞ˜	®‹ørrò~K«®[z^KˆÞ˜	®‹ørr¢~K«®[z^˜	®‹ørs°¢6öç7BWFFVDBÒæWrFFR‚’çFô•4õ7G&–ær‚“°¢6öç7BF‡2ÒÖWFFFF‡2†föÆFW"Â¦ö"ç&VÆF—fUF‚“°¢v—Bw&—FT§6öäf–ÆR‡F‡2æÖçVÅ&Wf–WrÂFõwdÖçVÅ&Wf–Wu7FFR‡7FGW2ÂWFFVDB’“°¢6öç7B&Wf–WuF‡2ÒÖWFFFF‡2†föÆFW"“°¢6öç7B7W'&VçBÒæ÷&ÖÆ—¦U&Wf–WtÖWFFF†v—B&VD§6öäf–ÆR‡&Wf–WuF‡2æÖ5&Wf–WrÂ·Ò’“°¢6öç7B–ÖvW2Ò7W'&VçBæ–ÖvW2æf–ÇFW"†–ÖvRÓâ–ÖvRç&VÆF—fUF‚ç&WÆ6TÆÂ‚uÅÂrÂròr’çFôÆö6ÆTÆ÷vW$66R‚w¦‚Ô4âr’ÓÒ¦ö"ç&VÆF—fUF‚ç&WÆ6TÆÂ‚uÅÂrÂròr’çFôÆö6ÆTÆ÷vW$66R‚w¦‚Ô4âr’“°¢–ÖvW2çW6‚‡²&VÆF—fUFƒ¢¦ö"ç&VÆF—fUF‚Â÷WGWEFƒ¢¦ö"æ÷WGWEF‚Â÷WGWDW†—7G3¢g2æW†—7G57–æ2†¦ö"æ÷WGWEF‚’ÂÖçVÅ7FGW3¢7FGW2Â&Wf–WvVDC¢WFFVDBÒ“°¢v—Bw&—FT§6öäf–ÆR‡&Wf–WuF‡2æÖ5&Wf–WrÂFôÖ5&Wf–WtÖWFFF†7W'&VçBÂ²–ÖvW2Â&Wf–WvVDC¢WFFVDBÒ’“°¢v—BFD÷W&F–öäÆör†föÆFW"ÂG·7FGW2ÓÓÒ~K«®[z^˜	®‹ørrò~K«®[z^j~Šë˜	®‹ørr¢~K«®[z^j~ŠëKˆÞ˜	®‹ørwÞûÉ¢G¶¦ö"ç&VÆF—fUF‡Ö“°¢&WGW&âG'VS°§Ð ¦7–æ2gVæ7F–öâ&÷fU&Wf–WtföÆFW"†föÆFW"ÂÆÆ÷u6¶—ÒfÇ6R’°¢–b‚föÆFW"ÇÂg2æW†—7G57–æ2†föÆFW"’’F‡&÷ræWrW'&÷"‚~K»¾Xªih~K»nZKžKˆÞZÙŽYÊ‚r“°¢6öç7B6÷W&6RÒv—B&VE6÷W&6TÖWFFF†föÆFW"“°¢–b‚6÷W&6RçFV×ÆFTföÆFW%F‚ÇÂg2æW†—7G57–æ2‡6÷W&6RçFV×ÆFTföÆFW%F‚’’°¢v—Bw&—FT§6öäf–ÆR†ÖWFFFF‡2†föÆFW"’æÖ5&Wf–WrÂ²7FGW3¢~[{.˜	®‹ørrÂ&Wf–WvVDC¢æWrFFR‚’çFô•4õ7G&–ær‚’Ò“°¢v—BFD÷W&F–öäÆör†föÆFW"Â~K«®[z^˜	®‹ø~K»¾Xªr“°¢&WGW&â²&÷fVC¢G'VRÂ6†ævVC¢Ó°¢Ð¢6öç7B6VÆV7FVEF‡2ÒæWr6WB‚‡6÷W&6RçFV×ÆFU&VÆF—fUF‡2ÇÂµÒ’æÖ‡fÇVRÓâ7G&–ær‡fÇVR’ç&WÆ6TÆÂ‚uÅÂrÂròr’çFôÆö6ÆTÆ÷vW$66R‚w¦‚Ô4âr’’“°¢6öç7B¦ö'2Ò†v—B'V–ÆEFV×ÆFT¦ö'2‡6÷W&6RçFV×ÆFTföÆFW%F‚ÂföÆFW"’¢æf–ÇFW"†¦ö"Óâ6VÆV7FVEF‡2ç6—¦RÇÂ6VÆV7FVEF‡2æ†2†¦ö"ç&VÆF—fUF‚ç&WÆ6TÆÂ‚uÅÂrÂròr’çFôÆö6ÆTÆ÷vW$66R‚w¦‚Ô4âr’’“°¢6öç7B7F–öæ&ÆT¦ö'2ÒµÓ°¢f÷"†6öç7B¦ö"öb¦ö'2’°¢6öç7B²7VÖÖ'’ÒÒv—BFV×ÆFTæÇ—6—4f÷$¦ö"†¦ö"“°¢–b‡7VÖÖ'’æ7F–öâÓÒw6¶—ö6÷’r’7F–öæ&ÆT¦ö'2çW6‚†¦ö"“°¢Ð¢6öç7BÖ—76–ærÒ7F–öæ&ÆT¦ö'2æf–ÇFW"†¦ö"Óâg2æW†—7G57–æ2†¦ö"æ÷WGWEF‚’“°¢–b†Ö—76–æræÆVæwF‚’°¢v—BFD÷W&F–öäÆör†föÆFW"Âh›ž˜xþ˜	®‹ø~K»¾XªX‰~ŠŽûÉ®‹ùŽiÈ’G¶Ö—76–æræÆVæwF‡Ò[ÊiÊ®yIþh‰ûÈÎiÊ®[Ù.j6“°¢–b†ÆÆ÷u6¶—’&WGW&â²&÷fVC¢fÇ6RÂÖ—76–æs¢Ö—76–æræÆVæwF‚Ó°¢F‡&÷ræWrW'&÷"†‹ùŽiÈ’G¶Ö—76–æræÆVæwF‡Ò[ÊZY~Y»îiÊ®yIþh‰“°¢Ð¢6öç7BWFFVDBÒæWrFFR‚’çFô•4õ7G&–ær‚“°¢f÷"†6öç7B¦ö"öb7F–öæ&ÆT¦ö'2’v—Bw&—FT§6öäf–ÆR†ÖWFFFF‡2†föÆFW"Â¦ö"ç&VÆF—fUF‚’æÖçVÅ&Wf–WrÂFõwdÖçVÅ&Wf–Wu7FFR‚~K«®[z^˜	®‹ørrÂWFFVDB’“°¢6öç7B–ÖvW2Ò7F–öæ&ÆT¦ö'2æÖ†¦ö"Óâ‡²&VÆF—fUFƒ¢¦ö"ç&VÆF—fUF‚Â÷WGWEFƒ¢¦ö"æ÷WGWEF‚Â÷WGWDW†—7G3¢G'VRÂÖçVÅ7FGW3¢~K«®[z^˜	®‹ørrÂ&Wf–WvVDC¢WFFVDBÒ’“°¢v—Bw&—FT§6öäf–ÆR†ÖWFFFF‡2†föÆFW"’æÖ5&Wf–WrÂFôÖ5&Wf–WtÖWFFF‡²7FGW3¢~[{.˜	®‹ørrÒÂ²7FGW3¢~[{.˜	®‹ørrÂ&Wf–WvVDC¢WFFVDBÂ–ÖvW2Ò’“°¢v—BFD÷W&F–öäÆör†föÆFW"Âh›ž˜xþ˜	®‹ø~K»¾XªX‰~ŠŽûÉ®[{.j~ŠëG¶7F–öæ&ÆT¦ö'2æÆVæwF‡Ò[ÊY»îx˜~K‹®˜	®‹ø~ûÈÎ[›n[Ù.j>K»¾Xª“°¢&WGW&â²&÷fVC¢G'VRÂ6†ævVC¢7F–öæ&ÆT¦ö'2æÆVæwF‚Ó°§Ð ¦7–æ2gVæ7F–öâ&F6„&÷fU&Wf–WtföÆFW'2†föÆFW'2’°¢6öç7B&W7VÇG2ÒµÓ°¢f÷"†6öç7BföÆFW"öb²ââææWr6WB‚†föÆFW'2ÇÂµÒ’æÖ…7G&–ær’•Ò’&W7VÇG2çW6‚‡²föÆFW"Ââââ†v—B&÷fU&Wf–WtföÆFW"†föÆFW"ÂG'VR’’Ò“°¢&WGW&â&W7VÇG3°§Ð ¦7–æ2gVæ7F–öâFVÆWFU&Wf–WtföÆFW'2†föÆFW'2’°¢6öç7B÷WGWE&ö÷BÒF‚ç&W6öÇfR‚†v—BÆöD6öæf–r‚’’æ÷WGWEF‚ÇÂ7W'&VçDFVfVÇD÷WGWE&ö÷B‚’“°¢6öç7BW†—7F–ærÒ²ââææWr6WB‚†föÆFW'2ÇÂµÒ’æÖ…7G&–ær’•Òæf–ÇFW"†föÆFW"Óâ°¢6öç7B&W6öÇfVBÒF‚ç&W6öÇfR†föÆFW"“°¢&WGW&âg2æW†—7G57–æ2‡&W6öÇfVB’bb&W6öÇfVBÓÒ÷WGWE&ö÷Bbb—56ÖT÷$6†–ÆEF‚†÷WGWE&ö÷BÂ&W6öÇfVB“°¢Ò“°¢ÆWBFVÆWFVBÒ°¢f÷"†6öç7BföÆFW"öbW†—7F–ær’°¢v—Bg7ç&Ò†föÆFW"Â²&V7W'6—fS¢G'VRÂf÷&6S¢G'VRÒ“°¢FVÆWFVB³Ò°¢Ð¢&WGW&âFVÆWFVC°§Ð  ¦7–æ2gVæ7F–öâ&W6WD6öæf–r‚’°¢v—Bg7ç&Ò†6öæf–tf–ÆR‚’Â²f÷&6S¢G'VRÒ“°¢&WGW&â6fT6öæf–r†FVfVÇD6öæf–r‚’“°§Ð ¦7–æ2gVæ7F–öâvVæW&FTg&VR‡–ÆöBÒ·ÒÂ÷F–öç2Ò·Ò’°¢–b‚–ÆöBç6÷W&6UF‚ÇÂg2æW†—7G57–æ2‡–ÆöBç6÷W&6UF‚’’F‡&÷ræWrW'&÷"‚~Šû~˜žhºžk©Y»îx˜rr“°¢–b‚7G&–ær‡–ÆöBç&ö×BÇÂrr’çG&–Ò‚’’F‡&÷ræWrW'&÷"‚~Šû~‹é>XZ^yIþY»îhùzK®ŠøÒr“°¢6öç7B6öæf–rÒv—BÆöD6öæf–r‚“°¢6öç7BföÆFW"ÒF‚æ¦ö–â†6öæf–ræ÷WGWEF‚ÇÂ7W'&VçDFVfVÇD÷WGWE&ö÷B‚’Â~ˆz®yKyIþY»âr“°¢v—Bg7æÖ¶F—"†föÆFW"Â²&V7W'6—fS¢G'VRÒ“°¢6öç7B÷WGWEF‚ÒF‚æ¦ö–â†föÆFW"Âˆz®yKyIþY»åòG¶Æö6Äf–ÆUF–ÖW7F×‚—Òçæv“°¢v—Bg7çw&—FTf–ÆR†÷WGWEF‚Âv—BvVæW&FT–ÖvR…7G&–ær‡–ÆöBç&ö×B’çG&–Ò‚’Â·–ÆöBç6÷W&6UF…ÒÂ°¢6—¦S¢6öæf–ræ–ÖvU6—¦RÇÂs#Gƒ#BrÀ¢VÆ—G“¢6öæf–ræ–ÖvUVÆ—G’ÇÂvWFòrÀ¢&–ÆÆ–ætFW67&—F–öã¢~ˆz®yKyIþY»ârÀ¢&–ÆÆ–æu&VfW&Væ6S¢F‚æ&6VæÖR‡–ÆöBç6÷W&6UF‚’À¢&–ÆÆ–ætöæ6T¶W“¢&–ÆÆ–ætöæ6T¶W’‚v–ÖvS¦g&VRrÂ–ÆöBç6÷W&6UF‚Â7G&–ær‡–ÆöBç&ö×B’çG&–Ò‚’’À¢6–væÃ¢÷F–öç2ç6–væÀ¢Ò’“°¢&WGW&â²÷WGWEF‚ÂW&Ã¢–ÖvUW&Â†÷WGWEF‚’Ó°§Ð ¦7–æ2gVæ7F–öâ6fUF—FÆU6WGW‡–ÆöBÒ·Ò’°¢6öç7BÆ–'&'’Òv—BÆöEF—FÆTÆ–'&'’‚“°¢–b‚Æ–'&'’’F‡&÷ræWrW'&÷"‚~Šû~XXŽZûÎXZ^X[>™JîŠøÞŠ‚r“°¢Æ–'&'’ç&Vf—…&ö÷G2Ò'6UF—FÆU&Vf—…&ö÷G2‡–ÆöBç&Vf—†W2ÇÂrr“°¢Æ–'&'’ç&Vf—…&ö÷BÒÆ–'&'’ç&Vf—…&ö÷G5³ÒÇÂrs°¢Æ–'&'’ç&WV—&VE&ö÷G2Ò'6UF—FÆU&Vf—…&ö÷G2‡–ÆöBç&WV—&VE&ö÷G2ÇÂµÒ“°¢–b‚Æ–'&'’ç&Vf—…&ö÷G2æÆVæwF‚’F‡&÷ræWrW'&÷"‚~ˆ{>[	Z¾XižKˆKŠ®j~š)Ž[ÈZKNŠøÞj’r“°¢v—B6fT6FVv÷'•F—FÆTÆ–'&'’†Æ–'&'’“°¢&WGW&â6fUF—FÆTÆ–'&'’†Æ–'&'’“°§Ð ¦7–æ2gVæ7F–öâvVæW&FUF—FÆW2‡–ÆöBÒ·Ò’°¢6öç7BÆ–'&'’Òv—BÆöEF—FÆTÆ–'&'’‚“°¢–b‚Æ–'&'’’F‡&÷ræWrW'&÷"‚~Šû~XXŽZûÎXZ^X[>™JîŠøÞŠ‚r“°¢6öç7B&Vf—…&ö÷G2Ò'6UF—FÆU&Vf—…&ö÷G2‡–ÆöBç&Vf—†W2ÇÂÆ–'&'’ç&Vf—…&ö÷G2ÇÂµÒ“°¢6öç7B&WV—&VE&ö÷G2Ò'6UF—FÆU&Vf—…&ö÷G2‡–ÆöBç&WV—&VE&ö÷G2ÇÂÆ–'&'’ç&WV—&VE&ö÷G2ÇÂµÒ“°¢–b‚&Vf—…&ö÷G2æÆVæwF‚’F‡&÷ræWrW'&÷"‚~Šû~XXŽZ¾Xižˆ{>[	KˆKŠ®j~š)Ž[ÈZKNŠøÞj’r“°¢Æ–'&'’ç&Vf—…&ö÷G2Ò&Vf—…&ö÷G3°¢Æ–'&'’ç&Vf—…&ö÷BÒ&Vf—…&ö÷G5³Ó°¢Æ–'&'’ç&WV—&VE&ö÷G2Ò&WV—&VE&ö÷G3°¢6öç7BvVæW&F–öå7FFRÒv—BÆöEF—FÆTvVæW&F–öå7FFR‚“°¢vVæW&F–öå7FFRææW‡D–æFW†W2ÇÃÒvVæW&F–öå7FFRäæW‡D–æFW†W2ÇÂ·Ó°¢6öç7B¶W’ÒF—FÆTvVæW&F–öå7FFT¶W’†Æ–'&'’Â&Vf—…&ö÷G2“°¢6öç7B7F'Ef&–çD–æFW‚ÒçVÖ&W"†vVæW&F–öå7FFRææW‡D–æFW†W5¶¶W•Ò’âòçVÖ&W"†vVæW&F–öå7FFRææW‡D–æFW†W5¶¶W•Ò’¢°¢6öç7BvVæW&FVBÒvVæW&FU7FæFÆöæUF—FÆW2‡²Æ–'&'’Â&Vf—…&ö÷G2Â6÷VçC¢–ÆöBæ6÷VçBÂ7F'Ef&–çD–æFW‚Ò“°¢vVæW&F–öå7FFRææW‡D–æFW†W5¶¶W•ÒÒvVæW&FVBææW‡Ef&–çD–æFWƒ°¢v—B6fUF—FÆTvVæW&F–öå7FFR†vVæW&F–öå7FFR“°¢v—B6fT6FVv÷'•F—FÆTÆ–'&'’†Æ–'&'’“°¢v—B6fUF—FÆTÆ–'&'’†Æ–'&'’“°¢&WGW&âvVæW&FVBçF—FÆW3°§Ð ¦7–æ2gVæ7F–öâW‡÷'EF—FÆW2‡–ÆöBÒ·Ò’°¢6öç7BF—FÆW2Ò‡–ÆöBçF—FÆW2ÇÂµÒ’æÖ…7G&–ær’æf–ÇFW"„&ööÆVâ“°¢–b‚F—FÆW2æÆVæwF‚’F‡&÷ræWrW'&÷"‚~Šû~XXŽ˜žhºžŠhZûÎX{®y¨Nj~š)‚r“°¢6öç7Bf–ÆTæÖRÒG·6fTf–ÆTæÖR‡–ÆöBæ6FVv÷'’ÇÂ~h›ž˜xòr—Õþj~š)…òG¶Æö6Äf–ÆUF–ÖW7F×‚—Òç†Ç7†°¢6öç7Bf–ÆRÒF‚æ¦ö–â†ævWEF‚‚vF÷væÆöG2r’Âf–ÆTæÖR“°¢v—Bw&—FUF—FÆW5v÷&¶&öö²†f–ÆRÂ–ÆöBæ6FVv÷'’ÇÂrrÂF—FÆW2“°¢&WGW&âf–ÆS°§Ð ¦7–æ2gVæ7F–öâ–æ—F–Æ—¦U'VçF–ÖR‚’°¢v—B&öÖ—6RæÆÂ…°¢g7æÖ¶F—"†7W'&VçEW6W$FF&ö÷B‚’Â²&V7W'6—fS¢G'VRÒ’À¢g7æÖ¶F—"†7W'&VçDFVfVÇD÷WGWE&ö÷B‚’Â²&V7W'6—fS¢G'VRÒ’À¢g7æÖ¶F—"‡F‚æ¦ö–â†7W'&VçEv÷&·76U&ö÷B‚’ÂvW‡÷'G2r’Â²&V7W'6—fS¢G'VRÒ¢Ò“°¢v—B&öÖ—6RæÆÂ…¶ÆöD6öæf–r‚’ÂÆöD•6WGF–æw2‚•Ò“°§Ð ¦6öç7B'VçF–ÖTW‡÷'G2Ò°¢DDõ$ôõBÀ¢æÇ—¦U&öGV7E&öf–ÆRÀ¢æÇ—¦UFV×ÆFT—FVÕv—F…&VfW&Væ6RÀ¢æÇ—¦UFV×ÆFT—FV×2À¢æÇ—¦UFV×ÆFTföÆFW"À¢•6WGF–æw57FGW2À¢&÷fU&Wf–WtföÆFW"À¢&F6„&÷fU&Wf–WtföÆFW'2À¢&–ÆÆ–ærÀ¢FVÆWFUFV×ÆFTföÆFW"À¢FVÆWFU&Wf–WtföÆFW'2À¢W‡÷'EF—FÆW2À¢f–ÆTg&öÕFö¶VâÀ¢f–ÆUFö¶VâÀ¢vVæW&FTg&VRÀ¢vVæW&FUF6²À¢vVæW&FUFV×ÆFUF6´Ö7FW"À¢vVæW&FUFV×ÆFU6WDf÷$föÆFW"À¢vVæW&FUF—FÆTf÷%F6²À¢vVæW&FUF—FÆW2À¢vWEFö&õV&Æ—6…6¶vRÀ¢vWD–ÖvU66†VGVÆW%6æ6†÷BÀ¢vWEFö&õV&Æ—6…6WGF–æw2À¢vWEFV×ÆFU&W&F–öâÀ¢–ÖvUW&ÂÀ¢–×÷'EF—FÆTÆ–'&'’À¢–æ—F–Æ—¦U'VçF–ÖRÀ¢—4÷WGWEF‚À¢—5v÷&·76UF‚À¢Æ—7E&VG•F—FÆUF6·2À¢Æ—7EFö&õV&Æ—6…F6·2À¢ÆöDÖöFVÅ6¶vU6WGF–æw2À¢æ÷&ÖÆ—¦UFö&õV&Æ—6…6WGF–æw2À¢Æ—7EFV×ÆFTföÆFW'2À¢Æ—7EFV×ÆFW2À¢ÆöD•6WGF–æw2À¢ÆöD6öæf–rÀ¢ÆöE&ö×E6WGF–æw2À¢ÆöEFV×ÆFU&öGV7E&öf–ÆRÀ¢ÆöEF—FÆTÆ–'&'’À¢ÆåFV×ÆFT÷WGWD¦ö'2À¢V&Æ–5F—FÆTÆ–'&'’À¢'Våv—F…v÷&·76RÀ¢&W&UFV×ÆFTföÆFW"À¢&W&UFV×ÆFU7G'V7GW&RÀ¢&VvVæW&FTÖ7FW$f÷%&Wf–WtföÆFW"À¢&VvVæW&FU6–ævÆUFV×ÆFRÀ¢&W6WD6öæf–rÀ¢&W6WE&ö×E6WGF–ærÀ¢&Wf–WtföÆFW'2À¢6fT6öæf–rÀ¢6fT•6WGF–æw2À¢6fU6VÆV7FVDÖöFVÅ6¶vRÀ¢V&Æ–4”6öæ7W'&Væ7•6WGF–æw2À¢VWVUFö&õV&Æ—6…F6²À¢6Æ–ÕFö&õV&Æ—6…F6²À¢6fU&ö×E6WGF–ærÀ¢6fUFö&õV&Æ—6…6WGF–æw2À¢6fUF—FÆTf÷%F6²À¢6äFÖ–åf–Wu&ö×E6WGF–æw2À¢6fUFV×ÆFT6öæf–wW&F–öâÀ¢6fUFV×ÆFU&öGV7E&öf–ÆRÀ¢6fUF—FÆU6WGWÀ¢66ä–ÖvW2À¢6WEFV×ÆFTÖçVÅ7FGW2À¢WFFUFö&õV&Æ—6…7FGW2À¢FW7DæÇ—6—4’À¢FW7D•6WGF–æw2À¢fÆ–FFUFV×ÆFT÷WGWDÆ–÷W@§Ó° ¤ö&¦V7BæFVf–æU&÷W'F–W2‡'VçF–ÖTW‡÷'G2Â°¢õUEUEõ$ôõC¢²VçVÖW&&ÆS¢G'VRÂvWC¢7W'&VçDFVfVÇD÷WGWE&ö÷BÒÀ¢U4U%ôDDõ$ôõC¢²VçVÖW&&ÆS¢G'VRÂvWC¢7W'&VçEW6W$FF&ö÷BÒÀ¢tõ$µ54Uô”C¢²VçVÖW&&ÆS¢G'VRÂvWC¢7W'&VçEv÷&·76T–BÒÀ¢tõ$µ54Uõ$ôõC¢²VçVÖW&&ÆS¢G'VRÂvWC¢7W'&VçEv÷&·76U&ö÷BÐ§Ò“° ¦ÖöGVÆRæW‡÷'G2Ò'VçF–ÖTW‡÷'G3° 