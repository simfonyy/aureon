export function ocrSearchLines(text: string): string[] {
  return [...new Set(text.split(/\r?\n/).map(line=>line.replace(/\s+/g,' ').trim()).filter(line=>line.length>=3&&/[\p{L}]/u.test(line)))].slice(0,80);
}
export function validateOcrFile(file: File): void {
  if (!['image/png','image/jpeg','image/webp','image/bmp','image/gif'].includes(file.type)||file.size<=0||file.size>16*1024*1024) throw Error('Выбери PNG, JPEG, WebP, BMP или GIF до 16 МБ');
}
const cancelled = () => new DOMException('Распознавание отменено', 'AbortError');
export async function ocrCanvas(file: File, signal?: AbortSignal): Promise<HTMLCanvasElement> {
  validateOcrFile(file); if(signal?.aborted)throw cancelled();
  const image=await createImageBitmap(file);
  try { if(signal?.aborted)throw cancelled();if(image.width*image.height>32_000_000)throw Error('Изображение слишком большое');const ratio=Math.min(1,2200/Math.max(image.width,image.height));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.width*ratio));canvas.height=Math.max(1,Math.round(image.height*ratio));const context=canvas.getContext('2d');if(!context)throw Error('Не удалось прочитать изображение');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(image,0,0,canvas.width,canvas.height);return canvas; } finally { image.close(); }
}

interface OcrWorker { terminate(): unknown | Promise<unknown> }
/** A job owns only its own worker, including workers resolving after cancellation. */
export function createOcrJobOwner() {
  let active: { cancel(): void } | null = null;
  function cancel() { const previous = active; active = null; previous?.cancel(); }
  function begin() {
    cancel();
    const controller = new AbortController();
    let ownedWorker: OcrWorker | undefined, cleanup: Promise<void> | undefined;
    const release = (): Promise<void> => {
      if (!ownedWorker) return Promise.resolve();
      if (!cleanup) { const worker = ownedWorker; cleanup = Promise.resolve().then(() => worker.terminate()).then(() => undefined).catch(() => undefined); }
      return cleanup;
    };
    const job = {
      signal: controller.signal,
      current: () => active === job && !controller.signal.aborted,
      async adopt(worker: OcrWorker): Promise<boolean> { ownedWorker = worker; if (!job.current()) { await release(); return false; } return true; },
      cancel() { controller.abort(); void release(); },
      async finish() { if (active === job) active = null; await release(); },
      wait<T>(work: Promise<T>): Promise<T> {
        return new Promise((resolve, reject) => {
          const abort = () => { controller.signal.removeEventListener('abort', abort); reject(cancelled()); };
          // Attach both branches even when already cancelled: a late worker error is handled.
          work.then(value => { controller.signal.removeEventListener('abort', abort); if (controller.signal.aborted) reject(cancelled()); else resolve(value); }, error => { controller.signal.removeEventListener('abort', abort); reject(error); });
          if (controller.signal.aborted) abort(); else controller.signal.addEventListener('abort', abort, { once: true });
        });
      },
    };
    active = job; return job;
  }
  return { begin, cancel };
}
