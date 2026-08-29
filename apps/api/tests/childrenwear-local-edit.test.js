const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const sharp = require('sharp');

const {
  childrenwearLocalEditPrompt,
  childrenwearLocalEditSelectionBounds,
  compositeChildrenwearLocalEdit,
  createChildrenwearLocalEditAnalysisPreview,
  createChildrenwearLocalEditMask,
  normalizeChildrenwearLocalEditIntent,
  normalizeChildrenwearLocalEditSelection
} = require('../src/runtime');

test('local edit selection normalizes valid shapes and rejects an empty selection', () => {
  const selection = normalizeChildrenwearLocalEditSelection({
    regions: [{ x: -1, y: .2, width: .5, height: 2 }],
    strokes: [{ radius: .5, points: [[-.2, 1.4], [.8, .6]] }]
  });
  assert.deepEqual(selection.regions, [{ x: 0, y: .2, width: .5, height: .8 }]);
  assert.equal(selection.strokes[0].radius, .12);
  assert.deepEqual(selection.strokes[0].points, [[0, 1], [.8, .6]]);
  assert.throws(() => normalizeChildrenwearLocalEditSelection({}), /框选或涂抹/);
});

test('local edit mask exposes only the selected area and compositing preserves every outside pixel', async t => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-local-edit-'));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const width = 100;
  const height = 80;
  const sourcePath = path.join(folder, 'source.png');
  const maskPath = path.join(folder, 'mask.png');
  await sharp({ create: { width, height, channels: 3, background: { r: 220, g: 20, b: 30 } } }).png().toFile(sourcePath);
  const selection = normalizeChildrenwearLocalEditSelection({ regions: [{ x: .25, y: .25, width: .5, height: .5 }] });
  await createChildrenwearLocalEditMask(sourcePath, selection, maskPath);

  const { data: mask, info: maskInfo } = await sharp(maskPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const alphaAt = (x, y) => mask[(y * maskInfo.width + x) * maskInfo.channels + 3];
  assert.equal(alphaAt(5, 5), 255, 'outside the selection must be opaque/protected');
  assert.equal(alphaAt(50, 40), 0, 'inside the selection must be transparent/editable');

  const generated = await sharp({ create: { width, height, channels: 3, background: { r: 10, g: 40, b: 230 } } }).png().toBuffer();
  const result = await compositeChildrenwearLocalEdit(sourcePath, generated, maskPath);
  const { data, info } = await sharp(result).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixelAt = (x, y) => [...data.subarray((y * info.width + x) * 3, (y * info.width + x) * 3 + 3)];
  assert.deepEqual(pixelAt(5, 5), [220, 20, 30], 'outside pixels must remain byte-identical to the current result');
  assert.deepEqual(pixelAt(50, 40), [10, 40, 230], 'the selected interior must use the repaired result');
});

