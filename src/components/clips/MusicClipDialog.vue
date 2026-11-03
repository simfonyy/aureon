<template>
  <q-dialog :model-value="Boolean(clips.target)" @update:model-value="value => { if (!value) clips.close(); }">
    <div class="music-clips" role="dialog" aria-labelledby="music-clips-title">
      <header>
        <div><h2 id="music-clips-title">Клипы</h2><p>{{ clips.target?.title }}<span v-if="clips.target"> · {{ artistNames(clips.target.artists) }}</span></p></div>
        <button type="button" class="icon-btn round" aria-label="Закрыть клипы" @click="clips.close()"><Icon name="close" :size="20" /></button>
      </header>
      <div v-if="clips.loading" class="clips-state" role="status"><q-spinner size="24px" /><p>Загружаем клипы…</p></div>
      <div v-else-if="clips.error" class="clips-state" role="alert"><p>{{ clips.error }}</p><button type="button" class="btn" @click="clips.load()">Повторить</button></div>
      <div v-else-if="!clips.clips.length" class="clips-state"><p>Для этого трека клипов нет.</p></div>
      <template v-else>
        <section v-if="selected" class="clip-preview" aria-label="Видеоклип">
          <video v-show="!previewError" :key="selected.id" ref="video" :poster="selected.thumbnail_url || undefined" controls playsinline preload="metadata" @play="previewStarted" @error="previewError = 'Не удалось воспроизвести видео.'" />
          <div class="clip-preview-caption"><strong>{{ selected.title }}</strong><span v-if="previewMode">Превью</span><span v-if="connecting" role="status">Загружаем видео…</span></div>
          <p v-if="previewError" class="clip-preview-error" role="alert">{{ previewError }}</p>
          <button v-if="previewError && !previewMode && selected.preview_url" type="button" class="btn" @click="select(selected, true)">Посмотреть превью</button>
        </section>
        <div class="clip-list">
          <article v-for="clip in clips.clips" :key="clip.id" class="clip-row">
            <button type="button" class="clip-thumb" :aria-label="`Смотреть: ${clip.title}`" @click="select(clip)">
              <img v-if="clip.thumbnail_url" :src="clip.thumbnail_url" alt="" loading="lazy" />
              <Icon v-else name="musicVideo" :size="28" />
              <span class="clip-play"><Icon name="play" :size="20" /></span>
            </button>
            <div class="clip-copy"><strong>{{ clip.title }}</strong><span>{{ artistNames(clip.artists) }}</span><small v-if="clip.duration_ms">{{ formatDuration(clip.duration_ms) }}</small></div>
            <button type="button" class="btn" :disabled="connecting && selected?.id === clip.id" @click="select(clip)">Смотреть</button>
          </article>
        </div>
        <footer><button v-if="externalUrl" type="button" class="btn" @click="openFullClip">Открыть трек в Яндекс Музыке <span aria-hidden="true">↗</span></button></footer>
        <p v-if="externalError" role="alert" class="clip-preview-error">{{ externalError }}</p>
      </template>
    </div>
  </q-dialog>
