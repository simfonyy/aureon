import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { compileScript, parse } from '@vue/compiler-sfc';
import { createRenderer, h, nextTick, reactive } from 'vue';

const data = code => 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
const js = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const syncUrl = data(js(await readFile(new URL('../src/lib/musicClipSync.ts', import.meta.url), 'utf8')));
const helpersUrl = data(js(await readFile(new URL('../src/lib/musicClips.ts', import.meta.url), 'utf8')));
const alignmentUrl = data(js(await readFile(new URL('../src/lib/clipAlignment.ts', import.meta.url), 'utf8')));
const { clipAlignmentCache } = await import(alignmentUrl);
const { createMusicClipSynchronizer } = await import(syncUrl);
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
async function settle() { for (let i = 0; i < 24; i++) { await Promise.resolve(); await nextTick(); } }
function media() {
  let time = 0;
  return { duration: 60, readyState: 4, paused: true, playbackRate: 1, muted: false, loop: true, seeking: false, seeks: [], plays: 0, pauses: 0, loads: 0,
    get currentTime() { return time; }, set currentTime(value) { time = value; this.seeks.push(value); },
    async play() { this.plays++; this.paused = false; }, pause() { this.pauses++; this.paused = true; },
    removeAttribute(name) { if (name === 'src') this.src = ''; }, load() { this.loads++; },
  };
}

test('audio position seeks a paused clip in both directions without playing or looping it', () => {
  const video = media(), errors = [];
  const sync = createMusicClipSynchronizer(video, { current: () => true, onError: message => errors.push(message) });
  sync.sync(25, false); assert.equal(video.currentTime, 25);
  sync.sync(3, false); assert.equal(video.currentTime, 3);
  sync.sync(-5, false); assert.equal(video.currentTime, 0);
  sync.sync(1, false, 1.25); assert.equal(video.playbackRate, 1.25);
  assert.equal(video.plays, 0); assert.equal(video.muted, true); assert.equal(video.loop, false); assert.deepEqual(errors, []);
  sync.dispose();
});

test('small playback drift stays smooth, larger seeks resync, and a shorter clip freezes at its end', async () => {
  const video = media(); video.currentTime = 12; video.seeks = [];
  const sync = createMusicClipSynchronizer(video, { current: () => true, onError: assert.fail });
  sync.sync(12.2, true); await settle(); assert.equal(video.plays, 1); assert.deepEqual(video.seeks, []);
  sync.sync(20, true); assert.equal(video.currentTime, 20);
  sync.sync(4, true); assert.equal(video.currentTime, 4);
  sync.sync(80, true); assert.equal(video.currentTime, 59.96); assert.equal(video.paused, true);
  const plays = video.plays; sync.sync(82, true); assert.equal(video.plays, plays);
  sync.sync(5, true); await settle(); assert.equal(video.currentTime, 5); assert.equal(video.paused, false);
  sync.dispose();
});

test('late play completion cannot restart a paused or disposed clip', async () => {
  const video = media(), pending = deferred();
  video.play = () => { video.plays++; return pending.promise.then(() => { video.paused = false; }); };
  const sync = createMusicClipSynchronizer(video, { current: () => true, onError: assert.fail });
  sync.sync(5, true); sync.sync(5, false);
  pending.resolve(); await settle(); assert.equal(video.paused, true);
  const pendingAgain = deferred(); video.play = () => pendingAgain.promise.then(() => { video.paused = false; });
  sync.sync(6, true); sync.dispose(); pendingAgain.resolve(); await settle(); assert.equal(video.paused, true);
});

