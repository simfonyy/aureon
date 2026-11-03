import { computed, onScopeDispose, ref, watch } from 'vue';
import { defineStore } from 'pinia';
import { useUiStore } from './ui/index';

const KEY = 'aureon.creative.v1';
export const useCreativeStore = defineStore('creative', () => {
  let saved: Record<string, unknown> = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { /* defaults */ }
  const miniSkin = ref<'classic' | 'cassette'>(saved.miniSkin === 'cassette' ? 'cassette' : 'classic');
  const motion = ref(saved.motion !== false);
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  const reducedMotion = ref(media.matches);
  const update = () => { reducedMotion.value = media.matches; };
  media.addEventListener('change', update);
  onScopeDispose(() => media.removeEventListener('change', update));
  const ui = useUiStore();
  const motionAllowed = computed(() => motion.value && ui.settings.animations && !reducedMotion.value);
  watch([miniSkin, motion], () => {
    try { localStorage.setItem(KEY, JSON.stringify({ miniSkin: miniSkin.value, motion: motion.value })); } catch { /* storage may be unavailable */ }
  });
  return { miniSkin, motion, reducedMotion, motionAllowed };
});
