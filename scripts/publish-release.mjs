import { appendFile, lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../', import.meta.url)));
const REPOSITORY = 'simfonyy/aureon';
const API = `https://api.github.com/repos/${REPOSITORY}`;
const ARTIFACTS = { windows: 'Aureon-Windows-x64', linux: 'Aureon-Linux-x64' };
const MAX_ASSET = 256 * 1024 * 1024;
const fail = message => { throw new Error(message); };
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }).trim();

function versionFiles(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) fail('Version must be a stable X.Y.Z release.');
  return {
    windows: [`Aureon_${version}_x64_ru-RU.msi`, `Aureon_${version}_windows-x64_portable.zip`],
    linux: [`Aureon_${version}_amd64.deb`, `Aureon_${version}_amd64.AppImage`],
  };
}

function publicationOnly(path) {
  return path === 'README.md' || path === 'CHANGELOG.md' || path.startsWith('docs/')
    || path === '.github/workflows/publish-release.yml' || path === 'scripts/publish-release.mjs';
}

function sourceVersions(sha) {
  const json = path => JSON.parse(git('show', `${sha}:${path}`));
  const cargo = git('show', `${sha}:src-tauri/Cargo.toml`).split(/^\[/m).find(section => section.startsWith('package]'));
  const rust = cargo && /^version\s*=\s*"([^"]+)"/m.exec(cargo)?.[1];
  return [json('package.json').version, json('src-tauri/tauri.conf.json').version, rust];
}

