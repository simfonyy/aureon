import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const coreFile = new URL('../src/lib/lyricsFx/musicFeatures.ts', import.meta.url);
const options = { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } };
const coreCode = ts.transpileModule(await readFile(coreFile, 'utf8'), options).outputText;
const coreUrl = 'data:text/javascript;base64,' + Buffer.from(coreCode).toString('base64');
const { analyzePcm } = await import(coreUrl);
const rate = 8000;
function audio(seconds, sample) {
  return Float32Array.from({ length: Math.round(seconds * rate) }, (_, i) => sample(i / rate));
}

test('silence and invalid PCM do not invent musical landmarks', () => {
  assert.deepEqual(analyzePcm(new Float32Array(rate * 3), rate).landmarks, []);
  assert.deepEqual(analyzePcm(new Float32Array(rate * 3).fill(NaN), rate).landmarks, []);
  assert.deepEqual(analyzePcm(new Float32Array(100), 0).landmarks, []);
});

test('a loudness step without a spectrum change does not trigger an accent', () => {
  const sound = audio(4, time => {
    const tone = Math.sin(2 * Math.PI * 220 * time) + .3 * Math.sin(2 * Math.PI * 440 * time);
    return tone * (time < 1.5 ? .08 : .48);
  });
  const result = analyzePcm(sound, rate);
  assert.ok(!result.landmarks.some(point => Math.abs(point.timeMs - 1500) < 200));
});

test('spectrum changes at equal loudness produce repeatable musical cues', () => {
  const frequencies = [220, 392, 880, 330];
  const sound = audio(8, time => .2 * Math.sin(2 * Math.PI * frequencies[Math.floor(time * 2) % frequencies.length] * time));
  const original = sound.slice();
  const a = analyzePcm(sound, rate), b = analyzePcm(sound, rate);
  assert.deepEqual(a, b);
  assert.deepEqual(sound, original);
  assert.ok(a.landmarks.length >= 10, 'musical changes remain visible without a loudness threshold');
  for (const ms of [1000, 2000, 3000, 4000, 5000, 6000]) assert.ok(a.landmarks.some(point => Math.abs(point.timeMs - ms) < 100), `cue near ${ms}`);
  assert.ok(a.pulsePeriodMs >= 400 && a.pulsePeriodMs <= 1100);
  assert.ok(a.landmarks.some(point => point.beatStrength > .1));
  assert.ok(a.landmarks.every(point => point.strength >= 0 && point.strength <= 1 && point.beatStrength >= 0 && point.beatStrength <= 1));
});

test('bass attacks in a repeating rhythm contribute pulse support', () => {
  const sound = audio(8, time => {
    const age = time % .5;
    const kick = age < .25 ? .6 * Math.sin(2 * Math.PI * 80 * age) * Math.exp(-age * 18) : 0;
    return .08 * Math.sin(2 * Math.PI * 1100 * time) + kick;
  });
  const result = analyzePcm(sound, rate);
  assert.ok(result.landmarks.length >= 10);
  assert.ok(result.landmarks.some(point => point.beatStrength > .1));
  assert.equal(result.method, 'spectral-flux+bass-pulse-v1');
});

const transportFile = new URL('../src/lib/lyricsFx/music.ts', import.meta.url);
const transportCode = ts.transpileModule(await readFile(transportFile, 'utf8'), options).outputText
  .replaceAll("from './musicFeatures'", `from '${coreUrl}'`)
  .replaceAll('import.meta.url', JSON.stringify(transportFile.href));
const { analyzeTrackMusic } = await import('data:text/javascript;base64,' + Buffer.from(transportCode).toString('base64'));

