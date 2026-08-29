const test = require('node:test');
const assert = require('node:assert/strict');

const runtime = require('../src/runtime');

test('flat-lay API inputs follow task-card order and ignore legacy preset role order', () => {
  const result = runtime.orderedChildrenwearGenerationInputs({
    id: 'childrenwearMasterGeneration',
    prompt: '图1保持商品事实，图2参考构图',
    imageOrder: ['flat_reference', 'real_product']
  }, [
    { label: '实拍产品图', path: 'C:\\workspace\\real.png' },
    { label: '成品参考图', path: 'C:\\workspace\\reference.png' },
    { label: '实拍局部细节图', paths: ['C:\\workspace\\detail-a.png', 'C:\\workspace\\detail-b.png'] }
  ]);
  assert.deepEqual(result.inputPaths.map(value => value.split('\\').pop()), [
    'real.png', 'reference.png', 'detail-a.png', 'detail-b.png'
  ]);
  assert.deepEqual(result.bindings.map(item => item.roleLabel), [
    '实拍产品图', '成品参考图', '实拍局部细节图', '实拍局部细节图'
  ]);
  assert.match(result.prompt, /严格按照任务卡片从左到右上传/);
  assert.match(result.prompt, /右侧结果图占位不计入编号/);
  assert.match(result.prompt, /图1保持商品事实，图2参考构图/);
});

test('multi-SKU card inputs expand consecutively before the reference image', () => {
  const result = runtime.orderedChildrenwearGenerationInputs({
    id: 'childrenwearCombinationGeneration',
    prompt: '按图1的组合方式排版',
    imageOrder: ['combination_reference', 'selected_flat_lays']
  }, [
    { label: '所选平铺图', paths: ['C:\\workspace\\sku-a.png', 'C:\\workspace\\sku-b.png'] },
    { label: '组合参考图', path: 'C:\\workspace\\layout.png' }
  ]);
  assert.deepEqual(result.inputPaths.map(value => value.split('\\').pop()), ['sku-a.png', 'sku-b.png', 'layout.png']);
  assert.deepEqual(result.bindings.map(item => item.imageNumber), [1, 2, 3]);
  assert.deepEqual(result.bindings.map(item => item.roleId), [
    'card_position', 'card_position', 'card_position'
  ]);
});

test('a card may contain a single input image', () => {
  const result = runtime.orderedChildrenwearGenerationInputs({
    id: 'childrenwearMasterGeneration',
    prompt: '只参考实拍商品',
    imageOrder: ['real_product']
  }, [{ label: '实拍产品图', path: 'C:\\workspace\\real.png' }]);
  assert.deepEqual(result.inputPaths, ['C:\\workspace\\real.png']);
  assert.equal(result.bindings[0].imageNumber, 1);
});

test('generation rejects a task card without any available input image', () => {
  assert.throws(() => runtime.orderedChildrenwearGenerationInputs({
    id: 'childrenwearMasterGeneration', prompt: 'test', imageOrder: []
  }, []), /没有可发送的图片/);
});
