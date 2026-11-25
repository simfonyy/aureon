<template>
  <Teleport to="body">
    <Transition name="fs" :duration="{ enter: 280, leave: 320 }">
      <div
        v-if="player.fullscreen && player.current"
        class="fs-player"
        @pointermove="pointerMoved"
        :class="{ 'with-queue': showQueue, 'has-clip-background': clipReady, 'clip-idle': clipReady && docked && !showQueue && !trackMenuOpen, 'clip-peek': clipReady && peek && !showQueue }"
      >
        <div
          v-if="coverUrl"
          class="fs-backdrop"
          :style="{ backgroundImage: `url(${coverUrl})` }"
        />
        <div class="fs-shade" />
        <MusicClipBackdrop class="fs-clip-backdrop" :track="player.current" :enabled="ui.settings.musicVideoBackground" :blur-px="ui.settings.musicVideoBlur" :active="player.fullscreen && !player.showLyrics && !player.loading" :position="player.progress" :playing="player.isPlaying" :playback-rate="player.playbackRate" :pending-resume="player.pendingResume" :alignment-allowed="!player.censorReplaced && !player.playingLocal" @ready="clipReady = $event" @loading="clipAligning = $event" @error="clipError" />

        <div class="fs-top">
          <div class="fs-drag" @mousedown="onDrag" @dblclick="toggleNative" />
          <div class="fs-top-actions">
            <ClipBackgroundControl :track="player.current" :active="player.fullscreen && !player.showLyrics" />
            <span v-if="clipAligning" class="clip-alignment-status" role="status"><q-spinner size="12px" />Загрузка клипа…</span>
            <button type="button" class="icon-btn round" aria-label="Текст трека" @click="openLyrics">
              <Icon name="lyrics" :size="18" />
              <q-tooltip>Текст трека</q-tooltip>
            </button>
            <button
              type="button"
              class="icon-btn round"
              aria-label="Очередь"
              :class="{ on: showQueue }"
              @click="showQueue = !showQueue"
            >
              <Icon name="queue" :size="18" />
              <q-tooltip>Очередь</q-tooltip>
            </button>
            <button type="button" class="icon-btn round" :aria-label="native ? 'Оконный режим' : 'Весь экран'" @click="toggleNative">
              <Icon :name="native ? 'restore' : 'maximize'" :size="16" />
              <q-tooltip>
                {{ native ? "Оконный режим" : "Весь экран" }}
              </q-tooltip>
            </button>
            <button type="button" class="icon-btn round" aria-label="Закрыть полноэкранный плеер" @click="close">
              <Icon name="close" :size="19" />
              <q-tooltip>Закрыть (Esc)</q-tooltip>
            </button>
          </div>
        </div>

        <div class="fs-body">
          <div class="fs-stage">
            <div class="fs-dock" @focusin="revealDock">
              <div class="fs-art">
                <Transition name="fs-swap">
                  <img
                    v-if="coverUrl"
                    :key="coverUrl"
                    :src="coverUrl"
                    decoding="async"
                    alt=""
                    @error="coverFailed = true"
                    @click="openLyrics"
                  />
                  <Icon v-else name="note" :size="72" class="faint" />
                </Transition>
                <div class="fs-player-actions" :class="{ 'menu-open': trackMenuOpen }" data-no-drag @click.stop>
                  <button
                    type="button"
                    class="fs-ctl fs-art-menu"
                    aria-label="Меню трека"
                    :aria-expanded="trackMenuOpen"
                  >
                    <Icon name="more" :size="19" />
                    <TrackMenu :track="player.current" @before-show="trackMenuOpen = true" @hide="trackMenuOpen = false" />
                  </button>
                  <div class="fs-art-row">
                    <button
                      type="button"
                      class="fs-ctl"
                      aria-label="Предыдущий трек"
                      :disabled="!player.hasPrev && player.progress <= 3"
                      @click.stop="player.prev()"
                    >
                      <Icon name="prev" :size="22" />
                      <q-tooltip>Предыдущий</q-tooltip>
                    </button>
                    <button
                      type="button"
                      class="fs-ctl fs-ctl-main"
                      :aria-label="player.isPlaying ? 'Пауза' : 'Воспроизвести'"
                      @click.stop="player.toggle()"
                    >
                      <Icon
                        :name="player.isPlaying ? 'pause' : 'play'"
                        :size="28"
                      />
                      <q-tooltip>
                        {{ player.isPlaying ? "Пауза" : "Играть" }}
                      </q-tooltip>
                    </button>
                    <button
                      type="button"
                      class="fs-ctl"
                      aria-label="Следующий трек"
                      :disabled="!player.hasNext"
                      @click.stop="player.next()"
                    >
                      <Icon name="next" :size="22" />
                      <q-tooltip>Следующий</q-tooltip>
                    </button>
                  </div>
                  <VolumeControl class="fs-art-volume" orientation="vertical" />
                  <button
                    type="button"
                    class="fs-ctl fs-art-like"
                    :aria-label="liked ? 'Убрать лайк' : 'Мне нравится'"
                    :aria-pressed="liked"
                    :class="{ on: liked }"
                    @click.stop="like"
                  >
                    <Icon :name="liked ? 'heartFilled' : 'heart'" :size="19" />
                    <q-tooltip>
                      {{ liked ? "Убрать лайк" : "Мне нравится" }}
                    </q-tooltip>
                  </button>
                </div>
              </div>

              <Transition name="fs-swap" mode="out-in">
                <div :key="player.current.id" class="fs-meta">
                  <div class="fs-title ellipsis">{{ player.current.title }}</div>
                  <div class="fs-artists ellipsis">
                    <ArtistsLine :artists="player.current.artists" :limit="3" />
                  </div>
                </div>
              </Transition>

              <div class="fs-progress">
                <span class="t-11 faint">{{
                  formatDuration(seekValue * 1000)
                }}</span>
                <q-slider
                  dense
                  color="primary"
                  :model-value="seekValue"
                  :min="0"
                  :max="Math.max(player.duration, 1)"
                  :step="1"
                  @update:model-value="onSeekInput"
                  @change="onSeekCommit"
                />
                <span class="t-11 faint">{{
                  formatDuration(player.duration * 1000)
                }}</span>
              </div>
            </div>
          </div>

          <Transition name="fs-q">
            <div v-if="showQueue" class="fs-queue">
              <div class="fs-queue-head">
                <span>Очередь</span>
                <div class="fs-queue-actions">
                  <QueuePlaylistButton />
                  <button type="button" class="icon-btn round" aria-label="Скрыть очередь" @click="showQueue = false">
                    <Icon name="close" :size="16" />
                  </button>
                </div>
              </div>
              <q-scroll-area class="fs-queue-list">
                <div
                  v-for="item in queueWindow"
                  :key="`${item.index}-${item.track.id}`"
                  class="fs-queue-item"
                  :class="{ on: item.index === player.index }"
                  @click="jumpTo(item.index)"
                >
                  <div class="cover fs-queue-cover">
                    <img
                      v-if="item.track.cover_url"
                      :src="item.track.cover_url"
                      loading="lazy"
                      decoding="async"
                      alt=""
                    />
                    <Icon v-else name="note" :size="14" class="faint" />
                  </div>
                  <div class="col" style="min-width: 0">
                    <div class="ellipsis t-13">{{ item.track.title }}</div>
                    <div class="faint t-11 ellipsis">
                      <ArtistsLine :artists="item.track.artists" :limit="2" />
                    </div>
                  </div>
                  <Icon
                    v-if="item.index === player.index"
                    :name="player.isPlaying ? 'pause' : 'play'"
                    :size="13"
                  />
                </div>
                <div v-if="!queueWindow.length" class="faint t-12 q-pa-md">
                  Очередь пуста
                </div>
              </q-scroll-area>
            </div>
          </Transition>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import ArtistsLine from "@/components/ArtistsLine.vue";
