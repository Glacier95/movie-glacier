import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseName, findNfoId } from '../dist-electron/electron/scanner.js';
import { titleQueries } from '../dist-electron/electron/media-titles.js';
import { chooseTmdbCandidate } from '../dist-electron/electron/tmdb-match.js';
import { lookupYear, omdbQueries, checkOmdbYear } from '../dist-electron/electron/omdb.js';
import { localWorkMatches, repairParsedWork } from '../dist-electron/electron/local-match.js';
import { Store } from '../dist-electron/electron/store.js';

const parse = name => parseName(path.join('D:', 'media', name), 'file');
const candidate = (id, title, year) => ({ id, title, originalTitle: title, year, posterPath: null });

test('numeric series titles retain their numbers while real release years are parsed', () => {
  for (const name of ['请回答1988.2015.E01.mkv', 'Reply.1988.E01.2015.mkv', '请回答1988/01.mkv']) {
    const parsed = parse(name);
    assert.equal(parsed.mediaType, 'tv', name);
    assert.equal(parsed.normalizedTitle, 'reply 1988', name);
    assert.equal(parsed.episode, 1, name);
    assert.notEqual(parsed.year, 1988, name);
  }
  assert.equal(parse('Reply.1988.2015.mkv').year, 2015);
  assert.equal(parse('1984.1984.mkv').title, '1984');
  assert.equal(parse('2001.A.Space.Odyssey.1968.mkv').title, '2001 A Space Odyssey');
  assert.equal(parse('Blade.Runner.2049.2017.mkv').title, 'Blade Runner 2049');
  assert.equal(parse('天空之城.1986.mkv').year, 1986);
});

test('Chinese seasons, episode-only filenames and known numbered series share a series identity', () => {
  for (const [name, season, episode] of [
    ['爱死亡和机器人3.2022.E01.mkv', 3, 1],
    ['爱死亡和机器人 第三季/第01集.mkv', 3, 1],
    ['Love.Death.and.Robots/Season 3/03.mkv', 3, 3],
    ['爱死亡和机器人3/S03E01.mkv', 3, 1],
    ['爱死亡和机器人.S01E01.2019.mkv', 1, 1],
    ['爱死亡和机器人.S02E01.2021.mkv', 2, 1]
  ]) {
    const parsed = parse(name);
    assert.deepEqual([parsed.mediaType, parsed.normalizedTitle, parsed.season, parsed.episode],
      ['tv', 'love death robots', season, episode], name);
  }
  const parsed = parse('其他剧集 第二十一季/第十二集.mkv');
  assert.deepEqual([parsed.title, parsed.season, parsed.episode], ['其他剧集', 21, 12]);
  assert.equal(parse('Toy.Story.3.2010.mkv').mediaType, 'movie', 'ordinary sequels remain films');
  assert.equal(parse('Some.Show.1x02.2015.mkv').episode, 2);
  assert.equal(parse('Some.Show.S02/Some.Show.S03E01.mkv').season, 3, 'explicit filename season takes precedence over folder');
});

test('TMDB never accepts a shorter title just because its year matches', () => {
  assert.equal(chooseTmdbCandidate('爱死亡和机器人3', 2022, [candidate(1, '爱死亡', 2022)]), null);
  assert.equal(chooseTmdbCandidate('Reply 1988', 2015, [candidate(1, 'Reply', 2015)]), null);
  assert.equal(chooseTmdbCandidate('爱死亡和机器人 Love, Death & Robots', null,
    [candidate(1, 'Love, Death & Robots', 2019)])?.id, 1);
  assert.equal(titleQueries('Love, Death & Robots')[0], 'Love, Death & Robots');
  assert.equal(titleQueries('Reply 1988')[0], 'Reply 1988');
  assert.equal(chooseTmdbCandidate('爱死亡和机器人', null, [candidate(2, '爱，死亡和机器人', 2019)])?.id, 2);
  assert.equal(chooseTmdbCandidate('Solaris', null, [candidate(1, 'Solaris', 1972), candidate(2, 'Solaris', 2002)]), null);
});

