import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';
import { electronExecutable } from './electron-path.mjs';
import { Store } from '../dist-electron/electron/store.js';

process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY = '1';
const data = fs.mkdtempSync(path.resolve('.cache/season-aliases-'));
const media = path.join(data, 'media'); fs.mkdirSync(media);
const store = await Store.open(path.join(data, 'library.sqlite'), path.resolve('dist-electron/sql-wasm.wasm'), {
  isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => ''
});
const id = store.createWork('tv', 'Stranger Things', 2016);
store.setWorkFields(id, { titleEn: 'Stranger Things', originalTitle: 'Stranger Things', imdbId: 'tt4574334', matchState: 'matched' });
for (let season = 1; season <= 5; season++) {
  const file = path.join(media, `Stranger.Things.S0${season}E01.mkv`); fs.writeFileSync(file, 'fixture');
  const stamp = new Date(Date.now() - 60_000); fs.utimesSync(file, stamp, stamp);
  store.putAsset({ workId: id, root: media, path: file, kind: 'file', season, episode: 1, size: 7, mtimeMs: stamp.getTime() }, 1);
}
store.setRating(id, 'douban', 1, 9.1, 100, '26359270');
store.queueTask('douban', id); store.taskDone(store.pendingTasks()[0].id, undefined, '第 1 季 9.1 分；第 2 季暂未匹配');
store.setRoots([media]);
store.replaceTop250(Array.from({ length: 250 }, (_, i) => ({ rank: i + 1, doubanId: String(8000000 + i) })));
store.replaceImdbTop250(Array.from({ length: 250 }, (_, i) => ({ rank: i + 1, imdbId: `tt${9000000 + i}` })));
store.close();
const packaged = process.env.FILM_LIBRARY_PACKAGED === '1';
const app = await electron.launch({ executablePath: electronExecutable(), args: ['--no-sandbox', '--disable-gpu', ...(packaged ? [] : ['.'])],
  env: { ...process.env, FILM_LIBRARY_SMOKE: '1', FILM_LIBRARY_DATA_DIR: data } });
try {
  const page = await app.firstWindow(); await page.locator('.brand').waitFor();
  const moduleUrl = await app.evaluate(({ app }) => process.getBuiltinModule('url').pathToFileURL(
    process.getBuiltinModule('path').join(app.getAppPath(), 'dist-electron/electron/main.js')).href);
  const checks = await app.evaluate(async ({ session }, moduleUrl) => {
    const require = process.getBuiltinModule('module').createRequire(moduleUrl);
    const { Douban } = require('./douban.js');
    const { Store } = require('./store.js');
    Store.prototype.getSecret = () => 'fixture-only';
    const navigate = Douban.prototype.navigate;
    Douban.prototype.navigate = function (...args) { this.lastRequestAt = 0; return navigate.apply(this, args); };
    const numerals = ['零', '一', '二', '三', '四', '五'];
    // IDs/titles/query behavior mirror the public suggestion endpoint; scores are fixtures.
    const ids = ['26359270', '26844438', '27119156', '27194292', '35774681'];
    const subjects = ids.map((id, i) => ({ id, title: `怪奇物语 第${numerals[i + 1]}季`, sub_title: 'Stranger Things',
      year: String([2016, 2017, 2019, 2022, 2025][i]), score: [9.1, 8.9, 8.7, 9.4, 7.2][i],
      imdbId: i === 0 ? 'tt4574334' : `tt602068${i + 3}` }));
    globalThis.aliasQueries = [];
    await session.fromPartition('persist:douban').protocol.handle('https', request => {
      const url = new URL(request.url), query = url.searchParams.get('q');
      if (url.pathname === '/j/subject_suggest') {
        globalThis.aliasQueries.push(query);
        let results = [];
        if (query === 'Stranger Things') results = [subjects[0]];
        if (query === '怪奇物语') results = subjects;
        for (let season = 1; season <= 5; season++) if (query === `怪奇物语第${numerals[season]}季`) results = [subjects[season - 1]];
        return new Response(JSON.stringify(results), { headers: { 'content-type': 'application/json' } });
      }
      const subject = subjects.find(item => url.pathname === `/subject/${item.id}/`);
      if (!subject) throw new Error(`Unexpected fixture URL: ${url.pathname}`);
      return new Response(`<div id="content"><h1><span>${subject.title}</span><span class="year">(${subject.year})</span></h1></div>
        <div id="info">IMDb: ${subject.imdbId}</div><strong property="v:average">${subject.score}</strong><span property="v:votes">100</span>
        <span property="v:genre">剧情</span><span property="v:summary">分季简介。</span>`, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    });
    const probe = new Douban();
    const work = { mediaType: 'tv', titleZh: 'Stranger Things', titleEn: 'Stranger Things', originalTitle: 'Stranger Things', year: 2016, imdbId: 'tt4574334' };
    const second = await probe.findSubject(work, 2);
    const movie = await probe.findSubject({ ...work, mediaType: 'movie', titleZh: '怪奇物语', titleEn: 'Stranger Things', year: 2017 }, null);
    process.env.FILM_LIBRARY_SMOKE = '0';
    return { second: second?.id, secondImdb: second?.imdbId, movie: movie?.id ?? null };
  }, moduleUrl);
  assert.equal(checks.second, '26844438', 'an English-only series learns its Chinese alias from the verified first season');
  assert.notEqual(checks.secondImdb, 'tt4574334', 'the fixture exercises an episode IMDb ID');
  assert.equal(checks.movie, null, 'a TV suggestion cannot become a movie');
  const job = await page.evaluate(() => window.library.updateLibrary());
  assert.equal(job.failures, 0);
  const work = (await page.evaluate(() => window.library.listWorks())).find(work => work.id === id);
  assert.equal(work.titleZh, '怪奇物语');
  assert.equal(work.titleEn, 'Stranger Things');
  assert.equal(work.imdbId, 'tt4574334', 'season episode IDs must not replace the series IMDb identity');
  assert.deepEqual(work.seasonRatings.map(rating => [rating.season, rating.sourceId]), [[1, '26359270'], [2, '26844438'], [3, '27119156'], [4, '27194292'], [5, '35774681']]);
  const logs = await page.evaluate(() => window.library.listScrapeLogs());
  assert.equal(logs.filter(log => log.status === 'failed').length, 0);
  assert.ok(!logs.some(log => log.message.includes('暂未匹配')));
  const requests = await app.evaluate(() => globalThis.aliasQueries.length);
  await page.evaluate(() => window.library.updateLibrary());
  assert.equal(await app.evaluate(() => globalThis.aliasQueries.length), requests, 'completed season scores are not queued again');
  await page.locator('.main-tabs button').nth(1).click();
  await page.getByRole('button', { name: '查看《怪奇物语》详情', exact: true }).click();
  await page.locator('#season-5 .season-heading-ratings').waitFor();
  assert.equal(await page.locator('.season-summary').count(), 5);
  for (const [season, score] of [[1, '9.1'], [2, '8.9'], [3, '8.7'], [4, '9.4'], [5, '7.2']])
    assert.ok((await page.locator(`#season-${season} .season-heading-ratings`).innerText()).includes(score));
  await page.screenshot({ path: path.resolve('.cache/stranger-season-ratings.png'), animations: 'disabled' });
  console.log('Season alias recovery passed: English-only title, real endpoint query shapes, different episode IMDb IDs, five independent ratings, completed partial-task recovery and stable updates.');
} finally { await app.close(); }
