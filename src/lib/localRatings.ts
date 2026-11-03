export interface LocalRatings { liked:string[];disliked:string[] }
export const LOCAL_RATINGS_KEY='aureon.local-ratings.v1';
export function parseLocalRatings(raw:unknown):LocalRatings {const ids=(v:unknown)=>Array.isArray(v)?[...new Set(v.filter((s):s is string=>typeof s==='string'&&/^local:[a-f0-9]{64}$/.test(s)))].slice(0,5000):[];const obj=raw&&typeof raw==='object'?raw as Record<string,unknown>:{};const liked=ids(obj.liked);return {liked,disliked:ids(obj.disliked).filter(id=>!liked.includes(id))};}
export function readLocalRatings():LocalRatings{try{return parseLocalRatings(JSON.parse(localStorage.getItem(LOCAL_RATINGS_KEY)||'{}'));}catch{return {liked:[],disliked:[]};}}
export function saveLocalRatings(liked:string[],disliked:string[]){try{localStorage.setItem(LOCAL_RATINGS_KEY,JSON.stringify(parseLocalRatings({liked,disliked})));return true;}catch{return false;}}
