
export type MetalTint = 'silver' | 'gold' | 'violet' | 'ice' | 'emerald';
export const metalTints: Record<MetalTint, { highlight: string; mid: string; glow: string }> = {
  silver: { highlight: '#c3c9d7', mid: '#8c96ad', glow: '124, 92, 255' },
  gold: { highlight: '#ecdfb0', mid: '#a69a70', glow: '228, 181, 73' },
  violet: { highlight: '#d5c6e9', mid: '#9a87b2', glow: '157, 105, 220' },
  ice: { highlight: '#c2e3ed', mid: '#7eacba', glow: '97, 181, 210' },
  emerald: { highlight: '#c7dfd3', mid: '#7da192', glow: '96, 177, 145' },
};
