import type { DiscoveryAlbum, Track } from '@/api/types';

const LIMIT = 40;
function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
function id(value: unknown): value is string { return typeof value === 'string' && /^\d{1,20}$/.test(value) && /[1-9]/.test(value); }
function nullableString(value: unknown): boolean { return value === null || typeof value === 'string'; }
function artists(value: unknown): boolean {
  return Array.isArray(value) && value.length <= 100 && value.every(item => record(item) && typeof item.id === 'string' && typeof item.name === 'string');
}
function unique<T extends { id: string }>(rows: unknown, valid: (row: unknown) => row is T): T[] {
  if (!Array.isArray(rows)) return [];
  const seen = new Set<string>(), result: T[] = [];
  for (const row of rows.slice(0, LIMIT * 5)) {
    if (!valid(row) || seen.has(row.id)) continue;
    seen.add(row.id); result.push(row);
    if (result.length === LIMIT) break;
  }
  return result;
}

export function discoveryAlbums(value: unknown): DiscoveryAlbum[] {
  return unique(value, (row): row is DiscoveryAlbum => record(row) && id(row.id) && typeof row.title === 'string' && artists(row.artists) && nullableString(row.cover_url) && nullableString(row.release_date) && (row.year === null || Number.isSafeInteger(row.year)));
}
export function discoveryChart(value: unknown): Track[] {
  return unique(value, (row): row is Track => record(row) && id(row.id) && typeof row.title === 'string' && artists(row.artists) && row.available === true && nullableString(row.cover_url) && nullableString(row.album_id) && nullableString(row.album_title) && (row.duration_ms === null || typeof row.duration_ms === 'number' && Number.isFinite(row.duration_ms) && row.duration_ms >= 0));
}
export function discoveryCacheKey(uid: number | null | undefined, section: 'releases' | 'chart'): string | null {
  return typeof uid === 'number' && Number.isSafeInteger(uid) && uid > 0 ? `home.discovery.${uid}.${section === 'chart' ? 'chart.russia' : section}.v1` : null;
}
export function releaseDateLabel(value: string | null | undefined): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value)) return '';
  const date = new Date(value.slice(0, 10) + 'T12:00:00Z');
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value.slice(0, 10)) return '';
  return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', timeZone: 'UTC' });
}
