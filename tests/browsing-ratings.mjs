import { electronExecutable } from './electron-path.mjs';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';
import { Store } from '../dist-electron/electron/store.js';

fs.mkdirSync('.cache', { recursive: true });
const data = fs.mkdtempSync(path.resolve('.cache/browsing-ratings-'));
const media = path.join(data, 'media');
fs.mkdirSync(media);
fs.mkdirSync(path.join(data, 'images'));
fs.copyFileSync(path.resolve('build/icon.png'), path.join(data, 'images', 'fixture.png'));
const store = await Store.open(path.join(data, 'library.sqlite'), path.resolve('dist-electron/sql-wasm.wasm'), {
  isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => ''
});
for (let i = 0; i < 116; i++) {
  const id = store.createWork(i < 80 ? 'movie' : 'tv', `收藏作品 ${i + 1}`, 1980 + i % 40);
  store.setWorkFields(id, { titleEn: `Collection ${String(i + 1).padStart(3, '0')}`, poster: 'fixture.png',
    genres: ['Drama', i % 2 ? 'Thriller' : 'Comedy'], countries: ['Japan'], matchState: 'matched',
    ratingImdb: i % 13 ? 6 + ((i * 3) % 40) / 10 : null,
    ratingDouban: i % 11 ? 6.5 + ((i * 7) % 35) / 10 : null });
  store.setFavorite(id, true);
  const file = path.join(media, `${i}.mkv`); fs.writeFileSync(file, 'fixture');
  store.putAsset({ workId: id, root: media, path: file, kind: 'file', season: i < 80 ? null : 1,
    episode: i < 80 ? null : 1, size: 7, mtimeMs: 1 }, 1);
}
store.setRoots([media]);
store.close();

