const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

test('template print frontend uses current action protocol labels and filters', async () => {
  const renderer = await fs.readFile(path.join(__dirname, '../../web/src/renderer.js'), 'utf8');
  const assetFilters = renderer.match(/const ASSET_TEMPLATE_FILTERS = \[[\s\S]*?\n\];/)?.[0] || '';
  const templateActions = renderer.match(/const TEMPLATE_ACTIONS = \[[\s\S]*?\n\];/)?.[0] || '';

  assert.match(renderer, /\['copy_original', '保留原图'\]/);
  assert.match(renderer, /\['exclude', '不输出'\]/);
  assert.match(renderer, /copy_original:\s*'保留原图'/);
  assert.match(renderer, /exclude:\s*'不输出'/);
  assert.doesNotMatch(assetFilters, /\['copy_template'/);
  assert.doesNotMatch(assetFilters, /\['skip_copy'/);
  assert.doesNotMatch(templateActions, /\['copy_template'/);
  assert.doesNotMatch(templateActions, /\['skip_copy'/);
});

test('review activity panel only renders after an explicit task card click', async () => {
  const renderer = await fs.readFile(path.join(__dirname, '../../web/src/renderer.js'), 'utf8');
  const stateBlock = renderer.match(/const state = \{[\s\S]*?\n\};/)?.[0] || '';
  const loadReviewsBlock = renderer.match(/async function loadReviews[\s\S]*?\n\}/)?.[0] || '';
  const renderReviewStageBlock = renderer.match(/function renderReviewStage\(\) \{[\s\S]*?const summary = reviewGenerationSummary/)?.[0] || '';
  const clickBlock = renderer.match(/\$\('#reviewList'\)\.onclick = event => \{[\s\S]*?renderReviewList\(\); renderReviewStage\(\);/)?.[0] || '';

  assert.match(stateBlock, /reviewTaskActivated:\s*false/);
  assert.match(loadReviewsBlock, /if \(state\.reviewTaskActivated && state\.activeReview\) \{\s*state\.activeReview = state\.reviews\.find/);
  assert.match(renderReviewStageBlock, /!state\.reviewTaskActivated/);
  assert.match(clickBlock, /state\.reviewTaskActivated = true/);
});

test('template editor uses manual regions instead of AI reference analysis', async () => {
  const renderer = await fs.readFile(path.join(__dirname, '../../web/src/renderer.js'), 'utf8');
  const index = await fs.readFile(path.join(__dirname, '../../web/index.html'), 'utf8');
  const bridge = await fs.readFile(path.join(__dirname, '../../web/src/api-bridge.js'), 'utf8');
  const server = await fs.readFile(path.join(__dirname, '../src/server.js'), 'utf8');
  const runtime = await fs.readFile(path.join(__dirname, '../src/runtime.js'), 'utf8');
  assert.match(renderer, /function initializeTemplateRegionEditor\(item\)/);
  assert.match(renderer, /const fitEditorToViewport = \(\) =>/);
  assert.match(renderer, /layout\?\.clientHeight \|\| figure\.clientHeight/);
  assert.match(renderer, /data-region-undo/);
  assert.match(renderer, /data-region-clear/);
  assert.match(renderer, /regions: item\.regions/);
  assert.match(renderer, /typeof window\.PointerEvent === 'function'/);
  assert.match(renderer, /window\.addEventListener\('mouseup', finishRegion, \{ once: true \}\)/);
  assert.match(renderer, /function renderTemplateRegionResult\(\)/);
  assert.doesNotMatch(renderer, /async function previewTemplateRegions\(\)/);
  assert.doesNotMatch(renderer, /data-region-preview/);
  assert.match(index, /id="templateRegionResult"/);
  assert.match(index, /id="saveTemplateRegionsButton"/);
  assert.doesNotMatch(bridge, /previewTemplateRegions/);
  assert.doesNotMatch(server, /previewTemplateRegions/);
  assert.doesNotMatch(runtime, /async function previewTemplateRegions\(payload\)/);
  assert.match(runtime, /MASTER_COORDINATE_REGISTRATION_MODE/);
  assert.doesNotMatch(renderer, /data-template-ai=/);
  assert.doesNotMatch(renderer, /templateAnalysisResult|renderTemplateAnalysisResult|openTemplateAnalysisResult/);
  assert.doesNotMatch(index, /templateAnalysisResult|saveTemplateConfigButton/);
  assert.doesNotMatch(bridge, /analyzeTemplates:/);
  assert.doesNotMatch(bridge, /analyzeTemplateItems:/);
  assert.doesNotMatch(bridge, /analyzeTemplateItemWithReference:/);
  assert.doesNotMatch(bridge, /saveTemplateConfig:/);
  assert.doesNotMatch(server, /analyzeTemplates:\s*\(/);
  assert.doesNotMatch(server, /analyzeTemplateItems:\s*\(/);
  assert.doesNotMatch(server, /analyzeTemplateItemWithReference:\s*\(/);
  assert.doesNotMatch(server, /saveTemplateConfig:\s*\(/);
  assert.doesNotMatch(runtime, /function templateAnalysisForJob|function saveTemplateConfiguration/);
});

test('legacy prompt entrypoints and master generation mode are not exposed', async () => {
  const renderer = await fs.readFile(path.join(__dirname, '../../web/src/renderer.js'), 'utf8');
  const index = await fs.readFile(path.join(__dirname, '../../web/index.html'), 'utf8');
  const bridge = await fs.readFile(path.join(__dirname, '../../web/src/api-bridge.js'), 'utf8');
  const server = await fs.readFile(path.join(__dirname, '../src/server.js'), 'utf8');
  const runtime = await fs.readFile(path.join(__dirname, '../src/runtime.js'), 'utf8');

  for (const source of [renderer, index, bridge, server, runtime]) {
    assert.doesNotMatch(source, /analyzeProductProfile|productProfileAnalysis/);
  }
  assert.doesNotMatch(index, /value="master"/);
  assert.doesNotMatch(index, /productProfileModal|analyzeProductProfileButton/);
  assert.doesNotMatch(bridge, /regenerateMaster:/);
  assert.doesNotMatch(server, /regenerateMaster:/);
  assert.doesNotMatch(runtime, /getPromptValue\('masterGeneration'\)|getPromptValue\('templateMigration'\)/);
  assert.doesNotMatch(runtime, /getPromptValue\('templateAudit'\)|getPromptValue\('templateAuditRecheck'\)/);
});

test('single-image regeneration keeps four fixed base images and supports generated-result references', async () => {
  const renderer = await fs.readFile(path.join(__dirname, '../../web/src/renderer.js'), 'utf8');
  const server = await fs.readFile(path.join(__dirname, '../src/server.js'), 'utf8');
  const runtime = await fs.readFile(path.join(__dirname, '../src/runtime.js'), 'utf8');

  assert.match(renderer, /function reviewRegenerationReferenceCandidates/);
  assert.match(renderer, /referenceResultRelativePath/);
  assert.match(renderer, /参考当前这张不合格结果/);
  assert.match(renderer, /可选参考结果图/);
  assert.match(server, /referenceResultRelativePath/);
  assert.match(runtime, /resolveReviewReferenceResultPath/);
  assert.match(runtime, /operator-selected generated reference/);
  assert.match(runtime, /exactly four images in this fixed order/);
  assert.match(runtime, /imagePaths\.push\(options\.referenceResultPath\)/);
});

test('review regeneration accepts multiple submissions and stop-all clears their local state', async () => {
  const renderer = await fs.readFile(path.join(__dirname, '../../web/src/renderer.js'), 'utf8');
  const server = await fs.readFile(path.join(__dirname, '../src/server.js'), 'utf8');
  const runtime = await fs.readFile(path.join(__dirname, '../src/runtime.js'), 'utf8');

  assert.match(renderer, /const wholeSetRunning = running && localRegenerating === 0/);
  assert.match(renderer, /state\.regeneratingReviewJobs\.clear\(\)/);
  assert.match(renderer, /record\.status = 'stopped'/);
  assert.match(renderer, /重新生成已停止/);
  assert.match(renderer, /reviewRegenerationJobIds: new Map\(\)/);
  assert.match(renderer, /await window\.caishen\.cancelJob\(jobId\)/);
  assert.match(renderer, /停止重新生成/);
  assert.match(server, /activeJobControllers\.has\(id\)/);
  assert.match(runtime, /queueTemplateRegeneration\(folder, options\.signal/);
  assert.match(runtime, /phase: 'failed',[\s\S]*?已停止重新生成/);
});