</template>
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import type { MusicClip } from '@/api/types';
import { api } from '@/api/client';
import { artistNames, formatDuration } from '@/lib/format';
import { musicTrackUrl } from '@/lib/musicClips';
import { attachMusicClip } from '@/lib/musicClipPlayback';
import { useMusicClipsStore } from '@/stores/musicClips';
import { usePlayerStore } from '@/stores/player/index';
import Icon from '@/components/Icon.vue';
const clips = useMusicClipsStore(), player = usePlayerStore();
const selected = ref<MusicClip | null>(null), video = ref<HTMLVideoElement | null>(null), previewError = ref(''), externalError = ref(''), connecting = ref(false), previewMode = ref(false);
const externalUrl = computed(() => musicTrackUrl(clips.target?.id || ''));
let generation = 0;
let release: (() => void) | null = null;
function stopPreview() { release?.(); release = null; const element = video.value; if (!element) return; element.pause(); element.removeAttribute('src'); element.load(); }
async function select(clip: MusicClip, preview = false) {
  if (preview && !clip.preview_url) return;
  const request = ++generation;
  stopPreview(); selected.value = clip; previewError.value = ''; previewMode.value = preview; connecting.value = true;
  const current = () => request === generation && Boolean(clips.target);
  try {
    const stream = preview ? { clip_id: clip.id, url: clip.preview_url!, kind: 'mp4' as const } : await api.clipStream(clip.id);
    if (!current()) return;
    if (stream.clip_id !== clip.id) throw new Error('Не удалось сопоставить видео с клипом.');
    await nextTick();
    const element = video.value;
    if (!current() || !element) return;
    const attached = await attachMusicClip(element, stream, { current, onError: message => { if (current()) previewError.value = message; } });
    if (!current()) { attached?.(); return; }
    release = attached;
    element.volume = Math.max(0, Math.min(1, player.volume));
    void element.play().catch(() => { if (current() && !previewError.value) previewError.value = 'Нажми воспроизведение в плеере.'; });
  } catch (cause) { if (current()) previewError.value = cause instanceof Error ? cause.message : 'Не удалось загрузить клип.'; }
  finally { if (current()) connecting.value = false; }
}
function previewStarted() { if (selected.value && !connecting.value) player.setPlaying(false); }
async function openFullClip() {
  const url = externalUrl.value;
  if (!url) return;
  const request = ++generation;
  connecting.value = false; stopPreview(); selected.value = null; externalError.value = '';
  try { await api.openExternal(url); if (request === generation && clips.target) player.setPlaying(false); }
  catch { if (request === generation && clips.target) externalError.value = 'Не удалось открыть Яндекс Музыку.'; }
}
watch(() => player.isPlaying, playing => {
  if (!playing) return;
  if (connecting.value) { generation++; connecting.value = false; stopPreview(); selected.value = null; }
  else video.value?.pause();
});
watch(() => player.current?.id, () => {
  if (connecting.value) { generation++; connecting.value = false; stopPreview(); selected.value = null; }
});
watch(() => clips.target?.id, () => { generation++; stopPreview(); selected.value = null; connecting.value = false; previewError.value = ''; externalError.value = ''; });
onBeforeUnmount(() => { generation++; stopPreview(); clips.close(); });
</script>
<style scoped>
.music-clips{box-sizing:border-box;width:min(900px,94vw);max-width:calc(100vw - 48px)!important;max-height:calc(100dvh - 48px);overflow:auto;background:var(--surface);color:var(--fg);border:1px solid var(--line);border-radius:16px;padding:24px}
.music-clips header{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;margin-bottom:24px}.music-clips h2{margin:0 0 8px;font-size:24px;letter-spacing:-.025em}.music-clips header p{margin:0;color:var(--fg-dim);font-size:13px;overflow-wrap:anywhere}
.clips-state{display:grid;justify-items:center;gap:10px;padding:48px 10px;color:var(--fg-dim)}.clips-state p{margin:0;line-height:1.5;text-align:center}
.clip-preview{margin-bottom:22px}.clip-preview video{display:block;width:100%;max-height:55dvh;aspect-ratio:16/9;object-fit:contain;background:#080808;border-radius:10px}.clip-preview-caption{display:flex;align-items:center;gap:12px;padding:12px 0}.clip-preview-caption strong{font-size:14px}.clip-preview-caption span{font-size:11px;color:var(--fg-dim);padding:3px 7px;border:1px solid var(--line);border-radius:5px}
.clip-list{display:grid;gap:12px}.clip-row{display:flex;align-items:center;gap:16px;padding:12px 0;border-top:1px solid var(--line)}.clip-thumb{position:relative;flex:none;width:144px;aspect-ratio:16/9;display:grid;place-items:center;border:0;border-radius:8px;overflow:hidden;background:var(--surface-2);color:var(--fg);padding:0;cursor:pointer}.clip-thumb:disabled{cursor:default}.clip-thumb img{width:100%;height:100%;object-fit:cover}.clip-play{position:absolute;inset:0;display:grid;place-items:center;background:#0002}.clip-play .ic{filter:drop-shadow(0 1px 4px #000)}.clip-copy{min-width:0;flex:1;display:grid;gap:5px}.clip-copy strong{font-size:14px;overflow-wrap:anywhere}.clip-copy span,.clip-copy small{color:var(--fg-dim);font-size:12px}
.music-clips footer{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-top:22px;padding-top:18px;border-top:1px solid var(--line)}.music-clips footer p{margin:0;color:var(--fg-dim);font-size:12px}.clip-preview-error{font-size:12px;color:var(--fg);padding:8px 0}.music-clips button:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
@media(max-width:600px){.music-clips{padding:16px}.clip-row{flex-wrap:wrap;gap:12px}.clip-thumb{width:110px}.clip-row>.btn{margin-left:122px}}
</style>
