<template>
  <q-dialog :model-value="updates.open && !blocked" :persistent="updates.downloading" @update:model-value="value => { if (!value) updates.remindLater(); }">
    <div v-if="updates.release" class="update-notice" aria-labelledby="update-title">
      <span class="update-caption">Обновление Aureon</span>
      <h2 id="update-title">Версия {{ updates.release.version }}</h2>
      <p v-if="updates.downloaded">Файл сохранён. Откройте его, чтобы установить новую версию.</p>
      <p v-else-if="updates.release.canInstall">После загрузки Aureon закроется и откроет установщик. Настройки сохранятся.</p>
      <p v-else-if="updates.release.packageName">Скачаем пакет в папку «Загрузки». Затем его можно установить.</p>
      <p v-else>Сборка для этой системы пока недоступна. Проверить файлы можно на странице релиза.</p>
      <button class="update-link" @click="api.openExternal(updates.release.releaseUrl)">Что изменилось ↗</button>
      <div v-if="updates.downloading" class="update-progress" role="status">
        <q-linear-progress :value="updates.progress / 100" color="primary" rounded />
        <span>{{ updates.progress < 100 ? `Скачивание · ${updates.progress}%` : 'Проверка файла…' }}</span>
      </div>
      <p v-if="updates.downloaded" class="update-file">{{ updates.downloaded }}</p>
      <p v-if="updates.error" class="update-error" role="alert">{{ updates.error }}</p>
      <div class="update-actions">
        <button class="btn" :disabled="updates.downloading" @click="updates.remindLater()">{{ updates.downloaded ? 'Закрыть' : 'Через 2 дня' }}</button>
        <button v-if="!updates.downloaded" class="btn primary" :disabled="updates.downloading" @click="updates.download()">{{ updates.downloading ? 'Скачивание…' : updates.release.canInstall ? 'Скачать и обновить' : updates.release.packageName ? 'Скачать' : 'Открыть релиз' }}</button>
      </div>
    </div>
  </q-dialog>
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount } from 'vue';
import { api } from '@/api/client';
import { useUpdatesStore } from '@/stores/updates';
defineProps<{ blocked?: boolean }>();
const updates = useUpdatesStore();
let initial: ReturnType<typeof setTimeout>, timer: ReturnType<typeof setInterval>;
const check = () => { if (document.visibilityState === 'visible') void updates.check(); };
onMounted(() => {
  initial = setTimeout(check, 15000);
  timer = setInterval(check, 60000);
  document.addEventListener('visibilitychange', check);
});
onBeforeUnmount(() => { clearTimeout(initial); clearInterval(timer); document.removeEventListener('visibilitychange', check); });
</script>

<style scoped>
.update-notice { width: 460px; max-width: calc(100vw - 40px); padding: 28px; color: var(--fg); background: var(--surface); border: 1px solid var(--line); border-radius: 16px; }
.update-caption { color: var(--fg-dim); font-size: 12px; }
h2 { margin: 8px 0 16px; font-size: 25px; line-height: 1.2; }
p { color: var(--fg-dim); line-height: 1.6; font-size: 13px; }
.update-link { border: 0; background: none; padding: 0; color: var(--accent); cursor: pointer; font-size: 13px; }
.update-progress { margin-top: 22px; display: grid; gap: 10px; font-size: 12px; color: var(--fg-dim); }
.update-error { color: #ec8d8d; }
.update-file { overflow-wrap: anywhere; }
.update-actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 10px; margin-top: 26px; }
.primary { background: var(--accent); color: #111; }
button:disabled { opacity: .5; cursor: wait; }
</style>
