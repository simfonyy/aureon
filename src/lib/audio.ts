export const audio = new Audio();
audio.preload = "auto";
audio.crossOrigin = "anonymous";

let sourceToken = 0;

export function nextSourceToken(): number {
  sourceToken += 1;
  return sourceToken;
}

export function isCurrentToken(token: number): boolean {
  return token === sourceToken;
}

export async function safePlay(token?: number): Promise<void> {
  try {
    await audio.play();
  } catch (error) {
    const name = (error as DOMException | undefined)?.name;
    if (name === "AbortError") return;
    if (token !== undefined && !isCurrentToken(token)) return;
    throw error;
  }
}

let fadeTimer: number | null = null;
let fadeDeadline: ReturnType<typeof setTimeout> | null = null;
let finishFade: (() => void) | null = null;

function stopFade(): void {
  if (fadeTimer !== null) {
    cancelAnimationFrame(fadeTimer);
    fadeTimer = null;
  }
  if (fadeDeadline !== null) { clearTimeout(fadeDeadline); fadeDeadline = null; }

  const finish = finishFade;
  finishFade = null;
  finish?.();
}

function ramp(from: number, to: number, ms: number): Promise<void> {
  stopFade();
  if (ms <= 0) {
    audio.volume = Math.max(0, Math.min(1, to));
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    finishFade = resolve;
    const started = performance.now();
    audio.volume = Math.max(0, Math.min(1, from));
    const tick = (now: number) => {
      const t = Math.min(1, (now - started) / ms);
      const eased = t * t * (3 - 2 * t);
      audio.volume = Math.max(0, Math.min(1, from + (to - from) * eased));
      if (t >= 1) {
        stopFade();
      } else fadeTimer = requestAnimationFrame(tick);
    };
    fadeTimer = requestAnimationFrame(tick);

    fadeDeadline = setTimeout(() => { audio.volume = Math.max(0, Math.min(1, to)); stopFade(); }, ms + 50);
  });
}

export async function fadeTo(target: number, ms = 140): Promise<void> {
  const clamped = Math.max(0, Math.min(1, target));
  if (ms <= 0) {
    stopFade();
    audio.volume = clamped;
    return;
  }
  await ramp(audio.volume, clamped, ms);
}

export async function fadeOut(ms: number): Promise<void> {
  if (ms <= 0 || audio.paused) return;
  await ramp(audio.volume, 0, ms);
}

export async function fadeIn(target: number, ms: number): Promise<void> {
  if (ms <= 0) {
    stopFade();
    audio.volume = Math.max(0, Math.min(1, target));
    return;
  }
  await ramp(0, target, ms);
}

export function cancelFade(target: number): void {
  stopFade();
  audio.volume = Math.max(0, Math.min(1, target));
}

export const EQ_BANDS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

interface Graph {
  context: AudioContext;
  source: MediaElementAudioSourceNode;
  preamp: GainNode;
  filters: BiquadFilterNode[];
  routed: boolean;
  routedPitch: AudioNode | null;
  pitch: PitchProcessor | null;
}

export interface PitchProcessor extends AudioWorkletNode {
  pitchSemitones: AudioParam;
  playbackRate: AudioParam;
}

let graph: Graph | null = null;
let failed = false;
let pitchSemitones = 0;
let pitchRequest = 0;
let pitchFactory: ((context: AudioContext) => PitchProcessor) | null = null;
let pitchLoading: Promise<void> | null = null;
const pitchListeners = new Set<(value: number, error?: string) => void>();

export function onPitchChange(listener: (value: number, error?: string) => void): () => void {
  pitchListeners.add(listener);
  return () => pitchListeners.delete(listener);
}

function notifyPitch(error?: string) { for (const listener of pitchListeners) listener(pitchSemitones, error); }

function configurePitch(current: Graph): void {
  if (!current.pitch) return;
  current.pitch.playbackRate.value = audio.playbackRate || 1;
  current.pitch.pitchSemitones.value = pitchSemitones;
}

