import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { createPinia, defineStore, setActivePinia } from 'pinia';
import { watch } from 'vue';

const compile = source => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const moduleUrl = source => 'data:text/javascript;base64,' + Buffer.from(compile(source)).toString('base64');
const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes,no) => { resolve=yes; reject=no; }); return { promise, resolve, reject }; };
const localId = n => 'local:' + n.toString(16).padStart(64,'0');
const track = n => ({ id:localId(n), title:`Local ${n}`, artists:[{ id:'local-artist:Artist', name:'Artist' }], album_id:null, album_title:'Album', cover_url:null, duration_ms:120000, available:true });
let fixtureNumber = 0;
const searchUrl = moduleUrl(await readFile(new URL('../src/lib/smartSearch.ts', import.meta.url),'utf8'));
const modelUrl = moduleUrl((await readFile(new URL('../src/lib/libraryTools/model.ts',import.meta.url),'utf8')).replace("'@/lib/smartSearch'",JSON.stringify(searchUrl)));
const { parseLocalLyrics } = await import(modelUrl);

// The real Pinia player and local playback helpers run unchanged. Only imports
// at platform/service boundaries are replaced, so calls and state are observed.
async function fixture(native = async (command,{id}) => command === 'library_track_path' ? `C:\\Music\\${id.slice(-1)}.flac` : '[00:01.25]Saved words') {
  const apiCalls = [], nativeCalls = [], censorCalls = [], lyricsHttpCalls = [], notifications = [], sources = [], plays = [];
  const cache = new Map(); let token = 0; let player;
  class Audio extends EventTarget {
    _src = ''; currentTime = 0; duration = 120; paused = true; error = null;
    playbackRate = 1; volume = 1;
    set src(value) { this._src = value; sources.push(value); }
    get src() { return this._src; }
    get currentSrc() { return this._src; }
    getAttribute(name) { return name === 'src' ? this._src || null : null; }
    removeAttribute(name) { if(name === 'src')this._src = ''; }
    pause() { this.paused=true; this.onpause?.(); }
    load() { if(this._src)this.dispatchEvent(new Event('loadedmetadata')); }
  }
  const audio = new Audio();
  const settings = {
    skipAiTracks:true, autoSkipDisliked:true, censorBypass:true, preferLocalFiles:true,
    crossfadeEnabled:false, crossfadeSeconds:0, autoWaveOnQueueEnd:false, repeatPlaylistAlways:false,
    discordEnabled:false, discordClientId:'', trimSilence:false,
  };
  const platform = {
    invoke:async(command,args) => { nativeCalls.push([command,args]); return native(command,args); },
    convertFileSrc:path => 'asset:' + path,
    parseLocalLyrics,
  };
  const key = `localPlaybackFixture${++fixtureNumber}`;
  globalThis[key] = platform;
  const helperSource = await readFile(new URL('../src/lib/libraryTools/playback.ts',import.meta.url),'utf8');
  const helperCode = compile(helperSource).replace(/import\s*\{([^}]+)\}\s*from\s*['"][^'"]+['"];?/g,(_,names) => `const {${names}} = globalThis.${key};`);
  const helpers = await import('data:text/javascript;base64,' + Buffer.from(helperCode).toString('base64'));
  const forbiddenCensor = name => (...args) => { censorCalls.push([name,args]); return name === 'ensureCensorList' ? Promise.resolve() : null; };
  const bindings = {
    ...platform, ...helpers, defineStore, watch, audio,
    Notify:{ create:entry => notifications.push(entry) },
    api:new Proxy({}, { get:(_,name) => async(...args) => {
      // Discord status stays in the native process, unlike catalog endpoints.
      if(name === 'discordPresenceStatus')return {connected:false,user:null,lastError:null};
      apiCalls.push([name,args]);
      if(name === 'aiCheckTracks')return [];
      if(name === 'wave')return {tracks:[],radio_session_id:null,batch_id:null};
      throw new Error(`Unexpected catalog call: ${String(name)}`);
    } }),
    bindMediaSession(){}, cancelFade(){}, currentLevel:()=>0, ensureAnalyser(){},
    fadeIn:async()=>{}, fadeOut:async()=>{}, fadeTo:async()=>{}, resumeAudioContext(){}, resumeOnGesture(){},
    isCurrentToken:request => request === token, nextSourceToken:()=>++token,
    safePlay:async request => { if(request !== undefined && request !== token)return; plays.push({source:audio.src,token:request}); audio.paused=false; audio.onplay?.(); },
    readCache:key => cache.get(key) ?? null, writeCache:(key,data) => cache.set(key,data), releaseMemoryCache(){},
    hasText:value => Boolean(value?.lines?.some(line=>line.text?.trim())),
    loadTrackLyrics:async(...args) => { lyricsHttpCalls.push(args); throw new Error('Unexpected lyrics HTTP request'); },
    proxyStream:url => url,
    playDiagnostic(){}, withDeadline:promise => promise,
    censorUrl:forbiddenCensor('censorUrl'), ensureCensorList:forbiddenCensor('ensureCensorList'),
    prefersOriginal:forbiddenCensor('prefersOriginal'), setPrefersOriginal(){}, overrideUrl:forbiddenCensor('overrideUrl'),
    createLogger:()=>({info(){},warn(){},error(){}}), logQuality(){},
    useEqualizerStore:()=>({apply(){}}), useLibraryStore:()=>({disliked:()=>false}),
    useSleepStore:()=>({onTrackEnded:()=>false,firing:false}),
    useStatsStore:()=>({begin(){},tick(){}}),
    useTogetherStore:()=>({isGuest:false,active:false}), useUiStore:()=>({settings}), DEFAULT_DISCORD_CLIENT_ID:'test',
    artistNames:artists=>artists.map(artist=>artist.name).join(', '), setTrayTooltip:async()=>{},
    resetPresenceSignature(){}, syncDiscordPresence:async()=>null,
    loadSession:()=>null, saveSession(){}, loadPlaybackSettings:()=>({volume:.5,muted:false,quality:'high',playbackRate:1,repeat:'off'}), savePlaybackSettings(){},
  };
  globalThis[key] = bindings;
  const playerSource = await readFile(new URL('../src/stores/player/index.ts',import.meta.url),'utf8');
  const playerCode = compile(playerSource).replace(/import\s*\{([^}]+)\}\s*from\s*['"][^'"]+['"];?/g,(_,names)=>`const {${names}} = globalThis.${key};`);
  const pinia = createPinia(); setActivePinia(pinia);
  const module = await import('data:text/javascript;base64,' + Buffer.from(playerCode).toString('base64'));
  player = module.usePlayerStore(pinia);
  return {player,audio,apiCalls,nativeCalls,censorCalls,lyricsHttpCalls,notifications,sources,plays,settings,
    dispose(){ player.$dispose(); delete globalThis[key]; },
  };
}

