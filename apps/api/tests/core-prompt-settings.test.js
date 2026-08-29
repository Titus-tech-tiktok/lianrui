const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PROMPT_DEFINITIONS,
  PROMPT_IMAGE_ROLES,
  normalizePromptImageOrder,
  publicPromptSettings
} = require('../src/core/prompt-settings');

test('internal analysis prompts remain available while generation groups start empty', () => {
  assert.equal(PROMPT_DEFINITIONS.filter(item => item.internal).length, 5);
  assert.equal(PROMPT_DEFINITIONS.filter(item => item.legacyGenerationDefinition).length, 3);
  const settings = publicPromptSettings({});
  assert.deepEqual(settings.prompts, []);
  assert.deepEqual(settings.stageBindings, { master: '', model: '', combination: '' });
  assert.deepEqual(settings.stages.map(item => item.id), ['master', 'model', 'combination']);
});

test('arbitrary groups retain independent presets, prompts and image order', () => {
  const settings = publicPromptSettings({
    promptGroups: {
      a: {
        id: 'a',
        title: 'A组分类',
        stageId: 'master',
        activePresetId: 'a-3',
        items: [
          { id: 'a-1', name: '预设 1', value: '先参考再实拍', imageOrder: ['flat_reference', 'real_product'] },
          { id: 'a-2', name: '预设 2', value: '先实拍再参考', imageOrder: ['real_product', 'flat_reference'] },
          { id: 'a-3', name: '预设 3', value: '三张实拍证据', imageOrder: ['real_product', 'real_details', 'flat_reference'] }
        ]
      },
      b: {
        id: 'b',
        title: 'B组分类',
        stageId: 'master',
        activePresetId: 'b-1',
        items: [{ id: 'b-1', name: '简版', value: '', imageOrder: ['real_product'] }]
      }
    },
    stagePromptGroupIds: { master: 'a' }
  });
  assert.equal(settings.prompts.length, 2);
  const groupA = settings.prompts.find(item => item.id === 'a');
  const groupB = settings.prompts.find(item => item.id === 'b');
  assert.equal(groupA.activePresetId, 'a-3');
  assert.equal(groupA.value, '三张实拍证据');
  assert.deepEqual(groupA.presets[2].imageOrder, ['real_product', 'real_details', 'flat_reference']);
  assert.equal(groupA.activeForStage, true);
  assert.equal(groupB.activeForStage, false);
  assert.equal(groupB.presets[0].value, '', '允许先保存图片顺序，稍后填写提示词');
  assert.deepEqual(groupA.imageRoles.map(item => item.id), PROMPT_IMAGE_ROLES.map(item => item.id));
});

test('legacy generation data migrates into editable groups without creating permanent defaults', () => {
  const settings = publicPromptSettings({
    prompts: { childrenwearModelGeneration: '旧模特提示词' },
    promptPresets: {
      childrenwearMasterGeneration: {
        activePresetId: 'legacy-flat',
        items: [{ id: 'legacy-flat', name: '旧平铺', value: '旧平铺提示词' }]
      }
    }
  });
  assert.deepEqual(settings.prompts.map(item => item.id).sort(), [
    'childrenwearMasterGeneration',
    'childrenwearModelGeneration'
  ]);
  assert.equal(settings.prompts.find(item => item.stageId === 'model').value, '旧模特提示词');
  assert.deepEqual(
    settings.prompts.find(item => item.stageId === 'master').presets[0].imageOrder,
    ['real_product', 'flat_reference']
  );
  assert.equal(settings.prompts.some(item => item.stageId === 'combination'), false);
});

test('image order accepts any valid subset and rejects duplicates or unknown roles', () => {
  assert.deepEqual(
    normalizePromptImageOrder('any-dynamic-group', ['real_product', 'real_details', 'flat_reference'], { strict: true }),
    ['real_product', 'real_details', 'flat_reference']
  );
  assert.deepEqual(normalizePromptImageOrder('any-dynamic-group', [], { strict: true }), []);
  assert.throws(
    () => normalizePromptImageOrder('any-dynamic-group', ['real_product', 'real_product'], { strict: true }),
    /图片顺序/
  );
  assert.throws(
    () => normalizePromptImageOrder('any-dynamic-group', ['not-a-role'], { strict: true }),
    /图片顺序/
  );
});