test('later seasons do not masquerade as series premiere years; explicit film IDs tolerate year differences', () => {
  const series = { mediaType: 'tv', year: 2022, titleZh: '爱，死亡和机器人', titleEn: '', originalTitle: '',
    assets: [{ path: path.join('D:', 'media', '爱死亡和机器人3.2022.E01.mkv'), kind: 'file', season: 3 }] };
  assert.equal(lookupYear(series), null);
  assert.equal(omdbQueries(series)[0], 'Love, Death & Robots');
  assert.equal(omdbQueries({ ...series, titleZh: '请回答1988' })[0], 'Reply 1988');
  assert.throws(() => checkOmdbYear({ mediaType: 'movie', year: 1986, imdbId: null }, 2003), /年份与本地资源不符/);
  assert.match(checkOmdbYear({ mediaType: 'movie', year: 1986, imdbId: 'tt0092067' }, 2003)[0], /保留本地年份/);
});

test('NFO lookup cannot borrow another film or an episode ID from a shared folder', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recognition-nfo-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const movie = path.join(dir, '天空之城.1986.mkv');
  fs.writeFileSync(path.join(dir, 'Other.Film.nfo'), '<movie><id>tt1234567</id></movie>');
  assert.equal(findNfoId(movie, 'file'), null);
  fs.writeFileSync(movie.replace('.mkv','.nfo'), '<movie><id>tt0092067</id></movie>');
  assert.equal(findNfoId(movie, 'file'), 'tt0092067');
  const episode = path.join(dir, 'Reply.1988.S01E01.mkv');
  fs.writeFileSync(episode.replace('.mkv','.nfo'), '<episodedetails><id>tt9999999</id></episodedetails>');
  assert.equal(findNfoId(episode, 'file'), null);
  fs.writeFileSync(path.join(dir, 'tvshow.nfo'), '<tvshow><id>tt5182866</id></tvshow>');
  assert.equal(findNfoId(episode, 'file'), 'tt5182866');
});

test('rescan repairs automatic series classifications and preserves manual edits, favorites and asset IDs', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recognition-store-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = await Store.open(path.join(dir, 'library.sqlite'), path.resolve('dist-electron/sql-wasm.wasm'), {
    isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => ''
  });
  const add = (id, name, season = null) => {
    const file = path.join(dir, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'test');
    store.putAsset({ workId: id, root: dir, path: file, kind: 'file', season, episode: null, size: 4, mtimeMs: 1 }, 1);
    return file;
  };
  const reply = store.createWork('movie', '请回答', 1988);
  const file = add(reply, '请回答1988/01.mkv');
  store.setFavorite(reply, true);
  const assetId = store.findAsset(file).id;
  assert.equal(repairParsedWork(store, reply), true);
  assert.deepEqual([store.work(reply).mediaType, store.work(reply).titleZh, store.work(reply).year], ['tv', '请回答1988', null]);
  assert.equal(store.findAsset(file).id, assetId);
  assert.equal(store.work(reply).favorite, true);
  assert.equal(store.findAsset(file).episode, 1);
  assert.equal(repairParsedWork(store, reply), false, 'a second scan must not reset metadata again');
  const robots = store.createWork('tv', '爱死亡', 2022);
  add(robots, '爱死亡和机器人3.2022.E01.mkv', 3);
  store.setWorkFields(robots, { matchState: 'matched', tmdbId: 123, imdbId: 'tt9999999', poster: 'wrong-film.jpg' });
  store.setRating(robots, 'imdb', null, 8, 100, 'tt9999999');
  assert.equal(repairParsedWork(store, robots), true);
  assert.equal(store.work(robots).tmdbId, null);
  assert.equal(store.work(robots).poster, null);
  assert.equal(store.work(robots).ratingImdb, null);
  assert.equal(localWorkMatches(store.work(robots), parse('爱死亡和机器人.S01E01.2019.mkv')), true);
  const manual = store.createWork('movie', 'Custom title', 2000);
  add(manual, 'Reply.1988.S01E01.2015.mkv');
  store.setManualFields(manual, { titleZh: '我确认的片名' });
  assert.equal(repairParsedWork(store, manual), false);
  assert.equal(store.work(manual).titleZh, '我确认的片名');
  store.close();
});
