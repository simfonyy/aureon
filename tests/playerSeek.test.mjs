import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { createPinia, defineStore } from 'pinia';
import { watch } from 'vue';

const source = await readFile(new URL('../src/stores/player/index.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const flush = () => new Promise(resolve => setImmediate(resolve));
const track = id => ({ id, title: `Track ${id}`, artists: [], duration_ms: 120000, available: true });
const stream = id => ({ url: `https://stream.test/${id}.mp3`, codec: 'mp3', bitrate: 320, source: 'test' });
let fixtureId = 0;

// Run the real Pinia actions and media-event handlers. The Audio boundary can
// reproduce HAVE_NOTHING, failed assignments, delayed metadata and stale events.
async function fixture(t, resolveStream = async id => stream(id)) {
  const assignments = [], plays = [], saved = [], stats = [], notifications = [];
  let token = 0;
  class Media extends EventTarget {
    _src = ''; _time = 0; readyState = 0; duration = NaN; paused = true; error = null;
    rejectAssignments = 0; ignoreAssignments = 0; volume = .5; playbackRate = 1;
    set src(value) { this._src = value; this.readyState = 0; this._time = 0; this.duration = NaN; }
    get src() { return this._src; }
    getAttribute(name) { return name === 'src' ? this._src || null : null; }
    removeAttribute(name) { if (name === 'src') { this._src = ''; this.readyState = 0; } }
    set currentTime(value) {
      assignments.push(value);
      if (!this.readyState || this.rejectAssignments-- > 0) throw new Error('Metadata not ready');
      if (this.ignoreAssignments-- > 0) return;
      this._time = value;
    }
    get currentTime() { return this._time; }
    pause() { this.paused = true; this.onpause?.(); }
    load() { this.readyState = 0; this._time = 0; this.duration = NaN; }
    metadata(duration = 120) { this.duration = duration; this.readyState = 1; this.dispatchEvent(new Event('loadedmetadata')); }
    time(value) { this._time = value; this.ontimeupdate?.(); }
  }
  const audio = new Media();
  const settings = {
    skipAiTracks: false, autoSkipDisliked: false, censorBypass: false, preferLocalFiles: false,
    crossfadeEnabled: false, crossfadeSeconds: 0, trimSilence: false,
  };
  const noop = () => {};
  const bindings = {
    defineStore, watch, audio, isLibraryTrack: () => false,
    bindMediaSession: noop, Notify: { create: value => notifications.push(value) },
    api: { stream: resolveStream }, convertFileSrc: value => value,
    cancelFade: noop, currentLevel: () => 0, ensureAnalyser: noop, fadeIn: async () => {}, fadeOut: async () => {}, fadeTo: async () => {},
    isCurrentToken: value => value === token, nextSourceToken: () => ++token,
    resumeAudioContext: noop, resumeOnGesture: noop,
    safePlay: async request => { if (request !== undefined && request !== token) return; audio.paused = false; plays.push(audio.src); audio.onplay?.(); },
    proxyStream: value => value, playDiagnostic: noop, withDeadline: promise => promise,
    overrideUrl: () => null, createLogger: () => ({ info: noop, warn: noop, error: noop }), logQuality: noop,
    useEqualizerStore: () => ({ apply: noop }), useLibraryStore: () => ({ disliked: () => false }),
    useSleepStore: () => ({ onTrackEnded: () => false, firing: false }),
    useStatsStore: () => ({ begin: noop, tick: value => stats.push(value) }),
    useTogetherStore: () => ({ isGuest: false }), useUiStore: () => ({ settings }),
    loadPlaybackSettings: () => ({ volume: .5, muted: false, quality: 'high', playbackRate: 1, repeat: 'off' }),
  };
  const key = `playerSeekFixture${++fixtureId}`;
  globalThis[key] = bindings;
  const code = compiled.replace(/import\s*\{([^}]+)\}\s*from\s*['"][^'"]+['"];?/g, (_, names) => `const {${names}} = globalThis.${key};`);
  const { usePlayerStore } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
  const player = usePlayerStore(createPinia());
  player.syncTray = async () => {};
  player.syncPresence = async () => null;
  player.prefetchNext = async () => {};
  player.persistSession = () => saved.push(player.progress);
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { setInterval: () => 1 } });
  player.bind();
  if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow); else delete globalThis.window;
  t.after(() => { player.$dispose(); delete globalThis[key]; });
  return { player, audio, assignments, plays, saved, stats, notifications };
}

test('the last seek while resolving a source survives delayed metadata and stale timeupdates', async t => {
  const pending = deferred(), f = await fixture(t, () => pending.promise);
  const loading = f.player.playQueue([track('101')]); await flush();
  assert.equal(f.player.loading, true);
  f.player.seek(35); f.player.seek(72);
  f.audio.time(0);
  assert.equal(f.player.progress, 72); assert.deepEqual(f.assignments, []);
  pending.resolve(stream('101')); await loading;
  assert.equal(f.player.progress, 72);
  f.audio.metadata();
  assert.equal(f.audio.currentTime, 72); assert.equal(f.player.progress, 72);
  f.audio.time(73); assert.equal(f.player.progress, 73);
  assert.deepEqual(f.stats, [1]); assert.equal(f.plays.length, 1);
});

