import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';
import { electronExecutable } from './electron-path.mjs';
import { Store } from '../dist-electron/electron/store.js';

fs.mkdirSync('.cache', { recursive: true });
const data = fs.mkdtempSync(path.resolve('.cache/omdb-priority-'));
const store = await Store.open(path.join(data, 'library.sqlite'), path.resolve('dist-electron/sql-wasm.wasm'), {
  isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => ''
});
const id = store.createWork('movie', 'Priority fixture', 2020);
const file = path.join(data, 'Priority.fixture.2020.mkv'); fs.writeFileSync(file, 'fixture');
const old = new Date(Date.now() - 60000); fs.utimesSync(file, old, old);
store.putAsset({ workId: id, root: data, path: file, kind: 'file', season: null, episode: null, size: 7, mtimeMs: old.getTime() }, 1);
store.setWorkFields(id, { tmdbId: 100 }); store.setRoots([data]);
store.queueTask('tmdb', id);
store.replaceTop250(Array.from({ length: 250 }, (_, i) => ({ rank: i + 1, doubanId: String(8000000 + i) })));
store.replaceImdbTop250(Array.from({ length: 250 }, (_, i) => ({ rank: i + 1, imdbId: `tt${9000000 + i}` })));
store.close();
const packaged = process.env.FILM_LIBRARY_PACKAGED === '1';
const app = await electron.launch({ executablePath: electronExecutable(packaged), args: packaged ? [] : ['.'],
  env: { ...process.env, FILM_LIBRARY_SMOKE: '1', FILM_LIBRARY_DATA_DIR: data } });
try {
  const page = await app.firstWindow(); await page.locator('.brand').waitFor();
  await app.evaluate(async ({ app }) => {
    const path = process.getBuiltinModule('path');
    const require = process.getBuiltinModule('module').createRequire(path.join(app.getAppPath(), 'dist-electron/electron/main.js'));
    const { Store } = require('./store.js');
    const { Metadata } = require('./metadata.js');
    const { Douban } = require('./douban.js');
    globalThis.providerCalls = []; globalThis.providerMode = 'ok';
    Store.prototype.getSecret = () => 'fixture-only';
    Metadata.prototype.checkOmdb = async () => {
      globalThis.providerCalls.push('checkOmdb');
      if (globalThis.providerMode === 'omdb-outage') throw new Error('fetch failed: OMDb fixture outage');
    };
    Metadata.prototype.checkTmdb = async () => {
      globalThis.providerCalls.push('checkTmdb');
      if (globalThis.providerMode === 'quota') throw new Error('fetch failed: TMDB fixture outage');
    };
    Metadata.prototype.hydrateOmdb = async function (id) {
      globalThis.fixtureStore = this.store; globalThis.providerCalls.push('hydrateOmdb');
      if (globalThis.providerMode === 'fallback') throw new Error('fetch failed: OMDb fixture outage');
      if (globalThis.providerMode === 'quota') throw new Error('OMDb 请求额度已用尽');
      this.store.setWorkFields(id, { titleEn: 'Priority fixture', imdbId: 'tt9999999', matchState: 'matched' });
      return [];
    };
    Metadata.prototype.hydrate = async function (id) {
      globalThis.fixtureStore = this.store; globalThis.providerCalls.push('hydrateTmdb');
      this.store.setWorkFields(id, { titleEn: 'Priority fixture', imdbId: 'tt9999999', matchState: 'matched' });
      return [];
    };
    Metadata.prototype.refreshChineseTitle = async () => false;
    Metadata.prototype.refreshImdb = async () => true;
    Douban.prototype.isBlocked = () => true;
    Douban.prototype.blockedMessage = () => 'Fixture verification';
  });
  const run = async mode => {
    if (mode !== 'ok') await app.evaluate(({ }, { id, mode }) => {
      globalThis.providerCalls = []; globalThis.providerMode = mode;
      globalThis.fixtureStore.queueTask('tmdb', id);
    }, { id, mode });
    const job = await page.evaluate(() => window.library.updateLibrary());
    return { job, calls: await app.evaluate(() => globalThis.providerCalls) };
  };
  const preferred = await run('ok');
  assert.deepEqual(preferred.calls, ['checkOmdb', 'hydrateOmdb'], 'healthy OMDb never probes TMDB');
  assert.equal(preferred.job.failures, 0);
  const fallback = await run('fallback');
  assert.deepEqual(fallback.calls, ['checkOmdb', 'hydrateOmdb', 'checkTmdb', 'hydrateTmdb']);
  assert.equal(fallback.job.failures, 0);
  const outage = await run('omdb-outage');
  assert.deepEqual(outage.calls, ['checkOmdb', 'checkTmdb', 'hydrateTmdb']);
  const quota = await run('quota');
  assert.deepEqual(quota.calls, ['checkOmdb', 'hydrateOmdb', 'checkTmdb']);
  assert.equal(quota.job.failures, 1);
  assert.match(quota.job.message, /请求额度已用尽/);
  console.log(`OMDb priority passed (${packaged ? 'packaged' : 'development'}): no TMDB probe on success, per-film fallback, preflight outage fallback, quota pause.`);
} finally { await app.close(); }
