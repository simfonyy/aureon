<template>
  <section id="settings-about" class="settings-group">
    <div class="settings-group-head">
      <h2>О проекте</h2>
      <p>Версия приложения и авторы.</p>
    </div>

    <div class="about-hero">
      <div class="about-card">
        <img class="about-avatar" src="/icons/about-avatar.jpg" alt="" width="256" height="256" />
        <div class="about-ident">
          <h3 class="about-name">Aureon</h3>
          <p class="about-sub">Клиент Яндекс Музыки для Windows</p>
          <div class="about-links about-maintainer">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 5v2"/></svg>
            <span>Разработка и поддержка — <b>Nightlezz Dev’s</b></span>
          </div>
          <div class="about-links">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m7 6-5 6 5 6m10-12 5 6-5 6m-3-16-4 20"/></svg>
            <span>Оригинальный проект: <strong>Mashiro</strong> · Автор: <a :href="AUTHOR_URL" @click.prevent="openLink(AUTHOR_URL)">elytrya (aeviww)</a></span>
          </div>
        </div>
      </div>
      <a class="about-repository" :href="REPOSITORY_URL" @click.prevent="openLink(REPOSITORY_URL)">
        <Icon name="github" :size="30" />
        <span>Репозиторий оригинального проекта</span>
        <svg class="about-repository-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12h16m-7-7 7 7-7 7"/></svg>
      </a>
    </div>

    <div class="about-rows">
      <div class="about-row">
        <span class="about-key">Версия</span>
        <span class="about-val">1.0.0</span>
      </div>
      <div class="about-row">
        <span class="about-key">Лицензия</span>
        <span class="about-val">
          <a :href="LICENSE_URL" @click.prevent="openLink(LICENSE_URL)"
            >GPL-3.0-or-later</a
          >
        </span>
      </div>
      <div class="about-row">
        <span class="about-key">Авторство</span>
        <span class="about-val">
          ООО «Яндекс» к проекту отношения не имеет
        </span>
      </div>
    </div>

    <div class="about-block">
      <h3>Благодарности</h3>
      <p class="about-note">
        Библиотеки и проекты, используемые в Aureon.
      </p>
      <a
        v-for="item in credits"
        :key="item.url"
        class="credit"
        :href="item.url"
        :title="item.url"
        @click.prevent="openLink(item.url)"
      >
        <span class="credit-name">{{ item.name }}</span>
        <span class="credit-desc">{{ item.desc }}</span>
      </a>
    </div>
  </section>
</template>

<script setup lang="ts">
import { api } from "@/api/client";
import Icon from "@/components/Icon.vue";

const AUTHOR_URL = "https://github.com/aeviww";
const REPOSITORY_URL = "https://github.com/aeviww/yandex-music-client";
const LICENSE_URL = "https://www.gnu.org/licenses/gpl-3.0.html";

function openLink(url: string) {
  void api.openExternal(url);
}


const credits = [
  {
    name: "MarshalX/yandex-music-api",
    desc: "описание неофициального API Яндекс Музыки",
    url: "https://github.com/MarshalX/yandex-music-api",
  },
  {
    name: "vyfor/yandex-music-rs",
    desc: "схемы ответов API для Rust-части",
    url: "https://github.com/vyfor/yandex-music-rs",
  },
  {
    name: "Hazzz895/FckCensor",
    desc: "оттуда позаимствована логика подмены зацензуренных треков",
    url: "https://github.com/Hazzz895/FckCensor",
  },
  {
    name: "Hazzz895/FckCensorData",
    desc: "база ссылок на незацензуренные версии треков",
    url: "https://github.com/Hazzz895/FckCensorData",
  },
  {
    name: "alexeyfv/slopless",
    desc: "база артистов с музыкой, сгенерированной нейросетями",
    url: "https://github.com/alexeyfv/slopless",
  },
];
</script>

