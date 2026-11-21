import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import ts from 'typescript';
const code=ts.transpileModule(await fs.readFile(new URL('../src/stores/ui/proceduralPresets.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {upgradeMetalPreset}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const old=()=>({metalAccent:'#dfbe72',liquidIntensity:70,metalContrast:130,metalDepth:100,metalSpeed:28,metalSeed:641});
test('saved stock palette upgrades once, custom settings survive',()=>{const p=old();upgradeMetalPreset(p);assert.equal(p.metalAccent,'#e9a52a');const upgraded={...p};upgradeMetalPreset(p);assert.deepEqual(p,upgraded);const custom={...old(),metalSpeed:99};upgradeMetalPreset(custom);assert.deepEqual(custom,{...old(),metalSpeed:99})});
