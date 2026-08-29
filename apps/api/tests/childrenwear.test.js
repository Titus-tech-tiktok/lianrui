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
  buildChildrenwearFlatLayTransformPlan,
  createChildrenwearCombination,
  createChildrenwearEvidence,
  extractFlatReferenceBackgroundProfile,
  flatLayApiSizeForReference,
  inspectFlatLayOutput
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
  const referenceSpec = { target_geometry: { canvas_aspect_ratio: '1:1', garment_canvas_coverage: 0.52, center_position: { x: 0.5, y: 0.5 } }, background_profile: { target_hex: '#EEBEC1', target_rgb: { r: 238, g: 190, b: 193 } } };
  const master = buildChildrenwearMasterPrompt({ productManifest, referenceSpec });
  assert.equal(master, '图1保持版型背景不变，衣服款式图案严格精密还原替换成图2衣服，轻微自然布料褶皱，局部点缀浅淡衣纹，整体版型平整，低对比度柔和褶皱，符合重力轻微垂坠纹路，真实不夸张，版型工整美观，真实纯棉面料材质棉毛纹理质感，8K，电商超清摄影。');
  assert.doesNotMatch(master, /product_truth|target_geometry|background_profile|transform_plan/i);

  const model = buildChildrenwearModelPrompt({ productManifest, referenceSpec: { model: { pose: '站立' } } });
  assert.match(model, /image 1 is the selected generated flat-lay/i);
  assert.match(model, /final model, action, pose and garment-deformation reference/i);
  assert.match(model, /纯棉梭织/);
  assert.match(model, /Preserve model identity\/type/i);
  assert.match(model, /Natural occlusion/i);
  assert.match(model, /action blueprint/i);
  assert.match(model, /fold flow and wrinkle zones/i);
  assert.match(model, /Never paste a rigid flat-lay silhouette/i);
  assert.match(model, /Never convert the real SKU into the reference garment type/i);
  assert.match(model, /REFERENCE PRESENTATION LOCK/i);
  assert.match(model, /PRODUCT IDENTITY LOCK/i);
  assert.match(model, /CONTROLLED RANDOM MICRO-VARIATION/i);
  assert.match(model, /natural facial expression, gaze direction and small head-angle variation/i);
  assert.match(model, /No dramatic turn, jump, squat/i);
  assert.match(model, /keep the model visually centred/i);
  assert.match(model, /BACKGROUND MICRO-VARIATION/i);
  assert.match(model, /Lock the reference scene type[\s\S]*depth of field, blur and bokeh/i);
  assert.match(model, /a stool or small decoration may appear or disappear/i);
  assert.match(model, /same background and under the same lighting setup/i);

  const whiteModel = buildChildrenwearModelPrompt({ productManifest, referenceSpec: {}, backgroundMode: 'white' });
  assert.match(whiteModel, /BACKGROUND MODE: PURE WHITE/i);
  assert.match(whiteModel, /RGB\(255,255,255\)/i);
  assert.match(whiteModel, /BACKGROUND VARIATION: none/i);
  const sceneModel = buildChildrenwearModelPrompt({ productManifest, referenceSpec: {}, backgroundMode: 'scene_reference', sceneSpec: { scene: { environment_type: 'nursery' } } });
  assert.match(sceneModel, /image 3 is the only environment\/background/i);
  assert.match(sceneModel, /SCENE_REFERENCE_SPEC/i);
  assert.match(sceneModel, /never controls the person, pose, garment identity or garment folds/i);
});

test('flat-lay transform plan keeps product facts separate from reference geometry', () => {
  const plan = buildChildrenwearFlatLayTransformPlan({
    product_truth: { must_preserve: ['pink pig print'], must_not_invent: ['pockets'] }
  }, {
    target_geometry: { garment_canvas_coverage: 0.47, sleeve_angles: [-9, 11] }
  });
  assert.ok(plan.preserve_from_source.includes('pink pig print'));
  assert.ok(plan.forbidden_changes.includes('pockets'));
  assert.equal(plan.geometry_constraints.target.garment_canvas_coverage, 0.47);
  assert.equal(plan.geometry_constraints.garment_canvas_coverage_tolerance, 0.03);
  assert.equal(plan.geometry_constraints.center_position_tolerance, 0.02);
});

