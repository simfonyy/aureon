<template>
  <section id="settings-about" class="settings-group">
    <div class="settings-group-head"><h2>О проекте</h2></div>

    <div class="about-card">
      <img class="about-icon" src="/icons/aureon-256.png" alt="" width="96" height="96" />
      <div class="about-identity">
        <div class="about-title">
          <h3>Aureon</h3>
          <span class="about-version">{{ appVersion }}</span>
        </div>
        <p>Неофициальный клиент Яндекс Музыки.</p>
        <a :href="MAINTAINER_URL" @click.prevent="openLink(MAINTAINER_URL)">nightlezz / simfonyy</a>
      </div>
    </div>

    <div class="about-update">
      <button class="btn" :disabled="updates.checking || updates.downloading" @click="updates.check(true)">{{ updates.checking ? 'Проверяем…' : 'Проверить обновления' }}</button>
      <span role="status">{{ updates.error || (updates.checked && !updates.release ? 'Установлена последняя версия.' : updates.release ? 'Доступна версия ' + updates.release.version : 'Новые версии проверяются автоматически.') }}</span>
    </div>
    <nav class="about-actions" aria-label="Ссылки проекта">
      <a v-for="link in links" :key="link.url" :href="link.url" @click.prevent="openLink(link.url)">
        <Icon :name="link.icon" :size="17" />
        <span>{{ link.label }}</span>
        <Icon name="chevronRight" :size="13" />
      </a>
    </nav>

    <dl class="about-details">
      <div>
        <dt>Основа</dt>
        <dd><a :href="ORIGINAL_URL" @click.prevent="openLink(ORIGINAL_URL)">Mashiro</a> от <a :href="AUTHOR_URL" @click.prevent="openLink(AUTHOR_URL)">elytrya (aeviww)</a></dd>
      </div>
      <div>
        <dt>Лицензия</dt>
        <dd><a :href="LICENSE_URL" @click.prevent="openLink(LICENSE_URL)">GPL-3.0-or-later</a></dd>
      </div>
    </dl>
    <p class="about-note">Aureon — независимый проект. Яндекс не участвует в его разработке.</p>

    <div class="about-credits">
      <h3>Используемые проекты</h3>
      <a v-for="item in credits" :key="item.url" :href="item.url" @click.prevent="openLink(item.url)">
        <span class="credit-name">{{ item.name }}</span>
        <span class="credit-desc">{{ item.desc }}</span>
        <Icon name="chevronRight" :size="13" />
      </a>
    </div>
  </section>
</template>

<script setup lang="ts">
import { version as appVersion } from "../../../../package.json";
import { api } from "@/api/client";
import Icon from "@/components/Icon.vue";

import { useUpdatesStore } from '@/stores/updates';
const updates = useUpdatesStore();
const REPOSITORY_URL = "https://github.com/simfonyy/aureon";
const MAINTAINER_URL = "https://github.com/simfonyy";
const ORIGINAL_URL = "https://github.com/aeviww/yandex-music-client";
const AUTHOR_URL = "https://github.com/aeviww";
const LICENSE_URL = "https://www.gnu.org/licenses/gpl-3.0.html";
const links = [
  { label: "Исходный код", icon: "github", url: REPOSITORY_URL },
  { label: "Обновления", icon: "download", url: `${REPOSITORY_URL}/releases` },
  { label: "Сообщить о баге", icon: "info", url: `${REPOSITORY_URL}/issues/new/choose` },
];
const credits = [
  { name: "MarshalX/yandex-music-api", desc: "Описание API Яндекс Музыки", url: "https://github.com/MarshalX/yandex-music-api" },
  { name: "vyfor/yandex-music-rs", desc: "Схемы ответов API", url: "https://github.com/vyfor/yandex-music-rs" },
  { name: "FckCensor", desc: "Замена цензурированных версий", url: "https://github.com/Hazzz895/FckCensor" },
  { name: "FckCensorData", desc: "База треков без цензуры", url: "https://github.com/Hazzz895/FckCensorData" },
  { name: "Slopless", desc: "Данные об AI-музыке", url: "https://github.com/alexeyfv/slopless" },
  { name: "LRCLIB", desc: "Тексты с синхронизацией", url: "https://lrclib.net" },
  { name: "Genius", desc: "Тексты песен, разборы и участники записи", url: "https://genius.com" },
];

function openLink(url: string) {
  void api.openExternal(url);
}
</script>

<style scoped>
.about-update { display:flex; align-items:center; flex-wrap:wrap; gap:12px; margin:0 0 20px; }
.about-update span { color:var(--fg-dim); font-size:12px; }
.about-card { display: flex; align-items: center; gap: 24px; padding: 26px 0; }
.about-icon { width: 96px; height: 96px; flex-shrink: 0; object-fit: contain; }
.about-identity { min-width: 0; }
.about-title { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; }
.about-title h3 { margin: 0; color: var(--fg); font-size: 38px; font-weight: 700; line-height: 1.15; letter-spacing: -.035em; }
.about-version { padding: 4px 9px; border: 1px solid var(--line); border-radius: 7px; color: var(--fg-dim); font-size: 12px; font-variant-numeric: tabular-nums; }
.about-identity p { margin: 9px 0 6px; color: var(--fg-dim); font-size: 14px; line-height: 1.5; }
.about-identity > a { font-size: 13px; }
.about-actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 4px 0 28px; }
.about-actions a { display: inline-flex; align-items: center; gap: 8px; padding: 10px 13px; border: 1px solid var(--line); border-radius: 9px; color: var(--fg); background: var(--surface); text-decoration: none; font-size: 12px; }
.about-actions a:hover { background: var(--surface-2); }
.about-actions a > :last-child { color: var(--fg-faint); }
.about-details { margin: 0; border-top: 1px solid var(--line); }
.about-details > div { display: grid; grid-template-columns: 90px minmax(0, 1fr); gap: 16px; padding: 13px 0; border-bottom: 1px solid var(--line); font-size: 13px; line-height: 1.5; }
.about-details dt { color: var(--fg-dim); }
.about-details dd { margin: 0; }
.about-identity > a, .about-details a { color: var(--accent); text-decoration: none; }
.about-identity > a:hover, .about-details a:hover { text-decoration: underline; }
.about-note { margin: 15px 0 28px; color: var(--fg-dim); font-size: 12px; line-height: 1.6; }
.about-credits h3 { margin: 0 0 10px; font-size: 14px; font-weight: 600; }
.about-credits > a { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 3px 14px; padding: 11px 0; border-bottom: 1px solid var(--line); text-decoration: none; }
.credit-name { color: var(--fg); font-size: 13px; }
.credit-desc { grid-row: 2; color: var(--fg-dim); font-size: 12px; line-height: 1.5; }
.about-credits .ic { grid-column: 2; grid-row: 1 / 3; align-self: center; color: var(--fg-faint); }
.about-credits a:hover .credit-name { color: var(--accent); }
a:focus-visible { outline: 2px solid var(--accent); outline-offset: 4px; }
@media (max-width: 1050px) { .about-card { gap: 17px; } .about-icon { width: 72px; height: 72px; } .about-title h3 { font-size: 32px; } }
</style>
