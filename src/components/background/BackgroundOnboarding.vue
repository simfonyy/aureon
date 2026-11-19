<template>
  <Teleport to="body">
    <div v-if="bg.open" class="onboarding-backdrop">
      <section ref="dialog" class="background-onboarding" role="dialog" aria-modal="true" aria-labelledby="onboard-title" @keydown.tab="trap">
        <header class="setup-header">
          <b><img src="/icons/favicon-32x32.png" width="26" height="26" alt="" />Aureon</b>
          <span class="setup-count" :aria-label="`Шаг ${step} из 3`">{{ step }} / 3</span>
        </header>

        <div v-if="step === 1" class="welcome-screen" :class="{ 'motion-off': !ui.settings.animations }">
          <div class="welcome-copy">
            <h1 id="onboard-title">Как будет выглядеть твой плеер?</h1>
            <p>Выбери живой или матовый фон. Его можно поменять в настройках.</p>
            <div class="welcome-actions">
              <button class="setup-primary" type="button" @click="step = 2">
                Выбрать фон <Icon name="chevronRight" :size="15" />
              </button>
              <button class="setup-link" type="button" @click="bg.finish()">Пропустить</button>
            </div>
          </div>
          <img class="welcome-image" src="/backgrounds/purple-chrome.png" alt="" />
        </div>

        <template v-else-if="step === 2">
          <div class="setup-heading"><h1 id="onboard-title">Какой фон использовать?</h1></div>
          <GpuRecommendation />
          <BackgroundChoices recommendation />
          <div class="setup-footer">
            <button class="btn" type="button" @click="step = 1">← Назад</button>
            <button class="setup-primary" type="button" @click="chooseStyle">Далее →</button>
          </div>
        </template>

        <template v-else>
          <div class="setup-heading">
            <h1 id="onboard-title">{{ bg.mode === 'beauty' ? 'Выбери рисунок' : 'Выбери цвет' }}</h1>
            <p>{{ bg.mode === 'beauty' ? 'Живой фон' : 'Матовая тема' }}</p>
          </div>
          <BackgroundPresets />
          <BackgroundPreview compact />
          <div class="setup-footer">
            <button class="btn" type="button" @click="step = 2">← Назад</button>
            <button class="setup-primary" type="button" @click="bg.finish()">Готово</button>
          </div>
        </template>

        <p v-if="bg.error" role="alert" class="setup-error">{{ bg.error }}</p>
      </section>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useBackgroundStore } from '@/stores/background';
import { useUiStore } from '@/stores/ui';
import { proceduralPresets } from '@/stores/ui/proceduralPresets';
import Icon from '@/components/Icon.vue';
import BackgroundChoices from './BackgroundChoices.vue';
import BackgroundPresets from './BackgroundPresets.vue';
import BackgroundPreview from './BackgroundPreview.vue';
import GpuRecommendation from './GpuRecommendation.vue';

const ui = useUiStore();
const bg = useBackgroundStore();
const step = ref(1);
const dialog = ref<HTMLElement | null>(null);
let previous: HTMLElement | null = null;

function chooseStyle() {
  if (bg.mode === 'beauty' && !proceduralPresets.some(preset => preset.name === bg.preset)) bg.selectPreset('Black Chrome');
  if (bg.mode === 'optimized' && ui.settings.theme !== 'custom') bg.selectPreset(ui.settings.theme);
  step.value = 3;
}

function trap(event: KeyboardEvent) {
  const controls = dialog.value?.querySelectorAll<HTMLElement>('button:not(:disabled),input,select,[tabindex="0"]');
  if (!controls?.length) return;
  const first = controls[0], last = controls[controls.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}

async function focusStep() {
  await nextTick();
  dialog.value?.querySelector('button')?.focus({ preventScroll: true });
}

watch(() => bg.open, open => {
  if (open) {
    previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    step.value = 1;
    void focusStep();
  } else {
    void nextTick(() => previous?.focus({ preventScroll: true }));
  }
}, { immediate: true });
watch(step, focusStep);
onBeforeUnmount(() => previous?.focus({ preventScroll: true }));
</script>

<style scoped>
.setup-header b {
  display: inline-flex;
  align-items: center;
  gap: 9px;
}

.setup-header img { display: block; border-radius: 6px; }
.setup-count { font-variant-numeric: tabular-nums; }

.welcome-screen {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, .85fr);
  align-items: center;
  gap: clamp(22px, 4vw, 56px);
  padding: clamp(16px, 3.5vw, 38px) clamp(4px, 1vw, 14px) clamp(14px, 2.5vw, 30px);
  animation: welcome-arrive 240ms cubic-bezier(.2,.75,.25,1) both;
}

.welcome-copy h1 {
  max-width: 390px;
  margin: 0;
  color: #f6f2fa;
  font-size: clamp(31px, 4vw, 51px);
  font-weight: 700;
  line-height: 1.04;
  letter-spacing: -.052em;
  text-wrap: balance;
}

.welcome-copy p {
  max-width: 30ch;
  margin: 16px 0 25px;
  color: #bab3c6;
  font-size: 14px;
  line-height: 1.55;
}

.welcome-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.welcome-actions button { min-height: 42px; font: inherit; font-size: 13px; font-weight: 650; }

.welcome-actions .setup-primary {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0 14px;
  border-radius: 9px;
  background: #ded1f4;
  color: #221733;
}

.welcome-actions .setup-primary:hover { background: #eee4ff; }
.welcome-actions .setup-link { margin: 0; padding: 0 10px; color: #bfb6cb; }
.welcome-actions .setup-link:hover { color: #fff; }

.welcome-image {
  display: block;
  width: 100%;
  aspect-ratio: 1.13;
  object-fit: cover;
  border: 1px solid #bca6ec30;
  border-radius: 16px;
  background: #17121f;
}

@keyframes welcome-arrive {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}

.welcome-screen.motion-off { animation: none; }
.welcome-screen.motion-off button { transition: none; }

@media (max-width: 580px) {
  .welcome-screen { grid-template-columns: 1fr; gap: 20px; }
  .welcome-image { aspect-ratio: 2.3; }
}

@media (prefers-reduced-motion: reduce) {
  .welcome-screen { animation: none; }
}
</style>