test('background profile uses robust original-image perimeter median instead of one pixel', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'childrenwear-background-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'reference.png');
  const background = { r: 238, g: 190, b: 193, alpha: 1 };
  const garment = Buffer.from('<svg width="500" height="500" xmlns="http://www.w3.org/2000/svg"><path d="M145 95 L210 70 H290 L355 95 L430 220 L365 260 L330 185 L330 425 L270 425 L250 310 L230 425 L170 425 L170 185 L135 260 L70 220 Z" fill="#ffffff"/></svg>');
  await sharp({ create: { width: 500, height: 500, channels: 4, background } })
    .composite([{ input: garment }, { input: Buffer.from('<svg width="20" height="20" xmlns="http://www.w3.org/2000/svg"><rect width="20" height="20" fill="#000000"/></svg>'), left: 0, top: 0 }])
    .png()
    .toFile(file);
  const profile = await extractFlatReferenceBackgroundProfile(file);
  assert.equal(profile.target_hex, '#EEBEC1');
  assert.deepEqual(profile.target_rgb, { r: 238, g: 190, b: 193 });
  assert.equal(profile.color_tolerance_delta_e, 3);
  assert.match(profile.uniformity.source, /original_reference/);
});

test('flat-lay API size follows the original reference orientation', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'childrenwear-output-size-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const cases = [
    ['square.png', 500, 500, '1024x1024'],
    ['near-square-portrait.png', 413, 473, '1024x1024'],
    ['portrait.png', 500, 700, '1024x1536'],
    ['landscape.png', 700, 500, '1536x1024']
  ];
  for (const [name, width, height, expected] of cases) {
    const file = path.join(root, name);
    await sharp({ create: { width, height, channels: 3, background: '#eeeeee' } }).png().toFile(file);
    assert.equal((await flatLayApiSizeForReference(file)).size, expected);
  }
});

test('deterministic flat-lay checks report background, center, coverage, contour and keypoints', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'childrenwear-flatlay-check-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const reference = path.join(root, 'reference.png');
  const output = path.join(root, 'output.png');
  await fs.writeFile(reference, await productImage('#eebec1', '#ffffff'));
  await fs.writeFile(output, await productImage('#eebec1', '#ffffff'));
  const analysis = {
    background_profile: { target_hex: '#EEBEC1', target_rgb: { r: 238, g: 190, b: 193 } },
    target_geometry: {
      garment_canvas_coverage: 0.33,
      center_position: { x: 0.5, y: 0.52 },
      keypoints: { neckline: { x: 0.5, y: 0.12 }, shoulders: [{ x: 0.4, y: 0.18 }, { x: 0.6, y: 0.18 }], sleeve_cuffs: [{ x: 0.14, y: 0.34 }, { x: 0.86, y: 0.34 }], crotch: { x: 0.5, y: 0.65 }, ankle_cuffs: [{ x: 0.35, y: 0.85 }, { x: 0.65, y: 0.85 }] }
    }
  };
  const result = await inspectFlatLayOutput(output, analysis, reference);
  assert.equal(result.background.delta_e, 0);
  assert.ok(result.geometry.detected_bbox);
  assert.ok(result.geometry.contour_similarity_iou > 0.98);
  assert.ok(result.geometry.keypoint_alignment.checked >= 6);
  assert.equal(result.geometry.sleeve_angle_checks.count, 2);
  assert.equal(result.geometry.leg_angle_checks.count, 2);
  assert.ok(result.geometry.crotch_check);
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
    assert.match(prompt, new RegExp(`Images 1 to ${count} are selected generated flat-lays`, 'i'));
    assert.match(prompt, new RegExp(`Image ${count + 1} is the target composition action blueprint`, 'i'));
    assert.match(prompt, /SKU 2[\s\S]*"piece_count": 2/i);
    assert.match(prompt, /action blueprint/i);
    assert.match(prompt, /sleeve and leg direction/i);
    assert.match(prompt, /stiff cut-outs/i);
    assert.match(prompt, /REFERENCE PRESENTATION LOCK/i);
    assert.match(prompt, /PRODUCT IDENTITY LOCK/i);
    assert.match(prompt, /layout\/background\/fold\/shadow\/action/i);
  }
});

