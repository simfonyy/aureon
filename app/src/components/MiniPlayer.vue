<template>
  <div
    class="mini-player"
    :class="{ 'has-viz': ui.settings.miniVisualizer, 'mini-layout-preview': preview, 'mini-quiet': quiet }"
    :style="rootStyle"
    @mousedown="onRootMouseDown"
    @contextmenu="onContext"
  >
    <canvas
      v-if="ui.settings.miniVisualizer"
      ref="vizCanvas"
      class="mini-visualizer"
    />

    <div class="mini-top" @dblclick="leaveMini()">
      <div class="cover mini-cover">
        <Transition name="pb-cover">
          <img
            v-if="player.current?.cover_url"
            :key="player.current.cover_url"
            :src="player.current.cover_url"
            decoding="async"
            alt=""
          />
          <Icon v-else name="note" :size="18" class="faint" />
        </Transition>
      </div>

      <div class="mini-meta">
        <Transition name="pb-swap" mode="out-in">
          <div :key="displayTitle" class="mini-title ellipsis">
            {{ displayTitle }}<AiTag :show="isAiCurrent" />
          </div>
        </Transition>
        <div class="mini-artist ellipsis" data-no-drag>
          <Transition name="pb-swap" mode="out-in">
            <ArtistsLine
              v-if="player.current"
              :key="player.current.id"
              :artists="player.current.artists"
              :limit="2"
            />
            <span v-else>Aureon</span>
          </Transition>
        </div>
        <div class="mini-seek">
          <span v-if="ui.settings.miniShowTime" class="mini-time">
            {{ formatDuration(player.progress * 1000) }}
          </span>

          <div class="mini-bar" data-no-drag>
            <div class="mini-bar-fill" :style="{ width: `${percent}%` }" aria-hidden="true">
              <span class="mini-bar-knob" />
            </div>
            <input
              class="mini-seek-input"
              type="range"
              min="0"
              :max="Math.max(player.duration, 1)"
              step=".1"
              :value="player.progress"
              :disabled="!player.duration"
              aria-label="Позиция трека"
              :aria-valuetext="formatDuration(player.progress * 1000)"
              @input="player.seek(Number(($event.target as HTMLInputElement).value))"
            />
          </div>

          <span v-if="ui.settings.miniShowTime" class="mini-time">
            {{ formatDuration(player.duration * 1000) }}
          </span>
        </div>
        <TrackMenu
          v-if="player.current"
          :context-menu="true"
          :track="player.current"
        />
      </div>

      <button
        type="button"
        class="mini-btn mini-restore"
        :class="{ 'mini-restore-preview': preview }"
        data-no-drag
        aria-label="Вернуться в обычный вид"
        @click.stop="leaveMini()"
      >
        <Icon name="restore" :size="15" />
        <q-tooltip>Обычное окно (Esc)</q-tooltip>
      </button>
    </div>

    <div class="mini-toolbar">
      <div class="mini-controls">
        <div
          v-for="id in miniButtons"
          :key="id"
          class="mini-control-slot"
          :class="{ 'mini-control-extra': !isTransport(id) }"
        >
          <button
            v-if="id === 'play'"
            type="button"
            class="mini-btn mini-play"
            data-no-drag
            :aria-label="player.isPlaying ? 'Пауза' : 'Играть'"
            @click.stop="player.toggle()"
          >
            <Transition name="ic-pop" mode="out-in">
              <q-spinner
                v-if="player.loading"
                key="load"
                size="15px"
              />
              <Icon
                v-else
                :key="player.isPlaying ? 'pause' : 'play'"
                :name="player.isPlaying ? 'pause' : 'play'"
                :size="16"
              />
            </Transition>
          </button>

          <button
            v-else-if="id === 'prev'"
            type="button"
            class="mini-btn"
            :disabled="!player.hasPrev && player.progress <= 3"
            data-no-drag
            aria-label="Предыдущий трек"
            @click.stop="player.prev()"
          >
            <Icon name="prev" :size="16" />
            <q-tooltip>Предыдущий трек</q-tooltip>
          </button>

          <button
            v-else-if="id === 'next'"
            type="button"
            class="mini-btn"
            data-no-drag
            aria-label="Следующий трек"
            @click.stop="player.next(false)"
          >
            <Icon name="next" :size="16" />
            <q-tooltip>Следующий трек</q-tooltip>
          </button>

          <button
            v-else-if="id === 'shuffle'"
            type="button"
            class="mini-btn"
            :class="{ on: player.shuffle }"
            data-no-drag
            aria-label="Перемешать"
            @click.stop="player.toggleShuffle()"
          >
            <Icon name="shuffle" :size="15" />
            <q-tooltip>Перемешать</q-tooltip>
          </button>

          <button
            v-else-if="id === 'repeat'"
            type="button"
            class="mini-btn"
            :class="{ on: player.repeat !== 'off' }"
            data-no-drag
            aria-label="Повтор"
            @click.stop="player.cycleRepeat()"
          >
            <Icon
              :name="player.repeat === 'one' ? 'repeatOne' : 'repeat'"
              :size="15"
            />
            <q-tooltip>Повтор</q-tooltip>
          </button>

          <button
            v-else-if="id === 'like'"
            type="button"
            class="mini-btn"
            :class="{ on: isLiked, dim: !player.current }"
            data-no-drag
            aria-label="Нравится"
            @click.stop="player.current && player.like()"
          >
            <Icon :name="isLiked ? 'heartFilled' : 'heart'" :size="15" />
            <q-tooltip>Нравится</q-tooltip>
          </button>

          <button
            v-else-if="id === 'dislike'"
            type="button"
            class="mini-btn"
            :class="{ dim: !player.current }"
            data-no-drag
            aria-label="Не нравится"
            @click.stop="player.current && player.dislike()"
          >
            <Icon name="heartOff" :size="15" />
            <q-tooltip>Не нравится</q-tooltip>
          </button>

          <button
            v-else-if="id === 'lyrics'"
            type="button"
            class="mini-btn"
            :class="{ on: player.showLyrics, dim: !player.current }"
            data-no-drag
            aria-label="Текст песни"
            @click.stop="player.current && player.toggleLyrics()"
          >
            <Icon name="lyrics" :size="15" />
            <q-tooltip>Текст песни</q-tooltip>
          </button>

        </div>
      </div>
      <VolumeControl :show-slider="ui.settings.miniVolumeSlider" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import Icon from "@/components/Icon.vue";
