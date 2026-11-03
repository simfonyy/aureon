import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { compileScript, parse } from '@vue/compiler-sfc';
import { createRenderer, h, nextTick, reactive } from 'vue';

const data = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const compile = source => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const helperUrl = data(compile(await readFile(new URL('../src/lib/musicClips.ts', import.meta.url), 'utf8')));
const buttonsUrl = data(compile(await readFile(new URL('../src/stores/ui/playerButtons.ts', import.meta.url), 'utf8')));
const defaultsSource = compile(await readFile(new URL('../src/stores/ui/defaults.ts', import.meta.url), 'utf8'))
  .replace(/from\s+(['"])\.\/playerButtons\1/, `from '${buttonsUrl}'`);
const { defaultInterfaceSettings } = await import(data(defaultsSource));
const require = createRequire(import.meta.url), vueUrl = pathToFileURL(require.resolve('vue')).href;

// Compile the real component, including its module-scoped session memory. Only
// store adapters, icons and Quasar's popup rendering are replaced.
globalThis.__clipBackgroundControlFixture = {};
const fixtureUrl = data(`
import {h} from '${vueUrl}';
const f=()=>globalThis.__clipBackgroundControlFixture;
export const useMusicClipsStore=()=>f().clips;
export const useUiStore=()=>f().ui;
export const usePlayerStore=()=>f().player;
export default {render:()=>h('i',{'aria-hidden':'true'})};
`);
const parsed = parse(await readFile(new URL('../src/components/clips/ClipBackgroundControl.vue', import.meta.url), 'utf8'));
assert.deepEqual(parsed.errors, []);
const compiled = compileScript(parsed.descriptor, { id: 'clip-background-control-test', inlineTemplate: true });
const componentCode = compile(compiled.content).replace(/from\s+(['"])([^'"]+)\1/g, (_, quote, id) =>
  `from '${id === 'vue' ? vueUrl : id === '@/lib/musicClips' ? helperUrl : fixtureUrl}'`);
const ClipBackgroundControl = (await import(data(componentCode))).default;

function node(type, text = '') { return { type, text, children: [], props: {}, parent: null }; }
const renderer = createRenderer({
  createElement: type => node(type), createText: value => node('#text', value), createComment: value => node('#comment', value),
  insert(child, parent, anchor = null) {
    if (child.parent) this.remove(child);
    const at = anchor ? parent.children.indexOf(anchor) : -1;
    parent.children.splice(at < 0 ? parent.children.length : at, 0, child); child.parent = parent;
  },
  remove(child) {
    if (!child.parent) return;
    const at = child.parent.children.indexOf(child);
    if (at >= 0) child.parent.children.splice(at, 1);
    child.parent = null;
  },
  setText(child, text) { child.text = text; },
  setElementText(child, text) { child.text = text; child.children = []; },
  parentNode: child => child.parent,
  nextSibling: child => child.parent?.children[child.parent.children.indexOf(child) + 1] || null,
  patchProp(child, key, previous, value) { child.props[key] = value; },
});
function descendants(root) { return [root, ...root.children.flatMap(descendants)]; }
function text(root) { return root.text + root.children.map(text).join(''); }
async function settle() { for (let i = 0; i < 4; i++) { await Promise.resolve(); await nextTick(); } }
function track(id, clipIds = []) { return { id, title: `Трек ${id}`, artists: [], clip_ids: clipIds }; }
function fixture(enabled = false) {
  const calls = { metadata: [], media: [], settings: [], fullscreen: 0 };
  const clips = reactive({
    knownClipIds: {},
    async lookup(row) { calls.metadata.push(row.id); },
    async open(row) { calls.media.push(['open', row.id]); },
    async load() { calls.media.push(['load']); },
  });
  const ui = reactive({
    settings: { musicVideoBackground: enabled },
    set(key, value) { calls.settings.push([key, value]); this.settings[key] = value; },
  });
  return { clips, ui, calls, player: { openFullscreen() { calls.fullscreen++; } } };
}
function mount(t, f, initialProps) {
  globalThis.__clipBackgroundControlFixture = f;
  const props = reactive(initialProps), root = node('root');
  const app = renderer.createApp({ render: () => h(ClipBackgroundControl, props) });
  app.component('q-menu', {
    props: ['modelValue'],
    setup(props, { slots }) { return () => props.modelValue ? h('section', { 'data-popup': 'hint' }, slots.default?.()) : null; },
  });
  app.component('q-tooltip', { setup(_, { slots }) { return () => h('small', { role: 'tooltip' }, slots.default?.()); } });
  app.mount(root);
  let closed = false;
  const close = () => { if (!closed) { closed = true; app.unmount(); } };
  t.after(close);
  return {
    root, props, close,
    hasHint: () => descendants(root).some(row => row.props.role === 'status' && text(row) === 'Есть клип'),
    button(label) { return descendants(root).find(row => row.type === 'button' && (row.props['aria-label'] === label || text(row) === label)); },
    click(label) {
      const button = this.button(label); assert.ok(button, `button ${label}`);
      return button.props.onClick({ stopPropagation() {} });
    },
  };
}

test('video backgrounds are opt-in for a fresh user', () => {
  assert.equal(defaultInterfaceSettings.musicVideoBackground, false);
});

test('inactive surfaces stay silent and do not consume the track hint', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(), view = mount(t, f, { track: track('81001', ['51']), active: false });
  assert.equal(view.hasHint(), false); assert.equal(view.button('Включить клип на фоне'), undefined);
  assert.deepEqual(f.calls.metadata, []); assert.deepEqual(f.calls.media, []);
  view.props.active = true; await settle();
  assert.equal(view.hasHint(), true); assert.deepEqual(f.calls.metadata, []);
  view.props.active = false; await settle();
  assert.equal(view.hasHint(), false);
  view.props.active = true; await settle();
  assert.equal(view.hasHint(), false);
});

test('only the active remote track requests metadata; discovery does not start media', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(), view = mount(t, f, { track: track('81002:91002'), active: false });
  assert.deepEqual(f.calls.metadata, []);
  view.props.active = true; await settle();
  assert.deepEqual(f.calls.metadata, ['81002:91002']); assert.equal(view.hasHint(), false);
  f.clips.knownClipIds['81002'] = ['52']; await settle();
  assert.equal(view.hasHint(), true); assert.deepEqual(f.calls.media, []);
  assert.deepEqual(f.calls.settings, []); assert.equal(f.calls.fullscreen, 0);
  view.props.active = false; view.props.track = track('81003'); await settle();
  f.clips.knownClipIds['81003'] = ['53']; await settle();
  assert.deepEqual(f.calls.metadata, ['81002:91002']); assert.equal(view.hasHint(), false);
});

test('a hint is shared across player and lyrics and remains dismissed after remount', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(), first = mount(t, f, { track: track('81004:91004', ['54']), active: true, openPlayer: true });
  const second = mount(t, f, { track: track('81004', ['54']), active: true });
  assert.equal(first.hasHint(), true); assert.equal(second.hasHint(), false);
  first.click('Закрыть подсказку о клипе'); await settle();
  assert.equal(first.hasHint(), false); first.close(); second.close();
  const reopened = mount(t, f, { track: track('81004', ['54']), active: true });
  assert.equal(reopened.hasHint(), false);
  reopened.props.track = track('81005', ['55']); await settle();
  assert.equal(reopened.hasHint(), true); assert.deepEqual(f.calls.media, []);
});

test('enabling from the bottom player stores consent and opens fullscreen once', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(), view = mount(t, f, { track: track('81006', ['56']), active: true, openPlayer: true });
  view.click('Показать на фоне'); await settle();
  assert.deepEqual(f.calls.settings, [['musicVideoBackground', true]]);
  assert.equal(f.ui.settings.musicVideoBackground, true); assert.equal(f.calls.fullscreen, 1);
  assert.equal(view.hasHint(), false); assert.equal(view.button('Выключить клип на фоне').props['aria-pressed'], true);
  assert.deepEqual(f.calls.metadata, []); assert.deepEqual(f.calls.media, []);
  view.click('Выключить клип на фоне'); await settle();
  assert.deepEqual(f.calls.settings, [['musicVideoBackground', true], ['musicVideoBackground', false]]);
  assert.equal(f.calls.fullscreen, 1); assert.equal(view.hasHint(), false);
});

test('enabling within lyrics keeps the current surface and the toggle can disable it', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(), view = mount(t, f, { track: track('81007', ['57']), active: true });
  view.click('Включить клип на фоне'); await settle();
  assert.deepEqual(f.calls.settings, [['musicVideoBackground', true]]);
  assert.equal(f.calls.fullscreen, 0); assert.equal(view.hasHint(), false);
  view.click('Выключить клип на фоне'); await settle();
  assert.equal(f.ui.settings.musicVideoBackground, false); assert.equal(f.calls.fullscreen, 0);
  assert.deepEqual(f.calls.media, []);
});

