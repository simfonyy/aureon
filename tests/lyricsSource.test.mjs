import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
let lrclib, yandex;
globalThis.lyricsSourceFixture = {
  api: { lrclibLookup: async () => lrclib, lyrics: async () => { if(yandex instanceof Error) throw yandex; return yandex; } },
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
