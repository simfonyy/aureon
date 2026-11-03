<template>
  <q-layout
    view="hHh lpR fFf"
    class="app-shell"
    :class="{ 'queue-open': rightPanel, 'lyrics-open': lyricsVisible, 'liquid-shell': liquidActive, 'optimized-effects': ui.settings.metalQuality === 'optimized' }"
  >
    <LiquidMetalBackground v-if="liquidAvailable" v-show="!panels.hidden && !panels.mini" :suspended="panels.hidden || panels.mini || background.open" />
    <Transition name="lyrics-ambient">
      <LyricsBackdrop v-if="lyricsVisible && !panels.hidden && !panels.mini" class="lyrics-shell-backdrop" :cover="player.current?.cover_url || ''" :mode="ui.settings.lyricsBackdrop" :blur="ui.settings.lyricsBackgroundBlur" :opacity="ui.settings.lyricsBackgroundOpacity" :motion="ui.settings.lyricsMotion" />
    </Transition>
    <q-header v-if="!panels.hidden && !panels.mini" class="topbar">
      <div
        class="titlebar"
        @mousedown="startWindowDrag"
        @dblclick="toggleWindowMaximize"
      >
        <div class="topbar-search-wrap" data-no-drag>
          <div class="searchbar">
            <Icon name="search" :size="15" class="faint" />
            <input
              v-model="query"
              placeholder="Трек, артист или строчка песни"
              @keyup.enter="submitSearch"
            />
            <button type="button" class="command-shortcut" aria-label="Команды и плейлисты" @click="tools.open='commands'">Ctrl K</button>
            <div v-if="query" class="icon-btn xs round" @click="query = ''">
              <Icon name="close" :size="13" />
            </div>
          </div>
        </div>
        <div class="topbar-drag-space" />

        <div
          class="icon-btn sm round"
          :class="{ on: rightPanel }"
          @click="rightPanel = !rightPanel"
        >
          <Icon name="queue" :size="17" />
          <q-tooltip>Очередь</q-tooltip>
        </div>

        <div class="account">
          <div class="account-avatar">
            <img
              v-if="avatarUrl"
              :src="avatarUrl"
              loading="lazy"
              decoding="async"
              referrerpolicy="no-referrer"
              @error="avatarError = true"
            />
            <span v-else class="avatar-monogram">{{ accountInitial }}</span>
          </div>
          <span class="account-name ellipsis">{{ accountName }}</span>
          <Icon name="chevronDown" :size="13" class="account-chevron" />
          <q-menu class="menu" anchor="bottom right" self="top right">
            <div class="menu-body profile-menu">
              <div class="profile-head">
                <div class="profile-menu-avatar">
                  <img
                    v-if="avatarUrl"
                    :src="avatarUrl"
                    loading="lazy"
                    decoding="async"
                    referrerpolicy="no-referrer"
                    @error="avatarError = true"
                  />
                  <span v-else class="avatar-monogram">{{
                    accountInitial
                  }}</span>
                </div>
                <div class="profile-menu-id">
                  <div class="profile-menu-name ellipsis">
                    {{ accountName }}
                  </div>
                  <div class="profile-menu-sub ellipsis">{{ accountSub }}</div>
                </div>
              </div>

              <div class="menu-sep" />

              <div
                v-for="link in profileLinks"
                :key="link.to"
                class="menu-item"
                v-close-popup
                @click="router.push(link.to)"
              >
                <Icon :name="link.icon" :size="17" />
                <span>{{ link.label }}</span>
              </div>

              <div class="menu-sep" />

              <div class="menu-item danger" v-close-popup @click="doLogout">
                <Icon name="logout" :size="17" />
                <span>Выйти из аккаунта</span>
              </div>
            </div>
          </q-menu>
        </div>

        <WindowControls />
      </div>
    </q-header>

    <q-drawer
      v-if="!panels.hidden && !panels.mini"
      :model-value="true"
      show-if-above
      side="left"
      :width="ui.settings.sidebarWidth"
      :breakpoint="0"
      class="sidebar"
    >
      <div class="column full-height">
        <div class="brand"><span>Aureon</span></div>

        <div ref="navGroup" class="nav-group nav-group-motion">
          <motion.div
            v-if="navIndicator"
            :key="navMotionAllowed ? 'moving' : 'still'"
            class="nav-active-pill"
            :initial="false"
            :animate="navIndicator"
            :transition="navTransition"
            aria-hidden="true"
          />
          <button
            v-for="item in nav"
            :key="item.to"
            :ref="element => setNavElement(item.to, element)"
            type="button"
            class="nav nav-motion-item"
            :class="{ on: route.path === item.to }"
            :aria-current="route.path === item.to ? 'page' : undefined"
            @click="router.push(item.to)"
          >
            <Icon :name="item.icon" :size="18" />
            <span>{{ item.label }}</span>
          </button>
          <button type="button" class="nav nav-motion-item" @click="tools.open='library'"><Icon name="library" :size="18"/><span>Локальная музыка</span></button>
        </div>

        <div class="nav-sep" />

        <div class="row items-center no-wrap side-head">
          <span class="col">Плейлисты</span>
          <span class="faint t-11">{{
            library.visiblePlaylists.length || ""
          }}</span>
        </div>

        <q-scroll-area class="col">
          <PlaylistFolders />
          <div
            v-for="pl in sidebarPlaylists"
            :key="pl.kind"
            class="side-item"
            :class="{ on: route.path === `/playlists/${pl.kind}` }"
            @click="router.push(`/playlists/${pl.kind}`)"
          >
            <div
              class="cover"
              style="width: 30px; height: 30px; border-radius: 7px"
            >
              <img
                loading="lazy"
                decoding="async"
                v-if="pl.cover_url"
                :src="pl.cover_url"
              />
              <Icon v-else name="queue" :size="14" class="faint" />
            </div>
            <div class="col" style="min-width: 0">
              <div class="ellipsis t-13">{{ pl.title }}</div>
            </div>
            <Icon
              v-if="library.isPinned(pl.kind)"
              name="pin"
              :size="13"
              class="faint"
            />
            <span v-else class="faint t-11">{{ pl.track_count }}</span>

            <q-menu context-menu touch-position class="menu">
              <div class="menu-body" style="min-width: 196px">
                <div
                  class="menu-item"
                  v-close-popup
                  @click="library.togglePin(pl.kind)"
                >
                  <Icon
                    :name="library.isPinned(pl.kind) ? 'pinOff' : 'pin'"
                    :size="17"
                  />
                  <span>{{
                    library.isPinned(pl.kind) ? "Открепить" : "Закрепить"
                  }}</span>
                </div>
                <div
                  class="menu-item"
                  v-close-popup
                  @click="router.push(`/playlists/${pl.kind}`)"
                >
                  <Icon name="queue" :size="17" />
                  <span>Открыть плейлист</span>
                </div>
                <div class="menu-sep" />
                <div
                  class="menu-item"
                  v-close-popup
                  @click="library.toggleHidden(pl.kind)"
                >
                  <Icon
                    :name="library.isHidden(pl.kind) ? 'eye' : 'eyeOff'"
                    :size="17"
                  />
                  <span>{{
                    library.isHidden(pl.kind)
                      ? "Вернуть в коллекцию"
                      : "Скрыть плейлист"
                  }}</span>
                </div>
              </div>
            </q-menu>
          </div>

          <template v-if="library.hiddenPlaylists.length">
            <button
              type="button"
              class="side-hidden-toggle"
              :class="{ open: showHidden }"
              @click="showHidden = !showHidden"
            >
              <span class="side-hidden-chevron">
                <Icon name="chevronRight" :size="12" />
              </span>
              <span class="col">Скрытые</span>
              <span class="side-hidden-count">{{
                library.hiddenPlaylists.length
              }}</span>
            </button>

            <div
              v-for="pl in showHidden ? library.hiddenPlaylists : []"
              :key="`hidden-${pl.kind}`"
              class="side-item side-item-hidden"
              :class="{ on: route.path === `/playlists/${pl.kind}` }"
              @click="router.push(`/playlists/${pl.kind}`)"
            >
              <div
                class="cover"
                style="width: 30px; height: 30px; border-radius: 7px"
              >
                <img
                  loading="lazy"
                  decoding="async"
                  v-if="pl.cover_url"
                  :src="pl.cover_url"
                />
                <Icon v-else name="queue" :size="14" class="faint" />
              </div>
              <div class="col" style="min-width: 0">
                <div class="ellipsis t-13">{{ pl.title }}</div>
              </div>
              <button
                type="button"
                class="icon-btn xs"
                title="Вернуть в коллекцию"
                @click.stop="library.toggleHidden(pl.kind)"
              >
                <Icon name="eye" :size="14" />
              </button>
            </div>
          </template>

          <div
            v-if="!library.playlists.length"
            class="faint t-12 q-px-lg q-py-sm"
          >
            Пусто
          </div>
        </q-scroll-area>
      </div>
    </q-drawer>

    <q-drawer
      v-if="!panels.hidden && !panels.mini"
      v-model="rightPanel"
      side="right"
      :width="300"
      :breakpoint="0"
      class="rightbar"
    >
      <div class="column full-height" style="overflow: hidden">
        <div class="side-head">Сейчас играет</div>

        <div v-if="player.current" class="now-block">
          <div
            class="cover"
            style="width: 100%; height: 268px; border-radius: 12px"
          >
            <img
              loading="lazy"
              decoding="async"
              v-if="player.current.cover_url"
              :src="player.current.cover_url"
            />
            <Icon v-else name="note" :size="30" class="faint" />
          </div>
          <div class="q-mt-md t-15 w-600 ellipsis">
            {{ player.current.title }}
          </div>
          <div class="dim t-13 clamp-2">
            <ArtistsLine :artists="player.current.artists" :limit="2" />
          </div>
        </div>
        <div v-else class="now-empty faint t-12">Очередь пуста</div>

        <div class="side-head queue-head">
          <span class="col">Очередь</span>
          <span v-if="queueItems.length" class="faint t-11 queue-pos">
            {{ player.index + 1 }} / {{ queueItems.length }}
          </span>
          <button
            v-if="queueItems.length"
            type="button"
            class="queue-locate"
            :class="{ off: followCurrent }"
            title="Пролистать к текущему треку"
            @click="locateCurrent"
          >
            <Icon name="queue" :size="13" />
          </button>
        </div>

        <q-scroll-area
          ref="queueScroll"
          class="col queue-scroll"
          @scroll="onQueueScroll"
        >
          <div
            v-for="item in queueItems"
            :key="`${item.track.id}-${item.index}`"
            class="side-item"
            :class="{
              'is-current': item.index === player.index,
              'is-played': item.index < player.index,
            }"
            :data-queue-current="item.index === player.index ? '1' : null"
            @click="jumpTo(item.index)"
          >
            <div
              class="cover"
              style="width: 30px; height: 30px; border-radius: 7px"
            >
              <img
                loading="lazy"
                decoding="async"
                v-if="item.track.cover_url"
                :src="item.track.cover_url"
              />
              <Icon v-else name="note" :size="14" class="faint" />
            </div>
            <div class="col" style="min-width: 0">
              <div class="ellipsis t-13">{{ item.track.title }}</div>
              <div class="faint t-11 ellipsis">
                <ArtistsLine :artists="item.track.artists" :limit="2" />
              </div>
            </div>
            <Icon
              v-if="item.index === player.index"
              :name="player.isPlaying ? 'pause' : 'play'"
              :size="13"
              class="queue-state"
            />
            <TrackMenu :context-menu="true" :track="item.track" />
          </div>

          <div v-if="!queueItems.length" class="faint t-12 q-px-md q-py-sm">
            Очередь пуста
          </div>
        </q-scroll-area>
      </div>
    </q-drawer>

    <q-page-container
      v-if="!panels.hidden && !panels.mini"
      style="position: relative"
    >
      <router-view v-slot="{ Component, route: current }">
        <Transition name="page" mode="out-in">
          <component :is="Component" :key="current.fullPath" />
        </Transition>
      </router-view>
      <Transition name="lyrics-view" @before-leave="freezeLyricsBounds">
        <LyricsPanel
          v-if="lyricsVisible"
          :style="player.lyricsFullscreen ? undefined : lyricsBox"
          @clip-ready="lyricsClipReady = $event"
        />
      </Transition>
    </q-page-container>

    <div v-if="panels.hidden" class="tray-idle">Играет в фоновом режиме</div>

    <q-footer
      class="main-player-footer"
      :class="{ 'is-player-covered': playerFooterBlocked }"
      :inert="playerFooterBlocked"
      v-if="!panels.hidden && !panels.mini"
      style="background: var(--bg); border-top: 1px solid var(--line)"
    >
      <PlayerBar />
    </q-footer>

    <CassetteMiniPlayer v-if="panels.mini && !panels.hidden && creative.miniSkin==='cassette'" />
    <MiniPlayer v-else-if="panels.mini && !panels.hidden" />

    <TogetherDock />
    <AlbumCoverTransition />
    <FullscreenPlayer />
    <CreativeFeedback />
    <CommandPalette v-if="commandsOpen" v-model="commandsOpen" />
    <ScreenshotSearchDialog v-if="ocrOpen" v-model="ocrOpen" />
    <LibraryToolsDialog v-if="localLibraryOpen" v-model="localLibraryOpen" />
    <AudioToolsDialog v-if="audioToolsOpen" v-model="audioToolsOpen" />
    <MusicClipDialog v-if="musicClips.target" />
    <TrackLyricsDialog />
    <AppDialog />
  </q-layout>
