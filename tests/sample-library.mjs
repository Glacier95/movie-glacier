import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';
import { discover, parseName } from '../dist-electron/electron/scanner.js';

const root = process.env.FILM_LIBRARY_SAMPLE_DIR || 'D:\\pt';
if (!fs.existsSync(root)) {
  console.log(`Sample directory not available: ${root}`);
  process.exit(0);
}
const data = path.resolve(`.cache/sample-library-${Date.now()}`);
fs.mkdirSync(data, { recursive: true });
const app = await electron.launch({
  executablePath: path.resolve('release/win-unpacked/Movie Glacier.exe'),
  args: ['--no-sandbox', '--disable-gpu'],
  env: { ...process.env, FILM_LIBRARY_DATA_DIR: data, FILM_LIBRARY_SMOKE: '1' }
});
try {
  const page = await app.firstWindow();
  await page.locator('.brand').waitFor();
  await page.evaluate(folder => window.library.setSettings({ roots: [folder] }), root);
  await page.evaluate(() => window.library.updateLibrary());
  const works = await page.evaluate(() => window.library.listWorks());
  const job = await page.evaluate(() => window.library.getJob());
  const assets = works.flatMap(work => work.assets);
  const discovered = await Array.fromAsync(discover(root));
  const absent = discovered.filter(item => !assets.some(asset => asset.path.toLowerCase() === item.path.toLowerCase()));
  assert.ok(absent.every(item => Date.now() - item.mtimeMs < 30_000), 'All stable media must be imported');
  if (job.failures) console.log(JSON.stringify({ scanWarning: job.message, failures: job.failures }));
  const movieFiles = assets.filter(asset => asset.kind === 'file' && asset.episode === null);
  const discs = assets.filter(asset => asset.kind === 'bdmv');
  const episodes = assets.filter(asset => asset.episode !== null);
  const discoveredMovies = discovered.filter(item => item.kind === 'file' && parseName(item.path, item.kind).episode === null);
  assert.equal(discoveredMovies.length, 29);
  assert.equal(movieFiles.length, discoveredMovies.length - absent.filter(item => item.kind === 'file').length);
  assert.equal(discs.length, 1);
  assert.equal(episodes.length, 48);
  assert.equal(works.filter(work => work.mediaType === 'tv').length, 1);
  assert.deepEqual([...new Set(episodes.map(asset => asset.season))].sort(), [1, 2, 3]);
  const duplicate = works.find(work => work.assets.filter(asset => asset.path.includes('The.Good.the.Bad.and.the.Ugly')).length === 2);
  assert.ok(duplicate, 'Golden trio duplicate editions should be merged');
  console.log(JSON.stringify({ works: works.length, movieFiles: movieFiles.length, discs: discs.length, episodes: episodes.length,
    deferredWhileWriting: absent.length,
    twinPeaksSeasons: [1, 2, 3], mergedGoodBadUgly: true }));
} finally { await app.close(); }
