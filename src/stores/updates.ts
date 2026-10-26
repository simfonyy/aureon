import { defineStore } from 'pinia';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { readSchedule, shouldCheck, UPDATE_SNOOZE } from '@/lib/updateSchedule';
import { api } from '@/api/client';

interface Release { version: string; releaseUrl: string; packageName: string | null; canInstall: boolean }
const KEY = 'aureon.updates.v1';
function savedSchedule() {
  try { return readSchedule(JSON.parse(localStorage.getItem(KEY) || '{}'), Date.now()); }
  catch { return readSchedule(null, Date.now()); }
}

export const useUpdatesStore = defineStore('updates', {
  state: () => ({ schedule: savedSchedule(), release: null as Release | null, checking: false, downloading: false, progress: 0, open: false, checked: false, error: '', downloaded: '' }),
  actions: {
    persist() { try { localStorage.setItem(KEY, JSON.stringify(this.schedule)); } catch { /* Remains deferred in this session. */ } },
    async check(manual = false) {
      if (this.checking || this.downloading) return;
      if (!isTauri()) { if (manual) this.error = 'Проверка доступна в приложении Aureon.'; return; }
      if (!manual && !shouldCheck(this.schedule, Date.now())) return;
      this.checking = true; this.error = ''; this.downloaded = '';
      try {
        this.release = await invoke<Release | null>('check_update');
        this.checked = true;
        if (this.release) this.open = true;
      } catch (error) {
        if (manual) this.error = String(error);
      } finally {
        this.schedule.checkedAt = Date.now(); this.persist(); this.checking = false;
      }
    },
    remindLater() {
      if (this.downloading) return;
      this.schedule.remindAt = Date.now() + UPDATE_SNOOZE;
      this.persist(); this.open = false;
    },
    async download() {
      if (!this.release || this.downloading) return;
      if (!this.release.packageName) { await api.openExternal(this.release.releaseUrl); return; }
      this.downloading = true; this.progress = 0; this.error = '';
      let unlisten: (() => void) | undefined;
      try {
        unlisten = await listen<number>('update-progress', event => { this.progress = event.payload; });
        this.downloaded = await invoke<string>('download_update', { requestedVersion: this.release.version });
      } catch (error) { this.error = String(error); }
      finally { this.downloading = false; try { unlisten?.(); } catch { /* The native window may already be closing. */ } }
    },
  },
});
