<script lang="ts">
const hintedTracks = new Set<string>();
</script>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { Track } from '@/api/types';
import { getCoverPalette } from '@/lib/coverPalette';
import { hasMusicClips, musicTrackId } from '@/lib/musicClips';
import { useMusicClipsStore } from '@/stores/musicClips';
import { usePlayerStore } from '@/stores/player/index';
import { useUiStore } from '@/stores/ui';
import Icon from '@/components/Icon.vue';

const props = withDefaults(defineProps<{ track: Track; active: boolean; openPlayer?: boolean; showHint?: boolean }>(), { openPlayer: false, showHint: true });
const clips = useMusicClipsStore(), ui = useUiStore(), player = usePlayerStore();
const hint = ref(false);
const hintAccent = ref('');
let timer: ReturnType<typeof setTimeout> | undefined;
const id = computed(() => musicTrackId(props.track.id));
const available = computed(() => hasMusicClips(props.track) || Boolean(id.value && clips.knownClipIds[id.value]?.length));
const label = computed(() => ui.settings.musicVideoBackground ? 'Выключить клип на фоне' : 'Включить клип на фоне');

function dismiss() { hint.value = false; clearTimeout(timer); }
function enable() {
  dismiss();
  ui.set('musicVideoBackground', true);
  if (props.openPlayer) player.openFullscreen();
}
function toggle() {
  if (!ui.settings.musicVideoBackground) enable();
  else { dismiss(); ui.set('musicVideoBackground', false); }
}
watch(() => [id.value, props.active] as const, () => {
  if (props.active && id.value && !hasMusicClips(props.track)) void clips.lookup(props.track);
}, { immediate: true });
watch(() => [id.value, available.value, props.active, ui.settings.musicVideoBackground] as const, ([trackId, hasClip, active, enabled]) => {
  dismiss();
  if (!props.showHint || !trackId || !hasClip || !active || enabled || hintedTracks.has(trackId)) return;
  hintedTracks.add(trackId);
  if (hintedTracks.size > 64) hintedTracks.delete(hintedTracks.values().next().value!);
  hint.value = true;
  timer = setTimeout(dismiss, 9000);
}, { immediate: true });
watch(() => [hint.value, props.track.cover_url] as const, async ([shown, url], _, onCleanup) => {
  let current = true;
  onCleanup(() => { current = false; });
  if (!shown) return;
  hintAccent.value = '';
  if (!url) return;
  const palette = await getCoverPalette(url);
  if (current && palette) hintAccent.value = palette.accent;
}, { immediate: true });
onBeforeUnmount(dismiss);
</script>

<template>
  <span v-if="available && active" class="clip-background-control" data-no-drag>
    <button type="button" class="clip-background-button" :class="{ on: ui.settings.musicVideoBackground }" :aria-label="label" :aria-pressed="ui.settings.musicVideoBackground" @click.stop="toggle">
      <Icon name="musicVideo" :size="18" />
      <q-tooltip v-if="!hint">{{ label }}</q-tooltip>
    </button>
    <q-menu
      :model-value="hint"
      no-parent-event no-focus no-refocus
      :anchor="openPlayer ? 'top left' : 'bottom right'"
      :self="openPlayer ? 'bottom left' : 'top right'"
      :offset="[0, 9]"
      class="clip-background-hint"
      :class="{ 'hint-above': openPlayer }"
      :style="hintAccent ? { '--clip-hint-accent': hintAccent } : undefined"
      transition-show="clip-hint"
      transition-hide="clip-hint"
      :transition-duration="ui.settings.animations === false ? 0 : 210"
      @update:model-value="value => { if (!value) dismiss(); }"
    >
      <div class="clip-hint-art" aria-hidden="true">
        <img v-if="track.cover_url" :src="track.cover_url" alt="" />
        <span><Icon name="musicVideo" :size="17" /></span>
      </div>
      <div class="clip-hint-copy">
        <p role="status">Есть клип</p>
        <button class="clip-hint-action" type="button" @click="enable">
          <Icon name="play" :size="13" />
          <span>Показать на фоне</span>
        </button>
      </div>
      <button type="button" class="clip-hint-close" aria-label="Закрыть подсказку о клипе" @click="dismiss"><Icon name="close" :size="14" /></button>
    </q-menu>
  </span>
