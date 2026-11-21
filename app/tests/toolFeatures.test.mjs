import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
async function load(name) {
  const source = await readFile(new URL(`../src/lib/${name}.ts`, import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}
const [{ commandScore }, { restoreFolders }, ratings, { validReaction, appendReaction }, { scrobbleCandidate }] = await Promise.all(['commandSearch', 'playlistFolders', 'localRatings', 'reactions', 'scrobble'].map(load));
const localId = n => `local:${n.toString(16).padStart(64, '0')}`;

test('command search ranks direct matches above loose matches and normalizes Russian and Unicode', () => {
  const prefix = commandScore('Текст песни', 'текст'), inside = commandScore('Открыть текст песни', 'текст'), reordered = commandScore('Текст песни', 'песни текст'), fuzzy = commandScore('Текст песни', 'ткст');
  assert.ok(prefix > inside && inside > reordered && reordered > fuzzy && fuzzy > 0);
  assert.equal(commandScore('Локальная библиотека', 'несуществующее'), 0);
  assert.ok(commandScore('Ёлка — концерт', 'елка') > 0);
  assert.ok(commandScore('Aureon настройки', 'ＡＵＲＥＯＮ') > 0);
  assert.ok(commandScore('Café', 'Cafe\u0301') > 0);
  assert.ok(commandScore('Плеер', '   ') > 0);
});

test('a playlist belongs to one restored folder, including duplicate and malformed memberships', () => {
  const result = restoreFolders([
    { id: 'one', name: ' Первая ', kinds: [10, 10, 11, -1, '12', 1.5, NaN, Infinity] },
    { id: 'two', name: 'Вторая', kinds: [10, 12, 11, 13] },
    { id: 'two', name: 'Повтор', kinds: [14] },
    null, { id: 'empty', name: '   ', kinds: [15] },
  ]);
  assert.deepEqual(result.map(row => [row.id, row.name, row.kinds]), [['one', 'Первая', [10, 11]], ['two', 'Вторая', [12, 13]]]);
  const all = result.flatMap(row => row.kinds); assert.equal(new Set(all).size, all.length);
});
test('folder limits do not reserve discarded playlists or collapse oversized IDs together', () => {
  const result = restoreFolders([{ id: 'first', name: 'First', kinds: Array.from({ length: 501 }, (_, n) => n) }, { id: 'second', name: 'Second', kinds: [499, 500] }]);
  assert.equal(result[0].kinds.length, 500); assert.deepEqual(result[1].kinds, [500]);
  const prefix = 'x'.repeat(80);
  const ids = restoreFolders([{ id: prefix + 'a', name: 'a' }, { id: prefix + 'b', name: 'b' }, { id: prefix, name: 'valid' }]).map(row => row.id);
  assert.deepEqual(ids, [prefix]);
  assert.equal(restoreFolders(Array.from({ length: 70 }, (_, n) => ({ id: String(n), name: 'Folder', kinds: [] }))).length, 50);
  assert.deepEqual(restoreFolders('{broken'), []);
});

test('local ratings reject remote and malformed IDs and resolve contradictory ratings once', () => {
  const one = localId(1), two = localId(2), invalid = ['123', 'local:abc', 'local:' + 'F'.repeat(64), null, 10];
  assert.deepEqual(ratings.parseLocalRatings({ liked: [one, one, ...invalid], disliked: [one, two, two, ...invalid] }), { liked: [one], disliked: [two] });
  assert.deepEqual(ratings.parseLocalRatings(null), { liked: [], disliked: [] });
  const many = ratings.parseLocalRatings({ liked: Array.from({ length: 5002 }, (_, n) => localId(n)) });
  assert.equal(many.liked.length, 5000); assert.equal(new Set(many.liked).size, 5000);
});
test('ratings storage recovers from corrupt JSON and reports a failed save', t => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), storage = new Map();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) } });
  t.after(() => { if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor); else delete globalThis.localStorage; });
  storage.set(ratings.LOCAL_RATINGS_KEY, '{broken'); assert.deepEqual(ratings.readLocalRatings(), { liked: [], disliked: [] });
  assert.equal(ratings.saveLocalRatings([localId(1)], [localId(1), localId(2)]), true);
  assert.deepEqual(ratings.readLocalRatings(), { liked: [localId(1)], disliked: [localId(2)] });
  globalThis.localStorage.setItem = () => { throw new Error('Quota exceeded'); };
  assert.equal(ratings.saveLocalRatings([], []), false);
});

