# Aureon

Неофициальный плеер Яндекс Музыки для Windows и Linux. Нужен аккаунт с Плюсом.

**[Скачать Aureon](https://github.com/simfonyy/aureon/releases/latest)**

![Клип в полноэкранном плеере Aureon](docs/screenshots/player.png)

Клип включается прямо с обложки. Если убрать мышь, обложка уедет в угол и освободит кадр. Aureon запоминает синхронизацию для каждого трека.

Мини-плеер можно прицепить к краю рабочего стола. Щелчок по обложке ставит трек на паузу, колесо меняет громкость. Через `Ctrl+K` можно найти песню, а через `Shift+Enter` — поставить её следующей.

## Установка

### Windows

1. Нажми **Скачать Aureon** в начале страницы. Откроется последний релиз.
2. Прокрути до **Assets**. Если список свёрнут, нажми на стрелку рядом с **Assets**.
3. Нажми на файл с окончанием `_x64_ru-RU.msi`. Это установщик для 64-битной Windows.
4. Открой скачанный файл из папки **Загрузки**. Нажми **Далее** и пройди шаги мастера. В конце отметь **Запустить Aureon** и нажми **Готово**.
5. Войди в свой аккаунт Яндекс Музыки. В следующий раз плеер можно открыть из меню **Пуск**.

**Хочешь portable?** В том же списке скачай файл с окончанием `_windows-x64_portable.zip`. Щёлкни по нему правой кнопкой, выбери **Извлечь все…** и укажи папку, где будет лежать плеер. Открой эту папку и дважды щёлкни по `Aureon.exe`.

Если у тебя 1.2.0 или 1.2.1, один раз обновись вручную тем же способом. С версии 1.2.2 Aureon сам проверяет обновления при запуске.

<details>
<summary><strong>Установка на Linux</strong></summary>

Для Ubuntu или Debian скачай из **Assets** файл с окончанием `_amd64.deb`. Открой терминал в папке с файлом. Для версии 1.2.2 команда такая:

```bash
sudo apt install ./Aureon_1.2.2_amd64.deb
```

После установки найди **Aureon** в меню приложений. Если предпочитаешь запуск из одной папки, скачай файл `.AppImage` и выполни в его папке:

```bash
chmod +x ./Aureon_1.2.2_amd64.AppImage
./Aureon_1.2.2_amd64.AppImage
```

Для другого релиза подставь имя скачанного файла.

</details>

## Android и iPhone

В следующих обновлениях планирую выложить версию для Android и `.ipa` для iPhone. Обе появятся здесь же, в Releases. Не теряйте :)

## Как собрать самому

<details>
<summary><strong>Windows · собрать свой MSI</strong></summary>

1. Установи Git, Node.js 22 с npm и Rust через rustup. В установщике Rust выбери стандартный вариант для Windows x64 (MSVC).
2. В Visual Studio Installer установи **Build Tools** с набором **Разработка классических приложений на C++**. Оставь выбранными компилятор MSVC для x64 и Windows SDK. Для запуска плеера нужен Microsoft Edge WebView2 Runtime.
3. Открой новое окно PowerShell в папке, где хочешь хранить проект, и выполни:

```powershell
git clone https://github.com/simfonyy/aureon.git
cd aureon/app
.\scripts\build\Build-MSI.bat
```

Скрипт сам установит зависимости проекта и соберёт плеер. Первый запуск может занять время. Когда сборка закончится, откроется Проводник с готовым установщиком из `app/src-tauri/target/release/bundle/msi/`. Сам плеер лежит в `app/src-tauri/target/release/Aureon.exe`. Если сборка остановилась с ошибкой, полный вывод лежит в `app/build-logs/`.

Чтобы посмотреть изменения во время разработки, запусти `npm.cmd run tauri:dev` из папки `aureon/app`. Остановить этот режим можно через `Ctrl+C`.

</details>

<details>
<summary><strong>Linux · собрать DEB и AppImage</strong></summary>

Релизные пакеты собираются на Ubuntu 22.04 x64. Установи Node.js 22 с npm и Rust stable через rustup. Затем открой терминал и установи библиотеки для сборки и воспроизведения музыки:

```bash
sudo apt update
sudo apt install git build-essential curl wget file pkg-config patchelf xdg-utils \
  libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libssl-dev \
  libsecret-1-dev libdbus-1-dev libfuse2 gstreamer1.0-plugins-base \
  gstreamer1.0-plugins-good gstreamer1.0-plugins-bad gstreamer1.0-libav
```

Скачай исходники и запусти сборку:

```bash
git clone https://github.com/simfonyy/aureon.git
cd aureon/app
npm ci
bash scripts/build/Build-Linux.sh
```

Готовый пакет для установки лежит в `app/src-tauri/target/release/bundle/deb/`, а файл для запуска без установки — в `app/src-tauri/target/release/bundle/appimage/`. Для разработки из той же папки проекта запусти `npm run tauri:dev`.

</details>

<details>
<summary><strong>Авторы и источники</strong></summary>

Aureon вырос из [Mashiro](https://github.com/aeviww/yandex-music-client). Это неофициальный клиент. Яндекс не участвует в разработке.

Тексты предоставляют [LRCLIB](https://lrclib.net) и [Genius](https://genius.com). Если у песни есть только тайминги строк, подсветка слов приблизительная. Без таймингов доступен обычный текст.

Для работы с Яндекс Музыкой использованы [MarshalX/yandex-music-api](https://github.com/MarshalX/yandex-music-api) и [vyfor/yandex-music-rs](https://github.com/vyfor/yandex-music-rs). Фильтр AI-треков использует [Slopless](https://github.com/alexeyfv/slopless). Источники версий без цензуры — [FckCensor](https://github.com/Hazzz895/FckCensor) и [FckCensorData](https://github.com/Hazzz895/FckCensorData).

Aureon распространяется под [GPL-3.0-or-later](LICENSE). Уведомления об авторских правах собраны в [NOTICE](docs/NOTICE). Лицензия шаблона установщика лежит в [app/src-tauri/installer](app/src-tauri/installer).

</details>
