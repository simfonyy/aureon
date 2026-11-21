import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(new URL('../src/stores/ui/persistence.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { restoreSettings, restorePlayerLayout } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
test('cancel player editing preserves a newly chosen theme and background', () => {
  const old = { theme: 'black', accent: '#fff', liquidMetal: true, playerHeight: 80, miniWidth: 400, showPlayerArtwork: true };
  const current = { theme: 'matte', accent: '#d6bb8a', liquidMetal: false, playerHeight: 120, miniWidth: 500, showPlayerArtwork: false };
  restorePlayerLayout(current, old);
  assert.equal(current.theme, 'matte');
  assert.equal(current.accent, '#d6bb8a');
  assert.equal(current.liquidMetal, false);
  assert.equal(current.playerHeight, 80);
  assert.equal(current.miniWidth, 400);
  assert.equal(current.showPlayerArtwork, true);
});
test('a damaged unrelated setting does not reset a valid saved theme', () => {
  const defaults = { theme: 'black', discordClientId: 'default', radius: 12, playerOrder: ['play'] };
  const restored = restoreSettings(defaults, { theme: 'matte', discordClientId: null, radius: 'broken', playerOrder: false });
  assert.equal(restored.theme, 'matte');
  assert.equal(restored.discordClientId, 'default');
  assert.equal(restored.radius, 12);
  restored.playerOrder.push('next');
  assert.deepEqual(defaults.playerOrder, ['play']);
});
test('null or array storage recovers defaults without throwing', () => {
  assert.deepEqual(restoreSettings({ theme: 'black' }, null), { theme: 'black' });
  assert.deepEqual(restoreSettings({ theme: 'black' }, []), { theme: 'black' });
});
