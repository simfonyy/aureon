import type { MusicClip, Track } from '@/api/types';

export function musicTrackId(id: string): string | null {
  return /^([1-9]\d{0,19})(?::[1-9]\d{0,19})?$/.exec(id)?.[1] || null;
}

export function hasMusicClips(track: Track | null | undefined): boolean {
  return Boolean(track && musicTrackId(track.id) && track.clip_ids?.some(id => /^[1-9]\d{0,19}$/.test(id)));
}

export function clipMediaUrl(value: string | null | undefined): string | null {
  if (!value || value.length > 8192 || /[\u0000-\u001f\u007f\\]/.test(value)) return null;
  try {
    const url = new URL(value);
    const domains = ['yandex.net', 'yandex.ru', 'yandex.com', 'yandexcdn.net'];
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || (url.port && url.port !== '443')) return null;
    if (!domains.some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`))) return null;
    return url.href;
  } catch { return null; }
}

export function musicTrackUrl(id: string): string | null {
  const numeric = musicTrackId(id);
  return numeric ? `https://music.yandex.ru/track/${numeric}` : null;
}

export function clipsForTrack(clips: MusicClip[], trackId: string): MusicClip[] {
  const numeric = musicTrackId(trackId);
  if (!numeric) return [];
  const seen = new Set<string>();
  return clips.filter(clip => {
    if (!/^[1-9]\d{0,19}$/.test(clip.id) || seen.has(clip.id)) return false;
    if (clip.track_ids.length && !clip.track_ids.includes(numeric)) return false;
    seen.add(clip.id);
    return true;
  }).slice(0, 32).map(clip => ({ ...clip, thumbnail_url: clipMediaUrl(clip.thumbnail_url), preview_url: clipMediaUrl(clip.preview_url) }));
}
