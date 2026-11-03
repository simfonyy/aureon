import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { createPinia } from 'pinia';

const url = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const helpersUrl = url(compile(await readFile(new URL('../src/lib/musicClips.ts', import.meta.url), 'utf8')));
const { musicTrackId, musicTrackUrl, hasMusicClips, clipsForTrack, clipMediaUrl } = await import(helpersUrl);
const playbackSource = (await readFile(new URL('../src/lib/musicClipPlayback.ts', import.meta.url), 'utf8')).replace("'./musicClips'", JSON.stringify(helpersUrl));
const { attachMusicClip } = await import(url(compile(playbackSource)));
const track = id => ({ id, title: 'Трек', artists: [], clip_ids: ['17'] });
const clip = id => ({ id, title: 'Клип', artists: [], thumbnail_url: null, preview_url: null, duration_ms: 210000, track_ids: ['123'] });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

test('clip actions use a real remote track ID, and a videoshot does not become a clip', () => {
  assert.equal(musicTrackId('123:456'), '123');
  assert.equal(musicTrackUrl('123:456'), 'https://music.yandex.ru/track/123');
  for (const id of ['local:' + 'a'.repeat(64), '0', '../123', '123?clipIds=17', '123#token', '']) {
    assert.equal(musicTrackId(id), null); assert.equal(musicTrackUrl(id), null); assert.equal(hasMusicClips(track(id)), false);
  }
  assert.equal(hasMusicClips(track('123')), true);
  assert.equal(hasMusicClips({ ...track('123'), clip_ids: [], background_video_uri: 'https://cache.yandex.net/shot.mp4' }), false);
});

test('media validation keeps signed Yandex URLs but rejects lookalikes, credentials and non-web URLs', () => {
  const signed = 'https://strm.yandex.ru/video.m3u8?signature=a%2Fb';
  assert.equal(clipMediaUrl(signed), signed);
  for (const value of ['https://yandex.net.evil.test/a', 'https://evil-yandex.net/a', 'http://strm.yandex.ru/a', 'file:///C:/private', 'https://user:secret@strm.yandex.ru/a', 'https://strm.yandex.ru:8443/a', 'https://strm.yandex.ru/a#secret', 'https://127.0.0.1/a', 'https://strm.yandex.ru/\na', 'https://strm.yandex.ru\\evil.test/a', 'x'.repeat(9000)]) assert.equal(clipMediaUrl(value), null, value);
  const rows = clipsForTrack([clip('17'), clip('17'), { ...clip('18'), track_ids: ['999'] }, { ...clip('19'), preview_url: 'https://evil.test/video.mp4' }], '123:456');
  assert.deepEqual(rows.map(row => row.id), ['17', '19']);
  assert.equal(rows[1].preview_url, null);
});

globalThis.__clipApi = {};
const storeSource = (await readFile(new URL('../src/stores/musicClips.ts', import.meta.url), 'utf8'))
  .replace("from 'pinia'", `from ${JSON.stringify(import.meta.resolve('pinia'))}`)
  .replace("import { api } from '@/api/client';", 'const api = {trackClips:id=>globalThis.__clipApi.trackClips(id)};')
  .replace("'@/lib/musicClips'", JSON.stringify(helpersUrl));
const { useMusicClipsStore } = await import(url(compile(storeSource)));

test('late clip responses cannot replace another track or reopen a closed panel', async () => {
  const a = deferred(), b = deferred(), calls = [];
  globalThis.__clipApi.trackClips = id => { calls.push(id); return id === '123' ? a.promise : b.promise; };
  const store = useMusicClipsStore(createPinia());
  const first = store.open(track('123:456')), second = store.open(track('999'));
  b.resolve([{ ...clip('18'), track_ids: ['999'] }]); await second;
  a.resolve([clip('17')]); await first;
  assert.deepEqual(calls, ['123', '999']); assert.equal(store.target.id, '999'); assert.equal(store.clips[0].id, '18');
  const late = deferred(); globalThis.__clipApi.trackClips = () => late.promise;
  const pending = store.open(track('123')); store.close(); late.reject(new Error('late')); await pending;
  assert.equal(store.target, null); assert.deepEqual(store.clips, []); assert.equal(store.error, ''); assert.equal(store.loading, false);
});

