<template>
  <div class="creative-preferences">
    <label><span>Мини-плеер</span><select v-model="creative.miniSkin" aria-label="Скин мини-плеера"><option value="classic">Обычный</option><option value="cassette">Кассета</option></select></label>
    <label><span>Анимации отклика</span><input v-model="creative.motion" type="checkbox" /></label>
    <small v-if="creative.reducedMotion">Движение отключено настройкой системы.</small>
  </div>
</template>
<script setup lang="ts">
import { useCreativeStore } from '@/stores/creative';
const creative = useCreativeStore();
</script>
<style scoped>
.creative-preferences{display:grid;gap:14px}.creative-preferences label{display:flex;align-items:center;justify-content:space-between;gap:16px}.creative-preferences select{color:var(--fg);background:var(--surface-2);border:1px solid var(--line);border-radius:8px;padding:8px}.creative-preferences input{accent-color:var(--accent)}.creative-preferences small{color:var(--fg-dim)}
</style>
