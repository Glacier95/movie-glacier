import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { playerCommand } from '../dist-electron/electron/player.js';
import { discover } from '../dist-electron/electron/scanner.js';

test('macOS opens app bundles with separate arguments and supports the default player', () => {
  const target = '/Volumes/Films/Movie & Friends (2024).mkv';
  assert.deepEqual(playerCommand('darwin', '/Applications/IINA.app', target), {
    executable: '/usr/bin/open', args: ['-a', '/Applications/IINA.app', target]
  });
  assert.equal(playerCommand('darwin', '', target), null);
  assert.equal(playerCommand('darwin', 'system', target), null);
  assert.deepEqual(playerCommand('win32', 'C:\\PotPlayer.exe', target), { executable: 'C:\\PotPlayer.exe', args: [target] });
});

test('Finder sidecars, hidden trash and macOS archive metadata do not become movies', async () => {
  fs.mkdirSync('.cache', { recursive: true });
  const root = fs.mkdtempSync(path.resolve('.cache/mac-scan-'));
  try {
    for (const name of ['Solaris.1972.mkv', '._Solaris.1972.mkv', '.Trashes/Old.Movie.2001.mp4', '__MACOSX/Copy.2020.mkv']) {
      const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'fixture');
    }
    const media = await Array.fromAsync(discover(root));
    assert.deepEqual(media.map(item => path.basename(item.path)), ['Solaris.1972.mkv']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
