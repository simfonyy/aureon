<template>
  <aside class="lyrics-queue" aria-label="Очередь воспроизведения">
    <header><h2>Очередь</h2><span>{{ player.queue.length }}</span><button type="button" class="icon-btn round" aria-label="Скрыть очередь" @click="emit('close')"><Icon name="close" :size="16" /></button></header>
    <q-scroll-area class="lyrics-queue-scroll">
      <div v-for="item in visibleQueue" :key="`${item.index}-${item.track.id}`" class="lyrics-queue-row" :class="{ current: item.index === player.index }">
        <button type="button" class="lyrics-queue-select" :aria-label="`Включить ${item.track.title}`" :aria-current="item.index === player.index ? 'true' : undefined" @click="play(item.index)">
          <span class="lyrics-queue-number">{{ item.index + 1 }}</span>
          <img v-if="item.track.cover_url" :src="item.track.cover_url" alt="" loading="lazy" />
          <span v-else class="lyrics-queue-placeholder"><Icon name="note" :size="20" /></span>
          <span class="lyrics-queue-meta"><b>{{ item.track.title }}</b><small>{{ artistNames(item.track.artists) }}</small></span>
          <span class="lyrics-queue-time">{{ formatDuration(item.track.duration_ms) }}</span>
        </button>
        <span v-if="item.index === player.index" class="lyrics-queue-meter" :class="{ playing: player.isPlaying }" aria-hidden="true"><i /><i /><i /><i /></span>
        <button v-else type="button" class="icon-btn round" :aria-label="`Меню трека ${item.track.title}`"><Icon name="more" :size="17" /><TrackMenu :track="item.track" /></button>
      </div>
      <p v-if="!visibleQueue.length" class="lyrics-queue-empty">Очередь пуста</p>
    </q-scroll-area>
  </aside>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import Icon from '@/components/Icon.vue';
import TrackMenu from '@/components/TrackMenu.vue';
import { artistNames, formatDuration } from '@/lib/format';
import { usePlayerStore } from '@/stores/player/index';
const emit = defineEmits<{ close: [] }>();
const player = usePlayerStore();
const visibleQueue = computed(() => {
  const start = Math.max(0, player.index - 3);
  return player.queue.slice(start, start + 80).map((track, offset) => ({ track, index: start + offset }));
});
function play(index: number) {
  if (index === player.index) { void player.toggle(); return; }
  player.index = index;
  void player.loadCurrent();
}
</script>
