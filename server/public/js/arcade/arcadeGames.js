import { icon } from '../icons.js';

// Single source for the playable Arcade games: name, icon and the modes the
// "Lobby öffnen" dialog offers. Lobby rows, the running list and the stats
// all label games from here.
export const ARCADE_GAMES = [
  { id: 'quiz', name: 'Gaming-Quiz', iconName: 'brain', modes: null, room: 'quizRoom' },
  { id: 'tetris', name: 'Tetris', iconName: 'blocks', modes: [{ value: 'duel', label: 'Duell' }, { value: 'arena', label: 'Arena' }], room: 'tetris' },
  { id: 'scribble', name: 'Scribble', iconName: 'pencil', modes: null, room: 'scribbleRoom' },
  { id: 'pong', name: 'Pong', iconName: 'gitCommitVertical', modes: [{ value: 'duel', label: 'Duell' }, { value: 'doubles', label: 'Doppel' }], room: 'pong' },
  { id: 'blobby', name: 'Blobby Volley', iconName: 'volleyball', modes: [{ value: 'duel', label: 'Duell' }, { value: 'doubles', label: 'Doppel' }], room: 'blobby' },
  { id: 'snake', name: 'Snake', iconName: 'snake', modes: [{ value: 'classic', label: 'Classic' }, { value: 'arena', label: 'Arena' }], room: 'snake' },
  { id: 'battleship', name: 'Battleship', iconName: 'ship', modes: null, room: 'battleship' },
  { id: 'challenge-rush', name: 'Challenge Rush', iconName: 'crosshair', modes: null, room: 'challengeRush' },
];

export function arcadeGame(id) {
  return ARCADE_GAMES.find((game) => game.id === id) ?? null;
}

export function arcadeGameIconHtml(id) {
  const game = arcadeGame(id);
  return `<span class="arcade-game-icon" aria-hidden="true">${game ? icon(game.iconName) : icon('gamepad')}</span>`;
}
