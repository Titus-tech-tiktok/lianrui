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
    description: '分析实拍图中的真实品类、组件数量、版型、颜色、材质纹理、工艺、图案位置、缝线和不确定区域。只有分析成功的素材才会进入 02 选材区。',
    placeholders: [],
    defaultValue: buildChildrenwearAssetAnalysisPrompt('product')
  },
  {
    id: 'childrenwearFlatReferenceAnalysis',
    title: '成品参考图 AI 分析',
    group: '多嘻噜卡 AI 分析',
    description: '只提取平铺姿态、构图、背景、光影、褶皱和商品占比，不把参考图中的款式、颜色或图案当成目标商品身份。',
    placeholders: [],
    defaultValue: buildChildrenwearAssetAnalysisPrompt('flat_reference')
  },
  {
    id: 'childrenwearModelReferenceAnalysis',
    title: '参考模特图 AI 分析',
    group: '多嘻噜卡 AI 分析',
    description: '分析人物、姿势、裁切、场景、光影、服装形变和遮挡层级，明确人物保护区与需要替换的服装区域。',
    placeholders: [],
    defaultValue: buildChildrenwearAssetAnalysisPrompt('model_reference')
  },
  {
    id: 'childrenwearCombinationReferenceAnalysis',
    title: '组合参考图 AI 分析',
    group: '多嘻噜卡 AI 分析',
    description: '分析多 SKU 的槽位数量、位置、尺寸、旋转、前后层级、重叠、背景和阴影，不继承参考商品本身的设计。',
    placeholders: [],
    defaultValue: buildChildrenwearAssetAnalysisPrompt('combination_reference')
  },
  {
    id: 'childrenwearMasterGeneration',
    title: '平铺母版图生成',
    group: '多嘻噜卡生图',
    description: '本板块统一使用这一套开放品类主提示词。实拍图决定商品身份，成品参考图决定展示效果；实际图片编号、已知资料和自动识别件数规则会在每次任务中动态追加。',
    placeholders: [],
    defaultValue: buildChildrenwearMasterPrompt({})
  },
  {
    id: 'childrenwearModelGeneration',
    title: '模特上身图生成',
    group: '多嘻噜卡生图',
    description: '本板块统一使用这一套开放品类主提示词。已审核母版决定商品身份，模特参考图决定人物、姿势与场景；任务事实会动态追加。',
    placeholders: [],
    defaultValue: buildChildrenwearModelPrompt({})
  },
  {
    id: 'childrenwearCombinationGeneration',
    title: '多 SKU 组合图生成',
    group: '多嘻噜卡生图',
    description: '本板块统一使用这一套开放品类主提示词。每张已审核母版分别锁定一个 SKU，组合参考图只控制布局；母版数量、每款件数和参考图索引会按任务动态追加。',
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
