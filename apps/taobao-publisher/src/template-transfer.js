const fs = require('node:fs/promises');
const path = require('node:path');

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function normalizeCategories(value) {
  const categories = Array.isArray(value) ? value : [];
  return categories
    .filter(item => item && typeof item === 'object')
    .map(item => {
      const category = cloneJson(item);
      delete category.stores;
      delete category.user;
      delete category.token;
      if (!category.id) category.id = `imported-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      if (!category.name) category.name = category.id;
      category.defaults = category.defaults && typeof category.defaults === 'object' ? category.defaults : {};
      category.defaults.selectors = category.defaults.selectors && typeof category.defaults.selectors === 'object'
        ? category.defaults.selectors
        : {};
      return category;
    });
}

function buildTemplateExport(state = {}, { now = new Date() } = {}) {
  return {
    version: 1,
    exportedAt: now.toISOString(),
    appVersion: String(state.appVersion || ''),
    categories: normalizeCategories(state.settings?.categories || state.categories || [])
  };
}

function parseTemplateImport(text) {
  let payload;
  try {
    payload = JSON.parse(String(text || ''));
  } catch {
    throw new Error('模板文件不是有效 JSON');
  }
  const categories = normalizeCategories(Array.isArray(payload) ? payload : payload.categories);
  if (!categories.length) throw new Error('没有可导入的类目模板');
  return categories;
}

async function exportTemplateFile({ dialog, appVersion = '', settings = {}, now = new Date() } = {}) {
  if (!dialog?.showSaveDialog) throw new Error('当前环境无法导出模板');
  const result = await dialog.showSaveDialog({
    title: '导出淘宝发布模板',
    defaultPath: `taobao-publisher-templates-${now.toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (result.canceled || !result.filePath) return { canceled: true };
  const payload = buildTemplateExport({ appVersion, settings }, { now });
  await fs.mkdir(path.dirname(result.filePath), { recursive: true });
  await fs.writeFile(result.filePath, JSON.stringify(payload, null, 2), 'utf8');
  return { canceled: false, filePath: result.filePath, count: payload.categories.length };
}

async function importTemplateFile({ dialog } = {}) {
  if (!dialog?.showOpenDialog) throw new Error('当前环境无法导入模板');
  const result = await dialog.showOpenDialog({
    title: '导入淘宝发布模板',
    properties: ['openFile'],
    filters: [{ name: 'JSON', extensions: ['json'] }]
  });
  if (result.canceled || !result.filePaths?.[0]) return { canceled: true };
  const filePath = result.filePaths[0];
  const categories = parseTemplateImport(await fs.readFile(filePath, 'utf8'));
  return { canceled: false, filePath, categories, count: categories.length };
}

module.exports = {
  buildTemplateExport,
  parseTemplateImport,
  exportTemplateFile,
  importTemplateFile
};
