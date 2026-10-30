import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';
import { Store } from '../dist-electron/electron/store.js';

fs.mkdirSync('.cache', { recursive: true });
const data = fs.mkdtempSync(path.resolve('.cache/release-titles-'));
const media = path.join(data, 'media'); fs.mkdirSync(media);
const store = await Store.open(path.join(data, 'library.sqlite'), path.resolve('dist-electron/sql-wasm.wasm'), {
  isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => ''
});
const films = [
  { name: 'Perfect Days AKA The Tokyo Toilet', year: 2023, imdbId: 'tt27503384', doubanId: '35902857', zh: '完美的日子', en: 'Perfect Days' },
  { name: '风柜来的人 All the Youthful Days', year: 1983, imdbId: 'tt0085533', doubanId: '1299436', zh: '风柜来的人', en: 'The Boys from Fengkuei' }
];
for (const film of films) {
  film.id = store.createWork('movie', film.name, film.year);
  const file = path.join(media, `${film.name}.${film.year}.mkv`); fs.writeFileSync(file, 'fixture');
  const old = new Date(Date.now() - 60_000); fs.utimesSync(file, old, old);
  store.putAsset({ workId: film.id, root: media, path: file, kind: 'file', season: null, episode: null, size: 7, mtimeMs: old.getTime() }, 1);
  store.queueTask('tmdb', film.id); store.queueTask('douban', film.id);
}
store.setRoots([media]);
store.replaceTop250(Array.from({ length: 250 }, (_, i) => ({ rank: i + 1, doubanId: String(8000000 + i) })));
store.replaceImdbTop250(Array.from({ length: 250 }, (_, i) => ({ rank: i + 1, imdbId: `tt${9000000 + i}` })));
store.close();
let app;
try {
  const packaged = process.env.FILM_LIBRARY_PACKAGED === '1';
  app = await electron.launch({ executablePath: path.resolve(packaged ? 'release/win-unpacked/Movie Glacier.exe' : 'node_modules/electron/dist/electron.exe'),
    args: ['--no-sandbox', '--disable-gpu', ...(packaged ? [] : ['.'])],
    env: { ...process.env, FILM_LIBRARY_DATA_DIR: data, FILM_LIBRARY_TEST_ONBOARDING: '1', FILM_LIBRARY_SMOKE: '0' } });
  const page = await app.firstWindow(); await page.locator('.brand').waitFor();
  await app.evaluate(async ({ session }, films) => {
    globalThis.metadataRequests = []; globalThis.doubanQueries = [];
    const json = data => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
    await session.fromPartition('persist:metadata').protocol.handle('https', request => {
      const url = new URL(request.url);
      if (url.hostname === 'query.wikidata.org') return json({ results: { bindings: [] } });
      if (url.hostname !== 'www.omdbapi.com') throw new Error(`Unexpected host: ${url.hostname}`);
      const id = url.searchParams.get('i'), title = url.searchParams.get('s');
      globalThis.metadataRequests.push({ id, title });
      if (id === 'tt0069293') return json({ Response: 'True' });
      if (title === 'Perfect Days') return json({ Response: 'True', Search: [{ Title: 'Perfect Days', Year: '2023', imdbID: films[0].imdbId }] });
      const film = films.find(film => film.imdbId === id);
      if (film) return json({ Response: 'True', Title: film.en, Year: String(film.year), imdbID: film.imdbId, Type: 'movie', Poster: 'N/A', Plot: 'English overview', Genre: 'Drama', imdbRating: '7.5' });
      return json({ Response: 'False', Error: title === 'All the Youthful Days' ? 'Too many results.' : 'Movie not found!' });
    });
    await session.fromPartition('persist:douban').protocol.handle('https', request => {
      const url = new URL(request.url), query = url.searchParams.get('q');
      if (url.pathname === '/j/subject_suggest') {
        globalThis.doubanQueries.push(query);
        const film = films.find(film => film.en === query || film.zh === query);
        return json(film ? [
          { id: film.doubanId, title: film.zh, sub_title: film.en, year: String(film.year) },
          { id: '1234567', title: 'Other film', sub_title: 'Other film', year: String(film.year) }
        ] : []);
      }
      const film = films.find(film => url.pathname === `/subject/${film.doubanId}/`);
      if (!film) throw new Error(`Unexpected Douban page: ${url.pathname}`);
      return new Response(`<div id="content"><h1><span>${film.zh}</span><span class="year">(${film.year})</span></h1></div>
        <div id="info">IMDb: ${film.imdbId}</div><strong property="v:average">8.5</strong><span property="v:votes">1000</span>
        <span property="v:genre">剧情</span><span property="v:summary">中文简介。</span>`, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    });
  }, films);
  await page.evaluate(() => window.library.setSettings({ omdbKey: 'integration-fixture-key' }));
  const job = await page.evaluate(() => window.library.retryFailed());
  assert.equal(job.failures, 0, 'a successful automatic retry clears the recovered failure count');
  const works = await page.evaluate(() => window.library.listWorks());
  for (const film of films) {
    const work = works.find(work => work.id === film.id);
    assert.equal(work.imdbId, film.imdbId);
    assert.equal(work.doubanId, film.doubanId);
    assert.equal(work.titleZh, film.zh);
    assert.equal(work.titleEn, film.en);
    assert.equal(work.ratingDouban, 8.5);
    assert.equal(work.ratingImdb, 7.5);
    assert.equal(work.matchState, 'matched');
  }
  assert.equal(works.length, 2, 'retry must update existing works instead of creating duplicate records');
  const requests = await app.evaluate(() => ({ metadata: globalThis.metadataRequests, douban: globalThis.doubanQueries }));
  assert.ok(requests.douban.includes('风柜来的人'), 'the Chinese alias is sent to Douban');
  assert.ok(requests.metadata.some(request => request.title === 'All the Youthful Days'), 'the original OMDb failure is exercised');
  assert.ok(requests.metadata.some(request => request.id === 'tt0085533'), 'Douban supplies the IMDb identity for the metadata retry');
  assert.equal((await page.evaluate(() => window.library.listScrapeLogs())).filter(log => log.status === 'failed').length, 0);
  console.log('Release-title matching passed: AKA and bilingual search, Too many results fallback, Douban IMDb backfill, same-job OMDb retry and no duplicate works.');
} finally { await app?.close(); }
