import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const url = source => 'data:text/javascript;base64,' + Buffer.from(compile(source)).toString('base64');
const searchUrl = url(await readFile(new URL('../src/lib/smartSearch.ts', import.meta.url), 'utf8'));
const source = (await readFile(new URL('../src/lib/libraryTools/model.ts', import.meta.url), 'utf8')).replace("'@/lib/smartSearch'", JSON.stringify(searchUrl));
const modelUrl = url(source);
const m = await import(modelUrl);
const id = n => 'local:' + n.toString(16).padStart(64,'0');
const entry = (n = 1, extra = {}) => ({ id:id(n), path:`C:\\Music\\song${n}.flac`, title:`Song ${n}`, artist:'Artist', album:'Album', genre:'Rock', year:2026, trackNumber:1, durationMs:179000, size:1000000, modifiedAt:100, addedAt:100, coverPath:null, lyrics:'', analysis:null, ...extra });
const analysis = (bpm = 120, energy = .7) => ({ version:1, bpm, bpmConfidence:.8, key:'C major', keyConfidence:.4, energy, analyzedSeconds:120, fingerprint:Array(100).fill(123) });
class MemoryStorage {
  values = new Map();
  get length() { return this.values.size; }
  key(i) { return [...this.values.keys()][i] ?? null; }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key,value) { this.values.set(key,String(value)); }
}

test('catalog normalization rejects malformed IDs, paths and duplicate rows; unknown audio metrics stay unknown', () => {
  assert.equal(m.normalizeEntry(null),null);
  assert.equal(m.normalizeEntry(entry(1,{id:'12'})),null);
  assert.equal(m.normalizeEntry(entry(1,{path:'../track.mp3'})),null);
  assert.equal(m.normalizeEntry(entry(1,{title:''})),null);
  const row = m.normalizeEntry(entry(1,{durationMs:Infinity, year:NaN, lyrics:'  line\0  ', analysis:analysis(-12,4)}));
  assert.equal(row.durationMs,0); assert.equal(row.year,null); assert.equal(row.lyrics,'line');
  assert.equal(row.analysis.bpm,null); assert.equal(row.analysis.energy,1);
  assert.equal(m.normalizeEntry(entry(1,{analysis:analysis(120,NaN)})).analysis,null);
  assert.equal(m.normalizeCatalog([entry(),entry(),entry(2),null]).length,2);
  assert.equal(m.normalizeCatalog(Array.from({length:5001},(_,i) => entry(i))).length,5000);
  const original = entry(); const track = m.asTrack(original, path => 'asset:' + path);
  assert.equal(track.id,original.id); assert.equal(track.duration_ms,179000); assert.equal(track.album_title,'Album');
  assert.equal(m.asTrack(entry(1,{artist:'',durationMs:0,coverPath:'C:\\cover.png'}), path=>'asset:'+path).cover_url,'asset:C:\\cover.png');
});

test('saved smart playlists are validated, bounded and survive a JSON round trip', () => {
  const base = {id:'one',title:'Давно не слушал',createdAt:100,rule:{kind:'unplayed',days:30}};
  assert.deepEqual(m.parseSmart(JSON.stringify([base])),[base]);
  assert.deepEqual(m.parseSmart('{broken'),[]);
  assert.deepEqual(m.parseSmart(JSON.stringify([null,{...base,title:''},{...base,rule:{kind:'recent',days:-1}},{...base,rule:{kind:'short',seconds:0}}])),[]);
  assert.equal(m.normalizeSmart([base,base]).length,1);
  assert.equal(m.normalizeSmart(Array.from({length:65},(_,i)=>({...base,id:String(i)}))).length,64);
  assert.equal(m.ruleLabel({kind:'short',seconds:180}),'Короче 3 мин');
});

test('smart rules use real listening history, ignore future/corrupt data and handle exact time boundaries', () => {
  const now = Date.UTC(2026,10,2); const day = 86400000;
  const row = entry(1,{addedAt:now-day*5});
  const unplayed = {kind:'unplayed',days:30};
  assert.equal(m.smartMatches(row,unplayed,[],now),true);
  assert.equal(m.smartMatches(row,unplayed,[{id:row.id,at:now-day*29,seconds:20}],now),false);
  assert.equal(m.smartMatches(row,unplayed,[{id:row.id,at:now-day*30,seconds:20}],now),false);
  assert.equal(m.smartMatches(row,unplayed,[{id:row.id,at:now-day*30-1,seconds:200}],now),true);
  assert.equal(m.smartMatches(row,unplayed,[null,{id:row.id,at:now+1,seconds:200},{id:row.id,at:now,seconds:19}],now),true);
  assert.equal(m.smartMatches(row,{kind:'recent',days:7},[],now),true);
  assert.equal(m.smartMatches(entry(1,{addedAt:now+1}),{kind:'recent',days:7},[],now),false);
  assert.equal(m.smartMatches(row,{kind:'short',seconds:180},[],now),true);
  assert.equal(m.smartMatches(entry(1,{durationMs:180000}),{kind:'short',seconds:180},[],now),false);
  assert.equal(m.smartMatches(entry(1,{durationMs:0}),{kind:'short',seconds:180},[],now),false);
});

