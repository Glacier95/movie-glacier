import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';
import { Store } from '../dist-electron/electron/store.js';

process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY = '1';

fs.mkdirSync('.cache', { recursive: true });
const data = fs.mkdtempSync(path.resolve('.cache/imdb-top250-'));
const media = path.join(data, 'media'); fs.mkdirSync(media);
const store = await Store.open(path.join(data, 'library.sqlite'), path.resolve('dist-electron/sql-wasm.wasm'), {
  isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => ''
});
const imdbChart = Array.from({ length: 250 }, (_, i) => ({ rank: i + 1, imdbId: `tt${String(1000000 + i)}` }));
const doubanChart = Array.from({ length: 250 }, (_, i) => ({ rank: i + 1, doubanId: String(2000000 + i) }));
for (const [i, title] of ['Both charts', 'IMDb only', 'Douban only', 'Neither chart', 'Unmatched movie', 'Series'].entries()) {
  const id = store.createWork(i === 5 ? 'tv' : 'movie', title, 2000 + i);
  store.setWorkFields(id, { titleEn: title, matchState: 'matched',
    imdbId: i === 0 || i === 5 ? imdbChart[0].imdbId : i === 1 ? imdbChart[249].imdbId : null,
    doubanId: i === 0 ? doubanChart[4].doubanId : i === 2 ? doubanChart[0].doubanId : null });
  const file = path.join(media, `${i}.mkv`); fs.writeFileSync(file, 'fixture');
  store.putAsset({ workId: id, root: media, path: file, kind: 'file', season: null, episode: null, size: 1, mtimeMs: 1 }, Date.now());
}
store.replaceTop250(doubanChart); store.replaceImdbTop250(imdbChart);
store.setRoots([media]); store.close();
let app;
try {
  app = await electron.launch({ executablePath: path.resolve('node_modules/electron/dist/electron.exe'),
    args: ['--no-sandbox', '--disable-gpu', '.'], env: { ...process.env, FILM_LIBRARY_DATA_DIR: data, FILM_LIBRARY_SMOKE: '1' } });
  const page = await app.firstWindow(); page.setDefaultTimeout(15_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = []; page.on('pageerror', error => errors.push(String(error)));
  await page.locator('.poster-card').first().waitFor();
  assert.equal(await page.locator('.poster-card').count(), 5);
  const settings = await page.evaluate(() => window.library.getSettings());
  assert.ok(settings.imdbTop250UpdatedAt);
  await page.getByRole('button', { name: /筛选/ }).click();
  await page.getByRole('button', { name: 'IMDb Top 250', exact: true }).click();
  assert.equal(await page.getByRole('button', { name: 'IMDb Top 250', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('.poster-card').count(), 2);
  await page.getByRole('button', { name: '豆瓣 Top250', exact: true }).click();
  assert.equal(await page.locator('.poster-card').count(), 1, 'two chart filters intersect');
  await page.getByRole('button', { name: '豆瓣 Top250 ×', exact: true }).click();
  assert.equal(await page.locator('.poster-card').count(), 2);
  await page.getByRole('button', { name: 'IMDb Top 250 ×', exact: true }).click();
  assert.equal(await page.locator('.poster-card').count(), 5);
  await page.getByRole('button', { name: '查看《Both charts》详情', exact: true }).click();
  assert.equal(await page.locator('.hero-ratings .top-badge').count(), 2);
  const badge = page.getByRole('button', { name: 'IMDb Top 250 · 第 1 名', exact: true });
  assert.match(await badge.getAttribute('title'), /榜单更新于/);
  await page.screenshot({ path: path.resolve('.cache/imdb-top250-detail.png'), animations: 'disabled' });
  await badge.click();
  assert.equal(await page.locator('.poster-card').count(), 2, 'badge opens chart filter');
  await page.getByRole('button', { name: '清除筛选', exact: true }).click();
  assert.equal(await page.locator('.poster-card').count(), 5);
  await page.getByRole('button', { name: 'IMDb Top 250', exact: true }).click();
  await page.getByRole('button', { name: 'Series 1', exact: true }).click();
  await page.getByRole('button', { name: 'IMDb Top 250', exact: true }).click();
  assert.equal(await page.locator('.poster-card').count(), 0, 'IMDb movie chart excludes series');
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  const metric = page.locator('.overview-metric').filter({ hasText: 'IMDb TOP 250' });
  assert.equal(await metric.locator('strong').innerText(), '2');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.resolve('.cache/imdb-top250-mobile.png'), animations: 'disabled' });
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.getByRole('banner').getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: 'English', exact: true }).click();
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  await page.getByRole('button', { name: 'Movies 5', exact: true }).click();
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await page.getByRole('button', { name: 'View details for Both charts', exact: true }).click();
  await page.getByRole('button', { name: 'IMDb Top 250 · #1', exact: true }).waitFor();
  await page.screenshot({ path: path.resolve('.cache/imdb-top250-english.png'), animations: 'disabled' });
  assert.deepEqual(errors, []);

  // Exercise the real hidden Chromium loader against deterministic official-page
  // responses, independently of external network access or IMDb challenges.
  const moduleUrl = pathToFileURL(path.resolve('dist-electron/electron/imdb.js')).href;
  const html = `<script id="__NEXT_DATA__">${JSON.stringify({ props: { pageProps: { pageData: { chartTitles: {
    edges: imdbChart.map(({ rank, imdbId }) => ({ currentRank: rank, node: { id: imdbId } }))
  } } } } })}</script>`;
  const loaded = await app.evaluate(async ({ session, BrowserWindow }, { moduleUrl, html }) => {
    const network = session.fromPartition('persist:metadata');
    await network.protocol.handle('https', () => new Response(html, { headers: { 'content-type': 'text/html' } }));
    const before = BrowserWindow.getAllWindows().length;
    try {
      const vm = process.getBuiltinModule('vm');
      const { fetchImdbTop250 } = await vm.runInThisContext(`import(${JSON.stringify(moduleUrl)})`, {
        importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER
      });
      const entries = await fetchImdbTop250();
      return { entries, closed: BrowserWindow.getAllWindows().length === before };
    } finally { network.protocol.unhandle('https'); }
  }, { moduleUrl, html });
  assert.deepEqual(loaded.entries, imdbChart);
  assert.ok(loaded.closed, 'temporary chart window is destroyed after loading');
  await app.evaluate(async ({ session }, html) => {
    await session.fromPartition('persist:metadata').protocol.handle('https', () => new Response(html, { headers: { 'content-type': 'text/html' } }));
  }, html);
  try {
    await page.getByRole('banner').getByRole('button', { name: 'Settings', exact: true }).click();
    const opened = app.waitForEvent('window');
    await page.getByRole('button', { name: 'Open IMDb / Verify', exact: true }).click();
    const verification = await opened;
    await verification.waitForURL('https://www.imdb.com/chart/top/');
    assert.ok(await app.evaluate(({ BrowserWindow, session }) => BrowserWindow.getAllWindows().some(window =>
      window.webContents.getURL() === 'https://www.imdb.com/chart/top/' && window.webContents.session === session.fromPartition('persist:metadata'))));
    await verification.close();
  } finally { await app.evaluate(({ session }) => session.fromPartition('persist:metadata').protocol.unhandle('https')); }
  console.log('IMDb Top 250 UI passed: independent filters, intersection, reset, badges, dates, overview, translations, series exclusion and Chromium loader.');
} finally { await app?.close(); }