test('a failed lookup is retryable, and local files never trigger clip requests', async () => {
  let calls = 0; globalThis.__clipApi.trackClips = async () => { if (++calls === 1) throw new Error('Нет связи'); return [clip('17')]; };
  const store = useMusicClipsStore(createPinia());
  await store.open(track('local:' + 'a'.repeat(64))); assert.equal(calls, 0);
  await store.open(track('123')); assert.equal(store.error, 'Нет связи'); assert.equal(store.loading, false);
  await store.load(); assert.equal(store.error, ''); assert.equal(store.clips[0].id, '17');
});

test('current-track discovery shares a single metadata request and ignores a response after logout', async () => {
  const request = deferred(); let calls = 0;
  globalThis.__clipApi.trackClips = id => { calls++; assert.equal(id, '123'); return request.promise; };
  const store = useMusicClipsStore(createPinia());
  const pending = store.lookup({ ...track('123'), clip_ids: [] });
  await store.lookup(track('123:456')); assert.equal(calls, 1);
  request.resolve([clip('17')]); await pending;
  assert.deepEqual(store.knownClipIds['123'], ['17']);
  await store.lookup(track('123')); assert.equal(calls, 1);
  const stale = deferred(); globalThis.__clipApi.trackClips = () => stale.promise;
  const old = store.lookup(track('999')); store.reset();
  stale.resolve([{ ...clip('18'), track_ids: ['999'] }]); await old;
  assert.deepEqual(store.knownClipIds, {}); assert.deepEqual(store.pendingLookups, []);
});

function video(nativeHls = false) {
  return { src: '', pauses: 0, loads: 0, canPlayType: () => typeof nativeHls === 'string' ? nativeHls : nativeHls ? 'probably' : '', pause() { this.pauses++; }, load() { this.loads++; }, removeAttribute(name) { if (name === 'src') this.src = ''; } };
}
function hlsFixture(supported = true) {
  const instances = [];
  class Hls {
    static Events = { ERROR: 'error', MANIFEST_PARSED: 'manifestParsed', MAX_AUTO_LEVEL_UPDATED: 'maxAutoLevelUpdated' };
    static ErrorTypes = { NETWORK_ERROR: 'networkError', MEDIA_ERROR: 'mediaError' };
    static isSupported() { return supported; }
    constructor(config) { this.config = config; this.destroyed = 0; this.listeners = new Map(); this.restarts = []; this.recoveries = 0; this.autoLevelCapping = -1; instances.push(this); }
    on(event, listener) { this.listeners.set(event, listener); }
    emit(event, data) { this.listeners.get(event)?.(event, data); }
    loadSource(url) { this.url = url; }
    attachMedia(media) { this.media = media; }
    startLoad(position) { this.restarts.push(position); }
    recoverMediaError() { this.recoveries++; }
    destroy() { this.destroyed++; }
  }
  return { module: { default: Hls }, instances };
}
const stream = { clip_id: '17', url: 'https://strm.yandex.ru/clip.m3u8?sign=abc', kind: 'hls' };

test('HLS playback uses bounded buffers without credential headers and releases the media exactly once', async () => {
  const media = video(), fixture = hlsFixture(), errors = [];
  const release = await attachMusicClip(media, stream, { current: () => true, onError: error => errors.push(error), loadHls: async () => fixture.module });
  const instance = fixture.instances[0];
  assert.equal(instance.url, stream.url); assert.equal(instance.media, media);
  assert.equal(instance.config.emeEnabled, false); assert.ok(instance.config.maxMaxBufferLength <= 60);
  assert.equal(instance.config.capLevelToPlayerSize, true); assert.equal(instance.config.startLevel, 0); assert.ok(instance.config.maxBufferSize <= 32 * 1024 * 1024);
  assert.equal(instance.config.xhrSetup, undefined); assert.equal(instance.config.fetchSetup, undefined);
  instance.emit('error', { fatal: false }); assert.deepEqual(errors, []);
  instance.emit('error', { fatal: true }); assert.equal(errors.length, 1);
  release(); release(); assert.equal(instance.destroyed, 1); assert.equal(media.pauses, 1); assert.equal(media.loads, 1);
});

