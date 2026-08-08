const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PROMPT_DEFINITIONS,
  normalizePromptValue,
  publicPromptSettings,
  renderPromptTemplate
} = require('../src/core/prompt-settings');

test('prompt settings expose only the three active generation prompts', () => {
  assert.deepEqual(PROMPT_DEFINITIONS.map(item => item.id), [
    'templatePrint',
    'templateMasterGeneration',
    'freeImageDefault'
  ]);
  for (const removedId of [
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

test('custom prompt values preserve empty strings and render dynamic values', () => {
  const settings = publicPromptSettings({
    prompts: {
      freeImageDefault: '',
      templatePrint: 'path={{templatePath}}'
    }
  });
  assert.equal(settings.prompts.find(item => item.id === 'freeImageDefault').customized, true);
  assert.deepEqual(settings.prompts.find(item => item.id === 'templatePrint').placeholders, ['{{templatePath}}']);
  assert.equal(renderPromptTemplate(settings.prompts.find(item => item.id === 'templatePrint').value, {
    templatePath: 'main/01.png'
  }), 'path=main/01.png');
  assert.equal(normalizePromptValue('freeImageDefault', ''), '');
});
