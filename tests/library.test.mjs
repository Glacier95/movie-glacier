import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { discover, parseName, findNfoId } from '../dist-electron/electron/scanner.js';
import { Store } from '../dist-electron/electron/store.js';
import { matchesSearch } from '../src/search.ts';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const wasm = path.resolve(rootDir, '../dist-electron/sql-wasm.wasm');
const secretStorage = {
  isEncryptionAvailable: () => true,
  encryptString: value => Buffer.from(value, 'utf8'),
  decryptString: value => value.toString('utf8')
};

test('scanner separates BDMV, films, seasons, and excludes samples', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'private-films-scan-'));
  t.after(() => { if (root.startsWith(os.tmpdir())) fs.rmSync(root, { recursive: true, force: true }); });
  const create = relative => {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'x');
    return target;
  };
  create('Mirror.1975/BDMV/index.bdmv');
  create('Mirror.1975/BDMV/STREAM/00001.m2ts');
  create('Mirror.1975/BDMV/PLAYLIST/00001.mpls');
  create('Twin.Peaks.S01/Twin.Peaks.S01E01.1990.mkv');
  create('Twin.Peaks.S01/Sample/sample.mkv');
  create('Twin.Peaks.Fire.Walk.With.Me.1992.mkv');
  create('软件/installer.zip');
  const items = await Array.fromAsync(discover(root));
  assert.equal(items.length, 3);
  assert.equal(items.filter(item => item.kind === 'bdmv').length, 1);
  assert.equal(items.find(item => item.kind === 'bdmv').size, 3, 'disc size includes the complete source folder');
  const episode = parseName(items.find(item => item.path.includes('S01E01')).path, 'file');
  assert.deepEqual([episode.mediaType, episode.title, episode.season, episode.episode], ['tv', 'Twin Peaks', 1, 1]);
  const disc = parseName(items.find(item => item.kind === 'bdmv').path, 'bdmv');
  assert.equal(disc.title, 'Mirror');
  const film = parseName(items.find(item => item.path.includes('Fire.Walk')).path, 'file');
  assert.equal(film.mediaType, 'movie');
});

test('NFO IMDb ID and real release names parse correctly', () => {
  assert.equal(parseName('[高山下的花环].Wreaths.at.the.Foot.of.the.Mountain.1984.BluRay.mkv', 'file').year, 1984);
  assert.equal(parseName('The.Good.the.Bad.and.the.Ugly.1966.BluRay.mkv', 'file').normalizedTitle,
    parseName('The Good, the Bad and the Ugly (1966).mkv', 'file').normalizedTitle);
});

test('search matches bilingual film, director, and actor names', () => {
  const work = { titleZh: '镜子', titleEn: 'Mirror', originalTitle: 'Zerkalo',
    directors: [{ id: '1', name: '安德烈·塔可夫斯基', originalName: 'Andrei Tarkovsky' }],
    actors: [{ id: '2', name: '玛格丽塔·捷列霍娃', originalName: 'Margarita Terekhova', aliases: ['玛格丽塔·特列霍娃'] }] };
  for (const query of ['镜子', 'mirror', '塔可夫斯基', 'TARKOVSKY', '捷列霍娃', '特列霍娃', 'Terekhova'])
    assert.equal(matchesSearch(work, query), true, query);
  assert.equal(matchesSearch(work, 'Kubrick'), false);
});

