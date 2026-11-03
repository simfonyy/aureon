<template>
  <div class="music-clip-backdrop" :class="{ 'is-ready': frameReady }" aria-hidden="true">
    <video :key="mediaKey" ref="video" muted playsinline preload="auto" disablepictureinpicture
      tabindex="-1" @loadedmetadata="metadataLoaded" @loadeddata="frameLoaded"
      @seeked="frameLoaded" @canplay="frameLoaded" @error="mediaFailed" />
    <div class="music-clip-backdrop-shade" />
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { MusicClipStream, Track } from '@/api/types';
import { api } from '@/api/client';
import { clipsForTrack, hasMusicClips, musicTrackId } from '@/lib/musicClips';
import { attachMusicClip } from '@/lib/musicClipPlayback';
import { createMusicClipSynchronizer } from '@/lib/musicClipSync';
import { audio } from '@/lib/audio';
import { clipAlignmentCache, CLIP_ALIGNMENT_ERROR } from '@/lib/clipAlignment';

const props = withDefaults(defineProps<{
  track: Track | null;
  enabled: boolean;
  active: boolean;
  position: number;
  playing: boolean;
  playbackRate?: number;
  pendingResume?: boolean;
  offsetSeconds?: number;
  alignmentAllowed?: boolean;
}>(), { playbackRate: 1, pendingResume: false, offsetSeconds: 0, alignmentAllowed: true });
const emit = defineEmits<{ ready: [value: boolean]; error: [message: string]; loading: [value: boolean] }>();
const video = ref<HTMLVideoElement | null>(null);
const frameReady = ref(false), mediaKey = ref(0);
const visible = ref(typeof document === 'undefined' || !document.hidden);
let request = 0, disposed = false;
type Synchronizer = ReturnType<typeof createMusicClipSynchronizer>;
type Session = { request: number; media: HTMLVideoElement; sync: Synchronizer; release: (() => void) | null; clock: ReturnType<typeof setInterval> | null; timeout: ReturnType<typeof setTimeout> | null; attached: boolean; alignmentOffset: number };
let session: Session | null = null;
let audioWaiting = false;
let lastDisallowedTrack = '';

function setReady(value: boolean) {
  frameReady.value = value;
  emit('ready', value);
}
function surfaceEligible() { return !disposed && props.enabled && props.active && visible.value && Boolean(props.track && musicTrackId(props.track.id)); }
function eligible() { return surfaceEligible() && props.alignmentAllowed; }
function current(value: Session) { return eligible() && session === value && value.request === request && value.media === video.value; }
function stop() {
  request++;
  const old = session;
  session = null;
  setReady(false);
  emit('loading', false);
  if (!old) return;
  if (old.clock !== null) clearInterval(old.clock);
  if (old.timeout !== null) clearTimeout(old.timeout);
  old.sync.dispose();
  if (old.release) old.release();
  else { old.media.pause(); old.media.removeAttribute('src'); old.media.load(); }
}
function fail(value: Session, message: string) {
  if (!current(value)) return;
  stop();
  emit('error', message);
}
function sync(force = false) {
  const value = session;
  if (!value || !current(value) || !value.attached) return;
  const sourceReady = !props.pendingResume && Boolean(audio.getAttribute('src')) && Number.isFinite(audio.currentTime);
  const position = sourceReady ? audio.currentTime : props.position;
  const offset = Number.isFinite(props.offsetSeconds) ? props.offsetSeconds : 0;
  const playing = sourceReady && props.playing && !audio.paused && !audio.seeking && !audioWaiting && audio.readyState >= 3;
  const rate = sourceReady && Number.isFinite(audio.playbackRate) && audio.playbackRate > 0 ? audio.playbackRate : props.playbackRate;
  value.sync.sync(position + value.alignmentOffset + offset, playing, rate, force);
}
function metadataLoaded(event: Event) {
  if (event.currentTarget === session?.media) sync(true);
}
function frameLoaded(event: Event) {
  const value = session;
  if (!value || !current(value) || !value.attached || event.currentTarget !== value.media || value.media.readyState < 2) return;
  sync();
  if (value.media.seeking) return;
  if (value.timeout !== null) { clearTimeout(value.timeout); value.timeout = null; }
  setReady(true);
  emit('loading', false);
}
function mediaFailed(event: Event) {
  const value = session;
  if (!value?.attached || event.currentTarget !== value.media || !current(value)) return;
  // HLS.js owns MSE recovery. Let its bounded retries finish before falling back.
  if (value.media.currentSrc.startsWith('blob:')) return;
  // Keep diagnostics useful without recording signed URLs or track/account data.
  console.warn('[clip-background]', { code: value.media.error?.code ?? 0, readyState: value.media.readyState, networkState: value.media.networkState, mediaSource: value.media.currentSrc.startsWith('blob:') });
  fail(value, 'Не удалось воспроизвести клип. Оставили обычный фон.');
}

