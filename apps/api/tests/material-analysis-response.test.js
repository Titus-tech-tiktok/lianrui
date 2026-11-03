const test = require('node:test');
const assert = require('node:assert/strict');
const { parseMaterialAnalysisJson, materialAnalysisError } = require('../src/core/materials');

test('material JSON accepts gateway escape wrappers without treating errors as descriptions', () => {
  assert.deepEqual(parseMaterialAnalysisJson('<escape>{"name":"罗纹","texturePrompt":"细密纵纹"}</escape>'), { name: '罗纹', texturePrompt: '细密纵纹' });
  assert.deepEqual(parseMaterialAnalysisJson('```json\n{"name":"棉"}\n```'), { name: '棉' });
  assert.throws(() => parseMaterialAnalysisJson('<html>upstream error</html>'), /未返回有效/);
});

test('material upload quota errors explain the actual upstream limitation', () => {
  const error = materialAnalysisError(new Error('upload_protection_limit_exceeded：你已达到文件上传上限。请23小时 内重试。'));
  assert.match(error.message, /23 小时/);
  assert.match(error.message, /不能作为图片识别结论/);
  const authError = new Error('Invalid token');
  assert.equal(materialAnalysisError(authError), authError);
});

const { garmentMaterialSlots } = require('../src/core/materials');
test('material slots exist only for garments, independent from model, pose, scene and result', () => {
  const bindings = [{imageNumber:1,roleLabel:'上衣参考（只约束上衣）'}, {imageNumber:2,roleLabel:'裤子参考（只约束下装）'}, {imageNumber:3,roleLabel:'参考模特图'}, {imageNumber:4,roleLabel:'人物动作参考（只约束姿态）'}, {imageNumber:5,roleLabel:'场景参考图'}];
  assert.deepEqual(garmentMaterialSlots(bindings, 'model').map(item => item.slot), ['top','bottom']);
  assert.deepEqual(garmentMaterialSlots(bindings, 'model', 'scene_only'), []);
  assert.deepEqual(garmentMaterialSlots([{imageNumber:1,roleLabel:'实拍产品图'},{imageNumber:2,roleLabel:'成品参考图'}], 'master').map(item => item.slot), ['garment']);
  assert.deepEqual(garmentMaterialSlots(bindings.slice(2), 'model'), []);
});

test('material names and generation prompts omit discarded uncertainty fields', () => {
  const { normalizeMaterial, materialPrompt } = require('../src/core/materials');
  const saved = normalizeMaterial({ name: '细罗纹针织（外观推测）', description: '旧外观说明', texturePrompt: '纵向细罗纹，柔和哑光', uncertainty: '旧的不确定信息' });
  assert.equal(saved.name, '细罗纹针织');
  assert.equal(saved.description, saved.texturePrompt);
  assert.equal(saved.uncertainty, undefined);
  assert.doesNotMatch(materialPrompt({ ...saved, uncertainty: '不要进入提示词' }, '上衣', 3), /不要进入提示词|不确定性/);
});

test('texture attributes cannot suppress people, clothing, prints or scene in a clothing task', () => {
  const { normalizeMaterial, materialPrompt } = require('../src/core/materials');
  const raw = { name: '细罗纹针织', texturePrompt: '细密纵向罗纹，轻微短绒，柔和哑光，无光泽，柔软自然垂坠，真实纺织品微距摄影，高清织物表面细节，无颜色限定，无印花，无图案，无服装，无人物，无背景干扰' };
  const material = normalizeMaterial(raw);
  assert.equal(material.texturePrompt, '细密纵向罗纹，轻微短绒，柔和哑光，无光泽，柔软自然垂坠');
  const prompt = materialPrompt(raw, '图1中的上衣', 5);
  assert.match(prompt, /细密纵向罗纹/);
  assert.doesNotMatch(prompt, /无人物|无服装|无印花|无图案|背景干扰|摄影|高清/);
});
