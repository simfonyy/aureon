import test from 'node:test';
import assert from 'node:assert/strict';
import { LyricsEffects } from '../src/lib/lyricsFx/renderer.ts';

// The real renderer's clock and geometry run against a recording Graphics
// sink. No browser, GPU, fake timers, or duplicated animation equations.
class GraphicsRecorder {
  commands = [];
  clear() { this.commands = []; return this; }
  moveTo(...args) { this.commands.push(['moveTo', ...args]); return this; }
  lineTo(...args) { this.commands.push(['lineTo', ...args]); return this; }
  bezierCurveTo(...args) { this.commands.push(['bezierCurveTo', ...args]); return this; }
  quadraticCurveTo(...args) { this.commands.push(['quadraticCurveTo', ...args]); return this; }
  closePath() { this.commands.push(['closePath']); return this; }
  fill(...args) { this.commands.push(['fill', ...args]); return this; }
  stroke(...args) { this.commands.push(['stroke', ...args]); return this; }
  ellipse(...args) { this.commands.push(['ellipse', ...args]); return this; }
  rect(...args) { this.commands.push(['rect', ...args]); return this; }
}
function point() { return { x: 0, y: 0, set(x, y = x) { this.x = x; this.y = y; } }; }
function object() { return { position: point(), scale: point(), pivot: point(), alpha: 1, tint: 0, visible: true }; }
function classList() { const set = new Set(); return { add: x => set.add(x), remove: x => set.delete(x), contains: x => set.has(x) }; }
function rect(x, y, width, height) { return { left: x, top: y, right: x + width, bottom: y + height, width, height }; }

function fixture(kind = 'blood') {
  const host = { getBoundingClientRect: () => rect(0, 0, 500, 300) };
  const element = { isConnected: true, classList: classList(), getBoundingClientRect: () => rect(40, 80, 180, 60) };
  const fx = new LyricsEffects(host);
  const canvas = { style: { display: 'block' } };
  let renders = 0;
  fx.app = { canvas, renderer: { resize() {} }, render() { renders++; } };
  fx.supported = true;
  const raster = {
    key: 'fixture', width: 180, height: 60, pad: 8, fontSize: 48,
    emitters: [{ x: 40, y: 45, delay: .1, detach: .5, length: 24, radius: 3, lean: 2, gravity: 120 }],
  };
  const rig = {
    key: 'event|fixture', raster, container: object(),
    tail: object(), echo: object(), base: object(), ink: object(),
    inkMask: new GraphicsRecorder(), liquid: new GraphicsRecorder(),
  };
  fx.rasterFor = () => raster;
  fx.rigs.set(rig.key, rig);
  const frame = {
    event: { id: 'event', wordId: 'word', type: kind, startMs: 1000, durationMs: 2400, intensity: .9, seed: 42 },
    word: { id: 'word', text: 'проверка', startMs: 1000, endMs: 1200, lineId: 'line' }, element, fill: 1,
  };
  function snapshot(ms) {
    fx.render(ms, [frame]);
    return structuredClone({
      commands: rig.liquid.commands, mask: rig.inkMask.commands,
      position: { x: rig.container.position.x, y: rig.container.position.y },
      scale: { x: rig.container.scale.x, y: rig.container.scale.y },
      alpha: rig.container.alpha, ink: rig.ink.tint,
      tail: { x: rig.tail.position.x, y: rig.tail.position.y, alpha: rig.tail.alpha },
      echo: { x: rig.echo.position.x, y: rig.echo.position.y, alpha: rig.echo.alpha },
    });
  }
  return { fx, frame, element, rig, canvas, snapshot, renders: () => renders };
}

for (const kind of ['blood', 'impact']) {
  test(`${kind}: pause and seek reconstruct exactly the same scene`, () => {
    const { snapshot } = fixture(kind);
    const state = snapshot(1390);
    assert.deepEqual(snapshot(1390), state, 'pause cannot advance the effect');
    snapshot(2100); snapshot(1050); snapshot(3200);
    assert.deepEqual(snapshot(1390), state, 'seek history must not change the effect');
    assert.notDeepEqual(snapshot(1550), state, 'audio time must advance the effect');
  });
}

