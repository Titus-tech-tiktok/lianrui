const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const sharp = require('sharp');

test('material analysis persists image/name descriptions and optional model references reach image API', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'material-generation-'));
  const bytes = await sharp({ create: { width: 128, height: 128, channels: 3, background: '#cabb99' } }).png().toBuffer();
  let analysisFailure = '';
  let plasticAttempts = 0;
  const analyses = [];
  const generations = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString('utf8');
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/v1/chat/completions') {
      if (analysisFailure) { res.statusCode = 400; return res.end(JSON.stringify({error:{message:analysisFailure}})); }
      analyses.push(JSON.parse(body));
      if (analyses.at(-1).messages[0].content.includes('POSE_REFERENCE_V1')) return res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ posePrompt: '身体朝前，头部轻向左转，右臂弯曲，左腿支撑，右腿向前迈步' }) } }] }));
      const requested = analyses.at(-1).messages[1].content[0].text;
      if (requested.includes('塑料') && ++plasticAttempts > 1) return res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ name: '模型改名', texturePrompt: '表面均匀致密，细微颗粒，光滑半哑光，轻微柔韧弯折' }) } }] }));

      return res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ name: '针织', description: '细密纵向坑条', texturePrompt: '细密纵向坑条，针织线圈，柔和哑光，柔软自然褶皱，无服装，无人物，微距摄影', uncertainty: '纤维成分无法由照片确认' }) } }] }));
    }
    generations.push(body);
    res.end(JSON.stringify({ data: [{ b64_json: bytes.toString('base64') }] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  process.env.CAISHEN_DATA_DIR = path.join(root, 'data');
  process.env.CAISHEN_WORKSPACE_ID = 'material-test';
  process.env.CAISHEN_API_BASE_URL = `http://127.0.0.1:${server.address().port}/v1`;
  process.env.CAISHEN_IMAGE_API_KEY = 'test-key';
  process.env.CAISHEN_IMAGE_MODEL = 'test-image';
  process.env.CAISHEN_IMAGE_RESPONSE_FORMAT = 'b64_json';
  process.env.CAISHEN_ANALYSIS_MODEL = 'test-vision';
  process.env.CAISHEN_IMAGE_API_START_INTERVAL_MS = '0';
  delete require.cache[require.resolve('../src/runtime')];
  const runtime = require('../src/runtime');
  t.after(async () => {
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  });
  await runtime.saveConfig({ outputPath: path.join(root, 'outputs') });
  await runtime.saveChildrenwearGenerationPromptSetting('childrenwearModelGeneration', '生成电商模特成品图');
  const assets = path.join(runtime.WORKSPACE_ROOT, 'assets', 'free');
  await fs.mkdir(assets, { recursive: true });
  const files = {};
  for (const name of ['fabric', 'top', 'bottom', 'model', 'pose']) {
    files[name] = path.join(assets, `${name}.png`);
    await fs.writeFile(files[name], bytes);
  }
  await assert.rejects(runtime.analyzeMaterial({ name: '独立名称' }), /先上传材质图片/);
  await assert.rejects(runtime.saveMaterial({ name: '独立名称', texturePrompt: '纹理' }), /先上传材质图片/);
  const material = await runtime.analyzeMaterial({ imagePath: files.fabric });
  assert.ok(material.id);
  assert.match(material.texturePrompt, /纵向坑条/);
  assert.equal(analyses[0].messages[1].content[1].type, 'image_url');
  const inferred = await runtime.analyzeMaterial({ name: '灯芯绒', imagePath: files.model, mode: 'name' });
  assert.equal(inferred.name, '灯芯绒');
  assert.equal(analyses[1].messages[1].content.length, 1);
  assert.equal((await runtime.listMaterials()).length, 2);
  const beforeReuse = analyses.length;
  const cached = await runtime.analyzeMaterial({ imagePath: files.fabric });
  assert.equal(cached.id, material.id);
  assert.equal(cached.reused, true);
  assert.equal(analyses.length, beforeReuse, 'already saved images must not call analysis API again');
  const { execFileSync } = require('node:child_process');
  const reloaded = JSON.parse(execFileSync(process.execPath, ['-e', `const r=require(${JSON.stringify(require.resolve('../src/runtime'))});r.listMaterials().then(v=>console.log(JSON.stringify(v)))`], { encoding: 'utf8', env: process.env }));
  assert.equal(reloaded.find(item => item.id === material.id).imagePath, files.fabric);
  assert.match(reloaded.find(item => item.id === material.id).texturePrompt, /纵向坑条/);
  await Promise.all([runtime.analyzeMaterial({ imagePath: files.fabric, force: true }), runtime.analyzeMaterial({ imagePath: files.fabric, force: true })]);
  assert.equal(analyses.length, beforeReuse + 1, 'concurrent reanalysis shares one API request');
  assert.equal((await runtime.listMaterials()).filter(item => item.imagePath === files.fabric).length, 1);

  assert.equal(await runtime.runWithWorkspace('other-account', async () => (await runtime.listMaterials()).length), 0);
  await assert.rejects(runtime.saveMaterial({ name: '非法', imagePath: path.join(root, 'foreign.png') }), /无效|当前账号/);
  const bottomMaterial = await runtime.saveMaterial({ name: '裤子材质B', imagePath: files.bottom, texturePrompt: '细腻平纹梭织，垂感明确' });
  const result = await runtime.generateChildrenwearModel({
    taskName: '独立模特任务', topReferencePath: files.top, bottomReferencePath: files.bottom,
    modelReferencePath: files.model, poseReferencePath: files.pose, backgroundMode: 'solid',
    materialSelections: [{ materialId: material.id, slot: 'top' }, { materialId: bottomMaterial.id, slot: 'bottom' }]
  });
  const output = result.modelOutputs.at(-1);
  assert.ok(output.topReferencePath);
  assert.ok(output.bottomReferencePath);
  assert.ok(output.poseReferencePathUrl);
  assert.match(output.poseAnalysis.posePrompt, /左腿支撑/);
  assert.match(generations[0], /左腿支撑/);
  assert.match(generations[0], /生成电商模特成品图/);
  assert.match(generations[0], /人物身份与外观取自人物模特参考/);
  const poseCalls = analyses.filter(item => item.messages[0].content.includes('POSE_REFERENCE_V1')).length;
  const reusedPose = await runtime.analyzePoseReference({ imagePath: files.pose });
  assert.equal(reusedPose.reused, true);
  assert.equal(analyses.filter(item => item.messages[0].content.includes('POSE_REFERENCE_V1')).length, poseCalls);
  assert.equal(output.materialSelections[0].id, material.id);
  assert.equal(output.materialSelections[1].id, bottomMaterial.id);
  assert.match(output.materialSelections[0].target, /图1中的上衣/);
  assert.match(output.materialSelections[1].target, /图2中的裤子/);
  assert.equal(output.materialSelections.length, 2);
  const order = JSON.parse(await fs.readFile(path.join(result.folder, '.evidence', output.id, 'input-order.json')));
  assert.deepEqual(order.imageOrder.map(item => item.roleLabel), ['上衣参考（只约束上衣）', '裤子参考（只约束下装）', '参考模特图', '人物动作参考（只约束姿态）', '材质：针织', '材质：裤子材质B']);
  assert.match(generations[0], /纵向坑条/);
  assert.doesNotMatch(generations[0], /无人物|无服装|微距摄影/, 'material reference must not introduce full-image exclusions');
  assert.match(generations[0], /图5仅作材质纹理参考/);
  const corrected = await runtime.analyzeMaterial({ id: material.id, imagePath: files.fabric, name: '羊毛呢', mode: 'name' });
  assert.equal(corrected.name, '羊毛呢', 'the model cannot override the user confirmed name');
  assert.equal(corrected.id, material.id);
  assert.equal(corrected.imagePath, files.fabric);
  assert.equal(analyses.at(-1).messages[1].content.length, 1, 'name correction must not rerun image classification');
  assert.match(analyses.at(-1).messages[0].content, /羊毛呢/);
  assert.equal((await runtime.listMaterials()).find(item => item.id === material.id).name, '羊毛呢');
  const plastic = await runtime.analyzeMaterial({ id: material.id, imagePath: files.fabric, name: '塑料', mode: 'name' });
  assert.equal(plastic.name, '塑料');
  assert.equal(plasticAttempts, 2, 'a textile response for plastic must be rejected and retried');
  assert.doesNotMatch(plastic.texturePrompt, /罗纹|针织|线圈|绒毛/);
  assert.match(analyses.at(-1).messages[1].content[0].text, /塑料/);
  assert.equal(analyses.at(-1).messages[1].content.length, 1);
  await assert.rejects(runtime.analyzeMaterial({ id: material.id, imagePath: files.fabric, name: '金属', mode: 'name' }), /未覆盖/);
  assert.equal((await runtime.listMaterials()).find(item => item.id === material.id).name, '塑料', 'invalid texture cannot overwrite the saved material');

  analysisFailure = 'No available channel for model gpt-5-6 under group gpt-image (distributor)';
  const edited = await runtime.generateChildrenwearLocalEdit({ folder: result.folder, stage: 'model', outputId: output.id, instruction: '选区改成红色', regions: [{x:.2,y:.2,width:.3,height:.3}] });
  assert.equal(edited.localEditHistory.at(-1).intentMode, 'direct_masked_edit');
  assert.equal(edited.localEditHistory.at(-1).resolvedInstruction, '选区改成红色');
  assert.match(generations.at(-1), /LOCAL_MASKED_REPAIR/);
  assert.match(generations.at(-1), /选区改成红色/);
  const beforeRejected = generations.length;
  analysisFailure = 'Invalid API key';
  await assert.rejects(runtime.generateChildrenwearLocalEdit({ folder: result.folder, stage: 'model', outputId: output.id, instruction: '选区改成蓝色', regions: [{x:.2,y:.2,width:.3,height:.3}] }), /Invalid API key/);
  assert.equal(generations.length, beforeRejected, 'auth failures must not silently fall back');
  analysisFailure = '';
  const poseOnly = await runtime.generateChildrenwearModel({ poseReferencePath: files.pose, backgroundMode: 'solid' });
  assert.ok(poseOnly.modelOutputs[0].path);
  assert.equal(poseOnly.modelOutputs[0].materialSelections.length, 0);
  await assert.rejects(runtime.generateChildrenwearModel({ folder: result.folder, topReferencePath: files.top, materialSelections: [{ materialId: 'missing', slot: 'top' }] }), /已不存在/);
});
