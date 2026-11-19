<template>
  <Teleport to="body">
    <Transition name="startup" @after-leave="emit('done')">
      <section v-if="visible" class="startup-intro" role="dialog" aria-modal="true" aria-label="Запуск Aureon" @keydown.esc="dismiss">
        <div class="startup-lockup">
          <img src="/icons/aureon-256.png" alt="" width="82" height="82" />
          <h1>Aureon</h1>
        </div>
        <button ref="skip" type="button" @click="dismiss">Продолжить</button>
      </section>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useUiStore } from '@/stores/ui';

const emit = defineEmits<{ done: [] }>();
const visible = ref(true);
const skip = ref<HTMLButtonElement | null>(null);
let timer: ReturnType<typeof setTimeout> | undefined;
let previous: HTMLElement | null = null;

function dismiss() {
  clearTimeout(timer);
  visible.value = false;
}

onMounted(() => {
  if (!useUiStore().settings.animations || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    emit('done');
    return;
  }
  previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  skip.value?.focus({ preventScroll: true });
  timer = setTimeout(dismiss, 850);
});

onBeforeUnmount(() => {
  clearTimeout(timer);
  requestAnimationFrame(() => previous?.focus({ preventScroll: true }));
});
</script>

<style scoped>
.startup-intro {
  position: fixed;
  inset: 0;
  z-index: 9500;
  display: grid;
  place-items: center;
  overflow: hidden;
  background: #101017;
  color: #f5f2fa;
}

.startup-intro::before {
  content: '';
  position: absolute;
  width: min(65vmin, 520px);
  aspect-ratio: 1;
  border: 1px solid #a08ab022;
  border-radius: 50%;
  background: repeating-radial-gradient(circle, transparent 0 12px, #bca8df0c 12px 13px);
}

.startup-lockup {
  position: relative;
  display: grid;
  justify-items: center;
  gap: 10px;
  animation: startup-arrive 270ms cubic-bezier(.2,.75,.25,1) both;
}

.startup-lockup img { display: block; border-radius: 21px; }
.startup-lockup h1 { margin: 0; font-size: 38px; font-weight: 720; line-height: 1.1; letter-spacing: -.065em; }

.startup-intro button {
  position: absolute;
  bottom: max(24px, 7vh);
  padding: 8px 14px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: #b8b1c4;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.startup-intro button:hover,
.startup-intro button:focus-visible { border-color: #6c5d81; color: #f5f2fa; }
.startup-leave-active { transition: opacity 170ms ease; }
.startup-leave-to { opacity: 0; }

@keyframes startup-arrive {
  from { opacity: 0; transform: translateY(7px); }
  to { opacity: 1; transform: translateY(0); }
}

@media (prefers-reduced-motion: reduce) {
  .startup-lockup { animation: none; }
  .startup-leave-active { transition: none; }
}
</style>
