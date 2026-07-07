// Small formatting/escaping helpers shared by every view.

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

// Small round badge carrying a game's icon on a tinted background — the
// "little design that fits the game" reused in every list/chip that
// mentions one.
export function gameBadgeHtml(game, size = 28) {
  if (!game) return '';
  const color = gameColor(game.id);
  const fontSize = Math.round(size * 0.55);
  return `<span class="game-badge" style="background:${color};width:${size}px;height:${size}px;font-size:${fontSize}px;">${escapeHtml(game.icon)}</span>`;
}
