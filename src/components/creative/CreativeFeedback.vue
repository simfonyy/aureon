<template>
  <div class="creative-feedback" aria-live="polite" aria-atomic="true">
    <AnimatePresence><motion.div v-if="message" :key="serial" class="creative-feedback-note" :initial="creative.motionAllowed ? { opacity: 0, y: 8, scale: .96 } : false" :animate="{ opacity: 1, y: 0, scale: 1 }" :exit="{ opacity: 0 }" :transition="{ duration: creative.motionAllowed ? .18 : 0 }"><svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg><span>{{ message }}</span></motion.div></AnimatePresence>
  </div>
</template>
<script setup lang="ts">
import { onScopeDispose, ref } from 'vue';
import { AnimatePresence, motion } from 'motion-v';
import { useLibraryStore } from '@/stores/library';
import { useCreativeStore } from '@/stores/creative';
const library = useLibraryStore(), creative = useCreativeStore();
const message = ref(''), serial = ref(0);
let timer: ReturnType<typeof setTimeout> | undefined, disposed = false;
function show(text: string) { if (disposed || !creative.motionAllowed) return; clearTimeout(timer); message.value = text; serial.value++; timer = setTimeout(() => { message.value = ''; }, 1400); }
const unsubscribe = library.$onAction(({ name, args, after }) => {
  if (name !== 'toggleLike') return;
  const track = args[0], wasLiked = library.liked(track.id);
  after(() => { if (!wasLiked && library.liked(track.id)) show('В любимых'); });
});
onScopeDispose(() => { disposed = true; unsubscribe(); clearTimeout(timer); });
</script>
<style scoped>
.creative-feedback{position:fixed;bottom:112px;left:50%;transform:translateX(-50%);z-index:11000;pointer-events:none}.creative-feedback-note{display:flex;align-items:center;gap:9px;padding:10px 16px;border:1px solid var(--line);background:var(--surface);color:var(--fg);box-shadow:0 8px 30px var(--shadow-soft);border-radius:30px;font-size:13px}
</style>
