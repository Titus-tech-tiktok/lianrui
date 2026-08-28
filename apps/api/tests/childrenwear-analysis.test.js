const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ANALYSIS_SCHEMA_VERSION,
  analysisSchemaVersionForRole,
  analysisRoleForLibraryKey,
  buildChildrenwearAnalysisCacheIdentity,
  buildChildrenwearAssetAnalysisPrompt,
  normalizeChildrenwearAssetAnalysis,
  validateChildrenwearAssetAnalysis
} = require('../src/core/childrenwear-analysis');

test('each childrenwear asset library has one independent AI analysis role', () => {
  assert.equal(analysisRoleForLibraryKey('childrenwearRealAssetsPath'), 'product');
  assert.equal(analysisRoleForLibraryKey('childrenwearReferenceAssetsPath'), 'flat_reference');
  assert.equal(analysisRoleForLibraryKey('childrenwearModelAssetsPath'), 'model_reference');
  assert.equal(analysisRoleForLibraryKey('childrenwearSceneAssetsPath'), 'scene_reference');
  assert.equal(analysisRoleForLibraryKey('childrenwearCombinationAssetsPath'), 'combination_reference');
});

test('analysis prompts keep product identity separate from presentation references', () => {
  const product = buildChildrenwearAssetAnalysisPrompt('product');
  const flat = buildChildrenwearAssetAnalysisPrompt('flat_reference');
  const model = buildChildrenwearAssetAnalysisPrompt('model_reference');
  const scene = buildChildrenwearAssetAnalysisPrompt('scene_reference');
  const combination = buildChildrenwearAssetAnalysisPrompt('combination_reference');
  assert.match(product, /open-ended/i);
  assert.match(product, /component_count/);
  assert.match(product, /never guess/i);
  assert.match(product, /what exact product is being sold/i);
  assert.match(product, /product_truth/);
  assert.match(product, /print_description/);
  assert.match(product, /pattern_cut/i);
  assert.match(product, /surface_texture/i);
  assert.match(flat, /not the target SKU/i);
  assert.match(flat, /why was this reference selected/i);
  assert.match(flat, /reference_value/);
  assert.match(flat, /natural fold flow/i);
  assert.match(flat, /background_profile/i);
  assert.match(flat, /shadow/i);
  assert.match(model, /protected person\/scene region/i);
  assert.match(model, /which action should the real product perform/i);
  assert.match(model, /exact presentation targets/i);
  assert.match(scene, /environment reference/i);
  assert.match(scene, /never controls the product, model identity, model pose or garment folds/i);
  assert.match(combination, /one supplied SKU per slot/i);
  assert.match(combination, /which action should each supplied SKU perform/i);
  assert.match(combination, /displayed outer outline/i);
});

test('analysis JSON is normalized to the current cache schema', () => {
  const product = normalizeChildrenwearAssetAnalysis('product', '```json\n{"summary":"x","product_truth":{"category":"new category","component_count":2,"must_preserve":["print"],"must_not_invent":["pocket"]}}\n```');
  assert.equal(product.schema_version, analysisSchemaVersionForRole('product'));
  assert.equal(product.asset_role, 'real_product');
  assert.equal(product.piece_count, 2);
  assert.equal(product.product_truth.category, 'new category');
  assert.deepEqual(product.product_truth.must_preserve, ['print']);
  assert.deepEqual(product.product_truth.must_not_invent, ['pocket']);
  assert.deepEqual(product.uncertain_regions, []);

  const combination = normalizeChildrenwearAssetAnalysis('combination_reference', { summary: 'layout', slots: [{ slot_id: 'slot_1' }] });
  assert.equal(combination.asset_role, 'combination_reference');
  assert.equal(combination.slot_count, 1);
  assert.equal(combination.schema_version, ANALYSIS_SCHEMA_VERSION);
});

