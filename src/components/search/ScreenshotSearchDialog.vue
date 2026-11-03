<template>
  <q-dialog :model-value="modelValue" @update:model-value="emit('update:modelValue',$event)">
    <div class="screenshot-search tool-dialog" @paste="paste">
      <header><h2>Поиск по скриншоту</h2><button class="icon-btn" aria-label="Закрыть поиск по скриншоту" @click="emit('update:modelValue',false)"><Icon name="close" :size="18"/></button></header>
      <p class="dim">Выбери изображение с текстом песни или вставь его сюда.</p>
      <label class="btn ocr-upload">Выбрать изображение<input type="file" accept="image/png,image/jpeg,image/webp,image/bmp,image/gif" :disabled="busy" @change="choose"/></label>
      <div v-if="preview" class="ocr-preview"><img :src="preview" alt="Выбранное изображение"/></div>
      <p v-if="!recognized" class="faint t-12">Изображение распознаётся на компьютере. При первом запуске с CDN загрузятся языки для русского и английского.</p>
      <button class="btn btn-solid" :disabled="!file||busy" @click="recognize">{{busy?'Распознаю…':'Распознать'}}</button>
      <div v-if="busy" class="ocr-progress" role="status">{{status}} {{Math.round(progress*100)}}%<progress :value="progress" max="1"/></div>
      <p v-if="error" role="alert">{{error}}</p>
      <div v-if="recognized" class="ocr-result"><label>Текст<textarea v-model="text" rows="5" maxlength="6000"/></label><p class="faint t-12">Можно поправить текст и выбрать нужную строчку.</p><div class="ocr-lines"><button v-for="line in lines" :key="line" @click="query=line" :class="{on:query===line}">{{line}}</button></div><input v-model="query" class="ocr-query" aria-label="Строка для поиска" maxlength="240"/><button class="btn btn-solid" :disabled="query.trim().length<3" @click="search">Найти песню</button></div>
    </div>
  </q-dialog>
</template>
<script setup lang="ts">
import {computed,onBeforeUnmount,ref,watch} from 'vue';
import {useRouter} from 'vue-router';
import Icon from '@/components/Icon.vue';
import {createOcrJobOwner,ocrCanvas,ocrSearchLines,validateOcrFile} from '@/lib/ocrSearch';
const props=defineProps<{modelValue:boolean}>(),emit=defineEmits<{'update:modelValue':[value:boolean]}>();
const router=useRouter(),file=ref<File|null>(null),preview=ref(''),text=ref(''),query=ref(''),busy=ref(false),error=ref(''),progress=ref(0),status=ref(''),recognized=ref(false);
const lines=computed(()=>ocrSearchLines(text.value)),jobs=createOcrJobOwner();
function setFile(next:File){if(busy.value)return;try{validateOcrFile(next);}catch(e){error.value=e instanceof Error?e.message:'Не удалось открыть изображение';return;}if(preview.value)URL.revokeObjectURL(preview.value);file.value=next;preview.value=URL.createObjectURL(next);recognized.value=false;text.value='';query.value='';error.value='';}
function choose(e:Event){const next=(e.target as HTMLInputElement).files?.[0];if(next)setFile(next);}
function paste(e:ClipboardEvent){if(busy.value)return;const next=Array.from(e.clipboardData?.files??[]).find(f=>f.type.startsWith('image/'));if(next){e.preventDefault();setFile(next);}}
async function recognize(){
  if(!file.value||busy.value||!props.modelValue)return;
  const job=jobs.begin(),selected=file.value;busy.value=true;error.value='';progress.value=0;status.value='Подготовка';
  try{
    const canvas=await ocrCanvas(selected,job.signal);if(!job.current())return;
    const {createWorker,OEM}=await import('tesseract.js');if(!job.current())return;
    // Do not race createWorker against cancellation: its late result still needs termination.
    const ownedWorker=await createWorker(['rus','eng'],OEM.LSTM_ONLY,{workerPath:new URL('/ocr/worker.min.js',location.href).href,corePath:new URL('/ocr/core',location.href).href,workerBlobURL:false,logger:m=>{if(!job.current())return;progress.value=Number.isFinite(m.progress)?Math.max(0,Math.min(1,m.progress)):0;status.value=m.status==='recognizing text'?'Распознавание':m.status==='loading language traineddata'?'Загрузка языков':'Подготовка';}});
    if(!await job.adopt(ownedWorker))return;
    const result=await job.wait(ownedWorker.recognize(canvas));if(!job.current())return;
    text.value=result.data.text.trim();query.value=ocrSearchLines(text.value)[0]?.slice(0,240)??'';recognized.value=true;if(!text.value)error.value='Текст не найден. Попробуй более чёткое изображение.';
  }catch(e){if(job.current())error.value=e instanceof Error?e.message:'Не удалось распознать текст';}
  finally{if(job.current())busy.value=false;await job.finish();}
}
function search(){const q=query.value.trim();if(q.length<3)return;emit('update:modelValue',false);void router.push({path:'/search',query:{q,mode:'lyrics'}});}
function cancel(){jobs.cancel();busy.value=false;}
watch(()=>props.modelValue,open=>{if(!open)cancel();});onBeforeUnmount(()=>{cancel();if(preview.value)URL.revokeObjectURL(preview.value);});
</script>
<style scoped>
.screenshot-search{width:680px;max-width:calc(100vw - 32px);max-height:calc(100dvh - 40px);overflow:auto;padding:24px;background:var(--surface);color:var(--fg);border:1px solid var(--line);border-radius:14px}header{display:flex;align-items:center;justify-content:space-between;gap:16px}h2{font-size:22px;margin:0}p{font-size:13px;line-height:1.5}.ocr-upload{display:inline-flex;position:relative;cursor:pointer;margin:8px 0}.ocr-upload input{position:absolute;opacity:0;inset:0;width:100%;cursor:pointer}.ocr-preview{margin:12px 0;background:var(--bg);border-radius:8px;overflow:hidden;max-height:220px}.ocr-preview img{display:block;width:100%;max-height:220px;object-fit:contain}.ocr-result{margin-top:20px;display:grid;gap:12px}.ocr-result label{display:grid;gap:8px;font-size:12px}.ocr-result textarea,.ocr-query{width:100%;padding:10px;border:1px solid var(--line);border-radius:7px;background:var(--bg);color:var(--fg);font:inherit}.ocr-lines{display:flex;flex-direction:column;gap:4px;max-height:140px;overflow:auto}.ocr-lines button{border:0;background:transparent;color:var(--fg-dim);text-align:left;padding:6px;font:inherit;font-size:13px;cursor:pointer}.ocr-lines button.on{color:var(--fg);background:var(--hover)}.ocr-progress{margin-top:12px;font-size:12px}.ocr-progress progress{width:100%;accent-color:var(--accent);display:block;margin:8px 0}
</style>
