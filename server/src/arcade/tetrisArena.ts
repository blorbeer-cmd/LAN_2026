export type TetrisMode = 'duel' | 'arena';

export const TETRIS_DUEL_PLAYERS = 2;
export const TETRIS_ARENA_MIN_PLAYERS = 3;
export const TETRIS_ARENA_MAX_PLAYERS = 8;

export function tetrisMode(value: unknown): TetrisMode | null {
  if (value === undefined) return 'duel';
  return value === 'duel' || value === 'arena' ? value : null;
}

export function tetrisPlayerLimit(mode: TetrisMode): number {
  return mode === 'arena' ? TETRIS_ARENA_MAX_PLAYERS : TETRIS_DUEL_PLAYERS;
}

export function canStartTetris(mode: TetrisMode, playerCount: number): boolean {
  return mode === 'arena'
    ? playerCount >= TETRIS_ARENA_MIN_PLAYERS && playerCount <= TETRIS_ARENA_MAX_PLAYERS
    : playerCount === TETRIS_DUEL_PLAYERS;
}

export function tetrisBotCount(mode: TetrisMode): number {
  return tetrisPlayerLimit(mode) - 1;
}

// Targets rotate through the stable lobby order. Advancing only after an
// actual attack distributes garbage without adding a separate targeting UI.
export function nextArenaTarget(
  playerIds: string[],
  alivePlayerIds: ReadonlySet<string>,
  attackerId: string,
  previousTargetId: string | null,
): string | null {
  if (!alivePlayerIds.has(attackerId) || alivePlayerIds.size < 2) return null;
  const startId = previousTargetId && playerIds.includes(previousTargetId) ? previousTargetId : attackerId;
  const startIndex = Math.max(0, playerIds.indexOf(startId));
  for (let offset = 1; offset <= playerIds.length; offset += 1) {
    const candidate = playerIds[(startIndex + offset) % playerIds.length];
    if (candidate !== attackerId && alivePlayerIds.has(candidate)) return candidate;
  }
  return null;
}

export function placementForElimination(aliveBeforeElimination: number): number {
  return Math.max(2, aliveBeforeElimination);
}

export function placementForEliminationBatch(aliveBeforeElimination: number, eliminatedCount: number): number {
  return Math.max(1, aliveBeforeElimination - Math.max(1, eliminatedCount) + 1);
}

export function isTargetableTetrisPlayer(state: { alive: boolean; pendingElimination?: boolean }): boolean {
  return state.alive && state.pendingElimination !== true;
}
