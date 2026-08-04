const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const XLSX = require('@e965/xlsx');

process.env.CAISHEN_DATA_DIR = path.join(os.tmpdir(), `caishen-taobao-runtime-${Date.now()}-${Math.random().toString(16).slice(2)}`);

const runtime = require('../src/runtime');
const { metadataPaths } = require('../src/core/review-engine');
const { createTitleWorkbookRows } = require('../src/core/title-task-engine');

const tinyPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64'
);

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(value, null, 2), 'utf8');
}

async function writeImage(file) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, tinyPng);
}

async function writeTitleWorkbook(file, title) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const workbook = XLSX.utils.book_new();
  const worksheet = XLSX.utils.aoa_to_sheet(createTitleWorkbookRows('餐边柜', [title], '2026/07/18 00:00'));
  XLSX.utils.book_append_sheet(workbook, worksheet, '标题');
  XLSX.writeFile(workbook, file);
}

async function createPublishableReviewTask(name = 'taobao-ready-0001') {
  const outputRoot = path.join(runtime.WORKSPACE_ROOT, 'outputs');
  const templateRoot = path.join(runtime.WORKSPACE_ROOT, 'assets', 'templates', 'sideboard-set');
  const folder = path.join(outputRoot, name);
  const relativePaths = [
    '1-1主图/1.jpg',
    '3-4主图/1.jpg',
    '详情页/1.jpg'
  ];

  await runtime.saveConfig({ outputPath: outputRoot, detailSetsPath: path.dirname(templateRoot), auditMode: 'quality' });
  for (const relativePath of relativePaths) {
    await writeImage(path.join(templateRoot, relativePath));
    await writeImage(path.join(folder, relativePath));
    await writeJson(metadataPaths(folder, relativePath).manualReview, {
      Status: '人工通过',
      UpdatedAt: new Date().toISOString()
    });
  }

  await writeJson(metadataPaths(folder).macSource, {
    schemaVersion: 2,
    templateFolderPath: templateRoot,
    templateRelativePaths: relativePaths,
    generationMode: 'template_print',
    status: '待人工筛图',
    createdAt: new Date().toISOString()
  });
  await writeJson(metadataPaths(folder).generationProgress, {
    phase: 'completed',
    pending: 0,
    failed: 0,
    current: relativePaths.length,
    total: relativePaths.length
  });
  await writeTitleWorkbook(path.join(folder, '标题.xlsx'), '餐边柜储物柜客厅靠墙收纳柜');
  return folder;
}

function configuredSideboardCategories(overrides = {}) {
  return [{
    id: 'sideboard',
    defaults: {
      brandName: '其他家',
      modelName: '其他',
      price: '88',
      stock: '999',
      ...overrides
    }
  }];
}

