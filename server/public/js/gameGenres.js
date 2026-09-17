// Fixed multiselect options for a game's genre tags. Mirrors GAME_GENRES in
// server/src/routes/games.ts — keep both in sync; gameGenres.test.js fails if
// they drift apart. The order is used in the game editor and genre filters.
export const GAME_GENRES = Object.freeze([
  'Battle Royale',
  'Fighting',
  'MMO',
  'MOBA',
  'Party',
  'Racing',
  'RPG',
  'Shooter',
  'Sonstiges',
  'Sport',
  'Strategie',
  'Survival',
]);

export const MAX_GENRES_PER_GAME = 5;
