import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const compiled = ts.transpileModule(await readFile(new URL('../src/lib/clipAlignment.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { createClipAlignmentCache, reliableClipAlignment, clipAlignmentCacheKey } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));
const valid = (offsetSeconds = 30) => ({ offsetSeconds, confidence: .95, matchedWindows: 6, analyzedSeconds: 30 });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

test('only a finite offset supported by several confident windows can become playback metadata', () => {
  assert.equal(reliableClipAlignment(valid()), true); assert.equal(reliableClipAlignment(valid(-30)), true);
  for (const value of [null, [], {}, { ...valid(), confidence: .2 }, { ...valid(), confidence: 2 }, { ...valid(), matchedWindows: 1 }, { ...valid(), matchedWindows: 3.5 }, { ...valid(), analyzedSeconds: 1 }, { ...valid(), analyzedSeconds: Infinity }, { ...valid(), offsetSeconds: NaN }, valid(301)]) assert.equal(reliableClipAlignment(value), false);
  assert.equal(clipAlignmentCacheKey('123:456', '17', 164.02), clipAlignmentCacheKey('123', '17', 164));
  assert.notEqual(clipAlignmentCacheKey('123', '17', 164), clipAlignmentCacheKey('123', '17', 180));
  for (const track of ['local:abcdef', '0', '123?token=secret']) assert.equal(clipAlignmentCacheKey(track, '17', 164), null);
});

test('identical requests share analysis; a different edition or clip requires its own confirmed match', async () => {
  const cache = createClipAlignmentCache(), pending = deferred(); let calls = 0;
  const load = () => { calls++; return pending.promise; };
  const a = cache.get('123', '17', 164, load), b = cache.get('123:456', '17', 164.01, load);
  await Promise.resolve(); assert.equal(calls, 1);
  pending.resolve({ ...valid(), url: 'https://signed.invalid/private', audio: 'never retain' });
  const [first, second] = await Promise.all([a, b]); assert.deepEqual(first, valid()); assert.deepEqual(second, valid());
  first.offsetSeconds = 99;
  assert.deepEqual(await cache.get('123', '17', 164, assert.fail), valid());
  await cache.get('123', '18', 164, async () => { calls++; return valid(10); });
  await cache.get('123', '17', 180, async () => { calls++; return valid(20); }); assert.equal(calls, 3);
});

test('failed or uncertain analysis is retryable and bounded cache eviction cannot grow without limit', async () => {
  const cache = createClipAlignmentCache(2);
  await assert.rejects(cache.get('123', '17', 164, async () => ({ ...valid(), confidence: .1 })), /Не удалось синхронизировать/);
  await assert.rejects(cache.get('123', '17', 164, async () => { throw new Error('backend failed'); }), /Не удалось синхронизировать/);
  assert.deepEqual(await cache.get('123', '17', 164, async () => valid()), valid());
  await cache.get('123', '18', 164, async () => valid(10));
  await cache.get('123', '19', 164, async () => valid(20));
  let refetched = false;
  await cache.get('123', '17', 164, async () => { refetched = true; return valid(); }); assert.equal(refetched, true);
});

test('clearing while analysis is pending prevents late results from restoring an old cache entry', async () => {
  const cache = createClipAlignmentCache(), pending = deferred();
  const old = cache.get('123', '17', 164, () => pending.promise); await Promise.resolve(); cache.clear();
  pending.resolve(valid()); assert.deepEqual(await old, valid());
  let requested = false;
  await cache.get('123', '17', 164, async () => { requested = true; return valid(20); }); assert.equal(requested, true);
});

test('a new track waits for the running native analysis and starts without a manual retry', async () => {
  const cache = createClipAlignmentCache(), first = deferred(), second = deferred(), calls = [], starts = [];
  let firstCurrent = true;
  const a = cache.get('123', '17', 164, () => { calls.push('A'); return first.promise; }, { current: () => firstCurrent, onStart: () => starts.push('A') });
  const aDone = assert.rejects(a, /Не удалось синхронизировать/);
  await Promise.resolve(); firstCurrent = false;
  const b = cache.get('456', '18', 180, () => { calls.push('B'); return second.promise; }, { onStart: () => starts.push('B') });
  await Promise.resolve(); assert.deepEqual(calls, ['A']); assert.deepEqual(starts, ['A']);
  first.resolve(valid()); await aDone;
  for (let i = 0; i < 8; i++) await Promise.resolve();
  assert.deepEqual(calls, ['A', 'B']); assert.deepEqual(starts, ['A', 'B']);
  second.resolve(valid(5)); assert.deepEqual(await b, valid(5));
});

test('queued inactive requests are skipped, while a fresh subscriber can reuse the same queued track', async () => {
  const cache = createClipAlignmentCache(), first = deferred(), calls = [];
  const a = cache.get('123', '17', 164, () => { calls.push('A'); return first.promise; });
  let canceled = true, replaced = true;
  const canceledRequest = cache.get('456', '18', 180, async () => { calls.push('canceled'); return valid(); }, { current: () => canceled });
  const canceledDone = assert.rejects(canceledRequest, /Не удалось синхронизировать/);
  const previous = cache.get('789', '19', 190, async () => { calls.push('live'); return valid(8); }, { current: () => replaced });
  const previousDone = assert.rejects(previous, /Не удалось синхронизировать/);
  canceled = false; replaced = false;
  const latest = cache.get('789', '19', 190, assert.fail);
  first.resolve(valid()); await a; await canceledDone; await previousDone;
  assert.deepEqual(await latest, valid(8)); assert.deepEqual(calls, ['A', 'live']);
});

test('the waiting queue is bounded and expires without launching abandoned native jobs', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const cache = createClipAlignmentCache(), first = deferred(), calls = [];
  const a = cache.get('123', '17', 164, () => { calls.push('A'); return first.promise; });
  const waiting = Array.from({ length: 8 }, (_, index) => cache.get(String(200 + index), '18', 180, async () => { calls.push('queued'); return valid(); }));
  const waitingDone = Promise.allSettled(waiting);
  await assert.rejects(cache.get('999', '19', 180, assert.fail), /Не удалось синхронизировать/);
  t.mock.timers.tick(120_000);
  assert.ok((await waitingDone).every(result => result.status === 'rejected'));
  first.resolve(valid()); await a;
  for (let i = 0; i < 8; i++) await Promise.resolve();
  assert.deepEqual(calls, ['A']);
  assert.deepEqual(await cache.get('999', '19', 180, async () => valid(9)), valid(9));
});

test('clearing queued work does not unlock the native slot before the running command completes', async () => {
  const cache = createClipAlignmentCache(), first = deferred(), calls = [];
  const a = cache.get('123', '17', 164, () => { calls.push('A'); return first.promise; });
  const old = cache.get('456', '18', 180, assert.fail);
  const oldDone = assert.rejects(old, /Не удалось синхронизировать/);
  await Promise.resolve(); cache.clear(); await oldDone;
  const latest = cache.get('789', '19', 190, async () => { calls.push('new'); return valid(12); });
  await Promise.resolve(); assert.deepEqual(calls, ['A']);
  first.resolve(valid()); await a; assert.deepEqual(await latest, valid(12));
  assert.deepEqual(calls, ['A', 'new']);
});
