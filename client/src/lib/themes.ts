export type ThemeId = 'default' | 'retro-arcade';

export interface ThemeMeta {
  id: ThemeId;
  label: string;
  description: string;
}

export const THEMES: ThemeMeta[] = [
  { id: 'default', label: 'Modern', description: 'Clean & vibrant' },
  { id: 'retro-arcade', label: 'Retro Arcade', description: 'SNES-inspired pixel art' },
];
