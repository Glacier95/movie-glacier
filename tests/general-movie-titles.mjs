import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';
import { electronExecutable } from './electron-path.mjs';
import { Store } from '../dist-electron/electron/store.js';

const films = [
  ['tt0117060', 'Mission: Impossible', 1996, '碟中谍'],
  ['tt0120755', 'Mission: Impossible II', 2000, '碟中谍2'],
  ['tt0317919', 'Mission: Impossible III', 2006, '碟中谍3'],
  ['tt1229238', 'Mission: Impossible - Ghost Protocol', 2011, '碟中谍4：幽灵协议'],
  ['tt2381249', 'Mission: Impossible - Rogue Nation', 2015, '碟中谍5'],
  ['tt4912910', 'Mission: Impossible - Fallout', 2018, '碟中谍6：全面瓦解'],
  ['tt9603212', 'Mission: Impossible - Dead Reckoning Part One', 2023, '碟中谍7：致命清算（上）'],
  ['tt9603208', 'Mission: Impossible - The Final Reckoning', 2025, '碟中谍8：最终清算']
].map(([imdbId, en, year, zh], index) => ({ imdbId, en, year, zh, item: `Q${index + 100}` }));
fs.mkdirSync('.cache', { recursive: true });
const data = fs.mkdtempSync(path.resolve('.cache/general-titles-'));
const open = () => Store.open(path.join(data, 'library.sqlite'), path.resolve('dist-electron/sql-wasm.wasm'), {
  isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => ''
});
let store = await open();
const add = (imdbId, title, en = '') => {
  const id = store.createWork('movie', title, 2020);
  store.setWorkFields(id, { imdbId, doubanTitleZh: title, titleEn: en, matchState: 'matched' });
  const file = path.join(data, `${id}.mkv`); fs.writeFileSync(file, 'fixture');
  store.putAsset({ workId: id, root: data, path: file, kind: 'file', season: null, episode: null, size: 7, mtimeMs: 1 }, 1);
  return id;
};
for (const film of films) { film.id = add(film.imdbId, '碟中谍', film.en); store.setWorkFields(film.id, { year: film.year }); }
const unknown = add('tt9876543', '另一系列');
const manual = add('tt1111111', '手动片名'); store.setManualFields(manual, { titleZh: '手动片名' });
const ambiguous = add('tt2222222', '待确认中文名');
const missing = add('tt3333333', '保留原中文名');
store.setSetting('appearance-fixture', 'keep');
store.run("DELETE FROM settings WHERE key='localizedMovieTitlesV2'"); store.close();
const packaged = process.env.FILM_LIBRARY_PACKAGED === '1';
const launch = () => electron.launch({ executablePath: electronExecutable(packaged), args: packaged ? [] : ['.'],
  env: { ...process.env, FILM_LIBRARY_DATA_DIR: data, FILM_LIBRARY_SMOKE: '1' } });
