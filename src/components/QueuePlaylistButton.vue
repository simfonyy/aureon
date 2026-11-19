<template>
  <button
    v-if="player.queue.length"
    class="icon-btn round queue-playlist-button"
    type="button"
    :disabled="!canSave || library.queuePlaylistBusy"
    :aria-busy="library.queuePlaylistBusy"
    aria-label="Сохранить очередь в плейлист"
    :title="canSave ? 'Сохранить очередь в плейлист' : 'В очереди нет треков Яндекс Музыки'"
    @click="library.saveQueueAsPlaylist(player.queue, player.current?.title)"
  >
    <q-spinner v-if="library.queuePlaylistBusy" size="15px" />
    <Icon v-else name="playlistAdd" :size="17" />
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import Icon from '@/components/Icon.vue';
import { musicTrackId } from '@/lib/musicClips';
import { useLibraryStore } from '@/stores/library';
import { usePlayerStore } from '@/stores/player/index';

const library = useLibraryStore();
const player = usePlayerStore();
const canSave = computed(() => player.queue.some(track => musicTrackId(track.id)));
</script>

<style scoped>
.queue-playlist-button { flex: 0 0 28px; width: 28px; height: 28px; }
.queue-playlist-button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
.queue-playlist-button:disabled { opacity: .48; cursor: default; }
</style>
