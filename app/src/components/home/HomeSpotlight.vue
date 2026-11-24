<template>
  <section v-if="release || recent.items.length" class="home-spotlight">
    <div v-if="release" class="spot-release" @mouseenter="hovered = true" @mouseleave="hovered = false"
      @focusin="focused = true" @focusout="onFocusOut">
      <div v-if="releases.length > 1" class="spot-nav" aria-label="Выбор релиза" role="group">
        <button type="button" aria-label="Предыдущий релиз" @click="advance(-1)"><Icon name="chevronLeft" :size="15" /></button>
        <span>{{ index + 1 }} / {{ releases.length }}</span>
        <button type="button" aria-label="Следующий релиз" @click="advance(1)"><Icon name="chevronRight" :size="15" /></button>
      </div>
      <button type="button" class="spot-open" :aria-label="'Открыть альбом ' + release.title" @click="router.push('/album/' + release.id)">
        <img v-if="release.cover_url" :key="release.id" :src="release.cover_url" alt="" />
        <span :key="release.id + '-title'" class="spot-copy">
          <small>Новый релиз</small>
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
import { computed, onBeforeUnmount, onMounted, ref, watchEffect } from 'vue';
import { useRouter } from 'vue-router';
import Icon from '@/components/Icon.vue';
import type { DiscoveryAlbum } from '@/api/types';
import { artistNames } from '@/lib/format';
import { useRecentMusicStore } from '@/stores/recentMusic';

const props = defineProps<{ releases: DiscoveryAlbum[]; loadingAlbum: string }>();
const selectedId = ref('');
const hovered = ref(false);
const focused = ref(false);
const visible = ref(false);
const index = computed(() => Math.max(0, props.releases.findIndex(album => album.id === selectedId.value)));
const release = computed(() => props.releases[index.value]);

function advance(direction: number) {
  const count = props.releases.length;
  if (count > 1) selectedId.value = props.releases[(index.value + direction + count) % count].id;
}

function onFocusOut(event: FocusEvent) {
  focused.value = event.currentTarget instanceof HTMLElement
    && event.relatedTarget instanceof Node
    && event.currentTarget.contains(event.relatedTarget);
}

function syncVisibility() {
  visible.value = !document.hidden;
}

onMounted(() => {
  syncVisibility();
  document.addEventListener('visibilitychange', syncVisibility);
});
onBeforeUnmount(() => document.removeEventListener('visibilitychange', syncVisibility));

watchEffect(onCleanup => {
  if (props.releases.length < 2 || !release.value || !visible.value || hovered.value || focused.value || props.loadingAlbum) return;
  const timer = window.setTimeout(() => advance(1), 60_000);
  onCleanup(() => clearTimeout(timer));
});
const emit = defineEmits<{ play: [album: DiscoveryAlbum] }>();
const router = useRouter();
const recent = useRecentMusicStore();
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
.spot-nav { position:absolute; z-index:1; top:12px; right:12px; display:flex; align-items:center; gap:2px; border-radius:20px; background:#111c; color:white; }
.spot-nav button { display:grid; place-items:center; width:30px; height:30px; border:0; background:transparent; color:inherit; cursor:pointer; border-radius:50%; }
.spot-nav span { font-size:11px; font-variant-numeric:tabular-nums; }
@media (prefers-reduced-motion: no-preference) {
  :global(html:not(.no-motion)) .spot-copy { animation:spot-arrive .28s ease-out; }
}
@keyframes spot-arrive { from { opacity:.4; transform:translateY(4px); } }
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
