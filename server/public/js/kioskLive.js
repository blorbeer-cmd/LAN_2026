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

// Keeps the one-line strip readable once it is on screen. In this order:
// the smallest groups give way first and are summed up in a compact "+N"
// pill; the largest game's whole name comes before that pill; and a name
// too long even on its own shortens, but never below about six characters
// next to its count. Runs again only for a fresh paint or a new strip
// width, so an unchanged board leaves the strip alone.
export function fitKioskLiveActive(container) {
  const strip = container.querySelector('.kiosk-live-active');
  if (!strip) return;
  const width = String(strip.clientWidth);
  if (strip.dataset.fittedWidth === width) return;
  const pills = [...strip.querySelectorAll('.kiosk-live-game:not(.kiosk-live-more)')];
  let more = strip.querySelector('.kiosk-live-more');
  if (!more) {
    more = document.createElement('span');
    more.className = 'kiosk-live-game kiosk-live-more';
    more.setAttribute('role', 'img');
    strip.append(more);
  }
  const overflows = () => strip.scrollWidth > strip.clientWidth + 1;
  const largestName = pills[0].querySelector('strong');
  const largestNameReadable = () =>
    largestName.getBoundingClientRect().width >= parseFloat(getComputedStyle(largestName).fontSize) * 3;
  for (const pill of pills) pill.hidden = false;
  pills[0].classList.remove('is-squeezed');
  more.hidden = true;
  let shown = pills.length;
  while (shown > 1 && overflows()) {
    shown -= 1;
    pills[shown].hidden = true;
    const hidden = pills.length - shown;
    const label = hidden === 1 ? '1 weiteres Spiel' : `${hidden} weitere Spiele`;
    more.textContent = `+${hidden}`;
    more.setAttribute('aria-label', label);
    more.title = label;
    more.hidden = false;
  }
  if (overflows()) {
    more.hidden = true;
    if (overflows()) {
      pills[0].classList.add('is-squeezed');
      if (shown < pills.length) {
        more.hidden = false;
        if (overflows() || !largestNameReadable()) more.hidden = true;
      }
    }
  }
  strip.dataset.fittedWidth = width;
}
