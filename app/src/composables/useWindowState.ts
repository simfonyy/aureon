import { onMounted, onBeforeUnmount, ref } from 'vue';
import { getCurrentWindow } from '@tauri-apps/api/window';

export function useWindowState() {
  const expanded = ref(false);
  const fullscreen = ref(false);
  const ready = ref(false);
  let disposed = false;
  let revision = 0;
  let unlisten: (() => void) | undefined;
  let ownsFullscreen = false;
  let fullscreenChange = Promise.resolve();
  async function refresh() {
    const request = ++revision;
    try {
      const win = getCurrentWindow();
      const [maximized, nativeFullscreen] = await Promise.all([win.isMaximized(), win.isFullscreen()]);
      if (disposed || request !== revision) return;
      expanded.value = maximized || nativeFullscreen;
      fullscreen.value = nativeFullscreen;
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
  function changeFullscreen(value?: boolean): Promise<void> {
    // Read the native state after the previous click completes, so rapid clicks
    // cannot both enter fullscreen or restore the wrong window placement.
    fullscreenChange = fullscreenChange.then(async () => {
      if (disposed) return;
      const win = getCurrentWindow();
      const current = await win.isFullscreen();
      const next = value ?? !current;
      if (next !== current) {
        await win.setFullscreen(next);
        ownsFullscreen = next;
      }
      await refresh();
    }).catch(() => { /* Leave the observed state unchanged if native access fails. */ });
    return fullscreenChange;
  }
  const toggleFullscreen = () => changeFullscreen();
  const exitFullscreen = () => changeFullscreen(false);
  onMounted(async () => {
    try {
      const off = await getCurrentWindow().onResized(() => { void refresh(); });
      if (disposed) off();
      else unlisten = off;
      await refresh();
    } catch {}
  });
  onBeforeUnmount(() => {
    disposed = true;
    revision++;
    unlisten?.();
    // Closing the lyrics must not leave the rest of the app in native fullscreen.
    // Other users of this composable (the titlebar) never acquire this ownership.
    fullscreenChange = fullscreenChange.then(async () => {
      if (!ownsFullscreen) return;
      const win = getCurrentWindow();
      if (await win.isFullscreen()) await win.setFullscreen(false);
      ownsFullscreen = false;
    }).catch(() => {});
  });
  return { expanded, fullscreen, ready, toggle, toggleFullscreen, exitFullscreen };
}
