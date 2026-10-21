import test from 'node:test';
import assert from 'node:assert/strict';
import { doubanIdFromWikidata, lookupDoubanIdByImdb } from '../dist-electron/electron/douban-crosswalk.js';

test('IMDb crosswalk resolves both Nymphomaniac volumes to separate Douban records', async () => {
  const expected = new Map([['tt1937390', '6827727'], ['tt2382009', '10792650']]);
  for (const [imdbId, doubanId] of expected) {
    const found = await lookupDoubanIdByImdb(imdbId, async url => {
      const query = new URL(url).searchParams.get('query');
      assert.match(query, new RegExp(`wdt:P345 "${imdbId}"`));
      return { ok: true, json: async () => ({ results: { bindings: [{ douban: { value: doubanId } }] } }) };
    });
    assert.equal(found, doubanId);
  }
});

test('crosswalk rejects invalid IMDb IDs and ambiguous or malformed Douban IDs', async () => {
  assert.equal(await lookupDoubanIdByImdb('Nymphomaniac', () => { throw new Error('must not query'); }), null);
  assert.equal(doubanIdFromWikidata({ results: { bindings: [
    { douban: { value: '6827727' } }, { douban: { value: '10792650' } }
  ] } }), null);
  assert.equal(doubanIdFromWikidata({ results: { bindings: [{ douban: { value: '../bad' } }] } }), null);
});
