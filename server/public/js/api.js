// Fetch wrapper: attaches the dedicated kiosk credential when needed and
// normalizes errors so callers get parsed JSON or a thrown Error with the
// server's German error message.

import { filterTestUsers } from './testFilter.js';

const KIOSK_TOKEN_KEY = 'respawn_kiosk_token';
const LEGACY_KIOSK_TOKEN_KEY = 'respawn_access_token';
let kioskMode = false;
// One instance, one group: this is no longer sent as a request header (the
// server always resolves the single start group on its own) but stays as the
// client-side key for the group id used to build /api/groups/:groupId/...
// URLs (see groupContext.js, socket.js, checklist.js).
export const GROUP_KEY = 'respawn_group_id';

export function setKioskMode(enabled) {
  kioskMode = Boolean(enabled);
}

export function getKioskToken() {
  const token = localStorage.getItem(KIOSK_TOKEN_KEY);
  if (token) {
    localStorage.removeItem(LEGACY_KIOSK_TOKEN_KEY);
    return token;
  }

  // Before the auth cutover the dedicated kiosk credential shared the
  // browser key used by the removed legacy login. Move it once so already
  // configured kiosk screens keep working without reviving shared auth.
  const legacyToken = localStorage.getItem(LEGACY_KIOSK_TOKEN_KEY);
  if (!legacyToken) return '';
  localStorage.setItem(KIOSK_TOKEN_KEY, legacyToken);
  localStorage.removeItem(LEGACY_KIOSK_TOKEN_KEY);
  return legacyToken;
}

export function setKioskToken(token) {
  localStorage.setItem(KIOSK_TOKEN_KEY, token);
  localStorage.removeItem(LEGACY_KIOSK_TOKEN_KEY);
}

export async function apiFetch(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (kioskMode) {
    const token = getKioskToken();
    if (token) headers['x-access-token'] = token;
    headers['x-kiosk-mode'] = '1';
  }
  // Tells the server this device currently sees test players (admin mode).
  // Needed for replace-style writes like the seating layout: a non-admin
  // client's state has test users filtered out, so its saves must not be
  // allowed to silently unseat them (see seating.ts).
  if (localStorage.getItem('respawn_admin') === '1') headers['x-admin-mode'] = '1';

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
    err.code = body?.code;
    throw err;
  }
  // Test players are visible in admin mode only — strip them out of every
  // response centrally instead of in each view (see testFilter.js).
  return filterTestUsers(body);
}

// For endpoints that don't return JSON (e.g. the QR code SVG) — apiFetch
// always tries to JSON.parse the body, which would silently swallow a
// non-JSON response.
export async function fetchText(path) {
  const headers = {};
  if (localStorage.getItem('respawn_admin') === '1') headers['x-admin-mode'] = '1';
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

// For binary downloads (the personalized agent ZIP): hands back a Blob (with its
// filename) instead of trying to JSON.parse it, and read the server's error
// JSON on failure the same way fetchText does.
export async function fetchBlob(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body) headers['Content-Type'] = 'application/json';
  if (localStorage.getItem('respawn_admin') === '1') headers['x-admin-mode'] = '1';
  const res = await fetch(path, { ...options, headers });
  if (!res.ok) {
    let message = `Fehler ${res.status}`;
    let code;
    try {
      const body = await res.json();
      message = body.error || message;
      code = body.code;
    } catch {
      // body wasn't JSON either; keep the generic message
    }
    const error = new Error(message);
    error.status = res.status;
    error.code = code;
    throw error;
  }
  const disposition = res.headers.get('content-disposition') || '';
  const match = disposition.match(/filename="([^"]+)"/);
  return { blob: await res.blob(), filename: match ? match[1] : 'download' };
}