import AiTag from "@/components/AiTag.vue";
import ArtistsLine from "@/components/ArtistsLine.vue";
import TrackMenu from "@/components/TrackMenu.vue";
import VolumeControl from "@/components/player/VolumeControl.vue";
import { useVisualizer } from "@/composables/useVisualizer";
import { formatDuration } from "@/lib/format";
import { getCoverPalette, type CoverPalette } from "@/lib/coverPalette";
import { ensureAiArtists, isAiArtist } from "@/lib/aiTag";
import { startWindowDrag } from "@/lib/window";
import { useLibraryStore } from "@/stores/library";
import { usePanelsStore } from "@/stores/panels";
import { usePlayerStore } from "@/stores/player/index";
import { useUiStore } from "@/stores/ui/index";

const props = withDefaults(defineProps<{ preview?: boolean }>(), {
  preview: false,
});

const player = usePlayerStore();
const panels = usePanelsStore();
const library = useLibraryStore();
const ui = useUiStore();
const router = useRouter();

const isTransport = (id: string) => id === "prev" || id === "play" || id === "next";
const miniButtons = computed(() => {
  const buttons = ui.activeMiniButtons();
  return [...buttons.filter(isTransport), ...buttons.filter(id => !isTransport(id))];
});
const palette = ref<CoverPalette | null>(null);

watch(() => player.current?.cover_url, async (cover, _, onCleanup) => {
  let current = true;
  onCleanup(() => { current = false; });
  if (!cover) {
    palette.value = null;
    return;
  }
  const next = await getCoverPalette(cover);
  if (current) palette.value = next;
}, { immediate: true });

function onRootMouseDown(event: MouseEvent) {
  if (props.preview) return;
  startWindowDrag(event);
}

async function leaveMini() {
  if (props.preview) return;
  await panels.exitMini();
}

async function onContext(event: MouseEvent) {
  if (props.preview) return;
  const target = event.target as HTMLElement | null;
  if (target?.closest(".mini-meta, .mini-toolbar")) return;
  event.preventDefault();
  await panels.exitMini();
  await router.push({ path: "/settings", query: { section: "mini" } });
}

const primaryArtistId = computed(
  () => player.current?.artists?.[0]?.id ?? null,
);
const isAiCurrent = computed(() => isAiArtist(primaryArtistId.value));
const displayTitle = computed(
  () => player.current?.title || "Ничего не играет",
);

watch(
  () => player.current?.id,
  (id) => {
    if (!id) return;
    if (primaryArtistId.value) ensureAiArtists([primaryArtistId.value]);
  },
  { immediate: true },
);

const percent = computed(() =>
  player.duration > 0
    ? Math.min(100, (player.progress / player.duration) * 100)
    : 0,
);

const isLiked = computed(() =>
  player.current ? library.liked(player.current.id) : false,
);

const quiet = computed(() => !props.preview && ui.settings.miniHoverControls && player.isPlaying);
const vizCanvas = ref<HTMLCanvasElement | null>(null);
useVisualizer(vizCanvas, () => ui.settings.miniVisualizer, { bars: 56, accent: () => palette.value?.accent });

const rootStyle = computed(() => ({
  "--mini-h": props.preview ? `${ui.settings.miniHeight}px` : "100vh",
  "--mini-art-accent": palette.value?.accent,
}));

function onKey(event: KeyboardEvent) {
  if (event.key !== "Escape") return;
  event.preventDefault();
  void panels.exitMini();
}

onMounted(() => {
  if (props.preview) return;
  window.addEventListener("keydown", onKey);
  document.documentElement.dataset.mini = "1";
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKey);
  if (!props.preview) delete document.documentElement.dataset.mini;
});
</script>

<style scoped>
.mini-player.mini-layout-preview {
  position: absolute;
  z-index: 1;
  border-radius: 14px;
  pointer-events: none;
}
</style>
