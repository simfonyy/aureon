<template><canvas ref="canvas" class="procedural-metal" :class="{ ready: ready && activeMode }" aria-hidden="true" /></template>
<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue';
import { useUiStore } from '@/stores/ui';
import { MetalRenderer } from '@/lib/metalRenderer';
const props=defineProps<{suspended?:boolean}>();
const ui=useUiStore(); const canvas=ref<HTMLCanvasElement|null>(null); const ready=ref(false);
const activeMode=computed(()=>ui.settings.metalQuality!=='optimized');
let renderer:MetalRenderer|null=null, disposed=false, initializing=false;
let frame=0, timer:ReturnType<typeof setTimeout>|undefined;
let clock=0,last=0; let pointer:[number,number]=[.5,.5];
let adaptiveFps=25, healthyFrames=0;
let focused=true, hidden=false, reduced=false; let media:MediaQueryList;
const parameters=()=>({accent:ui.settings.metalAccent,reflection:ui.settings.liquidIntensity,contrast:ui.settings.metalContrast,speed:ui.settings.metalSpeed,depth:ui.settings.metalDepth,grain:ui.settings.metalGrain,mouse:ui.settings.liquidParallax&&!reduced,seed:ui.settings.metalSeed});
function stop(){clearTimeout(timer);cancelAnimationFrame(frame);last=0;}
function draw(){renderer?.draw(parameters(),clock,pointer,ui.settings.metalQuality==='maximum'?'maximum':'balanced');}
function schedule(){
 stop(); if(!ready.value||!activeMode.value||hidden||!focused||props.suspended)return;
 draw(); if(reduced||!ui.settings.liquidMotion||!ui.settings.animations)return;
 const cap=ui.settings.metalQuality==='maximum'?40:25;adaptiveFps=Math.min(cap,adaptiveFps);
 const tick=(now:number)=>{if(disposed||hidden||!focused||!activeMode.value||props.suspended)return;
  if(last){const delta=now-last;clock+=Math.min(.1,delta/1000);if(delta>1000/adaptiveFps*1.65){adaptiveFps=Math.max(15,adaptiveFps-5);healthyFrames=0}else if(++healthyFrames>100){adaptiveFps=Math.min(cap,adaptiveFps+5);healthyFrames=0}}
  last=now;draw();timer=setTimeout(()=>{frame=requestAnimationFrame(tick);},Math.max(0,1000/adaptiveFps-(performance.now()-now)-8));};
 frame=requestAnimationFrame(tick);
}
async function initialize(){
 if(renderer||initializing||!canvas.value||!activeMode.value||disposed||props.suspended)return;
 initializing=true;
 try{renderer=new MetalRenderer(canvas.value);await renderer.warmUp();if(disposed)return;draw();ready.value=true;schedule();}
 catch{renderer?.dispose();renderer=null;ready.value=false;}
 finally{initializing=false;}
}
function visibility(){hidden=document.hidden;focused=document.hasFocus();schedule();}
function focus(){focused=true;schedule();}function blur(){focused=false;stop();}
function preference(){reduced=media.matches;pointer=[.5,.5];schedule();}
function move(e:PointerEvent){if(!ui.settings.liquidParallax||reduced||!activeMode.value)return;pointer=[e.clientX/innerWidth,1-e.clientY/innerHeight];}
function lost(e:Event){e.preventDefault();stop();ready.value=false;}
function restored(){renderer?.dispose();renderer=null;void initialize();}

watch(()=>[ui.settings.metalQuality,ui.settings.metalAccent,ui.settings.liquidIntensity,ui.settings.metalContrast,ui.settings.metalSpeed,ui.settings.metalDepth,ui.settings.metalGrain,ui.settings.metalSeed,ui.settings.liquidParallax,ui.settings.liquidMotion,ui.settings.animations],()=>{void initialize();if(ready.value)draw();schedule();});
watch(activeMode,()=>{void initialize();schedule();});
watch(()=>props.suspended,()=>{void initialize();schedule();});
onMounted(()=>{
 media=matchMedia('(prefers-reduced-motion: reduce)');reduced=media.matches;hidden=document.hidden;focused=document.hasFocus();
 media.addEventListener('change',preference);document.addEventListener('visibilitychange',visibility);window.addEventListener('focus',focus);window.addEventListener('blur',blur);window.addEventListener('pointermove',move,{passive:true});window.addEventListener('resize',schedule);
 canvas.value?.addEventListener('webglcontextlost',lost);canvas.value?.addEventListener('webglcontextrestored',restored);

 timer=setTimeout(()=>void initialize(),250);
});
onBeforeUnmount(()=>{disposed=true;stop();renderer?.dispose();media?.removeEventListener('change',preference);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('focus',focus);window.removeEventListener('blur',blur);window.removeEventListener('pointermove',move);window.removeEventListener('resize',schedule);canvas.value?.removeEventListener('webglcontextlost',lost);canvas.value?.removeEventListener('webglcontextrestored',restored);});
</script>
<style scoped>.procedural-metal{position:absolute;inset:0;width:100%;height:100%;opacity:0;pointer-events:none}.procedural-metal.ready{opacity:1}</style>
