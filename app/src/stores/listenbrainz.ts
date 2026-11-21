import {defineStore} from 'pinia';
import {invoke} from '@tauri-apps/api/core';
interface Connection {user_name:string;enabled:boolean}
interface Recent {artist:string;title:string;at:number}
export const useListenBrainzStore=defineStore('listenbrainz',{
  state:()=>({userName:'',enabled:false,ready:false,busy:false,error:'',recent:[] as Recent[]}),
  actions:{
    apply(c:Connection){this.userName=c.user_name;this.enabled=c.enabled;this.ready=true;},
    async init(){if(this.ready)return;try{this.apply(await invoke<Connection>('listenbrainz_status'));}catch{this.ready=true;}},
    async connect(token:string){this.busy=true;this.error='';try{this.apply(await invoke<Connection>('listenbrainz_connect',{token}));return true;}catch(e){this.error=String(e);return false;}finally{this.busy=false;}},
    async toggle(enabled:boolean){this.busy=true;this.error='';try{this.apply(await invoke<Connection>('listenbrainz_set_enabled',{enabled}));}catch(e){this.error=String(e);}finally{this.busy=false;}},
    async disconnect(){this.busy=true;this.error='';try{await invoke('listenbrainz_disconnect');this.apply({user_name:'',enabled:false});this.recent=[];}catch(e){this.error=String(e);}finally{this.busy=false;}},
    async history(){this.busy=true;this.error='';try{const data=await invoke<{payload:{listens:Array<{listened_at:number;track_metadata:{artist_name:string;track_name:string}}>}}>('listenbrainz_recent');this.recent=data.payload.listens.map(l=>({artist:l.track_metadata.artist_name,title:l.track_metadata.track_name,at:l.listened_at*1000}));}catch(e){this.error=String(e);}finally{this.busy=false;}},
  }
});
