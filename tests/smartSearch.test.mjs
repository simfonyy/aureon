import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const source=await readFile(new URL('../src/lib/smartSearch.ts',import.meta.url),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {queryVariants,similarity,smartCatalog,lyricSearch,matchTrack}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const empty=()=>({tracks:[],artists:[],albums:[]});
const track=(id,title,artist)=>({id,title,artists:[{id:'a',name:artist}],available:true});
test('search accepts transliteration, wrong keyboard layout and adjacent typos',()=>{
 assert.ok(queryVariants('serega pirat').includes('серега пират'));
 assert.ok(queryVariants('cthtuf gbhfn').includes('серега пират'));
 assert.ok(queryVariants('руддщ').includes('hello'));
 assert.ok(queryVariants('билли айлиш').includes('billi aylish'));
 assert.ok(similarity('серега приат','Серёга Пират')>0.9);
 assert.ok(similarity('билли айлиш','билли айлиш')>similarity('билли айлиш','другой артист'));
});
test('typo recovery uses nearby suggestions and deduplicates actual results',async()=>{
 const calls=[];
 const api={search:async q=>{calls.push(q);return q==='Серёга Пират'?{...empty(),artists:[{id:'a',name:q}],tracks:[track('1','Трек',q),track('1','Трек',q)]}:empty()},searchSuggest:async()=>['Серёга Пират','Другой исполнитель']};
 const found=await smartCatalog('серега приат',api);
 assert.deepEqual(found.alternatives,['Серёга Пират']);
 assert.equal(found.result.tracks.length,1);
 assert.ok(calls.length<=5);
});
test('catalog failures are distinguished from no matches and obsolete searches stop expanding',async()=>{
 await assert.rejects(()=>smartCatalog('abc',{search:async()=>{throw Error('offline')} }),/подключение/);
 let hints=0;
 await smartCatalog('abc',{search:async()=>empty(),searchSuggest:async()=>{hints++;return []}},()=>false);
 assert.equal(hints,0);
});
test('lyric matching requires both title and artist, never just the first catalog hit',()=>{
 const song={title:'Hello',artist:'Adele'};
 assert.equal(matchTrack(song,[track('wrong','Hello','Other'),track('right','Hello','Adele')]).id,'right');
 assert.equal(matchTrack(song,[track('wrong','Hello','Other')]),null);
 assert.equal(matchTrack(song,[{...track('x','Hello','Adele'),available:false}]),null);
 assert.equal(matchTrack({title:'Песня (Song)',artist:'Артист (Artist)'},[track('ru','Песня','Артист')]).id,'ru');
});
test('lyric transliteration fallback resolves playable songs and retains unmatched hits',async()=>{
 const song={id:1,title:'Песня',artist:'Исполнитель'};
 const found=await lyricSearch('moya stroka',{
 searchLyrics:async q=>q==='моя строка'?[{song,fragment:'моя строка'},{song:{...song,id:2,title:'Другое'},fragment:'Ещё'}]:[],
 search:async()=>({...empty(),tracks:[track('play','Песня','Исполнитель')]})
 });
 assert.equal(found.length,2); assert.equal(found[0].track.id,'play'); assert.equal(found[1].track,null);
});
test('unrelated English hits do not suppress Russian lyrics typed in Latin letters',async()=>{
 const song={id:1,title:'Песня',artist:'Артист'};
 const found=await lyricSearch('moya stroka',{
   searchLyrics:async q=>q==='моя строка'?[{song,fragment:'моя строка в тексте'}]:[{song:{...song,id:2},fragment:'unrelated words'}],
   search:async()=>empty(),
 });
 assert.equal(found[0].song.id,1);
});
