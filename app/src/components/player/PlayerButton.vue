<template>
  <button type="button" :aria-label="buttonLabel" :aria-pressed="buttonPressed" :disabled="buttonDisabled" @keydown.space.stop @keydown.enter.stop v-if="id === 'play'" class="play play-sm" @click="player.toggle()">
    <Transition name="ic-pop" mode="out-in">
      <q-spinner v-if="player.loading" key="load" size="14px" color="dark" />
      <Icon
        v-else
        :key="player.isPlaying ? 'pause' : 'play'"
        :name="player.isPlaying ? 'pause' : 'play'"
        :size="18"
      />
    </Transition>
  </button>

  <button type="button" :aria-label="buttonLabel" :aria-pressed="buttonPressed" :disabled="buttonDisabled" @keydown.space.stop @keydown.enter.stop
    v-else-if="id === 'shuffle'"
    class="icon-btn"
    :class="{ on: player.shuffle }"
    @click="player.toggleShuffle()"
  >
    <Icon name="shuffle" :size="18" />
    <q-tooltip>Перемешать</q-tooltip>
  </button>

  <button type="button" :aria-label="buttonLabel" :aria-pressed="buttonPressed" :disabled="buttonDisabled" @keydown.space.stop @keydown.enter.stop
    v-else-if="id === 'prev'"
    class="icon-btn"
    :class="{ off: !player.hasPrev }"
    @click="player.prev()"
  >
    <Icon name="prev" :size="19" />
    <q-tooltip>Предыдущий</q-tooltip>
  </button>

  <button type="button" :aria-label="buttonLabel" :aria-pressed="buttonPressed" :disabled="buttonDisabled" @keydown.space.stop @keydown.enter.stop v-else-if="id === 'next'" class="icon-btn" @click="player.next(false)">
    <Icon name="next" :size="19" />
    <q-tooltip>Следующий</q-tooltip>
  </button>

  <button type="button" :aria-label="buttonLabel" :aria-pressed="buttonPressed" :disabled="buttonDisabled" @keydown.space.stop @keydown.enter.stop
    v-else-if="id === 'repeat'"
    class="icon-btn"
    :class="{ on: player.repeat !== 'off' }"
    @click="player.cycleRepeat()"
  >
    <Icon :name="player.repeat === 'one' ? 'repeatOne' : 'repeat'" :size="18" />
    <q-tooltip>{{ repeatLabel }}</q-tooltip>
  </button>

  <button type="button" :aria-label="buttonLabel" :aria-pressed="buttonPressed" :disabled="buttonDisabled" @keydown.space.stop @keydown.enter.stop
    v-else-if="id === 'like'"
    class="icon-btn"
    :class="{ on: isLiked, off: !player.current }"
    @click="player.current && player.like()"
  >
    <Icon :name="isLiked ? 'heartFilled' : 'heart'" :size="18" />
    <q-tooltip>
      {{ isLiked ? "Убрать из «Мне нравится»" : "Нравится" }}
    </q-tooltip>
  </button>

  <button type="button" :aria-label="buttonLabel" :aria-pressed="buttonPressed" :disabled="buttonDisabled" @keydown.space.stop @keydown.enter.stop
    v-else-if="id === 'dislike'"
    class="icon-btn"
    :class="{ off: !player.current }"
    @click="player.current && player.dislike()"
  >
    <Icon name="heartOff" :size="18" />
    <q-tooltip>Не нравится</q-tooltip>
  </button>

  <button type="button" :aria-label="buttonLabel" :aria-pressed="buttonPressed" :disabled="buttonDisabled" @keydown.space.stop @keydown.enter.stop
    v-else-if="id === 'lyrics'"
    class="icon-btn"
    :class="{ on: player.showLyrics, off: !player.current }"
    @click="player.current && player.toggleLyrics()"
  >
    <Icon name="lyrics" :size="18" />
    <q-tooltip>Текст песни</q-tooltip>
  </button>

  <button type="button" :aria-label="buttonLabel" :aria-pressed="buttonPressed" :disabled="buttonDisabled" @keydown.space.stop @keydown.enter.stop
    v-else-if="id === 'queue'"
    class="icon-btn"
    :class="{ on: panels.queueOpen }"
    @click="panels.toggleQueue()"
  >
    <Icon name="queue" :size="18" />
    <q-tooltip>Очередь треков</q-tooltip>
  </button>

  <button type="button" :aria-label="buttonLabel" :aria-pressed="buttonPressed" :disabled="buttonDisabled" @keydown.space.stop @keydown.enter.stop v-else-if="id === 'mini'" class="icon-btn" @click="panels.enterMini()">
    <Icon name="mini" :size="18" />
    <q-tooltip>Мини-плеер поверх окон</q-tooltip>
  </button>

  <button type="button" :aria-label="buttonLabel" :aria-pressed="buttonPressed" :disabled="buttonDisabled" @keydown.space.stop @keydown.enter.stop
    v-else-if="id === 'sleep'"
    class="icon-btn"
    :class="{ on: sleep.active }"
  >
    <Icon name="clock" :size="18" />
    <q-tooltip>Таймер сна: {{ sleep.label }}</q-tooltip>
    <q-menu class="panel menu" anchor="top middle" self="bottom middle">
      <div class="menu-body" style="min-width: 178px">
        <div class="sleep-head">Таймер сна</div>
        <div
          v-for="m in sleepPresets"
          :key="m"
          class="opt"
          v-close-popup
          @click="sleep.start(m)"
        >
          <span>Через {{ m }} мин</span>
        </div>
        <div class="opt" v-close-popup @click="sleep.startUntilTrackEnd()">
          <span>До конца трека</span>
        </div>
        <div
          v-if="sleep.active"
          class="opt danger"
          v-close-popup
          @click="sleep.cancel()"
        >
          <span>Выключить ({{ sleep.label }})</span>
        </div>
      </div>
    </q-menu>
  </button>

  <button type="button" :aria-label="buttonLabel" :aria-pressed="buttonPressed" :disabled="buttonDisabled" @keydown.space.stop @keydown.enter.stop
    v-else-if="id === 'speed'"
    class="icon-btn"
    :class="{ on: player.playbackRate !== 1 }"
  >
    <Icon name="speed" :size="18" />
    <q-tooltip>Скорость</q-tooltip>
    <q-menu class="panel menu" anchor="top middle" self="bottom middle">
      <div class="menu-body" style="min-width: 132px">
        <div
          v-for="r in rates"
          :key="r"
          class="opt"
          :class="{ on: player.playbackRate === r }"
          v-close-popup
          @click="player.setPlaybackRate(r)"
        >
          <span>{{ r }}x</span>
          <Icon v-if="player.playbackRate === r" name="check" :size="15" />
        </div>
      </div>
    </q-menu>
  </button>

  <button type="button" :aria-label="buttonLabel" :aria-pressed="buttonPressed" :disabled="buttonDisabled" @keydown.space.stop @keydown.enter.stop v-else-if="id === 'quality'" class="icon-btn">
    <Icon name="quality" :size="18" />
    <q-tooltip>{{ player.qualityLabel || "Качество" }}</q-tooltip>
    <q-menu class="panel menu" anchor="top middle" self="bottom middle">
      <div class="menu-body" style="min-width: 172px">
        <div
          v-for="q in qualities"
          :key="q.value"
          class="opt"
          :class="{ on: player.quality === q.value }"
          v-close-popup
          @click="player.setQuality(q.value)"
        >
          <span>{{ q.label }}</span>
          <Icon v-if="player.quality === q.value" name="check" :size="15" />
        </div>
      </div>
    </q-menu>
  </button>

  <div v-else-if="id === 'volume'" ref="volumeArea" class="player-volume" @pointerenter="openVolume" @pointerleave="scheduleVolumeClose" @focusin="openVolume" @focusout="scheduleVolumeClose" @wheel.prevent.stop="onVolumeWheel">
    <button type="button" class="icon-btn" aria-label="Громкость" :aria-expanded="volumeOpen" aria-haspopup="dialog" @click="player.toggleMute()" @keydown.space.stop @keydown.enter.stop @keydown.tab.exact.prevent="focusVolumeSlider">
      <Icon :name="player.muted ? 'volumeOff' : 'volume'" :size="18" />
      <q-menu v-model="volumeOpen" class="player-volume-menu" anchor="top middle" self="bottom middle" :offset="[0, 8]" no-parent-event no-focus no-refocus transition-show="player-volume" transition-hide="player-volume" :transition-duration="180" @pointerenter="openVolume" @pointerleave="scheduleVolumeClose" @show="focusPendingVolumeSlider" @hide="onVolumeHide">
        <div ref="volumePanel" class="player-volume-panel" role="dialog" aria-label="Настройка громкости" @focusin="openVolume" @focusout="scheduleVolumeClose" @wheel.prevent.stop="onVolumeWheel" @keydown.space.stop>
          <q-slider class="player-volume-slider" aria-label="Уровень громкости" :aria-valuetext="`${Math.round((player.muted ? 0 : player.volume) * 100)}%`" :model-value="player.muted ? 0 : player.volume" :min="0" :max="1" :step="0.01" vertical reverse dense thumb-size="12px" track-size="3px" color="primary" @update:model-value="(v) => applyVolume(Number(v ?? 0))" @pan="onVolumePan" />
        </div>
      </q-menu>
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from "vue";
import Icon from "@/components/Icon.vue";
import type { Quality } from "@/api/types";
import { useLibraryStore } from "@/stores/library";
import { usePanelsStore } from "@/stores/panels";
import { usePlayerStore } from "@/stores/player/index";
import { useSleepStore } from "@/stores/sleep";
import type { PlayerButtonId } from "@/stores/ui/index";

