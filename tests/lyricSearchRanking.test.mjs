import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const source=await readFile(new URL('../src/lib/smartSearch.ts',import.meta.url),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {queryVariants,lyricSearch,matchTrack}=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const empty=()=>({tracks:[],artists:[],albums:[]});
const track=(id,title='Песня',artists=['Артист'])=>({id,title,available:true,artists:artists.map((name,index)=>({id:`artist-${index}`,name}))});
const hit=(id,fragment,title='Песня',artist='Артист')=>({song:{id,title,artist},fragment});
const api=(hits,search=async()=>empty())=>({searchLyrics:async()=>hits,search});
const deferred=()=>{let resolve;const promise=new Promise(yes=>{resolve=yes;});return{resolve,promise};};
const flush=()=>new Promise(resolve=>setImmediate(resolve));

test('a reordered remembered line and a couple of intervening words still find the song',async()=>{
  const hits=[hit(1,'Я собираю на АМа радик, для чего ради'),hit(2,'Любитель сладкого и ореховой пасты'),hit(3,'радик снова на моей ама')];
  const found=await lyricSearch('радик на ама',api(hits));
  assert.deepEqual(found.map(row=>row.song.id),[3,1]);
});

test('nearby letter swaps, transliteration and the previous keyboard layout recover the same phrase',async()=>{
  for(const query of ['слвоа этой песни','slova etoy pesni']) {
    const result=await lyricSearch(query,api([hit(1,'Слова этой песни я помню до сих пор')]));
    assert.equal(result[0]?.song.id,1,query);
  }
  const layout="ckjdf 'njq gtcyb";
  assert.ok(queryVariants(layout).includes('слова этой песни'));
  const result=await lyricSearch(layout,api([hit(2,'И слова этой песни знакомы')]));
  assert.equal(result[0]?.song.id,2);
});

test('artist aliases with swapped letters and joint names resolve independently of catalog order',()=>{
  const song={title:'Тп на аме',artist:'seroga priat'};
  assert.equal(matchTrack(song,[track('wrong','Тп на аме',['Другой артист']),track('right','Тп на аме',['Серёга Пират'])])?.id,'right');
  assert.equal(matchTrack({...song,title:'Тп на ame'},[track('mixed','Тп на аме',['Серёга Пират'])])?.id,'mixed');
  const joint={title:'3-е сентября',artist:'ЕГОР КРИД & Михаил Шуфутинский'};
  assert.equal(matchTrack(joint,[track('wrong','3-е сентября',['ЕГОР КРИД']),track('both','3-е сентября',['Михаил Шуфутинский','ЕГОР КРИД'])])?.id,'both');
});

test('live, remix and sped-up editions cannot silently replace the requested recording',()=>{
  const song={title:'Песня (Song)',artist:'Артист (Artist)'};
  const wrong=[track('live','Песня (Live)'),track('remix','Песня (Remix)'),track('sped','Песня (Sped Up)')];
  assert.equal(matchTrack(song,wrong),null);
  assert.equal(matchTrack(song,[...wrong,track('studio','Песня')])?.id,'studio');
  assert.equal(matchTrack({title:'Песня (Live)',artist:'Артист'},[track('studio','Песня'),wrong[0]])?.id,'live');
  assert.equal(matchTrack({title:'Нет в каталоге',artist:'Артист'},[track('different','Есть в каталоге')]),null);
  assert.equal(matchTrack({title:"Can't Let Go",artist:'Artist'},[track('apostrophe','Cant Let Go',['Artist'])])?.id,'apostrophe');
});

test('duplicate Genius rows retain the strongest fragment, not the last weaker one',async()=>{
  const found=await lyricSearch('слова этой песни',api([
    hit(1,'Слова этой песни'),hit(1,'Слова старой этой песни звучат'),hit(2,'Здесь совершенно другая история'),
  ]));
  assert.equal(found.length,1);assert.equal(found[0].fragment,'Слова этой песни');
});

test('exact remembered words rank ahead of a spelling correction',async()=>{
  const found=await lyricSearch('слова этой песни',api([hit(1,'Слвоа этой песни'),hit(2,'Слова этой песни')]));
  assert.deepEqual(found.map(row=>row.song.id),[2,1]);
});

test('different Genius entries resolving to one Yandex recording produce one playable result',async()=>{
  let calls=0;
  const found=await lyricSearch('слова этой песни',api([
    hit(1,'Слова этой песни'),hit(2,'Слова старой этой песни'),
  ],async()=>{calls++;return {...empty(),tracks:[track('123:456')]};}));
  assert.equal(found.length,1);assert.equal(found[0].song.id,1);assert.equal(found[0].track.id,'123:456');
  assert.equal(calls,1,'same artist/title lookup is shared within this search');
});

test('a clear playable hit precedes an unresolved hit while unrelated fragments disappear',async()=>{
  const found=await lyricSearch('слова этой песни',api([
    hit(1,'Слова этой песни','Нет в каталоге'),hit(2,'Слвоа этой песни','Есть в каталоге'),hit(3,'Ночь, фонарь, совсем другие слова'),
  ],async()=>({...empty(),tracks:[track('play','Есть в каталоге')]})));
  assert.deepEqual(found.map(row=>row.song.id),[2,1]);assert.equal(found[0].track.id,'play');
});

test('failure of the initial spelling does not discard a usable fallback; source requests stay bounded',async()=>{
  const calls=[];
  const found=await lyricSearch('moya stroka',{
    searchLyrics:async query=>{calls.push(query);if(query==='moya stroka')throw Error('temporary');return query==='моя строка'?[hit(1,'Моя строка осталась здесь')]:[];},
    search:async()=>empty(),
  });
  assert.equal(found[0]?.song.id,1);assert.ok(calls.length<=3);
  await assert.rejects(()=>lyricSearch('moya stroka',{searchLyrics:async()=>{throw Error('offline');},search:async()=>empty()}),/поиск по тексту/);
});

test('stale searches stop issuing fallback and catalog requests',async()=>{
  let current=true,catalog=0;const initial=deferred(),sourceCalls=[];
  const pending=lyricSearch('моя строка',{
    searchLyrics:query=>{sourceCalls.push(query);return initial.promise;},
    search:async()=>{catalog++;return empty();},
  },()=>current);
  current=false;initial.resolve([hit(1,'Моя строка')]);
  assert.deepEqual(await pending,[]);assert.equal(sourceCalls.length,1);assert.equal(catalog,0);
  let coldCalls=0;
  assert.deepEqual(await lyricSearch('моя строка',{searchLyrics:async()=>{coldCalls++;return[];}},()=>false),[]);
  assert.equal(coldCalls,0);
});

test('catalog resolution never has more than three requests in flight and stops expanding when stale',async()=>{
  let current=true,active=0,peak=0,calls=0;const gates=[];
  const rows=Array.from({length:8},(_,index)=>hit(index+1,'Слова этой песни',`Песня ${index}`));
  const pending=lyricSearch('слова этой песни',api(rows,async()=>{
    calls++;active++;peak=Math.max(peak,active);const gate=deferred();gates.push(gate);await gate.promise;active--;return empty();
  }),()=>current);
  await flush();assert.equal(calls,3);assert.equal(peak,3);
  current=false;gates.forEach(gate=>gate.resolve());
  assert.deepEqual(await pending,[]);assert.equal(calls,3);
});

test('a title-only fallback can recover metadata without accepting a different artist',async()=>{
  const calls=[];
  const found=await lyricSearch('моя строка',api([hit(1,'Моя строка')],async query=>{
    calls.push(query);return query==='Песня'?{...empty(),tracks:[track('wrong','Песня',['Другой']),track('right')]}:empty();
  }));
  assert.equal(found[0]?.track?.id,'right');assert.ok(calls.length<=3);assert.equal(calls.at(-1),'Песня');
});

test('one failed catalog lookup does not discard another playable song',async()=>{
  const found=await lyricSearch('моя строка',api([hit(1,'Моя строка','Ошибка'),hit(2,'Моя строка','Доступна')],query=>{
    if(query.toLowerCase().includes('ошибка') || query.toLowerCase().includes('oshibka'))throw Error('temporary');
    return Promise.resolve({...empty(),tracks:[track('play','Доступна')]});
  }));
  assert.equal(found[0].track?.id,'play');
  const failed=found.find(row=>row.song.id===1);
  assert.equal(failed.track,null);assert.equal(failed.lookupFailed,true);
});

test('two-word queries retain confident results and fallback arrival order cannot reorder equal hits',async()=>{
  const variants=queryVariants('moya stroka'),gates=[deferred(),deferred()];
  const pending=lyricSearch('moya stroka',{
    searchLyrics:query=>query===variants[0]?Promise.resolve([]):gates[query===variants[1]?0:1].promise,
    search:async()=>empty(),
  });
  await flush();gates[1].resolve([hit(2,'моя строка')]);gates[0].resolve([hit(1,'моя строка')]);
  assert.deepEqual((await pending).map(row=>row.song.id),[1,2]);
});