export const api = {
  meta: () => apiFetch('/api/meta'),
  me: () => apiFetch('/api/me'),

  onboarding: {
    get: () => apiFetch('/api/me/onboarding'),
    update: (data) => apiFetch('/api/me/onboarding', { method: 'PUT', body: JSON.stringify(data) }),
    rating: {
      start: (options = {}) => apiFetch('/api/me/onboarding/rating/start', { method: 'POST', body: JSON.stringify(options) }),
      complete: () => apiFetch('/api/me/onboarding/rating/complete', { method: 'POST' }),
      defer: () => apiFetch('/api/me/onboarding/rating/defer', { method: 'POST' }),
    },
  },

  groups: {
    list: () => apiFetch('/api/groups'),
    members: (groupId) => apiFetch(`/api/groups/${encodeURIComponent(groupId)}/members`),
    updateMember: (groupId, playerId, role) =>
      apiFetch(`/api/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(playerId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      }),
    createTestUsers: (groupId, count) =>
      apiFetch(`/api/groups/${encodeURIComponent(groupId)}/test-users`, {
        method: 'POST',
        body: JSON.stringify({ count }),
      }),
    cleanupTestUsers: (groupId) =>
      apiFetch(`/api/groups/${encodeURIComponent(groupId)}/test-users`, { method: 'DELETE' }),
  },

  // Real per-user login (see docs/KONZEPT-USER-MANAGEMENT.md).
  auth: {
    register: (data) => apiFetch('/api/auth/register', { method: 'POST', body: JSON.stringify(data) }),
    claim: (data) => apiFetch('/api/auth/claim', { method: 'POST', body: JSON.stringify(data) }),
    reset: (data) => apiFetch('/api/auth/reset', { method: 'POST', body: JSON.stringify(data) }),
    login: (data) => apiFetch('/api/auth/login', { method: 'POST', body: JSON.stringify(data) }),
    logout: () => apiFetch('/api/auth/logout', { method: 'POST' }),
    changePassword: (data) => apiFetch('/api/auth/password', { method: 'POST', body: JSON.stringify(data) }),
    reauth: (password) => apiFetch('/api/auth/reauth', { method: 'POST', body: JSON.stringify({ password }) }),
    bootstrapAccounts: (code) => apiFetch(`/api/auth/bootstrap-accounts?code=${encodeURIComponent(code)}`),
    invites: () => apiFetch('/api/auth/invites'),
    createInvite: (data) => apiFetch('/api/auth/invites', { method: 'POST', body: JSON.stringify(data) }),
    revokeInvite: (code) => apiFetch(`/api/auth/invites/${encodeURIComponent(code)}`, { method: 'DELETE' }),
    testSession: (code) => apiFetch('/api/auth/test-session', { method: 'POST', body: JSON.stringify({ code }) }),
  },

  players: {
    list: () => apiFetch('/api/players'),
    get: (id) => apiFetch(`/api/players/${id}`),
    create: (data) => apiFetch('/api/players', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => apiFetch(`/api/players/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    remove: (id) => apiFetch(`/api/players/${id}`, { method: 'DELETE' }),
    deactivate: (id) => apiFetch(`/api/players/${id}/deactivate`, { method: 'POST' }),
    reactivate: (id) => apiFetch(`/api/players/${id}/reactivate`, { method: 'POST' }),
    rotateApiKey: (id) => apiFetch(`/api/players/${id}/api-key/rotate`, { method: 'POST' }),
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
    demote: (id) => apiFetch(`/api/games/${id}/demote`, { method: 'POST' }),
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
    rematch: (data) => apiFetch('/api/matchmaking/rematch', { method: 'POST', body: JSON.stringify(data) }),
    history: (gameId) => apiFetch(`/api/matchmaking/history${gameId ? `?gameId=${gameId}` : ''}`),
    moveDrawPlayer: (drawId, playerId, toTeamIndex) =>
      apiFetch(`/api/matchmaking/draws/${drawId}/move`, {
        method: 'PATCH',
        body: JSON.stringify({ playerId, toTeamIndex }),
      }),
  },

  votes: {
    get: () => apiFetch('/api/votes'),
    kiosk: () => apiFetch('/api/votes/kiosk'),
    mine: (playerId) => apiFetch(`/api/votes/mine?playerId=${encodeURIComponent(playerId)}`),
    history: () => apiFetch('/api/votes/history'),
    historyRound: (round) => apiFetch(`/api/votes/history/${round}`),
    start: (options = {}) => apiFetch('/api/votes/start', { method: 'POST', body: JSON.stringify(options) }),
    cast: (playerId, gameId) => apiFetch('/api/votes', { method: 'POST', body: JSON.stringify({ playerId, gameId }) }),
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
    update: (id, data) => apiFetch(`/api/matches/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
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
    arcade: (params = {}) => {
      const qs = new URLSearchParams(params).toString();
      return apiFetch(`/api/analytics/arcade${qs ? `?${qs}` : ''}`);
    },
  },

  events: {
    list: () => apiFetch('/api/events'),
    get: (id) => apiFetch(`/api/events/${id}`),
    active: () => apiFetch('/api/events/active'),
    activate: (eventId) =>
      apiFetch('/api/me/active-event', { method: 'PUT', body: JSON.stringify({ eventId }) }),
    // data: { name, startsAt, endsAt, location?, description?, costCents?, accommodationCostCents?, paypalLink?, paymentDueAt? }
    create: (data) => apiFetch('/api/events', { method: 'POST', body: JSON.stringify(data) }),
    // fields: any subset of { name?, startsAt?, endsAt?, location?, description?, costCents?, accommodationCostCents?, paypalLink?, paymentDueAt? }
    update: (id, fields) => apiFetch(`/api/events/${id}`, { method: 'PATCH', body: JSON.stringify(fields) }),
    startTracking: (id) => apiFetch(`/api/events/${id}/tracking/start`, { method: 'POST' }),
    restart: (id) => apiFetch(`/api/events/${id}/restart`, { method: 'POST' }),
    stopTracking: (id) => apiFetch(`/api/events/${id}/tracking/stop`, { method: 'POST' }),
    end: (id) => apiFetch(`/api/events/${id}/end`, { method: 'POST' }),
    cancel: (id) => apiFetch(`/api/events/${id}`, { method: 'DELETE' }),
    setParticipants: (id, playerIds) =>
      apiFetch(`/api/events/${id}/participants`, { method: 'PUT', body: JSON.stringify({ playerIds }) }),
    inviteParticipant: (id, playerId) =>
      apiFetch(`/api/events/${id}/invitations`, { method: 'POST', body: JSON.stringify({ playerId }) }),
    removeParticipant: (id, playerId) =>
      apiFetch(`/api/events/${id}/participants/${playerId}`, { method: 'DELETE' }),
    setParticipantPaid: (id, playerId, paid) =>
      apiFetch(`/api/events/${id}/participants/${playerId}/payment`, {
        method: 'PATCH',
        body: JSON.stringify({ paid }),
      }),
    acceptInvitation: (id) => apiFetch(`/api/events/${id}/invitation/accept`, { method: 'POST' }),
    declineInvitation: (id) => apiFetch(`/api/events/${id}/invitation/decline`, { method: 'POST' }),
    // data: { name, location?, description? } — a draft "In Planung" event
    // with no fixed date; the date poll below is what later fixes one.
    createPlanning: (data) => apiFetch('/api/events/planning', { method: 'POST', body: JSON.stringify(data) }),
  },

  eventDatePolls: {
    list: (eventId) => apiFetch(`/api/events/${eventId}/date-polls`),
    get: (eventId, pollId) => apiFetch(`/api/events/${eventId}/date-polls/${pollId}`),
    // data: { options: [{startsOn, endsOn}], responseDueOn, note?, inviteePlayerIds? }
    create: (eventId, data) =>
      apiFetch(`/api/events/${eventId}/date-polls`, { method: 'POST', body: JSON.stringify(data) }),
    // fields: { note?, responseDueOn? }
    update: (eventId, pollId, fields) =>
      apiFetch(`/api/events/${eventId}/date-polls/${pollId}`, { method: 'PATCH', body: JSON.stringify(fields) }),
    addOption: (eventId, pollId, option) =>
      apiFetch(`/api/events/${eventId}/date-polls/${pollId}/options`, { method: 'POST', body: JSON.stringify(option) }),
    removeOption: (eventId, pollId, optionId) =>
      apiFetch(`/api/events/${eventId}/date-polls/${pollId}/options/${optionId}`, { method: 'DELETE' }),
    addInvitee: (eventId, pollId, playerId) =>
      apiFetch(`/api/events/${eventId}/date-polls/${pollId}/invitees`, { method: 'POST', body: JSON.stringify({ playerId }) }),
    removeInvitee: (eventId, pollId, playerId) =>
      apiFetch(`/api/events/${eventId}/date-polls/${pollId}/invitees/${playerId}`, { method: 'DELETE' }),
    // responses: [{ optionId, response }] — always the complete set for the round.
    submitMyResponses: (eventId, pollId, responses) =>
      apiFetch(`/api/events/${eventId}/date-polls/${pollId}/my-responses`, { method: 'PUT', body: JSON.stringify({ responses }) }),
    sendReminders: (eventId, pollId) =>
      apiFetch(`/api/events/${eventId}/date-polls/${pollId}/reminders`, { method: 'POST' }),
    close: (eventId, pollId) => apiFetch(`/api/events/${eventId}/date-polls/${pollId}/close`, { method: 'POST' }),
    reopen: (eventId, pollId, responseDueOn) =>
      apiFetch(`/api/events/${eventId}/date-polls/${pollId}/reopen`, {
        method: 'POST',
        body: JSON.stringify(responseDueOn ? { responseDueOn } : {}),
      }),
    cancel: (eventId, pollId) => apiFetch(`/api/events/${eventId}/date-polls/${pollId}/cancel`, { method: 'POST' }),
    schedule: (eventId, pollId, optionId) =>
      apiFetch(`/api/events/${eventId}/date-polls/${pollId}/schedule`, { method: 'POST', body: JSON.stringify({ optionId }) }),
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
    updateResult: (tournamentId, matchId, payload) =>
      apiFetch(`/api/tournaments/${tournamentId}/matches/${matchId}/result`, {
        method: 'PUT',
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
    updateQuestion: (id, data) =>
      apiFetch(`/api/quiz/questions/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    removeQuestion: (id) => apiFetch(`/api/quiz/questions/${id}`, { method: 'DELETE' }),
  },

  arcade: {
    stats: () => apiFetch('/api/arcade/stats'),
    lobbies: () => apiFetch('/api/arcade/lobbies'),
    scribbleGallery: () => apiFetch('/api/arcade/scribble/gallery'),
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
    unsubscribe: (endpoint) =>
      apiFetch('/api/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint }) }),
    last: () => apiFetch('/api/push/last'),
    current: (playerId) => apiFetch(`/api/push/current?playerId=${encodeURIComponent(playerId)}`),
    log: (playerId) => apiFetch(`/api/push/log?playerId=${encodeURIComponent(playerId)}`),
    seen: (id, playerId) =>
      apiFetch(`/api/push/${id}/seen`, { method: 'POST', body: JSON.stringify({ playerId }) }),
    seenAll: (playerId) =>
      apiFetch('/api/push/seen-all', { method: 'POST', body: JSON.stringify({ playerId }) }),
    hide: (id, playerId) =>
      apiFetch(`/api/push/${id}`, { method: 'DELETE', body: JSON.stringify({ playerId }) }),
    hideAll: (playerId) =>
      apiFetch('/api/push', { method: 'DELETE', body: JSON.stringify({ playerId }) }),
  },

  agent: {
    download: (playerId, trackActivity) =>
      fetchBlob(
        `/api/agent-download?playerId=${encodeURIComponent(playerId)}${trackActivity ? '&trackActivity=1' : ''}`,
      ),
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
    send: (playerId, message, endsAt) =>
      apiFetch('/api/broadcasts', { method: 'POST', body: JSON.stringify({ playerId, message, endsAt }) }),
    end: (id, playerId) =>
      apiFetch(`/api/broadcasts/${id}/end`, { method: 'POST', body: JSON.stringify({ playerId }) }),
  },

  info: {
    list: () => apiFetch('/api/info'),
    create: (data) => apiFetch('/api/info', { method: 'POST', body: JSON.stringify(data) }),
    update: (id, data) => apiFetch(`/api/info/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    remove: (id) => apiFetch(`/api/info/${id}`, { method: 'DELETE' }),
  },

  admin: {
    readiness: () => apiFetch('/api/admin/readiness'),
    players: () => apiFetch('/api/admin/players'),
    audit: (limit = 100) => apiFetch(`/api/admin/audit?limit=${limit}`),
    agentDiagnostics: () => apiFetch('/api/admin/agent-diagnostics'),
    createTestUsers: (count) => {
      const groupId = sessionStorage.getItem(GROUP_KEY);
      return groupId
        ? api.groups.createTestUsers(groupId, count)
        : apiFetch('/api/admin/test-users', { method: 'POST', body: JSON.stringify({ count }) });
    },
    seedHallOfFame: () => apiFetch('/api/admin/test-data/hall-of-fame', { method: 'POST' }),
    // The Admin panel promises to remove all marked test data, including the
    // historical Test-LAN fixtures. The group endpoint only removes players.
    cleanupTestUsers: () => apiFetch('/api/admin/test-users', { method: 'DELETE' }),
    featureUsage: (eventId) =>
      apiFetch(`/api/admin/feature-usage${eventId ? `?eventId=${encodeURIComponent(eventId)}` : ''}`),
  },

  feedback: {
    create: (data) => apiFetch('/api/feedback', { method: 'POST', body: JSON.stringify(data) }),
    list: (limit = 50) => apiFetch(`/api/feedback?limit=${limit}`),
  },

  foodOrders: {
    list: (orderId = null) => apiFetch(`/api/food-orders${orderId ? `?orderId=${encodeURIComponent(orderId)}` : ''}`),
    create: (playerId, title, { sendAt, notes, link, paypalLink, tipPercent } = {}) =>
      apiFetch('/api/food-orders', {
        method: 'POST',
        body: JSON.stringify({ playerId, title, sendAt, notes, link, paypalLink, tipPercent }),
      }),
    updateDetails: (orderId, { sendAt, notes, link, paypalLink, tipPercent }) =>
      apiFetch(`/api/food-orders/${orderId}`, {
        method: 'PATCH',
        body: JSON.stringify({ sendAt, notes, link, paypalLink, tipPercent }),
      }),
    remove: (orderId) => apiFetch(`/api/food-orders/${orderId}`, { method: 'DELETE' }),
    addItem: (orderId, data) =>
      apiFetch(`/api/food-orders/${orderId}/items`, { method: 'POST', body: JSON.stringify(data) }),
    removeItem: (orderId, itemId, playerId) =>
      apiFetch(`/api/food-orders/${orderId}/items/${itemId}`, {
        method: 'DELETE',
        body: JSON.stringify({ playerId }),
      }),
    setItemPaid: (orderId, itemId, paid) =>
      apiFetch(`/api/food-orders/${orderId}/items/${itemId}`, {
        method: 'PATCH',
        body: JSON.stringify({ paid }),
      }),
    setGroupPaid: (orderId, itemIds, paid) =>
      apiFetch(`/api/food-orders/${orderId}/items/bulk-paid`, {
        method: 'PATCH',
        body: JSON.stringify({ itemIds, paid }),
      }),
    close: (orderId) => apiFetch(`/api/food-orders/${orderId}/close`, { method: 'POST' }),
    reopen: (orderId) => apiFetch(`/api/food-orders/${orderId}/reopen`, { method: 'POST' }),
    finalize: (orderId) => apiFetch(`/api/food-orders/${orderId}/finalize`, { method: 'POST' }),
  },

  checklist: {
    items: (playerId) => apiFetch(`/api/checklist/items?playerId=${encodeURIComponent(playerId)}`),
    addItem: (playerId, label) =>
      apiFetch('/api/checklist/items', { method: 'POST', body: JSON.stringify({ playerId, label }) }),
    setItemChecked: (itemId, playerId, checked) =>
      apiFetch(`/api/checklist/items/${itemId}`, { method: 'PATCH', body: JSON.stringify({ playerId, checked }) }),
    removeItem: (itemId, playerId) =>
      apiFetch(`/api/checklist/items/${itemId}`, { method: 'DELETE', body: JSON.stringify({ playerId }) }),
    tasks: () => apiFetch('/api/checklist/tasks'),
    createRequest: (playerId, title, description, assigneePlayerIds, dueAt) =>
      apiFetch('/api/checklist/tasks', {
        method: 'POST',
        body: JSON.stringify({ playerId, title, description, assigneePlayerIds, dueAt }),
      }),
    createTodo: (playerId, title, description, assigneePlayerIds, dueAt) =>
      apiFetch('/api/checklist/tasks/todo', {
        method: 'POST',
        body: JSON.stringify({ playerId, title, description, assigneePlayerIds, dueAt }),
      }),
    claim: (taskId, playerId, comment) =>
      apiFetch(`/api/checklist/tasks/${taskId}/claim`, { method: 'POST', body: JSON.stringify({ playerId, comment }) }),
    release: (taskId, playerId) =>
      apiFetch(`/api/checklist/tasks/${taskId}/release`, { method: 'POST', body: JSON.stringify({ playerId }) }),
    setDone: (taskId, playerId) =>
      apiFetch(`/api/checklist/tasks/${taskId}/done`, { method: 'PATCH', body: JSON.stringify({ playerId }) }),
    cancel: (taskId, playerId) =>
      apiFetch(`/api/checklist/tasks/${taskId}`, { method: 'DELETE', body: JSON.stringify({ playerId }) }),
  },

  arrivals: {
    list: () => apiFetch('/api/arrivals'),
    saveMine: (data) => apiFetch('/api/arrivals/mine', { method: 'PUT', body: JSON.stringify(data) }),
    createCarpool: (data) => apiFetch('/api/arrivals/carpools', { method: 'POST', body: JSON.stringify(data) }),
    editCarpool: (id, data) =>
      apiFetch(`/api/arrivals/carpools/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    joinCarpool: (id, playerId) =>
      apiFetch(`/api/arrivals/carpools/${id}/join`, { method: 'POST', body: JSON.stringify({ playerId }) }),
    leaveCarpool: (id, playerId) =>
      apiFetch(`/api/arrivals/carpools/${id}/leave`, { method: 'POST', body: JSON.stringify({ playerId }) }),
    removeCarpool: (id, playerId) =>
      apiFetch(`/api/arrivals/carpools/${id}`, { method: 'DELETE', body: JSON.stringify({ playerId }) }),
  },

  music: {
    status: () => apiFetch('/api/music/status'),
    controllerPackage: (playerId, pairingCode) =>
      fetchBlob('/api/music/controller-package', {
        method: 'POST',
        body: JSON.stringify({ playerId, pairingCode }),
      }),
    createPairing: (playerId) =>
      apiFetch('/api/music/pairing', { method: 'POST', body: JSON.stringify({ playerId }) }),
    disconnectController: (playerId) =>
      apiFetch('/api/music/controller', { method: 'DELETE', body: JSON.stringify({ playerId }) }),
    devices: () => apiFetch('/api/music/devices'),
    start: (playerId, deviceId) =>
      apiFetch('/api/music/sessions', { method: 'POST', body: JSON.stringify({ playerId, deviceId }) }),
    search: (query) => apiFetch(`/api/music/search?q=${encodeURIComponent(query)}`),
    playPlaylist: (playerId, playlistId) =>
      apiFetch(`/api/music/playlists/${encodeURIComponent(playlistId)}/play`, {
        method: 'POST', body: JSON.stringify({ playerId }),
      }),
    request: (playerId, trackId) =>
      apiFetch('/api/music/requests', { method: 'POST', body: JSON.stringify({ playerId, trackId }) }),
    removeRequest: (playerId, requestId) =>
      apiFetch(`/api/music/requests/${requestId}`, { method: 'DELETE', body: JSON.stringify({ playerId }) }),
    reorder: (playerId, requestIds) =>
      apiFetch('/api/music/requests/order', { method: 'PUT', body: JSON.stringify({ playerId, requestIds }) }),
    skip: (playerId) => apiFetch('/api/music/skip', { method: 'POST', body: JSON.stringify({ playerId }) }),
    setPlaying: (playerId, playing) =>
      apiFetch('/api/music/playback', { method: 'POST', body: JSON.stringify({ playerId, playing }) }),
    end: (playerId) => apiFetch('/api/music/end', { method: 'POST', body: JSON.stringify({ playerId }) }),
    kiosk: () => apiFetch('/api/music/kiosk'),
  },
};
