<template>
  <div class="win-controls">
    <div class="win-btn" @click="minimize">
      <Icon name="minimize" :size="15" :width="1.5" />
    </div>
    <div class="win-btn" @click="toggleMaximize">
      <Icon
        :name="maximized ? 'restore' : 'maximize'"
        :size="13"
        :width="1.5"
      />
    </div>
    <div class="win-btn close" @click="close">
      <Icon name="close" :size="15" :width="1.5" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useWindowState } from "@/composables/useWindowState";
import Icon from "@/components/Icon.vue";

const { expanded: maximized, toggle: toggleMaximize } = useWindowState();

type AppWindow = {
  minimize: () => Promise<void>;
  toggleMaximize: () => Promise<void>;
  isMaximized: () => Promise<boolean>;
  close: () => Promise<void>;
};

async function appWindow(): Promise<AppWindow | null> {
  try {
    const mod = await import("@tauri-apps/api/window");
    return mod.getCurrentWindow() as unknown as AppWindow;
  } catch {
    return null;
  }
}

async function minimize() {
  const win = await appWindow();
  await win?.minimize();
}


async function close() {
  const win = await appWindow();
  await win?.close();
}

</script>
