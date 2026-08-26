const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function removeTempWithRetry(target) {
  let lastError;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await fs.rm(target, { recursive: true, force: true });
      return;
    } catch (error) {
      lastError = error;
      if (!['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(error?.code) || attempt === 4) break;
      await wait(100 * (attempt + 1));
    }
  }
  throw lastError;
}

test('素材库支持追加同名文件并只删除当前素材库内的选中图片', async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'caishen-asset-files-'));
  process.env.CAISHEN_DATA_DIR = temp;
  process.env.CAISHEN_WORKSPACE_ID = 'asset-files';
  const serverPath = require.resolve('../src/server');
  const runtimePath = require.resolve('../src/runtime');
  delete require.cache[serverPath];
  delete require.cache[runtimePath];
  const { addAssetFiles, createAssetThumbnail, deleteAssetFiles, normalizedThumbnailWidth, renameAssetFolder } = require('../src/server');

  const firstUpload = path.join(temp, 'upload-1');
  await fs.writeFile(firstUpload, 'first');
  const first = await addAssetFiles('print', '', [{ path: firstUpload, originalname: 'flower.png' }], ['flower.png']);
  assert.equal(first.added, 1);
  assert.equal(await fs.readFile(path.join(first.root, 'flower.png'), 'utf8'), 'first');

  const secondUpload = path.join(temp, 'upload-2');
  await fs.writeFile(secondUpload, 'second');
  const second = await addAssetFiles('print', first.root, [{ path: secondUpload, originalname: 'flower.png' }], ['flower.png']);
  assert.equal(second.added, 1);
  assert.equal(await fs.readFile(path.join(first.root, 'flower (2).png'), 'utf8'), 'second');

  let childrenwearRealLibrary;
  for (const kind of ['childrenwear-real', 'childrenwear-reference', 'childrenwear-model', 'childrenwear-combination']) {
    const upload = path.join(temp, `upload-${kind}`);
    await fs.writeFile(upload, kind);
    const relativePath = path.join('纯棉', '长裤', `${kind}.jpg`);
    const library = await addAssetFiles(kind, '', [{ path: upload, originalname: `${kind}.jpg` }], [relativePath]);
    assert.equal(library.added, 1);
    assert.equal(library.root.includes(kind), true);
    assert.equal(await fs.readFile(path.join(library.root, relativePath), 'utf8'), kind);
    if (kind === 'childrenwear-real') childrenwearRealLibrary = library;
  }

  const pagedUploads = [];
  for (let index = 0; index < 13; index += 1) {
    const upload = path.join(temp, `paged-${index}`);
    await fs.writeFile(upload, `paged-${index}`);
    pagedUploads.push({ path: upload, originalname: `单图-${index}.jpg` });
  }
  await addAssetFiles('childrenwear-real', childrenwearRealLibrary.root, pagedUploads, pagedUploads.map(item => item.originalname));
  const runtime = require('../src/runtime');
  const nestedPage = await runtime.scanImageLibraryPage(childrenwearRealLibrary.root, { folder: 'folder:纯棉', page: 1, pageSize: 12 });
  assert.equal(nestedPage.total, 1);
  assert.equal(nestedPage.items[0].folder, path.join('纯棉', '长裤'));
  const renamed = await renameAssetFolder('childrenwear-real', childrenwearRealLibrary.root, 'folder:纯棉', '纯棉梭织裤实拍');
  assert.equal(renamed.folder, 'folder:纯棉');
  const renamedPage = await runtime.scanImageLibraryPage(childrenwearRealLibrary.root, { folder: 'folder:纯棉', page: 1, pageSize: 12 });
  assert.equal(renamedPage.folders.find(folder => folder.id === 'folder:纯棉').name, '纯棉梭织裤实拍');
  assert.equal(renamedPage.items[0].path, nestedPage.items[0].path);
  await assert.rejects(() => renameAssetFolder('childrenwear-real', childrenwearRealLibrary.root, 'root', '根目录改名'), /未分类文件不能重命名/);
  const rootPage = await runtime.scanImageLibraryPage(childrenwearRealLibrary.root, { folder: 'root', page: 2, pageSize: 12 });
  assert.equal(rootPage.total, 13);
  assert.equal(rootPage.totalPages, 2);
  assert.equal(rootPage.items.length, 1);

  const originalRm = fs.rm;
  let simulatedLock = true;
  fs.rm = async (target, options) => {
    if (target === path.join(first.root, 'flower.png') && simulatedLock) {
      simulatedLock = false;
      const error = new Error('simulated Windows file lock');
      error.code = 'EPERM';
      throw error;
    }
    return originalRm(target, options);
  };
  let removed;
  try {
    removed = await deleteAssetFiles('print', first.root, [path.join(first.root, 'flower.png')]);
  } finally {
    fs.rm = originalRm;
  }
  assert.equal(removed.deleted, 1);
  await assert.rejects(() => fs.stat(path.join(first.root, 'flower.png')));
  await assert.rejects(() => deleteAssetFiles('print', first.root, [path.join(temp, 'outside.png')]), /不属于当前素材库/);

  const largeImage = path.join(first.root, 'large-preview.png');
  await sharp({ create: { width: 1800, height: 1200, channels: 3, background: '#b78c48' } }).png().toFile(largeImage);
  const thumbnail = await createAssetThumbnail(largeImage, 320);
  const thumbnailMetadata = await sharp(thumbnail.file).metadata();
  assert.equal(thumbnail.cacheHit, false);
  assert.equal(thumbnailMetadata.format, 'webp');
  assert.equal(thumbnailMetadata.width, 480);
  assert.ok((await fs.stat(thumbnail.file)).size < (await fs.stat(largeImage)).size);
  assert.equal((await createAssetThumbnail(largeImage, 480)).cacheHit, true);
  assert.equal(normalizedThumbnailWidth(999), 1200);

  sharp.cache(false);
  await wait(500);
  await removeTempWithRetry(temp);
});
