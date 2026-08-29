const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

test('selected presets drive stage prompt while task-card order drives API images', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'duoxiluka-prompt-groups-'));
  process.env.CAISHEN_DATA_DIR = temp;
  process.env.CAISHEN_WORKSPACE_ID = 'operator-a';
  const runtimePath = require.resolve('../src/runtime');
  delete require.cache[runtimePath];
  const runtime = require('../src/runtime');
  await runtime.initializeRuntime();

  let settings = await runtime.createPromptGroup({ title: 'A组分类', stageId: 'master', makeStageActive: true });
  const group = settings.prompts.find(item => item.title === 'A组分类');
  assert.ok(group);

  const definitions = [
    ['预设 1', '提示词一', ['flat_reference', 'real_product']],
    ['预设 2', '提示词二', ['real_product', 'flat_reference']],
    ['预设 3', '提示词三', ['real_product', 'real_details', 'flat_reference']]
  ];
  const presetIds = [];
  for (const [name, value, imageOrder] of definitions) {
    settings = await runtime.savePromptPreset(group.id, { name, value, imageOrder });
    presetIds.push(settings.prompts.find(item => item.id === group.id).presets.at(-1).id);
  }
  settings = await runtime.selectPromptPreset(group.id, presetIds[2]);
  settings = await runtime.selectStagePromptGroup('master', group.id);

  const stageSettings = await runtime.loadChildrenwearGenerationPromptSettings();
  const master = stageSettings.prompts.find(item => item.stageId === 'master');
  assert.equal(master.groupId, group.id);
  assert.equal(master.presetName, '预设 3');
  assert.equal(master.value, '提示词三');
  assert.deepEqual(master.imageOrder, ['real_product', 'real_details', 'flat_reference']);

  const ordered = runtime.orderedChildrenwearGenerationInputs({
    id: group.id,
    title: group.title,
    prompt: master.value,
    imageOrder: master.imageOrder
  }, [
    { label: '实拍产品图', path: 'D:\\images\\real.jpg' },
    { label: '成品参考图', path: 'D:\\images\\reference.jpg' },
    { label: '实拍局部细节图', paths: ['D:\\images\\detail-1.jpg', 'D:\\images\\detail-2.jpg'] }
  ]);
  assert.deepEqual(ordered.inputPaths, [
    'D:\\images\\real.jpg',
    'D:\\images\\reference.jpg',
    'D:\\images\\detail-1.jpg',
    'D:\\images\\detail-2.jpg'
  ]);
  assert.match(ordered.prompt, /任务卡片从左到右/);
  assert.match(ordered.prompt, /提示词三/);

  await runtime.deletePromptGroup(group.id);
  settings = await runtime.loadPromptSettings();
  assert.equal(settings.prompts.some(item => item.id === group.id), false);
  assert.equal(settings.stageBindings.master, '');
  await fs.rm(temp, { recursive: true, force: true });
});

test('deleting a migrated legacy group removes its compatibility shadow permanently', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'duoxiluka-legacy-prompt-'));
  process.env.CAISHEN_DATA_DIR = temp;
  process.env.CAISHEN_WORKSPACE_ID = 'operator-legacy';
  const runtimePath = require.resolve('../src/runtime');
  delete require.cache[runtimePath];
  const runtime = require('../src/runtime');
  await runtime.initializeRuntime();
  await runtime.savePromptSetting('childrenwearMasterGeneration', '旧提示词');
  assert.ok((await runtime.loadPromptSettings()).prompts.some(item => item.id === 'childrenwearMasterGeneration'));
  await runtime.deletePromptGroup('childrenwearMasterGeneration');
  const reloaded = await runtime.loadPromptSettings();
  assert.equal(reloaded.prompts.some(item => item.id === 'childrenwearMasterGeneration'), false);
  assert.equal(reloaded.stageBindings.master, '');
  await fs.rm(temp, { recursive: true, force: true });
});
