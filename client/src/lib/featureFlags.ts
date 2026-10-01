export const MULTIPLAYER = import.meta.env.VITE_MULTIPLAYER === 'true';

// Gates the player-requested themed games feature (STE-167 lean MVP). When off,
// no theme UI is shown and ordinary category games are completely unchanged.
export const THEME_ROUNDS = import.meta.env.VITE_THEME_ROUNDS === 'true';

// Gates the pixel-art redesign (STE-128). When off, the current UI renders
// unchanged; redesigned screens fall back to it.
export const PIXEL_UI = import.meta.env.VITE_PIXEL_UI === 'true';
