import { onMounted, onBeforeUnmount, ref } from 'vue';
import { getCurrentWindow } from '@tauri-apps/api/window';

export function useWindowState() {
  const expanded = ref(false);
  const ready = ref(false);
  let disposed = false;
  let revision = 0;
  let unlisten: (() => void) | undefined;
  async function refresh() {
    const request = ++revision;
    try {
      const win = getCurrentWindow();
      const [maximized, fullscreen] = await Promise.all([win.isMaximized(), win.isFullscreen()]);
      if (disposed || request !== revision) return;
      expanded.value = maximized || fullscreen;
      ready.value = true;
    } catch { /* Browser preview has no native window. */ }
  }
  async function toggle() {
    try {
      const win = getCurrentWindow();
      if (await win.isFullscreen()) await win.setFullscreen(false);
      else await win.toggleMaximize();
      await refresh();
    } catch { /* Browser preview. */ }
  }
  onMounted(async () => {
    try {
      const off = await getCurrentWindow().onResized(() => { void refresh(); });
      if (disposed) off();
      else unlisten = off;
      await refresh();
    } catch {}
  });
  onBeforeUnmount(() => { disposed = true; unlisten?.(); });
  return { expanded, ready, toggle };
}
