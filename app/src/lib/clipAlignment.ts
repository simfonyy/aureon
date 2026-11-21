export interface ClipAlignment {
  offsetSeconds: number;
  confidence: number;
  matchedWindows: number;
  analyzedSeconds: number;
}

export const CLIP_ALIGNMENT_ERROR = 'Не удалось синхронизировать клип с этой версией трека.';
const CACHE_VERSION = 1;
const STORAGE_KEY = 'aureon:clip-alignments';
const SAVED_KEY = /^clip-alignment:1:[1-9]\d{0,19}:[1-9]\d{0,19}:\d{1,6}$/;
const MAX_QUEUED_ANALYSES = 8;
const QUEUE_WAIT_MS = 120_000;

interface AlignmentRequestOptions {
  current?: () => boolean;
  onStart?: () => void;
}

export function reliableClipAlignment(value: unknown): value is ClipAlignment {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Partial<ClipAlignment>;
  return typeof row.offsetSeconds === 'number' && Number.isFinite(row.offsetSeconds) && Math.abs(row.offsetSeconds) <= 300 &&
    typeof row.confidence === 'number' && Number.isFinite(row.confidence) && row.confidence >= .8 && row.confidence <= 1 &&
    Number.isSafeInteger(row.matchedWindows) && row.matchedWindows! >= 3 && row.matchedWindows! <= 100_000 &&
    typeof row.analyzedSeconds === 'number' && Number.isFinite(row.analyzedSeconds) && row.analyzedSeconds >= 8 && row.analyzedSeconds <= 3600;
}

export function clipAlignmentCacheKey(trackId: string, clipId: string, duration: number): string | null {
  const track = /^([1-9]\d{0,19})(?::[1-9]\d{0,19})?$/.exec(trackId)?.[1];
  if (!track || !/^[1-9]\d{0,19}$/.test(clipId)) return null;
  const editionDuration = Number.isFinite(duration) && duration > 0 && duration <= 86_400 ? Math.round(duration * 10) : 0;
  return `clip-alignment:${CACHE_VERSION}:${track}:${clipId}:${editionDuration}`;
}

