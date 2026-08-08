'use strict';

const {
  TEMPLATE_MASTER_PROMPT,
  TEMPLATE_PRINT_PROMPT
} = require('./prompts');

const PLACEHOLDER_VALUES = Object.freeze({
  templatePath: '{{templatePath}}'
});

const templateJob = {
  relativeTemplatePath: PLACEHOLDER_VALUES.templatePath,
  templateImagePath: PLACEHOLDER_VALUES.templatePath
};

const PROMPT_DEFINITIONS = Object.freeze([
  {
    id: 'templatePrint',
    title: '套图文件夹+印花',
    group: '生图',
    description: '原套图、印花母版、原始印花和人工红框图按固定顺序直接请求 Image2；返回结果只恢复原画布尺寸，不做像素筛选或局部拼贴。',
    placeholders: ['{{templatePath}}'],
    defaultValue: TEMPLATE_PRINT_PROMPT(templateJob)
  },
  {
    id: 'templateMasterGeneration',
    title: '套图母版生成',
    group: '生图',
    description: '使用柜体参考图和原始印花生成纯白底标准印花柜体母版图，输入场景不会进入母版，母版生成不计入用户费用。',
    placeholders: [],
    defaultValue: TEMPLATE_MASTER_PROMPT
  },
  {
    id: 'freeImageDefault',
    title: '自由生图默认值',
    group: '前端默认',
    description: '打开自由生图页面时自动填入；用户仍可在生成前单独修改。',
    placeholders: [],
    defaultValue: ''
  }
]);

const definitionById = new Map(PROMPT_DEFINITIONS.map(item => [item.id, item]));

function renderPromptTemplate(template, values = {}) {
  let result = String(template ?? '');
  for (const [key, value] of Object.entries(values)) {
    result = result.split(`{{${key}}}`).join(String(value ?? ''));
  }
  return result;
}

function publicPromptSettings(saved = {}) {
  const prompts = saved?.prompts && typeof saved.prompts === 'object' ? saved.prompts : {};
  return {
    updatedAt: String(saved?.updatedAt || ''),
    prompts: PROMPT_DEFINITIONS.map(definition => ({
      ...definition,
      value: Object.prototype.hasOwnProperty.call(prompts, definition.id)
        ? String(prompts[definition.id] ?? '')
        : definition.defaultValue,
      customized: Object.prototype.hasOwnProperty.call(prompts, definition.id)
    }))
  };
}

function normalizePromptValue(id, value) {
  if (!definitionById.has(id)) throw new Error(`未知提示词：${id}`);
  const text = String(value ?? '');
  if (text.length > 100000) throw new Error('单条提示词不能超过 100000 个字符');
  return text;
}

module.exports = {
  PROMPT_DEFINITIONS,
  definitionById,
  normalizePromptValue,
  publicPromptSettings,
  renderPromptTemplate
};