function transport(t, { duration = 1, delayedWorker = false, decodeDelay = 0, chunks = [new Uint8Array([1, 2, 3])], advertisedSize = null, contentRange = null, status, responses, onFetch } = {}) {
  const descriptors = new Map(['fetch', 'Worker', 'OfflineAudioContext'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const state = { fetches: 0, decodes: 0, workers: 0, terminated: 0, cancelled: false, requests: [], decodedBytes: null };
  Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async (url, options) => {
    const index = state.fetches++;
    state.requests.push({ url, range: options.headers?.Range });
    await onFetch?.(index, options);
    const item = responses ? responses[index] : { chunks, advertisedSize, contentRange, status };
    if (!item) throw new Error('Unexpected additional audio request');
    return { ok: true, status: item.status ?? (item.contentRange ? 206 : 200), headers: { get: name => name === 'content-range' ? item.contentRange ?? null : item.advertisedSize ?? null }, body: new ReadableStream({
      start(controller) { for (const chunk of item.chunks ?? [new Uint8Array([1, 2, 3])]) controller.enqueue(chunk); controller.close(); },
      cancel() { state.cancelled = true; },
    }) };
  } });
  Object.defineProperty(globalThis, 'OfflineAudioContext', { configurable: true, value: class {
    async decodeAudioData(bytes) {
      state.decodes++;
      state.decodedBytes = Array.from(new Uint8Array(bytes));
      if (decodeDelay) await new Promise(resolve => setTimeout(resolve, decodeDelay));
      return { duration, length: rate, sampleRate: rate, numberOfChannels: 1, getChannelData: () => new Float32Array(rate) };
    }
  } });
  Object.defineProperty(globalThis, 'Worker', { configurable: true, value: class {
    constructor() { state.workers++; }
    postMessage() { setTimeout(() => this.onmessage?.({ data: { durationMs: 1000, landmarks: [], method: 'spectral-flux+bass-pulse-v1' } }), delayedWorker ? 30 : 0); }
    terminate() { state.terminated++; this.onmessage = null; }
  } });
  t.after(() => { for (const [key, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
  } });
  return state;
}

test('oversized responses are rejected before audio decoding', async t => {
  const state = transport(t, { advertisedSize: String(33 * 1024 * 1024) });
  assert.equal(await analyzeTrackMusic('https://source.invalid/large?signature=private', 'oversized-source'), null);
  assert.equal(state.decodes, 0); assert.equal(state.workers, 0);
});

test('streamed audio is capped even when content-length is missing', async t => {
  const state = transport(t, { chunks: [new Uint8Array(17 * 1024 * 1024), new Uint8Array(17 * 1024 * 1024)] });
  assert.equal(await analyzeTrackMusic('https://source.invalid/stream', 'stream-limit-source'), null);
  assert.equal(state.decodes, 0); assert.equal(state.workers, 0);
});

test('long recordings are rejected without starting a feature worker', async t => {
  const state = transport(t, { duration: 601 });
  assert.equal(await analyzeTrackMusic('https://source.invalid/long', 'long-source'), null);
  assert.equal(state.workers, 0);
  assert.equal(await analyzeTrackMusic('https://source.invalid/long', 'known-long-source', undefined, 601000), null);
  assert.equal(state.fetches, 1, 'known long duration avoids even fetching');
});

test('truncated range bodies are rejected before decoding', async t => {
  const state = transport(t, { contentRange: 'bytes 0-999/10000' });
  assert.equal(await analyzeTrackMusic('https://source.invalid/partial', 'partial-source'), null);
  assert.equal(state.decodes, 0);
});

const ranged = (start, end, total, bytes) => ({ status: 206, contentRange: `bytes ${start}-${end}/${total}`, chunks: [Uint8Array.from(bytes)] });

test('Tauri-style capped206 chunks are assembled sequentially before decoding', async t => {
  const state = transport(t, { responses: [ranged(0, 2, 8, [1, 2, 3]), ranged(3, 5, 8, [4, 5, 6]), ranged(6, 7, 8, [7, 8])] });
  assert.ok(await analyzeTrackMusic('http://127.0.0.1/proxy/track', 'ranged-song'));
  assert.deepEqual(state.decodedBytes, [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(state.requests.map(request => request.range), [undefined, 'bytes=3-7', 'bytes=6-7']);
  assert.equal(state.fetches, 3); assert.equal(state.decodes, 1);
});

test('one full206 response needs no follow-up request', async t => {
  const state = transport(t, { responses: [ranged(0, 2, 3, [8, 9, 10])] });
  assert.ok(await analyzeTrackMusic('http://127.0.0.1/proxy/full', 'full-range-song'));
  assert.equal(state.fetches, 1); assert.deepEqual(state.decodedBytes, [8, 9, 10]);
});

test('206 without exposed Content-Range cannot be assembled', async t => {
  const state = transport(t, { status: 206 });
  assert.equal(await analyzeTrackMusic('http://127.0.0.1/proxy/no-header', 'missing-range-header'), null);
  assert.equal(state.fetches, 1); assert.equal(state.decodes, 0);
});

test('gaps, repeated ranges and changed totals cannot corrupt the assembled audio', async t => {
  const variants = [ranged(3, 5, 6, [4, 5, 6]), ranged(0, 1, 6, [1, 2]), ranged(2, 3, 8, [3, 4])];
  let current = 0;
  const state = transport(t, { responses: [ranged(0, 1, 6, [1, 2]), variants[0]], onFetch(index) {
    // Each call below uses a fresh source key and a two-response server script.
  } });
  // Replace only the transport response plan between independent songs.
  const fetcher = globalThis.fetch;
  for (const variant of variants) {
    let request = 0;
    globalThis.fetch = async (url, options) => {
      const index = request++;
      const original = current; current = index;
      if (index === 0) return fetcher(url, options);
      state.fetches++;
      state.requests.push({ url, range: options.headers?.Range });
      return { ok: true, status: variant.status, headers: { get: name => name === 'content-range' ? variant.contentRange : null }, body: new ReadableStream({ start(c) { c.enqueue(variant.chunks[0]); c.close(); } }) };
    };
    // Reset the first-response index for the shared fake transport.
    state.fetches = 0;
    assert.equal(await analyzeTrackMusic('http://127.0.0.1/proxy/bad', `bad-range-${variant.contentRange}`), null);
    assert.equal(request, 2); assert.equal(state.decodes, 0);
  }
});

test('an oversized206 total is rejected before reading or fetching the rest', async t => {
  const state = transport(t, { responses: [ranged(0, 0, 32 * 1024 * 1024 + 1, [1])] });
  assert.equal(await analyzeTrackMusic('http://127.0.0.1/proxy/huge', 'oversized-total'), null);
  assert.equal(state.fetches, 1); assert.equal(state.decodes, 0);
});

test('a range body cannot exceed its declared interval', async t => {
  const state = transport(t, { responses: [ranged(0, 1, 4, [1, 2, 3])] });
  assert.equal(await analyzeTrackMusic('http://127.0.0.1/proxy/overlong', 'overlong-range-body'), null);
  assert.equal(state.fetches, 1); assert.equal(state.decodes, 0);
});

test('cancellation during a follow-up range prevents decoding and further requests', async t => {
  const controller = new AbortController();
  const state = transport(t, { responses: [ranged(0, 1, 6, [1, 2]), ranged(2, 3, 6, [3, 4])], onFetch(index) { if (index === 1) controller.abort(); } });
  assert.equal(await analyzeTrackMusic('http://127.0.0.1/proxy/abort', 'aborted-range-song', controller.signal), null);
  assert.equal(state.fetches, 2); assert.equal(state.decodes, 0); assert.equal(state.workers, 0);
});

test('tiny progressing ranges are bounded to256 responses rather than looping', async t => {
  const state = transport(t, { responses: Array.from({ length: 256 }, (_, i) => ranged(i, i, 257, [i % 256])) });
  assert.equal(await analyzeTrackMusic('http://127.0.0.1/proxy/tiny', 'range-request-limit'), null);
  assert.equal(state.fetches, 256); assert.equal(state.decodes, 0);
});

test('track cancellation terminates the worker and does not cache stale results', async t => {
  const state = transport(t, { delayedWorker: true });
  const controller = new AbortController();
  const pending = analyzeTrackMusic('https://source.invalid/cancel', 'cancelled-source', controller.signal);
  await new Promise(resolve => setTimeout(resolve, 5)); controller.abort();
  assert.equal(await pending, null);
  assert.equal(state.terminated, 1);
  assert.equal(await analyzeTrackMusic('https://source.invalid/cancel', 'cancelled-source', controller.signal), null);
});

test('feature cache uses stable source identity rather than signed playback URLs', async t => {
  const state = transport(t);
  const a = await analyzeTrackMusic('https://source.invalid/audio?signature=old', 'stable-source');
  const b = await analyzeTrackMusic('https://source.invalid/audio?signature=new', 'stable-source');
  assert.deepEqual(a, b); assert.equal(state.fetches, 1); assert.equal(state.workers, 1);
  a.landmarks.push({ timeMs: 100, strength: 1, beatStrength: 1 });
  const c = await analyzeTrackMusic('https://source.invalid/audio?signature=again', 'stable-source');
  assert.equal(c.landmarks.length, 0, 'callers cannot mutate cached features');
});

test('a cancelled decode returns promptly and never starts a worker', async t => {
  const state = transport(t, { decodeDelay: 300 });
  const controller = new AbortController();
  const pending = analyzeTrackMusic('https://source.invalid/decode', 'cancelled-decode-source', controller.signal);
  await new Promise(resolve => setTimeout(resolve, 5)); controller.abort();
  const result = await Promise.race([pending, new Promise(resolve => setTimeout(() => resolve('too late'), 100))]);
  assert.equal(result, null); assert.equal(state.workers, 0);
});

test('feature cache evicts old songs after four entries', async t => {
  const state = transport(t);
  for (let i = 0; i < 6; i++) await analyzeTrackMusic(`https://source.invalid/cache/${i}`, `cache-limit-${i}`);
  assert.equal(state.fetches, 6);
  await analyzeTrackMusic('https://source.invalid/cache/0', 'cache-limit-0');
  assert.equal(state.fetches, 7);
});
