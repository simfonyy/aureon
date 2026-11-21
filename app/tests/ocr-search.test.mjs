import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(new URL('../src/lib/ocrSearch.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { createOcrJobOwner, ocrCanvas, ocrSearchLines, validateOcrFile } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const worker = () => ({ terminated: 0, async terminate() { this.terminated++; } });

test('a cancelled deferred createWorker cannot terminate a newer worker or publish callbacks', async () => {
  const jobs = createOcrJobOwner(), first = jobs.begin(), pending = deferred(), oldWorker = worker(), newWorker = worker();
  const oldRun = (async () => { const owned = await pending.promise; try { return await first.adopt(owned); } finally { await first.finish(); } })();
  jobs.cancel(); const second = jobs.begin(); assert.equal(await second.adopt(newWorker), true);
  const callbacks = []; if (first.current()) callbacks.push('old'); if (second.current()) callbacks.push('new');
  pending.resolve(oldWorker); assert.equal(await oldRun, false);
  assert.deepEqual(callbacks, ['new']); assert.equal(oldWorker.terminated, 1); assert.equal(newWorker.terminated, 0); assert.equal(second.current(), true);
  await second.finish(); assert.equal(newWorker.terminated, 1);
});
test('cancellation settles a pending recognize and late rejection remains handled', async () => {
  const jobs = createOcrJobOwner(), job = jobs.begin(), owned = worker(), recognition = deferred();
  await job.adopt(owned); const running = job.wait(recognition.promise);
  jobs.cancel(); await assert.rejects(running, { name: 'AbortError' }); recognition.reject(new Error('late worker failure'));
  await job.finish(); await Promise.resolve(); assert.equal(owned.terminated, 1); assert.equal(job.current(), false);
});
test('an old finish waiting for terminate never clears the active replacement job', async () => {
  const jobs = createOcrJobOwner(), first = jobs.begin(), termination = deferred();
  await first.adopt({ terminate: () => termination.promise }); const finishing = first.finish();
  const second = jobs.begin(), secondWorker = worker(); await second.adopt(secondWorker);
  termination.resolve(); await finishing; assert.equal(second.current(), true); assert.equal(secondWorker.terminated, 0); await second.finish();
});
test('cancelled bitmap decode closes the image before allocating a canvas', async t => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'createImageBitmap'), image = { width: 100, height: 100, closed: 0, close() { this.closed++; } }, decode = deferred();
  Object.defineProperty(globalThis, 'createImageBitmap', { value: () => decode.promise, configurable: true });
  t.after(() => { if (original) Object.defineProperty(globalThis, 'createImageBitmap', original); else delete globalThis.createImageBitmap; });
  const controller = new AbortController(), reading = ocrCanvas(new File(['image'], 'test.png', { type: 'image/png' }), controller.signal);
  controller.abort(); decode.resolve(image); await assert.rejects(reading, { name: 'AbortError' }); assert.equal(image.closed, 1);
});
test('invalid image files are rejected and OCR query lines are deduplicated', () => {
  assert.throws(() => validateOcrFile(new File(['text'], 'bad.svg', { type: 'image/svg+xml' })), /PNG/);
  assert.throws(() => validateOcrFile(new File([], 'empty.png', { type: 'image/png' })), /16 МБ/);
  assert.deepEqual(ocrSearchLines(' Привет  мир\n123456\nПривет мир\nHi\nNext line'), ['Привет мир', 'Next line']);
});
