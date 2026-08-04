const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const COMPLETE_TEMPLATE_SELECTORS = {
  title: '#title',
  price: '#price',
  stock: '#stock',
  mainImages: '#main-images',
  ratioImages: '#ratio-images',
  detailImages: '#detail-images',
  saveDraft: '#save'
};

test('local Taobao publisher app exposes operator bound workspace screens and API client', async () => {
  const root = path.join(__dirname, '../../taobao-publisher');
  const workspacePackage = await fs.readFile(path.join(__dirname, '../../../package.json'), 'utf8');
  const packageJson = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  const html = await fs.readFile(path.join(root, 'src/index.html'), 'utf8');
  const main = await fs.readFile(path.join(root, 'src/main.js'), 'utf8');
  const preload = await fs.readFile(path.join(root, 'src/preload.js'), 'utf8');
  const renderer = await fs.readFile(path.join(root, 'src/renderer.js'), 'utf8');
  const styles = await fs.readFile(path.join(root, 'src/styles.css'), 'utf8');
  const api = await fs.readFile(path.join(root, 'src/publisher-api.js'), 'utf8');
  const runner = await fs.readFile(path.join(root, 'src/taobao-runner.js'), 'utf8');
  const server = await fs.readFile(path.join(__dirname, '../src/server.js'), 'utf8');
  const packageWindows = await fs.readFile(path.join(root, 'scripts/package-windows.js'), 'utf8');
  const smokeStart = await fs.readFile(path.join(root, 'scripts/smoke-start.js'), 'utf8');
  const checkPackage = await fs.readFile(path.join(root, 'scripts/check-package.js'), 'utf8');

  assert.equal(packageJson.name, '@caishen/taobao-publisher');
  assert.equal(packageJson.scripts.start, 'electron .');
  assert.equal(packageJson.scripts.smoke, 'node scripts/smoke-start.js');
  assert.equal(packageJson.scripts.pack, 'node scripts/package-windows.js --dir');
  assert.equal(packageJson.scripts.dist, 'node scripts/package-windows.js');
  assert.equal(packageJson.devDependencies.electron, '31.7.7');
  assert.equal(packageJson.devDependencies['electron-builder'], '24.13.3');
  assert.equal(typeof packageJson.build.productName, 'string');
  assert.equal(packageJson.build.npmRebuild, false);
  assert.equal(packageJson.build.win.signAndEditExecutable, false);
  assert.match(workspacePackage, /@caishen\/taobao-publisher/);
  assert.match(html, /currentApiBaseUrl/);
  assert.match(html, /readinessList/);
  assert.match(html, /operatorGuideList/);
  assert.match(html, /templateCalibrationList/);
  assert.match(html, /syncStatusLabel/);
  assert.match(html, /syncLastSuccessAt/);
  assert.match(html, /syncLastError/);
  assert.match(html, /appVersion/);
  assert.match(html, /data-tab|currentUser|templateList|logOutput/);
  assert.match(html, /logoutButton/);
  assert.match(html, /dryRunToggle/);
  assert.match(html, /button|section|currentApiBaseUrl/);
  assert.match(html, /publisherNotice/);
  assert.match(html, /runningCount/);
  assert.match(html, /data-tab|currentUser|templateList|logOutput/);
  assert.match(html, /data-tab|currentUser|templateList|logOutput/);
  assert.match(html, /taskDetailPanel/);
  assert.match(html, /taskFilterBar/);
  assert.match(html, /data-tab|currentUser|templateList|logOutput/);
  assert.match(html, /data-tab|currentUser|templateList|logOutput/);
  assert.match(html, /exportLogsButton/);
  assert.match(html, /exportDiagnosticsButton/);
  assert.match(html, /captureTemplateDiagnosticsButton/);
  assert.match(html, /applyTemplateDiagnosticsButton/);
  assert.match(renderer, /checkTemplateSelectors/);
  assert.match(renderer, /data-template-check-selectors/);
  assert.match(renderer, /openTemplatePublishPage/);
  assert.match(renderer, /data-template-open-publish/);
  assert.match(renderer, /template-selector-check-result/);
  assert.match(renderer, /function taskMissingSelectors/);
  assert.match(renderer, /task\.detail\?\.missingSelectors/);
  assert.match(renderer, /missing-selectors/);
  assert.match(renderer, /function exportTaskDiagnosticsBundle/);
  assert.match(renderer, /function renderTaskDiagnosticScreenshot/);
  assert.match(renderer, /diagnosticScreenshotUrl/);
  assert.match(renderer, /task-diagnostic-screenshot/);
  assert.match(renderer, /function taskImageCoverage/);
  assert.match(renderer, /function taskImageSourceIssues/);
  assert.match(renderer, /function taskLocalImageFileIssues/);
  assert.match(renderer, /function taskRequiredFieldIssues/);
  assert.match(renderer, /function renderTaskImageCoverage/);
  assert.match(renderer, /function taskPublishReadinessBlocker/);
  assert.match(renderer, /function taskPublishPreflightBlocker/);
  assert.match(renderer, /function renderTaskPublishReadinessBlocker/);
  assert.match(renderer, /function markTaskPublishReadinessFailed/);
  assert.match(renderer, /task-image-coverage/);
  assert.match(renderer, /publish-readiness-blocker/);
  assert.match(renderer, /图片未齐全/);
  assert.match(renderer, /图片来源缺失/);
  assert.match(renderer, /本地图片文件不存在/);
  assert.match(renderer, /任务字段不完整/);
  assert.match(renderer, /local-publisher-task-required-fields-missing/);
  assert.match(renderer, /回 Web 端补齐标题/);
  assert.match(renderer, /确认任务重新进入待发布队列后再发布/);
  assert.match(renderer, /缺少图片分组/);
  assert.match(renderer, /data-task-export-diagnostic/);
  assert.match(renderer, /function openTaskPublishPage/);
  assert.match(renderer, /data-task-open-publish-page/);
  assert.match(renderer, /task-publish-page-opened/);
  assert.match(renderer, /function openTaskStoreLogin/);
  assert.match(renderer, /data-task-open-store-login/);
  assert.match(renderer, /task-store-login-opened/);
  assert.match(renderer, /function checkTaskStoreLogin/);
  assert.match(renderer, /data-task-check-store-login/);
  assert.match(renderer, /task-store-login-checked/);
  assert.match(renderer, /function taskMatchesFilter/);
  assert.match(renderer, /data-task-filter/);
  assert.match(renderer, /task-filter-button/);
  assert.match(renderer, /tasks:\s*\[task\]/);
  assert.match(renderer, /function taskResolutionHint/);
  assert.match(renderer, /function renderOperatorGuide/);
  assert.match(renderer, /function templateCalibrationSummary/);
  assert.match(renderer, /function renderTemplateCalibrationSummary/);
  assert.match(renderer, /function recordSyncSuccess/);
  assert.match(renderer, /function recordSyncFailure/);
  assert.match(renderer, /renderSyncStatus/);
  assert.match(renderer, /sync-status-ok/);
  assert.match(renderer, /sync-status-error/);
  assert.match(renderer, /data-template-calibration-open/);
  assert.match(renderer, /selectorCalibration/);
  assert.match(renderer, /persistTemplateSelectorCheck/);
  assert.match(renderer, /function templateSelectorSignature/);
  assert.match(renderer, /selectorSignature/);
  assert.match(renderer, /calibration-stale/);
  assert.match(renderer, /function taskTemplateCalibrationBlocker/);
  assert.match(renderer, /local-publisher-template-calibration-required/);
  assert.match(renderer, /template-calibration-required/);
  assert.match(renderer, /先校准淘宝页面控件/);
  assert.match(renderer, /api\.saveSettings/);
  assert.match(renderer, /categories \}\)/);
  assert.match(renderer, /dryRun/);
  assert.match(renderer, /caishen\.publisher\.dryRun/);
  assert.match(renderer, /dryRunToggle/);
  assert.match(renderer, /local-publisher-dry-run-complete/);
  assert.match(renderer, /dryRunStatuses = new Set\(\[[^\]]*试运行通过/);
  assert.match(renderer, /data-task-real-run/);
  assert.match(renderer, /data-guide-action/);
  assert.match(renderer, /operator-guide/);
  assert.match(renderer, /activateTab\('stores'\)/);
  assert.match(renderer, /activateTab\('templates'\)/);
  assert.match(renderer, /function requestRunningTaskPause/);
  assert.match(renderer, /cancelTaobaoTask/);
  assert.match(renderer, /function pauseRunningTaskFromOperator/);
  assert.match(renderer, /data-task-pause/);
  assert.match(renderer, /runningStatuses\.has\(task\.status\)/);
  assert.match(renderer, /operator clicked pause/);
  assert.match(renderer, /failedStatuses = new Set\(\[[^\]]*已暂停/);
  assert.match(renderer, /taobao-runner-cancelled/);
  assert.match(renderer, /await taskPublishPreflightBlocker\(nextLocalTask\)/);
  assert.match(renderer, /await taskPublishPreflightBlocker\(localTask\)/);
  assert.match(renderer, /function isLoginManualIntervention/);
  assert.match(renderer, /function markActiveStoreOfflineForLoginIntervention/);
  assert.match(renderer, /store-login-invalidated/);
  assert.match(renderer, /online:\s*false/);
  assert.match(renderer, /resolution-hint/);
  assert.match(renderer, /taobao-runner-store-mismatch/);
  assert.match(renderer, /\\u5207\\u6362\\u5230\\u4efb\\u52a1\\u8981\\u6c42\\u7684\\u6dd8\\u5b9d\\u5e97\\u94fa/);
  assert.match(renderer, /taobao-runner-image-package-incomplete/);
  assert.match(renderer, /taobao-runner-image-source-missing/);
  assert.match(renderer, /taobao-runner-local-image-missing/);
  assert.match(renderer, /taobao-runner-image-download-failed/);
  assert.match(renderer, /重新同步图片/);
  assert.doesNotMatch(renderer, /\?\?\?\?/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /openStoreLogin\?\.\(newStore\)/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.doesNotMatch(renderer, /activeStoreId:\s*localStorage\.getItem\('caishen\.publisher\.activeStoreId'\)/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(api, /claimSpecificTask/);
  assert.match(api, /taskId/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(renderer, /clearStoreLogin/);
  assert.doesNotMatch(renderer, /娣樺疂鑷姩鍖栬繍琛屽櫒灏氭湭鎺ュ叆/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(api, /\/api\/auth\/login/);
  assert.match(api, /\/api\/auth\/logout/);
  assert.match(api, /error\.status = response\.status/);
  assert.match(api, /error\.payload = payload/);
  assert.match(api, /\/api\/taobao\/publish\/extension-options/);
  assert.match(api, /\/api\/taobao\/publish\/heartbeat/);
  assert.match(api, /\/api\/taobao\/publish\/claim/);
  assert.match(api, /userId/);
  assert.match(api, /URLSearchParams/);
  assert.match(api, /deviceId/);
  assert.match(api, /appVersion/);
  assert.match(api, /caishen\.publisher\.baseUrl/);
  assert.match(server, /\/api\/taobao\/publish\/heartbeat/);
  assert.match(server, /heartbeatTaobaoPublisher/);
  assert.match(server, /req\.body\?\.userId/);
  assert.match(server, /requestedUser\.id !== req\.body\?\.userId/);
  assert.match(server, /updateTaobaoPublishStatus\(req\.params\.id, req\.body \|\| \{\}\)/);
  assert.match(main, /preload\.js/);
  assert.match(main, /open-store-login/);
  assert.match(main, /get-app-info/);
  assert.match(main, /app\.getVersion\(\)/);
  assert.match(main, /check-store-login/);
  assert.match(main, /get-active-element-selector/);
  assert.match(main, /check-template-selectors/);
  assert.match(main, /open-template-publish-page/);
  assert.match(main, /clear-store-login/);
  assert.match(main, /append-publisher-log/);
  assert.match(main, /read-publisher-log/);
  assert.match(main, /clear-publisher-log/);
  assert.match(main, /read-diagnostic-screenshot/);
  assert.match(main, /publisher-file-exists/);
  assert.match(main, /export-publisher-diagnostics/);
  assert.match(main, /createPublisherDiagnosticBundle/);
  assert.match(main, /run-taobao-task/);
  assert.match(main, /cancel-taobao-task/);
  assert.match(main, /CAISHEN_PUBLISHER_SMOKE/);
  assert.match(main, /taobao-publisher smoke ok/);
  assert.match(preload, /contextBridge/);
  assert.match(preload, /openStoreLogin/);
  assert.match(preload, /getAppInfo/);
  assert.match(preload, /checkStoreLogin/);
  assert.match(preload, /getActiveElementSelector/);
  assert.match(preload, /clearStoreLogin/);
  assert.match(preload, /appendLog/);
  assert.match(preload, /readLog/);
  assert.match(preload, /exportDiagnostics/);
  assert.match(preload, /exportTemplates/);
  assert.match(preload, /importTemplates/);
  assert.match(preload, /clearLog/);
  assert.match(preload, /readDiagnosticScreenshot/);
  assert.match(preload, /fileExists/);
  assert.match(preload, /runTaobaoTask/);
  assert.match(preload, /cancelTaobaoTask/);
  assert.match(preload, /checkTemplateSelectors/);
  assert.match(preload, /openTemplatePublishPage/);
  assert.match(runner, /saveDraftSelectors/);
  assert.match(runner, /saveDraftSelectors/);
  assert.match(runner, /saveDraftSelectors/);
  assert.match(runner, /saveDraftSelectors/);
  assert.match(runner, /saveDraftSelectors/);
  assert.match(runner, /saveDraftSelectors/);
  assert.match(runner, /saveDraftSelectors/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(styles, /selector-status|diagnostic|log/);
  assert.match(styles, /task-diagnostic-screenshot/);
  assert.match(styles, /task-image-coverage/);
  assert.match(styles, /task-filter-bar/);
  assert.match(styles, /template-selector-check-result/);
  assert.match(styles, /template-calibration-list/);
  assert.match(styles, /selector-status|diagnostic|log/);
  assert.match(styles, /selector-status|diagnostic|log/);
  assert.match(renderer, /clearStoreLogin/);
  assert.match(runner, /saveDraftSelectors/);
  assert.match(packageWindows, /mkdtempSync/);
  assert.match(packageWindows, /caishen-taobao-publisher-build-/);
  assert.match(packageWindows, /stagingOutputDir/);
  assert.match(packageWindows, /stagingElectronDist/);
  assert.match(packageWindows, /electronDist/);
  assert.match(packageWindows, /electron-builder/);
  assert.match(packageWindows, /node_modules', 'electron-builder', 'cli\.js/);
  assert.match(packageWindows, /APP_BUILDER_CACHE/);
  assert.match(smokeStart, /CAISHEN_PUBLISHER_SMOKE/);
  assert.match(smokeStart, /taobao-publisher smoke ok/);
  assert.match(checkPackage, /scripts\/smoke-start\.js/);
  assert.match(checkPackage, /src\/diagnostic-bundle\.js/);
  assert.match(checkPackage, /src\/template-transfer\.js/);
});

test('local Taobao runner checks whether a store profile is still logged in', async () => {
  const { createTaobaoRunner } = require('../../taobao-publisher/src/taobao-runner');
  const loadedUrls = [];
  let pageText = '\u5343\u725b \u5356\u5bb6\u4e2d\u5fc3 \u5e97\u94fa \u5546\u54c1\u7ba1\u7406';
  let storeName = 'Example Store';
  const fakeWindow = {
    isDestroyed: () => false,
    focus: () => {},
    on: () => {},
    loadURL: async url => loadedUrls.push(url),
    webContents: {
      getURL: () => loadedUrls.at(-1) || '',
      executeJavaScript: async () => ({ text: pageText, storeName, url: loadedUrls.at(-1) || '' }),
      capturePage: async () => ({ toPNG: () => Buffer.from('png') })
    }
  };
  const runner = createTaobaoRunner({
    app: { getPath: () => __dirname },
    electron: {
      BrowserWindow: function BrowserWindow() {
        return fakeWindow;
      }
    }
  });

  const online = await runner.checkStoreLogin({ id: 'store-a', name: 'A Store' });
  assert.equal(online.ok, true);
  assert.equal(online.online, true);
  assert.equal(online.storeId, 'store-a');
  assert.equal(typeof online.storeName, 'string');
  assert.equal(loadedUrls.at(-1), 'https://myseller.taobao.com/');

  pageText = '\u6dd8\u5b9d\u767b\u5f55 \u626b\u7801\u767b\u5f55 \u8d26\u53f7\u5bc6\u7801\u767b\u5f55';
  storeName = '';
  const offline = await runner.checkStoreLogin({ id: 'store-a', name: 'A Store' });
  assert.equal(offline.ok, true);
  assert.equal(offline.online, false);
  assert.equal(typeof offline.reason, 'string');
});

test('local Taobao runner clears a store partition login state and closes its window', async () => {
  const { createTaobaoRunner } = require('../../taobao-publisher/src/taobao-runner');
  const calls = [];
  const fakeWindow = {
    isDestroyed: () => false,
    focus: () => {},
    on: () => {},
    close: () => calls.push(['close-window']),
    loadURL: async url => calls.push(['load-url', url]),
    webContents: {
      getURL: () => 'https://login.taobao.com/',
      executeJavaScript: async () => ({ text: '', url: '' }),
      capturePage: async () => ({ toPNG: () => Buffer.from('png') })
    }
  };
  const runner = createTaobaoRunner({
    app: { getPath: () => __dirname },
    electron: {
      BrowserWindow: function BrowserWindow() {
        return fakeWindow;
      },
      session: {
        fromPartition: partition => ({
          clearStorageData: async () => calls.push(['clear-storage', partition]),
          clearCache: async () => calls.push(['clear-cache', partition]),
          clearAuthCache: async () => calls.push(['clear-auth', partition])
        })
      }
    }
  });

  await runner.openStoreLogin({ id: 'store-clear', name: 'Clear Store' });
  const result = await runner.clearStoreLogin({ id: 'store-clear', name: 'Clear Store' });

  assert.equal(result.ok, true);
  assert.equal(result.storeId, 'store-clear');
  assert.deepEqual(calls.map(item => item[0]), ['load-url', 'close-window', 'clear-storage', 'clear-cache', 'clear-auth']);
  assert.equal(calls[2][1], 'persist:taobao-store-store-clear');
});

test('local Taobao runner reads a useful selector from the focused Taobao element', async () => {
  const { activeElementSelectorAdapter, createTaobaoRunner } = require('../../taobao-publisher/src/taobao-runner');
  const previousDocument = global.document;
  const previousCSS = global.CSS;
  global.CSS = { escape: value => String(value).replaceAll('"', '\\"') };
  const focusedInput = {
    id: 'title-input',
    tagName: 'INPUT',
    getAttribute: name => ({ name: 'title', placeholder: '鍟嗗搧鏍囬' }[name] || ''),
    parentElement: null
  };
  global.document = { activeElement: focusedInput, body: {} };
  try {
    const adapterResult = activeElementSelectorAdapter();
    assert.equal(adapterResult.ok, true);
    assert.equal(adapterResult.selector, '#title-input');
    assert.equal(adapterResult.tagName, 'input');
  } finally {
    global.document = previousDocument;
    global.CSS = previousCSS;
  }

  const loadedUrls = [];
  const fakeWindow = {
    isDestroyed: () => false,
    focus: () => {},
    on: () => {},
    loadURL: async url => loadedUrls.push(url),
    webContents: {
      getURL: () => loadedUrls.at(-1) || '',
      executeJavaScript: async script => {
        assert.match(script, /activeElementSelectorAdapter/);
        return { ok: true, selector: '#title-input', tagName: 'input', label: '鍟嗗搧鏍囬' };
      },
      capturePage: async () => ({ toPNG: () => Buffer.from('png') })
    }
  };
  const runner = createTaobaoRunner({
    app: { getPath: () => __dirname },
    electron: {
      BrowserWindow: function BrowserWindow() {
        return fakeWindow;
      }
    }
  });

  await runner.openStoreLogin({ id: 'store-selector', name: 'Selector Store' });
  const result = await runner.getActiveElementSelector({ id: 'store-selector' });

  assert.equal(result.ok, true);
  assert.equal(result.selector, '#title-input');
  assert.equal(result.storeId, 'store-selector');
});

test('local Taobao runner captures current page diagnostics for selector calibration', async () => {
  const { createTaobaoRunner } = require('../../taobao-publisher/src/taobao-runner');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'taobao-publisher-page-diagnostics-'));
  const loadedUrls = [];
  const fakeWindow = {
    isDestroyed: () => false,
    focus: () => {},
    on: () => {},
    loadURL: async url => loadedUrls.push(url),
    webContents: {
      getURL: () => loadedUrls.at(-1) || '',
      capturePage: async () => ({ toPNG: () => Buffer.from('page') }),
      executeJavaScript: async script => {
        assert.match(script, /taobaoPageDiagnosticsAdapter/);
        return {
          url: 'https://item.upload.taobao.com/sell/publish.htm',
          title: '鍙戝竷瀹濊礉',
          visibleFields: [{ selector: '#title', label: '瀹濊礉鏍囬' }],
          visibleButtons: [{ selector: '#save', text: '淇濆瓨鑽夌' }]
        };
      }
    }
  };
  const runner = createTaobaoRunner({
    app: { getPath: () => root },
    electron: {
      BrowserWindow: function BrowserWindow() {
        return fakeWindow;
      }
    }
  });

  await runner.openStoreLogin({ id: 'store-diagnostics', name: 'Diagnostics Store' });
  const result = await runner.capturePage({ storeId: 'store-diagnostics' });
  assert.equal(result.ok, true);
  assert.match(result.file, /taobao-logs/);
  assert.equal(result.detail.url, 'https://item.upload.taobao.com/sell/publish.htm');
  assert.equal(result.detail.visibleFields[0].selector, '#title');
  assert.equal(result.detail.visibleButtons[0].selector, '#save');
});

test('local Taobao runner checks template selectors on the current Taobao page', async () => {
  const { createTaobaoRunner } = require('../../taobao-publisher/src/taobao-runner');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'taobao-publisher-selector-check-'));
  const fakeWindow = {
    isDestroyed: () => false,
    focus: () => {},
    on: () => {},
    loadURL: async () => {},
    webContents: {
      getURL: () => 'https://item.upload.taobao.com/sell/publish.htm',
      executeJavaScript: async script => {
        assert.match(script, /checkTemplateSelectorsAdapter/);
        return {
          ok: false,
          total: 4,
          found: [
            { key: 'title', selector: '#title', found: true },
            { key: 'price', selector: '#price', found: true }
          ],
          missing: [
            { key: 'stock', selector: '#stock', found: false },
            { key: 'saveDraft', selector: '#save', found: false }
          ]
        };
      }
    }
  };
  const runner = createTaobaoRunner({
    app: { getPath: () => root },
    electron: {
      BrowserWindow: function BrowserWindow() {
        return fakeWindow;
      }
    }
  });

  await runner.openStoreLogin({ id: 'store-selector-check', name: 'Selector Check Store' });
  const result = await runner.checkTemplateSelectors({
    storeId: 'store-selector-check',
    category: {
      id: 'sideboard',
      defaults: {
        selectors: {
          title: '#title',
          price: '#price',
          stock: '#stock',
          saveDraft: '#save'
        }
      }
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.storeId, 'store-selector-check');
  assert.equal(result.total, 4);
  assert.equal(result.found.length, 2);
  assert.deepEqual(result.missing.map(item => item.key), ['stock', 'saveDraft']);
  assert.match(result.url, /item\.upload\.taobao\.com/);
});

test('local Taobao runner executes the page adapter and returns draft success', async () => {
  const { createTaobaoRunner } = require('../../taobao-publisher/src/taobao-runner');
  const loadedUrls = [];
  const executedScripts = [];
  const fakeWindow = {
    isDestroyed: () => false,
    focus: () => {},
    on: () => {},
    loadURL: async url => loadedUrls.push(url),
    webContents: {
      getURL: () => loadedUrls.at(-1) || '',
      debugger: {
        isAttached: () => true,
        sendCommand: async name => {
          if (name === 'Runtime.evaluate') return { result: { objectId: 'input-object' } };
          if (name === 'DOM.requestNode') return { nodeId: 42 };
          return {};
        }
      },
      executeJavaScript: async script => {
        executedScripts.push(script);
        if (script.includes('checkTemplateSelectorsAdapter')) return {
          ok: true,
          total: Object.keys(COMPLETE_TEMPLATE_SELECTORS).length,
          found: Object.entries(COMPLETE_TEMPLATE_SELECTORS).map(([key, selector]) => ({ key, selector, found: true })),
          missing: []
        };
        return {
          ok: true,
          stages: ['open', 'fill', 'upload', 'save'],
          currentStoreName: 'A Store'
        };
      },
      capturePage: async () => ({ toPNG: () => Buffer.from('png') })
    }
  };
  const runner = createTaobaoRunner({
    app: { getPath: () => __dirname },
    electron: {
      BrowserWindow: function BrowserWindow() {
        return fakeWindow;
      }
    }
  });

  const result = await runner.runTaobaoTask({
    storeId: 'store-a',
    store: { id: 'store-a', name: 'A Store' },
    fetchBinary: async () => ({ buffer: Buffer.from('image'), contentType: 'image/jpeg' }),
    task: {
      id: 'task-a',
      title: 'Desk lamp',
      categoryId: 'lighting',
      category: { defaults: { publishUrl: 'https://example.test/publish', brandName: 'other', modelName: 'other', price: '88', stock: '20', selectors: COMPLETE_TEMPLATE_SELECTORS } },
      images: [
        { type: 'mainImages', url: 'https://example.test/main.jpg' },
        { type: 'ratioImages', url: 'https://example.test/ratio.jpg' },
        { type: 'detailImages', url: 'https://example.test/detail.jpg' }
      ]
    }
  });

  assert.equal(result.ok, true);
  assert.equal(typeof result.status, 'string');
  assert.equal(result.detail.step, 'taobao-runner-draft-saved');
  assert.equal(loadedUrls.at(-1), 'https://example.test/publish');
  assert.match(executedScripts[0], /checkTemplateSelectorsAdapter/);
  const adapterScript = executedScripts.find(script => script.includes('fillTextByLabels'));
  assert.match(adapterScript, /uploadImageFiles/);
  assert.match(adapterScript, /localPath/);
  assert.match(adapterScript, /saveDraftSelectors/);
});

test('local Taobao runner blocks publishing when configured selectors are missing from the loaded page', async () => {
  const { createTaobaoRunner } = require('../../taobao-publisher/src/taobao-runner');
  const loadedUrls = [];
  const executedScripts = [];
  const appRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'taobao-publisher-selector-preflight-'));
  const fakeWindow = {
    isDestroyed: () => false,
    focus: () => {},
    on: () => {},
    loadURL: async url => loadedUrls.push(url),
    webContents: {
      getURL: () => loadedUrls.at(-1) || '',
      debugger: {
        isAttached: () => true,
        sendCommand: async () => {
          throw new Error('should not upload files when selectors are missing');
        }
      },
      executeJavaScript: async script => {
        executedScripts.push(script);
        if (script.includes('checkTemplateSelectorsAdapter')) return {
          ok: false,
          total: Object.keys(COMPLETE_TEMPLATE_SELECTORS).length,
          found: [{ key: 'title', selector: '#title', found: true }],
          missing: [{ key: 'stock', selector: '#stock', found: false }]
        };
        throw new Error('should not execute page adapter when selectors are missing');
      },
      capturePage: async () => ({ toPNG: () => Buffer.from('selector-missing') })
    }
  };
  const runner = createTaobaoRunner({
    app: { getPath: () => appRoot },
    electron: {
      BrowserWindow: function BrowserWindow() {
        return fakeWindow;
      }
    }
  });

  const result = await runner.runTaobaoTask({
    storeId: 'store-selector-preflight',
    store: { id: 'store-selector-preflight', name: 'Selector Store' },
    task: {
      id: 'task-selector-preflight',
      title: 'Desk lamp',
      categoryId: 'lighting',
      category: {
        defaults: {
          publishUrl: 'https://example.test/publish',
          brandName: 'other',
          modelName: 'other',
          price: '88',
          stock: '20',
          selectors: COMPLETE_TEMPLATE_SELECTORS
        }
      },
      images: {
        mainImages: [{ outputPath: __filename }],
        ratioImages: [{ outputPath: __filename }],
        detailImages: [{ outputPath: __filename }]
      }
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, '模板未配置');
  assert.equal(result.detail.step, 'taobao-runner-selector-check-failed');
  assert.deepEqual(result.detail.missingSelectors, ['stock']);
  assert.match(result.failureReason, /stock/);
  assert.match(result.detail.screenshotPath, /taobao-logs/);
  assert.equal(executedScripts.some(script => script.includes('taobaoPageAdapter')), false);
});

test('local Taobao runner can cancel a running task at a stage boundary', async () => {
  const { createTaobaoRunner } = require('../../taobao-publisher/src/taobao-runner');
  const loadedUrls = [];
  const fakeWindow = {
    isDestroyed: () => false,
    focus: () => {},
    on: () => {},
    loadURL: async url => loadedUrls.push(url),
    webContents: {
      getURL: () => loadedUrls.at(-1) || '',
      debugger: {
        isAttached: () => true,
        sendCommand: async () => ({})
      },
      executeJavaScript: async () => ({ ok: true }),
      capturePage: async () => ({ toPNG: () => Buffer.from('png') })
    }
  };
  const runner = createTaobaoRunner({
    app: { getPath: () => __dirname },
    electron: {
      BrowserWindow: function BrowserWindow() {
        return fakeWindow;
      }
    }
  });

  const result = await runner.runTaobaoTask({
    storeId: 'store-a',
    store: { id: 'store-a', name: 'A Store' },
    task: {
      id: 'task-cancel',
      title: 'Desk lamp',
      categoryId: 'lighting',
      category: { defaults: { publishUrl: 'https://example.test/publish', brandName: 'other', modelName: 'other', price: '88', stock: '20', selectors: COMPLETE_TEMPLATE_SELECTORS } },
      images: {
        mainImages: [{ outputPath: __filename }],
        ratioImages: [{ outputPath: __filename }],
        detailImages: [{ outputPath: __filename }]
      }
    },
    onStage: async stage => {
      if (stage.step === 'open-taobao') runner.cancelTask('task-cancel');
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, '已暂停');
  assert.equal(result.failureReason, '运营已暂停当前发布任务');
  assert.equal(result.detail.step, 'taobao-runner-cancelled');
  assert.equal(loadedUrls.includes('https://example.test/publish'), false);
});

test('local Taobao runner dry run validates a task without opening Taobao', async () => {
  const { createTaobaoRunner } = require('../../taobao-publisher/src/taobao-runner');
  let createdWindows = 0;
  const loadedUrls = [];
  const appRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'taobao-publisher-dry-run-'));
  const runner = createTaobaoRunner({
    app: {
      getPath: () => appRoot
    },
    electron: {
      session: { fromPartition: () => ({}) },
      BrowserWindow: function FakeWindow() {
        createdWindows += 1;
        return {
          isDestroyed: () => false,
          focus: () => {},
          on: () => {},
          loadURL: async url => loadedUrls.push(url),
          webContents: {}
        };
      }
    }
  });
  const stages = [];
  const result = await runner.runTaobaoTask({
    dryRun: true,
    storeId: 'store-dry-run',
    store: { id: 'store-dry-run', name: 'Dry Run Store' },
    task: {
      id: 'task-dry-run',
      name: 'Dry Run Task',
      title: 'Dry run title',
      categoryId: 'sideboard',
      category: {
        id: 'sideboard',
        defaults: {
          publishUrl: 'https://example.test/publish',
          brandName: 'other',
          modelName: 'other',
          price: '88',
          stock: '20',
          selectors: COMPLETE_TEMPLATE_SELECTORS
        }
      },
      images: {
        mainImages: [{ outputPath: __filename }],
        ratioImages: [{ outputPath: __filename }],
        detailImages: [{ outputPath: __filename }]
      }
    },
    onStage: stage => stages.push(stage)
  });
  assert.equal(createdWindows, 0);
  assert.deepEqual(loadedUrls, []);
  assert.equal(result.ok, true);
  assert.equal(result.status, '试运行通过');
  assert.equal(result.detail.step, 'local-publisher-dry-run-complete');
  assert.equal(result.detail.dryRun, true);
  assert.equal(result.detail.imageCount, 3);
  assert.deepEqual(stages.map(stage => stage.step), ['dry-run']);
});

test('local Taobao runner blocks tasks before opening Taobao when template defaults are incomplete', async () => {
  const { createTaobaoRunner } = require('../../taobao-publisher/src/taobao-runner');
  let browserWindowCreated = false;
  const runner = createTaobaoRunner({
    app: { getPath: () => __dirname },
    electron: {
      BrowserWindow: function BrowserWindow() {
        browserWindowCreated = true;
        throw new Error('should not open Taobao');
      }
    }
  });

  const result = await runner.runTaobaoTask({
    storeId: 'store-a',
    store: { id: 'store-a', name: 'A Store' },
    task: {
      id: 'task-missing-template',
      title: 'Desk lamp',
      categoryId: 'lighting',
      category: { defaults: { brandName: 'other', modelName: 'other', stock: '20' } }
    }
  });

  assert.equal(browserWindowCreated, false);
  assert.equal(result.ok, false);
  assert.equal(typeof result.status, 'string');
  assert.match(result.failureReason, /price/);
  assert.equal(result.detail.step, 'taobao-runner-template-incomplete');
});

test('local Taobao runner blocks tasks before opening Taobao when key template selectors are missing', async () => {
  const { createTaobaoRunner } = require('../../taobao-publisher/src/taobao-runner');
  let browserWindowCreated = false;
  const runner = createTaobaoRunner({
    app: { getPath: () => __dirname },
    electron: {
      BrowserWindow: function BrowserWindow() {
        browserWindowCreated = true;
        throw new Error('should not open Taobao');
      }
    }
  });

  const result = await runner.runTaobaoTask({
    storeId: 'store-a',
    store: { id: 'store-a', name: 'A Store' },
    task: {
      id: 'task-missing-selectors',
      title: 'Desk lamp',
      categoryId: 'lighting',
      category: {
        defaults: {
          brandName: 'other',
          modelName: 'other',
          price: '88',
          stock: '20',
          selectors: {
            title: '#title',
            price: '#price',
            stock: '#stock',
            mainImages: '#main-images'
          }
        }
      }
    }
  });

  assert.equal(browserWindowCreated, false);
  assert.equal(result.ok, false);
  assert.match(String(result.status || ''), /模板未配置|妯/);
  assert.match(result.failureReason, /ratioImages/);
  assert.match(result.failureReason, /detailImages/);
  assert.match(result.failureReason, /saveDraft/);
  assert.equal(result.detail.step, 'taobao-runner-template-incomplete');
  assert.deepEqual(result.detail.missingSelectors, ['ratioImages', 'detailImages', 'saveDraft']);
});

test('local Taobao runner blocks tasks before opening Taobao when required image groups are missing', async () => {
  const { createTaobaoRunner } = require('../../taobao-publisher/src/taobao-runner');
  let browserWindowCreated = false;
  const runner = createTaobaoRunner({
    app: { getPath: () => __dirname },
    electron: {
      BrowserWindow: function BrowserWindow() {
        browserWindowCreated = true;
        throw new Error('should not open Taobao');
      }
    }
  });

  const result = await runner.runTaobaoTask({
    storeId: 'store-a',
    store: { id: 'store-a', name: 'A Store' },
    task: {
      id: 'task-missing-image-groups',
      title: 'Desk lamp',
      categoryId: 'lighting',
      category: {
        defaults: {
          publishUrl: 'https://example.test/publish',
          brandName: 'other',
          modelName: 'other',
          price: '88',
          stock: '20',
          selectors: COMPLETE_TEMPLATE_SELECTORS
        }
      },
      images: {
        mainImages: [{ outputPath: __filename }]
      }
    }
  });

  assert.equal(browserWindowCreated, false);
  assert.equal(result.ok, false);
  assert.equal(result.status, '发布失败');
  assert.match(result.failureReason, /3:4/);
  assert.match(result.failureReason, /详情图/);
  assert.equal(result.detail.step, 'taobao-runner-image-package-incomplete');
  assert.deepEqual(result.detail.missingImageGroups, ['3:4 图', '详情图']);
});

test('local Taobao runner blocks tasks before opening Taobao when an image has no local path or URL', async () => {
  const { createTaobaoRunner } = require('../../taobao-publisher/src/taobao-runner');
  let browserWindowCreated = false;
  const runner = createTaobaoRunner({
    app: { getPath: () => __dirname },
    electron: {
      BrowserWindow: function BrowserWindow() {
        browserWindowCreated = true;
        throw new Error('should not open Taobao');
      }
    }
  });

  const result = await runner.runTaobaoTask({
    storeId: 'store-a',
    store: { id: 'store-a', name: 'A Store' },
    task: {
      id: 'task-missing-image-source',
      title: 'Desk lamp',
      categoryId: 'lighting',
      category: {
        defaults: {
          publishUrl: 'https://example.test/publish',
          brandName: 'other',
          modelName: 'other',
          price: '88',
          stock: '20',
          selectors: COMPLETE_TEMPLATE_SELECTORS
        }
      },
      images: {
        mainImages: [{ outputPath: __filename }],
        ratioImages: [{ name: 'ratio-missing.jpg' }],
        detailImages: [{ url: 'https://example.test/detail.jpg' }]
      }
    }
  });

  assert.equal(browserWindowCreated, false);
  assert.equal(result.ok, false);
  assert.equal(result.status, '发布失败');
  assert.match(result.failureReason, /ratio-missing/);
  assert.equal(result.detail.step, 'taobao-runner-image-source-missing');
  assert.deepEqual(result.detail.missingImageSources, ['ratio-missing.jpg']);
});

test('local Taobao runner blocks tasks before opening Taobao when a local image file is missing and has no URL fallback', async () => {
  const { createTaobaoRunner } = require('../../taobao-publisher/src/taobao-runner');
  let browserWindowCreated = false;
  const missingFile = path.join(os.tmpdir(), `missing-taobao-image-${Date.now()}.jpg`);
  const runner = createTaobaoRunner({
    app: { getPath: () => __dirname },
    electron: {
      BrowserWindow: function BrowserWindow() {
        browserWindowCreated = true;
        throw new Error('should not open Taobao');
      }
    }
  });

  const result = await runner.runTaobaoTask({
    storeId: 'store-a',
    store: { id: 'store-a', name: 'A Store' },
    task: {
      id: 'task-missing-local-file',
      title: 'Desk lamp',
      categoryId: 'lighting',
      category: {
        defaults: {
          publishUrl: 'https://example.test/publish',
          brandName: 'other',
          modelName: 'other',
          price: '88',
          stock: '20',
          selectors: COMPLETE_TEMPLATE_SELECTORS
        }
      },
      images: {
        mainImages: [{ name: 'main.jpg', outputPath: __filename }],
        ratioImages: [{ name: 'ratio-local.jpg', outputPath: missingFile }],
        detailImages: [{ name: 'detail.jpg', outputPath: __filename }]
      }
    }
  });

  assert.equal(browserWindowCreated, false);
  assert.equal(result.ok, false);
  assert.equal(result.status, '发布失败');
  assert.equal(result.detail.step, 'taobao-runner-local-image-missing');
  assert.equal(result.detail.missingLocalImages[0].label, 'ratio-local.jpg');
  assert.equal(result.detail.missingLocalImages[0].path, missingFile);
  assert.match(result.failureReason, /ratio-local\.jpg/);
});

test('local Taobao runner reports image download failures with image labels and URLs', async () => {
  const { createTaobaoRunner } = require('../../taobao-publisher/src/taobao-runner');
  const fakeWindow = {
    isDestroyed: () => false,
    focus: () => {},
    on: () => {},
    loadURL: async () => {},
    webContents: {
      getURL: () => 'https://example.test/publish',
      debugger: {
        isAttached: () => true,
        sendCommand: async () => ({ result: { objectId: 'input-object' } })
      },
      executeJavaScript: async script => {
        if (script.includes('checkTemplateSelectorsAdapter')) return {
          ok: true,
          total: Object.keys(COMPLETE_TEMPLATE_SELECTORS).length,
          found: Object.entries(COMPLETE_TEMPLATE_SELECTORS).map(([key, selector]) => ({ key, selector, found: true })),
          missing: []
        };
        throw new Error('should not execute page adapter when image download fails');
      },
      capturePage: async () => ({ toPNG: () => Buffer.from('download-failure') })
    }
  };
  const runner = createTaobaoRunner({
    app: { getPath: () => __dirname },
    electron: {
      BrowserWindow: function BrowserWindow() {
        return fakeWindow;
      }
    }
  });

  const result = await runner.runTaobaoTask({
    storeId: 'store-a',
    store: { id: 'store-a', name: 'A Store' },
    fetchBinary: async url => {
      throw new Error(`download blocked ${url}`);
    },
    task: {
      id: 'task-download-fail',
      title: 'Desk lamp',
      categoryId: 'lighting',
      category: {
        defaults: {
          publishUrl: 'https://example.test/publish',
          brandName: 'other',
          modelName: 'other',
          price: '88',
          stock: '20',
          selectors: COMPLETE_TEMPLATE_SELECTORS
        }
      },
      images: {
        mainImages: [{ name: 'main.jpg', url: 'https://example.test/main.jpg' }],
        ratioImages: [{ name: 'ratio.jpg', url: 'https://example.test/ratio.jpg' }],
        detailImages: [{ name: 'detail.jpg', url: 'https://example.test/detail.jpg' }]
      }
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, '发布失败');
  assert.equal(result.detail.step, 'taobao-runner-image-download-failed');
  assert.equal(result.detail.failedDownloads[0].label, 'main.jpg');
  assert.equal(result.detail.failedDownloads[0].url, 'https://example.test/main.jpg');
  assert.match(result.detail.failedDownloads[0].error, /download blocked/);
  assert.match(result.failureReason, /main\.jpg/);
});

test('local Taobao runner reports stages and flattens grouped API images for the adapter', async () => {
  const { createTaobaoRunner } = require('../../taobao-publisher/src/taobao-runner');
  const stages = [];
  let adapterPayload = null;
  const fakeWindow = {
    isDestroyed: () => false,
    focus: () => {},
    on: () => {},
    loadURL: async () => {},
    webContents: {
      getURL: () => 'https://example.test/publish',
      executeJavaScript: async script => {
        const match = script.match(/\)\((.*)\)$/s);
        adapterPayload = JSON.parse(match[1]);
        return { ok: true, stages: ['open', 'fill', 'upload', 'save'] };
      },
      capturePage: async () => ({ toPNG: () => Buffer.from('png') })
    }
  };
  const runner = createTaobaoRunner({
    app: { getPath: () => __dirname },
    electron: {
      BrowserWindow: function BrowserWindow() {
        return fakeWindow;
      }
    }
  });

  await runner.runTaobaoTask({
    storeId: 'store-a',
    store: { id: 'store-a', name: 'A Store' },
    onStage: stage => stages.push(stage.status),
    fetchBinary: async () => ({ buffer: Buffer.from('image'), contentType: 'image/jpeg' }),
    task: {
      id: 'task-images',
      title: 'Desk lamp',
      categoryId: 'lighting',
      category: { defaults: { publishUrl: 'https://example.test/publish', brandName: 'other', modelName: 'other', price: '88', stock: '20', selectors: COMPLETE_TEMPLATE_SELECTORS } },
      images: {
        mainImages: [{ url: 'https://example.test/main.jpg' }],
        ratioImages: [{ url: 'https://example.test/ratio.jpg' }],
        detailImages: [{ url: 'https://example.test/detail.jpg' }]
      }
    }
  });

  assert.equal(stages.length, 4);
  assert.equal(adapterPayload.images.length, 3);
  assert.deepEqual(adapterPayload.images.map(image => image.group), ['mainImages', 'ratioImages', 'detailImages']);
});

test('local Taobao runner prepares upload image files from local paths and remote URLs', async () => {
  const { prepareUploadImages } = require('../../taobao-publisher/src/taobao-runner');
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'taobao-publisher-images-'));
  const localImage = path.join(tempRoot, 'local-main.jpg');
  await fs.writeFile(localImage, Buffer.from('local-image'));
  const downloaded = [];

  const images = await prepareUploadImages({
    app: { getPath: () => tempRoot },
    storeId: 'store-a',
    taskId: 'task-a',
    images: [
      { group: 'mainImages', outputPath: localImage, url: 'https://example.test/local.jpg' },
      { group: 'detailImages', url: 'https://example.test/detail.jpg' }
    ],
    fetchBinary: async url => {
      downloaded.push(url);
      return { buffer: Buffer.from('remote-image'), contentType: 'image/jpeg' };
    }
  });

  assert.equal(images.length, 2);
  assert.equal(images[0].localPath, localImage);
  assert.equal(images[1].group, 'detailImages');
  assert.match(images[1].localPath, /taobao-upload-images/);
  assert.deepEqual(downloaded, ['https://example.test/detail.jpg']);
  assert.equal(await fs.readFile(images[1].localPath, 'utf8'), 'remote-image');
});

test('local Taobao runner uploads prepared local images through the Electron debugger file input API', async () => {
  const { uploadPreparedFilesWithDebugger } = require('../../taobao-publisher/src/taobao-runner');
  const commands = [];
  const webContents = {
    debugger: {
      isAttached: () => false,
      attach: async version => commands.push(['attach', version]),
      sendCommand: async (name, params) => {
        commands.push([name, params]);
        if (name === 'Runtime.evaluate') return { result: { objectId: 'input-object' } };
        if (name === 'DOM.requestNode') return { nodeId: 42 };
        return {};
      }
    }
  };

  const result = await uploadPreparedFilesWithDebugger(webContents, [
    { localPath: 'D:\\images\\main.jpg' },
    { localPath: 'D:\\images\\detail.jpg' }
  ]);

  assert.equal(result.ok, true);
  assert.equal(result.files.length, 2);
  assert.deepEqual(commands[0], ['attach', '1.3']);
  assert.equal(commands.at(-1)[0], 'DOM.setFileInputFiles');
  assert.deepEqual(commands.at(-1)[1].files, ['D:\\images\\main.jpg', 'D:\\images\\detail.jpg']);
});

test('local Taobao runner uploads image groups through template selectors when configured', async () => {
  const { uploadPreparedFilesWithDebugger } = require('../../taobao-publisher/src/taobao-runner');
  const commands = [];
  const webContents = {
    debugger: {
      isAttached: () => true,
      sendCommand: async (name, params) => {
        commands.push([name, params]);
        if (name === 'Runtime.evaluate') return { result: { objectId: `object-${commands.length}` } };
        if (name === 'DOM.requestNode') return { nodeId: commands.length + 100 };
        return {};
      }
    }
  };

  const result = await uploadPreparedFilesWithDebugger(webContents, [
    { group: 'mainImages', localPath: 'D:\\images\\main-1.jpg' },
    { group: 'detailImages', localPath: 'D:\\images\\detail-1.jpg' },
    { group: 'detailImages', localPath: 'D:\\images\\detail-2.jpg' }
  ], {
    mainImages: '#main-upload',
    detailImages: '#detail-upload'
  });

  const fileCommands = commands.filter(([name]) => name === 'DOM.setFileInputFiles');
  assert.equal(result.ok, true);
  assert.equal(fileCommands.length, 2);
  assert.deepEqual(fileCommands[0][1].files, ['D:\\images\\main-1.jpg']);
  assert.deepEqual(fileCommands[1][1].files, ['D:\\images\\detail-1.jpg', 'D:\\images\\detail-2.jpg']);
  assert.match(commands.find(([name]) => name === 'Runtime.evaluate')[1].expression, /#main-upload/);
});

test('Taobao page adapter fills fields from saved template selectors and custom fields', async () => {
  const { taobaoPageAdapter } = require('../../taobao-publisher/src/taobao-runner');
  const controls = new Map();
  const clicked = [];
  const makeControl = selector => ({
    selector,
    disabled: false,
    value: '',
    textContent: '',
    isContentEditable: false,
    dataset: {},
    id: '',
    innerText: '',
    getBoundingClientRect: () => ({ width: 100, height: 24 }),
    getAttribute: () => '',
    dispatchEvent: () => {},
    click: () => clicked.push(selector)
  });
  for (const selector of ['#title', '#brand', '#model', '#price', '#stock', '#material', '#style', '#save']) {
    controls.set(selector, makeControl(selector));
  }
  const previousDocument = global.document;
  const previousEvent = global.Event;
  global.Event = function Event() {};
  global.document = {
    body: { innerText: '' },
    querySelector: selector => controls.get(selector) || null,
    querySelectorAll: selector => {
      if (selector === 'button,a,[role="button"]') return [controls.get('#save')];
      return [];
    }
  };
  try {
    const result = await taobaoPageAdapter({
      title: 'Cabinet test title',
      template: {
        brandName: 'Other brand',
        modelName: '鍏朵粬',
        price: '88',
        stock: '999',
        attributes: { 鏉愯川: '瀹炴湪' },
        customFields: [{ label: 'Style', value: 'Vintage', selector: '#style' }],
        selectors: {
          title: '#title',
          brandName: '#brand',
          modelName: '#model',
          price: '#price',
          stock: '#stock',
          'attribute.鏉愯川': '#material',
          saveDraft: '#save'
        }
      },
      images: []
    });

    assert.equal(result.ok, true);
    assert.equal(typeof controls.get('#title').value, 'string');
    assert.equal(typeof controls.get('#brand').value, 'string');
    assert.equal(controls.get('#model').value, '鍏朵粬');
    assert.equal(controls.get('#price').value, '88');
    assert.equal(controls.get('#stock').value, '999');
    assert.equal(controls.get('#material').value, '瀹炴湪');
    assert.equal(typeof controls.get('#style').value, 'string');
    assert.deepEqual(clicked, ['#save']);
  } finally {
    global.document = previousDocument;
    global.Event = previousEvent;
  }
});

test('Taobao page adapter selects dropdown fields from saved template selectors', async () => {
  const { taobaoPageAdapter } = require('../../taobao-publisher/src/taobao-runner');
  const clicked = [];
  const makeControl = selector => ({
    selector,
    disabled: false,
    value: '',
    textContent: '',
    isContentEditable: false,
    dataset: {},
    id: '',
    innerText: '',
    options: [],
    getBoundingClientRect: () => ({ width: 100, height: 24 }),
    getAttribute: () => '',
    dispatchEvent: () => {},
    click: () => clicked.push(selector)
  });
  const makeInput = selector => ({ ...makeControl(selector), tagName: 'INPUT' });
  const controls = new Map([
    ['#title', makeInput('#title')],
    ['#brand', makeInput('#brand')],
    ['#model', makeInput('#model')],
    ['#price', makeInput('#price')],
    ['#stock', makeInput('#stock')],
    ['#freight', {
      ...makeControl('#freight'),
      tagName: 'SELECT',
      options: [
        { value: 'free', textContent: '鍖呴偖妯℃澘' },
        { value: 'paid', textContent: '浠樿垂妯℃澘' }
      ]
    }],
    ['#delivery', {
      ...makeControl('#delivery'),
      tagName: 'SELECT',
      options: [
        { value: '48h', textContent: 'ships within 48h' },
        { value: '7d', textContent: '7澶╁唴鍙戣揣' }
      ]
    }],
    ['#save', makeControl('#save')]
  ]);
  const previousDocument = global.document;
  const previousEvent = global.Event;
  global.Event = function Event() {};
  global.document = {
    body: { innerText: '' },
    querySelector: selector => controls.get(selector) || null,
    querySelectorAll: selector => {
      if (selector === 'button,a,[role="button"]') return [controls.get('#save')];
      return [];
    }
  };
  try {
    const result = await taobaoPageAdapter({
      title: 'Cabinet test title',
      template: {
        brandName: 'Other brand',
        modelName: '鍏朵粬',
        price: '88',
        stock: '999',
        freightTemplate: '鍖呴偖妯℃澘',
        customFields: [{ label: '鍙戣揣鏃舵晥', value: '7澶╁唴鍙戣揣', type: 'select', selector: '#delivery' }],
        selectors: {
          title: '#title',
          brandName: '#brand',
          modelName: '#model',
          price: '#price',
          stock: '#stock',
          freightTemplate: '#freight',
          saveDraft: '#save'
        }
      },
      images: []
    });

    assert.equal(result.ok, true);
    assert.equal(controls.get('#freight').value, 'free');
    assert.equal(controls.get('#delivery').value, '7d');
    assert.deepEqual(clicked, ['#save']);
  } finally {
    global.document = previousDocument;
    global.Event = previousEvent;
  }
});

test('Taobao page adapter clicks custom dropdown options by visible text', async () => {
  const { taobaoPageAdapter } = require('../../taobao-publisher/src/taobao-runner');
  const clicked = [];
  const makeControl = selector => ({
    selector,
    disabled: false,
    value: '',
    textContent: '',
    isContentEditable: false,
    dataset: {},
    id: '',
    innerText: '',
    tagName: 'DIV',
    getBoundingClientRect: () => ({ width: 100, height: 24 }),
    getAttribute: () => '',
    dispatchEvent: () => {},
    click: () => clicked.push(selector)
  });
  const makeInput = selector => ({ ...makeControl(selector), tagName: 'INPUT' });
  const controls = new Map([
    ['#title', makeInput('#title')],
    ['#brand', makeInput('#brand')],
    ['#model', makeInput('#model')],
    ['#price', makeInput('#price')],
    ['#stock', makeInput('#stock')],
    ['#freight-trigger', makeControl('#freight-trigger')],
    ['#save', makeControl('#save')]
  ]);
  const optionNodes = [
    { ...makeControl('option:鍖呴偖妯℃澘'), innerText: '鍖呴偖妯℃澘', textContent: '鍖呴偖妯℃澘' },
    { ...makeControl('option:浠樿垂妯℃澘'), innerText: '浠樿垂妯℃澘', textContent: '浠樿垂妯℃澘' }
  ];
  const previousDocument = global.document;
  const previousEvent = global.Event;
  global.Event = function Event() {};
  global.document = {
    body: { innerText: '' },
    querySelector: selector => controls.get(selector) || null,
    querySelectorAll: selector => {
      if (selector === 'button,a,[role="button"]') return [controls.get('#save')];
      if (selector.includes('[role="option"]')) return optionNodes;
      return [];
    }
  };
  try {
    const result = await taobaoPageAdapter({
      title: 'Cabinet test title',
      template: {
        brandName: 'Other brand',
        modelName: '鍏朵粬',
        price: '88',
        stock: '999',
        freightTemplate: '鍖呴偖妯℃澘',
        selectors: {
          title: '#title',
          brandName: '#brand',
          modelName: '#model',
          price: '#price',
          stock: '#stock',
          freightTemplate: '#freight-trigger',
          saveDraft: '#save'
        }
      },
      images: []
    });

    assert.equal(result.ok, true);
    assert.deepEqual(clicked, ['#freight-trigger', 'option:鍖呴偖妯℃澘', '#save']);
  } finally {
    global.document = previousDocument;
    global.Event = previousEvent;
  }
});

test('Taobao page adapter reads current store name from saved selector', async () => {
  const { taobaoPageAdapter } = require('../../taobao-publisher/src/taobao-runner');
  const clicked = [];
  const makeInput = selector => ({
    selector,
    disabled: false,
    value: '',
    textContent: '',
    isContentEditable: false,
    dataset: {},
    id: '',
    innerText: '',
    tagName: 'INPUT',
    getBoundingClientRect: () => ({ width: 100, height: 24 }),
    getAttribute: () => '',
    dispatchEvent: () => {},
    click: () => clicked.push(selector)
  });
  const controls = new Map([
    ['#title', makeInput('#title')],
    ['#brand', makeInput('#brand')],
    ['#model', makeInput('#model')],
    ['#price', makeInput('#price')],
    ['#stock', makeInput('#stock')],
    ['#shop-name', { ...makeInput('#shop-name'), tagName: 'SPAN', innerText: 'A Store', textContent: 'A Store' }],
    ['#save', { ...makeInput('#save'), tagName: 'BUTTON', innerText: '淇濆瓨鑽夌', textContent: '淇濆瓨鑽夌' }]
  ]);
  const previousDocument = global.document;
  const previousEvent = global.Event;
  global.Event = function Event() {};
  global.document = {
    body: { innerText: '鍗栧涓績 A Store 鍟嗗搧绠＄悊' },
    querySelector: selector => controls.get(selector) || null,
    querySelectorAll: selector => {
      if (selector === 'button,a,[role="button"]') return [controls.get('#save')];
      return [];
    }
  };
  try {
    const result = await taobaoPageAdapter({
      title: 'Cabinet test title',
      template: {
        brandName: 'Other brand',
        modelName: '鍏朵粬',
        price: '88',
        stock: '999',
        selectors: {
          title: '#title',
          brandName: '#brand',
          modelName: '#model',
          price: '#price',
          stock: '#stock',
          storeName: '#shop-name',
          saveDraft: '#save'
        }
      },
      images: []
    });

    assert.equal(result.ok, true);
    assert.equal(result.currentStoreName, 'A Store');
  } finally {
    global.document = previousDocument;
    global.Event = previousEvent;
  }
});

test('local Taobao runner pauses for manual handling when Taobao shows captcha or risk controls', async () => {
  const { createTaobaoRunner } = require('../../taobao-publisher/src/taobao-runner');
  const fakeWindow = {
    isDestroyed: () => false,
    focus: () => {},
    on: () => {},
    loadURL: async () => {},
    webContents: {
      getURL: () => 'https://example.test/publish',
      debugger: {
        isAttached: () => true,
        sendCommand: async name => {
          if (name === 'Runtime.evaluate') return { result: { objectId: 'input-object' } };
          if (name === 'DOM.requestNode') return { nodeId: 42 };
          return {};
        }
      },
      executeJavaScript: async () => ({
        ok: false,
        needsManualIntervention: true,
        reason: 'captcha detected',
        stages: ['open', 'fill', 'upload', 'save']
      }),
      capturePage: async () => ({ toPNG: () => Buffer.from('png') })
    }
  };
  const runner = createTaobaoRunner({
    app: { getPath: () => __dirname },
    electron: {
      BrowserWindow: function BrowserWindow() {
        return fakeWindow;
      }
    }
  });

  const result = await runner.runTaobaoTask({
    storeId: 'store-a',
    store: { id: 'store-a', name: 'A Store' },
    fetchBinary: async () => ({ buffer: Buffer.from('image'), contentType: 'image/jpeg' }),
    task: {
      id: 'task-captcha',
      title: 'Desk lamp',
      categoryId: 'lighting',
      category: { defaults: { publishUrl: 'https://example.test/publish', brandName: 'other', modelName: 'other', price: '88', stock: '20', selectors: COMPLETE_TEMPLATE_SELECTORS } },
      images: [
        { type: 'main', url: 'https://example.test/main.jpg' },
        { type: 'ratioImages', url: 'https://example.test/ratio.jpg' },
        { type: 'detailImages', url: 'https://example.test/detail.jpg' }
      ]
    }
  });

  assert.equal(result.ok, false);
  assert.equal(typeof result.status, 'string');
  assert.equal(typeof result.failureReason, 'string');
  assert.equal(result.detail.step, 'taobao-runner-manual-intervention');
});

test('local Taobao runner captures a diagnostic screenshot when adapter execution fails', async () => {
  const { createTaobaoRunner } = require('../../taobao-publisher/src/taobao-runner');
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'taobao-publisher-screenshot-'));
  const fakeWindow = {
    isDestroyed: () => false,
    focus: () => {},
    on: () => {},
    loadURL: async () => {},
    webContents: {
      getURL: () => 'https://example.test/publish',
      debugger: {
        isAttached: () => true,
        sendCommand: async name => {
          if (name === 'Runtime.evaluate') return { result: { objectId: 'input-object' } };
          if (name === 'DOM.requestNode') return { nodeId: 42 };
          return {};
        }
      },
      executeJavaScript: async () => ({
        ok: false,
        missingRequired: ['title'],
        stages: ['open', 'fill', 'upload', 'save']
      }),
      capturePage: async () => ({ toPNG: () => Buffer.from('screenshot') })
    }
  };
  const runner = createTaobaoRunner({
    app: { getPath: () => tempRoot },
    electron: {
      BrowserWindow: function BrowserWindow() {
        return fakeWindow;
      }
    }
  });

  const result = await runner.runTaobaoTask({
    storeId: 'store-a',
    store: { id: 'store-a', name: 'A Store' },
    fetchBinary: async () => ({ buffer: Buffer.from('image'), contentType: 'image/jpeg' }),
    task: {
      id: 'task-fail',
      title: 'Desk lamp',
      categoryId: 'lighting',
      category: { defaults: { publishUrl: 'https://example.test/publish', brandName: 'other', modelName: 'other', price: '88', stock: '20', selectors: COMPLETE_TEMPLATE_SELECTORS } },
      images: [
        { type: 'main', url: 'https://example.test/main.jpg' },
        { type: 'ratioImages', url: 'https://example.test/ratio.jpg' },
        { type: 'detailImages', url: 'https://example.test/detail.jpg' }
      ]
    }
  });

  assert.equal(result.ok, false);
  assert.match(result.detail.screenshotPath, /taobao-logs/);
  assert.equal(await fs.readFile(result.detail.screenshotPath, 'utf8'), 'screenshot');
});

test('local Taobao runner fails the task when image upload through debugger fails', async () => {
  const { createTaobaoRunner } = require('../../taobao-publisher/src/taobao-runner');
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'taobao-publisher-upload-fail-'));
  const fakeWindow = {
    isDestroyed: () => false,
    focus: () => {},
    on: () => {},
    loadURL: async () => {},
    webContents: {
      getURL: () => 'https://example.test/publish',
      debugger: {
        isAttached: () => true,
        sendCommand: async name => {
          if (name === 'Runtime.evaluate') return { result: {} };
          return {};
        }
      },
      executeJavaScript: async () => ({
        ok: true,
        stages: ['open', 'fill', 'upload', 'save']
      }),
      capturePage: async () => ({ toPNG: () => Buffer.from('upload-failure') })
    }
  };
  const runner = createTaobaoRunner({
    app: { getPath: () => tempRoot },
    electron: {
      BrowserWindow: function BrowserWindow() {
        return fakeWindow;
      }
    }
  });

  const result = await runner.runTaobaoTask({
    storeId: 'store-a',
    store: { id: 'store-a', name: 'A Store' },
    fetchBinary: async () => ({ buffer: Buffer.from('image'), contentType: 'image/jpeg' }),
    task: {
      id: 'task-upload-fail',
      title: 'Desk lamp',
      categoryId: 'lighting',
      category: { defaults: { publishUrl: 'https://example.test/publish', brandName: 'other', modelName: 'other', price: '88', stock: '20', selectors: COMPLETE_TEMPLATE_SELECTORS } },
      images: [
        { type: 'mainImages', url: 'https://example.test/main.jpg' },
        { type: 'ratioImages', url: 'https://example.test/ratio.jpg' },
        { type: 'detailImages', url: 'https://example.test/detail.jpg' }
      ]
    }
  });

  assert.equal(result.ok, false);
  assert.equal(typeof result.status, 'string');
  assert.equal(typeof result.failureReason, 'string');
  assert.equal(result.detail.step, 'taobao-runner-upload-failed');
  assert.match(result.detail.screenshotPath, /taobao-logs/);
  assert.equal(await fs.readFile(result.detail.screenshotPath, 'utf8'), 'upload-failure');
});

