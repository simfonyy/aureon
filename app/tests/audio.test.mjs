import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/audio.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
globalThis.window = globalThis;
globalThis.requestAnimationFrame = callback => setTimeout(() => callback(performance.now()), 16);
globalThis.cancelAnimationFrame = clearTimeout;
globalThis.Audio = class { volume = 1; paused = false; play() { return Promise.resolve(); } };
const audio = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function settles(promise) {
  const result = await Promise.race([promise.then(() => true), sleep(250).then(() => false)]);
  assert.equal(result, true, 'cancelled fade must resolve, releasing track navigation');
}

test('volume change during fade-out releases the waiting track load', async () => {
  const fade = audio.fadeOut(5000);
  await sleep(30);
  const volume = audio.fadeTo(.4, 30);
  await settles(fade);
  await settles(volume);
  assert.equal(audio.audio.volume, .4);
});

test('rapid navigation cancels fade-in without stranding its promise', async () => {
  const fade = audio.fadeIn(.8, 5000);
  audio.cancelFade(.2);
  await settles(fade);
  assert.equal(audio.audio.volume, .2);
});

test('a newer source invalidates the previous source immediately', () => {
  const old = audio.nextSourceToken();
  const current = audio.nextSourceToken();
  assert.equal(audio.isCurrentToken(old), false);
  assert.equal(audio.isCurrentToken(current), true);
});
