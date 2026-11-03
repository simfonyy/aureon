import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { effectScope, reactive, ref, watch } from 'vue';
import { parse } from '@vue/compiler-sfc';

// Run the real footer guard with Vue reactivity and a controlled leave clock.
// Inert protects keyboard/pointer input; global media handlers stay elsewhere.
const component = parse(await readFile(new URL('../src/layouts/MainLayout.vue', import.meta.url), 'utf8'));
assert.deepEqual(component.errors, []);
const script = ts.createSourceFile('MainLayout.ts', component.descriptor.scriptSetup.content, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
const guard = script.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'guardFooterDuringPlayerOverlay');
assert.ok(guard);
const body = ts.transpileModule(guard.getText(script), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const createGuard = new Function('ref', 'watch', 'player', 'lyricsVisible', 'onBeforeUnmount', 'setTimeout', 'clearTimeout', body + ';return guardFooterDuringPlayerOverlay();');

function fixture(t) {
  const player = reactive({ fullscreen: false }), lyrics = ref(false), timers = new Map(), removed = [], hooks = [];
  let id = 0;
  const scope = effectScope();
  const blocked = scope.run(() => createGuard(ref, watch, player, lyrics, fn => hooks.push(fn), (fn, delay) => {
    assert.ok(delay >= 320); timers.set(++id, fn); return id;
  }, key => { const fn = timers.get(key); if (fn) removed.push(fn); timers.delete(key); }));
  let closed = false;
  const close = () => { if (closed) return; closed = true; hooks.forEach(fn => fn()); scope.stop(); };
  t.after(close);
  return { player, lyrics, blocked, timers, removed, close, flush() { const callbacks = [...timers.values()]; timers.clear(); callbacks.forEach(fn => fn()); } };
}

test('either overlay blocks the lower player until its leave transition finishes', t => {
  const f = fixture(t);
  assert.equal(f.blocked.value, false);
  f.lyrics.value = true; assert.equal(f.blocked.value, true);
  f.lyrics.value = false; assert.equal(f.blocked.value, true); assert.equal(f.timers.size, 1);
  f.flush(); assert.equal(f.blocked.value, false);
  f.player.fullscreen = true; assert.equal(f.blocked.value, true);
  f.player.fullscreen = false; assert.equal(f.blocked.value, true);
  f.flush(); assert.equal(f.blocked.value, false);
});

test('rapidly reopening or moving from lyrics to the big player cannot unlock the covered footer', t => {
  const f = fixture(t);
  f.lyrics.value = true; f.lyrics.value = false;
  const stale = [...f.timers.values()][0];
  f.player.fullscreen = true; assert.equal(f.timers.size, 0);
  stale(); assert.equal(f.blocked.value, true);
  f.lyrics.value = true; f.player.fullscreen = false;
  assert.equal(f.timers.size, 0); assert.equal(f.blocked.value, true);
  f.lyrics.value = false;
  stale(); assert.equal(f.blocked.value, true); assert.equal(f.timers.size, 1);
  f.flush(); assert.equal(f.blocked.value, false);
});

test('unmount cancels a pending footer release', t => {
  const f = fixture(t);
  f.player.fullscreen = true; f.player.fullscreen = false;
  assert.equal(f.timers.size, 1);
  f.close(); assert.equal(f.timers.size, 0);
});
