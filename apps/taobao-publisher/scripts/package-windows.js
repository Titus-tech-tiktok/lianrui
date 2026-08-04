const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const appRoot = path.resolve(__dirname, '..');
const workspaceRoot = path.resolve(appRoot, '..', '..');
const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'caishen-taobao-publisher-build-'));
const configuredOutputDir = process.env.CAISHEN_PUBLISHER_OUTPUT_DIR || 'dist';
const outputDir = path.isAbsolute(configuredOutputDir) ? configuredOutputDir : path.join(appRoot, configuredOutputDir);
const cacheDir = path.join(os.tmpdir(), 'caishen-taobao-publisher-builder-cache');
const buildDir = path.join(stagingRoot, 'app');
const stagingOutputDir = path.join(stagingRoot, 'out');
const stagingElectronDist = path.join(stagingRoot, 'electron-dist');

function copyRecursive(source, target) {
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    fs.mkdirSync(target, { recursive: true });
    for (const entry of fs.readdirSync(source)) {
      copyRecursive(path.join(source, entry), path.join(target, entry));
    }
    return;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

async function main() {
  await fsp.rm(outputDir, { recursive: true, force: true });
  await fsp.mkdir(outputDir, { recursive: true });
  await fsp.mkdir(cacheDir, { recursive: true });
  await fsp.mkdir(stagingOutputDir, { recursive: true });
  copyRecursive(path.join(appRoot, 'src'), path.join(buildDir, 'src'));
  const localElectronDist = path.join(workspaceRoot, 'node_modules', 'electron', 'dist');
  if (!fs.existsSync(path.join(localElectronDist, 'electron.exe'))) {
    throw new Error(`Missing local Electron dist: ${localElectronDist}`);
  }
  copyRecursive(localElectronDist, stagingElectronDist);
  const packageJson = JSON.parse(await fsp.readFile(path.join(appRoot, 'package.json'), 'utf8'));
  delete packageJson.scripts;
  packageJson.devDependencies = {
    electron: packageJson.devDependencies?.electron,
    'electron-builder': packageJson.devDependencies?.['electron-builder']
  };
  packageJson.build = {
    ...packageJson.build,
    directories: { output: stagingOutputDir },
    electronDist: stagingElectronDist
  };
  await fsp.writeFile(path.join(buildDir, 'package.json'), JSON.stringify(packageJson, null, 2), 'utf8');

  const builderCli = path.join(workspaceRoot, 'node_modules', 'electron-builder', 'cli.js');
  if (!fs.existsSync(builderCli)) throw new Error(`Missing electron-builder CLI: ${builderCli}`);
  const args = [builderCli, '--win'];
  if (process.argv.includes('--dir')) args.push('--dir');
  const result = spawnSync(process.execPath, args, {
    cwd: buildDir,
    env: {
      ...process.env,
      APP_BUILDER_CACHE: cacheDir,
      ELECTRON_BUILDER_CACHE: cacheDir
    },
    stdio: 'inherit',
    shell: false
  });
  if (result.error) console.error(result.error);
  if (result.status === 0) copyRecursive(stagingOutputDir, outputDir);
  await fsp.rm(stagingRoot, { recursive: true, force: true });
  process.exit(result.status ?? 1);
}

main().catch(async error => {
  await fsp.rm(stagingRoot, { recursive: true, force: true }).catch(() => {});
  console.error(error);
  process.exit(1);
});
