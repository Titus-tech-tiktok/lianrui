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

test('template writer fills the exact designer canvas without white letterboxing', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'caishen-layout-no-letterbox-'));
  const templatePath = path.join(directory, 'designer-slice.jpg');
  const outputPath = path.join(directory, 'output.jpg');
  await sharp({ create: { width: 90, height: 160, channels: 3, background: '#eadfce' } }).jpeg().toFile(templatePath);
  const generated = await sharp({ create: { width: 120, height: 120, channels: 3, background: '#245db5' } }).png().toBuffer();
  await runtime.writeTemplateSizedImage({ templatePath, outputPath }, generated);
  const { data, info } = await sharp(outputPath).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const bottom = (info.height - 2) * info.width * info.channels + Math.floor(info.width / 2) * info.channels;
  assert.equal(info.width, 90);
  assert.equal(info.height, 160);
  assert.ok(data[bottom + 2] > 130, 'bottom remains generated content instead of a white padding band');
  assert.ok(data[bottom] < 100);
  await fs.rm(directory, { recursive: true, force: true });
});
