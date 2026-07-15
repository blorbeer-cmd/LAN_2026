// Shared game-specific skill display for player rows in team formation and
// tournaments. Missing self-ratings stay visible as an en dash instead of
// presenting the server's neutral balancing fallback as a real rating.

import { domainIcon } from './domainIcons.js';
import { icon } from './icons.js';
import { state } from './state.js';

export const DEFAULT_SKILL_RATING = 5;

export function skillRatingFor(playerId, gameId) {
  const entry = state.skills.find((skill) => skill.player_id === playerId && skill.game_id === gameId);
  return entry ? entry.rating : null;
}

export function skillLevelHtml(rating) {
  const value = rating == null ? '–' : rating;
  const title = rating == null ? 'Noch kein Skill-Level eingetragen' : `Skill-Level ${rating} von 10`;
  return `<span class="rating" title="${title}" aria-label="${title}">${icon(domainIcon('skill'))}<span>${value}</span></span>`;
}

export function playerSkillHtml(playerId, gameId) {
  return skillLevelHtml(skillRatingFor(playerId, gameId));
}

export function teamSkillTotal(players, gameId) {
  return players.reduce(
    (total, player) => total + (skillRatingFor(player.id, gameId) ?? DEFAULT_SKILL_RATING),
    0
  );
}

export function teamSkillHtml(players, gameId) {
  const total = teamSkillTotal(players, gameId);
  const title = `Gesamt-Skill ${total}. Fehlende Bewertungen zählen mit ${DEFAULT_SKILL_RATING}.`;
  return `<span class="rating team-skill-total" title="${title}" aria-label="${title}">${icon(domainIcon('skill'))}<span>${total}</span></span>`;
}
