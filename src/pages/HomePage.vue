<template>
  <q-page class="home-page">
    <q-scroll-area class="home-scroll">
      <div class="home-content">
        <header class="home-topline">
          <h1>{{ greeting }}</h1>
          <button class="home-library-link" type="button" @click="router.push('/library')">
            <Icon name="search" :size="15" /><span>В библиотеке</span>
          </button>
        </header>

        <HomeQuickLaunch :playlists="visiblePlaylists" @open-wave="openWave"
          @open-playlist="openPlaylist">
          <template #playlist-menu="{ playlist }">
            <HomePlaylistMenu :pl="playlist" @play="playPlaylist" @rename="rename" @remove="removePlaylist" />
          </template>
        </HomeQuickLaunch>

        <HomeDiscovery />

        <HomeShelf v-if="picks.length" id="home-picks" label="Новое для тебя">
          <article v-for="p in picks" :key="`${p.kind}-${p.id}`" class="home-card">
            <div class="home-card-art" :class="{ round: p.kind === 'artist' }"
              :data-home-album-cover="p.kind === 'album' ? String(p.id) : undefined"
              :style="p.color ? { background: p.color } : {}">
              <button class="home-cover-open" type="button" :aria-label="`Открыть: ${p.name}`" @click="openPick(p, $event)">
                <img v-if="p.cover_url" loading="lazy" decoding="async" :src="p.cover_url" alt="" />
                <Icon v-else :name="p.kind === 'artist' ? 'person' : 'album'" :size="38" class="faint" />
              </button>
              <HomePlayingBadge v-if="p.kind === 'album' && String(player.current?.album_id) === String(p.id)" />
              <button class="home-card-play" type="button" :aria-label="`Слушать: ${p.name}`" @click.stop="playPick(p)">
                <Icon name="play" :size="18" />
              </button>
            </div>
            <button class="home-card-title" type="button" :title="p.name" @click="openPick(p, $event)"><span>{{ p.name }}</span></button>
            <p class="home-card-subtitle" :title="p.artists.length ? artistNames(p.artists) : p.description || ''">
              {{ p.artists.length ? artistNames(p.artists) : p.description }}
            </p>
                            <q-menu context-menu touch-position class="menu">
                  <div class="menu-body" style="min-width: 212px">
                    <div class="menu-item" v-close-popup @click="playPick(p)">
                      <Icon name="play" :size="17" />
                      <span>Слушать</span>
                    </div>
                    <div class="menu-item" v-close-popup @click="openPick(p)">
                      <Icon
                        :name="p.kind === 'artist' ? 'artist' : 'album'"
                        :size="17"
                      />
                      <span>{{
                        p.kind === "artist"
                          ? "Открыть артиста"
                          : "Открыть альбом"
                      }}</span>
                    </div>
                    <div class="menu-item" v-close-popup @click="waveFrom(p)">
                      <Icon name="wave" :size="17" />
                      <span>Волна по этому</span>
                    </div>
                  </div>
                </q-menu>
          </article>
        </HomeShelf>

        <HomeShelf v-if="waves.length" id="home-stations" label="Станции" more-label="Все станции" @more="openWave">
          <div v-for="w in waves" :key="w.id" class="home-station">
            <button class="home-station-open" type="button" @click="playWave(w)">
              <span class="home-station-art" :style="w.color ? { background: w.color } : {}">
                <img v-if="w.cover_url" loading="lazy" decoding="async" :src="w.cover_url" alt="" />
                <Icon v-else name="wave" :size="24" />
                <span class="home-station-play"><Icon name="play" :size="18" /></span>
              </span>
              <span class="home-station-copy"><strong :title="w.name">{{ w.name }}</strong><small :title="w.description || ''">{{ w.description }}</small></span>
            </button>
                            <q-menu context-menu touch-position class="menu">
                  <div class="menu-body" style="min-width: 200px">
                    <div class="menu-item" v-close-popup @click="playWave(w)">
                      <Icon name="play" :size="17" />
                      <span>Запустить волну</span>
                    </div>
                    <div
                      class="menu-item"
                      v-close-popup
                      @click="router.push('/wave')"
                    >
                      <Icon name="wave" :size="17" />
                      <span>Открыть страницу волны</span>
                    </div>
                  </div>
                </q-menu>
          </div>
        </HomeShelf>

        <section v-if="otherPlaylists.length" class="home-playlists" aria-labelledby="home-playlists-title">
          <div class="home-section-head">
            <h2 id="home-playlists-title">Твои плейлисты</h2>
            <button class="more-link" type="button" @click="router.push('/playlists')">
              <span>Все плейлисты</span><Icon name="chevronRight" :size="14" />
            </button>
          </div>
          <div class="home-playlist-grid">
            <div v-for="pl in otherPlaylists" :key="pl.kind" class="home-playlist-tile">
              <button class="home-playlist-open" type="button" @click="openPlaylist(pl)">
                <span class="home-playlist-art">
                  <img v-if="pl.cover_url" loading="lazy" decoding="async" :src="pl.cover_url" alt="" />
                  <Icon v-else name="queue" :size="22" />
                </span>
                <span class="home-playlist-copy">
                  <strong :title="pl.title">{{ pl.title }}</strong>
                  <small>{{ plural(pl.track_count, 'трек', 'трека', 'треков') }}</small>
                </span>
              </button>
              <button class="home-playlist-listen" type="button" :aria-label="`Слушать: ${pl.title}`" @click="playPlaylist(pl)">
                <Icon name="play" :size="16" />
              </button>
                            <HomePlaylistMenu :pl="pl" @play="playPlaylist" @rename="rename" @remove="removePlaylist" />
            </div>
          </div>
        </section>


        <div v-if="loading" class="home-loading" role="status" aria-label="Загрузка подборок"><q-spinner size="24px" color="primary" /></div>
      </div>
    </q-scroll-area>
  </q-page>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { Notify } from "quasar";
