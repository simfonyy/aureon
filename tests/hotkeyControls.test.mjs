import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(new URL('../src/lib/hotkeys/keys.ts', import.meta.url), 'utf8');
const code = ts.transpileModule(source, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const keys = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
globalThis.hotkeyControlFixture = { ...keys, listen:async()=>()=>{}, createLogger:()=>({warn(){}}), HOTKEYS:[] };
const runtimeSource = (await readFile(new URL('../src/lib/hotkeys/runtime.ts', import.meta.url),'utf8'))
  .replace(/import type[^;]+;/g,'')
  .replace(/import\s*\{([^}]+)\}\s*from\s*['"][^'"]+['"];?/g,(_,names)=>`const {${names}} = globalThis.hotkeyControlFixture;`);
const runtimeCode = ts.transpileModule(runtimeSource,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const runtime = await import(`data:text/javascript;base64,${Buffer.from(runtimeCode).toString('base64')}`);
test('capture hotkeys leave native button activation alone but retain playback shortcuts elsewhere',()=>{
  let handler, plays=0;
  globalThis.window={addEventListener:(name,fn)=>{handler=fn;},removeEventListener:()=>{}};
  runtime.bindLocalHotkeys(()=> 'togglePlay',{togglePlay:()=>plays++});
  function press(code,key,onButton,extra={}) {
    let prevented=false;
    handler({code,key,target:{tagName:onButton?'BUTTON':'DIV',closest:selector=>onButton && selector.startsWith('button,')?{}:null},preventDefault(){prevented=true;},stopPropagation(){},...extra});
    return prevented;
  }
  assert.equal(press('Space',' ',true),false);
  assert.equal(press('Enter','Enter',true),false);
  assert.equal(plays,0);
  assert.equal(press('Space',' ',false),true);
  assert.equal(plays,1);
  assert.equal(press('Space',' ',true,{ctrlKey:true}),true);
  assert.equal(plays,2);
  runtime.unbindLocalHotkeys();
});
