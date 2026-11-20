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
    fitAutomaticDesktopRail({ root });
  }
  return normalized;
}

// Automatic prefers the laptop shell over a desktop rail whose main list would
// have to scroll; an explicit Desktop choice keeps the scrolling rail. The
// window height the rail last needed is remembered, so a window that is still
// too short decides without measuring and a taller one brings the rail back.
// The measurement runs synchronously right after the desktop marker is set, so
// the browser never paints the rejected shell in between.
let automaticRailMinHeight = 0;

export function forgetAutomaticRailFit() {
  automaticRailMinHeight = 0;
}

export function fitAutomaticDesktopRail({
  root = globalThis.document?.documentElement ?? null,
  railList = globalThis.document?.getElementById('desktop-nav-main') ?? null,
  viewportHeight = globalThis.innerHeight ?? 0,
} = {}) {
  if (!root || !railList) return;
  if (root.dataset.layoutPreference !== LAYOUT_MODES.auto || root.dataset.layoutMode !== LAYOUT_MODES.desktop) return;
  if (viewportHeight < automaticRailMinHeight) {
    root.dataset.layoutMode = LAYOUT_MODES.laptop;
    return;
  }
  // A hidden rail (app shell not shown yet) measures 0 and keeps Desktop; the
  // app re-checks once the shell and its entries are rendered. One pixel of
  // sub-pixel rounding is not a scrolling list.
  const overflow = railList.scrollHeight - railList.clientHeight;
  if (overflow > 1) {
    automaticRailMinHeight = viewportHeight + overflow;
    root.dataset.layoutMode = LAYOUT_MODES.laptop;
  }
}

export function applyLayoutModeForPlayer(playerId, options = {}) {
  return setLayoutModeForPlayer(playerId, layoutModeForPlayer(playerId, options), options);
}
