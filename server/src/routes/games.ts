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
import { getLiveBoard } from '../liveStatus';

export const gamesRouter = Router();

const DEFAULT_ICON = '🎮';
const MIN_TEAM_SIZE_FLOOR = 1;
const MAX_TEAM_SIZE_CEIL = 20;
const MAX_TITLE_LENGTH = 60;
const MAX_PLATFORM_LENGTH = 80;
const MAX_URL_LENGTH = 500;
const MAX_INFO_LENGTH = 300;

// Fixed multiselect options for a game's genre tags. Mirrored in the frontend
// as GAME_GENRES in server/public/js/gameGenres.js — keep both in sync, and
// the migration-time copy in db.ts's "normalize games genre column to
// multiselect json" migration.
const GAME_GENRES = [
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
] as const;
const MAX_GENRES_PER_GAME = 5;

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
  genre: string | null;
  info: string | null;
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
  const { genre, ...rest } = game;
  return {
    ...rest,
    isSuggestion: game.status === 'suggestion',
    processNames: procs.map((p) => p.process_name),
    genres: parseGenreColumn(genre),
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

// Stored as a JSON array of GAME_GENRES entries in the existing `genre` TEXT
// column (no schema change needed) — parsing failures or legacy free text
// from before the multiselect just read back as "no genres" instead of
// crashing the games list.
function parseGenreColumn(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((g): g is string => typeof g === 'string') : [];
  } catch {
    return [];
  }
}

// undefined = field omitted entirely (caller keeps the existing value).
// Any other invalid shape also returns undefined but is distinguished by the
// caller checking `value !== undefined`, same convention as optionalText.
function validateGenres(value: unknown): string[] | undefined {
  if (value === undefined) return undefined;
  if (value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_GENRES_PER_GAME) return undefined;
  const genres = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string' || !(GAME_GENRES as readonly string[]).includes(entry)) return undefined;
    genres.add(entry);
  }
  return [...genres];
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

// GET /api/games/genres - the fixed genre multiselect options, so the
// frontend's edit form and filters render from one server-side list instead
// of duplicating it (still mirrored as a constant for the client-side
// filter/chip rendering itself, since there's no bundler to share code).
gamesRouter.get('/genres', (_req, res) => {
  res.json(GAME_GENRES);
});

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
// system fixtures. A real catalog entry must match the request's retained
// group_id scope (404 otherwise, with existence hidden).
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
    const { name, icon, iconImage, minTeamSize, maxTeamSize, platform, platformUrl, trailerUrl, genres, info, status, playerId } =
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
    const parsedGenres = validateGenres(genres ?? null);
    if (parsedGenres === undefined) return res.status(400).json({ error: 'Genre-Auswahl ist ungültig.' });
    const parsedInfo = optionalText(info ?? null, MAX_INFO_LENGTH);
    if (parsedInfo === undefined) return res.status(400).json({ error: 'Info ist zu lang.' });
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
      genre: parsedGenres.length ? JSON.stringify(parsedGenres) : null,
      info: parsedInfo ?? null,
      status: resolvedStatus,
      created_by: createdBy,
      created_at: Date.now(),
      group_id: req.group!.id,
    };

    db.prepare(
      `INSERT INTO games (id, name, icon, icon_image, min_team_size, max_team_size, platform, platform_url, trailer_url, genre, info, status, created_by, created_at, group_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      row.genre,
      row.info,
      row.status,
      row.created_by,
      row.created_at,
      row.group_id,
    );

    broadcast(Events.gamesChanged, null, { groupId: req.group!.id });
    res.status(201).json(withProcessNames(row));
  },
);

// Resolves :id to a game whose retained group_id matches the request, 404-ing
// (with existence hidden) on a mismatch or an Arcade fixture (group_id NULL)
// — neither is editable through this generic route.
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

  const { name, icon, iconImage, minTeamSize, maxTeamSize, platform, platformUrl, trailerUrl, genres, info } =
    req.body ?? {};
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
  const parsedGenres = validateGenres(genres);
  if (parsedGenres === undefined && genres !== undefined) {
    return res.status(400).json({ error: 'Genre-Auswahl ist ungültig.' });
  }
  const parsedInfo = optionalText(info, MAX_INFO_LENGTH);
  if (parsedInfo === undefined && info !== undefined) {
    return res.status(400).json({ error: 'Info ist zu lang.' });
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
    genre: genres !== undefined ? (parsedGenres!.length ? JSON.stringify(parsedGenres) : null) : existing.genre,
    info: info !== undefined ? (parsedInfo ?? null) : existing.info,
  };

  db.prepare(
    `UPDATE games
     SET name = ?, icon = ?, icon_image = ?, min_team_size = ?, max_team_size = ?, platform = ?, platform_url = ?, trailer_url = ?, genre = ?, info = ?
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
    next.genre,
    next.info,
    next.id,
  );

  broadcast(Events.gamesChanged, null, { groupId: req.group!.id });
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

  broadcast(Events.gamesChanged, null, { groupId: req.group!.id });
  res.json(withProcessNames(db.prepare('SELECT * FROM games WHERE id = ?').get(existing.id) as GameRow));
});

// POST /api/games/:id/demote - the inverse of promote: pushes a catalog entry
// back into the suggestions list. Guarded the same way against a double-tap
// racing itself.
gamesRouter.post('/:id/demote', resolveGame, requireGroupRole('admin'), (req, res) => {
  const existing = req.groupResource as GameRow;
  if (existing.status !== 'catalog') return res.status(409).json({ error: 'Spiel ist bereits ein Vorschlag.' });

  const result = db
    .prepare(`UPDATE games SET status = 'suggestion' WHERE id = ? AND status = 'catalog'`)
    .run(existing.id);
  if (result.changes === 0) return res.status(409).json({ error: 'Spiel ist bereits ein Vorschlag.' });

  broadcast(Events.gamesChanged, null, { groupId: req.group!.id });
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
    broadcast(Events.gamesChanged, null, { groupId: req.group!.id });
    broadcast(Events.liveStatusChanged, getLiveBoard(req.group!.id), { groupId: req.group!.id });
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

  broadcast(Events.gamesChanged, null, { groupId: req.group!.id });
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
  broadcast(Events.gamesChanged, null, { groupId: req.group!.id });
  res.status(204).end();
});
