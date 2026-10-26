import {defineStore} from 'pinia';
import {invoke,isTauri} from '@tauri-apps/api/core';
import {useUiStore} from './ui';
import {proceduralPresets} from './ui/proceduralPresets';
import {themeNames} from './ui/themes';
import {recommend,chooseAdapter,type GpuAdapter,type BackgroundMode} from '@/lib/gpuRecommendation';
const KEY='nightlezz.background.setup.v1';
function read(){try{const raw=JSON.parse(localStorage.getItem(KEY)||'{}');return {completed:raw.completed===true,preset:typeof raw.preset==='string'?raw.preset:'',gpu:raw.gpu&&typeof raw.gpu.model==='string'&&typeof raw.gpu.vendor==='string'&&Number.isFinite(raw.gpu.vramMb)?raw.gpu as GpuAdapter:null};}catch{return {completed:false,preset:'',gpu:null}}}
let detection:Promise<void>|null=null;
export const useBackgroundStore=defineStore('background',{
 state:()=>({...read(),open:false,detecting:false,detected:false,error:'',previewCount:0,intro:false}),
 getters:{
  previewActive:state=>state.previewCount>0,
  mode():BackgroundMode{const ui=useUiStore().settings;return ui.backgroundMode==='beauty'?'beauty':'optimized'},
  recommendation:state=>recommend(state.gpu),
 },
 actions:{
  persist(){try{localStorage.setItem(KEY,JSON.stringify({completed:this.completed,mode:this.mode,preset:this.preset,gpu:this.gpu,recommendation:this.recommendation}));this.error='';return true}catch{this.error='Не удалось сохранить настройки. Проверь доступ к хранилищу приложения.';return false}},
  async detect(){if(detection)return detection;if(this.detected)return;this.detecting=true;
   detection=(async()=>{let timer:ReturnType<typeof setTimeout>|undefined;try{const adapters=await Promise.race([isTauri()?invoke<GpuAdapter[]>('detect_gpu'):Promise.resolve([]),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('timeout')),4500)})]);this.gpu=chooseAdapter(Array.isArray(adapters)?adapters.filter(a=>typeof a?.model==='string'&&typeof a.vendor==='string'&&Number.isFinite(a.vramMb)):[])}catch{this.gpu=null}finally{clearTimeout(timer);this.detecting=false;this.detected=true;this.persist();detection=null}})();return detection;
  },
  setMode(mode:BackgroundMode){const ui=useUiStore();Object.assign(ui.settings,{backgroundMode:mode==='beauty'?'beauty':'matte',liquidMetal:mode==='beauty',metalRenderer:mode==='beauty'?'webgl':'css',metalQuality:mode==='beauty'?'balanced':'optimized',liquidMotion:mode==='beauty'});if(mode==='beauty'&&['light','paper','sky','matte'].includes(ui.settings.theme))ui.settings.theme='black';ui.apply();this.persist()},
  selectPreset(name:string){const ui=useUiStore();if(this.mode==='beauty'){const p=proceduralPresets.find(p=>p.name===name);if(!p)return;Object.assign(ui.settings,{metalAccent:p.accent,liquidIntensity:p.reflection,metalContrast:p.contrast,metalDepth:p.depth,metalSpeed:p.speed,metalSeed:p.seed});this.preset=p.name}else{const p=themeNames.find(p=>p.value===name);if(!p)return;Object.assign(ui.settings,{theme:p.value,backgroundMode:'matte',liquidMetal:false,metalRenderer:'css',metalQuality:'optimized',liquidMotion:false});this.preset=p.value}ui.apply();this.persist()},
  restart(){this.open=true;void this.detect()},
  finish(){const first=!this.completed;this.completed=true;if(this.persist()){this.open=false;this.intro=first}else this.completed=false},
 }
});
