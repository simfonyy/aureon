<template>
  <motion.svg :key="active ? 'liked' : 'plain'" viewBox="0 0 24 24" :width="size" :height="size" aria-hidden="true" :initial="active && creative.motionAllowed ? { scale: .7 } : false" :animate="{ scale: 1 }" :transition="{ type: 'spring', stiffness: 440, damping: 18 }" :fill="active ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round">
    <path d="M20.8 4.6a5.6 5.6 0 0 0-7.9 0l-.9.9-.9-.9a5.6 5.6 0 0 0-7.9 7.9L12 21l8.8-8.5a5.6 5.6 0 0 0 0-7.9Z" />
  </motion.svg>
</template>
<script setup lang="ts">
import { motion } from 'motion-v';
import { useCreativeStore } from '@/stores/creative';
withDefaults(defineProps<{ active: boolean; size?: number }>(), { size: 18 });
const creative = useCreativeStore();
</script>