<style scoped>
.about-hero {
  container-type: inline-size;
  margin: 20px 0 26px;
  padding: clamp(18px, 3vw, 34px);
  overflow: hidden;
  border: 1px solid #ffffff10;
  border-radius: 24px;
  background: transparent;
  color: #f5f2ff;
}
.about-card {
  display: grid;
  grid-template-columns: minmax(120px, 25%) minmax(0, 1fr);
  align-items: start;
  gap: clamp(18px, 3cqw, 36px);
  margin: 0 0 30px;
}
.about-avatar {
  width: 100%;
  height: auto;
  aspect-ratio: 1;
  border-radius: 24%;
  object-fit: contain;
  filter: drop-shadow(0 12px 25px #0008);
}
.about-name {
  margin: 0 0 12px;
  font-size: clamp(38px, 8cqw, 82px);
  font-weight: 750;
  line-height: 1;
  letter-spacing: -.045em;
  color: #fff;
  background: linear-gradient(180deg, #fff 40%, #bfaaf2);
  background-clip: text;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}
.about-sub {
  font-size: clamp(13px, 2.5cqw, 24px);
  line-height: 1.45;
  color: #c7c3d9;
  margin: 0 0 18px;
}
.about-links {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  margin-top: 12px;
  font-size: clamp(12px, 2.25cqw, 22px);
  line-height: 1.5;
  color: #c7c3d9;
}
.about-links svg { width: 24px; height: 24px; flex-shrink: 0; margin-top: 3px; }
.about-links strong { color: #eeedf5; font-weight: 500; }
.about-links b, .about-links a { color: #a571ff; font-weight: 600; }
.about-links a { text-decoration: none; }
.about-repository { position: relative; display: flex; align-items: center; gap: 22px; padding: 20px 24px; border-radius: 20px; border: 1px solid #b382ff; color: #e6def8; background: linear-gradient(115deg,#ad70ff12,#ffffff05); box-shadow: inset 0 0 20px #9c63ff0b, 0 0 20px #9454ff12; text-decoration: none; font-size: clamp(14px,2.7cqw,25px); line-height: 1.4; transition: background 180ms, box-shadow 180ms; }
.about-repository::after { content: ''; pointer-events: none; position: absolute; bottom: -1px; left: 55%; width: 22%; height: 2px; background: #e8dbff; box-shadow: 0 0 12px 2px #a771ff; }
.about-repository > .ic { flex-shrink: 0; }
.about-repository-arrow { width: 25px; height: 25px; flex-shrink: 0; margin-left: auto; transition: transform 180ms; }
.about-repository:hover { background: #a875ff1c; box-shadow: 0 0 24px #a771ff20; }
.about-repository:hover .about-repository-arrow { transform: translateX(3px); }
.about-repository:focus-visible, .about-links a:focus-visible { outline: 2px solid #cfaeff; outline-offset: 4px; }
@container (max-width: 540px) {
  .about-card { grid-template-columns: 82px minmax(0,1fr); gap: 14px; margin-bottom: 22px; }
  .about-name { font-size: 38px; }
  .about-links { gap: 7px; }
  .about-links svg { width: 17px; height: 17px; }
  .about-repository { padding: 16px; gap: 12px; border-radius: 14px; }
}
@media (prefers-reduced-motion: reduce) { .about-repository, .about-repository-arrow { transition: none; } }
.about-val a,
.credit-name {
  color: var(--accent, #fa2d48);
  text-decoration: none;
  cursor: pointer;
}
.about-links a:hover,
.about-val a:hover,
.credit:hover .credit-name {
  text-decoration: underline;
}
.about-rows {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.about-row {
  display: flex;
  gap: 12px;
  font-size: 13px;
  line-height: 1.45;
}
.about-key {
  flex: 0 0 110px;
  opacity: 0.6;
}
.about-val {
  flex: 1 1 auto;
}
.about-block {
  margin-top: 26px;
  padding-top: 18px;
  border-top: 1px solid var(--line, rgba(255, 255, 255, 0.08));
}
.about-block h3 {
  margin: 0 0 4px;
  font-size: 14px;
  font-weight: 600;
}
.about-note {
  margin: 0 0 12px;
  font-size: 12px;
  opacity: 0.6;
}
.credit {
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 0;
  border-bottom: 1px solid var(--line, rgba(255, 255, 255, 0.06));
  text-decoration: none;
}
.credit:last-child {
  border-bottom: none;
}
.credit-name {
  font-size: 13px;
  font-weight: 500;
}
.credit-desc {
  font-size: 12px;
  color: var(--fg-dim);
}
</style>

