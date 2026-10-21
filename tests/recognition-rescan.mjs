import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';
import { Store } from '../dist-electron/electron/store.js';

const temp = fs.mkdtempSync(path.resolve('.cache/recognition-rescan-'));
const root = path.join(temp, 'media');
const data = path.join(temp, 'app-data');
const secrets = { isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => '' };
const store = await Store.open(path.join(data, 'library.sqlite'), path.resolve('dist-electron/sql-wasm.wasm'), secrets);
store.setRoots([root]);
const add = (workId, relative, season = null, episode = null) => {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'test');
  const stamp = new Date(Date.now() - 60000);
  fs.utimesSync(file, stamp, stamp);
  const stat = fs.statSync(file);
  store.putAsset({ workId, root, path: file, kind: 'file', season, episode, size: stat.size, mtimeMs: stat.mtimeMs }, 1);
  return store.findAsset(file).id;
};
const replyId = store.createWork('movie', '请回答', 1988);
const replyAsset = add(replyId, '请回答1988/第01集.mkv');
const robotsId = store.createWork('tv', '爱，死亡和机器人', 2019);
add(robotsId, '爱死亡和机器人.S01E01.2019.mkv', 1, 1);
const brokenId = store.createWork('tv', '爱死亡', 2022);
store.setWorkFields(brokenId, { matchState: 'matched', tmdbId: 123, imdbId: 'tt9999999' });
store.setFavorite(brokenId, true);
const thirdAsset = add(brokenId, '爱死亡和机器人3/第01集.mkv');
const manualId = store.createWork('movie', '手动确认的条目', 2000);
add(manualId, 'Reply.1988.S01E02.2015.mkv');
store.setManualFields(manualId, { titleZh: '手动确认的条目' });
store.close();
let app;
try {
  app = await electron.launch({ executablePath: path.resolve(process.env.FILM_LIBRARY_PACKAGED === '1' ? 'release/win-unpacked/Movie Glacier.exe' : 'node_modules/electron/dist/electron.exe'),
    args: ['--no-sandbox', '--disable-gpu', ...(process.env.FILM_LIBRARY_PACKAGED === '1' ? [] : ['.'])], env: { ...process.env, FILM_LIBRARY_DATA_DIR: data, FILM_LIBRARY_SMOKE: '1' }, timeout: 30000 });
  const page = await app.firstWindow();
  await page.locator('.brand').waitFor({ timeout: 20000 });
  await page.evaluate(() => window.library.updateLibrary());
  let works = await page.evaluate(() => window.library.listWorks());
  assert.equal(works.find(work => work.id === replyId).mediaType, 'movie', 'incremental scan retains old data until explicit rescan');
  await page.evaluate(() => window.library.rescanLibrary());
  works = await page.evaluate(() => window.library.listWorks());
  const reply = works.find(work => work.id === replyId);
  assert.equal(reply.mediaType, 'tv');
  assert.equal(reply.titleZh, '请回答1988');
  assert.equal(reply.assets[0].episode, 1);
  assert.equal(reply.assets[0].id, replyAsset);
  const robots = works.find(work => work.id === robotsId);
  assert.equal(robots.assets.length, 2);
  assert.deepEqual(robots.assets.map(asset => asset.season).sort(), [1, 3]);
  assert.equal(robots.assets.find(asset => asset.season === 3).id, thirdAsset);
  assert.equal(robots.favorite, true);
  assert.equal(works.some(work => work.id === brokenId), false);
  assert.equal(works.find(work => work.id === manualId).mediaType, 'movie');
  await page.evaluate(() => window.library.rescanLibrary());
  assert.equal((await page.evaluate(() => window.library.listWorks())).length, 3, 'repeat rescan is stable');
  console.log(JSON.stringify({ repairedReply1988: true, mergedRobotSeasons: [1, 3], favoritePreserved: true,
    manualEditsPreserved: true, stableRepeatRescan: true, dataDirectory: data }));
} finally { if (app) await app.close(); }
