import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { reactive, watch, nextTick } from 'vue';

test('media session publishes metadata, clamps position and handles idempotent controls', async () => {
  const handlers = {};
  const session = {
    setActionHandler(action, handler) { handlers[action] = handler; },
    setPositionState(state) { this.position = state; },
  };
  Object.defineProperty(globalThis, 'navigator', { value: { mediaSession: session }, configurable: true });
  globalThis.MediaMetadata = class { constructor(data) { Object.assign(this, data); } };
  globalThis.mediaTestWatch = watch;
  const source = await readFile(new URL('../src/lib/mediaSession.ts', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText.replace(/import \{ watch \} from 'vue';/, 'const watch = globalThis.mediaTestWatch;');
  const { bindMediaSession } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
  const player = reactive({
    current: { title: 'Song', artists: [{ name: 'Artist' }], album_title: 'Album', cover_url: 'https://example.com/cover.jpg' },
    duration: 100, progress: 20, playbackRate: 1, isPlaying: false,
    setPlaying(value) { this.isPlaying = value; },
    seek(value) { this.progress = value; },
    next() { this.nextCount = (this.nextCount ?? 0) + 1; },
    prev() { this.prevCount = (this.prevCount ?? 0) + 1; },
  });
  bindMediaSession(player);
  assert.equal(session.metadata.artist, 'Artist');
  handlers.play(); handlers.play();
  await nextTick();
  assert.equal(session.playbackState, 'playing');
  handlers.pause(); handlers.pause();
  await nextTick();
  assert.equal(session.playbackState, 'paused');
  handlers.seekto({ seekTime: 40 });
  handlers.seekbackward({ seekOffset: 5 });
  assert.equal(player.progress, 35);
  handlers.nexttrack(); handlers.previoustrack();
  assert.equal(player.nextCount, 1);
  assert.equal(player.prevCount, 1);
  player.progress = 120;
  await nextTick();
  assert.equal(session.position.position, 100);
  player.duration = Infinity;
  await nextTick();
  assert.equal(session.position, undefined);
  player.current = null;
  await nextTick();
  assert.equal(session.metadata, null);
  assert.equal(session.playbackState, 'none');
  // Rebinding disposes the previous listeners instead of accumulating them.
  bindMediaSession(player);
  handlers.stop();
  assert.equal(player.progress, 0);
});