test('local Taobao runner pauses when the logged Taobao store does not match the task store', async () => {
  const { createTaobaoRunner } = require('../../taobao-publisher/src/taobao-runner');
  const fakeWindow = {
    isDestroyed: () => false,
    focus: () => {},
    on: () => {},
    loadURL: async () => {},
    webContents: {
      getURL: () => 'https://example.test/publish',
      debugger: {
        isAttached: () => true,
        sendCommand: async name => {
          if (name === 'Runtime.evaluate') return { result: { objectId: 'input-object' } };
          if (name === 'DOM.requestNode') return { nodeId: 42 };
          return {};
        }
      },
      executeJavaScript: async () => ({
        ok: true,
        currentStoreName: 'B Store',
        stages: ['open', 'fill', 'upload', 'save']
      }),
      capturePage: async () => ({ toPNG: () => Buffer.from('screenshot') })
    }
  };
  const runner = createTaobaoRunner({
    app: { getPath: () => __dirname },
    electron: {
      BrowserWindow: function BrowserWindow() {
        return fakeWindow;
      }
    }
  });

  const result = await runner.runTaobaoTask({
    storeId: 'store-a',
    store: { id: 'store-a', name: 'A Store' },
    fetchBinary: async () => ({ buffer: Buffer.from('image'), contentType: 'image/jpeg' }),
    task: {
      id: 'task-store-mismatch',
      title: 'Desk lamp',
      categoryId: 'lighting',
      category: { defaults: { publishUrl: 'https://example.test/publish', brandName: 'other', modelName: 'other', price: '88', stock: '20', selectors: COMPLETE_TEMPLATE_SELECTORS } },
      images: [
        { type: 'main', url: 'https://example.test/main.jpg' },
        { type: 'ratioImages', url: 'https://example.test/ratio.jpg' },
        { type: 'detailImages', url: 'https://example.test/detail.jpg' }
      ]
    }
  });

  assert.equal(result.ok, false);
  assert.equal(typeof result.status, 'string');
  assert.equal(typeof result.failureReason, 'string');
  assert.equal(result.detail.step, 'taobao-runner-store-mismatch');
});

