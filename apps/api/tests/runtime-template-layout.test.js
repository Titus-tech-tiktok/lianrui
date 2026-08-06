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
