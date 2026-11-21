<template>
  <div v-if="track" class="phone-miniplayer" :style="{ '--played': played }">
    <button type="button" class="phone-mini-track" aria-label="Открыть плеер" @click="open = true">
      <span class="phone-mini-art">
        <img v-if="track.cover_url" :src="track.cover_url" alt="" />
        <Icon v-else name="note" :size="19" />
      </span>
      <span class="phone-mini-copy">
        <strong class="ellipsis">{{ track.title }}</strong>
        <span class="ellipsis">{{ artists }}</span>
      </span>
    </button>
    <button class="phone-player-button" type="button" :aria-label="playLabel" @click="player.toggle()">
      <Icon :name="playIcon" :size="24" />
    </button>
    <button class="phone-player-button" type="button" aria-label="Следующий трек" :disabled="!player.hasNext" @click="player.next(false)">
      <Icon name="next" :size="22" />
    </button>
  </div>

  <q-dialog
    v-model="open"
    class="phone-player-modal"
    maximized
    transition-show="slide-up"
    transition-hide="slide-down"
    :transition-duration="reduceMotion ? 0 : 320"
    aria-label="Сейчас играет"
    @hide="resetSheet"
  >
    <div v-if="track" class="phone-player" :style="paletteStyle">
      <div class="phone-sheet" :class="{ 'is-dragging': gesture }" :style="{ '--drag-y': dragY + 'px' }">
        <div
          class="phone-grab"
          aria-hidden="true"
          @pointerdown="startDrag"
          @pointermove="moveDrag"
          @pointerup="finishDrag"
          @pointercancel="cancelDrag"
          @lostpointercapture="cancelDrag"
        ><span /></div>
        <header class="phone-player-head">
          <button class="phone-player-button" type="button" aria-label="Свернуть плеер" @click="open = false">
            <Icon name="chevronDown" :size="23" />
          </button>
          <span>Сейчас играет</span>
          <button class="phone-player-button" type="button" aria-label="Меню трека">
            <Icon name="more" :size="23" />
            <TrackMenu :track="track" />
          </button>
        </header>

        <div class="phone-media">
          <div v-show="!queueOpen" class="phone-artwork" :class="{ 'is-playing': player.isPlaying }">
            <Transition name="phone-cover">
              <img v-if="track.cover_url" :key="track.cover_url" :src="track.cover_url" alt="" decoding="async" />
              <Icon v-else key="fallback" name="note" :size="58" />
            </Transition>
            <MusicClipBackdrop
              v-if="open"
              class="phone-clip"
              :track="track"
              :active="!queueOpen && !player.loading"
              :enabled="ui.settings.musicVideoBackground"
              :alignment-allowed="!player.censorReplaced && !player.playingLocal"
              :position="player.progress"
              :playing="player.isPlaying"
              :playback-rate="player.playbackRate"
              :pending-resume="player.pendingResume"
            />
          </div>

          <section v-if="queueOpen" class="phone-queue" aria-label="Очередь">
            <div class="phone-queue-head">
              <h2>Очередь</h2>
              <QueuePlaylistButton />
            </div>
            <q-virtual-scroll :items="player.queue" :virtual-scroll-item-size="56" class="phone-queue-list">
              <template #default="{ item, index }">
                <button
                  :key="item.id + '-' + index"
                  class="phone-queue-track"
                  :class="{ current: index === player.index }"
                  :aria-current="index === player.index ? 'true' : undefined"
                  type="button"
                  @click="playFromQueue(index)"
                >
                  <span class="phone-mini-art">
                    <img v-if="item.cover_url" :src="item.cover_url" alt="" loading="lazy" />
                    <Icon v-else name="note" :size="17" />
                  </span>
                  <span class="phone-mini-copy">
                    <strong class="ellipsis">{{ item.title }}</strong>
                    <span class="ellipsis">{{ artistNames(item.artists) }}</span>
                  </span>
                  <Icon v-if="index === player.index" name="wave" :size="18" />
                </button>
              </template>
            </q-virtual-scroll>
          </section>
        </div>

        <div class="phone-player-meta">
          <div class="phone-player-title">
            <h1 class="ellipsis">{{ track.title }}</h1>
            <p class="ellipsis">{{ artists }}</p>
          </div>
          <button class="phone-player-button" type="button" :aria-pressed="liked" :aria-label="liked ? 'Убрать лайк' : 'Мне нравится'" @click="library.toggleLike(track)">
            <Icon :name="liked ? 'heartFilled' : 'heart'" :size="26" />
          </button>
        </div>

        <div class="phone-seek">
          <q-slider
            :model-value="seekPreview ?? player.progress"
            :max="Math.max(1, player.duration)"
            :step="0.1"
            :disable="!player.duration"
            aria-label="Позиция трека"
            @update:model-value="seekPreview = $event"
            @change="commitSeek"
          />
          <div>
            <span>{{ formatDuration((seekPreview ?? player.progress) * 1000) }}</span>
            <span>{{ formatDuration(player.duration * 1000) }}</span>
          </div>
        </div>

        <div class="phone-transport" aria-label="Управление воспроизведением">
          <button class="phone-player-button" type="button" aria-label="Предыдущий трек" :disabled="!player.hasPrev && player.progress <= 3" @click="player.prev()">
            <Icon name="prev" :size="30" />
          </button>
          <button class="phone-player-button phone-play" type="button" :aria-label="playLabel" @click="player.toggle()">
            <Transition name="phone-play-icon" mode="out-in">
              <Icon :key="playIcon" :name="playIcon" :size="33" />
            </Transition>
          </button>
          <button class="phone-player-button" type="button" aria-label="Следующий трек" :disabled="!player.hasNext" @click="player.next(false)">
            <Icon name="next" :size="30" />
          </button>
        </div>

        <footer class="phone-player-tools">
          <button class="phone-player-button" type="button" aria-label="Текст песни" @click="openTrackLyrics(track)">
            <Icon name="lyrics" :size="23" />
          </button>
          <ClipBackgroundControl :track="track" :active="open && !queueOpen" :show-hint="false" />
          <button class="phone-player-button" type="button" aria-label="Очередь" :aria-pressed="queueOpen" @click="queueOpen = !queueOpen">
            <Icon name="queue" :size="23" />
          </button>
        </footer>
      </div>
    </div>
  </q-dialog>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import Icon from '@/components/Icon.vue';
