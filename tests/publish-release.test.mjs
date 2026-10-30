import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { planRelease, publishRelease } from '../scripts/publish-release.mjs';

const sha = 'a'.repeat(40);

function fixture(t, { version = '0.7.0', release = null, reference = null, uploadError = false } = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'movie-glacier-publish-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const names = [`Movie.Glacier.Setup.${version}.exe`, ...['arm64', 'x64'].flatMap(arch =>
    ['dmg', 'zip'].map(ext => `Movie.Glacier-${version}-mac-${arch}.${ext}`))];
  for (const name of names) fs.writeFileSync(path.join(directory, name), 'installer fixture');
  const writes = [];
  const state = { release: release ? { tag_name: `v${version}`, ...release } : null, reference };
  const api = async (method, route, body) => {
    if (method === 'GET') {
      if (route.startsWith('/releases/tags/')) return state.release?.draft ? null : state.release;
      if (route.startsWith('/releases?')) return state.release ? [state.release] : [];
      if (route.startsWith('/git/ref/tags/')) return state.reference;
      if (route === '/git/tags/annotated') return { object: { type: 'commit', sha } };
    }
    writes.push({ method, route, body });
    if (method === 'POST' && route === '/git/refs') {
      state.reference = { object: { type: 'commit', sha: body.sha } }; return state.reference;
    }
    if (method === 'POST' && route === '/releases') {
      state.release = { id: 12, ...body }; return state.release;
    }
    if (method === 'PATCH' && route === '/releases/12') {
      state.release = { ...state.release, ...body }; return state.release;
    }
    throw new Error(`Unexpected API request: ${method} ${route}`);
  };
  const upload = async (tag, files) => {
    assert.equal(state.release.draft, true, 'uploads must finish before publication');
    assert.equal(state.reference.object.sha, sha, 'the tag must identify the exact built commit');
    assert.equal(files.length, 6);
    assert.ok(files.some(file => path.basename(file) === 'SHA256SUMS.txt'));
    writes.push({ method: 'UPLOAD', tag });
    if (uploadError) throw new Error('Upload interrupted');
  };
  return { version, sha, directory, api, upload, writes, state };
}

test('a new main-branch version tags the built commit and publishes only after complete uploads', async t => {
  const f = fixture(t);
  const result = await publishRelease(f);
  assert.equal(result.release.draft, false);
  assert.equal(result.tag, 'v0.7.0');
  assert.deepEqual(f.writes.map(item => item.method), ['POST', 'POST', 'UPLOAD', 'PATCH']);
  assert.deepEqual(f.writes[0].body, { ref: 'refs/tags/v0.7.0', sha });
  assert.equal(f.writes[1].body.target_commitish, sha);
});

test('subsequent commits with an already published version do not mutate tags or release assets', async t => {
  const f = fixture(t, { release: { id: 12, draft: false }, reference: { object: { type: 'commit', sha: 'b'.repeat(40) } } });
  const result = await publishRelease(f);
  assert.equal(result.publish, false);
  assert.deepEqual(f.writes, []);
});

test('a failed upload leaves a draft that a retry of the same commit can complete', async t => {
  const f = fixture(t, { uploadError: true });
  await assert.rejects(publishRelease(f), /Upload interrupted/);
  assert.equal(f.state.release.draft, true);
  assert.equal(f.writes.some(item => item.method === 'PATCH'), false);
  f.writes.length = 0;
  await publishRelease({ ...f, upload: async () => f.writes.push({ method: 'UPLOAD' }) });
  assert.deepEqual(f.writes.map(item => item.method), ['UPLOAD', 'PATCH']);
  assert.equal(f.state.release.draft, false);
});

test('an existing tag for another commit is never moved or used for different binaries', async t => {
  const f = fixture(t, { reference: { object: { type: 'commit', sha: 'b'.repeat(40) } } });
  await assert.rejects(publishRelease(f), /points to another commit/);
  assert.deepEqual(f.writes, []);
});

test('annotated tags resolving to the built commit can be reused', async t => {
  const f = fixture(t, { reference: { object: { type: 'tag', sha: 'annotated' } } });
  assert.equal((await planRelease(f)).publish, true);
  assert.deepEqual(f.writes, []);
});

test('missing installers are rejected before a tag or release draft is created', async t => {
  const f = fixture(t);
  fs.unlinkSync(path.join(f.directory, 'Movie.Glacier-0.7.0-mac-x64.dmg'));
  await assert.rejects(publishRelease(f), /Missing or empty release installer/);
  assert.deepEqual(f.writes, []);
});

test('prerelease versions are marked as prereleases', async t => {
  const f = fixture(t, { version: '0.8.0-rc.1' });
  const result = await publishRelease(f);
  assert.equal(result.release.prerelease, true);
  assert.equal(result.tag, 'v0.8.0-rc.1');
});

test('a draft without a tag cannot be adopted from another commit', async t => {
  const f = fixture(t, { release: { id: 12, draft: true, target_commitish: 'b'.repeat(40) } });
  await assert.rejects(publishRelease(f), /draft targets another commit/);
  assert.deepEqual(f.writes, []);
});

test('draft discovery follows pagination when the published-tag endpoint returns no release', async () => {
  const requests = [];
  const draft = { id: 12, tag_name: 'v0.7.0', draft: true, target_commitish: sha };
  const api = async (method, route) => {
    assert.equal(method, 'GET');
    requests.push(route);
    if (route.startsWith('/releases/tags/')) return null;
    if (route.endsWith('page=1')) return Array.from({ length: 100 }, (_, i) => ({ tag_name: `v1.0.${i}` }));
    if (route.endsWith('page=2')) return [draft];
    if (route.startsWith('/git/ref/tags/')) return { object: { type: 'commit', sha } };
    throw new Error(`Unexpected API request: ${route}`);
  };
  const plan = await planRelease({ version: '0.7.0', sha, api });
  assert.equal(plan.release.id, 12);
  assert.equal(plan.publish, true);
  assert.ok(requests.includes('/releases?per_page=100&page=2'));
});
