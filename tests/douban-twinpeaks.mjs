import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';
import { chooseDoubanSubject } from '../dist-electron/electron/douban-match.js';

const data = path.resolve(`.cache/douban-twinpeaks-${Date.now()}`);
fs.mkdirSync(data, { recursive: true });
const app = await electron.launch({
  executablePath: path.resolve('release/win-unpacked/Movie Glacier.exe'),
  args: ['--no-sandbox', '--disable-gpu'],
  env: { ...process.env, FILM_LIBRARY_DATA_DIR: data, FILM_LIBRARY_SMOKE: '1' }
});
try {
  const main = await app.firstWindow();
  await main.locator('.brand').waitFor();
  const windowPromise = app.waitForEvent('window');
  await main.evaluate(() => window.library.doubanLogin());
  const douban = await windowPromise;
  const twinPeaks = { mediaType: 'tv', titleZh: '双峰', titleEn: 'Twin Peaks', originalTitle: 'Twin Peaks', year: 1990 };
  const expectedIds = ['1295526', '3022764', '26088510'];
  for (const [season, numeral] of [[1, '一'], [2, '二'], [3, '三']]) {
    const query = encodeURIComponent(`双峰 第${numeral}季`);
    const response = await douban.goto(`https://movie.douban.com/subject_search?search_text=${query}&cat=1002`, { waitUntil: 'domcontentloaded' });
    await douban.locator('a[href*="movie.douban.com/subject/"]').first().waitFor({ timeout: 8000 }).catch(() => undefined);
    const links = await douban.evaluate(() => [...document.querySelectorAll('a[href*="movie.douban.com/subject/"]')]
      .map(item => ({ text: item.textContent?.trim() ?? '', href: item.href,
        context: item.closest('.item-root')?.textContent?.replace(/\s+/g, ' ').slice(0, 220) ?? '' }))
      .filter(item => item.href && item.text).slice(0, 20));
    const match = chooseDoubanSubject(twinPeaks, season, null, links);
    assert.equal(response?.status(), 200);
    assert.equal(match?.id, expectedIds[season - 1]);
    assert.ok(match.rating > 0);
    console.log(JSON.stringify({ season, id: match.id, rating: match.rating, votes: match.votes }));
  }
  const response = await douban.goto('https://movie.douban.com/subject_search?search_text=肖申克的救赎&cat=1002', { waitUntil: 'domcontentloaded' });
  await douban.locator('a[href*="movie.douban.com/subject/"]').first().waitFor({ timeout: 8000 });
  const links = await douban.evaluate(() => [...document.querySelectorAll('a[href*="movie.douban.com/subject/"]')]
    .map(item => ({ text: item.textContent?.trim() ?? '', href: item.href,
      context: item.closest('.item-root')?.textContent?.replace(/\s+/g, ' ').slice(0, 220) ?? '' }))
    .filter(item => item.href && item.text).slice(0, 20));
  const film = chooseDoubanSubject({ mediaType: 'movie', titleZh: '肖申克的救赎',
    titleEn: 'The Shawshank Redemption', originalTitle: 'The Shawshank Redemption', year: 1994 }, null, null, links);
  assert.equal(response?.status(), 200);
  assert.equal(film?.id, '1292052');
  assert.ok(film.rating > 0);
  console.log(JSON.stringify({ movie: film.id, rating: film.rating, votes: film.votes }));
} finally { await app.close(); }
