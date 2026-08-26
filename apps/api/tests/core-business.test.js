const test = require('node:test');
const assert = require('node:assert/strict');
const { extractImageResult, isImagePath, safeFileName, taskFolderName } = require('../src/core/business');

test('识别常用图片扩展名', () => {
  assert.equal(isImagePath('/tmp/a.JPG'), true);
  assert.equal(isImagePath('/tmp/a.txt'), false);
});

test('清理不安全文件名', () => {
  assert.equal(safeFileName(' 柜子:/A* '), '柜子--A-');
});

test('生成稳定任务目录名', () => {
  const value = taskFolderName('ys', new Date(2026, 6, 10), 7, '/a/餐边柜.png', '/b/001.jpg');
  assert.equal(value, 'ys07100007-餐边柜-001');
});

test('解析 base64 图片响应', () => {
  assert.deepEqual(extractImageResult({ data: [{ b64_json: 'data:image/png;base64,YQ==' }] }), { type: 'base64', value: 'YQ==' });
  assert.deepEqual(extractImageResult({ data: [{ url: 'https://example.test/image.png' }] }), { type: 'url', value: 'https://example.test/image.png' });
  assert.deepEqual(extractImageResult({ data: [{ url: 'https://example.test/image.png' }] }, 'url'), { type: 'url', value: 'https://example.test/image.png' });
  assert.throws(() => extractImageResult({ data: [{ b64_json: 'YQ==' }] }, 'url'), /未按配置返回图片链接/);
  assert.throws(() => extractImageResult({ data: [{ url: 'https:\/\/example.test\/image.png' }] }, 'b64_json'), /未按配置返回 Base64/);
});
