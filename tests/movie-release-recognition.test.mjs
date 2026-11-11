import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseName } from '../dist-electron/electron/scanner.js';
import { omdbQueries, lookupYear, searchOmdbCandidate, chooseOmdbCandidate } from '../dist-electron/electron/omdb.js';
import { repairParsedWork, reconcileSeries } from '../dist-electron/electron/local-match.js';
import { movieChineseTitle } from '../dist-electron/electron/movie-titles.js';
import { Store } from '../dist-electron/electron/store.js';

const releases = [
  ['A_CONFUCIAN_CONFUSION-ANKO', 'bdmv', 'A CONFUCIAN CONFUSION', null, 'A Confucian Confusion', 1994],
  ['Apocalypse.Now.Redux.1979.UHD.BluRay.2160p.10bit.HDR.2Audio.TrueHD(Atmos).7.1.x265-beAst.mkv', 'file', 'Apocalypse Now', 1979, 'Apocalypse Now', 1979],
  ['E.T.The.Extra-Terrestrial.1982.1080p.BluRay.DTS-HD.MA.7.1.2Audio.x264-PbK.mkv', 'file', 'E T The Extra-Terrestrial', 1982, 'E.T. the Extra-Terrestrial', 1982],
  ['From.Kokuriko.Hill.2011.1080p.BluRay.x264.DTS.AC3.4Audio-HDWinG.mkv', 'file', 'From Kokuriko Hill', 2011, 'From Up on Poppy Hill', 2011],
  ['Spirited.Away.2011.BluRay.1080p.x264.DTS.AC3.4Audio-HDWinG.mkv', 'file', 'Spirited Away', 2011, 'Spirited Away', 2001, 'tt0245429'],
  ['SE7EN.US.Remastered.Edition.1995.1080p.BluRay.REMUX.VC1.DTS-HD.MA.7.1-PTHOME.mkv', 'file', 'SE7EN', 1995, 'Se7en', 1995],
  ['Thelma.and.Louise.1991.CC.UHD.Blu-ray.2160p.10bit.HDR.3Audio.DTS-HD.MA.5.1.x265-beAst.mkv', 'file', 'Thelma and Louise', 1991, 'Thelma & Louise', 1991],
  ['Eight.and.a.Half.1963.1080p.BluRay.FLAC.x264-HiFi.mkv', 'file', 'Eight and a Half', 1963, '8½', 1963],
  ['The Godfather - Part II (1974) (2160p UHD BluRay x265 DV HDR DD 5.1 English - Weasley HONE).mkv', 'file', 'The Godfather - Part II', 1974, 'The Godfather: Part II', 1974],
  ['The.Wave.2008.FRA.BluRay.1080p.AVC.DTS-HD.MA.5.1-ZimHook@PTHome', 'bdmv', 'The Wave', 2008, 'The Wave', 2008],
  ['[困在时间里的父亲].The.Father.2020.BluRay.1080p.x264.DTS-CMCT.mkv', 'file', '困在时间里的父亲 The Father', 2020, 'The Father', 2020, 'tt10272386'],
  ['[鸟人].Birdman.2014.BluRay.1080p.x264.AC3-CMCT.mkv', 'file', '鸟人 Birdman', 2014, 'Birdman or (The Unexpected Virtue of Ignorance)', 2014, 'tt2562232']
];

test('reported release names parse and resolve canonical OMDb titles without renaming media', async () => {
  for (const [filename, kind, title, year, canonical, releaseYear, identity] of releases) {
    const parsed = parseName(path.join('D:', 'media', filename), kind);
    assert.deepEqual([parsed.mediaType, parsed.title, parsed.year], ['movie', title, year], filename);
    const work = { ...parsed, titleZh: title, titleEn: title, originalTitle: title, assets: [], imdbId: null };
    assert.equal(omdbQueries(work)[0], canonical, filename);
    const imdbID = identity ?? 'tt9999999';
    const result = await searchOmdbCandidate(work, async params => ({ Response: 'True', Search: [
      { Title: canonical, Year: String(releaseYear), imdbID }
    ] }));
    assert.equal(result?.imdbID, imdbID, filename);
    assert.equal(lookupYear(work), canonical === 'Spirited Away' ? 2001 : year, filename);
  }
  assert.equal(parseName('Birdman.2020.mkv', 'file').year, 2020);
  assert.equal(parseName('K-ON.2009.S01E01.mkv', 'file').title, 'K-ON');
  assert.equal(parseName('This.Is.Us.2016.S01E01.mkv', 'file').title, 'This Is Us');
  assert.equal(chooseOmdbCandidate('Birdman', 2014, [{ Title: 'Birdman', Year: '2014', imdbID: 'tt9999999' }]), null);
  assert.equal(chooseOmdbCandidate('The Wave', 2008, [{ Title: 'The Wave', Year: '2015', imdbID: 'tt9999999' }]), null);
  assert.equal(movieChineseTitle({ mediaType: 'movie', imdbId: 'tt10272386' }, '父亲'), '困在时间里的父亲');
});

test('update repairs existing automatic movie identities, preserving assets and manual edits; Ignore survives in-flight work', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'movie-release-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = await Store.open(path.join(dir, 'library.sqlite'), path.resolve('dist-electron/sql-wasm.wasm'), {
    isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => ''
  });
  const add = (name, title, year) => {
    const id = store.createWork('movie', title, year);
    store.putAsset({ workId: id, root: dir, path: path.join(dir, name), kind: 'file', season: null, episode: null, size: 7, mtimeMs: 1 }, 1);
    store.setFavorite(id, true);
    return id;
  };
  for (const [name, , title, year, , expectedYear, imdbId] of releases.filter(release => release[6])) {
    const id = add(name, title, year);
    store.setWorkFields(id, { imdbId: 'tt9999999', matchState: 'matched' });
    store.setRating(id, 'imdb', null, 5.1, 10, 'tt9999999');
    const asset = store.work(id).assets[0];
    assert.equal(repairParsedWork(store, id), true);
    assert.equal(store.work(id).imdbId, imdbId);
    assert.equal(store.work(id).year, expectedYear);
    assert.equal(store.work(id).ratingImdb, null);
    assert.equal(store.work(id).favorite, true);
    assert.equal(store.work(id).assets[0].id, asset.id);
    assert.equal(repairParsedWork(store, id), false, 'repair is stable even before hydration');
  }
  const manual = add(releases[11][0], 'Custom', 2014);
  store.setManualFields(manual, { titleZh: '用户指定片名' });
  reconcileSeries(store);
  assert.equal(store.work(manual).titleZh, '用户指定片名');
  const ignored = add('Ignored.2020.mkv', 'Ignored', 2020);
  store.queueTask('tmdb', ignored);
  const task = store.pendingTasks().find(task => task.workId === ignored);
  store.taskRunning(task.id);
  store.ignoreWork(ignored);
  store.setWorkFields(ignored, { matchState: 'matched', titleEn: 'Late provider response' });
  store.taskDone(task.id);
  store.queueTask('douban', ignored);
  store.retryFailed();
  assert.equal(store.one('SELECT matchState FROM works WHERE id=?', [ignored]).matchState, 'ignored');
  assert.equal(store.pendingTasks().some(task => task.workId === ignored), false);
  assert.equal(store.listScrapeLogs().some(log => log.workId === ignored), false);
  assert.equal(store.one('SELECT status FROM tasks WHERE id=?', [task.id]).status, 'skipped');
  store.restoreWork(ignored);
  assert.equal(store.work(ignored).matchState, 'pending');
  store.close();
});
