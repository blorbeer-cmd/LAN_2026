// Single source of truth for the preset avatar color swatches (color picker
// in players.js, bulk test-player generation in admin.js). Six of the eight
// reuse the app's existing semantic accent/state colors (see --accent,
// --accent-2, --accent-3, --state-playing, --state-paused, --danger in
// style.css) so a player's avatar color never introduces a hue that doesn't
// already mean something elsewhere in the UI; the remaining two (cyan, lime)
// exist purely for swatch variety and have no semantic meaning.
export const AVATAR_PALETTE = [
  '#5b8cff', // --accent
  '#9163f5', // --accent-2
  '#ef5da8', // --accent-3
  '#22c55e', // --state-playing
  '#f59e0b', // --state-paused
  '#ef4444', // --danger
  '#06b6d4', // cyan (no semantic counterpart)
  '#84cc16', // lime (no semantic counterpart)
];