test('a user seek replaces a restored startAt, including a request for the beginning', async t => {
  const f = await fixture(t);
  f.player.queue = [track('102')]; f.player.index = 0;
  await f.player.loadCurrent({ startAt: 44, autoplay: false });
  f.player.seek(80); f.player.seek(0);
  f.audio.metadata();
  assert.equal(f.audio.currentTime, 0); assert.equal(f.player.progress, 0);
  f.audio.dispatchEvent(new Event('canplay'));
  assert.deepEqual(f.assignments, [0]); assert.equal(f.audio.paused, true); assert.deepEqual(f.plays, []);
});

test('a rejected metadata seek is retried on canplay without playing paused audio', async t => {
  const f = await fixture(t);
  f.player.queue = [track('103')]; f.player.index = 0;
  await f.player.loadCurrent({ startAt: 30, autoplay: false });
  f.audio.rejectAssignments = 1; f.audio.metadata();
  assert.equal(f.player.progress, 30); assert.equal(f.audio.currentTime, 0);
  f.audio.dispatchEvent(new Event('canplay'));
  assert.equal(f.audio.currentTime, 30); assert.equal(f.audio.paused, true);
  assert.deepEqual(f.assignments, [30, 30]); assert.deepEqual(f.plays, []);
});

test('a silently ignored seek is retained and the latest target wins the retry', async t => {
  const f = await fixture(t);
  await f.player.playQueue([track('104')]); f.audio.metadata();
  f.audio.ignoreAssignments = 1; f.player.seek(20);
  assert.equal(f.player.progress, 20); assert.equal(f.audio.currentTime, 0);
  f.player.seek(90); f.audio.dispatchEvent(new Event('progress'));
  assert.equal(f.audio.currentTime, 90); assert.equal(f.player.progress, 90);
  assert.deepEqual(f.assignments, [20, 90]);
});

test('switching tracks cancels old seek listeners and a late source cannot seek the new track', async t => {
  const old = deferred(), f = await fixture(t, id => id === '105' ? old.promise : Promise.resolve(stream(id)));
  const loading = f.player.playQueue([track('105')]); await flush();
  f.player.seek(67);
  await f.player.playQueue([track('106')]);
  f.audio.metadata();
  old.resolve(stream('105')); await loading;
  f.audio.dispatchEvent(new Event('canplay'));
  assert.equal(f.player.current.id, '106'); assert.equal(f.audio.currentTime, 0);
  assert.equal(f.player.progress, 0); assert.deepEqual(f.assignments, []);
});

test('recovery ignores old readiness until its replacement source has actually loaded', async t => {
  const pending = deferred(); let requests = 0;
  const f = await fixture(t, id => ++requests === 1 ? Promise.resolve(stream(id)) : pending.promise);
  await f.player.playQueue([track('109')]); f.audio.metadata(); f.audio.time(12);
  const recovery = f.player.recoverPlayback(12, true); await flush();
  f.player.seek(76);
  // A queued old loadedmetadata event must not consume the pending seek even
  // if the media object briefly still reports the old source and HAVE_METADATA.
  f.audio._src = stream('109').url; f.audio.metadata();
  assert.equal(f.player.progress, 76); assert.deepEqual(f.assignments, []);
  pending.resolve({ ...stream('109'), url: 'https://stream.test/recovered.mp3' }); await recovery;
  assert.equal(f.audio.readyState, 0); assert.equal(f.audio.currentTime, 0);
  f.audio.metadata();
  assert.equal(f.audio.src, 'https://stream.test/recovered.mp3');
  assert.equal(f.audio.currentTime, 76); assert.equal(f.player.progress, 76);
  assert.deepEqual(f.assignments, [76]);
});

test('seeking a restored session updates its future position without starting a request', async t => {
  let requests = 0;
  const f = await fixture(t, async id => { requests++; return stream(id); });
  f.player.current = track('107'); f.player.queue = [f.player.current]; f.player.index = 0;
  f.player.duration = 120; f.player.pendingResume = true;
  f.player.seek(62);
  assert.equal(f.player.progress, 62); assert.equal(f.saved.at(-1), 62);
  assert.equal(requests, 0); assert.deepEqual(f.assignments, []); assert.deepEqual(f.plays, []);
  await f.player.loadCurrent({ startAt: f.player.progress, autoplay: false }); f.audio.metadata();
  assert.equal(f.audio.currentTime, 62); assert.equal(f.audio.paused, true);
});

test('invalid positions do not poison progress and media duration clamps a queued seek', async t => {
  const f = await fixture(t); await f.player.playQueue([track('108')]);
  f.player.seek(100); f.player.seek(NaN); f.player.seek(Infinity); f.player.seek(-Infinity);
  assert.equal(f.player.progress, 100);
  f.audio.metadata(85);
  assert.equal(f.audio.currentTime, 85); assert.equal(f.player.progress, 85);
  f.player.seek(-20); assert.equal(f.audio.currentTime, 0); assert.equal(f.player.progress, 0);
});
