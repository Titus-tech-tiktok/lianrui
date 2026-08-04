const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('caishenPublisher', {
  openStoreLogin: store => ipcRenderer.invoke('open-store-login', store),
  checkStoreLogin: store => ipcRenderer.invoke('check-store-login', store),
  clearStoreLogin: store => ipcRenderer.invoke('clear-store-login', store),
  getActiveElementSelector: store => ipcRenderer.invoke('get-active-element-selector', store),
  openTemplatePublishPage: payload => ipcRenderer.invoke('open-template-publish-page', payload),
  checkTemplateSelectors: payload => ipcRenderer.invoke('check-template-selectors', payload),
  runTaobaoTask: payload => ipcRenderer.invoke('run-taobao-task', payload),
  cancelTaobaoTask: taskId => ipcRenderer.invoke('cancel-taobao-task', taskId),
  capturePage: payload => ipcRenderer.invoke('capture-taobao-page', payload),
  appendLog: message => ipcRenderer.invoke('append-publisher-log', message),
  readLog: () => ipcRenderer.invoke('read-publisher-log'),
  clearLog: () => ipcRenderer.invoke('clear-publisher-log'),
  exportDiagnostics: state => ipcRenderer.invoke('export-publisher-diagnostics', state),
  exportTemplates: payload => ipcRenderer.invoke('export-publisher-templates', payload),
  importTemplates: () => ipcRenderer.invoke('import-publisher-templates'),
  readDiagnosticScreenshot: filePath => ipcRenderer.invoke('read-diagnostic-screenshot', filePath),
  fileExists: filePath => ipcRenderer.invoke('publisher-file-exists', filePath),
  getAppInfo: () => ipcRenderer.invoke('get-app-info'),
  openLog: () => ipcRenderer.invoke('open-publisher-log')
});
