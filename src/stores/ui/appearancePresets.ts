import type { InterfaceSettings } from './defaults';

export type MetalTint = 'silver' | 'gold' | 'violet' | 'ice' | 'emerald';
export const metalTints: Record<MetalTint, { highlight: string; mid: string; glow: string }> = {
  silver: { highlight: '#c3c9d7', mid: '#8c96ad', glow: '124, 92, 255' },
  gold: { highlight: '#ecdfb0', mid: '#a69a70', glow: '228, 181, 73' },
  violet: { highlight: '#d5c6e9', mid: '#9a87b2', glow: '157, 105, 220' },
  ice: { highlight: '#c2e3ed', mid: '#7eacba', glow: '97, 181, 210' },
  emerald: { highlight: '#c7dfd3', mid: '#7da192', glow: '96, 177, 145' },
};
export const appearancePresets: Array<{ id: string; label: string; caption: string; settings: Partial<InterfaceSettings> }> = [
  { id: 'gold', label: 'Black Gold', caption: 'Обсидиан и тёплое золото', settings: { theme: 'black', accent: '#e2ba58', liquidTint: 'gold', liquidIntensity: 60, liquidSpeed: 38 } },
  { id: 'chrome', label: 'Black Chrome', caption: 'Серебро и чёрное стекло', settings: { theme: 'graphite', accent: '#b9c4dc', liquidTint: 'silver', liquidIntensity: 55, liquidSpeed: 36 } },
  { id: 'violet', label: 'Amethyst', caption: 'Мягкие лиловые отражения', settings: { theme: 'plum', accent: '#b58ae7', liquidTint: 'violet', liquidIntensity: 50, liquidSpeed: 40 } },
  { id: 'ice', label: 'Arctic', caption: 'Холодный свет на графите', settings: { theme: 'midnight', accent: '#83c9e4', liquidTint: 'ice', liquidIntensity: 55, liquidSpeed: 34 } },
  { id: 'emerald', label: 'Emerald', caption: 'Глубокий зелёный хром', settings: { theme: 'forest', accent: '#8bc9ad', liquidTint: 'emerald', liquidIntensity: 45, liquidSpeed: 42 } },
];
