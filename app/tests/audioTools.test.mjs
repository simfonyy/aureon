import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

let fixtureId = 0;
async function graphFixture(load) {
  const fixture = { processors: [], sources: 0 };
  class AudioNode {
    links = new Set(); gain = { value: 1 }; frequency = { value: 0 }; Q = { value: 0 };
    connect(target) { this.links.add(target); return target; }
    disconnect(target) { target ? this.links.delete(target) : this.links.clear(); }
  }
  class Processor extends AudioNode {
    pitchSemitones = { value: 0 }; playbackRate = { value: 1 }; closed = false; events = {};
    port = { close: () => { this.closed = true; } };
    addEventListener(name, callback) { this.events[name] = callback; }
    constructor() { super(); fixture.processors.push(this); }
  }
  class Media {
    playbackRate = 1; preservesPitch = true; paused = false; events = {};
    addEventListener(name, callback) { (this.events[name] ??= []).push(callback); }
    emit(name) { this.events[name]?.forEach(callback => callback()); }
  }
  class Context {
    destination = new AudioNode(); audioWorklet = {}; state = 'running';
    constructor() { fixture.context = this; }
    createMediaElementSource() { fixture.sources++; return this.source = new AudioNode(); }
    createGain() { return new AudioNode(); }
    createBiquadFilter() { return new AudioNode(); }
    createAnalyser() { return this.analyser = new AudioNode(); }
    resume() { return Promise.resolve(); }
    async setSinkId(value) { if (value === 'missing') throw Error('missing'); this.sinkId = value; }
  }
  const key = `audioToolsFixture${++fixtureId}`;
  globalThis[key] = { Audio: Media, AudioContext: Context, preparePitchProcessor: load ?? (async () => () => new Processor()) };
  let source = await readFile(new URL('../src/lib/audio.ts', import.meta.url), 'utf8');
  source = `const {Audio,AudioContext,preparePitchProcessor}=globalThis.${key};\n` + source.replace("import('./pitchProcessor')", 'Promise.resolve({preparePitchProcessor})');
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  fixture.api = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
  return fixture;
}

test('pitch stays independent from tempo and survives EQ rerouting without duplicating the source', async () => {
  const f = await graphFixture(), a = f.api;
  a.applyEqualizer(true, [2], -3); a.ensureAnalyser();
  await a.setPitchSemitones(-3);
  const processor = f.processors[0];
  assert.equal(a.audio.preservesPitch, false);
  assert.equal(processor.pitchSemitones.value, -3);
  assert.equal(f.context.source.links.has(processor), true);
  assert.equal(f.context.source.links.has(f.context.destination), false);
  assert.equal(f.context.source.links.has(f.context.analyser), true);
  assert.equal([...processor.links][0].gain.value, Math.pow(10, -3 / 20));
  a.audio.playbackRate = 1.3; a.audio.emit('ratechange');
  assert.equal(processor.playbackRate.value, 1.3);
  assert.equal(processor.pitchSemitones.value, -3);
  a.applyEqualizer(false, [], 0);
  assert.equal(processor.links.has(f.context.destination), true);
  await a.setPitchSemitones(0);
  assert.equal(a.audio.preservesPitch, true);
  assert.equal(f.context.source.links.has(f.context.destination), true);
  assert.equal(f.context.source.links.has(processor), false);
  assert.equal(processor.closed, true, 'reset must release the disconnected worklet port');
  assert.equal(f.sources, 1);
});

test('reset during lazy pitch loading cannot enable processing after the reset', async () => {
  let resolve;
  const loading = new Promise(done => { resolve = done; });
  const f = await graphFixture(() => loading);
  const pending = f.api.setPitchSemitones(5);
  await new Promise(done => setImmediate(done));
  await f.api.setPitchSemitones(0);
  resolve(() => { throw Error('stale request must not create a processor'); });
  await pending;
  assert.equal(f.api.currentPitchSemitones(), 0);
  assert.equal(f.api.audio.preservesPitch, true);
  assert.equal(f.context.source.links.has(f.context.destination), true);
});

test('seeking discards buffered samples and a processor failure returns to normal sound', async () => {
  const f = await graphFixture(), a = f.api;
  await a.setPitchSemitones(4);
  const old = f.processors[0]; a.audio.emit('seeking');
  const fresh = f.processors[1];
  assert.equal(old.closed, true); assert.equal(old.links.size, 0);
  assert.equal(fresh.pitchSemitones.value, 4);
  assert.equal(f.context.source.links.has(fresh), true);
  fresh.events.processorerror();
  assert.equal(a.currentPitchSemitones(), 0);
  assert.equal(a.audio.preservesPitch, true);
  assert.equal(f.context.source.links.has(f.context.destination), true);
  await a.setPitchSemitones(-2);
  assert.equal(f.processors.length, 3, 'the crashed processor must not be reused');
});

