<template>
  <div :inert="main&&(bg.open||bg.intro)" :aria-hidden="main&&(bg.open||bg.intro)?true:undefined" style="display:contents"><router-view /></div>
  <BackgroundOnboarding v-if="main" />
  <StartupIntro v-if="main&&bg.intro" @done="bg.intro=false" />
</template>

<script setup lang="ts">
import {onMounted} from 'vue';
import {isTauri} from '@tauri-apps/api/core';
import {getCurrentWindow} from '@tauri-apps/api/window';
import {useBackgroundStore} from '@/stores/background';
import BackgroundOnboarding from '@/components/background/BackgroundOnboarding.vue';
import StartupIntro from '@/components/background/StartupIntro.vue';
const bg=useBackgroundStore();const main=!isTauri()||getCurrentWindow().label==='main';
onMounted(()=>{if(main){if(!bg.completed)bg.restart()}});
</script>
