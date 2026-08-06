const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const runtime = require('../src/runtime');

function analysisWithPanel() {
  return JSON.stringify({
    version: 4,
    processingMode: 'replace_print',
    action: 'replace_print',
    printableSurfaces: [{
      id: 'front-panel',
      label: 'drawer front',
      polygon: [[0.25, 0.25], [0.75, 0.25], [0.75, 0.75], [0.25, 0.75]]
    }]
  });
}

test('template edit mask has a real transparent cut-out and protected opaque pixels', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'caishen-mask-alpha-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const templatePath = path.join(root, 'detail.png');
  await sharp({ create: { width: 100, height: 120, channels: 3, background: '#cc3322' } }).png().toFile(templatePath);
  const job = { templatePath, templateRoot: root, relativePath: '详情/detail.png' };
  const maskPath = await runtime.createTemplateEditMask(job, analysisWithPanel());
  assert.ok(maskPath);
  const { data, info } = await sharp(maskPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const alphaAt = (x, y) => data[(y * info.width + x) * info.channels + 3];
  assert.equal(alphaAt(0, 0), 255);
  assert.equal(alphaAt(50, 60), 0);
  assert.equal(alphaAt(25, 30), 255, 'panel outline is inset to preserve seams and frames');
});

test('masked result preserves every template pixel outside editable panels', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'caishen-mask-composite-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const templatePath = path.join(root, 'detail.png');
  await sharp({ create: { width: 100, height: 120, channels: 3, background: '#cc3322' } }).png().toFile(templatePath);
  const job = { templatePath, templateRoot: root, relativePath: '详情/detail.png' };
  const maskPath = await runtime.createTemplateEditMask(job, analysisWithPanel());
  const generated = await sharp({ create: { width: 128, height: 128, channels: 3, background: '#2266dd' } }).png().toBuffer();
  const output = await runtime.compositeTemplateEditResult(job, generated, maskPath);
  const { data, info } = await sharp(output).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const rgbAt = (x, y) => Array.from(data.subarray((y * info.width + x) * 3, (y * info.width + x) * 3 + 3));
  assert.deepEqual(rgbAt(0, 0), [204, 51, 34]);
  assert.deepEqual(rgbAt(50, 60), [34, 102, 221]);
  assert.deepEqual(rgbAt(99, 119), [204, 51, 34]);
  assert.equal(info.width, 100);
  assert.equal(info.height, 120);
});

test('local panel detection keeps cabinet surfaces cropped by an image edge', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'caishen-cropped-panel-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const templatePath = path.join(root, 'cropped-detail.png');
  await sharp({ create: { width: 120, height: 160, channels: 3, background: '#201b18' } })
    .composite([{ input: { create: { width: 76, height: 116, channels: 3, background: '#ddd8cf' } }, left: 22, top: 44 }])
    .png()
    .toFile(templatePath);
  const surfaces = await runtime.detectTemplateLightCabinetPanels(templatePath);
  assert.ok(surfaces.length >= 1);
  assert.equal(surfaces.some(surface => surface.polygon.some(([, y]) => y === 1)), true);
});

test('partial local detections never constrain open, cropped or multi-grid generation', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'caishen-local-mask-bypass-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const templatePath = path.join(root, 'open-drawers.png');
  await sharp({ create: { width: 100, height: 120, channels: 3, background: '#ddd8cf' } }).png().toFile(templatePath);
  const analysis = JSON.stringify({
    version: 11,
    processingMode: 'replace_print',
    printableSurfaces: [{
      id: 'local-panel-1',
      label: 'only one detected drawer front',
      polygon: [[0.3, 0.2], [0.7, 0.2], [0.7, 0.35], [0.3, 0.35]]
    }]
  });
  assert.equal(await runtime.createTemplateEditMask({ templatePath, templateRoot: root, relativePath: '详情/open.png' }, analysis), '');
});
