import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';
import { electronExecutable } from './electron-path.mjs';
import { Store } from '../dist-electron/electron/store.js';

fs.mkdirSync('.cache', { recursive: true });
const data = fs.mkdtempSync(path.resolve('.cache/wave-recognition-'));
const media = path.join(data, 'media');
const releaseName = 'The.Wave.2008.FRA.BluRay.1080p.AVC.DTS-HD.MA.5.1-ZimHook@PTHome';
const store = await Store.open(path.join(data, 'library.sqlite'), path.resolve('dist-electron/sql-wasm.wasm'), {
  isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => ''
});
const addDisc = (parent, manual = false) => {
  const folder = path.join(media, parent, releaseName);
  fs.mkdirSync(path.join(folder, 'BDMV'), { recursive: true });
  const index = path.join(folder, 'BDMV/index.bdmv'); fs.writeFileSync(index, 'fixture');
  const old = new Date(Date.now() - 60000); fs.utimesSync(index, old, old);
  const id = store.createWork('movie', 'The Wave', 2008);
  store.setWorkFields(id, { imdbId: 'tt9999999', tmdbId: 999, matchState: 'matched', poster: 'old.png' });
  store.putAsset({ workId: id, root: media, path: folder, kind: 'bdmv', season: null, episode: null, size: 7, mtimeMs: old.getTime() }, 1);
  store.setFavorite(id, true);
  if (manual) store.setManualFields(id, { titleZh: '用户确认的条目', imdbId: 'tt9999999' });
  else store.recordSourceRefresh(id, 'omdb', 'OMDb 未能可靠匹配片名和年份');
  return { id, assetId: store.work(id).assets[0].id };
};
const legacy = addDisc('automatic');
const manual = addDisc('manual', true);
store.setRoots([media]); store.close();
const packaged = process.env.FILM_LIBRARY_PACKAGED === '1';
const app = await electron.launch({ executablePath: electronExecutable(packaged), args: packaged ? [] : ['.'],
  env: { ...process.env, FILM_LIBRARY_SMOKE: '1', FILM_LIBRARY_DATA_DIR: data } });
try {
  const page = await app.firstWindow(); await page.locator('.brand').waitFor();
  await app.evaluate(async ({ app, session }) => {
    const path = process.getBuiltinModule('path');
    const require = process.getBuiltinModule('module').createRequire(path.join(app.getAppPath(), 'dist-electron/electron/main.js'));
    const { Store } = require('./store.js');
    const { Metadata } = require('./metadata.js');
    Store.prototype.getSecret = () => 'fixture-only';
    const hydrate = Metadata.prototype.hydrateOmdb;
    Metadata.prototype.hydrateOmdb = async function (...args) {
      globalThis.waveMetadata = this; globalThis.waveStore = this.store;
      return hydrate.apply(this, args);
    };
    globalThis.waveRequests = []; globalThis.waveWrongIdentity = false;
    const json = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
    await session.fromPartition('persist:metadata').protocol.handle('https', request => {
      const url = new URL(request.url);
      if (url.hostname === 'query.wikidata.org') return json({ results: { bindings: [] } });
      if (url.hostname !== 'www.omdbapi.com') throw new Error(`Unexpected provider: ${url.hostname}`);
      const params = Object.fromEntries([...url.searchParams].filter(([name]) => name !== 'apikey'));
      globalThis.waveRequests.push(params);
      if (params.i === 'tt0069293') return json({ Response: 'True' });
      if (params.s) return json({ Response: 'False', Error: 'Movie not found!' });
      if (params.i === 'tt1063669') return json({ Response: 'True', imdbID: globalThis.waveWrongIdentity ? 'tt9999999' : 'tt1063669',
        Title: 'Die Welle', Year: '2008', Type: 'movie', Poster: 'N/A', Plot: 'Fixture overview', Genre: 'Drama, Thriller',
        Director: 'Dennis Gansel', imdbRating: '7.6', imdbVotes: '123000' });
      throw new Error('Unexpected IMDb identity');
    });
  });
  const job = await page.evaluate(() => window.library.updateLibrary());
  assert.equal(job.failures, 0);
  const works = await page.evaluate(() => window.library.listWorks());
  const repaired = works.find(work => work.id === legacy.id);
  assert.equal(repaired.imdbId, 'tt1063669');
  assert.equal(repaired.titleEn, 'Die Welle');
  assert.equal(repaired.titleZh, '浪潮');
  assert.equal(repaired.year, 2008);
  assert.equal(repaired.ratingImdb, 7.6);
  assert.equal(repaired.favorite, true);
  assert.equal(repaired.assets[0].id, legacy.assetId);
  assert.equal(works.find(work => work.id === manual.id).imdbId, 'tt9999999');
  assert.equal(works.find(work => work.id === manual.id).titleZh, '用户确认的条目');
  const fresh = await app.evaluate(async ({ }, data) => {
    const store = globalThis.waveStore;
    const id = store.createWork('movie', 'The Wave', 2008);
    store.putAsset({ workId: id, root: data, path: `${data}/fresh-wave.mkv`, kind: 'file', season: null, episode: null, size: 7, mtimeMs: 1 }, 1);
    await globalThis.waveMetadata.hydrateOmdb(id);
    return store.work(id);
  }, data);
  assert.equal(fresh.imdbId, 'tt1063669', 'fresh entries also bypass an empty search index');
  assert.equal(fresh.titleZh, '浪潮');
  const requests = await app.evaluate(() => globalThis.waveRequests);
  assert.equal(requests.some(params => params.s), false, 'verified title/year identity needs no title search');
  const rejected = await app.evaluate(async ({ }, id) => {
    globalThis.waveWrongIdentity = true;
    try { await globalThis.waveMetadata.hydrateOmdb(id); return false; }
    catch (error) { return /IMDb ID/.test(String(error)); }
  }, fresh.id);
  assert.equal(rejected, true, 'a provider response cannot silently substitute another identity');
  console.log(`Wave recognition passed (${packaged ? 'packaged' : 'development'}): exact reported Blu-ray folder, empty search, German title, legacy repair, fresh entries, manual boundaries, stable assets and response-ID guard.`);
} finally { await app.close(); }