test('SQLite store persists assets, metadata, ratings, and atomic Top250 snapshot', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'private-films-db-'));
  t.after(() => { if (root.startsWith(os.tmpdir())) fs.rmSync(root, { recursive: true, force: true }); });
  const file = path.join(root, 'library.sqlite');
  let store = await Store.open(file, wasm, secretStorage);
  store.setRoots([path.join(root, 'movies')]);
  store.setSecret('tmdb', 'secret-token');
  const workId = store.createWork('movie', 'Mirror', 1975);
  assert.ok(workId > 0);
  const asset = { workId, root, path: path.join(root, 'Mirror.1975'), kind: 'bdmv', season: null, episode: null, size: 1, mtimeMs: 1234 };
  assert.deepEqual(store.putAsset(asset, 42), { added: true });
  assert.deepEqual(store.putAsset(asset, 43), { added: false });
  store.setWorkFields(workId, { doubanId: '1292052', directors: [{ id: '1', name: 'Andrei Tarkovsky' }] });
  store.queueTask('tmdb', workId);
  const taskId = store.pendingTasks()[0].id;
  store.taskDone(taskId, '网络连接失败');
  store.retryFailed();
  store.taskDone(taskId);
  assert.deepEqual(store.listScrapeLogs().map(log => log.status), ['done'], 'past failures disappear after success');
  store.retryFailed();
  store.taskDone(taskId, undefined, '海报未下载');
  assert.equal(store.listScrapeLogs()[0].message, '海报未下载');
  store.recordSourceRefresh(workId, 'douban', '暂时无法读取详情页');
  assert.deepEqual(store.listScrapeLogs().map(log => log.status), ['failed']);
  store.recordSourceRefresh(workId, 'douban', undefined, '中文资料已更新');
  assert.equal(store.listScrapeLogs().length, 1);
  assert.equal(store.listScrapeLogs()[0].message, '中文资料已更新');
  store.setManualFields(workId, { titleZh: '镜子' });
  store.setWorkFields(workId, { titleZh: 'Remote title' });
  store.applyManualFields(workId);
  assert.equal(store.work(workId).titleZh, '镜子');
  assert.equal(store.work(workId).favorite, false);
  store.setFavorite(workId, true);
  assert.equal(store.work(workId).favorite, true);
  store.setPersonAlias({ id: '1', name: '安德烈·塔可夫斯基', originalName: 'Andrei Tarkovsky', aliases: ['Andrey Tarkovskiy'] });
  assert.equal(store.personAlias('1').originalName, 'Andrei Tarkovsky');
  assert.deepEqual(store.personAlias('1').aliases, ['Andrey Tarkovskiy']);
  store.setRating(workId, 'imdb', null, 8.0, 100, 'tt0069293');
  assert.equal(store.listWorks().length, 1);
  assert.throws(() => store.replaceTop250([{ rank: 1, doubanId: '1292052' }]));
  assert.equal(store.top250UpdatedAt(), null);
  store.replaceTop250(Array.from({ length: 250 }, (_, index) => ({
    rank: index + 1, doubanId: index === 0 ? '1292052' : String(2000000 + index)
  })));
  assert.equal(store.listWorks()[0].topRank, 1);
  assert.throws(() => store.replaceTop250([{ rank: 1, doubanId: '1292052' }]));
  assert.equal(store.listWorks()[0].topRank, 1);
  const seriesId = store.createWork('tv', 'Twin Peaks', 1990);
  store.putAsset({ workId: seriesId, root, path: path.join(root, 'Twin.Peaks.S03E01.mkv'), kind: 'file', season: 3, episode: 1,
    size: 1, mtimeMs: 1234 }, 44);
  store.setRating(seriesId, 'douban', 2, 9.2, 100, 'season-2');
  store.setRating(seriesId, 'douban', 3, 8.9, 120, 'season-3');
  assert.deepEqual([store.work(seriesId).ratingDouban, store.work(seriesId).ratingSeason], [8.9, 3]);
  store.setRating(seriesId, 'douban', null, 9.0, 500, 'whole-series');
  assert.deepEqual([store.work(seriesId).ratingDouban, store.work(seriesId).ratingSeason], [9.0, null]);
  store.setRating(seriesId, 'douban', 3, 8.8, 120, 'season-3');
  assert.deepEqual([store.work(seriesId).ratingDouban, store.work(seriesId).ratingSeason], [9.0, null], 'a distinct whole-series entry keeps its score');
  store.ignoreWork(workId);
  assert.equal(store.listWorks().some(work => work.id === workId), false);
  assert.equal(store.ignoredWorks()[0].id, workId);
  store.restoreWork(workId);
  assert.equal(store.listWorks().some(work => work.id === workId), true);
  store.close();
  store = await Store.open(file, wasm, secretStorage);
  assert.equal(store.getSecret('tmdb'), 'secret-token');
  assert.equal(store.work(workId).assets.length, 1);
  assert.equal(store.work(workId).ratingImdb, 8);
  assert.equal(store.work(workId).titleZh, '镜子');
  assert.equal(store.work(workId).favorite, true);
  const duplicateId = store.createWork('movie', 'Mirror alternate', 1975);
  store.setFavorite(duplicateId, false);
  store.moveAssets(workId, duplicateId);
  assert.equal(store.work(duplicateId).favorite, true, 'merging versions keeps a favorite from either work');
  store.close();
});

