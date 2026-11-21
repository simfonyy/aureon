import { computed, ref, watch } from 'vue';
import { defineStore } from 'pinia';
import type { Playlist, Track } from '@/api/types';
import { readCache, writeCache } from '@/lib/cache';
import { useAuthStore } from './auth';

export type PlaylistSource = Pick<Playlist, 'kind' | 'title' | 'cover_url'>;
export interface RecentMusic {
  kind: 'album' | 'playlist';
  id: string;
  title: string;
  cover: string | null;
}

export const useRecentMusicStore = defineStore('recentMusic', () => {
  const auth = useAuthStore();
  const key = computed(() => auth.profile?.uid ? 'home.recent.' + auth.profile.uid : '');
  const items = ref<RecentMusic[]>([]);

  watch(key, value => {
    const data = value ? readCache<RecentMusic[]>(value) : null;
    items.value = Array.isArray(data) ? data.filter(row =>
      row && ['album', 'playlist'].includes(row.kind) && /^\d+$/.test(row.id) && typeof row.title === 'string',
    ).slice(0, 4) : [];
  }, { immediate: true, flush: 'sync' });

  function record(track: Track, playlist: PlaylistSource | null) {
    if (!key.value) return;
    let item: RecentMusic;
    if (playlist) {
      item = { kind: 'playlist', id: String(playlist.kind), title: playlist.title, cover: playlist.cover_url };
    } else if (track.album_id && track.album_title && /^\d+$/.test(track.album_id)) {
      item = { kind: 'album', id: track.album_id, title: track.album_title, cover: track.cover_url };
    } else return;
    const latest = items.value[0];
    if (latest?.kind === item.kind && latest.id === item.id && latest.title === item.title && latest.cover === item.cover) return;
    items.value = [item, ...items.value.filter(row => row.kind !== item.kind || row.id !== item.id)].slice(0, 4);
    writeCache(key.value, items.value);
  }

  return { items, record };
});
