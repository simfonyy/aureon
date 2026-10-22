<template>
  <q-page class="scroll-page">
    <q-scroll-area class="scroll-page-area">
      <div class="scroll-page-inner">
        <div class="h1">Поиск</div>

        <div class="suggest-wrap q-mt-lg">
          <div class="field">
            <Icon name="search" :size="16" class="faint" />
            <input
              v-model="text"
              type="text"
              spellcheck="false"
              :placeholder="mode === 'lyrics' ? 'Вспомни несколько слов из песни' : 'Трек, артист или строчка песни'"
              maxlength="240"
              aria-label="Поиск музыки"
              @keyup.enter="submit"
              @keydown.esc="closeSuggest"
              @focus="suggestOpen = true"
              @blur="closeSuggestSoon"
            />
            <button
              v-if="text"
              class="icon-btn xs"
              type="button"
              title="Очистить"
              @click="clearQuery"
            >
              <Icon name="close" :size="13" />
            </button>
          </div>

          <div v-if="suggestOpen && suggestions.length" class="suggest-list">
            <button
              v-for="hint in suggestions"
              :key="hint"
              class="suggest-item"
              type="button"
              @mousedown.prevent="pick(hint)"
            >
              <Icon name="search" :size="14" class="faint" />
              <span class="ellipsis">{{ hint }}</span>
            </button>
          </div>
        </div>

        <div class="search-modes q-mt-md" aria-label="Тип поиска">
          <button :class="{active:mode==='all'}" :aria-pressed="mode==='all'" @click="setMode('all')">Всё</button>
          <button :class="{active:mode==='lyrics'}" :aria-pressed="mode==='lyrics'" @click="setMode('lyrics')">По строчке</button>
        </div>
        <p v-if="!searched" class="faint t-13 q-mt-md">Можно с опечаткой, латиницей или в другой раскладке.</p>
        <div v-if="alternatives.length && mode==='all'" class="search-alternatives q-mt-md">
          <span class="faint t-13">Похожие запросы</span>
          <button v-for="hint in alternatives" :key="hint" @click="pick(hint)">{{ hint }}</button>
        </div>
        <p v-if="error" role="status" class="dim q-mt-lg">{{ error }} <button class="search-retry" @click="submit">Повторить</button></p>
        <section v-if="lyricLoading || lyricMatches.length || lyricError || (searched && mode==='lyrics')" class="q-mt-xl">
          <div class="h2 q-mb-md">По словам песни</div>
          <div v-if="lyricLoading" class="dim t-13" role="status"><q-spinner size="18px" class="q-mr-sm" />Ищем совпадения в тексте…</div>
          <p v-if="lyricError" class="dim t-13" role="status">{{ lyricError }} <button class="search-retry" @click="submit">Повторить</button></p>
          <article v-for="hit in lyricMatches" :key="hit.song.id" class="lyric-search-hit">
            <TrackRow v-if="hit.track" :track="hit.track" :index="0" :show-index="false" @play="playLyric(hit)" />
            <div v-else class="lyric-search-unavailable">
              <img v-if="hit.song.art" :src="hit.song.art" alt="" loading="lazy" />
              <div><div class="w-500">{{ hit.song.title }}</div><div class="dim t-13">{{ hit.song.artist }}</div>
                <div class="faint t-12">{{ hit.lookupFailed ? 'Не удалось проверить наличие в Яндекс Музыке' : 'Совпадение в Яндекс Музыке не найдено' }}</div>
              </div>
            </div>
            <p v-if="hit.fragment" class="lyric-search-fragment">{{ hit.fragment }}</p>
          </article>
          <p v-if="!lyricLoading && !lyricError && !lyricMatches.length && mode==='lyrics'" class="dim t-13">Совпадений нет. Попробуй другую строчку или более длинный фрагмент.</p>
          <div v-if="lyricMatches.length" class="faint t-11 q-mt-sm">Текст — Genius · воспроизведение — Яндекс Музыка</div>
        </section>

        <div v-if="loading" class="q-mt-xl">
          <q-spinner size="24px" color="primary" />
        </div>

        <template v-else-if="result">
          <template v-if="result.artists.length">
            <div class="h2 q-mt-xl q-mb-md">Артисты</div>
            <div class="row q-col-gutter-md">
              <div v-for="a in result.artists" :key="a.id" class="col-auto">
                <div
                  class="card text-center"
                  style="width: 132px"
                  @click="router.push(`/artist/${a.id}`)"
                >
                  <div class="cover round" style="width: 100%; aspect-ratio: 1">
                    <img
                      v-if="avatarOf(a)"
                      loading="lazy"
                      decoding="async"
                      :src="avatarOf(a) ?? undefined"
                    />
                    <Icon v-else name="person" :size="24" class="faint" />
                  </div>
                  <div class="t-13 w-500 ellipsis q-mt-sm">{{ a.name }}</div>
                </div>
              </div>
            </div>
          </template>

          <template v-if="genius.ready && genius.people.length">
            <div class="h2 q-mt-xl q-mb-md">Авторы и продюсеры</div>
            <div class="row q-col-gutter-md">
              <div v-for="p in genius.people" :key="p.id" class="col-auto">
                <div
                  class="card text-center"
                  style="width: 132px"
                  @click="openPerson(p.id)"
                >
                  <div class="cover round" style="width: 100%; aspect-ratio: 1">
                    <img
                      v-if="p.image"
                      loading="lazy"
                      decoding="async"
                      :src="p.image"
                    />
                    <Icon v-else name="person" :size="24" class="faint" />
                  </div>
                  <div class="t-13 w-500 ellipsis q-mt-sm">{{ p.name }}</div>
                  <div class="faint t-11">
                    {{ p.verified ? "genius · ✓" : "genius" }}
                  </div>
                </div>
              </div>
            </div>
          </template>

          <template v-if="result.albums.length">
            <div class="h2 q-mt-xl q-mb-md">Альбомы</div>
            <div class="row q-col-gutter-md">
              <div v-for="al in result.albums" :key="al.id" class="col-auto">
                <div
                  class="card"
                  style="width: 150px"
                  @click="router.push(`/album/${al.id}`)"
                >
                  <div class="cover" style="width: 100%; aspect-ratio: 1">
                    <img
                      loading="lazy"
                      decoding="async"
                      v-if="al.cover_url"
                      :src="al.cover_url"
                    />
                    <Icon v-else name="album" :size="24" class="faint" />
                  </div>
                  <div class="t-13 w-500 ellipsis q-mt-sm">{{ al.title }}</div>
                  <div class="faint t-11">{{ al.year || "" }}</div>
                </div>
              </div>
            </div>
          </template>

          <template v-if="result.tracks.length">
            <div class="h2 q-mt-xl q-mb-sm">Треки</div>
            <LazyTracks v-slot="{ item, index }" :items="result.tracks">
              <TrackRow :track="item" :index="index" @play="playFrom(index)" />
            </LazyTracks>
          </template>

          <div
            v-if="
              !result.tracks.length &&
              !result.artists.length &&
              !result.albums.length
            "
            class="dim t-13 q-mt-xl"
          >
            Ничего не нашлось
          </div>
        </template>
      </div>
    </q-scroll-area>
  </q-page>
