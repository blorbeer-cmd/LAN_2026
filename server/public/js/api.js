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
  },

  live: {
    board: () => apiFetch('/api/live'),
    setNote: (playerId, note) =>
      apiFetch(`/api/live/${playerId}/note`, { method: 'POST', body: JSON.stringify({ note }) }),
  },

  matchmaking: {
    generate: (data) => apiFetch('/api/matchmaking', { method: 'POST', body: JSON.stringify(data) }),
    history: (gameId) => apiFetch(`/api/matchmaking/history${gameId ? `?gameId=${gameId}` : ''}`),
  },

  votes: {
    get: () => apiFetch('/api/votes'),
    history: () => apiFetch('/api/votes/history'),
    start: () => apiFetch('/api/votes/start', { method: 'POST' }),
    cast: (playerId, gameId) =>
      apiFetch('/api/votes', { method: 'POST', body: JSON.stringify({ playerId, gameId }) }),
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

  export: {
    snapshot: (eventId) => apiFetch(`/api/export${eventId ? `?eventId=${eventId}` : ''}`),
    pdf: (eventId) => fetchBlob(`/api/export/pdf${eventId ? `?eventId=${eventId}` : ''}`),
  },

  hallOfFame: {
    get: () => apiFetch('/api/hall-of-fame'),
  },

  seating: {
    get: () => apiFetch('/api/seating'),
  },

  pings: {
    list: () => apiFetch('/api/pings'),
    create: (data) => apiFetch('/api/pings', { method: 'POST', body: JSON.stringify(data) }),
    toggleInterested: (id, playerId) =>
      apiFetch(`/api/pings/${id}/interested`, { method: 'POST', body: JSON.stringify({ playerId }) }),
    remove: (id) => apiFetch(`/api/pings/${id}`, { method: 'DELETE' }),
  },

  digest: {
    get: (playerId) => apiFetch(`/api/digest?playerId=${encodeURIComponent(playerId)}`),
  },

  push: {
    vapidPublicKey: () => apiFetch('/api/push/vapid-public-key'),
    subscribe: (playerId, subscription) =>
      apiFetch('/api/push/subscribe', { method: 'POST', body: JSON.stringify({ playerId, subscription }) }),
    unsubscribe: (endpoint) => apiFetch('/api/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint }) }),
  },

  agent: {
    download: (playerId, trackActivity) =>
      fetchBlob(`/api/agent-download?playerId=${encodeURIComponent(playerId)}${trackActivity ? '&trackActivity=1' : ''}`),
  },
};
