import type { SearchResult, Track, LyricSearchHit } from '@/api/types';

const latin = ['shch','sch','yo','zh','kh','ts','ch','sh','yu','ya','ye','a','b','v','g','d','e','z','i','j','k','l','m','n','o','p','r','s','t','u','f','h','c','y','w','x'];
const cyrillic = ['щ','щ','е','ж','х','ц','ч','ш','ю','я','е','а','б','в','г','д','е','з','и','й','к','л','м','н','о','п','р','с','т','у','ф','х','к','ы','в','кс'];
const reverse: Record<string, string> = { а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'y',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'ts',ч:'ch',ш:'sh',щ:'shch',ы:'y',э:'e',ю:'yu',я:'ya',ь:'',ъ:'' };
export function normalize(value: string): string {
  return value.toLowerCase().replace(/ё/g,'е').replace(/[^\p{L}\p{N}]+/gu,' ').trim().replace(/\s+/g,' ');
}
function transliterate(value: string): string {
  return /[а-яё]/i.test(value)
    ? [...value].map(c => reverse[c] ?? c).join('')
    : value.replace(new RegExp(latin.join('|'),'g'), c => cyrillic[latin.indexOf(c)]!);
}
export function queryVariants(value: string): string[] {
  const q = value.trim().toLowerCase().slice(0,240);
  const en = "qwertyuiop[]asdfghjkl;'zxcvbnm,.`", ru = 'йцукенгшщзхъфывапролджэячсмитьбюё';
  const from = /[а-яё]/i.test(q) ? ru : en, to = from === ru ? en : ru;
  const layout = [...q].map(c => from.includes(c) ? to[from.indexOf(c)] : c).join('');
  return [...new Set([q, transliterate(q), layout].filter(v => v.trim()))];
}
// Optimal string alignment includes adjacent swapped letters (приат → пират).
export function similarity(a: string, b: string): number {
  a = normalize(a); b = normalize(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const rows = Array.from({length:a.length+1}, () => Array<number>(b.length+1).fill(0));
  for (let i=0;i<=a.length;i++) rows[i]![0]=i;
  for (let j=0;j<=b.length;j++) rows[0]![j]=j;
  for(let i=1;i<=a.length;i++) for(let j=1;j<=b.length;j++) {
    rows[i]![j]=Math.min(rows[i-1]![j]!+1, rows[i]![j-1]!+1, rows[i-1]![j-1]!+(a[i-1]===b[j-1]?0:1));
    if(i>1 && j>1 && a[i-1]===b[j-2] && a[i-2]===b[j-1]) rows[i]![j]=Math.min(rows[i]![j]!,rows[i-2]![j-2]!+1);
  }
  return 1-rows[a.length]![b.length]!/Math.max(a.length,b.length);
}
function relevance(q: string, label: string): number {
  const n=normalize(label), query=normalize(q);
  return n.includes(query) ? 0.95 + (n===query ? 0.05 : 0) : similarity(query,n);
}
export async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try { return await Promise.race([promise,new Promise<T>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Поиск не ответил вовремя')),16000);})]); }
  finally { clearTimeout(timer!); }
}
export interface SearchApi {
  search(query:string):Promise<SearchResult>;
  searchSuggest(query:string):Promise<string[]>;
  searchLyrics(query:string):Promise<LyricSearchHit[]>;
}
const empty = ():SearchResult => ({tracks:[],artists:[],albums:[]});
export async function smartCatalog(query:string, api:SearchApi, current=()=>true) {
  const variants=queryVariants(query);
  const replies=await Promise.allSettled(variants.map(q=>bounded(api.search(q))));
  if(!current()) return {result:empty(), alternatives:[] as string[]};
  const successful=replies.flatMap(r=>r.status==='fulfilled'?[r.value]:[]);
  if(!successful.length) throw new Error('Не удалось выполнить поиск. Проверь подключение и попробуй ещё раз.');
  const names=successful.flatMap(r=>[...r.artists.map(a=>a.name),...r.tracks.map(t=>t.title)]);
  // Prefix suggestions supply candidates when the last word has a typo.
  const hints=await Promise.allSettled([query, variants[1], query.trim().split(/\s+/)[0]].filter((q,i,a):q is string=>!!q && a.indexOf(q)===i).map(q=>bounded(api.searchSuggest(q))));
  if(!current()) return {result:empty(),alternatives:[] as string[]};
  const candidates=[...new Set([...names,...hints.flatMap(r=>r.status==='fulfilled'?r.value:[])])]
    .map(label=>({label,score:Math.max(...variants.map(q=>similarity(q,label)))}))
    .filter(c=>c.score>=0.72 && !variants.some(q=>normalize(q)===normalize(c.label)))
    .sort((a,b)=>b.score-a.score).slice(0,2);
  const extra=await Promise.allSettled(candidates.map(c=>bounded(api.search(c.label))));
  successful.push(...extra.flatMap(r=>r.status==='fulfilled'?[r.value]:[]));
  const queries=[...variants,...candidates.map(c=>c.label)];
  function merge<T extends {id:string}>(items:T[],label:(t:T)=>string):T[] {
    return [...new Map(items.map(t=>[t.id,t])).values()].sort((a,b)=>Math.max(...queries.map(q=>relevance(q,label(b))))-Math.max(...queries.map(q=>relevance(q,label(a)))));
  }
  return {result:{
    tracks:merge(successful.flatMap(r=>r.tracks),t=>`${t.title} ${t.artists.map(a=>a.name).join(' ')}`).slice(0,60),
    artists:merge(successful.flatMap(r=>r.artists),a=>a.name).slice(0,12),
    albums:merge(successful.flatMap(r=>r.albums),a=>a.title).slice(0,12),
  },alternatives:candidates.map(c=>c.label)};
}
export interface LyricMatch extends LyricSearchHit { track:Track|null; lookupFailed:boolean }
function withoutTranslation(value:string):string { return value.replace(/\([^)]*\)|\[[^\]]*\]/g,'').trim(); }
export function matchTrack(song:LyricSearchHit['song'],tracks:Track[]):Track|null {
  const title=normalize(withoutTranslation(song.title));
  const matches=tracks.filter(t=>t.available).map(track=>({track,
    title:similarity(title,withoutTranslation(track.title)),
    artist:Math.max(0,...track.artists.map(a=>Math.max(...queryVariants(withoutTranslation(song.artist)).map(v=>similarity(v,withoutTranslation(a.name))))))
  })).filter(t=>t.title>=0.82 && t.artist>=0.72).sort((a,b)=>(b.title+b.artist)-(a.title+a.artist));
  return matches[0]?.track ?? null;
}
export async function lyricSearch(query:string,api:SearchApi,current=()=>true):Promise<LyricMatch[]> {
  let hits=await bounded(api.searchLyrics(query));
  // Latin fragments can return unrelated English hits; also check their Russian spelling.
  const variants=queryVariants(query);
  if((!hits.length || /^[a-z\s\p{P}]+$/iu.test(query)) && current()) {
    const fallback=await Promise.allSettled(queryVariants(query).slice(1).map(q=>bounded(api.searchLyrics(q))));
    hits.push(...fallback.flatMap(r=>r.status==='fulfilled'?r.value:[]));
  }
  if(!current()) return [];
  function fragmentScore(fragment:string):number {
    const words=normalize(fragment).split(' ');
    return Math.max(0,...variants.map(v=>{
      const count=normalize(v).split(' ').length;
      let best=0;
      for(let i=0;i<words.length;i++) best=Math.max(best,similarity(v,words.slice(i,i+count).join(' ')));
      return best;
    }));
  }
  hits.sort((a,b)=>fragmentScore(b.fragment)-fragmentScore(a.fragment));
  hits=[...new Map(hits.map(h=>[h.song.id,h])).values()].slice(0,6);
  const results:LyricMatch[]=[];
  for(let i=0;i<hits.length && current();i+=2) {
    results.push(...await Promise.all(hits.slice(i,i+2).map(async hit=>{
      try { const found=await bounded(api.search(`${withoutTranslation(hit.song.artist)} ${withoutTranslation(hit.song.title)}`));
        return {...hit,track:matchTrack(hit.song,found.tracks),lookupFailed:false};
      } catch { return {...hit,track:null,lookupFailed:true}; }
    })));
  }
  return results;
}