</template>

<script setup lang="ts">
import {defineAsyncComponent} from 'vue';
import {useWorkspaceToolsStore,type WorkspaceTool} from '@/stores/workspaceTools';
import {useCreativeStore} from '@/stores/creative';
import {usePlaylistFoldersStore} from '@/stores/playlistFolders';
import {useScrobble} from '@/composables/useScrobble';
import {useMusicClipsStore} from '@/stores/musicClips';
const musicClips = useMusicClipsStore();
onBeforeUnmount(() => musicClips.reset());
const MusicClipDialog=defineAsyncComponent(()=>import('@/components/clips/MusicClipDialog.vue'));
import PlaylistFolders from '@/components/library/PlaylistFolders.vue';
import CreativeFeedback from '@/components/creative/CreativeFeedback.vue';
const CassetteMiniPlayer=defineAsyncComponent(()=>import('@/components/creative/CassetteMiniPlayer.vue'));
const CommandPalette=defineAsyncComponent(()=>import('@/components/commands/CommandPalette.vue'));
const ScreenshotSearchDialog=defineAsyncComponent(()=>import('@/components/search/ScreenshotSearchDialog.vue'));
const LibraryToolsDialog=defineAsyncComponent(()=>import('@/components/library/LibraryToolsDialog.vue'));
const AudioToolsDialog=defineAsyncComponent(()=>import('@/components/audio/AudioToolsDialog.vue'));
import { useBackgroundStore } from '@/stores/background';
import { motion } from 'motion-v';
import AlbumCoverTransition from '@/components/AlbumCoverTransition.vue';
import LiquidMetalBackground from "@/components/LiquidMetalBackground.vue";
import { isLightColor, lightThemes, themePalettes } from "@/stores/ui/themes";
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";
const tools=useWorkspaceToolsStore(),creative=useCreativeStore(),playlistFolders=usePlaylistFoldersStore();
function toolModel(name:WorkspaceTool){return computed({get:()=>tools.open===name,set:(value:boolean)=>{if(value)tools.open=name;else if(tools.open===name)tools.open='';}});}
const commandsOpen=toolModel('commands'),ocrOpen=toolModel('ocr'),localLibraryOpen=toolModel('library'),audioToolsOpen=toolModel('audio');
useScrobble();
function commandKey(event:KeyboardEvent){if((event.ctrlKey||event.metaKey)&&!event.altKey&&!event.shiftKey&&event.code==='KeyK'){if(document.querySelector('.q-dialog')&&tools.open!=='commands')return;event.preventDefault();event.stopImmediatePropagation();tools.open=tools.open==='commands'?'':'commands';}}
import { useRoute, useRouter } from "vue-router";
import ArtistsLine from "@/components/ArtistsLine.vue";
import TrackMenu from "@/components/TrackMenu.vue";
import Icon from "@/components/Icon.vue";
import FullscreenPlayer from "@/components/FullscreenPlayer.vue";
import LyricsBackdrop from "@/components/lyrics/LyricsBackdrop.vue";
import LyricsPanel from "@/components/LyricsPanel.vue";
import MiniPlayer from "@/components/MiniPlayer.vue";
import PlayerBar from "@/components/PlayerBar.vue";
import TogetherDock from "@/components/together/TogetherDock.vue";
import TrackLyricsDialog from "@/components/TrackLyricsDialog.vue";
import AppDialog from "@/components/AppDialog.vue";
import WindowControls from "@/components/WindowControls.vue";
import { trackLyricsDialog } from "@/lib/dialogs";
import {
  bindGlobalHotkeyEvents,
  bindLocalHotkeys,
  unbindGlobalHotkeyEvents,
  unbindLocalHotkeys,
} from "@/lib/hotkeys/runtime";
import { bindTrayEvents, setCloseToTray } from "@/lib/tray";
import {
  releaseStuckPointer,
  startWindowDrag,
  toggleWindowMaximize,
} from "@/lib/window";
import { useAuthStore } from "@/stores/auth";
import { useLibraryStore } from "@/stores/library";
import { useHotkeysStore } from "@/stores/hotkeys";
import { usePanelsStore } from "@/stores/panels";
import { usePlayerStore } from "@/stores/player/index";
import { useLyricsFxStore } from "@/stores/lyricsFx";
import { useUiStore } from "@/stores/ui/index";

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const player = usePlayerStore();
useLyricsFxStore();
const library = useLibraryStore();
const ui = useUiStore();
const background = useBackgroundStore();
const panels = usePanelsStore();
const liquidAvailable = computed(() => {
  const theme = ui.settings.theme;
  const background = theme === "custom" ? ui.settings.customBackground : themePalettes[theme].background;
  return ui.settings.backgroundMode === 'beauty' && ui.settings.liquidMetal && !lightThemes.has(theme) && !isLightColor(background)
    ;
});
const liquidActive=computed(()=>liquidAvailable.value&&!panels.hidden&&!panels.mini);
const hotkeys = useHotkeysStore();