/** Only confirmed offsets are retained. Signed URLs, audio and account data are not cached here. */
export function createClipAlignmentCache(limit = 1024, storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>) {
  const maximum = Math.max(1, Math.min(1024, Number.isSafeInteger(limit) ? limit : 1024));
  type Subscriber = { current: () => boolean; onStart?: () => void };
  type Request = {
    key: string; epoch: number; load: () => Promise<unknown>; subscribers: Set<Subscriber>;
    promise: Promise<ClipAlignment>; resolve: (value: ClipAlignment) => void; reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout> | null; started: boolean;
  };
  const values = new Map<string, ClipAlignment>(), pending = new Map<string, Request>();
  const queue: Request[] = [];
  let active: Request | null = null;
  let epoch = 0;
  let restored = false;
  function copy(value: ClipAlignment): ClipAlignment { return { offsetSeconds: value.offsetSeconds, confidence: value.confidence, matchedWindows: value.matchedWindows, analyzedSeconds: value.analyzedSeconds }; }
  function restore() {
    if (restored) return;
    restored = true;
    try {
      const raw = (storage ?? globalThis.localStorage)?.getItem(STORAGE_KEY);
      if (!raw || raw.length > 512 * 1024) return;
      const rows: unknown = JSON.parse(raw);
      if (!Array.isArray(rows)) return;
      for (const row of rows.slice(-maximum)) {
        if (Array.isArray(row) && typeof row[0] === 'string' && SAVED_KEY.test(row[0]) && reliableClipAlignment(row[1])) {
          values.set(row[0], copy(row[1]));
        }
      }
    } catch { /* Local storage is optional. */ }
  }
  function persist() {
    try { (storage ?? globalThis.localStorage)?.setItem(STORAGE_KEY, JSON.stringify([...values])); }
    catch { /* Keep the confirmed match in memory if storage is unavailable. */ }
  }
  function saved(key: string) {
    restore();
    const value = values.get(key);
    if (!value) return null;
    values.delete(key);
    values.set(key, value);
    return copy(value);
  }
  function hasSubscribers(request: Request) {
    for (const subscriber of request.subscribers) if (!subscriber.current()) request.subscribers.delete(subscriber);
    return request.subscribers.size > 0;
  }
  function removeQueued(request: Request) {
    const at = queue.indexOf(request);
    if (at >= 0) queue.splice(at, 1);
    if (request.timer !== null) clearTimeout(request.timer);
    request.timer = null;
    if (pending.get(request.key) === request) pending.delete(request.key);
    request.reject(new Error(CLIP_ALIGNMENT_ERROR));
  }
  function pump() {
    if (active) return;
    const request = queue.shift();
    if (!request) return;
    if (!hasSubscribers(request)) { removeQueued(request); pump(); return; }
    active = request;
    request.started = true;
    if (request.timer !== null) clearTimeout(request.timer);
    request.timer = null;
    for (const subscriber of request.subscribers) subscriber.onStart?.();
    // Do not release this slot when a surface is closed: the native command is
    // still running. Its completion unlocks the next currently visible clip.
    void Promise.resolve().then(request.load).then(result => {
      if (!reliableClipAlignment(result)) throw new Error(CLIP_ALIGNMENT_ERROR);
      const value = copy(result);
      if (request.epoch === epoch) {
        values.set(request.key, value);
        while (values.size > maximum) values.delete(values.keys().next().value!);
        persist();
      }
      request.resolve(value);
    }).catch(() => request.reject(new Error(CLIP_ALIGNMENT_ERROR))).finally(() => {
      if (pending.get(request.key) === request) pending.delete(request.key);
      active = null;
      pump();
    });
  }
  return {
    saved(trackId: string, clipId: string, duration: number): ClipAlignment | null {
      const key = clipAlignmentCacheKey(trackId, clipId, duration);
      return key ? saved(key) : null;
    },
    savedClipIds(trackId: string, duration: number): string[] {
      const key = clipAlignmentCacheKey(trackId, '1', duration);
      if (!key) return [];
      restore();
      const [, version, track, , edition] = key.split(':');
      const prefix = `clip-alignment:${version}:${track}:`;
      return [...values.keys()].reverse()
        .filter(value => value.startsWith(prefix) && value.endsWith(`:${edition}`))
        .map(value => value.split(':')[3]!);
    },
    async get(trackId: string, clipId: string, duration: number, load: () => Promise<unknown>, options: AlignmentRequestOptions = {}): Promise<ClipAlignment> {
      const key = clipAlignmentCacheKey(trackId, clipId, duration);
      const subscriber: Subscriber = { current: options.current ?? (() => true), onStart: options.onStart };
      if (!key || !subscriber.current()) throw new Error(CLIP_ALIGNMENT_ERROR);
      const cached = saved(key);
      if (cached) return cached;
      let request = pending.get(key);
      if (!request) {
        for (const queued of [...queue]) if (!hasSubscribers(queued)) removeQueued(queued);
        if (queue.length >= MAX_QUEUED_ANALYSES) throw new Error(CLIP_ALIGNMENT_ERROR);
        let resolve!: Request['resolve'], reject!: Request['reject'];
        const promise = new Promise<ClipAlignment>((yes, no) => { resolve = yes; reject = no; });
        request = { key, epoch, load, subscribers: new Set(), promise, resolve, reject, timer: null, started: false };
        const queued = request;
        queued.timer = setTimeout(() => removeQueued(queued), QUEUE_WAIT_MS);
        pending.set(key, request);
        queue.push(request);
      }
      hasSubscribers(request);
      request.subscribers.add(subscriber);
      if (request.started) subscriber.onStart?.();
      else pump();
      try {
        const value = await request.promise;
        if (!subscriber.current()) throw new Error(CLIP_ALIGNMENT_ERROR);
        return copy(value);
      } finally { request.subscribers.delete(subscriber); }
    },
    clear() {
      epoch++; restored = true; values.clear();
      try { (storage ?? globalThis.localStorage)?.removeItem(STORAGE_KEY); } catch { /* Optional storage. */ }
      for (const request of [...queue]) removeQueued(request);
      // Keep the active native call occupying its slot, including across logout.
      pending.clear();
    },
  };
}

export const clipAlignmentCache = createClipAlignmentCache();
