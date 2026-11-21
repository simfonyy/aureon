import { defineStore } from 'pinia';
import type { MusicClip, Track } from '@/api/types';
import { api } from '@/api/client';
import { clipsForTrack, musicTrackId } from '@/lib/musicClips';

export const useMusicClipsStore = defineStore('musicClips', {
  state: () => ({ target: null as Track | null, clips: [] as MusicClip[], loading: false, error: '', request: 0,
    knownClipIds: {} as Record<string, string[]>, pendingLookups: [] as string[], lookupEpoch: 0 }),
  actions: {
    async lookup(track: Track) {
      const id = musicTrackId(track.id);
      if (!id || this.knownClipIds[id] !== undefined || this.pendingLookups.includes(id)) return;
      const epoch = this.lookupEpoch;
      this.pendingLookups.push(id);
      try {
        const details = await api.trackClips(id);
        if (epoch !== this.lookupEpoch) return;
        this.knownClipIds[id] = clipsForTrack(details, id).map(clip => clip.id);
        const keys = Object.keys(this.knownClipIds);
        if (keys.length > 64) delete this.knownClipIds[keys[0]!];
      } catch { /* Optional metadata must not interrupt playback. */ }
      finally { if (epoch === this.lookupEpoch) this.pendingLookups = this.pendingLookups.filter(value => value !== id); }
    },
    async open(track: Track) {
      if (!musicTrackId(track.id)) return;
      this.target = track;
      this.clips = [];
      await this.load();
    },
    async load() {
      const target = this.target;
      if (!target) return;
      const request = ++this.request;
      this.loading = true;
      this.error = '';
      try {
        const clips = await api.trackClips(musicTrackId(target.id)!);
        if (request !== this.request || this.target?.id !== target.id) return;
        this.clips = clipsForTrack(clips, target.id);
      } catch (cause) {
        if (request !== this.request) return;
        this.error = cause instanceof Error ? cause.message : 'Не удалось загрузить клипы.';
      } finally { if (request === this.request) this.loading = false; }
    },
    close() { this.request++; this.target = null; this.clips = []; this.loading = false; this.error = ''; },
    reset() { this.close(); this.lookupEpoch++; this.knownClipIds = {}; this.pendingLookups = []; },
  },
});
