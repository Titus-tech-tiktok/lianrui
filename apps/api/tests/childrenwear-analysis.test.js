const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ANALYSIS_SCHEMA_VERSION,
  analysisRoleForLibraryKey,
  buildChildrenwearAssetAnalysisPrompt,
  normalizeChildrenwearAssetAnalysis
} = require('../src/core/childrenwear-analysis');

test('each childrenwear asset library has one independent AI analysis role', () => {
  assert.equal(analysisRoleForLibraryKey('childrenwearRealAssetsPath'), 'product');
  assert.equal(analysisRoleForLibraryKey('childrenwearReferenceAssetsPath'), 'flat_reference');
  assert.equal(analysisRoleForLibraryKey('childrenwearModelAssetsPath'), 'model_reference');
  assert.equal(analysisRoleForLibraryKey('childrenwearCombinationAssetsPath'), 'combination_reference');
});

test('analysis prompts keep product identity separate from presentation references', () => {
  const product = buildChildrenwearAssetAnalysisPrompt('product');
  const flat = buildChildrenwearAssetAnalysisPrompt('flat_reference');
  const model = buildChildrenwearAssetAnalysisPrompt('model_reference');
  const combination = buildChildrenwearAssetAnalysisPrompt('combination_reference');
  assert.match(product, /open-ended/i);
  assert.match(product, /piece_count/);
  assert.match(product, /never guess/i);
  assert.match(product, /what exact product is being sold/i);
  assert.match(product, /selling_identity/);
  assert.match(product, /visible_selling_points/);
  assert.match(flat, /not the target SKU/i);
  assert.match(flat, /why was this reference selected/i);
  assert.match(flat, /reference_value/);
  assert.match(flat, /natural fold flow/i);
  assert.match(model, /protected person\/scene region/i);
  assert.match(model, /which action should the real product perform/i);
  assert.match(combination, /one supplied SKU per slot/i);
  assert.match(combination, /which action should each supplied SKU perform/i);
});

test('analysis JSON is normalized to the current cache schema', () => {
  const product = normalizeChildrenwearAssetAnalysis('product', '```json\n{"summary":"x","piece_count":2,"pieces":[]}\n```');
  assert.equal(product.schema_version, ANALYSIS_SCHEMA_VERSION);
  assert.equal(product.asset_role, 'real_product');
  assert.equal(product.piece_count, 2);
  assert.deepEqual(product.uncertain_regions, []);

  const combination = normalizeChildrenwearAssetAnalysis('combination_reference', { summary: 'layout', slots: [{ slot_id: 'slot_1' }] });
  assert.equal(combination.asset_role, 'combination_reference');
  assert.equal(combination.slot_count, 1);
});
