export interface ClipSyncMedia {
  currentTime: number;
  duration: number;
  readyState: number;
  paused: boolean;
  seeking?: boolean;
  playbackRate: number;
  muted: boolean;
  loop: boolean;
  play(): Promise<void>;
  pause(): void;
}

interface Options {
  current: () => boolean;
  onError: (message: string) => void;
}

/** Audio owns the clock. Video never loops or changes the audio player's state. */
export function createMusicClipSynchronizer(media: ClipSyncMedia, options: Options) {
  let disposed = false;
  let failed = false;
  let wantedPlaying = false;
  let pendingPlay: Promise<void> | null = null;
  let playVersion = 0;
  const current = () => !disposed && !failed && options.current();

  function pause() {
    if (!media.paused || pendingPlay) { playVersion++; media.pause(); }
  }

  function playFailed() {
    if (!current() || !wantedPlaying) return;
    failed = true;
    wantedPlaying = false;
    pause();
    options.onError('Не удалось запустить клип. Попробуй включить его ещё раз.');
  }

  function sync(position: number, playing: boolean, playbackRate = 1, force = false) {
    if (!current()) { wantedPlaying = false; pause(); return; }
    media.muted = true;
    media.loop = false;
    const baseRate = Number.isFinite(playbackRate) && playbackRate > 0
      ? Math.min(4, Math.max(.25, playbackRate)) : 1;
    const duration = Number.isFinite(media.duration) && media.duration > 0 ? media.duration : null;
    const requested = Number.isFinite(position) ? Math.max(0, position) : 0;
    const target = duration === null ? requested : Math.min(requested, Math.max(0, duration - .04));
    const finished = duration !== null && requested >= duration - .04;
    wantedPlaying = playing && !finished && !(Number.isFinite(position) && position < 0);
    const difference = target - media.currentTime;
    const seek = force || !Number.isFinite(media.currentTime) || Math.abs(difference) > (wantedPlaying ? .45 : .04);
    // Setting currentTime before metadata exists throws in some WebViews.
    if (media.readyState >= 1 && duration !== null && seek && (force || !media.seeking)) {
      try { media.currentTime = target; } catch { /* Retry when metadata/seek ranges become available. */ }
    }
    // Correct small drift without repeatedly seeking between video keyframes.
    // A positive error means video is behind the audio, so it briefly speeds up.
    const correction = wantedPlaying && !seek && Number.isFinite(difference) && Math.abs(difference) > .07
      ? Math.max(-.03, Math.min(.03, difference * .12)) : 0;
    const desiredRate = Math.max(.25, Math.min(4, baseRate * (1 + correction)));
    if (Math.abs(media.playbackRate - desiredRate) > .001) media.playbackRate = desiredRate;
    if (!wantedPlaying) { pause(); return; }
    if (media.readyState < 2 || !media.paused || pendingPlay) return;
    try {
      const result = media.play();
      pendingPlay = Promise.resolve(result);
      const pending = pendingPlay;
      const version = playVersion;
      void pending.then(() => {
        if (version !== playVersion || !current() || !wantedPlaying) media.pause();
      }, () => { if (version === playVersion) playFailed(); }).finally(() => {
        if (pendingPlay === pending) pendingPlay = null;
      });
    } catch { playFailed(); }
  }

  return {
    sync,
    dispose() {
      if (disposed) return;
      disposed = true;
      wantedPlaying = false;
      pause();
    },
  };
}