const avatarError = ref(false);
watch(
  () => auth.profile?.avatar_url,
  () => {
    avatarError.value = false;
  },
);
const avatarUrl = computed(() =>
  avatarError.value ? null : auth.profile?.avatar_url || null,
);
const accountName = computed(
  () => auth.profile?.display_name || auth.profile?.login || "Профиль",
);
const accountInitial = computed(() => {
  const src = (auth.profile?.display_name || auth.profile?.login || "").trim();
  return src ? src.charAt(0).toUpperCase() : "☺";
});
const accountLogin = computed(() => {
  const login = auth.profile?.login;
  if (!login || login === auth.profile?.display_name) return "";
  return "@" + login;
});
const accountSub = computed(() =>
  auth.profile?.has_plus
    ? "Яндекс Плюс"
    : accountLogin.value || "Яндекс Музыка",
);

const profileLinks = [
  { to: "/playlists", label: "Коллекция", icon: "library" },
  { to: "/stats", label: "Статистика", icon: "stats" },
  { to: "/settings", label: "Настройки", icon: "settings" },
];

const showHidden = ref(false);
const sidebarPlaylists = computed(() => library.visiblePlaylists.filter(p=>!playlistFolders.contains(p.kind)));

const query = ref("");
const rightPanel = computed({
  get: () => panels.queueOpen,
  set: (value: boolean) => {
    panels.queueOpen = value;
  },
});

