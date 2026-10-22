import type { LyricsLine } from '@/api/types';

export interface KaraokeWord { text: string; start: number; end: number }

// Enhanced LRC carries absolute word timestamps. Ordinary LRC only has lines;
// distribute those intervals by word length rather than pretending they are exact.
export function lineWords(line: LyricsLine, nextTime?: number): KaraokeWord[] {
  const end = Math.max(line.time_ms + 1, nextTime ?? line.time_ms + 4200);
  const marks = [...line.text.matchAll(/<(\d+):(\d{2}(?:[.,]\d+)?)>/g)];
  if (marks.length) {
    const words: KaraokeWord[] = [];
    const stamp = (m: RegExpMatchArray) => Number(m[1]) * 60000 + Number(m[2]!.replace(',', '.')) * 1000;
    const prefix = line.text.slice(0, marks[0]!.index);
    if (prefix.trim()) words.push({ text: prefix, start: line.time_ms, end: Math.max(line.time_ms + 1, stamp(marks[0]!)) });
    marks.forEach((mark, i) => {
      const text = line.text.slice(mark.index! + mark[0].length, marks[i + 1]?.index);
      const start = stamp(mark);
      if (text) words.push({ text, start, end: Math.max(start + 1, marks[i + 1] ? stamp(marks[i + 1]!) : end) });
    });
    return words;
  }
  const parts = line.text.match(/\S+\s*/gu) ?? [];
  const weights = parts.map(text => Math.max(1, [...text.trim()].length));
  const total = weights.reduce((a, b) => a + b, 0);
  let cursor = line.time_ms;
  return parts.map((text, i) => {
    const start = cursor;
    cursor += (end - line.time_ms) * weights[i]! / total;
    return { text, start, end: cursor };
  });
}

export function wordFill(word: KaraokeWord, now: number): number {
  return Math.max(0, Math.min(100, (now - word.start) / Math.max(1, word.end - word.start) * 100));
}

export function vocalCountdown(start: number | undefined, now: number): number {
  if (start === undefined || start < 3000) return 0;
  const left = start - now;
  return left > 0 && left <= 3000 ? Math.ceil(left / 1000) : 0;
}