</template>

<style scoped>
.clip-background-control{display:inline-flex;position:relative;flex:none}
.clip-background-button{display:grid;place-items:center;width:28px;height:28px;padding:0;border:0;border-radius:7px;background:transparent;color:var(--clip-control-fg,var(--fg-dim));cursor:pointer}
.clip-background-button:hover{background:var(--clip-control-hover-bg,var(--hover));color:var(--clip-control-hover,var(--fg))}.clip-background-button.on{color:var(--clip-control-on,var(--accent))}
.clip-background-button:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
</style>

<style>
.q-menu.clip-background-hint {
  --clip-hint-accent: var(--accent);
  --clip-hint-shift: -17px;
  display: grid;
  grid-template-columns: 50px minmax(0, 1fr) 22px;
  gap: 11px;
  width: 260px;
  max-width: calc(100vw - 32px);
  padding: 11px;
  overflow: visible;
  border: 1px solid color-mix(in srgb, var(--clip-hint-accent) 20%, var(--line));
  border-radius: 15px;
  background: color-mix(in srgb, var(--clip-hint-accent) 7%, var(--surface));
  color: var(--fg);
  box-shadow: 0 12px 32px #0005;
  transform-origin: calc(100% - 14px) top;
}

.q-menu.clip-background-hint.hint-above {
  --clip-hint-shift: 17px;
  transform-origin: 14px bottom;
}

.clip-background-hint .clip-hint-art {
  position: relative;
  display: grid;
  align-self: center;
  place-items: center;
  width: 50px;
  aspect-ratio: 1;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: color-mix(in srgb, var(--clip-hint-accent) 18%, var(--surface-2));
  color: var(--fg);
}

.clip-background-hint .clip-hint-art img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.clip-background-hint .clip-hint-art span {
  position: relative;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: #111018d9;
  color: #fff;
}

.clip-background-hint .clip-hint-copy {
  align-self: center;
  min-width: 0;
}

.clip-background-hint p {
  margin: 0 0 5px;
  font-size: 13px;
  line-height: 18px;
  font-weight: 700;
}

.clip-background-hint .clip-hint-action {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 5px 8px;
  border: 0;
  border-radius: 7px;
  background: color-mix(in srgb, var(--clip-hint-accent) 18%, var(--surface));
  color: color-mix(in srgb, var(--clip-hint-accent) 32%, var(--fg));
  font: inherit;
  font-size: 11px;
  font-weight: 650;
  line-height: 16px;
  text-align: left;
  cursor: pointer;
  transition: background 120ms ease;
}

.clip-background-hint .clip-hint-action:hover {
  background: color-mix(in srgb, var(--clip-hint-accent) 28%, var(--surface));
}

.clip-background-hint .clip-hint-close {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--fg-dim);
  cursor: pointer;
}

.clip-background-hint .clip-hint-close:hover { background: var(--hover); color: var(--fg); }
.clip-background-hint button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

.clip-background-hint.q-transition--clip-hint-enter-active {
  transition: opacity var(--q-transition-duration) ease, transform var(--q-transition-duration) cubic-bezier(.2,.75,.3,1);
}

.clip-background-hint.q-transition--clip-hint-leave-active {
  transition: opacity min(125ms, var(--q-transition-duration)) ease, transform min(125ms, var(--q-transition-duration)) ease;
}

.clip-background-hint.q-transition--clip-hint-enter-from {
  opacity: 0;
  transform: translateY(var(--clip-hint-shift)) scale(.9);
}

.clip-background-hint.q-transition--clip-hint-leave-to {
  opacity: 0;
  transform: translateY(calc(var(--clip-hint-shift) * .35)) scale(.98);
}

@media (prefers-reduced-motion: reduce) {
  .clip-background-hint.q-transition--clip-hint-enter-active,
  .clip-background-hint.q-transition--clip-hint-leave-active,
  .clip-background-hint .clip-hint-action { transition: none; }
}
</style>
