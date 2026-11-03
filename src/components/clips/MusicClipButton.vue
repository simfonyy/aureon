<template>
  <button v-if="available" type="button" class="music-clip-button" aria-label="Клипы к треку" @click.stop="clips.open(track)">
    <Icon name="musicVideo" :size="17" />
    <q-tooltip>Клип</q-tooltip>
  </button>
</template>
<script setup lang="ts">
import { computed, watch } from 'vue';
import type { Track } from '@/api/types';
import { hasMusicClips, musicTrackId } from '@/lib/musicClips';
import { useMusicClipsStore } from '@/stores/musicClips';
import Icon from '@/components/Icon.vue';
const props = defineProps<{ track: Track; lookup?: boolean }>();
const clips = useMusicClipsStore();
const available = computed(() => hasMusicClips(props.track) || hasMusicClips({ ...props.track, clip_ids: clips.knownClipIds[musicTrackId(props.track.id) || ''] }));
watch(() => [props.track.id, props.track.clip_ids, props.lookup] as const, () => {
  if (props.lookup && !hasMusicClips(props.track)) void clips.lookup(props.track);
}, { immediate: true });
</script>
<style scoped>
.music-clip-button{display:inline-flex;align-items:center;justify-content:center;flex:none;width:27px;height:27px;padding:0;border:0;border-radius:7px;background:transparent;color:var(--fg-dim);cursor:pointer}
.music-clip-button:hover{color:var(--fg);background:var(--surface-2)}.music-clip-button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
</style>
