'use strict';

const { buildChildrenwearAssetAnalysisPrompt } = require('./childrenwear-analysis');

const PROMPT_IMAGE_ROLES = Object.freeze([
  { id: 'real_product', label: '实拍产品图', group: '来源素材', note: '商品真实款式、颜色、图案与材质来源' },
  { id: 'flat_reference', label: '成品参考图', group: '来源素材', note: '平铺构图、版型姿态、背景与光影参考' },
  { id: 'real_details', label: '实拍局部细节图', group: '来源素材', note: '按现有顺序连续追加全部细节图', multiple: true },
  { id: 'model_reference', label: '参考模特图', group: '来源素材', note: '人物、姿势、镜头与服装上身参考' },
  { id: 'fixed_model_reference', label: '固定模特图', group: '来源素材', note: '账号已启用的固定模特参考' },
  { id: 'scene_reference', label: '场景参考图', group: '来源素材', note: '独立场景、道具、光线与景深参考' },
  { id: 'combination_reference', label: '组合参考图', group: '来源素材', note: '多 SKU 数量、位置、层级与摆放参考' },
  { id: 'approved_flat', label: '已生成平铺图', group: '生成结果', note: '当前款式最新平铺结果' },
  { id: 'selected_flat_lays', label: '所选平铺图', group: '生成结果', note: '按运营选择顺序连续追加全部平铺图', multiple: true },
  { id: 'generated_model', label: '已生成模特图', group: '生成结果', note: '当前款式最新模特上身结果' },
  { id: 'generated_combination', label: '已生成多 SKU 组合图', group: '生成结果', note: '当前任务最新组合结果' },
  { id: 'current_result', label: '当前生成结果图', group: '生成结果', note: '本次重新生成所基于的当前结果' },
  { id: 'result_history', label: '历史生成版本图', group: '生成结果', note: '按时间连续追加可用历史版本', multiple: true }
]);

const GENERATION_STAGES = Object.freeze([
  { id: 'master', legacyPromptId: 'childrenwearMasterGeneration', label: '02 生成平铺图', defaultTitle: '平铺母版图生成', defaultImageOrder: ['real_product', 'flat_reference'] },
  { id: 'model', legacyPromptId: 'childrenwearModelGeneration', label: '03 生成模特图', defaultTitle: '模特上身图生成', defaultImageOrder: ['approved_flat', 'model_reference'] },
  { id: 'combination', legacyPromptId: 'childrenwearCombinationGeneration', label: '04 组合多 SKU 图', defaultTitle: '多 SKU 组合图生成', defaultImageOrder: ['selected_flat_lays', 'combination_reference'] }
]);

const MODEL_PROMPT_ROUTES = Object.freeze([
  { id: 'dress_follow', label: '上身生成 · 跟随模特背景' },
  { id: 'dress_follow_fixed', label: '固定模特 · 跟随模特背景' },
  { id: 'dress_solid', label: '上身生成 · 指定纯色' },
  { id: 'dress_solid_fixed', label: '固定模特 · 指定纯色' },
  { id: 'dress_scene', label: '上身生成 · 独立场景图' },
  { id: 'dress_scene_fixed', label: '固定模特 · 独立场景图' },
  { id: 'scene_only_solid', label: '只换场景 · 指定纯色' },
  { id: 'scene_only_scene', label: '只换场景 · 独立场景图' }
]);

const generationStageById = new Map(GENERATION_STAGES.map(item => [item.id, item]));
const generationStageByLegacyPromptId = new Map(GENERATION_STAGES.map(item => [item.legacyPromptId, item]));

const PROMPT_DEFINITIONS = Object.freeze([
  { id: 'childrenwearProductAnalysis', internal: true, title: '实拍产品图 AI 分析', group: '多嘻噜卡 AI 分析', description: '分析商品真实信息。', placeholders: [], defaultValue: buildChildrenwearAssetAnalysisPrompt('product') },
  { id: 'childrenwearFlatReferenceAnalysis', internal: true, title: '成品参考图 AI 分析', group: '多嘻噜卡 AI 分析', description: '分析平铺参考信息。', placeholders: [], defaultValue: buildChildrenwearAssetAnalysisPrompt('flat_reference') },
  { id: 'childrenwearModelReferenceAnalysis', internal: true, title: '参考模特图 AI 分析', group: '多嘻噜卡 AI 分析', description: '分析模特参考信息。', placeholders: [], defaultValue: buildChildrenwearAssetAnalysisPrompt('model_reference') },
  { id: 'childrenwearSceneReferenceAnalysis', internal: true, title: '场景参考图 AI 分析', group: '多嘻噜卡 AI 分析', description: '分析场景参考信息。', placeholders: [], defaultValue: buildChildrenwearAssetAnalysisPrompt('scene_reference') },
  { id: 'childrenwearCombinationReferenceAnalysis', internal: true, title: '组合参考图 AI 分析', group: '多嘻噜卡 AI 分析', description: '分析组合参考信息。', placeholders: [], defaultValue: buildChildrenwearAssetAnalysisPrompt('combination_reference') },
  ...GENERATION_STAGES.map(stage => ({
    id: stage.legacyPromptId,
    legacyGenerationDefinition: true,
    title: stage.defaultTitle,
    group: '我的提示词',
    stageId: stage.id,
    description: `用于${stage.label}的旧版提示词数据兼容。`,
    imageRoles: PROMPT_IMAGE_ROLES,
    placeholders: [],
    defaultValue: ''
  }))
]);

