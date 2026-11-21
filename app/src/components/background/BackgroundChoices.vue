<template>
  <div class="background-choices" role="group" aria-label="Тип фона">
    <button v-for="mode in modes" :key="mode.id" type="button" :class="['background-choice', {selected:bg.mode===mode.id}]" :aria-pressed="bg.mode===mode.id" @click="bg.setMode(mode.id)">
      <div class="choice-top"><b>{{mode.title}}</b><Icon v-if="bg.mode===mode.id" name="check" :size="16" /></div>
      <p>{{mode.subtitle}}</p>
      <div :class="['choice-art',mode.id]">
        <img v-if="mode.id==='beauty'" src="/backgrounds/black-chrome.png" alt="" loading="lazy" />
        <div v-else class="matte-sample" aria-hidden="true"><i/><div><b/><span/><span/></div></div>
      </div>
    </button>
  </div>
</template>
<script setup lang="ts">
import Icon from '@/components/Icon.vue';
import {useBackgroundStore} from '@/stores/background';
import type {BackgroundMode} from '@/lib/gpuRecommendation';
defineProps<{recommendation?:boolean}>();
const bg=useBackgroundStore();
const modes: Array<{id:BackgroundMode;title:string;subtitle:string}> = [
  {id:'optimized',title:'Матовая тема',subtitle:'Однотонный фон и непрозрачные панели.'},
  {id:'beauty',title:'Живой фон',subtitle:'Движущиеся металлические отражения.'},
];
</script>
