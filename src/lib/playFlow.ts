export interface PlayDiagnostic { at: number; request: number; track: string; stage: string; elapsed?: number }
const entries: PlayDiagnostic[] = [];
export function playDiagnostic(request: number, track: string, stage: string, elapsed?: number) {
  entries.push({ at: Date.now(), request, track, stage, elapsed });
  if (entries.length > 80) entries.shift();

  console.info(`[play] ${request} ${stage}${elapsed === undefined ? '' : ` ${Math.round(elapsed)}ms`}`);
}
export function playbackDiagnostics() { return entries.map(entry => ({ ...entry })); }
export async function withDeadline<T>(operation: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label}: превышено время ожидания. Попробуй другой трек.`)), ms);
    })]);
  } finally { clearTimeout(timer); }
}
