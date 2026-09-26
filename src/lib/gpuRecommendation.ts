export type BackgroundMode = 'beauty' | 'optimized';
export interface GpuAdapter { model:string; vendor:string; vramMb:number; displayAttached:boolean }
export interface Recommendation { mode:BackgroundMode; tier:'high'|'conservative'|'unknown'; reason:string }


export function recommend(adapter?:GpuAdapter|null):Recommendation {
 const fallback:Recommendation={mode:'optimized',tier:'unknown',reason:'Не удалось оценить видеокарту. Для начала предлагаем простой фон.'};
 if(!adapter)return fallback;
 const model=adapter.model.toUpperCase();
 if(adapter.vendor==='NVIDIA'){
  const product=model.match(/\bRTX\s*(\d{4})\b/);if(!product)return fallback;
  const n=Number(product[1]);
  const high=[3060,3070,3080,3090,4060,4070,4080,4090,5060,5070,5080,5090].includes(n);
  return {mode:high?'beauty':'optimized',tier:high?'high':'conservative',reason:high?'Для этой модели предлагаем живой фон. Если приложение замедлится, попробуйте простой.':'Для этой модели предлагаем простой фон: он требует меньше ресурсов.'};
 }
 const amd=adapter.vendor==='AMD'&&/\bRX\s*(6600|6650|6700|6750|6800|6850|6900|6950|7600|7700|7800|7900|9060|9070)\b/.test(model);
 const intel=adapter.vendor==='Intel'&&/\bARC\s*(?:\(TM\)\s*)?(A750|A770|B570|B580)\b/.test(model);
 if((amd||intel)&&adapter.vramMb>=6000)return {mode:'beauty',tier:'high',reason:'Для этой модели предлагаем живой фон. Если приложение замедлится, попробуйте простой.'};
 return {...fallback,tier:'conservative',reason:'Для этой видеокарты предлагаем начать с простого фона: он требует меньше ресурсов.'};
}
export function chooseAdapter(adapters:GpuAdapter[]):GpuAdapter|null {


 return adapters.find(a=>a.displayAttached)??adapters[0]??null;
}
