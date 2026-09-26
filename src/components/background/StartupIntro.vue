<template>
  <Teleport to="body">
    <section class="startup-intro" aria-label="Запуск Aureon" @keydown.esc="emit('done')">
      <div class="startup-emblem"><img src="/icons/favicon-96x96.png" alt="" @error="($event.target as HTMLImageElement).style.display='none'"/><span>Ｎ</span></div>
      <h1>Aureon</h1>
      <div class="startup-line" aria-hidden="true"/>
      <button ref="skip" type="button" @click="emit('done')">Продолжить</button>
    </section>
  </Teleport>
</template>
<script setup lang="ts">
import {onMounted,onBeforeUnmount,ref} from 'vue';
import {useUiStore} from '@/stores/ui';
const emit=defineEmits<{done:[]}>();const skip=ref<HTMLButtonElement|null>(null);
let timer:ReturnType<typeof setTimeout>|undefined;let previous:HTMLElement|null=null;
onMounted(()=>{previous=document.activeElement as HTMLElement;skip.value?.focus();const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches||!useUiStore().settings.animations;timer=setTimeout(()=>emit('done'),reduced?100:2300)});
onBeforeUnmount(()=>{clearTimeout(timer);previous?.focus()});
</script>
<style scoped>
.startup-intro{position:fixed;inset:0;z-index:9500;display:flex;align-items:center;justify-content:center;flex-direction:column;background:radial-gradient(ellipse at 50% 40%,#271440 0,#0b0911 45%,#050507 85%);color:#f2edf8;animation:intro-reveal .55s ease-out both}
.startup-emblem{width:108px;height:108px;position:relative;display:grid;place-items:center;border-radius:28px;background:linear-gradient(135deg,#8d64b233,#06060b);border:1px solid #b08bda55;box-shadow:0 0 65px #923bf526;animation:emblem-reveal 1.25s cubic-bezier(.2,.8,.2,1) both}
.startup-emblem img{position:absolute;width:100%;height:100%;object-fit:contain;z-index:1}.startup-emblem span{font-size:48px;font-weight:700;color:#d9baff}
h1{font-size:clamp(27px,5vw,44px);letter-spacing:-1.5px;margin:25px 0 10px;animation:emblem-reveal .8s .2s both}
.startup-line{margin-top:28px;width:150px;height:2px;background:#ab64fa;transform-origin:left;animation:intro-line 2s ease-in-out both;box-shadow:0 0 14px #a969ee}
button{position:absolute;bottom:8%;background:none;border:1px solid #9a76b62c;padding:11px 20px;border-radius:12px;color:#b6a4c7;cursor:pointer;font:inherit;font-size:12px}button:focus-visible{outline:2px solid #b988ef;outline-offset:4px}
@keyframes intro-reveal{from{opacity:0}to{opacity:1}}@keyframes emblem-reveal{from{opacity:0;transform:translateY(18px) scale(.86);filter:blur(8px)}to{opacity:1;transform:none;filter:blur(0)}}@keyframes intro-line{from{transform:scaleX(0);opacity:.3}to{transform:scaleX(1);opacity:1}}
@media(prefers-reduced-motion:reduce){.startup-intro,.startup-emblem,h1,.startup-line{animation:none}}
</style>
