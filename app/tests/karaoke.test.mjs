import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(new URL('../src/lib/karaoke.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { lineWords, wordFill, vocalCountdown } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

test('ordinary LRC preserves text and distributes only within the line interval', () => {
  const words = lineWords({ time_ms: 3000, text: 'Тихо  поёт ночь' }, 9000);
  assert.equal(words.map(w => w.text).join(''), 'Тихо  поёт ночь');
  assert.equal(words[0].start, 3000);
  assert.equal(words.at(-1).end, 9000);
  assert.equal(wordFill(words[1], 0), 0);
  assert.equal(wordFill(words[1], 10000), 100);
  const middle = (words[1].start + words[1].end) / 2;
  assert.equal(wordFill(words[1], middle), 50);
  assert.equal(wordFill(words[1], words[1].start), 0); // Seek backward resets fill.
});
test('enhanced LRC uses provided timestamps including the terminal end marker', () => {
  const words = lineWords({ time_ms: 1000, text: '<00:01.00>Привет <00:02.500>мир<00:03.00>' }, 8000);
  assert.deepEqual(words, [
    { text: 'Привет ', start: 1000, end: 2500 },
    { text: 'мир', start: 2500, end: 3000 },
  ]);
});
test('empty and duplicate-time lines never produce invalid fill', () => {
  assert.deepEqual(lineWords({ time_ms: 0, text: '' }, 0), []);
  const words = lineWords({ time_ms: 2000, text: 'Слово' }, 2000);
  assert.ok(Number.isFinite(wordFill(words[0], 2000)));
});
test('countdown follows audio position through pause, seek and vocal start', () => {
  assert.equal(vocalCountdown(10000, 6999), 0);
  assert.equal(vocalCountdown(10000, 7000), 3);
  assert.equal(vocalCountdown(10000, 8000), 2);
  assert.equal(vocalCountdown(10000, 8000), 2);
  assert.equal(vocalCountdown(10000, 9000), 1);
  assert.equal(vocalCountdown(10000, 10000), 0);
  assert.equal(vocalCountdown(1000, 0), 0);
  assert.equal(vocalCountdown(undefined, 0), 0);
});
