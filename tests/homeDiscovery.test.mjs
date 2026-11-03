import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { compileScript, parse } from '@vue/compiler-sfc';
import { createRenderer, h, nextTick, reactive } from 'vue';

const data = code => 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
const js = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const helperUrl = data(js(await readFile(new URL('../src/lib/homeDiscovery.ts', import.meta.url), 'utf8')));
const { discoveryAlbums, discoveryChart, discoveryCacheKey, releaseDateLabel } = await import(helperUrl);
const album = (id = '1') => ({ id, title: `Альбом ${id}`, artists: [{ id: '2', name: 'Артист' }], cover_url: null, year: 2026, release_date: '2026-11-02T00:00:00+03:00' });
const track = (id = '3') => ({ id, title: `Трек ${id}`, artists: [{ id: '2', name: 'Артист' }], cover_url: null, album_id: null, album_title: null, duration_ms: 180000, available: true });
const payload = (overrides = {}) => ({ new_releases: [], chart: [], new_releases_error: null, chart_error: null, ...overrides });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

test('cache keys separate accounts, and malformed cache rows cannot become chart tracks', () => {
  assert.equal(discoveryCacheKey(1, 'releases'), 'home.discovery.1.releases.v1');
  assert.equal(discoveryCacheKey(1, 'chart'), 'home.discovery.1.chart.russia.v1');
  assert.notEqual(discoveryCacheKey(1, 'chart'), discoveryCacheKey(2, 'chart'));
  assert.notEqual(discoveryCacheKey(1, 'chart'), discoveryCacheKey(1, 'releases'));
  for (const uid of [null, undefined, 0, -1, NaN, Infinity, 1.1, '1']) assert.equal(discoveryCacheKey(uid, 'releases'), null);
  assert.deepEqual(discoveryAlbums([album(), null, album(), album('../1'), { ...album('2'), artists: null }, album('4')]).map(row => row.id), ['1', '4']);
  assert.deepEqual(discoveryChart([track(), track(), { ...track('4'), available: false }, { ...track('5'), duration_ms: NaN }, { ...track('6'), album_id: {} }, track('7')]).map(row => row.id), ['3', '7']);
  assert.equal(discoveryChart(Array.from({ length: 100 }, (_, i) => track(String(i + 1)))).length, 40);
  assert.equal(discoveryAlbums(Array.from({ length: 100 }, (_, i) => album(String(i + 1)))).length, 40);
});

test('release date uses the calendar date of the release and rejects impossible cached dates', () => {
  assert.equal(releaseDateLabel('2026-11-02T00:00:00+14:00'), '2 ноября');
  assert.equal(releaseDateLabel('2026-02-30'), '');
  assert.equal(releaseDateLabel(null), '');
  assert.equal(releaseDateLabel('not a date'), '');
});

