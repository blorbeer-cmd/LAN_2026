// Game management: create/edit/delete games and maintain the process-name
// mapping the agent uses to recognize what's running (FR-07, FR-10).

import { Router } from 'express';
import { nanoid } from 'nanoid';
import { db } from '../db';
import { broadcast, Events } from '../realtime';
import { isNonEmptyString, isIntInRange, isValidAvatar } from '../validation';

export const gamesRouter = Router();

const DEFAULT_ICON = '🎮';
const MIN_TEAM_SIZE_FLOOR = 1;
const MAX_TEAM_SIZE_CEIL = 20;

interface GameRow {
  id: string;
  name: string;
  icon: string;
  icon_image: string | null;
  min_team_size: number;
  max_team_size: number;
  created_at: number;
}

// Case-insensitive lookup used to give a friendly 409 instead of silently
// creating a second "Counter-Strike 2" — a duplicate game would split votes,
// skills and results across two indistinguishable entries in every dropdown.
function nameTaken(name: string, excludingId?: string): boolean {
  const row = db
    .prepare('SELECT id FROM games WHERE name = ? COLLATE NOCASE AND id != ?')
    .get(name, excludingId ?? '') as { id: string } | undefined;
  return Boolean(row);
}

function withProcessNames(game: GameRow) {
  const procs = db
    .prepare('SELECT process_name FROM game_process_names WHERE game_id = ? ORDER BY process_name')
    .all(game.id) as Array<{ process_name: string }>;
  return { ...game, processNames: procs.map((p) => p.process_name) };
}

// GET /api/games - all games including their process-name mappings.
gamesRouter.get('/', (_req, res) => {
  const rows = db.prepare('SELECT * FROM games ORDER BY name COLLATE NOCASE').all() as GameRow[];
  res.json(rows.map(withProcessNames));
});

// GET /api/games/:id
gamesRouter.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM games WHERE id = ?').get(req.params.id) as
    | GameRow
    | undefined;
  if (!row) return res.status(404).json({ error: 'Spiel nicht gefunden.' });
  res.json(withProcessNames(row));
});

function validateTeamSizes(
  minTeamSize: unknown,
  maxTeamSize: unknown
): { min: number; max: number } | { error: string } {
  const min = minTeamSize ?? MIN_TEAM_SIZE_FLOOR;
  const max = maxTeamSize ?? 5;
  if (!isIntInRange(min, MIN_TEAM_SIZE_FLOOR, MAX_TEAM_SIZE_CEIL)) {
    return { error: `min. Teamgröße muss zwischen ${MIN_TEAM_SIZE_FLOOR} und ${MAX_TEAM_SIZE_CEIL} liegen.` };
  }
  if (!isIntInRange(max, MIN_TEAM_SIZE_FLOOR, MAX_TEAM_SIZE_CEIL)) {
    return { error: `max. Teamgröße muss zwischen ${MIN_TEAM_SIZE_FLOOR} und ${MAX_TEAM_SIZE_CEIL} liegen.` };
  }
  if (min > max) {
    return { error: 'min. Teamgröße darf nicht größer als max. Teamgröße sein.' };
  }
  return { min, max };
}

