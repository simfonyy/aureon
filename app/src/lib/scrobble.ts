import type { Track } from '@/api/types';
import type { PlayEvent } from '@/stores/stats';
export function scrobbleCandidate(event: PlayEvent|undefined, track: Track|null, enabled:boolean, sent:ReadonlySet<string>) {
  if(!enabled||!event||!track||event.id!==track.id||!track.duration_ms||!Number.isFinite(track.duration_ms)||track.duration_ms<=0||!Number.isFinite(event.seconds)||event.seconds<0||!Number.isFinite(event.at))return null;
  const listenedAt=Math.floor(event.at/1000);
  if(!Number.isSafeInteger(listenedAt)||listenedAt<=0)return null;
  const key=`${event.id}:${event.at}`;
  const artist=track.artists.map(a=>a.name.trim()).filter(Boolean).join(', '),title=track.title.trim();
  if(!artist||!title||sent.has(key)||event.seconds<Math.min(240,track.duration_ms/2000))return null;
  return {key,listen:{artist,title,album:track.album_title,durationMs:track.duration_ms,listenedAt}};
}