const packaged = process.env.FILM_LIBRARY_PACKAGED === '1';
const app = await electron.launch({
  executablePath: electronExecutable(packaged),
  args: ['--no-sandbox', '--disable-gpu', ...(packaged ? [] : ['.'])],
  env: { ...process.env, FILM_LIBRARY_DATA_DIR: data, FILM_LIBRARY_SMOKE: '1' }
});
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(15000);
  await page.setViewportSize({ width: 1440, height: 960 });
  const errors = []; page.on('pageerror', error => errors.push(String(error)));
  await page.locator('.poster-card').first().waitFor();
  const nav = page.getByRole('navigation', { name: '影视类型' });
  const back = page.getByRole('button', { name: '返回片库', exact: true });
  const verifyReturn = async index => {
    await page.locator('.poster-grid').evaluate(grid => Promise.all(grid.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {}))));
    const card = page.locator('.poster-open').nth(index);
    await card.scrollIntoViewIfNeeded();
    const title = await card.getAttribute('aria-label');
    const before = await page.evaluate(() => scrollY);
    assert.ok(before > 400, 'test starts well below the top');
    await card.click();
    await page.locator('.detail-view').waitFor();
    assert.equal(await page.evaluate(() => scrollY), 0, 'details open at the top');
    await back.click();
    try { await page.waitForFunction(y => Math.abs(scrollY - y) < 2, before); }
    catch (error) { console.error({ before, after: await page.evaluate(() => scrollY), index }); throw error; }
    assert.equal(await page.getByRole('button', { name: title, exact: true }).isVisible(), true);
  };
  await verifyReturn(45);
  await verifyReturn(53);
  await page.getByRole('button', { name: '收藏', exact: true }).click();
  await verifyReturn(45);
  await nav.getByRole('button', { name: /^Movies/ }).click();
  await page.waitForFunction(() => scrollY === 0);
  assert.equal(await page.getByRole('button', { name: '收藏', exact: true }).getAttribute('aria-pressed'), 'true', 'same-tab click retains filters');
  await nav.getByRole('button', { name: /^Series/ }).click();
  await verifyReturn(25);
  await nav.getByRole('button', { name: /^Series/ }).click();
  await page.waitForFunction(() => scrollY === 0);
  await nav.getByRole('button', { name: 'Overview', exact: true }).click();
  const panel = page.locator('.panel-ratings');
  await panel.locator('svg').waitFor();
  await panel.scrollIntoViewIfNeeded();
  assert.equal(await panel.getByRole('button', { name: '0.5 分', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.equal(await panel.locator('.rating-source').count(), 2);
  assert.match(await panel.locator('.rating-imdb').innerText(), /平均分.*中位数/s);
  assert.match(await panel.locator('.rating-notes').innerText(), /双站均有评分/);
  assert.equal(await panel.locator('.chart-data button').count(), 40);
  await page.waitForTimeout(800);
  await panel.screenshot({ path: path.resolve('.cache/ratings-05-desktop.png'), animations: 'disabled' });
  const graph = panel.locator('.chart-ratings');
  const bounds = await graph.boundingBox();
  const points = graph.locator('svg path[fill="#9dc9ff"]');
  let clickedPoint = false;
  for (let i = 0; i < await points.count(); i++) {
    const box = await points.nth(i).boundingBox();
    if (box && box.width > 2 && box.width < 10 && box.height > 2 && box.height < 10 &&
      box.y > bounds.y + 55 && box.y < bounds.y + bounds.height - 110) {
      await points.nth(i).click({ force: true });
      clickedPoint = true;
      break;
    }
  }
  assert.equal(clickedPoint, true, 'an actual nonzero line point is clickable');
  const pointDialog = page.getByRole('dialog');
  await pointDialog.waitFor();
  const interval = (await pointDialog.getAttribute('aria-label')).split(' · ')[1].split('–').map(Number);
  const titles = await page.evaluate(() => window.library.listWorks());
  const expectedPointCount = titles.filter(work => work.ratingImdb !== null && work.ratingImdb >= interval[0] &&
    (work.ratingImdb < interval[1] || interval[1] === 10 && work.ratingImdb === 10)).length;
  assert.equal(await pointDialog.locator('.overview-titles>div').count(), expectedPointCount, 'focused chart points retain their original bin indexes');
  await page.keyboard.press('Escape');
  await panel.getByRole('button', { name: '0.1 分', exact: true }).click();
  assert.equal(await panel.locator('.chart-data button').count(), 200);
  await panel.getByRole('button', { name: '0–10', exact: true }).click();
  assert.equal(await panel.getByRole('button', { name: '0–10', exact: true }).getAttribute('aria-pressed'), 'true');
  await panel.locator('summary').click();
  const bin = panel.locator('.chart-data button').filter({ hasText: 'IMDb · 8.0–8.1' });
  const expectedCount = Number(await bin.locator('strong').innerText());
  assert.ok(expectedCount > 0);
  await bin.click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor();
  assert.equal(await dialog.locator('.overview-titles>div').count(), expectedCount);
  await page.keyboard.press('Escape');
  await panel.getByRole('button', { name: '1 分', exact: true }).click();
  assert.equal(await panel.locator('.chart-data button').count(), 20);
  await panel.getByRole('button', { name: '0.5 分', exact: true }).click();
  await panel.getByRole('button', { name: '聚焦评分', exact: true }).click();
  await panel.locator('summary').click();
  await nav.getByRole('button', { name: 'Overview', exact: true }).click();
  await page.waitForFunction(() => scrollY === 0);
  assert.equal(await panel.getByRole('button', { name: '0.5 分', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.setViewportSize({ width: 390, height: 844 });
  await panel.scrollIntoViewIfNeeded();
  await page.waitForTimeout(800);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await panel.screenshot({ path: path.resolve('.cache/ratings-05-mobile.png'), animations: 'disabled', style: '.topbar { visibility: hidden !important; }' });
  await page.evaluate(() => window.library.setSettings({ language: 'en' }));
  await panel.getByRole('button', { name: '0.5 pt', exact: true }).waitFor();
  assert.doesNotMatch(await panel.innerText(), /[\u3400-\u9fff]/);
  assert.deepEqual(errors, []);
  console.log('Browsing & ratings passed: scroll restoration in Movies/Series, same-tab top with filters retained, fine intervals, statistics, drilldown, mobile and English UI.');
} finally { await app.close(); }