import { api } from "@/api/client";
import type { Playlist, Track, WheelItem } from "@/api/types";
import Icon from "@/components/Icon.vue";
import HomeQuickLaunch from "@/components/home/HomeQuickLaunch.vue";
import HomeDiscovery from "@/components/home/HomeDiscovery.vue";
import HomeShelf from "@/components/home/HomeShelf.vue";
import HomePlaylistMenu from "@/components/home/HomePlaylistMenu.vue";
import HomePlayingBadge from "@/components/home/HomePlayingBadge.vue";
import { beginAlbumCoverTransition, arriveHomeAlbumCoverTransition } from "@/lib/albumCoverTransition";
import { artistNames, plural } from "@/lib/format";
import { askConfirm, askText } from "@/lib/dialogs";
import { readCache, swr, writeCache } from "@/lib/cache";
import { useLibraryStore } from "@/stores/library";
import { usePlayerStore } from "@/stores/player/index";

const router = useRouter();
const player = usePlayerStore();
const library = useLibraryStore();
const playlists = ref<Playlist[]>([]);
const wheel = ref<WheelItem[]>([]);
const loading = ref(false);

const visiblePlaylists = computed(() =>
  playlists.value.filter((pl) => !library.isHidden(pl.kind)),
);
const otherPlaylists = computed(() => visiblePlaylists.value.filter((pl) => !library.isPinned(pl.kind)));

const waves = computed(() =>
  wheel.value.filter((item) => item.kind === "wave"),
);
const picks = computed(() =>
  wheel.value.filter((item) => item.kind !== "wave"),
);

const greeting = computed(() => {
  const hour = new Date().getHours();
  if (hour < 6) return "Доброй ночи";
  if (hour < 12) return "Доброе утро";
  if (hour < 18) return "Добрый день";
  return "Добрый вечер";
});

function openPlaylist(pl: Playlist) {
  void router.push(`/playlists/${pl.kind}`);
}

function openWave() {
  void router.push("/wave");
}

async function playPlaylist(pl: Playlist) {
  try {
    const tracks =
      readCache<Track[]>(`playlist.${pl.kind}`) ??
      (await api.playlistTracks(pl.kind));
    if (!tracks.length) {
      Notify.create({ message: "Плейлист пуст" });
      return;
    }
    await player.playQueue(tracks, 0);
  } catch {
    Notify.create({ message: "Не удалось загрузить плейлист" });
  }
}

async function playPick(item: WheelItem) {
  if (item.kind === "album") {
    try {
      const album = await api.album(item.id);
      if (!album.tracks.length) {
        Notify.create({ message: "В альбоме нет доступных треков" });
        return;
      }
      await player.playQueue(album.tracks, 0);
    } catch {
      Notify.create({ message: "Не удалось загрузить альбом" });
    }
    return;
  }
  waveFrom(item);
}

function waveFrom(item: WheelItem) {
  const station =
    item.kind === "artist" ? `artist:${item.id}` : `album:${item.id}`;
  void player.startWave(station, item.name);
  void router.push("/wave");
}

function playWave(item: WheelItem) {
  void player.startWave(item.station || item.id, item.name);
  void router.push("/wave");
}

function openPick(item: WheelItem, event?: Event) {
  if (item.kind === "album") {
    const card = event?.currentTarget as HTMLElement | null;
    const cover = card?.closest('.home-card')?.querySelector<HTMLElement>('.home-card-art');
    beginAlbumCoverTransition(String(item.id), cover ?? null, 'album');
    void router.push(`/album/${item.id}`);
  }
  else if (item.kind === "artist") void router.push(`/artist/${item.id}`);
}

function syncCache() {
  writeCache("home.playlists", playlists.value);
}

async function rename(pl: Playlist) {
  const next = await askText({
    title: "Переименовать плейлист",
    value: pl.title,
    placeholder: "Название плейлиста",
  });
  if (!next || next === pl.title) return;
  if (await library.renamePlaylist(pl.kind, next)) {
    pl.title = next;
    syncCache();
  }
}

async function removePlaylist(pl: Playlist) {
  const ok = await askConfirm({
    title: "Удалить плейлист?",
    message: `«${pl.title}» исчезнет из Яндекс Музыки.`,
    okLabel: "Удалить",
    danger: true,
  });
  if (!ok) return;
  if (await library.deletePlaylist(pl.kind)) {
    playlists.value = playlists.value.filter((item) => item.kind !== pl.kind);
    syncCache();
  }
}

onMounted(() => {
  playlists.value = readCache<Playlist[]>("home.playlists") ?? [];
  wheel.value = readCache<WheelItem[]>("home.wheel") ?? [];
  void nextTick(arriveHomeAlbumCoverTransition);
  loading.value = !playlists.value.length && !wheel.value.length;

  void swr<Playlist[]>("home.playlists", () => api.playlists(), {
    onData: (data) => {
      playlists.value = data;
    },
    onSettled: () => {
      loading.value = false;
    },
  });

  void swr<WheelItem[]>("home.wheel", () => api.wheel(), {
    onData: (data) => {
      wheel.value = data;
    },
    onSettled: () => {
      loading.value = false;
    },
  });
});
</script>
