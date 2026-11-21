import { Application, Container, Graphics, Sprite, Texture } from 'pixi.js';
import { GlowFilter, MotionBlurFilter } from 'pixi-filters';
import type { FxFrame } from './rendererTypes';

type Emitter = { x: number; y: number; delay: number; detach: number; length: number; radius: number; lean: number; gravity: number };
type WordRaster = { key: string; texture: Texture; width: number; height: number; pad: number; fontSize: number; bottoms: number[]; emitters: Emitter[] };
type WordRig = {
  key: string;
  raster: WordRaster;
  container: Container;
  tail: Sprite;
  echo: Sprite;
  base: Sprite;
  ink: Sprite;
  inkMask: Graphics;
  liquid: Graphics;
  glow: GlowFilter;
  blur: MotionBlurFilter;
};

const RED = 0xf13853;
const DARK_RED = 0x850c2c;
const PALE_RED = 0xff7489;
const clamp = (value: number, low = 0, high = 1) => Math.min(high, Math.max(low, value));
const ease = (value: number) => { const x = clamp(value); return x * x * (3 - 2 * x); };
function blendColor(from: number, to: number, amount: number) {
  const t = clamp(amount);
  const r = Math.round((from >> 16) + ((to >> 16) - (from >> 16)) * t);
  const g = Math.round(((from >> 8) & 255) + (((to >> 8) & 255) - ((from >> 8) & 255)) * t);
  const b = Math.round((from & 255) + ((to & 255) - (from & 255)) * t);
  return (r << 16) | (g << 8) | b;
}

function random(seed: number) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let x = value;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** A clock-driven overlay. Calling render twice at the same audio time gives the same scene. */
export class LyricsEffects {
  public supported = false;
  private app: Application | null = null;
  private destroyed = false;
  private host: HTMLElement;
  private width = 0;
  private height = 0;
  private rigs = new Map<string, WordRig>();
  private rasters = new Map<string, WordRaster>();
  private hiddenWords = new Set<HTMLElement>();
  private readonly contextLost = (event: Event) => {
    event.preventDefault();
    this.supported = false;
    this.revealWords();
    for (const rig of this.rigs.values()) rig.container.visible = false;
    if (this.app) this.app.canvas.style.display = 'none';
  };
  private readonly contextRestored = () => {
    if (!this.destroyed) {
      this.supported = true;
      // A paused or disabled scene must not resurrect an old accent. Only a
      // successful render is allowed to show this canvas again.
    }
  };

  private constructor(host: HTMLElement) { this.host = host; }

  static async create(host: HTMLElement): Promise<LyricsEffects> {
    const result = new LyricsEffects(host);
    let app: Application | null = null;
    try {
      await document.fonts.ready;
      app = new Application();
      await app.init({
        width: Math.max(1, host.clientWidth), height: Math.max(1, host.clientHeight),
        preference: 'webgl', antialias: true, backgroundAlpha: 0,
        autoDensity: true, resolution: Math.min(2, window.devicePixelRatio || 1),
        autoStart: false, sharedTicker: false, powerPreference: 'high-performance',
      });
      app.stop();
      const canvas = app.canvas;
      canvas.classList.add('lyrics-effects-canvas');
      canvas.setAttribute('aria-hidden', 'true');
      Object.assign(canvas.style, { position: 'absolute', inset: '0', pointerEvents: 'none', display: 'block' });
      canvas.addEventListener('webglcontextlost', result.contextLost);
      canvas.addEventListener('webglcontextrestored', result.contextRestored);
      host.append(canvas);
      result.app = app;
      result.supported = true;
    } catch (error) {
      try { if (app?.renderer) app.destroy(true, { children: true }); } catch { /* DOM fallback remains active. */ }
      console.warn('Графические эффекты недоступны. Обычный текст сохранён.', error);
      result.supported = false;
    }
    return result;
  }