test('reactions accept emoji families and keycaps while rejecting chat text and controls', () => {
  for (const emoji of ['🔥', '👍🏽', '👨‍👩‍👧‍👦', '🇺🇿', '❤️', '1️⃣', '#️⃣', '*⃣']) assert.equal(validReaction(emoji), true, emoji);
  for (const value of ['', 'hello', 'круто🔥', '👍 yes', '123', '1', '🔥\n', 'x1️⃣', '🔥'.repeat(20), null, 12]) assert.equal(validReaction(value), false, String(value));
});
test('reaction delivery expires old bubbles, caps the visible burst and preserves input state', () => {
  const now = 20_000, original = [{ id: 1, emoji: '🎵', nick: 'old', at: now - 5000 }, { id: 2, emoji: '❤️', nick: 'recent', at: now - 4999 }];
  const output = appendReaction(original, '🔥', 'listener', now);
  assert.deepEqual(output.map(row => row.nick), ['recent', 'listener']); assert.equal(original.length, 2); assert.equal(original[0].nick, 'old');
  const burst = Array.from({ length: 15 }, (_, n) => ({ id: n, emoji: '🎵', nick: String(n), at: now - 10 }));
  const capped = appendReaction(burst, '👍', 'x'.repeat(100), now); assert.equal(capped.length, 8); assert.equal(capped.at(-1).nick.length, 60);
  assert.equal(appendReaction(original, 'chat message', 'listener', now), original);
  assert.equal(appendReaction(original, '🔥', null, now), original);
});

const track = { id: 'track-1', title: ' Песня ', artists: [{ id: 'artist-1', name: ' Артист ' }], album_id: null, album_title: 'Альбом', cover_url: null, duration_ms: 180_000, available: true };
const stamp = { id: track.id, title: track.title, artist: 'Артист', artistId: 'artist-1', cover: null, at: 1_790_000_000_567, seconds: 0 };
const candidate = (event = stamp, song = track, sent = new Set(), enabled = true) => scrobbleCandidate(event, song, enabled, sent);
test('scrobbling waits for half a short track or four minutes of a long track', () => {
  assert.equal(candidate({ ...stamp, seconds: 89.999 }), null);
  const half = candidate({ ...stamp, seconds: 90 }); assert.ok(half); assert.equal(half.listen.listenedAt, 1_790_000_000); assert.equal(half.listen.title, 'Песня'); assert.equal(half.listen.artist, 'Артист');
  const long = { ...track, duration_ms: 600_000 };
  assert.equal(candidate({ ...stamp, seconds: 239.999 }, long), null); assert.ok(candidate({ ...stamp, seconds: 240 }, long));
});
test('scrobble retries are suppressed by the same listening event while replaying remains eligible', () => {
  const event = { ...stamp, seconds: 100 }, first = candidate(event); assert.ok(first);
  const sent = new Set([first.key]); assert.equal(candidate({ ...event, seconds: 150 }, track, sent), null);
  assert.ok(candidate({ ...event, at: event.at + 180_000 }, track, sent)); assert.equal(sent.size, 1);
  assert.equal(candidate({ ...event, id: 'another-track' }), null); assert.equal(candidate(event, track, sent, false), null); assert.equal(candidate(event, null), null);
});
test('malformed timing or blank metadata never becomes an outbound scrobble', () => {
  for (const seconds of [NaN, Infinity, -1]) assert.equal(candidate({ ...stamp, seconds }), null);
  for (const at of [NaN, Infinity, -1000, 0, 1]) assert.equal(candidate({ ...stamp, seconds: 100, at }), null);
  for (const duration_ms of [NaN, Infinity, -1, 0, null]) assert.equal(candidate({ ...stamp, seconds: 1000 }, { ...track, duration_ms }), null);
  assert.equal(candidate({ ...stamp, seconds: 100 }, { ...track, title: '  ' }), null);
  assert.equal(candidate({ ...stamp, seconds: 100 }, { ...track, artists: [{ id: '1', name: '  ' }] }), null);
});
