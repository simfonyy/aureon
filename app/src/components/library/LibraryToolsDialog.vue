<template>
  <q-dialog :model-value="modelValue" @update:model-value="emit('update:modelValue', $event)">
    <div class="local-library" role="dialog" aria-label="Локальная музыка">
      <header class="local-header">
        <div><h2>Локальная музыка</h2><p>{{ store.entries.length }} треков на компьютере</p></div>
        <button class="local-icon" aria-label="Закрыть" @click="emit('update:modelValue', false)"><Icon name="close" :size="18" /></button>
      </header>
      <div class="local-toolbar">
        <button class="local-button" :disabled="store.busy" @click="store.importFiles(false)">Добавить файлы</button>
        <button class="local-button" :disabled="store.busy" @click="store.importFiles(true)">Добавить папку</button>
        <button v-if="!store.analyzing" class="local-button" :disabled="store.busy || !store.entries.length" @click="store.analyze()">Проанализировать</button>
        <button v-else class="local-button" :disabled="store.stopping" @click="store.stopping = true">{{ store.stopping ? 'Останавливаем…' : 'Остановить после трека' }}</button>
        <span v-if="store.busy" class="local-status" role="status">Подожди…</span>
        <span v-else-if="store.analyzing" class="local-status" role="status">{{ store.analysisDone }} / {{ store.analysisTotal }} · {{ analysisTitle }}</span>
      </div>
      <div v-if="store.analyzing" class="local-progress" aria-hidden="true"><i :style="{ width: `${store.analysisTotal ? 100 * store.analysisDone / store.analysisTotal : 0}%` }" /></div>
      <div v-if="store.error" class="local-error" role="alert">{{ store.error }}</div>
      <details v-if="store.notices.length" class="local-notices"><summary>{{ store.notices.length === 1 ? store.notices[0] : `Сообщения: ${store.notices.length}` }}</summary><p v-for="(notice,i) in store.notices" :key="i">{{ notice }}</p></details>
      <nav class="local-tabs" aria-label="Раздел библиотеки">
        <button v-for="item in tabs" :key="item.id" :class="{ active: tab === item.id }" @click="tab = item.id">{{ item.title }}</button>
      </nav>
      <div v-if="tab === 'tracks' || tab === 'texts'" class="local-search">
        <Icon name="search" :size="17" /><input v-model="draftQuery" :placeholder="tab === 'texts' ? 'Найти слова в сохранённых текстах' : 'Трек, исполнитель, альбом или слова песни'" aria-label="Поиск в локальной библиотеке" />
        <button v-if="draftQuery" class="local-icon" aria-label="Очистить поиск" @click="draftQuery = ''"><Icon name="close" :size="15" /></button>
      </div>
      <main class="local-body">
        <template v-if="tab === 'tracks'">
          <div class="local-controls">
            <select v-model="store.selectedPlaylist" aria-label="Подборка"><option value="">Все треки</option><option v-for="list in store.playlists" :key="list.id" :value="list.id">{{ list.title }}</option></select>
            <select v-model="store.sort" aria-label="Сортировка"><option value="added">Недавно добавлены</option><option value="title">По названию</option><option value="bpm">По темпу</option><option value="energy">По энергии</option><option value="near-tempo" :disabled="!store.currentEntry?.analysis?.bpm">Близкий темп к текущему</option><option value="near-energy" :disabled="!store.currentEntry?.analysis">Близкая энергия к текущему</option></select>
            <span class="local-faint">{{ store.visibleEntries.length }} треков</span>
            <button class="local-text-button" :disabled="!store.visibleEntries.length" @click="store.play(store.visibleEntries[0]!.id)">Слушать</button>
          </div>
          <p v-if="store.playlist" class="local-hint">{{ ruleLabel(store.playlist.rule) }}</p>
          <div v-if="!store.entries.length" class="local-empty"><Icon name="library" :size="32" /><h3>Добавь свою музыку</h3><p>Файлы остаются на месте. Теги и обложки читаются из них.</p></div>
          <div v-else-if="!store.visibleEntries.length" class="local-empty"><p>Ничего не найдено</p></div>
          <div v-else class="local-track-list">
            <div v-for="entry in pagedEntries" :key="entry.id" class="local-track" :class="{ playing: player.current?.id === entry.id }">
              <button class="local-art" :aria-label="`Слушать ${entry.title}`" @click="store.play(entry.id)"><img v-if="entry.coverPath" :src="convertFileSrc(entry.coverPath)" alt="" /><Icon v-else name="play" :size="20" /></button>
              <button class="local-track-info" @click="store.play(entry.id)"><strong>{{ entry.title }}</strong><span>{{ entry.artist || 'Без исполнителя' }}<template v-if="entry.album"> · {{ entry.album }}</template></span></button>
              <span class="local-metric" :title="entry.analysis ? 'Оценка по первым трём минутам' : 'После анализа'">{{ entry.analysis?.bpm ? `${entry.analysis.bpm} BPM` : '—' }}</span>
              <span class="local-metric local-key">{{ entry.analysis?.key || '—' }}</span>
              <span class="local-energy" :title="entry.analysis ? `Энергия: ${Math.round(entry.analysis.energy * 100)} из 100` : 'После анализа'"><i v-if="entry.analysis" :style="{ width: `${entry.analysis.energy * 100}%` }" /></span>
              <span class="local-duration">{{ duration(entry.durationMs) }}</span>
              <button class="local-icon" aria-label="Редактировать теги" title="Теги" @click="openEditor(entry)"><Icon name="settings" :size="17" /></button>
              <button class="local-icon" aria-label="Убрать из библиотеки" title="Убрать из библиотеки. Файл останется на диске" :disabled="store.busy" @click="store.remove(entry.id)"><Icon name="close" :size="16" /></button>
            </div>
          </div>
          <footer v-if="pageCount > 1" class="local-pagination"><button class="local-button" :disabled="page <= 1" @click="page--">Назад</button><span>{{ page }} / {{ pageCount }}</span><button class="local-button" :disabled="page >= pageCount" @click="page++">Дальше</button></footer>
          <p v-if="store.entries.length" class="local-hint">Темп, тональность и энергия — оценки по первым трём минутам. Анализ идёт на компьютере, без отправки музыки.</p>
        </template>
        <template v-else-if="tab === 'texts'">
          <p class="local-hint">Поиск работает без сети: теги, тексты из файлов и ранее загруженные тексты Aureon.</p>
          <div v-if="!store.query.trim()" class="local-empty"><h3>Вспомни строчку</h3><p>Здесь найдётся то, что уже есть на компьютере.</p></div>
          <div v-else-if="!store.textHits.length" class="local-empty"><p>Совпадений нет</p></div>
          <article v-for="hit in store.textHits.slice(0,100)" :key="hit.document.id" class="local-text-hit">
            <strong>{{ hit.document.title }}</strong><span>{{ hit.document.artist }}</span>
            <p v-if="hit.snippet">{{ hit.snippet }}</p>
            <small>{{ hit.document.local ? 'Локальный файл' : 'Сохранённый текст' }}</small>
            <button v-if="hit.document.local && store.entries.some(row => row.id === hit.document.id)" class="local-text-button" @click="store.play(hit.document.id, store.entries)">Слушать</button>
          </article>
        </template>
        <template v-else-if="tab === 'smart'">
          <h3>Подборки по правилу</h3><p class="local-hint">Состав меняется вместе с библиотекой и историей прослушивания.</p>
          <form class="local-smart-form" @submit.prevent="saveSmart">
            <input v-model="smartTitle" maxlength="100" placeholder="Название" required aria-label="Название подборки" />
            <select v-model="smartKind" aria-label="Правило"><option value="unplayed">Не слушал</option><option value="recent">Недавно добавлено</option><option value="short">Короче</option></select>
            <label><input v-model.number="smartValue" type="number" :min="1" :max="smartKind === 'short' ? 1440 : 3650" required :aria-label="smartKind === 'short' ? 'Минут' : 'Дней'" /><span>{{ smartKind === 'short' ? 'мин' : 'дн.' }}</span></label>
            <button class="local-button local-primary" type="submit">Сохранить</button>
          </form>
          <button v-for="preset in presets" :key="preset.title" class="local-preset" @click="smartTitle = preset.title; smartKind = preset.kind; smartValue = preset.value">{{ preset.title }}</button>
          <div v-if="!store.playlists.length" class="local-empty"><p>Сохранённых подборок пока нет</p></div>
          <div v-for="list in store.playlists" :key="list.id" class="local-smart-row">
            <button class="local-track-info" @click="openSmart(list.id)"><strong>{{ list.title }}</strong><span>{{ ruleLabel(list.rule) }} · {{ smartCount(list) }} треков</span></button>
            <button class="local-text-button" :disabled="!smartCount(list)" @click="playSmart(list)">Слушать</button>
            <button class="local-icon" aria-label="Удалить подборку" @click="store.removePlaylist(list.id)"><Icon name="close" :size="16" /></button>
          </div>
        </template>
        <template v-else>
          <h3>Похожие записи</h3><p class="local-hint">Chromaprint сравнивает звук, а не названия. Сначала проанализируй файлы. Ничего не удаляется автоматически.</p>
          <button class="local-button" :disabled="store.busy || store.analyzing || analyzedCount < 2" @click="store.findDuplicates()">Найти повторы</button>
          <p class="local-hint">Проанализировано: {{ analyzedCount }} из {{ store.entries.length }}</p>
          <p v-if="store.duplicatesTruncated" class="local-hint">Проверена часть пар. Можно убрать уже найденные повторы из библиотеки и запустить поиск снова.</p>
          <div v-if="store.duplicatesReady && !store.duplicateGroups.length" class="local-empty"><p>Похожих записей не найдено</p></div>
          <section v-for="(group,i) in store.duplicateGroups" :key="i" class="local-duplicate-group"><h4>Совпадение звука · {{ Math.round(group.similarity * 100) }}%</h4><div v-for="entry in duplicateEntries(group.ids)" :key="entry.id" class="local-duplicate"><div><strong>{{ entry.title }}</strong><p>{{ entry.path }}</p></div><button class="local-text-button" @click="store.play(entry.id, store.entries)">Слушать</button><button class="local-icon" aria-label="Убрать из библиотеки" title="Файл останется на диске" @click="store.remove(entry.id)"><Icon name="close" :size="16" /></button></div></section>
        </template>
      </main>
    </div>
  </q-dialog>
  <q-dialog v-model="editing">
    <div class="local-tag-editor" role="dialog" aria-label="Теги файла">
      <header class="local-header"><div><h2>Теги файла</h2><p>Исходный файл изменится. Копия останется рядом: .aureon-tags.bak</p></div><button class="local-icon" aria-label="Закрыть редактор" :disabled="store.busy" @click="editing = false"><Icon name="close" :size="18" /></button></header>
      <form class="local-tag-form" @submit.prevent="saveTags">
        <label class="local-cover-picker"><img v-if="coverPreview" :src="coverPreview" alt="Обложка" /><span v-else>Обложка</span><input type="file" accept="image/png,image/jpeg" aria-label="Выбрать обложку" @change="chooseCover" /></label>
        <label class="local-checkbox"><input v-model="form.removeCover" type="checkbox" @change="clearCover" />Убрать обложку</label>
        <div class="local-form-grid"><label>Название<input v-model="form.title" maxlength="512" required /></label><label>Исполнитель<input v-model="form.artist" maxlength="512" /></label><label>Альбом<input v-model="form.album" maxlength="512" /></label><label>Жанр<input v-model="form.genre" maxlength="256" /></label><label>Год<input v-model="yearDraft" type="number" min="0" max="9999" /></label><label>Номер трека<input v-model="trackDraft" type="number" min="0" max="9999" /></label></div>
        <details class="local-identify">
          <summary>Определить трек по звуку</summary>
          <p class="local-hint">AcoustID получит отпечаток звука и длительность. Файл и его название не отправляются. Выбранный вариант появится в полях выше.</p>
          <div class="local-identify-controls"><input v-model="clientKey" type="password" maxlength="128" placeholder="Ключ приложения AcoustID" aria-label="Ключ приложения AcoustID" autocomplete="off" spellcheck="false" @keydown.enter.prevent="identifyTrack" /><button type="button" class="local-button" :disabled="identifying || store.busy || store.analyzing || clientKey.trim().length < 6" @click="identifyTrack">{{ identifying ? 'Определяем…' : 'Определить по звуку' }}</button></div>
          <p v-if="identifyError" class="local-hint" role="status">{{ identifyError }}</p>
          <div v-if="identifyResults.length" class="local-identify-results"><button v-for="(candidate,i) in identifyResults" :key="i" type="button" @click="chooseIdentification(candidate)"><strong>{{ candidate.title }}</strong><span>{{ candidate.artist || 'Без исполнителя' }}<template v-if="candidate.album"> · {{ candidate.album }}</template></span><small>{{ Math.round(candidate.score * 100) }}% совпадения</small></button></div>
        </details>
        <label>Текст песни<textarea v-model="form.lyrics" maxlength="131072" rows="6" placeholder="Обычный текст или LRC" /></label>
        <div v-if="editorError || store.error" class="local-error" role="alert">{{ editorError || store.error }}</div>
        <footer class="local-tag-actions"><button class="local-button" type="button" :disabled="store.busy || store.analyzing" @click="selectedId && store.analyze([selectedId], true)">Пересчитать анализ</button><button class="local-button local-primary" type="submit" :disabled="store.busy">{{ store.busy ? 'Сохраняем…' : 'Записать в файл' }}</button></footer>
      </form>
    </div>
  </q-dialog>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { convertFileSrc } from '@tauri-apps/api/core';
