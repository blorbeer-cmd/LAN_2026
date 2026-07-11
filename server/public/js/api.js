// Fetch wrapper: attaches the shared access token (if any) and normalizes
// errors so callers always get either parsed JSON or a thrown Error with the
// server's German error message.

const TOKEN_KEY = 'lan2026_access_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export async function apiFetch(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  const token = getToken();
  if (token) headers['x-access-token'] = token;
  // Attach the admin PIN (set once on admin unlock) so admin-gated writes —
  // e.g. granting admin — pass the server's requireAdmin check. Absent in
  // open/dev mode, where the server allows it anyway.
  const adminPin = localStorage.getItem('lan2026_admin_pin');
  if (adminPin) headers['x-admin-pin'] = adminPin;

  const res = await fetch(path, { ...options, headers });

  if (res.status === 204) return null;

  let body = null;
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
  }

  if (!res.ok) {
    const message = (body && body.error) || `Fehler ${res.status}`;
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return body;
}

// For endpoints that don't return JSON (e.g. the QR code SVG) — apiFetch
// always tries to JSON.parse the body, which would silently swallow a
// non-JSON response. Still attaches the access token like apiFetch does.
export async function fetchText(path) {
  const headers = {};
  const token = getToken();
  if (token) headers['x-access-token'] = token;
  const res = await fetch(path, { headers });
  const text = await res.text();
  if (!res.ok) {
    let message = `Fehler ${res.status}`;
    try {
      message = JSON.parse(text).error || message;
    } catch {
      // body wasn't JSON either; keep the generic message
    }
    throw new Error(message);
  }
  return text;
}

// For binary downloads (the personalized agent ZIP): needs the access token
// attached like every other call, but must hand back a Blob (with its
// filename) instead of trying to JSON.parse it, and read the server's error
// JSON on failure the same way fetchText does.
export async function fetchBlob(path) {
  const headers = {};
  const token = getToken();
  if (token) headers['x-access-token'] = token;
  const res = await fetch(path, { headers });
  if (!res.ok) {
    let message = `Fehler ${res.status}`;
    try {
      message = (await res.json()).error || message;
    } catch {
      // body wasn't JSON either; keep the generic message
    }
    throw new Error(message);
  }
  const disposition = res.headers.get('content-disposition') || '';
  const match = disposition.match(/filename="([^"]+)"/);
  return { blob: await res.blob(), filename: match ? match[1] : 'download' };
}

