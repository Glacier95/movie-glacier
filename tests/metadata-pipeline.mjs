import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';
import { electronExecutable } from './electron-path.mjs';
import { Store } from '../dist-electron/electron/store.js';

fs.mkdirSync('.cache', { recursive: true });
const data = fs.mkdtempSync(path.resolve('.cache/metadata-pipeline-'));
const store = await Store.open(path.join(data, 'library.sqlite'), path.resolve('dist-electron/sql-wasm.wasm'), {
  isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => ''
});
const ids = [];
for (let index = 0; index < 2; index++) {
  const id = store.createWork('movie', `Fixture ${index}`, 2020);
  store.setWorkFields(id, { tmdbId: 100 + index });
  const file = path.join(data, `Fixture.${index}.2020.mkv`); fs.writeFileSync(file, 'fixture');
  store.putAsset({ workId: id, root: data, path: file, kind: 'file', season: null, episode: null, size: 7, mtimeMs: 1 }, 1);
  ids.push(id);
}
store.queueTask('douban', ids[0]);
store.queueTask('tmdb', ids[1]);
store.replaceTop250(Array.from({ length: 250 }, (_, index) => ({ rank: index + 1, doubanId: String(1000000 + index) })));
store.replaceImdbTop250(Array.from({ length: 250 }, (_, index) => ({ rank: index + 1, imdbId: `tt${1000000 + index}` })));
store.close();
const app = await electron.launch({ executablePath: electronExecutable(false), args: ['.'],
  env: { ...process.env, FILM_LIBRARY_SMOKE: '1', FILM_LIBRARY_DATA_DIR: data } });
