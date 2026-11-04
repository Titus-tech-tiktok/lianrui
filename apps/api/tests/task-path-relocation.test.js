const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const { relocateTaskPaths } = require('../src/core/task-paths');

test('task relocation maps its internal Windows/Linux paths without accepting outside paths', () => {
  const actual = path.join(os.tmpdir(), 'current-output', '童装任务', 'case');
  const result = relocateTaskPaths({
    folder: 'D:\\old\\case',
    masterPath: 'D:\\old\\case\\平铺图\\master.png',
    modelOutputs: [{ topReferencePath: 'D:/old/case/素材/top.png' }],
    externalMasterPath: 'D:/another-user/private.png',
    traversal: 'D:/old/case/../outside.png',
    sibling: 'D:/old/case-other/private.png'
  }, actual);
  assert.equal(result.folder, actual);
  assert.equal(result.masterPath, path.join(actual, '平铺图', 'master.png'));
  assert.equal(result.modelOutputs[0].topReferencePath, path.join(actual, '素材', 'top.png'));
  assert.equal(result.externalMasterPath, 'D:/another-user/private.png');
  assert.equal(result.traversal, 'D:/old/case/../outside.png');
  assert.equal(result.sibling, 'D:/old/case-other/private.png');
  assert.equal(relocateTaskPaths({ folder: '/old/app/task', masterPath: '/old/app/task/master.png' }, actual).masterPath, path.join(actual, 'master.png'));
});

test('listing a moved historical task exposes current paths that pass generation path checks', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moved-childrenwear-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  process.env.CAISHEN_DATA_DIR = path.join(root, 'data');
  process.env.CAISHEN_WORKSPACE_ID = 'moved-task-test';
  delete require.cache[require.resolve('../src/runtime')];
  const runtime = require('../src/runtime');
  const outputs = path.join(root, 'new-outputs');
  await runtime.saveConfig({ outputPath: outputs });
  const actual = path.join(outputs, '童装任务', '1104-001-test');
  await fs.mkdir(actual, { recursive: true });
  const image = path.join(actual, 'photo.png');
  await sharp({ create: { width: 32, height: 32, channels: 3, background: '#cccccc' } }).png().toFile(image);
  const oldFolder = '/old-server/output/童装任务/1104-001-test';
  await fs.writeFile(path.join(actual, 'childrenwear-task.json'), JSON.stringify({
    folder: oldFolder, taskName: 'test', taskCode: '1104-001', styleName: 'test',
    realPhotoPath: oldFolder + '/photo.png', referencePath: oldFolder + '/photo.png', masterPath: oldFolder + '/photo.png',
    modelOutputs: [{ id: 'model-1', path: oldFolder + '/photo.png', modelReferencePath: oldFolder + '/photo.png', topReferencePath: oldFolder + '/photo.png', poseReferencePath: oldFolder + '/photo.png' }]
  }));
  assert.equal(runtime.isOutputPath(oldFolder), false, 'old task path reproduces the reported API rejection');
  const [task] = await runtime.listChildrenwearTasks();
  assert.equal(task.folder, actual);
  for (const file of [task.folder, task.realPhotoPath, task.referencePath, task.masterPath, task.modelOutputs[0].topReferencePath, task.modelOutputs[0].poseReferencePath]) {
    assert.equal(runtime.isOutputPath(file), true, 'relocated task references pass current workspace/output checks');
    await fs.access(file);
  }
  const reopened = await runtime.getChildrenwearTask(task.folder);
  assert.equal(reopened.masterPath, image);
  assert.equal(runtime.isOutputPath(path.join(root, 'another-account', 'private.png')), false);
});
