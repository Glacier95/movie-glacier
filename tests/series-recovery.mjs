import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { _electron as electron } from 'playwright-core';
import { electronExecutable } from './electron-path.mjs';
import { Store } from '../dist-electron/electron/store.js';

fs.mkdirSync('.cache', { recursive: true });
const data = fs.mkdtempSync(path.resolve('.cache/series-recovery-'));
const media = path.join(data, 'media'); fs.mkdirSync(media);
const store = await Store.open(path.join(data, 'library.sqlite'), path.resolve('dist-electron/sql-wasm.wasm'), {
  isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => ''
});
const add = (id, name, season) => {
  const file = path.join(media, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'fixture');
  const stamp = new Date(Date.now() - 60_000); fs.utimesSync(file, stamp, stamp); const stat = fs.statSync(file);
  store.putAsset({ workId: id, root: media, path: file, kind: 'file', season, episode: 1, size: stat.size, mtimeMs: stat.mtimeMs }, 1);
};
const robots = store.createWork('tv', 'Love, Death & Robots', 2019);
store.setWorkFields(robots, { imdbId: 'tt1000001', matchState: 'matched' });
add(robots, 'Love.Death.and.Robots.S01E01.2019.mkv', 1);
const duplicate = store.createWork('tv', 'Love Death and Robots', null);
store.setFavorite(duplicate, true);
add(duplicate, 'Love.Death.and.Robots.S03E01.2022.mkv', 3);
add(duplicate, 'Love.Death.and.Robots/Volume 4/E01.mkv', null);
store.recordSourceRefresh(duplicate, 'douban', '旧分季匹配失败');
const reply = store.createWork('movie', '请回答', 1988);
add(reply, '请回答1988/01.mkv', null);
store.recordSourceRefresh(reply, 'omdb', '旧条目类型不符');
store.setRoots([media]);
store.replaceTop250(Array.from({ length: 250 }, (_, i) => ({ rank: i + 1, doubanId: String(8000000 + i) })));
store.replaceImdbTop250(Array.from({ length: 250 }, (_, i) => ({ rank: i + 1, imdbId: `tt${9000000 + i}` })));
store.close();
const packaged = process.env.FILM_LIBRARY_PACKAGED === '1';
const app = await electron.launch({ executablePath: electronExecutable(), args: ['--no-sandbox', '--disable-gpu', ...(packaged ? [] : ['.'])],
  env: { ...process.env, FILM_LIBRARY_SMOKE: '1', FILM_LIBRARY_DATA_DIR: data } });
try {
  const page = await app.firstWindow(); await page.locator('.brand').waitFor();
  await app.evaluate(async ({ session }, moduleUrl) => {
    const require = process.getBuiltinModule('module').createRequire(moduleUrl);
    const { Metadata } = require('./metadata.js'), { Douban } = require('./douban.js'), { Store } = require('./store.js');
    Store.prototype.getSecret = () => 'fixture-only';
    Metadata.prototype.checkTmdb = async () => { throw new Error('fetch failed: fixture outage'); };
    Metadata.prototype.checkOmdb = async () => {};
    Metadata.prototype.hydrateOmdb = async function (id) {
      globalThis.seriesStore = this.store;
      const work = this.store.work(id);
      if (work.mediaType !== 'tv') throw new Error('Series classification was not repaired');
      const robots = !work.titleZh.includes('请回答');
      this.store.setWorkFields(id, { titleEn: robots ? 'Love, Death & Robots' : 'Reply 1988',
        year: robots ? 2019 : 2015, imdbId: robots ? 'tt1000001' : 'tt2000001', matchState: 'matched' });
      return [];
    };
    const navigate = Douban.prototype.navigate;
    Douban.prototype.navigate = function (...args) { this.lastRequestAt = 0; return navigate.apply(this, args); };
    const subjects = [
      { id: '3000001', title: '爱，死亡和机器人 第一季', sub_title: 'Love, Death & Robots', year: '2019', rating: 9.2 },
      { id: '3000003', title: '爱，死亡和机器人 第三季', sub_title: 'Love, Death & Robots Volume 3', year: '2022', rating: 8.5 },
      { id: '3000004', title: '爱，死亡和机器人 第四季', sub_title: 'Love, Death & Robots Volume 4', year: '2025', rating: 8.1 },
      { id: '4000001', title: '请回答1988', sub_title: 'Reply 1988', year: '2015', rating: 9.7 }
    ];
    globalThis.seasonQueries = [];
    await session.fromPartition('persist:douban').protocol.handle('https', request => {
      const url = new URL(request.url);
      if (url.pathname === '/j/subject_suggest') {
        const query = url.searchParams.get('q'); globalThis.seasonQueries.push(query);
        const reply = query.includes('请回答') || query.includes('Reply');
        return new Response(JSON.stringify(subjects.filter(item => (item.id === '4000001') === reply)), { headers: { 'content-type': 'application/json' } });
      }
      const subject = subjects.find(item => url.pathname === `/subject/${item.id}/`);
      if (!subject) throw new Error(`Unexpected fixture request: ${url.pathname}`);
      return new Response(`<div id="content"><h1><span>${subject.title}</span><span class="year">(${subject.year})</span></h1></div>
        <div id="info">IMDb: ${subject.id === '4000001' ? 'tt2000001' : 'tt1000001'}</div>
        <strong property="v:average">${subject.rating}</strong><span property="v:votes">100</span>
        <span property="v:genre">剧情</span><span property="v:summary">测试分季简介。</span>`, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    });
    process.env.FILM_LIBRARY_SMOKE = '0';
  }, pathToFileURL(path.resolve('dist-electron/electron/main.js')).href);
  const job = await page.evaluate(() => window.library.retryFailed());
  assert.equal(job.failures, 0);
  const works = await page.evaluate(() => window.library.listWorks());
  assert.equal(works.length, 2);
  const series = works.find(work => work.id === robots);
  assert.equal(series.favorite, true);
  assert.equal(series.titleZh, '爱，死亡和机器人');
  assert.deepEqual(series.assets.map(asset => asset.season).sort(), [1, 3, 4]);
  assert.deepEqual([series.ratingSeason, series.ratingDouban], [4, 8.1]);
  const ratings = await app.evaluate(() => globalThis.seriesStore.all("SELECT season,sourceId FROM ratings WHERE workId=? AND source='douban' ORDER BY season", [1]));
  assert.deepEqual(ratings, [{ season: 1, sourceId: '3000001' }, { season: 3, sourceId: '3000003' }, { season: 4, sourceId: '3000004' }]);
  assert.equal(works.find(work => work.id === reply).mediaType, 'tv');
  assert.equal(works.find(work => work.id === reply).year, 2015);
  assert.equal(works.find(work => work.id === reply).ratingDouban, 9.7, 'single-season shows can use their whole-series Douban entry');
  assert.equal((await page.evaluate(() => window.library.listScrapeLogs())).filter(log => log.status === 'failed').length, 0);
  const queries = await app.evaluate(() => globalThis.seasonQueries.length);
  await page.evaluate(() => window.library.retryFailed());
  assert.equal(await app.evaluate(() => globalThis.seasonQueries.length), queries, 'resolved attempts and merged entries stay repaired');
  console.log('Series recovery passed: one card, seasons 1/3/4, per-season IDs and ratings, favorites, Reply 1988 type repair, whole-series fallback and stable retry.');
} finally { await app.close(); }
