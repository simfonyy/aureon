import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { createPinia, defineStore } from 'pinia';

const source = await readFile(new URL('../src/stores/genius.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const hit = id => ({ id, title: `Song ${id}`, full_title: `Song ${id}`, url: `https://genius.com/song-${id}` });
const person = id => ({ id, name: `Artist ${id}`, url: `https://genius.com/artists/${id}` });
const track = id => ({ id, title: `Track ${id}`, artists: [{ id: '1', name: 'Artist' }], available: true });
const song = id => ({ id, title: `Song ${id}`, lyrics: ['Line'], credits: [
  { id: 31, name: 'Producer', role: 'Продюсер' },
  { id: 31, name: 'Producer', role: 'Продюсер' },
  { id: 32, name: 'Writer', role: 'Автор' },
] });
let fixtureId = 0;

// Exercise the real Pinia getters/actions. Only network and storage boundaries
// are replaced, allowing responses to arrive in any order.
async function fixture(t, handlers = {}) {
  const requests = [], saved = new Map();
  saved.set('mashiro.genius', JSON.stringify({ token: 'token-one', enabled: true, showQuotes: true }));
  const api = new Proxy({}, { get: (_, name) => (...args) => {
    requests.push({ name, args });
    if (handlers[name]) return handlers[name](...args);
    throw new Error(`Unexpected service request: ${String(name)}`);
  } });
  const key = `geniusStoreFixture${++fixtureId}`;
  globalThis[key] = {
    defineStore, api, artistNames: artists => artists.map(artist => artist.name).join(', '),
    localStorage: { getItem: name => saved.get(name) ?? null, setItem: (name, value) => saved.set(name, value) },
  };
  const code = `const localStorage = globalThis.${key}.localStorage;\n` + compiled.replace(
    /import\s*\{([^}]+)\}\s*from\s*['"][^'"]+['"];?/g,
    (_, names) => `const {${names}} = globalThis.${key};`,
  );
  const { useGeniusStore } = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
  const store = useGeniusStore(createPinia());
  t.after(() => { store.$dispose(); delete globalThis[key]; });
  return { store, requests, saved };
}

test('song credits stay separate from artist search results', async t => {
  const f = await fixture(t, { geniusLookup: async () => song(1), geniusSearchPeople: async () => [person(9)] });
  await f.store.searchPeople('Artist');
  await f.store.fetchSong(track('101'));
  assert.deepEqual(f.store.peopleHits, [person(9)]);
  assert.deepEqual(f.store.people, [song(1).credits[0], song(1).credits[2]]);
  assert.deepEqual(f.store.producers, song(1).credits.slice(0, 2));
  assert.deepEqual(f.store.writers, [song(1).credits[2]]);
  f.store.song = null;
  assert.deepEqual(f.store.people, []);
  assert.deepEqual(f.store.peopleHits, [person(9)]);
});

test('a stale song search cannot complete loading or replace the newest query', async t => {
  const old = deferred(), latest = deferred();
  const f = await fixture(t, { geniusSearch: (_, query) => query === 'old' ? old.promise : latest.promise });
  const first = f.store.searchHits('old'), second = f.store.searchHits('latest');
  old.resolve([hit(1)]); await first;
  assert.equal(f.store.hitsLoading, true);
  assert.deepEqual(f.store.hits, []);
  latest.resolve([hit(2)]); await second;
  assert.equal(f.store.hitsLoading, false);
  assert.deepEqual(f.store.hits, [hit(2)]);
  assert.deepEqual(f.requests.map(request => request.args), [['token-one', 'old'], ['token-one', 'latest']]);
});

test('a late failed song search cannot erase a newer success or display its error', async t => {
  const old = deferred();
  const f = await fixture(t, { geniusSearch: (_, query) => query === 'old' ? old.promise : Promise.resolve([hit(2)]) });
  const first = f.store.searchHits('old');
  await f.store.searchHits('latest');
  old.reject(new Error('Old request failed')); await first;
  assert.deepEqual(f.store.hits, [hit(2)]);
  assert.equal(f.store.hitsLoading, false);
  assert.equal(f.store.error, '');
});

test('artist searches keep loading for the newest query and discard a late old result', async t => {
  const old = deferred(), latest = deferred(), last = deferred();
  const pending = { old, latest, last };
  const f = await fixture(t, { geniusSearchPeople: (_, query) => pending[query].promise });
  const first = f.store.searchPeople('old'), second = f.store.searchPeople('latest');
  old.reject(new Error('Old artist request failed')); await first;
  assert.equal(f.store.peopleLoading, true);
  const third = f.store.searchPeople('last');
  last.resolve([person(3)]); await third;
  latest.resolve([person(2)]); await second;
  assert.deepEqual(f.store.peopleHits, [person(3)]);
  assert.equal(f.store.peopleLoading, false);
});

test('clearing song and short artist queries discards in-flight responses immediately', async t => {
  const songs = deferred(), people = deferred();
  const f = await fixture(t, { geniusSearch: () => songs.promise, geniusSearchPeople: () => people.promise });
  const first = f.store.searchHits('song'), second = f.store.searchPeople('artist');
  await f.store.searchHits('  ');
  await f.store.searchPeople('a');
  assert.equal(f.store.hitsLoading, false);
  assert.equal(f.store.peopleLoading, false);
  songs.reject(new Error('Discarded query')); people.resolve([person(1)]);
  await Promise.all([first, second]);
  assert.deepEqual(f.store.hits, []);
  assert.deepEqual(f.store.peopleHits, []);
  assert.equal(f.store.error, '');
  assert.equal(f.requests.length, 2);
});

test('forget clears loading and prevents older responses from reaching a fresh search', async t => {
  const oldSongs = deferred(), oldPeople = deferred(), newSongs = deferred(), newPeople = deferred();
  const f = await fixture(t, {
    geniusSearch: (_, query) => query === 'old' ? oldSongs.promise : newSongs.promise,
    geniusSearchPeople: (_, query) => query === 'old' ? oldPeople.promise : newPeople.promise,
  });
  const old = [f.store.searchHits('old'), f.store.searchPeople('old')];
  f.store.song = song(1);
  f.store.forget();
  assert.equal(f.store.hitsLoading, false); assert.equal(f.store.peopleLoading, false);
  assert.deepEqual(f.store.people, []);
  const fresh = [f.store.searchHits('fresh'), f.store.searchPeople('fresh')];
  oldSongs.resolve([hit(1)]); oldPeople.resolve([person(1)]); await Promise.all(old);
  assert.equal(f.store.hitsLoading, true); assert.equal(f.store.peopleLoading, true);
  assert.deepEqual(f.store.hits, []); assert.deepEqual(f.store.peopleHits, []);
  newSongs.resolve([hit(2)]); newPeople.resolve([person(2)]); await Promise.all(fresh);
  assert.deepEqual(f.store.hits, [hit(2)]); assert.deepEqual(f.store.peopleHits, [person(2)]);
  assert.equal(f.store.hitsLoading, false); assert.equal(f.store.peopleLoading, false);
});

test('changing the Genius token discards old searches and uses the new token afterwards', async t => {
  const songs = deferred(), people = deferred();
  const f = await fixture(t, {
    geniusSearch: token => token === 'token-one' ? songs.promise : Promise.resolve([hit(2)]),
    geniusSearchPeople: token => token === 'token-one' ? people.promise : Promise.resolve([person(2)]),
  });
  const old = [f.store.searchHits('song'), f.store.searchPeople('artist')];
  f.store.apply({ token: 'token-two' });
  assert.equal(f.store.hitsLoading, false); assert.equal(f.store.peopleLoading, false);
  await Promise.all([f.store.searchHits('song'), f.store.searchPeople('artist')]);
  songs.resolve([hit(1)]); people.resolve([person(1)]); await Promise.all(old);
  assert.deepEqual(f.store.hits, [hit(2)]); assert.deepEqual(f.store.peopleHits, [person(2)]);
  assert.equal(JSON.parse(f.saved.get('mashiro.genius')).token, 'token-two');
  assert.deepEqual(f.requests.slice(-2).map(request => request.args[0]), ['token-two', 'token-two']);
});

test('disabling and re-enabling Genius does not revive a request from the old session', async t => {
  const songs = deferred(), people = deferred();
  const f = await fixture(t, { geniusSearch: () => songs.promise, geniusSearchPeople: () => people.promise });
  const old = [f.store.searchHits('song'), f.store.searchPeople('artist')];
  f.store.apply({ enabled: false });
  await Promise.all([f.store.searchHits('song'), f.store.searchPeople('artist')]);
  f.store.apply({ enabled: true });
  songs.resolve([hit(1)]); people.resolve([person(1)]); await Promise.all(old);
  assert.equal(f.requests.length, 2);
  assert.equal(f.store.ready, true);
  assert.equal(f.store.hitsLoading, false); assert.equal(f.store.peopleLoading, false);
  assert.deepEqual(f.store.hits, []); assert.deepEqual(f.store.peopleHits, []);
});

test('opening a song cancels pending search results instead of repopulating its picker', async t => {
  const first = deferred(), second = deferred();
  let calls = 0;
  const f = await fixture(t, {
    geniusSearch: () => (++calls === 1 ? first : second).promise,
    geniusLookup: async () => song(1), geniusSong: async () => song(2),
  });
  const search = f.store.searchHits('first');
  await f.store.fetchSong(track('101'));
  first.resolve([hit(3)]); await search;
  assert.deepEqual(f.store.hits, []); assert.equal(f.store.hitsLoading, false);
  const another = f.store.searchHits('second');
  await f.store.pickHit(hit(2));
  second.resolve([hit(4)]); await another;
  assert.equal(f.store.song.id, 2);
  assert.deepEqual(f.store.hits, []); assert.equal(f.store.hitsLoading, false);
});