import Icon from "@/components/Icon.vue";
import TrackMenu from "@/components/TrackMenu.vue";
import VolumeControl from "@/components/player/VolumeControl.vue";
import ClipBackgroundControl from '@/components/clips/ClipBackgroundControl.vue';
import QueuePlaylistButton from '@/components/QueuePlaylistButton.vue';
import MusicClipBackdrop from '@/components/clips/MusicClipBackdrop.vue';
import { Notify } from 'quasar';
import { formatDuration } from "@/lib/format";
import { largeCoverUrl } from '@/lib/coverArtwork';
import {
  isNativeFullscreen,
  setNativeFullscreen,
  startWindowDrag,
} from "@/lib/window";
import { useLibraryStore } from "@/stores/library";
import { usePlayerStore } from "@/stores/player/index";
import { useUiStore } from '@/stores/ui';

const player = usePlayerStore();
const ui = useUiStore();
function clipError(message: string) { Notify.create({ message, group: `clip-background-${player.current?.id}`, timeout: 5000 }); }
const library = useLibraryStore();
const route = useRoute();
const clipAligning = ref(false);
const clipReady = ref(false);
watch(() => player.current?.id, () => { clipReady.value = false; });
const coverFailed = ref(false);
watch(() => [player.current?.id, player.current?.cover_url], () => { coverFailed.value = false; });

