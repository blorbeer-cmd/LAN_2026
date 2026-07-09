// Shared game catalog: fixed LAN pool plus separately rated suggestions.

import { Router } from 'express';
import { nanoid } from 'nanoid';
import { db } from '../db';
import { broadcast, Events } from '../realtime';
import { isIntInRange, isNonEmptyString } from '../validation';
import { requireAdmin } from '../auth';

export const gameCatalogRouter = Router();

const MAX_TITLE_LENGTH = 80;
const MAX_PLATFORM_LENGTH = 80;
const MAX_URL_LENGTH = 500;

interface CatalogRow {
  id: string;
  title: string;
  platform: string | null;
  platform_url: string | null;
  trailer_url: string | null;
  is_suggestion: number;
  created_by: string | null;
  created_at: number;
}

interface InterestRow {
  catalog_id: string;
  player_id: string;
  name: string;
  color: string;
  avatar: string | null;
}

interface RatingRow extends InterestRow {
  rating: number;
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

function assertPlayer(playerId: unknown) {
  if (playerId === undefined || playerId === null || playerId === '') return null;
  if (typeof playerId !== 'string') return undefined;
  const player = db.prepare('SELECT id FROM players WHERE id = ?').get(playerId);
  return player ? playerId : undefined;
}

function serializeCatalog() {
  const rows = db
    .prepare(
      `SELECT id, title, platform, platform_url, trailer_url, is_suggestion, created_by, created_at
       FROM game_catalog
       ORDER BY title COLLATE NOCASE`
    )
    .all() as CatalogRow[];

  if (rows.length === 0) return { items: [] };
  const ids = rows.map((r) => r.id);

  const interestRows = db
    .prepare(
      `SELECT i.catalog_id, p.id AS player_id, p.name, p.color, p.avatar
       FROM game_catalog_interest i
       JOIN players p ON p.id = i.player_id
       WHERE i.catalog_id IN (${ids.map(() => '?').join(',')})
       ORDER BY p.name COLLATE NOCASE`
    )
    .all(...ids) as InterestRow[];

  const ratingRows = db
    .prepare(
      `SELECT r.catalog_id, r.rating, p.id AS player_id, p.name, p.color, p.avatar
       FROM game_catalog_ratings r
       JOIN players p ON p.id = r.player_id
       WHERE r.catalog_id IN (${ids.map(() => '?').join(',')})
       ORDER BY p.name COLLATE NOCASE`
    )
    .all(...ids) as RatingRow[];

  const interestsByCatalog = new Map<string, InterestRow[]>();
  for (const interest of interestRows) {
    interestsByCatalog.set(interest.catalog_id, [...(interestsByCatalog.get(interest.catalog_id) ?? []), interest]);
  }
  const ratingsByCatalog = new Map<string, RatingRow[]>();
  for (const rating of ratingRows) {
    ratingsByCatalog.set(rating.catalog_id, [...(ratingsByCatalog.get(rating.catalog_id) ?? []), rating]);
  }

  return {
    items: rows.map((r) => {
      const interested = interestsByCatalog.get(r.id) ?? [];
      const ratings = ratingsByCatalog.get(r.id) ?? [];
      const ratingAverage = ratings.length ? ratings.reduce((sum, rating) => sum + rating.rating, 0) / ratings.length : null;
      return {
        id: r.id,
        title: r.title,
        platform: r.platform,
        platformUrl: r.platform_url,
        trailerUrl: r.trailer_url,
        isSuggestion: Boolean(r.is_suggestion),
        createdBy: r.created_by,
        createdAt: r.created_at,
        interestCount: interested.length,
        interestedPlayerIds: interested.map((p) => p.player_id),
        interestedPlayers: interested.map((p) => ({
          id: p.player_id,
          name: p.name,
          color: p.color,
          avatar: p.avatar,
        })),
        ratingCount: ratings.length,
        ratingAverage,
        ratings: ratings.map((p) => ({
          id: p.player_id,
          name: p.name,
          color: p.color,
          avatar: p.avatar,
          rating: p.rating,
        })),
      };
    }),
  };
}

gameCatalogRouter.get('/', (_req, res) => {
  res.json(serializeCatalog());
});

gameCatalogRouter.post('/', (req, res) => {
  const { title, platform, platformUrl, trailerUrl, playerId } = req.body ?? {};
  if (!isNonEmptyString(title, MAX_TITLE_LENGTH)) {
    return res.status(400).json({ error: `Titel ist erforderlich (1-${MAX_TITLE_LENGTH} Zeichen).` });
  }

  const parsedPlatform = optionalText(platform, MAX_PLATFORM_LENGTH);
  if (parsedPlatform === undefined) return res.status(400).json({ error: 'Plattform ist zu lang.' });
  const parsedPlatformUrl = optionalUrl(platformUrl);
  if (parsedPlatformUrl === undefined) return res.status(400).json({ error: 'Plattform-Link muss mit http(s) beginnen.' });
  const parsedTrailer = optionalUrl(trailerUrl);
  if (parsedTrailer === undefined) return res.status(400).json({ error: 'Trailer-Link muss mit http(s) beginnen.' });
  const createdBy = assertPlayer(playerId);
  if (createdBy === undefined) return res.status(404).json({ error: 'Spieler nicht gefunden.' });

  db.prepare(
    `INSERT INTO game_catalog (id, title, platform, platform_url, upload_done, play_rate, trailer_url, is_suggestion, created_by, created_at)
     VALUES (?, ?, ?, ?, 0, NULL, ?, 1, ?, ?)`
  ).run(nanoid(), title.trim(), parsedPlatform, parsedPlatformUrl, parsedTrailer ?? null, createdBy, Date.now());
  broadcast(Events.gameCatalogChanged, null);
  res.status(201).json(serializeCatalog());
});

gameCatalogRouter.patch('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM game_catalog WHERE id = ?').get(req.params.id) as CatalogRow | undefined;
  if (!existing) return res.status(404).json({ error: 'Spiel nicht gefunden.' });

