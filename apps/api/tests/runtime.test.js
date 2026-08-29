const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

test('本地工作区配置可以保存并重新读取', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'caishen-web-'));
  process.env.CAISHEN_DATA_DIR = temp;
  process.env.CAISHEN_WORKSPACE_ID = 'test';
  const runtimePath = require.resolve('../src/runtime');
  delete require.cache[runtimePath];
  const runtime = require('../src/runtime');
  await runtime.initializeRuntime();
  const outputPath = path.join(temp, '主电脑成品输出');
  await runtime.saveConfig({
    operatorCode: 'web',
    auditMode: 'quality',
    outputPath,
    childrenwearAutoAnalysisEnabled: true,
    childrenwearAutoAnalysisIntervalMinutes: 10
  });
  const config = await runtime.loadConfig();
  assert.equal(config.operatorCode, 'web');
  assert.equal(config.auditMode, 'quality');
  assert.equal(config.outputPath, outputPath);
  assert.equal(config.childrenwearAutoAnalysisEnabled, true);
  assert.equal(config.childrenwearAutoAnalysisIntervalMinutes, 10);
  assert.equal((await runtime.scanPendingChildrenwearAnalysis()).total, 0);
  assert.equal((await fs.stat(outputPath)).isDirectory(), true);
  const externalImage = path.join(outputPath, '预览.png');
  await fs.writeFile(externalImage, Buffer.from('preview'));
  assert.equal(runtime.fileFromToken(runtime.fileToken(externalImage)), externalImage);
  const defaults = await runtime.loadPromptSettings();
  assert.deepEqual(defaults.prompts, []);
  await runtime.savePromptSetting('childrenwearMasterGeneration', '保持童装商品结构不变');
  let prompts = await runtime.loadPromptSettings();
  assert.equal(prompts.prompts.find(item => item.id === 'childrenwearMasterGeneration').value, '保持童装商品结构不变');
  assert.equal(prompts.prompts.find(item => item.id === 'childrenwearMasterGeneration').customized, true);
  await runtime.resetPromptSetting('childrenwearMasterGeneration');
  prompts = await runtime.loadPromptSettings();
  assert.equal(prompts.prompts.some(item => item.id === 'childrenwearMasterGeneration'), false);
  assert.equal(prompts.stageBindings.master, '');
  await fs.rm(temp, { recursive: true, force: true });
});
