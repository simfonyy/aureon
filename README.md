# Aureon

Яндекс Музыка для Windows и Linux с клипами прямо в плеере. Включи трек, открой клип с обложки и убери курсор. Обложка отъедет в угол, а музыка продолжится с той же секунды.

**[Скачать Aureon](https://github.com/simfonyy/aureon/releases/latest)** · [Что нового](CHANGELOG.md) · [Сообщить о баге](https://github.com/simfonyy/aureon/issues)

[![Плеер Aureon с клипом на фоне](docs/screenshots/player.png)](docs/screenshots/player.png)

### Пока играет музыка

- **Нашёл трек для очереди?** Нажми `Ctrl+K`, введи название и нажми `Shift+Enter`. Трек сыграет следующим. Обычный `Enter` включает его сразу.
- **Помнишь только строчку?** Введи её в поиск. Когда найдёшь песню, открой текст и следи за подсветкой в такт вокалу.
- **Работаешь в другом окне?** Подтащи мини-плеер к краю экрана. Останутся обложка и полоска прогресса. Клик — пауза, колесо — громкость.
- **Вернулся к любимому клипу?** Aureon запоминает синхронизацию на этом компьютере. При следующем включении подбирать её заново не придётся.

[Главная](docs/screenshots/home.png) · [Текст поверх клипа](docs/screenshots/lyrics.png) · [Все скриншоты](docs/screenshots/INDEX.md)

### Установка

| Платформа | Что скачать |
| --- | --- |
| Windows x64 | **MSI** для установки или **portable ZIP**. Распакуй ZIP в свою папку и запусти `Aureon.exe`. |
| Linux x64 | **DEB** для Debian и Ubuntu или **AppImage**. Для AppImage разреши выполнение файла. |

Для прослушивания нужны аккаунт Яндекса и Плюс. С версии 1.2.2 Aureon на Windows сам проверяет новые стабильные релизы при запуске. Переключатель автообновления находится в настройках, в разделе «О проекте».

### А на телефоне?

В следующих обновлениях ждите **версию для Android** и **IPA для iPhone**. Когда сборки будут готовы, выложим их здесь же. Чтобы не потерять релиз, вверху страницы GitHub выбери *Watch → Custom → Releases*.

<details>
<summary><strong>Собрать из исходников</strong></summary>

Понадобятся Node.js, Rust и системные зависимости Tauri 2.

```sh
npm ci
npm run tauri:dev
```

[Зависимости и сборка пакетов](docs/DISTRIBUTION.md) · [Участие в разработке](docs/CONTRIBUTING.md)

</details>

<details>
<summary><strong>Авторы и источники</strong></summary>

Aureon вырос из [Mashiro](https://github.com/aeviww/yandex-music-client). Это неофициальный клиент. Яндекс не участвует в разработке.

Тексты предоставляют [LRCLIB](https://lrclib.net) и [Genius](https://genius.com). Если у песни есть только тайминги строк, подсветка слов приблизительная. Без таймингов доступен обычный текст.

Для работы с Яндекс Музыкой использованы [MarshalX/yandex-music-api](https://github.com/MarshalX/yandex-music-api) и [vyfor/yandex-music-rs](https://github.com/vyfor/yandex-music-rs). Фильтр AI-треков использует [Slopless](https://github.com/alexeyfv/slopless). Источники версий без цензуры — [FckCensor](https://github.com/Hazzz895/FckCensor) и [FckCensorData](https://github.com/Hazzz895/FckCensorData).

[GPL-3.0-or-later](LICENSE) · [NOTICE](NOTICE) · [Лицензия шаблона установщика](src-tauri/installer)

</details>
