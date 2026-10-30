import assert from 'node:assert/strict';
import test from 'node:test';
import { chooseDoubanSuggestion, doubanChineseTitle, doubanGenresFromMeta, doubanTitleQueries, doubanSearchQueries, doubanLocalizedSeriesAliases, doubanSeasonSubjectMatches, ratingFromSearchLinks } from '../dist-electron/electron/douban-match.js';

test('suggestions identify films by title and year without confusing a series', () => {
  const work = { mediaType: 'movie', titleZh: '双峰：与火同行', titleEn: 'Twin Peaks: Fire Walk with Me', originalTitle: 'Twin Peaks: Fire Walk with Me', year: 1992 };
  const suggestions = [
    { id: '1295526', title: '双峰 第一季', year: '1990', episode: '8' },
    { id: '1303472', title: '双峰：与火同行', year: '1992', episode: '' }
  ];
  assert.equal(chooseDoubanSuggestion(work, null, suggestions)?.id, '1303472');
});

test('suggestions distinguish seasons from the whole series', () => {
  const work = { mediaType: 'tv', titleZh: '双峰', titleEn: 'Twin Peaks', originalTitle: 'Twin Peaks', year: 1990 };
  const suggestions = [
    { id: '1295526', title: '双峰 第一季', year: '1990', episode: '8' },
    { id: '3022764', title: '双峰  第二季', year: '1990', episode: '22' },
    { id: '26088510', title: '双峰 第三季', year: '2017', episode: '18' },
    { id: '1303472', title: '双峰：与火同行', year: '1992', episode: '' }
  ];
  assert.equal(chooseDoubanSuggestion(work, null, suggestions), null);
  assert.equal(chooseDoubanSuggestion(work, 1, suggestions)?.id, '1295526');
  assert.equal(chooseDoubanSuggestion(work, 2, suggestions)?.id, '3022764');
  assert.equal(chooseDoubanSuggestion(work, 3, suggestions)?.id, '26088510');
});

test('single translated suggestion can match an exact release year', () => {
  const work = { mediaType: 'movie', titleZh: '', titleEn: 'A City of Sadness', originalTitle: 'A City of Sadness', year: 1989 };
  const suggestions = [{ id: '1294194', title: '悲情城市', sub_title: '悲情城市', year: '1989', episode: '' }];
  assert.equal(chooseDoubanSuggestion(work, null, suggestions)?.id, '1294194');
  assert.equal(chooseDoubanSuggestion({ ...work, year: 1990 }, null, suggestions), null);
  assert.equal(chooseDoubanSuggestion({ ...work, year: 1995 }, null, suggestions), null);
});

test('Douban matches bilingual release names and explicit AKA aliases without shortening unrelated titles', () => {
  const work = title => ({ mediaType: 'movie', titleZh: title, titleEn: title, originalTitle: title, year: 2023 });
  const suggestions = [
    { id: '35902857', title: '完美的日子', sub_title: 'Perfect Days', year: '2023' },
    { id: '1234567', title: 'Other film', sub_title: 'Other film', year: '2023' }
  ];
  assert.equal(chooseDoubanSuggestion(work('Perfect Days AKA The Tokyo Toilet'), null, suggestions)?.id, '35902857');
  assert.equal(chooseDoubanSuggestion(work('Perfect Days: Behind the Scenes'), null, suggestions), null);
  assert.equal(chooseDoubanSuggestion({ ...work('风柜来的人 All the Youthful Days'), year: 1983 }, null, [
    { id: '1299436', title: '风柜来的人', sub_title: 'The Boys from Fengkuei', year: '1983' },
    { id: '1234567', title: 'Other film', year: '1983' }
  ])?.id, '1299436');
});

test('English-only series match localized seasons and volumes regardless of premiere year', () => {
  const work = { mediaType: 'tv', titleZh: 'Love Death and Robots', titleEn: 'Love, Death & Robots', originalTitle: 'Love Death and Robots', year: 2019 };
  assert.equal(doubanTitleQueries(work)[0], '爱，死亡和机器人');
  const results = [
    { id: '3000001', title: '爱，死亡和机器人 第一季', sub_title: 'Love, Death & Robots', year: '2019', episode: '18' },
    { id: '3000003', title: '爱，死亡和机器人 第三季', sub_title: 'Love, Death & Robots Volume 3', year: '2022', episode: '9' },
    { id: '3000004', title: '爱，死亡和机器人 第四季', sub_title: 'Love, Death & Robots Volume 4', year: '2025', episode: '10' },
    { id: '3000005', title: 'Other series 第三季', sub_title: 'Other series Season 3', year: '2022' }
  ];
  assert.equal(chooseDoubanSuggestion(work, null, results), null);
  for (const season of [1, 3, 4]) assert.equal(chooseDoubanSuggestion(work, season, results)?.id, `300000${season}`);
  assert.equal(chooseDoubanSuggestion(work, 2, results), null);
  assert.equal(chooseDoubanSuggestion(work, 3, [results[3]]), null);
});

