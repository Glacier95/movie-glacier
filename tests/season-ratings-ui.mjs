import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';
import { electronExecutable } from './electron-path.mjs';
import { Store } from '../dist-electron/electron/store.js';

process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY = '1';
fs.mkdirSync('.cache', { recursive: true });
const data = fs.mkdtempSync(path.resolve('.cache/season-ratings-'));
const media = path.join(data, 'media'); fs.mkdirSync(media);
const store = await Store.open(path.join(data, 'library.sqlite'), path.resolve('dist-electron/sql-wasm.wasm'), {
  isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => ''
});
const id = store.createWork('tv', '爱，死亡和机器人', 2019);
store.setWorkFields(id, { titleEn: 'Love, Death & Robots', matchState: 'matched' });
for (const season of [1, 2, 3, 4]) {
  const file = path.join(media, `Love.Death.and.Robots.S0${season}E01.mkv`); fs.writeFileSync(file, 'fixture');
  store.putAsset({ workId: id, root: media, path: file, kind: 'file', season, episode: 1, size: 7, mtimeMs: 1 }, 1);
}
for (const [season, score] of [[1, 9.2], [3, 8.5], [4, 4.8]]) store.setRating(id, 'douban', season, score, 100, String(3000000 + season));
store.setRating(id, 'imdb', null, 8.4, 100, 'tt1000001');
const single = store.createWork('tv', '请回答1988', 2015);
store.setWorkFields(single, { titleEn: 'Reply 1988', matchState: 'matched' });
const singleFile = path.join(media, 'Reply.1988.S01E01.2015.mkv'); fs.writeFileSync(singleFile, 'fixture');
store.putAsset({ workId: single, root: media, path: singleFile, kind: 'file', season: 1, episode: 1, size: 7, mtimeMs: 1 }, 1);
store.setRating(single, 'douban', null, 9.7, 100, '4000001');
const films = [
  { zh: '重庆森林', traditional: '重慶森林', original: '重慶森林', primary: '重庆森林' },
  { zh: '海滩的一天', traditional: '海灘的一天', original: '海灘的一天', primary: '海滩的一天' },
  { zh: '情书', traditional: '情書', original: 'Love Letter', primary: 'Love Letter' }
];
for (const film of films) {
  const movie = store.createWork('movie', film.zh, 1994);
  store.setWorkFields(movie, { titleEn: film.traditional, originalTitle: film.original, doubanTitleZh: film.zh, matchState: 'matched' });
  const file = path.join(media, `${film.primary}.mkv`); fs.writeFileSync(file, 'fixture');
  store.putAsset({ workId: movie, root: media, path: file, kind: 'file', season: null, episode: null, size: 7, mtimeMs: 1 }, 1);
}
store.setRoots([media]); store.close();
const packaged = process.env.FILM_LIBRARY_PACKAGED === '1';
const launch = () => electron.launch({ executablePath: electronExecutable(), args: ['--no-sandbox', '--disable-gpu', ...(packaged ? [] : ['.'])],
  env: { ...process.env, FILM_LIBRARY_SMOKE: '1', FILM_LIBRARY_DATA_DIR: data } });
