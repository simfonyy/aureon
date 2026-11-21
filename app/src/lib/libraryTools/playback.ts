import { invoke } from '@tauri-apps/api/core';
import { convertFileSrc } from '@tauri-apps/api/core';
import type { Lyrics } from '@/api/types';
import { parseLocalLyrics } from './model';

export function isLibraryTrack(id: string | undefined | null): boolean { return Boolean(id?.startsWith('local:')); }
export async function localTrackSource(id: string): Promise<string> {
  if (!isLibraryTrack(id)) throw new Error('Это не локальный трек');
  return convertFileSrc(await invoke<string>('library_track_path', { id }));
}
export async function localTrackLyrics(id: string): Promise<Lyrics | null> {
  if (!isLibraryTrack(id)) return null;
  return parseLocalLyrics(id, await invoke<string>('library_lyrics', { id }));
}
