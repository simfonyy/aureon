export const proceduralPresets = [
 {name:'Black Chrome',accent:'#9b91b8',reflection:70,contrast:180,depth:125,speed:25,seed:42},
 {name:'Liquid Metal',accent:'#c6c6ce',reflection:85,contrast:150,depth:140,speed:40,seed:127},
 {name:'Liquid Violet',accent:'#a915f5',reflection:90,contrast:155,depth:135,speed:30,seed:318},
 {name:'Silver Metal',accent:'#e1dfe4',reflection:100,contrast:125,depth:110,speed:30,seed:73},
 {name:'Dark Chrome',accent:'#787780',reflection:48,contrast:205,depth:130,speed:20,seed:552},
 {name:'Purple Chrome',accent:'#7513ed',reflection:85,contrast:175,depth:140,speed:25,seed:804},
 {name:'Midnight Metal',accent:'#3021a9',reflection:62,contrast:185,depth:145,speed:18,seed:916},
 {name:'Gold Chrome',accent:'#e9a52a',reflection:85,contrast:165,depth:125,speed:28,seed:641},
] as const;


export function upgradeMetalPreset(settings: {metalAccent:string;liquidIntensity:number;metalContrast:number;metalDepth:number;metalSpeed:number;metalSeed:number}) {
 const old = [
  ['#8b7cff',55,150,100,25,42],['#bbc8dc',85,120,140,40,127],
  ['#a78ae0',65,130,135,30,318],['#d4e0ec',100,95,75,30,73],
  ['#768096',35,180,90,20,552],['#9670c9',75,160,110,25,804],
  ['#778ead',45,155,120,18,916],['#dfbe72',70,130,100,28,641],
 ];
 const values=[settings.metalAccent,settings.liquidIntensity,settings.metalContrast,settings.metalDepth,settings.metalSpeed,settings.metalSeed];
 const index=old.findIndex(p=>p.every((v,i)=>v===values[i]));
 const p=proceduralPresets[index];
 if(p)Object.assign(settings,{metalAccent:p.accent,liquidIntensity:p.reflection,metalContrast:p.contrast,metalDepth:p.depth,metalSpeed:p.speed,metalSeed:p.seed});
}
