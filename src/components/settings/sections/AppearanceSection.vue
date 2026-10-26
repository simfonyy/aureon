<template>
  <section id="settings-theme" class="settings-group">
    <div class="settings-group-head">
      <h2>Оформление</h2>
      <p>Цвет выделения и своя палитра.</p>
    </div>

    <div class="setting-row"><div class="setting-copy"><b>Свои цвета</b><span>Пресеты матовой темы находятся в разделе «Фон».</span></div><button class="btn" @click="ui.useCustomTheme()">Настроить палитру</button></div>

    <div
      v-if="ui.settings.theme === 'custom'"
      class="setting-row setting-row-column"
    >
      <div class="setting-copy">
        <b>Своя палитра</b>
        <span></span>
      </div>
      <div class="custom-palette-grid">
        <ColorField
          label="Фон"
          :value="ui.settings.customBackground"
          @change="setColor('customBackground', $event)"
        />
        <ColorField
          label="Панели"
          :value="ui.settings.customSurface"
          @change="setColor('customSurface', $event)"
        />
        <ColorField
          label="Активные панели"
          :value="ui.settings.customSurface2"
          @change="setColor('customSurface2', $event)"
        />
        <ColorField
          label="Текст"
          :value="ui.settings.customText"
          @change="setColor('customText', $event)"
        />
      </div>
    </div>

    <div class="setting-row setting-row-column">
      <div class="setting-copy">
        <b>Цвет выделения</b>
        <span>Кнопки, активные пункты и индикаторы.</span>
      </div>
      <div class="settings-accent-row">
        <button
          v-for="color in accents"
          :key="color.value"
          class="settings-accent"
          :class="{ on: ui.settings.accent === color.value }"
          :title="color.label"
          :style="{ background: color.value }"
          @click="ui.set('accent', color.value)"
        >
          <Icon
            v-if="ui.settings.accent === color.value"
            name="check"
            :size="14"
          />
        </button>
        <ColorField
          label="Свой"
          :value="ui.settings.accent"
          @change="setColor('accent', $event)"
        />
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">




import ColorField from "@/components/settings/ColorField.vue";
import Icon from "@/components/Icon.vue";
import {
  accentColors,
  useUiStore,
} from "@/stores/ui/index";

const ui = useUiStore();
const accents = accentColors;

type ColorKey =
  | "accent"
  | "customBackground"
  | "customSurface"
  | "customSurface2"
  | "customText";

function setColor(key: ColorKey, value: string) {
  ui.settings[key] = value;
  if (key !== "accent") { ui.settings.theme = "custom"; ui.settings.backgroundMode = "matte"; }
  ui.apply();
}
</script>