import Icon from '@/components/Icon.vue';
import { useLibraryToolsStore } from '@/stores/libraryTools';
import { usePlayerStore } from '@/stores/player';
import { useStatsStore } from '@/stores/stats';
import { ruleLabel, smartMatches, identificationDraft, type LocalEntry, type SmartPlaylist, type SmartRule, type TagPatch, type Identification } from '@/lib/libraryTools/model';

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>();
const store = useLibraryToolsStore(); const player = usePlayerStore(); const stats = useStatsStore();
const tab = ref('tracks'); const page = ref(1); const draftQuery = ref(store.query);
const tabs = [{ id:'tracks', title:'Треки' }, { id:'texts', title:'По словам' }, { id:'smart', title:'Подборки' }, { id:'duplicates', title:'Повторы' }];
let searchTimer: ReturnType<typeof setTimeout> | null = null;
watch(draftQuery, value => { if (searchTimer) clearTimeout(searchTimer); searchTimer = setTimeout(() => { store.query = value; page.value = 1; }, 180); });
watch(() => [store.sort, store.selectedPlaylist, store.visibleEntries.length], () => { page.value = Math.min(page.value, pageCount.value); });
watch(() => props.modelValue, value => { if (value) void store.init(); }, { immediate: true });
onBeforeUnmount(() => { if (searchTimer) clearTimeout(searchTimer); });
const pageCount = computed(() => Math.max(1, Math.ceil(store.visibleEntries.length/100)));
const pagedEntries = computed(() => store.visibleEntries.slice((page.value-1)*100, page.value*100));
const analysisTitle = computed(() => store.entries.find(row => row.id === store.analysisCurrent)?.title || '');
const analyzedCount = computed(() => store.entries.filter(row => row.analysis).length);
function duration(ms: number) { const seconds = Math.floor(ms/1000); return `${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`; }
function duplicateEntries(ids: string[]) { const wanted = new Set(ids); return store.entries.filter(row => wanted.has(row.id)); }
const smartTitle = ref(''); const smartKind = ref<'unplayed' | 'recent' | 'short'>('unplayed'); const smartValue = ref(30);
const presets = [{ title:'Давно не слушал', kind:'unplayed' as const, value:30 }, { title:'Недавно добавлено', kind:'recent' as const, value:14 }, { title:'Короче трёх минут', kind:'short' as const, value:3 }];
function saveSmart() { const rule: SmartRule = smartKind.value === 'short' ? { kind:'short', seconds: Math.round(smartValue.value*60) } : { kind:smartKind.value, days:smartValue.value }; if (store.savePlaylist(smartTitle.value, rule)) { smartTitle.value = ''; openSmart(store.selectedPlaylist); } }
function openSmart(id: string) { store.selectedPlaylist = id; draftQuery.value = ''; store.query = ''; tab.value = 'tracks'; page.value = 1; }
function smartRows(list: SmartPlaylist) { return store.entries.filter(row => smartMatches(row, list.rule, stats.events)); }
function smartCount(list: SmartPlaylist) { return smartRows(list).length; }
function playSmart(list: SmartPlaylist) { const rows = smartRows(list); if (rows[0]) void store.play(rows[0].id, rows); }
const editing = ref(false); const selectedId = ref(''); const yearDraft = ref(''); const trackDraft = ref(''); const coverPreview = ref(''); const editorError = ref('');
const emptyForm = (): TagPatch => ({ title:'', artist:'', album:'', genre:'', year:null, trackNumber:null, lyrics:'', coverBase64:null, removeCover:false });
const form = ref<TagPatch>(emptyForm());
const clientKey = ref(''); const identifying = ref(false); const identifyError = ref(''); const identifyResults = ref<Identification[]>([]);
let identifyGeneration = 0;
watch(editing, value => { if (!value) { ++identifyGeneration; clientKey.value = ''; identifyResults.value = []; identifyError.value = ''; } });
onBeforeUnmount(() => { ++identifyGeneration; clientKey.value = ''; });
function openEditor(entry: LocalEntry) {
  ++identifyGeneration; identifyResults.value = []; identifyError.value = ''; clientKey.value = '';
  selectedId.value = entry.id; store.error = ''; editorError.value = ''; yearDraft.value = entry.year?.toString() || ''; trackDraft.value = entry.trackNumber?.toString() || '';
  form.value = { title:entry.title, artist:entry.artist, album:entry.album, genre:entry.genre, year:entry.year, trackNumber:entry.trackNumber, lyrics:entry.lyrics, coverBase64:null, removeCover:false };
  coverPreview.value = entry.coverPath ? convertFileSrc(entry.coverPath) : ''; editing.value = true;
}
async function identifyTrack() {
  if (identifying.value || store.busy || store.analyzing || clientKey.value.trim().length < 6) return;
  const generation = ++identifyGeneration; const id = selectedId.value;
  identifying.value = true; identifyError.value = ''; identifyResults.value = [];
  try {
    const result = await store.identify(id,clientKey.value);
    if (generation !== identifyGeneration || !editing.value || selectedId.value !== id) return;
    identifyResults.value = result;
    if (!result.length) identifyError.value = 'Совпадений не найдено';
  } catch (e) { if (generation === identifyGeneration && editing.value) identifyError.value = e instanceof Error ? e.message : 'Не удалось определить запись'; }
  finally { identifying.value = false; }
}
function chooseIdentification(candidate: Identification) {
  form.value = identificationDraft(form.value,candidate);
  identifyResults.value = []; identifyError.value = 'Поля заполнены. Проверь их перед записью в файл.';
}
let coverReadGeneration = 0;
async function chooseCover(event: Event) {
  const input = event.target as HTMLInputElement; const file = input.files?.[0]; const generation = ++coverReadGeneration;
  if (!file) return;
  editorError.value = '';
  if (file.size > 8*1024*1024 || !['image/png','image/jpeg'].includes(file.type)) { editorError.value = 'Нужна обложка PNG или JPEG до 8 МБ'; input.value = ''; return; }
  try {
    const data = await new Promise<string>((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('Не удалось прочитать обложку')); reader.readAsDataURL(file); });
    if (generation !== coverReadGeneration || !editing.value) return;
    form.value.coverBase64 = data.slice(data.indexOf(',')+1); form.value.removeCover = false; coverPreview.value = data;
  } catch { editorError.value = 'Не удалось прочитать обложку'; }
}
function clearCover() { if (form.value.removeCover) { ++coverReadGeneration; form.value.coverBase64 = null; coverPreview.value = ''; } }
async function saveTags() {
  const number = (value: string) => value === '' ? null : Number(value);
  form.value.year = number(String(yearDraft.value)); form.value.trackNumber = number(String(trackDraft.value));
  if (await store.editTags(selectedId.value, { ...form.value })) editing.value = false;
}
</script>