test('IMDb Top 250 migrates old libraries, links IDs, persists and retains complete snapshots on invalid updates', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'private-films-imdb-chart-'));
  t.after(() => { if (root.startsWith(os.tmpdir())) fs.rmSync(root, { recursive: true, force: true }); });
  const file = path.join(root, 'library.sqlite');
  let store = await Store.open(file, wasm, secretStorage);
  const id = store.createWork('movie', 'Ranked film', 1994);
  const tvId = store.createWork('tv', 'Series', 1990);
  for (const workId of [id, tvId]) store.putAsset({ workId, root, path: path.join(root, `${workId}.mkv`), kind: 'file', season: null, episode: null, size: 1, mtimeMs: 1 }, 1);
  store.setWorkFields(id, { imdbId: 'tt0111161', doubanId: '1292052' });
  // Simulate a pre-feature database while preserving existing library records.
  store.run('ALTER TABLE works DROP COLUMN imdbTopRank');
  store.run('DROP TABLE imdb_top250');
  store.close();
  store = await Store.open(file, wasm, secretStorage);
  assert.equal(store.work(id).imdbTopRank, null);
  assert.equal(store.imdbTop250UpdatedAt(), null);
  const chart = Array.from({ length: 250 }, (_, i) => ({ rank: i + 1, imdbId: i === 0 ? 'tt0111161' : `tt${String(2000000 + i)}` }));
  store.replaceTop250(Array.from({ length: 250 }, (_, i) => ({ rank: i + 1, doubanId: i === 0 ? '1292052' : String(3000000 + i) })));
  store.replaceImdbTop250(chart);
  const date = store.imdbTop250UpdatedAt();
  assert.ok(date);
  assert.deepEqual([store.work(id).topRank, store.work(id).imdbTopRank], [1, 1]);
  for (const invalid of [chart.slice(0, 249), [...chart.slice(0, 249), chart[0]], chart.map(item => ({ ...item, rank: 1 }))]) {
    assert.throws(() => store.replaceImdbTop250(invalid));
    assert.equal(store.imdbTop250UpdatedAt(), date);
    assert.equal(store.work(id).imdbTopRank, 1);
  }
  store.setManualFields(id, { imdbId: chart[249].imdbId });
  assert.equal(store.work(id).imdbTopRank, 250, 'ID edits use the cached chart without another fetch');
  store.setWorkFields(id, { imdbId: null });
  assert.equal(store.work(id).imdbTopRank, null);
  assert.equal(store.work(id).topRank, 1, 'IMDb changes do not alter Douban rankings');
  store.applyManualFields(id);
  assert.equal(store.work(id).imdbTopRank, 250);
  store.setWorkFields(tvId, { imdbId: chart[0].imdbId });
  assert.equal(store.work(tvId).imdbTopRank, null, 'the movie chart must not mark series');
  store.close();
  store = await Store.open(file, wasm, secretStorage);
  assert.equal(store.work(id).imdbTopRank, 250);
  assert.equal(store.imdbTop250UpdatedAt(), date);
  store.replaceImdbTop250(chart.map(item => ({ ...item, imdbId: `tt${String(4000000 + item.rank)}` })));
  assert.equal(store.work(id).imdbTopRank, null, 'a title leaving the chart loses its badge');
  store.setWorkFields(id, { imdbId: 'tt4000001' });
  assert.equal(store.work(id).imdbTopRank, 1, 'metadata ID updates link to existing chart');
  store.repairWorkFromName(id, { mediaType: 'movie', title: 'Other film', year: 2000 });
  assert.equal(store.work(id).imdbTopRank, null, 'reidentification clears stale rankings');
  store.close();
});

