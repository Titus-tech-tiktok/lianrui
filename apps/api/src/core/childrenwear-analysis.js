'use strict';

const crypto = require('node:crypto');

// Bump when role extraction changes materially so an old, less precise
// manifest cannot silently drive a newly strengthened generation contract.
const ANALYSIS_SCHEMA_VERSION = '1.1';

// Product truth and flat-reference geometry are the two analysis contracts
// consumed by the flat-lay stage. Keep the remaining roles on their existing
// schema so this focused upgrade does not invalidate model/scene/combination
// analysis caches.
const ROLE_ANALYSIS_SCHEMA_VERSIONS = Object.freeze({
  product: '2.0',
  flat_reference: '2.0',
  model_reference: ANALYSIS_SCHEMA_VERSION,
  scene_reference: ANALYSIS_SCHEMA_VERSION,
  combination_reference: ANALYSIS_SCHEMA_VERSION
});

const ROLE_ANALYSIS_PROMPT_VERSIONS = Object.freeze({
  product: 'flatlay-product-truth-v2',
  flat_reference: 'flatlay-target-geometry-v2',
  model_reference: 'model-reference-v1',
  scene_reference: 'scene-reference-v1',
  combination_reference: 'combination-reference-v1'
});

const ROLE_BY_LIBRARY_KEY = Object.freeze({
  childrenwearRealAssetsPath: 'product',
  childrenwearReferenceAssetsPath: 'flat_reference',
  childrenwearModelAssetsPath: 'model_reference',
  childrenwearSceneAssetsPath: 'scene_reference',
  childrenwearCombinationAssetsPath: 'combination_reference'
});

const ANALYSIS_ROLES = new Set(Object.values(ROLE_BY_LIBRARY_KEY));

function analysisSchemaVersionForRole(roleValue) {
  const role = normalizeAnalysisRole(roleValue);
  return ROLE_ANALYSIS_SCHEMA_VERSIONS[role];
}

function analysisPromptVersionForRole(roleValue) {
  const role = normalizeAnalysisRole(roleValue);
  return ROLE_ANALYSIS_PROMPT_VERSIONS[role];
}

function commonRules(role) {
  const schemaVersion = ROLE_ANALYSIS_SCHEMA_VERSIONS[role];
  return [
  'Return one JSON object only. Do not use markdown fences and do not add prose outside JSON.',
  'Describe only facts supported by visible pixels. Put unclear or hidden facts in uncertain_regions; never guess them.',
  'Silently identify why this image was selected for its assigned role. Product evidence must explain what is being sold and which visible details make it that product; reference evidence must explain which presentation action and physical behaviour should be learned.',
  'Use normalized 0..1 coordinates for positions and sizes when applicable.',
  'The catalogue is open-ended. Never force the image into a fixed list of sample garment categories.',
    `Set schema_version to "${schemaVersion}".`
  ];
}

