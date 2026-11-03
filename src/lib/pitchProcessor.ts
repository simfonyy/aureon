import { SoundTouchNode } from '@soundtouchjs/audio-worklet';
import processorUrl from '@soundtouchjs/audio-worklet/processor?url';
import type { PitchProcessor } from './audio';

/** The self-contained worklet is bundled locally; no CDN or audio upload. */
export async function preparePitchProcessor(context: AudioContext): Promise<(context: AudioContext) => PitchProcessor> {
  await SoundTouchNode.register(context, processorUrl);
  return target => new SoundTouchNode({ context: target });
}
