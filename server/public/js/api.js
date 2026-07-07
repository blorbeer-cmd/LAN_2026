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

export const api = {
  meta: () => apiFetch('/api/meta'),

  players: {
    list: () => apiFetch('/api/players'),
    get: (id) => apiFetch(`/api/players/${id}`),
    create: (data) => apiFetch('/api/players', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => apiFetch(`/api/players/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    remove: (id) => apiFetch(`/api/players/${id}`, { method: 'DELETE' }),
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
  },

  votes: {
    get: () => apiFetch('/api/votes'),
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
};