test('local publisher log store persists recent operator logs and supports clearing', async () => {
  const { createPublisherLogStore } = require('../../taobao-publisher/src/log-store');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'taobao-publisher-logs-'));
  const store = createPublisherLogStore({ userDataPath: root, maxBytes: 80 });

  await store.append('first log');
  await store.append('second log with a longer error explanation');
  const text = await store.read();
  assert.match(text, /second log/);
  assert.ok(Buffer.byteLength(text, 'utf8') <= 80);
  assert.match(store.filePath, /publisher\.log$/);

  await store.clear();
  assert.equal(await store.read(), '');
});

test('local publisher diagnostic bundle exports logs state and screenshots without passwords', async () => {
  const { createPublisherDiagnosticBundle } = require('../../taobao-publisher/src/diagnostic-bundle');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'taobao-publisher-diagnostic-bundle-'));
  const screenshot = path.join(root, 'taobao-logs', 'failure.png');
  await fs.mkdir(path.dirname(screenshot), { recursive: true });
  await fs.writeFile(path.join(root, 'publisher.log'), '[10:00:00] 鍙戝竷澶辫触\n', 'utf8');
  await fs.writeFile(screenshot, 'fake png', 'utf8');

  const exported = await createPublisherDiagnosticBundle({
    userDataPath: root,
    state: {
      user: { id: 'user-a', username: 'operator-a', password: 'secret' },
      token: 'should-not-export',
      deviceId: 'device-a',
      activeStoreId: 'store-a',
      tasks: [{
        id: 'task-a',
        name: '浠诲姟A',
        status: '鍙戝竷澶辫触',
        failureReason: 'selector failed',
        detail: { screenshotPath: screenshot }
      }]
    }
  });

  const files = await fs.readdir(exported.folder);
  assert.ok(files.includes('diagnostic.json'));
  assert.ok(files.includes('publisher.log'));
  assert.ok(files.includes('screenshots'));
  const diagnostic = JSON.parse(await fs.readFile(path.join(exported.folder, 'diagnostic.json'), 'utf8'));
  assert.equal(diagnostic.deviceId, 'device-a');
  assert.equal(diagnostic.activeStoreId, 'store-a');
  assert.equal(diagnostic.user.username, 'operator-a');
  assert.equal(diagnostic.user.password, undefined);
  assert.equal(diagnostic.token, undefined);
  assert.equal(diagnostic.tasks[0].failureReason, 'selector failed');
  assert.ok((await fs.readdir(path.join(exported.folder, 'screenshots'))).some(name => name.endsWith('.png')));
});

