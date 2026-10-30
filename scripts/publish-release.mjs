import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeReleaseChecksums } from './release-artifacts.mjs';

export async function planRelease({ version, sha, api }) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error('package.json must contain a semantic application version.');
  }
  const tag = `v${version}`;
  let release = await api('GET', `/releases/tags/${encodeURIComponent(tag)}`);
  // The tag endpoint only returns published releases; find retryable drafts separately.
  for (let page = 1; !release; page++) {
    const releases = await api('GET', `/releases?per_page=100&page=${page}`);
    if (!Array.isArray(releases)) throw new Error('Could not list existing release drafts.');
    release = releases.find(item => item.tag_name === tag) || null;
    if (releases.length < 100) break;
  }
  // Later commits with the same application version must not replace shipped binaries.
  if (release && !release.draft) return { tag, release, publish: false };
  const reference = await api('GET', `/git/ref/tags/${encodeURIComponent(tag)}`);
  let object = reference?.object;
  for (let depth = 0; object?.type === 'tag' && depth < 10; depth++) {
    object = (await api('GET', `/git/tags/${object.sha}`))?.object;
  }
  if (reference && (object?.type !== 'commit' || object.sha !== sha)) {
    throw new Error(`${tag} points to another commit. Rerun its original workflow or use a new application version.`);
  }
  if (!reference && release && release.target_commitish !== sha) {
    throw new Error(`The ${tag} draft targets another commit. Resolve the draft before publishing.`);
  }
  return { tag, release, publish: true, tagExists: Boolean(reference) };
}

export async function publishRelease({ version, sha, api, upload, directory }) {
  const plan = await planRelease({ version, sha, api });
  if (!plan.publish) return plan;
  // Validate all three platforms before creating a tag or changing a draft.
  const files = await writeReleaseChecksums(directory, version);
  if (!plan.tagExists) await api('POST', '/git/refs', { ref: `refs/tags/${plan.tag}`, sha });
  const prerelease = version.split('+')[0].includes('-');
  const release = plan.release || await api('POST', '/releases', {
    tag_name: plan.tag, target_commitish: sha, name: `Movie Glacier ${plan.tag}`,
    draft: true, prerelease, generate_release_notes: true
  });
  await upload(plan.tag, [...files, 'SHA256SUMS.txt'].map(name => path.join(directory, name)));
  const published = await api('PATCH', `/releases/${release.id}`, { draft: false, prerelease });
  return { ...plan, release: published };
}

async function main() {
  const command = process.argv[2];
  if (!['plan', 'publish'].includes(command)) throw new Error('Usage: node scripts/publish-release.mjs <plan|publish>');
  if (process.env.GITHUB_REF !== 'refs/heads/main' || !['push', 'workflow_dispatch'].includes(process.env.GITHUB_EVENT_NAME)) {
    throw new Error('Release publication is only available for main-branch pushes and manual main-branch runs.');
  }
  const repository = process.env.GITHUB_REPOSITORY;
  const sha = process.env.GITHUB_SHA;
  const token = process.env.GH_TOKEN;
  if (!repository || !sha || !token) throw new Error('GitHub repository, commit and authentication are required.');
  const { version } = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const api = async (method, route, body) => {
    const response = await fetch(`${process.env.GITHUB_API_URL || 'https://api.github.com'}/repos/${repository}${route}`, {
      method, signal: AbortSignal.timeout(30000),
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    if (method === 'GET' && response.status === 404) return null;
    if (!response.ok) throw new Error(`GitHub ${method} ${route} failed: HTTP ${response.status}`);
    return response.json();
  };
  const options = { version, sha, api };
  const result = command === 'plan' ? await planRelease(options) : await publishRelease({
    ...options, directory: path.resolve('release'),
    upload: (tag, files) => execFileSync('gh', ['release', 'upload', tag, ...files, '--repo', repository, '--clobber'], { stdio: 'inherit' })
  });
  if (command === 'plan' && process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `publish=${result.publish}\ntag=${result.tag}\n`);
  }
  console.log(result.publish ? `${result.tag}: ${result.release?.html_url || 'ready to publish'}` : `${result.tag} is already published; leaving it unchanged.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
