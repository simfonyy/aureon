<template>
  <section
    class="home-quick-launch"
    :class="{ 'home-quick-still': !motionEnabled }"
    aria-label="Быстрый доступ"
  >
    <Draggable
      v-model="pinnedPlaylists"
      class="home-quick-grid"
      item-key="kind"
      draggable=".home-quick-pin"
      handle=".home-quick-handle"
      ghost-class="home-quick-ghost"
      chosen-class="home-quick-chosen"
      :animation="motionEnabled ? 160 : 0"
      :force-fallback="true"
      :fallback-tolerance="5"
      :scroll-sensitivity="60"
      @start="dragging = true"
      @end="endDrag"
    >
      <template #header>
        <button class="home-quick-tile home-quick-fixed" type="button" @click="openWave">
          <span class="home-quick-art home-quick-wave"><Icon name="wave" :size="21" /></span>
          <span class="home-quick-title">Моя волна</span>
        </button>
      </template>
      <template #item="{ element: playlist }">
        <div class="home-quick-tile home-quick-pin">
          <button
            class="home-quick-open"
            type="button"
            @click="openPlaylist(playlist)"
          >
            <span class="home-quick-art">
              <img
                v-if="playlist.cover_url && !failedCovers.has(playlist.cover_url)"
                :src="playlist.cover_url"
                alt=""
                loading="lazy"
                decoding="async"
                draggable="false"
                @error="failedCovers.add(playlist.cover_url)"
              />
              <Icon v-else name="queue" :size="19" />
            </span>
            <span class="home-quick-title">{{ playlist.title }}</span>
          </button>
          <button
            class="home-quick-handle"
            type="button"
            :aria-label="`Порядок плейлиста «${playlist.title}»`"
            :aria-describedby="keyboardHintId"
            aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown"
            title="Перетащить · Alt + стрелки"
            @click.stop
            @keydown="reorderWithKeyboard($event, playlist)"
          >
            <svg width="13" height="18" viewBox="0 0 13 18" fill="currentColor" aria-hidden="true">
              <circle v-for="point in gripPoints" :key="`${point[0]}-${point[1]}`" :cx="point[0]" :cy="point[1]" r="1" />
            </svg>
          </button>
          <slot name="playlist-menu" :playlist="playlist" />
        </div>
      </template>
    </Draggable>
    <span :id="keyboardHintId" class="home-quick-sr">Перетащите плейлист или нажмите Alt и стрелку, чтобы изменить порядок.</span>
    <span class="home-quick-sr" role="status" aria-live="polite">{{ announcement }}</span>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, useId } from "vue";
import Draggable from "vuedraggable";
import type { Playlist } from "@/api/types";
import Icon from "@/components/Icon.vue";
import { useLibraryStore } from "@/stores/library";
import { useUiStore } from "@/stores/ui";

const props = defineProps<{ playlists: Playlist[] }>();
const emit = defineEmits<{
  "open-wave": [];
  "open-playlist": [playlist: Playlist];
}>();

const library = useLibraryStore();
const ui = useUiStore();
const keyboardHintId = useId();
const gripPoints = [[4, 5], [9, 5], [4, 9], [9, 9], [4, 13], [9, 13]];
const failedCovers = reactive(new Set<string>());
const dragging = ref(false);
const reducedMotion = ref(false);
const announcement = ref("");
let suppressClickUntil = 0;
let media: MediaQueryList | undefined;
const motionEnabled = computed(() => ui.settings.animations && !reducedMotion.value);

const pinnedPlaylists = computed<Playlist[]>({
  get() {
    const order = [...new Set([...library.homePinOrder, ...library.pinned])];
    const rank = new Map(order.map((kind, index) => [kind, index]));
    const seen = new Set<number>();
    return props.playlists
      .filter((playlist) => {
        if (seen.has(playlist.kind) || !library.isPinned(playlist.kind) || library.isHidden(playlist.kind)) return false;
        seen.add(playlist.kind);
        return true;
      })
      .sort((a, b) => (rank.get(a.kind) ?? order.length) - (rank.get(b.kind) ?? order.length));
  },
  set(playlists) {
    library.setHomePinOrder(playlists.map((playlist) => playlist.kind));
  },
});

function canOpen() {
  return !dragging.value && performance.now() >= suppressClickUntil;
}

function openWave() {
  if (canOpen()) emit("open-wave");
}

function openPlaylist(playlist: Playlist) {
  if (canOpen()) emit("open-playlist", playlist);
}

function endDrag() {
  dragging.value = false;
  suppressClickUntil = performance.now() + 250;
}

