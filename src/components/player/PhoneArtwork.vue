<template>
  <div ref="art" class="phone-artwork" :class="{ 'is-playing': player.isPlaying, 'is-expanded': expanded }"
    @touchstart.passive="startSwipe" @touchend.passive="finishSwipe" @touchcancel="swipe = null"
    @keydown.esc="handleEscape">
    <Transition name="phone-cover">
      <img v-if="track.cover_url" :key="track.cover_url" :src="track.cover_url" alt="" decoding="async" />
      <Icon v-else key="fallback" name="note" :size="58" />
    </Transition>
    <MusicClipBackdrop v-if="active" class="phone-clip" :track="track" :active="!player.loading"
      :enabled="enabled" :alignment-allowed="!player.censorReplaced && !player.playingLocal"
      :position="player.progress" :playing="player.isPlaying" :playback-rate="player.playbackRate"
      :pending-resume="player.pendingResume" @ready="ready = $event" @loading="loading = $event" @error="failed" />
    <button v-if="ready" ref="surface" class="phone-clip-surface" type="button"
      :aria-label="expanded ? 'Управление клипом' : 'Развернуть клип'" @click="surfaceTap">
      <span v-if="!expanded" class="phone-clip-expand"><Icon name="expand" :size="18" /></span>
    </button>
    <button v-if="available && !expanded" class="phone-clip-switch" type="button"
      :aria-label="enabled ? 'Вернуть обложку' : 'Включить клип'" :aria-pressed="enabled" @click="toggleClip">
      <q-spinner v-if="loading" size="17px" /><Icon v-else name="musicVideo" :size="18" />
    </button>
    <div v-if="expanded && controls" class="phone-clip-controls">
      <button class="phone-player-button" type="button" aria-label="Свернуть клип" @click="collapse">
        <Icon name="chevronDown" :size="24" />
      </button>
      <button class="phone-player-button" type="button" :aria-label="player.isPlaying ? 'Пауза' : 'Воспроизвести'" @click="player.toggle()">
        <Icon :name="player.isPlaying ? 'pause' : 'play'" :size="26" />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { Notify } from 'quasar';
import type { Track } from '@/api/types';
import Icon from '@/components/Icon.vue';
import MusicClipBackdrop from '@/components/clips/MusicClipBackdrop.vue';
import { hasMusicClips, musicTrackId } from '@/lib/musicClips';
import { useMusicClipsStore } from '@/stores/musicClips';
import { usePlayerStore } from '@/stores/player/index';
import { useUiStore } from '@/stores/ui';

const props = defineProps<{ track: Track; active: boolean }>();
const expanded = defineModel<boolean>('expanded', { required: true });
const player = usePlayerStore();
const ui = useUiStore();
const clips = useMusicClipsStore();
const art = ref<HTMLElement>();
const surface = ref<HTMLButtonElement>();
const ready = ref(false);
const loading = ref(false);
const enabled = ref(ui.settings.musicVideoBackground);
const controls = ref(false);
let swipe: Touch | null = null;
let motion: Animation | undefined;
const trackId = computed(() => musicTrackId(props.track.id));
const available = computed(() => hasMusicClips(props.track) || Boolean(trackId.value && clips.knownClipIds[trackId.value]?.length));

watch(() => [props.track.id, props.active] as const, () => {
  motion?.cancel();
  expanded.value = false;
  ready.value = false;
  controls.value = false;
  enabled.value = ui.settings.musicVideoBackground;
  if (props.active && !hasMusicClips(props.track)) void clips.lookup(props.track);
}, { immediate: true });

function toggleClip() {
  enabled.value = !enabled.value;
  ui.set('musicVideoBackground', enabled.value);
}

function handleEscape(event: KeyboardEvent) {
  if (!expanded.value) return;
  event.stopPropagation();
  event.preventDefault();
  void collapse();
}

watch(ready, value => {
  if (!value && expanded.value) {
    motion?.cancel();
    expanded.value = false;
  }
});

function animateFrame(collapsing: boolean) {
  const node = art.value;
  const frame = node?.parentElement?.getBoundingClientRect();
  if (!node || !frame || !ui.settings.animations || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const bounds = node.getBoundingClientRect();
  const side = Math.min(frame.width, frame.height, 410) * (player.isPlaying ? 1 : .94);
  const x = frame.left - bounds.left + (frame.width - side) / 2;
  const y = frame.top - bounds.top + (frame.height - side) / 2;
  const square = `inset(${y}px ${bounds.width - x - side}px ${bounds.height - y - side}px ${x}px round 16px)`;
  return node.animate([{ clipPath: square }, { clipPath: 'inset(0px round 0px)' }], {
    duration: 260,
    easing: 'cubic-bezier(.22,.7,.22,1)',
    direction: collapsing ? 'reverse' : 'normal',
    fill: 'both',
  });
}

async function surfaceTap() {
  if (expanded.value) {
    controls.value = !controls.value;
    return;
  }
  controls.value = false;
  expanded.value = true;
  await nextTick();
  if (expanded.value) motion = animateFrame(false);
  surface.value?.focus({ preventScroll: true });
}

async function collapse() {
  if (!expanded.value) return;
  motion?.cancel();
  const exit = animateFrame(true);
  motion = exit;
  if (exit) {
    try { await exit.finished; } catch { return; }
  }
  expanded.value = false;
  controls.value = false;
  exit?.cancel();
  await nextTick();
  surface.value?.focus({ preventScroll: true });
}

function startSwipe(event: TouchEvent) {
  swipe = expanded.value && event.touches.length === 1 ? event.touches[0] ?? null : null;
}

function finishSwipe(event: TouchEvent) {
  const end = event.changedTouches[0];
  if (swipe && end && end.identifier === swipe.identifier) {
    const dy = end.clientY - swipe.clientY;
    if (dy > 55 && dy > Math.abs(end.clientX - swipe.clientX)) void collapse();
  }
  swipe = null;
}

function failed(message: string) {
  motion?.cancel();
  expanded.value = false;
  enabled.value = false;
  Notify.create({ message });
}

onBeforeUnmount(() => motion?.cancel());
</script>
