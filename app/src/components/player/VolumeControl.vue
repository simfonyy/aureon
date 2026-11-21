<template>
  <div class="player-volume-control" :class="{ vertical: orientation === 'vertical' }" data-no-drag @wheel.prevent.stop="onWheel">
    <button
      class="player-volume-mute"
      type="button"
      :aria-label="muted ? 'Включить звук' : 'Выключить звук'"
      :aria-pressed="muted"
      :title="muted ? 'Включить звук' : 'Выключить звук'"
      @click.stop="toggleMute"
    >
      <Icon :name="muted ? 'volumeOff' : 'volume'" :size="16" />
    </button>
    <input
      v-if="showSlider"
      class="player-volume-range"
      type="range"
      min="0"
      max="100"
      :value="percent"
      :style="{ '--volume-fill': `${percent}%` }"
      :title="`Громкость ${percent}%`"
      aria-label="Громкость"
      :aria-orientation="orientation"
      :aria-valuetext="`${percent}%`"
      @input="setVolume(Number(($event.target as HTMLInputElement).value) / 100)"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue';
import Icon from '@/components/Icon.vue';
import { usePlayerStore } from '@/stores/player/index';

withDefaults(defineProps<{
  showSlider?: boolean;
  orientation?: 'horizontal' | 'vertical';
}>(), { showSlider: true, orientation: 'horizontal' });

const player = usePlayerStore();
const muted = computed(() => player.muted || player.volume <= .001);
const percent = computed(() => muted.value ? 0 : Math.round(player.volume * 100));
let lastAudible = .35;

watch(() => player.volume, value => {
  if (value > .001) lastAudible = value;
}, { immediate: true, flush: 'sync' });

function setVolume(value: number) {
  player.setVolume(Math.max(0, Math.min(1, value)));
}

function toggleMute() {
  if (player.volume <= .001) setVolume(lastAudible);
  else player.toggleMute();
}

function onWheel(event: WheelEvent) {
  const delta = event.deltaMode === 0 ? event.deltaY / 2000 : Math.sign(event.deltaY) * .05;
  if (delta) setVolume(percent.value / 100 - delta);
}
</script>

<style scoped>
.player-volume-control {
  --volume-direction: to right;
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 5px;
  color: var(--volume-color, var(--fg));
}

.player-volume-control.vertical {
  --volume-direction: to top;
  flex-direction: column-reverse;
  gap: 0;
}

.player-volume-mute {
  display: grid;
  flex: none;
  width: 26px;
  height: 26px;
  padding: 0;
  place-items: center;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.player-volume-mute:hover { background: color-mix(in srgb, currentColor 12%, transparent); }

.player-volume-range {
  appearance: none;
  inline-size: var(--volume-width, 64px);
  block-size: 24px;
  margin: 0;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.vertical .player-volume-range {
  writing-mode: vertical-lr;
  direction: rtl;
}

.player-volume-range::-webkit-slider-runnable-track {
  block-size: 4px;
  border-radius: 99px;
  background: linear-gradient(var(--volume-direction), var(--volume-accent, currentColor) var(--volume-fill), color-mix(in srgb, currentColor 28%, transparent) var(--volume-fill));
}

.player-volume-range::-webkit-slider-thumb {
  appearance: none;
  width: 9px;
  height: 9px;
  margin-block-start: -2.5px;
  border-radius: 50%;
  background: var(--volume-accent, currentColor);
}

.player-volume-range::-moz-range-track {
  block-size: 4px;
  border-radius: 99px;
  background: linear-gradient(var(--volume-direction), var(--volume-accent, currentColor) var(--volume-fill), color-mix(in srgb, currentColor 28%, transparent) var(--volume-fill));
}

.player-volume-range::-moz-range-thumb {
  width: 9px;
  height: 9px;
  border: 0;
  border-radius: 50%;
  background: var(--volume-accent, currentColor);
}

.player-volume-control :focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
</style>
