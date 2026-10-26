export function playerMetaLimit(contentWidth: number): number {
  return Math.max(150, Math.min(460, Math.floor(contentWidth * .36)));
}
