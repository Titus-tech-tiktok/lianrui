'use strict';

const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env'), quiet: true });

const runtime = require('../src/runtime');

async function main() {
  const [sourceRealPhotoPath, sourceReferencePath, sourceModelReferencePath] = process.argv.slice(2).map(value => path.resolve(value || ''));
  for (const [label, file] of [
    ['实拍图', sourceRealPhotoPath],
    ['成品参考图', sourceReferencePath],
    ['模特参考图', sourceModelReferencePath]
  ]) {
    if (!file || !fs.existsSync(file)) throw new Error(`${label}不存在：${file || '(未提供)'}`);
  }

  await runtime.initializeRuntime();
  await runtime.saveApiSettings({
    activeRelayId: 'xiaokonglong',
    responseFormat: process.env.CAISHEN_IMAGE_RESPONSE_FORMAT || 'url',
    requestTimeoutSeconds: 300,
    imageInitialConcurrency: 1,
    imageMaxConcurrency: 4,
    imageStartIntervalMs: 800,
    relays: [{
      id: 'xiaokonglong',
      name: '小恐龙中转站',
      description: '沿用永沙项目已验证的 KL API 图像线路',
      enabled: true,
      baseUrl: process.env.CAISHEN_API_BASE_URL,
      imageApiKey: process.env.CAISHEN_IMAGE_API_KEY,
      imageModel: process.env.CAISHEN_IMAGE_MODEL || 'gpt-image-2',
      analysisModel: process.env.CAISHEN_ANALYSIS_MODEL || 'gpt-5-6',
      healthPath: '/models',
      modelsPath: '/models'
    }]
  });
  const api = await runtime.loadApiSettings();
  if (!api.imageConfigured) throw new Error('生图接口尚未配置');
  await runtime.saveConfig({
    outputPath: path.resolve(__dirname, '../../../output'),
    imageSize: '1024x1024',
    imageQuality: 'high'
  });

  // Match the browser upload flow: source files are copied into the signed
  // workspace boundary before runtime methods return preview URLs.
  const assetRoot = path.join(runtime.WORKSPACE_ROOT, 'assets', 'childrenwear-live-smoke');
  fs.mkdirSync(assetRoot, { recursive: true });
  const realPhotoPath = path.join(assetRoot, `real${path.extname(sourceRealPhotoPath) || '.jpg'}`);
  const referencePath = path.join(assetRoot, `reference${path.extname(sourceReferencePath) || '.jpg'}`);
  const modelReferencePath = path.join(assetRoot, `model${path.extname(sourceModelReferencePath) || '.jpg'}`);
  fs.copyFileSync(sourceRealPhotoPath, realPhotoPath);
  fs.copyFileSync(sourceReferencePath, referencePath);
  fs.copyFileSync(sourceModelReferencePath, modelReferencePath);

  await runtime.analyzeChildrenwearAssets({ role: 'product', paths: [realPhotoPath] }, { reportProgress: event => process.stdout.write(`[实拍分析] ${event.message}\n`) });
  await runtime.analyzeChildrenwearAssets({ role: 'flat_reference', paths: [referencePath] }, { reportProgress: event => process.stdout.write(`[平铺参考分析] ${event.message}\n`) });
  await runtime.analyzeChildrenwearAssets({ role: 'model_reference', paths: [modelReferencePath] }, { reportProgress: event => process.stdout.write(`[模特参考分析] ${event.message}\n`) });

  process.stdout.write(`接口：${api.activeRelayName || '小恐龙中转站'} / ${api.configured ? '已配置' : '未配置'}\n`);
  let master;
  const resumeFolder = String(process.env.CHILDRENWEAR_RESUME_FOLDER || '').trim();
  if (resumeFolder) {
    const metadataPath = path.join(path.resolve(resumeFolder), 'childrenwear-task.json');
    master = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    master.realPhotoPath = realPhotoPath;
    master.referencePath = referencePath;
    fs.writeFileSync(metadataPath, JSON.stringify(master, null, 2), 'utf8');
    process.stdout.write(`复用已生成母版：${master.masterPath}\n`);
  } else {
    master = await runtime.generateChildrenwearMaster({
      realPhotoPath,
      referencePath,
      category: '纯棉梭织裤',
      material: '纯棉梭织',
      craft: '保留真实布纹、缝线、松紧腰和自然褶皱',
      extraInstruction: '生成适合童装电商使用的正方形平铺母版，不添加文字、吊牌或额外配饰。'
    }, { reportProgress: event => process.stdout.write(`[母版] ${event.percent}% ${event.message}\n`) });
  }
  process.stdout.write(`母版完成：${master.masterPath}\n`);

  const approved = await runtime.approveChildrenwearOutput({ folder: master.folder, stage: 'master', approved: true });
  process.stdout.write(`母版审核：${approved.masterApproved ? '通过' : '未通过'}\n`);
  const model = await runtime.generateChildrenwearModel({
    folder: master.folder,
    modelReferencePath,
    extraInstruction: '保持参考图的构图与姿势，画面简洁，不添加文字。'
  }, { reportProgress: event => process.stdout.write(`[模特] ${event.percent}% ${event.message}\n`) });
  process.stdout.write(`模特图完成：${model.modelOutputs.at(-1)?.path || ''}\n`);
}

main().catch(error => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
