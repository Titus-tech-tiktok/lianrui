const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const zlib = require('node:zlib');
const sharp = require('sharp');

const runtime = require('../src/runtime');
const { buildZipDownloadName, createFolderZip } = require('../src/server');

async function writeSource(folder, templateFolderPath, masterImagePath = '') {
  const meta = path.join(folder, '.caishen-meta');
  await fs.mkdir(meta, { recursive: true });
  await fs.writeFile(path.join(meta, 'source.json'), JSON.stringify({ TemplateFolderPath: templateFolderPath, MasterImagePath: masterImagePath }), 'utf8');
}

function zipLocalEntries(archive) {
  const entries = [];
  let offset = 0;
  while (offset + 30 <= archive.length && archive.readUInt32LE(offset) === 0x04034b50) {
    const method = archive.readUInt16LE(offset + 8);
    const compressedSize = archive.readUInt32LE(offset + 18);
    const nameLength = archive.readUInt16LE(offset + 26);
    const extraLength = archive.readUInt16LE(offset + 28);
    const name = archive.subarray(offset + 30, offset + 30 + nameLength).toString('utf8');
    const dataStart = offset + 30 + nameLength + extraLength;
    const payload = archive.subarray(dataStart, dataStart + compressedSize);
    entries.push({ name, data: method === 8 ? zlib.inflateRawSync(payload) : payload });
    offset += 30 + nameLength + extraLength + compressedSize;
  }
  return entries;
}

test('ZIP 下载名按套图文件夹、日期和两位序号生成', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'caishen-zip-name-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const templateFolder = path.join(root, 'templates', '款式1');
  await fs.mkdir(templateFolder, { recursive: true });
  const first = path.join(root, 'outputs', '0715-0001');
  const second = path.join(root, 'outputs', '0715-0002');
  await writeSource(first, templateFolder);
  await writeSource(second, templateFolder);

  assert.equal(await buildZipDownloadName(first), '款式1-0715-01');
  assert.equal(await buildZipDownloadName(second), '款式1-0715-02');
});

test('task ZIP includes its generated master image as 白底图/白底图.jpg', async t => {
  const fixtureRoot = path.join(runtime.WORKSPACE_ROOT, '.tests');
  await fs.mkdir(fixtureRoot, { recursive: true });
  const root = await fs.mkdtemp(path.join(fixtureRoot, 'caishen-zip-master-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const output = path.join(root, 'outputs', '0809-0001');
  const master = path.join(root, 'masters', 'generated-master.png');
  await fs.mkdir(path.dirname(master), { recursive: true });
  await fs.mkdir(output, { recursive: true });
  await sharp({ create: { width: 8, height: 8, channels: 4, background: { r: 25, g: 120, b: 220, alpha: 0.5 } } })
    .png()
    .toFile(master);
  await fs.writeFile(path.join(output, 'result.jpg'), Buffer.from('result-image'));
  await fs.mkdir(path.join(output, '白底'), { recursive: true });
  await fs.writeFile(path.join(output, '白底', '旧母版图.png'), Buffer.from('legacy-master'));
  await fs.writeFile(path.join(output, '母版图.jpg'), Buffer.from('legacy-root-master'));
  await writeSource(output, path.join(root, 'templates', 'style-1'), master);

  const archive = await createFolderZip(output);
  const entries = zipLocalEntries(archive);
  const names = entries.map(entry => entry.name);
  const masterEntry = entries.find(entry => entry.name === '白底图/白底图.jpg');

  assert.ok(names.includes('result.jpg'));
  assert.ok(masterEntry);
  assert.equal(names.some(name => name.startsWith('白底/')), false);
  assert.equal(names.includes('母版图.jpg'), false);
  assert.equal(names.includes('母版图.png'), false);
  assert.deepEqual([...masterEntry.data.subarray(0, 3)], [0xff, 0xd8, 0xff]);
});

