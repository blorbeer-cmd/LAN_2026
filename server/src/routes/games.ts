// Game management: the single lifecycle for everything the group could play,
// from a bare player-submitted suggestion to a full catalog entry (platform,
// trailer) to a tracked game with process-name mappings the agent uses to
// recognize what's running (FR-07, FR-10). See server/CLAUDE.md games reorg
// for why this replaced the old separate games/game_catalog split.

import { Router } from 'express';
import { nanoid } from 'nanoid';
import { db } from '../db';
import { broadcast, Events } from '../realtime';
import { isNonEmptyString, isIntInRange, isValidAvatar } from '../validation';
import { writeAdminAudit } from '../adminAudit';
import { requireRecentReauthentication, withBodyPlayerIdentity } from '../sessions';
import { requireGroupRole, resolveGroupResource } from '../groupAuthorization';

export const gamesRouter = Router();

const DEFAULT_ICON = '🎮';
const MIN_TEAM_SIZE_FLOOR = 1;
const MAX_TEAM_SIZE_CEIL = 20;
const MAX_TITLE_LENGTH = 60;
const MAX_PLATFORM_LENGTH = 80;
const MAX_URL_LENGTH = 500;

type GameStatus = 'suggestion' | 'catalog';

interface GameRow {
  id: string;
  name: string;
  icon: string;
  icon_image: string | null;
  min_team_size: number;
  max_team_size: number;
  platform: string | null;
  platform_url: string | null;
  trailer_url: string | null;
  status: GameStatus;
  created_by: string | null;
  created_at: number;
  group_id: string | null;
  arcade_key?: string | null;
}

// Case-insensitive lookup used to give a friendly 409 instead of silently
// creating a second "Counter-Strike 2" — a duplicate game would split votes,
// skills and results across two indistinguishable entries in every dropdown.
function nameTaken(groupId: string, name: string, excludingId?: string): boolean {
  const row = db
    .prepare('SELECT id FROM games WHERE group_id = ? AND name = ? COLLATE NOCASE AND id != ?')
    .get(groupId, name, excludingId ?? '') as { id: string } | undefined;
  return Boolean(row);
}

function withProcessNames(game: GameRow) {
  const procs = db
    .prepare('SELECT process_name FROM game_process_names WHERE game_id = ? ORDER BY process_name')
    .all(game.id) as Array<{ process_name: string }>;
  return {
    ...game,
    isSuggestion: game.status === 'suggestion',
    processNames: procs.map((p) => p.process_name),
  };
}

function optionalText(value: unknown, maxLength: number): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length <= maxLength ? trimmed : undefined;
}

function optionalUrl(value: unknown): string | null | undefined {
  const text = optionalText(value, MAX_URL_LENGTH);
  if (text === undefined || text === null) return text;
  try {
    const url = new URL(text);
    return url.protocol === 'http:' || url.protocol === 'https:' ? text : undefined;
  } catch {
    return undefined;
  }
}

function assertPlayer(playerId: unknown): string | null | undefined {
  if (playerId === undefined || playerId === null || playerId === '') return null;
  if (typeof playerId !== 'string') return undefined;
  const player = db.prepare('SELECT id FROM players WHERE id = ?').get(playerId);
  return player ? playerId : undefined;
}

// GET /api/games - all games (suggestions, catalog and tracked alike),
// including their process-name mappings. Excludes the 5 built-in Arcade
// titles (quiz/tetris/scribble/blobby/snake, arcade_key IS NOT NULL) — they
// aren't admin-managed here (see arcade/arcadeTracking.ts), and showing them
// in this catalog would also leak them into every picker fed by this list
// (votes, matchmaking, tournaments, captain draft), none of which make sense
// for a lobby-based 1v1 minigame that's always instantly playable.
gamesRouter.get('/', (req, res) => {
  const rows = db
    .prepare('SELECT * FROM games WHERE arcade_key IS NULL AND group_id = ? ORDER BY name COLLATE NOCASE')
    .all(req.group!.id) as GameRow[];
  res.json(rows.map(withProcessNames));
});

