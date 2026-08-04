const fs = require('node:fs/promises');
const path = require('node:path');
const { createTaobaoRunner } = require('./taobao-runner');
const { createPublisherLogStore } = require('./log-store');
const { createPublisherDiagnosticBundle } = require('./diagnostic-bundle');
const { exportTemplateFile, importTemplateFile } = require('./template-transfer');

function start() {
  let electron;
  try {
    electron = require('electron');
  } catch {
    console.log('Electron is not installed. Open src/index.html for the static publisher shell.');
    return;
  }

  const { app, BrowserWindow, ipcMain, shell, dialog } = electron;
  const runner = createTaobaoRunner({ electron, app });
  const logs = createPublisherLogStore({ userDataPath: app.getPath('userData') });
  const isSmoke = process.env.CAISHEN_PUBLISHER_SMOKE === '1';

  const createWindow = async () => {
    const win = new BrowserWindow({
      width: 1180,
      height: 760,
      minWidth: 960,
      minHeight: 620,
      show: !isSmoke,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false
      }
    });
    await win.loadFile(path.join(__dirname, 'index.html'));
    if (isSmoke) {
      const ok = await win.webContents.executeJavaScript(`
        Boolean(
          window.caishenPublisher &&
          document.querySelector('#loginForm') &&
          document.querySelector('#currentApiBaseUrl') &&
          document.querySelector('#storeList') &&
          document.querySelector('#taskList')
        )
      `);
      if (!ok) throw new Error('Publisher shell did not expose required UI and preload bridge');
      console.log('taobao-publisher smoke ok');
      app.quit();
    }
  };

  ipcMain.handle('open-store-login', (_event, store) => runner.openStoreLogin(store || {}));
  ipcMain.handle('check-store-login', (_event, store) => runner.checkStoreLogin(store || {}));
  ipcMain.handle('clear-store-login', (_event, store) => runner.clearStoreLogin(store || {}));
  ipcMain.handle('get-active-element-selector', (_event, store) => runner.getActiveElementSelector(store || {}));
  ipcMain.handle('open-template-publish-page', (_event, payload) => runner.openTemplatePublishPage(payload || {}));
  ipcMain.handle('check-template-selectors', (_event, payload) => runner.checkTemplateSelectors(payload || {}));
  ipcMain.handle('run-taobao-task', (_event, payload) => runner.runTaobaoTask(payload || {}));
  ipcMain.handle('cancel-taobao-task', (_event, taskId) => runner.cancelTask(taskId));
  ipcMain.handle('capture-taobao-page', (_event, payload) => runner.capturePage(payload || {}));
  ipcMain.handle('append-publisher-log', (_event, message) => logs.append(message));
  ipcMain.handle('read-publisher-log', () => logs.read());
  ipcMain.handle('clear-publisher-log', () => logs.clear());
  ipcMain.handle('export-publisher-diagnostics', async (_event, state) => {
    const result = await createPublisherDiagnosticBundle({
      userDataPath: app.getPath('userData'),
      state: state || {}
    });
    await logs.append(`导出诊断包：${result.folder}`);
    shell.showItemInFolder(path.join(result.folder, 'diagnostic.json'));
    return result;
  });
  ipcMain.handle('export-publisher-templates', async (_event, payload) => {
    const result = await exportTemplateFile({
      dialog,
      appVersion: app.getVersion(),
      settings: payload?.settings || {}
    });
    if (!result.canceled) {
      await logs.append(`导出模板配置：${result.filePath}`);
      shell.showItemInFolder(result.filePath);
    }
    return result;
  });
  ipcMain.handle('import-publisher-templates', async () => {
    const result = await importTemplateFile({ dialog });
    if (!result.canceled) await logs.append(`导入模板配置：${result.filePath}`);
    return result;
  });
  ipcMain.handle('read-diagnostic-screenshot', async (_event, filePath) => {
    const resolved = path.resolve(String(filePath || ''));
    const userData = path.resolve(app.getPath('userData'));
    const relative = path.relative(userData, resolved);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
    const stat = await fs.stat(resolved).catch(() => null);
    if (!stat?.isFile() || stat.size > 8 * 1024 * 1024) return null;
    const extension = path.extname(resolved).toLowerCase();
    const mime = extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg' : 'image/png';
    return { mime, base64: (await fs.readFile(resolved)).toString('base64') };
  });
  ipcMain.handle('publisher-file-exists', async (_event, filePath) => {
    const text = String(filePath || '').trim();
    if (!text) return false;
    const stat = await fs.stat(path.resolve(text)).catch(() => null);
    return Boolean(stat?.isFile());
  });
  ipcMain.handle('get-app-info', () => ({
    appVersion: app.getVersion(),
    platform: process.platform
  }));
  ipcMain.handle('open-publisher-log', async () => {
    await logs.append('打开运行日志文件');
    shell.showItemInFolder(logs.filePath);
    return { filePath: logs.filePath };
  });

  app.whenReady().then(createWindow).catch(error => {
    console.error(error.message || String(error));
    app.exit(1);
  });
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}

start();