const ROLE_PROMPTS = Object.freeze({
  product: [
    'CHILDRENSWEAR_PRODUCT_MANIFEST_ANALYSIS',
    'Analyze this real photographed SKU as the answer to “what exact product is being sold?”. The photo may be casual, rotated, folded or contain more than one coordinated component. Do not treat its pose or background as the desired ecommerce presentation.',
    ...commonRules('product'),
    'Required JSON shape:',
    '{"schema_version":"2.0","asset_role":"real_product","summary":"","product_truth":{"category":"","component_count":1,"base_color":{"name":"","hex_estimate":""},"print_description":"","print_scale":"","print_density":"","fabric":{"family":"","surface_texture":"","weave_or_knit":"","thickness":"","drape":"","stretch":"","sheen":"","opacity":"","wrinkle_character":""},"collar":"","sleeve_cuff":"","ankle_cuff":"","closure":"","seams":[],"construction":{"visible_side":"front|back|side|uncertain","pattern_cut":"","silhouette":"","proportions":"","panels":[],"openings":[],"pockets":[],"bindings":[],"trims":[]},"decorations":[{"type":"print|embroidery|applique|patch|label|other","description":"","colors":[],"visible_text":"","position":{"x":0.0,"y":0.0},"relative_size":0.0}],"must_preserve":[],"must_not_invent":[]},"uncertain_regions":[{"region":"","reason":"","instruction":"do not invent"}]}',
    'product_truth is the immutable merchandise contract. Inventory every component and record the true category and structure, colour, print content/scale/density/placement, material texture and thickness, collar, sleeve cuffs, ankle cuffs, closure, seams and unique craft. Do not describe the photographed table, room, camera angle or casual laying pose as product truth.',
    'All fields are category-neutral. If a garment does not have a requested part, return null or an empty array; never invent a collar, crotch, cuff, closure, pocket, seam, print or component.'
  ].join('\n'),
  flat_reference: [
    'CHILDRENSWEAR_FLAT_PRESENTATION_REFERENCE_ANALYSIS',
    'Analyze this finished ecommerce image as the answer to “why was this reference selected and what exactly should be learned from it?”. The garment shown is not the target SKU and none of its colour, material, print, label, pocket or construction may become product identity.',
    ...commonRules('flat_reference'),
    'Required JSON shape:',
    '{"schema_version":"2.0","asset_role":"flat_presentation_reference","summary":"","target_geometry":{"canvas_aspect_ratio":"","garment_bbox":{"x":0.0,"y":0.0,"width":0.0,"height":0.0},"garment_canvas_coverage":0.0,"center_position":{"x":0.0,"y":0.0},"torso_width_height_ratio":null,"shoulder_width":null,"sleeve_angles":[],"sleeve_length_ratio":null,"crotch_width":null,"crotch_depth":null,"leg_angles":[],"leg_length_ratio":null,"cuff_width_ratio":null,"symmetry":"","flatness":"","keypoints":{"neckline":null,"shoulders":[],"armpits":[],"sleeve_cuffs":[],"crotch":null,"legs":[],"ankle_cuffs":[]},"display_pose":"","component_placement":[],"detail_display_actions":[],"folds":[{"region":"","normalized_path_or_zone":"","direction":"","intensity":"","cause":"gravity|bend|compression|overlap|tension"}]},"background_profile":{"type":"","target_hex":"","target_rgb":{"r":0,"g":0,"b":0},"uniformity":null,"gradient":{"present":false,"direction":"","strength_delta_e":0},"vignette":{"present":false,"strength_delta_e":0},"shadow":{"direction":"","opacity":null,"softness":"","footprint":""},"color_tolerance_delta_e":3},"lighting":{"direction":"","contrast":"","softness":"","color_temperature":""},"reference_value":{"why_selected":"","action_to_transfer":"","fold_and_drape_logic":""},"protected_scene_elements":[],"forbidden_identity_transfer":["colour","material","print","text","labels","decoration","construction"],"uncertain_regions":[]}',
    'Measure the displayed geometry rather than describing a loose style: canvas ratio, normalized garment bounding box, occupied canvas area, center, body width/height, shoulder width, sleeve angles and length, crotch width/depth, leg angles and length, cuff ratios, symmetry, flatness and all visible keypoints. Use null for category-inapplicable or invisible values.',
    'Explain why the reference was selected, then extract the exact flat-lay action, component/detail placement, natural fold flow, background, lighting and shadow. The deterministic server may replace target_hex/target_rgb/uniformity/gradient/vignette with measurements taken from the original uploaded file; do not resist that correction.'
  ].join('\n'),
  model_reference: [
    'CHILDRENSWEAR_MODEL_REFERENCE_ANALYSIS',
    'Analyze this model ecommerce image as the answer to “why was this model reference selected and which action should the real product perform?”. The original garment is not product identity and must be replaceable.',
    ...commonRules('model_reference'),
    'Required JSON shape:',
    '{"schema_version":"1.1","asset_role":"model_reference","summary":"","reference_value":{"why_selected":"","action_to_transfer":"","fold_and_drape_logic":""},"canvas":{"aspect_ratio":"","crop":"","camera":""},"model":{"age_band":"","body_orientation":"","pose":"","weight_bearing":"","limbs":[],"hands":[],"feet":[]},"garment_display":{"target_regions":[],"occupancy":0.0,"on_body_outline":"","detail_display_actions":[],"fit":"","drape":"","folds":[{"region":"","normalized_path_or_zone":"","direction":"","intensity":"","cause":"gravity|bend|compression|overlap|tension"}],"visible_regions":[],"hidden_regions":[]},"occlusions":[{"occluder":"","target_region":"","layer_order":""}],"protected_regions":[],"editable_regions":[],"scene":{"background":{"description":"","colors":[{"hex_estimate":"","coverage":0.0}],"gradient":"","texture":""},"props":[]},"lighting":{"direction":"","contrast":"","softness":"","color_temperature":""},"shadow":{"footprint":"","direction":"","softness":"","opacity":""},"uncertain_regions":[]}',
    'Identify every protected person/scene region, the replaceable garment region, exact body pose and joint bends, on-body product outline, detail-display actions, garment occupancy, every major gravity/tension/compression fold zone, overlap and front/back layer order, background colour/gradient/texture, lighting and shadow footprint. These are exact presentation targets, not loose style hints.'
  ].join('\n'),
  scene_reference: [
    'CHILDRENSWEAR_SCENE_REFERENCE_ANALYSIS',
    'Analyze this image only as an optional ecommerce environment reference. It controls the background, environment, props, camera mood, lighting and ground/contact-shadow conditions. It never controls the product, model identity, model pose or garment folds.',
    ...commonRules('scene_reference'),
    'Required JSON shape:',
    '{"schema_version":"1.1","asset_role":"scene_reference","summary":"","reference_value":{"why_selected":"","environment_to_transfer":""},"canvas":{"aspect_ratio":"","crop":"","camera":""},"scene":{"environment_type":"","background":{"description":"","colors":[{"hex_estimate":"","coverage":0.0}],"gradient":"","texture":""},"ground":"","props":[{"description":"","position":{"x":0.0,"y":0.0},"layer":"background|foreground"}]} ,"lighting":{"direction":"","contrast":"","softness":"","color_temperature":""},"shadow":{"footprint":"","direction":"","softness":"","opacity":""},"protected_scene_elements":[],"uncertain_regions":[]}',
    'Explain why the scene is useful, then extract only reproducible environment facts: canvas/crop, background, ground, props and their layer order, lighting, colour temperature and shadow conditions. Do not infer or prescribe a person, pose, clothing identity, garment placement or garment folds.'
  ].join('\n'),
  combination_reference: [
    'CHILDRENSWEAR_COMBINATION_REFERENCE_ANALYSIS',
    'Analyze this ecommerce composition as the answer to “why was this multi-SKU reference selected and which action should each supplied SKU perform?”. Products shown in it are placeholders and must not contribute garment identity.',
    ...commonRules('combination_reference'),
    'Required JSON shape:',
    '{"schema_version":"1.1","asset_role":"combination_reference","summary":"","reference_value":{"why_selected":"","overall_action_to_transfer":"","fold_and_drape_logic":""},"canvas":{"aspect_ratio":"","crop":"","background":{"type":"","colors":[{"hex_estimate":"","coverage":0.0}],"gradient":"","texture":""}},"slot_count":2,"slots":[{"slot_id":"slot_1","center":{"x":0.0,"y":0.0},"size":{"width":0.0,"height":0.0},"rotation_degrees":0,"z_index":1,"display_pose":"","visual_outline":"","component_actions":[],"detail_display_actions":[],"folds":[{"region":"","normalized_path_or_zone":"","direction":"","intensity":"","cause":"gravity|bend|compression|overlap|tension"}],"drape":"","crop":""}],"overlaps":[{"front_slot":"","back_slot":"","region":"","amount":""}],"spacing":"","lighting":{"direction":"","softness":"","contrast":""},"shadow":{"contact_shadow":true,"overlap_shadow":true,"footprints":[],"description":""},"protected_scene_elements":[],"mapping_rule":"one supplied SKU per slot; never merge identities","uncertain_regions":[]}',
    'Extract exact slot count, normalized geometry, scale, rotation, z-order, overlap, spacing, canvas crop, background colour/gradient/texture, lighting and shadow footprints. For every slot, explicitly describe the displayed outer outline and product action: body orientation, component/detail placement, sleeve/leg direction, bends, spreading/folding, asymmetric placement, drape, every major fold direction, wrinkle zone and physical cause. These are exact presentation targets. Do not describe placeholder garment design as a required output feature.'
  ].join('\n')
});