test('closing while HLS is being imported never attaches a stale stream', async () => {
  const media = video(), fixture = hlsFixture(), importing = deferred(); let current = true;
  const pending = attachMusicClip(media, stream, { current: () => current, onError() {}, loadHls: () => importing.promise });
  current = false; importing.resolve(fixture.module);
  assert.equal(await pending, null); assert.equal(fixture.instances.length, 0); assert.equal(media.src, '');
});

test('a native HLS maybe response still uses HLS.js when MSE is available', async () => {
  const media = video('maybe'), fixture = hlsFixture();
  const release = await attachMusicClip(media, stream, { current: () => true, onError: assert.fail, loadHls: async () => fixture.module });
  assert.equal(fixture.instances.length, 1); assert.equal(fixture.instances[0].media, media);
  assert.equal(fixture.instances[0].url, stream.url); assert.equal(media.src, '');
  release(); assert.equal(fixture.instances[0].destroyed, 1);
});

test('native HLS is a fallback only without MSE, and an unsupported WebView fails without allocating a player', async () => {
  const media = video(true), nativeFixture = hlsFixture(false);
  const release = await attachMusicClip(media, stream, { current: () => true, onError: assert.fail, loadHls: async () => nativeFixture.module });
  assert.equal(nativeFixture.instances.length, 0); assert.equal(media.src, stream.url);
  release(); release(); assert.equal(media.src, ''); assert.equal(media.pauses, 1); assert.equal(media.loads, 1);
  const fixture = hlsFixture(false);
  await assert.rejects(attachMusicClip(video(), stream, { current: () => true, onError() {}, loadHls: async () => fixture.module }), /не поддерживает/);
  assert.equal(fixture.instances.length, 0);
  await assert.rejects(attachMusicClip(video(), { ...stream, url: 'https://foreign.test/a.m3u8' }, { current: () => true, onError() {} }), /неподдерживаемый адрес/);
});

test('MP4 playback never loads HLS.js', async () => {
  const media = video();
  const release = await attachMusicClip(media, { ...stream, kind: 'mp4', url: 'https://strm.yandex.ru/clip.mp4?sign=abc' }, {
    current: () => true, onError: assert.fail, loadHls: async () => { throw new Error('MP4 must not import HLS.js'); },
  });
  assert.equal(media.src, 'https://strm.yandex.ru/clip.mp4?sign=abc'); release(); assert.equal(media.src, '');
});

test('fatal HLS network errors get two delayed restarts and one terminal error', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const media = { ...video(), currentTime: 12 }, fixture = hlsFixture(), errors = [];
  const release = await attachMusicClip(media, stream, { current: () => true, onError: message => errors.push(message), loadHls: async () => fixture.module });
  const hls = fixture.instances[0], failure = { fatal: true, type: 'networkError' };
  hls.emit('error', failure); hls.emit('error', failure);
  t.mock.timers.tick(749); assert.deepEqual(hls.restarts, []); assert.deepEqual(errors, []);
  t.mock.timers.tick(1); assert.deepEqual(hls.restarts, [12]);
  media.currentTime = 20; hls.emit('error', failure);
  t.mock.timers.tick(1999); assert.deepEqual(hls.restarts, [12]);
  t.mock.timers.tick(1); assert.deepEqual(hls.restarts, [12, 20]);
  hls.emit('error', failure); hls.emit('error', failure);
  assert.equal(hls.destroyed, 1); assert.equal(errors.length, 1);
  release(); t.mock.timers.tick(10_000); assert.equal(hls.destroyed, 1); assert.deepEqual(hls.restarts, [12, 20]);
});

