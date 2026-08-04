const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const electronPath = require('electron');
const child = spawn(electronPath, [root], {
  cwd: root,
  env: {
    ...process.env,
    CAISHEN_PUBLISHER_SMOKE: '1'
  },
  stdio: ['ignore', 'pipe', 'pipe']
});

let output = '';
const timeout = setTimeout(() => {
  child.kill();
  console.error(output.trim() || 'taobao-publisher smoke timed out');
  process.exit(1);
}, 20000);

child.stdout.on('data', chunk => { output += chunk.toString(); });
child.stderr.on('data', chunk => { output += chunk.toString(); });
child.on('error', error => {
  clearTimeout(timeout);
  console.error(error.message);
  process.exit(1);
});
child.on('exit', code => {
  clearTimeout(timeout);
  if (code === 0 && output.includes('taobao-publisher smoke ok')) {
    console.log('taobao-publisher smoke ok');
    return;
  }
  console.error(output.trim() || `taobao-publisher smoke failed with exit code ${code}`);
  process.exit(code || 1);
});