test('analysis sort places missing metrics last and proximity follows the chosen current track', () => {
  const original = [entry(1,{analysis:analysis(90,.2)}),entry(2),entry(3,{analysis:analysis(125,.8)}),entry(4,{analysis:analysis(115,.6)})];
  const ids = rows => rows.map(row=>row.id);
  assert.deepEqual(ids(m.sortLocal(original,'bpm')),[id(1),id(4),id(3),id(2)]);
  assert.deepEqual(ids(m.sortLocal(original,'energy')),[id(3),id(4),id(1),id(2)]);
  assert.deepEqual(ids(m.sortLocal(original,'near-tempo',entry(10,{analysis:analysis(120,.75)}))),[id(3),id(4),id(1),id(2)]);
  assert.deepEqual(ids(m.sortLocal(original,'near-energy',entry(10,{analysis:analysis(120,.75)}))),[id(3),id(4),id(1),id(2)]);
  assert.deepEqual(ids(original),[id(1),id(2),id(3),id(4)]);
});

test('offline index matches metadata, saved lyric fragments, transliteration and keyboard layout without requests', () => {
  const documents = [
    {id:id(1),title:'Звёзды',artist:'Серега Пират',album:'Ночь',lyrics:'[00:03.00]На холодной земле\nСнова поём',local:true,track:null},
    {id:'online',title:'Déjà Vu',artist:'Artist',album:'',lyrics:'Hold the line',local:false,track:null},
  ];
  const index = m.buildSearchIndex(documents);
  assert.equal(m.searchIndex(index,'серега')[0].document.id,id(1));
  assert.equal(m.searchIndex(index,'serega')[0].document.id,id(1));
  assert.equal(m.searchIndex(index,'cthtuf')[0].document.id,id(1));
  assert.equal(m.searchIndex(index,'cnhjrf').length,0);
  assert.equal(m.searchIndex(index,'ghbdfn').length,0);
  const hit = m.searchIndex(index,'холодной земле')[0];
  assert.equal(hit.inLyrics,true); assert.equal(hit.snippet,'На холодной земле');
  assert.equal(m.searchIndex(index,'deja vu')[0].document.id,'online');
  assert.equal(m.searchIndex(index,'pjtpds').length,0);
  assert.equal(m.searchIndex(index,'серега пират')[0].document.id,id(1));
  assert.deepEqual(m.searchIndex(index,' '),[]);
});

test('existing cache texts are searchable when some cache entries are broken or lack track metadata', () => {
  const storage = new MemoryStorage();
  const track = m.asTrack(entry(1), path=>path);
  storage.setItem('mashiro.cache.liked.tracks',JSON.stringify({data:[track]}));
  storage.setItem('mashiro.cache.lyrics.'+track.id,JSON.stringify({data:{track_id:track.id,lines:[{time_ms:0,text:'Saved words'},null]}}));
  storage.setItem('mashiro.cache.lyrics.unknown',JSON.stringify({data:{track_id:'unknown',lines:[{text:'Rare phrase'}]}}));
  storage.setItem('mashiro.cache.lyrics.broken','{broken');
  storage.setItem('other-private-key',JSON.stringify({data:{track_id:'other',lines:[{text:'Never indexed'}]}}));
  const result = m.savedTextDocuments(storage);
  assert.equal(result.length,2); assert.equal(result.find(row=>row.id===track.id).title,track.title);
  assert.equal(result.find(row=>row.id==='unknown').track,null);
  assert.equal(m.searchDocuments(result,'rare')[0].document.id,'unknown');
  assert.equal(m.searchDocuments(result,'never indexed').length,0);
});

test('local lyrics parse plain text, repeated LRC timestamps, fractional seconds and a timed zero line', () => {
  assert.equal(m.parseLocalLyrics(id(1),'[ti:track]\n[ar:artist]'),null);
  const plain = m.parseLocalLyrics(id(1),'First line\n\nSecond line');
  assert.equal(plain.synced,false); assert.equal(plain.lines.length,2);
  const timed = m.parseLocalLyrics(id(1),'[ti:track]\n[01:02.5][00:03.25]Words\n[00:00.000]First');
  assert.equal(timed.synced,true); assert.deepEqual(timed.lines.map(row=>row.time_ms),[0,3250,62500]);
  assert.equal(m.parseLocalLyrics(id(1),'[00:00]Start').synced,true);
});

