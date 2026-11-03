<template>
  <aside class="lyrics-queue" aria-label="Очередь воспроизведения">
    <header><h2>Очередь</h2><span>{{ player.queue.length }}</span><button type="button" class="icon-btn round" aria-label="Скрыть очередь" @click="emit('close')"><Icon name="close" :size="16" /></button></header>
    <q-scroll-area class="lyrics-queue-scroll">
      <CreativeTrackList :tracks="queueTracks" v-slot="{track,index}">
      <div class="lyrics-queue-row" :class="{ current: queueIndex(track,index) === player.index }">
        <button type="button" class="lyrics-queue-select" :aria-label="`Включить ${track.title}`" :aria-current="queueIndex(track,index) === player.index ? 'true' : undefined" @click="play(queueIndex(track,index))">
          <span class="lyrics-queue-number">{{ queueIndex(track,index) + 1 }}</span>
          <img v-if="track.cover_url" :src="track.cover_url" alt="" loading="lazy" />
          <span v-else class="lyrics-queue-placeholder"><Icon name="note" :size="20" /></span>
          <span class="lyrics-queue-meta"><b>{{ track.title }}</b><small>{{ artistNames(track.artists) }}</small></span>
          <span class="lyrics-queue-time">{{ formatDuration(track.duration_ms) }}</span>
        </button>
        <span v-if="queueIndex(track,index) === player.index" class="lyrics-queue-meter" :class="{ playing: player.isPlaying }" aria-hidden="true"><i /><i /><i /><i /></span>
        <button v-else type="button" class="icon-btn round" :aria-label="`Меню трека ${track.title}`"><Icon name="more" :size="17" /><TrackMenu :track="track" /></button>
      </div>
      </CreativeTrackList>
      <p v-if="!visibleQueue.length" class="lyrics-queue-empty">Очередь пуста</p>
    </q-scroll-area>
  </aside>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type {Track} from '@/api/types';
import Icon from '@/components/Icon.vue';
import TrackMenu from '@/components/TrackMenu.vue';
import CreativeTrackList from '@/components/creative/CreativeTrackList.vue';
import { artistNames, formatDuration } from '@/lib/format';
import { usePlayerStore } from '@/stores/player/index';
const emit = defineEmits<{ close: [] }>();
const player = usePlayerStore();
const visibleQueue = computed(() => {
  const start = Math.max(0, player.index - 3);
  return player.queue.slice(start, start + 80).map((track, offset) => ({ track, index: start + offset }));
});
const queueTracks=computed(()=>visibleQueue.value.map(item=>item.track));
function queueIndex(track:Track,index:number){const item=visibleQueue.value[index];return item?.track.id===track.id?item.index:player.queue.findIndex(t=>t.id===track.id);}
function play(index: number) {
  if(index<0)return;
  if (index === player.index) { void player.toggle(); return; }
  player.index = index;
  void player.loadCurrent();
}
</script>