let app = await launch();
try {
  const page = await app.firstWindow(); await page.locator('.poster-card').first().waitFor();
  assert.equal((await page.evaluate(() => window.library.listWorks())).filter(work => work.titleZh === '碟中谍').length, 8);
  await app.evaluate(async ({ session }, films) => {
    globalThis.titleRequests = [];
    await session.fromPartition('persist:metadata').protocol.handle('https', request => {
      const url = new URL(request.url);
      if (url.hostname !== 'query.wikidata.org') throw new Error(`Unexpected host: ${url.hostname}`);
      const id = /wdt:P345 "(tt\d+)"/.exec(url.searchParams.get('query'))?.[1];
      globalThis.titleRequests.push(id);
      const film = films.find(film => film.imdbId === id);
      const row = (item, title) => ({ item: { value: `http://www.wikidata.org/entity/${item}` },
        itemLabel: { value: title, 'xml:lang': 'zh-cn' } });
      const bindings = film ? [film.imdbId === 'tt2381249' ? { ...row(film.item, '不可能的任务：失控国度'),
        series: { value: 'http://www.wikidata.org/entity/Q642441' }, part: { value: '5' } } : row(film.item, film.zh)]
        : id === 'tt9876543' ? [row('Q999', '另一系列2：未曾预设的续集')]
        : id === 'tt2222222' ? [row('Q1000', '错片'), row('Q1001', '错片')]
        : id === 'tt3333333' ? [] : (() => { throw new Error(`Unexpected IMDb ID: ${id}`); })();
      return new Response(JSON.stringify({ results: { bindings } }), { headers: { 'content-type': 'application/json' } });
    });
  }, films);
  const job = await page.evaluate(() => window.library.updateLibrary());
  assert.equal(job.failures, 0, 'Chinese title tasks work without OMDb/TMDB keys or Douban access');
  const works = await page.evaluate(() => window.library.listWorks());
  for (const film of films) {
    const work = works.find(work => work.id === film.id);
    assert.equal(work.titleZh, film.zh); assert.equal(work.titleEn, film.en); assert.equal(work.imdbId, film.imdbId);
    await page.locator('.poster-card').filter({ hasText: film.zh }).first().waitFor();
  }
  assert.equal(works.find(work => work.id === unknown).titleZh, '另一系列2：未曾预设的续集', 'no franchise-specific table is required');
  assert.equal(works.find(work => work.id === manual).titleZh, '手动片名');
  assert.equal(works.find(work => work.id === ambiguous).titleZh, '待确认中文名');
  assert.equal(works.find(work => work.id === missing).titleZh, '保留原中文名');
  assert.equal(await app.evaluate(() => globalThis.titleRequests.includes('tt1111111')), false, 'manual titles are not queried');
  await page.evaluate(() => window.library.updateLibrary());
  assert.equal(await app.evaluate(() => globalThis.titleRequests.length), 11, 'completed title tasks do not refetch on every library update');
  await page.screenshot({ path: path.resolve(`.cache/general-titles-${packaged ? 'packaged' : 'development'}.png`) });
  await app.close(); app = null;
  store = await open();
  for (const film of films) {
    store.setWorkFields(film.id, { titleZh: '碟中谍', doubanTitleZh: '碟中谍' }); store.applyDoubanTitle(film.id);
    assert.equal(store.work(film.id).titleZh, film.zh, 'later source abbreviations cannot replace cached full titles');
  }
  const fail1 = add('tt4444444', '网络失败保留1'), fail2 = add('tt5555555', '网络失败保留2');
  store.queueTask('wikidata', fail1); store.queueTask('wikidata', fail2); store.close();
  app = await launch();
  const page2 = await app.firstWindow(); await page2.locator('.poster-card').first().waitFor();
  await app.evaluate(async ({ session }) => {
    globalThis.failedTitleRequests = 0;
    await session.fromPartition('persist:metadata').protocol.handle('https', () => {
      globalThis.failedTitleRequests++; return new Response('', { status: 503 });
    });
  });
  const outage = await page2.evaluate(() => window.library.updateLibrary());
  assert.equal(outage.failures, 1);
  assert.equal(await app.evaluate(() => globalThis.failedTitleRequests), 1, 'an unavailable provider pauses remaining title requests');
  assert.equal((await page2.evaluate(() => window.library.listWorks())).find(work => work.id === fail1).titleZh, '网络失败保留1');
  await app.close(); app = null;
  store = await open();
  assert.ok(store.pendingTasks().some(task => task.workId === fail2 && task.type === 'wikidata'));
  assert.equal(store.getSetting('appearance-fixture'), 'keep'); store.close();
  console.log(`General movie title integration passed (${packaged ? 'packaged' : 'development'}): eight Mission: Impossible films, unseen franchise, no keys, persistent cache, protected manual edits, ambiguity/no-result rejection and isolated provider outage.`);
} finally { await app?.close(); }
