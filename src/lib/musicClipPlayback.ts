import type { MusicClipStream } from '@/api/types';
import { clipMediaUrl } from './musicClips';

type HlsModule = typeof import('hls.js');
interface Options { current: () => boolean; onError: (message: string) => void; background?: boolean; loadHls?: () => Promise<HlsModule> }

/** The signed stream stays in memory. OAuth is never added to video requests. */
export async function attachMusicClip(video: HTMLVideoElement, stream: MusicClipStream, options: Options): Promise<(() => void) | null> {
  const url = clipMediaUrl(stream.url);
  if (!url) throw new Error('Яндекс Музыка вернула неподдерживаемый адрес клипа.');
  if (!options.current()) return null;
  let destroy = () => {};
  if (stream.kind === 'hls') {
    const { default: Hls } = await (options.loadHls ?? (() => import('hls.js')))();
    if (!options.current()) return null;
    // Chromium may report native HLS as "maybe" but fail to decode the stream.
    // Prefer the HLS.js MSE path; keep native HLS for platforms without MSE.
    if (Hls.isSupported()) {
      const hls = new Hls({
        maxBufferLength: 30, maxMaxBufferLength: 60, backBufferLength: 15,
        maxBufferSize: 32 * 1024 * 1024, capLevelToPlayerSize: true, startLevel: 0,
        manifestLoadingTimeOut: 15_000, levelLoadingTimeOut: 15_000, fragLoadingTimeOut: 20_000,
        emeEnabled: false,
      });
      let hlsDestroyed = false;
      let networkRetries = 0, mediaRecoveries = 0, maximumLevel = -1;
      let retryTimer: ReturnType<typeof setTimeout> | undefined;
      const current = () => !hlsDestroyed && options.current();
      const cancelRetry = () => { if (retryTimer !== undefined) clearTimeout(retryTimer); retryTimer = undefined; };
      const destroyHls = () => { if (!hlsDestroyed) { hlsDestroyed = true; cancelRetry(); hls.destroy(); } };
      const fail = () => {
        if (!current()) return;
        destroyHls();
        options.onError('Не удалось воспроизвести клип. Повтори загрузку или открой трек в Яндекс Музыке.');
      };
      const applyMaximumLevel = () => {
        if (!current() || maximumLevel < 0) return;
        const cap = hls.autoLevelCapping;
        if (cap < 0 || cap > maximumLevel) hls.autoLevelCapping = maximumLevel;
      };
      hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
        if (!current() || !options.background) return;
        maximumLevel = -1;
        // autoLevelCapping permits every level up to an index. Inspect the whole
        // prefix, including duplicate codec renditions, rather than assuming one
        // resolution per index or allowing a larger rendition in the middle.
        for (const [index, level] of data.levels.entries()) {
          if (!Number.isFinite(level.height) || level.height <= 0 || level.height > 720) break;
          maximumLevel = index;
        }
        applyMaximumLevel();
      });
      // The player-size controller can raise its cap after a resize. Keep the
      // background ceiling while retaining smaller size-based caps.
      hls.on(Hls.Events.MAX_AUTO_LEVEL_UPDATED, applyMaximumLevel);
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal || !current()) return;
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          if (retryTimer !== undefined) return;
          if (networkRetries >= 2) { fail(); return; }
          const delay = [750, 2000][networkRetries++]!;
          retryTimer = setTimeout(() => {
            retryTimer = undefined;
            if (!current()) { destroyHls(); return; }
            try { hls.startLoad(Number.isFinite(video.currentTime) ? Math.max(0, video.currentTime) : -1); }
            catch { fail(); }
          }, delay);
          return;
        }
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR && mediaRecoveries++ === 0) {
          cancelRetry();
          try { hls.recoverMediaError(); } catch { fail(); }
          return;
        }
        fail();
      });
      try { hls.loadSource(url); hls.attachMedia(video); }
      catch (cause) { destroyHls(); throw cause; }
      destroy = destroyHls;
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) video.src = url;
    else throw new Error('Эта версия WebView не поддерживает видео HLS.');
  } else if (stream.kind === 'mp4') video.src = url;
  else throw new Error('Формат клипа не поддерживается.');
  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true; destroy(); video.pause(); video.removeAttribute('src'); video.load();
  };
}
