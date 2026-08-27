const TARGET_VIEWS = new Set(['foodOrders', 'eventPolls']);

function decodeSegment(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

// Hashes are intentionally limited to browser-visible UI state. API routes and
// stored ids remain unchanged; a reload can still reconstruct the exact local
// screen without coupling the server to the SPA's presentation hierarchy.
export function parseAppHash(hash) {
  const parts = String(hash || '').replace(/^#/, '').split('/');
  const view = parts[0] || null;
  const segment = parts[1] ? decodeSegment(parts[1]) : null;

  if (view === 'tournaments') {
    if (segment === 'new') return { view, localRoute: { kind: 'create' }, searchTarget: null };
    if (segment) return { view, localRoute: { kind: 'detail', id: segment }, searchTarget: null };
    return { view, localRoute: null, searchTarget: null };
  }
  if (view === 'arcade') {
    return {
      view,
      localRoute: segment ? { kind: 'game', id: segment } : null,
      searchTarget: null,
    };
  }
  if (TARGET_VIEWS.has(view)) {
    return {
      view,
      localRoute: null,
      searchTarget: segment
        ? { type: view === 'foodOrders' ? 'order' : 'poll', id: segment }
        : null,
    };
  }
  return { view, localRoute: null, searchTarget: null };
}

export function appHash(view, localRoute = null, searchTarget = null) {
  if (view === 'tournaments') {
    if (localRoute?.kind === 'create') return '#tournaments/new';
    if (localRoute?.kind === 'detail' && localRoute.id) {
      return `#tournaments/${encodeURIComponent(localRoute.id)}`;
    }
  }
  if (view === 'arcade' && localRoute?.kind === 'game' && localRoute.id) {
    return `#arcade/${encodeURIComponent(localRoute.id)}`;
  }
  if (
    TARGET_VIEWS.has(view) &&
    searchTarget?.id &&
    searchTarget.type === (view === 'foodOrders' ? 'order' : 'poll')
  ) {
    return `#${encodeURIComponent(view)}/${encodeURIComponent(searchTarget.id)}`;
  }
  return `#${encodeURIComponent(view)}`;
}

export function localRouteKey(route) {
  if (!route?.kind) return '';
  return `${route.kind}:${route.id ?? ''}`;
}
