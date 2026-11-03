export type CoverRgb = readonly [number, number, number];

export interface CoverPalette {
  dominant: string;
  accent: string;
  muted: string;
  dark: string;
  light: string;
  onAccent: '#ffffff' | '#000000';
  onDark: '#ffffff';
  onLight: '#111318';
}

const clamp = (value: number) => Math.round(Math.max(0, Math.min(255, value)));
const hex = (rgb: CoverRgb) => `#${rgb.map(value => clamp(value).toString(16).padStart(2, '0')).join('')}`;
const mix = (a: CoverRgb, b: CoverRgb, amount: number): CoverRgb => a.map((value, i) => clamp(value * (1 - amount) + b[i] * amount)) as unknown as CoverRgb;

export function relativeLuminance(rgb: CoverRgb): number {
  const channels = rgb.map(value => {
    const channel = clamp(value) / 255;
    return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
  });
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722;
}

export function contrastRatio(a: CoverRgb, b: CoverRgb): number {
  const first = relativeLuminance(a), second = relativeLuminance(b);
  return (Math.max(first, second) + .05) / (Math.min(first, second) + .05);
}

/** Derive local art surfaces; never overwrite the selected interface theme. */
export function paletteFromColors(rawColors: readonly (readonly number[])[]): CoverPalette | null {
  const colors: CoverRgb[] = [];
  for (const raw of rawColors) {
    if (!Array.isArray(raw) || raw.length !== 3 || raw.some(value => !Number.isFinite(value))) continue;
    const rgb = raw.map(clamp) as unknown as CoverRgb;
    if (!colors.some(color => color.every((value, i) => Math.abs(value - rgb[i]) < 12))) colors.push(rgb);
    if (colors.length === 8) break;
  }
  if (!colors.length) return null;
  const dominant = colors[0];
  const score = (rgb: CoverRgb, index: number) => {
    const high = Math.max(...rgb) / 255, low = Math.min(...rgb) / 255;
    const saturation = high === low ? 0 : (high - low) / (1 - Math.abs(high + low - 1));
    const brightness = (high + low) / 2;
    return saturation * .72 + (1 - Math.abs(brightness - .5) * 2) * .2 + .08 / (index + 1);
  };
  const accent = colors.reduce((best, color, index) => score(color, index) > score(best, colors.indexOf(best)) ? color : best, dominant);
  const white: CoverRgb = [255, 255, 255], black: CoverRgb = [0, 0, 0];
  return Object.freeze({
    dominant: hex(dominant),
    accent: hex(accent),
    muted: hex(mix(dominant, [125, 128, 135], .44)),
    dark: hex(mix(dominant, [9, 11, 17], .82)),
    light: hex(mix(dominant, [246, 247, 250], .88)),
    onAccent: contrastRatio(accent, white) >= contrastRatio(accent, black) ? '#ffffff' : '#000000',
    onDark: '#ffffff',
    onLight: '#111318',
  });
}

export function coverPaletteStyle(palette: CoverPalette | null): Record<string, string> {
  if (!palette) return {};
  return Object.fromEntries(Object.entries(palette).map(([key, value]) => [
    `--cover-${key.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`, value,
  ]));
}

type ExtractCover = (source: string) => Promise<readonly (readonly number[])[]>;

async function extractCoverColors(source: string): Promise<readonly (readonly number[])[]> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    const clear = () => { clearTimeout(timer); img.onload = null; img.onerror = null; };
    const timer = setTimeout(() => { clear(); img.src = ''; reject(new Error('Cover decoding timed out')); }, 5000);
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => { clear(); img.naturalWidth && img.naturalHeight ? resolve(img) : reject(new Error('Empty cover')); };
    img.onerror = () => { clear(); reject(new Error('Cover is unavailable')); };
    img.src = source;
  });
  // Sample a thumbnail rather than synchronously quantizing a large cover.
  const scale = Math.min(1, 96 / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return [];
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const { getPaletteSync } = await import('colorthief');
  return (getPaletteSync(canvas, { colorCount: 6, quality: 3, colorSpace: 'oklch', ignoreWhite: false }) ?? []).map(color => color.array());
}

/** Share decoding between art views, with a bounded LRU and short-lived misses. */
export function createCoverPaletteLoader(extract: ExtractCover = extractCoverColors, limit = 48) {
  const cache = new Map<string, { promise: Promise<CoverPalette | null>; expires: number }>();
  const maximum = Number.isFinite(limit) ? Math.max(1, Math.min(128, Math.floor(limit))) : 48;
  function load(source: string): Promise<CoverPalette | null> {
    const key = source.trim();
    if (!key) return Promise.resolve(null);
    const cached = cache.get(key);
    if (cached && cached.expires > Date.now()) {
      cache.delete(key); cache.set(key, cached);
      return cached.promise;
    }
    cache.delete(key);
    const entry = { promise: Promise.resolve(null) as Promise<CoverPalette | null>, expires: Infinity };
    entry.promise = Promise.resolve().then(() => extract(key)).then(paletteFromColors).catch(() => null).then(palette => {
      entry.expires = Date.now() + (palette ? 6 * 60 * 60 * 1000 : 15_000);
      return palette;
    });
    cache.set(key, entry);
    while (cache.size > maximum) cache.delete(cache.keys().next().value!);
    return entry.promise;
  }
  return { load, clear: () => cache.clear(), get size() { return cache.size; } };
}

const coverPalettes = createCoverPaletteLoader();
export const getCoverPalette = (source: string) => coverPalettes.load(source);
