// DOM-free markup for the Broadcast (kiosk) Live-Status card. kiosk.js owns
// the layout decisions (columns, paging); this only builds the strings so the
// content stays unit-testable.

import { escapeHtml, stateLabel, avatarHtml } from './format.js';
import { activeGameGroups, runningGameNames } from './liveActivity.js';
import { icon } from './icons.js';

// One roster row: avatar, name with a second line below it and the status
// dot. The second line names the running game for a playing participant and
// the state otherwise, so every row keeps the same height whatever happens.
export function kioskLiveRowHtml(p) {
  const label = escapeHtml(stateLabel(p.state));
  const games = p.state === 'playing' ? runningGameNames(p) : [];
  const detail = games.length > 0 ? escapeHtml(games.join(', ')) : label;
  return `<div class="kiosk-live-row is-${escapeHtml(p.state)}">${avatarHtml(p, 32)}<span class="kiosk-live-text"><span class="player-name">${escapeHtml(p.name)}</span><span class="kiosk-live-detail">${detail}</span></span><span class="kiosk-live-status is-${escapeHtml(p.state)}" role="img" aria-label="${label}" title="${label}"></span></div>`;
}

// "Gerade aktiv" above the roster, as on Home: one pill per running game with
// its player count. They are passive TV labels, not the interactive .chip
// control, so kiosk.css styles them at the TV text size on its own. The count is a people icon plus the number (the German
// wording stays its accessible name) so several games fit on one line.
// Nothing at all while nobody plays.
export function kioskLiveActiveHtml(players) {
  const groups = activeGameGroups(players);
  if (groups.length === 0) return '';
  const chips = groups
    .map((g) => {
      const count = `${g.players.length} Spieler`;
      return `<span class="kiosk-live-game"><strong>${escapeHtml(g.name)}</strong><span class="kiosk-live-active-count muted" role="img" aria-label="${count}" title="${count}">${icon('users')}${g.players.length}</span></span>`;
    })
    .join('');
  return `<div class="kiosk-live-active"><span class="kiosk-live-active-label">Gerade aktiv</span>${chips}</div>`;
}
