<template>
  <section id="settings-discord" class="settings-group">
    <div class="settings-group-head">
      <h2>Discord</h2>
      <p>Во время трека Discord показывает прослушивание. На паузе видна карточка приложения без таймера.</p>
    </div>
    <div class="setting-row">
      <span class="setting-copy"><b>Своё приложение Discord</b><span>Чтобы использовать своё имя приложения, укажи его Application ID.</span></span>
      <button class="settings-reset-button" type="button" @click="api.openExternal('https://discord.com/developers/applications')">Открыть портал Discord</button>
    </div>

    <SettingToggle
      :model-value="ui.settings.discordEnabled"
      label="Показывать статус"
      description="Discord должен быть запущен на этом компьютере."
      @update:model-value="setEnabled"
    />

    <label class="setting-row setting-field-row">
      <span class="setting-copy">
        <b>Application ID</b>
        <span>Оставь пустым, чтобы вернуть приложение по умолчанию.</span>
      </span>
      <input
        :value="ui.settings.discordClientId"
        type="text"
        inputmode="numeric"
        spellcheck="false"
        :placeholder="DEFAULT_DISCORD_CLIENT_ID"
        @change="setClientId"
      />
    </label>

    <div class="setting-row">
      <span class="setting-copy"><b>Подпись во время воспроизведения</b><span>Показывается рядом с именем в списке участников Discord.</span></span>
      <div class="settings-choice" role="group" aria-label="Подпись во время воспроизведения">
        <button
          v-for="option in statusTitles"
          :key="option.value"
          type="button"
          :class="{ on: ui.settings.discordStatusTitle === option.value }"
          :aria-pressed="ui.settings.discordStatusTitle === option.value"
          @click="ui.set('discordStatusTitle', option.value)"
        >
          {{ option.label }}
        </button>
      </div>
    </div>

    <label
      v-for="field in textFields"
      :key="field.key"
      class="setting-row setting-field-row"
    >
      <span class="setting-copy">
        <b>{{ field.label }}</b>
        <span>{{ lockedField === field.key ? "Эта строка используется как подпись статуса." : field.hint }}</span>
      </span>
      <input
        :value="lockedField === field.key ? field.placeholder : ui.settings[field.key]"
        :disabled="lockedField === field.key"
        type="text"
        :maxlength="field.maxLength"
        :placeholder="field.placeholder"
        @change="setText(field.key, $event)"
      />
    </label>

    <SettingToggle
      :model-value="ui.settings.discordShowArtwork"
      label="Обложка трека"
      description="Обложка альбома как большая картинка статуса."
      @update:model-value="setFlag('discordShowArtwork', $event)"
    />
    <SettingToggle
      :model-value="ui.settings.discordShowTime"
      label="Таймер трека"
      description="Показывать, сколько осталось до конца трека."
      @update:model-value="setFlag('discordShowTime', $event)"
    />

    <SettingToggle
      :model-value="ui.settings.discordDownloadButton"
      label="Кнопка «Скачать Aureon»"
      description="Добавляет ссылку на релизы. Кнопку видят другие пользователи Discord."
      @update:model-value="setFlag('discordDownloadButton', $event)"
    />

    <div class="setting-row setting-row-column discord-status-row">
      <div class="discord-status">
        <span class="discord-dot" :class="statusTone" />
        <span class="setting-copy">
          <b>{{ statusTitle }}</b>
          <span>{{ statusText }}</span>
        </span>
      </div>
      <div class="discord-actions">
        <button
          class="settings-reset-button"
          type="button"
          :disabled="player.presenceReconnecting"
          @click="reconnect"
        >
          {{
            player.presenceReconnecting ? "Подключаемся…" : "Переподключиться"
          }}
        </button>
        <button class="settings-reset-button" type="button" @click="test">
          Отправить статус
        </button>
        <button
          class="settings-reset-button"
          type="button"
          :disabled="checking"
          @click="checkId"
        >
          {{ checking ? "Проверяем…" : "Проверить ID" }}
        </button>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { Notify } from "quasar";
import { api } from "@/api/client";
import SettingToggle from "@/components/settings/SettingToggle.vue";
import { usePlayerStore } from "@/stores/player/index";
import type { DiscordStatusTitle } from "@/stores/ui/defaults";
import type { InterfaceSettings } from "@/stores/ui/index";
import { DEFAULT_DISCORD_CLIENT_ID, useUiStore } from "@/stores/ui/index";

