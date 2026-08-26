const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env'), quiet: true });
const express = require('express');
const helmet = require('helmet');
const multer = require('multer');
const sharp = require('sharp');
const runtime = require('./runtime');
const { createAuthService } = require('./auth');
const { createAlipayRechargeService } = require('./alipay-recharge');
const { verifyBusinessRequest } = require('./business-link');
const { createBusinessSnapshotService } = require('./business-snapshot');
const { metadataPaths, normalizeSourceMetadata } = require('./core/review-engine');
const { isSameOrChildPath } = require('./core/path-utils');

const PORT = Math.max(1, Number(process.env.PORT || 8788));
const HOST = String(process.env.CAISHEN_HOST || '127.0.0.1');
const auth = createAuthService(runtime.DATA_ROOT);
const alipayRecharge = createAlipayRechargeService(runtime.DATA_ROOT, runtime.billing);
const businessSnapshot = createBusinessSnapshotService({
  auth,
  runtime,
  alipayRecharge,
  businessId: 'duoxiluka',
  businessName: '多嘻噜卡科技'
});
const tempRoot = () => path.join(runtime.WORKSPACE_ROOT, 'tmp');
const assetRoot = () => path.join(runtime.WORKSPACE_ROOT, 'assets');
const jobRoot = () => path.join(runtime.WORKSPACE_ROOT, 'jobs');
const thumbnailRoot = () => path.join(runtime.WORKSPACE_ROOT, '.cache', 'thumbnails');
const LONG_JOB_METHODS = new Set([
  'prepareTemplates', 'generateFree', 'generateTask', 'generateTemplateMaster',
  'generateTemplates', 'regenerateTemplate',
  'analyzeChildrenwearAssets', 'scanPendingChildrenwearAnalysis',
  'generateChildrenwearMaster', 'generateChildrenwearModel', 'generateChildrenwearCombination'
]);
const SUPERADMIN_RPC_METHODS = new Set([
  'getApiSettings', 'saveApiSettings', 'testApiSettings', 'testRelayHealth', 'savePromptSetting', 'resetPromptSetting'
]);
const childrenwearAutoAnalysisLastRuns = new Map();
let childrenwearAutoAnalysisSweepRunning = false;

async function runChildrenwearAutoAnalysisSweep() {
  if (childrenwearAutoAnalysisSweepRunning) return;
  childrenwearAutoAnalysisSweepRunning = true;
  try {
    const users = await auth.listUsers();
    const byWorkspace = new Map();
    for (const user of users) {
      if (user?.active === false || !user?.workspaceId) continue;
      const current = byWorkspace.get(user.workspaceId);
      if (!current || (current.role === 'superadmin' && user.role !== 'superadmin')) byWorkspace.set(user.workspaceId, user);
    }
    for (const user of byWorkspace.values()) {
      await runtime.runWithWorkspace(user.workspaceId, async () => {
        const config = await runtime.loadConfig();
        if (config.childrenwearAutoAnalysisEnabled !== true) return;
        const intervalMinutes = [1, 5, 10, 30, 60].includes(Number(config.childrenwearAutoAnalysisIntervalMinutes))
          ? Number(config.childrenwearAutoAnalysisIntervalMinutes)
          : 5;
        const now = Date.now();
        const lastRun = childrenwearAutoAnalysisLastRuns.get(user.workspaceId) || 0;
        if (now - lastRun < intervalMinutes * 60 * 1000) return;
        childrenwearAutoAnalysisLastRuns.set(user.workspaceId, now);
        const result = await runtime.scanPendingChildrenwearAnalysis({ includeFailed: false });
        if (result.total) console.log(`[childrenwear-analysis:${user.workspaceId}] 已并发分析 ${result.analyzed}/${result.total} 张素材`);
      }, { userRole: user.role || 'member', userId: user.id || '' }).catch(error => {
        console.warn(`[childrenwear-analysis:${user.workspaceId}] ${error?.message || error}`);
      });
    }
  } finally {
    childrenwearAutoAnalysisSweepRunning = false;
  }
}

function canAccessRpc(user, method) {
  const name = String(method || '');
  if (SUPERADMIN_RPC_METHODS.has(name)) return user?.role === 'superadmin';
  if (name === 'getPromptSettings') return isTeamAdmin(user);
  return true;
}

const isSuperAdmin = user => user?.role === 'superadmin';
const isTeamAdmin = user => user?.role === 'superadmin' || user?.role === 'admin';
const BILLING_AMOUNT_SCALE = 1_000_000;

function parseBillingUsdMinor(value) {
  const text = String(value ?? '').trim();
  if (!/^\d+(?:\.\d{0,6})?$/.test(text)) return NaN;
  const [whole, fraction = ''] = text.split('.');
  const major = Number(whole);
  if (!Number.isSafeInteger(major)) return NaN;
  const minor = major * BILLING_AMOUNT_SCALE + Number(fraction.padEnd(6, '0'));
  return Number.isSafeInteger(minor) ? minor : NaN;
}

function billingAmountMinorFromRequest(body) {
  const amountMinor = Number(body?.amountMinor);
  if (Number.isSafeInteger(amountMinor)) return amountMinor;
  const amountUsd = parseBillingUsdMinor(body?.amountUsd ?? body?.amount);
  if (Number.isSafeInteger(amountUsd)) return amountUsd;
  return amountMinor;
}

function roleName(role) {
  return { superadmin: '超级管理员', admin: '管理员', member: '成员' }[role] || '成员';
}

function visibleUsersForActor(users, actor) {
  if (actor.role === 'superadmin') return users;
  if (actor.role === 'admin') {
    return users.filter(user => user.id === actor.id || (user.role === 'member' && (!user.parentUserId || user.parentUserId === actor.id)));
  }
  return [];
}

function billingVisibleUsersForActor(users, actor) {
  if (actor.role === 'superadmin') return users;
  if (actor.role === 'admin') return visibleUsersForActor(users, actor);
  return [];
}

function canTransferUserBalance(actor, target) {
  if (!target) return false;
  if (actor.role === 'superadmin') return true;
  if (actor.role !== 'admin') return false;
  return target.id === actor.id
    || (target.role === 'member' && (!target.parentUserId || target.parentUserId === actor.id));
}

function canManageUser(actor, target) {
  if (!target) return false;
  if (actor.role === 'superadmin') return target.role !== 'superadmin' || target.id !== actor.id;
  if (actor.role === 'admin') return target.role === 'member' && (!target.parentUserId || target.parentUserId === actor.id);
  return false;
}
const MAX_ACTIVE_JOBS = Math.max(1, Number(process.env.CAISHEN_JOB_CONCURRENCY || 50));
const JOB_RATE_LIMIT_PER_HOUR = Math.max(10, Number(process.env.CAISHEN_JOB_RATE_LIMIT_PER_HOUR || 120));
const UPLOAD_FILE_LIMIT_MB = Math.max(1, Number(process.env.CAISHEN_UPLOAD_FILE_LIMIT_MB || 1024));
const UPLOAD_FILE_LIMIT_BYTES = Math.round(UPLOAD_FILE_LIMIT_MB * 1024 * 1024);
const pendingJobs = [];
const jobsByClientKey = new Map();
const activeJobControllers = new Map();
const jobRateWindows = new Map();
const loginRateWindows = new Map();
const assetSyncSessions = new Map();
const thumbnailJobs = new Map();

async function markInterruptedGenerationProgress(job, message) {
  const folder = String(job?.progress?.folder || '');
  if (!folder || !runtime.isWorkspacePath(folder)) return;
  const current = job.progress && typeof job.progress === 'object' ? job.progress : {};
  const next = {
    ...current,
    folder,
    phase: 'failed',
    message,
    updatedAt: new Date().toISOString()
  };
  try {
    const file = metadataPaths(folder).generationProgress;
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, JSON.stringify(next, null, 2), 'utf8');
  } catch {}
}
const thumbnailWaiters = [];
const THUMBNAIL_CONCURRENCY = Math.max(1, Math.min(6, Number(process.env.CAISHEN_THUMBNAIL_CONCURRENCY || 3)));
let activeThumbnails = 0;
let activeJobs = 0;
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => {
      const destination = tempRoot();
      fs.mkdirSync(destination, { recursive: true });
      callback(null, destination);
    },
    filename: (_req, _file, callback) => callback(null, `${Date.now()}-${crypto.randomBytes(10).toString('hex')}`)
  }),
  limits: { fileSize: UPLOAD_FILE_LIMIT_BYTES, files: 10000 }
});

