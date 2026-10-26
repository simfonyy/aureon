<p align="center">
  <img src="public/icons/aureon-256.png" width="88" alt="Aureon">
</p>
<h1 align="center">Aureon</h1>
<p align="center">Своя музыка.</p>
<p align="center">
  <a href="https://github.com/simfonyy/aureon/releases/latest">Скачать</a> ·
  <a href="CHANGELOG.md">Обновления</a> ·
  <a href="https://github.com/simfonyy/aureon/issues/new/choose">Сообщить о баге</a>
</p>
<p align="center">
  <img src="https://img.shields.io/github/downloads/simfonyy/aureon/total?style=flat-square&amp;label=скачиваний&amp;labelColor=252628&amp;color=786443" alt="Скачивания файлов из релизов">
</p>

![Aureon](docs/screenshots/home.png)

Неофициальный клиент Яндекс Музыки для Windows и Linux. Для прослушивания нужны аккаунт Яндекса и Плюс.

Караоке по словам, поиск по строчке и с опечатками, «Моя волна», плейлисты, мини-плеер, эквалайзер и статистика.

| Караоке | Поиск по строчке |
| --- | --- |
| [![Караоке](docs/screenshots/lyrics.png)](docs/screenshots/lyrics.png) | [![Поиск](docs/screenshots/search.png)](docs/screenshots/search.png) |

[Все скриншоты](docs/screenshots/INDEX.md)

## Скачать

| Windows x64 | Linux x64 · экспериментально |
| --- | --- |
| [Установщик MSI](https://github.com/simfonyy/aureon/releases/download/v1.0.3/Aureon_1.0.3_x64_ru-RU.msi) | [DEB](https://github.com/simfonyy/aureon/releases/download/v1.0.3/Aureon_1.0.3_amd64.deb) |
| [ZIP без установки](https://github.com/simfonyy/aureon/releases/download/v1.0.3/Aureon_1.0.3_windows-x64_portable.zip) | [AppImage](https://github.com/simfonyy/aureon/releases/download/v1.0.3/Aureon_1.0.3_amd64.AppImage) |

ZIP нужно распаковать. Для AppImage — разрешить выполнение файла. [Подробнее об установке](docs/DISTRIBUTION.md).

## Сборка

Vue 3, Quasar, Rust и Tauri 2.

~~~sh
npm ci
npm run tauri:dev
~~~

[Зависимости и сборка пакетов](docs/DISTRIBUTION.md) · [Участие в разработке](docs/CONTRIBUTING.md)

<details>
<summary>Тексты песен и источники</summary>

Тексты — [LRCLIB](https://lrclib.net) и [Genius](https://genius.com). Если есть тайминги только строк, подсветка слов приблизительная. Без таймингов показывается обычный текст.

Поиск по строчке не добавляет отсутствующие песни в каталог Яндекса. Фильтр AI-треков использует [Slopless](https://github.com/alexeyfv/slopless).

API: [MarshalX/yandex-music-api](https://github.com/MarshalX/yandex-music-api), [vyfor/yandex-music-rs](https://github.com/vyfor/yandex-music-rs). Версии без цензуры: [FckCensor](https://github.com/Hazzz895/FckCensor), [FckCensorData](https://github.com/Hazzz895/FckCensorData).

</details>

Основан на [Mashiro](https://github.com/aeviww/yandex-music-client). Спасибо! Яндекс не участвует в разработке.

[GPL-3.0-or-later](LICENSE) · [NOTICE](NOTICE) · [Лицензия шаблона установщика](src-tauri/installer)
