<template>
                <q-menu context-menu touch-position class="menu">
                  <div class="menu-body" style="min-width: 216px">
                    <div
                      class="menu-item"
                      v-close-popup
                      @click="emit('play', pl)"
                    >
                      <Icon name="play" :size="17" />
                      <span>Слушать</span>
                    </div>
                    <div
                      class="menu-item"
                      v-close-popup
                      @click="router.push(`/playlists/${pl.kind}`)"
                    >
                      <Icon name="queue" :size="17" />
                      <span>Открыть плейлист</span>
                    </div>
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

                    <div class="menu-sep" />

                    <div class="menu-item" v-close-popup @click="emit('rename', pl)">
                      <Icon name="name" :size="17" />
                      <span>Переименовать</span>
                    </div>
                    <div
                      class="menu-item"
                      v-close-popup
                      @click="library.setPlaylistPublic(pl.kind, true)"
                    >
                      <Icon name="share" :size="17" />
                      <span>Сделать публичным</span>
                    </div>
                    <div
                      class="menu-item"
                      v-close-popup
                      @click="library.setPlaylistPublic(pl.kind, false)"
                    >
                      <Icon name="person" :size="17" />
                      <span>Сделать личным</span>
                    </div>

                    <div class="menu-sep" />

                    <div
                      class="menu-item danger"
                      v-close-popup
                      @click="emit('remove', pl)"
                    >
                      <Icon name="trash" :size="17" />
                      <span>Удалить плейлист</span>
                    </div>
                  </div>
                </q-menu>
</template>
<script setup lang="ts">
import { useRouter } from "vue-router";
import Icon from "@/components/Icon.vue";
import { useLibraryStore } from "@/stores/library";
import type { Playlist } from "@/api/types";
defineProps<{ pl: Playlist }>();
const emit = defineEmits<{ play: [pl: Playlist]; rename: [pl: Playlist]; remove: [pl: Playlist] }>();
const library = useLibraryStore();
const router = useRouter();
</script>
