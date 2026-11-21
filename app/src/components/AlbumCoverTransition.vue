<template>
  <Teleport to="body">
    <div v-if="transfer" :key="transfer.token" ref="cover" class="album-cover-flight" :style="initialStyle" aria-hidden="true">
      <img :src="transfer.src" alt="" @error="cancelAlbumCoverTransition(transfer.token)" />
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { animate } from 'motion-v';
import { useUiStore } from '@/stores/ui';
import {
  albumCoverTransfer as transfer, cancelAlbumCoverTransition,
  guardAlbumCoverRoute, reconcileAlbumCoverScroll,
} from '@/lib/albumCoverTransition';

const route = useRoute(), ui = useUiStore();
const cover = ref<HTMLElement | null>(null);
let playback: ReturnType<typeof animate> | null = null;
let disposed = false;
const media = window.matchMedia('(prefers-reduced-motion: reduce)');
const initialStyle = computed(() => {
  const from = transfer.value?.from;
  return from ? { left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px`, borderRadius: `${from.radius}px` } : {};
});

watch(transfer, async value => {
  playback?.stop(); playback = null;
  if (!value?.to) return;
  const token = value.token;
  await nextTick();
  if (disposed || transfer.value?.token !== token || !cover.value) return;
  const from = value.from, to = value.to;
  try {
    playback = animate(cover.value, {
      x: [0, to.left - from.left], y: [0, to.top - from.top],
      width: [from.width, to.width], height: [from.height, to.height],
      borderRadius: [from.radius, to.radius],
    }, { duration: .42, ease: [.22, 1, .36, 1] });
    void playback.then(() => cancelAlbumCoverTransition(token), () => cancelAlbumCoverTransition(token));
  } catch { cancelAlbumCoverTransition(token); }
}, { flush: 'post' });

watch(() => route.path, guardAlbumCoverRoute);
watch(() => ui.settings.animations, enabled => { if (!enabled) cancelAlbumCoverTransition(); });
function changed() { cancelAlbumCoverTransition(); }
function preference() { if (media.matches) changed(); }
function visibility() { if (document.hidden) changed(); }
onMounted(() => {
  window.addEventListener('resize', changed);
  window.addEventListener('wheel', changed, { passive: true });
  document.addEventListener('visibilitychange', visibility);
  document.addEventListener('scroll', reconcileAlbumCoverScroll, true);
  media.addEventListener('change', preference);
});
onBeforeUnmount(() => {
  disposed = true; playback?.stop(); cancelAlbumCoverTransition();
  window.removeEventListener('resize', changed);
  window.removeEventListener('wheel', changed);
  document.removeEventListener('visibilitychange', visibility);
  document.removeEventListener('scroll', reconcileAlbumCoverScroll, true);
  media.removeEventListener('change', preference);
});
</script>

<style>
.album-cover-flight { position: fixed; z-index: 1900; overflow: hidden; pointer-events: none; will-change: transform, width, height; box-shadow: 0 16px 38px -18px var(--shadow-soft); }
.album-cover-flight img { display: block; width: 100%; height: 100%; object-fit: cover; }
[data-cover-flight-hidden] { visibility: hidden !important; }
</style>
