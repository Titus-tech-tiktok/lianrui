const fs = require('node:fs/promises');
const path = require('node:path');

function createPublisherLogStore({ userDataPath, maxBytes = 256 * 1024 }) {
  if (!userDataPath) throw new Error('缺少日志目录');
  const filePath = path.join(userDataPath, 'publisher.log');

  async function read() {
    try {
      return await fs.readFile(filePath, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') return '';
      throw error;
    }
  }

  async function append(message) {
    const text = String(message || '').trim();
    if (!text) return read();
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const next = `${await read()}${text}\n`;
    const buffer = Buffer.from(next, 'utf8');
    const trimmed = buffer.length > maxBytes ? buffer.subarray(buffer.length - maxBytes).toString('utf8') : next;
    await fs.writeFile(filePath, trimmed, 'utf8');
    return trimmed;
  }

  async function clear() {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, '', 'utf8');
    return '';
  }

  return {
    filePath,
    read,
    append,
    clear
  };
}

module.exports = { createPublisherLogStore };
