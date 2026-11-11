import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';
import { electronExecutable } from './electron-path.mjs';
import { Store } from '../dist-electron/electron/store.js';

fs.mkdirSync('.cache', { recursive: true });
const data = fs.mkdtempSync(path.resolve('.cache/scrape-ignore-'));
const store = await Store.open(path.join(data, 'library.sqlite'), path.resolve('dist-electron/sql-wasm.wasm'), {
  isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => ''
});
const films = ['Failed fixture', 'Pending fixture', 'Editable fixture'].map((title, index) => {
  const id = store.createWork('movie', title, 2020);
  const file = path.join(data, `${title}.2020.mkv`); fs.writeFileSync(file, 'fixture');
  store.putAsset({ workId: id, root: data, path: file, kind: 'file', season: null, episode: null, size: 7, mtimeMs: 1 }, 1);
  if (!index) store.recordSourceRefresh(id, 'omdb', 'Fixture lookup failed');
  else if (index === 1) store.queueTask('tmdb', id);
  return { id, title, file };
});
store.setRoots([data]); store.close();
const packaged = process.env.FILM_LIBRARY_PACKAGED === '1';
const app = await electron.launch({ executablePath: electronExecutable(packaged), args: packaged ? [] : ['.'],
  env: { ...process.env, FILM_LIBRARY_SMOKE: '1', FILM_LIBRARY_DATA_DIR: data } });
try {
  const page = await app.firstWindow(); page.setDefaultTimeout(15000);
  const errors = []; page.on('pageerror', error => errors.push(String(error)));
  await page.locator('.poster-card').first().waitFor();
  await page.getByRole('banner').getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '抓取日志', exact: true }).click();
  const logs = page.getByRole('dialog', { name: '抓取日志', exact: true });
  const failed = logs.locator('.log-entry').filter({ hasText: films[0].title });
  await failed.getByRole('button', { name: '忽略此资源', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: '忽略此资源', exact: true });
  await confirmation.waitFor();
  assert.match(await confirmation.innerText(), /原始文件不会删除/);
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.evaluate(() => Boolean(document.activeElement.closest('.ignore-modal'))), true);
  await page.screenshot({ path: path.resolve('.cache/scrape-ignore-confirm.png'), animations: 'disabled' });
  await page.keyboard.press('Escape');
  await confirmation.waitFor({ state: 'hidden' });
  assert.equal(await failed.count(), 1, 'cancel leaves the resource and parent dialog intact');
  await failed.getByRole('button', { name: '忽略此资源', exact: true }).click();
  await confirmation.getByRole('button', { name: '确认忽略', exact: true }).click();
  await failed.waitFor({ state: 'hidden' });
  assert.equal(fs.readFileSync(films[0].file, 'utf8'), 'fixture');
  const pending = logs.locator('.log-entry').filter({ hasText: films[1].title });
  await pending.getByRole('button', { name: '忽略此资源', exact: true }).click();
  await confirmation.getByRole('button', { name: '确认忽略', exact: true }).click();
  await pending.waitFor({ state: 'hidden' });
  await logs.getByRole('button', { name: '关闭', exact: true }).click();
  const settings = page.getByRole('dialog', { name: '设置', exact: true });
  await settings.locator('.ignored-list>div').first().waitFor();
  assert.equal(await settings.locator('.ignored-list>div').count(), 2, 'ignored resources update underneath the log panel');
  await settings.locator('.ignored-list>div').filter({ hasText: films[0].title }).getByRole('button', { name: '恢复', exact: true }).click();
  await settings.getByRole('button', { name: '取消', exact: true }).click();
  await page.locator('.poster-card').filter({ hasText: films[2].title }).locator('.poster-open').click();
  await page.getByRole('button', { name: '编辑资料', exact: true }).click();
  await page.getByRole('dialog', { name: '编辑资料', exact: true }).getByRole('button', { name: '忽略此资源', exact: true }).click();
  await confirmation.getByRole('button', { name: '取消', exact: true }).click();
  assert.equal(await page.getByRole('dialog', { name: '编辑资料', exact: true }).count(), 1);
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.library.setSettings({ language: 'en' }));
  await page.getByRole('button', { name: 'Edit details', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Ignore this title', exact: true }).click();
  const english = page.getByRole('dialog', { name: 'Ignore this title', exact: true });
  assert.doesNotMatch(await english.innerText(), /[\u3400-\u9fff]/);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await english.getByRole('button', { name: 'Ignore title', exact: true }).click();
  await page.locator('.ignore-modal').waitFor({ state: 'hidden' });
  const works = await page.evaluate(() => window.library.listWorks());
  assert.deepEqual(works.map(work => work.id), [films[0].id]);
  assert.deepEqual(errors, []);
  console.log(`Scrape ignore passed (${packaged ? 'packaged' : 'development'}): failed/pending, cancel, focus, restore, edit reuse, English, narrow layout and intact media.`);
} finally { await app.close(); }
