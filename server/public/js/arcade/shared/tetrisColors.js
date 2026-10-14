// Tetromino colors shared by the live game, the spectator stream and the kiosk.
// 1-7 are the pieces, 8 is garbage. Every hue comes from the app palette
// (brand blue/violet/pink, rank gold, state green/amber, cyan) so the board
// reads as Respawn while the seven pieces stay distinguishable.
export const TETRIS_COLORS = {
  1: '#5b8cff', // I: --accent  design-token-ok: canvas paint needs literal colors
  2: '#ffd166', // O: --rank-1-gold  design-token-ok: canvas paint needs literal colors
  3: '#22c55e', // S: --state-playing  design-token-ok: canvas paint needs literal colors
  4: '#ef5da8', // Z: --accent-3  design-token-ok: canvas paint needs literal colors
  5: '#9163f5', // J: --accent-2  design-token-ok: canvas paint needs literal colors
  6: '#06b6d4', // T: avatar cyan  design-token-ok: canvas paint needs literal colors
  7: '#f59e0b', // L: --state-paused  design-token-ok: canvas paint needs literal colors
  8: '#4a5468', // garbage: muted slate  design-token-ok: canvas paint needs literal colors
};
