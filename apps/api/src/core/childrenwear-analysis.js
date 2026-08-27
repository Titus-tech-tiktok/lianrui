'use strict';

const ANALYSIS_SCHEMA_VERSION = '1.0';

const ROLE_BY_LIBRARY_KEY = Object.freeze({
  childrenwearRealAssetsPath: 'product',
  childrenwearReferenceAssetsPath: 'flat_reference',
  childrenwearModelAssetsPath: 'model_reference',
  childrenwearCombinationAssetsPath: 'combination_reference'
});

const ANALYSIS_ROLES = new Set(Object.values(ROLE_BY_LIBRARY_KEY));

const COMMON_RULES = Object.freeze([
  'Return one JSON object only. Do not use markdown fences and do not add prose outside JSON.',
  'Describe only facts supported by visible pixels. Put unclear or hidden facts in uncertain_regions; never guess them.',
  'Silently identify why this image was selected for its assigned role. Product evidence must explain what is being sold and which visible details make it that product; reference evidence must explain which presentation action and physical behaviour should be learned.',
  'Use normalized 0..1 coordinates for positions and sizes when applicable.',
  'The catalogue is open-ended. Never force the image into a fixed list of sample garment categories.',
  `Set schema_version to "${ANALYSIS_SCHEMA_VERSION}".`
]);

