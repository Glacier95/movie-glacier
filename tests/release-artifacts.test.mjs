import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { writeReleaseChecksums } from '../scripts/release-artifacts.mjs';

function releaseFixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'movie-glacier-release-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const files = ['Movie.Glacier.Setup.0.7.0.exe', 'Movie.Glacier-0.7.0-mac-arm64.dmg',
    'Movie.Glacier-0.7.0-mac-arm64.zip', 'Movie.Glacier-0.7.0-mac-x64.dmg', 'Movie.Glacier-0.7.0-mac-x64.zip'];
  for (const name of files) fs.writeFileSync(path.join(directory, name), `fixture:${name}`);
  return { directory, files };
}

test('release checksums cover all platforms and optional blockmaps, replacing stale sums', async t => {
  const { directory, files } = releaseFixture(t);
  const blockmap = `${files[1]}.blockmap`;
  fs.writeFileSync(path.join(directory, blockmap), 'blockmap fixture');
  fs.writeFileSync(path.join(directory, 'SHA256SUMS.txt'), 'stale platform-only sums');
  await writeReleaseChecksums(directory, '0.7.0');
  const lines = fs.readFileSync(path.join(directory, 'SHA256SUMS.txt'), 'utf8').trim().split('\n');
  assert.equal(lines.length, 6);
  for (const name of [...files, blockmap]) {
    const expected = crypto.createHash('sha256').update(fs.readFileSync(path.join(directory, name))).digest('hex');
    assert.ok(lines.includes(`${expected}  ${name}`));
  }
});

test('release publication rejects missing architectures, empty installers and wrong versions', async t => {
  const { directory, files } = releaseFixture(t);
  await assert.rejects(writeReleaseChecksums(directory, '0.7.1'), /Missing or empty/);
  fs.unlinkSync(path.join(directory, files[4]));
  await assert.rejects(writeReleaseChecksums(directory, '0.7.0'), /mac-x64.zip/);
  fs.writeFileSync(path.join(directory, files[4]), '');
  await assert.rejects(writeReleaseChecksums(directory, '0.7.0'), /mac-x64.zip/);
  assert.equal(fs.existsSync(path.join(directory, 'SHA256SUMS.txt')), false);
});

test('release publication rejects unrelated files in the upload directory', async t => {
  const { directory } = releaseFixture(t);
  fs.writeFileSync(path.join(directory, 'debug.log'), 'fixture');
  await assert.rejects(writeReleaseChecksums(directory, '0.7.0'), /Unexpected release artifact: debug.log/);
  assert.equal(fs.existsSync(path.join(directory, 'SHA256SUMS.txt')), false);
});
