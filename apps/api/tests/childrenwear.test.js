const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const {
  buildChildrenwearMasterPrompt,
  buildChildrenwearModelPrompt,
  buildChildrenwearCombinationPrompt,
  childrenwearPieceCount,
  createChildrenwearCombination,
  createChildrenwearEvidence
} = require('../src/core/childrenwear');

async function productImage(background = '#f6f6f3', garment = '#d6b36c') {
  const svg = Buffer.from(`<svg width="720" height="900" xmlns="http://www.w3.org/2000/svg">
    <rect width="720" height="900" fill="${background}"/>
    <path d="M210 150 L290 100 H430 L510 150 L620 300 L535 355 L485 270 L490 760 Q360 825 230 760 L235 270 L185 355 L100 300 Z" fill="${garment}" stroke="#6f5832" stroke-width="8"/>
    <path d="M290 105 Q360 180 430 105" fill="none" stroke="#fff" stroke-width="24"/>
    <path d="M255 360 Q360 315 465 360" fill="none" stroke="#8b6c3f" stroke-width="5"/>
    <circle cx="360" cy="450" r="52" fill="#5d8c6a"/>
  </svg>`);
  return sharp(svg).png().toBuffer();
}

test('childrenwear prompts keep real product and reference roles separate', () => {
  const productManifest = { category_guess: '纯棉梭织裤', piece_count: 1, pieces: [{ material: { family: '纯棉梭织' }, decorations: [{ type: '刺绣贴布' }] }] };
  const referenceSpec = { canvas: { aspect_ratio: '1:1' }, presentation: { display_pose: '平铺' } };
  const master = buildChildrenwearMasterPrompt({ productManifest, referenceSpec });
  assert.match(master, /image 1 is the original real product photo/i);
  assert.match(master, /image 2 is the finished flat-lay reference/i);
  assert.match(master, /PRODUCT_MANIFEST/);
  assert.match(master, /FLAT_REFERENCE_SPEC/);
  assert.match(master, /纯棉梭织裤/);
  assert.match(master, /刺绣贴布/);
  assert.match(master, /Never copy product identity from image 2/i);
  assert.doesNotMatch(master, /automatic detail crops/i);

  const model = buildChildrenwearModelPrompt({ productManifest, referenceSpec: { model: { pose: '站立' } } });
  assert.match(model, /image 1 is the approved flat-lay master/i);
  assert.match(model, /final model, pose and scene reference/i);
  assert.match(model, /纯棉梭织/);
  assert.match(model, /Preserve the model identity/i);
  assert.match(model, /Natural occlusion/i);
  assert.match(model, /Never convert the real SKU into the reference garment type/i);
});

test('combination prompts use the real reference index for two to four masters', () => {
  for (const count of [2, 3, 4]) {
    const prompt = buildChildrenwearCombinationPrompt({
      count,
      items: Array.from({ length: count }, (_, index) => ({
        productManifest: {
          category_guess: index === 1 ? '纯棉套装' : '纯棉梭织裤',
          piece_count: index === 1 ? 2 : 1
        }
      }))
    });
    assert.match(prompt, new RegExp(`Images 1 to ${count} are approved`, 'i'));
    assert.match(prompt, new RegExp(`Image ${count + 1} is the target composition blueprint`, 'i'));
    assert.match(prompt, /SKU 2[\s\S]*"piece_count": 2/i);
  }
});

test('unknown categories and materials remain open catalogue evidence hints', () => {
  const prompt = buildChildrenwearMasterPrompt({
    productManifest: { category_guess: '未来新品类-X9', piece_count: 1, pieces: [{ material: { family: '实验复合面料-Z7' } }] },
    referenceSpec: { presentation: { display_pose: 'reference-defined' } }
  });
  assert.match(prompt, /未来新品类-X9/);
  assert.match(prompt, /实验复合面料-Z7/);
  assert.match(prompt, /product-specific fact/i);
  assert.doesNotMatch(prompt, /two-piece set|romper silhouette/i);
  assert.equal(childrenwearPieceCount({ category: '纯棉套装' }), null);
  assert.equal(childrenwearPieceCount({ category: '完全未知新品类', pieceCount: 4 }), 4);
  assert.equal(childrenwearPieceCount({ productManifest: { piece_count: 3 } }), 3);
});

test('single real photo is expanded into three evidence crops', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'childrenwear-evidence-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'real.png');
  await fs.writeFile(source, await productImage());
  const files = await createChildrenwearEvidence(source, path.join(root, 'evidence'));
  assert.equal(files.length, 3);
  for (const file of files) {
    const metadata = await sharp(file).metadata();
    assert.ok(metadata.width > 200);
    assert.ok(metadata.height > 200);
  }
});

