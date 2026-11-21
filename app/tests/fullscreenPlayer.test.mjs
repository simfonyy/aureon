import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

let fixtureId = 0;
const flush = () => new Promise(resolve => setImmediate(resolve));

async function fullscreenFixture(query = async () => true) {
  let timerId = 0;
  const timers = new Map(), watches = [], nativeCalls = [];
  const player = { fullscreen: true, closeFullscreen() { this.fullscreen = false; } };
  const fixture = {
    timers, watches,
    ref: value => ({ value }),
    computed: get => ({ get value() { return get(); } }),
    watch: (get, callback) => watches.push({ get, callback }),
    onMounted() {},
    onBeforeUnmount: fn => { fixture.unmount = fn; },
    usePlayerStore: () => player,
    useUiStore: () => ({ settings: { musicVideoBackground: false } }),
    Notify: { create() {} },
    largeCoverUrl: value => value || '',
    useLibraryStore: () => ({}),
    useRoute: () => ({ fullPath: '/' }),
    isNativeFullscreen: query,
    setNativeFullscreen: async value => { nativeCalls.push(value); return true; },
  };
  fixture.window = {
    setTimeout: callback => { const id = ++timerId; timers.set(id, callback); return id; },
    clearTimeout: id => timers.delete(id),
    addEventListener() {}, removeEventListener() {},
  };
  fixture.runTimers = () => { const pending = [...timers.values()]; timers.clear(); pending.forEach(callback => callback()); };
  const source = await readFile(new URL('../src/components/FullscreenPlayer.vue', import.meta.url), 'utf8');
  const script = source.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1];
  const key = `fullscreenPlayerFixture${++fixtureId}`;
  globalThis[key] = fixture;
  const preamble = `const fixture = globalThis.${key};\nconst { window } = fixture;\n`;
  const code = ts.transpileModule(preamble + script + '\nexport const harness = { native, close };', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
    .replace(/import\s*\{([^}]+)\}\s*from\s*['"][^'"]+['"];?/g, (_, names) => `const {${names}} = fixture;`)
    .replace(/import\s+\w+\s+from\s*['"][^'"]+['"];?/g, '');
  const { harness } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
  const openWatcher = watches.find(watch => typeof watch.get() === 'boolean');
  const open = value => { player.fullscreen = value; openWatcher.callback(value); };
  return { fixture, harness, nativeCalls, open };
}

test('reopening the big player cancels the previous delayed native fullscreen exit', async () => {
  const { fixture, harness, nativeCalls, open } = await fullscreenFixture();
  harness.native.value = true;
  harness.close(); open(false);
  assert.equal(fixture.timers.size, 1);
  open(true); await flush();
  assert.equal(fixture.timers.size, 0);
  fixture.runTimers();
  assert.deepEqual(nativeCalls, []);
  assert.equal(harness.native.value, true);
  fixture.unmount();
});

test('a closed big player still exits native fullscreen after its leave transition', async () => {
  const { fixture, harness, nativeCalls, open } = await fullscreenFixture();
  harness.native.value = true;
  harness.close(); open(false); fixture.runTimers();
  assert.deepEqual(nativeCalls, [false]);
  fixture.unmount();
});

test('a stale native fullscreen query cannot update the state after closing', async () => {
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const { fixture, harness, open } = await fullscreenFixture(() => pending);
  open(true); harness.close(); open(false);
  resolve(true); await flush();
  assert.equal(harness.native.value, false);
  fixture.unmount();
});