function replacePitch(current: Graph): void {
  if (!pitchFactory || pitchSemitones === 0) return;
  const previous = current.pitch;
  current.pitch = pitchFactory(current.context);
  current.pitch.addEventListener('processorerror', () => {
    if (graph !== current || current.pitch !== processor) return;
    pitchSemitones = 0;
    audio.preservesPitch = true;
    route(current, current.routed);
    current.pitch = null;
    processor.port.close();
    notifyPitch('Обработка звука остановлена. Включён обычный звук.');
  });
  const processor = current.pitch;
  configurePitch(current);
  route(current, current.routed);
  previous?.disconnect();
  previous?.port.close();
}

function route(current: Graph, throughFilters: boolean): void {
  const processor = pitchSemitones !== 0 ? current.pitch : null;
  if (current.routed === throughFilters && current.routedPitch === processor) return;
  current.routed = throughFilters;
  current.routedPitch?.disconnect();
  current.routedPitch = processor;
  try {
    current.source.disconnect();
  } catch {}
  const output = throughFilters ? current.preamp : current.context.destination;
  if (processor) {
    current.source.connect(processor);
    if (!audio.paused) processor.connect(output);
  } else current.source.connect(output);
  if (analyser) {
    try {
      current.source.connect(analyser);
    } catch {}
  }
}

function build(): Graph | null {
  if (graph) return graph;
  if (failed) return null;
  try {
    const context = new AudioContext({ latencyHint: "playback" });
    const source = context.createMediaElementSource(audio);
    const preamp = context.createGain();
    const filters = EQ_BANDS.map((frequency, index) => {
      const filter = context.createBiquadFilter();
      filter.type =
        index === 0
          ? "lowshelf"
          : index === EQ_BANDS.length - 1
            ? "highshelf"
            : "peaking";
      filter.frequency.value = frequency;
      filter.Q.value = 1.1;
      filter.gain.value = 0;
      return filter;
    });

    let node: AudioNode = preamp;
    for (const filter of filters) {
      node.connect(filter);
      node = filter;
    }
    node.connect(context.destination);

    graph = { context, source, preamp, filters, routed: false, routedPitch: null, pitch: null };
    source.connect(context.destination);
    audio.addEventListener('ratechange', () => { if (graph) configurePitch(graph); });
    audio.addEventListener('pause', () => { graph?.pitch?.disconnect(); });
    audio.addEventListener('play', () => {
      if (graph && pitchSemitones !== 0) {
        try { replacePitch(graph); } catch { void setPitchSemitones(0); }
      }
    });
    // A fresh processor prevents samples from before a seek/track switch
    // remaining in SoundTouch's short internal time-stretch buffer.
    for (const event of ['seeking', 'emptied']) audio.addEventListener(event, () => {
      if (graph && pitchSemitones !== 0) {
        try { replacePitch(graph); } catch { void setPitchSemitones(0); }
      }
    });
    void context.resume().catch(() => undefined);
    return graph;
  } catch {
    failed = true;
    return null;
  }
}

export function currentPitchSemitones(): number { return pitchSemitones; }

export async function setPitchSemitones(value: number): Promise<void> {
  const next = Math.max(-12, Math.min(12, Math.round(Number.isFinite(value) ? value : 0)));
  const request = ++pitchRequest;
  if (next === 0) {
    pitchSemitones = 0;
    audio.preservesPitch = true;
    if (graph) {
      route(graph, graph.routed);
      graph.pitch?.disconnect(); graph.pitch?.port.close(); graph.pitch = null;
    }
    notifyPitch();
    return;
  }
  const current = build();
  if (!current || !current.context.audioWorklet) throw new Error('Изменение тональности недоступно в этой версии приложения.');
  await current.context.resume();
  if (!pitchFactory) {
    pitchLoading ??= import('./pitchProcessor').then(async module => {
      pitchFactory = await module.preparePitchProcessor(current.context);
    }).finally(() => { pitchLoading = null; });
    await pitchLoading;
  }
  if (request !== pitchRequest) return;
  const previous = pitchSemitones;
  try {
    pitchSemitones = next;
    if (!current.pitch) replacePitch(current);
    configurePitch(current);
    audio.preservesPitch = false;
    route(current, current.routed);
    notifyPitch();
  } catch (error) {
    pitchSemitones = previous;
    audio.preservesPitch = previous === 0;
    route(current, current.routed);
    throw error;
  }
}

