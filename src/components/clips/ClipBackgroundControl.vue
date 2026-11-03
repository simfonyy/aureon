<script lang="ts">
// One hint per track in the current session, shared by the player and lyrics.
const hintedTracks = new Set<string>();
</script>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { Track } from '@/api/types';
import { hasMusicClips, musicTrackId } from '@/lib/musicClips';
import { useMusicClipsStore } from '@/stores/musicClips';
import { usePlayerStore } from '@/stores/player/index';
import { useUiStore } from '@/stores/ui';
import Icon from '@/components/Icon.vue';

const props = withDefaults(defineProps<{ track: Track; active: boolean; openPlayer?: boolean }>(), { openPlayer: false });
const clips = useMusicClipsStore(), ui = useUiStore(), player = usePlayerStore();
const hint = ref(false);
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
  if (!trackId || !hasClip || !active || enabled || hintedTracks.has(trackId)) return;
  hintedTracks.add(trackId);
  if (hintedTracks.size > 64) hintedTracks.delete(hintedTracks.values().next().value!);
  hint.value = true;
  timer = setTimeout(dismiss, 9000);
}, { immediate: true });
onBeforeUnmount(dismiss);
</script>

<template>
  <span v-if="available && active" class="clip-background-control" data-no-drag>
    <button type="button" class="clip-background-button" :class="{ on: ui.settings.musicVideoBackground }" :aria-label="label" :aria-pressed="ui.settings.musicVideoBackground" @click.stop="toggle">
      <Icon name="musicVideo" :size="18" />
      <q-tooltip v-if="!hint">{{ label }}</q-tooltip>
    </button>
    <q-menu :model-value="hint" no-parent-event no-focus no-refocus :anchor="openPlayer ? 'top right' : 'bottom right'" :self="openPlayer ? 'bottom right' : 'top right'" :offset="[0, 12]" class="clip-background-hint" :class="{ 'hint-above': openPlayer }" transition-show="fade" transition-hide="fade" @update:model-value="value => { if (!value) dismiss(); }">
      <div class="clip-hint-copy"><p role="status">Есть клип</p><button type="button" @click="enable">Показать на фоне</button></div>
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
/* QMenu renders in a portal outside this component's scoped root. */
.q-menu.clip-background-hint {
  display:grid;
  grid-template-columns:minmax(0,1fr) 20px;
  align-items:start;
  gap:12px;
  box-sizing:border-box;
  width:260px;
  max-width:calc(100vw - 32px);
  overflow:visible;
  padding:14px;
  border:1px solid var(--line);
  border-radius:10px;
  background:var(--surface);
  color:var(--fg);
  box-shadow:0 6px 20px #0002;
  backdrop-filter:none;
  font-family:inherit;
}
.q-menu.clip-background-hint::before {
  content:'';
  position:absolute;
  right:10px;
  top:-5px;
  width:8px;
  height:8px;
  background:var(--surface);
  border-left:1px solid var(--line);
  border-top:1px solid var(--line);
  transform:rotate(45deg);
  pointer-events:none;
}
.q-menu.clip-background-hint.hint-above::before { top:auto;bottom:-5px;transform:rotate(225deg); }
.q-menu.clip-background-hint .clip-hint-copy { min-width:0; }
.q-menu.clip-background-hint .clip-hint-copy p { margin:0 0 4px;font-size:13px;line-height:20px;font-weight:600; }
.q-menu.clip-background-hint .clip-hint-copy button {
  display:block;
  padding:0;
  border:0;
  background:transparent;
  color:var(--accent);
  font:inherit;
  font-size:12px;
  line-height:18px;
  text-align:left;
  cursor:pointer;
}
.q-menu.clip-background-hint .clip-hint-copy button:hover { text-decoration:underline;text-underline-offset:3px; }
.q-menu.clip-background-hint .clip-hint-close {
  display:grid;
  place-items:center;
  width:20px;
  height:20px;
  padding:0;
  border:0;
  border-radius:4px;
  background:transparent;
  color:var(--fg-dim);
  cursor:pointer;
}
.q-menu.clip-background-hint .clip-hint-close:hover { background:var(--hover);color:var(--fg); }
.q-menu.clip-background-hint button:focus-visible { outline:2px solid var(--accent);outline-offset:3px; }
</style>
