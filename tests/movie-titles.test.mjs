import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Store } from '../dist-electron/electron/store.js';
import { movieChineseTitle } from '../dist-electron/electron/movie-titles.js';
import { omdbChineseTitle } from '../dist-electron/electron/omdb.js';
import { doubanChineseTitle } from '../dist-electron/electron/douban-match.js';

const trilogy = [
  ['tt0120737', '指环王1：护戒使者'], ['tt0167261', '指环王2：双塔奇兵'], ['tt0167260', '指环王3：王者无敌']
];

test('localized sequel names retain punctuation, parts and subtitles', () => {
  for (const [input, expected] of [
    ['指环王1：护戒使者 The Lord of the Rings: The Fellowship of the Ring (2001)', '指环王1：护戒使者'],
    ['指环王II：双塔奇兵', '指环王II：双塔奇兵'],
    ['指环王 II：双塔奇兵', '指环王 II：双塔奇兵'],
    ['指环王 II：双塔奇兵 The Lord of the Rings: The Two Towers (2002)', '指环王 II：双塔奇兵'],
    ['哈利·波特与死亡圣器(下) Harry Potter and the Deathly Hallows: Part 2 (2011)', '哈利·波特与死亡圣器(下)'],
    ['蜘蛛侠：纵横宇宙（上）', '蜘蛛侠：纵横宇宙（上）'],
    ['黑客帝国-矩阵重载 The Matrix Reloaded', '黑客帝国-矩阵重载'],
    ['X战警：逆转未来 X-Men: Days of Future Past', 'X战警：逆转未来'],
    ['悲情城市 (1989)', '悲情城市']
  ]) assert.equal(doubanChineseTitle(input), expected);
});

test('exact IMDb identity expands the trilogy abbreviation without guessing other films or translations', () => {
  for (const [imdbId, expected] of trilogy) {
    const work = { mediaType: 'movie', imdbId, titleZh: '指环王' };
    assert.equal(omdbChineseTitle(work, 'The Lord of the Rings'), expected);
    assert.equal(movieChineseTitle(work, '魔戒'), expected);
    assert.equal(movieChineseTitle(work, '魔戒：完整的其他译名'), '魔戒：完整的其他译名');
    assert.equal(movieChineseTitle({ ...work, mediaType: 'tv' }, '指环王'), '指环王');
  }
  assert.equal(movieChineseTitle({ mediaType: 'movie', imdbId: 'tt9999999' }, '指环王'), '指环王');
});

test('existing libraries repair trilogy titles offline and queue artwork without changing user data', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'movie-titles-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const file = path.join(dir, 'library.sqlite');
  const open = () => Store.open(file, path.resolve('dist-electron/sql-wasm.wasm'), {
    isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => ''
  });
  let store = await open();
  const records = trilogy.map(([imdbId, expected], index) => {
    const id = store.createWork('movie', '指环王', 2001 + index);
    store.setWorkFields(id, { imdbId, doubanTitleZh: '指环王', titleEn: `English part ${index + 1}`, poster: `existing-${index}.jpg`, matchState: 'matched' });
    store.setFavorite(id, true); store.setRating(id, 'imdb', null, 8.8, 100, imdbId);
    store.putAsset({ workId: id, root: dir, path: path.join(dir, `${index}.mkv`), kind: 'file', season: null, episode: null, size: 7, mtimeMs: 1 }, 1);
    return { id, expected, before: store.work(id) };
  });
  const manual = store.createWork('movie', '指环王', 2001);
  store.setWorkFields(manual, { imdbId: trilogy[0][0] });
  store.putAsset({ workId: manual, root: dir, path: path.join(dir, 'manual.mkv'), kind: 'file', season: null, episode: null, size: 7, mtimeMs: 1 }, 1);
  store.setManualFields(manual, { titleZh: '我自己的片名' });
  store.setSetting('appearance-fixture', 'keep');
  store.run("DELETE FROM settings WHERE key='movieTitlesAndPostersV1'"); store.close();
  store = await open();
  for (const { id, expected, before } of records) {
    const after = store.work(id);
    assert.equal(after.titleZh, expected); assert.equal(after.doubanTitleZh, expected);
    for (const field of ['id', 'imdbId', 'year', 'titleEn', 'poster', 'favorite', 'ratingImdb', 'assets'])
      assert.deepEqual(after[field], before[field], field);
    assert.ok(store.pendingTasks().some(task => task.workId === id && task.type === 'imdb'));
    store.setWorkFields(id, { titleZh: '指环王' }); store.applyDoubanTitle(id);
    assert.equal(store.work(id).titleZh, expected, 'cached Chinese metadata cannot restore the generic name');
  }
  assert.equal(store.work(manual).titleZh, '我自己的片名');
  assert.equal(store.getSetting('appearance-fixture'), 'keep');
  const tasks = store.pendingTasks(); store.close(); store = await open();
  assert.deepEqual(store.pendingTasks(), tasks, 'upgrade tasks are queued once'); store.close();
});
