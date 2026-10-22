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
  maximized = false; resize();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(state.expanded.value, false);
  await state.toggle();
  assert.equal(maximized, true);
  assert.equal(state.expanded.value, true);
  maximized = false; fullscreen = true; resize();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(state.expanded.value, true);
  await state.toggle();
  assert.equal(fullscreen, false);
  assert.equal(state.expanded.value, false);
  unmount();
  assert.equal(removed, true);
});