function analysisRoleForLibraryKey(value) {
  return ROLE_BY_LIBRARY_KEY[String(value || '')] || '';
}

function normalizeAnalysisRole(value) {
  const role = String(value || '').trim();
  if (!ANALYSIS_ROLES.has(role)) throw new Error('不支持的童装素材分析类型');
  return role;
}

function buildChildrenwearAssetAnalysisPrompt(roleValue) {
  const role = normalizeAnalysisRole(roleValue);
  return ROLE_PROMPTS[role];
}

function buildChildrenwearAnalysisCacheIdentity({ contentHash, role: roleValue, analysisPrompt, model } = {}) {
  const role = normalizeAnalysisRole(roleValue);
  const promptVersion = analysisPromptVersionForRole(role);
  const structureVersion = analysisSchemaVersionForRole(role);
  const promptHash = crypto.createHash('sha256').update(String(analysisPrompt || '')).digest('hex');
  const normalizedModel = String(model || '').trim();
  const identityHash = crypto.createHash('sha256').update(JSON.stringify({
    contentHash: String(contentHash || ''),
    role,
    promptVersion,
    structureVersion,
    promptHash,
    model: normalizedModel
  })).digest('hex');
  return { identityHash, promptVersion, structureVersion, promptHash, model: normalizedModel };
}

function extractJsonObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  const text = String(value || '').trim();
  if (!text) throw new Error('AI 未返回分析结果');
  try { return JSON.parse(text); } catch {}
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  if (fenced) {
    try { return JSON.parse(fenced.trim()); } catch {}
  }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(text.slice(start, end + 1)); } catch {}
  }
  throw new Error('AI 返回的分析结果不是有效 JSON');
}

function jsonClone(value) {
  const text = JSON.stringify(value);
  if (!text || text.length > 200_000) throw new Error('AI 返回的分析结果过大');
  return JSON.parse(text);
}

function normalizeChildrenwearAssetAnalysis(roleValue, value) {
  const role = normalizeAnalysisRole(roleValue);
  const parsed = jsonClone(extractJsonObject(value));
  const schemaVersion = analysisSchemaVersionForRole(role);
  const expectedAssetRole = {
    product: 'real_product',
    flat_reference: 'flat_presentation_reference',
    model_reference: 'model_reference',
    scene_reference: 'scene_reference',
    combination_reference: 'combination_reference'
  }[role];
  parsed.schema_version = schemaVersion;
  parsed.asset_role = expectedAssetRole;
  parsed.summary = String(parsed.summary || '').trim().slice(0, 1000);
  parsed.uncertain_regions = Array.isArray(parsed.uncertain_regions) ? parsed.uncertain_regions.slice(0, 100) : [];
  if (role === 'product') {
    const truth = parsed.product_truth && typeof parsed.product_truth === 'object' ? parsed.product_truth : {};
    truth.category = String(truth.category || parsed.category_guess || '').trim().slice(0, 300);
    truth.base_color = truth.base_color && typeof truth.base_color === 'object' ? truth.base_color : null;
    truth.print_description = String(truth.print_description || '').trim().slice(0, 2000);
    truth.print_scale = truth.print_scale ?? null;
    truth.print_density = truth.print_density ?? null;
    truth.fabric = truth.fabric && typeof truth.fabric === 'object' ? truth.fabric : {};
    truth.collar = truth.collar ?? null;
    truth.sleeve_cuff = truth.sleeve_cuff ?? null;
    truth.ankle_cuff = truth.ankle_cuff ?? null;
    truth.closure = truth.closure ?? null;
    truth.seams = Array.isArray(truth.seams) ? truth.seams.slice(0, 100) : [];
    truth.must_preserve = Array.isArray(truth.must_preserve) ? truth.must_preserve.slice(0, 200) : [];
    truth.must_not_invent = Array.isArray(truth.must_not_invent) ? truth.must_not_invent.slice(0, 200) : [];
    const declared = Number(truth.component_count ?? parsed.piece_count);
    parsed.piece_count = Number.isInteger(declared) && declared >= 1 && declared <= 16
      ? declared
      : 1;
    truth.component_count = parsed.piece_count;
    parsed.product_truth = truth;
    // Compatibility fields remain available to approved-master/model/combination
    // consumers while the flat-lay stage reads product_truth directly.
    parsed.category_guess = String(parsed.category_guess || truth.category || '').trim().slice(0, 300);
    parsed.must_preserve = truth.must_preserve;
    parsed.must_not_invent = truth.must_not_invent;
    parsed.pieces = Array.isArray(parsed.pieces) ? parsed.pieces.slice(0, 16) : [];
  }
  if (role === 'flat_reference') {
    const geometry = parsed.target_geometry && typeof parsed.target_geometry === 'object' ? parsed.target_geometry : {};
    geometry.garment_bbox = geometry.garment_bbox && typeof geometry.garment_bbox === 'object' ? geometry.garment_bbox : null;
    geometry.center_position = geometry.center_position && typeof geometry.center_position === 'object' ? geometry.center_position : null;
    geometry.sleeve_angles = Array.isArray(geometry.sleeve_angles) ? geometry.sleeve_angles.slice(0, 16) : [];
    geometry.leg_angles = Array.isArray(geometry.leg_angles) ? geometry.leg_angles.slice(0, 16) : [];
    geometry.keypoints = geometry.keypoints && typeof geometry.keypoints === 'object' ? geometry.keypoints : {};
    geometry.component_placement = Array.isArray(geometry.component_placement) ? geometry.component_placement.slice(0, 50) : [];
    geometry.detail_display_actions = Array.isArray(geometry.detail_display_actions) ? geometry.detail_display_actions.slice(0, 100) : [];
    geometry.folds = Array.isArray(geometry.folds) ? geometry.folds.slice(0, 100) : [];
    parsed.target_geometry = geometry;
    const background = parsed.background_profile && typeof parsed.background_profile === 'object' ? parsed.background_profile : {};
    background.target_hex = String(background.target_hex || '').trim().slice(0, 20);
    background.target_rgb = background.target_rgb && typeof background.target_rgb === 'object' ? background.target_rgb : null;
    background.color_tolerance_delta_e = 3;
    background.shadow = background.shadow && typeof background.shadow === 'object' ? background.shadow : {};
    parsed.background_profile = background;
  }
  if (role === 'combination_reference') {
    parsed.slots = Array.isArray(parsed.slots) ? parsed.slots.slice(0, 12) : [];
    const declared = Number(parsed.slot_count);
    parsed.slot_count = Number.isInteger(declared) && declared >= 1 && declared <= 12
      ? declared
      : Math.max(1, parsed.slots.length || 1);
  }
  return parsed;
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function nonEmptyText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function aspectRatioNumber(value) {
  if (typeof value === 'string' && value.includes(':')) {
    const [width, height] = value.split(':', 2).map(Number);
    return Number.isFinite(width) && Number.isFinite(height) && height > 0 ? width / height : null;
  }
  return finiteNumber(value);
}

function validateNormalizedPoint(value, label, errors) {
  if (value == null) return;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    errors.push(`${label} 必须是坐标对象或 null`);
    return;
  }
  const x = finiteNumber(value.x);
  const y = finiteNumber(value.y);
  if (x == null || y == null || x < 0 || x > 1 || y < 0 || y > 1) {
    errors.push(`${label} 坐标必须位于 0..1`);
  }
}