test('play rejection falls back once, while a stale rejection is ignored', async () => {
  const video = media(), errors = [];
  video.play = async () => { video.plays++; throw new Error('Autoplay rejected'); };
  const sync = createMusicClipSynchronizer(video, { current: () => true, onError: message => errors.push(message) });
  sync.sync(5, true); await settle(); sync.sync(6, true); await settle();
  assert.equal(errors.length, 1); assert.equal(video.plays, 1); assert.equal(video.paused, true); sync.dispose();
  const pending = deferred(); let current = true;
  const stale = createMusicClipSynchronizer({ ...media(), play: () => pending.promise }, { current: () => current, onError: assert.fail });
  stale.sync(1, true); current = false; pending.reject(new Error('late')); await settle(); stale.dispose();
});

test('a play interrupted by buffering cannot report failure after audio resumes', async () => {
  const video = media(), pending = deferred(), errors = [];
  video.play = () => { video.plays++; return pending.promise; };
  const sync = createMusicClipSynchronizer(video, { current: () => true, onError: message => errors.push(message) });
  sync.sync(1, true); sync.sync(1, false); sync.sync(1, true);
  pending.reject(Object.assign(new Error('play was interrupted by pause'), { name: 'AbortError' }));
  await settle(); assert.deepEqual(errors, []);
  video.play = async () => { video.plays++; video.paused = false; };
  sync.sync(1.1, true); await settle(); assert.equal(video.paused, false); assert.deepEqual(errors, []); sync.dispose();
});

test('small drift uses a bounded rate correction while large drift seeks exactly', async () => {
  const video = media(); video.currentTime = 10; video.seeks = [];
  const sync = createMusicClipSynchronizer(video, { current: () => true, onError: assert.fail });
  sync.sync(10.3, true, 1.25); await settle();
  assert.deepEqual(video.seeks, []); assert.equal(video.playbackRate, 1.25 * 1.03);
  sync.sync(9.7, true, 1.25); assert.equal(video.playbackRate, 1.25 * .97); assert.deepEqual(video.seeks, []);
  sync.sync(10.02, true, 1.25); assert.equal(video.playbackRate, 1.25);
  sync.sync(10.6, true, 1.25); assert.equal(video.currentTime, 10.6); assert.equal(video.playbackRate, 1.25);
  sync.sync(10.4, false, 1.25); assert.equal(video.currentTime, 10.4); assert.equal(video.paused, true);
  sync.dispose();
});

test('a negative aligned clip position holds the first frame until the audio reaches its start', async () => {
  const video = media(); video.currentTime = 5;
  const sync = createMusicClipSynchronizer(video, { current: () => true, onError: assert.fail });
  sync.sync(-2, true); assert.equal(video.currentTime, 0); assert.equal(video.plays, 0);
  sync.sync(0, true); await settle(); assert.equal(video.plays, 1); sync.dispose();
});

test('a buffering video seek is not repeatedly moved by the clock, while a new user seek still wins', () => {
  const video = media(); video.currentTime = 10; video.seeks = []; video.seeking = true;
  const sync = createMusicClipSynchronizer(video, { current: () => true, onError: assert.fail });
  sync.sync(12, true); sync.sync(12.1, true);
  assert.deepEqual(video.seeks, []);
  sync.sync(30, false, 1, true);
  assert.equal(video.currentTime, 30);
  sync.dispose();
});