const props = defineProps<{ id: PlayerButtonId }>();
const volumeOpen = ref(false);
const volumeArea = ref<HTMLElement | null>(null);
const volumePanel = ref<HTMLElement | null>(null);
let volumeCloseTimer: ReturnType<typeof setTimeout> | undefined;
let volumeDragging = false;
let volumeFocusPending = false;

function clearVolumeClose() {
  if (volumeCloseTimer !== undefined) clearTimeout(volumeCloseTimer);
  volumeCloseTimer = undefined;
}
function openVolume() {
  clearVolumeClose();
  volumeOpen.value = true;
}
function volumeHasFocus() {
  const focused = document.activeElement;
  return focused !== null && focused.matches(':focus-visible') && (volumeArea.value?.contains(focused) || volumePanel.value?.contains(focused));
}
function scheduleVolumeClose() {
  clearVolumeClose();
  volumeCloseTimer = setTimeout(() => {
    volumeCloseTimer = undefined;
    if (!volumeDragging && !volumeHasFocus() && !volumeArea.value?.matches(':hover') && !volumePanel.value?.closest('.player-volume-menu')?.matches(':hover')) volumeOpen.value = false;
  }, 180);
}
async function focusVolumeSlider() {
  volumeFocusPending = true;
  openVolume();
  await nextTick();
  focusPendingVolumeSlider();
}
function focusPendingVolumeSlider() {
  if (!volumeFocusPending) return;
  const slider = volumePanel.value?.querySelector<HTMLElement>('[role="slider"]');
  if (slider) { volumeFocusPending = false; slider.focus(); }
}
function onVolumeHide() {
  volumeFocusPending = false;
  clearVolumeClose();
}
function applyVolume(value: number) {
  if (Number.isFinite(value)) player.setVolume(Math.max(0, Math.min(1, value)));
}
function onVolumeWheel(event: WheelEvent) {
  if (!Number.isFinite(event.deltaY) || event.deltaY === 0) return;
  openVolume();
  const units = event.deltaMode === 1 ? 3 : event.deltaMode === 2 ? Math.abs(event.deltaY) : 100;
  const notches = Math.max(1, Math.round(Math.abs(event.deltaY) / units));
  const nextPercent = Math.round(player.volume * 100) - Math.sign(event.deltaY) * notches * 5;
  applyVolume(nextPercent / 100);
}
function onVolumePan(phase: string) {
  volumeDragging = phase === 'start';
  if (volumeDragging) clearVolumeClose(); else scheduleVolumeClose();
}
onBeforeUnmount(clearVolumeClose);