test('a closed brush loop edits its enclosed object while an open stroke remains a brush stroke', async t => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-local-edit-loop-'));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const sourcePath = path.join(folder, 'source.png');
  await sharp({ create: { width: 200, height: 200, channels: 3, background: '#ffffff' } }).png().toFile(sourcePath);

  const closedMaskPath = path.join(folder, 'closed.png');
  const closed = normalizeChildrenwearLocalEditSelection({
    strokes: [{ radius: .02, points: [[.35, .35], [.65, .35], [.68, .5], [.65, .65], [.35, .65], [.32, .5], [.35, .35]] }]
  });
  await createChildrenwearLocalEditMask(sourcePath, closed, closedMaskPath);
  const closedMask = await sharp(closedMaskPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const closedAlpha = (x, y) => closedMask.data[(y * closedMask.info.width + x) * closedMask.info.channels + 3];
  assert.equal(closedAlpha(100, 100), 0, 'the interior of a circled object must be editable');
  assert.equal(closedAlpha(10, 10), 255, 'pixels outside the circled object stay protected');

  const openMaskPath = path.join(folder, 'open.png');
  const open = normalizeChildrenwearLocalEditSelection({
    strokes: [{ radius: .02, points: [[.35, .35], [.65, .35], [.68, .5], [.65, .65]] }]
  });
  await createChildrenwearLocalEditMask(sourcePath, open, openMaskPath);
  const openMask = await sharp(openMaskPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const openAlpha = (x, y) => openMask.data[(y * openMask.info.width + x) * openMask.info.channels + 3];
  assert.equal(openAlpha(100, 100), 255, 'an open brush stroke must not silently unlock its whole bounding box');
});

test('local edit intent turns a short operator instruction into a semantic object edit', () => {
  const intent = normalizeChildrenwearLocalEditIntent({
    target_object: '右裤腿上方的黄色恐龙刺绣',
    target_evidence: '青色选区中心覆盖黄色恐龙图案，周围是深蓝色棉布',
    operation: 'recolor',
    requested_result: '将恐龙刺绣主体改为红色',
    expanded_instruction: '只把右裤腿上方黄色恐龙刺绣改为红色，保持刺绣轮廓、针脚、大小、位置和周围深蓝色面料不变。',
    preserve_inside_selection: ['深蓝色面料', '刺绣轮廓和针脚'],
    forbidden_changes: ['不得把整个选区填成红色', '不得移动或放大刺绣'],
    confidence: 0.96
  }, '换成红色');
  const prompt = childrenwearLocalEditPrompt('master', '换成红色', 3, intent);
  assert.equal(intent.targetObject, '右裤腿上方的黄色恐龙刺绣');
  assert.match(prompt, /permission boundary/);
  assert.match(prompt, /not a paint bucket/);
  assert.match(prompt, /黄色恐龙刺绣/);
  assert.match(prompt, /不得把整个选区填成红色/);
  assert.match(prompt, /只把右裤腿上方黄色恐龙刺绣改为红色/);
});

test('replacement intent makes the new object explicit and overrides conflicting product references', () => {
  const intent = normalizeChildrenwearLocalEditIntent({
    target_object: '米白色裤腿上的绿色恐龙印花',
    target_evidence: '选区完整覆盖绿色恐龙图案',
    operation: 'replace',
    requested_result: '把绿色恐龙印花替换为白云图案',
    replacement_object: '白色云朵印花',
    replacement_appearance: '一朵轮廓清楚、横向展开、具有三个圆润云瓣的白色云朵，与原印花大小相近',
    replacement_extent: '完整移除绿色恐龙，在原图案中心和近似占位范围内放置白云',
    expanded_instruction: '完整移除选区中的绿色恐龙，只在相同中心和近似大小处生成一朵轮廓清晰的白色云朵印花。',
    preserve_inside_selection: ['米白色棉布纹理', '原有褶皱和光影'],
    forbidden_changes: ['不得留下恐龙残影', '不得生成白点或无语义色块'],
    confidence: .98
  }, '换成白云');
  const prompt = childrenwearLocalEditPrompt('master', '换成白云', 3, intent);
  assert.equal(intent.schemaVersion, '2.0');
  assert.equal(intent.replacementObject, '白色云朵印花');
  assert.match(prompt, /operator correction request has highest priority/i);
  assert.match(prompt, /白色云朵印花/);
  assert.match(prompt, /three|三个圆润云瓣/);
  assert.match(prompt, /No old-object remnants, abstract blobs, dots or placeholder marks/);
  assert.match(prompt, /Do not restore the old product motif/);
});

test('local edit analysis preview highlights the selection while preserving an unmarked source and creates a focused crop', async t => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'cw-local-edit-preview-'));
  t.after(() => fs.rm(folder, { recursive: true, force: true }));
  const sourcePath = path.join(folder, 'source.png');
  const maskPath = path.join(folder, 'mask.png');
  const previewPath = path.join(folder, 'preview.png');
  const cropPath = path.join(folder, 'crop.png');
  await sharp({ create: { width: 240, height: 180, channels: 3, background: { r: 15, g: 35, b: 75 } } }).png().toFile(sourcePath);
  const selection = normalizeChildrenwearLocalEditSelection({
    strokes: [{ radius: .04, points: [[.45, .45], [.55, .55]] }]
  });
  await createChildrenwearLocalEditMask(sourcePath, selection, maskPath);
  const result = await createChildrenwearLocalEditAnalysisPreview(sourcePath, selection, maskPath, previewPath, cropPath);
  const bounds = childrenwearLocalEditSelectionBounds(selection);
  assert.ok(bounds.width > .1 && bounds.width < .5);
  assert.deepEqual(result.bounds, bounds);
  const sourceOutside = await sharp(sourcePath).extract({ left: 5, top: 5, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
  const previewOutside = await sharp(previewPath).extract({ left: 5, top: 5, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
  assert.deepEqual([...previewOutside], [...sourceOutside], 'analysis overlay must not alter pixels outside the operator selection');
  const sourceInside = await sharp(sourcePath).extract({ left: 120, top: 90, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
  const previewInside = await sharp(previewPath).extract({ left: 120, top: 90, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
  assert.notDeepEqual([...previewInside], [...sourceInside], 'analysis preview should visibly mark the selected area for the vision model');
  const cropMetadata = await sharp(cropPath).metadata();
  assert.ok(cropMetadata.width > 0 && cropMetadata.height > 0);
});
