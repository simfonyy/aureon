<template>
  <div ref="host" class="lyrics-fx-overlay" aria-hidden="true" />
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { FxFrame } from '@/lib/lyricsFx/rendererTypes';
import type { LyricsEffects } from '@/lib/lyricsFx/renderer';

const props = defineProps<{
  nowMs: number;
  frames: FxFrame[];
  enabled: boolean;
  trackKey: string;
}>();
const emit = defineEmits<{ supported: [value: boolean] }>();
const host = ref<HTMLElement | null>(null);
let renderer: LyricsEffects | null = null;
let initialization: Promise<void> | null = null;
let disposed = false;
let drawing = false;
let failed = false;
let observedParent: HTMLElement | null = null;
let resizeObserver: ResizeObserver | null = null;

function clear() {
  if (drawing) renderer?.clear();
  drawing = false;
}

function render() {
  if (disposed || !props.enabled || document.hidden || !props.frames.length) {
    clear();
    return;
  }
  if (!renderer) {
    void initialize();
    return;
  }
  renderer.render(props.nowMs, props.frames);
  drawing = renderer.supported;
}

async function initialize() {
  if (initialization || disposed || failed || !host.value || !props.enabled || !props.frames.length) return initialization;
  const element = host.value;
  initialization = (async () => {
    let created: LyricsEffects | null = null;
    try {
      const { LyricsEffects } = await import('@/lib/lyricsFx/renderer');
      // The tab can close or effects can be disabled while the lazy chunk loads.
      if (disposed || host.value !== element || !props.enabled) return;
      created = await LyricsEffects.create(element);
      if (disposed || host.value !== element || !props.enabled) {
        created.destroy();
        return;
      }
      if (!created.supported) {
        failed = true;
        created.destroy();
        emit('supported', false);
        return;
      }
      renderer = created;
      emit('supported', true);
      render();
    } catch {
      created?.destroy();
      failed = true;
      // The DOM continues to render lyrics when import, initialization or WebGL fails.
      if (!disposed) emit('supported', false);
    } finally {
      initialization = null;
    }
  })();
  return initialization;
}

watch(() => [props.nowMs, props.frames, props.enabled] as const, render, { flush: 'post' });
watch(() => props.trackKey, () => {
  renderer?.reset();
  drawing = false;
}, { flush: 'sync' });

function visibilityChanged() {
  if (document.hidden) clear(); else render();
}

onMounted(() => {
  resizeObserver = new ResizeObserver(render);
  if (host.value) {
    resizeObserver.observe(host.value);
    observedParent = host.value.parentElement;
    // Native scroll events do not bubble. Capture catches Quasar's scroll container.
    observedParent?.addEventListener('scroll', render, true);
  }
  document.addEventListener('visibilitychange', visibilityChanged);
  void document.fonts.ready.then(() => { if (!disposed) render(); });
  render();
});

onBeforeUnmount(() => {
  disposed = true;
  resizeObserver?.disconnect();
  observedParent?.removeEventListener('scroll', render, true);
  document.removeEventListener('visibilitychange', visibilityChanged);
  renderer?.destroy();
  renderer = null;
  drawing = false;
});

defineExpose({ render, clear });
</script>

<style>
.lyrics-fx-overlay {
  position: absolute;
  inset: 0;
  z-index: 2;
  overflow: hidden;
  pointer-events: none;
  mask-image: linear-gradient(transparent, #000 12%, #000 84%, transparent);
}
.lyrics-fx-overlay canvas {
  display: block;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.lyrics-wrap .lyric-word.fx-rendered {
  color: transparent !important;
  background: none !important;
  text-shadow: none !important;
}
</style>
