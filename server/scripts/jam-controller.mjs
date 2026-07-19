#!/usr/bin/env node

import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { URL, URLSearchParams } from 'node:url';

const HOST = '127.0.0.1';
const PORT = Number(process.env.JAM_CONTROLLER_PORT || 43821);
const REDIRECT_URI = `http://${HOST}:${PORT}/callback`;
const STORE_DIR = path.join(os.homedir(), '.respawn');
const STORE_FILE = path.join(STORE_DIR, 'jam-controller.json');
const SCOPES = 'user-read-playback-state user-modify-playback-state';
const DEFAULT_RESPAWN_URL = 'https://lan.dbehnke.dev';

let state = { ...loadBootstrap(), ...loadState() };
let oauthPending = null;
let scheduledPlayback = null;
let polling = false;
let heartbeating = false;

function loadState() {
  try { return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8')); } catch { return {}; }
}

function loadBootstrap() {
  try {
    const scriptDir = path.dirname(path.resolve(process.argv[1] || '.'));
    return JSON.parse(fs.readFileSync(path.join(scriptDir, 'controller-setup.json'), 'utf8'));
  } catch {
    return {};
  }
}

function saveState() {
  fs.mkdirSync(STORE_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(STORE_FILE, JSON.stringify(state, null, 2), { mode: 0o600 });
}

function htmlEscape(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
  })[character]);
}