function validateOptionalRatio(value, label, errors, max = 10) {
  if (value == null || value === '') return;
  const number = finiteNumber(value);
  if (number == null || number < 0 || number > max) errors.push(`${label} 数值超出允许范围`);
}

function validateChildrenwearAssetAnalysis(roleValue, analysis) {
  const role = normalizeAnalysisRole(roleValue);
  const errors = [];
  if (!analysis || typeof analysis !== 'object' || Array.isArray(analysis)) {
    throw new Error('AI 分析结果无效：缺少结构化对象');
  }
  if (analysis.schema_version !== analysisSchemaVersionForRole(role)) errors.push('分析结构版本不匹配');
  if (role === 'product') {
    const truth = analysis.product_truth;
    if (!truth || typeof truth !== 'object' || Array.isArray(truth)) errors.push('缺少 product_truth');
    else {
      if (!nonEmptyText(truth.category)) errors.push('product_truth.category 不能为空');
      const baseColor = truth.base_color;
      if (!baseColor || typeof baseColor !== 'object' || (!nonEmptyText(baseColor.name) && !nonEmptyText(baseColor.hex_estimate))) {
        errors.push('product_truth.base_color 缺少可见颜色证据');
      }
      const fabric = truth.fabric;
      if (!fabric || typeof fabric !== 'object' || !Object.values(fabric).some(nonEmptyText)) {
        errors.push('product_truth.fabric 缺少面料证据');
      }
      const componentCount = finiteNumber(truth.component_count);
      if (!Number.isInteger(componentCount) || componentCount < 1 || componentCount > 16) errors.push('product_truth.component_count 必须为 1..16 的整数');
      if (!Array.isArray(truth.must_preserve) || !truth.must_preserve.some(nonEmptyText)) errors.push('product_truth.must_preserve 不能为空');
      if (!Array.isArray(truth.must_not_invent) || !truth.must_not_invent.some(nonEmptyText)) errors.push('product_truth.must_not_invent 不能为空');
    }
  }
  if (role === 'flat_reference') {
    const geometry = analysis.target_geometry;
    if (!geometry || typeof geometry !== 'object' || Array.isArray(geometry)) errors.push('缺少 target_geometry');
    else {
      const ratio = aspectRatioNumber(geometry.canvas_aspect_ratio);
      if (ratio == null || ratio < 0.2 || ratio > 5) errors.push('target_geometry.canvas_aspect_ratio 无效');
      const bbox = geometry.garment_bbox;
      if (!bbox || typeof bbox !== 'object') errors.push('target_geometry.garment_bbox 不能为空');
      else {
        const values = ['x', 'y', 'width', 'height'].map(key => finiteNumber(bbox[key]));
        if (values.some(value => value == null) || values[0] < 0 || values[1] < 0 || values[2] <= 0 || values[3] <= 0 || values[2] > 1 || values[3] > 1 || values[0] + values[2] > 1.02 || values[1] + values[3] > 1.02) {
          errors.push('target_geometry.garment_bbox 必须是画布内有效的 0..1 包围框');
        }
      }
      const coverage = finiteNumber(geometry.garment_canvas_coverage);
      if (coverage == null || coverage <= 0 || coverage > 1) errors.push('target_geometry.garment_canvas_coverage 必须位于 0..1');
      const center = geometry.center_position;
      if (!center || typeof center !== 'object') errors.push('target_geometry.center_position 不能为空');
      else validateNormalizedPoint(center, 'target_geometry.center_position', errors);
      if (!nonEmptyText(geometry.symmetry)) errors.push('target_geometry.symmetry 不能为空');
      if (!nonEmptyText(geometry.flatness)) errors.push('target_geometry.flatness 不能为空');
      for (const [key, max] of [['torso_width_height_ratio', 10], ['shoulder_width', 1], ['sleeve_length_ratio', 10], ['crotch_width', 1], ['crotch_depth', 1], ['leg_length_ratio', 10], ['cuff_width_ratio', 10]]) {
        validateOptionalRatio(geometry[key], `target_geometry.${key}`, errors, max);
      }
      for (const key of ['sleeve_angles', 'leg_angles']) {
        if (!Array.isArray(geometry[key])) errors.push(`target_geometry.${key} 必须是数组`);
        else if (geometry[key].some(value => finiteNumber(value) == null || Number(value) < -180 || Number(value) > 180)) errors.push(`target_geometry.${key} 角度必须位于 -180..180`);
      }
      const keypoints = geometry.keypoints;
      if (!keypoints || typeof keypoints !== 'object' || Array.isArray(keypoints)) errors.push('target_geometry.keypoints 不能为空');
      else {
        for (const key of ['neckline', 'crotch']) validateNormalizedPoint(keypoints[key], `target_geometry.keypoints.${key}`, errors);
        for (const key of ['shoulders', 'armpits', 'sleeve_cuffs', 'legs', 'ankle_cuffs']) {
          if (keypoints[key] != null && !Array.isArray(keypoints[key])) errors.push(`target_geometry.keypoints.${key} 必须是数组`);
          for (const [index, point] of (Array.isArray(keypoints[key]) ? keypoints[key] : []).entries()) {
            validateNormalizedPoint(point, `target_geometry.keypoints.${key}[${index}]`, errors);
          }
        }
      }
    }
    const background = analysis.background_profile;
    const rgb = background?.target_rgb;
    if (!background || typeof background !== 'object' || !/^#[0-9a-f]{6}$/i.test(String(background.target_hex || ''))) errors.push('background_profile.target_hex 无效');
    if (!rgb || ['r', 'g', 'b'].some(key => finiteNumber(rgb[key]) == null || Number(rgb[key]) < 0 || Number(rgb[key]) > 255)) errors.push('background_profile.target_rgb 无效');
  }
  if (errors.length) throw new Error(`AI 分析结果无效：${errors.join('；')}`);
  return analysis;
}

function compactAnalysisJson(value) {
  return JSON.stringify(value || {}, null, 2);
}

module.exports = {
  ANALYSIS_ROLES,
  ANALYSIS_SCHEMA_VERSION,
  ROLE_ANALYSIS_PROMPT_VERSIONS,
  ROLE_ANALYSIS_SCHEMA_VERSIONS,
  ROLE_BY_LIBRARY_KEY,
  analysisPromptVersionForRole,
  analysisRoleForLibraryKey,
  analysisSchemaVersionForRole,
  buildChildrenwearAnalysisCacheIdentity,
  buildChildrenwearAssetAnalysisPrompt,
  compactAnalysisJson,
  extractJsonObject,
  normalizeAnalysisRole,
  normalizeChildrenwearAssetAnalysis,
  validateChildrenwearAssetAnalysis
};