test('hints expire without reopening and unmount cancels their timer', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(), view = mount(t, f, { track: track('81008', ['58']), active: true });
  assert.equal(view.hasHint(), true);
  t.mock.timers.tick(8999); await settle(); assert.equal(view.hasHint(), true);
  t.mock.timers.tick(1); await settle(); assert.equal(view.hasHint(), false);
  view.props.track = track('81009', ['59']); await settle(); assert.equal(view.hasHint(), true);
  view.close(); t.mock.timers.tick(9000); await settle();
  assert.deepEqual(f.calls.settings, []); assert.deepEqual(f.calls.media, []);
});

test('local tracks and tracks without clips cannot expose a video control', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(), local = mount(t, f, { track: track('local:' + 'a'.repeat(64), ['60']), active: true });
  assert.equal(local.hasHint(), false); assert.equal(local.button('Включить клип на фоне'), undefined);
  assert.deepEqual(f.calls.metadata, []);
  const remote = mount(t, f, { track: track('81010'), active: true });
  assert.deepEqual(f.calls.metadata, ['81010']); assert.equal(remote.hasHint(), false);
  f.clips.knownClipIds['81010'] = []; await settle();
  assert.equal(remote.button('Включить клип на фоне'), undefined); assert.deepEqual(f.calls.media, []);
});

test('an already enabled background does not show a new consent hint', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(true), view = mount(t, f, { track: track('81011', ['61']), active: true, openPlayer: true });
  assert.equal(view.hasHint(), false); assert.ok(view.button('Выключить клип на фоне'));
  assert.deepEqual(f.calls.settings, []); assert.deepEqual(f.calls.media, []); assert.equal(f.calls.fullscreen, 0);
});
