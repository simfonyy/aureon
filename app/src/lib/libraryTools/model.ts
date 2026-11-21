import type { Lyrics, Track } from '@/api/types';
import { normalize, queryVariants } from '@/lib/smartSearch';

export interface AudioAnalysis {
  version: number; bpm: number | null; bpmConfidence: number;
  key: string | null; keyConfidence: number; energy: number;
  analyzedSeconds: number; fingerprint: number[];
}
export interface LocalEntry {
  id: string; path: string; title: string; artist: string; album: string; genre: string;
  year: number | null; trackNumber: number | null; durationMs: number;
  size: number; modifiedAt: number; addedAt: number; coverPath: string | null;
  lyrics: string; analysis: AudioAnalysis | null;
}
export interface TagPatch {
  title: string; artist: string; album: string; genre: string;
  year: number | null; trackNumber: number | null; lyrics: string;
  coverBase64: string | null; removeCover: boolean;
}
export interface Identification { recordingId: string; title: string; artist: string; album: string; score: number }
export function identificationDraft(form: TagPatch, candidate: Identification): TagPatch {
  return { ...form, title:candidate.title.trim().slice(0,512) || form.title,
    artist:candidate.artist.trim().slice(0,512) || form.artist, album:candidate.album.trim().slice(0,512) || form.album };
}
export type SmartRule = { kind: 'unplayed'; days: number } | { kind: 'recent'; days: number } | { kind: 'short'; seconds: number };
export interface SmartPlaylist { id: string; title: string; rule: SmartRule; createdAt: number }
export interface PlayStamp { id: string; at: number; seconds: number }
export type LocalSort = 'title' | 'added' | 'bpm' | 'energy' | 'near-tempo' | 'near-energy';
export const SMART_KEY = 'aureon.library.smart.v1';
export const MAX_PLAYLISTS = 64;

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const text = (value: unknown, length: number): string => typeof value === 'string' ? value.replace(/\0/g, '').trim().slice(0, length) : '';
export function normalizeEntry(value: unknown): LocalEntry | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (typeof row.id !== 'string' || !/^local:[a-f0-9]{64}$/.test(row.id) || !/^(?:[a-z]:[\\/]|\\\\|\/)/i.test(text(row.path, 32768)) || !text(row.title, 512)) return null;
  let analysis: AudioAnalysis | null = null;
  if (row.analysis && typeof row.analysis === 'object') {
    const a = row.analysis as Record<string, unknown>;
    if (a.version === 1 && finite(a.energy) && finite(a.analyzedSeconds) && a.analyzedSeconds > 0 && a.analyzedSeconds <= 181) {
      analysis = {
        version: 1, bpm: finite(a.bpm) && a.bpm >= 30 && a.bpm <= 300 ? a.bpm : null,
        bpmConfidence: finite(a.bpmConfidence) ? Math.min(1, Math.max(0, a.bpmConfidence)) : 0,
        key: text(a.key, 24) || null, keyConfidence: finite(a.keyConfidence) ? Math.min(1, Math.max(0, a.keyConfidence)) : 0,
        energy: Math.min(1, Math.max(0, a.energy)), analyzedSeconds: a.analyzedSeconds,
        fingerprint: Array.isArray(a.fingerprint) ? a.fingerprint.slice(0, 4096).filter((n): n is number => finite(n) && Number.isInteger(n) && n >= 0 && n <= 0xffffffff) : [],
      };
    }
  }
  return {
    id: row.id, path: text(row.path, 32768), title: text(row.title, 512), artist: text(row.artist, 512),
    album: text(row.album, 512), genre: text(row.genre, 256),
    year: finite(row.year) && Number.isInteger(row.year) && row.year >= 0 && row.year <= 9999 ? row.year : null,
    trackNumber: finite(row.trackNumber) && Number.isInteger(row.trackNumber) && row.trackNumber >= 0 && row.trackNumber <= 9999 ? row.trackNumber : null,
    durationMs: finite(row.durationMs) && row.durationMs >= 0 && row.durationMs <= 86400000 ? row.durationMs : 0,
    size: finite(row.size) && row.size >= 0 ? row.size : 0,
    addedAt: finite(row.addedAt) && row.addedAt > 0 ? row.addedAt : 0,
    modifiedAt: finite(row.modifiedAt) && row.modifiedAt >= 0 ? row.modifiedAt : 0,
    coverPath: text(row.coverPath, 32768) || null, lyrics: text(row.lyrics, 262144), analysis,
  };
}
export function normalizeCatalog(value: unknown): LocalEntry[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.slice(0, 5000).flatMap(raw => {
    const row = normalizeEntry(raw);
    if (!row || seen.has(row.id)) return [];
    seen.add(row.id); return [row];
  });
}
export function asTrack(entry: LocalEntry, cover: (path: string) => string): Track {
  return {
    id: entry.id, title: entry.title, artists: entry.artist ? [{ id: `local-artist:${entry.artist}`, name: entry.artist }] : [],
    album_id: null, album_title: entry.album || null, cover_url: entry.coverPath ? cover(entry.coverPath) : null,
    duration_ms: entry.durationMs || null, available: true,
  };
}