test('blood remains anchored before detach and then falls away', () => {
  const { snapshot } = fixture();
  const attached = snapshot(1300).commands;
  const detached = snapshot(1700).commands;
  assert.ok(attached.some(command => command[0] === 'bezierCurveTo'), 'viscous stem is a contour path');
  assert.ok(detached.some(command => command[0] === 'lineTo'), 'falling drop has a short trail');
  const tip = attached.find(command => command[0] === 'ellipse');
  const falling = detached.find(command => command[0] === 'ellipse');
  assert.ok(falling[2] > tip[2], 'detached drop moves below attached tip');
});

test('context loss reveals DOM words and hides any stale canvas', () => {
  const { fx, element, canvas, snapshot } = fixture();
  snapshot(1390);
  assert.equal(element.classList.contains('fx-rendered'), true);
  let prevented = false;
  fx.contextLost({ preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(fx.supported, false);
  assert.equal(element.classList.contains('fx-rendered'), false);
  assert.equal(canvas.style.display, 'none');
  fx.contextRestored();
  assert.equal(fx.supported, true);
  assert.equal(canvas.style.display, 'none', 'restore cannot resurrect the old paused canvas');
  snapshot(1390);
  assert.equal(canvas.style.display, 'block', 'a fresh audio-time render can show the canvas');
});

test('clipped, disconnected, ended and cleared words always fall back to DOM', () => {
  const { fx, frame, element, snapshot } = fixture();
  snapshot(1390);
  element.getBoundingClientRect = () => rect(600, 80, 180, 60);
  fx.render(1400, [frame]);
  assert.equal(element.classList.contains('fx-rendered'), false);
  element.getBoundingClientRect = () => rect(40, 80, 180, 60);
  snapshot(1390);
  element.isConnected = false;
  fx.render(1400, [frame]);
  assert.equal(element.classList.contains('fx-rendered'), false);
  element.isConnected = true;
  snapshot(1390); fx.render(3400, [frame]);
  assert.equal(element.classList.contains('fx-rendered'), false);
  snapshot(1390); fx.clear();
  assert.equal(element.classList.contains('fx-rendered'), false);
});

test('word never fades out while the blood accent is ending', () => {
  const { snapshot } = fixture();
  const state = snapshot(3399);
  assert.equal(state.alpha, 1);
  assert.equal(state.ink, 0xf7f4f6, 'accent returns to the regular white word');
});

test('long word wrapping preserves every character in bounded rows', () => {
  const { fx } = fixture();
  const text = 'сверхдлинноепроверочноеслово';
  const rows = fx.wrapText({ measureText: value => ({ width: Array.from(value).length * 20 }) }, text, 100);
  assert.ok(rows.length > 1);
  assert.equal(rows.join(''), text);
  assert.ok(rows.every(row => Array.from(row).length <= 5));
});

test('track reset releases word textures and restores DOM before the next song', () => {
  const { fx, element, rig, snapshot } = fixture();
  let texturesDestroyed = 0, rigsDestroyed = 0, filtersDestroyed = 0;
  rig.container.destroy = () => rigsDestroyed++;
  rig.glow = { destroy() { filtersDestroyed++; } };
  rig.blur = { destroy() { filtersDestroyed++; } };
  fx.rasters.set('old-word', { texture: { destroy() { texturesDestroyed++; } } });
  snapshot(1390);
  fx.reset();
  assert.equal(element.classList.contains('fx-rendered'), false);
  assert.equal(fx.rigs.size, 0);
  assert.equal(fx.rasters.size, 0);
  assert.equal(texturesDestroyed, 1);
  assert.equal(rigsDestroyed, 1);
  assert.equal(filtersDestroyed, 2);
});

test('an unavailable audio clock clears the old effect and reveals the lyric', () => {
  const { fx, frame, element, rig, snapshot } = fixture();
  snapshot(1390);
  fx.render(Number.NaN, [frame]);
  assert.equal(element.classList.contains('fx-rendered'), false);
  assert.equal(rig.container.visible, false);
});