function reorderWithKeyboard(event: KeyboardEvent, playlist: Playlist) {
  if (!event.altKey || event.ctrlKey || event.metaKey) return;
  const direction = ["ArrowLeft", "ArrowUp"].includes(event.key) ? -1
    : ["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : 0;
  if (!direction) return;
  event.preventDefault();
  event.stopPropagation();
  const items = [...pinnedPlaylists.value];
  const from = items.findIndex((item) => item.kind === playlist.kind);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= items.length) return;
  items.splice(from, 1);
  items.splice(to, 0, playlist);
  if (library.setHomePinOrder(items.map((item) => item.kind))) {
    announcement.value = `${playlist.title}: ${to + 1} из ${items.length}`;
  }
}

function syncMotion() {
  reducedMotion.value = media?.matches ?? false;
}

onMounted(() => {
  if (typeof window.matchMedia !== "function") return;
  media = window.matchMedia("(prefers-reduced-motion: reduce)");
  syncMotion();
  media.addEventListener("change", syncMotion);
});
onBeforeUnmount(() => media?.removeEventListener("change", syncMotion));
</script>

<style scoped lang="scss">
.home-quick-launch { container-type: inline-size; }
.home-quick-grid { display:flex;align-items:center;flex-wrap:wrap;gap:8px; }
.home-quick-tile {
  display: flex; align-items: center; gap: 12px; min-width: 0; height: 64px;
  padding: 0; border: 1px solid var(--line); border-radius: 10px;
  color: var(--fg); background: var(--surface); text-align: left;
  transition: background-color 150ms ease, border-color 150ms ease;
}
.home-quick-tile:hover, .home-quick-tile:focus-within { background: var(--hover); }
.home-quick-fixed { height:38px;padding:8px 14px;gap:8px;border-radius:9px;background:var(--accent);border-color:transparent;color:var(--bg);cursor:pointer; }
.home-quick-fixed:hover { background:color-mix(in srgb,var(--accent) 88%,var(--fg)); }
.home-quick-fixed .home-quick-art { flex-basis:20px;width:20px;height:20px;background:transparent;color:inherit; }
.home-quick-open {
  display: flex; align-items: center; flex: 1; gap: 12px; align-self: stretch;
  min-width: 0; padding: 11px 0 11px 11px; border: 0; border-radius: 9px;
  color: inherit; background: transparent; text-align: left; cursor: pointer;
}
.home-quick-art {
  display: grid; place-items: center; flex: 0 0 40px; width: 40px; height: 40px;
  overflow: hidden; border-radius: 6px; color: var(--fg-dim); background: var(--surface-2);
}
.home-quick-art img { display: block; width: 100%; height: 100%; object-fit: cover; }
.home-quick-wave { color: var(--accent); }
.home-quick-title {
  overflow: hidden; min-width: 0; font-size: 13px; font-weight: 600;
  line-height: 1.3; white-space: nowrap; text-overflow: ellipsis;
}
.home-quick-pin { gap:2px;width:210px;height:48px; }
.home-quick-pin .home-quick-art { flex-basis:30px;width:30px;height:30px; }
.home-quick-pin .home-quick-open { padding-block:8px; }
.home-quick-handle {
  display: grid; place-items: center; flex: 0 0 26px; height: 40px; padding: 0;
  margin-right: 4px; border: 0; border-radius: 5px; color: var(--fg-faint);
  background: transparent; opacity: 0; cursor: grab; touch-action: none;
  transition: opacity 150ms ease, color 150ms ease;
}
.home-quick-pin:hover .home-quick-handle, .home-quick-pin:focus-within .home-quick-handle { opacity: 1; }
.home-quick-handle:hover { color: var(--fg); }
.home-quick-handle:active { cursor: grabbing; }
.home-quick-fixed:focus-visible, .home-quick-open:focus-visible, .home-quick-handle:focus-visible {
  outline: 2px solid var(--accent); outline-offset: 3px;
}
.home-quick-ghost { opacity: .3; }
.home-quick-chosen { border-color: var(--fg-faint); }
.home-quick-sr {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0;
}
.home-quick-still .home-quick-tile, .home-quick-still .home-quick-handle { transition: none; }
@container (max-width: 700px) {
  .home-quick-pin { height:48px; }
  .home-quick-open { padding: 9px 0 9px 9px; gap: 10px; }
  .home-quick-pin { gap: 2px; }
}
@media (hover: none) { .home-quick-handle { opacity: 1; } }
@media (prefers-reduced-motion: reduce) {
  .home-quick-tile, .home-quick-handle { transition: none; }
}
</style>