export function normalizeSmart(value: unknown): SmartPlaylist[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  return value.slice(0, MAX_PLAYLISTS).flatMap(raw => {
    if (!raw || typeof raw !== 'object') return [];
    const row = raw as Partial<SmartPlaylist>;
    if (typeof row.id !== 'string' || row.id.length > 100 || !row.id || ids.has(row.id) || !text(row.title, 100) || !finite(row.createdAt) || row.createdAt < 0 || !row.rule) return [];
    let rule: SmartRule;
    if ((row.rule.kind === 'recent' || row.rule.kind === 'unplayed') && finite(row.rule.days) && Number.isInteger(row.rule.days) && row.rule.days >= 1 && row.rule.days <= 3650) rule = { kind: row.rule.kind, days: row.rule.days };
    else if (row.rule.kind === 'short' && finite(row.rule.seconds) && Number.isInteger(row.rule.seconds) && row.rule.seconds >= 1 && row.rule.seconds <= 86400) rule = { kind: 'short', seconds: row.rule.seconds };
    else return [];
    ids.add(row.id);
    return [{ id: row.id, title: text(row.title, 100), rule, createdAt: row.createdAt }];
  });
}
export function parseSmart(raw: string | null): SmartPlaylist[] {
  if (!raw || raw.length > 128 * 1024) return [];
  try { return normalizeSmart(JSON.parse(raw)); } catch { return []; }
}
export function smartMatches(entry: LocalEntry, rule: SmartRule, history: readonly PlayStamp[], now = Date.now()): boolean {
  if (!Number.isFinite(now)) return false;
  if (rule.kind === 'short') return Number.isFinite(rule.seconds) && rule.seconds > 0 && entry.durationMs > 0 && entry.durationMs < rule.seconds * 1000;
  const boundary = now - rule.days * 86400000;
  if (!Number.isFinite(boundary) || rule.days < 1) return false;
  if (rule.kind === 'recent') return entry.addedAt > 0 && entry.addedAt >= boundary && entry.addedAt <= now;
  // The existing statistics count a play after 20 seconds. Future/corrupt events are ignored.
  return !history.some(play => play?.id === entry.id && Number.isFinite(play.at) && play.at >= boundary && play.at <= now && Number.isFinite(play.seconds) && play.seconds >= 20);
}
export function ruleLabel(rule: SmartRule): string {
  if (rule.kind === 'recent') return `Добавлено за ${rule.days} дн.`;
  if (rule.kind === 'unplayed') return `Не слушал ${rule.days} дн.`;
  return rule.seconds % 60 === 0 ? `Короче ${rule.seconds / 60} мин` : `Короче ${rule.seconds} с`;
}
export function sortLocal(entries: readonly LocalEntry[], sort: LocalSort, reference?: LocalEntry | null): LocalEntry[] {
  const nullable = (a: number | null | undefined, b: number | null | undefined) => a == null ? b == null ? 0 : 1 : b == null ? -1 : a-b;
  return [...entries].sort((a,b) => {
    let order = 0;
    if (sort === 'added') order = b.addedAt-a.addedAt;
    else if (sort === 'bpm') order = nullable(a.analysis?.bpm, b.analysis?.bpm);
    else if (sort === 'energy') order = nullable(a.analysis ? -a.analysis.energy : null, b.analysis ? -b.analysis.energy : null);
    else if (sort === 'near-tempo' && reference?.analysis?.bpm) order = nullable(a.analysis?.bpm == null ? null : Math.abs(a.analysis.bpm-reference.analysis.bpm), b.analysis?.bpm == null ? null : Math.abs(b.analysis.bpm-reference.analysis.bpm));
    else if (sort === 'near-energy' && reference?.analysis) order = nullable(a.analysis ? Math.abs(a.analysis.energy-reference.analysis.energy) : null, b.analysis ? Math.abs(b.analysis.energy-reference.analysis.energy) : null);
    return order || a.title.localeCompare(b.title, 'ru') || a.id.localeCompare(b.id);
  });
}

