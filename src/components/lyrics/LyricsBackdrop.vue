<template>
  <div class="lyrics-scene" :class="{ 'scene-still': !motion }" :style="{ '--scene-blur': `${blur}px`, '--scene-opacity': opacity / 100 }" aria-hidden="true">
    <TransitionGroup name="lyrics-scene-swap">
      <div v-if="mode === 'cover' && cover" :key="cover" class="lyrics-scene-image" :style="{ backgroundImage: `url(${JSON.stringify(cover)})` }" />
      <div v-else-if="mode === 'gradient'" key="gradient" class="lyrics-scene-gradient" />
    </TransitionGroup>
    <div class="lyrics-scene-shade" />
  </div>
</template>

<script setup lang="ts">
defineProps<{ cover: string; mode: string; blur: number; opacity: number; motion: boolean }>();
</script>