function safeSegment(value, fallback = 'file') {
  const cleaned = String(value || '').normalize('NFC').replace(/[<>:"|?*\u0000-\u001f]/g, '-').replace(/^\.+$/, '').trim();
  return cleaned || fallback;
}

function uploadName(file) {
  const raw = String(file?.originalname || '');
  const decoded = Buffer.from(raw, 'latin1').toString('utf8');
  return decoded.includes('\ufffd') ? raw : decoded;
}

function safeRelative(value, fallback) {
  const parts = String(value || '').replaceAll('\\', '/').split('/').filter(part => part && part !== '.' && part !== '..');
  return parts.map(part => safeSegment(part)).join('/') || safeSegment(fallback);
}

function isWithin(root, candidate) {
  return isSameOrChildPath(root, candidate);
}

const decodeFileToken = token => runtime.fileFromToken(token);
const fileUrl = file => runtime.imageUrl(file);

const ZIP_CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < 256; index += 1) {
  let crc = index;
  for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
  ZIP_CRC_TABLE[index] = crc >>> 0;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = ZIP_CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function zipDosDateTime(input) {
  const date = input instanceof Date && !Number.isNaN(input.getTime()) ? input : new Date();
  return {
    date: (((date.getFullYear() - 1980) & 0x7f) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)
  };
}

function zipAttachmentName(name) {
  const fallback = safeSegment(name, 'task');
  const ascii = fallback.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}.zip"; filename*=UTF-8''${encodeURIComponent(`${fallback}.zip`)}`;
}

async function readZipSourceMetadata(folder) {
  const paths = metadataPaths(folder);
  for (const file of [paths.wpfSource, paths.macSource]) {
    try {
      return normalizeSourceMetadata(JSON.parse(await fsp.readFile(file, 'utf8')));
    } catch {
      // Try the next known metadata location.
    }
  }
  return normalizeSourceMetadata({});
}

function zipDateStamp(folder, fallbackDate = new Date()) {
  const match = path.basename(folder).match(/^(\d{4})(?:-|$)/);
  if (match) return match[1];
  return `${String(fallbackDate.getMonth() + 1).padStart(2, '0')}${String(fallbackDate.getDate()).padStart(2, '0')}`;
}

function normalizedComparablePath(value) {
  return path.resolve(String(value || '')).toLocaleLowerCase('en-US');
}

function sameTemplateSource(left, right) {
  if (!left || !right) return false;
  if (normalizedComparablePath(left) === normalizedComparablePath(right)) return true;
  return path.basename(left).toLocaleLowerCase('zh-CN') === path.basename(right).toLocaleLowerCase('zh-CN');
}

async function buildZipDownloadName(folder) {
  try {
    const task = JSON.parse(await fsp.readFile(path.join(folder, 'childrenwear-task.json'), 'utf8'));
    if (String(task?.taskName || '').trim()) return safeSegment(String(task.taskName).trim(), '童装款式');
  } catch {}
  const source = await readZipSourceMetadata(folder);
  const templateFolderPath = source.templateFolderPath;
  const templateName = safeSegment(templateFolderPath ? path.basename(templateFolderPath) : path.basename(folder), 'task');
  const stamp = zipDateStamp(folder);
  let sequence = 1;

  try {
    const parent = path.dirname(folder);
    const siblings = await fsp.readdir(parent, { withFileTypes: true });
    const matching = [];
    for (const entry of siblings) {
      if (!entry.isDirectory() || zipDateStamp(entry.name) !== stamp) continue;
      const siblingFolder = path.join(parent, entry.name);
      const siblingSource = await readZipSourceMetadata(siblingFolder);
      if (sameTemplateSource(siblingSource.templateFolderPath, templateFolderPath)) matching.push(siblingFolder);
    }
    matching.sort((a, b) => path.basename(a).localeCompare(path.basename(b), 'zh-CN', { numeric: true }));
    const index = matching.findIndex(item => path.resolve(item) === path.resolve(folder));
    if (index >= 0) sequence = index + 1;
  } catch {
    sequence = 1;
  }

  return `${templateName}-${stamp}-${String(sequence).padStart(2, '0')}`;
}

function numberedZipImageName(folderName, prefix, index, file) {
  const extension = path.extname(String(file || '')).toLowerCase() || '.png';
  return `${folderName}/${prefix}${String(index + 1).padStart(2, '0')}${extension}`;
}

async function collectChildrenwearDeliveryEntries(root, task) {
  const candidates = [];
  if (task.masterPath) candidates.push({ file: task.masterPath, name: numberedZipImageName('平铺图', '平铺图', 0, task.masterPath) });
  (Array.isArray(task.modelOutputs) ? task.modelOutputs : []).forEach((output, index) => {
    if (output?.path) candidates.push({ file: output.path, name: numberedZipImageName('模特图', '模特图', index, output.path) });
  });
  (Array.isArray(task.combinationOutputs) ? task.combinationOutputs : []).forEach((output, index) => {
    if (output?.path) candidates.push({ file: output.path, name: numberedZipImageName('多组合SKU图', '多组合SKU', index, output.path) });
  });
  const entries = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const file = path.resolve(String(candidate.file || ''));
    const comparable = normalizedComparablePath(file);
    if (seen.has(comparable) || !isWithin(root, file)) continue;
    const stat = await fsp.stat(file).catch(() => null);
    if (!stat?.isFile()) continue;
    seen.add(comparable);
    entries.push({ file, name: candidate.name });
  }
  return entries;
}

async function collectZipEntries(root, folder = root, entries = []) {
  const children = await fsp.readdir(folder, { withFileTypes: true });
  for (const child of children.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true }))) {
    const target = path.join(folder, child.name);
    if (child.isDirectory()) await collectZipEntries(root, target, entries);
    else if (child.isFile()) entries.push(target);
  }
  return entries;
}

async function collectZipDownloadEntries(folder) {
  const root = path.resolve(folder);
  const childrenwearTask = await fsp.readFile(path.join(root, 'childrenwear-task.json'), 'utf8')
    .then(text => { try { return JSON.parse(text); } catch { return null; } })
    .catch(() => null);
  if (childrenwearTask) return collectChildrenwearDeliveryEntries(root, childrenwearTask);
  const files = await collectZipEntries(root);
  let entries = files.map(file => ({
    file,
    name: path.relative(root, file).replaceAll(path.sep, '/')
  }));
  const source = await readZipSourceMetadata(root);
  const masterImagePath = path.resolve(String(source.masterImagePath || ''));
  const masterStat = source.masterImagePath && runtime.isWorkspacePath(masterImagePath)
    ? await fsp.stat(masterImagePath).catch(() => null)
    : null;
  if (masterStat?.isFile()) {
    const masterName = '白底图/白底图.jpg';
    entries = entries.filter(entry => {
      const archiveName = entry.name.replaceAll('\\', '/').replace(/^\.\/+/, '').toLocaleLowerCase('zh-CN');
      const topFolder = archiveName.split('/')[0];
      return normalizedComparablePath(entry.file) !== normalizedComparablePath(masterImagePath)
        && archiveName !== '母版图.jpg'
        && archiveName !== '母版图.png'
        && topFolder !== '白底'
        && topFolder !== '白底图';
    });
    entries.push({ file: masterImagePath, name: masterName, convertToJpeg: true });
  }
  return entries;
}

async function readZipEntrySource(entry) {
  const source = await fsp.readFile(entry.file);
  if (!entry.convertToJpeg) return source;
  return sharp(source, { failOn: 'none', animated: false, limitInputPixels: 120_000_000 })
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .jpeg({ quality: 95, chromaSubsampling: '4:4:4' })
    .toBuffer();
}

async function createZipFromEntries(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const entry of entries) {
    const file = entry.file;
    const stat = await fsp.stat(file);
    const source = await readZipEntrySource(entry);
    const compressedCandidate = zlib.deflateRawSync(source);
    const useDeflate = compressedCandidate.length < source.length;
    const payload = useDeflate ? compressedCandidate : source;
    const name = Buffer.from(entry.name, 'utf8');
    const checksum = crc32(source);
    const dos = zipDosDateTime(stat.mtime);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(useDeflate ? 8 : 0, 8);
    localHeader.writeUInt16LE(dos.time, 10);
    localHeader.writeUInt16LE(dos.date, 12);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(payload.length, 18);
    localHeader.writeUInt32LE(source.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, name, payload);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(useDeflate ? 8 : 0, 10);
    centralHeader.writeUInt16LE(dos.time, 12);
    centralHeader.writeUInt16LE(dos.date, 14);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(payload.length, 20);
    centralHeader.writeUInt32LE(source.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, name);
    offset += localHeader.length + name.length + payload.length;
  }
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, ...centralParts, end]);
}

async function createFolderZip(folder) {
  return createZipFromEntries(await collectZipDownloadEntries(path.resolve(folder)));
}

async function createChildrenwearBatchZip(folders) {
  const unique = [...new Set((folders || []).map(value => path.resolve(String(value || ''))))].slice(0, 30);
  const entries = [];
  for (const folder of unique) {
    const prefix = safeSegment(await buildZipDownloadName(folder), '童装任务');
    const taskEntries = await collectZipDownloadEntries(folder);
    taskEntries.forEach(entry => entries.push({ ...entry, name: `${prefix}/${entry.name}` }));
  }
  if (!entries.length) throw new Error('选中的任务没有可下载的生成图片');
  return createZipFromEntries(entries);
}

function normalizedThumbnailWidth(value) {
  return Math.max(1, Number(value) || 0) <= 480 ? 480 : 1200;
}

async function withThumbnailSlot(worker) {
  if (activeThumbnails >= THUMBNAIL_CONCURRENCY) {
    await new Promise(resolve => thumbnailWaiters.push(resolve));
  }
  activeThumbnails += 1;
  try { return await worker(); }
  finally {
    activeThumbnails = Math.max(0, activeThumbnails - 1);
    thumbnailWaiters.shift()?.();
  }
}

