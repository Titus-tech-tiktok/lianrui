const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const runtime = require('../src/runtime');
const templateMask = require('../src/core/template-mask');

test('runtime exposes only template helpers used by the four-image request flow', () => {
  assert.equal(runtime.createTemplateEditMask, templateMask.createTemplateEditMask);
  assert.equal(runtime.detectTemplateLightCabinetPanels, templateMask.detectTemplateLightCabinetPanels);
  assert.equal(runtime.hasSemanticPrintableSurfaces, templateMask.hasSemanticPrintableSurfaces);
  assert.equal(runtime.createTemplatePostCompositeMask, undefined);
  assert.equal(runtime.compositeTemplateEditResult, undefined);
  assert.equal(runtime.validateTemplatePrintCoverage, undefined);
});

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
  const maskPath = await templateMask.createTemplateEditMask(job, analysisWithPanel());
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
  const maskPath = await templateMask.createTemplateEditMask(job, analysisWithPanel());
  const generated = await sharp({ create: { width: 128, height: 128, channels: 3, background: '#2266dd' } }).png().toBuffer();
  const output = await templateMask.compositeTemplateEditResult(job, generated, maskPath);
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
  const surfaces = await templateMask.detectTemplateLightCabinetPanels(templatePath);
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
  assert.equal(await templateMask.createTemplateEditMask({ templatePath, templateRoot: root, relativePath: '详情/open.png' }, analysis), '');
});

test('only semantic panel polygons are trusted for structure-preserving generation', () => {
  assert.equal(templateMask.hasSemanticPrintableSurfaces({
    printableSurfaces: [{ id: 'local-panel-1', polygon: [[0.1, 0.1], [0.4, 0.1], [0.4, 0.4], [0.1, 0.4]] }]
  }), false);
  assert.equal(templateMask.hasSemanticPrintableSurfaces({
    printableSurfaces: [{ id: 'drawer-front-1', polygon: [[0.1, 0.1], [0.4, 0.1], [0.4, 0.4], [0.1, 0.4]] }]
  }), true);
});

