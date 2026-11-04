const path = require('node:path');
const { isSameOrChildPath } = require('./path-utils');

// Rebase only files belonging to this discovered task directory. External
// references keep their original ownership and must pass normal API validation.
function relocateTaskPaths(task, actualFolder) {
  const oldFolder = String(task?.folder || '').replace(/\\/g, '/').replace(/\/+$/, '');
  const actual = path.resolve(actualFolder);
  const windowsPath = /^[a-z]:\//i.test(oldFolder);
  const compare = value => windowsPath ? value.toLowerCase() : value;
  const oldKey = compare(oldFolder);
  function relocate(value) {
    if (Array.isArray(value)) return value.map(relocate);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, relocate(item)]));
    if (typeof value !== 'string' || !oldFolder) return value;
    const normalized = value.replace(/\\/g, '/');
    const candidateKey = compare(normalized);
    if (candidateKey !== oldKey && !candidateKey.startsWith(oldKey + '/')) return value;
    const suffix = normalized.slice(oldFolder.length).replace(/^\/+/, '');
    const candidate = path.resolve(actual, ...suffix.split('/').filter(Boolean));
    return isSameOrChildPath(actual, candidate) ? candidate : value;
  }
  return { ...relocate(task), folder: actual };
}

module.exports = { relocateTaskPaths };
