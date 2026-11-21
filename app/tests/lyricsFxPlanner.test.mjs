import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../src/lib/lyricsFx/planner.ts',import.meta.url),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {planAccents,sourceFingerprint}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const words=Array.from({length:9},(_,i)=>({id:`w${i}`,text:'Акцент',startMs:1000+i*9000,endMs:1600+i*9000,lineId:`l${i}`}));
const candidates=words.map((word,i)=>({wordId:word.id,type:i%2?'impact':'blood',score:.9-i*.02,reason:'Смысл фразы'}));
const music={durationMs:90000,method:'spectral-flux+bass-pulse-v1',landmarks:words.map(word=>({timeMs:word.startMs+50,strength:.8,beatStrength:.8}))};
test('context and spectral/rhythmic evidence are both required',()=>{
 assert.deepEqual(planAccents(words,[],music,'track'),[]);
 assert.deepEqual(planAccents(words,candidates,null,'track'),[]);
 assert.deepEqual(planAccents(words,candidates,{...music,landmarks:music.landmarks.map(p=>({...p,strength:.4,beatStrength:0}))},'track'),[]);
 assert.ok(planAccents(words,candidates,{...music,landmarks:music.landmarks.map(p=>({...p,beatStrength:0}))},'track').length>0);
 assert.ok(planAccents(words,candidates,music,'track').length>0);
});
test('events stay inside selected words, use both types and respect rarity',()=>{
 const result=planAccents(words,candidates,music,'track');
 assert.deepEqual(new Set(result.map(e=>e.type)),new Set(['blood','impact']));
 assert.ok(result.every(e=>{const w=words.find(w=>w.id===e.wordId);return e.startMs>=w.startMs&&e.startMs<=w.endMs}));
 for(let i=1;i<result.length;i++) assert.ok(result[i].startMs-result[i-1].startMs>=8000);
 for(let i=0;i+3<result.length;i++) assert.ok(result[i+3].startMs-result[i].startMs>=60000);
});
test('source and word bind deterministic seeds, stale or zero spans never animate',()=>{
 const a=planAccents(words,candidates,music,'a'),b=planAccents(words,candidates,music,'b');
 assert.deepEqual(a,planAccents(words,candidates,music,'a'));
 assert.notEqual(a[0].seed,b[0].seed);
 assert.deepEqual(planAccents(words,[{...candidates[0],wordId:'foreign'}],music,'a'),[]);
 assert.deepEqual(planAccents(words.map(w=>({...w,endMs:w.startMs})),candidates,music,'a'),[]);
});
test('signed URLs do not leak into source keys or invalidate identical content',()=>{
 assert.equal(sourceFingerprint('https://cdn.example/song.mp3?token=one'),sourceFingerprint('https://cdn.example/song.mp3?token=two'));
 assert.notEqual(sourceFingerprint('https://cdn.example/song.mp3'),sourceFingerprint('https://cdn.example/other.mp3'));
 assert.equal(sourceFingerprint('http://ymstream.localhost/https%3A%2F%2Fcdn.example%2Fsong.mp3%3Ftoken%3Done'),sourceFingerprint('https://cdn.example/song.mp3?token=two'));
});