let app;
try {
  app = await launch(); let page = await app.firstWindow(); page.setDefaultTimeout(15_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = []; page.on('pageerror', error => errors.push(String(error)));
  await page.locator('.brand').waitFor();
  const expectedVersion = JSON.parse(fs.readFileSync('package.json', 'utf8')).version;
  assert.equal(await page.locator('.app-version').innerText(), `v${expectedVersion}`);
  assert.equal(await app.evaluate(({ app }) => app.getVersion()), expectedVersion);
  for (const film of films) {
    const card = page.locator('.poster-card').filter({ has: page.getByRole('button', { name: `查看《${film.zh}》详情`, exact: true }) });
    assert.equal(await card.locator('.poster-title').innerText(), film.primary);
    assert.ok(!(await card.locator('.poster-subtitle').innerText()).includes(film.traditional));
    await card.getByRole('button', { name: `查看《${film.zh}》详情`, exact: true }).click();
    await page.locator('.hero h1').waitFor();
    assert.equal(await page.locator('.hero h1').innerText(), film.primary);
    if (film.primary === film.zh) assert.equal(await page.locator('.hero-original').count(), 0);
    else assert.equal(await page.locator('.hero-original').innerText(), film.zh);
    await page.getByRole('button', { name: '返回片库', exact: true }).click();
  }
  const openSeries = async title => {
    await page.locator('.main-tabs button').nth(1).click();
    await page.getByRole('button', { name: title, exact: true }).click();
    await page.locator('.hero-season-ratings').waitFor();
  };
  await openSeries('查看《爱，死亡和机器人》详情');
  assert.equal(await page.locator('.season-summary').count(), 4);
  for (const [season, score] of [[1, '9.2'], [3, '8.5'], [4, '4.8']]) {
    assert.match(await page.locator(`.season-summary[href="#season-${season}"]`).innerText(), new RegExp(score.replace('.', '\\.')));
    assert.match(await page.locator(`#season-${season} .season-heading-ratings`).innerText(), new RegExp(score.replace('.', '\\.')));
  }
  assert.match(await page.locator('.season-summary[href="#season-2"]').innerText(), /暂无评分/);
  assert.doesNotMatch(await page.locator('#season-2 .season-heading-ratings').innerText(), /9\.2|8\.4/,
    'missing season ratings must not borrow another season or the overall score');
  assert.match(await page.locator('.hero-ratings').innerText(), /IMDb.*整剧.*8\.4/);
  await page.screenshot({ path: path.resolve('.cache/season-ratings-detail.png'), animations: 'disabled' });
  await page.locator('.season-summary[href="#season-4"]').click();
  assert.ok(await page.locator('#season-4').isVisible());
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.main-tabs')).columnGap === '9px');
  const overflow = await page.evaluate(() => [...document.querySelectorAll('body *')].filter(element => element.getBoundingClientRect().right > innerWidth + 1)
    .slice(0, 8).map(element => ({ tag: element.tagName, className: element.className, text: element.textContent?.slice(0, 80), parent: element.parentElement?.className, right: element.getBoundingClientRect().right,
      gap: getComputedStyle(element.parentElement).gap, width: innerWidth, narrow: matchMedia('(max-width:600px)').matches })));
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), JSON.stringify(overflow));
  await page.screenshot({ path: path.resolve('.cache/season-ratings-mobile.png'), animations: 'disabled' });
  await page.evaluate(() => window.library.setSettings({ language: 'en' }));
  await page.getByRole('group', { name: 'Season ratings', exact: true }).waitFor();
  assert.match(await page.locator('.season-summary[href="#season-4"]').innerText(), /Season 4.*Douban.*4\.8/s);
  assert.match(await page.locator('#season-2 .season-heading-ratings').innerText(), /No rating available/);
  assert.doesNotMatch(await page.locator('.hero-season-ratings').innerText(), /[\u3400-\u9fff]/);
  assert.deepEqual(errors, []);
  await app.close(); app = await launch(); page = await app.firstWindow(); page.setDefaultTimeout(15_000);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('.brand').waitFor();
  await openSeries('View details for Love, Death & Robots');
  assert.match(await page.locator('#season-4 .season-heading-ratings').innerText(), /4\.8/);
  assert.match(await page.locator('#season-1 .season-heading-ratings').innerText(), /9\.2/);
  await page.getByRole('button', { name: 'Back to library', exact: true }).click();
  await page.getByRole('button', { name: 'View details for Reply 1988', exact: true }).click();
  assert.match(await page.locator('#season-1 .season-heading-ratings').innerText(), /Overall series.*9\.7/s,
    'a single-season show labels an overall-source fallback explicitly');
  console.log('Titles and season ratings UI passed: simplified/traditional Chinese shown once, real English title preferred; independent season scores, missing states, mobile, English and persistence.');
} finally { await app?.close(); }
