import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';
import { Store } from '../dist-electron/electron/store.js';

fs.mkdirSync('.cache', { recursive: true });
const data = fs.mkdtempSync(path.resolve('.cache/overview-'));
const media = path.join(data, 'media'); fs.mkdirSync(media); fs.mkdirSync(path.join(data, 'images'));
const store = await Store.open(path.join(data, 'library.sqlite'), path.resolve('dist-electron/sql-wasm.wasm'), {
  isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => ''
});
const titles = ['Solaris', 'Mirror', 'Stalker', 'Arrival', 'Dune', 'Inception', 'The Grand Budapest Hotel', 'Fargo', 'Parasite', 'Moonlight', 'Perfect Days', 'The Tree of Life'];
for (let i = 0; i < 36; i++) {
  const title = `${titles[i % titles.length]} ${i + 1}`, year = 1970 + (i % 12) * 4;
  const id = store.createWork(i < 30 ? 'movie' : 'tv', title, year);
  fs.copyFileSync(path.resolve('build/icon.png'), path.join(data, 'images', `${String(i).padStart(40, '0')}.png`));
  store.setWorkFields(id, { titleEn: title, genres: [i % 2 ? 'Drama' : 'Science Fiction', i % 3 ? 'Thriller' : 'Adventure'], countries: [['US', 'France'], ['Japan'], ['Germany'], ['United Kingdom']][i % 4],
    directors: [{ id: `director:${i % 12}`, name: `Director ${i % 12}` }], actors: [{ id: `actor:${i % 14}`, name: `Actor ${i % 14}` }],
    year, ratingDouban: i % 7 === 0 ? null : 5 + (i % 11) * .4, ratingImdb: i % 9 === 0 ? null : 4 + (i % 12) * .5, topRank: i % 3 ? null : i + 1, poster: `${String(i).padStart(40, '0')}.png`, matchState: 'matched' });
  const file = path.join(media, `${i}.mkv`); fs.writeFileSync(file, 'fixture');
  store.putAsset({ workId: id, root: media, path: file, kind: 'file', season: null, episode: null, size: 100, mtimeMs: 1 }, Date.now());
}
store.setRoots([media]); store.setSetting('backgroundBlur', '110'); store.close();
let app;
try {
  const packaged = process.env.FILM_LIBRARY_PACKAGED === '1';
  app = await electron.launch({ executablePath: path.resolve(packaged ? 'release/win-unpacked/Movie Glacier.exe' : 'node_modules/electron/dist/electron.exe'), args: packaged ? ['--no-sandbox', '--disable-gpu'] : ['--no-sandbox', '--disable-gpu', '.'], env: { ...process.env, FILM_LIBRARY_DATA_DIR: data, FILM_LIBRARY_SMOKE: '1' } });
  const page = await app.firstWindow(); page.setDefaultTimeout(15_000);
  const errors = []; page.on('pageerror', e => errors.push(String(e)));
  await page.locator('.poster-card').first().waitFor();
  assert.equal(await page.locator('.app-version').innerText(), `v${JSON.parse(fs.readFileSync('package.json')).version}`);
  assert.equal(await page.getByRole('banner').getByRole('button', { name: /更新库|抓取日志/ }).count(), 0);
  assert.equal(await page.locator('.poster-rank').count(), 0);
  await page.getByRole('button', { name: /排序：/ }).click();
  assert.match(await page.getByRole('listbox').evaluate(el => getComputedStyle(el).backgroundImage), /0\.33/);
  await page.screenshot({ path: path.resolve('.cache/overview-sort.png'), animations: 'disabled' });
  await page.keyboard.press('Escape');
  assert.equal((await page.evaluate(() => window.library.getSettings())).backgroundBlur, 50, 'legacy blur clamps to new range');
  await page.getByRole('banner').getByRole('button', { name: '设置', exact: true }).click();
  assert.deepEqual(await page.locator('.settings-quick-actions button').allTextContents(), ['抓取日志', '更新库']);
  const slider = page.getByRole('slider', { name: '背景模糊程度' });
  assert.equal(await slider.getAttribute('max'), '50'); assert.equal(await slider.getAttribute('step'), '1');
  await slider.focus(); await page.keyboard.press('Home'); await page.keyboard.press('ArrowRight');
  assert.equal(await slider.inputValue(), '1');
  await page.getByRole('button', { name: '保存设置', exact: true }).click();
  assert.equal((await page.evaluate(() => window.library.getSettings())).backgroundBlur, 1);
  await assert.rejects(page.evaluate(() => window.library.setSettings({ backgroundBlur: -1 })));
  await assert.rejects(page.evaluate(() => window.library.setSettings({ backgroundBlur: 1.5 })));
  await page.getByRole('button', { name: '查看《Solaris 1》详情', exact: true }).click();
  assert.match(await page.locator('.hero-ratings').innerText(), /豆瓣.*IMDb.*Top250/s);
  assert.equal(await page.locator('.auxiliary-tags .top-badge').count(), 0);
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await page.locator('.overview-chart svg').first().waitFor();
  assert.equal(await page.locator('.overview-chart svg').count(), 7);
  assert.equal(await page.locator('.overview-metric strong').first().innerText(), '36');
  await page.waitForFunction(() => [...document.querySelectorAll('.mosaic-tile img')].every(img => img.complete && img.naturalWidth > 0));
  assert.ok(await page.locator('.mosaic-tile').count() < 80, 'poster DOM stays bounded');
  const transform = await page.locator('.mosaic-track').first().evaluate(el => getComputedStyle(el).transform);
  await page.waitForTimeout(200);
  assert.notEqual(await page.locator('.mosaic-track').first().evaluate(el => getComputedStyle(el).transform), transform);
  assert.equal(await page.getByRole('button', { name: '暂停背景', exact: true }).count(), 0);
  assert.doesNotMatch(await page.locator('.overview-page').innerText(), /点击图表探索作品|从类型到年代|收藏的每一面|我的收藏/);
  assert.equal(await page.locator('.overview-metric').count(), 4);
  const boxes = await Promise.all(['genres', 'chord', 'years', 'countries', 'ratings', 'directors', 'actors'].map(key => page.locator(`.panel-${key}`).boundingBox()));
  const [genres, chord, years, countries, ratings, directors, actors] = boxes;
  assert.ok(Math.abs(genres.y - chord.y) < 2 && Math.abs(years.y - countries.y) < 2, 'first two rows have two half-width cards');
  assert.ok(Math.abs(ratings.y - directors.y) < 2 && Math.abs(directors.y - actors.y) < 2, 'third row contains ratings and both people cards');
  assert.ok(Math.abs(directors.width - actors.width) < 2 && Math.abs(ratings.width - directors.width * 2 - 20) < 2, 'people each occupy one quarter');
  assert.equal(await page.locator('.panel-chord .panel-index').innerText(), '02');
  assert.equal(await page.locator('.panel-directors h2').innerText(), '导演 · Top 10');
  assert.equal(await page.locator('.panel-actors h2').innerText(), '演员 · Top 10');
  assert.equal(await page.locator('.panel-directors .chart-data button').count(), 10);
  assert.equal(await page.locator('.panel-actors .chart-data button').count(), 10);
  assert.deepEqual(await page.locator('.overview-chart').evaluateAll(nodes => nodes.map(el => el.dataset.chartKind)), ['pie', 'chord', 'years', 'bubbles', 'ratings', 'people', 'people']);
  const layoutSize = () => page.evaluate(() => ({
    page: document.documentElement.scrollHeight,
    panels: [...document.querySelectorAll('.overview-panel')].map(el => Math.round(el.getBoundingClientRect().height)),
    charts: [...document.querySelectorAll('.overview-chart')].map(el => Math.round(el.getBoundingClientRect().height))
  }));
  await page.waitForTimeout(200);
  const closedLayout = await layoutSize();
  for (const name of ['ratings', 'directors', 'actors', 'genres', 'chord', 'years', 'countries']) {
    const details = page.locator(`.panel-${name} details`);
    for (let cycle = 0; cycle < 3; cycle++) {
      await details.locator('summary').click();
      await page.waitForTimeout(150);
      assert.equal(await details.getAttribute('open'), '');
      assert.deepEqual((await layoutSize()).charts, closedLayout.charts, `${name}: details must not resize any chart`);
      await details.locator('summary').click();
      await page.waitForTimeout(150);
      const collapsed = await layoutSize();
      assert.ok(Math.abs(collapsed.page - closedLayout.page) <= 2,
        `${name} cycle ${cycle + 1}: closing details must restore page height (${closedLayout.page} -> ${collapsed.page})`);
      assert.deepEqual(collapsed.panels, closedLayout.panels, `${name}: cards must shrink back after collapse`);
      assert.deepEqual(collapsed.charts, closedLayout.charts, `${name}: opening details must not stretch charts`);
    }
  }
  assert.equal(await page.locator('.chart-map,.map-footer').count(), 0);
  assert.ok(await page.locator('.panel-chord svg path').count() > 6, 'native chord renders arcs and ribbons');
  await page.locator('.panel-chord svg path[fill="#9dc9ff"][fill-opacity="0.28"]').first().click({ force: true });
  await page.getByRole('dialog').waitFor();
  assert.match(await page.getByRole('dialog').getAttribute('aria-label'), /×/);
  const selectedLabel = await page.getByRole('dialog').getAttribute('aria-label');
  const allWorks = await page.evaluate(() => window.library.listWorks());
  const [source, target] = selectedLabel.split(' × ');
  const expected = allWorks.filter(work => work.genres.includes(source) && work.genres.includes(target));
  assert.equal(await page.locator('.overview-titles>div').count(), expected.length, 'ribbon opens exactly the shared titles');
  await page.keyboard.press('Escape');
  await page.locator('.panel-countries svg path[fill="#9dc9ff"]').first().click({ force: true });
  await page.getByRole('dialog').waitFor();
  assert.ok(await page.locator('.overview-titles>div').count() > 0, 'bubble opens region titles');
  await page.keyboard.press('Escape');
  const continuity = await page.evaluate(async () => {
    const samples = new Map(); const issues = []; const initial = new Set(document.querySelectorAll('.mosaic-tile img')); let time = 0;
    const observer = new MutationObserver(records => {
      for (const record of records) if (record.type === 'attributes' && record.attributeName === 'src' && record.oldValue && record.oldValue !== record.target.getAttribute('src')) issues.push('image source replaced');
    }); observer.observe(document.querySelector('.mosaic-grid'), { subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['src'] });
    await new Promise(resolve => {
      const start = performance.now();
      function sample(now) {
        for (const img of document.querySelectorAll('.mosaic-tile img')) {
          const box = img.getBoundingClientRect(); const old = samples.get(img);
          if (old && time && now - time < 180 && box.bottom > 0 && box.top < innerHeight && Math.abs(box.top - old.top) > 12) issues.push('visible image jumped');
          if (!old && now - start > 500 && box.bottom > 0 && box.top < innerHeight) issues.push('new image inserted onscreen');
          samples.set(img, { top: box.top });
        }
        time = now;
        if (now - start < 15_500) requestAnimationFrame(sample); else resolve();
      } requestAnimationFrame(sample);
    }); observer.disconnect();
    return { issues, recycled: [...document.querySelectorAll('.mosaic-tile img')].filter(img => !initial.has(img)).length, preserved: [...document.querySelectorAll('.mosaic-tile img')].some(img => initial.has(img)) };
  });
  assert.deepEqual(continuity.issues, [], 'row recycling preserves visible image positions and sources');
  assert.equal(continuity.preserved, true);
  assert.ok(continuity.recycled > 0, 'test crosses a real offscreen row recycling boundary');
  await page.mouse.move(10, 10);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.resolve('.cache/overview-desktop.png'), fullPage: true });
  await page.locator('.panel-genres svg path[fill="#9dc9ff"]').first().click();
  await page.getByRole('dialog').waitFor();
  await page.keyboard.press('Escape');
  await page.locator('.panel-genres summary').click();
  await page.locator('.panel-genres .chart-data button').first().click();
  await page.getByRole('dialog').waitFor(); assert.ok(await page.locator('.overview-titles>div').count() > 0);
  await page.keyboard.press('Escape');
  await page.locator('.overview-scopes').getByRole('button', { name: 'Series', exact: true }).click();
  assert.equal(await page.locator('.overview-metric strong').first().innerText(), '6');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  const mobileClosedLayout = await layoutSize();
  for (const name of ['ratings', 'directors', 'actors']) {
    const summary = page.locator(`.panel-${name} summary`);
    for (let cycle = 0; cycle < 3; cycle++) {
      await summary.click();
      await page.waitForTimeout(100);
      await summary.click();
      await page.waitForTimeout(100);
      const collapsed = await layoutSize();
      assert.ok(Math.abs(collapsed.page - mobileClosedLayout.page) <= 2, `${name}: mobile height must restore after collapse`);
      assert.deepEqual(collapsed.charts, mobileClosedLayout.charts);
    }
  }
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'mobile viewport has no horizontal overflow');
  await page.waitForTimeout(700);
  assert.equal(await page.locator('.chart-bubbles').evaluate(container => {
    const bounds = container.getBoundingClientRect();
    return [...container.querySelectorAll('svg path[fill]')].filter(el => /^#/.test(el.getAttribute('fill'))).every(el => {
      const b = el.getBoundingClientRect();
      return b.left >= bounds.left - 1 && b.right <= bounds.right + 1 && b.top >= bounds.top - 1 && b.bottom <= bounds.bottom + 1;
    });
  }), true, 'all region bubbles remain inside the chart after resizing');
  await page.screenshot({ path: path.resolve('.cache/overview-mobile.png'), fullPage: true });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const still = await page.locator('.mosaic-track').first().getAttribute('style');
  await page.waitForTimeout(250);
  assert.equal(await page.locator('.mosaic-track').first().getAttribute('style'), still, 'reduced motion stops RAF movement');
  await page.evaluate(() => window.library.setSettings({ language: 'en' }));
  await page.getByRole('button', { name: 'All titles', exact: true }).waitFor();
  assert.doesNotMatch(await page.locator('.overview-page').innerText(), /[\u3400-\u9fff]/);
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.getByRole('banner').getByRole('button', { name: 'Settings', exact: true }).click();
  assert.match(await page.locator('.settings-modal').evaluate(el => getComputedStyle(el).backgroundImage), /0\.13/);
  await page.screenshot({ path: path.resolve('.cache/overview-settings.png') });
  await page.getByRole('button', { name: 'Activity log', exact: true }).click();
  await page.screenshot({ path: path.resolve('.cache/overview-logs.png') });
  await page.getByRole('dialog', { name: 'Activity log' }).getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.evaluate(() => window.library.setSettings({ roots: [] }));
  await page.getByRole('button', { name: 'All titles', exact: true }).click();
  await page.locator('.overview-empty').waitFor();
  assert.equal(await page.locator('.overview-metric strong').first().innerText(), '0');
  assert.equal(await page.locator('.overview-chart svg').count(), 0);
  assert.deepEqual(errors, []);
  console.log('Overview UI passed: Top 10 directors and cast, 30 desktop/mobile expand-collapse cycles without height growth, charts, scope, drilldown, motion, empty library and translations.');
} finally { await app?.close(); }
