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

const STATE_LABELS = { playing: 'Spielt', paused: 'Pause', offline: 'Offline' };
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
  return `<span title="${title}" style="color:var(--state-paused);${hasConflict ? '' : 'visibility:hidden;'}">${icon('armchair')}</span>`;
}

// Game artwork and emoji are deliberately omitted from the UI. There are not
// enough semantically strong line icons to give every title a useful symbol,
// and repeating a generic gamepad adds noise without adding information.
export function gameBadgeHtml(game, size = 28) {
  return '';
}

// Renders the "currently running games" chip list for one live-board entry
// (shared by the Live view and the kiosk dashboard). Only distinguishes
// foreground vs. background when there's actually more than one game running
// at once *and* the player's agent sent the foreground signal at all
// (activityTracked) — with a single game, or with no signal, there's nothing
// meaningful to disambiguate, so all chips render the same as before.
export function gameChipsHtml(games, activityTracked, badgeSize = 20) {
  const showForeground = activityTracked && games.length > 1;
  return games
    .map((g) => {
      const isForeground = showForeground && g.foreground;
      const cls = !showForeground ? 'chip' : isForeground ? 'chip chip-foreground' : 'chip chip-background';
      const tag = isForeground ? ' <strong>· aktiv</strong>' : '';
      return `<span class="${cls}">${gameBadgeHtml({ id: g.game_id, icon: g.game_icon }, badgeSize)} ${escapeHtml(g.game_name)} · ${formatSince(g.since)}${tag}</span>`;
    })
    .join('');
}