test('search page fallback reads Chinese title, genres and rating only from the selected ID', () => {
  const links = [
    { href: 'https://movie.douban.com/subject/1294194/', text: '悲情城市 (1989)', context: '9.0(150847人评价) 中国台湾 / 剧情' },
    { href: 'https://movie.douban.com/subject/1234567/', text: '龙屡阁 (2020)', context: '3.8(418人评价)' }
  ];
  assert.deepEqual(ratingFromSearchLinks('1294194', links), { id: '1294194', title: '悲情城市 (1989)', titleZh: '悲情城市', year: 1989, rating: 9, votes: 150847, tagsZh: [] });
  assert.deepEqual(ratingFromSearchLinks('1294194', [{ ...links[0], text: '', context: '悲情城市 (1989)9.0(150847人评价)中国台湾' }]),
    { id: '1294194', title: '悲情城市 (1989)', titleZh: '悲情城市', year: 1989, rating: 9, votes: 150847, tagsZh: [] });
  const localized = ratingFromSearchLinks('1294194', [{ ...links[0], text: '', titleText: '悲情城市 A City of Sadness (1989)',
    meta: '中国台湾 / 剧情 / 历史 / A City of Sadness / 157分钟' }]);
  assert.equal(localized?.titleZh, '悲情城市');
  assert.deepEqual(localized?.tagsZh, ['剧情', '历史']);
  assert.equal(doubanChineseTitle('冰血暴 Fargo (1996)'), '冰血暴');
  assert.deepEqual(doubanGenresFromMeta('美国 / 惊悚 / 犯罪 / 98分钟'), ['惊悚', '犯罪']);
  assert.equal(ratingFromSearchLinks('9999999', links), null);
});

test('localized season queries omit the separator and learn aliases only from a full title match', () => {
  const work = { mediaType: 'tv', titleZh: 'Stranger Things', titleEn: 'Stranger Things', originalTitle: 'Stranger Things', year: 2016 };
  const first = { id: '26359270', title: '怪奇物语 第一季', sub_title: 'Stranger Things', year: '2016' };
  assert.deepEqual(doubanLocalizedSeriesAliases(work, [first]), ['怪奇物语']);
  assert.deepEqual(doubanLocalizedSeriesAliases(work, [{ ...first, sub_title: 'Stranger Things: Behind the Scenes' }]), []);
  const localized = { ...work, titleZh: '怪奇物语 第一季' };
  const queries = doubanSearchQueries(localized, 2);
  assert.ok(queries.includes('怪奇物语第二季'));
  assert.ok(queries.includes('怪奇物语'));
  assert.ok(queries.includes('Stranger Things'));
  assert.ok(!queries.some(query => query.includes('第一季') || query.includes('First Season')));
  const later = { id: '26844438', title: '怪奇物语 第二季', sub_title: 'Stranger Things', year: '2017' };
  assert.equal(chooseDoubanSuggestion(localized, 2, [first, later])?.id, later.id);
  assert.equal(doubanChineseTitle('怪奇物语 第2季 Stranger Things Season 2 (2017)'), '怪奇物语 第2季');
});

test('season pages require their own exact title and season even when IMDb refers to an episode', () => {
  const match = { id: '26844438', title: '怪奇物语 第二季', sub_title: 'Stranger Things', year: '2017' };
  const subject = { id: match.id, title: '怪奇物语 第二季', titleZh: '怪奇物语 第二季', year: 2017, rating: 8.9, votes: 100, imdbId: 'tt6020684' };
  assert.equal(doubanSeasonSubjectMatches(match, subject, 2), true);
  assert.equal(doubanSeasonSubjectMatches(match, { ...subject, title: '怪奇物语 第一季', titleZh: '怪奇物语 第一季' }, 2), false);
  assert.equal(doubanSeasonSubjectMatches(match, { ...subject, title: 'Other Show Season 2', titleZh: '其他剧 第二季' }, 2), false);
  assert.equal(doubanSeasonSubjectMatches(match, { ...subject, id: '1234567' }, 2), false);
  assert.equal(doubanSeasonSubjectMatches(match, subject, 3), false);
});
