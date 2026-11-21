import { mkdirSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
export function prepareFeatureAssets() {
  const target = new URL('public/ocr/core/', root);
  mkdirSync(target, { recursive: true });
  copyFileSync(new URL('node_modules/tesseract.js/dist/worker.min.js', root), new URL('../worker.min.js', target));
  for (const file of ['tesseract-core-lstm.wasm.js','tesseract-core-simd-lstm.wasm.js','tesseract-core-relaxedsimd-lstm.wasm.js'])
    copyFileSync(new URL(`node_modules/tesseract.js-core/${file}`, root), new URL(file, target));
  copyFileSync(new URL('node_modules/emoji-picker-element-data/ru/emojibase/data.json',root),new URL('public/emoji-ru.json',root));
}
if (process.argv[1] === fileURLToPath(import.meta.url)) prepareFeatureAssets();
