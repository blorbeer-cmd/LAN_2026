// Player management: create/rename/recolor/delete participants. Each player
// gets a private API key used by their agent to report live status (FR-06).

import { Router } from 'express';
import { nanoid } from 'nanoid';
import { db } from '../db';
import { broadcast, Events } from '../realtime';
import { isNonEmptyString, isHexColor } from '../validation';

export const playersRouter = Router();

const DEFAULT_COLOR = '#4f9dff';

interface PlayerRow {
  id: string;
  name: string;
  color: string;
  api_key: string;
  created_at: number;
}

function toPublicPlayer(row: PlayerRow) {
  // The API key is left out of bulk listings so a glance at the roster can't
  // be used to spoof someone else's live status; it's only returned when a
  // client explicitly asks for that one player (their own profile).
  const { api_key: _apiKey, ...rest } = row;
  return rest;
}

// GET /api/players - roster without API keys.
playersRouter.get('/', (_req, res) => {
  const rows = db
    .prepare('SELECT * FROM players ORDER BY name COLLATE NOCASE')
    .all() as PlayerRow[];
  res.json(rows.map(toPublicPlayer));
});

// GET /api/players/:id - single player including their API key.
playersRouter.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM players WHERE id = ?').get(req.params.id) as
    | PlayerRow
    | undefined;
  if (!row) return res.status(404).json({ error: 'Spieler nicht gefunden.' });
  res.json(row);
});

// POST /api/players - create a player. Returns the API key once here (and via
// the single-player GET) so the frontend can show/copy it.
playersRouter.post('/', (req, res) => {
  const { name, color } = req.body ?? {};

  if (!isNonEmptyString(name)) {
    return res.status(400).json({ error: 'Name ist erforderlich (1-60 Zeichen).' });
  }
  if (color !== undefined && !isHexColor(color)) {
    return res.status(400).json({ error: 'Farbe muss ein Hex-Code sein, z.B. #4f9dff.' });
  }

  const row: PlayerRow = {
    id: nanoid(),
    name: name.trim(),
    color: color ?? DEFAULT_COLOR,
    api_key: nanoid(24),
    created_at: Date.now(),
  };

  db.prepare(
    'INSERT INTO players (id, name, color, api_key, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(row.id, row.name, row.color, row.api_key, row.created_at);

  broadcast(Events.playersChanged, null);
  res.status(201).json(row);
});

// PATCH /api/players/:id - rename and/or recolor.
playersRouter.patch('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM players WHERE id = ?').get(req.params.id) as
    | PlayerRow
    | undefined;
  if (!existing) return res.status(404).json({ error: 'Spieler nicht gefunden.' });

  const { name, color } = req.body ?? {};
  if (name !== undefined && !isNonEmptyString(name)) {
    return res.status(400).json({ error: 'Name muss 1-60 Zeichen lang sein.' });
  }
  if (color !== undefined && !isHexColor(color)) {
    return res.status(400).json({ error: 'Farbe muss ein Hex-Code sein, z.B. #4f9dff.' });
  }

  const nextName = name !== undefined ? name.trim() : existing.name;
  const nextColor = color !== undefined ? color : existing.color;

  db.prepare('UPDATE players SET name = ?, color = ? WHERE id = ?').run(
    nextName,
    nextColor,
    existing.id
  );

  broadcast(Events.playersChanged, null);
  res.json({ ...existing, name: nextName, color: nextColor });
});

// DELETE /api/players/:id - removes the player and cascades to their skills/
// live status/votes (enforced by SQLite foreign keys).
playersRouter.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM players WHERE id = ?').run(req.params.id);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Spieler nicht gefunden.' });
  }
  broadcast(Events.playersChanged, null);
  res.status(204).end();
});
