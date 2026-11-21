<template>
  <div class="background-presets" :class="{matte:bg.mode==='optimized'}" aria-label="Пресеты фона">
    <button v-for="preset in presets" :key="preset.id" type="button" :class="{selected:selected===preset.id}" :aria-pressed="selected===preset.id" @click="bg.selectPreset(preset.id)">
      <img v-if="preset.image" :src="preset.image" alt="" loading="lazy" />
      <div v-else class="matte-swatch" :style="{background:preset.background}" aria-hidden="true"><i :style="{background:preset.surface}"/><b :style="{background:preset.surface2}"/></div>
      <span>{{preset.label}}</span><i v-if="selected===preset.id"><Icon name="check" :size="12"/></i>
    </button>
  </div>
</template>
<script setup lang="ts">
import {computed} from 'vue';
import Icon from '@/components/Icon.vue';
import {useBackgroundStore} from '@/stores/background';
import {useUiStore} from '@/stores/ui';
import {proceduralPresets} from '@/stores/ui/proceduralPresets';
import {themeNames,themePalettes} from '@/stores/ui/themes';
const bg=useBackgroundStore(), ui=useUiStore();
const selected=computed(()=>bg.mode==='beauty'?bg.preset:ui.settings.theme);
const presets=computed(()=>bg.mode==='beauty'
  ? proceduralPresets.map(p=>({id:p.name,label:p.name,image:'/backgrounds/'+p.name.toLowerCase().replaceAll(' ','-')+'.png',background:'',surface:'',surface2:''}))
  : themeNames.filter(p=>p.value!=='matte').map(p=>({id:p.value,label:p.label,image:'',...themePalettes[p.value]})));
</script>