test('local publisher template transfer exports categories without account or store state', async () => {
  const { buildTemplateExport, parseTemplateImport } = require('../../taobao-publisher/src/template-transfer');
  const exported = buildTemplateExport({
    appVersion: '0.1.0',
    user: { username: 'operator-a', password: 'secret' },
    token: 'hidden',
    settings: {
      stores: [{ id: 'store-a', name: 'A Store' }],
      categories: [
        {
          id: 'cat-a',
          name: '餐边柜',
          defaults: {
            brandName: '其他家',
            modelName: '其他',
            price: '199',
            stock: '50',
            selectors: { title: '#title', saveDraft: '#save' }
          }
        }
      ]
    }
  }, { now: new Date('2026-07-19T15:00:00.000Z') });

  assert.equal(exported.version, 1);
  assert.equal(exported.appVersion, '0.1.0');
  assert.equal(exported.categories.length, 1);
  assert.equal(exported.categories[0].name, '餐边柜');
  assert.equal(exported.stores, undefined);
  assert.equal(exported.user, undefined);
  assert.equal(exported.token, undefined);
  assert.equal(exported.categories[0].defaults.selectors.title, '#title');

  const importedFromEnvelope = parseTemplateImport(JSON.stringify({
    user: { username: 'wrong' },
    stores: [{ id: 'wrong-store' }],
    categories: exported.categories
  }));
  assert.deepEqual(importedFromEnvelope, exported.categories);

  const importedFromArray = parseTemplateImport(JSON.stringify(exported.categories));
  assert.deepEqual(importedFromArray, exported.categories);
  assert.throws(() => parseTemplateImport('{"categories":[]}'), /没有可导入的类目模板/);
});
