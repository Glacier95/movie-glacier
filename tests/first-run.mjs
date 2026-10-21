import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';

const data = path.resolve(`.cache/first-run-${Date.now()}`);
fs.mkdirSync(data, { recursive: true });
const app = await electron.launch({
  executablePath: process.env.FILM_LIBRARY_PACKAGED === '1'
    ? path.resolve('release/win-unpacked/Movie Glacier.exe')
    : path.resolve('node_modules/electron/dist/electron.exe'),
  args: process.env.FILM_LIBRARY_PACKAGED === '1' ? ['--no-sandbox', '--disable-gpu'] : ['--no-sandbox', '--disable-gpu', '.'],
  env: { ...process.env, FILM_LIBRARY_DATA_DIR: data, FILM_LIBRARY_TEST_ONBOARDING: '1' }
});
try {
  const page = await app.firstWindow();
  const dialog = page.getByRole('dialog', { name: '首次配置' });
  await dialog.waitFor({ timeout: 20_000 });
  assert.match(await dialog.innerText(), /TMDB.*OMDb.*豆瓣/s);
  assert.equal(await page.title(), 'Movie Glacier');
  await page.screenshot({ path: path.resolve('.cache/first-run.png') });
  await dialog.getByRole('button', { name: '完成设置并开始扫描' }).click();
  assert.match(await page.getByRole('alert').innerText(), /首次使用请先选择影视目录/);
  await page.evaluate(async root => window.library.setSettings({ roots: [root], tmdbKey: 'test-token', omdbKey: 'test-key' }), data);
  await page.reload();
  await page.locator('.brand').waitFor();
  assert.equal(await page.getByRole('dialog', { name: '首次配置' }).count(), 0);
  await page.getByRole('banner').getByRole('button', { name: '设置' }).click();
  const settings = page.getByRole('dialog', { name: '设置' });
  assert.match(await settings.innerText(), /TMDB.*已加密保存.*OMDb.*已加密保存/s);
  assert.equal(await settings.getByPlaceholder('已保存；留空保持原值，输入新令牌可更换').inputValue(), '');
  assert.equal(await page.evaluate(() => window.library.getSettings().then(item => item.hasTmdbKey && item.hasOmdbKey)), true);
  console.log('First-run setup gate and source tutorials passed.');
} finally { await app.close(); }