async function createAssetThumbnail(file, requestedWidth = 480) {
  const source = path.resolve(String(file || ''));
  if (!(runtime.isWorkspacePath(source) || runtime.isOutputPath(source)) || !SUPPORTED_IMAGE_EXTENSIONS.has(path.extname(source).toLowerCase())) {
    throw new Error('不支持生成此文件的预览图');
  }
  const stat = await fsp.stat(source).catch(() => null);
  if (!stat?.isFile()) throw new Error('原始图片不存在');
  const width = normalizedThumbnailWidth(requestedWidth);
  const quality = width > 480 ? 84 : 78;
  const cacheKey = crypto.createHash('sha256')
    .update(`${source}\0${Math.trunc(stat.mtimeMs)}\0${stat.size}\0${width}\0webp`)
    .digest('hex');
  const target = path.join(thumbnailRoot(), cacheKey.slice(0, 2), `${cacheKey}.webp`);
  if ((await fsp.stat(target).catch(() => null))?.isFile()) return { file: target, width, cacheHit: true };
  if (thumbnailJobs.has(target)) return thumbnailJobs.get(target);

  const job = withThumbnailSlot(async () => {
    if ((await fsp.stat(target).catch(() => null))?.isFile()) return { file: target, width, cacheHit: true };
    await fsp.mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.${process.pid}-${crypto.randomBytes(3).toString('hex')}.tmp`;
    try {
      await sharp(source, { failOn: 'none', animated: false, limitInputPixels: 120_000_000 })
        .rotate()
        .resize({ width, height: width, fit: 'inside', withoutEnlargement: true })
        .webp({ quality, effort: 3, smartSubsample: true })
        .toFile(temporary);
      await fsp.rename(temporary, target);
      return { file: target, width, cacheHit: false };
    } finally {
      await fsp.rm(temporary, { force: true }).catch(() => {});
    }
  }).finally(() => thumbnailJobs.delete(target));
  thumbnailJobs.set(target, job);
  return job;
}

async function pruneThumbnailCache(maxAgeMs = 30 * 24 * 60 * 60 * 1000) {
  const cutoff = Date.now() - maxAgeMs;
  const root = thumbnailRoot();
  const buckets = await fsp.readdir(root, { withFileTypes: true }).catch(() => []);
  for (const bucket of buckets) {
    if (!bucket.isDirectory()) continue;
    const directory = path.join(root, bucket.name);
    const files = await fsp.readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of files) {
      if (!entry.isFile()) continue;
      const target = path.join(directory, entry.name);
      const stat = await fsp.stat(target).catch(() => null);
      if (stat && stat.mtimeMs < cutoff) await fsp.rm(target, { force: true }).catch(() => {});
    }
    if (!(await fsp.readdir(directory).catch(() => [])).length) await fsp.rmdir(directory).catch(() => {});
  }
}

function workspacePath(value, options = {}) {
  const text = String(value || '').trim();
  if (!text && options.allowEmpty) return '';
  if (!text || !runtime.isWorkspacePath(text)) throw new Error(options.message || '路径不属于当前工作区');
  return path.resolve(text);
}

function configAssetPath(value) {
  const text = String(value || '').trim();
  return text && runtime.isWorkspacePath(text) ? path.resolve(text) : '';
}

function managedPath(value, options = {}) {
  const text = String(value || '').trim();
  if (!text && options.allowEmpty) return '';
  if (!text || (!runtime.isWorkspacePath(text) && !runtime.isOutputPath(text))) {
    throw new Error(options.message || '路径不属于当前工作区或成品输出目录');
  }
  return path.resolve(text);
}

function safeTask(task = {}) {
  return {
    ...task,
    productPath: workspacePath(task.productPath, { allowEmpty: task.generationMode === 'template_print', message: '品类图不属于当前工作区' }),
    printPath: workspacePath(task.printPath, { message: '印花图不属于当前工作区' }),
    templateFolderPath: workspacePath(task.templateFolderPath, { message: '套图不属于当前工作区' }),
    masterImagePath: managedPath(task.masterImagePath, { allowEmpty: true, message: '母版图不属于当前工作区或成品输出目录' }),
    masterReferencePath: workspacePath(task.masterReferencePath, { allowEmpty: true, message: '母版参考图不属于当前工作区' }),
    templateRelativePaths: [...new Set((Array.isArray(task.templateRelativePaths)
      ? task.templateRelativePaths
      : task.templateRelativePath ? [task.templateRelativePath] : [])
      .map(value => String(value || '').trim())
      .filter(Boolean))].slice(0, 500)
  };
}

function safeConfig(config = {}) {
  const outputValue = String(config.outputPath || runtime.OUTPUT_ROOT).trim();
  if (!path.isAbsolute(outputValue)) throw new Error('成品输出目录必须填写主电脑上的绝对路径');
  const outputPath = path.resolve(outputValue);
  if (outputPath === path.parse(outputPath).root || outputPath === path.resolve(os.homedir())) {
    throw new Error('成品输出目录必须使用单独的文件夹，不能选择磁盘根目录或用户主目录');
  }
  const forbiddenRoots = ['assets', 'jobs', 'tmp', '.cache'].map(name => path.join(runtime.WORKSPACE_ROOT, name));
  if (outputPath === path.resolve(runtime.WORKSPACE_ROOT) || forbiddenRoots.some(root => isWithin(root, outputPath))) {
    throw new Error('成品输出目录不能使用素材、任务缓存或工作区根目录');
  }
  return {
    ...config,
    categoriesPath: configAssetPath(config.categoriesPath),
    printsPath: configAssetPath(config.printsPath),
    detailSetsPath: configAssetPath(config.detailSetsPath),
    childrenwearRealAssetsPath: configAssetPath(config.childrenwearRealAssetsPath),
    childrenwearReferenceAssetsPath: configAssetPath(config.childrenwearReferenceAssetsPath),
    childrenwearModelAssetsPath: configAssetPath(config.childrenwearModelAssetsPath),
    childrenwearCombinationAssetsPath: configAssetPath(config.childrenwearCombinationAssetsPath),
    outputPath
  };
}

function publicConfig(config) {
  return {
    ...config,
    categoriesPath: configAssetPath(config.categoriesPath),
    printsPath: configAssetPath(config.printsPath),
    detailSetsPath: configAssetPath(config.detailSetsPath),
    childrenwearRealAssetsPath: configAssetPath(config.childrenwearRealAssetsPath),
    childrenwearReferenceAssetsPath: configAssetPath(config.childrenwearReferenceAssetsPath),
    childrenwearModelAssetsPath: configAssetPath(config.childrenwearModelAssetsPath),
    childrenwearCombinationAssetsPath: configAssetPath(config.childrenwearCombinationAssetsPath),
    workspaceRoot: runtime.WORKSPACE_ROOT,
    defaultOutputPath: runtime.OUTPUT_ROOT
  };
}

function jobFile(id) {
  return path.join(jobRoot(), `${String(id).replace(/[^a-zA-Z0-9-]/g, '')}.json`);
}

async function readJob(id) {
  try { return JSON.parse(await fsp.readFile(jobFile(id), 'utf8')); } catch { return null; }
}

async function writeJob(job) {
  await fsp.mkdir(jobRoot(), { recursive: true });
  const file = jobFile(job.id);
  const temporary = `${file}.${process.pid}.tmp`;
  await fsp.writeFile(temporary, JSON.stringify(job, null, 2));
  let lastError;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await fsp.rename(temporary, file);
      return job;
    } catch (error) {
      lastError = error;
      if (!['EPERM', 'EBUSY'].includes(error?.code) || attempt === 5) break;
      await wait(80 * (attempt + 1));
    }
  }
  throw lastError;
}

function publicJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    clientKey: job.clientKey || '',
    method: job.method,
    status: job.status,
    result: job.status === 'completed' ? job.result : undefined,
    error: job.status === 'failed' ? job.error : undefined,
    progress: job.progress && typeof job.progress === 'object' ? job.progress : {},
    createdAt: job.createdAt,
    startedAt: job.startedAt || '',
    finishedAt: job.finishedAt || ''
  };
}

async function runNextJobs() {
  while (activeJobs < MAX_ACTIVE_JOBS && pendingJobs.length) {
    const job = pendingJobs.shift();
    activeJobs += 1;
    void runtime.runWithWorkspace(job.workspaceId, async () => {
      job.status = 'running';
      job.startedAt = new Date().toISOString();
      job.progress = { ...(job.progress || {}), phase: 'running', message: job.progress?.message || '后台任务已开始', updatedAt: new Date().toISOString() };
      const controller = new AbortController();
      activeJobControllers.set(job.id, controller);
      await writeJob(job);
      try {
        let progressWrite = Promise.resolve();
        const reportProgress = update => {
          job.progress = { ...(job.progress || {}), ...(update || {}), updatedAt: new Date().toISOString() };
          progressWrite = progressWrite.then(() => writeJob(job));
          return progressWrite;
        };
        job.result = await rpc[job.method](job.args || [], { reportProgress, signal: controller.signal });
        await progressWrite;
        job.status = 'completed';
        job.progress = { ...(job.progress || {}), phase: 'completed', percent: 100, message: job.progress?.message || '任务已完成', updatedAt: new Date().toISOString() };
      } catch (error) {
        job.status = 'failed';
        job.error = controller.signal.aborted ? '任务已手动停止' : (error?.message || String(error));
        job.progress = { ...(job.progress || {}), phase: 'failed', message: job.error, updatedAt: new Date().toISOString() };
      } finally {
        activeJobControllers.delete(job.id);
        job.finishedAt = new Date().toISOString();
        await writeJob(job);
        activeJobs -= 1;
        runNextJobs();
      }
    }, {
      userRole: job.actorRole || 'member',
      userId: job.actorUserId || ''
    });
  }
}

async function enqueueJob(method, args, clientKey = '', actor = {}) {
  const workspaceId = runtime.WORKSPACE_ID;
  const normalizedClientKey = String(clientKey || '').slice(0, 160);
  const scopedClientKey = normalizedClientKey ? `${workspaceId}:${normalizedClientKey}` : '';
  if (scopedClientKey && jobsByClientKey.has(scopedClientKey)) {
    const existing = await readJob(jobsByClientKey.get(scopedClientKey));
    if (existing) return existing;
    jobsByClientKey.delete(scopedClientKey);
  }
  const job = {
    id: crypto.randomUUID(),
    workspaceId,
    actorRole: String(actor?.role || 'member'),
    actorUserId: String(actor?.id || ''),
    clientKey: normalizedClientKey,
    method,
    args,
    status: 'queued',
    result: null,
    error: '',
    createdAt: new Date().toISOString(),
    startedAt: '',
    finishedAt: '',
    progress: { phase: 'queued', current: 0, total: 0, percent: 0, message: '等待服务器处理', updatedAt: new Date().toISOString() }
  };
  await writeJob(job);
  if (scopedClientKey) jobsByClientKey.set(scopedClientKey, job.id);
  pendingJobs.push(job);
  runNextJobs();
  return job;
}

async function cancelJob(id) {
  const job = await readJob(id);
  if (!job) return null;
  if (!['queued', 'running'].includes(job.status)) return job;
  const controller = activeJobControllers.get(job.id);
  if (controller) {
    controller.abort();
    job.progress = { ...(job.progress || {}), phase: 'stopping', message: '正在停止当前任务…', updatedAt: new Date().toISOString() };
    await writeJob(job);
    return job;
  }
  const index = pendingJobs.findIndex(item => item.id === job.id);
  if (index >= 0) pendingJobs.splice(index, 1);
  job.status = 'failed';
  job.error = '任务已手动停止';
  job.progress = { ...(job.progress || {}), phase: 'failed', message: job.error, updatedAt: new Date().toISOString() };
  job.finishedAt = new Date().toISOString();
  await writeJob(job);
  return job;
}

async function cancelWorkspaceJobs(workspaceId = runtime.WORKSPACE_ID) {
  const ids = new Set();
  for (const job of pendingJobs) {
    if (job.workspaceId === workspaceId) ids.add(job.id);
  }
  for (const id of activeJobControllers.keys()) {
    const job = await readJob(id);
    if (job?.workspaceId === workspaceId) ids.add(id);
  }
  const cancelled = [];
  for (const id of ids) {
    const job = await cancelJob(id);
    if (job) cancelled.push(job);
  }
  const deadline = Date.now() + 5000;
  while ([...ids].some(id => activeJobControllers.has(id)) && Date.now() < deadline) {
    await wait(50);
  }
  const settled = await Promise.all(cancelled.map(job => readJob(job.id)));
  return {
    count: cancelled.length,
    jobs: settled.map((job, index) => publicJob(job || cancelled[index]))
  };
}

async function initializeJobs() {
  await fsp.mkdir(jobRoot(), { recursive: true });
  const files = await fsp.readdir(jobRoot()).catch(() => []);
  for (const name of files.filter(name => name.endsWith('.json'))) {
    const job = await readJob(name.slice(0, -5));
    if (!job) continue;
    if (job.clientKey) jobsByClientKey.set(`${runtime.WORKSPACE_ID}:${job.clientKey}`, job.id);
    if (job.status === 'queued' || job.status === 'running') {
      job.status = 'failed';
      job.error = '服务重启，任务执行状态已中断，请重新提交。';
      job.progress = { ...(job.progress || {}), phase: 'failed', message: job.error, updatedAt: new Date().toISOString() };
      job.finishedAt = new Date().toISOString();
      await markInterruptedGenerationProgress(job, job.error);
      await writeJob(job);
    }
  }
}

function consumeJobRate(ip) {
  const now = Date.now();
  const key = String(ip || 'unknown');
  const recent = (jobRateWindows.get(key) || []).filter(value => now - value < 60 * 60 * 1000);
  if (recent.length >= JOB_RATE_LIMIT_PER_HOUR) return false;
  recent.push(now);
  jobRateWindows.set(key, recent);
  return true;
}

function consumeLoginRate(ip) {
  const now = Date.now();
  const key = String(ip || 'unknown');
  const recent = (loginRateWindows.get(key) || []).filter(value => now - value < 15 * 60 * 1000);
  if (recent.length >= 20) return false;
  recent.push(now);
  loginRateWindows.set(key, recent);
  return true;
}

function requestIsSecure(req) {
  return Boolean(req.secure || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https');
}

async function moveUploadedFile(source, destination) {
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  try {
    await fsp.rename(source, destination);
  } catch (error) {
    if (error.code !== 'EXDEV') throw error;
    await fsp.copyFile(source, destination);
    await fsp.rm(source, { force: true });
  }
}

async function handleFolderUpload(req, res) {
  const kindMap = { product: 'product', print: 'print', template: 'template' };
  const kind = kindMap[req.params.kind];
  if (!kind) return res.status(400).json({ error: '不支持的素材类型' });
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: '没有收到文件' });

  let relativePaths = [];
  try { relativePaths = JSON.parse(req.body.relativePaths || '[]'); } catch {}
  const normalized = files.map((file, index) => safeRelative(relativePaths[index], uploadName(file)));
  const firstParts = normalized.map(value => value.split('/')[0]);
  const commonRoot = firstParts.length && firstParts.every(value => value === firstParts[0]) && normalized.some(value => value.includes('/'))
    ? firstParts[0]
    : '';
  const collection = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const collectionRoot = path.join(assetRoot(), kind, collection, commonRoot || '素材');

  for (let index = 0; index < files.length; index += 1) {
    const relative = commonRoot ? normalized[index].split('/').slice(1).join('/') : normalized[index];
    const target = path.join(collectionRoot, safeRelative(relative, uploadName(files[index])));
    if (!isWithin(collectionRoot, target)) throw new Error('上传路径无效');
    await moveUploadedFile(files[index].path, target);
  }

  if (kind === 'template') await runtime.prepareTemplateStructure(collectionRoot);
  return res.json({ root: collectionRoot, count: files.length, name: commonRoot || '素材' });
}

const ASSET_KIND_MAP = Object.freeze({
  product: 'product',
  print: 'print',
  template: 'template',
  'childrenwear-real': 'childrenwear-real',
  'childrenwear-reference': 'childrenwear-reference',
  'childrenwear-model': 'childrenwear-model',
  'childrenwear-combination': 'childrenwear-combination'
});
const SUPPORTED_IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif', '.tif', '.tiff']);

function assetKind(value) {
  return ASSET_KIND_MAP[String(value || '')] || '';
}

function cleanExpiredAssetSyncSessions() {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [id, session] of assetSyncSessions) {
    if (session.createdAt < cutoff) assetSyncSessions.delete(id);
  }
}

async function prepareAssetSync(kindValue, payload = {}, workspaceId = runtime.WORKSPACE_ID) {
  cleanExpiredAssetSyncSessions();
  const kind = assetKind(kindValue);
  if (!kind) throw new Error('不支持的素材类型');
  const files = Array.isArray(payload.files) ? payload.files : [];
  if (!files.length) throw new Error('选择的文件夹里没有支持的图片');
  if (files.length > 50000) throw new Error('单次扫描最多支持 50000 张图片');

  const kindRoot = path.join(assetRoot(), kind);
  const requestedRoot = String(payload.currentRoot || '').trim();
  const requestedStat = requestedRoot && isWithin(kindRoot, requestedRoot)
    ? await fsp.stat(requestedRoot).catch(() => null)
    : null;
  const rootName = safeSegment(payload.rootName, '素材');
  const root = requestedStat?.isDirectory()
    ? path.resolve(requestedRoot)
    : path.join(kindRoot, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`, rootName);
  const entries = [];
  const seen = new Set();

  for (const item of files) {
    const relativePath = safeRelative(item?.relativePath, item?.name || 'image');
    if (!SUPPORTED_IMAGE_EXTENSIONS.has(path.extname(relativePath).toLowerCase())) continue;
    const key = relativePath.toLocaleLowerCase('zh-CN');
    if (seen.has(key)) continue;
    seen.add(key);
    const size = Math.max(0, Number(item?.size) || 0);
    const lastModified = Math.max(0, Number(item?.lastModified) || 0);
    const target = path.join(root, relativePath);
    if (!isWithin(root, target)) continue;
    const current = await fsp.stat(target).catch(() => null);
    const unchanged = current?.isFile()
      && current.size === size
      && (!lastModified || Math.abs(current.mtimeMs - lastModified) < 2000);
    entries.push({ relativePath, size, lastModified, needed: !unchanged });
  }

  if (!entries.length) throw new Error('选择的文件夹里没有支持的图片');
  const session = {
    id: crypto.randomUUID(),
    workspaceId,
    kind,
    root,
    rootName,
    createdAt: Date.now(),
    entries: new Map(entries.map(item => [item.relativePath, item])),
    uploaded: 0,
    uploadedBytes: 0
  };
  assetSyncSessions.set(session.id, session);
  return {
    sessionId: session.id,
    root,
    rootName,
    total: entries.length,
    skipped: entries.filter(item => !item.needed).length,
    neededRelativePaths: entries.filter(item => item.needed).map(item => item.relativePath)
  };
}

async function uploadAssetSyncBatch(sessionId, files, relativePaths, lastModifiedValues, workspaceId = runtime.WORKSPACE_ID) {
  const session = assetSyncSessions.get(String(sessionId || ''));
  if (!session || session.workspaceId !== workspaceId) throw new Error('扫描会话已失效，请重新选择文件夹');
  let uploaded = 0;
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const relativePath = safeRelative(relativePaths[index], uploadName(file));
    const entry = session.entries.get(relativePath);
    if (!entry?.needed) {
      await fsp.rm(file.path, { force: true });
      continue;
    }
    const target = path.join(session.root, relativePath);
    if (!isWithin(session.root, target)) throw new Error('上传路径无效');
    await moveUploadedFile(file.path, target);
    const lastModified = Math.max(0, Number(lastModifiedValues[index]) || entry.lastModified || 0);
    if (lastModified) {
      const modifiedAt = new Date(lastModified);
      await fsp.utimes(target, modifiedAt, modifiedAt).catch(() => {});
    }
    entry.needed = false;
    entry.uploaded = true;
    uploaded += 1;
    session.uploaded += 1;
    session.uploadedBytes += Number(file.size) || 0;
  }
  return { uploaded, totalUploaded: session.uploaded };
}

