<template>
  <div v-show="!side"><slot /></div>
  <div v-if="side" class="mini-screen-dock" :class="{ right: side === 'right' }"
    @pointermove="showControls" @pointerleave="scheduleCollapse" @focusin="showControls" @focusout="scheduleCollapse">
    <button class="dock-cover" type="button" :aria-label="player.isPlaying ? 'Пауза' : 'Воспроизвести'"
      @click="coverClick" @pointerdown="beginDrag" @pointermove="dragCover" @pointerup="dragStart = null"
      @pointercancel="dragStart = null" @wheel.prevent="volume">
      <img v-if="player.current?.cover_url" :src="player.current.cover_url" alt="" />
      <Icon v-else name="note" :size="22" />
      <span class="dock-progress" :style="{ width: played + '%' }" />
    </button>
    <div v-if="expanded" class="dock-controls" @mousedown="startWindowDrag">
      <span><strong>{{ player.current?.title || 'Aureon' }}</strong><small>{{ artistNames(player.current?.artists || []) }}</small></span>
      <button type="button" aria-label="Предыдущий трек" @click="player.prev()"><Icon name="prev" :size="16" /></button>
      <button type="button" :aria-label="player.isPlaying ? 'Пауза' : 'Воспроизвести'" @click="player.toggle()"><Icon :name="player.isPlaying ? 'pause' : 'play'" :size="17" /></button>
      <button type="button" aria-label="Следующий трек" @click="player.next(false)"><Icon name="next" :size="16" /></button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { api } from '@/api/client';
import Icon from '@/components/Icon.vue';
import { artistNames } from '@/lib/format';
import { startWindowDrag } from '@/lib/window';
import { usePlayerStore } from '@/stores/player/index';
import { useUiStore } from '@/stores/ui';

const player = usePlayerStore(), ui = useUiStore();
const side = ref<'left' | 'right' | null>(null), expanded = ref(false);
const played = computed(() => player.duration > 0 ? Math.min(100, 100 * player.progress / player.duration) : 0);
let dragStart: { x: number; y: number } | null = null;
let suppressClick = false, disposed = false, wanted = false;
let movedTimer: number, leaveTimer: number;
let detach: (() => void) | undefined;
let pending = Promise.resolve();

function update() {
  pending = pending.then(async () => {
    if (disposed) return;
    const expand = wanted;
    const edge = await api.dockMiniPlayer(expand, Boolean(side.value), ui.settings.miniWidth, ui.settings.miniHeight);
    if (disposed) return;
    side.value = edge;
    expanded.value = Boolean(edge && expand);
    if (!edge) wanted = false;
  }).catch(() => {});
}

function showControls() {
  window.clearTimeout(leaveTimer);
  if (!wanted && !dragStart) { wanted = true; update(); }
}

function scheduleCollapse() {
  window.clearTimeout(leaveTimer);
  leaveTimer = window.setTimeout(() => {
    if (document.querySelector('.mini-screen-dock:hover, .mini-screen-dock :focus-visible')) return;
    wanted = false;
    update();
  }, 220);
}

function beginDrag(event: PointerEvent) {
  if (event.button !== 0) return;
  dragStart = { x: event.screenX, y: event.screenY };
  suppressClick = false;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
}

function dragCover(event: PointerEvent) {
  if (!dragStart || Math.hypot(event.screenX - dragStart.x, event.screenY - dragStart.y) < 5) return;
  dragStart = null;
  suppressClick = true;
  void getCurrentWindow().startDragging().catch(() => {});
}

function coverClick() {
  if (!suppressClick) void player.toggle();
  suppressClick = false;
}

function volume(event: WheelEvent) {
  const change = event.deltaMode === 0 ? event.deltaY / 2000 : Math.sign(event.deltaY) * .05;
  if (change) player.setVolume(Math.max(0, Math.min(1, (player.muted ? 0 : player.volume) - change)));
}

onMounted(async () => {
  try {
    const stop = await getCurrentWindow().onMoved(() => {
      window.clearTimeout(movedTimer);
      movedTimer = window.setTimeout(update, 180);
    });
    if (disposed) stop();
    else detach = stop;
  } catch {}
});
onBeforeUnmount(() => {
  disposed = true;
  detach?.();
  window.clearTimeout(movedTimer);
  window.clearTimeout(leaveTimer);
});
</script>
<style scoped>
.mini-screen-dock { position: fixed; inset: 0; display: flex; align-items: stretch; background: var(--surface); color: var(--fg); }
.mini-screen-dock.right { flex-direction: row-reverse; }
.dock-cover { position: relative; overflow: hidden; display: grid; flex: 0 0 60px; place-items: center; background: var(--surface-2); }
.mini-screen-dock button { border: 0; padding: 0; color: inherit; cursor: pointer; }
.dock-cover img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.dock-progress { position: absolute; bottom: 0; left: 0; height: 3px; background: var(--accent); }
.dock-controls { display: flex; align-items: center; flex: 1; min-width: 0; padding: 0 8px; gap: 3px; animation: dock-reveal .18s ease-out; }
.dock-controls span { flex: 1; min-width: 0; }
.dock-controls strong, .dock-controls small { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dock-controls small { color: var(--fg-dim); }
.dock-controls button { width: 28px; height: 32px; border-radius: 7px; background: transparent; }
.dock-controls button:hover { background: var(--hover); }
@keyframes dock-reveal { from { opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .dock-controls { animation: none; } }
html.no-motion .dock-controls { animation: none; }
</style>