const showQueue = ref(false);
const trackMenuOpen = ref(false);
const docked = ref(false);
const peek = ref(false);
let idleTimer: number | undefined;

function settleDock() {
  window.clearTimeout(idleTimer);
  if (clipReady.value && !showQueue.value && !trackMenuOpen.value) docked.value = true;
}

function revealDock() {
  if (!clipReady.value) return;
  window.clearTimeout(idleTimer);
  if (docked.value) peek.value = true;
  docked.value = false;
  idleTimer = window.setTimeout(() => {
    if (!document.querySelector('.fs-dock :focus-visible, .fs-dock :active')) settleDock();
  }, 2000);
}

function pointerMoved(event: PointerEvent) {
  if (!document.hasFocus() || (!event.movementX && !event.movementY)) return;
  if (!docked.value || (event.target as HTMLElement).closest('.fs-dock')) revealDock();
}

watch(() => [clipReady.value, showQueue.value, trackMenuOpen.value], () => {
  window.clearTimeout(idleTimer);
  docked.value = false;
  peek.value = false;
  if (clipReady.value && !document.hasFocus()) settleDock();
  else if (clipReady.value && !showQueue.value && !trackMenuOpen.value) revealDock();
});
const native = ref(false);
let nativeCloseTimer: number | undefined;
let nativeReadVersion = 0;

function cancelNativeClose() {
  if (nativeCloseTimer !== undefined) window.clearTimeout(nativeCloseTimer);
  nativeCloseTimer = undefined;
}

const coverUrl = computed(() => coverFailed.value ? player.current?.cover_url || '' : largeCoverUrl(player.current?.cover_url));

const scrubbing = ref<number | null>(null);
const seekValue = computed(() => scrubbing.value ?? player.progress);

function onSeekInput(value: number | null) {
  scrubbing.value = Number(value ?? 0);
}

function onSeekCommit(value: number | null) {
  const target = Number(value ?? 0);
  scrubbing.value = null;
  player.seek(target);
}
const liked = computed(() =>
  player.current ? library.liked(player.current.id) : false,
);

const HISTORY = 5;
const VISIBLE = 60;

const queueWindow = computed(() => {
  const queue = player.queue ?? [];
  const start = Math.max(0, player.index - HISTORY);
  const end = Math.min(queue.length, player.index + 1 + VISIBLE);
  const out: Array<{ track: (typeof queue)[number]; index: number }> = [];
  for (let i = start; i < end; i++) {
    const track = queue[i];
    if (track) out.push({ track, index: i });
  }
  return out;
});

function jumpTo(index: number) {
  player.index = index;
  void player.loadCurrent();
}

function onDrag(event: MouseEvent) {
  if (event.button !== 0 || native.value) return;
  void startWindowDrag(event);
}

function like() {
  if (player.current) void library.toggleLike(player.current);
}

function openLyrics() {
  void player.openLyricsFullscreen();
}

async function toggleNative() {
  const value = !native.value;
  const ok = await setNativeFullscreen(value);
  native.value = ok ? value : await isNativeFullscreen();
}

function close() {
  const wasNative = native.value;
  cancelNativeClose();
  showQueue.value = false;
  player.closeFullscreen();
  if (!wasNative) return;
  native.value = false;
  nativeCloseTimer = window.setTimeout(() => {
    nativeCloseTimer = undefined;
    if (!player.fullscreen) void setNativeFullscreen(false);
  }, 340);
}

