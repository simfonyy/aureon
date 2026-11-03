import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { usePlayerStore } from '@/stores/player';
import { useStatsStore } from '@/stores/stats';
import { asTrack, normalizeCatalog, normalizeEntry, normalizeSmart, parseSmart, SMART_KEY, MAX_PLAYLISTS, savedTextDocuments, smartMatches, sortLocal, buildSearchIndex, searchIndex, type LocalEntry, type TagPatch, type SmartPlaylist, type SmartRule, type LocalSort, type SearchDocument, type Identification } from '@/lib/libraryTools/model';

interface ImportReport { tracks: unknown; errors: string[]; truncated: boolean }
export interface DuplicateGroup { ids: string[]; similarity: number }
interface DuplicateReport { groups: DuplicateGroup[]; truncated: boolean }
const message = (error: unknown) => typeof error === 'string' ? error : error instanceof Error ? error.message : 'Не удалось выполнить действие';
function loadSmart(): SmartPlaylist[] { try { return parseSmart(localStorage.getItem(SMART_KEY)); } catch { return []; } }

export const useLibraryToolsStore = defineStore('libraryTools', () => {
  const entries = ref<LocalEntry[]>([]);
  const playlists = ref(loadSmart());
  const query = ref('');
  const sort = ref<LocalSort>('added');
  const selectedPlaylist = ref('');
  const error = ref('');
  const notices = ref<string[]>([]);
  const busy = ref(false);
  const ready = ref(false);
  const cachedTexts = ref<SearchDocument[]>([]);
  const duplicateGroups = ref<DuplicateGroup[]>([]);
  const duplicatesTruncated = ref(false);
  const duplicatesReady = ref(false);
  const analyzing = ref(false);
  const analysisCurrent = ref('');
  const analysisDone = ref(0);
  const analysisTotal = ref(0);
  const stopping = ref(false);
  let loading: Promise<void> | null = null;
  const player = usePlayerStore();
  const stats = useStatsStore();
  const currentEntry = computed(() => entries.value.find(row => row.id === player.current?.id) || null);
  const playlist = computed(() => playlists.value.find(row => row.id === selectedPlaylist.value) || null);
  const allDocuments = computed<SearchDocument[]>(() => {
    const local = entries.value.map(entry => ({ id: entry.id, title: entry.title, artist: entry.artist, album: entry.album, lyrics: entry.lyrics, local: true, track: asTrack(entry, convertFileSrc) }));
    const localIds = new Set(local.map(row => row.id));
    return [...local, ...cachedTexts.value.filter(row => !localIds.has(row.id))];
  });
  const index = computed(() => buildSearchIndex(allDocuments.value));
  const textHits = computed(() => searchIndex(index.value, query.value, 10000));
  const visibleEntries = computed(() => {
    let rows = entries.value;
    if (playlist.value) rows = rows.filter(row => smartMatches(row, playlist.value!.rule, stats.events));
    if (query.value.trim()) { const ids = new Set(textHits.value.map(hit => hit.document.id)); rows = rows.filter(row => ids.has(row.id)); }
    return sortLocal(rows, sort.value, currentEntry.value);
  });
  function refreshTexts() {
    try { cachedTexts.value = savedTextDocuments(localStorage); } catch { cachedTexts.value = []; }
  }
  function replace(entry: LocalEntry) {
    const at = entries.value.findIndex(row => row.id === entry.id);
    if (at === -1) entries.value.push(entry); else entries.value.splice(at, 1, entry);
    duplicateGroups.value = []; duplicatesReady.value = false;
  }
  async function init(force = false) {
    refreshTexts();
    if (loading) return loading;
    if (ready.value && !force) return;
    error.value = ''; busy.value = true;
    loading = (async () => {
      try { entries.value = normalizeCatalog(await invoke('library_catalog')); ready.value = true; }
      catch (e) { error.value = message(e); }
      finally { busy.value = false; loading = null; }
    })();
    return loading;
  }
  async function importFiles(folder = false) {
    if (busy.value) return;
    busy.value = true; error.value = ''; notices.value = [];
    try {
      const result = await invoke<ImportReport>('library_import', { folder });
      entries.value = normalizeCatalog(result.tracks); ready.value = true;
      notices.value = (Array.isArray(result.errors) ? result.errors.filter((item): item is string => typeof item === 'string') : []).slice(0, 100);
      if (result.truncated) notices.value.unshift('Добавлено не всё: предел — 5000 треков и 8 вложенных папок.');
      duplicateGroups.value = []; duplicatesReady.value = false;
    } catch (e) { error.value = message(e); }
    finally { busy.value = false; }
  }
  async function editTags(id: string, patch: TagPatch): Promise<boolean> {
    if (busy.value) return false;
    busy.value = true; error.value = '';
    try {
      const updated = normalizeEntry(await invoke('library_edit_tags', { id, patch }));
      if (!updated) throw new Error('Не удалось прочитать изменённый файл');
      replace(updated);
      const metadata = asTrack(updated, convertFileSrc);
      player.queue = player.queue.map(track => track.id === id ? metadata : track);
      player.sourceQueue = player.sourceQueue.map(track => track.id === id ? metadata : track);
      if (player.current?.id === id) { player.current = metadata; player.lyrics = null; }
      return true;
    } catch (e) { error.value = message(e); return false; }
    finally { busy.value = false; }
  }
  async function remove(id: string) {
    if (busy.value) return;
    busy.value = true; error.value = '';
    try {
      await invoke('library_remove', { id });
      entries.value = entries.value.filter(row => row.id !== id);
      duplicateGroups.value = []; duplicatesReady.value = false;
    } catch (e) { error.value = message(e); }
    finally { busy.value = false; }
  }
  async function play(id: string, rows: LocalEntry[] = visibleEntries.value) {
    const at = rows.findIndex(row => row.id === id);
    if (at === -1) return;
    try { await player.playQueue(rows.map(row => asTrack(row, convertFileSrc)), at); }
    catch (e) { error.value = message(e); }
  }
  function savePlaylist(title: string, rule: SmartRule): boolean {
    error.value = '';
    if (playlists.value.length >= MAX_PLAYLISTS) { error.value = 'Можно сохранить до 64 подборок'; return false; }
    const candidate = { id: crypto.randomUUID(), title, rule, createdAt: Date.now() };
    const next = normalizeSmart([...playlists.value, candidate]);
    if (!next.some(row => row.id === candidate.id)) { error.value = 'Проверь название и правило'; return false; }
    try { localStorage.setItem(SMART_KEY, JSON.stringify(next)); playlists.value = next; selectedPlaylist.value = candidate.id; return true; }
    catch { error.value = 'Не удалось сохранить подборку'; return false; }
  }
  function removePlaylist(id: string) {
    try {
      const next = playlists.value.filter(row => row.id !== id);
      localStorage.setItem(SMART_KEY, JSON.stringify(next)); playlists.value = next;
      if (selectedPlaylist.value === id) selectedPlaylist.value = '';
    } catch { error.value = 'Не удалось удалить подборку'; }
  }
  async function analyze(ids?: string[], force = false) {
    if (analyzing.value || busy.value) return;
    const wanted = new Set(ids || entries.value.map(row => row.id));
    const pending = entries.value.filter(row => wanted.has(row.id) && (force || !row.analysis)).map(row => row.id);
    if (!pending.length) { notices.value = ['Эти треки уже проанализированы.']; return; }
    analyzing.value = true; stopping.value = false; analysisDone.value = 0; analysisTotal.value = pending.length;
    error.value = ''; notices.value = [];
    try {
      for (const id of pending) {
        if (stopping.value) break;
        if (!entries.value.some(row => row.id === id)) continue;
        analysisCurrent.value = id;
        try {
          const updated = normalizeEntry(await invoke('library_analyze', { id }));
          if (!updated) throw new Error('Не удалось сохранить анализ');
          replace(updated);
        } catch (e) { if (notices.value.length < 100) notices.value.push(`${entries.value.find(row => row.id === id)?.title || 'Трек'}: ${message(e)}`); }
        analysisDone.value += 1;
      }
    } finally { analyzing.value = false; analysisCurrent.value = ''; stopping.value = false; }
  }
  async function findDuplicates() {
    if (busy.value || analyzing.value) return;
    busy.value = true; error.value = '';
    try {
      const result = await invoke<DuplicateReport>('library_duplicate_groups');
      duplicateGroups.value = result.groups; duplicatesTruncated.value = result.truncated; duplicatesReady.value = true;
    } catch (e) { error.value = message(e); }
    finally { busy.value = false; }
  }
  async function identify(id: string, clientKey: string): Promise<Identification[]> {
    // The key belongs to this one request; it is never part of the store or storage.
    if (!/^[A-Za-z0-9_-]{6,128}$/.test(clientKey.trim())) throw new Error('Введи ключ приложения AcoustID');
    if (busy.value || analyzing.value) throw new Error('Дождись текущего действия');
    if (!entries.value.find(row => row.id === id)?.analysis) {
      await analyze([id]);
      if (!entries.value.find(row => row.id === id)?.analysis) throw new Error('Не удалось проанализировать запись');
    }
    busy.value = true;
    try { return await invoke<Identification[]>('library_identify', { id, clientKey:clientKey.trim() }); }
    catch (e) { throw new Error(message(e)); }
    finally { busy.value = false; }
  }
  return { entries, playlists, query, sort, selectedPlaylist, playlist, error, notices, busy, ready,
    currentEntry, visibleEntries, textHits, cachedTexts, duplicateGroups, duplicatesTruncated, duplicatesReady,
    analyzing, analysisCurrent, analysisDone, analysisTotal, stopping,
    init, importFiles, editTags, remove, play, savePlaylist, removePlaylist, analyze, findDuplicates, identify, refreshTexts };
});
