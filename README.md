# Aureon

Неофициальный плеер Яндекс Музыки для Windows и Linux. Нужен аккаунт с Плюсом.

**[Скачать Aureon](https://github.com/simfonyy/aureon/releases/latest)**

![Клип в полноэкранном плеере Aureon](docs/screenshots/player.png)

Клип включается прямо с обложки. Если убрать мышь, обложка уедет в угол и освободит кадр. Aureon запоминает синхронизацию для каждого трека.

Мини-плеер можно прицепить к краю рабочего стола. Щелчок по обложке ставит трек на паузу, колесо меняет громкость. Через `Ctrl+K` можно найти песню, а через `Shift+Enter` — поставить её следующей.

## Установка

**Windows x64.** Скачай MSI. Для запуска без установки распакуй portable ZIP и открой `Aureon.exe`. Начиная с 1.2.2 обе версии обновляются при запуске.

**Linux x64.** Для Debian и Ubuntu есть DEB. Для AppImage дай файлу право на выполнение и запусти его.

## Android и iPhone

В следующих обновлениях планирую выложить версию для Android и `.ipa` для iPhone. Обе появятся здесь же, в Releases. Не теряйте :)

<details>
<summary><strong>Собрать из исходников</strong></summary>

Понадобятся Node.js, Rust и системные зависимости Tauri 2.

```sh
npm ci
npm run tauri:dev
```

[Инструкция по сборке](docs/DISTRIBUTION.md)

</details>

<details>
<summary><strong>Авторы и источники</strong></summary>

Aureon вырос из [Mashiro](https://github.com/aeviww/yandex-music-client). Это неофициальный клиент. Яндекс не участвует в разработке.

Тексты предоставляют [LRCLIB](https://lrclib.net) и [Genius](https://genius.com). Если у песни есть только тайминги строк, подсветка слов приблизительная. Без таймингов доступен обычный текст.

Для работы с Яндекс Музыкой использованы [MarshalX/yandex-music-api](https://github.com/MarshalX/yandex-music-api) и [vyfor/yandex-music-rs](https://github.com/vyfor/yandex-music-rs). Фильтр AI-треков использует [Slopless](https://github.com/alexeyfv/slopless). Источники версий без цензуры — [FckCensor](https://github.com/Hazzz895/FckCensor) и [FckCensorData](https://github.com/Hazzz895/FckCensorData).

Aureon распространяется под [GPL-3.0-or-later](LICENSE). Уведомления об авторских правах собраны в [NOTICE](NOTICE). Лицензия шаблона установщика лежит в [src-tauri/installer](src-tauri/installer).

</details>
