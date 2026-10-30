import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeLibrary, ratingDistribution, ratingSummary, pairedRatings, relationships } from '../src/overview-data.ts';

const work = (id, patch = {}) => ({ id, mediaType: 'movie', genres: [], doubanTags: [], countries: [], directors: [], actors: [], year: null, topRank: null, favorite: false, assets: [], ...patch });
test('overview counts titles, merges aliases, deduplicates credits and preserves missing years', () => {
  const a = work(1, { genres: ['Science Fiction', '科幻'], countries: ['US', '美国'], directors: [{ id: 'tmdb:1', name: '导演甲', originalName: 'Director A' }], actors: [{ id: 'cast:1', name: 'Actor A' }, { id: 'cast:1', name: 'Actor A' }], year: 2000, favorite: true, topRank: 12, assets: [{}, {}] });
  const b = work(2, { mediaType: 'tv', doubanTags: ['科幻'], countries: ['United States of America'], directors: [{ id: 'omdb:a', name: 'Director A' }], year: 2001 });
  const stats = summarizeLibrary([a, b, work(3), a]);
  assert.equal(stats.total, 3); assert.equal(stats.movies, 2); assert.equal(stats.series, 1);
  assert.equal(stats.favorites, 1); assert.equal(stats.top250, 1);
  assert.deepEqual(stats.genres, [{ name: 'Science Fiction', value: 2, ids: [1, 2] }]);
  assert.deepEqual(stats.countries, [{ name: 'United States', value: 2, ids: [1, 2] }]);
  assert.equal(stats.directors[0].name, '导演甲'); assert.equal(stats.directors[0].value, 2);
  assert.equal(stats.actors[0].value, 1);
  assert.equal(stats.years.find(b => b.name === '未知年份').value, 1);
  assert.deepEqual(stats.missing, { genres: 1, countries: 1 });
  assert.equal(summarizeLibrary([a, b], true).directors[0].name, 'Director A');
});
test('overview handles empty libraries and limits people rankings to ten', () => {
  assert.equal(summarizeLibrary([]).total, 0); assert.deepEqual(summarizeLibrary([]).years, []);
  const works = Array.from({ length: 12 }, (_, i) => work(i, {
    directors: [{ id: `p${i}`, name: `Person ${i}` }], actors: [{ id: `a${i}`, name: `Actor ${i}` }]
  }));
  assert.equal(summarizeLibrary(works).directors.length, 10);
  assert.equal(summarizeLibrary(works).actors.length, 10);
  assert.equal(summarizeLibrary(works.slice(0, 3)).directors.length, 3);
});

test('overview counts IMDb and Douban chart membership independently and deduplicates versions', () => {
  const both = work(1, { topRank: 5, imdbTopRank: 250 });
  const imdbOnly = work(2, { imdbTopRank: 1 });
  const stats = summarizeLibrary([both, both, imdbOnly, work(3), work(4, { mediaType: 'tv', imdbTopRank: 20 })]);
  assert.equal(stats.top250, 1);
  assert.equal(stats.imdbTop250, 2);
  assert.equal(summarizeLibrary([]).imdbTop250, 0);
});

test('rating lines count independent scores, exclude missing values and include boundaries once', () => {
  const items = [work(1, { ratingImdb: 0, ratingDouban: 8.5 }), work(2, { ratingImdb: 8, ratingDouban: null }),
    work(3, { ratingImdb: 9.9, ratingDouban: 10 }), work(4, { ratingImdb: 10 }), work(5, { ratingImdb: NaN }),
    work(6, { ratingImdb: -1 }), work(7, { ratingImdb: 11 }), work(8)];
  const imdb = ratingDistribution([...items, items[0]], 'ratingImdb');
  assert.equal(imdb.reduce((total, b) => total + b.value, 0), 4);
  assert.deepEqual(imdb[0].ids, [1]); assert.deepEqual(imdb[8].ids, [2]); assert.deepEqual(imdb[9].ids, [3, 4]);
  const douban = ratingDistribution(items, 'ratingDouban');
  assert.equal(douban.reduce((total, b) => total + b.value, 0), 2);
  assert.deepEqual(douban[8].ids, [1]); assert.deepEqual(douban[9].ids, [3]);
});

test('release years are chronological rather than ordered by popularity, with unknown last', () => {
  const summary = summarizeLibrary([work(1, { year: 2000 }), work(2, { year: 1970 }), work(3, { year: 2000 }), work(4)]);
  assert.deepEqual(summary.years.map(b => b.name), ['1970', '2000', '未知年份']);
});

