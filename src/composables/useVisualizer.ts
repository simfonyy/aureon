import { onBeforeUnmount, onMounted, watch, type Ref } from "vue";
import { spectrumBands, smoothSpectrum } from "@/lib/spectrum";
import { audioSampleRate, frequencyData } from "@/lib/audio";
import { usePlayerStore } from "@/stores/player/index";

interface VisualizerOptions { bars?: number }


export function useVisualizer(canvas: Ref<HTMLCanvasElement | null>, enabled: () => boolean, options: VisualizerOptions = {}) {
  const player = usePlayerStore();
  const count = options.bars ?? 56;
  const levels = new Float32Array(count);
  const targets = new Float32Array(count);
  let raf = 0, last = 0, colorAt = 0, accent = "#a77cff";
  let reduced = false;
  let media: MediaQueryList;

  function frame(now: number) {
    if (!enabled() || document.hidden) { stop(); return; }
    const el = canvas.value, ctx = el?.getContext("2d");
    if (!el || !ctx) { stop(); return; }
    if (last && now - last < (reduced ? 100 : 32)) { raf = requestAnimationFrame(frame); return; }
    const dt = last ? Math.min((now - last) / 1000, .1) : 1 / 30; last = now;
    const w = el.clientWidth, h = el.clientHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
    if (el.width !== pw || el.height !== ph) { el.width = pw; el.height = ph; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    if (!w || !h) { stop(); return; }
    if (now - colorAt > 500) { accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#a77cff"; colorAt = now; }
    const data = player.isPlaying ? frequencyData() : null;
    spectrumBands(data, audioSampleRate(), targets);
    const slot = w / count, bw = Math.max(1, Math.min(4, slot * .48));
    const maxHeight = Math.max(0, h - 4);
    const center = h / 2;
    const fill = ctx.createLinearGradient(0, center - maxHeight / 2, 0, center + maxHeight / 2);
    fill.addColorStop(0, accent); fill.addColorStop(.5, accent); fill.addColorStop(1, "transparent");
    ctx.fillStyle = fill;
    let peak = 0;
    for (let i = 0; i < count; i++) {
      const target = targets[i];
      const previous = levels[i] ?? 0;
      const next = smoothSpectrum(previous, target, dt);
      levels[i] = next; peak = Math.max(peak, next);
      if (next < .006) continue;
      const edge = (.8 + .2 * Math.sin(Math.PI * (i + .5) / count));
      const bh = Math.min(maxHeight, Math.max(2, next * maxHeight * edge));
      ctx.globalAlpha = (.4 + next * .55) * edge;
      ctx.beginPath();ctx.roundRect(i * slot + (slot - bw) / 2, center - bh / 2, bw, bh, Math.min(bw / 2, bh / 2));ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (!player.isPlaying && peak < .006) { ctx.clearRect(0, 0, w, h); stop(); return; }
    raf = requestAnimationFrame(frame);
  }
  function stop() { cancelAnimationFrame(raf); raf = 0; last = 0; }
  function start() { stop(); if (enabled() && !document.hidden) raf = requestAnimationFrame(frame); }
  function visibility() { document.hidden ? stop() : start(); }
  function preference() { reduced = media.matches; start(); }
  watch(enabled, start, { flush: "post" });
  watch(() => player.isPlaying, start);
  onMounted(() => { media = matchMedia('(prefers-reduced-motion: reduce)'); reduced = media.matches; media.addEventListener('change', preference); document.addEventListener('visibilitychange', visibility); window.addEventListener('resize', start); start(); });
  onBeforeUnmount(() => { stop(); media?.removeEventListener('change', preference); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('resize', start); });
  return { start, stop };
}