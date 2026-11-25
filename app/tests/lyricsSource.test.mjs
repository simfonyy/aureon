import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
let lrclib, yandex, netease = [];
globalThis.lyricsSourceFixture = {
  api: { catalogLyrics: async () => [], neteaseLookup: async () => netease, lrclibLookup: async () => lrclib, lyrics: async () => { if(yandex instanceof Error) throw yandex; return yandex; } },
  artistNames: () => 'Artist',
  useGeniusStore: () => ({ ready: false }),
  useUiStore: () => ({ settings: { lyricsSource: 'auto' } }),
};
const source = await readFile(new URL('../src/lib/lyricsSource.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
  .replace(/import\s*\{([^}]+)\}\s*from\s*['"][^'"]+['"];?/g, (_, names) => `const {${names}} = globalThis.lyricsSourceFixture;`);
const { loadTrackLyrics } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const track = { id: 'a', title: 'Song', artists: [{ name: 'Artist' }] };
test('automatic lookup prefers synced Yandex lyrics over plain LRCLIB', async () => {
  lrclib = { synced: false, lines: [{ text: 'plain', time_ms: 0 }] };
  yandex = { synced: true, track_id: 'a', lines: [{ text: 'timed', time_ms: 2000 }] };
  assert.equal((await loadTrackLyrics(track)).origin, 'yandex');
  assert.equal((await loadTrackLyrics(track, 'lrclib')).origin, 'lrclib');
});
test('a later source failure does not discard readable plain lyrics', async () => {
  lrclib = { synced: false, lines: [{ text: 'plain', time_ms: 0 }] };
  yandex = new Error('offline');
  assert.equal((await loadTrackLyrics(track)).lyrics.lines[0].text, 'plain');
});

test('automatic lookup uses timed NetEase lyrics before falling back to plain text', async () => {
  lrclib = null;
  yandex = { synced: false, lines: [{ time_ms: 0, text: 'plain' }] };
  netease = [{ time_ms: 1200, text: 'timed' }];
  const result = await loadTrackLyrics(track);
  assert.equal(result.origin, 'netease');
  assert.equal(result.lyrics.lines[0].time_ms, 1200);
  netease = [];
  assert.equal((await loadTrackLyrics(track)).origin, 'yandex');
});

test('a KuGou outage still allows QQ Music to supply timed lyrics', async () => {
  netease = [];
  lrclib = null;
  yandex = { synced: false, lines: [{ time_ms: 0, text: 'plain' }] };
  const calls = [];
  globalThis.lyricsSourceFixture.api.catalogLyrics = async (provider) => {
    calls.push(provider);
    if (provider === 'kugou') throw new Error('unavailable');
    return [{ time_ms: 400, text: 'timed' }];
  };
  assert.equal((await loadTrackLyrics(track)).origin, 'qqmusic');
  assert.deepEqual(calls, ['kugou', 'qqmusic']);
  calls.length = 0;
  assert.equal((await loadTrackLyrics(track, 'qqmusic')).lyrics.synced, true);
  assert.deepEqual(calls, ['qqmusic']);
});
