import { defineStore } from 'pinia';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { readSchedule, shouldCheck, UPDATE_SNOOZE, type UpdateCheckReason } from '@/lib/updateSchedule';
import { usePlayerStore } from '@/stores/player/index';
import { api } from '@/api/client';

interface Release { version: string; releaseUrl: string; packageName: string | null; canInstall: boolean }
const AUTO_KEY = 'aureon.updates.automatic';
const ATTEMPT_KEY = 'aureon.updates.installing';
const KEY = 'aureon.updates.v1';
function preference(key: string) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function setPreference(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {}
}

function savedSchedule() {
  try { return readSchedule(JSON.parse(localStorage.getItem(KEY) || '{}'), Date.now()); }
  catch { return readSchedule(null, Date.now()); }
}

export const useUpdatesStore = defineStore('updates', {
  state: () => ({ automatic: preference(AUTO_KEY) !== 'off', schedule: savedSchedule(), release: null as Release | null, checking: false, downloading: false, progress: 0, open: false, checked: false, error: '', downloaded: '' }),
  actions: {
    setAutomatic(enabled: boolean) {
      this.automatic = enabled;
      setPreference(AUTO_KEY, enabled ? 'on' : 'off');
    },
    persist() { try { localStorage.setItem(KEY, JSON.stringify(this.schedule)); } catch { /* Remains deferred in this session. */ } },
    async check(reason: UpdateCheckReason = 'scheduled') {
      const manual = reason === 'manual';
      if (this.checking || this.downloading) return;
      if (!isTauri()) { if (manual) this.error = 'Проверка доступна в приложении Aureon.'; return; }
      if (!shouldCheck(this.schedule, Date.now(), reason)) return;
      this.checking = true; this.error = ''; this.downloaded = '';
      try {
        this.release = await invoke<Release | null>('check_update');
        this.checked = true;
        if (!this.release) {
          this.open = false;
          setPreference(ATTEMPT_KEY, null);
        } else if (reason === 'startup' && this.automatic && this.release.canInstall) {
          if (preference(ATTEMPT_KEY) === this.release.version) {
            this.error = 'Предыдущая установка не завершилась. Можно повторить вручную.';
            this.open = true;
          } else {
            await this.download();
            if (this.error) this.open = true;
          }
        } else this.open = true;
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
        const request = { requestedVersion: this.release.version };
        const path = await invoke<string>('download_update', request);
        if (this.release.canInstall) {
          usePlayerStore().persistSession();
          setPreference(ATTEMPT_KEY, request.requestedVersion);
          await invoke('install_update', request);
        } else {
          this.downloaded = path;
        }
      } catch (error) { this.error = String(error); }
      finally { this.downloading = false; try { unlisten?.(); } catch { /* The native window may already be closing. */ } }
    },
  },
});