function page(message = '') {
  const connected = Boolean(state.controllerToken && state.refreshToken);
  const help = (text) => `<span class="field-help" tabindex="0" aria-label="Info"><span aria-hidden="true">i</span><span class="field-tooltip" role="tooltip">${htmlEscape(text)}</span></span>`;
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Respawn Jam-Controller</title><style>
  :root{color-scheme:dark;font-family:Inter,system-ui,sans-serif;background:#0f1420;color:#eef1f8}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;box-sizing:border-box}.card{width:min(680px,100%);background:#171e30;border:1px solid #303b59;border-radius:18px;padding:24px;box-sizing:border-box}.stack{display:grid;gap:16px}h1,p{margin:0}.muted{color:#9aa4bb}.ok{color:#2bd681}.error{color:#ff6b75}label{display:grid;gap:7px;color:#9aa4bb;font-size:14px}.field-label{display:flex;align-items:center;gap:7px}.field-help{position:relative;display:inline-grid;place-items:center;width:17px;height:17px;border:1px solid #596783;border-radius:50%;color:#aab4c8;font-size:11px;font-weight:700;cursor:help}.field-tooltip{position:absolute;z-index:10;left:calc(100% + 8px);top:50%;width:min(280px,65vw);padding:9px 11px;border:1px solid #3b496b;border-radius:9px;background:#101625;color:#dce2ef;font-size:12px;font-weight:400;line-height:1.4;box-shadow:0 10px 30px rgba(0,0,0,.35);transform:translateY(-50%);visibility:hidden;opacity:0;pointer-events:none}.field-help:hover .field-tooltip,.field-help:focus .field-tooltip{visibility:visible;opacity:1}input{height:44px;border:1px solid #364363;border-radius:10px;background:#202a44;color:#eef1f8;padding:0 13px;font:inherit}.row{display:grid;grid-template-columns:1fr 1fr;gap:12px}button{height:44px;border:0;border-radius:10px;color:white;font-weight:700;background:linear-gradient(100deg,#5b8cff,#8467ef,#ea4da6);cursor:pointer}code{background:#101625;border-radius:8px;padding:8px 10px;word-break:break-all}details{border:1px solid #303b59;border-radius:10px;padding:12px}summary{cursor:pointer;color:#9aa4bb}@media(max-width:600px){.row{grid-template-columns:1fr}.field-tooltip{left:auto;right:0;top:calc(100% + 8px);transform:none}}
  </style></head><body><main class="card stack"><h1>Respawn Jam-Controller</h1>
  <p class="muted">Spotify läuft auf diesem Gerät. Zugangsdaten und Tokens verlassen es nicht.</p>
  ${message ? `<p class="${connected ? 'ok' : 'error'}">${htmlEscape(message)}</p>` : ''}
  ${connected ? `<div class="stack"><p><strong>${htmlEscape(state.label)}</strong> · ${htmlEscape(state.spotifyDisplayName || 'Spotify')}</p><p class="muted">Verbunden mit ${htmlEscape(state.respawnBaseUrl)}</p><p>Der Controller läuft. Diese Seite darf offen bleiben oder der Browser kann geschlossen werden.</p><form method="post" action="/disconnect"><button>Controller zurücksetzen</button></form></div>` : `
  <form method="post" action="/setup" class="stack">
    <label><span class="field-label">Respawn-Adresse ${help('Ist vorausgefüllt. Nur ändern, wenn der Controller einen anderen Respawn-Server verwenden soll.')}</span><input name="respawnBaseUrl" type="url" required value="${htmlEscape(state.respawnBaseUrl || DEFAULT_RESPAWN_URL)}"></label>
    <div class="row"><label><span class="field-label">Kopplungscode ${help('Wird durch das heruntergeladene Paket automatisch eingetragen und ist zehn Minuten gültig.')}</span><input name="pairingCode" required autocomplete="off" maxlength="12" value="${htmlEscape(state.pairingCode || '')}"></label><label><span class="field-label">Gerätename</span><input name="label" required value="${htmlEscape(state.label || 'LAN-Musik-PC')}"></label></div>
    <label><span class="field-label">Spotify Client-ID ${help('Im Spotify Developer Dashboard unter deiner App in Basic Information. Ein Client-Secret wird nicht benötigt.')}</span><input name="clientId" required autocomplete="off" value="${htmlEscape(state.clientId || '')}"></label>
    <label><span class="field-label">Redirect URI ${help('Diesen Wert im Spotify Developer Dashboard unter Redirect URIs exakt hinzufügen.')}</span><code>${REDIRECT_URI}</code></label>
    <details><summary>Erweitert</summary><label><span class="field-label">Respawn-Zugangstoken ${help('Nur für einen Respawn-Server mit altem gemeinsamen Zugangsschutz erforderlich.')}</span><input name="accessToken" type="password" value="${htmlEscape(state.accessToken || '')}"></label></details>
    <button>Mit Spotify verbinden</button>
  </form>`}
  </main></body></html>`;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; if (body.length > 20_000) req.destroy(); });
    req.on('end', () => resolve(new URLSearchParams(body)));
    req.on('error', reject);
  });
}

function base64url(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

async function beginOauth(form, res) {
  const respawnBaseUrl = String(form.get('respawnBaseUrl') || '').trim().replace(/\/+$/, '');
  const pairingCode = String(form.get('pairingCode') || '').trim().toUpperCase();
  const label = String(form.get('label') || '').trim();
  const clientId = String(form.get('clientId') || '').trim();
  const accessToken = String(form.get('accessToken') || '').trim();
  if (!respawnBaseUrl || !pairingCode || !label || !clientId) throw new Error('Alle Pflichtfelder ausfüllen.');
  const verifier = base64url(crypto.randomBytes(64));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  const oauthState = base64url(crypto.randomBytes(24));
  oauthPending = { verifier, oauthState, respawnBaseUrl, pairingCode, label, clientId, accessToken };
  const params = new URLSearchParams({
    client_id: clientId, response_type: 'code', redirect_uri: REDIRECT_URI, scope: SCOPES,
    code_challenge_method: 'S256', code_challenge: challenge, state: oauthState,
  });
  res.writeHead(302, { Location: `https://accounts.spotify.com/authorize?${params}` }).end();
}

async function finishOauth(url) {
  if (url.searchParams.get('error')) throw new Error('Spotify-Anmeldung wurde abgebrochen.');
  const code = url.searchParams.get('code');
  const returnedState = url.searchParams.get('state');
  if (!oauthPending || !code || returnedState !== oauthPending.oauthState) throw new Error('Spotify-Anmeldung ist abgelaufen oder ungültig.');
  const tokenResponse = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: oauthPending.clientId, grant_type: 'authorization_code', code,
      redirect_uri: REDIRECT_URI, code_verifier: oauthPending.verifier,
    }),
  });
  const tokens = await tokenResponse.json();
  if (!tokenResponse.ok || !tokens.refresh_token) throw new Error(tokens.error_description || 'Spotify-Token konnte nicht abgerufen werden.');
  const profileResponse = await fetch('https://api.spotify.com/v1/me', { headers: { Authorization: `Bearer ${tokens.access_token}` } });
  const profile = await profileResponse.json();
  if (!profileResponse.ok) throw new Error('Spotify-Profil konnte nicht geladen werden.');
  const registration = await respawnFetch('/api/music/controller/register', {
    method: 'POST', body: JSON.stringify({
      pairingCode: oauthPending.pairingCode, label: oauthPending.label,
      spotifyDisplayName: profile.display_name || profile.id,
    }),
  }, oauthPending);
  state = {
    respawnBaseUrl: oauthPending.respawnBaseUrl,
    accessToken: oauthPending.accessToken,
    label: oauthPending.label,
    clientId: oauthPending.clientId,
    controllerId: registration.controllerId,
    controllerToken: registration.controllerToken,
    groupId: registration.groupId,
    spotifyDisplayName: profile.display_name || profile.id,
    accessTokenSpotify: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + Number(tokens.expires_in || 3600) * 1000,
  };
  oauthPending = null;
  saveState();
}