test('retry recovers history-only failures without reviving superseded successful work', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'retry-history-'));
  t.after(() => { if (root.startsWith(os.tmpdir())) fs.rmSync(root, { recursive: true, force: true }); });
  const store = await Store.open(path.join(root, 'library.sqlite'), wasm, secretStorage);
  const id = store.createWork('movie', 'Recovered film', 1986);
  store.putAsset({ workId: id, root, path: path.join(root, 'Recovered.1986.mkv'), kind: 'file', season: null, episode: null, size: 1, mtimeMs: 1 }, 1);
  store.queueTask('tmdb', id);
  const first = store.pendingTasks()[0].id;
  store.taskDone(first, '旧年份匹配失败', '', 'omdb');
  store.queueTask('tmdb', id);
  store.taskDone(store.pendingTasks()[0].id, undefined, '已按确认编号成功', 'omdb');
  store.retryFailed();
  assert.equal(store.hasFailedTasks('tmdb'), false);
  assert.equal(store.pendingTasks().length, 0, 'resolved attempts are not retried on every scan');
  store.recordSourceRefresh(id, 'omdb', '手动刷新失败');
  store.retryFailed();
  assert.deepEqual(store.pendingTasks().map(task => task.type), ['tmdb'], 'history-only failures receive a real retry task');
  store.retryFailed();
  assert.equal(store.pendingTasks().length, 1, 'retry does not duplicate pending work');
  store.ignoreWork(id);
  assert.equal(store.listScrapeLogs().length, 0);
  store.close();
});

test('existing libraries gain persisted Douban text fields and queue enrichment once', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'private-films-douban-migration-'));
  t.after(() => { if (root.startsWith(os.tmpdir())) fs.rmSync(root, { recursive: true, force: true }); });
  const file = path.join(root, 'library.sqlite');
  const media = path.join(root, 'Fargo.1996.mkv');
  fs.writeFileSync(media, 'fixture');
  let store = await Store.open(file, wasm, secretStorage);
  const workId = store.createWork('movie', 'Fargo', 1996);
  store.putAsset({ workId, root, path: media, kind: 'file', season: null, episode: null, size: 7, mtimeMs: 1 }, 1);
  store.setWorkFields(workId, { overview: '旧版中文简介', genres: ['犯罪'] });
  store.run('DELETE FROM settings WHERE key=?', ['doubanDetailsV1']);
  store.close();
  store = await Store.open(file, wasm, secretStorage);
  assert.deepEqual(store.pendingTasks().map(task => task.type).sort(), ['douban', 'tmdb']);
  store.setWorkFields(workId, { doubanId: '1292067', doubanTitleZh: '冰血暴', doubanOverviewZh: '豆瓣中文简介', doubanTags: ['剧情', '犯罪'] });
  store.applyDoubanTitle(workId);
  assert.equal(store.work(workId).titleZh, '冰血暴');
  store.setManualFields(workId, { titleZh: '自定义片名' });
  store.applyDoubanTitle(workId);
  store.applyManualFields(workId);
  assert.equal(store.work(workId).titleZh, '自定义片名');
  store.close();
  store = await Store.open(file, wasm, secretStorage);
  assert.deepEqual(store.work(workId).doubanTags, ['剧情', '犯罪']);
  assert.equal(store.work(workId).doubanOverviewZh, '豆瓣中文简介');
  assert.equal(store.pendingTasks().length, 2, 'migration is not queued twice');
  store.clearDoubanFields(workId);
  assert.deepEqual(store.work(workId).doubanTags, []);
  assert.equal(store.work(workId).doubanOverviewZh, '');
  store.close();
});
