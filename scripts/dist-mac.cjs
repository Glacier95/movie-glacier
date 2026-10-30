const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

async function main() {
  if (process.platform !== 'darwin') throw new Error('Build macOS installers on a Mac.');
  // Cloud-synced Desktop/Documents folders can restore FinderInfo while signing.
  // Keep the entire signing/archive operation on the local temporary volume.
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'movie-glacier-release-'));
  const result = spawnSync(process.execPath, [require.resolve('electron-builder/cli.js'),
    '--mac', 'dmg', 'zip', ...process.argv.slice(2), '--publish', 'never',
    `--config.directories.output=${staging}`], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`macOS packaging failed. Build output: ${staging}`);
  const output = path.resolve('release'); fs.mkdirSync(output, { recursive: true });
  const artifacts = fs.readdirSync(staging).filter(name => /\.(dmg|zip|blockmap)$/.test(name));
  const sums = [];
  for (const name of artifacts) {
    const target = path.join(output, name); fs.copyFileSync(path.join(staging, name), target);
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(target)) hash.update(chunk);
    sums.push(`${hash.digest('hex')}  ${name}`);
  }
  fs.writeFileSync(path.join(output, 'SHA256SUMS.txt'), sums.join('\n') + '\n');
  const directory = fs.readdirSync(staging).find(name => /^mac(?:-arm64|-universal)?$/.test(name));
  if (!directory || !artifacts.some(name => name.endsWith('.dmg'))) throw new Error('The macOS build is incomplete.');
  const executable = path.join(staging, directory, 'Movie Glacier.app/Contents/MacOS/Movie Glacier');
  fs.mkdirSync('.cache', { recursive: true });
  fs.writeFileSync('.cache/mac-package.json', JSON.stringify({ executable, artifacts }, null, 2));
  console.log(`macOS installers: ${output}\nPackaged test executable: ${executable}`);
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