function freezeLyricsBounds(element: Element) {
  const el = element as HTMLElement;
  const bounds = el.getBoundingClientRect();
  Object.assign(el.style, { position: 'fixed', top: `${bounds.top}px`, left: `${bounds.left}px`, width: `${bounds.width}px`, height: `${bounds.height}px`, right: 'auto', bottom: 'auto' });
}

const lyricsVisible = computed(() => player.showLyrics && !!player.current);
const lyricsClipReady = ref(false);
watch(() => [lyricsVisible.value, player.current?.id] as const, () => { lyricsClipReady.value = false; }, { flush: 'sync' });

function guardFooterDuringPlayerOverlay() {
  const blocked = ref(false);
  let releaseTimer: ReturnType<typeof setTimeout> | undefined;
  let releaseVersion = 0;
  function clearRelease() { releaseVersion++; if (releaseTimer !== undefined) clearTimeout(releaseTimer); releaseTimer = undefined; }
  watch(() => player.fullscreen || lyricsVisible.value, open => {
    clearRelease();
    if (open) { blocked.value = true; return; }
    // Both overlay leave transitions take at most 320ms. Keep clicks and Tab
    // out of the lower player until the fading overlay has actually left.
    const version = releaseVersion;
    if (blocked.value) releaseTimer = setTimeout(() => {
      if (version !== releaseVersion) return;
      releaseTimer = undefined;
      if (!player.fullscreen && !lyricsVisible.value) blocked.value = false;
    }, 340);
  }, { immediate: true, flush: 'sync' });
  onBeforeUnmount(clearRelease);
  return blocked;
}
const playerFooterBlocked = guardFooterDuringPlayerOverlay();

