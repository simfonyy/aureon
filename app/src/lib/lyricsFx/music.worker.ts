import { analyzePcm, type MusicAnalysis } from './musicFeatures';

const worker = globalThis as unknown as {
  onmessage: ((event: MessageEvent<{ samples: Float32Array; sampleRate: number }>) => void) | null;
  postMessage: (result: MusicAnalysis | null) => void;
};
worker.onmessage = event => {
  try { worker.postMessage(analyzePcm(event.data.samples, event.data.sampleRate)); }
  catch { worker.postMessage(null); }
};
