import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';
import { electronExecutable } from './electron-path.mjs';
import { Store } from '../dist-electron/electron/store.js';

fs.mkdirSync('.cache', { recursive: true });
const data = fs.mkdtempSync(path.resolve('.cache/franchise-posters-'));
fs.mkdirSync(path.join(data, 'images'));
const artwork = fs.readFileSync('build/icon.png');
const oldPoster = `${'a'.repeat(40)}.jpg`;
const films = [
  { imdbId: 'tt0120737', year: 2001, zh: '指环王1：护戒使者', en: 'The Lord of the Rings: The Fellowship of the Ring' },
  { imdbId: 'tt0167261', year: 2002, zh: '指环王2：双塔奇兵', en: 'The Lord of the Rings: The Two Towers' },
  { imdbId: 'tt0167260', year: 2003, zh: '指环王3：王者无敌', en: 'The Lord of the Rings: The Return of the King' }
];
const store = await Store.open(path.join(data, 'library.sqlite'), path.resolve('dist-electron/sql-wasm.wasm'), {
  isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => ''
});
for (const [index, film] of films.entries()) {
  film.id = store.createWork('movie', '指环王', film.year);
  film.doubanId = String(1000000 + index);
  film.posterUrl = `https://m.media-amazon.com/images/${film.imdbId}.jpg`;
  film.poster = crypto.createHash('sha1').update(film.posterUrl).digest('hex') + '.jpg';
  store.setWorkFields(film.id, { imdbId: film.imdbId, tmdbId: 100 + index, doubanId: film.doubanId,
    titleEn: film.en, doubanTitleZh: '指环王', poster: oldPoster, matchState: 'matched' });
  const file = path.join(data, `film-${index}.mkv`); fs.writeFileSync(file, 'fixture');
  store.putAsset({ workId: film.id, root: data, path: file, kind: 'file', season: null, episode: null, size: 7, mtimeMs: 1 }, 1);
}
fs.writeFileSync(path.join(data, 'images', oldPoster), artwork);
store.run("DELETE FROM settings WHERE key='movieTitlesAndPostersV1'"); store.close();
const packaged = process.env.FILM_LIBRARY_PACKAGED === '1';
const app = await electron.launch({ executablePath: electronExecutable(packaged), args: packaged ? [] : ['.'],
  env: { ...process.env, FILM_LIBRARY_DATA_DIR: data, FILM_LIBRARY_SMOKE: '1' } });
