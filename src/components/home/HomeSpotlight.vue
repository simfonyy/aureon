<template>
  <section v-if="release || recent.items.length" class="home-spotlight">
    <div v-if="release" class="spot-release">
      <button type="button" class="spot-open" :aria-label="'Открыть альбом ' + release.title" @click="router.push('/album/' + release.id)">
        <img v-if="release.cover_url" :src="release.cover_url" alt="" />
        <span class="spot-copy">
          <small>{{ familiar ? 'Новое от знакомых артистов' : 'Новый релиз' }}</small>
          <strong>{{ release.title }}</strong><span>{{ artistNames(release.artists) }}</span>
        </span>
      </button>
      <button class="spot-play" type="button" :aria-label="'Слушать ' + release.title" :disabled="loadingAlbum === release.id" @click="emit('play', release)">
        <q-spinner v-if="loadingAlbum === release.id" size="18px" /><Icon v-else name="play" :size="21" />
      </button>
    </div>
    <div v-if="recent.items.length" class="spot-recent">
      <h2>Недавно слушали</h2>
      <router-link v-for="row in recent.items" :key="row.kind + row.id" :to="(row.kind === 'album' ? '/album/' : '/playlists/') + row.id">
        <img v-if="row.cover" :src="row.cover" alt="" /><Icon v-else :name="row.kind === 'album' ? 'album' : 'queue'" :size="26" />
        <span><strong>{{ row.title }}</strong><small>{{ row.kind === 'album' ? 'Альбом' : 'Плейлист' }}</small></span>
        <Icon name="chevronRight" :size="14" />
      </router-link>
    </div>
  </section>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import Icon from '@/components/Icon.vue';
import type { DiscoveryAlbum } from '@/api/types';
import { artistNames } from '@/lib/format';
import { useRecentMusicStore } from '@/stores/recentMusic';
import { useLibraryStore } from '@/stores/library';
import { useStatsStore } from '@/stores/stats';

const props = defineProps<{ releases: DiscoveryAlbum[]; loadingAlbum: string }>();
const emit = defineEmits<{ play: [album: DiscoveryAlbum] }>();
const router = useRouter(), recent = useRecentMusicStore(), library = useLibraryStore(), stats = useStatsStore();
const familiar = computed(() => {
  const artists = new Set(stats.events.filter(event => event.seconds >= 20).map(event => event.artistId));
  const names = new Set(library.likedAlbums.flatMap(album => (album.artists || '').toLowerCase().split(', ')));
  return props.releases.find(album => album.artists.some(artist => artists.has(artist.id) || names.has(artist.name.toLowerCase())));
});
const release = computed(() => familiar.value ?? props.releases[0]);
</script>
<style scoped>
.home-spotlight { display: grid; gap: 24px; margin-bottom: 22px; }
@container home-content (min-width: 700px) {
  .home-spotlight:has(.spot-release):has(.spot-recent) { grid-template-columns: minmax(0, 1.3fr) minmax(220px, 1fr); align-items: center; }
}
.spot-release { position: relative; isolation: isolate; overflow: hidden; border-radius: 14px; background: var(--surface-2); }
.spot-open { position: relative; display: flex; width: 100%; min-height: clamp(196px, 32cqw, 310px); align-items: end; padding: 24px 80px 24px 24px; border: 0; cursor: pointer; background: transparent; color: white; text-align: left; }
.spot-open img, .spot-open::after { position: absolute; z-index: -1; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.spot-open::after { content: ''; background: linear-gradient(0deg, #080809e8, #08080911 95%); }
.spot-copy { display: grid; gap: 4px; }
.spot-copy small { font-size: 12px; }
.spot-copy strong { font-size: clamp(24px, 3.8cqw, 43px); line-height: 1.06; letter-spacing: -.04em; overflow-wrap: anywhere; }
.spot-play { position: absolute; right: 20px; bottom: 22px; width: 44px; height: 44px; border: 0; border-radius: 50%; display: grid; place-items: center; background: white; color: #171719; cursor: pointer; }
.spot-recent h2 { margin: 0 0 8px; font-size: 18px; line-height: 1.4; }
.spot-recent a { display: grid; grid-template-columns: 42px minmax(0, 1fr) 16px; align-items: center; gap: 12px; padding: 6px; border-radius: 7px; color: var(--fg); text-decoration: none; }
.spot-recent a:hover { background: var(--hover); }
.spot-recent img { width: 42px; height: 42px; object-fit: cover; border-radius: 6px; }
.spot-recent strong, .spot-recent small { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.spot-recent small { color: var(--fg-dim); }
</style>
