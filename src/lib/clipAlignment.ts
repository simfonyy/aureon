export interface ClipAlignment {
  offsetSeconds: number;
  confidence: number;
  matchedWindows: number;
  analyzedSeconds: number;
}

export const CLIP_ALIGNMENT_ERROR = 'Не удалось синхронизировать клип с этой версией трека.';
const CACHE_VERSION = 1;
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
export function createClipAlignmentCache(limit = 64) {
  const maximum = Math.max(1, Math.min(64, Number.isSafeInteger(limit) ? limit : 64));
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
  function copy(value: ClipAlignment): ClipAlignment { return { offsetSeconds: value.offsetSeconds, confidence: value.confidence, matchedWindows: value.matchedWindows, analyzedSeconds: value.analyzedSeconds }; }
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
      }
      request.resolve(value);
    }).catch(() => request.reject(new Error(CLIP_ALIGNMENT_ERROR))).finally(() => {
      if (pending.get(request.key) === request) pending.delete(request.key);
      active = null;
      pump();
    });
  }
  return {
    async get(trackId: string, clipId: string, duration: number, load: () => Promise<unknown>, options: AlignmentRequestOptions = {}): Promise<ClipAlignment> {
      const key = clipAlignmentCacheKey(trackId, clipId, duration);
      const subscriber: Subscriber = { current: options.current ?? (() => true), onStart: options.onStart };
      if (!key || !subscriber.current()) throw new Error(CLIP_ALIGNMENT_ERROR);
      const saved = values.get(key);
      if (saved) { values.delete(key); values.set(key, saved); return copy(saved); }
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
      epoch++; values.clear();
      for (const request of [...queue]) removeQueued(request);
      // Keep the active native call occupying its slot, including across logout.
      pending.clear();
    },
  };
}

export const clipAlignmentCache = createClipAlignmentCache();
