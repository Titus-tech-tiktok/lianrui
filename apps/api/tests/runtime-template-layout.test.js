const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const runtime = require('../src/runtime');

test('detail slice rejects a generated white bottom when the template has page content there', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'caishen-layout-'));
  const templatePath = path.join(directory, 'slice.png');
  const template = sharp({ create: { width: 100, height: 200, channels: 3, background: '#d4b38b' } })
    .composite([{ input: { create: { width: 100, height: 50, channels: 3, background: '#472f1f' } }, top: 150, left: 0 }]);
  await template.png().toFile(templatePath);
  const output = await sharp({ create: { width: 100, height: 200, channels: 3, background: '#d4b38b' } })
    .composite([{ input: { create: { width: 100, height: 50, channels: 3, background: '#ffffff' } }, top: 150, left: 0 }])
    .png()
    .toBuffer();
  const result = await runtime.validateTemplateOutputLayout({ templatePath, relativePath: '详情/03.jpg' }, output, 'detail slice');
  assert.equal(result.passed, false);
  assert.match(result.reason, /大面积空白/);
  await fs.rm(directory, { recursive: true, force: true });
});

test('detail slice accepts a legitimate print color change touching one boundary', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'caishen-layout-edge-print-'));
  const templatePath = path.join(directory, 'slice.png');
  const template = sharp({ create: { width: 120, height: 180, channels: 3, background: '#eee4d4' } })
    .composite([{ input: { create: { width: 52, height: 120, channels: 3, background: '#e4ded2' } }, top: 30, left: 0 }]);
  await template.png().toFile(templatePath);
  const output = await sharp({ create: { width: 120, height: 180, channels: 3, background: '#eee4d4' } })
    .composite([{ input: { create: { width: 52, height: 120, channels: 3, background: '#26384c' } }, top: 30, left: 0 }])
    .png()
    .toBuffer();

  const result = await runtime.validateTemplateOutputLayout({ templatePath, relativePath: '详情/04.jpg' }, output, 'detail slice');
  assert.equal(result.passed, true);
  await fs.rm(directory, { recursive: true, force: true });
});

test('multi-grid keeps the same layout when generated colors differ across the page', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'caishen-layout-grid-color-'));
  const templatePath = path.join(directory, 'grid.png');
  await sharp({ create: { width: 120, height: 180, channels: 3, background: '#d4b38b' } }).png().toFile(templatePath);
  const output = await sharp({ create: { width: 120, height: 180, channels: 3, background: '#8b6548' } }).png().toBuffer();

  const result = await runtime.validateTemplateOutputLayout({ templatePath, relativePath: '详情/多宫格-04.jpg' }, output, 'multi-grid detail slice');
  assert.equal(result.passed, true);
  await fs.rm(directory, { recursive: true, force: true });
});

test('transport canvas restores the exact designer dimensions without zooming page details', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'caishen-layout-transport-canvas-'));
  const templatePath = path.join(directory, 'designer-slice.png');
  const outputPath = path.join(directory, 'output.png');
  const source = await sharp({ create: { width: 81, height: 144, channels: 3, background: '#eadfce' } })
    .composite([{ input: { create: { width: 20, height: 20, channels: 3, background: '#ef1f1f' } }, left: 30, top: 62 }])
    .png()
    .toBuffer();
  await fs.writeFile(templatePath, source);
  const job = { templatePath, outputPath, templateRoot: directory, relativePath: '详情/05.png' };
  const plan = await runtime.prepareTemplateGenerationCanvas(job);
  const generated = await fs.readFile(plan.templatePath);
  const restored = await runtime.restoreTemplateGenerationCanvas(generated, plan);
  await runtime.writeTemplateSizedImage(job, restored);
  const { data, info } = await sharp(outputPath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(plan.canvasWidth, 1024);
  assert.equal(plan.canvasHeight, 1536);
  assert.ok(plan.left > 0, 'portrait template uses transport margins instead of zooming the page');
  assert.equal(info.width, 81);
  assert.equal(info.height, 144);
  const redPixels = [];
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const offset = (y * info.width + x) * info.channels;
      if (data[offset] > 200 && data[offset + 1] < 80 && data[offset + 2] < 80) redPixels.push([x, y]);
    }
  }
  assert.ok(redPixels.length > 0);
  const redWidth = Math.max(...redPixels.map(([x]) => x)) - Math.min(...redPixels.map(([x]) => x)) + 1;
  const redHeight = Math.max(...redPixels.map(([, y]) => y)) - Math.min(...redPixels.map(([, y]) => y)) + 1;
  assert.ok(Math.abs(redWidth - 20) <= 1, `page detail width must remain original scale, got ${redWidth}`);
  assert.ok(Math.abs(redHeight - 20) <= 1, `page detail height must remain original scale, got ${redHeight}`);
  await fs.rm(directory, { recursive: true, force: true });
});

test('transport canvas keeps mask cut-outs aligned and locks its outer margins', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'caishen-layout-transport-mask-'));
  const templatePath = path.join(directory, 'designer-slice.png');
  const maskPath = path.join(directory, 'mask.png');
  await sharp({ create: { width: 81, height: 144, channels: 3, background: '#eadfce' } }).png().toFile(templatePath);
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="81" height="144"><defs><mask id="m"><rect width="81" height="144" fill="white"/><rect x="30" y="62" width="20" height="20" fill="black"/></mask></defs><rect width="81" height="144" fill="white" mask="url(#m)"/></svg>';
  await sharp(Buffer.from(svg)).png().toFile(maskPath);
  const plan = await runtime.prepareTemplateGenerationCanvas({ templatePath, templateRoot: directory, relativePath: '详情/06.png' }, maskPath);
  const { data, info } = await sharp(plan.maskPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const alphaAt = (x, y) => data[(y * info.width + x) * info.channels + 3];
  assert.equal(info.width, 1024);
  assert.equal(info.height, 1536);
  assert.equal(alphaAt(2, Math.floor(info.height / 2)), 255, 'transport margin remains locked');
  assert.equal(alphaAt(plan.left + Math.floor(plan.contentWidth / 2), plan.top + Math.floor(plan.contentHeight / 2)), 0, 'editable cut-out remains transparent');
  await fs.rm(directory, { recursive: true, force: true });
});