test('an identification candidate fills only a draft and preserves existing fields omitted by the service', () => {
  const form = {title:'Unknown',artist:'Original artist',album:'Original album',genre:'Rock',year:2000,trackNumber:4,lyrics:'Saved lyrics',coverBase64:null,removeCover:false};
  const before = structuredClone(form);
  const draft = m.identificationDraft(form,{recordingId:'recording',title:' Recognized title ',artist:'New artist',album:'',score:.97});
  assert.equal(draft.title,'Recognized title'); assert.equal(draft.artist,'New artist'); assert.equal(draft.album,'Original album');
  assert.equal(draft.genre,'Rock'); assert.equal(draft.year,2000); assert.equal(draft.lyrics,'Saved lyrics');
  assert.deepEqual(form,before); assert.notEqual(draft,form);
});

test('smart-playlist storage failure never reports a saved playlist and analysis stops after the active file', async () => {
  const pinia = await import('pinia'); const vue = await import('vue');
  globalThis.__libraryVue = vue; globalThis.__libraryPinia = pinia;
  const storage = new MemoryStorage(); globalThis.localStorage = storage;
  const player = {current:null,queue:[],sourceQueue:[],playQueue:async()=>{}};
  const stats = {events:[]}; globalThis.__libraryPlayer = player; globalThis.__libraryStats = stats;
  let release; let calls = [];
  globalThis.__libraryInvoke = async (command,args) => {
    calls.push([command,args]);
    if (command==='library_catalog') return [entry(1),entry(2)];
    if (command==='library_analyze') { await new Promise(resolve=>{release=resolve;}); return entry(args.id===id(1)?1:2,{analysis:analysis()}); }
    if (command==='library_identify') return [{recordingId:'recording',title:'Recognized',artist:'Other',album:'',score:.9}];
    throw new Error('Disk unavailable');
  };
  const storeSource = (await readFile(new URL('../src/stores/libraryTools.ts',import.meta.url),'utf8'))
    .replace("import { defineStore } from 'pinia';",'const {defineStore}=globalThis.__libraryPinia;')
    .replace("import { computed, ref } from 'vue';",'const {computed,ref}=globalThis.__libraryVue;')
    .replace("import { convertFileSrc, invoke } from '@tauri-apps/api/core';",'const convertFileSrc=p=>p; const invoke=globalThis.__libraryInvoke;')
    .replace("import { usePlayerStore } from '@/stores/player';",'const usePlayerStore=()=>globalThis.__libraryPlayer;')
    .replace("import { useStatsStore } from '@/stores/stats';",'const useStatsStore=()=>globalThis.__libraryStats;')
    .replace("'@/lib/libraryTools/model'",JSON.stringify(modelUrl));
  pinia.setActivePinia(pinia.createPinia());
  const {useLibraryToolsStore} = await import(url(storeSource));
  const store = useLibraryToolsStore(); await store.init();
  storage.setItem = ()=>{throw new Error('Quota');};
  assert.equal(store.savePlaylist('Test',{kind:'short',seconds:180}),false);
  assert.equal(store.playlists.length,0); assert.match(store.error,/сохранить/);
  const run = store.analyze(); await new Promise(resolve=>setImmediate(resolve));
  assert.equal(store.analyzing,true); store.stopping = true; release(); await run;
  assert.equal(store.analysisDone,1); assert.equal(store.analyzing,false); assert.equal(store.entries[0].analysis.bpm,120);
  assert.equal(calls.filter(([command])=>command==='library_analyze').length,1);
  assert.equal(calls.filter(([command])=>command==='library_identify').length,0);
  await assert.rejects(store.identify(id(1),''),/ключ/);
  assert.equal(calls.filter(([command])=>command==='library_identify').length,0);
  const catalogBefore = structuredClone(JSON.parse(JSON.stringify(store.entries)));
  const candidate = await store.identify(id(1),'only-memory-client-key');
  assert.equal(candidate[0].title,'Recognized'); assert.deepEqual(JSON.parse(JSON.stringify(store.entries)),catalogBefore);
  assert.equal(JSON.stringify(store.$state).includes('only-memory-client-key'),false);
  assert.equal([...storage.values.values()].some(value=>value.includes('only-memory-client-key')),false);
  assert.equal(calls.filter(([command])=>command==='library_analyze').length,1);
  await store.remove(id(1)); assert.equal(store.entries.length,2); assert.match(store.error,/Disk unavailable/);
  store.$dispose();
});
