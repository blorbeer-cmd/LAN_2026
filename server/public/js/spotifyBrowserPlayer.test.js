import assert from 'node:assert/strict';
import test from 'node:test';
import {
  connectLocalSpotifyPlayer,
  localSpotifyPlaybackStatus,
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
  globalThis.fetch = async (url) => {
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
});
