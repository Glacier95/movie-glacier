import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chineseMovieTitleFromWikidata, lookupChineseMovieTitle, preferredMovieTitle } from '../dist-electron/electron/localized-movies.js';
import { Store } from '../dist-electron/electron/store.js';

const row = (title, item = 'Q1', language = 'zh-cn') => ({ item: { value: `http://www.wikidata.org/entity/${item}` },
  itemLabel: { value: title, 'xml:lang': language } });
const payload = (...bindings) => ({ results: { bindings } });

test('Chinese movie lookup uses exact IMDb IDs, validates unique entities and never guesses a translation', async () => {
  assert.equal(await lookupChineseMovieTitle('tt2381249', async url => {
    const query = new URL(url).searchParams.get('query');
    assert.match(query, /wdt:P345 "tt2381249"/);
    assert.match(query, /zh-cn,zh-hans,zh/);
    return new Response(JSON.stringify(payload(row('碟中谍5：神秘国度'))));
  }), '碟中谍5：神秘国度');
  assert.equal(await lookupChineseMovieTitle('tt123" } UNION {', () => { throw new Error('must not query'); }), null);
  assert.equal(chineseMovieTitleFromWikidata(payload(row('碟中諜2', 'Q2', 'zh-hant'))), '碟中谍2');
  for (const value of [null, {}, payload(), payload(row('Mission: Impossible', 'Q1', 'en')), payload(row('Q1')),
    payload(row('碟中谍2', '../bad')), payload(row('碟中谍2', 'Q1'), row('碟中谍2', 'Q2')),
    payload(row('碟中谍2'), row('另一部电影'))]) assert.equal(chineseMovieTitleFromWikidata(value), null);
  await assert.rejects(lookupChineseMovieTitle('tt2381249', async () => new Response('', { status: 503 })), /HTTP 503/);
});

test('complete Chinese movie titles survive shorter labels from another provider', () => {
  assert.equal(preferredMovieTitle('碟中谍4：幽灵协议', '碟中谍'), '碟中谍4：幽灵协议');
  assert.equal(preferredMovieTitle('碟中諜4：幽靈協議', '碟中谍4'), '碟中諜4：幽靈協議');
  assert.equal(preferredMovieTitle('碟中谍', '碟中谍5：神秘国度'), '碟中谍5：神秘国度');
  assert.equal(preferredMovieTitle('旧译名', '新译名'), '新译名');
  assert.equal(preferredMovieTitle('指环王3：王者无敌', '魔戒：王者归来'), '指环王3：王者无敌');
});

test('a verified series ordinal distinguishes an existing local franchise name when regional translations differ', () => {
  const data = row('不可能的任務：失控國度', 'Q17548046', 'zh');
  data.series = { value: 'http://www.wikidata.org/entity/Q642441' }; data.part = { value: '5' };
  assert.equal(chineseMovieTitleFromWikidata(payload(data), '碟中谍'), '碟中谍5');
  assert.equal(chineseMovieTitleFromWikidata(payload({ ...data, part: { value: '1' } }), '碟中谍'), '碟中谍');
  assert.equal(chineseMovieTitleFromWikidata(payload({ ...data, part: { value: '0' } }), '碟中谍'), '不可能的任务：失控国度');
  assert.equal(chineseMovieTitleFromWikidata(payload(data, { ...data, part: { value: '6' } }), '碟中谍'), '不可能的任务：失控国度');
  const alias = { ...data, mainlandTitle: { value: '碟中谍5：神秘国度', 'xml:lang': 'zh-cn' } };
  assert.equal(chineseMovieTitleFromWikidata(payload(alias), '碟中谍'), '碟中谍5：神秘国度');
});

test('generic cache survives upgrades, retains full subtitles and protects manual titles and IDs', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'localized-movies-'));
  t.after(() => { assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir())); fs.rmSync(dir, { recursive: true, force: true }); });
  const open = () => Store.open(path.join(dir, 'library.sqlite'), path.resolve('dist-electron/sql-wasm.wasm'), {
    isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => ''
  });
  let store = await open();
  const add = (imdbId, title) => {
    const id = store.createWork('movie', title, 2020);
    store.putAsset({ workId: id, root: dir, path: path.join(dir, `${id}.mkv`), kind: 'file', season: null, episode: null, size: 7, mtimeMs: 1 }, 1);
    store.setWorkFields(id, { imdbId, doubanTitleZh: title, titleEn: 'Correct English title', matchState: 'matched', poster: 'keep.jpg' });
    return id;
  };
  const mission = add('tt2381249', '碟中谍'), other = add('tt9876543', '未曾预设的电影'), manual = add('tt0317919', '自定义中文名');
  store.setManualFields(manual, { titleZh: '自定义中文名' });
  store.setFavorite(mission, true); store.setRating(mission, 'imdb', null, 8, 100, 'tt2381249');
  const before = store.work(mission);
  store.setSetting('appearance-fixture', 'keep');
  store.run("DELETE FROM settings WHERE key='localizedMovieTitlesV2'"); store.close();
  store = await open();
  assert.ok(store.pendingTasks().some(task => task.type === 'wikidata' && task.workId === mission));
  assert.ok(!store.pendingTasks().some(task => task.type === 'wikidata' && task.workId === manual));
  for (const [id, title] of [[mission, '碟中谍5：神秘国度'], [other, '未曾预设的电影2：新章节']]) {
    store.setLocalizedMovieTitle(store.work(id).imdbId, title); store.applyDoubanTitle(id);
    assert.equal(store.work(id).titleZh, title);
  }
  store.setWorkFields(mission, { titleZh: '碟中谍', doubanTitleZh: '碟中谍' }); store.applyDoubanTitle(mission);
  assert.equal(store.work(mission).titleZh, '碟中谍5：神秘国度', 'a later generic source cannot overwrite a verified title');
  store.setLocalizedMovieTitle('tt0317919', '碟中谍3'); store.applyDoubanTitle(manual); store.applyManualFields(manual);
  assert.equal(store.work(manual).titleZh, '自定义中文名');
  for (const field of ['id', 'imdbId', 'titleEn', 'year', 'poster', 'favorite', 'ratingImdb', 'assets'])
    assert.deepEqual(store.work(mission)[field], before[field], field);
  const tasks = store.pendingTasks(); store.close(); store = await open();
  assert.deepEqual(store.pendingTasks(), tasks);
  assert.equal(store.localizedMovieTitle('tt2381249').titleZh, '碟中谍5：神秘国度');
  assert.equal(store.localizedMovieTitle('tt0000001'), null, 'cached titles are scoped to the exact IMDb identity');
  assert.equal(store.getSetting('appearance-fixture'), 'keep'); store.close();
});
