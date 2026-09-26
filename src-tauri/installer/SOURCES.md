# Installer sources

Native WiX 3 WixUI_InstallDir dialogs via Tauri CLI 2.11.5.

Template: https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.11.5/crates/tauri-bundler/src/bundle/windows/msi/main.wxs

Documentation: https://v2.tauri.app/distribute/windows-installer/

Modifications: per-user installation, existing Nightlezz MSI directory lookup, Russian welcome/finish strings, logo bitmaps, original project GPL-3.0 agreement. Existing UpgradeCode retained. No manual MSI table generator.