function onKey(event: KeyboardEvent) {
  if (!player.fullscreen || event.defaultPrevented || event.repeat) return;
  if (event.key === 'F11' && !event.altKey && !event.ctrlKey && !event.metaKey) {
    event.preventDefault();
    void toggleNative();
    return;
  }
  if (event.key === "Escape" && !trackMenuOpen.value) close();
}

watch(
  () => player.fullscreen,
  (open) => {
    const request = ++nativeReadVersion;
    if (open) {
      cancelNativeClose();
      void isNativeFullscreen().then((value) => {
        if (request === nativeReadVersion && player.fullscreen) native.value = value;
      });
      return;
    }
    showQueue.value = false;
    trackMenuOpen.value = false;
    if (native.value) {
      native.value = false;
      void setNativeFullscreen(false);
    }
  },
);

watch(
  () => route.fullPath,
  () => {
    if (player.fullscreen) close();
  },
);

onMounted(() => {
  window.addEventListener("keydown", onKey);
  window.addEventListener("blur", settleDock);
});

onBeforeUnmount(() => {
  window.clearTimeout(idleTimer);
  window.removeEventListener("blur", settleDock);
  nativeReadVersion++;
  const shouldExit = native.value || nativeCloseTimer !== undefined;
  cancelNativeClose();
  if (shouldExit) void setNativeFullscreen(false);
  window.removeEventListener("keydown", onKey);
});
</script>

<style scoped>
.fs-player { overflow:clip;--clip-control-fg:#ffffffb3;--clip-control-hover:#fff;--clip-control-hover-bg:#ffffff18;--clip-control-on:#fff; }
.fs-clip-backdrop { z-index:1; }
.clip-alignment-status { display:inline-flex;align-items:center;gap:7px;color:#ffffffb3;font-size:12px;margin-inline:4px 10px; }
.fs-stage { container-type: inline-size; }

.fs-dock {
  --dock-shift: 0px;
  --dock-motion: 250ms cubic-bezier(.22, .65, .28, 1);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: clamp(10px, 2vh, 20px);
  width: min(560px, 100%);
  min-width: 0;
  translate: var(--dock-shift) 0;
  transition: width var(--dock-motion), translate var(--dock-motion), opacity .22s ease, transform .26s ease;
}

.fs-dock .fs-art {
  --cover-limit: 460px;
  --art-size: min(50vh, var(--cover-limit), 100%, max(150px, calc(100dvh - 225px)));
  width: var(--art-size);
  height: auto;
  flex-shrink: 0;
  aspect-ratio: 1;
  container-type: inline-size;
  transition: width var(--dock-motion);
}

.has-clip-background .fs-dock {
  position: absolute;
  left: 50%;
  bottom: 50%;
  translate: -50% 50%;
  transition: left var(--dock-motion), bottom var(--dock-motion), translate var(--dock-motion), width var(--dock-motion);
}
.has-clip-background.with-queue .fs-dock { position: static; translate: none; }
.clip-peek .fs-dock {
  width: min(360px, 78vw, 47vh);
  left: clamp(20px, 3vw, 48px);
  bottom: clamp(20px, 4vh, 52px);
  translate: 0 0;
}
.clip-peek .fs-art { order: 1; }
.clip-idle .fs-dock {
  width: clamp(96px, 10vw, 152px);
  bottom: clamp(20px, 4vh, 52px);
  left: clamp(20px, 3vw, 48px);
  translate: 0 0;
  gap: 0;
}
.clip-idle .fs-dock .fs-meta, .clip-idle .fs-dock .fs-progress {
  visibility: hidden;
  height: 0;
  overflow: hidden;
}
.clip-idle .fs-player-actions { opacity: 0; pointer-events: none; }
.clip-idle .fs-player-actions > * { pointer-events: none; }
html.no-motion .fs-dock, html.no-motion .fs-dock .fs-art { transition: none; }

.fs-dock .fs-meta,
.fs-dock .fs-progress { width: 100%; max-width: 100%; }

@media (prefers-reduced-motion: reduce) {
  .fs-dock,
  .fs-dock .fs-art { transition: none; }
}
</style>
