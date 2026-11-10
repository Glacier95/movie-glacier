import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../dist-electron/electron/store.js';

function fixture(t) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'movie-glacier-recovery-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(folder)), path.resolve(os.tmpdir()));
    fs.rmSync(folder, { recursive: true, force: true });
  });
  const file = path.join(folder, 'library.sqlite');
  const open = () => Store.open(file, path.resolve('dist-electron/sql-wasm.wasm'), {
    isEncryptionAvailable: () => false, encryptString: () => Buffer.alloc(0), decryptString: () => ''
  });
  return { folder, file, open };
}

test('an invalid main database falls back to a valid snapshot and preserves the original', async t => {
  const { folder, file, open } = fixture(t);
  const store = await open();
  store.setRoots(['example-media']);
  store.setSetting('language', 'en');
  store.createWork('movie', 'Fixture title', 2005);
  store.close();
  const damage = Buffer.alloc(1024);
  fs.writeFileSync(file, damage);
  fs.writeFileSync(file + '.tmp', 'incomplete');
  const restored = await open();
  assert.equal(restored.recoveredFrom, 'library.sqlite.bak');
  assert.deepEqual(restored.roots(), ['example-media']);
  assert.equal(restored.getSetting('language'), 'en');
  assert.equal(restored.one('SELECT titleZh FROM works').titleZh, 'Fixture title');
  restored.close();
  const original = fs.readdirSync(folder).find(name => name.startsWith('library.sqlite.corrupt-'));
  assert.deepEqual(fs.readFileSync(path.join(folder, original)), damage);
  const reopened = await open();
  assert.equal(reopened.recoveredFrom, null);
  reopened.close();
});

test('a valid main database wins over a stale temp, but a complete temp can recover an interrupted write', async t => {
  const { file, open } = fixture(t);
  const store = await open();
  store.setSetting('test', 'old');
  store.close();
  const old = fs.readFileSync(file);
  const newer = await open();
  newer.setSetting('test', 'new');
  newer.close();
  fs.writeFileSync(file + '.tmp', old);
  const healthy = await open();
  assert.equal(healthy.getSetting('test'), 'new');
  assert.equal(healthy.recoveredFrom, null);
  healthy.close();
  fs.copyFileSync(file, file + '.tmp');
  fs.unlinkSync(file + '.bak');
  fs.writeFileSync(file, old.subarray(0, 100));
  const restored = await open();
  assert.equal(restored.recoveredFrom, 'library.sqlite.tmp');
  assert.equal(restored.getSetting('test'), 'new');
  restored.close();
});

test('unrecoverable damage is reported without silently creating an empty library', async t => {
  const { file, open } = fixture(t);
  fs.writeFileSync(file, Buffer.alloc(0));
  fs.writeFileSync(file + '.bak', 'broken backup');
  await assert.rejects(open(), /no usable local backup/);
  assert.equal(fs.statSync(file).size, 0);
  assert.equal(fs.readFileSync(file + '.bak', 'utf8'), 'broken backup');
});
