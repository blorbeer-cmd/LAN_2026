import { Router } from 'express';
import { db } from '../db';
import { requireUser } from '../sessions';

export const onboardingRouter = Router();

export const ONBOARDING_VERSION = 1;
// Upper bound for the persisted step index (see STEPS/buildSteps() in
// onboarding.js): 12 steps for admins (Home, Match, Vote, Essen, Mehr,
// Profil, Arcade, Durchsage, Jam, Orga, Admin, Spielekatalog), one fewer for
// everyone else — index 11 is the highest either variant can reach.
export const CORE_STEP_COUNT = 11;
const MAX_SEEN_VIEWS = 20;

type OnboardingStatus = 'pending' | 'active' | 'completed' | 'skipped';
type RatingStatus = 'pending' | 'active' | 'completed' | 'deferred';

interface OnboardingRow {
  player_id: string;
  version: number;
  status: OnboardingStatus;
  last_core_step: number;
  rating_status: RatingStatus;
  rating_candidate_ids_json: string;
  seen_views_json: string;
  completed_at: number | null;
  updated_at: number;
}

export interface OnboardingState {
  version: number;
  status: OnboardingStatus;
  lastCoreStep: number;
  ratingStatus: RatingStatus;
  ratingCandidateIds: string[];
  seenViews: string[];
  completedAt: number | null;
}

const DEFAULT_COMPLETED_STATE: OnboardingState = {
  version: ONBOARDING_VERSION,
  status: 'completed',
  lastCoreStep: CORE_STEP_COUNT,
  ratingStatus: 'completed',
  ratingCandidateIds: [],
  seenViews: [],
  completedAt: null,
};

function parseStringArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
  } catch {
    return [];
  }
}

function toState(row: OnboardingRow | undefined): OnboardingState {
  if (!row) return { ...DEFAULT_COMPLETED_STATE };
  return {
    version: row.version,
    status: row.status,
    lastCoreStep: row.last_core_step,
    ratingStatus: row.rating_status,
    ratingCandidateIds: parseStringArray(row.rating_candidate_ids_json),
    seenViews: parseStringArray(row.seen_views_json),
    completedAt: row.completed_at,
  };
}

function rowFor(playerId: string): OnboardingRow | undefined {
  return db.prepare('SELECT * FROM player_onboarding WHERE player_id = ?').get(playerId) as OnboardingRow | undefined;
}

/** New registrations and first-time claims start with an active onboarding state. */
export function resetOnboardingForNewAccount(playerId: string): void {
  const now = Date.now();
  db.prepare(
    `INSERT INTO player_onboarding
       (player_id, version, status, last_core_step, rating_status, rating_candidate_ids_json, seen_views_json, completed_at, updated_at)
     VALUES (?, ?, 'pending', 0, 'pending', '[]', '[]', NULL, ?)
     ON CONFLICT(player_id) DO UPDATE SET
       version = excluded.version,
       status = 'pending',
       last_core_step = 0,
       rating_status = 'pending',
       rating_candidate_ids_json = '[]',
       seen_views_json = '[]',
       completed_at = NULL,
       updated_at = excluded.updated_at`,
  ).run(playerId, ONBOARDING_VERSION, now);
}

function updateState(playerId: string, patch: Partial<{
  status: OnboardingStatus;
  lastCoreStep: number;
  ratingStatus: RatingStatus;
  ratingCandidateIds: string[];
  seenViews: string[];
  completedAt: number | null;
}>): OnboardingState {
  const current = toState(rowFor(playerId));
  const next = {
    ...current,
    ...patch,
    version: ONBOARDING_VERSION,
  };
  const now = Date.now();
  db.prepare(
    `INSERT INTO player_onboarding
       (player_id, version, status, last_core_step, rating_status, rating_candidate_ids_json, seen_views_json, completed_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(player_id) DO UPDATE SET
       version = excluded.version,
       status = excluded.status,
       last_core_step = excluded.last_core_step,
       rating_status = excluded.rating_status,
       rating_candidate_ids_json = excluded.rating_candidate_ids_json,
       seen_views_json = excluded.seen_views_json,
       completed_at = excluded.completed_at,
       updated_at = excluded.updated_at`,
  ).run(
    playerId,
    next.version,
    next.status,
    next.lastCoreStep,
    next.ratingStatus,
    JSON.stringify(next.ratingCandidateIds),
    JSON.stringify(next.seenViews),
    next.completedAt,
    now,
  );
  return { ...next };
}

function rankedCatalogGameIds(groupId: string): string[] {
  const rows = db
    .prepare(
      `SELECT g.id,
              COALESCE(AVG(CASE WHEN pl.id IS NOT NULL THEN p.rating END), -1) AS average_bock,
              COUNT(CASE WHEN pl.id IS NOT NULL THEN p.rating END) AS rating_count,
              g.name
       FROM games g
       LEFT JOIN preferences p ON p.game_id = g.id AND p.group_id = g.group_id
       LEFT JOIN players pl ON pl.id = p.player_id AND pl.is_test = 0
       WHERE g.group_id = ? AND g.status = 'catalog' AND g.arcade_key IS NULL
       GROUP BY g.id
       ORDER BY average_bock DESC, rating_count DESC, g.name COLLATE NOCASE ASC, g.id ASC`,
    )
    .all(groupId) as Array<{ id: string }>;
  return rows.map((row) => row.id);
}

function reconcileCandidateIds(candidateIds: string[], rankedIds: string[]): string[] {
  if (rankedIds.length === 0) return [];
  const targetCount = candidateIds.length > 10 ? rankedIds.length : Math.min(10, rankedIds.length);
  const rankedSet = new Set(rankedIds);
  const retained = candidateIds.filter((id) => rankedSet.has(id));
  return Array.from(new Set([...retained, ...rankedIds])).slice(0, targetCount);
}