test('EXIF-rotated phone photo uses normalized dimensions for evidence crops', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'childrenwear-exif-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'phone.jpg');
  await sharp(await productImage())
    .jpeg({ quality: 92 })
    .withMetadata({ orientation: 6 })
    .toFile(source);
  const files = await createChildrenwearEvidence(source, path.join(root, 'evidence'));
  assert.equal(files.length, 3);
  for (const file of files) await fs.access(file);
});

test('approved masters can be deterministically composed without another AI call', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'childrenwear-combo-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const first = path.join(root, 'first.png');
  const second = path.join(root, 'second.png');
  const output = path.join(root, 'combination.png');
  await fs.writeFile(first, await productImage('#f6f6f3', '#d6b36c'));
  await fs.writeFile(second, await productImage('#f6f6f3', '#a8c4df'));
  await createChildrenwearCombination([first, second], output, { background: '#eef0e5', size: 1200 });
  const metadata = await sharp(output).metadata();
  assert.equal(metadata.width, 1200);
  assert.equal(metadata.height, 1200);
});

test('runtime completes master approval, model generation and combination with the image API', { concurrency: false }, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'childrenwear-runtime-'));
  const generated = await productImage('#f6f6f3', '#e6be79');
  let requests = 0;
  let analysisRequests = 0;
  let activeImageRequests = 0;
  let maxActiveImageRequests = 0;
  const requestBodies = [];
  const analysisSystemPrompts = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      const bodyText = Buffer.concat(chunks).toString('utf8');
      if (req.url === '/v1/chat/completions') {
        analysisRequests += 1;
        const body = JSON.parse(bodyText);
        const system = String(body.messages?.[0]?.content || '');
        analysisSystemPrompts.push(system);
        const analysis = system.includes('PRODUCT_MANIFEST')
          ? { summary: '开放品类商品身份', category_guess: '测试新品类', piece_count: 1, pieces: [{ piece_id: 'piece_1', piece_type: '测试童装', material: { family: '可见面料' }, construction: {}, decorations: [] }], must_preserve: [], uncertain_regions: [] }
          : system.includes('FLAT_PRESENTATION')
            ? { summary: '平铺参考', canvas: { aspect_ratio: '1:1' }, presentation: { display_pose: '平铺' }, uncertain_regions: [] }
            : system.includes('MODEL_REFERENCE')
              ? { summary: '模特参考', model: { pose: '站立' }, protected_regions: [], editable_regions: [], uncertain_regions: [] }
              : { summary: '组合参考', slot_count: 2, slots: [{ slot_id: 'slot_1' }, { slot_id: 'slot_2' }], uncertain_regions: [] };
        return res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(analysis) } }], usage: {} }));
      }
      if (req.url !== '/v1/images/edits') return res.writeHead(404).end();
      requests += 1;
      requestBodies.push(bodyText);
      activeImageRequests += 1;
      maxActiveImageRequests = Math.max(maxActiveImageRequests, activeImageRequests);
      setTimeout(() => {
        activeImageRequests -= 1;
        res.end(JSON.stringify({ data: [{ b64_json: generated.toString('base64') }] }));
      }, 25);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  });

  process.env.CAISHEN_DATA_DIR = path.join(root, 'data');
  process.env.CAISHEN_WORKSPACE_ID = 'childrenwear-test';
  process.env.CAISHEN_API_BASE_URL = `http://127.0.0.1:${server.address().port}/v1`;
  process.env.CAISHEN_IMAGE_API_KEY = 'test-key';
  process.env.CAISHEN_IMAGE_MODEL = 'gpt-image-2';
  process.env.CAISHEN_IMAGE_RESPONSE_FORMAT = 'b64_json';
  process.env.CAISHEN_IMAGE_API_START_INTERVAL_MS = '0';
  const runtimePath = require.resolve('../src/runtime');
  delete require.cache[runtimePath];
  const runtime = require('../src/runtime');
  t.after(() => delete require.cache[runtimePath]);

  const assetRoot = path.join(runtime.WORKSPACE_ROOT, 'assets', 'free');
  const legacyReferenceRoot = path.join(runtime.WORKSPACE_ROOT, 'assets', 'childrenwear-reference', 'manual');
  const outputRoot = path.join(root, 'output');
  await fs.mkdir(assetRoot, { recursive: true });
  const real = path.join(assetRoot, 'real.png');
  const reference = path.join(assetRoot, 'reference.png');
  const modelReference = path.join(assetRoot, 'model.png');
  await fs.writeFile(real, await productImage('#333333', '#e2bc73'));
  await fs.writeFile(reference, await productImage('#f6f6f3', '#b7c68c'));
  await fs.writeFile(modelReference, await productImage('#ddd6cd', '#d9a6a6'));
  await runtime.saveConfig({
    outputPath: outputRoot,
    childrenwearReferenceAssetsPath: legacyReferenceRoot,
    imageSize: '1024x1024',
    imageQuality: 'high'
  });
  await runtime.savePromptSetting('childrenwearMasterGeneration', 'CUSTOM_BRAND_GUIDANCE: keep a soft premium babywear presentation.');
  await runtime.savePromptSetting('childrenwearProductAnalysis', 'CUSTOM_PRODUCT_ANALYSIS\nPRODUCT_MANIFEST');
  await runtime.analyzeChildrenwearAssets({ role: 'product', paths: [real] });
  await runtime.analyzeChildrenwearAssets({ role: 'flat_reference', paths: [reference] });
  await runtime.analyzeChildrenwearAssets({ role: 'model_reference', paths: [modelReference] });
  assert.match(analysisSystemPrompts[0], /CUSTOM_PRODUCT_ANALYSIS/);

  const first = await runtime.generateChildrenwearMaster({
    realPhotoPath: real,
    referencePath: reference,
    category: '纯棉梭织裤',
    material: '纯棉梭织',
    craft: '刺绣贴布'
  });
  assert.equal(first.masterApproved, false);
  assert.match(requestBodies[0], /CUSTOM_BRAND_GUIDANCE/);
  assert.match(requestBodies[0], /SYSTEM_DYNAMIC_EXECUTION_CONTRACT/);
  assert.match(requestBodies[0], /PRODUCT_MANIFEST/);
  assert.match(requestBodies[0], /开放品类商品身份/);
  assert.match(requestBodies[0], /FLAT_REFERENCE_SPEC/);
  assert.equal(first.masterReviewStatus, 'pending');
  assert.ok(first.masterGeneration.elapsedMs >= 0);
  assert.ok(first.masterGeneration.apiRequestCount >= 1);
  assert.equal(typeof first.masterGeneration.billingCostMinor, 'number');
  assert.ok(first.masterHistory[0].url);
  assert.match(first.realPhotoThumbnailUrl, /^\/api\/thumbnails\//);
  assert.match(first.referenceThumbnailUrl, /^\/api\/thumbnails\//);
  assert.match(first.masterThumbnailUrl, /^\/api\/thumbnails\//);
  assert.match(first.masterPreviewUrl, /[?&]w=1200/);
  assert.ok(first.realPhotoPath.startsWith(path.join(first.folder, '素材', '实拍图')));
  assert.ok(first.referencePath.startsWith(path.join(first.folder, '素材', '成品参考图')));
  await fs.access(first.realPhotoPath);
  await fs.access(first.referencePath);
  assert.match(first.taskCode, /^\d{4}-001$/);
  assert.equal(first.taskName, `纯棉梭织裤${first.taskCode}`);
  await fs.access(first.masterPath);
  assert.equal(path.basename(path.dirname(first.masterPath)), '平铺图');
  await assert.rejects(
    runtime.generateChildrenwearModel({ folder: first.folder, modelReferencePath: modelReference }),
    /请先人工确认母版图/
  );
  const flaggedFirst = await runtime.approveChildrenwearOutput({ folder: first.folder, stage: 'master', approved: false, reviewStatus: 'needs_regeneration' });
  assert.equal(flaggedFirst.masterApproved, false);
  assert.equal(flaggedFirst.masterReviewStatus, 'needs_regeneration');
  const approvedFirst = await runtime.approveChildrenwearOutput({ folder: first.folder, stage: 'master', approved: true });
  assert.equal(approvedFirst.masterApproved, true);
  assert.equal(approvedFirst.masterReviewStatus, 'approved');

  const withModel = await runtime.generateChildrenwearModel({ folder: first.folder, modelReferencePath: modelReference });
  assert.equal(withModel.modelOutputs.length, 1);
  assert.equal(withModel.modelOutputs[0].reviewStatus, 'pending');
  assert.ok(withModel.modelOutputs[0].elapsedMs >= 0);
  assert.ok(withModel.modelOutputs[0].apiRequestCount >= 1);
  assert.equal(typeof withModel.modelOutputs[0].billingCostMinor, 'number');
  assert.match(withModel.modelOutputs[0].thumbnailUrl, /^\/api\/thumbnails\//);
  assert.match(withModel.modelOutputs[0].modelReferenceThumbnailUrl, /^\/api\/thumbnails\//);
  assert.ok(withModel.modelOutputs[0].modelReferencePath.startsWith(path.join(first.folder, '素材', '参考模特图')));
  assert.ok(withModel.modelOutputs[0].modelReferenceUrl);
  await fs.access(withModel.modelOutputs[0].path);
  assert.equal(path.basename(path.dirname(withModel.modelOutputs[0].path)), '模特图');

  await Promise.all(Array.from({ length: 3 }, () => runtime.generateChildrenwearModel({
    folder: first.folder,
    modelReferencePath: modelReference
  })));
  assert.ok(maxActiveImageRequests >= 3, `expected concurrent model calls, observed ${maxActiveImageRequests}`);
  const afterConcurrentModels = (await runtime.listChildrenwearTasks()).find(item => item.folder === first.folder);
  assert.equal(afterConcurrentModels.modelOutputs.length, 4);
  assert.equal(new Set(afterConcurrentModels.modelOutputs.map(item => item.id)).size, 4);

  const second = await runtime.generateChildrenwearMaster({
    realPhotoPath: real,
    referencePath: reference,
    category: '纯棉套装',
    material: '纯棉针织'
  });
  const approvedSecond = await runtime.approveChildrenwearOutput({ folder: second.folder, stage: 'master', approved: true });
  await runtime.analyzeChildrenwearAssets({ role: 'combination_reference', paths: [reference] });
  const combo = await runtime.generateChildrenwearCombination({
    folder: approvedFirst.folder,
    taskName: '纯棉梭织裤款式 A',
    masterPaths: [approvedFirst.masterPath, approvedSecond.masterPath],
    combinationReferencePath: reference
  });
  assert.equal(combo.combinationOutputs.length, 1);
  assert.match(requestBodies[6], /Images 1 to 2 are approved flat-lay masters/);
  assert.match(requestBodies[6], /Image 3 is the target composition blueprint/);
  assert.match(requestBodies[6], /SKU 2[\s\S]*"piece_count": 1/);
  assert.equal(combo.combinationOutputs[0].reviewStatus, 'pending');
  assert.ok(combo.combinationOutputs[0].elapsedMs >= 0);
  assert.ok(combo.combinationOutputs[0].apiRequestCount >= 1);
  assert.match(combo.combinationOutputs[0].thumbnailUrl, /^\/api\/thumbnails\//);
  assert.ok(combo.combinationReferencePath.startsWith(path.join(first.folder, '素材', '组合参考图')));
  assert.ok(combo.masterPaths.every(item => item.startsWith(path.join(first.folder, '素材', '组合平铺图'))));
  assert.equal(combo.masterUrls.length, 2);
  await fs.access(combo.combinationOutputs[0].path);
  assert.equal(path.basename(path.dirname(combo.combinationOutputs[0].path)), '组合图');
  assert.equal(combo.taskName, first.taskName);

  const legacyTaskFolder = path.join(path.dirname(first.folder), 'legacy-task');
  const repairedReference = path.join(legacyReferenceRoot, '纯棉长爬', 'legacy-reference.png');
  const missingReference = path.join(legacyReferenceRoot, '纯棉长爬-成品参考图', 'legacy-reference.png');
  await fs.mkdir(path.dirname(repairedReference), { recursive: true });
  await fs.writeFile(repairedReference, await productImage('#f4e8e8', '#c7a4d6'));
  await fs.mkdir(legacyTaskFolder, { recursive: true });
  await fs.writeFile(path.join(legacyTaskFolder, 'childrenwear-task.json'), JSON.stringify({
    id: 'legacy-task',
    folder: legacyTaskFolder,
    category: '纯棉长爬',
    taskCode: '0826-099',
    taskName: '纯棉长爬0826-099',
    referencePath: missingReference,
    modelOutputs: [],
    masterHistory: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }, null, 2));
  const listedTasks = await runtime.listChildrenwearTasks();
  assert.equal(listedTasks.length, 3);
  const repairedLegacyTask = listedTasks.find(item => item.id === 'legacy-task');
  assert.ok(repairedLegacyTask.referencePath.startsWith(path.join(legacyTaskFolder, '素材', '成品参考图')));
  await fs.access(repairedLegacyTask.referencePath);
  assert.deepEqual(repairedLegacyTask.assetHealth.missing, []);
  await fs.rm(real, { force: true });
  await fs.rm(reference, { force: true });
  const regenerated = await runtime.generateChildrenwearMaster({
    folder: first.folder,
    realPhotoPath: first.realPhotoPath,
    referencePath: first.referencePath,
    category: '纯棉梭织裤',
    material: '纯棉梭织'
  });
  assert.equal(regenerated.masterVersion, 2);
  assert.equal(requests, 8);
  assert.equal(analysisRequests, 4);
  const deletion = await runtime.deleteChildrenwearTasks([first.folder]);
  assert.equal(deletion.deleted, 1);
  assert.deepEqual(deletion.folders, [first.folder]);
  assert.equal(await fs.stat(first.folder).catch(() => null), null);
  assert.equal((await runtime.listChildrenwearTasks()).some(task => task.folder === first.folder), false);
  await fs.access(second.folder);
  await assert.rejects(runtime.deleteChildrenwearTasks([outputRoot]), /只能删除童装任务根目录/);
});
