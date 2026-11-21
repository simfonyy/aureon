import { defineConfig } from "@quasar/app-vite/wrappers";
import { fileURLToPath } from "node:url";
import { prepareFeatureAssets } from './scripts/prepare-feature-assets.mjs';

export default defineConfig(() => {
  return {
    boot: ["native", "auth"],

    css: ["app.scss"],

    extras: ["roboto-font", "material-icons"],

    build: {
      beforeDev: prepareFeatureAssets,
      beforeBuild: prepareFeatureAssets,
      extendViteConf(config) {

        config.server ??= {};
        config.server.watch = { ...config.server.watch, ignored: ["**/src-tauri/**"] };
      },
      target: {
        browser: ["es2022", "edge111", "firefox115", "chrome115", "safari15"],
        node: "node20",
      },
      typescript: {
        strict: true,
        vueShim: true,
      },
      vueRouterMode: "hash",
      distDir: "dist/spa",
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },

    devServer: {
      port: 9000,
      open: false,
    },

    framework: {
      config: {
        dark: true,
      },
      plugins: ["Notify", "Loading", "Dialog"],
    },

    animations: [],

    ssr: false,
  };
});
