// Small formatting/escaping helpers shared by every view.

import { state } from './state.js';

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
  const color = escapeHtml((player && player.color) || '#999999');
  if (player && player.avatar) {
    return `<img class="avatar-img" src="${escapeHtml(player.avatar)}" alt="" style="width:${size}px;height:${size}px;" />`;
  }
  return `<span class="avatar-dot" style="background:${color};width:${size}px;height:${size}px;"></span>`;
}

// Deterministic accent color per game (hashed from its id), so every game
// gets a stable little visual identity across the app without anyone having
// to pick a color by hand.
export function gameColor(gameId) {
  let hash = 0;
  const s = String(gameId ?? '');
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  return `hsl(${hash % 360} 70% 45%)`;
}

// Small round badge carrying a game's icon (or, if the organizer uploaded
// one, its actual box art/logo) on a tinted background — the "little design
// that fits the game" reused in every list/chip that mentions one.
//
// Looked up fresh from state.games by id rather than trusting whatever
// fields the caller happened to have on hand (many API payloads only carry
// a flattened { id, icon } pair, not the full game row) — this way a custom
// icon_image shows up everywhere a badge appears without having to thread
// it through every endpoint that mentions a game.
export function gameBadgeHtml(game, size = 28) {
  if (!game) return '';
  const full = state.games.find((g) => g.id === game.id);
  const iconImage = full ? full.icon_image : null;
  const icon = (full && full.icon) || game.icon;

  if (iconImage) {
    return `<span class="game-badge game-badge-img" style="width:${size}px;height:${size}px;"><img src="${escapeHtml(iconImage)}" alt="" /></span>`;
  }
  const color = gameColor(game.id);
  const fontSize = Math.round(size * 0.55);
  return `<span class="game-badge" style="background:${color};width:${size}px;height:${size}px;font-size:${fontSize}px;">${escapeHtml(icon)}</span>`;
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
