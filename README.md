<p align="center">
  <img src="src-tauri/icons/128x128.png" width="120" alt="Aureon">
</p>

<h1 align="center">Aureon</h1>

<p align="center">
  Неофициальный клиент Яндекс Музыки для Windows
</p>

<p align="center">
  <img src="docs/badges/version.svg" alt="Версия 1.0.0" />
  <img src="docs/badges/license.svg" alt="Лицензия GPL-3.0-or-later" />
  <img src="docs/badges/windows.svg" alt="Windows x64" />
</p>
<p align="center">
  <img src="docs/badges/tauri.svg" alt="Tauri 2" />
  <img src="docs/badges/vue.svg" alt="Vue 3" />
  <img src="docs/badges/typescript.svg" alt="TypeScript 5" />
  <img src="docs/badges/rust.svg" alt="Rust 1.77.2 или новее" />
</p>


## Скриншоты

[ТЫК](docs/screenshots/INDEX.md)

## Возможности

- Поиск музыки, плейлисты, любимые треки и «Моя волна».
- Текст песни с поиском и очередью. В тексте с таймингами нажатие на строку перематывает трек. `Esc` закрывает окно текста.
- Живой или простой фон, готовые стили и свои цвета.
- Мини-плеер, эквалайзер, горячие клавиши и работа в трее.
- Текущий трек в профиле Discord.
- Версии треков без цензуры, если для них найдена замена в базе FckCensorData.

## Установка

Открой установщик `.msi` и следуй шагам мастера. При первом запуске можно выбрать фон, затем войти в аккаунт Яндекса. Фон и цвета меняются в настройках.

## Сборка из исходников

Понадобятся Windows x64, Node.js 22, Rust (MSVC) и Visual Studio Build Tools с компонентами C++ и Windows SDK.

Запусти `Build-MSI.bat` из папки проекта. Он установит зависимости и соберёт MSI. При первой сборке нужен интернет.

Установщик появится в `src-tauri/target/release/bundle/msi/`, лог сборки — в `build-logs/`.

Для ручной сборки открой Developer PowerShell for Visual Studio:

```powershell
npm ci
npm run tauri -- build --bundles msi --verbose
```

## Разработка

Интерфейс: Vue 3 и Quasar. Нативная часть: Rust и Tauri 2.

```powershell
npm ci
npm run tauri:dev
```

`npm run dev` запускает только веб-интерфейс. Воспроизведение и другие нативные функции требуют запуска через Tauri.

Проверки проекта:

```powershell
npm run build
npm test
cargo check --manifest-path src-tauri/Cargo.toml
```

## Discord

Запусти Discord и включи статус в настройках Aureon. Пустое поле Application ID использует приложение по умолчанию. Можно указать ID своего приложения Discord; токен бота не нужен.

## Сообщить об ошибке

В Issue укажи версию приложения и шаги, после которых появляется проблема. Если не собирается MSI, приложи лог из `build-logs/`. Перед отправкой убери из лога токены и личные данные.

## Благодарности

Спасибо авторам и разработчикам проектов, которые использовались в Aureon:

- [aeviww/yandex-music-client](https://github.com/aeviww/yandex-music-client) — оригинальный проект **Mashiro**, на основе которого создан Aureon
- [MarshallX/yandex-music-api](https://github.com/MarshallX/yandex-music-api) — описание неофициального API Яндекс Музыки
- [vyfor/yandex-music-rs](https://github.com/vyfor/yandex-music-rs) — схемы ответов API для Rust-части
- [Hazzz895/FckCensor](https://github.com/Hazzz895/FckCensor) — логика работы с цензурированными треками
- [Hazzz895/FckCensorData](https://github.com/Hazzz895/FckCensorData) — база ссылок на нецензурные версии
- [alexeyfv/slopless](https://github.com/alexeyfv/slopless) — база артистов с Яндекс Музыки
- [lrclib](https://github.com/tranxuanthang/lrclib) — открытая база текстов песен

Лицензия: **GPL-3.0-or-later**. См. [LICENSE](LICENSE) и [NOTICE](NOTICE). Источники и лицензия шаблона установщика указаны в [src-tauri/installer](src-tauri/installer).

Aureon не связан с ООО "Яндекс" и не является его официальным приложением.
