// Account-scoped presentation preference for wide browser windows. The
// storage key includes the verified account id, so shared LAN devices keep
// each person's choice across logout without leaking it to the next login.

export const LAYOUT_MODES = Object.freeze({ auto: 'auto', desktop: 'desktop', laptop: 'laptop' });
export const DEFAULT_LAYOUT_MODE = LAYOUT_MODES.auto;

const STORAGE_PREFIX = 'respawn_layout_mode:';

export function layoutModeStorageKey(playerId) {
  return `${STORAGE_PREFIX}${playerId}`;
}

function browserStorage() {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

export function layoutModeForPlayer(playerId, { storage = browserStorage() } = {}) {
  if (!playerId || !storage) return DEFAULT_LAYOUT_MODE;
  try {
    const stored = storage.getItem(layoutModeStorageKey(playerId));
    return Object.values(LAYOUT_MODES).includes(stored) ? stored : DEFAULT_LAYOUT_MODE;
  } catch {
    return DEFAULT_LAYOUT_MODE;
  }
}

export function resolvedLayoutMode(preference, { wide = globalThis.matchMedia?.('(min-width: 1280px)').matches ?? false } = {}) {
  if (preference === LAYOUT_MODES.auto) return wide ? LAYOUT_MODES.desktop : LAYOUT_MODES.laptop;
  return preference === LAYOUT_MODES.desktop ? LAYOUT_MODES.desktop : LAYOUT_MODES.laptop;
}

export function setLayoutModeForPlayer(playerId, mode, {
  storage = browserStorage(),
  root = globalThis.document?.documentElement ?? null,
  wide,
} = {}) {
  const normalized = Object.values(LAYOUT_MODES).includes(mode) ? mode : DEFAULT_LAYOUT_MODE;
  if (playerId && storage) {
    try {
      storage.setItem(layoutModeStorageKey(playerId), normalized);
    } catch {
      // A blocked localStorage must not prevent changing the current layout.
    }
  }
  if (root) {
    root.dataset.layoutPreference = normalized;
    root.dataset.layoutMode = resolvedLayoutMode(normalized, { wide });
  }
  return normalized;
}

export function applyLayoutModeForPlayer(playerId, options = {}) {
  return setLayoutModeForPlayer(playerId, layoutModeForPlayer(playerId, options), options);
}
