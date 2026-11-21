<template>
  <div ref="background" class="liquid-metal" :class="{ 'is-moving': moving }" :style="materialStyle" aria-hidden="true">
    <div class="liquid-metal-field">
      <svg class="metal-folds" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">
        <defs>
          <linearGradient id="chrome-ribbon" x1="0" y1="0" x2="0.8" y2="1">
            <stop stop-color="#08090c"/><stop offset=".28" stop-color="#10131b"/>
            <stop offset=".40" stop-color="#323847"/><stop offset=".465" :stop-color="tint.mid"/>
            <stop offset=".485" :stop-color="tint.highlight"/><stop offset=".51" stop-color="#414757"/>
            <stop offset=".56" stop-color="#101219"/><stop offset=".78" stop-color="#06070a"/>
            <stop offset=".89" stop-color="#282736"/><stop offset="1" stop-color="#08090c"/>
          </linearGradient>
          <linearGradient id="chrome-edge" x1="0" y1="0" x2="1" y2=".5">
            <stop stop-color="#adb8d0" stop-opacity="0"/><stop offset=".48" stop-color="#cad3e4" stop-opacity=".45"/>
            <stop offset=".7" stop-color="#8170a8" stop-opacity=".18"/><stop offset="1" stop-color="#adb8d0" stop-opacity="0"/>
          </linearGradient>
        </defs>
        <g fill="url(#chrome-ribbon)">
          <path d="M-250 440C110 560 295 250 470 225S750 265 950 10L1140-170C830 380 655 135 475 400S45 870-250 660Z"/>
          <path d="M710-180C760 80 1250 55 1160 300S700 460 945 615 1410 310 1800 420L1790 140C1390 105 1420 545 1110 455S1600 165 1410-180Z"/>
          <path d="M-240 1120C-60 800 195 925 450 695S895 700 1120 795 1510 555 1810 665L1740 1020C1380 820 1295 1170 945 955S605 815 320 1055 55 1120-240 1230Z"/>
        </g>
        <g fill="none" stroke="url(#chrome-edge)" stroke-width="2">
          <path d="M-90 642C255 770 430 145 685 253S996 44 1075-70"/>
          <path d="M830-80C1050 110 1295 62 1235 253S827 462 1080 543 1485 238 1700 337"/>
          <path d="M-70 1060C175 775 215 988 483 778S842 778 1087 877 1490 658 1670 790"/>
        </g>
      </svg>
      <div class="metal-ambient" />
    </div>
    <ProceduralMetal v-if="ui.settings.metalRenderer === 'webgl'" :suspended="suspended" />
    <div class="metal-grain" />
    <div class="metal-vignette" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from "vue";
import { useUiStore } from "@/stores/ui";
import { metalTints } from '@/stores/ui/appearancePresets';
import ProceduralMetal from './ProceduralMetal.vue';
const props=defineProps<{suspended?:boolean}>();

const ui = useUiStore();
const tint = computed(() => metalTints[ui.settings.liquidTint] ?? metalTints.silver);
const background = ref<HTMLElement | null>(null);
const reduced = ref(false);
const visible = ref(true);
const moving = computed(() => ui.settings.liquidMotion && ui.settings.animations && !reduced.value && visible.value && !props.suspended);
const parallax = computed(() => moving.value && ui.settings.liquidParallax);
const materialStyle = computed(() => ({
  '--metal-glow': tint.value.glow,
  '--metal-intensity': Math.max(15, Math.min(100, ui.settings.liquidIntensity)) / 100,
  '--metal-cycle': `${Math.max(25, Math.min(45, ui.settings.liquidSpeed))}s`,
}));
let frame = 0;
let x = 0;
let y = 0;
let media: MediaQueryList | undefined;
function resetPosition() {
  cancelAnimationFrame(frame);
  frame = 0;
  background.value?.style.setProperty('--metal-x', '0px');
  background.value?.style.setProperty('--metal-y', '0px');
}
function pointer(event: PointerEvent) {
  if (!parallax.value || event.pointerType === 'touch') return;
  x = (event.clientX / window.innerWidth - .5) * 16;
  y = (event.clientY / window.innerHeight - .5) * 16;
  if (frame) return;
  frame = requestAnimationFrame(() => {
    background.value?.style.setProperty('--metal-x', `${x}px`);
    background.value?.style.setProperty('--metal-y', `${y}px`);
    frame = 0;
  });
}
function visibility() { visible.value = !document.hidden; }
function preference() { reduced.value = media?.matches ?? false; }
watch(parallax, (enabled) => { if (!enabled) resetPosition(); });
onMounted(() => {
  media = window.matchMedia('(prefers-reduced-motion: reduce)');
  preference();
  visibility();
  media.addEventListener('change', preference);
  window.addEventListener('pointermove', pointer, { passive: true });
  window.addEventListener('blur', resetPosition);
  document.documentElement.addEventListener('pointerleave', resetPosition);
  document.addEventListener('visibilitychange', visibility);
});
onBeforeUnmount(() => {
  resetPosition();
  media?.removeEventListener('change', preference);
  window.removeEventListener('pointermove', pointer);
  window.removeEventListener('blur', resetPosition);
  document.documentElement.removeEventListener('pointerleave', resetPosition);
  document.removeEventListener('visibilitychange', visibility);
});
</script>
