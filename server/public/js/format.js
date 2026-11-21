// Small formatting/escaping helpers shared by every view.

import { icon } from './icons.js';

export function escapeHtml(value) {
  const s = String(value ?? '');
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// A whole value that is a web address ("https://…", "http://…" or "www.…")
// returns its normalized http(s) href; anything else (an IP:port, plain
// text, another scheme) returns null so callers never build a foreign link.
export function webUrlHref(value) {
  const trimmed = String(value ?? '').trim();
  if (!/^(?:https?:\/\/|www\.)\S+$/i.test(trimmed)) return null;
  try {
    const url = new URL(/^www\./i.test(trimmed) ? `https://${trimmed}` : trimmed);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

// Double quotes (straight and typographic) never belong to an address; an
// apostrophe may (".../o'connor"), so it only counts as a quote at the end.
const TEXT_URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"“”„‟«»‹›]+/gi;
const CLOSING_BRACKETS = { ')': '(', ']': '[', '}': '{' };
const TRAILING_TEXT = '.,;:!?\'‘’‚';

// Sentence punctuation or a closing single quote directly after a URL
// ("… unter https://x.de.") stays text, as does a closing bracket the URL
// itself never opened.
function trimUrlEnd(candidate) {
  let end = candidate.length;
  while (end > 0) {
    const last = candidate[end - 1];
    if (TRAILING_TEXT.includes(last)) {
      end -= 1;
      continue;
    }
    const opening = CLOSING_BRACKETS[last];
    if (!opening) break;
    const part = candidate.slice(0, end);
    if (part.split(opening).length >= part.split(last).length) break;
    end -= 1;
  }
  return candidate.slice(0, end);
}

// Escapes user text for HTML and turns every web address in it into a link
// that opens in a new tab. Line breaks are left to the caller's CSS.
export function linkifyHtml(text) {
  const source = String(text ?? '');
  let html = '';
  let index = 0;
  for (const match of source.matchAll(TEXT_URL_PATTERN)) {
    const candidate = trimUrlEnd(match[0]);
    const href = webUrlHref(candidate);
    if (!href) continue;
    html += escapeHtml(source.slice(index, match.index));
    html += `<a class="text-link" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(candidate)}</a>`;
    index = match.index + candidate.length;
  }
  return html + escapeHtml(source.slice(index));
}

// "seit HH:MM" for a timestamp, or a relative "vor Xm" for very recent ones.
export function formatSince(timestampMs) {
  if (!timestampMs) return '';
  const diffMin = Math.max(0, Math.round((Date.now() - timestampMs) / 60000));
  if (diffMin < 1) return 'gerade eben';
  if (diffMin < 60) return `seit ${diffMin} Min.`;
  const d = new Date(timestampMs);
  return `seit ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')} Uhr`;
}

export function formatDateTime(timestampMs) {
  if (!timestampMs) return '–';
  const d = new Date(timestampMs);
  return d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function formatDate(timestampMs) {
  if (!timestampMs) return '–';
  const d = new Date(timestampMs);
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
}

// "2026-07-08T14:30" — the value format <input type="datetime-local">
// expects/emits, in the browser's local time (not UTC).
export function toDatetimeLocal(timestampMs) {
  const d = new Date(timestampMs);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const STATE_LABELS = { playing: 'Spielt', online: 'Online', paused: 'Pause', offline: 'Offline' };
export function stateLabel(state) {
  return STATE_LABELS[state] || state;
}

// Renders a player's profile picture if they set one, falling back to the
// existing color-dot avatar otherwise. `player` just needs `color` and
// optionally `avatar`; accepts a partial object so callers with only an
// enriched (playerColor-style) payload can pass `{ color: p.playerColor }`.
export function avatarHtml(player, size = 32) {
  const color = escapeHtml((player && player.color) || 'var(--text-muted)');
  if (player && player.avatar) {
    return `<img class="avatar-img" src="${escapeHtml(player.avatar)}" alt="" style="width:${size}px;height:${size}px;" />`;
  }
  return `<span class="avatar-dot" style="background:${color};width:${size}px;height:${size}px;"></span>`;
}

// Seat-neighbor conflict marker for a team-draw player row (FR-18
// extension): always renders the icon slot, just hidden via visibility when
// there's no conflict, so the rating/select that follows never shifts
// left/right depending on which rows happen to have a conflict.
export function seatConflictIconHtml(player) {
  const names = player?.seatConflictNames;
  const hasConflict = !!player?.seatConflict;
  const title = hasConflict
    ? `Spielt gegen Sitznachbar${names?.length > 1 ? 'n' : ''}: ${names.map(escapeHtml).join(', ')}`
    : '';
  return `<span role="img" aria-label="${title}" title="${title}" style="color:var(--state-paused);${hasConflict ? '' : 'visibility:hidden;'}">${icon('armchair')}</span>`;
}

// Renders the "currently running games" chip list for one live-board entry
// (shared by the Live view and the kiosk dashboard). Game artwork and emoji
// are deliberately omitted from the UI: there are not enough semantically
// strong line icons to give every title a useful symbol, and repeating a
// generic gamepad adds noise without adding information. Only distinguishes
// foreground vs. background when there's actually more than one game running
// at once *and* the player's agent sent the foreground signal at all
// (activityTracked) — with a single game, or with no signal, there's nothing
// meaningful to disambiguate, so all chips render the same as before.
export function gameChipsHtml(games, activityTracked) {
  const showForeground = activityTracked && games.length > 1;
  return games
    .map((g) => {
      const isForeground = showForeground && g.foreground;
      const cls = !showForeground ? 'chip' : isForeground ? 'chip chip-foreground' : 'chip chip-background';
      const tag = isForeground ? ' <strong>· aktiv</strong>' : '';
      return `<span class="${cls}">${escapeHtml(g.game_name)} · ${formatSince(g.since)}${tag}</span>`;
    })
    .join('');
}
