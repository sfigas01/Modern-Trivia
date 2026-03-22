/** SNES Cloud Kingdom design tokens — no React dependency */

/** Color palette for gradients and accents */
export const SNES_COLORS = {
  red1: '#ff655d',
  red2: '#df2e36',
  red3: '#a80e18',
  green1: '#74ec57',
  green2: '#39bf36',
  green3: '#1f7d25',
} as const;

/** Avatar cap color rotation */
export const CAP_COLORS = ['#df302d', '#42b44d', '#9d6031', '#3366cc', '#9D50BB', '#f39c12'];

/** Sky background gradient */
export const SKY_GRADIENT = 'linear-gradient(180deg, #1f78e4 0%, #4aa6ff 42%, #d6f0ff 100%)';

/** Font family stacks */
export const FONT_STACKS = {
  title: "'Luckiest Guy', sans-serif",
  pixel: "'Press Start 2P', cursive",
  display: "Impact, Haettenschweiler, 'Arial Black', sans-serif",
} as const;

/** Impact font, uppercase, text-stroke — used for panel headers and labels */
export const pixelText: React.CSSProperties = {
  fontFamily: FONT_STACKS.display,
  textTransform: 'uppercase' as const,
  letterSpacing: '1px',
  color: '#fff',
  WebkitTextStroke: '2px #11204d',
  textShadow: '0 4px 0 rgba(0,0,0,0.3)',
};

/** Blue gradient panel — black border, inset glow, drop shadow */
export const gamePanel: React.CSSProperties = {
  border: '6px solid #111',
  borderRadius: 14,
  background: 'linear-gradient(180deg, #4565df 0%, #2f57c9 20%, #234ebd 100%)',
  boxShadow: '0 8px 0 rgba(0,0,0,.28), inset 0 0 0 4px #dfe6ff',
};

/** Panel section header — gradient with inner highlight */
export const panelHeader: React.CSSProperties = {
  borderRadius: 6,
  border: '4px solid rgba(0,0,0,.28)',
  background: 'linear-gradient(180deg, #2a63f0 0%, #355ad4 100%)',
  boxShadow: 'inset 0 3px 0 rgba(255,255,255,.18)',
};

/** Dark navy gradient row */
export const teamRow: React.CSSProperties = {
  borderRadius: 4,
  background: 'linear-gradient(180deg, rgba(18,52,132,.95), rgba(14,44,115,.95))',
  boxShadow: 'inset 0 2px 0 rgba(255,255,255,.08)',
};

/** Tactile 3D button base — Impact font, used for in-panel buttons (REMOVE, ADD TEAM) */
export const btnBase: React.CSSProperties = {
  fontFamily: FONT_STACKS.display,
  textTransform: 'uppercase' as const,
  letterSpacing: '1px',
  color: '#fff',
  borderRadius: 10,
  border: '4px solid rgba(0,0,0,.38)',
  boxShadow: '0 8px 0 rgba(0,0,0,.28), inset 0 3px 0 rgba(255,255,255,.18)',
  cursor: 'pointer',
  userSelect: 'none' as const,
  transition: 'transform 0.1s',
};
