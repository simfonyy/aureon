<template>
  <q-dialog :model-value="modelValue" position="top" @update:model-value="emit('update:modelValue', $event)">
    <div class="command-palette" @keydown.down.prevent="move(1)" @keydown.up.prevent="move(-1)">
      <label class="command-search">
        <Icon name="search" :size="20" />
        <input ref="input" v-model="query" autofocus aria-label="Поиск музыки и команд"
          placeholder="Трек, артист, плейлист или команда" autocomplete="off" spellcheck="false"
          @keydown.enter.prevent="run(selected, $event)" />
        <kbd>Esc</kbd>
      </label>
      <div class="command-results" role="listbox" aria-label="Результаты поиска">
        <button v-for="(item, i) in results" :key="item.id" role="option" :aria-selected="i === selected"
          :class="{ on: i === selected }" @mousemove="selected = i" @click="run(i, $event)">
          <Icon :name="item.icon" :size="17" /><span>{{ item.label }}</span><small>{{ item.group }}</small>
        </button>
        <p v-if="!results.length">Ничего не найдено</p>
      </div>
      <footer>↑ ↓ выбрать <span>Enter {{ results[selected]?.musical ? 'слушать' : 'открыть' }}</span>
        <span v-if="results[selected]?.track">Shift + Enter следующим</span>
      </footer>
    </div>
  </q-dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Notify } from 'quasar';
import type { Track, Artist, Playlist } from '@/api/types';
import { api } from '@/api/client';
import Icon from '@/components/Icon.vue';
import { commandScore } from '@/lib/commandSearch';
import { artistNames } from '@/lib/format';
import { useWorkspaceToolsStore, type WorkspaceTool } from '@/stores/workspaceTools';
import { usePlayerStore } from '@/stores/player/index';
import { useLibraryStore } from '@/stores/library';
import { useSleepStore } from '@/stores/sleep';

interface Command {
  id: string;
  label: string;
  group: string;
  icon: string;
  keywords?: string;
  musical?: boolean;
  track?: Track;
  action: () => unknown;
}

