export const MULTIPLAYER = import.meta.env.VITE_MULTIPLAYER === 'true';

// Gates the player-requested themed games feature (STE-167 lean MVP). When off,
// no theme UI is shown and ordinary category games are completely unchanged.
export const THEME_ROUNDS = import.meta.env.VITE_THEME_ROUNDS === 'true';
