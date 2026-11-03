import type { FxEvent, FxWord } from './rendererTypes';
import type { MusicAnalysis } from './music';

export interface FxCandidate { wordId:string; type:'blood'|'impact'; score:number; reason:string }
export interface FxDocument { transcript:string; words:FxWord[]; lines:Array<{id:string;wordIds:string[]}> }

export function fingerprint(value:string):string {
  let hash=2166136261;
  for (const char of value) { hash^=char.codePointAt(0)!; hash=Math.imul(hash,16777619); }
  return (hash>>>0).toString(16).padStart(8,'0');
}

/** Credentials and signed query parameters never enter the model cache. */
export function sourceFingerprint(source:string):string {
  let value=source;
  try {
    let url=new URL(value);
    if (url.hostname.endsWith('.localhost') || !['http:','https:','file:'].includes(url.protocol)) {
      const decoded=decodeURIComponent(url.pathname.replace(/^\//,''));
      if (/^(https?|file):/i.test(decoded)) url=new URL(decoded);
    }
    value=`${url.protocol}//${url.host}${url.pathname}`;
  } catch { value=value.split('?')[0]!.split('#')[0]!; }
  return fingerprint(value);
}

export function planAccents(words:FxWord[],candidates:FxCandidate[],music:MusicAnalysis|null,sourceKey:string):FxEvent[] {
  if (!music?.landmarks.length) return [];
  const byId=new Map(words.map(word=>[word.id,word]));
  const pool:Array<FxEvent & { merit:number }>=[];
  for (const candidate of candidates) {
    const word=byId.get(candidate.wordId);
    if (!word || !['blood','impact'].includes(candidate.type) || !Number.isFinite(candidate.score) || candidate.score<.55 || candidate.score>1) continue;
    const length=word.endMs-word.startMs;
    if (length<70 || length>4000) continue;
    const latest=Math.min(word.endMs,word.startMs+300);
    const points=music.landmarks.filter(point=>point.timeMs>=word.startMs-120 && point.timeMs<=latest+100);
    const hit=points.sort((a,b)=> (b.strength*.65+b.beatStrength*.35-Math.abs(b.timeMs-word.startMs)/1800)-(a.strength*.65+a.beatStrength*.35-Math.abs(a.timeMs-word.startMs)/1800))[0];
    // Contextual choice AND a real spectral/rhythmic landmark are required.
    if (!hit || hit.strength<.32 || (hit.beatStrength<.2 && hit.strength<.62)) continue;
    const score=candidate.score*.65+hit.strength*.25+hit.beatStrength*.1;
    const startMs=Math.max(word.startMs,Math.min(latest,hit.timeMs));
    const seed=parseInt(fingerprint(`${sourceKey}|${word.id}|${candidate.type}`),16);
    pool.push({id:`${word.id}-${candidate.type}`,wordId:word.id,type:candidate.type,startMs,
      durationMs:candidate.type==='blood'?2300:720,intensity:Math.min(1,.5+score*.5),seed,
      reason:candidate.reason,merit:score});
  }
  const selected:typeof pool=[];
  for (const candidate of pool.sort((a,b)=>b.merit-a.merit || a.startMs-b.startMs)) {
    if (selected.some(event=>event.wordId===candidate.wordId || Math.abs(event.startMs-candidate.startMs)<8000)) continue;
    const ordered=[...selected,candidate].sort((a,b)=>a.startMs-b.startMs);
    if (ordered.some((event,index)=>ordered[index+3] && ordered[index+3]!.startMs-event.startMs<60000)) continue;
    selected.push(candidate);
  }
  return selected.sort((a,b)=>a.startMs-b.startMs).map(({merit,...event})=>event);
}