// POST /api/games - create a new game.
gamesRouter.post('/', (req, res) => {
  const { name, icon, iconImage, minTeamSize, maxTeamSize } = req.body ?? {};

  if (!isNonEmptyString(name)) {
    return res.status(400).json({ error: 'Name ist erforderlich (1-60 Zeichen).' });
  }
  if (iconImage !== undefined && iconImage !== null && !isValidAvatar(iconImage)) {
    return res.status(400).json({ error: 'iconImage muss ein gültiges Bild (data:image/...) sein.' });
  }
  const sizes = validateTeamSizes(minTeamSize, maxTeamSize);
  if ('error' in sizes) return res.status(400).json({ error: sizes.error });

  const trimmedName = name.trim();
  if (nameTaken(trimmedName)) {
    return res.status(409).json({ error: `Das Spiel "${trimmedName}" gibt es schon.` });
  }

  const row: GameRow = {
    id: nanoid(),
    name: trimmedName,
    icon: isNonEmptyString(icon, 8) ? icon : DEFAULT_ICON,
    icon_image: iconImage ?? null,
    min_team_size: sizes.min,
    max_team_size: sizes.max,
    created_at: Date.now(),
  };

  db.prepare(
    `INSERT INTO games (id, name, icon, icon_image, min_team_size, max_team_size, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(row.id, row.name, row.icon, row.icon_image, row.min_team_size, row.max_team_size, row.created_at);

  broadcast(Events.gamesChanged, null);
  res.status(201).json(withProcessNames(row));
});

// PATCH /api/games/:id - edit name/icon/team sizes.
gamesRouter.patch('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM games WHERE id = ?').get(req.params.id) as
    | GameRow
    | undefined;
  if (!existing) return res.status(404).json({ error: 'Spiel nicht gefunden.' });

  const { name, icon, iconImage, minTeamSize, maxTeamSize } = req.body ?? {};
  if (name !== undefined && !isNonEmptyString(name)) {
    return res.status(400).json({ error: 'Name muss 1-60 Zeichen lang sein.' });
  }
  if (icon !== undefined && !isNonEmptyString(icon, 8)) {
    return res.status(400).json({ error: 'Icon muss 1-8 Zeichen lang sein.' });
  }
  if (iconImage !== undefined && iconImage !== null && !isValidAvatar(iconImage)) {
    return res.status(400).json({ error: 'iconImage muss ein gültiges Bild (data:image/...) sein.' });
  }
  const sizes = validateTeamSizes(
    minTeamSize !== undefined ? minTeamSize : existing.min_team_size,
    maxTeamSize !== undefined ? maxTeamSize : existing.max_team_size
  );
  if ('error' in sizes) return res.status(400).json({ error: sizes.error });

  if (name !== undefined && nameTaken(name.trim(), existing.id)) {
    return res.status(409).json({ error: `Das Spiel "${name.trim()}" gibt es schon.` });
  }

  const next: GameRow = {
    ...existing,
    name: name !== undefined ? name.trim() : existing.name,
    icon: icon !== undefined ? icon : existing.icon,
    icon_image: iconImage !== undefined ? iconImage : existing.icon_image,
    min_team_size: sizes.min,
    max_team_size: sizes.max,
  };

  db.prepare(
    'UPDATE games SET name = ?, icon = ?, icon_image = ?, min_team_size = ?, max_team_size = ? WHERE id = ?'
  ).run(next.name, next.icon, next.icon_image, next.min_team_size, next.max_team_size, next.id);

  broadcast(Events.gamesChanged, null);
  res.json(withProcessNames(next));
});

// DELETE /api/games/:id - cascades to process names, skills, votes, matches;
// sets live_status.game_id to NULL for anyone currently on it.
gamesRouter.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM games WHERE id = ?').run(req.params.id);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Spiel nicht gefunden.' });
  }
  broadcast(Events.gamesChanged, null);
  broadcast(Events.liveStatusChanged, null);
  res.status(204).end();
});

// POST /api/games/:id/processes - add a process-name mapping for agent scans.
gamesRouter.post('/:id/processes', (req, res) => {
  const game = db.prepare('SELECT id FROM games WHERE id = ?').get(req.params.id);
  if (!game) return res.status(404).json({ error: 'Spiel nicht gefunden.' });

  const { processName } = req.body ?? {};
  if (!isNonEmptyString(processName, 100)) {
    return res.status(400).json({ error: 'Prozessname ist erforderlich.' });
  }
  const normalized = processName.trim().toLowerCase();

  const clash = db
    .prepare('SELECT game_id FROM game_process_names WHERE process_name = ?')
    .get(normalized) as { game_id: string } | undefined;
  if (clash) {
    return res.status(409).json({ error: 'Dieser Prozessname ist bereits einem Spiel zugeordnet.' });
  }

  db.prepare('INSERT INTO game_process_names (id, game_id, process_name) VALUES (?, ?, ?)').run(
    nanoid(),
    req.params.id,
    normalized
  );

  broadcast(Events.gamesChanged, null);
  res.status(201).json({ processName: normalized });
});

// DELETE /api/games/:id/processes/:processName - remove a mapping.
gamesRouter.delete('/:id/processes/:processName', (req, res) => {
  const result = db
    .prepare('DELETE FROM game_process_names WHERE game_id = ? AND process_name = ?')
    .run(req.params.id, req.params.processName.toLowerCase());
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Zuordnung nicht gefunden.' });
  }
  broadcast(Events.gamesChanged, null);
  res.status(204).end();
});