// Run the actual component setup and event handlers. Only browser adapters are
// replaced, so request lifecycle, Pinia-facing state and cache logic stay real.
const require = createRequire(import.meta.url), vueUrl = pathToFileURL(require.resolve('vue')).href;
globalThis.__homeDiscoveryFixture = {};
const fixtureUrl = data(`
import {h} from '${vueUrl}';
const f=()=>globalThis.__homeDiscoveryFixture;
export const api={homeDiscovery:()=>f().api.homeDiscovery(),album:id=>f().api.album(id)};
export const useAuthStore=()=>f().auth;
export const usePlayerStore=()=>f().player;
export const useRouter=()=>({push:path=>f().routes.push(path)});
export const Notify={create:notice=>f().notices.push(notice)};
export const readCache=key=>f().cache.get(key)??null;
export const writeCache=(key,value)=>f().cache.set(key,value);
export const artistNames=rows=>rows.map(row=>row.name).join(', ');
export const beginAlbumCoverTransition=()=>{};
export default {props:['label','track','index'],emits:['play'],setup(props,{slots,emit}){return()=>props.track?h('button',{'data-track':props.track.id,onClick:()=>emit('play')},props.track.title):h('div',{},slots.default?.());}};
`);
const source = await readFile(new URL('../src/components/home/HomeDiscovery.vue', import.meta.url), 'utf8');
const parsed = parse(source); assert.deepEqual(parsed.errors, []);
const compiled = compileScript(parsed.descriptor, { id: 'home-discovery-test', inlineTemplate: true });
const code = js(compiled.content).replace(/from\s+(['"])([^'"]+)\1/g, (_, quote, id) => `from '${id === 'vue' ? vueUrl : id === '@/lib/homeDiscovery' ? helperUrl : fixtureUrl}'`);
const HomeDiscovery = (await import(data(code))).default;
function node(type, text = '') { return { type, text, children: [], props: {}, parent: null }; }
const renderer = createRenderer({
  createElement: type => node(type), createText: value => node('#text', value), createComment: value => node('#comment', value),
  insert(child, parent, anchor = null) { if (child.parent) this.remove(child); const at = anchor ? parent.children.indexOf(anchor) : -1; parent.children.splice(at < 0 ? parent.children.length : at, 0, child); child.parent = parent; },
  remove(child) { if (child.parent) { const at = child.parent.children.indexOf(child); if (at >= 0) child.parent.children.splice(at, 1); child.parent = null; } },
  setText(child, text) { child.text = text; }, setElementText(child, text) { child.text = text; child.children = []; },
  parentNode: child => child.parent, nextSibling: child => child.parent?.children[child.parent.children.indexOf(child) + 1] || null,
  patchProp(child, key, oldValue, value) { child.props[key] = value; },
});
function descendants(root) { return [root, ...root.children.flatMap(descendants)]; }
function text(root) { return root.text + root.children.map(text).join(''); }
async function settle() { for (let i = 0; i < 5; i++) { await Promise.resolve(); await nextTick(); } }
function mount(fixture) {
  globalThis.__homeDiscoveryFixture = fixture;
  const root = node('root'), app = renderer.createApp(HomeDiscovery);
  app.component('q-spinner', { render: () => h('i') }); app.mount(root);
  return { root, close: () => app.unmount(), click: label => { const button = descendants(root).find(row => row.type === 'button' && (text(row) === label || row.props['aria-label'] === label)); assert.ok(button, `button ${label}`); return button.props.onClick({ stopPropagation() {} }); } };
}
function fixture(request) {
  return { auth: reactive({ profile: { uid: 11 } }), cache: new Map(), notices: [], routes: [], played: [], api: { homeDiscovery: request, album: async () => ({ tracks: [] }) }, player: { current: null, playQueue: async function (...args) { globalThis.__homeDiscoveryFixture.played.push(args); } } };
}

test('Russia chart ignores the old geo chart cache and restores only the Russia-scoped cache', async () => {
  const first = deferred(), f = fixture(() => first.promise);
  f.cache.set('home.discovery.11.chart.v1', [track('71')]);
  f.cache.set('home.discovery.11.releases.v1', [album('73')]);
  const uncached = mount(f); await settle();
  assert.ok(text(uncached.root).includes('Чарт России'));
  assert.ok(text(uncached.root).includes('Альбом 73'));
  assert.ok(!text(uncached.root).includes('Трек 71'));
  assert.equal(descendants(uncached.root).filter(row => row.props['data-track']).length, 0);
  uncached.close(); first.resolve(payload()); await settle();

  const second = deferred(); f.api.homeDiscovery = () => second.promise;
  f.cache.set('home.discovery.11.chart.russia.v1', [track('72')]);
  const restored = mount(f); await settle();
  assert.ok(text(restored.root).includes('Трек 72'));
  assert.ok(!text(restored.root).includes('Трек 71'));
  assert.ok(text(restored.root).includes('Альбом 73'));
  restored.close(); second.resolve(payload()); await settle();
});

test('partial failure retains last successful releases, updates chart, and a successful empty retry clears releases', async () => {
  const requests = [deferred(), deferred()]; let request = 0;
  const f = fixture(() => requests[request++].promise);
  f.cache.set(discoveryCacheKey(11, 'releases'), [album('8')]);
  const view = mount(f); await settle();
  requests[0].resolve(payload({ new_releases_error: 'Не удалось обновить релизы.', chart: [track('9'), { ...track('10'), available: false }] })); await settle();
  assert.ok(text(view.root).includes('Альбом 8')); assert.ok(text(view.root).includes('Трек 9')); assert.ok(!text(view.root).includes('Трек 10'));
  assert.deepEqual(f.cache.get(discoveryCacheKey(11, 'releases')).map(row => row.id), ['8']);
  view.click('Повторить'); requests[1].resolve(payload()); await settle();
  assert.ok(!text(view.root).includes('Альбом 8')); assert.deepEqual(f.cache.get(discoveryCacheKey(11, 'releases')), []);
  view.close();
});

test('late requests after account switch or unmount cannot write another account cache', async () => {
  const requests = [deferred(), deferred()]; let request = 0;
  const f = fixture(() => requests[request++].promise), view = mount(f); await settle();
  f.auth.profile = { uid: 22 }; await settle();
  requests[0].resolve(payload({ new_releases: [album('1')] })); await settle();
  assert.equal(f.cache.has(discoveryCacheKey(11, 'releases')), false); assert.ok(!text(view.root).includes('Альбом 1'));
  view.close(); requests[1].resolve(payload({ new_releases: [album('2')] })); await settle();
  assert.equal(f.cache.has(discoveryCacheKey(22, 'releases')), false);
});

test('first-load partial releases remain visible without replacing the last-good cache', async () => {
  const f = fixture(async () => payload({ new_releases: [album('5')], new_releases_error: 'Не удалось загрузить часть новинок (1)' }));
  const view = mount(f); await settle();
  assert.ok(text(view.root).includes('Альбом 5')); assert.ok(text(view.root).includes('часть новинок'));
  assert.equal(f.cache.has(discoveryCacheKey(11, 'releases')), false);
  view.close();
});

test('chart starts the complete ordered queue and supersedes a pending album click', async () => {
  const albumRequest = deferred();
  const rows = Array.from({ length: 12 }, (_, i) => track(String(i + 20)));
  const f = fixture(async () => payload({ new_releases: [album('8')], chart: rows })); f.api.album = () => albumRequest.promise;
  const view = mount(f); await settle();
  assert.equal(descendants(view.root).filter(row => row.props['data-track']).length, 10);
  view.click('Все треки'); await settle(); assert.equal(descendants(view.root).filter(row => row.props['data-track']).length, 12);
  view.click('Слушать: Альбом 8'); await settle();
  await descendants(view.root).find(row => row.props['data-track'] === '23').props.onClick();
  albumRequest.resolve({ tracks: [track('99')] }); await settle();
  assert.equal(f.played.length, 1); assert.deepEqual(f.played[0][0].map(row => row.id), rows.map(row => row.id)); assert.equal(f.played[0][1], 3);
  view.close();
});
