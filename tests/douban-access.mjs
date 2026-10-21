import fs from 'node:fs';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';

const data = path.resolve(`.cache/douban-probe-${Date.now()}`);
fs.mkdirSync(data, { recursive: true });
const app = await electron.launch({
  executablePath: path.resolve('release/win-unpacked/Movie Glacier.exe'),
  args: ['--no-sandbox', '--disable-gpu'],
  env: { ...process.env, FILM_LIBRARY_DATA_DIR: data, FILM_LIBRARY_SMOKE: '1' }
});
try {
  const main = await app.firstWindow();
  await main.locator('.brand').waitFor();
  const windowPromise = app.waitForEvent('window', { timeout: 15_000 });
  await main.evaluate(() => window.library.doubanLogin());
  const douban = await windowPromise;
  for (const url of ['https://movie.douban.com/top250', 'https://movie.douban.com/subject_search?search_text=肖申克的救赎&cat=1002', 'https://movie.douban.com/subject/1292052/']) {
    try {
      const response = await douban.goto(url, { timeout: 15_000, waitUntil: 'domcontentloaded' });
      if (url.includes('/subject/')) await douban.locator('strong[property="v:average"]').waitFor({ timeout: 8000 }).catch(() => undefined);
      if (url.includes('subject_search')) await douban.locator('a[href*="movie.douban.com/subject/"]').first().waitFor({ timeout: 8000 }).catch(() => undefined);
      const result = await douban.evaluate(() => ({ title: document.title,
        listed: document.querySelectorAll('ol.grid_view > li .item').length,
        subjectLinks: document.querySelectorAll('a[href*="movie.douban.com/subject/"]').length,
        rating: document.querySelector('strong[property="v:average"]')?.textContent?.trim() ?? null,
        body: document.body?.innerText.slice(0, 170) ?? '' }));
      console.log(JSON.stringify({ url, status: response?.status(), ...result }));
    } catch (error) { console.log(JSON.stringify({ url, error: String(error).slice(0, 300) })); }
  }
  const ranks = [];
  for (let start = 0; start < 250; start += 25) {
    await douban.goto(`https://movie.douban.com/top250?start=${start}`, { timeout: 15_000, waitUntil: 'domcontentloaded' });
    const page = await douban.evaluate(() => [...document.querySelectorAll('ol.grid_view > li .item')].map(item => ({
      rank: Number(item.querySelector('em')?.textContent),
      id: /\/subject\/(\d+)/.exec(item.querySelector('.hd a')?.href ?? '')?.[1]
    })));
    ranks.push(...page);
  }
  console.log(JSON.stringify({ fullTop250: ranks.length === 250 && new Set(ranks.map(item => item.id)).size === 250 && ranks.every((item, index) => item.rank === index + 1) }));
} finally { await app.close(); }
