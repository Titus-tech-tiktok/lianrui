const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PROMPT_DEFINITIONS,
  normalizePromptValue,
  publicPromptSettings
} = require('../src/core/prompt-settings');

test('prompt settings expose all active childrenwear analysis and generation prompts', () => {
  assert.deepEqual(PROMPT_DEFINITIONS.map(item => item.id), [
    'childrenwearProductAnalysis',
    'childrenwearFlatReferenceAnalysis',
    'childrenwearModelReferenceAnalysis',
    'childrenwearCombinationReferenceAnalysis',
    'childrenwearMasterGeneration',
    'childrenwearModelGeneration',
    'childrenwearCombinationGeneration'
  ]);
  assert.equal(PROMPT_DEFINITIONS.filter(item => item.group === '多嘻噜卡 AI 分析').length, 4);
  assert.equal(PROMPT_DEFINITIONS.filter(item => item.group === '多嘻噜卡生图').length, 3);
  for (const removedId of [
    'templatePrint',
    'templateMasterGeneration',
    'freeImageDefault',
    'masterGeneration',
    'templateAnalysis',
    'templateMigration',
    'productProfileAnalysis',
    'templateAudit',
    'templateAuditRecheck'
  ]) {
    assert.equal(PROMPT_DEFINITIONS.some(item => item.id === removedId), false);
    assert.throws(() => normalizePromptValue(removedId, 'unused'), /unknown prompt|\u672a\u77e5\u63d0\u793a\u8bcd/i);
  }
});

test('custom childrenwear prompt values preserve empty strings', () => {
  const settings = publicPromptSettings({
    prompts: {
      childrenwearMasterGeneration: ''
    }
  });
  assert.equal(settings.prompts.find(item => item.id === 'childrenwearMasterGeneration').customized, true);
  assert.equal(settings.prompts.find(item => item.id === 'childrenwearMasterGeneration').value, '');
  assert.equal(normalizePromptValue('childrenwearMasterGeneration', ''), '');
});