async function start() {
  stop();
  mediaKey.value = request;
  const token = request, track = props.track;
  if (!surfaceEligible() || !track) return;
  if (!props.alignmentAllowed) {
    if (hasMusicClips(track) && lastDisallowedTrack !== track.id) { lastDisallowedTrack = track.id; emit('error', CLIP_ALIGNMENT_ERROR); }
    return;
  }
  await nextTick();
  if (token !== request || !eligible() || !video.value) return;
  const media = video.value;
  media.muted = true; media.defaultMuted = true; media.volume = 0; media.loop = false;
  const value: Session = { request: token, media, release: null, clock: null, timeout: null, attached: false, alignmentOffset: 0,
    sync: createMusicClipSynchronizer(media, { current: () => current(value), onError: message => fail(value, message) }) };
  session = value;
  emit('loading', true);
  value.timeout = setTimeout(() => fail(value, CLIP_ALIGNMENT_ERROR), 110_000);
  try {
    const clips = clipsForTrack(await api.trackClips(musicTrackId(track.id)!), track.id);
    if (!current(value)) return;
    if (!clips.length) { stop(); return; }
    let stream: MusicClipStream | null = null;
    let lastError: unknown;
    // A track can carry more than one edition. Try a bounded number of full clips.
    for (const clip of clips.slice(0, 3)) {
      try {
        const editionDuration = !props.pendingResume && Number.isFinite(audio.duration) && audio.duration > 0
          ? audio.duration : (track.duration_ms || 0) / 1000;
        if (value.timeout !== null) { clearTimeout(value.timeout); value.timeout = null; }
        const alignment = await clipAlignmentCache.get(track.id, clip.id, editionDuration,
          () => api.alignMusicClip(musicTrackId(track.id)!, clip.id), {
            current: () => current(value),
            onStart: () => {
              if (!current(value)) return;
              if (value.timeout !== null) clearTimeout(value.timeout);
              value.timeout = setTimeout(() => fail(value, CLIP_ALIGNMENT_ERROR), 110_000);
            },
          });
        if (!current(value)) return;
        if (value.timeout !== null) clearTimeout(value.timeout);
        value.timeout = setTimeout(() => fail(value, 'Клип не загрузился. Оставили обычный фон.'), 25_000);
        const candidate = await api.clipStream(clip.id);
        if (!current(value)) return;
        if (!candidate || candidate.clip_id !== clip.id) throw new Error('Не удалось получить нужный клип.');
        stream = candidate;
        value.alignmentOffset = alignment.offsetSeconds;
        break;
      }
      catch (cause) { lastError = cause; }
      if (!current(value)) return;
    }
    if (!current(value)) return;
    if (!stream) throw lastError || new Error('Клип недоступен.');
    if (value.timeout !== null) clearTimeout(value.timeout);
    value.timeout = setTimeout(() => fail(value, 'Клип не загрузился. Оставили обычный фон.'), 25_000);
    value.attached = true;
    const release = await attachMusicClip(media, stream, { current: () => current(value), onError: message => fail(value, message), background: true });
    if (!current(value)) { release?.(); return; }
    if (!release) { fail(value, 'Не удалось загрузить клип.'); return; }
    value.release = release;
    sync(true);
    value.clock = setInterval(() => sync(), 100);
    if (media.readyState >= 2 && !media.seeking) {
      if (value.timeout !== null) { clearTimeout(value.timeout); value.timeout = null; }
      setReady(true);
      emit('loading', false);
    }
  } catch (cause) {
    fail(value, cause instanceof Error ? cause.message : 'Не удалось загрузить клип. Оставили обычный фон.');
  }
}
watch(() => [props.track?.id, props.enabled, props.active, props.alignmentAllowed, visible.value] as const, () => { void start(); }, { immediate: true, flush: 'post' });
watch(() => [props.position, props.playing, props.playbackRate, props.pendingResume, props.offsetSeconds] as const, () => sync());
function visibilityChanged() { visible.value = !document.hidden; }
const audioEvents = ['waiting', 'seeking', 'pause', 'playing', 'seeked', 'canplay', 'ratechange', 'emptied', 'ended'] as const;
function audioStateChanged(event: Event) {
  if (event.type === 'waiting' || event.type === 'emptied') audioWaiting = true;
  else if (event.type === 'playing' || event.type === 'canplay' || event.type === 'seeked') audioWaiting = false;
  sync(event.type === 'seeked');
}
onMounted(() => {
  document.addEventListener('visibilitychange', visibilityChanged);
  for (const name of audioEvents) audio.addEventListener(name, audioStateChanged);
});
onBeforeUnmount(() => {
  disposed = true;
  document.removeEventListener('visibilitychange', visibilityChanged);
  for (const name of audioEvents) audio.removeEventListener(name, audioStateChanged);
  stop();
});
</script>

<style scoped>
.music-clip-backdrop { position:absolute;inset:0;overflow:hidden;pointer-events:none;opacity:0;transition:opacity 240ms ease; }
.music-clip-backdrop.is-ready { opacity:1; }
.music-clip-backdrop video { position:absolute;inset:-3px;display:block;width:calc(100% + 6px);height:calc(100% + 6px);object-fit:cover;filter:blur(2px); }
.music-clip-backdrop-shade { position:absolute;inset:0;background:linear-gradient(180deg,#050508b8,#05050855 28%,#05050880 72%,#050508d9),linear-gradient(90deg,#05050855,transparent 55%); }
@media(prefers-reduced-motion:reduce) { .music-clip-backdrop { transition:none; } }
</style>