const lyricsBox = computed(() => ({
  top: "40px",
  bottom: lyricsClipReady.value && ui.settings.musicVideoBackground ? "0px" : "77px",
  left: lyricsClipReady.value && ui.settings.musicVideoBackground ? "0px" : `${ui.settings.sidebarWidth}px`,
  right: lyricsClipReady.value && ui.settings.musicVideoBackground ? "0px" : rightPanel.value ? "300px" : "0px",
}));

const nav = [
  { to: "/", label: "Главное", icon: "home" },
  { to: "/search", label: "Поиск", icon: "search" },
  { to: "/wave", label: "Моя волна", icon: "wave" },
  { to: "/liked", label: "Мне нравится", icon: "heart" },
  { to: "/playlists", label: "Коллекция", icon: "library" },
  { to: "/library", label: "Поиск в библиотеке", icon: "filter" },
  { to: "/stats", label: "Статистика", icon: "stats" },
];

const navGroup = ref<HTMLElement | null>(null);
const navElements = new Map<string, HTMLElement>();
const navIndicator = ref<{ top: number; left: number; width: number; height: number } | null>(null);
const navMotionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
const navReducedMotion = ref(navMotionPreference.matches);
const navMotionAllowed = computed(() => ui.settings.animations && !navReducedMotion.value);
const navTransition = computed(() => ({ type: 'tween' as const, duration: navMotionAllowed.value ? .18 : 0, ease: 'easeOut' as const }));
let navResizeObserver: ResizeObserver | undefined;

