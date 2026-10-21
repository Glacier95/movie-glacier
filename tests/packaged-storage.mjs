import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';

const install = path.resolve('release/win-unpacked');
const data = path.join(install, 'user-data');
assert.equal(fs.existsSync(data), false, 'Do not run this test over existing user data');
const env = { ...process.env, FILM_LIBRARY_SMOKE: '1' };
delete env.FILM_LIBRARY_DATA_DIR;
const launch = () => electron.launch({ executablePath: path.join(install, 'Movie Glacier.exe'), args: ['--no-sandbox', '--disable-gpu'], env });
let app;
try {
  app = await launch();
  let page = await app.firstWindow();
  await page.locator('.brand').waitFor();
  const locations = await app.evaluate(({ app }) => ['userData', 'sessionData', 'logs', 'crashDumps'].map(key => app.getPath(key)));
  assert.deepEqual(locations, [data, data, path.join(data, 'logs'), path.join(data, 'Crashpad')]);
  await page.evaluate(() => window.library.setSettings({ language: 'en', backgroundBlur: 40 }));
  await app.close();
  assert.ok(fs.existsSync(path.join(data, 'library.sqlite')));
  app = await launch(); page = await app.firstWindow();
  await page.getByRole('button', { name: 'Settings', exact: true }).waitFor();
  assert.equal((await page.evaluate(() => window.library.getSettings())).backgroundBlur, 40);
  console.log('Packaged app stores database, sessions, logs and crash data beside its executable; settings survive restart.');
} finally {
  await app?.close();
  // This test exclusively created this exact directory; never clean a preexisting profile.
  assert.equal(path.resolve(data), path.join(path.resolve('release/win-unpacked'), 'user-data'));
  fs.rmSync(data, { recursive: true, force: true });
}
