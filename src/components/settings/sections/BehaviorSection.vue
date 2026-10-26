<template>
  <section id="settings-behavior" class="settings-group">
    <div class="settings-group-head">
      <h2>Поведение</h2>
      <p>
        Окно, воспроизведение и фильтры.
      </p>
    </div>

    <div class="settings-subgroup">
      <div class="settings-subgroup-head">
        <h3>Визуальные эффекты</h3>
      </div>

      <SettingToggle
        v-if="ui.settings.backgroundMode === 'beauty'"
        :model-value="ui.settings.glass"
        label="Размытие панелей"
        description="Размывать фон за полупрозрачными панелями."
        @update:model-value="ui.set('glass', $event)"
      />
      <SettingSlider
        v-if="ui.settings.backgroundMode === 'beauty' && ui.settings.glass"
        label="Сила размытия"

        :model-value="ui.settings.glassBlur"
        :min="0"
        :max="40"
        :step="2"
        suffix=" px"
        @update:model-value="ui.set('glassBlur', $event)"
      />
      <SettingToggle
        :model-value="ui.settings.animations"
        label="Анимации интерфейса"
        description="Плавное появление меню и переходы между страницами."
        @update:model-value="ui.set('animations', $event)"
      />
    </div>

    <div class="settings-subgroup">
      <div class="settings-subgroup-head">
        <h3>Обложки и миниатюры</h3>
      </div>

      <SettingToggle
        :model-value="ui.settings.showPlaylistCovers"
        label="Обложки плейлистов в боковой панели"
        description="Рядом с названием каждого плейлиста показывается его миниатюра."
        @update:model-value="ui.set('showPlaylistCovers', $event)"
      />
      <SettingToggle
        :model-value="ui.settings.showPlayerArtwork"
        label="Обложка трека в нижней панели"
        description="Нажатие открывает плеер, правая кнопка — альбом."
        @update:model-value="ui.set('showPlayerArtwork', $event)"
      />
    </div>

    <div class="settings-subgroup">
      <div class="settings-subgroup-head">
        <h3>Окно и запуск</h3>
        <p>Что происходит при закрытии окна и при следующем запуске.</p>
      </div>

      <SettingToggle
        :model-value="ui.settings.minimizeToTray"
        label="Закрытие сворачивает в трей"
        description="Крестик прячет окно в системный трей, музыка продолжает играть. Полностью выйти можно через меню трея."
        @update:model-value="ui.set('minimizeToTray', $event)"
      />
      <SettingToggle
        :model-value="ui.settings.resumeLastSession"
        label="Восстанавливать очередь после запуска"
        description="Сохранять очередь, текущий трек и место остановки."
        @update:model-value="ui.set('resumeLastSession', $event)"
      />
      <SettingToggle
        v-if="ui.settings.resumeLastSession"
        :model-value="ui.settings.resumeAutoplay"
        label="Сразу продолжать воспроизведение"
        description="После запуска продолжать трек с места остановки."
        @update:model-value="ui.set('resumeAutoplay', $event)"
      />
    </div>

    <div class="settings-subgroup">
      <div class="settings-subgroup-head">
        <h3>Воспроизведение</h3>
      </div>

      <SettingToggle
        :model-value="ui.settings.autoSkipDisliked"
        label="Пропускать треки с дизлайком"
        description="Не включать треки с отметкой «Не нравится»."
        @update:model-value="ui.set('autoSkipDisliked', $event)"
      />
      <SettingToggle
        :model-value="ui.settings.trimSilence"
        label="Пропускать тишину в конце трека"
        description="Переходить к следующему треку, если в конце осталась тишина."
        @update:model-value="ui.set('trimSilence', $event)"
      />
      <div class="setting-row setting-row-column">
        <div class="setting-copy">
          <b>Когда очередь закончилась</b
          ><span>
            Остановить музыку, повторить список или продолжить волной по плейлисту.
          </span>
        </div>
        <div class="settings-choice">
          <button
            :class="{ on: queueEnd === 'stop' }"
            @click="setQueueEnd('stop')"
          >
            Остановиться
          </button>
          <button
            :class="{ on: queueEnd === 'repeat' }"
            @click="setQueueEnd('repeat')"
          >
            Повтор плейлиста
          </button>
          <button
            :class="{ on: queueEnd === 'wave' }"
            @click="setQueueEnd('wave')"
          >
            Моя волна по плейлисту
          </button>
        </div>
      </div>
    </div>

    <div class="settings-subgroup">
      <div class="settings-subgroup-head">
        <h3>Фильтры контента</h3>
        <p>Версии без цензуры и пропуск AI-треков.</p>
      </div>

      <SettingToggle
        :model-value="ui.settings.censorBypass"
        label="Обход цензуры"
        description="Включать версию без цензуры, если она есть в базе FckCensorData."
        @update:model-value="ui.set('censorBypass', $event)"
      />
      <SettingToggle
        v-if="ui.settings.censorBypass"
        :model-value="ui.settings.censorBadge"
        label="Показывать пометку о подмене"
        description="Метка «без цензуры» рядом с названием заменённого трека."
        @update:model-value="ui.set('censorBadge', $event)"
      />
      <SettingToggle
        :model-value="ui.settings.skipAiTracks"
        label="Не воспроизводить AI-треки"
        description="Пропускать отмеченные в Slopless треки без дизлайка. База может знать не обо всех AI-треках."
        @update:model-value="ui.set('skipAiTracks', $event)"
      />
      <SettingToggle
        :model-value="ui.settings.autoDislikeAi"
        label="Автодизлайк AI-треков"
        description="Ставить «Не нравится» трекам, отмеченным в Slopless, и пропускать их."
        @update:model-value="ui.set('autoDislikeAi', $event)"
      />
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import SettingSlider from "@/components/settings/SettingSlider.vue";
import SettingToggle from "@/components/settings/SettingToggle.vue";
import { useUiStore } from "@/stores/ui/index";

const ui = useUiStore();

type QueueEnd = "stop" | "repeat" | "wave";

const queueEnd = computed<QueueEnd>(() => {
  if (ui.settings.repeatPlaylistAlways) return "repeat";
  return ui.settings.autoWaveOnQueueEnd ? "wave" : "stop";
});

function setQueueEnd(mode: QueueEnd) {
  ui.set("repeatPlaylistAlways", mode === "repeat");
  ui.set("autoWaveOnQueueEnd", mode === "wave");
  if (mode === "wave") ui.set("autoWaveSource", "playlist");
}
</script>

<style scoped>
.settings-subgroup {
  margin-top: 26px;
  padding-top: 18px;
  border-top: 1px solid var(--border, rgba(255, 255, 255, 0.08));
}
.settings-subgroup:first-of-type {
  margin-top: 18px;
}
.settings-subgroup-head {
  margin-bottom: 12px;
}
.settings-subgroup-head h3 {
  margin: 0 0 4px;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.3;
}
.settings-subgroup-head p {
  margin: 0;
  font-size: 12px;
  line-height: 1.45;
  opacity: 0.6;
}
</style>