const definitionById = new Map(PROMPT_DEFINITIONS.map(item => [item.id, item]));

function generationStage(value) {
  return generationStageById.get(String(value || '')) || generationStageByLegacyPromptId.get(String(value || '')) || null;
}

function normalizeGenerationStageId(value) {
  return generationStage(value)?.id || '';
}

function defaultPromptImageOrder(id) {
  return [...(generationStage(id)?.defaultImageOrder || [])];
}

function normalizePromptImageOrder(id, value, options = {}) {
  const definition = definitionById.get(String(id || ''));
  if (definition?.internal) return [];
  const allowed = PROMPT_IMAGE_ROLES.map(item => item.id);
  const source = Array.isArray(value) ? value.map(String) : [];
  const valid = source.filter((role, index) => allowed.includes(role) && source.indexOf(role) === index);
  if (options.strict === true && valid.length !== source.length) throw new Error('图片顺序包含重复或无效的图片关联');
  return valid;
}

function normalizePromptGroupId(value) {
  const id = String(value || '').trim().slice(0, 100);
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new Error('提示词分类编号无效');
  return id;
}

function normalizePromptGroupTitle(value, fallback = '未命名分类') {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 80) || fallback;
}

function normalizePromptValue(id, value) {
  const promptId = String(id || '');
  if (definitionById.get(promptId)?.internal !== true) normalizePromptGroupId(promptId);
  else if (!definitionById.has(promptId)) throw new Error(`未知提示词：${id}`);
  const text = String(value ?? '');
  if (text.length > 100000) throw new Error('单条提示词不能超过 100000 个字符');
  return text;
}

function normalizedPresetItems(groupId, rawGroup = {}, legacyStage = null) {
  const items = (Array.isArray(rawGroup.items) ? rawGroup.items : []).map((item, index) => ({
    id: String(item?.id || `legacy-${index + 1}`).slice(0, 100),
    name: String(item?.name || `预设 ${index + 1}`).slice(0, 80),
    value: String(item?.value ?? ''),
    imageOrder: Object.prototype.hasOwnProperty.call(item || {}, 'imageOrder')
      ? normalizePromptImageOrder(groupId, item.imageOrder)
      : [...(legacyStage?.defaultImageOrder || [])],
    createdAt: String(item?.createdAt || ''),
    updatedAt: String(item?.updatedAt || '')
  })).filter(item => item.id);
  const activePresetId = items.some(item => item.id === String(rawGroup.activePresetId || ''))
    ? String(rawGroup.activePresetId)
    : (items[0]?.id || '');
  return { items, activePresetId };
}

function normalizedPromptGroups(saved = {}) {
  const rawGroups = saved?.promptGroups && typeof saved.promptGroups === 'object' ? saved.promptGroups : {};
  const groups = [];
  for (const [key, rawValue] of Object.entries(rawGroups)) {
    const raw = rawValue && typeof rawValue === 'object' ? rawValue : {};
    let id;
    try { id = normalizePromptGroupId(raw.id || key); } catch { continue; }
    const stageId = normalizeGenerationStageId(raw.stageId);
    if (!stageId) continue;
    const presets = normalizedPresetItems(id, raw);
    groups.push({ id, title: normalizePromptGroupTitle(raw.title), stageId, description: String(raw.description || '').slice(0, 500), activePresetId: presets.activePresetId, items: presets.items, createdAt: String(raw.createdAt || ''), updatedAt: String(raw.updatedAt || '') });
  }

  const legacyPrompts = saved?.prompts && typeof saved.prompts === 'object' ? saved.prompts : {};
  const legacyPresets = saved?.promptPresets && typeof saved.promptPresets === 'object' ? saved.promptPresets : {};
  for (const stage of GENERATION_STAGES) {
    if (groups.some(group => group.id === stage.legacyPromptId)) continue;
    const hasLegacyValue = Object.prototype.hasOwnProperty.call(legacyPrompts, stage.legacyPromptId);
    const hasLegacyPresets = Object.prototype.hasOwnProperty.call(legacyPresets, stage.legacyPromptId);
    if (!hasLegacyValue && !hasLegacyPresets) continue;
    const rawGroup = legacyPresets[stage.legacyPromptId] && typeof legacyPresets[stage.legacyPromptId] === 'object' ? legacyPresets[stage.legacyPromptId] : {};
    const presets = normalizedPresetItems(stage.legacyPromptId, rawGroup, stage);
    if (!presets.items.length && hasLegacyValue) {
      presets.items.push({ id: 'legacy-default', name: '默认预设', value: String(legacyPrompts[stage.legacyPromptId] ?? ''), imageOrder: [...stage.defaultImageOrder], createdAt: String(saved?.updatedAt || ''), updatedAt: String(saved?.updatedAt || '') });
      presets.activePresetId = 'legacy-default';
    }
    groups.push({ id: stage.legacyPromptId, title: stage.defaultTitle, stageId: stage.id, description: `从旧版${stage.label}设置迁移，可自由改名、删除或新增其他分类。`, activePresetId: presets.activePresetId, items: presets.items, createdAt: String(saved?.updatedAt || ''), updatedAt: String(saved?.updatedAt || '') });
  }
  return groups;
}