</template>

<script setup lang="ts">
import Icon from "@/components/Icon.vue";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import LazyTracks from "@/components/LazyTracks.vue";
import TrackRow from "@/components/TrackRow.vue";
import { api } from "@/api/client";
import type { Artist, SearchResult, Track } from "@/api/types";
import { smartCatalog, lyricSearch, queryVariants, bounded, type LyricMatch } from '@/lib/smartSearch';
import { cachedAvatar, fetchAvatars } from "@/lib/artistAvatar";
import { usePlayerStore } from "@/stores/player/index";
import { useGeniusStore } from "@/stores/genius";

const route = useRoute();
const router = useRouter();
const player = usePlayerStore();
const genius = useGeniusStore();

const text = ref("");
const result = ref<SearchResult | null>(null);
const loading = ref(false);
const mode = ref<'all'|'lyrics'>('all');
const searched = ref(false);
const error = ref('');
const lyricError = ref('');
const lyricLoading = ref(false);
const lyricMatches = ref<LyricMatch[]>([]);
const alternatives = ref<string[]>([]);
let request = 0;
let suggestRequest = 0;
function setMode(next:'all'|'lyrics') { mode.value=next; if(text.value.trim()) submit(); }
function playLyric(hit:LyricMatch) {
  const tracks=lyricMatches.value.map(h=>h.track).filter((t):t is Track=>!!t);
  const index=tracks.findIndex(t=>t.id===hit.track?.id);
  if(index>=0) void player.playQueue(tracks,index);
}
const avatars = ref<Record<string, string | null>>({});

function avatarOf(artist: Artist): string | null {
  return artist.cover_url || avatars.value[artist.id] || null;
}

async function loadAvatars(artists: Artist[]) {
  const missing = artists.filter((a) => !a.cover_url);
  if (!missing.length) return;
  const next: Record<string, string | null> = { ...avatars.value };
  for (const artist of missing) {
    const cached = cachedAvatar(artist.id);
    if (cached) next[artist.id] = cached;
  }
  avatars.value = next;
  const loaded = await fetchAvatars(missing.map((a) => a.id));
  avatars.value = { ...avatars.value, ...loaded };
}

function playFrom(i: number) {
  const tracks = result.value?.tracks || [];
  if (tracks.length) void player.playQueue(tracks, i);
}