function setNavElement(path: string, element: unknown) {
  if (element instanceof HTMLElement) navElements.set(path, element);
  else navElements.delete(path);
}

function updateNavIndicator() {
  const group = navGroup.value;
  const active = navElements.get(route.path);
  if (!group || !active?.isConnected) { navIndicator.value = null; return; }
  const groupBounds = group.getBoundingClientRect();
  const itemBounds = active.getBoundingClientRect();
  navIndicator.value = {
    top: itemBounds.top - groupBounds.top,
    left: itemBounds.left - groupBounds.left,
    width: itemBounds.width,
    height: itemBounds.height,
  };
}

function updateNavMotionPreference() { navReducedMotion.value = navMotionPreference.matches; }

watch(() => route.path, () => { void nextTick(updateNavIndicator); }, { flush: 'post' });
watch(navGroup, group => {
  navResizeObserver?.disconnect();
  if (group) navResizeObserver?.observe(group);
  void nextTick(updateNavIndicator);
}, { flush: 'post' });

type ScrollAreaRef = {
  getScrollTarget: () => HTMLElement;
  setScrollPosition: (
    axis: "vertical" | "horizontal",
    offset: number,
    duration?: number,
  ) => void;
} | null;

const queueScroll = ref<ScrollAreaRef>(null);
const followCurrent = ref(true);
let autoScrolling = false;

