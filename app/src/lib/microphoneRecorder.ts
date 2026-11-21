export interface MicrophoneRecording { blob: Blob; mime: string; durationMs: number }
export type RecordingState = 'idle' | 'requesting' | 'recording' | 'stopping';
interface RecorderOptions {
  getStream: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  createRecorder: (stream: MediaStream, options: MediaRecorderOptions) => MediaRecorder;
  supported: (mime: string) => boolean;
  onState?: (state: RecordingState) => void;
  onLimit?: () => void;
  onError?: () => void;
  now?: () => number;
  maxBytes?: number;
}

export function recordingMime(supported: (mime: string) => boolean): string {
  return ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'].find(supported) ?? '';
}

/** Permission is requested exclusively by start(); cancel also handles a late permission response. */
export function createMicrophoneRecorder(options: RecorderOptions) {
  const now = options.now ?? (() => performance.now());
  let state: RecordingState = 'idle', generation = 0, recorder: MediaRecorder | null = null;
  let stream: MediaStream | null = null, chunks: Blob[] = [], bytes = 0, started = 0;
  let resolveStop: ((recording: MicrophoneRecording | null) => void) | null = null;
  let stopPromise: Promise<MicrophoneRecording | null> | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let discard = false;
  const notify = (value: RecordingState) => { state = value; options.onState?.(value); };
  const stopTracks = () => { stream?.getTracks().forEach(track => track.stop()); stream = null; };
  function finish() {
    clearTimeout(timer); stopTracks();
    const mime = recorder?.mimeType || chunks[0]?.type || 'audio/webm';
    const result = !discard && bytes ? { blob: new Blob(chunks, { type: mime }), mime, durationMs: Math.max(0, now() - started) } : null;
    recorder = null; chunks = []; bytes = 0; notify('idle');
    resolveStop?.(result); resolveStop = null;
  }
  function stop(): Promise<MicrophoneRecording | null> {
    if (state === 'requesting') { generation++; notify('idle'); return Promise.resolve(null); }
    if (!recorder) return Promise.resolve(null);
    if (state !== 'stopping') {
      notify('stopping');
      try { recorder.stop(); } catch { finish(); }
      stopTracks();
    }
    return stopPromise ?? Promise.resolve(null);
  }
  return {
    get state() { return state; },
    get completed() { return stopPromise ?? Promise.resolve(null); },
    async start(deviceId = ''): Promise<void> {
      if (state !== 'idle') throw new Error('Запись уже запущена');
      const request = ++generation;
      discard = false; chunks = []; bytes = 0; stopPromise = null;
      notify('requesting');
      let incoming: MediaStream | null = null;
      try {
        incoming = await options.getStream({ audio: { ...(deviceId ? { deviceId: { exact: deviceId } } : {}), echoCancellation: false, noiseSuppression: false, autoGainControl: false }, video: false });
        if (request !== generation) { incoming.getTracks().forEach(track => track.stop()); return; }
        stream = incoming;
        const mimeType = recordingMime(options.supported);
        recorder = options.createRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 128_000 });
        stopPromise = new Promise(resolve => { resolveStop = resolve; });
        recorder.addEventListener('dataavailable', event => {
          if (!event.data.size || discard) return;
          if (bytes + event.data.size > (options.maxBytes ?? 32 * 1024 * 1024)) { options.onLimit?.(); void stop(); return; }
          chunks.push(event.data); bytes += event.data.size;
        });
        recorder.addEventListener('stop', finish, { once: true });
        recorder.addEventListener('error', () => { options.onError?.(); void stop(); }, { once: true });
        recorder.start(1000);
        started = now(); notify('recording');
        timer = setTimeout(() => { options.onLimit?.(); void stop(); }, 15 * 60 * 1000);
      } catch (error) {
        if (stream === incoming) stopTracks();
        else incoming?.getTracks().forEach(track => track.stop());
        if (request !== generation) return;
        stopTracks(); recorder = null; notify('idle');
        throw error;
      }
    },
    stop,
    cancel() { discard = true; generation++; void stop(); },
  };
}