test('output selection targets the shared AudioContext and failure leaves routing intact', async () => {
  const f = await graphFixture(), a = f.api;
  assert.equal(a.audioOutputSupported(), true);
  await a.setAudioOutput('headphones');
  assert.equal(f.context.sinkId, 'headphones');
  await assert.rejects(a.setAudioOutput('missing'));
  assert.equal(f.context.sinkId, 'headphones');
  assert.equal(f.context.source.links.has(f.context.destination), true);
  assert.equal(f.sources, 1);
});

test('pausing mutes the processor tail and resuming starts without buffered old samples', async () => {
  const f = await graphFixture(), a = f.api;
  await a.setPitchSemitones(2);
  const old = f.processors[0];
  a.audio.paused = true; a.audio.emit('pause');
  assert.equal(old.links.size, 0);
  a.audio.paused = false; a.audio.emit('play');
  assert.equal(old.closed, true);
  assert.equal(f.processors[1].links.has(f.context.destination), true);
  assert.equal(f.processors[1].pitchSemitones.value, 2);
});

const recorderSource = await readFile(new URL('../src/lib/microphoneRecorder.ts', import.meta.url), 'utf8');
const recorderCode = ts.transpileModule(recorderSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const { createMicrophoneRecorder } = await import(`data:text/javascript;base64,${Buffer.from(recorderCode).toString('base64')}`);
function recordingFixture(overrides = {}) {
  const f = { requests: 0, stops: 0, now: 0, instances: [], states: [], limits: 0 };
  f.stream = { getTracks: () => [{ stop: () => { f.stops++; } }] };
  class Recorder extends EventTarget {
    mimeType = 'audio/webm;codecs=opus';
    start() { this.state = 'recording'; }
    data(text) { const event = new Event('dataavailable'); event.data = new Blob([text], { type: this.mimeType }); this.dispatchEvent(event); }
    stop() { this.state = 'inactive'; queueMicrotask(() => { this.data('final'); this.dispatchEvent(new Event('stop')); }); }
  }
  f.recorder = createMicrophoneRecorder({
    getStream: async () => { f.requests++; return f.stream; },
    createRecorder: () => { const instance = new Recorder(); f.instances.push(instance); return instance; },
    supported: mime => mime.includes('webm'), now: () => f.now,
    onState: state => f.states.push(state), onLimit: () => { f.limits++; }, ...overrides,
  });
  return f;
}

test('microphone is requested only by start and stop includes the final chunk before releasing tracks', async () => {
  const f = recordingFixture();
  assert.equal(f.requests, 0);
  await f.recorder.start(); f.instances[0].data('voice'); f.now = 2500;
  const recording = await f.recorder.stop();
  assert.equal(await recording.blob.text(), 'voicefinal');
  assert.equal(recording.durationMs, 2500);
  assert.equal(recording.mime, 'audio/webm;codecs=opus');
  assert.equal(f.stops, 1); assert.equal(f.recorder.state, 'idle');
});

test('cancelling a pending permission request releases a stream which arrives later', async () => {
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const f = recordingFixture({ getStream: () => pending });
  const start = f.recorder.start(); f.recorder.cancel(); resolve(f.stream); await start;
  assert.equal(f.stops, 1); assert.equal(f.instances.length, 0); assert.equal(f.recorder.state, 'idle');
});

test('recording rejects duplicate starts and enforces the memory limit', async () => {
  const f = recordingFixture({ maxBytes: 8 });
  await f.recorder.start(); await assert.rejects(f.recorder.start());
  f.instances[0].data('safe'); f.instances[0].data('too large');
  const recording = await f.recorder.completed;
  assert.equal(await recording.blob.text(), 'safe');
  assert.ok(f.limits >= 1); assert.equal(f.stops, 1); assert.equal(f.recorder.state, 'idle');
});

test('a recorder constructor failure releases the permitted microphone', async () => {
  const f = recordingFixture({ createRecorder: () => { throw Error('unsupported'); } });
  await assert.rejects(f.recorder.start());
  assert.equal(f.stops, 1); assert.equal(f.recorder.state, 'idle');
});
