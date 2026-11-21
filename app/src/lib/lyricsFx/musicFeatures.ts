export interface MusicLandmark {
  timeMs: number;
  strength: number;
  beatStrength: number;
}

export interface MusicAnalysis {
  durationMs: number;
  landmarks: MusicLandmark[];
  method: 'spectral-flux+bass-pulse-v1';
  pulsePeriodMs?: number;
}

const clamp = (n: number, min = 0, max = 1) => Math.max(min, Math.min(max, n));
const median = (values: number[]) => {
  if (!values.length) return 0;
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)]!;
};

/** Radix-2 FFT, with reusable scratch arrays. Runs in the analysis worker. */
function fft(real: Float64Array, imaginary: Float64Array, reverse: Uint16Array, cosine: Float64Array, sine: Float64Array) {
  const size = real.length;
  for (let i = 0; i < size; i++) {
    const j = reverse[i]!;
    if (j > i) { const value = real[i]!; real[i] = real[j]!; real[j] = value; }
    imaginary[i] = 0;
  }
  for (let length = 2; length <= size; length *= 2) {
    const half = length / 2, stride = size / length;
    for (let start = 0; start < size; start += length) {
      for (let j = 0; j < half; j++) {
        const a = start + j, b = a + half, phase = j * stride;
        const r = real[b]! * cosine[phase]! - imaginary[b]! * sine[phase]!;
        const im = real[b]! * sine[phase]! + imaginary[b]! * cosine[phase]!;
        real[b] = real[a]! - r; imaginary[b] = imaginary[a]! - im;
        real[a] += r; imaginary[a] += im;
      }
    }
  }
}

