// Optimistic check for dialogs that act on an open Match draw (result,
// tournament, adding a player to a chosen team). The client sends the lineup
// it showed (player ids per team); the handler compares it with the stored
// lineup inside the transaction that writes. A draw that was reshuffled,
// extended or edited on another device in the meantime answers 409 with the
// code below instead of silently using or overwriting the newer teams.

import { db } from './db';
import { lineupKey } from './matchmaking';

export const DRAW_LINEUP_CHANGED_CODE = 'draw_lineup_changed';
export const DRAW_LINEUP_CHANGED = 'Die Teams dieser Auslosung wurden inzwischen geändert. Bitte die Auslosung neu öffnen.';

export class DrawLineupChangedError extends Error {}

// Only the shape is checked: any lineup a draw can hold must stay sendable,
// and draws themselves have no team or team-size cap. The JSON body limit
// (1 MB, app.ts) bounds the size, and the comparison is a single sort.
export function isDrawLineup(value: unknown): value is string[][] {
  return Array.isArray(value) && value.length >= 1 && value.every((team) =>
    Array.isArray(team) && team.every((id) => typeof id === 'string' && id.length >= 1 && id.length <= 64));
}

// Call inside the writing transaction; throws DrawLineupChangedError when the
// stored lineup differs from the one the dialog showed. Team order and the
// order within a team do not matter, except for `teamIndex`: a dialog that
// chose a team by its position also needs that position to hold the same
// players, since two reshuffles can return the same teams in another order.
export function assertDrawLineup(drawId: string, expected: string[][], teamIndex?: number): void {
  const stored = db.prepare('SELECT teams FROM matchmaking_draws WHERE id = ?').pluck().get(drawId) as string | undefined;
  const current = stored
    ? (JSON.parse(stored) as Array<{ players: Array<{ id: string }> }>).map((team) => team.players.map((player) => player.id))
    : [];
  if (lineupKey(current) !== lineupKey(expected)) throw new DrawLineupChangedError();
  if (teamIndex !== undefined && lineupKey([current[teamIndex] ?? []]) !== lineupKey([expected[teamIndex] ?? []])) {
    throw new DrawLineupChangedError();
  }
}
