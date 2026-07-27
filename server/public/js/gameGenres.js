// Fixed multiselect options for a game's genre tags. Mirrors GAME_GENRES in
// server/src/routes/games.ts — keep both in sync.
export const GAME_GENRES = Object.freeze([
  'Shooter',
  'Fighting',
  'Racing',
  'Sport',
  'Party',
  'Strategie',
  'Rollenspiel',
  'Plattformer',
  'Puzzle',
  'Simulation',
  'Kartenspiel',
  'Geschicklichkeit',
  'Koop',
  'Horror',
  'Sonstiges',
]);

export const MAX_GENRES_PER_GAME = 5;