const queueItems = computed(() =>
  (player.queue ?? []).map((track, index) => ({ track, index })),
);

function currentEl(): { target: HTMLElement; el: HTMLElement } | null {
  const area = queueScroll.value;
  if (!area?.getScrollTarget) return null;
  const target = area.getScrollTarget();
  const el = target?.querySelector<HTMLElement>('[data-queue-current="1"]');
  return target && el ? { target, el } : null;
}

async function scrollToCurrent(duration = 0) {
  await nextTick();
  const found = currentEl();
  const area = queueScroll.value;
  if (!found || !area) return;

  const { target, el } = found;
  const offset = el.offsetTop - target.clientHeight / 2 + el.clientHeight / 2;

  autoScrolling = true;
  area.setScrollPosition("vertical", Math.max(0, offset), duration);
  window.setTimeout(() => {
    autoScrolling = false;
  }, duration + 60);
}

function isCurrentVisible(): boolean {
  const found = currentEl();
  if (!found) return false;
  const { target, el } = found;
  const top = el.offsetTop - target.scrollTop;
  return top > -el.clientHeight && top < target.clientHeight;
}

function onQueueScroll() {
  if (autoScrolling) return;
  followCurrent.value = isCurrentVisible();
}

function locateCurrent() {
  followCurrent.value = true;
  void scrollToCurrent(220);
}

watch(
  () => panels.queueOpen,
  (open) => {
    if (!open) return;
    followCurrent.value = true;
    void scrollToCurrent(0);
  },
);

watch(
  () => player.index,
  () => {
    if (!panels.queueOpen || !followCurrent.value) return;
    void scrollToCurrent(260);
  },
);

function jumpTo(index: number) {
  player.index = index;
  followCurrent.value = true;
  void player.loadCurrent();
}

function submitSearch() {
  if (!query.value.trim()) return;
  void router.push({ name: "search", query: { q: query.value.trim() } });
}

async function doLogout() {
  await auth.logout();
  void router.replace("/login");
}

const hotkeyHandlers = {
  toggle: () => player.toggle(),
  mute: () => player.toggleMute(),
  seekForward: () =>
    player.seek(Math.min(player.duration || 0, player.progress + 5)),
  seekBackward: () => player.seek(Math.max(0, player.progress - 5)),
  volumeUp: () =>
    player.setVolume(Math.round(Math.min(1, player.volume + 0.05) * 100) / 100),
  volumeDown: () =>
    player.setVolume(Math.round(Math.max(0, player.volume - 0.05) * 100) / 100),
  like: () => {
    void player.like();
  },
  dislike: () => {
    void player.dislike();
  },
  repeat: () => player.cycleRepeat(),
  shuffle: () => player.toggleShuffle(),
  next: () => {
    void player.next(false);
  },
  prev: () => {
    void player.prev();
  },
  lyrics: () => player.toggleLyrics(),
  queue: () => panels.toggleQueue(),
};