test('taobao publish runtime queues claims packages and records draft save status', async () => {
  const folder = await createPublishableReviewTask();
  const settings = await runtime.getTaobaoPublishSettings();
  const categoryId = 'sideboard';

  const listed = await runtime.listTaobaoPublishTasks();
  assert.equal(listed.tasks.length, 1);
  assert.equal(listed.tasks[0].folder, folder);
  assert.equal(listed.tasks[0].titleReady, true);
  assert.equal(listed.tasks[0].mainImageCount, 1);
  assert.equal(listed.tasks[0].ratioImageCount, 1);
  assert.equal(listed.tasks[0].detailImageCount, 1);
  assert.equal(listed.tasks[0].images.mainImages.length, 1);
  assert.equal(listed.tasks[0].images.ratioImages.length, 1);
  assert.equal(listed.tasks[0].images.detailImages.length, 1);
  assert.match(listed.tasks[0].images.mainImages[0].url, /^\/api\/files\//);
  assert.match(listed.tasks[0].images.mainImages[0].relativePath, /1\.jpg$/);

  const queued = await runtime.queueTaobaoPublishTask({ folder, categoryId });
  assert.equal(queued.status, '等待插件接收');
  assert.ok(queued.id);

  await assert.rejects(
    () => runtime.claimTaobaoPublishTask({ token: 'wrong-token' }),
    /令牌无效/
  );

  const claimed = await runtime.claimTaobaoPublishTask({ token: settings.token, extensionId: 'extension-test' });
  assert.equal(claimed.id, queued.id);
  assert.equal(claimed.title, '餐边柜储物柜客厅靠墙收纳柜');
  assert.equal(claimed.category.id, categoryId);
  assert.equal(claimed.images.mainImages.length, 1);
  assert.equal(claimed.images.ratioImages.length, 1);
  assert.equal(claimed.images.detailImages.length, 1);

  const updated = await runtime.updateTaobaoPublishStatus(queued.id, {
    token: settings.token,
    status: '已保存草稿',
    detail: { confirmation: '保存成功' }
  });
  assert.equal(updated.status, '已保存草稿');
  assert.equal(updated.detail.confirmation, '保存成功');
});

test('taobao publish list only includes reviewed tasks that already have a title', async () => {
  const folder = await createPublishableReviewTask('taobao-ready-without-title');
  const entries = await fs.readdir(folder);
  await Promise.all(entries.filter(item => item.toLowerCase().endsWith('.xlsx')).map(item => fs.rm(path.join(folder, item), { force: true })));

  const listed = await runtime.listTaobaoPublishTasks();
  assert.equal(listed.tasks.some(item => path.resolve(item.folder) === path.resolve(folder)), false);
  assert.equal(listed.blockedTasks.some(item => path.resolve(item.folder) === path.resolve(folder)), true);
});

test('manual task title is saved to the title workbook and used by Taobao publish package', async () => {
  const folder = await createPublishableReviewTask();
  const settings = await runtime.getTaobaoPublishSettings();
  const manualTitle = '餐边柜中古风客厅靠墙储物柜玄关柜';

  const saved = await runtime.saveTitleForTask({ folder, title: manualTitle, category: '餐边柜' });
  assert.equal(saved.firstTitle, manualTitle);
  assert.equal(saved.category, '餐边柜');

  const listed = await runtime.listReadyTitleTasks();
  const titleTask = listed.find(item => path.resolve(item.folder) === path.resolve(folder));
  assert.equal(titleTask.firstTitle, manualTitle);

  const publishTasks = await runtime.listTaobaoPublishTasks();
  const publishTask = publishTasks.tasks.find(item => path.resolve(item.folder) === path.resolve(folder));
  assert.equal(publishTask.categoryId, 'sideboard');
  assert.equal(publishTask.categoryName, '餐边柜（储物柜）');

  const queued = await runtime.queueTaobaoPublishTask({ folder, categoryId: 'sideboard' });
  const claimed = await runtime.claimTaobaoPublishTask({ token: settings.token, extensionId: 'manual-title-test' });
  assert.equal(claimed.id, queued.id);
  assert.equal(claimed.title, manualTitle);
});

test('local publisher only claims tasks for the same web user store and enabled device', async () => {
  const folderA = await createPublishableReviewTask('taobao-ready-user-a');
  const folderB = await createPublishableReviewTask('taobao-ready-user-b');
  const settings = await runtime.saveTaobaoPublishSettings({
    stores: [
      {
        id: 'store-a',
        name: '运营A淘宝店',
        ownerUserId: 'user-a',
        profileDir: 'profiles/store-a',
        autoPublish: true,
        online: true
      },
      {
        id: 'store-b',
        name: '运营B淘宝店',
        ownerUserId: 'user-b',
        profileDir: 'profiles/store-b',
        autoPublish: true,
        online: true
      }
    ],
    devices: [
      {
        id: 'device-a',
        name: '运营A电脑',
        userId: 'user-a',
        activeStoreId: 'store-a',
        enabled: true
      },
      {
        id: 'device-b-disabled',
        name: '运营B电脑',
        userId: 'user-b',
        activeStoreId: 'store-b',
        enabled: false
      }
    ],
    categories: configuredSideboardCategories()
  });

  const queuedA = await runtime.queueTaobaoPublishTask({
    folder: folderA,
    categoryId: 'sideboard',
    ownerUserId: 'user-a',
    storeId: 'store-a'
  });
  const queuedB = await runtime.queueTaobaoPublishTask({
    folder: folderB,
    categoryId: 'sideboard',
    ownerUserId: 'user-b',
    storeId: 'store-b'
  });

  assert.equal(queuedA.ownerUserId, 'user-a');
  assert.equal(queuedA.storeId, 'store-a');
  assert.equal(queuedB.ownerUserId, 'user-b');
  assert.equal(queuedB.storeId, 'store-b');

  assert.equal(await runtime.claimTaobaoPublishTask({
    token: settings.token,
    userId: 'user-b',
    storeId: 'store-b',
    deviceId: 'device-b-disabled'
  }), null);

  assert.equal(await runtime.claimTaobaoPublishTask({
    token: settings.token,
    userId: 'user-a',
    storeId: 'store-b',
    deviceId: 'device-a'
  }), null);

  const claimedA = await runtime.claimTaobaoPublishTask({
    token: settings.token,
    userId: 'user-a',
    storeId: 'store-a',
    deviceId: 'device-a'
  });

  assert.equal(claimedA.id, queuedA.id);
  assert.equal(claimedA.ownerUserId, 'user-a');
  assert.equal(claimedA.storeId, 'store-a');
  assert.equal(claimedA.store.name, '运营A淘宝店');
});

test('web queued Taobao publish tasks must target a store owned by the current user', async () => {
  const folder = await createPublishableReviewTask('taobao-ready-web-store-required');
  await runtime.saveTaobaoPublishSettings({
    stores: [{
      id: 'store-web-owner',
      name: 'Web 排队店铺',
      ownerUserId: 'user-web-owner',
      autoPublish: true,
      online: true
    }],
    categories: configuredSideboardCategories()
  });

  await assert.rejects(() => runtime.queueTaobaoPublishTask({
    folder,
    categoryId: 'sideboard',
    ownerUserId: 'user-web-owner',
    requireStore: true,
    requireStoreOwner: true
  }), /店铺|store/i);

  await assert.rejects(() => runtime.queueTaobaoPublishTask({
    folder,
    categoryId: 'sideboard',
    ownerUserId: 'user-other',
    storeId: 'store-web-owner',
    requireStore: true,
    requireStoreOwner: true
  }), /店铺|store/i);

  const queued = await runtime.queueTaobaoPublishTask({
    folder,
    categoryId: 'sideboard',
    ownerUserId: 'user-web-owner',
    storeId: 'store-web-owner',
    requireStore: true,
    requireStoreOwner: true
  });
  assert.equal(queued.ownerUserId, 'user-web-owner');
  assert.equal(queued.storeId, 'store-web-owner');
});

test('local publisher task list only shows tasks for the same web user store and enabled device', async () => {
  const folderA = await createPublishableReviewTask('taobao-visible-user-a');
  const folderB = await createPublishableReviewTask('taobao-visible-user-b');
  const settings = await runtime.saveTaobaoPublishSettings({
    stores: [
      {
        id: 'visible-store-a',
        name: '可见店铺A',
        ownerUserId: 'visible-user-a',
        autoPublish: true,
        online: true
      },
      {
        id: 'visible-store-b',
        name: '可见店铺B',
        ownerUserId: 'visible-user-b',
        autoPublish: true,
        online: true
      }
    ],
    devices: [
      {
        id: 'visible-device-a',
        userId: 'visible-user-a',
        activeStoreId: 'visible-store-a',
        enabled: true
      },
      {
        id: 'visible-device-disabled',
        userId: 'visible-user-a',
        activeStoreId: 'visible-store-a',
        enabled: false
      }
    ]
  });

  const queuedA = await runtime.queueTaobaoPublishTask({
    folder: folderA,
    categoryId: 'sideboard',
    ownerUserId: 'visible-user-a',
    storeId: 'visible-store-a',
    deviceId: 'visible-device-a'
  });
  const queuedB = await runtime.queueTaobaoPublishTask({
    folder: folderB,
    categoryId: 'sideboard',
    ownerUserId: 'visible-user-b',
    storeId: 'visible-store-b'
  });

  const listed = await runtime.listTaobaoPublishTasks({
    token: settings.token,
    userId: 'visible-user-a',
    storeId: 'visible-store-a',
    deviceId: 'visible-device-a'
  });
  assert.deepEqual(listed.tasks.map(task => task.id), [queuedA.id]);
  assert.equal(listed.tasks[0].ownerUserId, 'visible-user-a');
  assert.equal(listed.tasks[0].storeId, 'visible-store-a');

  const disabledDeviceList = await runtime.listTaobaoPublishTasks({
    token: settings.token,
    userId: 'visible-user-a',
    storeId: 'visible-store-a',
    deviceId: 'visible-device-disabled'
  });
  assert.deepEqual(disabledDeviceList.tasks, []);
  assert.ok(queuedB.id);
});

test('local publisher auto queues the earliest ready task for the active store', async () => {
  const folder = await createPublishableReviewTask('餐边柜-auto-queue');
  await runtime.saveTitleForTask({ folder, title: '餐边柜自动发布测试标题', category: '餐边柜' });
  const settings = await runtime.saveTaobaoPublishSettings({
    stores: [
      {
        id: 'store-auto',
        name: '自动发布店铺',
        ownerUserId: 'user-auto',
        profileDir: 'profiles/store-auto',
        autoPublish: true,
        online: true
      }
    ],
    devices: [
      {
        id: 'device-auto',
        name: '自动发布电脑',
        userId: 'user-auto',
        activeStoreId: 'store-auto',
        enabled: true
      }
    ],
    localPublisher: {
      autoPublish: true,
      activeStoreId: 'store-auto',
      activeDeviceId: 'device-auto'
    },
    categories: configuredSideboardCategories()
  });

  const claimed = await runtime.claimTaobaoPublishTask({
    token: settings.token,
    userId: 'user-auto',
    storeId: 'store-auto',
    deviceId: 'device-auto'
  });

  assert.equal(claimed.folder, folder);
  assert.equal(claimed.ownerUserId, 'user-auto');
  assert.equal(claimed.storeId, 'store-auto');
});

test('local publisher can manually claim one selected task instead of the earliest task', async () => {
  const folderFirst = await createPublishableReviewTask('taobao-ready-manual-first');
  const folderSecond = await createPublishableReviewTask('taobao-ready-manual-second');
  const settings = await runtime.saveTaobaoPublishSettings({
    stores: [{
      id: 'store-manual',
      name: 'Manual Store',
      ownerUserId: 'user-manual',
      autoPublish: true,
      online: true
    }],
    devices: [{
      id: 'device-manual',
      userId: 'user-manual',
      activeStoreId: 'store-manual',
      enabled: true
    }],
    categories: configuredSideboardCategories()
  });
  const first = await runtime.queueTaobaoPublishTask({
    folder: folderFirst,
    categoryId: 'sideboard',
    ownerUserId: 'user-manual',
    storeId: 'store-manual'
  });
  const second = await runtime.queueTaobaoPublishTask({
    folder: folderSecond,
    categoryId: 'sideboard',
    ownerUserId: 'user-manual',
    storeId: 'store-manual'
  });

  const claimed = await runtime.claimTaobaoPublishTask({
    token: settings.token,
    userId: 'user-manual',
    storeId: 'store-manual',
    deviceId: 'device-manual',
    taskId: second.id
  });

  assert.equal(claimed.id, second.id);
  const listed = await runtime.listTaobaoPublishTasks({
    token: settings.token,
    userId: 'user-manual',
    storeId: 'store-manual',
    deviceId: 'device-manual'
  });
  const statuses = new Map(listed.tasks.map(task => [task.id, task.status]));
  assert.equal(statuses.get(first.id), first.status);
  assert.notEqual(statuses.get(second.id), second.status);
});
test('failed local publisher task can be requeued with diagnostics cleared and attempt incremented', async () => {
  const folder = await createPublishableReviewTask('taobao-ready-retry');
  const settings = await runtime.saveTaobaoPublishSettings({
    stores: [{
      id: 'store-retry',
      name: '重试店铺',
      ownerUserId: 'user-retry',
      autoPublish: true,
      online: true
    }],
    devices: [{
      id: 'device-retry',
      userId: 'user-retry',
      activeStoreId: 'store-retry',
      enabled: true
    }],
    categories: configuredSideboardCategories()
  });
  const queued = await runtime.queueTaobaoPublishTask({
    folder,
    categoryId: 'sideboard',
    ownerUserId: 'user-retry',
    storeId: 'store-retry',
    deviceId: 'device-retry'
  });
  const claimed = await runtime.claimTaobaoPublishTask({
    token: settings.token,
    userId: 'user-retry',
    storeId: 'store-retry',
    deviceId: 'device-retry',
    extensionId: 'retry-test'
  });
  assert.equal(claimed.id, queued.id);

  const failed = await runtime.updateTaobaoPublishStatus(queued.id, {
    token: settings.token,
    status: '失败',
    failureReason: '验证码拦截',
    detail: { screenshotPath: 'D:\\screenshots\\captcha.png' }
  });
  assert.equal(failed.status, '失败');
  assert.equal(failed.failureReason, '验证码拦截');
  assert.equal(failed.detail.screenshotPath, 'D:\\screenshots\\captcha.png');

  const retried = await runtime.updateTaobaoPublishStatus(queued.id, {
    token: settings.token,
    status: '等待插件接收',
    detail: { retryReason: 'operator clicked retry' }
  });
  assert.equal(retried.status, '等待插件接收');
  assert.equal(retried.failureReason, '');
  assert.equal(retried.attempts, 2);
  assert.equal(retried.detail.retryReason, 'operator clicked retry');

  const reclaimed = await runtime.claimTaobaoPublishTask({
    token: settings.token,
    userId: 'user-retry',
    storeId: 'store-retry',
    deviceId: 'device-retry',
    extensionId: 'retry-test-2'
  });
  assert.equal(reclaimed.id, queued.id);
});

test('paused local publisher task can be requeued after operator resumes publishing', async () => {
  const folder = await createPublishableReviewTask('taobao-paused-local-publisher');
  const settings = await runtime.saveTaobaoPublishSettings({
    ...(await runtime.getTaobaoPublishSettings()),
    stores: [{ id: 'store-paused', name: 'Paused Store', ownerUserId: 'user-paused', online: true }],
    localPublisher: {
      devices: [{
        id: 'device-paused',
        userId: 'user-paused',
        activeStoreId: 'store-paused',
        enabled: true
      }]
    },
    categories: configuredSideboardCategories()
  });
  const queued = await runtime.queueTaobaoPublishTask({
    folder,
    categoryId: 'sideboard',
    ownerUserId: 'user-paused',
    storeId: 'store-paused',
    deviceId: 'device-paused'
  });
  await runtime.heartbeatTaobaoPublisher({
    userId: 'user-paused',
    deviceId: 'device-paused',
    activeStoreId: 'store-paused',
    autoPublish: true
  });
  await runtime.claimTaobaoPublishTask({
    token: settings.token,
    userId: 'user-paused',
    storeId: 'store-paused',
    deviceId: 'device-paused',
    extensionId: 'paused-test'
  });

  const paused = await runtime.updateTaobaoPublishStatus(queued.id, {
    token: settings.token,
    userId: 'user-paused',
    storeId: 'store-paused',
    deviceId: 'device-paused',
    status: '已暂停',
    failureReason: '运营已暂停当前发布任务',
    detail: { step: 'taobao-runner-cancelled' }
  });
  assert.equal(paused.status, '已暂停');
  assert.equal(paused.failureReason, '运营已暂停当前发布任务');

  const retried = await runtime.updateTaobaoPublishStatus(queued.id, {
    token: settings.token,
    userId: 'user-paused',
    storeId: 'store-paused',
    deviceId: 'device-paused',
    status: '等待插件接收',
    detail: { retryReason: 'operator resumed publishing' }
  });
  assert.equal(retried.status, '等待插件接收');
  assert.equal(retried.failureReason, '');
  assert.equal(retried.detail.retryReason, 'operator resumed publishing');
});

test('dry run completed local publisher task is not automatically reclaimed', async () => {
  const folder = await createPublishableReviewTask('taobao-dry-run-local-publisher');
  const settings = await runtime.saveTaobaoPublishSettings({
    ...(await runtime.getTaobaoPublishSettings()),
    stores: [{ id: 'store-dry-run', name: 'Dry Run Store', ownerUserId: 'user-dry-run', online: true }],
    localPublisher: {
      devices: [{
        id: 'device-dry-run',
        userId: 'user-dry-run',
        activeStoreId: 'store-dry-run',
        enabled: true
      }]
    },
    categories: configuredSideboardCategories()
  });
  const queued = await runtime.queueTaobaoPublishTask({
    folder,
    categoryId: 'sideboard',
    ownerUserId: 'user-dry-run',
    storeId: 'store-dry-run',
    deviceId: 'device-dry-run'
  });
  await runtime.heartbeatTaobaoPublisher({
    userId: 'user-dry-run',
    deviceId: 'device-dry-run',
    activeStoreId: 'store-dry-run',
    autoPublish: true
  });
  await runtime.claimTaobaoPublishTask({
    token: settings.token,
    userId: 'user-dry-run',
    storeId: 'store-dry-run',
    deviceId: 'device-dry-run',
    extensionId: 'dry-run-test'
  });

  const checked = await runtime.updateTaobaoPublishStatus(queued.id, {
    token: settings.token,
    userId: 'user-dry-run',
    storeId: 'store-dry-run',
    deviceId: 'device-dry-run',
    status: '试运行通过',
    detail: { step: 'local-publisher-dry-run-complete', dryRun: true }
  });
  assert.equal(checked.status, '试运行通过');
  assert.equal(checked.detail.dryRun, true);

  const reclaimed = await runtime.claimTaobaoPublishTask({
    token: settings.token,
    userId: 'user-dry-run',
    storeId: 'store-dry-run',
    deviceId: 'device-dry-run',
    extensionId: 'dry-run-test-2'
  });
  assert.notEqual(reclaimed?.id || '', queued.id);
});

test('local publisher status uploads diagnostic screenshots for Web task details', async () => {
  const folder = await createPublishableReviewTask('taobao-ready-diagnostic-upload');
  const settings = await runtime.saveTaobaoPublishSettings({
    stores: [{
      id: 'store-diagnostic',
      name: 'Diagnostic Store',
      ownerUserId: 'user-diagnostic',
      autoPublish: true,
      online: true
    }],
    devices: [{
      id: 'device-diagnostic',
      userId: 'user-diagnostic',
      activeStoreId: 'store-diagnostic',
      enabled: true
    }],
    categories: configuredSideboardCategories()
  });
  const queued = await runtime.queueTaobaoPublishTask({
    folder,
    categoryId: 'sideboard',
    ownerUserId: 'user-diagnostic',
    storeId: 'store-diagnostic',
    deviceId: 'device-diagnostic'
  });
  await runtime.claimTaobaoPublishTask({
    token: settings.token,
    userId: 'user-diagnostic',
    storeId: 'store-diagnostic',
    deviceId: 'device-diagnostic'
  });

  const updated = await runtime.updateTaobaoPublishStatus(queued.id, {
    token: settings.token,
    userId: 'user-diagnostic',
    storeId: 'store-diagnostic',
    deviceId: 'device-diagnostic',
    status: '发布失败',
    failureReason: 'selector failed',
    detail: {
      step: 'adapter-failed',
      screenshotPath: 'D:\\local\\taobao-failure.png',
      diagnosticScreenshot: {
        mime: 'image/png',
        base64: tinyPng.toString('base64')
      }
    }
  });

  assert.match(updated.detail.diagnosticScreenshotUrl, /^\/api\/files\//);
  assert.match(updated.detail.diagnosticScreenshotPath, /taobao-diagnostics/);
  assert.equal(await fs.readFile(updated.detail.diagnosticScreenshotPath, 'base64'), tinyPng.toString('base64'));
  assert.equal(updated.detail.diagnosticScreenshot, undefined);
});

test('local publisher status records an operator-readable execution timeline', async () => {
  const folder = await createPublishableReviewTask('taobao-ready-status-timeline');
  const settings = await runtime.saveTaobaoPublishSettings({
    stores: [{
      id: 'store-timeline',
      name: 'Timeline Store',
      ownerUserId: 'user-timeline',
      autoPublish: true,
      online: true
    }],
    devices: [{
      id: 'device-timeline',
      userId: 'user-timeline',
      activeStoreId: 'store-timeline',
      enabled: true,
      appVersion: '0.1.0'
    }],
    categories: configuredSideboardCategories()
  });

  const queued = await runtime.queueTaobaoPublishTask({
    folder,
    categoryId: 'sideboard',
    ownerUserId: 'user-timeline',
    storeId: 'store-timeline',
    deviceId: 'device-timeline'
  });
  assert.equal(queued.timeline.at(-1).status, '等待插件接收');
  assert.equal(queued.timeline.at(-1).step, 'queued');

  await runtime.claimTaobaoPublishTask({
    token: settings.token,
    userId: 'user-timeline',
    storeId: 'store-timeline',
    deviceId: 'device-timeline',
    extensionId: 'timeline-test'
  });

  const updated = await runtime.updateTaobaoPublishStatus(queued.id, {
    token: settings.token,
    userId: 'user-timeline',
    storeId: 'store-timeline',
    deviceId: 'device-timeline',
    status: '发布失败',
    failureReason: 'selector failed',
    detail: {
      step: 'adapter-failed',
      screenshotPath: 'D:\\local\\timeline-failure.png',
      diagnosticScreenshot: {
        mime: 'image/png',
        base64: tinyPng.toString('base64')
      }
    }
  });

  assert.deepEqual(updated.timeline.map(item => item.status), [
    '等待插件接收',
    '插件已接收',
    '发布失败'
  ]);
  assert.deepEqual(updated.timeline.map(item => item.step), [
    'queued',
    'claim',
    'adapter-failed'
  ]);
  assert.equal(updated.timeline.at(-1).failureReason, 'selector failed');
  assert.equal(updated.timeline.at(-1).deviceId, 'device-timeline');
  assert.match(updated.timeline.at(-1).diagnosticScreenshotUrl, /^\/api\/files\//);
  assert.equal(updated.timeline.at(-1).diagnosticScreenshot, undefined);
});

test('local publisher status updates are rejected when web user or store does not match the task', async () => {
  const folder = await createPublishableReviewTask('taobao-ready-status-auth');
  const settings = await runtime.saveTaobaoPublishSettings({
    stores: [
      {
        id: 'store-status-a',
        name: '鐘舵€佹洿鏂板簵閾?A',
        ownerUserId: 'user-status-a',
        autoPublish: true,
        online: true
      },
      {
        id: 'store-status-b',
        name: '鐘舵€佹洿鏂板簵閾?B',
        ownerUserId: 'user-status-b',
        autoPublish: true,
        online: true
      }
    ],
    devices: [
      {
        id: 'device-status-a',
        userId: 'user-status-a',
        activeStoreId: 'store-status-a',
        enabled: true
      },
      {
        id: 'device-status-b',
        userId: 'user-status-b',
        activeStoreId: 'store-status-b',
        enabled: true
      }
    ],
    categories: configuredSideboardCategories()
  });
  const queued = await runtime.queueTaobaoPublishTask({
    folder,
    categoryId: 'sideboard',
    ownerUserId: 'user-status-a',
    storeId: 'store-status-a',
    deviceId: 'device-status-a'
  });

  await assert.rejects(() => runtime.updateTaobaoPublishStatus(queued.id, {
    token: settings.token,
    userId: 'user-status-b',
    storeId: 'store-status-b',
    deviceId: 'device-status-b',
    status: '绛夊緟鎻掗欢鎺ユ敹'
  }), /mismatch|不匹配|不屬於|不属于|鍖归厤/);

  const listed = await runtime.listTaobaoPublishTasks({
    token: settings.token,
    userId: 'user-status-a',
    storeId: 'store-status-a',
    deviceId: 'device-status-a'
  });
  const task = listed.tasks.find(item => item.id === queued.id);
  assert.equal(task.status, queued.status);
  assert.equal(task.attempts, 1);
});

test('operator can skip a failed local publisher task so it is not reclaimed', async () => {
  const folder = await createPublishableReviewTask('taobao-ready-skip-local-publish');
  const settings = await runtime.saveTaobaoPublishSettings({
    stores: [{
      id: 'store-skip',
      name: '跳过店铺',
      ownerUserId: 'user-skip',
      autoPublish: true,
      online: true
    }],
    devices: [{
      id: 'device-skip',
      userId: 'user-skip',
      activeStoreId: 'store-skip',
      enabled: true
    }],
    localPublisher: {
      autoPublish: false
    },
    categories: configuredSideboardCategories()
  });
  const queued = await runtime.queueTaobaoPublishTask({
    folder,
    categoryId: 'sideboard',
    ownerUserId: 'user-skip',
    storeId: 'store-skip',
    deviceId: 'device-skip'
  });
  await runtime.claimTaobaoPublishTask({
    token: settings.token,
    userId: 'user-skip',
    storeId: 'store-skip',
    deviceId: 'device-skip',
    extensionId: 'skip-test'
  });
  await runtime.updateTaobaoPublishStatus(queued.id, {
    token: settings.token,
    status: '发布失败',
    failureReason: '运营确认不再发布',
    detail: { screenshotPath: 'D:\\screenshots\\skip.png' }
  });

  const skipped = await runtime.updateTaobaoPublishStatus(queued.id, {
    token: settings.token,
    status: '已跳过本地发布',
    detail: {
      skipReason: 'operator clicked skip',
      skippedByDeviceId: 'device-skip'
    }
  });

  assert.equal(skipped.status, '已跳过本地发布');
  assert.equal(skipped.failureReason, '');
  assert.equal(skipped.detail.skipReason, 'operator clicked skip');
  assert.equal(skipped.detail.skippedByDeviceId, 'device-skip');

  const reclaimed = await runtime.claimTaobaoPublishTask({
    token: settings.token,
    userId: 'user-skip',
    storeId: 'store-skip',
    deviceId: 'device-skip',
    extensionId: 'skip-test-2'
  });
  assert.equal(reclaimed, null);
});

test('template incomplete publish status is persisted and can be requeued', async () => {
  const folder = await createPublishableReviewTask('taobao-ready-template-incomplete');
  const settings = await runtime.getTaobaoPublishSettings();
  const queued = await runtime.queueTaobaoPublishTask({ folder, categoryId: 'sideboard' });
  await runtime.claimTaobaoPublishTask({ token: settings.token, extensionId: 'template-incomplete-test' });

  const blocked = await runtime.updateTaobaoPublishStatus(queued.id, {
    token: settings.token,
    status: '模板未配置',
    failureReason: '类目模板缺少必填字段：price',
    detail: { step: 'taobao-runner-template-incomplete', missing: ['price'] }
  });
  assert.equal(blocked.status, '模板未配置');
  assert.equal(blocked.failureReason, '类目模板缺少必填字段：price');
  assert.deepEqual(blocked.detail.missing, ['price']);

  const retried = await runtime.updateTaobaoPublishStatus(queued.id, {
    token: settings.token,
    status: '等待插件接收',
    detail: { retryReason: 'template fixed' }
  });
  assert.equal(retried.status, '等待插件接收');
  assert.equal(retried.attempts, 2);
});

test('local publisher marks incomplete category templates before claiming tasks', async () => {
  const folder = await createPublishableReviewTask('taobao-ready-preclaim-template-incomplete');
  const settings = await runtime.saveTaobaoPublishSettings({
    stores: [{
      id: 'store-template-preclaim',
      name: '模板预检店铺',
      ownerUserId: 'user-template-preclaim',
      autoPublish: true,
      online: true
    }],
    devices: [{
      id: 'device-template-preclaim',
      name: '模板预检电脑',
      userId: 'user-template-preclaim',
      activeStoreId: 'store-template-preclaim',
      enabled: true
    }],
    categories: [{
      id: 'sideboard',
      defaults: {
        brandName: '其他家',
        modelName: '其他',
        stock: '999',
        price: ''
      }
    }]
  });
  const queued = await runtime.queueTaobaoPublishTask({
    folder,
    categoryId: 'sideboard',
    ownerUserId: 'user-template-preclaim',
    storeId: 'store-template-preclaim'
  });

  const claimed = await runtime.claimTaobaoPublishTask({
    token: settings.token,
    userId: 'user-template-preclaim',
    storeId: 'store-template-preclaim',
    deviceId: 'device-template-preclaim',
    extensionId: 'exe:device-template-preclaim'
  });
  assert.equal(claimed, null);

  const listed = await runtime.listTaobaoPublishTasks();
  const task = listed.tasks.find(item => item.id === queued.id);
  assert.equal(task.status, '模板未配置');
  assert.equal(task.failureReason, '类目模板缺少必填字段：price');
  assert.deepEqual(task.detail.missing, ['price']);
});

test('saving a fixed category template requeues tasks blocked by template preflight', async () => {
  const folder = await createPublishableReviewTask('taobao-ready-template-fixed-requeue');
  const settings = await runtime.saveTaobaoPublishSettings({
    stores: [{
      id: 'store-template-fixed',
      name: '模板修复店铺',
      ownerUserId: 'user-template-fixed',
      autoPublish: true,
      online: true
    }],
    devices: [{
      id: 'device-template-fixed',
      name: '模板修复电脑',
      userId: 'user-template-fixed',
      activeStoreId: 'store-template-fixed',
      enabled: true
    }],
    categories: [{
      id: 'sideboard',
      defaults: {
        brandName: '其他家',
        modelName: '其他',
        stock: '999',
        price: ''
      }
    }]
  });
  const queued = await runtime.queueTaobaoPublishTask({
    folder,
    categoryId: 'sideboard',
    ownerUserId: 'user-template-fixed',
    storeId: 'store-template-fixed'
  });
  await runtime.claimTaobaoPublishTask({
    token: settings.token,
    userId: 'user-template-fixed',
    storeId: 'store-template-fixed',
    deviceId: 'device-template-fixed',
    extensionId: 'exe:device-template-fixed'
  });

  const blockedList = await runtime.listTaobaoPublishTasks();
  const blocked = blockedList.tasks.find(item => item.id === queued.id);
  assert.equal(blocked.status, '模板未配置');
  assert.deepEqual(blocked.detail.missing, ['price']);

  await runtime.saveTaobaoPublishSettings({
    categories: [{
      id: 'sideboard',
      defaults: {
        brandName: '其他家',
        modelName: '其他',
        stock: '999',
        price: '1680'
      }
    }]
  });

  const listed = await runtime.listTaobaoPublishTasks();
  const requeued = listed.tasks.find(item => item.id === queued.id);
  assert.equal(requeued.status, queued.status);
  assert.equal(requeued.failureReason, '');
  assert.equal(requeued.detail.step, 'local-publisher-template-fixed');
  assert.deepEqual(requeued.detail.missing, []);
  assert.equal(requeued.attempts, 2);
});

test('saving template selector calibration only requeues locally blocked tasks after the current store passes calibration', async () => {
  const folder = await createPublishableReviewTask('taobao-ready-template-calibration-requeue');
  const settings = await runtime.saveTaobaoPublishSettings({
    stores: [{
      id: 'store-template-calibration',
      name: '模板校准店铺',
      ownerUserId: 'user-template-calibration',
      autoPublish: true,
      online: true
    }],
    devices: [{
      id: 'device-template-calibration',
      name: '模板校准电脑',
      userId: 'user-template-calibration',
      activeStoreId: 'store-template-calibration',
      enabled: true
    }],
    categories: [{
      id: 'sideboard',
      defaults: {
        brandName: '其他家',
        modelName: '其他',
        stock: '999',
        price: '1680',
        selectorCalibration: {
          'store-template-calibration': { ok: false }
        }
      }
    }]
  });
  const queued = await runtime.queueTaobaoPublishTask({
    folder,
    categoryId: 'sideboard',
    ownerUserId: 'user-template-calibration',
    storeId: 'store-template-calibration'
  });
  await runtime.updateTaobaoPublishStatus(queued.id, {
    token: settings.token,
    userId: 'user-template-calibration',
    storeId: 'store-template-calibration',
    deviceId: 'device-template-calibration',
    status: '模板未配置',
    failureReason: '模板控件未校准：sideboard',
    detail: {
      step: 'local-publisher-template-calibration-required',
      categoryId: 'sideboard',
      storeId: 'store-template-calibration',
      calibrationStatus: 'failed'
    }
  });

  await runtime.saveTaobaoPublishSettings({
    categories: [{
      id: 'sideboard',
      defaults: {
        brandName: '其他家',
        modelName: '其他',
        stock: '999',
        price: '1680',
        selectorCalibration: {
          'store-template-calibration': { ok: false }
        }
      }
    }]
  });
  const stillBlocked = (await runtime.listTaobaoPublishTasks()).tasks.find(item => item.id === queued.id);
  assert.equal(stillBlocked.status, '模板未配置');
  assert.equal(stillBlocked.detail.step, 'local-publisher-template-calibration-required');

  await runtime.saveTaobaoPublishSettings({
    categories: [{
      id: 'sideboard',
      defaults: {
        brandName: '其他家',
        modelName: '其他',
        stock: '999',
        price: '1680',
        selectorCalibration: {
          'store-template-calibration': { ok: true }
        }
      }
    }]
  });

  const listed = await runtime.listTaobaoPublishTasks();
  const requeued = listed.tasks.find(item => item.id === queued.id);
  assert.equal(requeued.status, queued.status);
  assert.equal(requeued.failureReason, '');
  assert.equal(requeued.detail.step, 'local-publisher-template-calibration-fixed');
  assert.equal(requeued.detail.calibrationStoreId, 'store-template-calibration');
  assert.equal(requeued.attempts, 2);
});

test('local publisher runtime stage statuses are persisted for Web progress cards', async () => {
  const folder = await createPublishableReviewTask('taobao-ready-runtime-stages');
  const settings = await runtime.getTaobaoPublishSettings();
  const queued = await runtime.queueTaobaoPublishTask({ folder, categoryId: 'sideboard' });
  await runtime.claimTaobaoPublishTask({ token: settings.token, extensionId: 'runtime-stage-test' });

  for (const status of ['正在打开淘宝', '正在填写模板', '正在上传图片', '正在保存草稿']) {
    const updated = await runtime.updateTaobaoPublishStatus(queued.id, {
      token: settings.token,
      status,
      detail: { step: `stage-${status}` }
    });
    assert.equal(updated.status, status);
    assert.equal(updated.detail.step, `stage-${status}`);
  }
});

test('local publisher execution metadata is visible in Web task details', async () => {
  const folder = await createPublishableReviewTask('taobao-ready-execution-metadata');
  const settings = await runtime.saveTaobaoPublishSettings({
    stores: [{
      id: 'store-meta',
      name: '元数据店铺',
      ownerUserId: 'user-meta',
      autoPublish: true,
      online: true
    }],
    devices: [{
      id: 'device-meta',
      name: '元数据电脑',
      userId: 'user-meta',
      activeStoreId: 'store-meta',
      enabled: true
    }],
    categories: configuredSideboardCategories()
  });
  const queued = await runtime.queueTaobaoPublishTask({
    folder,
    categoryId: 'sideboard',
    ownerUserId: 'user-meta',
    storeId: 'store-meta'
  });
  await runtime.claimTaobaoPublishTask({
    token: settings.token,
    userId: 'user-meta',
    storeId: 'store-meta',
    deviceId: 'device-meta',
    extensionId: 'exe:device-meta'
  });
  await runtime.updateTaobaoPublishStatus(queued.id, {
    token: settings.token,
    status: '需要人工处理',
    failureReason: '检测到验证码',
    detail: { step: 'taobao-runner-manual-intervention', screenshotPath: 'D:\\screenshots\\captcha.png' }
  });

  const listed = await runtime.listTaobaoPublishTasks();
  const task = listed.tasks.find(item => item.id === queued.id);
  assert.equal(task.storeName, '元数据店铺');
  assert.equal(task.deviceId, 'device-meta');
  assert.equal(task.extensionId, 'exe:device-meta');
  assert.equal(task.attempts, 1);
  assert.equal(task.failureReason, '检测到验证码');
  assert.equal(task.detail.screenshotPath, 'D:\\screenshots\\captcha.png');
  assert.ok(task.updatedAt);
});

test('local publisher heartbeat keeps only recently seen devices eligible to claim', async () => {
  const folder = await createPublishableReviewTask('taobao-ready-heartbeat');
  await runtime.saveTaobaoPublishSettings({
    stores: [{
      id: 'store-heartbeat',
      name: '心跳店铺',
      ownerUserId: 'user-heartbeat',
      autoPublish: true,
      online: true
    }],
    devices: [{
      id: 'device-heartbeat',
      name: '心跳电脑',
      userId: 'user-heartbeat',
      activeStoreId: 'store-heartbeat',
      enabled: true,
      lastSeenAt: '2000-01-01T00:00:00.000Z'
    }],
    categories: configuredSideboardCategories()
  });
  const settings = await runtime.getTaobaoPublishSettings();
  await runtime.queueTaobaoPublishTask({
    folder,
    categoryId: 'sideboard',
    ownerUserId: 'user-heartbeat',
    storeId: 'store-heartbeat'
  });

  const staleClaim = await runtime.claimTaobaoPublishTask({
    token: settings.token,
    userId: 'user-heartbeat',
    storeId: 'store-heartbeat',
    deviceId: 'device-heartbeat'
  });
  assert.equal(staleClaim, null);

  const heartbeat = await runtime.heartbeatTaobaoPublisher({
    userId: 'user-heartbeat',
    deviceId: 'device-heartbeat',
    deviceName: '运营电脑一号',
    appVersion: '0.1.0-test',
    activeStoreId: 'store-heartbeat',
    autoPublish: true
  });
  const device = heartbeat.devices.find(item => item.id === 'device-heartbeat');
  assert.equal(device.name, '运营电脑一号');
  assert.equal(device.enabled, true);
  assert.equal(device.userId, 'user-heartbeat');
  assert.equal(device.activeStoreId, 'store-heartbeat');
  assert.equal(device.appVersion, '0.1.0-test');
  assert.ok(device.lastSeenAt);

  const claimed = await runtime.claimTaobaoPublishTask({
    token: settings.token,
    userId: 'user-heartbeat',
    storeId: 'store-heartbeat',
    deviceId: 'device-heartbeat'
  });
  assert.equal(claimed.storeId, 'store-heartbeat');
});

test('local publisher heartbeat ignores stores not owned by the current web user', async () => {
  await runtime.saveTaobaoPublishSettings({
    stores: [
      {
        id: 'store-owned-by-a',
        name: '运营A店铺',
        ownerUserId: 'user-a',
        autoPublish: true,
        online: true
      },
      {
        id: 'store-owned-by-b',
        name: '运营B店铺',
        ownerUserId: 'user-b',
        autoPublish: true,
        online: true
      }
    ],
    categories: configuredSideboardCategories()
  });

  const heartbeat = await runtime.heartbeatTaobaoPublisher({
    userId: 'user-a',
    deviceId: 'device-cross-store',
    deviceName: 'cross store computer',
    appVersion: '0.1.0-test',
    activeStoreId: 'store-owned-by-b',
    autoPublish: true
  });

  const device = heartbeat.devices.find(item => item.id === 'device-cross-store');
  assert.equal(device.activeStoreId, '');
  assert.equal(heartbeat.localPublisher.activeStoreId, '');
  assert.equal(heartbeat.localPublisher.activeDeviceId, 'device-cross-store');
});

test('local publisher reclaims a running task when the previous device is offline', async () => {
  const folder = await createPublishableReviewTask('taobao-ready-reclaim-offline-device');
  await runtime.saveTaobaoPublishSettings({
    stores: [{
      id: 'store-reclaim',
      name: '离线回收店铺',
      ownerUserId: 'user-reclaim',
      autoPublish: true,
      online: true
    }],
    devices: [
      {
        id: 'device-old',
        name: '旧电脑',
        userId: 'user-reclaim',
        activeStoreId: 'store-reclaim',
        enabled: true,
        lastSeenAt: new Date().toISOString()
      },
      {
        id: 'device-new',
        name: '新电脑',
        userId: 'user-reclaim',
        activeStoreId: 'store-reclaim',
        enabled: true,
        lastSeenAt: new Date().toISOString()
      }
    ],
    categories: configuredSideboardCategories()
  });
  const settings = await runtime.getTaobaoPublishSettings();
  const queued = await runtime.queueTaobaoPublishTask({
    folder,
    categoryId: 'sideboard',
    ownerUserId: 'user-reclaim',
    storeId: 'store-reclaim'
  });
  await runtime.claimTaobaoPublishTask({
    token: settings.token,
    userId: 'user-reclaim',
    storeId: 'store-reclaim',
    deviceId: 'device-old',
    extensionId: 'exe:device-old'
  });
  await runtime.updateTaobaoPublishStatus(queued.id, {
    token: settings.token,
    status: '正在上传图片',
    detail: { step: 'upload-images' }
  });
  await runtime.saveTaobaoPublishSettings({
    ...(await runtime.getTaobaoPublishSettings()),
    devices: [
      {
        id: 'device-old',
        name: '旧电脑',
        userId: 'user-reclaim',
        activeStoreId: 'store-reclaim',
        enabled: true,
        lastSeenAt: '2000-01-01T00:00:00.000Z'
      },
      {
        id: 'device-new',
        name: '新电脑',
        userId: 'user-reclaim',
        activeStoreId: 'store-reclaim',
        enabled: true,
        lastSeenAt: new Date().toISOString()
      }
    ]
  });

  const reclaimed = await runtime.claimTaobaoPublishTask({
    token: settings.token,
    userId: 'user-reclaim',
    storeId: 'store-reclaim',
    deviceId: 'device-new',
    extensionId: 'exe:device-new'
  });

  assert.equal(reclaimed.id, queued.id);
  const listed = await runtime.listTaobaoPublishTasks();
  const task = listed.tasks.find(item => item.id === queued.id);
  assert.equal(task.deviceId, 'device-new');
  assert.equal(task.extensionId, 'exe:device-new');
  assert.equal(task.attempts, 2);
  assert.equal(task.detail.previousDeviceId, 'device-old');
  assert.equal(task.detail.previousStatus, '正在上传图片');
});
