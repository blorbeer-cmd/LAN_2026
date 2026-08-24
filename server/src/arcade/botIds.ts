const ARCADE_BOT_IDS = new Set([
  'battleship-bot',
  'blobby-bot',
  'challenge-rush-bot',
  'pong-bot',
  'quiz-bot',
  'scribble-bot',
  'snake-bot',
  'tetris-bot',
]);

const ARCADE_BOT_ID_PREFIXES = [
  'blobby-bot-',
  'pong-bot-',
  'snake-bot-',
  'tetris-bot-',
];

export function isKnownArcadeBotId(playerId: string): boolean {
  return ARCADE_BOT_IDS.has(playerId) || ARCADE_BOT_ID_PREFIXES.some((prefix) => playerId.startsWith(prefix));
}
