<template>
  <div class="home-discovery" :aria-busy="loading">
    <template v-if="releases.length">
      <HomeShelf id="home-new-releases" label="Новые релизы">
        <article v-for="album in releases" :key="album.id" class="home-card">
          <div class="home-card-art" :data-home-album-cover="album.id">
            <button class="home-cover-open" type="button" :aria-label="`Открыть альбом: ${album.title}`" @click="openAlbum(album, $event)">
              <img v-if="album.cover_url" :src="album.cover_url" alt="" loading="lazy" decoding="async" />
              <Icon v-else name="album" :size="38" class="faint" />
            </button>
            <HomePlayingBadge v-if="String(player.current?.album_id) === album.id" />
            <button class="home-card-play" type="button" :aria-label="`Слушать: ${album.title}`" :disabled="loadingAlbum === album.id" @click.stop="playAlbum(album)">
              <q-spinner v-if="loadingAlbum === album.id" size="18px" /><Icon v-else name="play" :size="18" />
            </button>
          </div>
          <button class="home-card-title" type="button" :title="album.title" @click="openAlbum(album, $event)"><span>{{ album.title }}</span></button>
          <p class="home-card-subtitle" :title="artistNames(album.artists)">{{ artistNames(album.artists) }}</p>
          <small v-if="releaseDateLabel(album.release_date)" class="release-date">{{ releaseDateLabel(album.release_date) }}</small>
        </article>
      </HomeShelf>
    </template>
    <section v-else-if="loading || releasesError" class="discovery-status-section" aria-labelledby="new-releases-heading">
      <div class="home-section-head"><h2 id="new-releases-heading">Новые релизы</h2></div>
      <p v-if="loading" class="discovery-loading" role="status"><q-spinner size="15px" />Загружаем релизы…</p>
    </section>
    <div v-if="releasesError" class="discovery-error" role="status"><span>{{ releasesError }}</span><button type="button" :disabled="loading" @click="load">Повторить</button></div>

    <section v-if="chart.length || loading || chartError" class="home-chart" aria-labelledby="home-chart-heading">
      <div class="home-section-head">
        <h2 id="home-chart-heading">Чарт России</h2>
        <button v-if="chart.length > 10" type="button" class="more-link" :aria-expanded="chartExpanded" aria-controls="home-chart-tracks" @click="chartExpanded = !chartExpanded"><span>{{ chartExpanded ? 'Свернуть' : 'Все треки' }}</span><Icon name="chevronRight" :size="14" /></button>
      </div>
      <div v-if="chart.length" id="home-chart-tracks" class="home-chart-tracks" :class="{ 'is-preview': !chartExpanded && chart.length > 5 }" :style="{ '--chart-rows': Math.ceil(visibleChart.length / 2) }">
        <TrackRow v-for="(track, index) in visibleChart" :key="track.id" :track="track" :index="index" :show-album="false" @play="playChart(index)" />
      </div>
      <p v-else-if="loading" class="discovery-loading" role="status"><q-spinner size="15px" />Загружаем чарт России…</p>
      <div v-if="chartError" class="discovery-error" role="status"><span>{{ chartError }}</span><button type="button" :disabled="loading" @click="load">Повторить</button></div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { Notify } from 'quasar';
import { api } from '@/api/client';
import type { DiscoveryAlbum, Track } from '@/api/types';
import { useAuthStore } from '@/stores/auth';
import { usePlayerStore } from '@/stores/player/index';
import { readCache, writeCache } from '@/lib/cache';
import { artistNames } from '@/lib/format';
import { beginAlbumCoverTransition } from '@/lib/albumCoverTransition';
import { discoveryAlbums, discoveryCacheKey, discoveryChart, releaseDateLabel } from '@/lib/homeDiscovery';
import HomeShelf from './HomeShelf.vue';
import HomePlayingBadge from './HomePlayingBadge.vue';
import Icon from '@/components/Icon.vue';
import TrackRow from '@/components/TrackRow.vue';