const ROLE_PROMPTS = Object.freeze({
  product: [
    'CHILDRENSWEAR_PRODUCT_MANIFEST_ANALYSIS',
    'Analyze this real photographed SKU as the answer to “what exact product is being sold?”. The photo may be casual, rotated, folded or contain more than one coordinated component. Do not treat its pose or background as the desired ecommerce presentation.',
    ...COMMON_RULES,
    'Required JSON shape:',
    '{"schema_version":"1.0","asset_role":"real_product","summary":"","selling_identity":"","visible_selling_points":[],"category_guess":"","piece_count":1,"pieces":[{"piece_id":"piece_1","piece_type":"","visible_side":"front|back|side|uncertain","base_colors":[{"name":"","hex_estimate":"","coverage":0.0}],"material":{"family":"","surface":"","thickness":"","drape":"","stretch":"","sheen":"","opacity":"","wrinkle_character":"","material_signature":""},"construction":{"silhouette":"","panels":[],"openings":[],"closures":[],"pockets":[],"seams":[],"neckline":"","sleeves":"","cuffs":"","waist":"","crotch":"","legs":"","hems":"","bindings":[],"trims":[]},"decorations":[{"id":"","type":"print|embroidery|applique|patch|label|other","description":"","visible_text":"","position":{"x":0.0,"y":0.0},"relative_size":0.0}]}],"must_preserve":[],"uncertain_regions":[{"region":"","reason":"","instruction":"do not invent"}]}',
    'Inventory every garment component separately. State the visible selling identity and selling points: exact component count, silhouette, construction details, colours, motif/label placement, craft, and especially the material signature—surface texture, thickness, softness or rigidity, drape, stretch response, sheen and characteristic wrinkle scale.'
  ].join('\n'),
  flat_reference: [
    'CHILDRENSWEAR_FLAT_PRESENTATION_REFERENCE_ANALYSIS',
    'Analyze this finished ecommerce image as the answer to “why was this reference selected and what exactly should be learned from it?”. The garment shown is not the target SKU and none of its colour, material, print, label, pocket or construction may become product identity.',
    ...COMMON_RULES,
    'Required JSON shape:',
    '{"schema_version":"1.0","asset_role":"flat_presentation_reference","summary":"","reference_value":{"why_selected":"","action_to_transfer":"","fold_and_drape_logic":""},"canvas":{"aspect_ratio":"","width":0,"height":0,"crop":"","background":{"type":"","colors":[],"texture":""}},"presentation":{"viewpoint":"","product_count":1,"centers":[{"x":0.0,"y":0.0}],"coverage":0.0,"rotations_degrees":[],"display_pose":"","visual_outline":"","symmetry":"","spacing":""},"folds":[{"region":"","direction":"","intensity":"","cause":"gravity|bend|compression|overlap|tension"}],"lighting":{"direction":"","contrast":"","softness":"","color_temperature":""},"shadow":{"type":"","direction":"","softness":"","opacity":""},"protected_scene_elements":[],"preserve_from_reference":[],"replace_from_reference":[],"uncertain_regions":[]}',
    'Explain the reference value, then extract canvas, crop, product occupancy, exact display action, placement, rotation, spreading/folding logic, natural fold flow and causes, background, camera, lighting, shadows and protected non-product pixels.'
  ].join('\n'),
  model_reference: [
    'CHILDRENSWEAR_MODEL_REFERENCE_ANALYSIS',
    'Analyze this model ecommerce image as the answer to “why was this model reference selected and which action should the real product perform?”. The original garment is not product identity and must be replaceable.',
    ...COMMON_RULES,
    'Required JSON shape:',
    '{"schema_version":"1.0","asset_role":"model_reference","summary":"","reference_value":{"why_selected":"","action_to_transfer":"","fold_and_drape_logic":""},"canvas":{"aspect_ratio":"","crop":"","camera":""},"model":{"age_band":"","body_orientation":"","pose":"","weight_bearing":"","limbs":[],"hands":[],"feet":[]},"garment_display":{"target_regions":[],"fit":"","drape":"","folds":[],"visible_regions":[],"hidden_regions":[]},"occlusions":[{"occluder":"","target_region":"","layer_order":""}],"protected_regions":[],"editable_regions":[],"scene":{"background":"","props":[]},"lighting":{"direction":"","contrast":"","softness":"","color_temperature":""},"uncertain_regions":[]}',
    'Identify every protected person/scene region, the replaceable garment region, body pose, joint bends, gravity folds, overlap and front/back layer order.'
  ].join('\n'),
  combination_reference: [
    'CHILDRENSWEAR_COMBINATION_REFERENCE_ANALYSIS',
    'Analyze this ecommerce composition as the answer to “why was this multi-SKU reference selected and which action should each supplied SKU perform?”. Products shown in it are placeholders and must not contribute garment identity.',
    ...COMMON_RULES,
    'Required JSON shape:',
    '{"schema_version":"1.0","asset_role":"combination_reference","summary":"","reference_value":{"why_selected":"","overall_action_to_transfer":"","fold_and_drape_logic":""},"canvas":{"aspect_ratio":"","background":{"type":"","colors":[],"texture":""}},"slot_count":2,"slots":[{"slot_id":"slot_1","center":{"x":0.0,"y":0.0},"size":{"width":0.0,"height":0.0},"rotation_degrees":0,"z_index":1,"display_pose":"","component_actions":[],"folds":[{"region":"","direction":"","intensity":"","cause":"gravity|bend|compression|overlap|tension"}],"drape":"","crop":""}],"overlaps":[{"front_slot":"","back_slot":"","region":"","amount":""}],"spacing":"","lighting":{"direction":"","softness":"","contrast":""},"shadow":{"contact_shadow":true,"overlap_shadow":true,"description":""},"protected_scene_elements":[],"mapping_rule":"one supplied SKU per slot; never merge identities","uncertain_regions":[]}',
    'Extract slot count, normalized geometry, scale, rotation, z-order, overlap, spacing, background, lighting and shadows. For every slot, explicitly describe the garment action: body orientation, sleeve/leg direction, bends, spreading/folding, asymmetric placement, drape, fold directions, wrinkle zones and their physical cause. Do not describe placeholder garment design as a required output feature.'
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
  const expectedAssetRole = {
    product: 'real_product',
    flat_reference: 'flat_presentation_reference',
    model_reference: 'model_reference',
    combination_reference: 'combination_reference'
  }[role];
  parsed.schema_version = ANALYSIS_SCHEMA_VERSION;
  parsed.asset_role = expectedAssetRole;
  parsed.summary = String(parsed.summary || '').trim().slice(0, 1000);
  parsed.uncertain_regions = Array.isArray(parsed.uncertain_regions) ? parsed.uncertain_regions.slice(0, 100) : [];
  if (role === 'product') {
    parsed.pieces = Array.isArray(parsed.pieces) ? parsed.pieces.slice(0, 16) : [];
    const declared = Number(parsed.piece_count);
    parsed.piece_count = Number.isInteger(declared) && declared >= 1 && declared <= 16
      ? declared
      : Math.max(1, parsed.pieces.length || 1);
    parsed.must_preserve = Array.isArray(parsed.must_preserve) ? parsed.must_preserve.slice(0, 200) : [];
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

function compactAnalysisJson(value) {
  return JSON.stringify(value || {}, null, 2);
}

module.exports = {
  ANALYSIS_ROLES,
  ANALYSIS_SCHEMA_VERSION,
  ROLE_BY_LIBRARY_KEY,
  analysisRoleForLibraryKey,
  buildChildrenwearAssetAnalysisPrompt,
  compactAnalysisJson,
  extractJsonObject,
  normalizeAnalysisRole,
  normalizeChildrenwearAssetAnalysis
};