test('direct flat-lay prompt stays category-agnostic while piece count remains open-ended', () => {
  const prompt = buildChildrenwearMasterPrompt({
    productManifest: { category_guess: '未来新品类-X9', piece_count: 1, pieces: [{ material: { family: '实验复合面料-Z7' } }] },
    referenceSpec: { presentation: { display_pose: 'reference-defined' } }
  });
  assert.match(prompt, /图1保持版型背景不变/);
  assert.doesNotMatch(prompt, /未来新品类-X9|实验复合面料-Z7|two-piece set|romper silhouette/i);
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

test('generated flat-lays can be deterministically composed without another AI call', async (t) => {
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
          ? { summary: '开放品类商品身份', product_truth: { category: '测试新品类', component_count: 1, base_color: { name: '灰色', hex_estimate: '#333333' }, fabric: { family: '可见面料', surface_texture: '细纹' }, must_preserve: ['真实结构和颜色'], must_not_invent: ['不可新增口袋'] }, pieces: [{ piece_id: 'piece_1', piece_type: '测试童装', material: { family: '可见面料' }, construction: {}, decorations: [] }], uncertain_regions: [] }
          : system.includes('FLAT_PRESENTATION')
            ? { summary: '平铺参考', target_geometry: { canvas_aspect_ratio: '1:1', garment_bbox: { x: 0.2, y: 0.12, width: 0.6, height: 0.76 }, garment_canvas_coverage: 0.35, center_position: { x: 0.5, y: 0.5 }, torso_width_height_ratio: 0.55, shoulder_width: 0.42, sleeve_angles: [-15, 15], sleeve_length_ratio: 0.36, crotch_width: 0.18, crotch_depth: 0.12, leg_angles: [86, 94], leg_length_ratio: 0.4, cuff_width_ratio: 0.2, symmetry: 'near symmetric', flatness: 'flat', keypoints: { neckline: { x: 0.5, y: 0.16 }, shoulders: [{ x: 0.36, y: 0.22 }, { x: 0.64, y: 0.22 }], armpits: [], sleeve_cuffs: [{ x: 0.2, y: 0.38 }, { x: 0.8, y: 0.38 }], crotch: { x: 0.5, y: 0.62 }, legs: [], ankle_cuffs: [{ x: 0.39, y: 0.88 }, { x: 0.61, y: 0.88 }] }, component_placement: [], detail_display_actions: [], folds: [] }, background_profile: { target_hex: '#f6f6f3', target_rgb: { r: 246, g: 246, b: 243 }, shadow: {}, color_tolerance_delta_e: 3 }, uncertain_regions: [] }
            : system.includes('MODEL_REFERENCE')
              ? { summary: '模特参考', model: { pose: '站立' }, protected_regions: [], editable_regions: [], uncertain_regions: [] }
              : { summary: '组合参考', slot_count: 4, slots: [{ slot_id: 'slot_1' }, { slot_id: 'slot_2' }, { slot_id: 'slot_3' }, { slot_id: 'slot_4' }], uncertain_regions: [] };
        return res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(analysis) } }], usage: {} }));
      }
      if (req.url !== '/v1/images/edits') return res.writeHead(404).end();
      requests += 1;
      requestBodies.push(bodyText);
      setTimeout(() => {
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
  process.env.CAISHEN_IMAGE_API_INITIAL_CONCURRENCY = '8';
  process.env.CAISHEN_IMAGE_API_MAX_CONCURRENCY = '500';
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
  const emptyGenerationPrompts = await runtime.loadChildrenwearGenerationPromptSettings();
  assert.equal(emptyGenerationPrompts.prompts.length, 3);
  assert.equal(emptyGenerationPrompts.prompts.every(item => item.value === ''), true, '生成板块不得内置预设提示词');
  await runtime.saveChildrenwearGenerationPromptSetting('childrenwearMasterGeneration', 'CUSTOM_MASTER_PROMPT');
  await runtime.saveChildrenwearGenerationPromptSetting('childrenwearModelGeneration', 'CUSTOM_MODEL_PROMPT');
  await runtime.saveChildrenwearGenerationPromptSetting('childrenwearCombinationGeneration', 'CUSTOM_COMBINATION_PROMPT');
  await runtime.analyzeChildrenwearAssets({ role: 'model_reference', paths: [modelReference] });
  const analysisRequestsBeforeMaster = analysisRequests;

  const first = await runtime.generateChildrenwearMaster({
    realPhotoPath: real,
    referencePath: reference,
    category: '纯棉梭织裤',
    material: '纯棉梭织',
    craft: '刺绣贴布'
  });
  assert.equal(first.masterApproved, false);
  assert.equal(analysisRequests, analysisRequestsBeforeMaster, 'flat-lay generation must not call the text-analysis API');
  assert.match(requestBodies[0], /CUSTOM_MASTER_PROMPT/);
  assert.doesNotMatch(requestBodies[0], /图1保持版型背景不变|SYSTEM_DYNAMIC_EXECUTION_CONTRACT|product_truth|target_geometry|transform_plan/);
  assert.ok(requestBodies[0].indexOf('filename="real.png"') < requestBodies[0].indexOf('filename="reference.png"'), 'API image order must follow the task card from left to right');
  assert.match(requestBodies[0], /1024x1536/);
  assert.equal(first.backgroundProfile.target_hex, '#F6F6F3');
  assert.equal(first.analysisSchemaVersion, 'direct-two-image-v1');
  assert.equal(first.productAnalysisSchemaVersion, '');
  assert.equal(first.flatReferenceAnalysisSchemaVersion, '');
  assert.equal(first.productManifest.source, 'direct_two_image_flat_lay');
  assert.equal(first.flatLayValidation.advisory_only, true);
  assert.equal(first.flatLayImageSize.size, '1024x1536');
  assert.equal(typeof first.flatLayValidation.geometry.contour_similarity_iou, 'number');
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
  assert.equal(first.taskName, `${first.taskCode} 纯棉梭织裤`);
  await fs.access(first.masterPath);
  assert.equal(path.basename(path.dirname(first.masterPath)), '平铺图');
  const outsideDetail = path.join(root, 'outside-detail.png');
  await fs.writeFile(outsideDetail, await productImage('#ffffff', '#d0b080'));
  await assert.rejects(runtime.generateChildrenwearMaster({
    folder: first.folder,
    realPhotoPath: first.realPhotoPath,
    referencePath: first.referencePath,
    detailPhotoPaths: [outsideDetail]
  }), /实拍细节图不属于当前工作区/);
  await assert.rejects(runtime.generateChildrenwearMaster({
    folder: first.folder,
    realPhotoPath: first.realPhotoPath,
    referencePath: first.referencePath,
    realDetailPaths: [outsideDetail]
  }), /实拍细节图不属于当前工作区/);
  const withModel = await runtime.generateChildrenwearModel({ folder: first.folder, modelReferencePath: modelReference });
  assert.match(requestBodies[1], /CUSTOM_MODEL_PROMPT/);
  assert.match(requestBodies[1], /本次任务模式：生成模特上身图/);
  assert.doesNotMatch(requestBodies[1], /SYSTEM_DYNAMIC_EXECUTION_CONTRACT/);
  assert.equal(withModel.masterApproved, false, '平铺图仍待审核，但不再阻塞模特图生成');
  const flaggedFirst = await runtime.approveChildrenwearOutput({ folder: first.folder, stage: 'master', approved: false, reviewStatus: 'needs_regeneration' });
  assert.equal(flaggedFirst.masterApproved, false);
  assert.equal(flaggedFirst.masterReviewStatus, 'needs_regeneration');
  const approvedFirst = await runtime.approveChildrenwearOutput({ folder: first.folder, stage: 'master', approved: true });
  assert.equal(approvedFirst.masterApproved, true);
  assert.equal(approvedFirst.masterReviewStatus, 'approved');

  assert.equal(withModel.modelOutputs.length, 1);
  assert.equal(withModel.modelOutputs[0].operationType, 'dress');
  assert.equal(withModel.modelOutputs[0].backgroundMode, 'model_reference');
  assert.equal(withModel.modelOutputs[0].promptRoute, 'dress_follow');
  assert.equal(withModel.modelOutputs[0].reviewRequired, false);
  assert.equal(withModel.modelOutputs[0].reviewStatus, 'completed');
  assert.ok(withModel.modelOutputs[0].elapsedMs >= 0);
  assert.ok(withModel.modelOutputs[0].apiRequestCount >= 1);
  assert.equal(typeof withModel.modelOutputs[0].billingCostMinor, 'number');
  assert.match(withModel.modelOutputs[0].thumbnailUrl, /^\/api\/thumbnails\//);
  assert.match(withModel.modelOutputs[0].modelReferenceThumbnailUrl, /^\/api\/thumbnails\//);
  assert.ok(withModel.modelOutputs[0].modelReferencePath.startsWith(path.join(first.folder, '素材', '参考模特图')));
  assert.ok(withModel.modelOutputs[0].modelReferenceUrl);
  assert.equal(withModel.modelOutputs[0].masterPath, first.masterPath);
  assert.match(withModel.modelOutputs[0].masterThumbnailUrl, /^\/api\/thumbnails\//);
  assert.equal(withModel.modelOutputs[0].taskName, first.taskName);
  await fs.access(withModel.modelOutputs[0].path);
  assert.equal(path.basename(path.dirname(withModel.modelOutputs[0].path)), '模特图');

  const modelBatchProgress = [];
  const modelBatch = await runtime.generateChildrenwearBatch({
    stage: 'model',
    items: Array.from({ length: 3 }, () => ({
      folder: first.folder,
      modelReferencePath: modelReference
    }))
  }, { reportProgress: update => modelBatchProgress.push(update) });
  assert.equal(modelBatch.total, 3);
  assert.equal(modelBatch.completed, 3);
  assert.equal(modelBatch.failed, 0);
  assert.equal(modelBatch.results.every(item => item.ok), true);
  assert.equal(modelBatch.results[0].value.folder, first.folder);
  assert.equal(modelBatch.results[0].value.modelOutputs.length, 1);
  assert.equal(
    modelBatch.results[0].value.modelOutputs[0].path,
    modelBatchProgress.find(item => item.itemIndex === 0 && item.itemResult)?.itemResult.modelOutputs[0].path
  );
  assert.equal('productManifest' in modelBatch.results[0].value, false);
  assert.equal(modelBatchProgress.filter(item => item.itemState === 'completed').length, 3);
  assert.deepEqual(
    modelBatchProgress.at(-1).completedItems.map(item => item.index).sort((a, b) => a - b),
    [0, 1, 2]
  );
  assert.ok(modelBatchProgress[0].concurrency >= 3, `expected configured model concurrency, observed ${modelBatchProgress[0].concurrency}`);
  const afterConcurrentModels = (await runtime.listChildrenwearTasks()).find(item => item.folder === first.folder);
  assert.equal((await runtime.getChildrenwearTask(first.folder)).folder, first.folder);
  assert.equal(afterConcurrentModels.modelOutputs.length, 4);
  assert.equal(new Set(afterConcurrentModels.modelOutputs.map(item => item.id)).size, 4);

  const second = await runtime.generateChildrenwearMaster({
    realPhotoPath: real,
    referencePath: reference,
    category: '纯棉套装',
    material: '纯棉针织',
    promptOverride: 'ONE_TIME_MASTER_REGENERATION_PROMPT'
  });
  assert.match(requestBodies[5], /ONE_TIME_MASTER_REGENERATION_PROMPT/);
  assert.doesNotMatch(requestBodies[5], /CUSTOM_MASTER_PROMPT/);
  await runtime.analyzeChildrenwearAssets({ role: 'combination_reference', paths: [reference] });
  const combo = await runtime.generateChildrenwearCombination({
    folder: approvedFirst.folder,
    taskName: '纯棉梭织裤款式 A',
    masterPaths: [approvedFirst.masterPath, second.masterPath],
    combinationReferencePath: reference
  });
  assert.equal(combo.combinationOutputs.length, 1);
  assert.equal(second.masterApproved, false, '未审核平铺图应允许直接进入组合图阶段');
  assert.match(requestBodies[6], /CUSTOM_COMBINATION_PROMPT/);
  assert.doesNotMatch(requestBodies[6], /Images 1 to 2 are selected generated flat-lays|SYSTEM_DYNAMIC_EXECUTION_CONTRACT/);
  assert.equal(combo.combinationOutputs[0].reviewRequired, false);
  assert.equal(combo.combinationOutputs[0].reviewStatus, 'completed');
  assert.ok(combo.combinationOutputs[0].elapsedMs >= 0);
  assert.ok(combo.combinationOutputs[0].apiRequestCount >= 1);
  assert.match(combo.combinationOutputs[0].thumbnailUrl, /^\/api\/thumbnails\//);
  assert.ok(combo.combinationReferencePath.startsWith(path.join(first.folder, '素材', '组合参考图')));
  assert.ok(combo.masterPaths.every(item => item.startsWith(path.join(first.folder, '素材', '组合平铺图'))));
  assert.equal(combo.masterUrls.length, 2);
  assert.equal(combo.combinationOutputs[0].masterPaths.length, 2);
  assert.equal(combo.combinationReferenceSpec.slot_count, 2, '运营选择数量必须覆盖参考图识别出的槽位数');
  assert.equal(combo.combinationReferenceSpec.selected_sku_count, 2);
  assert.equal(combo.combinationReferenceSpec.detected_slot_count, null, '关闭 AI 分析后不得伪造参考图槽位数');
  assert.equal(combo.sourceMasterPaths.length, 2);
  assert.equal(combo.sourceTaskFolders.length, 2);
  assert.equal(combo.combinationOutputs[0].sourceMasterPaths.length, 2);
  assert.equal(combo.combinationOutputs[0].sourceTaskFolders.length, 2);
  assert.equal(combo.combinationOutputs[0].masterThumbnailUrls.length, 2);
  assert.equal(combo.combinationOutputs[0].combinationReferencePath, combo.combinationReferencePath);
  assert.match(combo.combinationOutputs[0].combinationReferenceThumbnailUrl, /^\/api\/thumbnails\//);
  assert.equal(combo.combinationOutputs[0].taskName, `${combo.taskCode} 纯棉梭织裤款式 A`);
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
  await runtime.invalidateChildrenwearAnalysisPaths([first.realPhotoPath], 'product');
  await runtime.invalidateChildrenwearAnalysisPaths([first.referencePath], 'flat_reference');
  const regenerated = await runtime.generateChildrenwearMaster({
    folder: first.folder,
    realPhotoPath: first.realPhotoPath,
    referencePath: first.referencePath,
    category: '纯棉梭织裤',
    material: '纯棉梭织'
  });
  assert.match(requestBodies[7], /CUSTOM_MASTER_PROMPT/);
  assert.doesNotMatch(requestBodies[7], /ONE_TIME_MASTER_REGENERATION_PROMPT/);
  assert.equal(regenerated.masterVersion, 2);
  assert.equal(requests, 8);
  assert.equal(analysisRequests, 2, 'only the model and combination reference workflows should use AI analysis');
  const deletion = await runtime.deleteChildrenwearTasks([first.folder]);
  assert.equal(deletion.deleted, 1);
  assert.deepEqual(deletion.folders, [first.folder]);
  assert.equal(await fs.stat(first.folder).catch(() => null), null);
  assert.equal((await runtime.listChildrenwearTasks()).some(task => task.folder === first.folder), false);
  await fs.access(second.folder);
  await assert.rejects(runtime.deleteChildrenwearTasks([outputRoot]), /只能删除童装任务根目录/);
});