type TextKey = "discordDetails" | "discordState" | "discordButtonLabel";
type FlagKey = "discordShowArtwork" | "discordShowTime" | "discordDownloadButton";

const ui = useUiStore();
const player = usePlayerStore();
const statusTitles: Array<{ value: DiscordStatusTitle; label: string }> = [
  { value: "track", label: "Трек" },
  { value: "artist", label: "Исполнитель" },
  { value: "app", label: "Приложение" },
];
const lockedField = computed(() => ({
  track: "discordDetails",
  artist: "discordState",
  app: null,
})[ui.settings.discordStatusTitle]);

const textFields: Array<{
  key: TextKey;
  label: string;
  hint: string;
  placeholder: string;
  maxLength: number;
}> = [
  {
    key: "discordDetails",
    label: "Первая строка",
    hint: "Подстановки: {title}, {artist}, {album}",
    placeholder: "{title}",
    maxLength: 128,
  },
  {
    key: "discordState",
    label: "Вторая строка",
    hint: "Подстановки: {title}, {artist}, {album}",
    placeholder: "{artist}",
    maxLength: 128,
  },
  {
    key: "discordButtonLabel",
    label: "Текст кнопки",
    hint: "Кнопка ведёт на трек в Яндекс Музыке. Пусто - без кнопки.",
    placeholder: "Слушать в Яндекс Музыке",
    maxLength: 31,
  },
];

const statusTone = computed(() => {
  if (!ui.settings.discordEnabled) return "off";
  if (idError.value || player.presenceError) return "error";
  return player.presenceConnected ? "ok" : "waiting";
});

const statusTitle = computed(() => {
  if (!ui.settings.discordEnabled) return "Выключено";
  if (idError.value) return "Неверный Application ID";
  if (player.presenceError) return "Ошибка подключения";
  return player.presenceConnected ? "Подключено" : "Нет соединения";
});

const statusText = computed(() => {
  if (!ui.settings.discordEnabled) return "Статус не отправляется в Discord.";
  if (idError.value) return idError.value;
  if (player.presenceUser && player.presenceConnected) {
    return `Discord: ${player.presenceUser}${appName.value ? `, приложение "${appName.value}"` : ""}. Статус обновляется вместе с треком.`;
  }
  if (appName.value && player.presenceConnected) {
    return `Приложение "${appName.value}", статус обновляется вместе с треком.`;
  }
  if (player.presenceError) return player.presenceError;
  if (!player.presenceConnected)
    return "Discord не найден. Запусти его и нажми «Переподключиться».";
  return "Статус обновляется при запуске трека и при паузе.";
});

function setEnabled(value: boolean) {
  ui.set("discordEnabled", value);
  void player.syncPresence(true);
}

function setClientId(event: Event) {
  const input = event.target as HTMLInputElement;
  const value = input.value.trim() || DEFAULT_DISCORD_CLIENT_ID;
  input.value = value;
  ui.set("discordClientId", value);
  void player.syncPresence(true);
}

function setText(key: TextKey, event: Event) {
  const value = (event.target as HTMLInputElement).value;
  ui.set(key, value as InterfaceSettings[TextKey]);
  void player.syncPresence(true);
}

function setFlag(key: FlagKey, value: boolean) {
  ui.set(key, value);
  void player.syncPresence(true);
}

const checking = ref(false);
const appName = ref<string | null>(null);
const idError = ref<string | null>(null);

async function checkId() {
  checking.value = true;
  try {
    const message = await api.validateDiscordApp(
      ui.settings.discordClientId || DEFAULT_DISCORD_CLIENT_ID,
    );
    appName.value = message;
    idError.value = null;
    Notify.create({ type: "positive", message, timeout: 6000 });
  } catch (error) {
    appName.value = null;
    idError.value = String((error as Error)?.message ?? error);
    Notify.create({
      type: "negative",
      message: idError.value,
      timeout: 10000,
    });
  } finally {
    checking.value = false;
  }
}

function test() {
  void player.testPresence();
}

function reconnect() {
  void player.reconnectPresence();
}

onMounted(async () => {
  await player.refreshPresenceStatus();
  try {
    appName.value = await api.validateDiscordApp(
      ui.settings.discordClientId || DEFAULT_DISCORD_CLIENT_ID,
    );
    idError.value = null;
  } catch (error) {
    appName.value = null;
    idError.value = String((error as Error)?.message ?? error);
  }
});
</script>