  render(nowMs: number, frames: FxFrame[]): void {
    const app = this.app;
    if (!Number.isFinite(nowMs)) { this.clear(); return; }
    if (!app || !this.supported || this.destroyed) { this.revealWords(); return; }
    const hostBounds = this.host.getBoundingClientRect();
    const w = Math.round(hostBounds.width), h = Math.round(hostBounds.height);
    if (w <= 0 || h <= 0) { this.clear(); return; }
    if (w !== this.width || h !== this.height) {
      this.width = w; this.height = h;
      app.renderer.resize(w, h);
    }
    for (const rig of this.rigs.values()) rig.container.visible = false;
    const visibleWords = new Set<HTMLElement>();
    try {
      for (const frame of frames) {
        const { event, element } = frame;
        if (!element.isConnected || nowMs < event.startMs || nowMs >= event.startMs + event.durationMs) continue;
        const bounds = element.getBoundingClientRect();
        if (bounds.width < 1 || bounds.height < 1 || bounds.right < hostBounds.left || bounds.left > hostBounds.right || bounds.bottom < hostBounds.top || bounds.top > hostBounds.bottom) continue;
        const raster = this.rasterFor(frame);
        if (!raster) continue;
        const key = `${event.id}|${raster.key}`;
        let rig = this.rigs.get(key);
        if (!rig) {
          rig = this.createRig(key, raster, event.type);
          this.rigs.set(key, rig);
          app.stage.addChild(rig.container);
        }
        this.positionRig(rig, frame, nowMs, bounds.left - hostBounds.left, bounds.top - hostBounds.top);
        visibleWords.add(element);
      }
      app.render();
      app.canvas.style.display = 'block';
      for (const element of this.hiddenWords) {
        if (!visibleWords.has(element)) element.classList.remove('fx-rendered');
      }
      for (const element of visibleWords) element.classList.add('fx-rendered');
      this.hiddenWords = visibleWords;
      this.trimCaches();
    } catch (error) {
      this.supported = false;
      this.revealWords();
      app.canvas.style.display = 'none';
      for (const rig of this.rigs.values()) rig.container.visible = false;
      try { app.render(); } catch { /* DOM text remains available after a context failure. */ }
      console.warn('Эффект остановлен; текст продолжает работать.', error);
    }
  }

  clear(): void {
    this.revealWords();
    if (!this.app || this.destroyed) return;
    for (const rig of this.rigs.values()) rig.container.visible = false;
    if (this.supported) {
      try { this.app.render(); } catch { this.supported = false; }
    }
  }

  /** Release word-specific GPU resources when the lyric source or track changes. */
  reset(): void {
    this.clear();
    for (const rig of this.rigs.values()) {
      rig.container.destroy({ children: true });
      rig.glow.destroy();
      rig.blur.destroy();
    }
    for (const raster of this.rasters.values()) raster.texture.destroy(true);
    this.rigs.clear();
    this.rasters.clear();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.revealWords();
    this.destroyed = true;
    const app = this.app;
    if (app) {
      app.canvas.removeEventListener('webglcontextlost', this.contextLost);
      app.canvas.removeEventListener('webglcontextrestored', this.contextRestored);
      for (const rig of this.rigs.values()) {
        rig.glow.destroy(); rig.blur.destroy();
      }
      app.destroy(true, { children: true });
    }
    for (const raster of this.rasters.values()) raster.texture.destroy(true);
    this.rigs.clear(); this.rasters.clear(); this.app = null; this.supported = false;
  }

  private revealWords() {
    for (const element of this.hiddenWords) element.classList.remove('fx-rendered');
    this.hiddenWords.clear();
  }