const router = useRouter(), auth = useAuthStore(), player = usePlayerStore();
const releases = ref<DiscoveryAlbum[]>([]), chart = ref<Track[]>([]);
const releasesError = ref(''), chartError = ref(''), loading = ref(false), chartExpanded = ref(false), loadingAlbum = ref('');
const visibleChart = computed(() => chartExpanded.value ? chart.value : chart.value.slice(0, 10));
let disposed = false, generation = 0, playbackGeneration = 0;
function account() { return auth.profile?.uid ?? null; }
function restore() {
  const releaseKey = discoveryCacheKey(account(), 'releases'), chartKey = discoveryCacheKey(account(), 'chart');
  releases.value = releaseKey ? discoveryAlbums(readCache(releaseKey)) : [];
  chart.value = chartKey ? discoveryChart(readCache(chartKey)) : [];
  releasesError.value = ''; chartError.value = ''; chartExpanded.value = false;
}
async function load() {
  const request = ++generation, uid = account(); loading.value = true;
  try {
    const data = await api.homeDiscovery();
    if (disposed || request !== generation || uid !== account()) return;
    releasesError.value = data.new_releases_error || '';
    chartError.value = data.chart_error || '';
    if (!releasesError.value) {
      releases.value = discoveryAlbums(data.new_releases);
      const key = discoveryCacheKey(uid, 'releases'); if (key) writeCache(key, releases.value);
    } else if (!releases.value.length) releases.value = discoveryAlbums(data.new_releases);
    if (!chartError.value) {
      chart.value = discoveryChart(data.chart);
      const key = discoveryCacheKey(uid, 'chart'); if (key) writeCache(key, chart.value);
    } else if (!chart.value.length) chart.value = discoveryChart(data.chart);
  } catch {
    if (disposed || request !== generation || uid !== account()) return;
    releasesError.value = 'Не удалось обновить релизы.'; chartError.value = 'Не удалось обновить чарт России.';
  } finally {
    if (!disposed && request === generation && uid === account()) loading.value = false;
  }
}
function openAlbum(album: DiscoveryAlbum, event: Event) {
  const cover = (event.currentTarget as HTMLElement | null)?.closest('.home-card')?.querySelector<HTMLElement>('.home-card-art');
  beginAlbumCoverTransition(album.id, cover ?? null, 'album');
  void router.push(`/album/${album.id}`);
}
async function playAlbum(album: DiscoveryAlbum) {
  const request = ++playbackGeneration, uid = account(); loadingAlbum.value = album.id;
  try {
    const result = await api.album(album.id);
    if (disposed || request !== playbackGeneration || uid !== account()) return;
    const tracks = result.tracks.filter(track => track.available);
    if (tracks.length) await player.playQueue(tracks, 0);
    else Notify.create({ message: 'В альбоме нет доступных треков' });
  } catch {
    if (!disposed && request === playbackGeneration && uid === account()) Notify.create({ message: 'Не удалось загрузить альбом' });
  } finally {
    if (!disposed && request === playbackGeneration) loadingAlbum.value = '';
  }
}
async function playChart(index: number) {
  ++playbackGeneration; loadingAlbum.value = '';
  const uid = account();
  try { await player.playQueue([...chart.value], index); }
  catch { if (!disposed && uid === account()) Notify.create({ message: 'Не удалось включить трек' }); }
}
watch(account, () => { ++playbackGeneration; loadingAlbum.value = ''; restore(); void load(); });
onMounted(() => { restore(); void load(); });
onBeforeUnmount(() => { disposed = true; ++generation; ++playbackGeneration; });
</script>

<style scoped>
.home-discovery:empty{display:none}.release-date{display:block;margin-top:5px;font-size:calc(11px * var(--text-scale, 1));line-height:1.4;color:var(--fg-dim)}
.home-chart-tracks{border-top:1px solid var(--line);padding-top:5px}.home-chart-tracks :deep(.row-track){min-width:0}
@container home-content (min-width: 900px) {
  .home-chart-tracks.is-preview{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));grid-template-rows:repeat(var(--chart-rows),auto);grid-auto-flow:column;column-gap:32px}
}
.discovery-error,.discovery-loading{display:flex;align-items:center;gap:10px;color:var(--fg-dim);font-size:12px;line-height:1.5;margin:10px 0 0}
.discovery-error{flex-wrap:wrap}.discovery-error button{border:0;background:transparent;color:var(--fg);padding:4px 0;font:inherit;font-size:12px;cursor:pointer;text-decoration:underline;text-underline-offset:3px}.discovery-error button:disabled{opacity:.45;cursor:default}.discovery-loading{min-height:28px}
</style>
