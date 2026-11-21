import type { MusicAnalysis } from './musicFeatures';
export type { MusicAnalysis, MusicLandmark } from './musicFeatures';

const MAX_BYTES = 32 * 1024 * 1024;
const MAX_DURATION_MS = 600000;
const MAX_RESPONSES = 256;
const RATE = 8000;
const cache = new Map<string, MusicAnalysis>();

function discard(response: Response): void { void response.body?.cancel().catch(() => {}); }

function contentRange(response: Response): { start: number; end: number; total: number } | null {
  const match = /^bytes\s+(\d+)-(\d+)\/(\d+)$/i.exec(response.headers.get('content-range') || '');
  if (!match) return null;
  const [start, end, total] = match.slice(1).map(Number) as [number, number, number];
  if (![start, end, total].every(Number.isSafeInteger) || start < 0 || end < start || total <= end || total > MAX_BYTES) return null;
  return { start, end, total };
}

async function readBody(response: Response, signal: AbortSignal, limit: number): Promise<Uint8Array | null> {
  if (!response.ok || Number(response.headers.get('content-length')) > limit) { discard(response); return null; }
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (!signal.aborted) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > limit) { await reader.cancel(); return null; }
      chunks.push(next.value);
    }
    if (signal.aborted || !length) { await reader.cancel(); return null; }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
  } finally { reader.releaseLock(); }
}

async function readAudio(first: Response, audioUrl: string, signal: AbortSignal): Promise<ArrayBuffer | null> {
  if (first.status === 200) {
    const bytes = await readBody(first, signal, MAX_BYTES);
    return bytes ? bytes.buffer as ArrayBuffer : null;
  }
  if (first.status !== 206) { discard(first); return null; }
  const initial = contentRange(first);
  if (!initial || initial.start !== 0) { discard(first); return null; }
  const complete = new Uint8Array(initial.total);
  let response = first, range = initial, offset = 0, responses = 0;
  while (!signal.aborted) {
    if (response.status !== 206 || range.start !== offset || range.total !== initial.total) { discard(response); return null; }
    const expected = range.end - range.start + 1;
    const bytes = await readBody(response, signal, expected);
    if (!bytes || bytes.byteLength !== expected || signal.aborted) return null;
    complete.set(bytes, offset); offset += bytes.byteLength; responses++;
    if (offset === initial.total) return complete.buffer;
    if (offset > initial.total || responses >= MAX_RESPONSES) return null;
    response = await fetch(audioUrl, { signal, credentials: 'omit', cache: 'no-store', headers: { Range: `bytes=${offset}-${initial.total - 1}` } });
    const following = contentRange(response);
    if (!following) { discard(response); return null; }
    range = following;
  }
  discard(response);
  return null;
}

async function monoPcm(audio: AudioBuffer, signal: AbortSignal): Promise<Float32Array | null> {
  const channelCount = Math.min(2, audio.numberOfChannels);
  if (!channelCount) return null;
  const channels = Array.from({ length: channelCount }, (_, i) => audio.getChannelData(i));
  const mono = new Float32Array(audio.length);
  // Decode already resamples to 8 kHz. Yield while mixing so ten-minute tracks do not block input.
  for (let start = 0; start < mono.length; start += 65536) {
    if (signal.aborted) return null;
    const end = Math.min(start + 65536, mono.length);
    for (let i = start; i < end; i++) {
      let value = 0;
      for (const channel of channels) value += channel[i]!;
      mono[i] = Number.isFinite(value) ? value / channelCount : 0;
    }
    if (end < mono.length) await new Promise<void>(resolve => setTimeout(resolve, 0));
  }
  return mono;
}

function features(samples: Float32Array, signal: AbortSignal): Promise<MusicAnalysis | null> {
  return new Promise(resolve => {
    if (signal.aborted || typeof Worker === 'undefined') { resolve(null); return; }
    let worker: Worker;
    try { worker = new Worker(new URL('./music.worker.ts', import.meta.url), { type: 'module' }); }
    catch { resolve(null); return; }
    let finished = false;
    const finish = (value: MusicAnalysis | null) => {
      if (finished) return; finished = true;
      signal.removeEventListener('abort', abort); worker.terminate(); resolve(value);
    };
    const abort = () => finish(null);
    signal.addEventListener('abort', abort, { once: true });
    worker.onmessage = event => {
      const data = event.data as MusicAnalysis | null;
      const valid = data && data.method === 'spectral-flux+bass-pulse-v1' && Number.isFinite(data.durationMs) && data.durationMs <= MAX_DURATION_MS && Array.isArray(data.landmarks)
        && data.landmarks.length <= 4096 && data.landmarks.every(point => Number.isFinite(point.timeMs) && point.timeMs >= 0 && point.timeMs <= data.durationMs && Number.isFinite(point.strength) && point.strength >= 0 && point.strength <= 1 && Number.isFinite(point.beatStrength) && point.beatStrength >= 0 && point.beatStrength <= 1);
      finish(valid ? data : null);
    };
    worker.onerror = () => finish(null); worker.onmessageerror = () => finish(null);
    try { worker.postMessage({ samples, sampleRate: RATE }, [samples.buffer]); }
    catch { finish(null); }
  });
}

function abortable<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(new Error('Audio analysis cancelled')); };
    if (signal.aborted) { reject(new Error('Audio analysis cancelled')); return; }
    signal.addEventListener('abort', abort, { once: true });
    pending.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}

/** Analyze the actual playback source. Cache keys are caller-owned hashes, never signed URLs. */
export async function analyzeTrackMusic(audioUrl: string, sourceKey: string, signal?: AbortSignal, durationMs?: number): Promise<MusicAnalysis | null> {
  if (!audioUrl || !sourceKey || signal?.aborted || (durationMs !== undefined && (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > MAX_DURATION_MS))) return null;
  const previous = cache.get(sourceKey);
  if (previous) { cache.delete(sourceKey); cache.set(sourceKey, previous); return structuredClone(previous); }
  if (typeof OfflineAudioContext === 'undefined') return null;
  const controller = new AbortController();
  const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 45000);
  try {
    const response = await fetch(audioUrl, { signal: controller.signal, credentials: 'omit', cache: 'no-store' });
    const bytes = await readAudio(response, audioUrl, controller.signal);
    if (!bytes || controller.signal.aborted) return null;
    const context = new OfflineAudioContext(1, 1, RATE);
    // Native decode cannot be stopped, but obsolete work must not hold the caller or publish results.
    const decoded = await abortable(context.decodeAudioData(bytes), controller.signal);
    if (controller.signal.aborted || !Number.isFinite(decoded.duration) || decoded.duration <= 0 || decoded.duration * 1000 > MAX_DURATION_MS || decoded.sampleRate !== RATE) return null;
    const samples = await monoPcm(decoded, controller.signal);
    if (!samples || controller.signal.aborted) return null;
    const result = await features(samples, controller.signal);
    if (!result || controller.signal.aborted) return null;
    cache.set(sourceKey, structuredClone(result));
    while (cache.size > 4) cache.delete(cache.keys().next().value!);
    return result;
  } catch { return null; }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