test('manual coarse region creates an ROI-only post-composite mask and red-box annotation', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'caishen-manual-region-mask-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const templatePath = path.join(root, 'detail.png');
  await sharp({ create: { width: 160, height: 200, channels: 3, background: '#292724' } })
    .composite([
      { input: { create: { width: 90, height: 120, channels: 3, background: '#dedbd4' } }, left: 35, top: 40 },
      { input: { create: { width: 90, height: 3, channels: 3, background: '#44413d' } }, left: 35, top: 99 }
    ])
    .png()
    .toFile(templatePath);
  const analysis = JSON.stringify({
    version: 11,
    processingMode: 'replace_print',
    replace_regions: [{ x: 0.15, y: 0.12, width: 0.7, height: 0.75 }],
    protected_regions: [{ x: 0.42, y: 0.2, width: 0.16, height: 0.08 }]
  });
  const job = { templatePath, templateRoot: root, relativePath: '详情/detail.png' };
  const maskPath = await templateMask.createTemplateEditMask(job, analysis);
  const annotationPath = await templateMask.createTemplateRegionAnnotation(job, analysis);
  assert.ok(maskPath);
  assert.ok(annotationPath);
  const mask = await sharp(maskPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const alphaAt = (x, y) => mask.data[(y * mask.info.width + x) * mask.info.channels + 3];
  assert.equal(alphaAt(80, 80), 0, 'the semantic ROI is editable');
  assert.equal(alphaAt(80, 100), 0, 'local seam detection does not narrow the manual ROI');
  assert.equal(alphaAt(8, 8), 255, 'pixels outside the coarse region stay protected');
  const annotation = await sharp(annotationPath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let redPixels = 0;
  let cyanPixels = 0;
  for (let index = 0; index < annotation.data.length; index += annotation.info.channels) {
    if (annotation.data[index] > 220 && annotation.data[index + 1] < 110 && annotation.data[index + 2] < 110) redPixels += 1;
    if (annotation.data[index] < 80 && annotation.data[index + 1] > 140 && annotation.data[index + 2] > 150) cyanPixels += 1;
  }
  assert.ok(redPixels > 0, 'annotation contains visible red ROI borders');
  assert.ok(cyanPixels > 0, 'annotation contains visible cyan hardware-protection borders');
});

test('coarse request mask stays continuous while post-composite mask restores seams and labels', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'caishen-continuous-mask-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const templatePath = path.join(root, 'lighting-and-label.png');
  await sharp({ create: { width: 200, height: 240, channels: 3, background: '#282420' } })
    .composite([
      { input: { create: { width: 130, height: 170, channels: 3, background: '#dedbd4' } }, left: 35, top: 35 },
      { input: { create: { width: 12, height: 110, channels: 3, background: '#ffffff' } }, left: 68, top: 50 },
      { input: { create: { width: 12, height: 110, channels: 3, background: '#777777' } }, left: 92, top: 50 },
      { input: { create: { width: 130, height: 4, channels: 3, background: '#37322e' } }, left: 35, top: 116 },
      { input: { create: { width: 42, height: 24, channels: 3, background: '#a85f32' } }, left: 112, top: 67 },
      { input: { create: { width: 16, height: 6, channels: 3, background: '#ffffff' } }, left: 125, top: 76 }
    ])
    .png()
    .toFile(templatePath);
  const analysis = JSON.stringify({
    version: 11,
    processingMode: 'replace_print',
    replace_regions: [{ x: 0.12, y: 0.1, width: 0.76, height: 0.8 }]
  });
  const job = { templatePath, templateRoot: root, relativePath: 'detail/lighting-and-label.png' };
  const maskPath = await templateMask.createTemplateEditMask(job, analysis);
  const postMaskPath = await templateMask.createTemplatePostCompositeMask(job, analysis, maskPath);
  assert.ok(maskPath);
  assert.ok(postMaskPath);
  const mask = await sharp(maskPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const postMask = await sharp(postMaskPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const alphaAt = (x, y) => mask.data[(y * mask.info.width + x) * mask.info.channels + 3];
  const postAlphaAt = (x, y) => postMask.data[(y * postMask.info.width + x) * postMask.info.channels + 3];
  assert.equal(alphaAt(72, 72), 0, 'overexposed highlight remains editable');
  assert.equal(alphaAt(96, 72), 0, 'soft shadow remains editable');
  assert.equal(alphaAt(84, 117), 0, 'drawer seams remain inside semantic model guidance');
  assert.equal(alphaAt(118, 72), 0, 'labels inside the ROI are preserved by model semantics');
  assert.equal(alphaAt(130, 78), 0, 'occluding text remains inside model semantic guidance');
  assert.equal(postAlphaAt(72, 72), 0, 'post-processing accepts generated print on the cabinet front');
  assert.equal(postAlphaAt(84, 117), 255, 'post-processing restores the original drawer seam');
  assert.equal(postAlphaAt(118, 72), 255, 'post-processing restores the original colored label');
  assert.equal(postAlphaAt(130, 78), 255, 'post-processing restores text inside the label');
  assert.equal(postAlphaAt(28, 72), 255, 'post-processing rejects generated pixels on background inside the coarse ROI');

  const preview = await templateMask.createTemplateMaskPreview(job, analysis, maskPath);
  assert.equal(preview.passed, true);
  assert.ok(preview.regions[0].editablePercent > 0);
  await fs.access(preview.previewPath);
});

test('post-composite refinement failure falls back without blocking a large manual ROI', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'caishen-post-mask-fallback-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const templatePath = path.join(root, 'uniform-close-up.png');
  await sharp({ create: { width: 160, height: 240, channels: 3, background: '#d8d1c8' } }).png().toFile(templatePath);
  const analysis = JSON.stringify({
    version: 11,
    processingMode: 'replace_print',
    replace_regions: [{ x: 0.01, y: 0.01, width: 0.98, height: 0.98 }]
  });
  const job = { templatePath, templateRoot: root, relativePath: 'detail/uniform-close-up.png' };
  const coarseMaskPath = await templateMask.createTemplateEditMask(job, analysis);
  const postMaskPath = await templateMask.createTemplatePostCompositeMask(job, analysis, coarseMaskPath);
  assert.ok(coarseMaskPath);
  assert.ok(postMaskPath);
  await fs.access(postMaskPath);
});

test('generated print can complete a light cabinet front just outside a coarse ROI', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'caishen-post-mask-extension-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const templatePath = path.join(root, 'coarse-box.png');
  await sharp({ create: { width: 200, height: 160, channels: 3, background: '#332d29' } })
    .composite([{ input: { create: { width: 120, height: 70, channels: 3, background: '#dedbd4' } }, left: 50, top: 45 }])
    .png()
    .toFile(templatePath);
  const generated = await sharp({ create: { width: 200, height: 160, channels: 3, background: '#332d29' } })
    .composite([{ input: { create: { width: 120, height: 70, channels: 3, background: '#1297d4' } }, left: 50, top: 45 }])
    .png()
    .toBuffer();
  const analysis = JSON.stringify({
    version: 11,
    processingMode: 'replace_print',
    replace_regions: [{ x: 0.2, y: 0.2, width: 0.55, height: 0.6 }]
  });
  const job = { templatePath, templateRoot: root, relativePath: 'main/coarse-box.png' };
  const coarseMaskPath = await templateMask.createTemplateEditMask(job, analysis);
  const postMaskPath = await templateMask.createTemplatePostCompositeMask(job, analysis, coarseMaskPath, generated);
  const mask = await sharp(postMaskPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const alphaAt = (x, y) => mask.data[(y * mask.info.width + x) * mask.info.channels + 3];
  assert.equal(alphaAt(100, 80), 0, 'printed panel remains editable inside the coarse ROI');
  assert.equal(alphaAt(160, 80), 0, 'the same printed panel can continue beyond the rough box');
  assert.equal(alphaAt(185, 80), 255, 'unrelated background outside the expanded panel remains protected');
});

test('large manual ROI is accepted for opened drawers and foreground occlusions', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'caishen-large-manual-roi-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const templatePath = path.join(root, 'opened-and-occluded.png');
  await sharp({ create: { width: 320, height: 400, channels: 3, background: '#d8d1c8' } }).png().toFile(templatePath);
  const analysis = JSON.stringify({
    version: 11,
    processingMode: 'replace_print',
    replace_regions: [{ x: 0.015, y: 0.0081, width: 0.8641, height: 0.8676 }]
  });
  const job = { templatePath, templateRoot: root, relativePath: 'main/opened-and-occluded.png' };
  const maskPath = await templateMask.createTemplateEditMask(job, analysis);
  assert.ok(maskPath);
  const metrics = await templateMask.templateEditMaskMetrics(job, analysis, maskPath);
  assert.equal(metrics.passed, true);
  assert.ok(metrics.regions[0].editablePercent > 95);
});

