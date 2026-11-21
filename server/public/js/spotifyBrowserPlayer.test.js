import assert from 'node:assert/strict';
import test from 'node:test';
import {
  browserPlaybackReport,
  connectLocalSpotifyPlayer,
  localSpotifyPlaybackStatus,
  localSpotifySessionNeedsRecovery,
  preloadSpotifyPlaybackSdk,
  waitForLocalSpotifyPlaybackReady,
} from './spotifyBrowserPlayer.js';

test('local Spotify playback capability validates the controller response', async () => {
  const requests = [];
  const status = await localSpotifyPlaybackStatus({
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        json: async () => ({
          available: true,
          ready: true,
          playerName: 'Respawn · TV-Musik-PC',
          message: null,
        }),
      };
    },
  });

  assert.deepEqual(status, {
    available: true,
    ready: true,
    playerName: 'Respawn · TV-Musik-PC',
    message: null,
  });
  assert.equal(requests[0].url, 'http://127.0.0.1:43821/web-player/status');
  assert.equal(requests[0].options.cache, 'no-store');
});

test('local Spotify playback capability stays hidden on ordinary client devices', async () => {
  const unavailable = await localSpotifyPlaybackStatus({
    fetchImpl: async () => { throw new Error('connection refused'); },
  });
  assert.equal(unavailable, null);

  const malformed = await localSpotifyPlaybackStatus({
    fetchImpl: async () => ({ ok: true, json: async () => ({ available: true }) }),
  });
  assert.equal(malformed, null);
});

test('Spotify Playback SDK retries with a fresh script after a load error', async (t) => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  let currentScript = null;
  let createdScripts = 0;

  globalThis.window = {};
  globalThis.document = {
    querySelector: () => currentScript,
    createElement: () => {
      createdScripts += 1;
      const listeners = new Map();
      const script = {
        dataset: {},
        addEventListener: (name, listener) => listeners.set(name, listener),
        fail: () => listeners.get('error')?.(),
        remove: () => { if (currentScript === script) currentScript = null; },
      };
      return script;
    },
    body: { appendChild: (script) => { currentScript = script; } },
  };
  t.after(() => {
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
  });

  const failedLoad = preloadSpotifyPlaybackSdk();
  currentScript.fail();
  await assert.rejects(failedLoad, /konnte nicht geladen/);
  assert.equal(currentScript, null, 'the failed script is removed before a retry');

  const retriedLoad = preloadSpotifyPlaybackSdk();
  assert.equal(createdScripts, 2);
  globalThis.window.Spotify = { Player: class FakeSpotifyPlayer {} };
  globalThis.window.onSpotifyWebPlaybackSDKReady();
  assert.equal(await retriedLoad, globalThis.window.Spotify);
});