onMounted(() => {
  window.addEventListener('keydown',commandKey,true);
  navMotionPreference.addEventListener('change', updateNavMotionPreference);
  navResizeObserver = new ResizeObserver(updateNavIndicator);
  if (navGroup.value) navResizeObserver.observe(navGroup.value);
  updateNavIndicator();
  hotkeys.load();
  bindLocalHotkeys((signature) => hotkeys.resolve(signature), hotkeyHandlers);
  void bindGlobalHotkeyEvents(hotkeyHandlers);
  void hotkeys.applyGlobal();
  void library.init();
  void setCloseToTray(ui.settings.minimizeToTray);
  if (ui.settings.resumeLastSession) {
    void player.restoreSession(ui.settings.resumeAutoplay);
  }
  void bindTrayEvents({
    onToggle: () => player.toggle(),
    onNext: () => {
      void player.next(false);
    },
    onPrev: () => {
      void player.prev();
    },
    onLike: () => {
      void player.like();
    },
    onHidden: () => {
      panels.queueOpen = false;
      panels.hidden = true;
      player.releaseMemory();
    },
    onShown: () => {
      panels.hidden = false;
    },
  });
});

watch(
  () => ui.settings,
  () => {
    ui.apply();
    void player.syncPresence();
    void setCloseToTray(ui.settings.minimizeToTray);
  },
  { deep: true, immediate: true },
);

function onWindowFocus() {
  releaseStuckPointer();
}

watch(
  () => route.fullPath,
  () => {
    player.closeLyrics();
    trackLyricsDialog.open = false;
    document.documentElement.dataset.route = route.path.startsWith("/settings")
      ? "settings"
      : route.path.replace(/^\//, "").split("/")[0] || "home";
  },
  { immediate: true },
);

window.addEventListener("focus", onWindowFocus);

onBeforeUnmount(() => {
  window.removeEventListener('keydown',commandKey,true);
  navResizeObserver?.disconnect();
  navMotionPreference.removeEventListener('change', updateNavMotionPreference);
  window.removeEventListener("focus", onWindowFocus);
  unbindLocalHotkeys();
  unbindGlobalHotkeyEvents();
});
</script>

<style scoped>
.main-player-footer.is-player-covered { pointer-events:none; }
.command-shortcut{border:1px solid var(--line);border-radius:5px;white-space:nowrap;background:transparent;color:var(--fg-dim);font-size:10px;padding:3px 5px;cursor:pointer}
.nav-group-motion {
  position: relative;
  isolation: isolate;
}
.nav-active-pill {
  position: absolute;
  z-index: 0;
  border-radius: var(--radius);
  background: var(--surface-2);
  box-shadow: inset 0 0 0 1px var(--line);
  pointer-events: none;
}
.nav.nav-motion-item {
  position: relative;
  z-index: 1;
  width: calc(100% - 20px);
  appearance: none;
  border: 0;
  background: transparent;
  font-family: inherit;
  text-align: left;
}
.nav.nav-motion-item:hover {
  background: var(--hover);
}
.nav.nav-motion-item.on {
  background: transparent;
  box-shadow: none;
}
.nav.nav-motion-item:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: -2px;
}
.liquid-shell .nav-active-pill {
  background: linear-gradient(130deg, rgba(186, 181, 202, .19), rgba(71, 69, 84, .2));
  box-shadow: inset 0 0 0 1px rgba(218, 208, 239, .25), inset 0 1px 0 rgba(255, 255, 255, .13);
}
.queue-head {
  display: flex;
  align-items: center;
  gap: 8px;
}
.queue-pos {
  flex: 0 0 auto;
  font-variant-numeric: tabular-nums;
}
.queue-locate {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--accent, #fa2d48);
  cursor: pointer;
  transition:
    background 0.14s ease,
    color 0.14s ease,
    opacity 0.14s ease;
}
.queue-locate:hover {
  background: var(--hover);
}
.queue-locate.off {
  color: var(--fg-dim);
  opacity: 0.5;
}
</style>

