import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/stores/player/index.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const imports = new Set();
const code = js.replace(/import\s*\{([^}]+)\}\s*from\s*["'][^"']+["'];/g, (_, names) => {
  const fields = names.split(',').map(s => s.trim()).filter(Boolean);
  fields.forEach(name => imports.add(name));
  return `const { ${fields.join(', ')} } = globalThis.aiPlaybackMocks;`;
});
let enabled, validToken, checks, sources, blocked, checkHook;
let lyricsHook;
const noop = () => {};
globalThis.aiPlaybackMocks = Object.fromEntries([...imports].map(name => [name, noop]));
Object.assign(globalThis.aiPlaybackMocks, {
  defineStore: (_, options) => options,
  createLogger: () => ({ info: noop, warn: noop, error: noop }),
  useUiStore: () => ({ settings: { skipAiTracks: enabled } }),
  useStatsStore: () => ({ begin: noop }),
  useEqualizerStore: () => ({ apply: noop }),
  isCurrentToken: () => validToken,
  withDeadline: promise => promise,
  loadTrackLyrics: (...args) => lyricsHook(...args),
  hasText: value => Boolean(value?.lines?.length),
  api: {
    async aiCheckTracks([id]) {
      checks.push(id);
      if (checkHook) await checkHook();
      return [{ id, ai: blocked.has(id) }];
    },
    async stream(id) {
      sources.push(id);
      // Stop at the audio boundary: no network/audio devices in this test.
      throw new Error('fixture audio boundary');
    },
  },
  Notify: { create: noop },
  audio: { pause: noop, removeAttribute: noop, load: noop },
});
const { usePlayerStore: options } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
function fixture(ids) {
  enabled = true; validToken = true; checks = []; sources = []; blocked = new Set(); checkHook = undefined;
  return {
    ...options.actions,
    queue: ids.map(id => ({ id, title: id, artists: [], duration_ms: 10000 })),
    index: 0, progress: 0, current: null, isWave: false, loading: false,
  };
}
test('AI filter checks before requesting audio and skips without a dislike', async () => {
  const player = fixture(['ai', 'human']);
  blocked.add('ai');
  await player.performLoad({}, 1);
  assert.deepEqual(checks, ['ai', 'human']);
  assert.deepEqual(sources, ['human']);
  assert.equal(player.current.id, 'human');
});
test('all-AI queue stops without playing its last track or wrapping', async () => {
  const player = fixture(['a', 'b']);
  blocked = new Set(['a', 'b']);
  await player.performLoad({}, 1);
  assert.deepEqual(sources, []);
  assert.equal(player.current, null);
  assert.equal(player.loading, false);
  assert.equal(player.index, 1);
});
test('disabled filter does not issue AI requests', async () => {
  const player = fixture(['a']); enabled = false;
  await player.performLoad({}, 1);
  assert.deepEqual(checks, []);
  assert.deepEqual(sources, ['a']);
});
test('changing tracks during the AI request invalidates the old result', async () => {
  const player = fixture(['a', 'b']); blocked.add('a');
  checkHook = async () => { validToken = false; };
  await player.performLoad({}, 1);
  assert.deepEqual(sources, []);
  assert.equal(player.index, 0);
});
test('all-AI radio extends at most once, then stops', async () => {
  const player = fixture(['a']); blocked = new Set(['a', 'b']);
  player.isWave = true;
  let extensions = 0;
  player.extendWave = async () => { extensions++; player.queue.push({ id: 'b' }); };
  await player.performLoad({}, 1);
  assert.equal(extensions, 1);
  assert.deepEqual(sources, []);
  assert.equal(player.current, null);
});

test('late lyrics response cannot replace the newer source or clear its loading state', async () => {
  const player = fixture(['a']); player.current = player.queue[0];
  const pending = [];
  lyricsHook = () => new Promise(resolve => pending.push(resolve));
  const old = player.loadLyrics(true, 'lrclib');
  const fresh = player.loadLyrics(true, 'yandex');
  pending[0]({ lyrics: { track_id: 'a', lines: [{ text: 'old' }] }, origin: 'lrclib' });
  await old;
  assert.equal(player.lyricsLoading, true);
  assert.equal(player.lyrics, null);
  pending[1]({ lyrics: { track_id: 'a', lines: [{ text: 'new' }] }, origin: 'yandex' });
  await fresh;
  assert.equal(player.lyrics.lines[0].text, 'new');
  assert.equal(player.lyricsLoading, false);
});

test('missing lyrics keep the full-screen view and retry controls available', async () => {
  const player = fixture(['a']); player.current = player.queue[0];
  player.showLyrics = true; player.lyricsFullscreen = true;
  lyricsHook = async () => null;
  await player.loadLyrics(true);
  assert.equal(player.showLyrics, true);
  assert.equal(player.lyricsFullscreen, true);
  assert.ok(player.lyricsError);
});