  const { title, platform, platformUrl, trailerUrl } = req.body ?? {};
  const nextTitle = title === undefined ? existing.title : isNonEmptyString(title, MAX_TITLE_LENGTH) ? title.trim() : undefined;
  if (nextTitle === undefined) return res.status(400).json({ error: `Titel muss 1-${MAX_TITLE_LENGTH} Zeichen lang sein.` });
  const parsedPlatform = optionalText(platform, MAX_PLATFORM_LENGTH);
  if (parsedPlatform === undefined && platform !== undefined) return res.status(400).json({ error: 'Plattform ist zu lang.' });
  const parsedPlatformUrl = optionalUrl(platformUrl);
  if (parsedPlatformUrl === undefined && platformUrl !== undefined) {
    return res.status(400).json({ error: 'Plattform-Link muss mit http(s) beginnen.' });
  }
  const parsedTrailer = optionalUrl(trailerUrl);
  if (parsedTrailer === undefined && trailerUrl !== undefined) {
    return res.status(400).json({ error: 'Trailer-Link muss mit http(s) beginnen.' });
  }

  db.prepare(
    `UPDATE game_catalog
     SET title = ?, platform = ?, platform_url = ?, trailer_url = ?
     WHERE id = ?`
  ).run(
    nextTitle,
    platform === undefined ? existing.platform : parsedPlatform,
    platformUrl === undefined ? existing.platform_url : parsedPlatformUrl,
    trailerUrl === undefined ? existing.trailer_url : parsedTrailer,
    existing.id
  );
  broadcast(Events.gameCatalogChanged, null);
  res.json(serializeCatalog());
});

gameCatalogRouter.post('/:id/promote', requireAdmin, (req, res) => {
  const existing = db.prepare('SELECT id, is_suggestion FROM game_catalog WHERE id = ?').get(req.params.id) as
    | { id: string; is_suggestion: number }
    | undefined;
  if (!existing) return res.status(404).json({ error: 'Spiel nicht gefunden.' });
  if (!existing.is_suggestion) return res.status(400).json({ error: 'Spiel ist bereits im Katalog.' });

  db.prepare('UPDATE game_catalog SET is_suggestion = 0 WHERE id = ?').run(existing.id);
  broadcast(Events.gameCatalogChanged, null);
  res.json(serializeCatalog());
});

gameCatalogRouter.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM game_catalog WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'Spiel nicht gefunden.' });
  broadcast(Events.gameCatalogChanged, null);
  res.status(204).end();
});

gameCatalogRouter.post('/:id/interest', (req, res) => {
  const game = db.prepare('SELECT id, is_suggestion FROM game_catalog WHERE id = ?').get(req.params.id) as
    | { id: string; is_suggestion: number }
    | undefined;
  if (!game) return res.status(404).json({ error: 'Spiel nicht gefunden.' });
  if (game.is_suggestion) return res.status(400).json({ error: 'Vorschläge werden mit 1-5 bewertet.' });

  const { playerId } = req.body ?? {};
  if (typeof playerId !== 'string' || !playerId) return res.status(400).json({ error: 'playerId ist erforderlich.' });
  const player = db.prepare('SELECT id FROM players WHERE id = ?').get(playerId);
  if (!player) return res.status(404).json({ error: 'Spieler nicht gefunden.' });

  const existing = db
    .prepare('SELECT 1 FROM game_catalog_interest WHERE catalog_id = ? AND player_id = ?')
    .get(req.params.id, playerId);
  if (existing) {
    db.prepare('DELETE FROM game_catalog_interest WHERE catalog_id = ? AND player_id = ?').run(req.params.id, playerId);
  } else {
    db.prepare('INSERT INTO game_catalog_interest (catalog_id, player_id) VALUES (?, ?)').run(req.params.id, playerId);
  }
  broadcast(Events.gameCatalogChanged, null);
  res.json(serializeCatalog());
});

gameCatalogRouter.put('/:id/rating', (req, res) => {
  const game = db.prepare('SELECT id FROM game_catalog WHERE id = ?').get(req.params.id) as { id: string } | undefined;
  if (!game) return res.status(404).json({ error: 'Spiel nicht gefunden.' });

  const { playerId, rating } = req.body ?? {};
  if (typeof playerId !== 'string' || !playerId) return res.status(400).json({ error: 'playerId ist erforderlich.' });
  if (!isIntInRange(rating, 1, 5)) return res.status(400).json({ error: 'rating muss zwischen 1 und 5 liegen.' });
  const player = db.prepare('SELECT id FROM players WHERE id = ?').get(playerId);
  if (!player) return res.status(404).json({ error: 'Spieler nicht gefunden.' });

  db.prepare(
    `INSERT INTO game_catalog_ratings (catalog_id, player_id, rating)
     VALUES (?, ?, ?)
     ON CONFLICT(catalog_id, player_id) DO UPDATE SET rating = excluded.rating`
  ).run(req.params.id, playerId, rating);
  broadcast(Events.gameCatalogChanged, null);
  res.json(serializeCatalog());
});