function startRating(playerId: string, groupId: string, includeAll: boolean): OnboardingState {
  const current = toState(rowFor(playerId));
  const rankedIds = rankedCatalogGameIds(groupId);
  if (rankedIds.length === 0) {
    return updateState(playerId, {
      status: 'completed',
      ratingStatus: 'completed',
      ratingCandidateIds: [],
      completedAt: Date.now(),
    });
  }
  const candidateIds = current.ratingCandidateIds.length > 0
    ? reconcileCandidateIds(includeAll ? rankedIds : current.ratingCandidateIds, rankedIds)
    : (includeAll ? rankedIds : rankedIds.slice(0, 10));
  return updateState(playerId, {
    status: 'active',
    ratingStatus: 'active',
    ratingCandidateIds: candidateIds,
  });
}

function missingRatings(playerId: string, candidateIds: string[]): string[] {
  const requiredIds = candidateIds.slice(0, Math.min(10, candidateIds.length));
  const hasSkill = db.prepare('SELECT 1 FROM skills WHERE player_id = ? AND game_id = ?').pluck();
  const hasBock = db.prepare('SELECT 1 FROM preferences WHERE player_id = ? AND game_id = ?').pluck();
  return requiredIds.filter((gameId) => !hasSkill.get(playerId, gameId) || !hasBock.get(playerId, gameId));
}

onboardingRouter.get('/', requireUser, (req, res) => {
  res.json(toState(rowFor(req.player!.id)));
});

onboardingRouter.put('/', requireUser, (req, res) => {
  const body = req.body ?? {};
  const patch: Parameters<typeof updateState>[1] = {};

  if (body.status !== undefined) {
    if (!['pending', 'active'].includes(body.status)) {
      return res.status(400).json({ error: 'Ungültiger Onboarding-Status.' });
    }
    patch.status = body.status;
  }
  if (body.lastCoreStep !== undefined) {
    if (!Number.isInteger(body.lastCoreStep) || body.lastCoreStep < 0 || body.lastCoreStep > CORE_STEP_COUNT) {
      return res.status(400).json({ error: 'Ungültiger Onboarding-Schritt.' });
    }
    patch.lastCoreStep = body.lastCoreStep;
  }
  if (body.ratingStatus !== undefined) {
    if (!['pending', 'active', 'deferred'].includes(body.ratingStatus)) {
      return res.status(400).json({ error: 'Ungültiger Bewertungsstatus.' });
    }
    patch.ratingStatus = body.ratingStatus;
  }
  if (body.seenViews !== undefined) {
    if (
      !Array.isArray(body.seenViews)
      || body.seenViews.length > MAX_SEEN_VIEWS
      || body.seenViews.some((view: unknown) => typeof view !== 'string' || view.length > 60)
    ) {
      return res.status(400).json({ error: 'Ungültige Seitenhinweise.' });
    }
    patch.seenViews = Array.from(new Set(body.seenViews));
  }

  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'Keine gültige Änderung.' });
  return res.json(updateState(req.player!.id, patch));
});

// Test fixtures need a deterministic way to keep unrelated browser flows out
// of the first-login tour. This route is deliberately unavailable outside the
// test process; production clients must use rating/complete instead.
onboardingRouter.post('/test-complete', requireUser, (req, res) => {
  if (process.env.NODE_ENV !== 'test') return res.sendStatus(404);
  return res.json(updateState(req.player!.id, {
    status: 'completed',
    lastCoreStep: CORE_STEP_COUNT,
    ratingStatus: 'completed',
    completedAt: Date.now(),
  }));
});

onboardingRouter.post('/rating/start', requireUser, (req, res) => {
  const includeAll = req.body?.includeAll === true;
  return res.json(startRating(req.player!.id, req.group!.id, includeAll));
});

onboardingRouter.post('/rating/defer', requireUser, (req, res) => {
  const current = toState(rowFor(req.player!.id));
  if (current.ratingStatus !== 'active' || current.ratingCandidateIds.length === 0) {
    return res.status(409).json({ error: 'Keine aktive Bewertungsrunde vorhanden.' });
  }
  return res.json(updateState(req.player!.id, {
    status: 'completed',
    lastCoreStep: CORE_STEP_COUNT,
    ratingStatus: 'deferred',
    completedAt: null,
  }));
});

onboardingRouter.post('/rating/complete', requireUser, (req, res) => {
  const current = toState(rowFor(req.player!.id));
  if (current.ratingStatus !== 'active') {
    return res.status(409).json({ error: 'Bewertungsrunde wurde noch nicht gestartet.' });
  }
  const rankedIds = rankedCatalogGameIds(req.group!.id);
  const candidateIds = reconcileCandidateIds(current.ratingCandidateIds.length > 0 ? current.ratingCandidateIds : rankedIds.slice(0, 10), rankedIds);
  if (candidateIds.join('\u0000') !== current.ratingCandidateIds.join('\u0000')) {
    updateState(req.player!.id, { ratingCandidateIds: candidateIds });
  }
  if (candidateIds.length === 0) {
    return res.json(updateState(req.player!.id, {
      status: 'completed',
      ratingStatus: 'completed',
      completedAt: Date.now(),
    }));
  }
  const missing = missingRatings(req.player!.id, candidateIds);
  if (missing.length > 0) {
    return res.status(409).json({ error: 'Bewerte die ersten zehn Spiele vollständig.', code: 'onboarding_ratings_incomplete', missingGameIds: missing });
  }
  return res.json(updateState(req.player!.id, {
    status: 'completed',
    ratingStatus: 'completed',
    completedAt: Date.now(),
  }));
});
