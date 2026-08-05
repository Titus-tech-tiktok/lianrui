const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');

test('every workspace lists a full detail page as sliced template jobs', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'caishen-folder-slicing-'));
  process.env.CAISHEN_DATA_DIR = path.join(temp, 'data');
  process.env.CAISHEN_DETAIL_FULL_SLICE_HEIGHT = '700';
  const runtimePath = require.resolve('../src/runtime');
  delete require.cache[runtimePath];
  const runtime = require('../src/runtime');
  const mainDirectory = `1-1\u4e3b\u56fe`;
  const skuDirectory = 'sku';
  const detailDirectories = ['\u8be6\u60c5\u9875', '\u8be6\u60c5'];

  for (const [index, workspaceId] of ['local', 'user-member'].entries()) {
    await runtime.runWithWorkspace(workspaceId, async () => {
      const detailDirectory = detailDirectories[index];
      const detailFile = '\u8be6\u60c5\u9875.jpg';
      const folder = path.join(runtime.WORKSPACE_ROOT, 'assets', 'template', 'batch', 'template');
      await fs.mkdir(path.join(folder, mainDirectory), { recursive: true });
      await fs.mkdir(path.join(folder, skuDirectory), { recursive: true });
      await fs.mkdir(path.join(folder, detailDirectory), { recursive: true });
      await sharp({ create: { width: 790, height: 790, channels: 3, background: '#dddddd' } })
        .jpeg()
        .toFile(path.join(folder, mainDirectory, '01.jpg'));
      await sharp({ create: { width: 790, height: 790, channels: 3, background: '#cccccc' } })
        .jpeg()
        .toFile(path.join(folder, skuDirectory, '01.jpg'));
      await sharp({ create: { width: 790, height: 1600, channels: 3, background: '#eeeeee' } })
        .jpeg()
        .toFile(path.join(folder, detailDirectory, detailFile));
      const folders = await runtime.listTemplateFolders();
      assert.equal(folders.length, 1);
      assert.equal(folders[0].count, 5);
      const items = await runtime.listTemplates(folders[0].path);
      assert.deepEqual(items.map(item => item.relativePath), [
        `${mainDirectory}/01.jpg`,
        `${skuDirectory}/01.jpg`,
        `${detailDirectory}/01.jpg`,
        `${detailDirectory}/02.jpg`,
        `${detailDirectory}/03.jpg`
      ]);
    });
  }
});
