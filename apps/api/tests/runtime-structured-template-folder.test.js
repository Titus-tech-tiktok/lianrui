const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');

test('structured template folders preserve designer-prepared main, ratio and detail images', async (t) => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'caishen-structured-template-'));

  process.env.CAISHEN_DATA_DIR = path.join(temp, 'data');
  process.env.CAISHEN_WORKSPACE_ID = 'structured-template';
  process.env.CAISHEN_DETAIL_FULL_SLICE_HEIGHT = '1000';
  const runtimePath = require.resolve('../src/runtime');
  delete require.cache[runtimePath];
  const runtime = require('../src/runtime');

  const folder = path.join(runtime.WORKSPACE_ROOT, 'assets', 'template', 'fixed', 'template');
  await Promise.all([
    fs.mkdir(path.join(folder, '主图'), { recursive: true }),
    fs.mkdir(path.join(folder, '3-4主图'), { recursive: true }),
    fs.mkdir(path.join(folder, '详情页'), { recursive: true }),
    fs.mkdir(path.join(folder, '忽略目录'), { recursive: true })
  ]);
  await sharp({ create: { width: 120, height: 120, channels: 3, background: '#f3eee6' } })
    .jpeg()
    .toFile(path.join(folder, '主图', '1.jpg'));
  await sharp({ create: { width: 120, height: 160, channels: 3, background: '#e8dac6' } })
    .jpeg()
    .toFile(path.join(folder, '3-4主图', '1.jpg'));
  await sharp({ create: { width: 100, height: 2500, channels: 3, background: '#eadfce' } })
    .jpeg()
    .toFile(path.join(folder, '详情页', 'detail-full.jpg'));
  await sharp({ create: { width: 80, height: 80, channels: 3, background: '#222222' } })
    .jpeg()
    .toFile(path.join(folder, '忽略目录', 'unused.jpg'));

  const items = await runtime.listTemplates(folder);
  const relativePaths = items.map(item => item.relativePath);

  assert.deepEqual(relativePaths, [
    '主图/1.jpg',
    '3-4主图/1.jpg',
    '详情页/detail-full.jpg'
  ]);
  const detailItem = items.find(item => item.relativePath === '详情页/detail-full.jpg');
  assert.equal(detailItem.name, 'detail-full.jpg');
  assert.equal(detailItem.folder, '详情页');
  assert.equal(detailItem.templatePath, path.join(folder, '详情页', 'detail-full.jpg'));
});
