import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';
import { Store } from '../dist-electron/electron/store.js';
import { electronExecutable } from './electron-path.mjs';

fs.mkdirSync('.cache', { recursive: true });
const data = fs.mkdtempSync(path.resolve('.cache/desktop-ui-'));
fs.mkdirSync(path.join(data, 'images'));
const titles = ['The Quiet Hours', 'After the Rain', 'Into the Blue', 'Last Light', 'A Place in Time', 'Wild Coast', 'Night Drive', 'The Long Way Home'];
const colors = [['#b88955', '#191d24'], ['#627d68', '#141d22'], ['#2e84ac', '#091c39'], ['#c87954', '#30151e'], ['#a99374', '#192a2b'], ['#748a6e', '#162f2e'], ['#a75568', '#17182c'], ['#8b8f9f', '#283342']];
const names = titles.map(title => crypto.createHash('sha1').update(title).digest('hex') + '.png');
const store = await Store.open(path.join(data, 'library.sqlite'), path.resolve('dist-electron/sql-wasm.wasm'), {
  isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => ''
});
for (let index = 0; index < 80; index++) {
  const id = store.createWork('movie', titles[index % titles.length], 2020 + index % 5);
  store.setWorkFields(id, { titleEn: titles[index % titles.length], poster: names[index % titles.length],
    overview: 'A fictional film used to verify the library interface, motion, and keyboard navigation.',
    genres: ['Drama', 'Adventure'], ratingImdb: Number((7.2 + index % 15 / 10).toFixed(1)), matchState: 'matched' });
  const file = path.join(data, `fixture-${index}.mkv`); fs.writeFileSync(file, 'fixture');
  store.putAsset({ workId: id, root: data, path: file, kind: 'file', season: null, episode: null, size: 7, mtimeMs: 1 }, 1);
}
store.setRoots([data]); store.close();
const packaged = process.env.FILM_LIBRARY_PACKAGED === '1';
const app = await electron.launch({ executablePath: electronExecutable(packaged), args: packaged ? [] : ['.'],
  env: { ...process.env, FILM_LIBRARY_SMOKE: '1', FILM_LIBRARY_DATA_DIR: data } });
