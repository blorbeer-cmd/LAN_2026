// Shared game-specific skill display for player rows in team formation and
// tournaments. A missing self-rating is shown as the parenthesized fallback
// the server actually balances with (DEFAULT_RATING in routes/matchmaking.ts),
// so the visible per-player values and team totals match the draw instead of
// contradicting it.

import { domainIcon } from './domainIcons.js';
import { icon } from './icons.js';
import { state } from './state.js';

export const UNRATED_SKILL_VALUE = 5;

export function skillRatingFor(playerId, gameId) {
  const entry = state.skills.find((skill) => skill.player_id === playerId && skill.game_id === gameId);
  return entry ? entry.rating : null;
}

export function skillLevelHtml(rating) {
  const rated = rating != null;
  const value = rated ? rating : `(${UNRATED_SKILL_VALUE})`;
  const title = rated
    ? `Skill-Level ${rating} von 10`
    : `Ohne eigene Bewertung, zählt mit Skill-Level ${UNRATED_SKILL_VALUE} von 10`;
  const unratedClass = rated ? '' : ' rating-unrated';
  return `<span class="rating${unratedClass}" title="${title}" aria-label="${title}">${icon(domainIcon('skill'))}<span>${value}</span></span>`;
}

export function playerSkillHtml(playerId, gameId) {
  return skillLevelHtml(skillRatingFor(playerId, gameId));
}

export function teamSkillTotal(players, gameId) {
  return players.reduce(
    (total, player) => total + (skillRatingFor(player.id, gameId) ?? UNRATED_SKILL_VALUE),
    0
  );
}

export function unratedPlayerCount(players, gameId) {
  return players.filter((player) => skillRatingFor(player.id, gameId) == null).length;
}

export function teamSkillHtml(players, gameId) {
  const total = teamSkillTotal(players, gameId);
  const unrated = unratedPlayerCount(players, gameId);
  const value = unrated > 0 ? `${total} <span class="rating-unrated">(${unrated})</span>` : `${total}`;
  const title =
    unrated > 0
      ? `Gesamt-Skill ${total}, davon ${unrated} ohne eigene Bewertung mit je ${UNRATED_SKILL_VALUE}`
      : `Gesamt-Skill ${total}`;
  return `<span class="rating team-skill-total" title="${title}" aria-label="${title}">${icon(domainIcon('skill'))}<span>${value}</span></span>`;
}
