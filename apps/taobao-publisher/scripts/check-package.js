const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
for (const file of ['src/main.js', 'src/preload.js', 'src/taobao-runner.js', 'src/diagnostic-bundle.js', 'src/template-transfer.js', 'src/index.html', 'src/renderer.js', 'src/publisher-api.js', 'src/styles.css', 'scripts/smoke-start.js']) {
  const target = path.join(root, file);
  if (!fs.existsSync(target)) throw new Error(`Missing ${file}`);
}

console.log('taobao-publisher package files ok');
