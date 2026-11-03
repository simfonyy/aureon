<template>
  <div class="creative-track-list">
    <AnimatePresence :initial="false">
      <motion.div v-for="(track, index) in tracks" :key="keys[index]" :layout="creative.motionAllowed ? 'position' : false" :initial="creative.motionAllowed ? { opacity: 0, y: 6 } : false" :animate="{ opacity: 1, y: 0 }" :exit="creative.motionAllowed ? { opacity: 0, height: 0, overflow: 'hidden' } : { opacity: 1 }" :transition="{ duration: creative.motionAllowed ? .18 : 0 }">
        <slot :track="track" :index="index" />
      </motion.div>
    </AnimatePresence>
  </div>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import { AnimatePresence, motion } from 'motion-v';
import type { Track } from '@/api/types';
import { useCreativeStore } from '@/stores/creative';
const props = defineProps<{ tracks: Track[] }>();
const creative = useCreativeStore();
const keys = computed(() => { const seen = new Map<string, number>(); return props.tracks.map(track => { const n = seen.get(track.id) || 0; seen.set(track.id, n + 1); return `${track.id}:${n}`; }); });
</script>