// GET /api/games/:id - the built-in Arcade titles (group_id NULL) are shared
// system fixtures readable from any group; a real catalog entry is only
// readable from its own group (404 otherwise, existence hidden like every
// other cross-group boundary).
gamesRouter.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM games WHERE id = ?').get(req.params.id) as GameRow | undefined;
  if (!row || (row.group_id !== null && row.group_id !== req.group!.id)) {
    return res.status(404).json({ error: 'Spiel nicht gefunden.' });
  }
  res.json(withProcessNames(row));
});

function validateTeamSizes(
  minTeamSize: unknown,
  maxTeamSize: unknown,
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

// POST /api/games - create a game. Two shapes in practice: an admin adding a
// tracked game (name, team size, no status = defaults to 'catalog'), or a
// player suggestion from the Spiele view (name + optional platform/trailer,
// status: 'suggestion', playerId so it's attributed as createdBy).
gamesRouter.post(
  '/',
  ...withBodyPlayerIdentity,
  (req, res, next) => {
    if (req.body?.status !== 'suggestion') {
      return requireGroupRole('admin')(req, res, next);
    }
    next();
  },
  (req, res) => {
    const { name, icon, iconImage, minTeamSize, maxTeamSize, platform, platformUrl, trailerUrl, status, playerId } =
      req.body ?? {};

    if (!isNonEmptyString(name, MAX_TITLE_LENGTH)) {
      return res.status(400).json({ error: `Name ist erforderlich (1-${MAX_TITLE_LENGTH} Zeichen).` });
    }
    if (iconImage !== undefined && iconImage !== null && !isValidAvatar(iconImage)) {
      return res.status(400).json({ error: 'iconImage muss ein gültiges Bild (data:image/...) sein.' });
    }
    const sizes = validateTeamSizes(minTeamSize, maxTeamSize);
    if ('error' in sizes) return res.status(400).json({ error: sizes.error });

    // ?? null: an omitted field means "no value", same as an explicit null —
    // only an actually-too-long string or a malformed URL is an error here.
    const parsedPlatform = optionalText(platform ?? null, MAX_PLATFORM_LENGTH);
    if (parsedPlatform === undefined) return res.status(400).json({ error: 'Plattform ist zu lang.' });
    const parsedPlatformUrl = optionalUrl(platformUrl ?? null);
    if (parsedPlatformUrl === undefined)
      return res.status(400).json({ error: 'Plattform-Link muss mit http(s) beginnen.' });
    const parsedTrailer = optionalUrl(trailerUrl ?? null);
    if (parsedTrailer === undefined) return res.status(400).json({ error: 'Trailer-Link muss mit http(s) beginnen.' });
    const resolvedStatus: GameStatus = status === 'suggestion' ? 'suggestion' : 'catalog';
    const createdBy = assertPlayer(playerId);
    if (createdBy === undefined) return res.status(404).json({ error: 'Spieler nicht gefunden.' });

    const trimmedName = name.trim();
    if (nameTaken(req.group!.id, trimmedName)) {
      return res.status(409).json({ error: `Das Spiel "${trimmedName}" gibt es schon.` });
    }

    const row: GameRow = {
      id: nanoid(),
      name: trimmedName,
      icon: isNonEmptyString(icon, 8) ? icon : DEFAULT_ICON,
      icon_image: iconImage ?? null,
      min_team_size: sizes.min,
      max_team_size: sizes.max,
      platform: parsedPlatform ?? null,
      platform_url: parsedPlatformUrl ?? null,
      trailer_url: parsedTrailer ?? null,
      status: resolvedStatus,
      created_by: createdBy,
      created_at: Date.now(),
      group_id: req.group!.id,
    };

    db.prepare(
      `INSERT INTO games (id, name, icon, icon_image, min_team_size, max_team_size, platform, platform_url, trailer_url, status, created_by, created_at, group_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      row.id,
      row.name,
      row.icon,
      row.icon_image,
      row.min_team_size,
      row.max_team_size,
      row.platform,
      row.platform_url,
      row.trailer_url,
      row.status,
      row.created_by,
      row.created_at,
      row.group_id,
    );

    broadcast(Events.gamesChanged, null);
    res.status(201).json(withProcessNames(row));
  },
);

// Resolves :id to a game owned by the caller's current group, 404-ing
// (existence hidden) for a foreign group's game or an arcade fixture
// (group_id NULL) — neither is editable through this generic route.
const resolveGame = resolveGroupResource<GameRow>({
  resourceType: 'Spiel',
  load: (id) => {
    const row = db.prepare('SELECT * FROM games WHERE id = ?').get(id) as GameRow | undefined;
    return row ? { resource: row, groupId: row.group_id } : undefined;
  },
});

// PATCH /api/games/:id - edit name/icon/team sizes/platform/trailer.
gamesRouter.patch('/:id', resolveGame, requireGroupRole('admin'), (req, res) => {
  const existing = req.groupResource as GameRow;

  const { name, icon, iconImage, minTeamSize, maxTeamSize, platform, platformUrl, trailerUrl } = req.body ?? {};
  if (name !== undefined && !isNonEmptyString(name, MAX_TITLE_LENGTH)) {
    return res.status(400).json({ error: `Name muss 1-${MAX_TITLE_LENGTH} Zeichen lang sein.` });
  }
  if (icon !== undefined && !isNonEmptyString(icon, 8)) {
    return res.status(400).json({ error: 'Icon muss 1-8 Zeichen lang sein.' });
  }
  if (iconImage !== undefined && iconImage !== null && !isValidAvatar(iconImage)) {
    return res.status(400).json({ error: 'iconImage muss ein gültiges Bild (data:image/...) sein.' });
  }
  const sizes = validateTeamSizes(
    minTeamSize !== undefined ? minTeamSize : existing.min_team_size,
    maxTeamSize !== undefined ? maxTeamSize : existing.max_team_size,
  );
  if ('error' in sizes) return res.status(400).json({ error: sizes.error });

  const parsedPlatform = optionalText(platform, MAX_PLATFORM_LENGTH);
  if (parsedPlatform === undefined && platform !== undefined)
    return res.status(400).json({ error: 'Plattform ist zu lang.' });
  const parsedPlatformUrl = optionalUrl(platformUrl);
  if (parsedPlatformUrl === undefined && platformUrl !== undefined) {
    return res.status(400).json({ error: 'Plattform-Link muss mit http(s) beginnen.' });
  }
  const parsedTrailer = optionalUrl(trailerUrl);
  if (parsedTrailer === undefined && trailerUrl !== undefined) {
    return res.status(400).json({ error: 'Trailer-Link muss mit http(s) beginnen.' });
  }

  if (name !== undefined && nameTaken(req.group!.id, name.trim(), existing.id)) {
    return res.status(409).json({ error: `Das Spiel "${name.trim()}" gibt es schon.` });
  }

  const next: GameRow = {
    ...existing,
    name: name !== undefined ? name.trim() : existing.name,
    icon: icon !== undefined ? icon : existing.icon,
    icon_image: iconImage !== undefined ? iconImage : existing.icon_image,
    min_team_size: sizes.min,
    max_team_size: sizes.max,
    platform: platform !== undefined ? (parsedPlatform ?? null) : existing.platform,
    platform_url: platformUrl !== undefined ? (parsedPlatformUrl ?? null) : existing.platform_url,
    trailer_url: trailerUrl !== undefined ? (parsedTrailer ?? null) : existing.trailer_url,
  };

  db.prepare(
    `UPDATE games
     SET name = ?, icon = ?, icon_image = ?, min_team_size = ?, max_team_size = ?, platform = ?, platform_url = ?, trailer_url = ?
     WHERE id = ?`,
  ).run(
    next.name,
    next.icon,
    next.icon_image,
    next.min_team_size,
    next.max_team_size,
    next.platform,
    next.platform_url,
    next.trailer_url,
    next.id,
  );

  broadcast(Events.gamesChanged, null);
  res.json(withProcessNames(next));
});

// POST /api/games/:id/promote - a player-submitted suggestion becomes a
// regular catalog entry. Guarded against a double-tap racing itself: the
// second request finds status already 'catalog' and gets a clean 409 instead
// of silently re-broadcasting.
gamesRouter.post('/:id/promote', resolveGame, requireGroupRole('admin'), (req, res) => {
  const existing = req.groupResource as GameRow;
  if (existing.status !== 'suggestion') return res.status(409).json({ error: 'Spiel ist bereits im Katalog.' });

  const result = db
    .prepare(`UPDATE games SET status = 'catalog' WHERE id = ? AND status = 'suggestion'`)
    .run(existing.id);
  if (result.changes === 0) return res.status(409).json({ error: 'Spiel ist bereits im Katalog.' });

  broadcast(Events.gamesChanged, null);
  res.json(withProcessNames(db.prepare('SELECT * FROM games WHERE id = ?').get(existing.id) as GameRow));
});

// DELETE /api/games/:id - cascades to process names, skills, preferences,
// votes, matches; sets live_status.game_id to NULL for anyone currently on it.
// Checked ahead of the group-ownership resolver: an Arcade title (group_id
// NULL) would otherwise 404 there before reaching this more specific 400.
gamesRouter.delete(
  '/:id',
  (req, res, next) => {
    const existing = db.prepare('SELECT arcade_key FROM games WHERE id = ?').get(req.params.id) as
      { arcade_key: string | null } | undefined;
    if (existing?.arcade_key) {
      return res.status(400).json({ error: 'Arcade-Spiele können nicht gelöscht werden.' });
    }
    next();
  },
  resolveGame,
  requireGroupRole('admin'),
  requireRecentReauthentication,
  (req, res) => {
    const existing = req.groupResource as GameRow;
    db.prepare('DELETE FROM games WHERE id = ?').run(existing.id);
    writeAdminAudit({
      actorPlayerId: req.player?.id,
      groupId: req.group!.id,
      action: 'game_deleted',
      targetType: 'game',
      targetId: existing.id,
    });
    broadcast(Events.gamesChanged, null);
    broadcast(Events.liveStatusChanged, null);
    res.status(204).end();
  },
);

// POST /api/games/:id/processes - add a process-name mapping for agent scans.
gamesRouter.post('/:id/processes', resolveGame, requireGroupRole('admin'), (req, res) => {
  const game = req.groupResource as GameRow;

  const { processName } = req.body ?? {};
  if (!isNonEmptyString(processName, 100)) {
    return res.status(400).json({ error: 'Prozessname ist erforderlich.' });
  }
  const normalized = processName.trim().toLowerCase();

  const clash = db
    .prepare('SELECT game_id FROM game_process_names WHERE group_id = ? AND process_name = ?')
    .get(req.group!.id, normalized) as { game_id: string } | undefined;
  if (clash) {
    return res.status(409).json({ error: 'Dieser Prozessname ist bereits einem Spiel zugeordnet.' });
  }

  db.prepare('INSERT INTO game_process_names (id, game_id, group_id, process_name) VALUES (?, ?, ?, ?)').run(
    nanoid(),
    game.id,
    req.group!.id,
    normalized,
  );

  broadcast(Events.gamesChanged, null);
  res.status(201).json({ processName: normalized });
});

// DELETE /api/games/:id/processes/:processName - remove a mapping.
gamesRouter.delete('/:id/processes/:processName', resolveGame, requireGroupRole('admin'), (req, res) => {
  const game = req.groupResource as GameRow;
  const result = db
    .prepare('DELETE FROM game_process_names WHERE game_id = ? AND process_name = ?')
    .run(game.id, req.params.processName.toLowerCase());
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Zuordnung nicht gefunden.' });
  }
  broadcast(Events.gamesChanged, null);
  res.status(204).end();
});
