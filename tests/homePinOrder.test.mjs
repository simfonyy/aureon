import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createPinia } from 'pinia';
import ts from 'typescript';

// Use the real store; requests and notifications are browser adapters only.
const bridge = { api: { playlistDelete: async () => {} }, notifications: [] };
globalThis.__homePinStoreBridge = bridge;
const ratingsSource=await readFile(new URL('../src/lib/localRatings.ts',import.meta.url),'utf8');
const ratingsCode=ts.transpileModule(ratingsSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const ratingsUrl='data:text/javascript;base64,'+Buffer.from(ratingsCode).toString('base64');
let source = await readFile(new URL('../src/stores/library.ts', import.meta.url), 'utf8');
source = source
  .replace("'@/lib/localRatings'",JSON.stringify(ratingsUrl))
  .replace('import { Notify } from "quasar";', 'const Notify = { create: (notice: unknown) => globalThis.__homePinStoreBridge.notifications.push(notice) };')
  .replace('import { api } from "@/api/client";', 'const api = globalThis.__homePinStoreBridge.api;');
const code = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText.replace('from "pinia"', `from ${JSON.stringify(import.meta.resolve('pinia'))}`);
const { useLibraryStore } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));

const pinKey = 'mashiro.pinned';
const homeKey = 'mashiro.homePinnedOrder';
const hideKey = 'mashiro.hiddenPlaylists';
const playlists = [30, 20, 10].map(kind => ({
  kind, title: `Плейлист ${kind}`, track_count: kind, cover_url: null, owner_uid: 1,
}));

function storedLibrary(t, homeOrder = [], hidden = []) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map([
    [pinKey, JSON.stringify([10, 20, 30])],
    [homeKey, JSON.stringify(homeOrder)],
    [hideKey, JSON.stringify(hidden)],
  ]);
  let rejectHomeWrite = false;
  bridge.notifications.length = 0;
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => {
        if (rejectHomeWrite && key === homeKey) throw new Error('Storage full');
        values.set(key, value);
      },
    },
  });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else delete globalThis.localStorage;
  });
  const store = useLibraryStore(createPinia());
  store.playlists = structuredClone(playlists);
  return { store, values, rejectHomeWrites: () => { rejectHomeWrite = true; } };
}

test('home order survives restart without changing sidebar or service playlist order', t => {
  const { store, values } = storedLibrary(t);
  assert.equal(store.setHomePinOrder([30, 10, 20]), true);
  assert.deepEqual(store.homePinOrder, [30, 10, 20]);
  assert.deepEqual(JSON.parse(values.get(homeKey)), [30, 10, 20]);
  assert.deepEqual(store.pinned, [10, 20, 30]);
  assert.deepEqual(store.sortedPlaylists.map(item => item.kind), [10, 20, 30]);
  assert.deepEqual(store.playlists.map(item => item.kind), [30, 20, 10]);
  const restarted = useLibraryStore(createPinia());
  assert.deepEqual(restarted.homePinOrder, [30, 10, 20]);
  assert.deepEqual(restarted.pinned, [10, 20, 30]);
});

test('damaged saved order and unpinned identifiers cannot add phantom shortcuts', t => {
  const { store } = storedLibrary(t, [30, 30, '20', null, true, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, 20]);
  assert.deepEqual(store.homePinOrder, [30, 20]);
  assert.equal(store.setHomePinOrder([20, 20, 999, -4, NaN, Infinity, 1.5, null, true]), true);
  assert.deepEqual(store.homePinOrder, [20, 30, 10]);
  assert.deepEqual(store.pinned, [10, 20, 30]);
});

test('partial home data keeps remaining pins while excluding hidden playlists', t => {
  const { store } = storedLibrary(t, [10, 30, 20], [20]);
  assert.equal(store.setHomePinOrder([30]), true);
  assert.deepEqual(store.homePinOrder, [30, 10]);
  assert.deepEqual(store.hidden, [20]);
  assert.deepEqual(store.pinned, [10, 20, 30]);
});

test('unpinning forgets the old home position and repinning appends it', t => {
  const { store, values } = storedLibrary(t, [30, 10, 20]);
  store.togglePin(10);
  assert.deepEqual(store.homePinOrder, [30, 20]);
  assert.deepEqual(JSON.parse(values.get(homeKey)), [30, 20]);
  store.togglePin(10);
  assert.deepEqual(store.pinned, [20, 30, 10]);
  store.setHomePinOrder([]);
  assert.deepEqual(store.homePinOrder, [30, 20, 10]);
});

test('hiding and deleting playlists remove their home positions', async t => {
  const { store, values } = storedLibrary(t, [30, 10, 20]);
  store.toggleHidden(10);
  assert.deepEqual(store.pinned, [20, 30]);
  assert.deepEqual(store.homePinOrder, [30, 20]);
  assert.equal(await store.deletePlaylist(30), true);
  assert.deepEqual(store.homePinOrder, [20]);
  assert.deepEqual(JSON.parse(values.get(homeKey)), [20]);
  assert.deepEqual(store.playlists.map(item => item.kind), [20, 10]);
});

test('failed persistence leaves the last home order intact', t => {
  const { store, values, rejectHomeWrites } = storedLibrary(t, [10, 20, 30]);
  rejectHomeWrites();
  assert.equal(store.setHomePinOrder([30, 20, 10]), false);
  assert.deepEqual(store.homePinOrder, [10, 20, 30]);
  assert.deepEqual(JSON.parse(values.get(homeKey)), [10, 20, 30]);
  assert.equal(bridge.notifications.length, 1);
  assert.equal(bridge.notifications[0].type, 'negative');
});