type SinkContext = AudioContext & { setSinkId?: (deviceId: string) => Promise<void>; sinkId?: string };
export function audioOutputSupported(): boolean {
  return typeof (AudioContext.prototype as SinkContext).setSinkId === 'function';
}
export async function setAudioOutput(deviceId: string): Promise<void> {
  const current = build();
  const context = current?.context as SinkContext | undefined;
  if (!context?.setSinkId) throw new Error('Выбор выхода недоступен в этой системе.');
  await context.setSinkId(deviceId);
}

export function equalizerAvailable(): boolean {
  return !failed;
}

export function applyEqualizer(
  enabled: boolean,
  gains: number[],
  preampDb: number,
): boolean {
  if (!enabled && !graph) return true;
  const current = build();
  if (!current) return false;

  void current.context.resume().catch(() => undefined);
  route(current, enabled);
  const preampGain = enabled ? Math.pow(10, preampDb / 20) : 1;
  current.preamp.gain.value = preampGain;
  current.filters.forEach((filter, index) => {
    filter.gain.value = enabled ? (gains[index] ?? 0) : 0;
  });
  return true;
}

export function resumeAudioContext(): void {
  if (graph) void graph.context.resume().catch(() => undefined);
}

let analyser: AnalyserNode | null = null;
let levelBuffer: Float32Array<ArrayBuffer> | null = null;

export function ensureAnalyser(): boolean {
  const current = build();
  if (!current) return false;
  if (current.context.state === "suspended") {
    void current.context.resume().catch(() => undefined);
  }
  if (!analyser) {
    analyser = current.context.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = .25;
    analyser.minDecibels = -90;
    analyser.maxDecibels = -20;
    levelBuffer = new Float32Array(analyser.fftSize);
    current.source.connect(analyser);
  }
  return true;
}

let freqBuffer: Uint8Array<ArrayBuffer> | null = null;

export function audioSampleRate(): number { return graph?.context.sampleRate ?? 48000; }

export function frequencyData(): Uint8Array | null {
  if (!ensureAnalyser()) return null;
  if (!analyser) return null;
  if (!freqBuffer || freqBuffer.length !== analyser.frequencyBinCount) {
    freqBuffer = new Uint8Array(analyser.frequencyBinCount);
  }
  analyser.getByteFrequencyData(freqBuffer);
  return freqBuffer;
}

export function currentLevel(): number {
  if (!analyser || !levelBuffer) {
    if (!ensureAnalyser()) return 1;
  }
  if (!analyser || !levelBuffer) return 1;
  analyser.getFloatTimeDomainData(levelBuffer);
  let sum = 0;
  for (let i = 0; i < levelBuffer.length; i++) {
    const v = levelBuffer[i] ?? 0;
    sum += v * v;
  }
  return Math.sqrt(sum / levelBuffer.length);
}

let gestureArmed = false;

export function resumeOnGesture(run: () => void): void {
  if (gestureArmed) return;
  gestureArmed = true;
  const fire = () => {
    gestureArmed = false;
    window.removeEventListener("pointerdown", fire);
    window.removeEventListener("keydown", fire);
    run();
  };
  window.addEventListener("pointerdown", fire, { once: true });
  window.addEventListener("keydown", fire, { once: true });
}
