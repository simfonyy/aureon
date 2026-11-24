<template>
  <router-view />
  <UpdateNotice v-if="mainWindow" />
</template>

<script setup lang="ts">
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import UpdateNotice from '@/components/UpdateNotice.vue';
import { phoneLayout } from '@/lib/phoneLayout';
import { useUiStore } from '@/stores/ui';
import { applyInterfaceSettings } from '@/stores/ui/apply';

const mainWindow = !phoneLayout && (!isTauri() || getCurrentWindow().label === 'main');
document.documentElement.classList.toggle('phone-layout', phoneLayout);
applyInterfaceSettings(useUiStore().settings);
</script>