async function respawnFetch(endpoint, options = {}, override = state) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (override.accessToken) headers['x-access-token'] = override.accessToken;
  if (override.controllerToken) headers['x-music-controller-token'] = override.controllerToken;
  const response = await fetch(`${override.respawnBaseUrl}${endpoint}`, { ...options, headers });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Respawn antwortet mit ${response.status}.`);
  return data;
}

async function spotifyToken() {
  if (state.accessTokenSpotify && Date.now() < Number(state.expiresAt || 0) - 60_000) return state.accessTokenSpotify;
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: state.clientId, grant_type: 'refresh_token', refresh_token: state.refreshToken }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error_description || 'Spotify-Anmeldung muss erneuert werden.');
  state.accessTokenSpotify = data.access_token;
  if (data.refresh_token) state.refreshToken = data.refresh_token;
  state.expiresAt = Date.now() + Number(data.expires_in || 3600) * 1000;
  saveState();
  return state.accessTokenSpotify;
}

async function spotify(pathname, options = {}) {
  const token = await spotifyToken();
  const response = await fetch(`https://api.spotify.com/v1${pathname}`, {
    ...options, headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) },
  });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error?.message || `Spotify antwortet mit ${response.status}.`);
  return data;
}

function publicTrack(track) {
  if (!track) return null;
  return {
    id: track.id, uri: track.uri, name: track.name,
    artist: (track.artists || []).map((artist) => artist.name).filter(Boolean).join(', '),
    album: track.album?.name || '', imageUrl: track.album?.images?.[0]?.url || null,
    durationMs: Number(track.duration_ms || 0),
  };
}

function clearSchedule() {
  if (scheduledPlayback) clearTimeout(scheduledPlayback);
  scheduledPlayback = null;
}