test('flat-lay analysis exposes product truth and measurable target geometry contracts', () => {
  const product = buildChildrenwearAssetAnalysisPrompt('product');
  const reference = buildChildrenwearAssetAnalysisPrompt('flat_reference');
  for (const field of ['product_truth', 'base_color', 'print_description', 'print_scale', 'print_density', 'sleeve_cuff', 'ankle_cuff', 'must_not_invent']) {
    assert.match(product, new RegExp(field));
  }
  for (const field of ['target_geometry', 'garment_bbox', 'garment_canvas_coverage', 'center_position', 'sleeve_angles', 'crotch_depth', 'leg_angles', 'keypoints', 'background_profile', 'target_hex', 'color_tolerance_delta_e']) {
    assert.match(reference, new RegExp(field));
  }
  const normalized = normalizeChildrenwearAssetAnalysis('flat_reference', {
    target_geometry: { garment_canvas_coverage: 0.42, sleeve_angles: [-12, 12] },
    background_profile: { target_hex: '#abcdef', color_tolerance_delta_e: 99 }
  });
  assert.equal(normalized.schema_version, analysisSchemaVersionForRole('flat_reference'));
  assert.equal(normalized.target_geometry.garment_canvas_coverage, 0.42);
  assert.equal(normalized.background_profile.color_tolerance_delta_e, 3);
});

test('analysis cache identity invalidates on role, prompt content, structure version or model', () => {
  const base = { contentHash: 'abc123', role: 'product', analysisPrompt: 'prompt A', model: 'gpt-5.6' };
  const first = buildChildrenwearAnalysisCacheIdentity(base);
  assert.equal(first.identityHash, buildChildrenwearAnalysisCacheIdentity(base).identityHash);
  assert.notEqual(first.identityHash, buildChildrenwearAnalysisCacheIdentity({ ...base, analysisPrompt: 'prompt B' }).identityHash);
  assert.notEqual(first.identityHash, buildChildrenwearAnalysisCacheIdentity({ ...base, model: 'gpt-5.7' }).identityHash);
  assert.notEqual(first.identityHash, buildChildrenwearAnalysisCacheIdentity({ ...base, role: 'flat_reference' }).identityHash);
  assert.equal(first.structureVersion, analysisSchemaVersionForRole('product'));
});

test('product truth and target geometry reject empty or out-of-range analysis', () => {
  const product = normalizeChildrenwearAssetAnalysis('product', {
    product_truth: {
      category: '开放品类商品', component_count: 1,
      base_color: { name: '米色', hex_estimate: '#EEE4D0' },
      fabric: { family: '针织', surface_texture: '细纹' },
      must_preserve: ['真实颜色'], must_not_invent: ['不可新增口袋']
    }
  });
  assert.equal(validateChildrenwearAssetAnalysis('product', product), product);
  assert.throws(() => validateChildrenwearAssetAnalysis('product', normalizeChildrenwearAssetAnalysis('product', { product_truth: { category: '' } })), /category 不能为空/);

  const reference = normalizeChildrenwearAssetAnalysis('flat_reference', {
    target_geometry: {
      canvas_aspect_ratio: '3:4',
      garment_bbox: { x: 0.15, y: 0.08, width: 0.7, height: 0.84 },
      garment_canvas_coverage: 0.46,
      center_position: { x: 0.5, y: 0.5 },
      symmetry: 'near symmetric', flatness: 'flat', sleeve_angles: [-12, 12], leg_angles: [86, 94],
      keypoints: { neckline: { x: 0.5, y: 0.12 }, shoulders: [], armpits: [], sleeve_cuffs: [], crotch: { x: 0.5, y: 0.62 }, legs: [], ankle_cuffs: [] }
    },
    background_profile: { target_hex: '#EEBEC1', target_rgb: { r: 238, g: 190, b: 193 } }
  });
  assert.equal(validateChildrenwearAssetAnalysis('flat_reference', reference), reference);
  const emptyGeometry = normalizeChildrenwearAssetAnalysis('flat_reference', { target_geometry: {}, background_profile: { target_hex: '#EEBEC1', target_rgb: { r: 238, g: 190, b: 193 } } });
  assert.throws(() => validateChildrenwearAssetAnalysis('flat_reference', emptyGeometry), /garment_bbox 不能为空/);
  const invalidRange = structuredClone(reference);
  invalidRange.target_geometry.center_position.x = 1.4;
  assert.throws(() => validateChildrenwearAssetAnalysis('flat_reference', invalidRange), /center_position 坐标必须位于 0\.\.1/);
});
