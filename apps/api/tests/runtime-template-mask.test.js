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