export interface SearchDocument { id: string; title: string; artist: string; album: string; lyrics: string; local: boolean; track: Track | null }
export interface SearchHit { document: SearchDocument; snippet: string; inLyrics: boolean }
const fold = (value: string) => normalize(value.normalize('NFKD').replace(/\p{M}/gu, ''));
export interface SearchIndexEntry { document: SearchDocument; metadata: string; title: string; lyrics: string; lines: string[] }
export function buildSearchIndex(documents: readonly SearchDocument[]): SearchIndexEntry[] {
  return documents.slice(0, 10000).map(document => {
    const lines = document.lyrics.slice(0,262144).split(/\r?\n/).slice(0,4000);
    return { document, metadata: fold(`${document.title} ${document.artist} ${document.album}`), title: fold(document.title), lyrics: fold(lines.join('\n')), lines };
  });
}
export function searchIndex(index: readonly SearchIndexEntry[], query: string, limit = 100): SearchHit[] {
  const queries = [...new Set(queryVariants(query.slice(0, 240)).map(fold).filter(Boolean))];
  if (!queries.length) return [];
  const result: (SearchHit & { score: number })[] = [];
  for (const item of index) {
    const { document, metadata, lines } = item;
    let best = 0; let matchedLine = ''; let inLyrics = false;
    for (const q of queries) {
      const tokens = q.split(' ');
      if (metadata.includes(q)) { best = Math.max(best, item.title === q ? 4 : 3); }
      else if (tokens.every(token => metadata.includes(token))) best = Math.max(best, 2.5);
      if (best < 2 && item.lyrics.includes(q)) {
        best = 2; inLyrics = true;
        matchedLine = (lines.find(line => fold(line).includes(q)) || lines[0] || '').replace(/\[[^\]]*\]/g,'').trim();
      }
    }
    if (best) result.push({ document, snippet: matchedLine.slice(0, 240), inLyrics, score: best });
  }
  return result.sort((a,b) => b.score-a.score || Number(b.document.local)-Number(a.document.local) || a.document.title.localeCompare(b.document.title, 'ru')).slice(0, Math.max(1, Math.min(10000, limit))).map(({ score: _, ...hit }) => hit);
}
export function searchDocuments(documents: readonly SearchDocument[], query: string): SearchHit[] { return searchIndex(buildSearchIndex(documents), query); }

export function parseLocalLyrics(id: string, text: string): Lyrics | null {
  const lines: Lyrics['lines'] = []; const plain: string[] = []; let timed = false;
  for (const line of text.slice(0, 262144).split(/\r?\n/).slice(0, 4000)) {
    const stamps = [...line.matchAll(/\[(\d{1,3}):([0-5]\d)(?:[.:](\d{1,3}))?\]/g)];
    const content = line.replace(/\[[^\]]*\]/g, '').trim();
    if (!content) continue;
    if (stamps.length) { timed = true; for (const stamp of stamps) lines.push({ time_ms: Number(stamp[1])*60000 + Number(stamp[2])*1000 + Number((stamp[3] || '').padEnd(3,'0')), text: content }); }
    else if (!/^\[[a-z]+:/i.test(line)) plain.push(content);
  }
  if (!lines.length) lines.push(...plain.map(text => ({ time_ms: 0, text })));
  if (!lines.length) return null;
  return { track_id: id, synced: timed, lines: lines.sort((a,b) => a.time_ms-b.time_ms), writers: [] };
}

// Reads only Aureon's existing cache. It never requests lyrics or metadata over the network.
export function savedTextDocuments(storage: Pick<Storage, 'length' | 'key' | 'getItem'>): SearchDocument[] {
  const tracks = new Map<string, Track>(); const lyrics = new Map<string, string>();
  const keys = Array.from({ length: Math.min(storage.length, 10000) }, (_,i) => storage.key(i)).filter((key): key is string => !!key && key.startsWith('mashiro.cache.'));
  for (const key of keys) {
    try {
      const raw = storage.getItem(key); if (!raw || raw.length > 8 * 1024 * 1024) continue;
      const data: unknown = JSON.parse(raw).data;
      if (key.startsWith('mashiro.cache.lyrics.') && data && typeof data === 'object') {
        const row = data as Partial<Lyrics>;
        if (typeof row.track_id === 'string' && Array.isArray(row.lines)) {
          const text = row.lines.slice(0, 4000).map(line => typeof line?.text === 'string' ? line.text.slice(0,2000) : '').filter(Boolean).join('\n').slice(0, 262144);
          if (text) lyrics.set(row.track_id, text);
        }
      } else {
        const values = Array.isArray(data) ? data : data && typeof data === 'object' && 'tracks' in data && Array.isArray(data.tracks) ? data.tracks : [];
        for (const row of values.slice(0, 5000)) {
          if (row && typeof row.id === 'string' && typeof row.title === 'string' && Array.isArray(row.artists) && row.artists.every((artist: unknown) => artist && typeof artist === 'object' && 'name' in artist && typeof artist.name === 'string')) tracks.set(row.id, row as Track);
        }
      }
    } catch { /* An incomplete cache entry does not hide the other saved texts. */ }
  }
  return [...lyrics].map(([id, text]) => {
    const track = tracks.get(id) || null;
    return { id, title: track?.title || 'Сохранённый текст', artist: track?.artists.map(a => a.name).join(', ') || '', album: track?.album_title || '', lyrics: text, track, local: id.startsWith('local:') };
  });
}
