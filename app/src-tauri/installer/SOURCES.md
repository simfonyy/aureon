# Installer sources

Native WiX 3 WixUI_InstallDir dialogs via Tauri CLI 2.11.5.

Template: https://github.com/tauri-apps/tauri/blob/tauri-cli-v2.11.5/crates/tauri-bundler/src/bundle/windows/msi/main.wxs

Documentation: https://v2.tauri.app/distribute/windows-installer/

Modifications: per-user installation, existing Nightlezz MSI directory lookup, Russian welcome/finish strings, logo bitmaps, original project GPL-3.0 agreement. Existing UpgradeCode retained. No manual MSI table generator.

Artwork: `scripts/build/Prepare-InstallerArtwork.ps1`, using the existing Aureon icon. No version number is baked into the images.

The desktop executable links the Rust library as an rlib. It does not need a separate cdylib. Tauri CLI 2.12.4 automatically bundles DLLs from the output directory; keeping an unused cdylib there introduces a file-keyed component that is invalid for this per-user installer.
