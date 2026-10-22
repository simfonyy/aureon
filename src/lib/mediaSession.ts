import { watch } from 'vue';
import type { usePlayerStore } from '@/stores/player';

let dispose: (() => void) | undefined;

export function bindMediaSession(player: ReturnType<typeof usePlayerStore>) {
  dispose?.();
  if (!('mediaSession' in navigator)) return;
  const session = navigator.mediaSession;
  const handlers: Partial<Record<MediaSessionAction, MediaSessionActionHandler>> = {
    play: () => player.setPlaying(true),
    pause: () => player.setPlaying(false),
    nexttrack: () => { void player.next(); },
    previoustrack: () => { void player.prev(); },
    seekto: details => { if (details.seekTime !== undefined) player.seek(details.seekTime); },
    seekbackward: details => player.seek(player.progress - (details.seekOffset ?? 10)),
    seekforward: details => player.seek(player.progress + (details.seekOffset ?? 10)),
    stop: () => { player.setPlaying(false); player.seek(0); },
  };
  for (const [action, handler] of Object.entries(handlers)) {
    try { session.setActionHandler(action as MediaSessionAction, handler!); } catch { /* Unsupported OS action. */ }
  }
  const stopMetadata = watch(() => player.current, track => {
    if (typeof MediaMetadata === 'undefined') return;
    session.metadata = track ? new MediaMetadata({
      title: track.title,
      artist: track.artists.map(artist => artist.name).join(', '),
      album: track.album_title ?? '',
      artwork: track.cover_url ? [{ src: track.cover_url }] : [],
    }) : null;
  }, { immediate: true });
  const stopPosition = watch(() => [player.isPlaying, player.progress, player.duration, player.playbackRate, player.current] as const, () => {
    session.playbackState = !player.current ? 'none' : player.isPlaying ? 'playing' : 'paused';
    try {
      const duration = player.duration;
      session.setPositionState(Number.isFinite(duration) && duration > 0 ? {
        duration, position: Math.max(0, Math.min(duration, player.progress)), playbackRate: player.playbackRate,
      } : undefined);
    } catch { /* Older WebViews may not expose a position timeline. */ }
  }, { immediate: true });
  dispose = () => {
    stopMetadata(); stopPosition();
    for (const action of Object.keys(handlers)) {
      try { session.setActionHandler(action as MediaSessionAction, null); } catch {}
    }
  };
}