import TrackMenu from '@/components/TrackMenu.vue';
import QueuePlaylistButton from '@/components/QueuePlaylistButton.vue';
import ClipBackgroundControl from '@/components/clips/ClipBackgroundControl.vue';
import MusicClipBackdrop from '@/components/clips/MusicClipBackdrop.vue';
import { openTrackLyrics } from '@/lib/dialogs';
import { artistNames, formatDuration } from '@/lib/format';
import { useCoverPalette } from '@/composables/useCoverPalette';
import { useLibraryStore } from '@/stores/library';
import { usePlayerStore } from '@/stores/player/index';
import { useUiStore } from '@/stores/ui';

const player = usePlayerStore();
const library = useLibraryStore();
const ui = useUiStore();
const track = computed(() => player.current);
const { style: paletteStyle } = useCoverPalette(() => track.value?.cover_url);
const artists = computed(() => track.value ? artistNames(track.value.artists) : '');
const liked = computed(() => Boolean(track.value && library.liked(track.value.id)));
const played = computed(() => player.duration ? Math.max(0, Math.min(1, player.progress / player.duration)) : 0);
const playIcon = computed(() => player.isPlaying ? 'pause' : 'play');
const playLabel = computed(() => player.isPlaying ? 'Пауза' : 'Воспроизвести');
const reduceMotion = computed(() => !ui.settings.animations || matchMedia('(prefers-reduced-motion: reduce)').matches);
const open = ref(false);
const queueOpen = ref(false);
const seekPreview = ref<number | null>(null);
const dragY = ref(0);
const gesture = ref<{ pointerId: number; y: number; start: number } | null>(null);

onMounted(() => player.bind());

watch(track, (value, previous) => {
  if (!value) open.value = false;
  if (value?.id !== previous?.id) seekPreview.value = null;
});

function commitSeek(value: number | null) {
  seekPreview.value = null;
  if (value !== null) player.seek(value);
}

function playFromQueue(index: number) {
  player.index = index;
  void player.loadCurrent();
}

function startDrag(event: PointerEvent) {
  if (!event.isPrimary || event.button !== 0) return;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  gesture.value = { pointerId: event.pointerId, y: event.clientY, start: performance.now() };
}

function moveDrag(event: PointerEvent) {
  if (gesture.value?.pointerId !== event.pointerId) return;
  dragY.value = Math.min(240, Math.max(0, event.clientY - gesture.value.y) * .78);
}

function finishDrag(event: PointerEvent) {
  const start = gesture.value;
  if (!start || start.pointerId !== event.pointerId) return;
  const distance = event.clientY - start.y;
  if (distance > 85 || (distance > 32 && distance / Math.max(1, performance.now() - start.start) > .5)) {
    gesture.value = null;
    open.value = false;
  } else cancelDrag(event);
}

function cancelDrag(event: PointerEvent) {
  if (gesture.value?.pointerId !== event.pointerId) return;
  gesture.value = null;
  dragY.value = 0;
}

function resetSheet() {
  gesture.value = null;
  dragY.value = 0;
  queueOpen.value = false;
  seekPreview.value = null;
}
</script>
