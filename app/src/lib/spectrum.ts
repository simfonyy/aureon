// Logarithmic bands devote space to bass and vocals instead of mostly silent upper bins.
export function spectrumBands(data: Uint8Array | null, sampleRate: number, output: Float32Array): Float32Array {
  if (!data?.length || sampleRate <= 0) { output.fill(0); return output; }
  const binHz = sampleRate / (data.length * 2);
  const low = Math.max(45, binHz), high = Math.min(14000, sampleRate / 2);
  for (let i = 0; i < output.length; i++) {
    const start = low * (high / low) ** (i / output.length);
    const end = low * (high / low) ** ((i + 1) / output.length);
    const first = Math.min(data.length - 1, Math.max(1, Math.floor(start / binHz)));
    const last = Math.min(data.length, Math.max(first + 1, Math.ceil(end / binHz)));
    let energy = 0, peak = 0;
    for (let bin = first; bin < last; bin++) { const value = data[bin] / 255; energy += value * value; peak = Math.max(peak, value); }
    const level = Math.sqrt(energy / (last - first)) * .7 + peak * .3;
    output[i] = Math.min(1, Math.max(0, (level - .035) / .965) ** .72);
  }
  return output;
}

export function smoothSpectrum(previous: number, target: number, dt: number): number {
  return previous + (target - previous) * (1 - Math.exp(-Math.max(0, dt) / (target > previous ? .025 : .15)));
}