try {
  const page = await app.firstWindow(); await page.locator('.poster-card').first().waitFor();
  const upgraded = await page.evaluate(() => window.library.listWorks());
  assert.deepEqual(upgraded.map(work => work.titleZh).sort(), films.map(film => film.zh).sort());
  await app.evaluate(async ({ session }, { films, artwork }) => {
    globalThis.posterRequests = []; globalThis.posterMode = 'ok';
    const json = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
    await session.fromPartition('persist:metadata').protocol.handle('https', request => {
      const url = new URL(request.url); globalThis.posterRequests.push(request.url);
      if (url.hostname === 'www.omdbapi.com') {
        const film = films.find(film => film.imdbId === url.searchParams.get('i'));
        if (!film) return json({ Response: 'True' });
        return json({ Response: 'True', imdbID: film.imdbId, Title: film.en, Type: 'movie', Year: String(film.year),
          Poster: globalThis.posterMode === 'missing' ? 'N/A' : globalThis.posterMode === 'invalid' ? 'https://movie.douban.com/poster.jpg'
            : film.posterUrl + (globalThis.posterMode === 'ok' ? '' : `?${globalThis.posterMode}`),
          Plot: 'English overview', imdbRating: globalThis.posterMode === 'unrated' ? 'N/A' : '8.8', imdbVotes: '1000' });
      }
      if (url.hostname === 'm.media-amazon.com') {
        if (globalThis.posterMode === 'failed') return new Response('not found', { status: 404 });
        if (globalThis.posterMode === 'empty') return new Response('', { headers: { 'content-type': 'image/jpeg' } });
        return new Response(Uint8Array.from(artwork), { headers: { 'content-type': 'image/png' } });
      }
      if (url.hostname === 'api.themoviedb.org') {
        const id = Number(/\/movie\/(\d+)/.exec(url.pathname)?.[1]);
        const film = films[id - 100];
        if (url.pathname.endsWith('/external_ids')) return json({ imdb_id: film.imdbId });
        if (url.pathname.endsWith('/credits')) return json({ crew: [], cast: [] });
        return json({ title: url.searchParams.get('language') === 'zh-CN' ? '指环王' : film.en,
          release_date: `${film.year}-01-01`, poster_path: '/tmdb-poster.jpg' });
      }
      throw new Error(`Unexpected provider request: ${url.hostname}`);
    });
    await session.fromPartition('persist:douban').protocol.handle('https', request => {
      const url = new URL(request.url);
      if (url.pathname === '/j/subject_suggest') return json([{ id: films[0].doubanId, title: '指环王', sub_title: films[0].en, year: '2001' }]);
      const film = films.find(film => url.pathname === `/subject/${film.doubanId}/`);
      if (!film) throw new Error(`Unexpected Douban request: ${url.pathname}`);
      return new Response(`<div id="content"><h1><span>${film.zh}</span><span class="year">(${film.year})</span></h1></div>
        <div id="info">IMDb: ${film.imdbId}</div><strong property="v:average">9.0</strong><span property="v:votes">1000</span>
        <span property="v:summary">测试中文简介。</span><img src="https://movie.douban.com/poster.jpg">`,
        { headers: { 'content-type': 'text/html; charset=utf-8' } });
    });
  }, { films, artwork: [...artwork] });
  await page.evaluate(() => window.library.setSettings({ omdbKey: 'fixture-only-key', tmdbKey: 'fixture-only-token' }));
  for (const film of films) {
    const result = await page.evaluate(id => window.library.refreshWorkMetadata(id, 'omdb'), film.id);
    assert.equal(result.failures, 0);
    const work = (await page.evaluate(() => window.library.listWorks())).find(work => work.id === film.id);
    assert.equal(work.titleZh, film.zh); assert.equal(work.titleEn, film.en); assert.equal(work.poster, film.poster);
    assert.deepEqual(fs.readFileSync(path.join(data, 'images', work.poster)), artwork);
  }
  const id = films[0].id;
  // A successful TMDB refresh still uses the OMDb artwork.
  assert.equal((await page.evaluate(id => window.library.refreshWorkMetadata(id, 'tmdb'), id)).failures, 0);
  assert.equal((await page.evaluate(() => window.library.listWorks())).find(work => work.id === id).poster, films[0].poster);
  for (const mode of ['failed', 'empty', 'missing', 'invalid']) {
    await app.evaluate((_electron, mode) => { globalThis.posterMode = mode; }, mode);
    await page.evaluate(id => window.library.refreshWorkMetadata(id, 'omdb'), id);
    const work = (await page.evaluate(() => window.library.listWorks())).find(work => work.id === id);
    assert.equal(work.poster, films[0].poster, `${mode} artwork retains the cached poster`);
    assert.equal(work.titleZh, films[0].zh);
  }
  await app.evaluate(() => { globalThis.posterMode = 'ok'; });
  // Upgrade's queued IMDb refresh also updates artwork for unrated films.
  await app.evaluate(() => { globalThis.posterMode = 'unrated'; });
  await page.evaluate(() => window.library.updateLibrary());
  const unrated = (await page.evaluate(() => window.library.listWorks())).find(work => work.id === id);
  assert.equal(unrated.poster, crypto.createHash('sha1').update(films[0].posterUrl + '?unrated').digest('hex') + '.jpg');
  await app.evaluate(() => { globalThis.posterMode = 'ok'; });
  await page.evaluate(id => window.library.refreshWorkMetadata(id, 'omdb'), id);
  assert.equal((await page.evaluate(id => window.library.refreshWorkMetadata(id, 'douban'), id)).failures, 0);
  const requests = await app.evaluate(() => globalThis.posterRequests);
  assert.ok(requests.some(url => url.startsWith('https://m.media-amazon.com/')));
  assert.ok(!requests.some(url => /image\.tmdb\.org|movie\.douban\.com/.test(url)), 'Douban metadata and TMDB refresh cannot replace OMDb artwork');
  for (const film of films) await page.locator('.poster-card').filter({ hasText: film.zh }).waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('.poster-card img')].length === 3 &&
    [...document.querySelectorAll('.poster-card img')].every(img => img.complete && img.naturalWidth > 0));
  await page.screenshot({ path: path.resolve(`.cache/franchise-posters-${packaged ? 'packaged' : 'development'}.png`) });
  console.log(`Franchise/poster integration passed (${packaged ? 'packaged' : 'development'}): offline upgrade, distinct trilogy names, OMDb artwork, TMDB refresh, Douban isolation, missing/unsafe/failed/empty images.`);
} finally { await app.close(); }
