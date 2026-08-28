'use strict';

const {
  buildChildrenwearCombinationPrompt,
  buildChildrenwearMasterPrompt,
  buildChildrenwearModelPrompt
} = require('./childrenwear');
const { buildChildrenwearAssetAnalysisPrompt } = require('./childrenwear-analysis');

const PROMPT_DEFINITIONS = Object.freeze([
  {
    id: 'childrenwearProductAnalysis',
    title: '实拍产品图 AI 分析',
    group: '多嘻噜卡 AI 分析',
    description: '回答“这张图到底要卖什么”：分析真实品类、组件数量、版型、颜色、材质特征、工艺、图案位置、缝线和可见卖点。只有分析成功的素材才会进入 02 选材区。',
    placeholders: [],
    defaultValue: buildChildrenwearAssetAnalysisPrompt('product')
  },
  {
    id: 'childrenwearFlatReferenceAnalysis',
    title: '成品参考图 AI 分析',
    group: '多嘻噜卡 AI 分析',
    description: '回答“为什么选择这张参考图来学”：提取平铺动作、摆放/弯折方式、自然褶皱与受力、构图、背景、光影和商品占比，不继承参考商品身份。',
    placeholders: [],
    defaultValue: buildChildrenwearAssetAnalysisPrompt('flat_reference')
  },
  {
    id: 'childrenwearModelReferenceAnalysis',
    title: '参考模特图 AI 分析',
    group: '多嘻噜卡 AI 分析',
    description: '回答“为什么选择这张模特图来学”：分析人物动作、姿势、裁切、场景、光影、服装受力形变、自然褶皱和遮挡层级。',
    placeholders: [],
    defaultValue: buildChildrenwearAssetAnalysisPrompt('model_reference')
  },
  {
    id: 'childrenwearSceneReferenceAnalysis',
    title: '场景参考图 AI 分析',
    group: '多嘻噜卡 AI 分析',
    description: '只分析可选的背景环境、道具、镜头氛围、灯光与接地阴影；不决定人物、动作、服装身份或服装褶皱。',
    placeholders: [],
    defaultValue: buildChildrenwearAssetAnalysisPrompt('scene_reference')
  },
  {
    id: 'childrenwearCombinationReferenceAnalysis',
    title: '组合参考图 AI 分析',
    group: '多嘻噜卡 AI 分析',
    description: '回答“为什么选择这张组合图来学”：逐槽分析每件衣服的摆放动作、袖腿方向、弯折、自然褶皱、间距、层级、背景和阴影，不继承参考商品设计。',
    placeholders: [],
    defaultValue: buildChildrenwearAssetAnalysisPrompt('combination_reference')
  },
  {
    id: 'childrenwearMasterGeneration',
    title: '平铺母版图生成',
    group: '多嘻噜卡生图',
    description: '双源硬锁：实拍图100%锁定商品款式、裁片结构、面料、颜色、材质、图案和细节；成品参考图100%锁定摆姿形成的外轮廓、背景、褶皱位置、阴影、构图和细节摆放动作。两者禁止混用。',
    placeholders: [],
    defaultValue: buildChildrenwearMasterPrompt({})
  },
  {
    id: 'childrenwearModelGeneration',
    title: '模特上身图生成',
    group: '多嘻噜卡生图',
    description: '结构化三源锁定：选中的已生成平铺图锁定商品，不要求先审核通过；模特参考图锁定人物与动作类型、上身轮廓、褶皱逻辑和细节展示意图，并在每次生成时小幅随机变化表情、视线、头部角度、肩线、手势或站姿；人物始终居中。背景可选择跟随模特参考、纯白或独立场景参考图；非纯白背景锁定颜色、光线、景深、虚化和机位，只允许凳子、摆件等次要场景元素小幅增减或移动。',
    placeholders: [],
    defaultValue: buildChildrenwearModelPrompt({})
  },
  {
    id: 'childrenwearCombinationGeneration',
    title: '多 SKU 组合图生成',
    group: '多嘻噜卡生图',
    description: '双源硬锁：每张选中的已生成平铺图分别锁定一个SKU的真实款式、面料、颜色、材质、图案和结构，不要求先审核通过；组合参考图锁定背景、槽位外轮廓、摆放动作、褶皱、阴影、间距和层级。',
    placeholders: [],
    defaultValue: buildChildrenwearCombinationPrompt({ count: 4 })
  }
]);

const definitionById = new Map(PROMPT_DEFINITIONS.map(item => [item.id, item]));

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
  publicPromptSettings
};