function normalizedStageBindings(saved = {}, groups = normalizedPromptGroups(saved)) {
  const raw = saved?.stagePromptGroupIds && typeof saved.stagePromptGroupIds === 'object' ? saved.stagePromptGroupIds : {};
  return Object.fromEntries(GENERATION_STAGES.map(stage => {
    const requested = String(raw[stage.id] || '');
    const valid = groups.find(group => group.id === requested && group.stageId === stage.id)
      || groups.find(group => group.id === stage.legacyPromptId && group.stageId === stage.id)
      || groups.find(group => group.stageId === stage.id)
      || null;
    return [stage.id, valid?.id || ''];
  }));
}

function normalizedPromptRouteBindings(saved = {}, groups = normalizedPromptGroups(saved), stageBindings = normalizedStageBindings(saved, groups)) {
  const raw = saved?.promptRouteGroupIds && typeof saved.promptRouteGroupIds === 'object' ? saved.promptRouteGroupIds : {};
  const fallback = groups.find(group => group.id === stageBindings.model && group.stageId === 'model') || null;
  return Object.fromEntries(MODEL_PROMPT_ROUTES.map(route => {
    const requested = String(raw[route.id] || '');
    const valid = groups.find(group => group.id === requested && group.stageId === 'model') || fallback;
    return [route.id, valid?.id || ''];
  }));
}

function publicPromptSettings(saved = {}) {
  const groups = normalizedPromptGroups(saved);
  const stageBindings = normalizedStageBindings(saved, groups);
  const routeBindings = normalizedPromptRouteBindings(saved, groups, stageBindings);
  return {
    schemaVersion: 3,
    updatedAt: String(saved?.updatedAt || ''),
    stages: GENERATION_STAGES.map(stage => ({ ...stage, activeGroupId: stageBindings[stage.id] || '' })),
    stageBindings,
    promptRoutes: MODEL_PROMPT_ROUTES,
    routeBindings,
    prompts: groups.map(group => {
      const activePreset = group.items.find(item => item.id === group.activePresetId) || null;
      const stage = generationStageById.get(group.stageId);
      return {
        id: group.id,
        title: group.title,
        group: stage?.label || '我的提示词',
        stageId: group.stageId,
        stageLabel: stage?.label || '',
        description: group.description || `本组用于${stage?.label || '生图'}；每条预设独立保存提示词，图片编号固定按任务卡片从左到右。`,
        imageRoles: PROMPT_IMAGE_ROLES,
        placeholders: [],
        value: activePreset?.value || '',
        presets: group.items,
        activePresetId: group.activePresetId,
        activePresetName: activePreset?.name || '',
        activeForStage: stageBindings[group.stageId] === group.id,
        activeForRoutes: group.stageId === 'model' ? MODEL_PROMPT_ROUTES.filter(route => routeBindings[route.id] === group.id).map(route => route.id) : [],
        customized: group.items.length > 0,
        createdAt: group.createdAt,
        updatedAt: group.updatedAt
      };
    })
  };
}

module.exports = {
  GENERATION_STAGES,
  MODEL_PROMPT_ROUTES,
  PROMPT_IMAGE_ROLES,
  PROMPT_DEFINITIONS,
  defaultPromptImageOrder,
  definitionById,
  generationStage,
  normalizeGenerationStageId,
  normalizePromptGroupId,
  normalizePromptGroupTitle,
  normalizePromptImageOrder,
  normalizePromptValue,
  normalizedPromptGroups,
  normalizedPromptRouteBindings,
  normalizedStageBindings,
  publicPromptSettings
};