// Mount the real component with a host video and API adapters. This exercises
// track changes and visibility while real setup/watch/cleanup code stays active.
const require = createRequire(import.meta.url), vueUrl = pathToFileURL(require.resolve('vue')).href;
const fixtureUrl = data(`export const api={trackClips:id=>globalThis.__clipBackdropFixture.trackClips(id),clipStream:id=>globalThis.__clipBackdropFixture.clipStream(id),alignMusicClip:(trackId,clipId)=>globalThis.__clipBackdropFixture.alignMusicClip(trackId,clipId)};export const attachMusicClip=(...args)=>globalThis.__clipBackdropFixture.attach(...args);export const audio=new Proxy({},{get(_,key){const value=globalThis.__clipBackdropFixture.audio[key];return typeof value==='function'?value.bind(globalThis.__clipBackdropFixture.audio):value;}});`);
const parsed = parse(await readFile(new URL('../src/components/clips/MusicClipBackdrop.vue', import.meta.url), 'utf8'));
assert.deepEqual(parsed.errors, []);
const code = js(compileScript(parsed.descriptor, { id: 'clip-backdrop-test', inlineTemplate: true }).content)
  .replace(/from\s+(['"])([^'"]+)\1/g, (_, quote, id) => `from '${id === 'vue' ? vueUrl : id === '@/lib/musicClips' ? helpersUrl : id === '@/lib/musicClipSync' ? syncUrl : id === '@/lib/clipAlignment' ? alignmentUrl : fixtureUrl}'`);
const MusicClipBackdrop = (await import(data(code))).default;
function node(type, text = '') { return { type, text, children: [], props: {}, parent: null, ...(type === 'video' ? media() : {}) }; }
const renderer = createRenderer({
  createElement: type => node(type), createText: value => node('#text', value), createComment: value => node('#comment', value),
  insert(child, parent, anchor = null) { if (child.parent) this.remove(child); const at = anchor ? parent.children.indexOf(anchor) : -1; parent.children.splice(at < 0 ? parent.children.length : at, 0, child); child.parent = parent; },
  remove(child) { if (child.parent) { const at = child.parent.children.indexOf(child); if (at >= 0) child.parent.children.splice(at, 1); child.parent = null; } },
  setText(child, text) { child.text = text; }, setElementText(child, text) { child.text = text; child.children = []; },
  parentNode: child => child.parent, nextSibling: child => child.parent?.children[child.parent.children.indexOf(child) + 1] || null,
  patchProp(child, key, oldValue, value) { child.props[key] = value; },
});
const track = id => ({ id, title: id, artists: [], clip_ids: ['17'], album_id: null, album_title: null, cover_url: null, duration_ms: 60_000, available: true });
const clip = (id, trackId) => ({ id, title: id, artists: [], thumbnail_url: null, preview_url: null, duration_ms: 60_000, track_ids: [trackId] });
function mount(t, f, initial = {}) {
  clipAlignmentCache.clear();
  f.alignMusicClip ??= async () => ({ offsetSeconds: 0, confidence: .99, matchedWindows: 5, analyzedSeconds: 20 });
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document'), listeners = new Map();
  const doc = { hidden: false, addEventListener(name, fn) { listeners.set(name, fn); }, removeEventListener(name) { listeners.delete(name); } };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: doc });
  const audioListeners = new Map();
  f.audio ??= { currentTime: 10, readyState: 4, paused: true, seeking: false, playbackRate: 1,
    getAttribute: name => name === 'src' ? '/test.wav' : null,
    addEventListener(name, fn) { const rows = audioListeners.get(name) || new Set(); rows.add(fn); audioListeners.set(name, rows); },
    removeEventListener(name, fn) { audioListeners.get(name)?.delete(fn); },
  };
  globalThis.__clipBackdropFixture = f;
  const props = reactive({ track: track('123'), enabled: true, active: true, position: 10, playing: false, ...initial });
  const emitted = { ready: [], error: [], loading: [] }, root = node('root');
  const app = renderer.createApp({ setup: () => () => h(MusicClipBackdrop, { ...props, onReady: value => emitted.ready.push(value), onError: value => emitted.error.push(value), onLoading: value => emitted.loading.push(value) }) });
  app.mount(root);
  let closed = false;
  const close = () => { if (closed) return; closed = true; app.unmount(); };
  t.after(() => { close(); delete globalThis.__clipBackdropFixture; if (previous) Object.defineProperty(globalThis, 'document', previous); else delete globalThis.document; });
  return { props, emitted, close, audio: f.audio, audioListeners,
    audioEvent(type) { audioListeners.get(type)?.forEach(fn => fn({ type })); },
    visibility(hidden) { doc.hidden = hidden; listeners.get('visibilitychange')?.(); } };
}

test('disabled/inactive background never requests a clip and a stale track cannot attach', async t => {
  const first = deferred(), second = deferred(), requests = [], attachments = [];
  const view = mount(t, {
    trackClips(id) { requests.push(id); return id === '123' ? first.promise : second.promise; },
    clipStream: async id => ({ clip_id: id, kind: 'mp4', url: 'https://strm.yandex.ru/clip.mp4' }),
    attach: async (video, stream) => { attachments.push(stream.clip_id); return () => video.pause(); },
  }, { enabled: false });
  await settle(); assert.deepEqual(requests, []);
  view.props.enabled = true; await settle(); assert.deepEqual(requests, ['123']);
  view.props.track = track('456'); await settle(); assert.deepEqual(requests, ['123', '456']);
  first.resolve([clip('17', '123')]); await settle(); assert.deepEqual(attachments, []);
  second.resolve([clip('18', '456')]); await settle(); assert.deepEqual(attachments, ['18']); assert.deepEqual(view.emitted.error, []);
  view.props.active = false; await settle(); assert.equal(view.emitted.ready.at(-1), false);
});

test('hiding/off destroys the decoder, ignores a late attach, and visible restore gets a fresh stream', async t => {
  const pending = deferred(), videos = [], streams = [], released = [];
  let attaches = 0;
  const view = mount(t, {
    trackClips: async () => [clip('17', '123')],
    clipStream: async id => { streams.push(id); return { clip_id: id, kind: 'mp4', url: 'https://strm.yandex.ru/clip.mp4' }; },
    attach: async video => { videos.push(video); if (++attaches === 1) await pending.promise; return () => { released.push(video); video.pause(); }; },
  });
  await settle(); assert.equal(attaches, 1);
  view.visibility(true); await settle(); assert.equal(view.emitted.ready.at(-1), false);
  pending.resolve(); await settle(); assert.deepEqual(released, [videos[0]]);
  view.visibility(false); await settle(); assert.equal(attaches, 2); assert.equal(streams.length, 2);
  view.props.enabled = false; await settle(); assert.equal(released.length, 2); assert.equal(videos[1].paused, true);
  assert.deepEqual(view.emitted.error, []);
});

test('a mismatched stream cannot play another clip and decoder failure restores the ordinary backdrop', async t => {
  const requested = [], attached = [];
  let failDecoder, released = 0;
  const view = mount(t, {
    trackClips: async () => [clip('17', '123'), clip('18', '123')],
    clipStream: async id => { requested.push(id); return { clip_id: id === '17' ? '999' : id, kind: 'mp4', url: 'https://strm.yandex.ru/clip.mp4' }; },
    attach: async (video, stream, options) => { attached.push(stream.clip_id); failDecoder = options.onError; return () => { released++; video.pause(); }; },
  });
  await settle();
  assert.deepEqual(requested, ['17', '18']); assert.deepEqual(attached, ['18']);
  assert.equal(view.emitted.ready.at(-1), true);
  failDecoder('Видео недоступно'); await settle();
  assert.equal(view.emitted.ready.at(-1), false); assert.deepEqual(view.emitted.error, ['Видео недоступно']); assert.equal(released, 1);
});

test('backdrop uses the live audio clock, immediately pauses on stalls and seeks both ways', async t => {
  let video;
  const view = mount(t, {
    trackClips: async () => [clip('17', '123')],
    clipStream: async id => ({ clip_id: id, kind: 'mp4', url: 'https://strm.yandex.ru/clip.mp4' }),
    attach: async element => { video = element; return () => element.pause(); },
  }, { position: 35, playing: true });
  view.audio.paused = false;
  await settle();
  assert.equal(video.currentTime, 10); assert.equal(video.paused, false);
  view.audio.currentTime = 20; view.audioEvent('seeked'); await settle();
  assert.equal(video.currentTime, 20); assert.equal(view.props.position, 35);
  view.audio.currentTime = 3; view.audioEvent('seeked'); await settle(); assert.equal(video.currentTime, 3);
  // Some browsers dispatch waiting before readyState drops; both signals stop it.
  view.audioEvent('waiting'); assert.equal(video.paused, true);
  view.audioEvent('playing'); await settle(); assert.equal(video.paused, false);
  view.audio.readyState = 2; view.audioEvent('canplay'); assert.equal(video.paused, true);
  view.audio.readyState = 4; view.audioEvent('canplay'); await settle(); assert.equal(video.paused, false);
  view.audio.seeking = true; view.audioEvent('seeking'); assert.equal(video.paused, true);
  view.audio.seeking = false; view.audioEvent('seeked'); await settle(); assert.equal(video.paused, false);
  view.audio.paused = true; view.audioEvent('pause'); assert.equal(video.paused, true);
  view.close(); assert.ok([...view.audioListeners.values()].every(rows => rows.size === 0));
});

test('pending resume uses stored position without playing, and explicit offset stays on the audio clock', async t => {
  let video;
  const view = mount(t, {
    trackClips: async () => [clip('17', '123')],
    clipStream: async id => ({ clip_id: id, kind: 'mp4', url: 'https://strm.yandex.ru/clip.mp4' }),
    attach: async element => { video = element; return () => element.pause(); },
  }, { position: 22, playing: true, pendingResume: true, offsetSeconds: 3 });
  view.audio.paused = false;
  await settle(); assert.equal(video.currentTime, 25); assert.equal(video.paused, true);
  view.props.pendingResume = false; await settle(); assert.equal(video.currentTime, 13); assert.equal(video.paused, false);
  view.audio.currentTime = 4; view.props.offsetSeconds = -6; await settle(); assert.equal(video.currentTime, 0); assert.equal(video.paused, true);
});

test('a confirmed 30-second clip intro maps its frames onto the audio clock before becoming visible', async t => {
  const analysis = deferred(), order = [];
  let video;
  const view = mount(t, {
    trackClips: async () => [clip('17', '123')],
    alignMusicClip: async (trackId, clipId) => { order.push(`align:${trackId}:${clipId}`); return analysis.promise; },
    clipStream: async id => { order.push('stream'); return { clip_id: id, kind: 'mp4', url: 'https://strm.yandex.ru/clip.mp4' }; },
    attach: async element => { order.push('attach'); video = element; return () => element.pause(); },
  }, { playing: true });
  view.audio.paused = false;
  await settle(); assert.equal(view.emitted.ready.at(-1), false); assert.equal(view.emitted.loading.at(-1), true); assert.equal(video, undefined);
  assert.deepEqual(order, ['align:123:17']);
  analysis.resolve({ offsetSeconds: 30, confidence: .98, matchedWindows: 6, analyzedSeconds: 30 }); await settle();
  assert.deepEqual(order, ['align:123:17', 'stream', 'attach']); assert.equal(video.currentTime, 40); assert.equal(view.emitted.ready.at(-1), true);
  view.audio.currentTime = 2; view.audioEvent('seeked'); await settle(); assert.equal(video.currentTime, 32);
});

test('an unconfirmed match keeps the cover, and a stale alignment cannot fetch or attach video', async t => {
  const first = deferred(), second = deferred(), streams = [], attached = [];
  const view = mount(t, {
    trackClips: async id => [clip(id === '123' ? '17' : '18', id)],
    alignMusicClip: (id) => id === '123' ? first.promise : second.promise,
    clipStream: async id => { streams.push(id); return { clip_id: id, kind: 'mp4', url: 'https://strm.yandex.ru/clip.mp4' }; },
    attach: async (element, stream) => { attached.push(stream.clip_id); return () => element.pause(); },
  });
  await settle(); view.props.track = track('456'); await settle();
  first.resolve({ offsetSeconds: 30, confidence: .99, matchedWindows: 7, analyzedSeconds: 30 }); await settle(); assert.deepEqual(streams, []);
  second.resolve({ offsetSeconds: 5, confidence: .2, matchedWindows: 1, analyzedSeconds: 30 }); await settle();
  assert.deepEqual(streams, []); assert.deepEqual(attached, []); assert.equal(view.emitted.ready.at(-1), false);
  assert.deepEqual(view.emitted.error, ['Не удалось синхронизировать клип с этой версией трека.']); assert.equal(view.emitted.loading.at(-1), false);
});

test('custom audio editions cannot launch official-stream analysis or show an unsynchronized clip', async t => {
  let requests = 0;
  const view = mount(t, { trackClips: async () => { requests++; return []; }, alignMusicClip: async () => { requests++; }, clipStream: assert.fail, attach: assert.fail }, { alignmentAllowed: false });
  await settle(); assert.equal(requests, 0); assert.equal(view.emitted.ready.at(-1), false); assert.equal(view.emitted.error.length, 1);
  view.props.active = false; await settle(); view.props.active = true; await settle(); assert.equal(view.emitted.error.length, 1); assert.equal(requests, 0);
});

test('switching tracks during analysis queues the new clip and automatically shows only its video', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const first = deferred(), second = deferred(), calls = [], streams = [], attached = [];
  let busy = false;
  const view = mount(t, {
    trackClips: async id => [clip(id === '123' ? '17' : '18', id)],
    alignMusicClip: id => {
      assert.equal(busy, false, 'native analysis must never overlap');
      busy = true; calls.push(id);
      return (id === '123' ? first.promise : second.promise).finally(() => { busy = false; });
    },
    clipStream: async id => { streams.push(id); return { clip_id: id, kind: 'mp4', url: 'https://strm.yandex.ru/clip.mp4' }; },
    attach: async (video, stream) => { attached.push(stream.clip_id); return () => video.pause(); },
  });
  await settle(); assert.deepEqual(calls, ['123']);
  view.props.track = track('456'); await settle();
  assert.deepEqual(calls, ['123']); assert.deepEqual(view.emitted.error, []); assert.equal(view.emitted.loading.at(-1), true);
  // Waiting for the old command must not consume the new clip's analysis deadline.
  t.mock.timers.tick(111_000); await settle();
  assert.deepEqual(view.emitted.error, []); assert.equal(view.emitted.loading.at(-1), true);
  first.resolve({ offsetSeconds: 1, confidence: .99, matchedWindows: 6, analyzedSeconds: 30 }); await settle();
  assert.deepEqual(calls, ['123', '456']); assert.deepEqual(streams, []);
  second.resolve({ offsetSeconds: 5, confidence: .99, matchedWindows: 6, analyzedSeconds: 30 }); await settle();
  assert.deepEqual(streams, ['18']); assert.deepEqual(attached, ['18']);
  assert.equal(view.emitted.ready.at(-1), true); assert.equal(view.emitted.loading.at(-1), false); assert.deepEqual(view.emitted.error, []);
});

test('turning a queued background off prevents its analysis and video from starting after the old command', async t => {
  const first = deferred(), calls = [];
  const view = mount(t, {
    trackClips: async id => [clip(id === '123' ? '17' : '18', id)],
    alignMusicClip: id => { calls.push(id); assert.equal(id, '123'); return first.promise; },
    clipStream: assert.fail, attach: assert.fail,
  });
  await settle(); view.props.track = track('456'); await settle();
  assert.deepEqual(calls, ['123']); view.props.enabled = false; await settle();
  first.resolve({ offsetSeconds: 0, confidence: .99, matchedWindows: 6, analyzedSeconds: 30 }); await settle();
  assert.deepEqual(calls, ['123']); assert.equal(view.emitted.ready.at(-1), false); assert.equal(view.emitted.loading.at(-1), false);
  assert.deepEqual(view.emitted.error, []);
});
