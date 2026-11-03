import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { compileScript, parse } from '@vue/compiler-sfc';
import { createSSRApp, h } from 'vue';
import { renderToString } from '@vue/server-renderer';
const require = createRequire(import.meta.url), vueUrl = pathToFileURL(require.resolve('vue')).href;
const data = text => `data:text/javascript;base64,${Buffer.from(text).toString('base64')}`;
function js(source) { return ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText; }
const calls = [], storage = new Map();
globalThis.__aureonUiFixture = {
  api: { artist: async id => { calls.push(id); return { cover_url: `https://covers.test/${id}` }; } },
  library: { liked: () => false, playlists: [], membershipLoading: false },
  player: {}, ui: { settings: { censorBypass: false } }, router: { push: () => {} },
};
const fixtureUrl = data(`export const api=globalThis.__aureonUiFixture.api; export const Notify={create(){}}; export const useRouter=()=>globalThis.__aureonUiFixture.router; export const useLibraryStore=()=>globalThis.__aureonUiFixture.library; export const usePlayerStore=()=>globalThis.__aureonUiFixture.player; export const useUiStore=()=>globalThis.__aureonUiFixture.ui; export const useMusicClipsStore=()=>({knownClipIds:{'123':['17']},open(){}}); export const artistNames=artists=>artists.map(a=>a.name).join(', '); export const formatDuration=()=>''; export const openTrackLyrics=()=>{}; export const clearOverride=()=>{}; export const getOverride=()=>null; export const setOverride=()=>{}; export const ensureCensorList=async()=>{}; export const isCensored=()=>false; export const prefersOriginal=()=>false; export default {render(){return null}};`);
const avatarSource = js((await readFile(new URL('../src/lib/artistAvatar.ts', import.meta.url), 'utf8')).replace('"@/api/client"', `'${fixtureUrl}'`));
const avatarUrl = data(avatarSource), avatars = await import(avatarUrl);
const clipsUrl = data(js(await readFile(new URL('../src/lib/musicClips.ts', import.meta.url), 'utf8')));

async function component(path) {
  const source = await readFile(new URL(path, import.meta.url), 'utf8');
  const { descriptor } = parse(source), compiled = compileScript(descriptor, { id: 'local-ui-test', inlineTemplate: true });
  const result = js(compiled.content).replace(/from\s+(['"])([^'"]+)\1/g, (_, quote, id) => `from '${id === 'vue' ? vueUrl : id === '@/lib/artistAvatar' ? avatarUrl : id === '@/lib/musicClips' ? clipsUrl : fixtureUrl}'`);
  return (await import(data(result))).default;
}
const TrackMenu = await component('../src/components/TrackMenu.vue'), ArtistsLine = await component('../src/components/ArtistsLine.vue');
async function html(component, props) {
  const app = createSSRApp(component, props);
  const contents = { setup(_, { slots }) { return () => h('div', slots.default?.()); } };
  app.component('q-menu', contents); app.component('q-dialog', { props: ['modelValue'], setup(props, { slots }) { return () => props.modelValue ? h('div', slots.default?.()) : null; } });
  app.component('q-spinner', { render: () => null }); app.directive('close-popup', { getSSRProps: () => ({}) });
  return renderToString(app);
}
const track = { id: 'local:abc', title: 'Песня', artists: [{ id: 'local-artist:Имя', name: 'Имя' }], album_id: null, album_title: 'Локальный альбом', cover_url: null, duration_ms: 3000, available: true };

test('local track menu retains queue, ratings, lyrics and details while removing service-only actions', async () => {
  const result = await html(TrackMenu, { track });
  for (const label of ['Играть следующим', 'Добавить в конец очереди', 'Показать текст песни', 'О треке', 'Нравится', 'Не нравится']) assert.ok(result.includes(label), label);
  for (const label of ['Моя волна по треку', 'Похожие треки', 'Скачать', 'Добавить в плейлист', 'Поделиться', 'Перейти к исполнителю', 'Подменить версию']) assert.ok(!result.includes(label), label);
});
test('normal service track retains its existing menu actions', async () => {
  const result = await html(TrackMenu, { track: { ...track, id: '12345', artists: [{ id: '678', name: 'Артист' }] } });
  for (const label of ['Моя волна по треку', 'Похожие треки', 'Скачать', 'Добавить в плейлист', 'Поделиться', 'Перейти к исполнителю', 'Подменить версию']) assert.ok(result.includes(label), label);
});

test('a clip discovered for a compound track ID is also available from its menu', async () => {
  const result = await html(TrackMenu, { track: { ...track, id: '123:456', clip_ids: [], artists: [{ id: '789', name: 'Артист' }] } });
  assert.ok(result.includes('Клипы к треку'));
  const unavailable = await html(TrackMenu, { track: { ...track, id: '987:456', clip_ids: [], artists: [{ id: '789', name: 'Артист' }] } });
  assert.ok(!unavailable.includes('Клипы к треку'));
});
test('local artists render as plain names while remote artists retain links', async () => {
  const local = await html(ArtistsLine, { artists: track.artists }); assert.ok(local.includes('Имя')); assert.ok(!local.includes('class="link"'));
  const remote = await html(ArtistsLine, { artists: [{ id: '789', name: 'Артист' }] }); assert.ok(remote.includes('class="link"'));
});
test('local artist avatars never read legacy cached URLs or call the remote artist API', async t => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) } });
  t.after(() => { if (original) Object.defineProperty(globalThis, 'localStorage', original); else delete globalThis.localStorage; });
  storage.set('mashiro.artistAvatars', JSON.stringify({ 'local-artist:Имя': 'https://unexpected.test/image' }));
  assert.equal(avatars.cachedAvatar('local-artist:Имя'), null); assert.equal(await avatars.fetchAvatar('local-artist:Имя'), null);
  const result = await avatars.fetchAvatars(['local-artist:Имя', 'local:abc', '', '123', '123']);
  assert.deepEqual(calls, ['123']); assert.deepEqual(result, { 123: 'https://covers.test/123' });
  assert.equal(avatars.cachedAvatar('local-artist:Имя'), null);
});
