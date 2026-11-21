import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/lib/coverArtwork.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { largeCoverUrl } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));
const cover = 'https://avatars.yandex.net/get-music-content/5457717/f2001c91.a.15091278-1/200x200';

test('large artwork upgrades recognized Yandex Music thumbnails and URI placeholders', () => {
  for (const host of ['avatars.yandex.net', 'avatars.mds.yandex.net', 'avatars.mds.yandex.ru']) {
    const prefix = `https://${host}/get-music-content/5457717/f2001c91.a.15091278-1/`;
    for (const rendition of ['50x50', '200x200', '400x400', '%%', '%25%25']) {
      assert.equal(largeCoverUrl(prefix + rendition), prefix + '800x800');
    }
  }
  assert.equal(largeCoverUrl(cover, 1000), cover.replace('200x200', '1000x1000'));
  assert.equal(largeCoverUrl(cover.replace('https:', '')), cover.replace('https:', '').replace('200x200', '800x800'));
  assert.equal(largeCoverUrl(cover.replace('avatars.', 'AVATARS.')), cover.replace('avatars.', 'AVATARS.').replace('200x200', '800x800'));
});

test('signed query and fragment bytes are preserved, and existing large or rectangular art is not degraded', () => {
  const suffix = '?signature=a%2Fb%2Bc&size=200x200&template=%%#original';
  assert.equal(largeCoverUrl(cover + suffix), cover.replace('200x200', '800x800') + suffix);
  for (const rendition of ['800x800', '1000x1000', '2048x2048', '400x600', 'orig']) {
    const value = cover.replace('200x200', rendition);
    assert.equal(largeCoverUrl(value), value);
  }
  for (const invalid of [NaN, Infinity, -1, 0, 12, 800.5, 99999]) assert.equal(largeCoverUrl(cover, invalid), cover.replace('200x200', '800x800'));
});

test('external, local, malformed and unrelated Yandex image URLs remain unchanged', () => {
  for (const value of [
    '/cover.svg?art=3', 'C:\\Music\\cover.jpg', 'asset://localhost/C:/Music/cover.jpg',
    'https://asset.localhost/C:/Music/cover.jpg', 'data:image/png;base64,AA==', 'blob:http://tauri.localhost/preview',
    'https://covers.example.org/get-music-content/1/cover/200x200',
    cover.replace('avatars.yandex.net', 'avatars.yandex.net.example.org'),
    cover.replace('avatars.yandex.net', 'evil-avatars.yandex.net'),
    cover.replace('avatars.yandex.net', 'user:secret@avatars.yandex.net'),
    cover.replace('avatars.yandex.net', 'avatars.yandex.net:8443'),
    cover.replace('get-music-content', 'get-yapic'),
    cover.replace('200x200', 'cover.jpg'),
    cover.replace('200x200', '200x200/extra'),
    cover.replace('200x200', '0x0'),
    cover.replace('https:', 'http:'), ` ${cover}`, cover.replace('/200x200', '\\200x200'),
    'not a URL',
  ]) assert.equal(largeCoverUrl(value), value, value);
  assert.equal(largeCoverUrl(null), ''); assert.equal(largeCoverUrl(undefined), ''); assert.equal(largeCoverUrl(''), '');
});
