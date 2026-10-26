import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
async function load(path) {
 const code=ts.transpileModule(await readFile(new URL(path,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
 return import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
}
const {restoreBackgroundMode}=await load('../src/stores/ui/persistence.ts');
const {readSchedule,shouldCheck,UPDATE_SNOOZE,UPDATE_INTERVAL}=await load('../src/lib/updateSchedule.ts');
const {spectrumBands,smoothSpectrum}=await load('../src/lib/spectrum.ts');
test('old static backgrounds become matte; live and custom appearance choices persist',()=>{
 assert.equal(restoreBackgroundMode({metalRenderer:'css',theme:'plum'}),'matte');
 assert.equal(restoreBackgroundMode({metalRenderer:'webgl',liquidMetal:true}),'beauty');
 assert.equal(restoreBackgroundMode({metalRenderer:'webgl',theme:'matte'}),'matte');
 assert.equal(restoreBackgroundMode({backgroundMode:'matte',metalRenderer:'webgl'}),'matte');
 assert.equal(restoreBackgroundMode(null),'matte');
});
test('update dismissal survives restart for exactly two days and checks are throttled',()=>{
 const now=1800000000000;
 const deferred=JSON.parse(JSON.stringify({checkedAt:now,remindAt:now+UPDATE_SNOOZE}));
 const restored=readSchedule(deferred,now+86400000);
 assert.equal(shouldCheck(restored,now+UPDATE_SNOOZE-1),false);
 assert.equal(shouldCheck(restored,now+UPDATE_SNOOZE),true);
 assert.equal(shouldCheck({checkedAt:now,remindAt:0},now+UPDATE_INTERVAL-1),false);
 assert.equal(shouldCheck({checkedAt:now,remindAt:0},now+UPDATE_INTERVAL),true);
 assert.deepEqual(readSchedule({checkedAt:now+1,remindAt:'bad'},now),{checkedAt:0,remindAt:0});
});
test('spectrum responds to bass, vocals and high frequencies without inventing sound',()=>{
 for(const hz of [80,440,2500,10000]) {
  const data=new Uint8Array(1024), output=new Float32Array(56);
  data[Math.round(hz/(48000/2048))]=160;
  spectrumBands(data,48000,output);
  assert.ok(Math.max(...output)>.25,'frequency '+hz+' is visible');
  assert.ok(output.filter(v=>v>0).length<15,'narrow signal stays localized');
 }
 const result=spectrumBands(new Uint8Array(1024),48000,new Float32Array(56));
 assert.ok(result.every(v=>v===0));
 assert.ok(spectrumBands(null,48000,new Float32Array(56).fill(1)).every(v=>v===0));
 assert.ok(smoothSpectrum(0,1,1/30)>.7);
 let level=1;for(let i=0;i<30;i++)level=smoothSpectrum(level,0,1/30);
 assert.ok(level<.002,'pause clears quickly without a jump');
});


const {playerMetaLimit}=await load('../src/lib/playerSizing.ts');
test('player metadata controls stay within the actual responsive layout',()=>{
 assert.equal(playerMetaLimit(818),294);
 assert.equal(playerMetaLimit(1800),460);
 assert.equal(playerMetaLimit(300),150);
 assert.ok(playerMetaLimit(900)<playerMetaLimit(1100));
});