test('local queue loads real local helper sources and embedded lyrics while catalog, AI, censor and HTTP lyrics stay untouched', async () => {
  const f = await fixture();
  try {
    await f.player.playQueue([track(1),track(2)]);
    assert.equal(f.audio.src,'asset:C:\\Music\\1.flac');
    assert.equal(f.audio.paused,false); assert.equal(f.player.playingLocal,true);
    assert.equal(f.player.currentSource,'local-library'); assert.equal(f.player.loading,false);
    assert.equal(f.player.censorReplaced,false); assert.equal(f.player.censorAvailable,false);
    await f.player.loadLyrics();
    assert.equal(f.player.lyricsOrigin,'local');
    assert.equal(f.player.lyrics.track_id,localId(1));
    assert.deepEqual(f.player.lyrics.lines,[{time_ms:1250,text:'Saved words'}]);
    await f.player.prefetchNext();
    assert.deepEqual(f.nativeCalls.map(([name,args])=>[name,args.id]),[['library_track_path',localId(1)],['library_lyrics',localId(1)]]);
    assert.deepEqual(f.apiCalls,[]); assert.deepEqual(f.censorCalls,[]); assert.deepEqual(f.lyricsHttpCalls,[]);
    assert.equal(f.plays.length,1);
  } finally { f.dispose(); }
});

test('missing local source stops cleanly, never falls back to the network and detaches previous media', async () => {
  const f = await fixture(async()=>{throw new Error('File was removed');});
  try {
    f.audio.src='asset:previous-track';
    await f.player.playQueue([track(1)]);
    assert.equal(f.audio.src,''); assert.equal(f.audio.paused,true); assert.equal(f.player.loading,false);
    assert.equal(f.player.isPlaying,false); assert.equal(f.plays.length,0);
    assert.match(f.notifications.at(-1).message,/File was removed/);
    assert.deepEqual(f.apiCalls,[]); assert.deepEqual(f.censorCalls,[]); assert.deepEqual(f.lyricsHttpCalls,[]);
  } finally { f.dispose(); }
});