const player = usePlayerStore();
const library = useLibraryStore();
const panels = usePanelsStore();
const sleep = useSleepStore();
const buttonLabel = computed(() => ({
  play: player.isPlaying ? 'Пауза' : 'Воспроизвести', shuffle: 'Перемешать',
  prev: 'Предыдущий трек', next: 'Следующий трек', repeat: repeatLabel.value,
  like: isLiked.value ? 'Убрать из «Мне нравится»' : 'Нравится', dislike: 'Не нравится',
  lyrics: 'Текст песни', queue: 'Очередь треков', mini: 'Мини-плеер',
  sleep: 'Таймер сна', speed: 'Скорость воспроизведения', quality: 'Качество звука', volume: 'Громкость',
}[props.id]));
const buttonPressed = computed(() => {
  if (props.id === 'shuffle') return player.shuffle;
  if (props.id === 'repeat') return player.repeat !== 'off';
  if (props.id === 'like') return isLiked.value;
  if (props.id === 'lyrics') return player.showLyrics;
  if (props.id === 'queue') return panels.queueOpen;
  return undefined;
});
const buttonDisabled = computed(() => props.id === 'prev' ? !player.hasPrev : ['play', 'like', 'dislike', 'lyrics'].includes(props.id) && !player.current);

const sleepPresets = [15, 30, 45, 60];
const rates = [0.75, 1, 1.25, 1.5, 1.75, 2];

const qualities: Array<{ value: Quality; label: string }> = [
  { value: "low", label: "Экономное" },
  { value: "normal", label: "Стандартное" },
  { value: "high", label: "Высокое" },
  { value: "lossless", label: "Максимальное" },
];

const isLiked = computed(() =>
  player.current ? library.liked(player.current.id) : false,
);

const repeatLabel = computed(() => {
  if (player.repeat === "one") return "Повтор трека";
  if (player.repeat === "all") return "Повтор плейлиста";
  return "Повтор выключен";
});
</script>