test('fine rating bins preserve decimal boundaries and count every valid title exactly once', () => {
  const values = [0, 0.1, 0.49, 0.5, 7.9, 8, 8.1, 8.5, 9.9, 10];
  const items = values.map((ratingImdb, id) => work(id, { ratingImdb }));
  for (const step of [0.1, 0.5, 1]) {
    const bins = ratingDistribution([...items, items[0], work(100, { ratingImdb: NaN })], 'ratingImdb', step);
    assert.equal(bins.length, 10 / step);
    assert.equal(bins.reduce((sum, bin) => sum + bin.value, 0), values.length);
    assert.equal(new Set(bins.flatMap(bin => bin.ids)).size, values.length);
    assert.ok(bins.at(-1).ids.includes(9), '10.0 is included in the final bin');
  }
  assert.deepEqual(ratingDistribution(items, 'ratingImdb', 0.1)[81].ids, [6]);
  assert.deepEqual(ratingDistribution(items, 'ratingImdb', 0.5)[16].ids, [5, 6]);
  assert.equal(summarizeLibrary(items).ratings.imdb.length, 20, 'the overview defaults to half-point intervals');
});

test('rating summaries exclude invalid scores and compare only titles rated on both sources', () => {
  const items = [work(1, { ratingImdb: 0, ratingDouban: 1 }), work(2, { ratingImdb: 8, ratingDouban: 9 }),
    work(3, { ratingImdb: 9 }), work(4, { ratingImdb: 10 }), work(5), work(6, { ratingImdb: NaN, ratingDouban: 11 })];
  const summary = ratingSummary([...items, items[0]], 'ratingImdb');
  assert.deepEqual(summary, { count: 4, missing: 2, mean: 6.75, median: 8.5, highCount: 3, highShare: .75, coverage: 4 / 6 });
  assert.deepEqual(pairedRatings([...items, items[0]]), { count: 2, difference: 1 });
  assert.deepEqual(pairedRatings([work(1)]), { count: 0, difference: null });
  assert.equal(ratingSummary([], 'ratingDouban').mean, null);
  assert.equal(ratingSummary([], 'ratingDouban').median, null);
  assert.equal(ratingSummary([], 'ratingDouban').coverage, 0);
});


test('relationships count shared titles once, normalize aliases and never invent links', () => {
  const a = work(1, { genres: ['科幻', 'Science Fiction', 'Drama', 'Drama'], countries: ['US', '美国', 'France'] });
  const b = work(2, { genres: ['Science Fiction', 'Drama', 'Adventure'], countries: ['US'] });
  const stats = summarizeLibrary([a, b, a, work(3, { genres: ['Comedy'], countries: ['Japan'] })]);
  const pairs = relationships(stats.genres);
  assert.equal(pairs.length, 3);
  assert.deepEqual(pairs.find(p => [p.source, p.target].includes('Drama') && [p.source, p.target].includes('Science Fiction')).ids, [1, 2]);
  assert.ok(pairs.every(p => p.source !== p.target && p.value === p.ids.length));
  const regions = relationships(stats.countries);
  assert.equal(regions.length, 1); assert.deepEqual(regions[0].ids, [1]);
  assert.deepEqual(relationships([]), []);
  assert.deepEqual(relationships(summarizeLibrary([work(1, { genres: ['Drama'] })]).genres), []);
  assert.equal(relationships(summarizeLibrary(Array.from({ length: 12 }, (_, id) => work(id, { genres: [`Genre ${id}`, 'Drama'] }))).genres.slice(0, 8)).length, 7);
});


test('bubble packing preserves area ratios and contains sparse and dense data without collisions', async () => {
  const { packBubbles } = await import('../src/overview-layout.ts');
  for (const width of [270, 520]) for (const values of [[], [10], [20, 10], Array.from({ length: 100 }, (_, i) => 100 - i)]) {
    const points = packBubbles(values, width, 310);
    assert.deepEqual(points, packBubbles(values, width, 310), 'stable on repeat renders');
    points.forEach((p, i) => {
      assert.ok(p.x - p.radius >= 0 && p.x + p.radius <= width && p.y - p.radius >= 0 && p.y + p.radius <= 310);
      assert.ok(Math.abs(p.radius ** 2 / points[0].radius ** 2 - values[i] / values[0]) < 1e-9);
      for (const other of points.slice(i + 1)) assert.ok(Math.hypot(p.x - other.x, p.y - other.y) >= p.radius + other.radius);
    });
  }
});
