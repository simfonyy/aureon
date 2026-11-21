// Ignore damaged fields individually: one invalid value must not reset the theme.
export function restoreSettings<T extends object>(defaults: T, saved: unknown): T {
  const result = structuredClone(defaults);
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return result;
  const values = saved as Record<string, unknown>;
  for (const key of Object.keys(defaults) as (keyof T)[]) {
    const value = values[String(key)];
    const baseline = defaults[key];
    if (value === null || value === undefined) continue;
    if (Array.isArray(baseline) ? Array.isArray(value) : typeof value === typeof baseline) {
      if (typeof value === 'number' && !Number.isFinite(value)) continue;
      result[key] = value as T[keyof T];
    }
  }
  return result;
}

export function restorePlayerLayout<T extends object>(settings: T, snapshot: T): void {
  for (const key of Object.keys(snapshot) as (keyof T)[]) {
    if (/^(player|mini)/.test(String(key)) || key === 'showPlayerArtwork') settings[key] = snapshot[key];
  }
}

export function restoreBackgroundMode(saved: { backgroundMode?: unknown; metalRenderer?: unknown; metalQuality?: unknown; liquidMetal?: unknown; theme?: unknown } | null): 'matte' | 'beauty' {
  if (saved?.backgroundMode === 'matte' || saved?.backgroundMode === 'beauty') return saved.backgroundMode;
  return saved?.metalRenderer === 'webgl' && saved.metalQuality !== 'optimized' && saved.liquidMetal !== false && saved.theme !== 'matte' ? 'beauty' : 'matte';
}
