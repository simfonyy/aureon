<template>
  <div class="lyrics-scene" :class="{ 'scene-still': !motion }" :style="sceneStyle" aria-hidden="true">
    <TransitionGroup name="lyrics-scene-swap">
      <div v-if="mode === 'cover' && cover" :key="cover" class="lyrics-scene-image" :style="{ backgroundImage: `url(${JSON.stringify(cover)})` }" />
      <div v-else-if="mode === 'gradient'" key="gradient" class="lyrics-scene-gradient" :style="gradientStyle" />
    </TransitionGroup>
    <div class="lyrics-scene-shade" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useCoverPalette } from '@/composables/useCoverPalette';
const props = defineProps<{ cover: string; mode: string; blur: number; opacity: number; motion: boolean }>();
const { palette, style } = useCoverPalette(() => props.mode === 'gradient' ? props.cover : null);
const sceneStyle = computed(() => ({ ...style.value, '--scene-blur': `${props.blur}px`, '--scene-opacity': props.opacity / 100 }));
const gradientStyle = computed(() => palette.value ? {
  background: 'radial-gradient(ellipse at 14% 7%, color-mix(in srgb, var(--cover-accent) 48%, transparent), transparent 64%), radial-gradient(ellipse at 86% 90%, color-mix(in srgb, var(--cover-muted) 32%, transparent), transparent 62%), var(--cover-dark)',
} : undefined);
</script>