try {
  const page = await app.firstWindow(); await page.locator('.brand').waitFor();
  const hydration = await app.evaluate(async ({ app }, moduleUrl) => {
    const { Metadata } = process.getBuiltinModule('module').createRequire(moduleUrl)('./metadata.js');
    const original = { id: 1, mediaType: 'movie', year: 2020, poster: 'existing-poster.jpg',
      backdrop: 'existing-backdrop.jpg', imdbId: 'tt1000001', matchState: 'matched', overview: 'Existing synopsis' };
    let fields;
    const fixture = new Metadata({ work: () => original, setWorkFields: (_id, value) => { fields = value; },
      applyDoubanTitle: () => {}, applyManualFields: () => {} }, app.getPath('userData'));
    fixture.tmdb = async resource => resource.endsWith('/external_ids') ? { imdb_id: '' }
      : resource.endsWith('/credits') ? { crew: [], cast: [] } : { title: 'Home', release_date: '2020-01-01' };
    await fixture.hydrate(1, 100);
    fixture.tmdb = async () => ({ results: Array.from({ length: 20 }, (_, index) => ({ id: index + 1,
      title: index === 12 ? 'Home' : `Other ${index}`, original_title: index === 12 ? 'Home' : `Other ${index}`,
      release_date: '2020-01-01' })) });
    const candidates = await fixture.search('movie', 'Home', 2020);
    return { fields, selected: fixture.chooseExact('Home', 2020, candidates)?.id };
  }, pathToFileURL(path.resolve('dist-electron/electron/main.js')).href);
  assert.equal(hydration.fields.poster, 'existing-poster.jpg');
  assert.equal(hydration.fields.backdrop, 'existing-backdrop.jpg');
  assert.equal(hydration.fields.imdbId, 'tt1000001');
  assert.equal(hydration.selected, 13, 'reliable candidates after result twelve must not be discarded');
  await app.evaluate(async (_electron, moduleUrl) => {
    const require = process.getBuiltinModule('module').createRequire(moduleUrl);
    const { Metadata } = require('./metadata.js');
    const { Douban } = require('./douban.js');
    const { Store } = require('./store.js');
    // All provider behavior is deterministic; no provider requests or credentials are used.
    Store.prototype.getSecret = () => 'fixture-only';
    Metadata.prototype.checkTmdb = async () => {};
    Metadata.prototype.hydrate = async function (id, tmdbId) {
      globalThis.fixtureStore = this.store;
      this.store.setWorkFields(id, { tmdbId, titleEn: 'Hydrated fixture', imdbId: 'tt1000001' });
      globalThis.hydratedCount = (globalThis.hydratedCount ?? 0) + 1;
      return [];
    };
    Metadata.prototype.refreshImdb = async () => true;
    Douban.prototype.isBlocked = () => true;
    Douban.prototype.blockedMessage = () => 'Fixture verification required';
    process.env.FILM_LIBRARY_SMOKE = '0';
  }, pathToFileURL(path.resolve('dist-electron/electron/main.js')).href);
  await page.evaluate(() => window.library.updateLibrary());
  assert.equal(await app.evaluate(() => globalThis.hydratedCount), 1, 'blocked Douban must not suppress TMDB');
  assert.equal(await app.evaluate(() => globalThis.fixtureStore.pendingTasks().some(task => task.type === 'douban')), true,
    'verification-blocked work remains retryable');
  await app.evaluate(async (_electron, { moduleUrl, ids }) => {
    const { Douban } = process.getBuiltinModule('module').createRequire(moduleUrl)('./douban.js');
    Douban.prototype.isBlocked = () => false;
    Douban.prototype.findSubject = async () => { throw new Error('fetch failed: fixture outage'); };
    // The chart cache is fresh, so this scan makes no live chart request.
    globalThis.fixtureStore.queueTask('tmdb', ids[1]);
  }, { moduleUrl: pathToFileURL(path.resolve('dist-electron/electron/main.js')).href, ids });
  const result = await page.evaluate(() => window.library.updateLibrary());
  assert.equal(result.failures, 1);
  assert.equal(await app.evaluate(() => globalThis.hydratedCount), 2, 'a Douban network failure must not cancel independent metadata');
  assert.equal(result.running, false);
  await app.evaluate(async ({ session }, { moduleUrl, ids }) => {
    const require = process.getBuiltinModule('module').createRequire(moduleUrl);
    const { Metadata } = require('./metadata.js');
    const { Douban } = require('./douban.js');
    Metadata.prototype.checkTmdb = async () => { throw new Error('fetch failed: fixture outage'); };
    Metadata.prototype.checkOmdb = async () => {};
    globalThis.quotaRequests = 0;
    await session.fromPartition('persist:metadata').protocol.handle('https', request => {
      if (new URL(request.url).hostname === 'query.wikidata.org') return new Response(JSON.stringify({ results: { bindings: [] } }),
        { headers: { 'content-type': 'application/json' } });
      globalThis.quotaRequests++;
      return new Response(JSON.stringify({ Error: 'Request limit reached!' }), { status: 401, headers: { 'content-type': 'application/json' } });
    });
    Douban.prototype.findSubject = async work => ({ id: String(4000000 + work.id), titleZh: '测试电影',
      title: '测试电影', year: 2020, rating: 8.1, votes: 10, overviewZh: '已获取中文资料。', tagsZh: ['剧情'] });
    for (const id of ids) globalThis.fixtureStore.queueTask('tmdb', id);
    globalThis.fixtureStore.queueTask('douban', ids[1]);
  }, { moduleUrl: pathToFileURL(path.resolve('dist-electron/electron/main.js')).href, ids });
  const quota = await page.evaluate(() => window.library.updateLibrary());
  assert.equal(await app.evaluate(() => globalThis.quotaRequests), 1, 'quota exhaustion pauses OMDb for the rest of the update');
  assert.match(quota.message, /请求额度已用尽/);
  assert.ok(await app.evaluate(() => globalThis.fixtureStore.pendingTasks().some(task => task.type === 'tmdb')));
  assert.equal((await page.evaluate(() => window.library.listWorks())).find(work => work.id === ids[1]).ratingDouban, 8.1,
    'OMDb quota exhaustion leaves independent Douban work running');
  console.log('Metadata source isolation passed: verification, outages, pending retries, and independent hydration.');
} finally { await app.close(); }
