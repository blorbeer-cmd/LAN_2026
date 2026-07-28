// Fixed multiselect options for a game's genre tags. Mirrors GAME_GENRES in
// server/src/routes/games.ts — keep both in sync; gameGenres.test.js fails if
// they drift apart. Ordered by theme rather than alphabetically so related
// genres sit next to each other in the chip list; 'Sonstiges' stays last as
// the catch-all.
export const GAME_GENRES = Object.freeze([
  'Shooter',
  'Battle Royale',
  'Fighting',
  'Racing',
  'Sport',
  'Party',
  'Quiz',
  'Strategie',
  'MOBA',
  '4X',
  'Tower Defense',
  'Aufbau',
  'Rollenspiel',
  'MMO',
  'Abenteuer',
  'Plattformer',
  'Roguelike',
  'Puzzle',
  'Simulation',
  'Sandbox',
  'Survival',
  'Kartenspiel',
  'Geschicklichkeit',
  'Rhythmus',
  'Koop',
  'Horror',
  'Sonstiges',
]);

export const MAX_GENRES_PER_GAME = 5;
