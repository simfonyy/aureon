import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createPinia } from 'pinia';
import ts from 'typescript';

// Exercise the real store and persistence; only its browser CSS adapter is replaced.
const modules = new Map();
async function moduleUrl(file) {
  if (modules.has(file.href)) return modules.get(file.href);
  const pending = (async () => {
    if (file.pathname.endsWith('/apply.ts')) return 'data:text/javascript,export function applyInterfaceSettings() {}';
    let code = ts.transpileModule(await readFile(file, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText;
    const imports = [...code.matchAll(/\bfrom\s+(['"])([^'"]+)\1/g)];
    for (const match of imports) {
      const specifier = match[2];
      const url = specifier.startsWith('.')
        ? await moduleUrl(new URL(specifier + '.ts', file))
        : import.meta.resolve(specifier);
      code = code.replaceAll(match[0], match[0].replace(specifier, url));
    }
    return 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
  })();
  modules.set(file.href, pending);
  return pending;
}
const { useUiStore } = await import(await moduleUrl(new URL('../src/stores/ui/index.ts', import.meta.url)));
const key = 'mashiro.interface';

function storedSettings(t, initial) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map([[key, JSON.stringify(initial)]]);
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) },
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete globalThis.localStorage;
  });
  return values;
}

test('word accents are enabled for old settings without changing other preferences', t => {
  storedSettings(t, { theme: 'plum', animations: false });
  const ui = useUiStore(createPinia());
  assert.equal(ui.settings.lyricsFxEnabled, true);
  assert.equal(ui.settings.theme, 'plum');
  assert.equal(ui.settings.animations, false);
});

test('disabling word accents persists across a fresh store', t => {
  const saved = storedSettings(t, { theme: 'graphite' });
  const ui = useUiStore(createPinia());
  ui.set('lyricsFxEnabled', false);
  assert.equal(JSON.parse(saved.get(key)).lyricsFxEnabled, false);
  const restarted = useUiStore(createPinia());
  assert.equal(restarted.settings.lyricsFxEnabled, false);
  assert.equal(restarted.settings.theme, 'graphite');
});

test('damaged effect flag uses its default while valid fields survive', t => {
  storedSettings(t, { lyricsFxEnabled: 'false', theme: 'forest', lyricsMotion: false });
  const ui = useUiStore(createPinia());
  assert.equal(ui.settings.lyricsFxEnabled, true);
  assert.equal(ui.settings.theme, 'forest');
  assert.equal(ui.settings.lyricsMotion, false);
});

test('resetting lyrics restores the effect flag without resetting appearance', t => {
  const saved = storedSettings(t, { lyricsFxEnabled: false, theme: 'midnight', animations: false });
  const ui = useUiStore(createPinia());
  ui.resetLyrics();
  assert.equal(ui.settings.lyricsFxEnabled, true);
  assert.equal(JSON.parse(saved.get(key)).lyricsFxEnabled, true);
  assert.equal(ui.settings.theme, 'midnight');
  assert.equal(ui.settings.animations, false);
});
