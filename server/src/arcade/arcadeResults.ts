import { nanoid } from 'nanoid';
import { db } from '../db';

export interface ArcadePlayerRef {
  id: string;
  name: string;
}

export interface ArcadeScoreEntry {
  playerId: string;
  name: string;
  score: number;
}

export function recordArcadeResult(params: {
  gameType: string;
  winnerId: string | null;
  players: ArcadePlayerRef[];
  scores: ArcadeScoreEntry[];
  reason: string;
  startedAt: number;
  endedAt: number;
}): void {
  db.prepare(
    `INSERT INTO arcade_results (id, game_type, winner_id, players, scores, reason, started_at, ended_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    nanoid(),
    params.gameType,
    params.winnerId,
    JSON.stringify(params.players),
    JSON.stringify(params.scores),
    params.reason,
    params.startedAt,
    params.endedAt
  );
}