test('per-region coverage validation rejects unchanged output and accepts printed output', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'caishen-coverage-validation-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const templatePath = path.join(root, 'coverage.png');
  await sharp({ create: { width: 160, height: 200, channels: 3, background: '#292724' } })
    .composite([{ input: { create: { width: 90, height: 120, channels: 3, background: '#dedbd4' } }, left: 35, top: 40 }])
    .png()
    .toFile(templatePath);
  const analysis = JSON.stringify({
    version: 11,
    processingMode: 'replace_print',
    replace_regions: [{ x: 0.15, y: 0.12, width: 0.7, height: 0.75 }]
  });
  const job = { templatePath, templateRoot: root, relativePath: 'detail/coverage.png' };
  const maskPath = await templateMask.createTemplateEditMask(job, analysis);
  const unchanged = await fs.readFile(templatePath);
  const failed = await templateMask.validateTemplatePrintCoverage(job, unchanged, maskPath, analysis);
  assert.equal(failed.passed, false);
  assert.equal(failed.regions[0].passed, false);

  const generated = await sharp({ create: { width: 160, height: 200, channels: 3, background: '#1b7fd0' } }).png().toBuffer();
  const composited = await templateMask.compositeTemplateEditResult(job, generated, maskPath);
  const passed = await templateMask.validateTemplatePrintCoverage(job, composited, maskPath, analysis);
  assert.equal(passed.passed, true);
  assert.equal(passed.regions[0].passed, true);
});