async function api(path, { method = 'GET', body, optional = false, upload = false, size } = {}) {
  const token = process.env.GH_TOKEN;
  if (!token) fail('GitHub token is unavailable.');
  const url = upload ? path : API + path;
  if (upload) {
    const parsed = new URL(url);
    if (parsed.origin !== 'https://uploads.github.com' || !parsed.pathname.startsWith(`/repos/${REPOSITORY}/releases/`)) {
      fail('Unexpected release upload host.');
    }
  }
  const response = await fetch(url, {
    method, redirect: 'error', signal: AbortSignal.timeout(upload ? 180_000 : 30_000),
    headers: {
      Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'Aureon-release',
      ...(body !== undefined ? { 'Content-Type': upload ? 'application/octet-stream' : 'application/json' } : {}),
      ...(size !== undefined ? { 'Content-Length': String(size) } : {}),
    },
    ...(body !== undefined ? { body: upload ? body : JSON.stringify(body) } : {}),
    ...(upload ? { duplex: 'half' } : {}),
  });
  if (optional && response.status === 404) { await response.body?.cancel(); return null; }
  if (!response.ok) { await response.body?.cancel(); fail(`GitHub ${method} request failed: HTTP ${response.status}.`); }
  if (response.status === 204) return null;
  if (Number(response.headers.get('content-length') || 0) > 4 * 1024 * 1024) fail('GitHub response is too large.');
  let length = 0;
  const chunks = [];
  for await (const chunk of response.body) {
    length += chunk.byteLength;
    if (length > 4 * 1024 * 1024) { await response.body.cancel().catch(() => {}); fail('GitHub response is too large.'); }
    chunks.push(Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function verifySource(version, runId) {
  if (process.env.GITHUB_REPOSITORY !== REPOSITORY || process.env.GITHUB_REF !== 'refs/heads/main') {
    fail('Publication must run from simfonyy/aureon main.');
  }
  if (!/^[1-9]\d{0,19}$/.test(runId)) fail('Invalid Desktop packages run ID.');
  const current = git('rev-parse', 'HEAD');
  if (!/^[0-9a-f]{40}$/.test(current) || current !== process.env.GITHUB_SHA) fail('Workflow checkout does not match its commit.');
  const main = await api('/git/ref/heads/main');
  if (main.object?.sha !== current) fail('main moved after dispatch. Run publication again from the current commit.');
  const run = await api(`/actions/runs/${runId}`);
  if (run.repository?.full_name !== REPOSITORY || run.head_repository?.full_name !== REPOSITORY
      || run.status !== 'completed' || run.conclusion !== 'success'
      || !['push', 'workflow_dispatch'].includes(run.event)
      || !['main', `release/${version}`].includes(run.head_branch)
      || run.path?.split('@')[0] !== '.github/workflows/desktop-packages.yml'
      || !/^[0-9a-f]{40}$/.test(run.head_sha || '')) {
    fail('The selected run is not a successful trusted Desktop packages build.');
  }
  const source = run.head_sha;
  // fetch-depth:0 supplies the source commit. Refuse an unrelated build rather
  // than fetching arbitrary revisions or reusing packages from another tree.
  git('cat-file', '-e', `${source}^{commit}`);
  const changed = git('diff', '--name-only', source, current).split('\n').filter(Boolean);
  const drift = changed.filter(path => !publicationOnly(path));
  if (drift.length) fail(`Build source differs from main: ${drift.join(', ')}.`);
  if ([...sourceVersions(source), ...sourceVersions(current)].some(value => value !== version)) {
    fail('Package, Tauri and Cargo versions must match the requested release in both commits.');
  }
  const jobs = await api(`/actions/runs/${runId}/jobs?per_page=100`);
  for (const name of ['Windows x64 — MSI and portable', 'Linux x64 — DEB and AppImage']) {
    const matches = jobs.jobs?.filter(job => job.name === name) || [];
    if (matches.length !== 1 || matches[0].conclusion !== 'success') fail(`Required build did not succeed: ${name}.`);
  }
  const result = await api(`/actions/runs/${runId}/artifacts?per_page=100`);
  if (result.total_count > 100) fail('Unexpected number of build artifacts.');
  const artifacts = {};
  for (const [platform, name] of Object.entries(ARTIFACTS)) {
    const matches = result.artifacts?.filter(artifact => artifact.name === name) || [];
    if (matches.length !== 1 || matches[0].expired || !Number.isSafeInteger(matches[0].id)
        || matches[0].size_in_bytes <= 0 || matches[0].size_in_bytes > MAX_ASSET * 2
        || matches[0].workflow_run?.head_sha && matches[0].workflow_run.head_sha !== source) {
      fail(`Required artifact is missing, expired or mismatched: ${name}.`);
    }
    artifacts[platform] = matches[0].id;
  }
  return { current, source, artifacts };
}

function checksumRows(text, expected) {
  if (Buffer.byteLength(text) > 4096) fail('Checksum file is too large.');
  const rows = new Map();
  for (const line of text.trim().split(/\r?\n/)) {
    const match = /^([a-fA-F0-9]{64})  ([A-Za-z0-9_.-]+)$/.exec(line);
    if (!match || !expected.includes(match[2]) || rows.has(match[2])) fail('Unexpected or duplicate package checksum.');
    rows.set(match[2], match[1].toLowerCase());
  }
  if (rows.size !== expected.length) fail('Package checksums are incomplete.');
  return rows;
}

async function fileHash(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function verifyPackages(version) {
  const files = versionFiles(version);
  const packages = [];
  for (const [platform, expected] of Object.entries(files)) {
    const directory = join(ROOT, 'release-input', platform);
    const entries = await readdir(directory);
    const names = [...expected, 'SHA256SUMS.txt'];
    if (entries.length !== names.length || entries.some(name => !names.includes(name))) fail(`Unexpected ${platform} artifact files.`);
    for (const name of names) {
      const stat = await lstat(join(directory, name));
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > (name === 'SHA256SUMS.txt' ? 4096 : MAX_ASSET)) {
        fail(`Invalid release file: ${name}.`);
      }
    }
    const checksums = checksumRows(await readFile(join(directory, 'SHA256SUMS.txt'), 'utf8'), expected);
    for (const name of expected) {
      const path = join(directory, name), size = (await lstat(path)).size, hash = await fileHash(path);
      if (hash !== checksums.get(name)) fail(`Checksum mismatch: ${name}.`);
      packages.push({ name, path, size, hash });
    }
  }
  const output = join(ROOT, 'release-output');
  await mkdir(output, { recursive: true });
  const sums = join(output, 'SHA256SUMS.txt');
  await writeFile(sums, packages.toSorted((a, b) => a.name.localeCompare(b.name, 'en')).map(file => `${file.hash}  ${file.name}`).join('\n') + '\n');
  packages.push({ name: 'SHA256SUMS.txt', path: sums, size: (await lstat(sums)).size, hash: await fileHash(sums) });
  return packages;
}

function releaseBody(changelog, version, files) {
  const heading = new RegExp(`^## (?:\\[)?${version.replaceAll('.', '\\.')}\\]?[^\\n]*$`, 'm');
  const match = heading.exec(changelog);
  if (!match) fail('Release changelog section is missing.');
  const section = changelog.slice(match.index + match[0].length).split(/^## /m)[0];
  const bullets = section.split(/\r?\n/).filter(line => line.startsWith('- '));
  if (bullets.length !== 5 || bullets.some(line => line.length > 240)) fail('Use exactly five short changelog bullets for this release.');
  const link = (label, name) => `[${label}](https://github.com/${REPOSITORY}/releases/download/v${version}/${name})`;
  const downloads = `![Скачивания файлов](https://img.shields.io/github/downloads/${REPOSITORY}/v${version}/total?style=flat-square&label=скачиваний&labelColor=252628&color=786443)`;
  const packages = [
    '| Windows x64 | Linux x64 |',
    '| --- | --- |',
    `| ${link('Установщик MSI', files.windows[0])} | ${link('DEB', files.linux[0])} |`,
    `| ${link('ZIP без установки', files.windows[1])} | ${link('AppImage', files.linux[1])} |`,
  ];
  return `${downloads}\n\n${bullets.join('\n')}\n\n${packages.join('\n')}\n`;
}

async function verifyTag(version, expected) {
  const ref = await api(`/git/ref/tags/v${version}`, { optional: true });
  if (!ref) return;
  let object = ref.object;
  for (let depth = 0; object?.type === 'tag' && depth < 3; depth++) object = (await api(`/git/tags/${object.sha}`)).object;
  if (object?.type !== 'commit' || object.sha !== expected) fail('The release tag already points to another commit.');
}

function matchingAsset(asset, file) {
  return asset.state === 'uploaded' && asset.size === file.size
    && (!asset.digest || asset.digest === `sha256:${file.hash}`);
}

async function verifyAssets(id, files) {
  const assets = await api(`/releases/${id}/assets?per_page=100`);
  if (!Array.isArray(assets) || assets.length !== files.length) fail('Release asset set is incomplete or unexpected.');
  for (const file of files) {
    const matches = assets.filter(asset => asset.name === file.name);
    if (matches.length !== 1 || !matchingAsset(matches[0], file)) fail(`Uploaded release asset does not match: ${file.name}.`);
  }
}

async function publish(version, state) {
  const files = await verifyPackages(version);
  const body = releaseBody(await readFile(join(ROOT, 'CHANGELOG.md'), 'utf8'), version, versionFiles(version));
  await verifyTag(version, state.current);
  let release = await api(`/releases/tags/v${version}`, { optional: true });
  if (!release) {
    // The tag endpoint returns published releases only. Drafts are in the list.
    const recentReleases = await api('/releases?per_page=100');
    const drafts = recentReleases.filter(item => item.draft && item.tag_name === `v${version}`);
    if (drafts.length > 1) fail('Multiple drafts exist for this version.');
    release = drafts[0];
  }
  if (release) {
    if (release.tag_name !== `v${version}` || release.target_commitish !== state.current || release.prerelease) fail('An unexpected release already exists for this version.');
    if (!release.draft) {
      await verifyAssets(release.id, files);
      console.log(`Release v${version} is already published with the verified assets.`);
      return;
    }
    const existing = await api(`/releases/${release.id}/assets?per_page=100`);
    if (existing.some(asset => !files.some(file => file.name === asset.name))) fail('Existing draft contains unexpected assets.');
    release = await api(`/releases/${release.id}`, { method: 'PATCH', body: { name: `Aureon v${version}`, body, draft: true, prerelease: false } });
  } else {
    release = await api('/releases', { method: 'POST', body: { tag_name: `v${version}`, target_commitish: state.current,
      name: `Aureon v${version}`, body, draft: true, prerelease: false, generate_release_notes: false, make_latest: 'false' } });
  }
  // On any failure below, the release stays a draft and cannot become Latest.
  for (const file of files) {
    const assets = await api(`/releases/${release.id}/assets?per_page=100`);
    const existing = assets.find(asset => asset.name === file.name);
    if (existing && matchingAsset(existing, file)) continue;
    if (existing) await api(`/releases/assets/${existing.id}`, { method: 'DELETE' });
    const upload = new URL(release.upload_url.split('{')[0]); upload.searchParams.set('name', file.name);
    const asset = await api(upload.href, { method: 'POST', upload: true, body: createReadStream(file.path), size: file.size });
    if (!matchingAsset(asset, file)) fail(`Upload verification failed: ${file.name}.`);
  }
  await verifyAssets(release.id, files);
  await verifyTag(version, state.current);
  const main = await api('/git/ref/heads/main');
  if (main.object?.sha !== state.current) fail('main moved during publication; the complete release remains a draft.');
  const published = await api(`/releases/${release.id}`, { method: 'PATCH', body: { draft: false, prerelease: false, make_latest: 'true' } });
  if (published.draft || published.prerelease || published.tag_name !== `v${version}`) fail('GitHub did not publish the expected stable release.');
  await verifyAssets(published.id, files);
  const latest = await api('/releases/latest');
  if (latest.id !== published.id) fail('Published release did not become Latest.');
  console.log(`Published Aureon v${version}: four packages and SHA256SUMS.txt verified.`);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,
    `Aureon v${version}: [release](${published.html_url}).\n\nBuild source: \`${state.source}\`. Release commit: \`${state.current}\`.\n`);
}

async function selfTest() {
  const assert = (await import('node:assert/strict')).default;
  const files = versionFiles('1.1.0');
  assert.equal(files.windows.length + files.linux.length, 4);
  assert.throws(() => versionFiles('1.1.0-beta'));
  assert(publicationOnly('docs/screenshots/home.png'));
  for (const path of ['src/main.ts', 'src-tauri/Cargo.toml', 'package.json', 'scripts/collect-packages.mjs', '.github/workflows/desktop-packages.yml']) assert(!publicationOnly(path));
  const hash = 'a'.repeat(64), name = files.windows[0];
  assert.equal(checksumRows(`${hash}  ${name}\n`, [name]).get(name), hash);
  assert.throws(() => checksumRows(`${hash}  ../private\n`, [name]));
  assert.throws(() => checksumRows(`${hash}  ${name}\n${hash}  ${name}\n`, [name]));
  assert.throws(() => checksumRows(`${hash}  ${name}\n`, files.windows));
  assert(!matchingAsset({ state: 'uploaded', size: 8, digest: `sha256:${'b'.repeat(64)}` }, { size: 8, hash }));
  assert(matchingAsset({ state: 'uploaded', size: 8, digest: `sha256:${hash}` }, { size: 8, hash }));
  const body = releaseBody('## [1.1.0] — 4 ноября 2026\n\n' + Array.from({ length: 5 }, (_, index) => `- Изменение ${index}`).join('\n') + '\n\n## [1.0.3]\n- old', '1.1.0', files);
  assert(!body.includes('- old')); assert(body.includes(files.linux[1]));
  assert(!/эксперимент|готовится|preview|beta/i.test(body));
  console.log('Publisher validation self-test passed (no network or GitHub writes).');
}

async function main() {
  const mode = process.argv[2];
  if (mode === '--self-test') return selfTest();
  if (!['prepare', 'publish'].includes(mode)) fail('Expected prepare or publish.');
  const version = process.env.RELEASE_VERSION || '', runId = process.env.BUILD_RUN_ID || '';
  versionFiles(version);
  const state = await verifySource(version, runId);
  if (mode === 'prepare') {
    if (!process.env.GITHUB_OUTPUT) fail('GitHub step outputs are unavailable.');
    await appendFile(process.env.GITHUB_OUTPUT, `windows_id=${state.artifacts.windows}\nlinux_id=${state.artifacts.linux}\n`);
    console.log(`Verified successful build ${runId} at ${state.source}; only publication files changed.`);
  } else await publish(version, state);
}

main().catch(error => { console.error(error instanceof Error ? error.message : 'Release publication failed.'); process.exitCode = 1; });