const props = defineProps<{ modelValue: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>();
const router = useRouter(), tools = useWorkspaceToolsStore(), player = usePlayerStore();
const library = useLibraryStore(), sleep = useSleepStore();
const query = ref(''), selected = ref(0), input = ref<HTMLInputElement | null>(null);
const catalog = ref<Command[]>([]);
const route = (path: string, section?: string) => () => router.push({ path, query: section ? { section } : {} });
const tool = (name: WorkspaceTool) => () => { tools.open = name; };

const commands = computed<Command[]>(() => [
 {id:'play',label:player.isPlaying?'Пауза':'Воспроизвести',group:'Плеер',icon:player.isPlaying?'pause':'play',keywords:'play pause стоп',action:()=>player.toggle()},
 {id:'lyrics',label:'Текст песни',group:'Плеер',icon:'lyrics',action:()=>{player.showLyrics=!player.showLyrics;}},
 {id:'audio',label:'Темп, тональность и микрофон',group:'Звук',icon:'sliders',keywords:'звук выход устройство запись',action:tool('audio')},
 {id:'local',label:'Локальная библиотека',group:'Музыка',icon:'library',keywords:'дубли теги умные плейлисты bpm энергия файлы',action:tool('library')},
 {id:'ocr',label:'Поиск по скриншоту',group:'Поиск',icon:'search',keywords:'изображение текст распознать',action:tool('ocr')},
 {id:'home',label:'Главное',group:'Разделы',icon:'home',action:route('/')},
 {id:'liked',label:'Мне нравится',group:'Разделы',icon:'heart',action:route('/liked')},
 {id:'stats',label:'Статистика',group:'Разделы',icon:'stats',action:route('/stats')},
 {id:'sleep30',label:'Таймер сна на 30 минут',group:'Плеер',icon:'time',action:()=>sleep.start(30)},
 ...(sleep.active?[{id:'sleepCancel',label:'Выключить таймер сна',group:'Плеер',icon:'time',action:()=>sleep.cancel()}]:[]),
 {id:'eq',label:'Эквалайзер',group:'Настройки',icon:'sliders',action:route('/settings','equalizer')},
 {id:'background',label:'Фон и тема',group:'Настройки',icon:'display',action:route('/settings','backgrounds')},
 {id:'mini',label:'Вид мини-плеера',group:'Настройки',icon:'mini',keywords:'кассета скин',action:route('/settings','mini')},
 {id:'listenbrainz',label:'ListenBrainz',group:'Настройки',icon:'stats',keywords:'история синхронизация',action:route('/settings','listenbrainz')},
]);

async function playList(load: Promise<Track[]>, playlist?: Playlist) {
  const tracks = (await load).filter(track => track.available);
  if (!tracks.length) return Notify.create({ message: 'Нет доступных треков' });
  await player.playQueue(tracks, 0, { playlist });
}

function trackResult(track: Track): Command {
  return {
    id: 'track:' + track.id, label: track.title, group: artistNames(track.artists), icon: 'note', track, musical: true,
    action: () => {
      const index = player.queue.findIndex(row => row.id === track.id);
      if (index < 0) return player.playQueue([track], 0);
      player.index = index;
      return player.loadCurrent();
    },
  };
}

function artistResult(artist: Artist): Command {
  return { id: 'artist:' + artist.id, label: artist.name, group: 'Артист', icon: 'artist', musical: true,
    action: () => playList(api.artistTracks(artist.id)) };
}

watch([query, () => props.modelValue], ([text, open], _, onCleanup) => {
  selected.value = 0;
  catalog.value = [];
  if (!open || text.trim().length < 2) return;
  let active = true;
  const timer = window.setTimeout(async () => {
    try {
      const data = await api.search(text.trim());
      if (active) catalog.value = [
        ...data.tracks.filter(t => t.available).slice(0, 12).map(trackResult),
        ...data.artists.slice(0, 4).map(artistResult),
      ];
    } catch {}
  }, 200);
  onCleanup(() => { active = false; window.clearTimeout(timer); });
});

const results = computed(() => {
  const local: Command[] = [
    ...commands.value,
    ...library.playlists.map(p => ({ id: 'playlist:' + p.kind, label: p.title, group: 'Плейлист',
      icon: 'queue', musical: true, action: () => playList(api.playlistTracks(p.kind), p) })),
    ...player.queue.map(trackResult),
  ];
  const matches = local.map(item => ({ item, score: commandScore([item.label, item.keywords, item.group].join(' '), query.value) }))
    .filter(row => row.score > 0);
  for (const item of catalog.value) {
    matches.push({ item, score: commandScore(item.label + ' ' + item.group, query.value) || 1 });
  }
  matches.sort((a, b) => b.score - a.score);
  const unique = new Map<string, Command>();
  for (const { item } of matches) {
    if (!unique.has(item.id)) unique.set(item.id, item);
    if (unique.size >= 35) break;
  }
  const list = [...unique.values()];
  const text = query.value.trim();
  if (text.length >= 2) list.push({ id: 'search', label: 'Искать музыку: ' + text, group: 'Поиск', icon: 'search',
    action: () => router.push({ path: '/search', query: { q: text } }) });
  return list;
});
watch(results, (rows, previous) => {
  const current = previous?.[selected.value];
  if (current && selected.value > 0) selected.value = Math.max(0, rows.findIndex(item => item.id === current.id));
});

function move(delta: number) {
  if (!results.value.length) return;
  selected.value = (selected.value + delta + results.value.length) % results.value.length;
  void nextTick(() => document.querySelector('.command-results [aria-selected=true]')?.scrollIntoView({ block: 'nearest' }));
}

async function run(index: number, event: KeyboardEvent | MouseEvent) {
  const item = results.value[index];
  if (!item || (event.shiftKey && !item.track)) return;
  emit('update:modelValue', false);
  await nextTick();
  try {
    if (event.shiftKey && item.track) player.playNext(item.track);
    else await item.action();
  } catch { Notify.create({ message: 'Не удалось выполнить команду' }); }
}

watch(() => props.modelValue, async open => {
  if (open) { query.value = ''; selected.value = 0; await nextTick(); input.value?.focus(); }
});
</script>
<style scoped>.command-palette{margin-top:min(14vh,100px);width:640px;max-width:calc(100vw - 32px);background:var(--surface);color:var(--fg);border:1px solid var(--line);border-radius:13px;box-shadow:0 20px 90px #0006}.command-search{display:flex;gap:14px;align-items:center;padding:18px;border-bottom:1px solid var(--line)}.command-search input{min-width:0;flex:1;background:none;border:0;color:var(--fg);outline:0;font:inherit}.command-search kbd{font-size:11px;color:var(--fg-dim)}.command-results{max-height:min(54vh,440px);overflow:auto;padding:7px}.command-results button{width:100%;display:flex;align-items:center;gap:12px;padding:12px;border:0;border-radius:7px;background:transparent;color:var(--fg);text-align:left;cursor:pointer;font:inherit;font-size:13px}.command-results button.on{background:var(--hover)}.command-results button>span{flex:1}.command-results small{color:var(--fg-dim);font-size:11px;max-width:30%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.command-results p{padding:18px;color:var(--fg-dim)}footer{display:flex;gap:18px;font-size:11px;color:var(--fg-dim);padding:11px 18px;border-top:1px solid var(--line)}</style>
