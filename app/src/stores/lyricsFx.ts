import { computed, onScopeDispose, ref, watch } from 'vue';
import { defineStore } from 'pinia';
import { invoke } from '@tauri-apps/api/core';
import { audio } from '@/lib/audio';
import { lineWords } from '@/lib/karaoke';
import { analyzeTrackMusic } from '@/lib/lyricsFx/music';
import { fingerprint, planAccents, sourceFingerprint, type FxCandidate, type FxDocument } from '@/lib/lyricsFx/planner';
import type { FxEvent } from '@/lib/lyricsFx/rendererTypes';
import { usePlayerStore } from './player/index';
import { useUiStore } from './ui/index';

interface Selection { status:'ready'|'unavailable'|'error';candidates:FxCandidate[];cacheKey:string }

/** Background preparation belongs to playback, so opening the lyrics never starts a second model run. */
export const useLyricsFxStore=defineStore('lyricsFx',()=>{
  const player=usePlayerStore(),ui=useUiStore();
  const events=ref<FxEvent[]>([]),status=ref<'idle'|'analyzing'|'ready'|'unavailable'>('idle');
  const sourceUrl=ref(audio.currentSrc || audio.src),reduced=window.matchMedia('(prefers-reduced-motion: reduce)');
  const reducedMotion=ref(reduced.matches);
  const updateMotion=()=>{reducedMotion.value=reduced.matches};
  const updateSource=()=>{sourceUrl.value=audio.currentSrc || audio.src};
  reduced.addEventListener('change',updateMotion);
  audio.addEventListener('loadstart',updateSource);audio.addEventListener('loadedmetadata',updateSource);audio.addEventListener('emptied',updateSource);
  const enabled=computed(()=>ui.settings.lyricsFxEnabled && ui.settings.lyricsMotion && ui.settings.animations && !reducedMotion.value);
  const sourceKey=computed(()=>`${player.current?.id??''}|${player.currentSource??''}|${player.currentCodec??''}|${player.censorReplaced?'replacement':'original'}|${sourceFingerprint(sourceUrl.value)}`);
  const document=computed<FxDocument>(()=>{
    if (!player.current || !player.lyrics?.synced || player.lyrics.track_id!==player.current.id) return {transcript:'',words:[],lines:[]};
    const lines=player.lyrics.lines;
    const rows=lines.map((line,i)=>lineWords(line,lines[i+1]?.time_ms ?? (player.duration>0?player.duration*1000:undefined)));
    const words=rows.flatMap((row,i)=>row.flatMap((word,j)=>word.text.trim() && !/^\[.*\]$/.test(word.text.trim())?[{id:`l${i}-w${j}`,text:word.text,startMs:word.start,endMs:word.end,lineId:`l${i}`}]:[]));
    return {transcript:lines.map(line=>line.text.replace(/<\d+:\d+(?:[.,]\d+)?>/g,'')).join('\n'),words,
      lines:rows.map((_,i)=>({id:`l${i}`,wordIds:words.filter(word=>word.lineId===`l${i}`).map(word=>word.id)})).filter(line=>line.wordIds.length)};
  });
  const documentKey=computed(()=>`${sourceKey.value}|${fingerprint(JSON.stringify(document.value))}`);
  const cache=new Map<string,FxEvent[]>();
  let generation=0,timer:ReturnType<typeof setTimeout>|undefined,abort:AbortController|null=null,nativeBusy=false;
  let cancellation:Promise<unknown>=Promise.resolve();
  function cancel(){
    generation++;clearTimeout(timer);abort?.abort();abort=null;
    if (nativeBusy) { nativeBusy=false;cancellation=cancellation.then(()=>invoke('cancel_lyrics_fx')).catch(()=>{}); }
  }
  watch([()=>player.current?.id,enabled],()=>{
    if (enabled.value && player.current && !player.loading) void player.loadLyrics();
  },{immediate:true});
  watch(()=>player.loading,loading=>{if (!loading && enabled.value && player.current) void player.loadLyrics()});
  watch([documentKey,enabled,()=>player.loading],()=>{
    cancel();events.value=[];status.value='idle';
    if (!enabled.value || player.loading || !sourceUrl.value || !document.value.words.length) return;
    const key=documentKey.value,cached=cache.get(key);
    if (cached) {events.value=cached;status.value='ready';return}
    const request={sourceKey:sourceKey.value,...document.value};
    if (request.words.length>600) {status.value='unavailable';return}
    const current=++generation;
    timer=setTimeout(async()=>{
      await cancellation;
      if (current!==generation || !enabled.value) return;
      const controller=new AbortController();abort=controller;status.value='analyzing';nativeBusy=true;
      try {
        const [selection,music]=await Promise.all([
          invoke<Selection>('analyze_lyrics_fx',{request}).then(selection=>{if(selection?.status!=='ready')controller.abort();return selection}),
          analyzeTrackMusic(sourceUrl.value,request.sourceKey,controller.signal,player.duration>0?player.duration*1000:undefined),
        ]);
        if (current!==generation || documentKey.value!==key || !enabled.value) return;
        events.value=selection?.status==='ready' && Array.isArray(selection.candidates)?planAccents(request.words,selection.candidates,music,request.sourceKey):[];
        status.value=selection?.status==='ready' && music?'ready':'unavailable';
        if (status.value==='ready') {cache.set(key,events.value);while(cache.size>4)cache.delete(cache.keys().next().value!)}
      } catch { controller.abort();if (current===generation) {events.value=[];status.value='unavailable'} }
      finally { if(current===generation){nativeBusy=false;abort=null} }
    },250);
  },{immediate:true});
  onScopeDispose(()=>{cancel();reduced.removeEventListener('change',updateMotion);audio.removeEventListener('loadstart',updateSource);audio.removeEventListener('loadedmetadata',updateSource);audio.removeEventListener('emptied',updateSource)});
  return {events,status,enabled,sourceKey,document};
});
