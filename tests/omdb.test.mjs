import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { chooseOmdbCandidate, lookupYear, omdbQueries, searchOmdbCandidate } from '../dist-electron/electron/omdb.js';

const candidate = (Title, Year, imdbID) => ({ Title, Year, imdbID });

test('an adjacent-year first page cannot beat an exact-year result on a later request', async () => {
  const work = { mediaType: 'movie', titleZh: 'Home', titleEn: 'Home', originalTitle: 'Home', year: 2020 };
  const result = await searchOmdbCandidate(work, async params => ({ Response: 'True', Search: [
    params.y === '2020' ? candidate('Home', '2020', 'tt1000001') : candidate('Home', '2019', 'tt1000002')
  ] }));
  assert.equal(result?.imdbID, 'tt1000001');
});

test('equally plausible adjacent releases stay unmatched regardless of response order', async () => {
  const work = { mediaType: 'movie', titleZh: 'Home', titleEn: 'Home', originalTitle: 'Home', year: 2020 };
  const result = await searchOmdbCandidate(work, async params => ({ Response: 'True', Search: [
    params.y === '2021' ? candidate('Home', '2021', 'tt1000001') : candidate('Home', '2019', 'tt1000002')
  ] }));
  assert.equal(result, null);
});

test('OMDb fallback rejects similarly named extras and accepts one-year release differences', () => {
  assert.equal(chooseOmdbCandidate('Dogville', 2003, [
    candidate('Dogville Confessions', '2003', 'tt0357608'),
    candidate('Dogville', '2004', 'tt0276919')
  ])?.imdbID, 'tt0276919');
  assert.equal(chooseOmdbCandidate('Ex Machina', 2014, [
    candidate('Ex Machina (2014)/Crash (2004) - Movie Buff Specialists', '2014', 'tt9999999'),
    candidate('Ex Machina', '2015', 'tt0470752')
  ])?.imdbID, 'tt0470752');
  assert.equal(chooseOmdbCandidate('Mirror', 1975, [candidate('The Mirror', '1975', 'tt0072443')])?.imdbID,
    'tt0072443');
  assert.equal(chooseOmdbCandidate('Nymphomaniac Vol I', 2013,
    [candidate('Nymphomaniac: Vol. I', '2014', 'tt1937390')])?.imdbID, 'tt1937390');
  assert.equal(chooseOmdbCandidate('Solaris', 1972, [candidate('Solaris', '2002', 'tt0307479')]), null);
  assert.equal(chooseOmdbCandidate('Fargo', 1996, [
    candidate('Fargo', '1996', 'tt0116282'), candidate('Fargo', '1996', 'tt2222222')
  ]), null, 'indistinguishable results need confirmation');
});

test('series matching uses the earliest local season rather than a later revival year', () => {
  const asset = (name, season) => ({ path: path.join('D:', 'media', name), kind: 'file', season });
  const work = { mediaType: 'tv', titleZh: '双峰 Twin Peaks', titleEn: 'Twin Peaks', originalTitle: 'Twin Peaks', year: 2017,
    assets: [asset('Twin.Peaks.S03E01.2017.mkv', 3), asset('Twin.Peaks.S01E01.1990.mkv', 1)] };
  assert.equal(lookupYear(work), 1990);
  assert.equal(omdbQueries(work)[0], 'Twin Peaks');
  assert.equal(chooseOmdbCandidate('Twin Peaks', lookupYear(work), [
    candidate('Twin Peaks', '2017', 'tt4093826'), candidate('Twin Peaks', '1990–1991', 'tt0098936')
  ])?.imdbID, 'tt0098936');
});

test('1983 Nostalgia searches its IMDb spelling before similarly named films', () => {
  const work = { mediaType: 'movie', titleZh: 'Nostalgia', titleEn: 'Nostalgia', originalTitle: 'Nostalgia', year: 1983 };
  assert.deepEqual(omdbQueries(work), ['Nostalghia', 'Nostalgia']);
});

test('OMDb splits explicit AKA aliases and continues after broad searches return too many results', async () => {
  const work = { mediaType: 'movie', titleZh: 'Perfect Days AKA The Tokyo Toilet', titleEn: '', originalTitle: '', year: 2023 };
  assert.deepEqual(omdbQueries(work), ['Perfect Days', 'The Tokyo Toilet']);
  const calls = [];
  const found = await searchOmdbCandidate(work, async params => {
    calls.push(params);
    return params.y === '2023' ? { Response: 'True', Search: [candidate('Perfect Days', '2023', 'tt27503384')] }
      : { Response: 'False', Error: 'Too many results.' };
  });
  assert.equal(found?.imdbID, 'tt27503384');
  assert.deepEqual(calls.map(params => [params.s, params.y ?? null]), [['Perfect Days', null], ['Perfect Days', '2023']]);
  const queries = [];
  await searchOmdbCandidate({ ...work, titleZh: '风柜来的人 All the Youthful Days', year: 1983 }, async params => {
    queries.push(params.s); return { Response: 'False', Error: 'Too many results.' };
  });
  assert.ok(queries.includes('风柜来的人'), 'a broad English alias must not prevent trying the Chinese title');
  await assert.rejects(searchOmdbCandidate(work, async () => ({ Response: 'False', Error: 'Invalid API key!' })), /Invalid API key/);
  assert.equal(chooseOmdbCandidate('Perfect Days', 2023, [candidate('Perfect Days: Behind the Scenes', '2023', 'tt9999999')]), null);
});
