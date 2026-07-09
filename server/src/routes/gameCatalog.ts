// Shared "could we play this?" catalog. This is intentionally not the
// tracked games table: it contains install/upload hints, trailers/prices and
// simple per-player interest taps for planning the LAN game pool.

import { Router } from 'express';
import { nanoid } from 'nanoid';
import { db } from '../db';
import { broadcast, Events } from '../realtime';
import { isIntInRange, isNonEmptyString } from '../validation';

export const gameCatalogRouter = Router();

const MAX_TITLE_LENGTH = 80;
const MAX_PLATFORM_LENGTH = 80;
const MAX_TRAILER_LENGTH = 500;
const PLAY_RATES = new Set(['niedrig', 'mittel', 'hoch']);

interface CatalogRow {
  id: string;
  title: string;
  platform: string | null;
  upload_done: number;
  play_rate: string | null;
  price_cents: number | null;
  trailer_url: string | null;
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

function optionalText(value: unknown, maxLength: number): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length <= maxLength ? trimmed : undefined;
}

function optionalPlayRate(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  return typeof value === 'string' && PLAY_RATES.has(value) ? value : undefined;
}

function optionalPriceCents(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  return isIntInRange(value, 0, 999_999_00) ? value : undefined;
}

function optionalTrailerUrl(value: unknown): string | null | undefined {
  const text = optionalText(value, MAX_TRAILER_LENGTH);
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
      `SELECT id, title, platform, upload_done, play_rate, price_cents, trailer_url, created_by, created_at
       FROM game_catalog
       ORDER BY title COLLATE NOCASE`
    )
    .all() as CatalogRow[];

  if (rows.length === 0) return { items: [] };

  const interestRows = db
    .prepare(
      `SELECT i.catalog_id, p.id AS player_id, p.name, p.color, p.avatar
       FROM game_catalog_interest i
       JOIN players p ON p.id = i.player_id
       WHERE i.catalog_id IN (${rows.map(() => '?').join(',')})
       ORDER BY p.name COLLATE NOCASE`
    )
    .all(...rows.map((r) => r.id)) as InterestRow[];

  const interestsByCatalog = new Map<string, InterestRow[]>();
  for (const interest of interestRows) {
    interestsByCatalog.set(interest.catalog_id, [...(interestsByCatalog.get(interest.catalog_id) ?? []), interest]);
  }

  return {
    items: rows.map((r) => {
      const interested = interestsByCatalog.get(r.id) ?? [];
      return {
        id: r.id,
        title: r.title,
        platform: r.platform,
        uploadDone: Boolean(r.upload_done),
        playRate: r.play_rate,
        priceCents: r.price_cents,
        trailerUrl: r.trailer_url,
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
      };
    }),
  };
}

gameCatalogRouter.get('/', (_req, res) => {
  res.json(serializeCatalog());
});

gameCatalogRouter.post('/', (req, res) => {
  const { title, platform, uploadDone, playRate, priceCents, trailerUrl, playerId } = req.body ?? {};
  if (!isNonEmptyString(title, MAX_TITLE_LENGTH)) {
    return res.status(400).json({ error: `Titel ist erforderlich (1-${MAX_TITLE_LENGTH} Zeichen).` });
  }

  const parsedPlatform = optionalText(platform, MAX_PLATFORM_LENGTH);
  if (parsedPlatform === undefined) return res.status(400).json({ error: 'Plattform ist zu lang.' });
  const parsedPlayRate = optionalPlayRate(playRate);
  if (parsedPlayRate === undefined) return res.status(400).json({ error: 'Spielrate muss niedrig, mittel oder hoch sein.' });
  const parsedPrice = optionalPriceCents(priceCents);
  if (parsedPrice === undefined) return res.status(400).json({ error: 'Preis muss eine positive Cent-Ganzzahl sein.' });
  const parsedTrailer = optionalTrailerUrl(trailerUrl);
  if (parsedTrailer === undefined) return res.status(400).json({ error: 'Trailer-URL muss mit http(s) beginnen.' });
  const createdBy = assertPlayer(playerId);
  if (createdBy === undefined) return res.status(404).json({ error: 'Spieler nicht gefunden.' });

  db.prepare(
    `INSERT INTO game_catalog (id, title, platform, upload_done, play_rate, price_cents, trailer_url, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    nanoid(),
    title.trim(),
    parsedPlatform,
    uploadDone === true ? 1 : 0,
    parsedPlayRate ?? null,
    parsedPrice ?? null,
    parsedTrailer ?? null,
    createdBy,
    Date.now()
  );
  broadcast(Events.gameCatalogChanged, null);
  res.status(201).json(serializeCatalog());
});

gameCatalogRouter.patch('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM game_catalog WHERE id = ?').get(req.params.id) as CatalogRow | undefined;
  if (!existing) return res.status(404).json({ error: 'Spiel nicht gefunden.' });

  const { title, platform, uploadDone, playRate, priceCents, trailerUrl } = req.body ?? {};
  const nextTitle = title === undefined ? existing.title : isNonEmptyString(title, MAX_TITLE_LENGTH) ? title.trim() : undefined;
  if (nextTitle === undefined) return res.status(400).json({ error: `Titel muss 1-${MAX_TITLE_LENGTH} Zeichen lang sein.` });
  const parsedPlatform = optionalText(platform, MAX_PLATFORM_LENGTH);
  if (parsedPlatform === undefined && platform !== undefined) return res.status(400).json({ error: 'Plattform ist zu lang.' });
  const parsedPlayRate = optionalPlayRate(playRate);
  if (parsedPlayRate === undefined && playRate !== undefined) {
    return res.status(400).json({ error: 'Spielrate muss niedrig, mittel oder hoch sein.' });
  }
  const parsedPrice = optionalPriceCents(priceCents);
  if (parsedPrice === undefined && priceCents !== undefined) {
    return res.status(400).json({ error: 'Preis muss eine positive Cent-Ganzzahl sein.' });
  }
  const parsedTrailer = optionalTrailerUrl(trailerUrl);
  if (parsedTrailer === undefined && trailerUrl !== undefined) {
    return res.status(400).json({ error: 'Trailer-URL muss mit http(s) beginnen.' });
  }
  if (uploadDone !== undefined && typeof uploadDone !== 'boolean') {
    return res.status(400).json({ error: 'uploadDone muss true oder false sein.' });
  }

  db.prepare(
    `UPDATE game_catalog
     SET title = ?, platform = ?, upload_done = ?, play_rate = ?, price_cents = ?, trailer_url = ?
     WHERE id = ?`
  ).run(
    nextTitle,
    platform === undefined ? existing.platform : parsedPlatform,
    uploadDone === undefined ? existing.upload_done : uploadDone ? 1 : 0,
    playRate === undefined ? existing.play_rate : parsedPlayRate,
    priceCents === undefined ? existing.price_cents : parsedPrice,
    trailerUrl === undefined ? existing.trailer_url : parsedTrailer,
    existing.id
  );
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
  const game = db.prepare('SELECT id FROM game_catalog WHERE id = ?').get(req.params.id);
  if (!game) return res.status(404).json({ error: 'Spiel nicht gefunden.' });

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
