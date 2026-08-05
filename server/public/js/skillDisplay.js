// Shared game-specific skill display for player rows in team formation and
// tournaments. Two things vary per call site and both change what an honest
// display looks like:
//
// - `balanced`: whether the shown teams were actually built from these ratings.
//   A matchmaking draw was, so a player without an own rating entered it with
//   the neutral fallback and that value is shown in parentheses. A captain
//   draft picks by turn order and never touches ratings (routes/draft.ts), so
//   there the values are pure information and a missing one stays an en dash —
//   claiming it "counts as 5" would describe a calculation that never happened.
// - `stored`: whether the player objects come from a persisted draw snapshot.
//   Those carry the rating the draw itself used (null when there was none) and
//   must keep showing it, so a later self-rating cannot retroactively rewrite
//   a recorded lineup. Live selections have no snapshot and use current state.

import { domainIcon } from './domainIcons.js';
import { icon } from './icons.js';
import { state } from './state.js';

export const UNRATED_SKILL_VALUE = 5;

export function skillRatingFor(playerId, gameId) {
  const entry = state.skills.find((skill) => skill.player_id === playerId && skill.game_id === gameId);
  return entry ? entry.rating : null;
}

export function ratingForPlayer(player, gameId, { stored = false } = {}) {
  return stored ? (player.rating ?? null) : skillRatingFor(player.id, gameId);
}

export function skillLevelHtml(rating, { balanced = true } = {}) {
  if (rating == null) {
    const title = balanced
      ? `Ohne eigene Bewertung, zählt mit Skill-Level ${UNRATED_SKILL_VALUE} von 10`
      : 'Noch kein Skill-Level eingetragen';
    const value = balanced ? `(${UNRATED_SKILL_VALUE})` : '–';
    return `<span class="rating rating-unrated" title="${title}" aria-label="${title}">${icon(domainIcon('skill'))}<span>${value}</span></span>`;
  }
  const title = `Skill-Level ${rating} von 10`;
  return `<span class="rating" title="${title}" aria-label="${title}">${icon(domainIcon('skill'))}<span>${rating}</span></span>`;
}

export function playerSkillHtml(player, gameId, options = {}) {
  return skillLevelHtml(ratingForPlayer(player, gameId, options), options);
}

export function teamSkillTotal(players, gameId, options = {}) {
  const { balanced = true } = options;
  return players.reduce((total, player) => {
    const rating = ratingForPlayer(player, gameId, options);
    if (rating != null) return total + rating;
    return balanced ? total + UNRATED_SKILL_VALUE : total;
  }, 0);
}

export function unratedPlayerCount(players, gameId, options = {}) {
  return players.filter((player) => ratingForPlayer(player, gameId, options) == null).length;
}

export function teamSkillHtml(players, gameId, options = {}) {
  const { balanced = true } = options;
  const total = teamSkillTotal(players, gameId, options);
  // Only a balanced lineup can state what the missing ratings contributed;
  // without that, the count would name a share of a sum it never entered.
  const unrated = balanced ? unratedPlayerCount(players, gameId, options) : 0;
  const value = unrated > 0 ? `${total} <span class="rating-unrated">(${unrated})</span>` : `${total}`;
  const title =
    unrated > 0
      ? `Gesamt-Skill ${total}, davon ${unrated} ohne eigene Bewertung mit je ${UNRATED_SKILL_VALUE}`
      : `Gesamt-Skill ${total}`;
  return `<span class="rating team-skill-total" title="${title}" aria-label="${title}">${icon(domainIcon('skill'))}<span>${value}</span></span>`;
}