export const api = {
  meta: () => apiFetch('/api/meta'),

  players: {
    list: () => apiFetch('/api/players'),
    get: (id) => apiFetch(`/api/players/${id}`),
    create: (data) => apiFetch('/api/players', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => apiFetch(`/api/players/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    remove: (id) => apiFetch(`/api/players/${id}`, { method: 'DELETE' }),
    stats: (id, params = {}) => {
      const qs = new URLSearchParams(params).toString();
      return apiFetch(`/api/players/${id}/stats${qs ? `?${qs}` : ''}`);
    },
    neighbors: (id) => apiFetch(`/api/players/${id}/neighbors`),
    setNeighbors: (id, neighborIds) =>
      apiFetch(`/api/players/${id}/neighbors`, { method: 'PUT', body: JSON.stringify({ neighborIds }) }),
  },

  games: {
    list: () => apiFetch('/api/games'),
    create: (data) => apiFetch('/api/games', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => apiFetch(`/api/games/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    remove: (id) => apiFetch(`/api/games/${id}`, { method: 'DELETE' }),
    promote: (id) => apiFetch(`/api/games/${id}/promote`, { method: 'POST' }),
    addProcess: (id, processName) =>
      apiFetch(`/api/games/${id}/processes`, { method: 'POST', body: JSON.stringify({ processName }) }),
    removeProcess: (id, processName) =>
      apiFetch(`/api/games/${id}/processes/${encodeURIComponent(processName)}`, { method: 'DELETE' }),
  },

  skills: {
    list: (params = {}) => {
      const qs = new URLSearchParams(params).toString();
      return apiFetch(`/api/skills${qs ? `?${qs}` : ''}`);
    },
    set: (playerId, gameId, rating) =>
      apiFetch('/api/skills', { method: 'PUT', body: JSON.stringify({ playerId, gameId, rating }) }),
    suggestions: () => apiFetch('/api/skills/suggestions'),
  },

  preferences: {
    list: (params = {}) => {
      const qs = new URLSearchParams(params).toString();
      return apiFetch(`/api/preferences${qs ? `?${qs}` : ''}`);
    },
    set: (playerId, gameId, rating) =>
      apiFetch('/api/preferences', { method: 'PUT', body: JSON.stringify({ playerId, gameId, rating }) }),
  },

  live: {
    board: () => apiFetch('/api/live'),
    setNote: (playerId, note) =>
      apiFetch(`/api/live/${playerId}/note`, { method: 'POST', body: JSON.stringify({ note }) }),
  },

  matchmaking: {
    generate: (data) => apiFetch('/api/matchmaking', { method: 'POST', body: JSON.stringify(data) }),
    history: (gameId) => apiFetch(`/api/matchmaking/history${gameId ? `?gameId=${gameId}` : ''}`),
    moveDrawPlayer: (drawId, playerId, toTeamIndex) =>
      apiFetch(`/api/matchmaking/draws/${drawId}/move`, {
        method: 'PATCH',
        body: JSON.stringify({ playerId, toTeamIndex }),
      }),
  },

  votes: {
    get: () => apiFetch('/api/votes'),
    mine: (playerId) => apiFetch(`/api/votes/mine?playerId=${encodeURIComponent(playerId)}`),
    history: () => apiFetch('/api/votes/history'),
    historyRound: (round) => apiFetch(`/api/votes/history/${round}`),
    start: (options = {}) => apiFetch('/api/votes/start', { method: 'POST', body: JSON.stringify(options) }),
    cast: (playerId, gameId) =>
      apiFetch('/api/votes', { method: 'POST', body: JSON.stringify({ playerId, gameId }) }),
    castPoints: (playerId, entries) =>
      apiFetch('/api/votes/points', { method: 'POST', body: JSON.stringify({ playerId, entries }) }),
    close: () => apiFetch('/api/votes/close', { method: 'POST' }),
    cancel: () => apiFetch('/api/votes/cancel', { method: 'POST' }),
  },

  matches: {
    list: (params = {}) => {
      const qs = new URLSearchParams(params).toString();
      return apiFetch(`/api/matches${qs ? `?${qs}` : ''}`);
    },
    create: (data) => apiFetch('/api/matches', { method: 'POST', body: JSON.stringify(data) }),
    remove: (id) => apiFetch(`/api/matches/${id}`, { method: 'DELETE' }),
  },

  leaderboard: {
    get: (gameId) => apiFetch(`/api/leaderboard${gameId ? `?gameId=${gameId}` : ''}`),
  },

  stats: {
    playtime: (gameId) => apiFetch(`/api/stats/playtime${gameId ? `?gameId=${gameId}` : ''}`),
  },

  analytics: {
    overview: (params = {}) => {
      const qs = new URLSearchParams(params).toString();
      return apiFetch(`/api/analytics/overview${qs ? `?${qs}` : ''}`);
    },
    sessions: (params = {}) => {
      const qs = new URLSearchParams(params).toString();
      return apiFetch(`/api/analytics/sessions${qs ? `?${qs}` : ''}`);
    },
    concurrency: (params) => {
      const qs = new URLSearchParams(params).toString();
      return apiFetch(`/api/analytics/concurrency?${qs}`);
    },
    awards: (params = {}) => {
      const qs = new URLSearchParams(params).toString();
      return apiFetch(`/api/analytics/awards${qs ? `?${qs}` : ''}`);
    },
    games: (params = {}) => {
      const qs = new URLSearchParams(params).toString();
      return apiFetch(`/api/analytics/games${qs ? `?${qs}` : ''}`);
    },
    gamesTournaments: (params = {}) => {
      const qs = new URLSearchParams(params).toString();
      return apiFetch(`/api/analytics/games-tournaments${qs ? `?${qs}` : ''}`);
    },
  },

  events: {
    list: () => apiFetch('/api/events'),
    active: () => apiFetch('/api/events/active'),
    // data: { name, startsAt, endsAt, location?, description? }
    create: (data) => apiFetch('/api/events', { method: 'POST', body: JSON.stringify(data) }),
    // fields: any subset of { name?, startsAt?, endsAt?, location?, description? }
    update: (id, fields) => apiFetch(`/api/events/${id}`, { method: 'PATCH', body: JSON.stringify(fields) }),
    startTracking: (id) => apiFetch(`/api/events/${id}/tracking/start`, { method: 'POST' }),
    stopTracking: (id) => apiFetch(`/api/events/${id}/tracking/stop`, { method: 'POST' }),
    end: (id) => apiFetch(`/api/events/${id}/end`, { method: 'POST' }),
    setParticipants: (id, playerIds) =>
      apiFetch(`/api/events/${id}/participants`, { method: 'PUT', body: JSON.stringify({ playerIds }) }),
  },

  tournaments: {
    list: () => apiFetch('/api/tournaments'),
    get: (id) => apiFetch(`/api/tournaments/${id}`),
    create: (data) => apiFetch('/api/tournaments', { method: 'POST', body: JSON.stringify(data) }),
    // payload is either { winnerTeamId } (win/loss-only tournaments) or
    // { scoreA, scoreB } (score-tracking tournaments) — the server derives
    // the winner itself in the latter case.
    recordResult: (tournamentId, matchId, payload) =>
      apiFetch(`/api/tournaments/${tournamentId}/matches/${matchId}/result`, {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    remove: (id) => apiFetch(`/api/tournaments/${id}`, { method: 'DELETE' }),
  },

  qrcode: {
    svg: (text) => fetchText(`/api/qrcode?text=${encodeURIComponent(text)}`),
  },

  quiz: {
    questions: () => apiFetch('/api/quiz/questions'),
    createQuestion: (data) => apiFetch('/api/quiz/questions', { method: 'POST', body: JSON.stringify(data) }),
    updateQuestion: (id, data) => apiFetch(`/api/quiz/questions/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    removeQuestion: (id) => apiFetch(`/api/quiz/questions/${id}`, { method: 'DELETE' }),
  },

  arcade: {
    stats: () => apiFetch('/api/arcade/stats'),
  },

  export: {
    snapshot: (eventId) => apiFetch(`/api/export${eventId ? `?eventId=${eventId}` : ''}`),
    pdf: (eventId) => fetchBlob(`/api/export/pdf${eventId ? `?eventId=${eventId}` : ''}`),
  },

  backup: {
    download: () => fetchBlob('/api/backup'),
  },

  hallOfFame: {
    get: () => apiFetch('/api/hall-of-fame'),
  },

  seating: {
    get: () => apiFetch('/api/seating'),
    layout: () => apiFetch('/api/seating/layout'),
    saveLayout: (layout) => apiFetch('/api/seating/layout', { method: 'PUT', body: JSON.stringify(layout) }),
  },

  digest: {
    get: (playerId) => apiFetch(`/api/digest?playerId=${encodeURIComponent(playerId)}`),
  },

  push: {
    vapidPublicKey: () => apiFetch('/api/push/vapid-public-key'),
    subscribe: (playerId, subscription) =>
      apiFetch('/api/push/subscribe', { method: 'POST', body: JSON.stringify({ playerId, subscription }) }),
    unsubscribe: (endpoint) => apiFetch('/api/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint }) }),
    last: () => apiFetch('/api/push/last'),
    log: (playerId) => apiFetch(`/api/push/log?playerId=${encodeURIComponent(playerId)}`),
  },

  agent: {
    download: (playerId, trackActivity) =>
      fetchBlob(`/api/agent-download?playerId=${encodeURIComponent(playerId)}${trackActivity ? '&trackActivity=1' : ''}`),
  },

  draft: {
    get: () => apiFetch('/api/draft'),
    start: (data) => apiFetch('/api/draft/start', { method: 'POST', body: JSON.stringify(data) }),
    pick: (playerId, pickPlayerId) =>
      apiFetch('/api/draft/pick', { method: 'POST', body: JSON.stringify({ playerId, pickPlayerId }) }),
    cancel: () => apiFetch('/api/draft/cancel', { method: 'POST' }),
  },

  broadcasts: {
    list: () => apiFetch('/api/broadcasts'),
    send: (playerId, message) =>
      apiFetch('/api/broadcasts', { method: 'POST', body: JSON.stringify({ playerId, message }) }),
  },

  info: {
    list: () => apiFetch('/api/info'),
    create: (data) => apiFetch('/api/info', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => apiFetch(`/api/info/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    remove: (id) => apiFetch(`/api/info/${id}`, { method: 'DELETE' }),
  },

  admin: {
    status: () => apiFetch('/api/admin/status'),
    unlock: (pin) => apiFetch('/api/admin/unlock', { method: 'POST', body: JSON.stringify({ pin }) }),
    agentDiagnostics: () => apiFetch('/api/admin/agent-diagnostics'),
  },

  foodOrders: {
    list: () => apiFetch('/api/food-orders'),
    create: (playerId, title, { sendAt, notes, link } = {}) =>
      apiFetch('/api/food-orders', { method: 'POST', body: JSON.stringify({ playerId, title, sendAt, notes, link }) }),
    updateDetails: (orderId, { sendAt, notes, link }) =>
      apiFetch(`/api/food-orders/${orderId}`, { method: 'PATCH', body: JSON.stringify({ sendAt, notes, link }) }),
    addItem: (orderId, data) =>
      apiFetch(`/api/food-orders/${orderId}/items`, { method: 'POST', body: JSON.stringify(data) }),
    removeItem: (orderId, itemId, playerId) =>
      apiFetch(`/api/food-orders/${orderId}/items/${itemId}`, {
        method: 'DELETE',
        body: JSON.stringify({ playerId }),
      }),
    close: (orderId) => apiFetch(`/api/food-orders/${orderId}/close`, { method: 'POST' }),
  },

  arrivals: {
    list: () => apiFetch('/api/arrivals'),
    saveMine: (data) => apiFetch('/api/arrivals/mine', { method: 'PUT', body: JSON.stringify(data) }),
    createCarpool: (data) => apiFetch('/api/arrivals/carpools', { method: 'POST', body: JSON.stringify(data) }),
    editCarpool: (id, data) => apiFetch(`/api/arrivals/carpools/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    joinCarpool: (id, playerId) =>
      apiFetch(`/api/arrivals/carpools/${id}/join`, { method: 'POST', body: JSON.stringify({ playerId }) }),
    leaveCarpool: (id, playerId) =>
      apiFetch(`/api/arrivals/carpools/${id}/leave`, { method: 'POST', body: JSON.stringify({ playerId }) }),
    removeCarpool: (id, playerId) =>
      apiFetch(`/api/arrivals/carpools/${id}`, { method: 'DELETE', body: JSON.stringify({ playerId }) }),
  },
};
