const fs = require('node:fs/promises');
const path = require('node:path');

function safeSegment(value, fallback = 'item') {
  return String(value || fallback).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || fallback;
}

function sanitizeUser(user = {}) {
  if (!user || typeof user !== 'object') return null;
  return {
    id: String(user.id || ''),
    username: String(user.username || ''),
    displayName: String(user.displayName || '')
  };
}

function sanitizeStore(store = {}) {
  return {
    id: String(store.id || ''),
    name: String(store.name || ''),
    ownerUserId: String(store.ownerUserId || ''),
    autoPublish: store.autoPublish !== false,
    online: store.online === true
  };
}

function sanitizeTask(task = {}) {
  const detail = task.detail && typeof task.detail === 'object' ? { ...task.detail } : {};
  delete detail.diagnosticScreenshot;
  return {
    id: String(task.id || ''),
    name: String(task.name || ''),
    status: String(task.status || ''),
    storeId: String(task.storeId || ''),
    storeName: String(task.storeName || ''),
    deviceId: String(task.deviceId || ''),
    failureReason: String(task.failureReason || ''),
    updatedAt: String(task.updatedAt || ''),
    attempts: Number(task.attempts || 0),
    detail,
    timeline: Array.isArray(task.timeline) ? task.timeline : []
  };
}

function screenshotPathsFromState(state = {}) {
  const paths = new Set();
  for (const task of Array.isArray(state.tasks) ? state.tasks : []) {
    const detail = task?.detail && typeof task.detail === 'object' ? task.detail : {};
    if (detail.screenshotPath) paths.add(String(detail.screenshotPath));
    if (detail.diagnosticScreenshotPath) paths.add(String(detail.diagnosticScreenshotPath));
    for (const item of Array.isArray(task.timeline) ? task.timeline : []) {
      if (item?.screenshotPath) paths.add(String(item.screenshotPath));
      if (item?.diagnosticScreenshotPath) paths.add(String(item.diagnosticScreenshotPath));
    }
  }
  return [...paths].filter(Boolean);
}

async function copyIfInsideUserData(source, destinationFolder, userDataPath) {
  const resolved = path.resolve(String(source || ''));
  const root = path.resolve(userDataPath);
  const relative = path.relative(root, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  const stat = await fs.stat(resolved).catch(() => null);
  if (!stat?.isFile() || stat.size > 8 * 1024 * 1024) return null;
  await fs.mkdir(destinationFolder, { recursive: true });
  const target = path.join(destinationFolder, `${Date.now()}-${safeSegment(path.basename(resolved))}`);
  await fs.copyFile(resolved, target);
  return target;
}

async function createPublisherDiagnosticBundle({ userDataPath, state = {}, now = new Date() } = {}) {
  if (!userDataPath) throw new Error('缺少诊断目录');
  const root = path.resolve(userDataPath);
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const folder = path.join(root, 'diagnostic-bundles', `publisher-${stamp}`);
  await fs.mkdir(folder, { recursive: true });

  const logFile = path.join(root, 'publisher.log');
  if (await fs.stat(logFile).then(stat => stat.isFile()).catch(() => false)) {
    await fs.copyFile(logFile, path.join(folder, 'publisher.log'));
  } else {
    await fs.writeFile(path.join(folder, 'publisher.log'), '', 'utf8');
  }

  const screenshotFolder = path.join(folder, 'screenshots');
  const copiedScreenshots = [];
  for (const screenshotPath of screenshotPathsFromState(state)) {
    const copied = await copyIfInsideUserData(screenshotPath, screenshotFolder, root);
    if (copied) copiedScreenshots.push(copied);
  }

  const diagnostic = {
    exportedAt: now.toISOString(),
    appVersion: String(state.appVersion || ''),
    apiBaseUrl: String(state.apiBaseUrl || ''),
    deviceId: String(state.deviceId || ''),
    activeStoreId: String(state.activeStoreId || ''),
    autoPublish: state.autoPublish !== false,
    user: sanitizeUser(state.user),
    stores: (Array.isArray(state.stores) ? state.stores : []).map(sanitizeStore),
    tasks: (Array.isArray(state.tasks) ? state.tasks : []).map(sanitizeTask),
    screenshots: copiedScreenshots.map(file => path.basename(file))
  };
  await fs.writeFile(path.join(folder, 'diagnostic.json'), JSON.stringify(diagnostic, null, 2), 'utf8');
  return { folder, files: ['diagnostic.json', 'publisher.log'], screenshots: copiedScreenshots };
}

module.exports = { createPublisherDiagnosticBundle };
