import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

test('window state tracks external maximize/restore and removes its resize listener', async () => {
  let mounted, unmount, resize;
  let maximized = true, fullscreen = false, removed = false;
  globalThis.windowStateFixture = {
    ref: value => ({ value }),
    onMounted: fn => { mounted = fn; },
    onBeforeUnmount: fn => { unmount = fn; },
    getCurrentWindow: () => ({
      isMaximized: async () => maximized,
      isFullscreen: async () => fullscreen,
      toggleMaximize: async () => { maximized = !maximized; },
      setFullscreen: async value => { fullscreen = value; },
      onResized: async fn => { resize = fn; return () => { removed = true; }; },
    }),
  };
  const source = await readFile(new URL('../src/composables/useWindowState.ts', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
    .replace(/import\s*\{([^}]+)\}\s*from\s*['"][^'"]+['"];?/g, (_, names) => `const {${names}} = globalThis.windowStateFixture;`);
  const { useWindowState } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
  const state = useWindowState();
  await mounted();
  assert.equal(state.ready.value, true);
  assert.equal(state.expanded.value, true);
  assert.equal(state.fullscreen.value, false);
  maximized = false; resize();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(state.expanded.value, false);
  await state.toggle();
  assert.equal(maximized, true);
  assert.equal(state.expanded.value, true);
  maximized = false; fullscreen = true; resize();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(state.expanded.value, true);
  assert.equal(state.fullscreen.value, true);
  await state.toggle();
  assert.equal(fullscreen, false);
  assert.equal(state.expanded.value, false);
  unmount();
  assert.equal(removed, true);
});

let fixtureNumber = 0;
const tick = () => new Promise(resolve => setImmediate(resolve));

async function fullscreenFixture({ maximized = false, fullscreen = false, beforeSet } = {}) {
  const native = { maximized, fullscreen, calls: [], removed: false };
  const hooks = {};
  const win = {
    isMaximized: async () => native.maximized,
    isFullscreen: async () => native.fullscreen,
    toggleMaximize: async () => { native.calls.push(['maximize']); native.maximized = !native.maximized; },
    setFullscreen: async value => {
      native.calls.push(['fullscreen', value]);
      await beforeSet?.(value);
      native.fullscreen = value;
    },
    onResized: async fn => { hooks.resize = fn; return () => { native.removed = true; }; },
  };
  globalThis.windowStateFixture = {
    ref: value => ({ value }),
    onMounted: fn => { hooks.mount = fn; },
    onBeforeUnmount: fn => { hooks.unmount = fn; },
    getCurrentWindow: () => win,
  };
  const source = await readFile(new URL('../src/composables/useWindowState.ts', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
    .replace(/import\s*\{([^}]+)\}\s*from\s*['"][^'"]+['"];?/g, (_, names) => `const {${names}} = globalThis.windowStateFixture;`);
  const { useWindowState } = await import(`data:text/javascript;base64,${Buffer.from(`${code}\n// fixture ${++fixtureNumber}`).toString('base64')}`);
  const state = useWindowState();
  await hooks.mount();
  return { native, hooks, state };
}

for (const maximized of [false, true]) {
  test(`lyrics fullscreen uses the native fullscreen API and retains ${maximized ? 'maximized' : 'windowed'} placement`, async () => {
    const { native, state } = await fullscreenFixture({ maximized });
    assert.equal(state.fullscreen.value, false);
    await state.toggleFullscreen();
    assert.equal(native.fullscreen, true);
    assert.equal(state.fullscreen.value, true);
    assert.equal(state.expanded.value, true);
    await state.exitFullscreen();
    assert.equal(native.fullscreen, false);
    assert.equal(state.fullscreen.value, false);
    assert.equal(state.expanded.value, maximized);
    assert.equal(native.maximized, maximized);
    assert.deepEqual(native.calls, [['fullscreen', true], ['fullscreen', false]]);
  });
}

test('rapid fullscreen clicks serialize against the native state', async () => {
  const { native, state } = await fullscreenFixture();
  await Promise.all([state.toggleFullscreen(), state.toggleFullscreen()]);
  assert.equal(native.fullscreen, false);
  assert.equal(state.fullscreen.value, false);
  assert.deepEqual(native.calls, [['fullscreen', true], ['fullscreen', false]]);
});

test('closing lyrics during fullscreen entry restores the native window after entry completes', async () => {
  let release;
  const wait = new Promise(resolve => { release = resolve; });
  const { native, hooks, state } = await fullscreenFixture({ beforeSet: value => value ? wait : undefined });
  const entering = state.toggleFullscreen();
  await tick();
  hooks.unmount();
  release();
  await entering;
  await tick();
  assert.equal(native.fullscreen, false);
  assert.equal(native.removed, true);
  assert.deepEqual(native.calls, [['fullscreen', true], ['fullscreen', false]]);
});

test('disposing a titlebar observer does not exit fullscreen owned by another view', async () => {
  const { native, hooks } = await fullscreenFixture({ fullscreen: true });
  hooks.unmount();
  await tick();
  assert.equal(native.fullscreen, true);
  assert.deepEqual(native.calls, []);
});

test('a rejected native fullscreen change leaves the observed state intact and can be retried', async () => {
  let reject = true;
  const { native, state } = await fullscreenFixture({ beforeSet: () => { if (reject) throw new Error('denied'); } });
  await state.toggleFullscreen();
  assert.equal(native.fullscreen, false);
  assert.equal(state.fullscreen.value, false);
  reject = false;
  await state.toggleFullscreen();
  assert.equal(native.fullscreen, true);
  assert.equal(state.fullscreen.value, true);
});

test('lyrics shortcuts respect an already handled F11 and Escape leaves native fullscreen before closing lyrics', async () => {
  const source = await readFile(new URL('../src/components/LyricsPanel.vue', import.meta.url), 'utf8');
  const start = source.indexOf('function onHintKey(');
  const end = source.indexOf('window.addEventListener("pointerdown"', start);
  assert.ok(start > 0 && end > start);
  const code = ts.transpileModule(source.slice(start, end), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const actions = [];
  const nativeFullscreen = { value: true };
  const scope = {
    hint: { value: null }, showSettings: { value: false }, annotationOpen: { value: false }, nativeFullscreen,
    document: { querySelector: () => null },
    toggleWindow: () => actions.push('toggle'),
    exitFullscreen: () => actions.push('exit'),
    player: { closeLyrics: () => actions.push('close') },
  };
  const handler = new Function('scope', `const {hint, showSettings, annotationOpen, nativeFullscreen, document, toggleWindow, exitFullscreen, player} = scope;\n${code}\nreturn onHintKey;`)(scope);
  const event = (key, defaultPrevented = false) => ({ key, defaultPrevented, repeat: false, altKey: false, ctrlKey: false, metaKey: false, preventDefault() { this.defaultPrevented = true; } });
  handler(event('F11', true));
  assert.deepEqual(actions, []);
  const unhandled = event('F11');
  handler(unhandled);
  assert.equal(unhandled.defaultPrevented, true);
  assert.deepEqual(actions, ['toggle']);
  handler(event('Escape'));
  assert.deepEqual(actions, ['toggle', 'exit']);
  nativeFullscreen.value = false;
  handler(event('Escape'));
  assert.deepEqual(actions, ['toggle', 'exit', 'close']);
});