test('local Spotify player registers the browser device with a loopback token', async (t) => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalFetch = globalThis.fetch;
  let instance = null;
  let suppliedToken = null;

  class FakeSpotifyPlayer {
    constructor(options) {
      this.options = options;
      this.listeners = new Map();
      this.activated = false;
      instance = this;
    }

    addListener(name, listener) {
      this.listeners.set(name, listener);
    }

    async activateElement() {
      this.activated = true;
    }

    async connect() {
      await new Promise((resolve) => this.options.getOAuthToken((token) => {
        suppliedToken = token;
        resolve();
      }));
      queueMicrotask(() => this.listeners.get('ready')?.({ device_id: 'browser-device-1' }));
      return true;
    }

    disconnect() {}
  }

  globalThis.window = { Spotify: { Player: FakeSpotifyPlayer } };
  globalThis.document = {};
  const stateReports = [];
  let reportArrived;
  const reportPromise = new Promise((resolve) => { reportArrived = resolve; });
  globalThis.fetch = async (url, options) => {
    if (url === 'http://127.0.0.1:43821/web-player/state') {
      stateReports.push({ options, body: JSON.parse(options.body) });
      reportArrived();
      return { ok: true, status: 204 };
    }
    assert.equal(url, 'http://127.0.0.1:43821/web-player/token');
    return { ok: true, json: async () => ({ accessToken: 'browser-access-token' }) };
  };
  t.after(() => {
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
    globalThis.fetch = originalFetch;
  });

  const connected = await connectLocalSpotifyPlayer({ name: 'Respawn · Kiosk' });
  assert.deepEqual(connected, { deviceId: 'browser-device-1', name: 'Respawn · Kiosk' });
  assert.equal(instance.options.enableMediaSession, true);
  assert.equal(instance.activated, true);
  assert.equal(suppliedToken, 'browser-access-token');

  // Several SDK events for one change reach the local controller as one report.
  const playerStateChanged = instance.listeners.get('player_state_changed');
  playerStateChanged({ paused: true, position: 0, track_window: { current_track: { uri: 'spotify:track:old' } } });
  playerStateChanged(null);
  await reportPromise;
  assert.equal(stateReports.length, 1);
  assert.equal(stateReports[0].options.method, 'POST');
  assert.deepEqual(stateReports[0].body, { deviceId: 'browser-device-1', state: null });
});

test('browser playback reports carry only what Respawn shows and the current position', () => {
  const sdkState = {
    paused: false,
    position: 61_000,
    duration: 200_000,
    context: { uri: 'spotify:playlist:0123456789012345678901', metadata: { name: 'LAN' } },
    track_window: {
      current_track: {
        uri: 'spotify:track:0123456789012345678901',
        name: 'Title',
        duration_ms: 200_000,
        artists: [{ name: 'A', uri: 'spotify:artist:x' }, { name: 'B' }],
        album: { name: 'Album', images: [{ url: 'https://i.scdn.co/image/1' }, { url: 'https://i.scdn.co/image/2' }] },
      },
      next_tracks: [{ uri: 'spotify:track:next' }],
    },
  };
  assert.deepEqual(browserPlaybackReport('device-1', sdkState, 10_500, 10_000), {
    deviceId: 'device-1',
    state: {
      track: {
        uri: 'spotify:track:0123456789012345678901',
        name: 'Title',
        artists: ['A', 'B'],
        album: 'Album',
        imageUrl: 'https://i.scdn.co/image/1',
        durationMs: 200_000,
      },
      contextUri: 'spotify:playlist:0123456789012345678901',
      isPlaying: true,
      progressMs: 61_500,
    },
  });
  const paused = browserPlaybackReport('device-1', { ...sdkState, paused: true }, 10_500, 10_000);
  assert.equal(paused.state.progressMs, 61_000, 'a paused song does not advance while the report waits');
  assert.deepEqual(browserPlaybackReport('device-1', null), { deviceId: 'device-1', state: null });
});

test('local Spotify playback waits for renewed browser scopes', async () => {
  const states = [
    { available: true, ready: false, playerName: 'Respawn · TV' },
    { available: true, ready: true, playerName: 'Respawn · TV' },
  ];
  let delays = 0;
  const ready = await waitForLocalSpotifyPlaybackReady({
    status: async () => states.shift(),
    attempts: 3,
    intervalMs: 1,
    delay: async () => { delays += 1; },
  });
  assert.equal(ready.ready, true);
  assert.equal(delays, 1);
});

test('local Spotify playback detects a stale browser device after reload', () => {
  const session = { deviceId: 'old-device', deviceName: 'Respawn · TV' };
  const localPlayback = { ready: true, playerName: 'Respawn · TV' };
  assert.equal(localSpotifySessionNeedsRecovery(session, localPlayback, null), true);
  assert.equal(localSpotifySessionNeedsRecovery(session, localPlayback, { deviceId: 'old-device' }), false);
  assert.equal(localSpotifySessionNeedsRecovery(session, { ...localPlayback, playerName: 'Andere Box' }, null), false);
});
