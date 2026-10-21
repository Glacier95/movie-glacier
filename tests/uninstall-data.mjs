import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

// Exercise the exact removal macros with fake install/AppData folders and no registry changes.
const cache = path.resolve('.cache');
const root = fs.mkdtempSync(path.join(cache, 'uninstall-test-'));
assert.ok(root.startsWith(cache + path.sep));
function findCompiler(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) { const found = findCompiler(file); if (found) return found; }
    else if (entry.name === 'makensis.exe' && path.basename(dir) === 'Bin') return file;
  }
}
const compiler = process.env.MAKENSIS_EXE || findCompiler(path.join(cache, 'electron-builder'));
assert.ok(compiler, 'Build the installer once to obtain NSIS');
for (const mode of ['keep', 'delete']) {
  const install = path.join(root, mode), legacy = path.join(root, `${mode}-legacy`);
  const entries = ['user-data/library.sqlite', 'user-data/images/poster.jpg', 'user-data/Partitions/douban/Network/Cookies', 'resources/app.asar', 'resources/elevate.exe', 'Movie Glacier.exe', 'Uninstall Movie Glacier.exe', 'my-media/movie.mkv'];
  for (const entry of entries) {
    const file = path.join(install, entry);
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'fixture');
  }
  for (const name of ['movie-glacier', 'Movie Glacier', '私人影视库', 'unrelated-app']) {
    fs.mkdirSync(path.join(legacy, name), { recursive: true });
    fs.writeFileSync(path.join(legacy, name, 'library.sqlite'), 'backup');
  }
  const output = path.join(root, `${mode}.exe`);
  const script = path.join(root, `${mode}.nsi`);
  fs.writeFileSync(script, `Unicode true
RequestExecutionLevel user
SilentInstall silent
OutFile "${output}"
InstallDir "${install}"
!define UNINSTALL_FILENAME "Uninstall Movie Glacier.exe"
!define BUILD_RESOURCES_DIR "${path.resolve('build')}"
!include "${path.resolve('build/installer.nsh')}"
Section
${mode === 'delete' ? `!insertmacro removeMovieGlacierData "$INSTDIR" "${legacy}"` : ''}
!insertmacro customRemoveFiles
SectionEnd
`);
  execFileSync(compiler, ['/V2', script], { windowsHide: true, stdio: 'pipe' });
  execFileSync(output, [], { windowsHide: true, timeout: 30000 });
  assert.equal(fs.existsSync(path.join(install, 'user-data/library.sqlite')), mode === 'keep');
  assert.equal(fs.existsSync(path.join(install, 'resources/app.asar')), false);
  assert.equal(fs.existsSync(path.join(install, 'resources/elevate.exe')), false);
  assert.equal(fs.existsSync(path.join(install, 'Movie Glacier.exe')), false);
  assert.equal(fs.existsSync(path.join(install, 'my-media/movie.mkv')), true, 'media is never removed');
  for (const name of ['movie-glacier', 'Movie Glacier', '私人影视库']) assert.equal(fs.existsSync(path.join(legacy, name)), mode === 'keep');
  assert.equal(fs.existsSync(path.join(legacy, 'unrelated-app/library.sqlite')), true);
}
console.log('NSIS keep/delete macros passed; media and unrelated AppData were preserved.');
