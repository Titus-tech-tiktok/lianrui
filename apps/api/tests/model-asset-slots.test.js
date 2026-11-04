const test = require('node:test');
const assert = require('node:assert/strict');

test('asset clicks fill top, pants, model and pose on one active outfit task', async () => {
  const { modelAssetSlot, selectModelAssetDraft, assignModelAsset, nextModelAssetSlot } = await import('../../web/src/model-asset-slots.mjs');
  const task = { id: 'outfit', reference: { path: 'fixed-model.png' }, operationType: 'dress', materialSelections: [{ slot: 'top', materialId: 'A' }, { slot: 'bottom', materialId: 'B' }] };
  const tasks = [task];
  let selectedSlot = 'top';
  for (const [sourceRole, path, expectedSlot] of [['master', 'shirt.png', 'top'], ['master', 'pants.png', 'bottom'], ['reference', 'model.png', 'reference'], ['reference', 'pose.png', 'pose']]) {
    const target = selectModelAssetDraft(tasks, 'outfit');
    assert.equal(target, task, 'reuse the active task even when a fixed model makes it ready');
    const slot = modelAssetSlot(sourceRole, selectedSlot);
    assert.equal(slot, expectedSlot);
    assignModelAsset(target, slot, { path });
    selectedSlot = nextModelAssetSlot(slot);
  }
  assert.equal(tasks.length, 1);
  assert.equal(task.top.path, 'shirt.png');
  assert.equal(task.bottom.path, 'pants.png');
  assert.equal(task.reference.path, 'model.png');
  assert.equal(task.pose.path, 'pose.png');
  assert.equal(task.master, undefined, 'separate garment assets must not become separate whole-product inputs');
});

test('asset editing preserves unrelated garment materials and requires an explicit target for completed tasks', async () => {
  const { selectModelAssetDraft, assignModelAsset } = await import('../../web/src/model-asset-slots.mjs');
  const task = { id: 'done', operationType: 'dress', result: { path: 'result.png' }, top: { path: 'shirt.png' }, materialSelections: [{ slot: 'top', materialId: 'A' }, { slot: 'bottom', materialId: 'B' }] };
  assert.equal(selectModelAssetDraft([task], 'done'), null);
  assert.equal(selectModelAssetDraft([task], 'done', true), task);
  assignModelAsset(task, 'reference', { path: 'new-model.png' });
  assert.equal(task.materialSelections.length, 2);
  assignModelAsset(task, 'top', { path: 'new-shirt.png' });
  assert.deepEqual(task.materialSelections, [{ slot: 'bottom', materialId: 'B' }]);
  task.status = '生成中';
  assert.equal(selectModelAssetDraft([task], 'done', true), null);
});
