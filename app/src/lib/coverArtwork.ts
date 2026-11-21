const AVATAR_HOSTS = new Set([
  'avatars.yandex.net',
  'avatars.mds.yandex.net',
  'avatars.mds.yandex.ru',
]);

/** Upgrade Yandex Music cover thumbnails only; local and other artwork stays intact. */
export function largeCoverUrl(value: string | null | undefined, size = 800): string {
  if (!value) return '';
  if (value !== value.trim() || /[\u0000-\u0020\u007f\\]/.test(value)) return value;
  let url: URL;
  try { url = new URL(value.startsWith('//') ? `https:${value}` : value); }
  catch { return value; }
  if (url.protocol !== 'https:' || !AVATAR_HOSTS.has(url.hostname) || url.username || url.password || (url.port && url.port !== '443')) return value;
  const match = /^\/get-music-content\/[^/]+\/[^/]+\/(%%|%25%25|([1-9]\d{0,4})x([1-9]\d{0,4}))$/i.exec(url.pathname);
  if (!match) return value;
  const requested = Number.isSafeInteger(size) && size >= 200 && size <= 2048 ? size : 800;
  if (match[2] && match[3]) {
    const width = Number(match[2]), height = Number(match[3]);
    // A rectangular rendition may be an intentional crop. Never change its shape
    // or replace an existing higher resolution with a smaller image.
    if (width !== height || width >= requested) return value;
  }
  const suffixAt = value.search(/[?#]/);
  const path = suffixAt < 0 ? value : value.slice(0, suffixAt);
  const suffix = suffixAt < 0 ? '' : value.slice(suffixAt);
  return path.replace(/\/(?:%%|%25%25|[1-9]\d{0,4}x[1-9]\d{0,4})$/i, `/${requested}x${requested}`) + suffix;
}
