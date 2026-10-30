import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cleanTitle } from '../dist-electron/electron/title-cleanup.js';
import { doubanChineseTitle } from '../dist-electron/electron/douban-match.js';
import { titleQueries } from '../dist-electron/electron/media-titles.js';
import { Store } from '../dist-electron/electron/store.js';

test('complete Simplified/Traditional aliases collapse within a single field', () => {
  for (const [input, expected] of [
    ['海滩的一天 海灘的一天', '海滩的一天'], ['海灘的一天 海滩的一天', '海滩的一天'],
    ['重庆森林 重慶森林', '重庆森林'], ['重慶森林 / 重庆森林', '重庆森林'],
    ['海滩的一天　海灘的一天 | 海滩的一天', '海滩的一天'],
    ['阿飞 正传 阿飛 正傳', '阿飞 正传'],
    ['重庆森林 重慶森林 Chungking Express', '重庆森林 Chungking Express'],
    ['Chungking Express 重庆森林 重慶森林', 'Chungking Express 重庆森林'],
    ['你好，李焕英 你好，李煥英', '你好，李焕英'],
    ['无间道2 無間道2', '无间道2'],
    ['再见 再见 再見 再見', '再见 再见']
  ]) {
    assert.equal(cleanTitle(input), expected, input);
    assert.equal(cleanTitle(expected), expected, 'cleanup is idempotent');
  }
  assert.equal(doubanChineseTitle('海滩的一天 海灘的一天 (1983)'), '海滩的一天');
  assert.deepEqual(titleQueries('重庆森林 重慶森林 Chungking Express'), ['Chungking Express', '重庆森林 Chungking Express', '重庆森林']);
});

test('distinct aliases, bilingual names, sequels and deliberate repeated words remain intact', () => {
  for (const title of ['', '海灘的一天', '一 一', '再见 再见', '重慶 森林', '重庆森林 Chungking Express',
    '霸王别姬 再见我的妾', '爱在黎明破晓前 愛在午夜降臨前', '无间道2 無間道3',
    'The The', '一 愛', 'A.B. / A B', 'Love, Death & Robots']) assert.equal(cleanTitle(title), title);
});

test('old title fields are repaired offline on open without changing IDs, assets, scores or manual input', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'title-cleanup-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const database = path.join(dir, 'library.sqlite');
  const secrets = { isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => '' };
  const open = () => Store.open(database, path.resolve('dist-electron/sql-wasm.wasm'), secrets);
  let store = await open();
  const id = store.createWork('movie', '海滩的一天', 1983);
  const file = path.join(dir, 'A.Day.on.the.Beach.1983.mkv'); fs.writeFileSync(file, 'fixture');
  store.putAsset({ workId: id, root: dir, path: file, kind: 'file', season: null, episode: null, size: 7, mtimeMs: 1 }, 1);
  store.setWorkFields(id, { imdbId: 'tt0085740', doubanId: '1303455', poster: 'kept.jpg', matchState: 'manual' });
  store.setManualFields(id, { titleZh: '海滩的一天 海灘的一天' });
  store.setFavorite(id, true); store.setRating(id, 'douban', null, 8.5, 100, '1303455');
  store.setSetting('appearance-fixture', 'keep');
  const before = store.work(id), manual = store.one('SELECT fields FROM work_edits WHERE workId=?', [id]);
  const tasks = store.all('SELECT * FROM tasks');
  // Simulate an actual pre-fix database, bypassing normalized write paths.
  store.run('UPDATE works SET titleZh=?,titleEn=?,originalTitle=?,doubanTitleZh=? WHERE id=?',
    ['海滩的一天 海灘的一天', '海滩的一天 海灘的一天', '海滩的一天 海灘的一天', '海滩的一天 海灘的一天', id]);
  store.run("DELETE FROM settings WHERE key='concatenatedTitlesV1'"); store.close();
  store = await open();
  const after = store.work(id);
  for (const field of ['titleZh', 'titleEn', 'originalTitle', 'doubanTitleZh']) assert.equal(after[field], '海滩的一天');
  for (const field of ['id', 'year', 'imdbId', 'doubanId', 'poster', 'matchState', 'favorite', 'ratingDouban']) assert.deepEqual(after[field], before[field]);
  assert.deepEqual(after.assets, before.assets);
  assert.deepEqual(store.one('SELECT fields FROM work_edits WHERE workId=?', [id]), manual, 'retain the original manual-edit input');
  assert.deepEqual(store.all('SELECT * FROM tasks'), tasks, 'repair does not require a new metadata request');
  assert.equal(store.getSetting('appearance-fixture'), 'keep');
  store.applyManualFields(id); assert.equal(store.work(id).titleZh, '海滩的一天', 'reapplying a manual edit cannot restore duplicates');
  store.setWorkFields(id, { doubanTitleZh: '重庆森林 重慶森林', originalTitle: 'Chungking Express' });
  assert.equal(store.work(id).doubanTitleZh, '重庆森林');
  assert.equal(store.work(id).originalTitle, 'Chungking Express');
  store.close(); store = await open();
  assert.equal(store.work(id).titleZh, '海滩的一天');
  assert.equal(store.work(id).doubanTitleZh, '重庆森林'); store.close();
});