test('release or stale track cancels deferred HLS recovery without restarting it', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const fixture = hlsFixture(), errors = []; let current = true;
  const first = await attachMusicClip(video(), stream, { current: () => current, onError: message => errors.push(message), loadHls: async () => fixture.module });
  fixture.instances[0].emit('error', { fatal: true, type: 'networkError' }); first();
  t.mock.timers.tick(750); assert.deepEqual(fixture.instances[0].restarts, []); assert.equal(fixture.instances[0].destroyed, 1);
  const second = await attachMusicClip(video(), stream, { current: () => current, onError: message => errors.push(message), loadHls: async () => fixture.module });
  fixture.instances[1].emit('error', { fatal: true, type: 'networkError' }); current = false;
  t.mock.timers.tick(750); assert.deepEqual(fixture.instances[1].restarts, []); assert.equal(fixture.instances[1].destroyed, 1);
  second(); assert.deepEqual(errors, []);
});

test('fatal HLS media errors recover once, cancel pending network recovery and then fail once', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const fixture = hlsFixture(), errors = [];
  const release = await attachMusicClip(video(), stream, { current: () => true, onError: message => errors.push(message), loadHls: async () => fixture.module });
  const hls = fixture.instances[0];
  hls.emit('error', { fatal: true, type: 'networkError' });
  hls.emit('error', { fatal: true, type: 'mediaError' });
  assert.equal(hls.recoveries, 1); assert.equal(hls.destroyed, 0); assert.deepEqual(errors, []);
  t.mock.timers.tick(5000); assert.deepEqual(hls.restarts, []);
  hls.emit('error', { fatal: true, type: 'mediaError' }); hls.emit('error', { fatal: true, type: 'mediaError' });
  assert.equal(hls.recoveries, 1); assert.equal(hls.destroyed, 1); assert.equal(errors.length, 1); release();
});

test('a recovery exception releases HLS instead of leaving an unusable decoder alive', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const fixture = hlsFixture(), errors = [];
  const release = await attachMusicClip(video(), stream, { current: () => true, onError: message => errors.push(message), loadHls: async () => fixture.module });
  const hls = fixture.instances[0]; hls.startLoad = () => { throw new Error('restart failed'); };
  hls.emit('error', { fatal: true, type: 'networkError' }); t.mock.timers.tick(750);
  assert.equal(hls.destroyed, 1); assert.equal(errors.length, 1); release();
});

test('background quality cap examines all codec renditions and cannot rise above the safe 720p prefix', async () => {
  const fixture = hlsFixture();
  const release = await attachMusicClip(video(), stream, { current: () => true, onError: assert.fail, background: true, loadHls: async () => fixture.module });
  const hls = fixture.instances[0];
  const levels = Array.from({ length: 85 }, (_, index) => ({ height: index < 15 ? 240 : index < 35 ? 360 : index < 60 ? 720 : 1080 }));
  levels[64].height = 360;
  hls.emit('manifestParsed', { levels }); assert.equal(hls.autoLevelCapping, 59);
  hls.autoLevelCapping = 84; hls.emit('maxAutoLevelUpdated', {}); assert.equal(hls.autoLevelCapping, 59);
  hls.autoLevelCapping = 10; hls.emit('maxAutoLevelUpdated', {}); assert.equal(hls.autoLevelCapping, 10);
  release();
  hls.autoLevelCapping = 84; hls.emit('maxAutoLevelUpdated', {}); assert.equal(hls.autoLevelCapping, 84);
});

test('ordinary full clip playback keeps its automatic higher quality levels', async () => {
  const fixture = hlsFixture();
  const release = await attachMusicClip(video(), stream, { current: () => true, onError: assert.fail, loadHls: async () => fixture.module });
  const hls = fixture.instances[0];
  hls.emit('manifestParsed', { levels: [{ height: 360 }, { height: 720 }, { height: 1080 }] });
  assert.equal(hls.autoLevelCapping, -1); release();
});