async function executeCommand(type, payload = {}) {
  if (type !== 'scheduleQueue') clearSchedule();
  if (type === 'devices') {
    const data = await spotify('/me/player/devices');
    return { devices: (data.devices || []).filter((device) => device.id && !device.is_restricted).map((device) => ({
      id: device.id, name: device.name || 'Spotify-Gerät', type: device.type || '', active: Boolean(device.is_active),
    })) };
  }
  if (type === 'search') {
    const data = await spotify(`/search?type=track&limit=10&q=${encodeURIComponent(payload.query)}`);
    return { tracks: (data.tracks?.items || []).map(publicTrack) };
  }
  if (type === 'track') return publicTrack(await spotify(`/tracks/${encodeURIComponent(payload.trackId)}`));
  if (type === 'playUris') {
    await spotify(`/me/player/play?device_id=${encodeURIComponent(payload.deviceId)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uris: payload.uris, position_ms: 0 }),
    });
    return { ok: true };
  }
  if (type === 'queueTrack') {
    await spotify(`/me/player/queue?uri=${encodeURIComponent(payload.uri)}&device_id=${encodeURIComponent(payload.deviceId)}`, { method: 'POST' });
    return { ok: true };
  }
  if (type === 'pause' || type === 'resume') {
    await spotify(`/me/player/${type === 'pause' ? 'pause' : 'play'}?device_id=${encodeURIComponent(payload.deviceId)}`, { method: 'PUT' });
    return { ok: true };
  }
  if (type === 'scheduleQueue') {
    clearSchedule();
    scheduledPlayback = setTimeout(async () => {
      scheduledPlayback = null;
      try {
        if (payload.uris?.length) await executeCommand('playUris', { deviceId: payload.deviceId, uris: payload.uris });
        else await executeCommand('pause', { deviceId: payload.deviceId });
        await sendHeartbeat();
      } catch (error) { console.error('[Jam] Geplanter Wechsel fehlgeschlagen:', error.message); }
    }, Math.max(0, Number(payload.delayMs || 0)));
    return { scheduled: true };
  }
  throw new Error(`Unbekannter Controller-Befehl: ${type}`);
}

async function pollCommands() {
  if (polling || !state.controllerToken) return;
  polling = true;
  try {
    const { command } = await respawnFetch('/api/music/controller/commands');
    if (command) {
      try {
        const data = await executeCommand(command.type, command.payload);
        await respawnFetch(`/api/music/controller/commands/${encodeURIComponent(command.id)}/result`, {
          method: 'POST', body: JSON.stringify({ ok: true, data }),
        });
      } catch (error) {
        await respawnFetch(`/api/music/controller/commands/${encodeURIComponent(command.id)}/result`, {
          method: 'POST', body: JSON.stringify({ ok: false, error: error.message }),
        }).catch(() => {});
      }
    }
  } catch (error) { console.error('[Jam] Respawn-Verbindung:', error.message); }
  finally { polling = false; }
}

async function sendHeartbeat() {
  if (heartbeating || !state.controllerToken) return;
  heartbeating = true;
  try {
    const playback = await spotify('/me/player');
    await respawnFetch('/api/music/controller/heartbeat', {
      method: 'POST', body: JSON.stringify({
        spotifyDisplayName: state.spotifyDisplayName,
        playback: playback ? {
          track: publicTrack(playback.item), deviceId: playback.device?.id || null,
          isPlaying: Boolean(playback.is_playing), progressMs: Number(playback.progress_ms || 0),
        } : null,
      }),
    });
  } catch (error) { console.error('[Jam] Heartbeat:', error.message); }
  finally { heartbeating = false; }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);
    if (req.method === 'POST' && url.pathname === '/setup') {
      await beginOauth(await readBody(req), res);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/callback') {
      await finishOauth(url);
      res.writeHead(302, { Location: '/' }).end();
      return;
    }
    if (req.method === 'POST' && url.pathname === '/disconnect') {
      state = {};
      saveState();
      res.writeHead(302, { Location: '/' }).end();
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(page());
  } catch (error) {
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(page(error instanceof Error ? error.message : 'Einrichtung fehlgeschlagen.'));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Respawn Jam-Controller: ${REDIRECT_URI.replace('/callback', '')}`);
  console.log(`Spotify Redirect URI: ${REDIRECT_URI}`);
  if (!state.controllerToken) openSetupPage();
});

function openSetupPage() {
  const url = `http://${HOST}:${PORT}`;
  const command = process.platform === 'darwin'
    ? ['open', [url]]
    : process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : ['xdg-open', [url]];
  try {
    const child = spawn(command[0], command[1], { detached: true, stdio: 'ignore' });
    child.on('error', () => {
      // Auf Geräten ohne Desktop kann die ausgegebene URL manuell geöffnet werden.
    });
    child.unref();
  } catch {
    // Headless Raspberry Pis simply open the printed URL manually.
  }
}

setInterval(pollCommands, 500).unref();
setInterval(sendHeartbeat, 3_000).unref();
if (state.controllerToken) void sendHeartbeat();
