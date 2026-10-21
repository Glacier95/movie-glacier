import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { prepareDataDirectory } from '../dist-electron/electron/data-directory.js';

test('migration preserves settings, key material, artwork and sessions without overwriting an existing library', () => {
  const root = fs.mkdtempSync(path.resolve('.cache/data-migration-'));
  const old = path.join(root, 'legacy'), target = path.join(root, 'install', 'user-data');
  for (const name of ['library.sqlite', 'Local State', 'images/poster.jpg', 'Partitions/douban/Network/Cookies', 'Local Storage/leveldb/000001.log']) {
    fs.mkdirSync(path.dirname(path.join(old, name)), { recursive: true });
    fs.writeFileSync(path.join(old, name), name);
  }
  prepareDataDirectory(target, [path.join(root, 'missing'), old]);
  for (const name of ['library.sqlite', 'Local State', 'images/poster.jpg', 'Partitions/douban/Network/Cookies', 'Local Storage/leveldb/000001.log']) {
    assert.equal(fs.readFileSync(path.join(target, name), 'utf8'), name);
    assert.ok(fs.existsSync(path.join(old, name)), 'legacy backup is retained');
  }
  fs.writeFileSync(path.join(target, 'library.sqlite'), 'newer library');
  prepareDataDirectory(target, [old]);
  assert.equal(fs.readFileSync(path.join(target, 'library.sqlite'), 'utf8'), 'newer library');
  assert.equal(fs.existsSync(path.join(target, '.migration-staging')), false);
});

test('interrupted copy is retried and an unwritable target is never silently replaced by AppData', () => {
  const root = fs.mkdtempSync(path.resolve('.cache/data-retry-'));
  const old = path.join(root, 'legacy'), target = path.join(root, 'user-data');
  fs.mkdirSync(old);
  fs.writeFileSync(path.join(old, 'library.sqlite'), 'complete');
  fs.mkdirSync(path.join(target, '.migration-staging'), { recursive: true });
  fs.writeFileSync(path.join(target, '.migration-staging', 'library.sqlite'), 'partial');
  prepareDataDirectory(target, [old]);
  assert.equal(fs.readFileSync(path.join(target, 'library.sqlite'), 'utf8'), 'complete');
  const invalid = path.join(root, 'file');
  fs.writeFileSync(invalid, 'not a directory');
  assert.throws(() => prepareDataDirectory(invalid, [old]));
});
