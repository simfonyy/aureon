import test from 'node:test';
import assert from 'node:assert/strict';

// Run the actual bundled render-thread DSP in a minimal AudioWorklet host.
// Browser registration/device permissions are verified separately in native QA.
let Processor;
globalThis.sampleRate = 48000;
globalThis.AudioWorkletProcessor = class { port = { postMessage() {}, onmessage: null }; };
globalThis.registerProcessor = (_name, constructor) => { Processor = constructor; };
await import('@soundtouchjs/audio-worklet/processor');

for (const [tempo, semitones] of [[1, 12], [1.25, 12], [.75, -12], [1.5, -3], [2, -7], [.5, 7]]) {
  test(`real SoundTouch DSP preserves requested key at tempo ${tempo}, shift ${semitones}`, () => {
    const processor = new Processor({ processorOptions: { sampleBufferType: 'circular' } });
    const parameters = { pitch: Float32Array.of(1), pitchSemitones: Float32Array.of(semitones), playbackRate: Float32Array.of(tempo) };
    const length = 48000 * 4, output = new Float32Array(length);
    for (let offset = 0; offset < length; offset += 128) {
      const count = Math.min(128, length - offset), input = new Float32Array(count), left = new Float32Array(count), right = new Float32Array(count);
      for (let i = 0; i < count; i++) input[i] = .3 * Math.sin(2 * Math.PI * 400 * tempo * (offset + i) / 48000);
      assert.equal(processor.process([[input]], [[left, right]], parameters), true);
      output.set(left, offset);
    }
    let crossings = 0, sum = 0;
    for (let i = 48000; i < length; i++) {
      assert.equal(Number.isFinite(output[i]), true);
      if (output[i] > 0 && output[i - 1] <= 0) crossings++;
      sum += output[i] ** 2;
    }
    const frequency = crossings / 3, expected = 400 * 2 ** (semitones / 12);
    assert.ok(Math.abs(frequency - expected) < 10, `${frequency.toFixed(2)} Hz instead of ${expected.toFixed(2)} Hz`);
    assert.ok(Math.sqrt(sum / (48000 * 3)) > .02, 'processing must produce audible nonzero samples');
  });
}
