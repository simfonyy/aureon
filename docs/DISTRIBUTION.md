# Пакеты Aureon

Windows: основной выпуск — MSI из существующего фирменного установщика (русский интерфейс).
ZIP без установки содержит тот же Aureon.exe. Настройки и вход сохраняются в профиле Windows,
а не рядом с EXE: это вариант без установки, не изолированный переносимый профиль.
Для работы нужен WebView2 Runtime; MSI умеет устанавливать его.

Linux: `.deb` для Debian/Ubuntu и `.AppImage` для запуска без установки.
Настройки остаются в профиле пользователя. AppImage собирается с GStreamer для воспроизведения.
Linux-пакеты собираются в GitHub Actions на Ubuntu 22.04. Проверка установки и воспроизведения
на реальном Linux-компьютере ещё нужна, поэтому эти пакеты пока экспериментальные.

## GitHub Actions

Workflow [Desktop packages](https://github.com/simfonyy/aureon/actions/workflows/desktop-packages.yml) собирает Windows x64 (MSI и ZIP без установки) и Linux x64
(DEB и AppImage). Он запускается при push в main, build/desktop-packages, при pull request
в main, при теге v* или вручную: Actions → Desktop packages → Run workflow.

В успешном запуске скачайте Artifacts → Aureon-Windows-x64 / Aureon-Linux-x64.
Архивы хранятся 30 дней и содержат SHA256SUMS.txt. GitHub Releases автоматически не публикуются.
Пакеты без цифровой подписи. Workflow не требует личных токенов, только стандартное
разрешение чтения репозитория. Linux воспроизведение нужно дополнительно проверить на реальном ПК.

## Локальная сборка Windows

`Build-MSI.ps1` — обычная сборка. При уже установленных зависимостях: `./Build-MSI.ps1 -SkipInstall`.
Результат: `src-tauri/target/release/bundle/msi/`.

## Linux (Ubuntu 22.04+, x86_64)

Нужны Node.js 22, npm, актуальный Rust stable и системные библиотеки:

```bash
sudo apt-get update
sudo apt-get install -y build-essential curl wget file pkg-config patchelf \
  libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev libssl-dev \
  libsecret-1-dev libdbus-1-dev libfuse2 gstreamer1.0-plugins-base gstreamer1.0-plugins-good \
  gstreamer1.0-plugins-bad gstreamer1.0-libav
npm ci
bash Build-Linux.sh
```

Зависимости зафиксированы в package-lock.json. Перед публичным выпуском проверьте
проигрывание MP3/AAC/FLAC, системный трей, авторизацию и повторный запуск на целевой системе.

Tauri автоматически подхватывает `src-tauri/tauri.linux.conf.json` на Linux.
Установка `.deb`: `sudo apt install ./Aureon_*.deb`.
Запуск AppImage: `chmod +x ./Aureon*.AppImage`, затем открыть файл.

Источник требований: https://v2.tauri.app/distribute/appimage/
