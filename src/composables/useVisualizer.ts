import { onBeforeUnmount, onMounted, watch, type Ref } from "vue";
import { frequencyData } from "@/lib/audio";
import { usePlayerStore } from "@/stores/player/index";

interface VisualizerOptions { bars?: number }


export function useVisualizer(canvas: Ref<HTMLCanvasElement | null>, enabled: () => boolean, options: VisualizerOptions = {}) {
  const player = usePlayerStore();
  const count = options.bars ?? 56;
  const levels = new Float32Array(count);
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
    const usable = data ? Math.floor(data.length * .66) : 0;
    const stride = Math.max(1, Math.floor(usable / count));
    const slot = w / count, bw = Math.max(1, Math.min(4, slot * .48));
    const maxHeight = Math.min(32, Math.max(0, h - 4));
    const center = h / 2;
    const fill = ctx.createLinearGradient(0, center - maxHeight / 2, 0, center + maxHeight / 2);
    fill.addColorStop(0, accent); fill.addColorStop(.5, accent); fill.addColorStop(1, "transparent");
    ctx.fillStyle = fill;
    let peak = 0;
    for (let i = 0; i < count; i++) {
      let sum = 0;
      if (data) for (let j = 0; j < stride; j++) sum += data[i * stride + j] ?? 0;
      const target = data ? Math.pow(sum / stride / 255, 1.5) : 0;
      const previous = levels[i] ?? 0;
      const next = previous + (target - previous) * (1 - Math.exp(-dt / (target > previous ? .045 : .21)));
      levels[i] = next; peak = Math.max(peak, next);
      if (next < .006) continue;
      const edge = Math.pow(Math.sin(Math.PI * (i + .5) / count), .4);
      const bh = Math.min(maxHeight, Math.max(2, next * maxHeight * edge));
      ctx.globalAlpha = (.25 + next * .5) * edge;
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