const suggestions = ref<string[]>([]);
const suggestOpen = ref(false);
let suggestTimer: ReturnType<typeof setTimeout> | undefined;
let blurTimer: ReturnType<typeof setTimeout> | undefined;

function closeSuggest() {
  suggestOpen.value = false;
}

function closeSuggestSoon() {
  blurTimer = setTimeout(closeSuggest, 120);
}

function clearQuery() {
  request++; suggestRequest++;
  clearTimeout(suggestTimer);
  loading.value=false; lyricLoading.value=false; searched.value=false;
  lyricMatches.value=[]; alternatives.value=[]; error.value=''; lyricError.value='';
  text.value = "";
  suggestions.value = [];
  result.value = null;
}

function pick(hint: string) {
  clearTimeout(blurTimer);
  text.value = hint;
  suggestions.value = [];
  suggestOpen.value = false;
  void run();
}

function submit() {
  suggestions.value = [];
  suggestOpen.value = false;
  void run();
}

watch(text, (value) => {
  const id=++suggestRequest;
  ++request;
  loading.value=false; lyricLoading.value=false;
  suggestions.value=[];
  clearTimeout(suggestTimer);
  const q = value.trim();
  if(!q) { result.value=null; lyricMatches.value=[]; alternatives.value=[]; searched.value=false; error.value=''; lyricError.value=''; }
  if (q.length < 2) {
    suggestions.value = [];
    return;
  }
  if(mode.value==='lyrics') return;
  suggestTimer = setTimeout(async () => {
    const replies=await Promise.allSettled(queryVariants(q).slice(0,2).map(v=>bounded(api.searchSuggest(v))));
    if(id!==suggestRequest) return;
    suggestions.value=[...new Set(replies.flatMap(r=>r.status==='fulfilled'?r.value:[]))].filter(h=>h.toLowerCase()!==q.toLowerCase()).slice(0,6);
  }, 300);
}, {flush:'sync'});

async function run() {
  const q = text.value.trim();
  if (!q) return;
  clearTimeout(suggestTimer); ++suggestRequest;
  const id=++request, current=()=>id===request;
  const lyricsOnly=mode.value==='lyrics';
  searched.value=true; error.value=''; lyricError.value='';
  result.value=null; alternatives.value=[]; lyricMatches.value=[];
  loading.value=!lyricsOnly; lyricLoading.value=false;
  async function findLyrics() {
    lyricLoading.value=true;
    try { const found=await lyricSearch(q,api,current); if(current()) lyricMatches.value=found; }
    catch { if(current()) lyricError.value='Поиск по тексту сейчас недоступен. Попробуй ещё раз.'; }
    finally { if(current()) lyricLoading.value=false; }
  }
  const automaticLyrics=q.split(/\s+/).length>=3;
  const lyricsTask=(lyricsOnly || automaticLyrics) ? findLyrics() : null;
  if(!lyricsOnly) {
    if(genius.ready) void genius.searchPeople(q);
    try {
      const found=await smartCatalog(q,api,current);
      if(!current()) return;
      result.value=found.result; alternatives.value=found.alternatives;
      void loadAvatars(found.result.artists);
      if(!lyricsTask && !found.result.tracks.length && !found.result.artists.length && !found.result.albums.length) await findLyrics();
    } catch(e) { if(current()) error.value=e instanceof Error?e.message:'Не удалось выполнить поиск'; }
    finally { if(current()) loading.value=false; }
  }
  await lyricsTask;
}

function openPerson(id: number) {
  void router.push({ name: "genius-artist", params: { id: String(id) } });
}

watch(
  () => route.query.q,
  (q) => {
    if (typeof q === "string" && q) {
      text.value = q;
      void run();
    }
  },
);

onMounted(() => {
  const q = route.query.q;
  if (typeof q === "string" && q) {
    text.value = q;
    void run();
  }
});
onBeforeUnmount(() => {
  request++; suggestRequest++;
  clearTimeout(suggestTimer);
  clearTimeout(blurTimer);
});
</script>

<style scoped>
.search-modes,.search-alternatives {display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.search-modes button,.search-alternatives button,.search-retry {border:1px solid var(--line);background:var(--surface);color:var(--fg);border-radius:18px;padding:7px 14px;cursor:pointer;font:inherit}
.search-modes button.active {background:var(--surface-2);border-color:var(--accent);color:var(--accent)}
.search-alternatives button,.search-retry {font-size:12px}
.lyric-search-hit {padding:10px 0;border-bottom:1px solid var(--line)}
.lyric-search-fragment {margin:4px 16px 8px 66px;color:var(--fg-dim);font-size:13px;white-space:pre-line;line-height:1.6;max-width:680px}
.lyric-search-unavailable {display:flex;gap:12px;align-items:center;padding:8px 16px}
.lyric-search-unavailable img {width:38px;height:38px;object-fit:cover;border-radius:6px}
</style>
