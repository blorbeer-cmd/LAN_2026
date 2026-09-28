// Broadcast newsticker: every 30 seconds one new, playfully exaggerated
// headline about the running event. Real, fresh results (matches,
// tournament fixtures) and, where the event tracks play time, ongoing
// sessions take priority; otherwise a line combines a real participant with
// a catalog game. Everything is generated on the server so every Broadcast
// screen of an event shows the same feed, and it is generated lazily on
// request (no timer), keyed by the 30-second slot the request falls into.
//
// The feed history is deliberately in memory only: after a restart the
// ticker simply starts a fresh feed, which costs nothing for a fun display.

import { db } from './db';
import {
  DRAW_TEMPLATES,
  FALLBACK_GAMES,
  FALLBACK_TEMPLATES,
  MATCH_TEMPLATES,
  PLAYING_TEMPLATES,
  PLAYTIME_TEMPLATES,
  TOURNAMENT_MATCH_TEMPLATES,
  pick,
  type NewsRandom,
  type NewsTemplate,
} from './newstickerTemplates';

export const NEWSTICKER_SLOT_MS = 30_000;
// Results older than this are no longer "news" and are left to the fallback.
export const NEWSTICKER_FRESH_MS = 90 * 60_000;
// A session has to run a while before it is worth a headline.
const PLAYING_MIN_MS = 20 * 60_000;
const PLAYTIME_MIN_HOURS = 2;
const FEED_LENGTH = 10;
// A new feed starts full, so the tile never waits minutes to fill up.
const INITIAL_ITEMS = FEED_LENGTH;
// Slots missed while no screen asked are not back-filled beyond this.
const MAX_CATCH_UP = 4;
const RECENT_TEMPLATE_WINDOW = 20;
// Two hours of ticker: no identical line comes back within that time.
const RECENT_TEXT_WINDOW = 240;
// Longer lines read badly from across the room and crowd a small tile, so
// they are re-rolled; only if every try is long does one still run.
const MAX_TEXT_LENGTH = 170;
const FRESH_FACT_SHARE = 0.8;
const TRACKING_FACT_SHARE = 0.35;
const STATE_IDLE_MS = 12 * 60 * 60_000;

export interface NewsItem {
  id: string;
  text: string;
  icon: string;
  meta: string | null;
  createdAt: number;
}

export interface NewsFeed {
  items: NewsItem[];
  nextAt: number;
  // Relative wait, so a screen with a skewed clock still asks on time.
  nextInMs: number;
}

export interface NewsPlayer {
  id: string;
  name: string;
}

interface FactBase {
  key: string;
  at: number;
  playerIds: string[];
}

export type NewsFact =
  | (FactBase & { kind: 'match'; game: string; winners: string[]; losers: string[]; score: string | null })
  | (FactBase & { kind: 'draw'; game: string; teams: string[] })
  | (FactBase & { kind: 'tournamentMatch'; tournament: string; game: string; winner: string; loser: string; score: string | null })
  | (FactBase & { kind: 'playing'; game: string; player: string; minutes: number })
  | (FactBase & { kind: 'playtime'; game: string; player: string; hours: number });

export interface NewsInput {
  roster: NewsPlayer[];
  games: string[];
  facts: NewsFact[];
}

export interface NewsHistory {
  recentTemplates: string[];
  recentTexts: string[];
  usedFacts: Set<string>;
  lastSubject: string | null;
}

export interface ComposedNews {
  text: string;
  icon: string;
  meta: string | null;
  templateId: string;
  subject: string | null;
  factKey: string | null;
  // Everyone the line names, so a later opt-out can hide it at once.
  playerIds: string[];
}

