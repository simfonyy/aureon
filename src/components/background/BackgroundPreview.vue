<template><div class="background-preview" :class="{compact}" role="img" aria-label="Предпросмотр выбранного фона"><LiquidMetalBackground :suspended="!running"/><div class="preview-sample"><span>Aureon</span><small>{{bg.mode==='beauty'?'Живой фон':'Простой фон'}}</small></div></div></template>
<script setup lang="ts">
import {onMounted,onBeforeUnmount} from 'vue';import LiquidMetalBackground from '@/components/LiquidMetalBackground.vue';import {useBackgroundStore} from '@/stores/background';
withDefaults(defineProps<{running?:boolean;compact?:boolean}>(),{running:true,compact:false});const bg=useBackgroundStore();onMounted(()=>bg.previewCount++);onBeforeUnmount(()=>bg.previewCount=Math.max(0,bg.previewCount-1));
</script>
