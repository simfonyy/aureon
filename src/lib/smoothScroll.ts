export function createScrollFollower(read: () => number, write: (value: number) => void) {
  let frame = 0, target = 0, previous = 0;
  function stop() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0; previous = 0;
  }
  function step(now: number) {
    const dt = previous ? Math.min(64, now - previous) : 16;
    previous = now;
    const current = read();
    const next = current + (target - current) * (1 - Math.exp(-dt / 115));
    if (Math.abs(target - next) < 0.4) { write(target); stop(); return; }
    write(next);
    frame = requestAnimationFrame(step);
  }
  return { stop, move(value: number, animate: boolean) {
    target = Math.max(0, value);
    if (!animate) { stop(); write(target); return; }
    if (!frame) frame = requestAnimationFrame(step);
  } };
}
