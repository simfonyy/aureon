export interface FxWord {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
  lineId: string;
}

export interface FxEvent {
  id: string;
  wordId: string;
  type: 'blood' | 'impact';
  startMs: number;
  durationMs: number;
  intensity: number;
  seed: number;
  reason?: string;
}

export interface FxFrame {
  event: FxEvent;
  word: FxWord;
  element: HTMLElement;
  fill: number;
}
