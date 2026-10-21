import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';
import { Store } from '../dist-electron/electron/store.js';

const base = path.resolve(`.cache/person-search-${Date.now()}`);
const root = path.join(base, 'media');
const data = path.join(base, 'app-data');
fs.mkdirSync(root, { recursive: true });
const secretStorage = { isEncryptionAvailable: () => true,
  encryptString: value => Buffer.from(value), decryptString: value => value.toString('utf8') };
const store = await Store.open(path.join(data, 'library.sqlite'), path.resolve('dist-electron/sql-wasm.wasm'), secretStorage);
store.setRoots([root]);
for (const [name, year, director, actor] of [
  ['Mirror', 1975, { id: '1', name: '安德烈·塔可夫斯基', originalName: 'Andrei Tarkovsky' },
    { id: '2', name: '玛格丽塔·捷列霍娃', originalName: 'Margarita Terekhova', aliases: ['玛格丽塔·特列霍娃'] }],
  ['Fargo', 1996, { id: '3', name: '乔尔·科恩', originalName: 'Joel Coen' },
    { id: '4', name: '弗兰西斯·麦克多蒙德', originalName: 'Frances McDormand' }]
]) {
  const file = path.join(root, `${name}.${year}.mkv`);
  fs.writeFileSync(file, 'media');
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(file, old, old);
  const id = store.createWork('movie', name, year);
  store.putAsset({ workId: id, root, path: file, kind: 'file', season: null, episode: null,
    size: fs.statSync(file).size, mtimeMs: fs.statSync(file).mtimeMs }, Date.now());
  store.setWorkFields(id, { directors: [director], actors: [actor] });
}
store.close();
const packaged = process.env.FILM_LIBRARY_PACKAGED === '1';
const app = await electron.launch({
  executablePath: packaged ? path.resolve('release/win-unpacked/Movie Glacier.exe') : path.resolve('node_modules/electron/dist/electron.exe'),
  args: packaged ? ['--no-sandbox', '--disable-gpu'] : ['--no-sandbox', '--disable-gpu', '.'],
  env: { ...process.env, FILM_LIBRARY_DATA_DIR: data, FILM_LIBRARY_SMOKE: '1' }
});
try {
  const page = await app.firstWindow();
  await page.locator('.poster-card').first().waitFor();
  const input = page.getByPlaceholder('搜索电影、导演或演员（中英文）');
  for (const query of ['Terekhova', '特列霍娃', 'Tarkovsky', '塔可夫斯基']) {
    await input.fill(query);
    assert.equal(await page.locator('.poster-card').count(), 1, query);
  }
  await input.fill('');
  await page.locator('.poster-card').filter({ hasText: 'Mirror' }).click();
  await page.getByRole('button', { name: /玛格丽塔·捷列霍娃/ }).click();
  assert.equal(await input.inputValue(), '玛格丽塔·捷列霍娃');
  assert.equal(await page.locator('.poster-card').count(), 1);
  await input.fill('');
  await page.locator('.poster-card').filter({ hasText: 'Mirror' }).click();
  await page.getByRole('button', { name: /安德烈·塔可夫斯基/ }).click();
  assert.equal(await input.inputValue(), '安德烈·塔可夫斯基');
  assert.equal(await page.locator('.poster-card').count(), 1);
  console.log('Bilingual director and actor search plus name-click navigation passed.');
} finally { await app.close(); }
