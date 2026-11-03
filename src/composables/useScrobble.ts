import {onBeforeUnmount,onMounted,watch} from 'vue';
import {invoke} from '@tauri-apps/api/core';
import {useListenBrainzStore} from '@/stores/listenbrainz';
import {usePlayerStore} from '@/stores/player/index';
import {useStatsStore} from '@/stores/stats';
import {scrobbleCandidate} from '@/lib/scrobble';
const KEY='aureon.listenbrainz.sent.v1';
function readSent():Set<string>{try{const data:unknown=JSON.parse(localStorage.getItem(KEY)||'[]');return new Set(Array.isArray(data)?data.filter(x=>typeof x==='string').slice(-500):[]);}catch{return new Set();}}
export function useScrobble(){const connection=useListenBrainzStore(),player=usePlayerStore(),stats=useStatsStore();const sent=readSent();let pending=false,stopped=false,retryAt=0;
  const stop=watch(()=>[stats.events.at(-1)?.seconds,player.current?.id,connection.enabled],async()=>{if(pending||stopped||Date.now()<retryAt)return;const candidate=scrobbleCandidate(stats.events.at(-1),player.current,connection.enabled,sent);if(!candidate)return;pending=true;try{await invoke('listenbrainz_submit',{listen:candidate.listen});sent.add(candidate.key);if(sent.size>500)sent.delete(sent.values().next().value!);try{localStorage.setItem(KEY,JSON.stringify([...sent]));}catch{}connection.error='';}catch(e){retryAt=Date.now()+60000;connection.error=String(e);}finally{pending=false;}});
  onMounted(()=>void connection.init());onBeforeUnmount(()=>{stopped=true;stop();});
}
