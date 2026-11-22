const LOCAL_CONTROLLER_URL = 'http://127.0.0.1:43821';
const SPOTIFY_SDK_URL = 'https://sdk.scdn.co/spotify-player.js';
const LOCAL_PROBE_TIMEOUT_MS = 1_000;
const PLAYER_READY_TIMEOUT_MS = 15_000;
// The SDK often fires several state events for one change. Only the last one
// within this window is reported to the local controller.
const STATE_REPORT_DELAY_MS = 300;

let sdkPromise = null;
let playerPromise = null;
let player = null;
let playerInfo = null;
let latestTokenError = null;
let pendingStateReport = null;

async function responseJson(response) {
  return response.json().catch(() => ({}));
}

async function fetchLocalJson(pathname, { fetchImpl = globalThis.fetch, timeoutMs = LOCAL_PROBE_TIMEOUT_MS } = {}) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${LOCAL_CONTROLLER_URL}${pathname}`, {
      cache: 'no-store',
      signal: abort.signal,
    });
    const data = await responseJson(response);
    if (!response.ok) throw new Error(data.error || `Lokaler Jam-Controller antwortet mit ${response.status}.`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export async function localSpotifyPlaybackStatus(options = {}) {
  try {
    const data = await fetchLocalJson('/web-player/status', options);
    if (data?.available !== true || typeof data.playerName !== 'string') return null;
    return {
      available: true,
      ready: data.ready === true,
      playerName: data.playerName,
      message: typeof data.message === 'string' ? data.message : null,
    };
  } catch {
    // Most clients are phones or laptops without the local controller. Its
    // absence is therefore an expected capability check, not an app error.
    return null;
  }
}

export async function waitForLocalSpotifyPlaybackReady({
  status = localSpotifyPlaybackStatus,
  attempts = 60,
  intervalMs = 2_000,
  delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
} = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const localPlayback = await status();
    if (localPlayback?.ready) return localPlayback;
    if (attempt < attempts - 1) await delay(intervalMs);
  }
  return null;
}

async function localSpotifyToken() {
  const data = await fetchLocalJson('/web-player/token', { timeoutMs: 10_000 });
  if (typeof data.accessToken !== 'string' || !data.accessToken) {
    throw new Error('Der lokale Jam-Controller hat keinen Spotify-Zugriffstoken geliefert.');
  }
  return data.accessToken;
}

export function preloadSpotifyPlaybackSdk() {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return Promise.reject(new Error('Spotify-Browser-Wiedergabe ist nur im Browser verfügbar.'));
  }
  if (window.Spotify?.Player) return Promise.resolve(window.Spotify);
  if (sdkPromise) return sdkPromise;

  sdkPromise = new Promise((resolve, reject) => {
    let settled = false;
    let script = null;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sdkPromise = null;
      script?.remove();
      reject(error);
    };
    const previousReady = window.onSpotifyWebPlaybackSDKReady;
    const finish = () => {
      if (settled) return;
      if (!window.Spotify?.Player) {
        fail(new Error('Spotify Web Playback SDK wurde nicht vollständig geladen.'));
        return;
      }
      settled = true;
      clearTimeout(timer);
      try { if (typeof previousReady === 'function') previousReady(); } catch { /* unrelated callback */ }
      resolve(window.Spotify);
    };
    const timer = setTimeout(
      () => fail(new Error('Spotify Web Playback SDK konnte nicht rechtzeitig geladen werden.')),
      PLAYER_READY_TIMEOUT_MS,
    );
    window.onSpotifyWebPlaybackSDKReady = finish;

    script = document.querySelector('script[data-respawn-spotify-sdk]');
    if (!script) {
      script = document.createElement('script');
      script.src = SPOTIFY_SDK_URL;
      script.async = true;
      script.dataset.respawnSpotifySdk = 'true';
      document.body.appendChild(script);
    }
    script.addEventListener('error', () => fail(new Error('Spotify Web Playback SDK konnte nicht geladen werden.')), { once: true });
  });
  return sdkPromise;
}

// Keeps only what Respawn shows. The local controller reports it to Respawn
// instead of asking Spotify, which saves requests against Spotify's quota.
export function browserPlaybackReport(deviceId, state, now = Date.now(), receivedAt = now) {
  if (!state) return { deviceId, state: null };
  const track = state.track_window?.current_track;
  if (!track?.uri) return { deviceId, state: null };
  const isPlaying = !state.paused;
  const progressMs = Number(state.position || 0) + (isPlaying ? Math.max(0, now - receivedAt) : 0);
  return {
    deviceId,
    state: {
      track: {
        uri: track.uri,
        name: track.name || '',
        artists: (track.artists || []).map((artist) => artist?.name).filter(Boolean),
        album: track.album?.name || '',
        imageUrl: track.album?.images?.[0]?.url || null,
        durationMs: Number(track.duration_ms || state.duration || 0),
      },
      contextUri: state.context?.uri || null,
      isPlaying,
      progressMs,
    },
  };
}

function reportPlayerState(state) {
  const deviceId = playerInfo?.deviceId;
  if (!deviceId) return;
  if (pendingStateReport) clearTimeout(pendingStateReport);
  const receivedAt = Date.now();
  pendingStateReport = setTimeout(() => {
    pendingStateReport = null;
    // Best effort: without the report the controller still asks Spotify.
    globalThis.fetch(`${LOCAL_CONTROLLER_URL}/web-player/state`, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(browserPlaybackReport(deviceId, state, Date.now(), receivedAt)),
    }).catch(() => {});
  }, STATE_REPORT_DELAY_MS);
}

function resetPlayer() {
  const disconnectedPlayer = player;
  player = null;
  playerInfo = null;
  playerPromise = null;
  try { disconnectedPlayer?.disconnect(); } catch { /* already disconnected */ }
}

export function localSpotifyPlayerInfo() {
  return playerInfo;
}

export function localSpotifySessionNeedsRecovery(session, localPlayback, info = playerInfo) {
  return Boolean(
    session &&
    localPlayback?.ready &&
    session.deviceName === localPlayback.playerName &&
    session.deviceId !== info?.deviceId,
  );
}

export async function connectLocalSpotifyPlayer({ name = 'Respawn · Browser' } = {}) {
  if (playerInfo) {
    if (typeof player?.activateElement === 'function') await player.activateElement();
    return playerInfo;
  }
  if (playerPromise) return playerPromise;

  latestTokenError = null;
  const pendingPlayer = (async () => {
    const Spotify = await preloadSpotifyPlaybackSdk();
    player = new Spotify.Player({
      name,
      enableMediaSession: true,
      getOAuthToken: (callback) => {
        localSpotifyToken()
          .then((token) => {
            latestTokenError = null;
            callback(token);
          })
          .catch((error) => {
            latestTokenError = error;
            callback('');
          });
      },
    });

    if (typeof player.activateElement === 'function') {
      await player.activateElement().catch(() => {});
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      const finishError = (message) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const error = latestTokenError || new Error(message);
        resetPlayer();
        reject(error);
      };
      const handleFatalError = (message) => {
        if (settled) resetPlayer();
        else finishError(message);
      };
      const timer = setTimeout(
        () => finishError('Spotify-Browser-Wiedergabe wurde nicht rechtzeitig bereit.'),
        PLAYER_READY_TIMEOUT_MS,
      );

      player.addListener('ready', ({ device_id: deviceId }) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        playerInfo = { deviceId, name };
        resolve(playerInfo);
      });
      player.addListener('player_state_changed', (state) => reportPlayerState(state));
      player.addListener('not_ready', () => {
        if (!settled) finishError('Spotify-Browser-Wiedergabe ist nicht erreichbar.');
        else resetPlayer();
      });
      player.addListener('initialization_error', ({ message }) => handleFatalError(`Spotify konnte im Browser nicht initialisiert werden: ${message}`));
      player.addListener('authentication_error', ({ message }) => handleFatalError(`Spotify-Anmeldung für den Browser fehlgeschlagen: ${message}`));
      player.addListener('account_error', () => handleFatalError('Browser-Wiedergabe benötigt ein Spotify-Premium-Konto.'));

      Promise.resolve(player.connect()).then((connected) => {
        if (!connected) finishError('Spotify-Browser-Wiedergabe konnte keine Verbindung herstellen.');
      }).catch((error) => finishError(error.message));
    });
  })();
  playerPromise = pendingPlayer;
  pendingPlayer.catch(() => {
    if (playerPromise === pendingPlayer) playerPromise = null;
  });

  return pendingPlayer;
}

export { LOCAL_CONTROLLER_URL };