  private rasterFor(frame: FxFrame): WordRaster | null {
    const el = frame.element, style = getComputedStyle(el), rect = el.getBoundingClientRect();
    const fontSize = parseFloat(style.fontSize) || 42;
    const lineHeight = parseFloat(style.lineHeight) || fontSize * 1.18;
    const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    let text = frame.word.text.trimEnd();
    if (style.textTransform === 'uppercase') text = text.toLocaleUpperCase();
    if (style.textTransform === 'lowercase') text = text.toLocaleLowerCase();
    const width = Math.max(1, Math.ceil(rect.width)), height = Math.max(1, Math.ceil(rect.height));
    const key = `${text}|${font}|${style.letterSpacing}|${width}|${height}|${lineHeight}|${frame.event.seed}`;
    const cached = this.rasters.get(key);
    if (cached) return cached;
    const pad = 8, dpr = 2;
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil((width + pad * 2) * dpr);
    canvas.height = Math.ceil((height + pad * 2) * dpr);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.scale(dpr, dpr);
    ctx.font = font;
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#fff';
    ctx.fontKerning = style.fontKerning as CanvasFontKerning;
    if ('letterSpacing' in ctx) (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = style.letterSpacing;
    const metrics = ctx.measureText(text);
    const ascent = metrics.fontBoundingBoxAscent || metrics.actualBoundingBoxAscent || fontSize * .8;
    const descent = metrics.fontBoundingBoxDescent || metrics.actualBoundingBoxDescent || fontSize * .2;
    const baseline = (lineHeight - ascent - descent) / 2 + ascent;
    const rows = this.wrapText(ctx, text, width);
    rows.forEach((row, index) => ctx.fillText(row, pad, pad + baseline + index * lineHeight));
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const bottoms: number[] = [];
    for (let x = 0; x < width; x++) {
      const sx = Math.min(canvas.width - 1, Math.round((x + pad) * dpr));
      let bottom = -1;
      for (let y = Math.min(canvas.height - 1, Math.ceil((height + pad) * dpr)); y >= pad * dpr; y--) {
        if ((pixels[(y * canvas.width + sx) * 4 + 3] ?? 0) > 150) { bottom = y / dpr - pad; break; }
      }
      bottoms.push(bottom);
    }
    const emitters = this.makeEmitters(bottoms, width, fontSize, frame.event.seed);
    const raster: WordRaster = { key, texture: Texture.from(canvas), width, height, pad, fontSize, bottoms, emitters };
    this.rasters.set(key, raster);
    return raster;
  }

  private wrapText(ctx: CanvasRenderingContext2D, text: string, width: number): string[] {
    if (ctx.measureText(text).width <= width + 1) return [text];
    const rows: string[] = [];
    let row = '';
    for (const char of Array.from(text)) {
      if (row && ctx.measureText(row + char).width > width + 1) { rows.push(row); row = char; }
      else row += char;
    }
    if (row) rows.push(row);
    return rows;
  }

  private makeEmitters(bottoms: number[], width: number, fontSize: number, seed: number): Emitter[] {
    const rng = random(seed);
    const candidates = bottoms.flatMap((y, x) => y >= fontSize * .3 ? [x] : []);
    if (!candidates.length) return [];
    const count = Math.min(8, Math.max(3, Math.floor(width / (fontSize * .5))));
    const emitters: Emitter[] = [];
    for (let i = 0; i < count; i++) {
      const portion = (i + .2 + rng() * .6) / count;
      const ideal = Math.round(portion * width);
      let best = candidates[0]!, score = Infinity;
      for (const x of candidates) {
        // Prefer lower contour tips so each neck stays attached to a real glyph.
        const value = Math.abs(x - ideal) - bottoms[x]! * .12;
        if (value < score && !emitters.some(e => Math.abs(e.x - x) < fontSize * .14)) { best = x; score = value; }
      }
      if (!Number.isFinite(score)) continue;
      emitters.push({
        x: best, y: bottoms[best]! - .8,
        delay: .04 + rng() * .32, detach: .44 + rng() * .25,
        length: fontSize * (.35 + rng() * .42), radius: fontSize * (.05 + rng() * .03),
        lean: (rng() - .5) * fontSize * .12, gravity: 95 + rng() * 65,
      });
    }
    return emitters;
  }

  private createRig(key: string, raster: WordRaster, kind: string): WordRig {
    const container = new Container();
    const tail = new Sprite(raster.texture), echo = new Sprite(raster.texture);
    const base = new Sprite(raster.texture), ink = new Sprite(raster.texture);
    const inkMask = new Graphics(), liquid = new Graphics();
    for (const sprite of [tail, echo, base, ink]) {
      sprite.scale.set(.5);
      sprite.position.set(-raster.pad, -raster.pad);
    }
    tail.tint = kind === 'blood' ? DARK_RED : 0xcbd0de;
    echo.tint = kind === 'blood' ? RED : 0xffffff;
    base.tint = 0x938c98;
    ink.tint = kind === 'blood' ? RED : 0xffffff;
    container.addChild(tail, echo, liquid, base, ink, inkMask);
    ink.mask = inkMask;
    const glow = new GlowFilter({ distance: 9, outerStrength: .5, innerStrength: 0, color: RED, quality: .15 });
    const blur = new MotionBlurFilter({ velocity: { x: 5, y: 0 }, kernelSize: 5, offset: -1 });
    if (kind === 'blood') ink.filters = [glow];
    else echo.filters = [blur];
    return { key, raster, container, tail, echo, base, ink, inkMask, liquid, glow, blur };
  }

  private positionRig(rig: WordRig, frame: FxFrame, nowMs: number, x: number, y: number) {
    const { raster, container, base, ink, inkMask, tail, echo, liquid } = rig;
    const { event } = frame;
    const age = Math.max(0, nowMs - event.startMs) / 1000;
    const duration = event.durationMs / 1000;
    const intensity = clamp(event.intensity, .15, 1);
    const fade = ease((duration - age) / .34);
    const fill = clamp(Number.isFinite(frame.fill) ? frame.fill : 0);
    container.visible = true;
    // Only the liquid and accent fade. The word itself remains readable until
    // the DOM resumes drawing it at the end of the event.
    container.alpha = 1;
    container.position.set(x, y);
    container.pivot.set(0, 0);
    container.scale.set(1);
    base.alpha = 1;
    ink.alpha = 1;
    inkMask.clear().rect(-raster.pad, -raster.pad, Math.max(0, raster.width * fill + raster.pad), raster.height + raster.pad * 2).fill(0xffffff);
    liquid.clear();
    if (event.type === 'blood') {
      const enter = ease(age / .13);
      ink.tint = blendColor(0xf7f4f6, RED, enter * fade);
      const strain = Math.sin(age * 8) * Math.exp(-age * 4) * intensity;
      container.scale.set(1 + strain * .018, 1 + strain * .09);
      container.position.y -= strain * 2;
      tail.alpha = enter * .1 * intensity * fade;
      tail.position.set(-raster.pad + Math.sin(age * 3) * .7, -raster.pad + 3);
      tail.scale.set(.5, .5 + enter * .022);
      echo.alpha = enter * .12 * intensity * fade;
      echo.position.set(-raster.pad, -raster.pad + 1.6);
      echo.scale.set(.5);
      this.drawBlood(liquid, raster, age, fill, intensity, fade);
    } else {
      ink.tint = 0xf7f4f6;
      const spring = Math.sin(age * 22) * Math.exp(-age * 6.8) * intensity;
      const blast = (1 - Math.exp(-age * 32)) * Math.exp(-age * 8) * intensity;
      container.pivot.set(raster.width * .5, raster.height * .62);
      container.position.set(x + raster.width * .5, y + raster.height * .62 - spring * 5);
      container.scale.set(1 + spring * .13, 1 + spring * .29);
      tail.alpha = blast * .16 * fade;
      tail.position.set(-raster.pad - blast * 20, -raster.pad + blast * 2);
      tail.scale.set(.5 + blast * .03, .5);
      echo.alpha = blast * .32 * fade;
      echo.position.set(-raster.pad + blast * 9, -raster.pad - blast * 2);
      echo.scale.set(.5);
    }
  }

  private drawBlood(g: Graphics, raster: WordRaster, age: number, fill: number, intensity: number, fade: number) {
    for (const emitter of raster.emitters) {
      if (emitter.x > raster.width * fill) continue;
      const t = age - emitter.delay;
      if (t < 0) continue;
      const { x, y } = emitter;
      const radius = emitter.radius * (.7 + intensity * .3);
      const length = emitter.length * (.7 + intensity * .3);
      const grow = clamp(t / emitter.detach);
      const attached = t < emitter.detach;
      const neck = attached ? length * grow ** 1.4 : Math.max(2, length * .14 * Math.exp(-(t - emitter.detach) * 5));
      const lean = emitter.lean * grow;
      const stem = radius * (attached ? .48 + .4 * Math.sin(grow * Math.PI) : .45);
      const wet = ease(t / .1) * fade;
      g.moveTo(x - stem, y - 2)
        .bezierCurveTo(x - stem * 1.4, y + neck * .2, x + lean - stem * .35, y + neck * .74, x + lean - stem * .65, y + neck)
        .quadraticCurveTo(x + lean, y + neck + radius * .8, x + lean + stem * .65, y + neck)
        .bezierCurveTo(x + lean + stem * .35, y + neck * .74, x + stem * 1.4, y + neck * .2, x + stem, y - 2)
        .closePath().fill({ color: RED, alpha: wet * .95 });
      g.moveTo(x + stem * .45, y)
        .quadraticCurveTo(x + lean + .3, y + neck * .5, x + lean + .3, y + neck * .92)
        .stroke({ color: PALE_RED, alpha: wet * .2, width: .65 });
      if (attached) {
        const size = radius * (.35 + grow * .9);
        g.ellipse(x + lean, y + neck, size * .78, size * 1.2).fill({ color: RED, alpha: wet });
        g.ellipse(x + lean + size * .2, y + neck - size * .25, size * .18, size * .38).fill({ color: PALE_RED, alpha: wet * .3 });
      } else {
        const fall = t - emitter.detach;
        const distance = 30 * fall + emitter.gravity * fall * fall * .5;
        const travelFade = 1 - ease((distance - raster.fontSize * .2) / (raster.fontSize * .8));
        if (travelFade <= 0) continue;
        const px = x + emitter.lean + emitter.lean * fall * .22;
        const py = y + length + distance;
        const alpha = travelFade * fade;
        const stretch = 1 + Math.min(.6, fall * 1.4);
        g.moveTo(px, py - Math.min(22, 8 + fall * 25)).lineTo(px, py - radius)
          .stroke({ color: DARK_RED, width: radius * .8, alpha: alpha * .32 });
        g.ellipse(px, py, radius * .9 / Math.sqrt(stretch), radius * stretch)
          .fill({ color: RED, alpha });
        g.ellipse(px + radius * .2, py - radius * .25, radius * .18, radius * .35)
          .fill({ color: PALE_RED, alpha: alpha * .4 });
      }
    }
  }

  private trimCaches() {
    if (this.rigs.size <= 12) return;
    for (const [key, rig] of this.rigs) {
      if (this.rigs.size <= 8) break;
      if (rig.container.visible) continue;
      rig.container.destroy({ children: true });
      rig.glow.destroy(); rig.blur.destroy();
      this.rigs.delete(key);
    }
    const used = new Set([...this.rigs.values()].map(rig => rig.raster.key));
    for (const [key, raster] of this.rasters) {
      if (!used.has(key)) { raster.texture.destroy(true); this.rasters.delete(key); }
    }
  }
}