/** Musical onset cues, not a trained beat/downbeat or song-structure model. */
export function analyzePcm(samples: Float32Array, sampleRate: number): MusicAnalysis {
  const durationMs = Number.isFinite(sampleRate) && sampleRate > 0 ? samples.length / sampleRate * 1000 : 0;
  const result: MusicAnalysis = { durationMs, landmarks: [], method: 'spectral-flux+bass-pulse-v1' };
  if (!durationMs || durationMs > 600000 || sampleRate < 4000 || sampleRate > 48000 || samples.length < 1024) return result;

  const size = 512, hop = Math.round(sampleRate * .016), bands = 24;
  const count = Math.max(0, Math.floor((samples.length - size) / hop) + 1);
  if (count < 12) return result;
  const window = new Float64Array(size), reverse = new Uint16Array(size);
  const cosine = new Float64Array(size / 2), sine = new Float64Array(size / 2);
  for (let i = 0; i < size; i++) {
    window[i] = .5 - .5 * Math.cos(2 * Math.PI * i / (size - 1));
    let bits = i, reversed = 0;
    for (let j = 0; j < 9; j++) { reversed = (reversed << 1) | (bits & 1); bits >>= 1; }
    reverse[i] = reversed;
  }
  for (let i = 0; i < size / 2; i++) {
    cosine[i] = Math.cos(-2 * Math.PI * i / size); sine[i] = Math.sin(-2 * Math.PI * i / size);
  }
  const binBand = new Int16Array(size / 2 + 1).fill(-1);
  const lowHz = 35, highHz = Math.min(3800, sampleRate / 2);
  for (let i = 1; i <= size / 2; i++) {
    const hz = i * sampleRate / size;
    if (hz >= lowHz && hz <= highHz) binBand[i] = Math.min(bands - 1, Math.floor(Math.log(hz / lowHz) / Math.log(highHz / lowHz) * bands));
  }
  const shapes = new Float32Array(count * bands), rms = new Float32Array(count), bass = new Float32Array(count);
  const novelty = new Float32Array(count), smoothed = new Float32Array(count);
  const real = new Float64Array(size), imaginary = new Float64Array(size), spectrum = new Float64Array(bands);
  for (let frame = 0; frame < count; frame++) {
    const offset = frame * hop; let energy = 0;
    for (let i = 0; i < size; i++) {
      const sample = Number.isFinite(samples[offset + i]) ? samples[offset + i]! : 0;
      real[i] = sample * window[i]!; energy += sample * sample;
    }
    rms[frame] = Math.sqrt(energy / size);
    fft(real, imaginary, reverse, cosine, sine);
    spectrum.fill(0); let bassEnergy = 0, totalEnergy = 0;
    for (let i = 1; i <= size / 2; i++) {
      const band = binBand[i]!;
      if (band < 0) continue;
      const power = real[i]! ** 2 + imaginary[i]! ** 2;
      spectrum[band] += power; totalEnergy += power;
      if (i * sampleRate / size <= 220) bassEnergy += power;
    }
    let total = 0;
    for (let b = 0; b < bands; b++) { spectrum[b] = Math.sqrt(spectrum[b]!); total += spectrum[b]!; }
    bass[frame] = totalEnergy > 1e-10 ? Math.sqrt(bassEnergy / totalEnergy) : 0;
    if (total > 1e-8 && rms[frame]! > 1e-5) {
      for (let b = 0; b < bands; b++) shapes[frame * bands + b] = spectrum[b]! / total;
    }
    if (frame > 0) {
      let flux = 0;
      for (let b = 0; b < bands; b++) flux += Math.max(0, shapes[frame * bands + b]! - shapes[(frame - 1) * bands + b]!);
      // Both components are normalized by spectrum energy. A gain increase alone is not novelty.
      novelty[frame] = .78 * flux + .22 * Math.max(0, bass[frame]! - bass[frame - 1]!);
    }
  }
  for (let f = 1; f < count - 1; f++) smoothed[f] = novelty[f - 1]! * .2 + novelty[f]! * .6 + novelty[f + 1]! * .2;

  const frameMs = hop / sampleRate * 1000;
  const candidates: MusicLandmark[] = [];
  for (let f = 7; f < count - 7; f++) {
    const peak = smoothed[f]!;
    if (peak < .018 || peak < smoothed[f - 1]! || peak <= smoothed[f + 1]! || peak < smoothed[f - 2]! || peak < smoothed[f + 2]! || rms[f]! < 1e-4) continue;
    const local = Array.from(smoothed.subarray(Math.max(0, f - 38), Math.min(count, f + 39)));
    const middle = median(local), deviation = median(local.map(value => Math.abs(value - middle)));
    const threshold = Math.max(.018, middle + 2 * deviation);
    if (peak <= threshold) continue;
    // Confirm a change in musical texture beyond the brief FFT transient of a volume step.
    let shapeChange = 0;
    for (let b = 0; b < bands; b++) {
      let before = 0, after = 0;
      for (let d = 3; d <= 7; d++) { before += shapes[(f - d) * bands + b]!; after += shapes[(f + d) * bands + b]!; }
      shapeChange += Math.abs(after - before) / 5;
    }
    if (shapeChange < .045) continue;
    const strength = clamp(.5 * clamp((peak - threshold) / .18) + .35 * clamp(shapeChange / .7) + .15 * clamp(bass[f]!));
    if (strength < .16) continue;
    const candidate = { timeMs: Math.round((f * hop + size / 2) / sampleRate * 1000), strength: Math.round(strength * 1000) / 1000, beatStrength: 0 };
    const previous = candidates.at(-1);
    if (previous && candidate.timeMs - previous.timeMs < 120) {
      if (candidate.strength > previous.strength) candidates[candidates.length - 1] = candidate;
    } else candidates.push(candidate);
  }

  // Estimate a repeated pulse from the novelty curve. This does not claim bar/downbeat positions.
  let bestLag = 0, bestCorrelation = 0, bestScore = 0;
  const lower = Math.ceil(240 / frameMs), upper = Math.min(Math.floor(1200 / frameMs), Math.floor(count / 3));
  for (let lag = lower; lag <= upper; lag++) {
    let cross = 0, left = 0, right = 0;
    for (let f = lag; f < count; f++) {
      const a = smoothed[f]!, b = smoothed[f - lag]!;
      cross += a * b; left += a * a; right += b * b;
    }
    const correlation = cross / Math.sqrt(Math.max(1e-14, left * right));
    const score = correlation * (1 - .06 * Math.abs(Math.log2(lag * frameMs / 500)));
    if (score > bestScore) { bestScore = score; bestLag = lag; bestCorrelation = correlation; }
  }
  if (bestCorrelation >= .12 && candidates.length >= 3) {
    const period = bestLag * frameMs; result.pulsePeriodMs = Math.round(period);
    for (let i = 0; i < candidates.length; i++) {
      let support = 0;
      for (const direction of [-1, 1]) {
        const expected = candidates[i]!.timeMs + direction * period;
        const close = candidates.some((point, j) => i !== j && Math.abs(point.timeMs - expected) < Math.max(55, period * .12));
        if (close) support += .5;
      }
      candidates[i]!.beatStrength = Math.round(clamp(bestCorrelation * support) * 1000) / 1000;
    }
  }
  result.landmarks = candidates.length > 4096
    ? candidates.sort((a, b) => b.strength - a.strength).slice(0, 4096).sort((a, b) => a.timeMs - b.timeMs)
    : candidates;
  return result;
}
