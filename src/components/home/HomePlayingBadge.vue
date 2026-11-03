<template>
  <span class="home-playing-badge" :title="player.isPlaying ? 'Сейчас играет' : 'На паузе'">
    <canvas v-if="animated" ref="canvas" aria-hidden="true" />
    <Icon v-else :name="player.isPlaying ? 'wave' : 'pause'" :size="14" />
    <span class="sr-only">{{ player.isPlaying ? 'Сейчас играет' : 'На паузе' }}</span>
  </span>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import Icon from '@/components/Icon.vue';
import { useVisualizer } from '@/composables/useVisualizer';
import { usePlayerStore } from '@/stores/player/index';
import { useUiStore } from '@/stores/ui/index';
const player = usePlayerStore();
const ui = useUiStore();
const canvas = ref<HTMLCanvasElement | null>(null);
const animated = computed(() => player.isPlaying && ui.settings.animations);
useVisualizer(canvas, () => animated.value, { bars: 4 });
</script>

<style scoped>
.home-playing-badge { position:absolute;left:10px;bottom:10px;display:grid;place-items:center;width:30px;height:30px;border-radius:8px;background:var(--surface);color:var(--accent);pointer-events:none; }
canvas { width:22px;height:22px; }
.sr-only { position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap; }
</style>