<style scoped>
.local-library,.local-tag-editor{background:var(--surface,#17181b);color:var(--fg,#f4f4f5);border:1px solid var(--line,rgba(255,255,255,.12));border-radius:18px;box-shadow:0 24px 80px #0007;max-width:min(1180px,calc(100vw - 40px))!important;width:1080px;max-height:calc(100vh - 48px)!important;display:flex;flex-direction:column;overflow:hidden}
.local-header{padding:23px 26px 17px;display:flex;align-items:flex-start;justify-content:space-between;gap:16px}.local-header h2{font-size:23px;line-height:1.3;margin:0;font-weight:700;letter-spacing:-.45px}.local-header p{margin:6px 0 0;font-size:12px;color:var(--fg-dim,#aaa)}
button,input,select,textarea{font:inherit;color:inherit}button{cursor:pointer}button:disabled{cursor:default;opacity:.42}.local-icon{width:32px;height:32px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0;border:0;background:transparent;border-radius:8px;color:var(--fg-dim,#aaa)}.local-icon:hover:not(:disabled){background:var(--hover,rgba(255,255,255,.07));color:var(--fg,#fff)}
.local-toolbar{padding:0 26px 14px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}.local-button{background:var(--surface,rgba(255,255,255,.045));border:1px solid var(--line,rgba(255,255,255,.12));border-radius:9px;padding:8px 13px;font-size:12px;line-height:1.3}.local-button:hover:not(:disabled){background:var(--hover,rgba(255,255,255,.09))}.local-primary{background:var(--fg,#f4f4f5);border-color:transparent;color:var(--bg,#171717);font-weight:600}.local-primary:hover:not(:disabled){background:var(--fg,#f4f4f5);filter:brightness(.92)}.local-status{font-size:11px;color:var(--fg-dim,#aaa);max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-left:auto}.local-progress{height:2px;background:var(--line,#333)}.local-progress i{display:block;height:100%;background:var(--accent,#c9b485);transition:width .2s}
.local-error{font-size:12px;line-height:1.5;color:#f3aaaa;background:#9d303020;border:1px solid #c4585833;border-radius:9px;padding:10px 13px;margin:0 26px 12px}.local-notices{font-size:11px;color:var(--fg-dim,#aaa);padding:0 26px 12px;max-height:110px;overflow:auto}.local-notices summary{cursor:pointer}.local-notices p{margin:5px 0}
.local-tabs{display:flex;gap:20px;padding:0 26px;border-bottom:1px solid var(--line,rgba(255,255,255,.09))}.local-tabs button{border:0;border-bottom:2px solid transparent;background:transparent;padding:12px 0;font-size:13px;color:var(--fg-dim,#aaa)}.local-tabs button.active{border-color:var(--accent,#c9b485);color:var(--fg,#fff)}.local-search{display:flex;align-items:center;gap:10px;padding:12px 26px;color:var(--fg-dim,#aaa);border-bottom:1px solid var(--line,rgba(255,255,255,.06))}.local-search input{background:transparent;border:0;outline:0;flex:1;font-size:12px;min-width:0}.local-search input::placeholder{color:var(--fg-dim,#aaa);opacity:.8}
.local-body{padding:18px 26px 24px;overflow:auto;min-height:150px;flex:1;scrollbar-width:none}.local-body::-webkit-scrollbar{display:none}.local-body h3{font-size:17px;font-weight:650;line-height:1.4;margin:0 0 8px}.local-controls{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:10px}.local-controls select,.local-smart-form select{font-size:11px;background:var(--surface,#1b1c20);border:1px solid var(--line,#ffffff1a);padding:7px 9px;border-radius:7px;max-width:230px}.local-faint{font-size:11px;color:var(--fg-dim,#aaa);margin-left:auto}.local-text-button{border:0;background:transparent;color:var(--accent,#c9b485);font-size:12px;padding:6px;white-space:nowrap}.local-hint{font-size:11px;line-height:1.6;color:var(--fg-dim,#aaa);margin:8px 0 14px;max-width:780px}.local-empty{padding:45px 10px;text-align:center;color:var(--fg-dim,#aaa)}.local-empty h3{margin-top:13px;color:var(--fg,#fff)}.local-empty p{font-size:12px;margin:8px 0}
.local-track{display:flex;align-items:center;gap:11px;padding:8px 4px;border-radius:9px;min-height:60px}.local-track:hover{background:var(--hover,#ffffff07)}.local-track.playing .local-track-info strong{color:var(--accent,#c9b485)}.local-art{width:42px;height:42px;flex-shrink:0;border-radius:7px;overflow:hidden;display:flex;align-items:center;justify-content:center;background:var(--surface,#ffffff08);border:0;color:var(--fg-dim,#aaa);padding:0}.local-art img{width:100%;height:100%;object-fit:cover}.local-track-info{display:flex;flex-direction:column;gap:4px;min-width:0;flex:1;align-items:flex-start;background:transparent;border:0;text-align:left;padding:0}.local-track-info strong{font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%}.local-track-info span{font-size:11px;line-height:1.4;color:var(--fg-dim,#aaa);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}.local-metric{font-size:10px;color:var(--fg-dim,#aaa);width:66px;text-align:right;flex-shrink:0;font-variant-numeric:tabular-nums}.local-key{width:66px}.local-energy{height:4px;background:var(--line,#ffffff15);border-radius:3px;width:38px;overflow:hidden;flex-shrink:0;margin:0 8px}.local-energy i{height:100%;background:var(--accent,#c9b485);display:block}.local-duration{font-size:10px;color:var(--fg-dim,#aaa);width:34px;text-align:right;font-variant-numeric:tabular-nums}.local-pagination{display:flex;gap:16px;align-items:center;justify-content:center;margin:16px 0}.local-pagination span{font-size:11px;color:var(--fg-dim,#aaa)}
.local-text-hit{padding:17px 0;border-bottom:1px solid var(--line,#ffffff12);position:relative}.local-text-hit strong{font-size:13px;display:block}.local-text-hit>span{font-size:11px;color:var(--fg-dim,#aaa);display:block;margin-top:4px}.local-text-hit p{font-size:13px;line-height:1.7;margin:12px 0 7px}.local-text-hit small{font-size:10px;color:var(--fg-dim,#aaa)}.local-text-hit button{float:right}
.local-smart-form{display:flex;gap:9px;align-items:center;margin:17px 0 9px;flex-wrap:wrap}.local-smart-form>input{flex:1;min-width:150px}.local-smart-form input,.local-tag-form input,.local-tag-form textarea{background:var(--surface,#ffffff06);border:1px solid var(--line,#ffffff15);border-radius:7px;padding:9px 10px;outline:none;font-size:12px;min-width:0}.local-smart-form input:focus,.local-tag-form input:focus,.local-tag-form textarea:focus{border-color:var(--accent,#c9b485)}.local-smart-form label{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--fg-dim,#aaa)}.local-smart-form label input{width:65px}.local-preset{font-size:10px;color:var(--fg-dim,#aaa);border:1px solid var(--line,#ffffff15);background:transparent;border-radius:14px;padding:5px 9px;margin:0 6px 7px 0}.local-smart-row{display:flex;align-items:center;gap:14px;padding:15px 0;border-bottom:1px solid var(--line,#ffffff10)}.local-duplicate-group{border:1px solid var(--line,#ffffff15);border-radius:11px;padding:15px;margin-top:15px}.local-duplicate-group h4{font-size:11px;font-weight:500;color:var(--fg-dim,#aaa);margin:0 0 13px}.local-duplicate{display:flex;align-items:center;gap:10px;padding:10px 0}.local-duplicate>div{flex:1;min-width:0}.local-duplicate strong{font-size:12px}.local-duplicate p{font-size:10px;color:var(--fg-dim,#aaa);overflow-wrap:anywhere;margin:5px 0}
.local-tag-editor{width:650px}.local-tag-form{padding:0 26px 24px;overflow:auto}.local-tag-form>label{display:flex;flex-direction:column;gap:7px;font-size:11px;color:var(--fg-dim,#aaa)}.local-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:13px;margin:17px 0}.local-form-grid label{display:flex;flex-direction:column;gap:6px;font-size:11px;color:var(--fg-dim,#aaa)}.local-tag-form textarea{resize:vertical;width:100%;min-height:110px;max-height:280px}.local-tag-form input,.local-tag-form textarea{color:var(--fg,#fff)}.local-tag-form .local-error{margin:14px 0}.local-tag-actions{display:flex;justify-content:space-between;gap:10px;margin-top:20px}.local-tag-form .local-cover-picker{width:92px;height:92px;position:relative;display:flex;align-items:center;justify-content:center;border:1px dashed var(--line,#ffffff30);border-radius:9px;overflow:hidden;cursor:pointer}.local-cover-picker img{width:100%;height:100%;object-fit:cover}.local-cover-picker input{position:absolute;inset:0;width:100%;height:100%;opacity:0;cursor:pointer}.local-tag-form .local-checkbox{display:flex;flex-direction:row;align-items:center;gap:7px;margin-top:9px;font-size:11px}.local-checkbox input{accent-color:var(--accent,#c9b485)}
@media(max-width:950px){.local-library{max-width:calc(100vw - 24px)!important}.local-metric{width:55px}.local-key{display:none}.local-track{gap:8px}.local-energy{margin:0 3px;width:30px}.local-header,.local-toolbar{padding-left:20px;padding-right:20px}.local-tabs,.local-search,.local-body{padding-left:20px;padding-right:20px}.local-status{max-width:220px}}
button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
.local-identify{margin:15px 0 18px;padding:12px;border:1px solid var(--line);border-radius:9px}.local-identify summary{cursor:pointer;font-size:12px}.local-identify-controls{display:flex;gap:8px}.local-identify-controls input{flex:1;min-width:0}.local-identify-results{display:flex;flex-direction:column;gap:6px;margin-top:12px}.local-identify-results button{display:flex;flex-direction:column;gap:4px;text-align:left;background:var(--bg);border:1px solid var(--line);border-radius:7px;padding:11px;color:var(--fg)}.local-identify-results strong{font-size:12px}.local-identify-results span,.local-identify-results small{font-size:10px;color:var(--fg-dim)}
</style>
