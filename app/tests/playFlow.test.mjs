import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../src/lib/playFlow.ts',import.meta.url),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {withDeadline,playDiagnostic,playbackDiagnostics}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
test('a stuck source fails by deadline and a later source can succeed',async()=>{
 await assert.rejects(withDeadline(new Promise(()=>{}),25,'Поток'),/время ожидания/);
 assert.equal(await withDeadline(Promise.resolve('next-source'),100,'Поток'),'next-source');
});
test('late rejection is consumed after timeout',async()=>{
 await assert.rejects(withDeadline(new Promise((_,reject)=>setTimeout(()=>reject(Error('late')),50)),10,'Поток'));
 await new Promise(resolve=>setTimeout(resolve,70));
});
test('diagnostics stay bounded and contain no stream or token fields',()=>{
 for(let i=0;i<90;i++)playDiagnostic(i,'fixture','select');
 const entries=playbackDiagnostics();assert.equal(entries.length,80);
 assert.deepEqual(Object.keys(entries[0]).sort(),['at','elapsed','request','stage','track']);
});
