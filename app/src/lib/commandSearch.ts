export function commandScore(label:string,query:string):number {
  const norm=(s:string)=>s.toLocaleLowerCase('ru').replaceAll('ё','е').normalize('NFKC');const text=norm(label),q=norm(query).trim();if(!q)return 1;if(text.startsWith(q))return 100;if(text.includes(q))return 70;
  const words=q.split(/\s+/);if(words.every(w=>text.includes(w)))return 50;
  let at=0;for(const char of text)if(char===q[at])at++;return at===q.length?10:0;
}
