<template>
  <section id="settings-mini" class="settings-group">
    <div class="settings-group-head">
      <h2>Мини-плеер</h2>
      <p>
        Размеры и кнопки мини-плеера.
      </p>
    </div>

    <CreativePreferences />
    <div v-if="creative.miniSkin==='cassette'" class="cassette-preview"><CassetteMiniPlayer preview/></div>
    <MiniLayoutEditor v-else />

    <div class="setting-row">
      <div class="setting-copy">
        <b>Сбросить вид мини-плеера</b>
        <span>Размер окна, отступы и прозрачность вернутся к исходным.</span>
      </div>
      <button
        class="settings-reset-button"
        type="button"
        @click="ui.resetMiniLayout()"
      >
        Сбросить
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import MiniLayoutEditor from "@/components/player/MiniLayoutEditor.vue";
import CreativePreferences from '@/components/creative/CreativePreferences.vue';
import CassetteMiniPlayer from '@/components/creative/CassetteMiniPlayer.vue';
import {useCreativeStore} from '@/stores/creative';
import { useUiStore } from "@/stores/ui/index";

const ui = useUiStore();
const creative=useCreativeStore();
</script>
<style scoped>.cassette-preview{width:min(100%,460px);margin:24px 0;border-radius:12px;overflow:hidden}</style>