test('an older asynchronous local source cannot replace or start the newly selected track', async () => {
  const old = deferred();
  const f = await fixture(async(command,{id})=> id === localId(1) ? old.promise : 'C:\\Music\\new.flac');
  try {
    const first = f.player.playQueue([track(1)]); await flush();
    assert.equal(f.player.current.id,localId(1)); assert.equal(f.player.loading,true);
    await f.player.playQueue([track(2)]);
    assert.equal(f.player.current.id,localId(2)); assert.equal(f.audio.src,'asset:C:\\Music\\new.flac');
    old.resolve('C:\\Music\\stale.flac'); await first;
    assert.equal(f.player.current.id,localId(2)); assert.equal(f.audio.src,'asset:C:\\Music\\new.flac');
    assert.deepEqual(f.sources,['asset:C:\\Music\\new.flac']); assert.equal(f.plays.length,1);
    assert.equal(f.player.loading,false); assert.deepEqual(f.apiCalls,[]); assert.deepEqual(f.censorCalls,[]);
  } finally { old.resolve('C:\\Music\\stale.flac'); f.dispose(); }
});

test('local lyrics miss and read errors stay offline, and a stale response cannot overwrite a newer song', async () => {
  const old = deferred(); let mode = 'deferred';
  const f = await fixture(async(command,{id})=>{
    if(command === 'library_track_path')return `C:\\Music\\${id.slice(-1)}.flac`;
    if(mode === 'error')throw new Error('Read failed');
    if(mode === 'empty')return '';
    return id === localId(1) ? old.promise : '[00:02]New words';
  });
  try {
    await f.player.playQueue([track(1)]);
    const pending = f.player.loadLyrics(); await flush();
    await f.player.playQueue([track(2)]); await f.player.loadLyrics();
    old.resolve('[00:01]Old words'); await pending;
    assert.equal(f.player.lyrics.track_id,localId(2)); assert.equal(f.player.lyrics.lines[0].text,'New words');
    mode='empty'; await f.player.loadLyrics(true);
    assert.equal(f.player.lyrics,null); assert.match(f.player.lyricsError,/нет текста/);
    mode='error'; await f.player.loadLyrics(true);
    assert.equal(f.player.lyrics,null); assert.equal(f.player.lyricsLoading,false); assert.match(f.player.lyricsError,/прочитать/);
    assert.deepEqual(f.apiCalls,[]); assert.deepEqual(f.lyricsHttpCalls,[]); assert.deepEqual(f.censorCalls,[]);
  } finally { old.resolve(''); f.dispose(); }
});

test('local tracks inserted in an active wave never send their IDs as playback feedback or wave seeds', async () => {
  const f = await fixture();
  try {
    await f.player.playQueue([1,2,3,4,5,6].map(track),0,{wave:true,batchId:'wave-batch'});
    await f.player.next(false);
    assert.equal(f.player.current.id,localId(2));
    assert.deepEqual(f.apiCalls,[]);
    f.settings.autoWaveSource='playlist';
    await f.player.continueWithWave();
    const requests = f.apiCalls.filter(([name])=>name==='wave');
    assert.equal(requests.length,1);
    assert.equal(requests[0][1][0].station,'user:onyourwave');
    assert.equal(JSON.stringify(f.apiCalls).includes('local:'),false);
  } finally { f.dispose(); }
});

test('wave continuation omits local entries from the server queue when online and local tracks are mixed', async () => {
  const f = await fixture();
  try {
    f.player.queue=[track(1),{...track(2),id:'online-2'},track(3)];
    f.player.sourceQueue=[...f.player.queue]; f.player.index=0; f.player.current=f.player.queue[0];
    f.player.isWave=true; f.player.waveSessionId='session'; f.player.stationId='user:onyourwave';
    await f.player.extendWave();
    const requests=f.apiCalls.filter(([name])=>name==='wave');
    assert.ok(requests.length>0);
    for(const [,args] of requests) {
      if(args[0].queue)assert.deepEqual(args[0].queue,['online-2']);
      assert.equal(JSON.stringify(args).includes('local:'),false);
    }
    assert.deepEqual(f.censorCalls,[]); assert.deepEqual(f.lyricsHttpCalls,[]);
  } finally { f.dispose(); }
});