// mulberry32: a tiny seeded generator, so one slot always yields the same
// line for every screen and tests can reproduce a feed exactly.
export function seededRandom(seed: number): NewsRandom {
  let state = seed >>> 0;
  return {
    next() {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

export function hashSeed(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function joinNames(names: string[]): string {
  if (names.length === 0) return 'Unbekannt';
  if (names.length === 1) return names[0];
  if (names.length <= 3) return `${names.slice(0, -1).join(', ')} und ${names[names.length - 1]}`;
  return `${names.slice(0, 2).join(', ')} und ${names.length - 2} weitere`;
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} Minuten`;
  const hours = Math.floor(minutes / 60);
  return hours === 1 ? 'einer Stunde' : `${hours} Stunden`;
}

// Picks a template that was not used recently; when every form of this kind
// is still "warm" (few templates, busy feed) the least recently used wins.
function chooseTemplate<C>(rng: NewsRandom, templates: readonly NewsTemplate<C>[], history: NewsHistory): NewsTemplate<C> {
  const cold = templates.filter((template) => !history.recentTemplates.includes(template.id));
  if (cold.length > 0) return pick(rng, cold);
  return [...templates].sort(
    (a, b) => history.recentTemplates.lastIndexOf(a.id) - history.recentTemplates.lastIndexOf(b.id),
  )[0];
}

function composeFact(fact: NewsFact, rng: NewsRandom, history: NewsHistory): ComposedNews {
  switch (fact.kind) {
    case 'match': {
      const template = chooseTemplate(rng, MATCH_TEMPLATES, history);
      return {
        text: template.render({ winners: joinNames(fact.winners), losers: joinNames(fact.losers), game: fact.game, score: fact.score, rng }),
        icon: template.icon,
        meta: `${fact.game} · Match`,
        templateId: template.id,
        subject: fact.winners[0] ?? null,
        factKey: fact.key,
        playerIds: fact.playerIds,
      };
    }
    case 'draw': {
      const template = chooseTemplate(rng, DRAW_TEMPLATES, history);
      return {
        text: template.render({ teams: fact.teams.join(' und '), game: fact.game, rng }),
        icon: template.icon,
        meta: `${fact.game} · Match`,
        templateId: template.id,
        subject: null,
        factKey: fact.key,
        playerIds: fact.playerIds,
      };
    }
    case 'tournamentMatch': {
      const template = chooseTemplate(rng, TOURNAMENT_MATCH_TEMPLATES, history);
      return {
        text: template.render({ tournament: fact.tournament, winner: fact.winner, loser: fact.loser, score: fact.score, rng }),
        icon: template.icon,
        meta: `${fact.tournament} · ${fact.game}`,
        templateId: template.id,
        subject: fact.winner,
        factKey: fact.key,
        playerIds: fact.playerIds,
      };
    }
    case 'playing': {
      const template = chooseTemplate(rng, PLAYING_TEMPLATES, history);
      return {
        text: template.render({ player: fact.player, game: fact.game, duration: formatDuration(fact.minutes), rng }),
        icon: template.icon,
        meta: fact.game,
        templateId: template.id,
        subject: fact.player,
        factKey: fact.key,
        playerIds: fact.playerIds,
      };
    }
    case 'playtime': {
      const template = chooseTemplate(rng, PLAYTIME_TEMPLATES, history);
      return {
        text: template.render({ player: fact.player, game: fact.game, hours: fact.hours, rng }),
        icon: template.icon,
        meta: fact.game,
        templateId: template.id,
        subject: fact.player,
        factKey: fact.key,
        playerIds: fact.playerIds,
      };
    }
  }
}

function composeFallback(input: NewsInput, rng: NewsRandom, history: NewsHistory): ComposedNews | null {
  if (input.roster.length === 0) return null;
  // Never name the same person twice in a row when anyone else is there.
  const candidates = input.roster.filter((player) => player.name !== history.lastSubject);
  const player = pick(rng, candidates.length > 0 ? candidates : input.roster);
  const others = input.roster.filter((entry) => entry.id !== player.id);
  // A lone participant still gets duels: against "der Rest des Tisches".
  const other = others.length > 0 ? pick(rng, others) : null;
  const game = pick(rng, input.games.length > 0 ? input.games : FALLBACK_GAMES);
  const template = chooseTemplate(rng, FALLBACK_TEMPLATES, history);
  return {
    text: template.render({ player: player.name, other: other?.name ?? 'der Rest des Tisches', game, rng }),
    icon: template.icon,
    meta: game,
    templateId: template.id,
    subject: player.name,
    factKey: null,
    // The second person counts even for forms that do not print them: an
    // opt-out then hides slightly more than needed, never less.
    playerIds: other ? [player.id, other.id] : [player.id],
  };
}

const REAL_RESULT_KINDS = new Set<NewsFact['kind']>(['match', 'draw', 'tournamentMatch']);

// Pure selection step, separated from the database so the priorities and
// the anti-repeat rules can be tested directly.
export function composeNews(input: NewsInput, rng: NewsRandom, history: NewsHistory, now: number): ComposedNews | null {
  const unused = input.facts.filter((fact) => !history.usedFacts.has(fact.key));
  const freshResults = unused
    .filter((fact) => REAL_RESULT_KINDS.has(fact.kind) && now - fact.at <= NEWSTICKER_FRESH_MS)
    .sort((a, b) => b.at - a.at);
  const tracking = unused.filter((fact) => fact.kind === 'playing' || fact.kind === 'playtime');

  const attempts: Array<() => ComposedNews | null> = [];
  if (freshResults.length > 0 && rng.next() < FRESH_FACT_SHARE) attempts.push(() => composeFact(freshResults[0], rng, history));
  if (tracking.length > 0 && rng.next() < TRACKING_FACT_SHARE) attempts.push(() => composeFact(pick(rng, tracking), rng, history));
  // Several fallback tries: a rendered line that already ran recently is
  // re-rolled instead of shown again.
  for (let i = 0; i < 12; i += 1) attempts.push(() => composeFallback(input, rng, history));

  let last: ComposedNews | null = null;
  for (const attempt of attempts) {
    const composed = attempt();
    if (!composed) continue;
    last = composed;
    if (!history.recentTexts.includes(composed.text) && composed.text.length <= MAX_TEXT_LENGTH) return composed;
  }
  return last;
}

export function rememberNews(history: NewsHistory, composed: ComposedNews): void {
  history.recentTemplates.push(composed.templateId);
  if (history.recentTemplates.length > RECENT_TEMPLATE_WINDOW) history.recentTemplates.shift();
  history.recentTexts.push(composed.text);
  if (history.recentTexts.length > RECENT_TEXT_WINDOW) history.recentTexts.shift();
  if (composed.factKey) history.usedFacts.add(composed.factKey);
  history.lastSubject = composed.subject;
}

// ---------------------------------------------------------------------------
// Database facts

function parseIds(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export function loadNewsRoster(groupId: string, eventId: string): NewsPlayer[] {
  const participants = db
    .prepare(
      `SELECT p.id, p.name FROM event_participants ep
       JOIN players p ON p.id = ep.player_id
       WHERE ep.event_id = ? AND ep.status = 'accepted' AND p.deactivated_at IS NULL AND p.newsticker_opt_out = 0
       ORDER BY p.name COLLATE NOCASE`,
    )
    .all(eventId) as NewsPlayer[];
  if (participants.length > 0) return participants;
  // Events without a roster (e.g. a group workspace) fall back to the
  // group's active members.
  return db
    .prepare(
      `SELECT p.id, p.name FROM group_memberships gm
       JOIN players p ON p.id = gm.player_id
       WHERE gm.group_id = ? AND gm.status = 'active' AND p.deactivated_at IS NULL AND p.newsticker_opt_out = 0
       ORDER BY p.name COLLATE NOCASE`,
    )
    .all(groupId) as NewsPlayer[];
}

function loadCatalogGames(groupId: string): string[] {
  return (
    db
      .prepare(
        "SELECT name FROM games WHERE group_id = ? AND status = 'catalog' AND arcade_key IS NULL ORDER BY name COLLATE NOCASE",
      )
      .all(groupId) as Array<{ name: string }>
  ).map((row) => row.name);
}

function loadResultFacts(eventId: string, names: Map<string, string>, since: number): NewsFact[] {
  const facts: NewsFact[] = [];
  // Tournament results also write a matches row; those are reported once,
  // through their tournament fixture below.
  const matches = db
    .prepare(
      `SELECT m.id, m.played_at, m.result, g.name AS game FROM matches m
       JOIN games g ON g.id = m.game_id
       WHERE m.event_id = ? AND m.played_at >= ?
         AND NOT EXISTS (SELECT 1 FROM tournament_matches tm WHERE tm.match_id = m.id)
       ORDER BY m.played_at DESC LIMIT 20`,
    )
    .all(eventId, since) as Array<{ id: string; played_at: number; result: string; game: string }>;
  for (const match of matches) {
    let result: { teams?: Array<{ playerIds?: unknown; score?: number | null }>; winnerTeamIndex?: number | null };
    try {
      result = JSON.parse(match.result);
    } catch {
      continue;
    }
    const teams = (result.teams ?? []).map((team) => (Array.isArray(team.playerIds) ? team.playerIds.filter((id): id is string => typeof id === 'string') : []));
    const playerIds = teams.flat();
    // A result that names anyone outside the ticker roster (opted out,
    // deactivated, not at this event) is skipped as a whole.
    if (playerIds.length === 0 || playerIds.some((id) => !names.has(id))) continue;
    const teamNames = teams.map((ids) => joinNames(ids.map((id) => names.get(id)!)));
    const winnerIndex = result.winnerTeamIndex;
    if (winnerIndex === null || winnerIndex === undefined) {
      facts.push({ kind: 'draw', key: `match:${match.id}`, at: match.played_at, playerIds, game: match.game, teams: teamNames });
      continue;
    }
    const winners = teams[winnerIndex];
    if (!winners) continue;
    const losers = teams.filter((_, index) => index !== winnerIndex).flat();
    const scores = (result.teams ?? []).map((team) => team.score);
    const score = scores.length === 2 && scores.every((value) => typeof value === 'number')
      ? `${scores[winnerIndex]} : ${scores[1 - winnerIndex]}`
      : null;
    facts.push({
      kind: 'match',
      key: `match:${match.id}`,
      at: match.played_at,
      playerIds,
      game: match.game,
      winners: winners.map((id) => names.get(id)!),
      losers: losers.map((id) => names.get(id)!),
      score,
    });
  }

  const fixtures = db
    .prepare(
      `SELECT tm.id, tm.played_at, tm.score_a, tm.score_b, tm.winner_team_id, tm.team_a_id,
              t.name AS tournament, g.name AS game,
              ta.name AS team_a, ta.player_ids AS team_a_players,
              tb.name AS team_b, tb.player_ids AS team_b_players
       FROM tournament_matches tm
       JOIN tournaments t ON t.id = tm.tournament_id
       JOIN games g ON g.id = t.game_id
       JOIN tournament_teams ta ON ta.id = tm.team_a_id
       JOIN tournament_teams tb ON tb.id = tm.team_b_id
       WHERE t.event_id = ? AND tm.played_at >= ? AND tm.is_bye = 0 AND tm.is_draw = 0 AND tm.winner_team_id IS NOT NULL
       ORDER BY tm.played_at DESC LIMIT 20`,
    )
    .all(eventId, since) as Array<{
    id: string;
    played_at: number;
    score_a: number | null;
    score_b: number | null;
    winner_team_id: string;
    team_a_id: string;
    tournament: string;
    game: string;
    team_a: string;
    team_a_players: string;
    team_b: string;
    team_b_players: string;
  }>;
  for (const fixture of fixtures) {
    const playerIds = [...parseIds(fixture.team_a_players), ...parseIds(fixture.team_b_players)];
    if (playerIds.some((id) => !names.has(id))) continue;
    const aWon = fixture.winner_team_id === fixture.team_a_id;
    const score = fixture.score_a !== null && fixture.score_b !== null
      ? aWon ? `${fixture.score_a} : ${fixture.score_b}` : `${fixture.score_b} : ${fixture.score_a}`
      : null;
    facts.push({
      kind: 'tournamentMatch',
      key: `tournament-match:${fixture.id}`,
      at: fixture.played_at,
      playerIds,
      tournament: fixture.tournament,
      game: fixture.game,
      winner: aWon ? fixture.team_a : fixture.team_b,
      loser: aWon ? fixture.team_b : fixture.team_a,
      score,
    });
  }
  return facts;
}

// play_sessions only exist where the event tracks play time with consent,
// so without tracking this simply yields nothing.
function loadTrackingFacts(eventId: string, names: Map<string, string>, now: number): NewsFact[] {
  const facts: NewsFact[] = [];
  const ongoing = db
    .prepare(
      `SELECT ps.player_id, ps.started_at, g.name AS game FROM play_sessions ps
       JOIN games g ON g.id = ps.game_id
       WHERE ps.event_id = ? AND ps.ended_at IS NULL AND ps.started_at <= ?`,
    )
    .all(eventId, now - PLAYING_MIN_MS) as Array<{ player_id: string; started_at: number; game: string }>;
  for (const session of ongoing) {
    const player = names.get(session.player_id);
    if (!player) continue;
    const minutes = Math.floor((now - session.started_at) / 60_000);
    // One headline per started hour of the same session at most.
    facts.push({
      kind: 'playing',
      key: `playing:${session.player_id}:${session.game}:${session.started_at}:${Math.floor(minutes / 60)}`,
      at: now,
      playerIds: [session.player_id],
      game: session.game,
      player,
      minutes,
    });
  }
  const totals = db
    .prepare(
      `SELECT ps.player_id, g.name AS game,
              SUM(COALESCE(ps.ended_at, ?) - MAX(ps.started_at, ?)) AS total_ms
       FROM play_sessions ps JOIN games g ON g.id = ps.game_id
       WHERE ps.event_id = ? AND COALESCE(ps.ended_at, ?) > ?
       GROUP BY ps.player_id, g.name
       HAVING total_ms >= ?`,
    )
    .all(now, now - 24 * 60 * 60_000, eventId, now, now - 24 * 60 * 60_000, PLAYTIME_MIN_HOURS * 60 * 60_000) as Array<{
    player_id: string;
    game: string;
    total_ms: number;
  }>;
  for (const total of totals) {
    const player = names.get(total.player_id);
    if (!player) continue;
    const hours = Math.floor(total.total_ms / (60 * 60_000));
    facts.push({
      kind: 'playtime',
      key: `playtime:${total.player_id}:${total.game}:${hours}`,
      at: now,
      playerIds: [total.player_id],
      game: total.game,
      player,
      hours,
    });
  }
  return facts;
}

export function loadNewsInput(groupId: string, eventId: string, now: number): NewsInput {
  const roster = loadNewsRoster(groupId, eventId);
  const names = new Map(roster.map((player) => [player.id, player.name]));
  return {
    roster,
    games: loadCatalogGames(groupId),
    facts: [...loadResultFacts(eventId, names, now - NEWSTICKER_FRESH_MS), ...loadTrackingFacts(eventId, names, now)],
  };
}

// ---------------------------------------------------------------------------
// Feed state

interface StoredItem extends NewsItem {
  playerIds: string[];
}

interface FeedState {
  items: StoredItem[];
  lastSlot: number;
  history: NewsHistory;
  touchedAt: number;
}

const feeds = new Map<string, FeedState>();

export function resetNewstickerFeeds(): void {
  feeds.clear();
}

function pruneIdleFeeds(now: number): void {
  for (const [key, state] of feeds) {
    if (now - state.touchedAt > STATE_IDLE_MS) feeds.delete(key);
  }
}

export function getNewstickerFeed(groupId: string, eventId: string, now = Date.now()): NewsFeed {
  pruneIdleFeeds(now);
  const key = `${groupId}:${eventId}`;
  const slot = Math.floor(now / NEWSTICKER_SLOT_MS);
  let state = feeds.get(key);
  if (!state) {
    state = {
      items: [],
      lastSlot: slot - INITIAL_ITEMS,
      history: { recentTemplates: [], recentTexts: [], usedFacts: new Set(), lastSubject: null },
      touchedAt: now,
    };
    feeds.set(key, state);
  }
  state.touchedAt = now;

  if (slot > state.lastSlot) {
    const catchUp = state.items.length === 0 ? INITIAL_ITEMS : MAX_CATCH_UP;
    const firstSlot = Math.max(state.lastSlot + 1, slot - catchUp + 1);
    const input = loadNewsInput(groupId, eventId, now);
    for (let current = firstSlot; current <= slot; current += 1) {
      const rng = seededRandom(hashSeed(`${key}:${current}`));
      const composed = composeNews(input, rng, state.history, now);
      if (!composed) continue;
      rememberNews(state.history, composed);
      state.items.unshift({
        id: `${eventId}:${current}`,
        text: composed.text,
        icon: composed.icon,
        meta: composed.meta,
        createdAt: current * NEWSTICKER_SLOT_MS,
        playerIds: composed.playerIds,
      });
    }
    state.items.length = Math.min(state.items.length, FEED_LENGTH);
    state.lastSlot = slot;
  }

  // Filtered on every read, not only when a line is created: someone who
  // opts out disappears from the screen with the next poll.
  const visible = new Set(loadNewsRoster(groupId, eventId).map((player) => player.id));
  const items = state.items
    .filter((item) => item.playerIds.every((id) => visible.has(id)))
    .map(({ playerIds: _playerIds, ...item }) => item);
  const nextAt = (slot + 1) * NEWSTICKER_SLOT_MS;
  return { items, nextAt, nextInMs: nextAt - now };
}
