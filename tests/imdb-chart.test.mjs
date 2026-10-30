import test from 'node:test';
import assert from 'node:assert/strict';
import { parseImdbTop250, validateImdbTop250 } from '../dist-electron/electron/imdb-chart.js';

const entries = () => Array.from({ length: 250 }, (_, index) => ({ rank: index + 1, imdbId: `tt${String(index + 1).padStart(7, '0')}` }));
const next = edges => `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { pageData: { chartTitles: { edges } } } } })}</script>`;
const ld = items => `<script type="application/ld+json">${JSON.stringify({ '@type': 'ItemList', itemListElement: items })}</script>`;

test('IMDb chart reads explicit Next.js ranks, including rank 250, independent of edge order', () => {
  const chart = entries();
  assert.deepEqual(parseImdbTop250(next(chart.map(({ rank, imdbId }) => ({ currentRank: rank, node: { id: imdbId } })).reverse())), chart);
  assert.deepEqual(parseImdbTop250(next(chart.map(({ rank, imdbId }) => ({ node: { id: imdbId, currentRank: rank } })))), chart);
});

test('IMDb chart reads JSON-LD and falls back from truncated Next.js data', () => {
  const chart = entries();
  const html = ld(chart.map(({ rank, imdbId }) => ({ '@type': 'ListItem', position: rank, item: { url: `https://www.imdb.com/title/${imdbId}/` } })));
  assert.deepEqual(parseImdbTop250(html), chart);
  assert.deepEqual(parseImdbTop250(next([{ node: { id: 'tt0000001' } }]) + html), chart);
  assert.deepEqual(parseImdbTop250(next(chart.map(({ imdbId }) => ({ node: { id: imdbId } })))), chart);
});

test('IMDb chart rejects incomplete, duplicate, out-of-range and invalid entries', () => {
  const chart = entries();
  for (const bad of [chart.slice(0, 249), [...chart.slice(0, 249), chart[0]],
    chart.map((item, i) => i === 249 ? { ...item, rank: 0 } : item),
    chart.map((item, i) => i === 249 ? { ...item, rank: 251 } : item),
    chart.map((item, i) => i === 249 ? { ...item, rank: 1.5 } : item),
    chart.map((item, i) => i === 249 ? { ...item, imdbId: 'not-an-id' } : item),
    chart.map((item, i) => i === 249 ? { ...item, rank: 1 } : item)]) assert.throws(() => validateImdbTop250(bad));
});

test('IMDb chart never infers the Top 250 from unrelated links, recommendations or challenge pages', () => {
  assert.throws(() => parseImdbTop250('<h1>Verify you are human</h1>'));
  assert.throws(() => parseImdbTop250(entries().map(item => `<a href="/title/${item.imdbId}/">Title</a>`).join('')));
  assert.throws(() => parseImdbTop250('<script id="__NEXT_DATA__">invalid JSON</script>'));
  assert.throws(() => parseImdbTop250(ld(entries().map(({ rank, imdbId }) => ({ position: rank, item: { url: `https://example.com/title/${imdbId}/` } })))));
});