async function finishAssetSync(sessionId, workspaceId = runtime.WORKSPACE_ID) {
  const session = assetSyncSessions.get(String(sessionId || ''));
  if (!session || session.workspaceId !== workspaceId) throw new Error('扫描会话已失效，请重新选择文件夹');
  const missing = [...session.entries.values()].filter(item => item.needed).length;
  if (missing) throw new Error(`还有 ${missing} 张图片未上传完成`);
  await fsp.mkdir(session.root, { recursive: true });
  if (session.kind === 'template') await runtime.prepareTemplateStructure(session.root);
  assetSyncSessions.delete(session.id);
  return {
    root: session.root,
    name: session.rootName,
    count: session.entries.size,
    uploaded: session.uploaded,
    skipped: session.entries.size - session.uploaded,
    uploadedBytes: session.uploadedBytes,
    added: session.uploaded,
    paths: [...session.entries.values()].map(item => path.join(session.root, item.relativePath)),
    uploadedPaths: [...session.entries.values()]
      .filter(item => item.uploaded)
      .map(item => path.join(session.root, item.relativePath))
  };
}

async function assetLibraryRoot(kindValue, requestedRoot = '') {
  const kind = assetKind(kindValue);
  if (!kind) throw new Error('不支持的素材类型');
  const kindRoot = path.join(assetRoot(), kind);
  const value = String(requestedRoot || '').trim();
  if (value) {
    const root = path.resolve(value);
    if (!isWithin(kindRoot, root)) throw new Error('素材目录不属于当前素材库');
    const stat = await fsp.stat(root).catch(() => null);
    if (!stat?.isDirectory()) throw new Error('素材目录不存在，请重新选择文件夹');
    return { kind, kindRoot, root };
  }
  const root = path.join(kindRoot, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`, '手动添加');
  await fsp.mkdir(root, { recursive: true });
  return { kind, kindRoot, root };
}

async function moveAssetFileWithoutOverwrite(source, root, relativePath) {
  const normalized = safeRelative(relativePath, path.basename(source));
  const extension = path.extname(normalized).toLowerCase();
  if (!SUPPORTED_IMAGE_EXTENSIONS.has(extension)) return '';
  const directory = path.dirname(normalized);
  const baseName = path.basename(normalized, extension);
  for (let attempt = 1; attempt <= 1000; attempt += 1) {
    const fileName = attempt === 1 ? `${baseName}${extension}` : `${baseName} (${attempt})${extension}`;
    const target = path.join(root, directory === '.' ? '' : directory, fileName);
    if (!isWithin(root, target)) throw new Error('上传路径无效');
    await fsp.mkdir(path.dirname(target), { recursive: true });
    let handle;
    try {
      handle = await fsp.open(target, 'wx');
      await handle.close();
      handle = null;
      await fsp.copyFile(source, target);
      await fsp.rm(source, { force: true });
      return target;
    } catch (error) {
      await handle?.close().catch(() => {});
      if (error?.code === 'EEXIST') continue;
      await fsp.rm(target, { force: true }).catch(() => {});
      throw error;
    }
  }
  throw new Error(`同名素材过多：${path.basename(normalized)}`);
}

async function addAssetFiles(kindValue, requestedRoot, files = [], relativePaths = []) {
  if (!files.length) throw new Error('没有收到图片文件');
  if (files.length > 500) throw new Error('单次最多添加 500 张图片');
  const library = await assetLibraryRoot(kindValue, requestedRoot);
  const added = [];
  let skipped = 0;
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const relativePath = safeRelative(relativePaths[index], uploadName(file));
    if (!SUPPORTED_IMAGE_EXTENSIONS.has(path.extname(relativePath).toLowerCase())) {
      skipped += 1;
      await fsp.rm(file.path, { force: true });
      continue;
    }
    added.push(await moveAssetFileWithoutOverwrite(file.path, library.root, relativePath));
  }
  if (!added.length) throw new Error('没有可添加的图片文件');
  runtime.invalidateImageLibraryIndex(library.root);
  return { root: library.root, added: added.length, skipped, paths: added };
}

async function removeEmptyAssetParents(directory, root) {
  let current = path.resolve(directory);
  const boundary = path.resolve(root);
  while (current !== boundary && isWithin(boundary, current)) {
    const entries = await fsp.readdir(current).catch(() => null);
    if (!entries || entries.length) break;
    await fsp.rmdir(current).catch(() => {});
    current = path.dirname(current);
  }
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function removeFileWithRetry(file) {
  const retryable = new Set(['EPERM', 'EBUSY', 'ENOTEMPTY']);
  let lastError;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await fsp.chmod(file, 0o666).catch(() => {});
      await fsp.rm(file, { force: true });
      return;
    } catch (error) {
      lastError = error;
      if (!retryable.has(error?.code) || attempt === 4) break;
      await wait(80 * (attempt + 1));
    }
  }
  throw lastError;
}

async function deleteAssetFiles(kindValue, requestedRoot, paths = []) {
  if (!Array.isArray(paths) || !paths.length) throw new Error('请先选择需要删除的素材');
  if (paths.length > 500) throw new Error('单次最多删除 500 张图片');
  const library = await assetLibraryRoot(kindValue, requestedRoot);
  const analysisRoleByKind = {
    'childrenwear-real': 'product',
    'childrenwear-reference': 'flat_reference',
    'childrenwear-model': 'model_reference',
    'childrenwear-combination': 'combination_reference'
  };
  const files = [];
  for (const value of [...new Set(paths.map(item => String(item || '').trim()).filter(Boolean))]) {
    const file = path.resolve(value);
    if (!isWithin(library.root, file) || !isWithin(library.kindRoot, file)) throw new Error('存在不属于当前素材库的文件');
    const stat = await fsp.stat(file).catch(() => null);
    if (!stat?.isFile() || !SUPPORTED_IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase())) continue;
    files.push(file);
  }
  if (analysisRoleByKind[library.kind]) {
    await runtime.invalidateChildrenwearAnalysisPaths(files, analysisRoleByKind[library.kind]);
  }
  let deleted = 0;
  for (const file of files) {
    await removeFileWithRetry(file);
    await removeEmptyAssetParents(path.dirname(file), library.root);
    deleted += 1;
  }
  runtime.invalidateImageLibraryIndex(library.root);
  return { root: library.root, deleted };
}

function normalizedAssetFolderName(value) {
  const name = String(value || '').trim();
  if (!name) throw new Error('文件夹名称不能为空');
  if (name === '.' || name === '..' || /[\\/:*?"<>|]/.test(name) || /[. ]$/.test(name)) throw new Error('文件夹名称包含无效字符');
  if (name.length > 80) throw new Error('文件夹名称最多 80 个字符');
  return name;
}

async function renameAssetFolder(kindValue, requestedRoot, folderId, nextNameValue) {
  const library = await assetLibraryRoot(kindValue, requestedRoot);
  const id = String(folderId || '');
  if (!id.startsWith('folder:')) throw new Error('未分类文件不能重命名');
  const currentName = id.slice('folder:'.length).trim();
  if (!currentName || currentName.includes('/') || currentName.includes('\\')) throw new Error('文件夹标识无效');
  const nextName = normalizedAssetFolderName(nextNameValue);
  const source = path.resolve(library.root, currentName);
  if (!isWithin(library.root, source)) throw new Error('文件夹不属于当前素材库');
  const sourceStat = await fsp.stat(source).catch(() => null);
  if (!sourceStat?.isDirectory()) throw new Error('原文件夹不存在，请刷新后重试');
  const labelsFile = path.join(library.root, '.caishen-folder-labels.json');
  const labels = await fsp.readFile(labelsFile, 'utf8')
    .then(text => { try { return JSON.parse(text); } catch { return {}; } })
    .catch(() => ({}));
  labels[id] = nextName;
  await fsp.writeFile(labelsFile, JSON.stringify(labels, null, 2), 'utf8');
  runtime.invalidateImageLibraryIndex(library.root);
  return { root: library.root, folder: id, name: nextName };
}

const rpc = {
  getConfig: async () => publicConfig(await runtime.loadConfig()),
  getApiConcurrencySettings: () => runtime.publicApiConcurrencySettings(),
  getApiSettings: () => runtime.loadApiSettings(),
  saveApiSettings: ([payload]) => runtime.saveApiSettings(payload || {}),
  testApiSettings: ([payload]) => runtime.testApiSettings(payload || {}),
  testRelayHealth: ([payload]) => runtime.testRelayHealth(payload || {}),
  saveConfig: async ([config]) => publicConfig(await runtime.saveConfig(safeConfig(config || {}))),
  resetConfig: async () => publicConfig(await runtime.resetConfig()),
  getPromptSettings: async (args, context) => {
    if (context?.user?.role === 'superadmin') return runtime.loadPromptSettings();
    if (context?.user?.role === 'admin' && await runtime.canAdminViewPromptSettings()) return runtime.loadPromptSettings();
    throw new Error('没有查看网站提示词的权限');
  },
  savePromptSetting: ([id, value]) => runtime.savePromptSetting(id, value),
  resetPromptSetting: ([id]) => runtime.resetPromptSetting(id),
  listImages: ([root, query]) => runtime.scanImages(workspacePath(root, { allowEmpty: true }), String(query || '')),
  listImageLibrary: ([root, options]) => runtime.scanImageLibraryPage(workspacePath(root, { allowEmpty: true }), options || {}),
  analyzeChildrenwearAssets: ([payload], context) => runtime.analyzeChildrenwearAssets({
    ...(payload || {}),
    paths: [...new Set((payload?.paths || []).map(value => workspacePath(value, { message: '童装素材不属于当前工作区' })))]
  }, context || {}),
  scanPendingChildrenwearAnalysis: ([payload], context) => runtime.scanPendingChildrenwearAnalysis(payload || {}, context || {}),
  listTemplateFolders: () => runtime.listTemplateFolders(),
  deleteTemplateFolder: ([folder]) => runtime.deleteTemplateFolder(workspacePath(folder)),
  generateTask: ([task], context) => runtime.generateTask(safeTask(task || {}), context || {}),
  generateTemplateMaster: ([task], context) => runtime.generateTemplateTaskMaster(safeTask(task || {}), context || {}),
  listTemplates: ([folder]) => runtime.listTemplates(workspacePath(folder)),
  getTemplatePreparation: ([folder]) => runtime.getTemplatePreparation(workspacePath(folder)),
  prepareTemplates: ([folder]) => runtime.prepareTemplateFolder(workspacePath(folder)),
  saveTemplateRegions: ([payload]) => runtime.saveTemplateRegions({ ...(payload || {}), folder: workspacePath(payload?.folder) }),
  generateFree: ([payload], context) => runtime.generateFree({ ...(payload || {}), sourcePath: workspacePath(payload?.sourcePath) }, context || {}),
  generateChildrenwearMaster: ([payload], context) => runtime.generateChildrenwearMaster({
    ...(payload || {}),
    folder: payload?.folder ? managedPath(payload.folder) : '',
    realPhotoPath: managedPath(payload?.realPhotoPath, { message: '实拍图不属于当前工作区或任务目录' }),
    referencePath: managedPath(payload?.referencePath, { message: '参考成品图不属于当前工作区或任务目录' })
  }, context || {}),
  generateChildrenwearModel: ([payload], context) => runtime.generateChildrenwearModel({
    ...(payload || {}),
    folder: managedPath(payload?.folder, { message: '童装任务不属于当前输出目录' }),
    modelReferencePath: managedPath(payload?.modelReferencePath, { message: '模特参考图不属于当前工作区或任务目录' })
  }, context || {}),
  generateChildrenwearCombination: ([payload], context) => runtime.generateChildrenwearCombination({
    ...(payload || {}),
    folder: payload?.folder ? managedPath(payload.folder, { message: '组合图任务不属于当前输出目录' }) : '',
    combinationReferencePath: managedPath(payload?.combinationReferencePath, { message: '组合参考图不属于当前工作区或任务目录' }),
    masterPaths: [...new Set((payload?.masterPaths || []).map(value => managedPath(value, { message: '母版图不属于当前输出目录' })))]
  }, context || {}),
  listChildrenwearTasks: () => runtime.listChildrenwearTasks(),
  renameChildrenwearTask: ([payload]) => runtime.renameChildrenwearTask({
    ...(payload || {}),
    folder: managedPath(payload?.folder, { message: '款式任务不属于当前输出目录' })
  }),
  deleteChildrenwearTasks: ([folders]) => runtime.deleteChildrenwearTasks(
    [...new Set((folders || []).map(value => managedPath(value, { message: '款式任务不属于当前输出目录' })))]
  ),
  approveChildrenwearOutput: ([payload]) => runtime.approveChildrenwearOutput({
    ...(payload || {}),
    folder: managedPath(payload?.folder, { message: '童装任务不属于当前输出目录' })
  }),
  listReviews: () => runtime.reviewFolders(),
  approveReview: ([folder]) => runtime.approveReviewFolder(managedPath(folder)),
  setReviewStatus: ([payload]) => runtime.setTemplateManualStatus({ ...(payload || {}), folder: managedPath(payload?.folder) }),
  generateTemplates: async ([payload], context) => {
    const folders = [...new Set((payload?.folders || []).map(value => managedPath(value)))];
    return Promise.all(folders.map(async folder => {
      if (context?.signal?.aborted) throw new Error('任务已停止');
      return runtime.generateTemplateSetForFolder(folder, payload?.onlyMissing !== false, null, context || {});
    }));
  },
  regenerateTemplate: ([payload], context) => runtime.regenerateSingleTemplate({
    ...(payload || {}),
    folder: managedPath(payload?.folder),
    relativePath: String(payload?.relativePath || ''),
    referenceResultRelativePath: String(payload?.referenceResultRelativePath || '')
  }, context || {}),
  batchApproveReviews: ([folders]) => runtime.batchApproveReviewFolders((folders || []).map(value => managedPath(value))),
  deleteReviews: ([folders]) => runtime.deleteReviewFolders((folders || []).map(value => managedPath(value))),
  getFileLink: ([target, kind]) => {
    const file = managedPath(target);
    const token = runtime.fileToken(file);
    if (kind === 'zip') return `/api/zip/${token}`;
    return kind === 'folder' ? `/api/browse?path=${token}` : `/api/files/${token}?download=1`;
  }
};

async function startServer() {
  const existingUsers = await auth.listUsers();
  for (const user of existingUsers) {
    await runtime.runWithWorkspace(user.workspaceId, async () => {
      await runtime.initializeRuntime();
      await runtime.billing.ensureAccount(user.workspaceId);
      await Promise.all([fsp.mkdir(tempRoot(), { recursive: true }), initializeJobs()]);
    });
  }

  const app = express();
  app.disable('x-powered-by');
  if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
  app.use(helmet({
    crossOriginResourcePolicy: { policy: 'same-origin' },
    contentSecurityPolicy: false
  }));
  app.use(express.json({ limit: '25mb' }));

  app.post('/api/internal/business/snapshot', async (req, res) => {
    const verification = verifyBusinessRequest(req);
    if (!verification.ok) return res.status(verification.status).json({ error: verification.error });
    try {
      return res.json({ data: await businessSnapshot.snapshot(req.body || {}) });
    } catch (error) {
      return res.status(400).json({ error: error?.message || String(error) });
    }
  });

  app.post('/api/internal/business/recharge-action', async (req, res) => {
    const verification = verifyBusinessRequest(req);
    if (!verification.ok) return res.status(verification.status).json({ error: verification.error });
    try {
      return res.json({ data: await businessSnapshot.rechargeAction(req.body || {}, 'business-link') });
    } catch (error) {
      return res.status(400).json({ error: error?.message || String(error) });
    }
  });

  app.get('/api/health', (_req, res) => {
    const queue = runtime.getImageSchedulerSnapshot();
    return res.json({
      ok: true,
      commit: String(process.env.APP_COMMIT_SHA || 'unknown'),
      uptimeSeconds: Math.floor(process.uptime()),
      activeImageRequests: queue.active,
      queuedImageRequests: queue.queued,
      currentImageConcurrency: queue.currentConcurrency,
      maxImageConcurrency: queue.maxConcurrency,
      imageStartIntervalMs: queue.minStartIntervalMs
    });
  });

  app.get('/api/auth/status', async (req, res) => {
    const user = await auth.userFromRequest(req);
    return res.json({ data: { authenticated: Boolean(user), bootstrapRequired: !(await auth.hasUsers()), user } });
  });

  app.post('/api/auth/bootstrap', async (req, res) => {
    try {
      const user = await auth.createUser(req.body || {}, { bootstrap: true });
      await runtime.runWithWorkspace(user.workspaceId, () => runtime.initializeRuntime());
      await runtime.billing.ensureAccount(user.workspaceId);
      const token = await auth.createSession(user);
      res.setHeader('Set-Cookie', auth.sessionCookie(token, requestIsSecure(req)));
      return res.status(201).json({ data: { user } });
    } catch (error) {
      return res.status(400).json({ error: error?.message || String(error) });
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    if (!consumeLoginRate(req.ip)) return res.status(429).json({ error: '登录尝试过于频繁，请 15 分钟后再试' });
    const user = await auth.authenticate(req.body?.username, req.body?.password);
    if (!user) return res.status(401).json({ error: '账号或密码不正确' });
    const token = await auth.createSession(user);
    res.setHeader('Set-Cookie', auth.sessionCookie(token, requestIsSecure(req)));
    return res.json({ data: { user } });
  });

  app.post('/api/auth/logout', (req, res) => {
    res.setHeader('Set-Cookie', auth.clearSessionCookie(requestIsSecure(req)));
    return res.json({ data: { ok: true } });
  });

  app.use('/api', async (req, res, next) => {
    const user = await auth.userFromRequest(req);
    if (!user) return res.status(401).json({ error: '请先登录' });
    req.user = user;
    return runtime.runWithWorkspace(user.workspaceId, () => next(), {
      userRole: user.role,
      userId: user.id
    });
  });

  app.post('/api/auth/password', async (req, res) => {
    try {
      const user = await auth.changeOwnPassword(req.user.id, req.body?.currentPassword, req.body?.newPassword, req.body?.requestId);
      return res.json({ data: user });
    } catch (error) {
      return res.status(400).json({ error: error?.message || String(error) });
    }
  });

  app.get('/api/auth/users', async (req, res) => {
    if (!isTeamAdmin(req.user)) return res.status(403).json({ error: '只有管理员可以查看团队账号' });
    const users = await auth.listUsers();
    return res.json({ data: visibleUsersForActor(users, req.user) });
  });

  app.post('/api/auth/users/:id/require-password-change', async (req, res) => {
    if (!isSuperAdmin(req.user)) return res.status(403).json({ error: '只有超级管理员可以要求用户强制改密' });
    try {
      return res.json({ data: await auth.requirePasswordChange(req.params.id, req.user.id) });
    } catch (error) {
      return res.status(400).json({ error: error?.message || String(error) });
    }
  });

  app.post('/api/auth/users/:id/reveal-password', async (req, res) => {
    if (!isSuperAdmin(req.user)) return res.status(403).json({ error: '只有超级管理员可以查看已记录密码' });
    try {
      return res.json({ data: await auth.revealUserPassword(req.params.id, req.user.id, req.body?.currentPassword) });
    } catch (error) {
      return res.status(400).json({ error: error?.message || String(error) });
    }
  });

  app.post('/api/auth/password-policy/require-all', async (req, res) => {
    if (!isSuperAdmin(req.user)) return res.status(403).json({ error: '只有超级管理员可以要求用户强制改密' });
    try {
      return res.json({ data: await auth.requireAllPasswordChanges(req.user.id) });
    } catch (error) {
      return res.status(400).json({ error: error?.message || String(error) });
    }
  });

  app.post('/api/auth/users', async (req, res) => {
    if (!isTeamAdmin(req.user)) return res.status(403).json({ error: '只有管理员可以创建团队账号' });
    try {
      const payload = { ...(req.body || {}) };
      if (req.user.role !== 'superadmin') payload.role = 'member';
      const user = await auth.createUser(payload, {
        actorRole: req.user.role,
        parentUserId: req.user.role === 'admin' ? req.user.id : ''
      });
      await runtime.runWithWorkspace(user.workspaceId, () => runtime.initializeRuntime());
      await runtime.billing.ensureAccount(user.workspaceId);
      return res.status(201).json({ data: user });
    } catch (error) {
      return res.status(400).json({ error: error?.message || String(error) });
    }
  });

  app.patch('/api/auth/users/:id', async (req, res) => {
    if (!isTeamAdmin(req.user)) return res.status(403).json({ error: '只有管理员可以管理团队账号' });
    try {
      const target = await auth.getUserById(req.params.id);
      if (!canManageUser(req.user, target)) return res.status(403).json({ error: `不能编辑该${roleName(target?.role)}账号` });
      return res.json({ data: await auth.updateUser(req.params.id, req.body || {}, req.user) });
    } catch (error) {
      return res.status(400).json({ error: error?.message || String(error) });
    }
  });

  app.delete('/api/auth/users/:id', async (req, res) => {
    if (!isTeamAdmin(req.user)) return res.status(403).json({ error: '只有管理员可以管理团队账号' });
    try {
      const target = await auth.getUserById(req.params.id);
      if (!canManageUser(req.user, target)) return res.status(403).json({ error: `不能删除该${roleName(target?.role)}账号` });
      return res.json({ data: await auth.deleteUser(req.params.id, req.user) });
    } catch (error) {
      return res.status(400).json({ error: error?.message || String(error) });
    }
  });

  app.get('/api/alipay/config', async (req, res) => {
    if (req.user.role !== 'admin' && !isSuperAdmin(req.user)) return res.status(403).json({ error: '当前账号不能使用 Alipay' });
    try {
      const [settings, relayChoices] = await Promise.all([alipayRecharge.getSettings(), runtime.loadRelayChoices(true)]);
      return res.json({ data: { ...settings, qrUrl: settings.qrAvailable ? '/api/alipay/qr' : '', activeServiceId: relayChoices.activeRelayId, services: relayChoices.relays.map(relay => ({ id: relay.id, name: relay.name, description: relay.description })) } });
    } catch (error) { return res.status(400).json({ error: error?.message || String(error) }); }
  });

  app.get('/api/alipay/qr', async (_req, res) => {
    const settings = await alipayRecharge.getSettings();
    if (!settings.qrAvailable) return res.status(404).json({ error: '收款码尚未配置' });
    return res.sendFile(alipayRecharge.qrFile);
  });

  app.get('/api/alipay/recharges', async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: '当前账号不能提交充值核验' });
    return res.json({ data: await alipayRecharge.listMine(req.user.id) });
  });

  app.post('/api/alipay/recharges', async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: '当前账号不能提交充值核验' });
    try {
      const relayChoices = await runtime.loadRelayChoices(true);
      const relay = relayChoices.relays.find(item => item.id === String(req.body?.serviceId || '').trim());
      if (!req.body?.serviceId) throw new Error('请选择充值到账账户');
      if (!relay) throw new Error('当前服务暂不可用');
      const order = await alipayRecharge.createOrder(req.body || {}, { userId: req.user.id, workspaceId: req.user.workspaceId, username: req.user.username, displayName: req.user.displayName, relayId: relay.id, relayName: relay.name });
      return res.status(201).json({ data: order });
    } catch (error) { return res.status(400).json({ error: error?.message || String(error) }); }
  });

  app.get('/api/alipay/settings', async (req, res) => {
    if (!isSuperAdmin(req.user)) return res.status(403).json({ error: '无权查看 Alipay 配置' });
    return res.json({ data: await alipayRecharge.getSettings() });
  });
  app.put('/api/alipay/settings', async (req, res) => {
    if (!isSuperAdmin(req.user)) return res.status(403).json({ error: '无权修改 Alipay 配置' });
    try { return res.json({ data: await alipayRecharge.saveSettings(req.body || {}) }); }
    catch (error) { return res.status(400).json({ error: error?.message || String(error) }); }
  });
  app.post('/api/alipay/settings/qr', (req, res, next) => {
    if (!isSuperAdmin(req.user)) return res.status(403).json({ error: '无权修改 Alipay 配置' });
    return next();
  }, upload.single('qr'), async (req, res) => {
    if (!req.file?.path) return res.status(400).json({ error: '请选择支付宝收款码图片' });
    const temporary = `${alipayRecharge.qrFile}.${process.pid}.tmp.png`;
    try {
      await fsp.mkdir(path.dirname(alipayRecharge.qrFile), { recursive: true });
      await sharp(req.file.path, { failOn: 'error', limitInputPixels: 40_000_000 }).rotate().resize({ width: 1400, height: 1400, fit: 'inside', withoutEnlargement: true }).png().toFile(temporary);
      await fsp.rename(temporary, alipayRecharge.qrFile);
      return res.json({ data: await alipayRecharge.getSettings() });
    } catch {
      await fsp.rm(temporary, { force: true }).catch(() => {});
      return res.status(400).json({ error: '收款码图片无法识别，请使用 JPG、PNG 或 WebP 图片' });
    } finally { await fsp.rm(req.file.path, { force: true }).catch(() => {}); }
  });
  app.get('/api/alipay/review', async (req, res) => {
    if (!isSuperAdmin(req.user)) return res.status(403).json({ error: '无权查看充值核验记录' });
    return res.json({ data: await alipayRecharge.listReview() });
  });
  app.post('/api/alipay/recharges/:id/approve', async (req, res) => {
    if (!isSuperAdmin(req.user)) return res.status(403).json({ error: '无权处理充值核验' });
    try { return res.json({ data: await alipayRecharge.approve(req.params.id, req.body || {}, req.user.id) }); }
    catch (error) { return res.status(400).json({ error: error?.message || String(error) }); }
  });
  app.post('/api/alipay/recharges/:id/reject', async (req, res) => {
    if (!isSuperAdmin(req.user)) return res.status(403).json({ error: '无权处理充值核验' });
    try { return res.json({ data: await alipayRecharge.reject(req.params.id, req.body?.reason) }); }
    catch (error) { return res.status(400).json({ error: error?.message || String(error) }); }
  });

  app.get('/api/billing/me', async (req, res) => {
    try {
      const days = Math.max(1, Math.min(3660, Math.trunc(Number(req.query.days) || 30)));
      const relayChoices = await runtime.loadRelayChoices(true);
      const requestedRelayId = String(req.query.relayId || relayChoices.activeRelayId || 'default-relay');
      const relay = relayChoices.relays.find(item => item.id === requestedRelayId);
      const relayId = relay?.id || relayChoices.activeRelayId || 'default-relay';
      const data = await runtime.billing.getSummary(req.user.workspaceId, relayId, 30);
      data.relays = relayChoices.relays;
      data.activeRelayId = relayChoices.activeRelayId;
      if (![1, 7, 30].includes(days)) data.spendTotals = {
        ...(data.spendTotals || {}),
        ...(await runtime.billing.getSpendTotals(req.user.workspaceId, [days], relayId))
      };
      data.customSpendDays = days;
      return res.json({ data });
    } catch (error) {
      return res.status(400).json({ error: error?.message || String(error) });
    }
  });

  app.get('/api/billing/admin', async (req, res) => {
    if (!isTeamAdmin(req.user)) return res.status(403).json({ error: '只有管理员可以查看团队算力余额' });
    try {
      const allUsers = await auth.listUsers();
      const users = billingVisibleUsersForActor(allUsers, req.user);
      const visibleWorkspaceIds = new Set(users.map(user => user.workspaceId));
      const relayChoices = await runtime.loadRelayChoices(true);
      const [rules, accounts, transactions] = await Promise.all([
        req.user.role === 'superadmin' ? runtime.billing.getRules() : Promise.resolve(undefined),
        runtime.billing.listAccounts(users.map(user => user.workspaceId), relayChoices.relays.map(relay => relay.id)),
        runtime.billing.listTransactions('', 150)
      ]);
      const visibleTransactions = transactions.filter(entry => visibleWorkspaceIds.has(entry.workspaceId));
      const byWorkspace = new Map(accounts.map(account => [account.workspaceId, account]));
      return res.json({
        data: {
          role: req.user.role,
          relays: relayChoices.relays,
          activeRelayId: relayChoices.activeRelayId,
          ...(req.user.role === 'superadmin' ? { rules } : {}),
          users: users.map(user => ({ ...user, billing: byWorkspace.get(user.workspaceId) })),
          transactionUsers: users.map(user => ({
              id: user.id,
              username: user.username,
              displayName: user.displayName,
              role: user.role,
              active: user.active,
              workspaceId: user.workspaceId
          })),
          transactions: visibleTransactions
        }
      });
    } catch (error) {
      return res.status(400).json({ error: error?.message || String(error) });
    }
  });

  app.get('/api/billing/global-stats', async (req, res) => {
    if (!isSuperAdmin(req.user)) return res.status(403).json({ error: '只有超级管理员可以查看全局统计' });
    try {
      const users = await auth.listUsers();
      const userLookup = new Map(users.map(user => [user.workspaceId, user]));
      const range = String(req.query.range || 'today');
      const relayChoices = await runtime.loadRelayChoices();
      const requestedRelayId = String(req.query.relayId || '');
      const selectedRelay = relayChoices.relays.find(relay => relay.id === requestedRelayId)
        || relayChoices.relays.find(relay => relay.id === relayChoices.activeRelayId)
        || relayChoices.relays[0];
      if (!selectedRelay) return res.status(400).json({ error: '暂无可用中转站，请先在 API 设置中启用中转站' });
      const [stats, transactions] = await Promise.all([
        runtime.billing.getGlobalStats(range, userLookup, selectedRelay.id),
        runtime.billing.listTransactions('', 300, selectedRelay.id)
      ]);
      const startedAt = new Date(stats.startedAt).getTime();
      const endedAt = new Date(stats.endedAt).getTime();
      const visibleTransactions = transactions.filter(entry => {
        if (userLookup.get(entry.workspaceId)?.role === 'superadmin') return false;
        const createdAt = new Date(entry.createdAt).getTime();
        return Number.isFinite(createdAt) && createdAt >= startedAt && createdAt < endedAt;
      }).slice(0, 50).map(entry => {
        const user = userLookup.get(entry.workspaceId) || {};
        return {
          ...entry,
          username: user.username || entry.workspaceId,
          displayName: user.displayName || user.username || entry.workspaceId
        };
      });
      return res.json({
        data: {
          ...stats,
          relayId: selectedRelay.id,
          relays: relayChoices.relays,
          activeRelayId: relayChoices.activeRelayId,
          transactions: visibleTransactions
        }
      });
    } catch (error) {
      return res.status(400).json({ error: error?.message || String(error) });
    }
  });

  app.get('/api/billing/accounting', async (req, res) => {
    if (!isSuperAdmin(req.user)) return res.status(403).json({ error: '只有超级管理员可以查看经营账目' });
    try {
      return res.json({ data: await businessSnapshot.accounting(req.query || {}) });
    } catch (error) {
      return res.status(400).json({ error: error?.message || String(error) });
    }
  });

  app.get('/api/relays', async (req, res) => {
    if (!isTeamAdmin(req.user)) return res.status(403).json({ error: '只有管理员可以查看中转站' });
    try {
      return res.json({ data: await runtime.loadRelayChoices() });
    } catch (error) {
      return res.status(400).json({ error: error?.message || String(error) });
    }
  });

  app.put('/api/relays/selection', async (req, res) => {
    if (!isTeamAdmin(req.user)) return res.status(403).json({ error: '只有管理员可以切换中转站' });
    try {
      return res.json({ data: await runtime.saveActiveRelay(req.body?.activeRelayId) });
    } catch (error) {
      return res.status(400).json({ error: error?.message || String(error) });
    }
  });

  app.get('/api/finance/ledger', async (req, res) => {
    if (!isSuperAdmin(req.user)) return res.status(403).json({ error: '只有超级管理员可以查看财务账本' });
    try {
      return res.json({ data: await runtime.financeLedger.list(String(req.query.month || '')) });
    } catch (error) {
      return res.status(400).json({ error: error?.message || String(error) });
    }
  });

  app.post('/api/finance/entries', async (req, res) => {
    if (!isSuperAdmin(req.user)) return res.status(403).json({ error: '只有超级管理员可以新增财务记录' });
    try {
      return res.status(201).json({ data: await runtime.financeLedger.create(req.body || {}) });
    } catch (error) {
      return res.status(400).json({ error: error?.message || String(error) });
    }
  });

  app.put('/api/finance/entries/:id', async (req, res) => {
    if (!isSuperAdmin(req.user)) return res.status(403).json({ error: '只有超级管理员可以修改财务记录' });
    try {
      return res.json({ data: await runtime.financeLedger.update(req.params.id, req.body || {}) });
    } catch (error) {
      return res.status(400).json({ error: error?.message || String(error) });
    }
  });

  app.delete('/api/finance/entries/:id', async (req, res) => {
    if (!isSuperAdmin(req.user)) return res.status(403).json({ error: '只有超级管理员可以删除财务记录' });
    try {
      return res.json({ data: await runtime.financeLedger.remove(req.params.id) });
    } catch (error) {
      return res.status(400).json({ error: error?.message || String(error) });
    }
  });

  app.put('/api/billing/rules', async (req, res) => {
    if (!isSuperAdmin(req.user)) return res.status(403).json({ error: '只有超级管理员可以修改计费规则' });
    try {
      return res.json({ data: await runtime.billing.saveRules(req.body || {}) });
    } catch (error) {
      return res.status(400).json({ error: error?.message || String(error) });
    }
  });

  app.delete('/api/billing/ledger', async (req, res) => {
    if (!isSuperAdmin(req.user)) return res.status(403).json({ error: '只有超级管理员可以清空费用流水' });
    try {
      return res.json({ data: await runtime.billing.clearTransactions() });
    } catch (error) {
      return res.status(400).json({ error: error?.message || String(error) });
    }
  });

  app.post('/api/billing/adjust', async (req, res) => {
    if (!isTeamAdmin(req.user)) return res.status(403).json({ error: '只有管理员可以调整余额' });
    try {
      const user = (await auth.listUsers()).find(item => item.id === String(req.body?.userId || ''));
      if (!user) return res.status(404).json({ error: '账号不存在' });
      const relayChoices = await runtime.loadRelayChoices(true);
      const relayId = String(req.body?.relayId || '');
      const relay = relayChoices.relays.find(item => item.id === relayId);
      if (!relay) return res.status(400).json({ error: '请选择有效的中转站' });
      let result;
      const amountMinor = billingAmountMinorFromRequest(req.body || {});
      if (req.user.role === 'superadmin') {
        result = await runtime.billing.adjustBalance(user.workspaceId, relayId, amountMinor, {
          description: req.body?.description,
          operatorUserId: req.user.id,
          relayName: relay.name
        });
      } else {
        if (!canManageUser(req.user, user)) return res.status(403).json({ error: '只能给自己的成员账号划拨算力余额' });
        if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) return res.status(400).json({ error: '管理员只能输入正数划拨算力余额' });
        result = await runtime.billing.transferBalance(req.user.workspaceId, user.workspaceId, relayId, amountMinor, {
          debitDescription: '成员账户划拨',
          creditDescription: '账户充值到账',
          operatorUserId: req.user.id,
          relayName: relay.name
        });
      }
      return res.json({ data: result });
    } catch (error) {
      return res.status(400).json({ error: error?.message || String(error) });
    }
  });

  app.post('/api/billing/transfer', async (req, res) => {
    if (!isTeamAdmin(req.user)) return res.status(403).json({ error: '只有管理员可以划拨余额' });
    try {
      const users = await auth.listUsers();
      const fromUser = users.find(item => item.id === String(req.body?.fromUserId || ''));
      const toUser = users.find(item => item.id === String(req.body?.toUserId || ''));
      if (!fromUser || !toUser) return res.status(404).json({ error: '转出或转入账号不存在' });
      if (!canTransferUserBalance(req.user, fromUser) || !canTransferUserBalance(req.user, toUser)) {
        return res.status(403).json({ error: '只能在自己和自己的员工账号之间划拨余额' });
      }
      const relayChoices = await runtime.loadRelayChoices(true);
      const relayId = String(req.body?.relayId || '');
      const relay = relayChoices.relays.find(item => item.id === relayId);
      if (!relay) return res.status(400).json({ error: '请选择有效的中转站' });
      const amountMinor = billingAmountMinorFromRequest(req.body || {});
      const result = await runtime.billing.transferBalance(fromUser.workspaceId, toUser.workspaceId, relayId, amountMinor, {
        debitDescription: `划拨给 ${toUser.displayName || toUser.username}`,
        creditDescription: `收到 ${fromUser.displayName || fromUser.username} 划拨`,
        operatorUserId: req.user.id,
        relayName: relay.name
      });
      return res.json({
        data: {
          ...result,
          fromUserId: fromUser.id,
          toUserId: toUser.id
        }
      });
    } catch (error) {
      return res.status(400).json({ error: error?.message || String(error) });
    }
  });

  app.post('/api/rpc', async (req, res) => {
    const method = String(req.body?.method || '');
    const handler = rpc[method];
    if (!handler) return res.status(404).json({ error: `未知操作：${method}` });
    if (!canAccessRpc(req.user, method)) return res.status(403).json({ error: '只有管理员可以访问此设置' });
    if (LONG_JOB_METHODS.has(method)) return res.status(409).json({ error: '该操作必须通过后台任务接口执行' });
    try {
      return res.json({ data: await handler(Array.isArray(req.body?.args) ? req.body.args : [], { user: req.user }) });
    } catch (error) {
      console.error(`[rpc:${method}]`, error);
      return res.status(400).json({ error: error?.message || String(error) });
    }
  });

  app.post('/api/jobs', async (req, res) => {
    const method = String(req.body?.method || '');
    if (!LONG_JOB_METHODS.has(method) || !rpc[method]) return res.status(404).json({ error: `未知后台任务：${method}` });
    if (!consumeJobRate(req.ip)) return res.status(429).json({ error: '后台任务提交过于频繁，请稍后再试' });
    try {
      const job = await enqueueJob(method, Array.isArray(req.body?.args) ? req.body.args : [], req.body?.clientKey, req.user);
      return res.status(job.status === 'completed' ? 200 : 202).json({ data: publicJob(job) });
    } catch (error) {
      return res.status(400).json({ error: error?.message || String(error) });
    }
  });

  app.get('/api/jobs/:id', async (req, res) => {
    const job = await readJob(req.params.id);
    if (!job) return res.sendStatus(404);
    return res.json({ data: publicJob(job) });
  });

  app.post('/api/jobs/:id/cancel', async (req, res) => {
    const job = await cancelJob(req.params.id);
    if (!job) return res.sendStatus(404);
    return res.json({ data: publicJob(job) });
  });

  app.post('/api/jobs/cancel-active', async (req, res) => {
    return res.json({ data: await cancelWorkspaceJobs(req.user.workspaceId) });
  });

  app.post('/api/assets/sync/prepare/:kind', async (req, res, next) => {
    try {
      return res.json({ data: await prepareAssetSync(req.params.kind, req.body || {}, req.user.workspaceId) });
    } catch (error) { next(error); }
  });

  app.post('/api/assets/sync/upload/:sessionId', upload.array('files', 80), async (req, res, next) => {
    try {
      let relativePaths = [];
      let lastModifiedValues = [];
      try { relativePaths = JSON.parse(req.body.relativePaths || '[]'); } catch {}
      try { lastModifiedValues = JSON.parse(req.body.lastModified || '[]'); } catch {}
      return res.json({ data: await uploadAssetSyncBatch(req.params.sessionId, req.files || [], relativePaths, lastModifiedValues, req.user.workspaceId) });
    } catch (error) { next(error); }
  });

  app.post('/api/assets/sync/finish/:sessionId', async (req, res, next) => {
    try {
      return res.json({ data: await finishAssetSync(req.params.sessionId, req.user.workspaceId) });
    } catch (error) { next(error); }
  });

  app.post('/api/assets/files/:kind', upload.array('files', 500), async (req, res, next) => {
    try {
      let relativePaths = [];
      try { relativePaths = JSON.parse(req.body.relativePaths || '[]'); } catch {}
      return res.json({ data: await addAssetFiles(req.params.kind, req.body.root, req.files || [], relativePaths) });
    } catch (error) { next(error); }
  });

  app.delete('/api/assets/files/:kind', async (req, res, next) => {
    try {
      return res.json({ data: await deleteAssetFiles(req.params.kind, req.body?.root, req.body?.paths) });
    } catch (error) { next(error); }
  });

  app.get('/api/billing/detail', async (req, res) => {
    try {
      const allUsers = await auth.listUsers();
      const visibleUsers = isTeamAdmin(req.user) ? billingVisibleUsersForActor(allUsers, req.user) : allUsers.filter(user => user.id === req.user.id);
      const requestedUserId = String(req.query.userId || (isTeamAdmin(req.user) ? 'team' : req.user.id));
      const teamView = requestedUserId === 'team';
      if (teamView && !isTeamAdmin(req.user)) return res.status(403).json({ error: '不能查看全团队费用明细' });
      const target = teamView ? null : visibleUsers.find(user => user.id === requestedUserId);
      if (!teamView && !target) return res.status(403).json({ error: '不能查看该账号的费用明细' });
      const relayChoices = await runtime.loadRelayChoices(true);
      const requestedRelayId = String(req.query.relayId || 'all');
      const relay = relayChoices.relays.find(item => item.id === requestedRelayId);
      if (requestedRelayId !== 'all' && !relay) return res.status(400).json({ error: '服务账户不存在或不可用' });
      const reportUsers = teamView ? visibleUsers : [target];
      const report = await runtime.billing.getLedgerReport(new Map(reportUsers.map(user => [user.workspaceId, user])), { relayId: requestedRelayId === 'all' ? '' : requestedRelayId, range: String(req.query.range || 'today'), startDate: req.query.startDate, endDate: req.query.endDate, limit: 500 });
      const data = { ...report, transactions: report.transactions.map(({ operatorUserId, onceKey, ...entry }) => entry), relays: relayChoices.relays, activeRelayId: relayChoices.activeRelayId, relayId: requestedRelayId, viewedUser: teamView ? { id: 'team', username: '', displayName: '全团队', role: 'team' } : { id: target.id, username: target.username, displayName: target.displayName, role: target.role }, users: visibleUsers.map(user => ({ id: user.id, username: user.username, displayName: user.displayName, role: user.role, workspaceId: user.workspaceId })) };
      return res.json({ data });
    } catch (error) { return res.status(400).json({ error: error?.message || String(error) }); }
  });

  app.patch('/api/assets/folders/:kind', async (req, res, next) => {
    try {
      return res.json({ data: await renameAssetFolder(req.params.kind, req.body?.root, req.body?.folder, req.body?.name) });
    } catch (error) { next(error); }
  });

  app.post('/api/upload/folder/:kind', upload.array('files', 10000), (req, res, next) => {
    handleFolderUpload(req, res).catch(next);
  });

  app.post('/api/upload/image', upload.single('file'), async (req, res, next) => {
    try {
      if (!req.file) return res.status(400).json({ error: '没有收到图片' });
      const originalName = uploadName(req.file);
      const extension = path.extname(originalName).toLowerCase();
      if (!['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif', '.tif', '.tiff'].includes(extension)) {
        await fsp.rm(req.file.path, { force: true });
        return res.status(415).json({ error: '不支持的图片格式' });
      }
      const destination = path.join(assetRoot(), 'free', `${Date.now()}-${crypto.randomBytes(4).toString('hex')}${extension}`);
      await moveUploadedFile(req.file.path, destination);
      return res.json({ path: destination, name: safeSegment(originalName), url: fileUrl(destination) });
    } catch (error) { next(error); }
  });

  app.get('/api/files/:token', async (req, res) => {
    const file = decodeFileToken(req.params.token);
    const stat = file ? await fsp.stat(file).catch(() => null) : null;
    if (!stat?.isFile()) return res.sendStatus(404);
    if (req.query.download === '1') res.download(file, path.basename(file));
    else {
      res.set('Cache-Control', req.query.v ? 'private, max-age=31536000, immutable' : 'private, no-cache');
      res.sendFile(file, { dotfiles: 'allow' });
    }
  });

  app.get('/api/zip/:token', async (req, res, next) => {
    try {
      const folder = decodeFileToken(req.params.token);
      const stat = folder ? await fsp.stat(folder).catch(() => null) : null;
      if (!stat?.isDirectory()) return res.sendStatus(404);
      const archive = await createFolderZip(folder);
      const downloadName = await buildZipDownloadName(folder);
      res.set({
        'Content-Type': 'application/zip',
        'Content-Disposition': zipAttachmentName(downloadName),
        'Cache-Control': 'private, no-cache'
      });
      return res.send(archive);
    } catch (error) {
      return next(error);
    }
  });

  app.post('/api/zip/childrenwear-batch', async (req, res, next) => {
    try {
      const requested = Array.isArray(req.body?.folders) ? req.body.folders : [];
      if (!requested.length) return res.status(400).json({ error: '请先选择需要下载的款式任务' });
      if (requested.length > 30) return res.status(400).json({ error: '单次最多批量下载 30 个款式任务' });
      const folders = [...new Set(requested.map(folder => managedPath(folder, { message: '存在不属于当前输出目录的任务' })))];
      const archive = await createChildrenwearBatchZip(folders);
      const stamp = zipDateStamp('', new Date());
      res.set({
        'Content-Type': 'application/zip',
        'Content-Disposition': zipAttachmentName(`童装任务${stamp}-${String(folders.length).padStart(3, '0')}款`),
        'Cache-Control': 'private, no-cache'
      });
      return res.send(archive);
    } catch (error) {
      return next(error);
    }
  });

  app.get('/api/thumbnails/:token', async (req, res) => {
    const file = decodeFileToken(req.params.token);
    const stat = file ? await fsp.stat(file).catch(() => null) : null;
    if (!stat?.isFile() || !SUPPORTED_IMAGE_EXTENSIONS.has(path.extname(file).toLowerCase())) return res.sendStatus(404);
    try {
      const thumbnail = await createAssetThumbnail(file, req.query.w);
      res.set({
        'Cache-Control': req.query.v ? 'private, max-age=31536000, immutable' : 'private, no-cache',
        'X-Thumbnail-Cache': thumbnail.cacheHit ? 'HIT' : 'MISS'
      });
      res.type('image/webp');
      return res.sendFile(thumbnail.file, { dotfiles: 'allow' });
    } catch (error) {
      console.warn(`[thumbnail] ${path.basename(file)}: ${error?.message || error}`);
      res.set('Cache-Control', 'private, no-cache');
      return res.sendFile(file, { dotfiles: 'allow' });
    }
  });

  app.get('/api/browse', async (req, res) => {
    const folder = decodeFileToken(req.query.path);
    const stat = folder ? await fsp.stat(folder).catch(() => null) : null;
    if (!stat?.isDirectory()) return res.sendStatus(404);
    const entries = await fsp.readdir(folder, { withFileTypes: true });
    const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    const items = entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN', { numeric: true })).map(entry => {
      const target = path.join(folder, entry.name);
      const token = runtime.fileToken(target);
      const href = entry.isDirectory() ? `/api/browse?path=${token}` : `${fileUrl(target)}?download=1`;
      return `<li><a href="${href}">${entry.isDirectory() ? '文件夹' : '文件'} · ${escape(entry.name)}</a></li>`;
    }).join('');
    res.type('html').send(`<!doctype html><meta charset="utf-8"><title>多嘻噜卡科技</title><style>body{font:16px system-ui;max-width:900px;margin:48px auto;padding:0 24px}li{margin:12px 0}a{color:#174b3a}</style><p>多嘻噜卡科技</p><h1>${escape(path.basename(folder))}</h1><ul>${items}</ul>`);
  });

  const webDist = path.resolve(__dirname, '../../web/dist');
  if (fs.existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get(/.*/, (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
  }

  app.use((error, _req, res, _next) => {
    console.error(error);
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: `单个文件不能超过 ${UPLOAD_FILE_LIMIT_MB}MB` });
    }
    res.status(400).json({ error: error?.message || '请求失败' });
  });

  const server = app.listen(PORT, HOST, () => {
    console.log(`多嘻噜卡科技 Web 已启动：http://${HOST}:${PORT}`);
    for (const user of existingUsers) {
      void runtime.runWithWorkspace(user.workspaceId, () => pruneThumbnailCache())
        .catch(error => console.warn(`[thumbnail-cache] ${error?.message || error}`));
    }
  });
  const analysisSweepTimer = setInterval(() => { void runChildrenwearAutoAnalysisSweep(); }, 30_000);
  analysisSweepTimer.unref?.();
  server.once('close', () => clearInterval(analysisSweepTimer));
  return server;
}

if (require.main === module) startServer().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

module.exports = {
  addAssetFiles,
  buildZipDownloadName,
  canAccessRpc,
  collectZipDownloadEntries,
  createChildrenwearBatchZip,
  createFolderZip,
  createAssetThumbnail,
  decodeFileToken,
  deleteAssetFiles,
  isWithin,
  normalizedThumbnailWidth,
  renameAssetFolder,
  safeRelative,
  startServer,
  UPLOAD_FILE_LIMIT_MB,
  writeJob
};
