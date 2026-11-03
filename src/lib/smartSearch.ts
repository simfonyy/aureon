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
const editionWords = /\b(?:live|remix|remixed|mix|acoustic|instrumental|demo|cover|remaster(?:ed)?|radio\s+edit|extended|sped\s+up|speed\s+up|slowed|reverb)\b|(?:ремикс|акустик|концерт|лайв|ускоренн|замедленн|инструментал|минусовк)/iu;
function withoutTranslation(value:string):string {
  const base = value.replace(/\([^)]*\)|\[[^\]]*\]/g, '');
  return value.replace(/\(([^)]*)\)|\[([^\]]*)\]/g, (whole, round:string|undefined, square:string|undefined) => {
    const note = round ?? square ?? '';
    // Genius often adds a Latin translation to a Russian title/artist. A live,
    // remix or other edition label is part of the identity, not a translation.
    if (editionWords.test(note)) return whole;
    const translated = /[а-яё]/iu.test(base) && /[a-z]/iu.test(note) && !/[а-яё]/iu.test(note)
      || /[a-z]/iu.test(base) && /[а-яё]/iu.test(note) && !/[a-z]/iu.test(note);
    return translated ? '' : whole;
  }).trim();
}
function edition(value:string):string[] {
  const n = normalize(value);
  const groups:Array<[string,RegExp]> = [
    ['live', /\blive\b|лайв|концерт/u], ['remix', /\b(?:remix|remixed|mix)\b|ремикс/u],
    ['acoustic', /\bacoustic\b|акустик/u], ['instrumental', /\binstrumental\b|инструментал|минусовк/u],
    ['demo', /\bdemo\b|демо/u], ['cover', /\bcover\b|кавер/u],
    ['remaster', /\bremaster(?:ed)?\b|ремастер/u], ['edit', /\bradio edit\b|\bextended\b/u],
    ['sped', /\b(?:sped|speed) up\b|ускоренн/u], ['slowed', /\bslowed\b|замедленн/u],
    ['reverb', /\breverb\b/u],
  ];
  return groups.filter(([,pattern])=>pattern.test(n)).map(([name])=>name);
}
function spellingScore(wanted:string, candidate:string):number {
  const forms=queryVariants(candidate).slice(0,2);
  return Math.max(0,...queryVariants(wanted).flatMap((variant,index)=>forms.map((form,formIndex)=>similarity(variant,form)-(index+formIndex)*0.008)));
}
function artistParts(value:string):string[] {
  return withoutTranslation(value).split(/\s+(?:feat(?:uring)?|ft|with|and|и)\.?\s+|\s*[,;&×]\s*|\s+x\s+/iu).map(name=>name.trim()).filter(Boolean);
}
function artistScore(wanted:string, artists:Track['artists']):number {
  if (!artists.length) return 0;
  const names = artists.map(artist=>withoutTranslation(artist.name));
  const full = Math.max(...names.map(name=>spellingScore(withoutTranslation(wanted),name)), spellingScore(withoutTranslation(wanted),names.join(' ')));
  const parts = artistParts(wanted);
  if (parts.length <= 1) return full;
  const scores = parts.map(part=>Math.max(...names.map(name=>spellingScore(part,name))));
  if (scores.some(score=>score < 0.72)) return full;
  return Math.max(full,scores.reduce((sum,score)=>sum+score,0)/scores.length);
}
export function matchTrack(song:LyricSearchHit['song'],tracks:Track[]):Track|null {
  const title = withoutTranslation(song.title), wantedEdition = edition(title).join('|');
  const matches=tracks.filter(track=>track.available && edition(track.title).join('|')===wantedEdition).map((track,index)=>({track,index,
    title:Math.min(spellingScore(title,withoutTranslation(track.title)),phraseScore(queryVariants(title.replace(/['’]/gu,'')),withoutTranslation(track.title).replace(/['’]/gu,''))),
    artist:artistScore(song.artist,track.artists),
  })).filter(item=>item.title>=0.82 && item.artist>=0.72)
    .sort((a,b)=>(b.title+b.artist)-(a.title+a.artist) || a.index-b.index);
  return matches[0]?.track ?? null;
}

interface RankedLyric { hit:LyricSearchHit; score:number; order:number }
function phraseScore(queries:string[],fragment:string):number {
  const plain=normalize(fragment);
  const original=normalize(queries[0]??'');
  if(original && ` ${plain} `.includes(` ${original} `)) return 1;
  // Cyrillic й/ы and э/е have several Latin spellings. Comparing the native
  // fragment in Latin too avoids choosing one irreversible reverse spelling.
  const forms=[...new Set([plain,...(/[a-z]/iu.test(queries[0]??'') && /[а-яё]/iu.test(plain)?[normalize(transliterate(plain))]:[])])];
  const cache=new Map<string,number>();
  let best=0;
  forms.forEach((form,formIndex)=>{
    const words=form.split(' ').filter(Boolean).slice(0,80);
    queries.forEach((query,variant)=>{
      const wanted=normalize(query).split(' ').filter(Boolean).slice(0,32), count=wanted.length, phrase=wanted.join(' ');
      if (!count || words.length < count) return;
      const weights=wanted.map(word=>Math.max(0.35,Math.min(1,word.length/5)));
      const total=weights.reduce((sum,weight)=>sum+weight,0);
      for(let start=0;start<=words.length-count;start++) {
        for(let length=count;length<=count+2 && start+length<=words.length;length++) {
          const window=words.slice(start,start+length);
          if(window.join(' ')===phrase) { best=Math.max(best,1-variant*0.025-formIndex*0.015); continue; }
          const pairs:Array<{q:number;w:number;score:number}>=[];
          for(let q=0;q<count;q++) for(let w=0;w<window.length;w++) {
            const left=wanted[q]!,right=window[w]!, key=`${left}\0${right}`;
            let score=cache.get(key);
            if(score===undefined) { score=left===right?1:left.length<=2?0:similarity(left,right); cache.set(key,score); }
            if(score >= (left.length===3?0.66:0.7)) pairs.push({q,w,score});
          }
          pairs.sort((a,b)=>b.score-a.score || a.q-b.q || a.w-b.w);
          const chosen=new Map<number,{w:number;score:number}>(),used=new Set<number>();
          for(const pair of pairs) if(!chosen.has(pair.q) && !used.has(pair.w)) { chosen.set(pair.q,pair); used.add(pair.w); }
          if(chosen.size < (count<=2?count:Math.ceil(count*0.75))) continue;
          let score=0,previous=-1,reordered=false;
          for(let q=0;q<count;q++) {
            const pair=chosen.get(q);
            if(!pair) continue;
            score+=pair.score*weights[q]!/total;
            if(pair.w<previous) reordered=true;
            previous=pair.w;
          }
          score-=(reordered?0.12:0)+(length-count)*0.025+variant*0.025+formIndex*0.015;
          best=Math.max(best,score);
        }
      }
    });
  });
  return best;
}

export async function lyricSearch(query:string,api:SearchApi,current=()=>true):Promise<LyricMatch[]> {
  const variants=queryVariants(query).slice(0,3);
  if(!current() || !normalize(query) || !variants.length) return [];
  const replies:Array<LyricSearchHit[]|undefined>=[];
  let successful=0;
  const searchSource=async(value:string,index:number)=>{
    if(!current()) return;
    try { const hits=await bounded(api.searchLyrics(value)); if(current()) { successful++;replies[index]=hits; } }
    catch { /* Another spelling may still have a usable reply. */ }
  };
  await searchSource(variants[0]!,0);
  if(!current()) return [];
  await Promise.all(variants.slice(1).map((value,index)=>searchSource(value,index+1)));
  if(!current()) return [];
  if(!successful) throw new Error('Не удалось выполнить поиск по тексту. Попробуй ещё раз.');
  const count=normalize(query).split(' ').length, threshold=count>=3?0.65:count===2?0.62:0.72;
  const ranked=replies.flatMap(hits=>hits??[]).slice(0,24).map((hit,order)=>({hit,order,score:phraseScore(variants,hit.fragment)}))
    .filter(item=>item.score>=threshold).sort((a,b)=>b.score-a.score || a.order-b.order);
  // Keep the first/best fragment. Constructing a Map from sorted entries would
  // overwrite it with a weaker fragment of the same Genius song.
  const bestSongs=new Map<number,RankedLyric>();
  for(const item of ranked) if(!bestSongs.has(item.hit.song.id)) bestSongs.set(item.hit.song.id,item);
  const candidates=[...bestSongs.values()].slice(0,8);
  const catalogCache=new Map<string,Promise<SearchResult|null>>();
  function catalog(value:string):Promise<SearchResult|null> {
    const key=normalize(value),cached=catalogCache.get(key);
    if(cached) return cached;
    if(!current()) return Promise.resolve(null);
    const request=(async()=>{ try { return await bounded(api.search(value)); } catch { return null; } })();
    if(catalogCache.size<24) catalogCache.set(key,request);
    return request;
  }
  async function resolve(item:RankedLyric):Promise<LyricMatch> {
    const song=item.hit.song, artist=withoutTranslation(song.artist),title=withoutTranslation(song.title);
    const queries=[`${artist} ${title}`,queryVariants(`${artist} ${title}`)[1],title]
      .filter((value,index,all):value is string=>Boolean(value?.trim()) && all.findIndex(other=>other && normalize(other)===normalize(value!))===index);
    let failed=true;
    for(const value of queries) {
      if(!current()) break;
      const found=await catalog(value);
      if(!current()) break;
      if(!found) continue;
      failed=false;
      const track=matchTrack(song,found.tracks);
      if(track) return {...item.hit,track,lookupFailed:false};
    }
    return {...item.hit,track:null,lookupFailed:failed};
  }
  const results:Array<{item:RankedLyric;match:LyricMatch}>=[];
  let next=0;
  await Promise.all(Array.from({length:Math.min(3,candidates.length)},async()=>{
    while(current()) {
      const item=candidates[next++];
      if(!item) return;
      results.push({item,match:await resolve(item)});
    }
  }));
  if(!current()) return [];
  results.sort((a,b)=>Number(Boolean(b.match.track))-Number(Boolean(a.match.track)) || b.item.score-a.item.score || a.item.order-b.item.order);
  const seen=new Set<string>();
  return results.flatMap(({match})=>{
    const id=match.track ? `track:${match.track.id.replace(/^(\d+):\d+$/,'$1')}` : `song:${match.song.id}`;
    if(seen.has(id)) return [];
    seen.add(id);return [match];
  }).slice(0,6);
}
