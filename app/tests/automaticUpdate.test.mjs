import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/stores/updates.ts', import.meta.url), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;

function fixture({ automatic = true, installable = true, previous = '', failDownload = false } = {}) {
  const calls = [];
  const storage = new Map([['aureon.updates.automatic', automatic ? 'on' : 'off'], ['aureon.updates.installing', previous]]);
  const localStorage = { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) };
  const release = { version: '1.2.3', canInstall: installable, packageName: 'package' };
  const invoke = async name => {
    calls.push(name);
    if (name === 'check_update') return release;
    if (name === 'download_update' && failDownload) throw Error('download interrupted');
    return 'downloaded';
  };
  const bindings = {
    defineStore: (_, options) => () => Object.assign(options.state(), options.actions),
    readSchedule: () => ({ checkedAt: 0, remindAt: 0 }), shouldCheck: () => true, isTauri: () => true,
    invoke, localStorage, listen: async () => () => {}, usePlayerStore: () => ({ persistSession: () => calls.push('save') }),
  };
  const store = Function(...Object.keys(bindings), js.replace(/^import .*;$/gm, '').replace('export const useUpdatesStore', 'const useUpdatesStore') + '\nreturn useUpdatesStore();')(...Object.values(bindings));
  return { store, calls, storage };
}

test('startup downloads, saves playback, and hands off a verified Windows update', async () => {
  const { store, calls, storage } = fixture();
  await store.check('startup');
  assert.deepEqual(calls, ['check_update', 'download_update', 'save', 'install_update']);
  assert.equal(storage.get('aureon.updates.installing'), '1.2.3');
});

test('manual checks, opt-out, Linux packages and an interrupted install ask before applying', async () => {
  for (const [config, reason] of [[{}, 'manual'], [{ automatic: false }, 'startup'], [{ installable: false }, 'startup'], [{ previous: '1.2.3' }, 'startup']]) {
    const { store, calls } = fixture(config);
    await store.check(reason);
    assert.deepEqual(calls, ['check_update']);
    assert.equal(store.open, true);
  }
});

test('an interrupted download allows retry without closing the player', async () => {
  const { store, calls, storage } = fixture({ failDownload: true });
  await store.check('startup');
  assert.deepEqual(calls, ['check_update', 'download_update']);
  assert.equal(store.downloading, false);
  assert.equal(store.open, true);
  assert.match(store.error, /interrupted/);
  assert.equal(storage.get('aureon.updates.installing'), '');
});
