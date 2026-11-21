import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import * as vue from 'vue';

const compile = source => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const helperSource = await readFile(new URL('../src/lib/coverPalette.ts', import.meta.url), 'utf8');
const palette = await import('data:text/javascript;base64,' + Buffer.from(compile(helperSource)).toString('base64'));
const rgb = color => color.slice(1).match(/../g).map(channel => Number.parseInt(channel, 16));
const flush = () => new Promise(resolve => setImmediate(resolve));

test('cover colors keep text readable for bright, dark, saturated and monochrome art', () => {
  for (let red = 0; red <= 255; red += 51) {
    for (let green = 0; green <= 255; green += 51) {
      for (let blue = 0; blue <= 255; blue += 51) {
        const result = palette.paletteFromColors([[red, green, blue]]);
        assert.ok(palette.contrastRatio(rgb(result.accent), rgb(result.onAccent)) >= 4.5);
        assert.ok(palette.contrastRatio(rgb(result.dark), rgb(result.onDark)) >= 7);
        assert.ok(palette.contrastRatio(rgb(result.light), rgb(result.onLight)) >= 7);
      }
    }
  }
  assert.equal(palette.paletteFromColors([[128, 128, 128]]).accent, '#808080');
  assert.equal(palette.paletteFromColors([[0, 0, 0]]).accent, '#000000');
  assert.equal(palette.paletteFromColors([[255, 255, 255]]).accent, '#ffffff');
});

test('missing colors leave existing theme variables untouched and invalid samples are ignored', () => {
  assert.equal(palette.paletteFromColors([]), null);
  assert.equal(palette.paletteFromColors([[Number.NaN, 0, 0], [], undefined]), null);
  assert.deepEqual(palette.coverPaletteStyle(null), {});
  const result = palette.paletteFromColors([[300, -10, 14.4], [260, -1, 14], [25, 140, 180]]);
  assert.equal(result.dominant, '#ff000e');
  const style = palette.coverPaletteStyle(result);
  assert.equal(style['--cover-on-accent'], result.onAccent);
  assert.ok(Object.keys(style).every(key => key.startsWith('--cover-')));
  assert.equal(Object.hasOwn(style, '--accent'), false);
});

test('art views share in-flight extraction and the cache evicts the least recently used source', async () => {
  const calls = new Map();
  let release;
  const loader = palette.createCoverPaletteLoader(async source => {
    calls.set(source, (calls.get(source) ?? 0) + 1);
    if (source === 'first' && calls.get(source) === 1) await new Promise(resolve => { release = resolve; });
    return [[20, 100, 160]];
  }, 2);
  const first = loader.load('first');
  const duplicate = loader.load(' first ');
  assert.equal(first, duplicate);
  await flush(); release();
  assert.equal(await first, await duplicate);
  await loader.load('second');
  await loader.load('first');
  await loader.load('third');
  assert.equal(loader.size, 2);
  await loader.load('second');
  assert.equal(calls.get('first'), 1);
  assert.equal(calls.get('second'), 2);
});

test('CORS/canvas failures use a short-lived fallback and can recover without restarting', async t => {
  let now = 1000, calls = 0;
  t.mock.method(Date, 'now', () => now);
  const loader = palette.createCoverPaletteLoader(async () => {
    calls++;
    if (calls === 1) throw new DOMException('Cross-origin canvas is unreadable', 'SecurityError');
    return [[120, 45, 30]];
  });
  assert.equal(await loader.load('cover'), null);
  assert.equal(await loader.load('cover'), null);
  assert.equal(calls, 1);
  now += 15_001;
  assert.ok(await loader.load('cover'));
  assert.equal(calls, 2);
  assert.equal(await loader.load(''), null);
  assert.equal(calls, 2);
});

test('a failed anonymous image request does not escape the default extraction loader', async t => {
  const previousImage = Object.getOwnPropertyDescriptor(globalThis, 'Image');
  const requests = [];
  globalThis.Image = class {
    set src(value) {
      requests.push({ value, crossOrigin: this.crossOrigin });
      queueMicrotask(() => this.onerror?.());
    }
  };
  t.after(() => {
    if (previousImage) Object.defineProperty(globalThis, 'Image', previousImage);
    else delete globalThis.Image;
  });
  const loader = palette.createCoverPaletteLoader();
  assert.equal(await loader.load('https://covers.invalid/unavailable.jpg'), null);
  assert.deepEqual(requests, [{ value: 'https://covers.invalid/unavailable.jpg', crossOrigin: 'anonymous' }]);
});

test('changing cover or leaving the view rejects late palette results', async t => {
  const pending = new Map();
  globalThis.paletteViewFixture = {
    vue,
    getCoverPalette: source => new Promise(resolve => pending.set(source, resolve)),
    coverPaletteStyle: palette.coverPaletteStyle,
  };
  t.after(() => { delete globalThis.paletteViewFixture; });
  const source = await readFile(new URL('../src/composables/useCoverPalette.ts', import.meta.url), 'utf8');
  const compiled = compile(source)
    .replace(/import\s*\{([^}]+)\}\s*from\s*['"]vue['"];?/g, (_, names) => `const {${names}} = globalThis.paletteViewFixture.vue;`)
    .replace(/import\s*\{([^}]+)\}\s*from\s*['"]@\/lib\/coverPalette['"];?/g, (_, names) => `const {${names}} = globalThis.paletteViewFixture;`);
  const { useCoverPalette } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));
  const scope = vue.effectScope(), url = vue.ref('first');
  const result = scope.run(() => useCoverPalette(url));
  t.after(() => scope.stop());
  assert.equal(result.pending.value, true);
  url.value = 'second'; await vue.nextTick();
  const second = palette.paletteFromColors([[35, 95, 145]]);
  pending.get('second')(second); await flush();
  assert.equal(result.pending.value, false);
  assert.equal(result.palette.value.accent, second.accent);
  pending.get('first')(palette.paletteFromColors([[240, 30, 20]])); await flush();
  assert.equal(result.palette.value.accent, second.accent);
  url.value = ''; await vue.nextTick();
  assert.equal(result.palette.value, null);
  assert.equal(result.pending.value, false);
  assert.deepEqual(result.style.value, {});
  url.value = 'third'; await vue.nextTick(); scope.stop();
  pending.get('third')(second); await flush();
  assert.equal(result.palette.value, null);
  assert.equal(result.pending.value, false);
});
