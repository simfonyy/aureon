#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.."
if [[ "$(uname -s)" != Linux ]]; then
  echo 'Run this script on Linux (Ubuntu 22.04+ recommended).' >&2
  exit 1
fi
for tool in node cargo pkg-config; do
  command -v "$tool" >/dev/null || { echo "Missing build tool: $tool" >&2; exit 1; }
done
pkg-config --exists webkit2gtk-4.1 gtk+-3.0 || {
  echo 'Install Linux build dependencies listed in docs/DISTRIBUTION.md.' >&2
  exit 1
}
[[ -d node_modules ]] || { echo 'Install frontend dependencies first; see docs/DISTRIBUTION.md.' >&2; exit 1; }
node node_modules/@tauri-apps/cli/tauri.js build --bundles deb,appimage
echo 'Linux packages: src-tauri/target/release/bundle/{deb,appimage}'