try {
  let page = await app.firstWindow(); const errors = []; page.on('pageerror', error => errors.push(String(error)));
  await page.locator('.poster-card').first().waitFor();
  assert.equal(await page.locator('.page-intro .eyebrow,.page-intro p').count(), 0, 'page headings omit promotional copy');
  assert.equal(await page.locator('.main-tabs').evaluate(element => getComputedStyle(element).paddingTop), '0px');
  assert.notEqual(await page.locator('.main-tabs button.active').evaluate(element => getComputedStyle(element, '::after').display), 'none',
    'classic active-tab underline is visible');
  await page.locator('.main-tabs button').nth(1).click();
  assert.equal(await page.locator('.page-intro .eyebrow,.page-intro p').count(), 0);
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await page.locator('.overview-heading h1').waitFor();
  assert.equal(await page.locator('.overview-heading .overview-eyebrow,.overview-heading p').count(), 0);
  await page.locator('.main-tabs button').first().click();
  // Generate clearly fictional local artwork; no personal media or remote assets.
  const images = await page.evaluate(({ titles, colors }) => titles.map((title, index) => {
    const canvas = document.createElement('canvas'); canvas.width = 480; canvas.height = 720;
    const context = canvas.getContext('2d'); const [light, dark] = colors[index];
    const gradient = context.createLinearGradient(0, 0, 300, 720); gradient.addColorStop(0, light); gradient.addColorStop(1, dark);
    context.fillStyle = gradient; context.fillRect(0, 0, 480, 720);
    const sun = context.createRadialGradient(300, 250, 0, 300, 250, 180); sun.addColorStop(0, '#f7dfab99'); sun.addColorStop(1, '#f7dfab00');
    context.fillStyle = sun; context.fillRect(0, 0, 480, 720);
    context.fillStyle = '#0b142955'; context.beginPath(); context.moveTo(0, 490);
    context.bezierCurveTo(140, 220 + index * 20, 280, 650, 480, 360); context.lineTo(480, 720); context.lineTo(0, 720); context.fill();
    context.fillStyle = '#f2ead9'; context.textAlign = 'center'; context.font = '12px sans-serif'; context.fillText('GLACIER  /  SAMPLE COLLECTION', 240, 50);
    context.font = 'bold 42px Georgia'; const words = title.toUpperCase().split(' '); const split = Math.ceil(words.length / 2);
    context.fillText(words.slice(0, split).join(' '), 240, 545, 420); context.fillText(words.slice(split).join(' '), 240, 595, 420);
    context.font = '11px sans-serif'; context.fillStyle = '#dce2e6aa'; context.fillText('FICTIONAL ARTWORK FOR INTERFACE TESTING', 240, 680);
    return canvas.toDataURL('image/png').split(',')[1];
  }), { titles, colors });
  images.forEach((image, index) => fs.writeFileSync(path.join(data, 'images', names[index]), Buffer.from(image, 'base64')));
  await page.reload(); await page.locator('.poster-card').first().waitFor();
  await page.evaluate(() => {
    globalThis.transitionCount = 0;
    const original = document.startViewTransition.bind(document);
    document.startViewTransition = (...args) => { globalThis.transitionCount++; return original(...args); };
  });
  await page.setViewportSize({ width: 1380, height: 900 });
  await page.waitForTimeout(650);
  await page.screenshot({ path: path.resolve('.cache/desktop-library.png') });
  assert.equal(await page.evaluate(() => window.library.platform), process.platform);
  const card = page.locator('.poster-open').nth(40);
  await card.scrollIntoViewIfNeeded(); const previousScroll = await page.evaluate(() => scrollY);
  const previousId = await card.locator('..').getAttribute('data-work-id');
  assert.ok(previousScroll > 500);
  await card.click(); await page.locator('.detail-view').waitFor();
  await page.waitForTimeout(160);
  await page.screenshot({ path: path.resolve('.cache/desktop-transition.png') });
  await page.waitForFunction(() => !document.documentElement.dataset.transitioning);
  assert.equal(await page.evaluate(() => scrollY), 0);
  assert.equal(await page.locator('.hero-inner').evaluate(element => getComputedStyle(element).opacity), '1', 'transition cleanup must not restart an invisible entrance fade');
  await page.screenshot({ path: path.resolve('.cache/desktop-detail.png') });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.documentElement.dataset.transitioning && !document.querySelector('.detail-view'));
  assert.ok(Math.abs(await page.evaluate(() => scrollY) - previousScroll) < 2);
  assert.equal(await page.evaluate(() => document.activeElement.closest('[data-work-id]')?.getAttribute('data-work-id')), previousId);
  assert.equal(await page.evaluate(() => globalThis.transitionCount), 2);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+f' : 'Control+f');
  await page.waitForFunction(() => document.activeElement === document.querySelector('.search-box input'));
  await page.keyboard.type('Quiet'); assert.equal(await page.locator('.poster-card').count(), 10);
  await page.locator('.search-box input').fill('');
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+,' : 'Control+,');
  await page.getByRole('dialog', { name: '设置', exact: true }).waitFor();
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.evaluate(() => Boolean(document.activeElement.closest('[role="dialog"]'))), true);
  if (process.platform === 'darwin') {
    assert.match(await page.getByRole('dialog').innerText(), /播放器/);
    assert.ok(await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.items.some(item => item.role === 'editmenu')));
  }
  await page.screenshot({ path: path.resolve('.cache/desktop-settings.png'), animations: 'disabled' });
  await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'hidden' });
  for (const width of [1000, 720, 390]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${width}px library fits`);
    await page.locator('.poster-open').first().click(); await page.locator('.detail-view').waitFor();
    await page.waitForFunction(() => !document.documentElement.dataset.transitioning);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${width}px details fit`);
    if (width === 390) await page.screenshot({ path: path.resolve('.cache/desktop-narrow.png') });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.documentElement.dataset.transitioning && !document.querySelector('.detail-view'));
  }
  await page.emulateMedia({ reducedMotion: 'reduce' }); const count = await page.evaluate(() => globalThis.transitionCount);
  await page.locator('.poster-open').first().click(); await page.locator('.detail-view').waitFor();
  await page.keyboard.press('Escape'); await page.locator('.poster-grid').waitFor();
  assert.equal(await page.evaluate(() => globalThis.transitionCount), count, 'reduced motion bypasses transitions');
  assert.deepEqual(errors, []);
  if (process.platform === 'darwin') {
    await page.close(); const nextWindow = app.waitForEvent('window');
    await app.evaluate(({ app }) => app.emit('activate')); page = await nextWindow;
    await page.locator('.brand').waitFor();
    assert.equal(await page.locator('.poster-card').count(), 80);
  }
  console.log(`Desktop UI passed (${packaged ? 'packaged' : 'development'}): 80 cards, shared poster transitions, scroll/focus restoration, shortcuts, modal focus, 390–1380px layouts, reduced motion, Dock reopen.`);
} finally { await app.close(); }
