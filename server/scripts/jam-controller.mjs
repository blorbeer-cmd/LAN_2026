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
const STORE_DIR = process.env.JAM_CONTROLLER_STORE_DIR
  ? path.resolve(process.env.JAM_CONTROLLER_STORE_DIR)
  : path.join(os.homedir(), '.respawn');
const STORE_FILE = path.join(STORE_DIR, 'jam-controller.json');
const SCOPES = 'user-read-playback-state user-modify-playback-state';
const DEFAULT_RESPAWN_URL = 'https://lan.dbehnke.dev';
const REQUEST_TIMEOUT_MS = Math.max(100, Number(process.env.JAM_CONTROLLER_REQUEST_TIMEOUT_MS || 10_000));
const LOCAL_FORM_TOKEN = crypto.randomBytes(24).toString('base64url');

let state = { ...loadBootstrap(), ...loadState() };
let oauthPending = null;
let scheduledPlayback = null;
let polling = false;
let heartbeating = false;
let localPageOpened = false;
let serverReady = false;
let runtime = {
  needsPairing: false,
  respawn: state.controllerToken ? 'connecting' : 'setup',
  respawnMessage: null,
  lastRespawnAt: null,
  spotify: state.refreshToken ? 'connecting' : 'authorization_required',
  spotifyMessage: state.refreshToken ? null : 'Spotify muss verbunden werden.',
};

class HttpResponseError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

class SpotifyAuthorizationError extends Error {}

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

function pageHeaders() {
  return {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  };
}

function xmlEscape(value) {
  return htmlEscape(value);
}

function autostartFile() {
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'LaunchAgents', 'dev.respawn.jam-controller.plist');
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'Respawn-Jam-Controller.cmd');
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'autostart', 'respawn-jam-controller.desktop');
}

function autostartEnabled() {
  return fs.existsSync(autostartFile());
}

function setAutostart(enabled) {
  const target = autostartFile();
  if (!enabled) {
    fs.rmSync(target, { force: true });
    return;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const node = process.execPath;
  const script = path.resolve(process.argv[1]);
  if (process.platform === 'darwin') {
    fs.writeFileSync(target, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>dev.respawn.jam-controller</string>
<key>ProgramArguments</key><array><string>${xmlEscape(node)}</string><string>${xmlEscape(script)}</string></array>
<key>RunAtLoad</key><true/><key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
<key>StandardOutPath</key><string>${xmlEscape(path.join(STORE_DIR, 'jam-controller.log'))}</string>
<key>StandardErrorPath</key><string>${xmlEscape(path.join(STORE_DIR, 'jam-controller.log'))}</string>
</dict></plist>\n`, { mode: 0o600 });
    return;
  }
  if (process.platform === 'win32') {
    fs.writeFileSync(target, `@echo off\r\nstart "" /min "${node}" "${script}"\r\n`, { mode: 0o600 });
    return;
  }
  const escapedNode = node.replace(/([\\"])/g, '\\$1');
  const escapedScript = script.replace(/([\\"])/g, '\\$1');
  fs.writeFileSync(target, `[Desktop Entry]
Type=Application
Name=Respawn Jam-Controller
Exec="${escapedNode}" "${escapedScript}"
Terminal=false
X-GNOME-Autostart-enabled=true
`, { mode: 0o600 });
}

function setupFields({ includePairing }) {
  const help = (text) => `<span class="field-help" tabindex="0" aria-label="Info"><span aria-hidden="true">i</span><span class="field-tooltip" role="tooltip">${htmlEscape(text)}</span></span>`;
  return `
    <label><span class="field-label">Respawn-Adresse ${help('Ist vorausgefüllt. Nur ändern, wenn der Controller einen anderen Respawn-Server verwenden soll.')}</span><input name="respawnBaseUrl" type="url" required value="${htmlEscape(state.respawnBaseUrl || DEFAULT_RESPAWN_URL)}"></label>
    ${includePairing ? `<div class="row"><label><span class="field-label">Kopplungscode ${help('Beim ersten Download ist der Code vorausgefüllt. Für eine vorhandene Installation auf der Jam-Seite „Vorhandenen Controller koppeln“ oder „Wiederverbindung vorbereiten“ wählen und den neuen Code hier eintragen.')}</span><input name="pairingCode" required autocomplete="off" maxlength="12" value="${htmlEscape(state.pairingCode || '')}"></label><label><span class="field-label">Gerätename</span><input name="label" required value="${htmlEscape(state.label || 'LAN-Musik-PC')}"></label></div>` : ''}
    <label><span class="field-label">Spotify Client-ID ${help('Im Spotify Developer Dashboard unter deiner App in „Basic Information“. Dank PKCE wird kein Client-Secret benötigt oder gespeichert.')}</span><input name="clientId" required autocomplete="off" value="${htmlEscape(state.clientId || '')}"></label>
    <label><span class="field-label">Redirect URI ${help('Diesen Wert im Spotify Developer Dashboard unter „Redirect URIs“ exakt hinzufügen. Er bleibt unabhängig von der Respawn-Adresse gleich.')}</span><code>${REDIRECT_URI}</code></label>
    <details><summary>Erweitert</summary><label><span class="field-label">Respawn-Zugangstoken ${help('Nur für einen Respawn-Server mit altem gemeinsamen Zugangsschutz erforderlich.')}</span><input name="accessToken" type="password" value="${htmlEscape(state.accessToken || '')}"></label></details>`;
}

function page(message = '', isError = false) {
  const hasController = Boolean(state.controllerToken);
  const hasSpotify = Boolean(state.refreshToken);
  const needsPairing = !hasController || runtime.needsPairing;
  const autostart = autostartEnabled();
  const csrf = `<input type="hidden" name="_csrf" value="${LOCAL_FORM_TOKEN}">`;
  const statusLabel = (value) => value === 'connected' ? 'Verbunden' : value === 'connecting' ? 'Verbindet…' : value === 'authorization_required' ? 'Anmeldung nötig' : value === 'setup' ? 'Einrichtung nötig' : 'Automatischer Neuversuch';
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Respawn Jam-Controller</title><style>
  :root{color-scheme:dark;font-family:Inter,system-ui,sans-serif;background:#0f1420;color:#eef1f8}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;box-sizing:border-box}.card{width:min(680px,100%);background:#171e30;border:1px solid #303b59;border-radius:18px;padding:24px;box-sizing:border-box}.stack{display:grid;gap:16px}h1,h2,p{margin:0}.muted{color:#9aa4bb}.ok{color:#2bd681}.error{color:#ff6b75}.warning{color:#f7c66a}.status{display:flex;justify-content:space-between;gap:12px;padding:12px;border:1px solid #303b59;border-radius:10px}.status strong:last-child{text-align:right}label{display:grid;gap:7px;color:#9aa4bb;font-size:14px}.field-label{display:flex;align-items:center;gap:7px}.field-help{position:relative;display:inline-grid;place-items:center;width:17px;height:17px;border:1px solid #596783;border-radius:50%;color:#aab4c8;font-size:11px;font-weight:700;cursor:help}.field-tooltip{position:absolute;z-index:10;left:calc(100% + 8px);top:50%;width:min(280px,65vw);padding:9px 11px;border:1px solid #3b496b;border-radius:9px;background:#101625;color:#dce2ef;font-size:12px;font-weight:400;line-height:1.4;box-shadow:0 10px 30px rgba(0,0,0,.35);transform:translateY(-50%);visibility:hidden;opacity:0;pointer-events:none}.field-help:hover .field-tooltip,.field-help:focus .field-tooltip{visibility:visible;opacity:1}input{height:44px;border:1px solid #364363;border-radius:10px;background:#202a44;color:#eef1f8;padding:0 13px;font:inherit}.row{display:grid;grid-template-columns:1fr 1fr;gap:12px}button{min-height:44px;border:0;border-radius:10px;padding:0 14px;color:white;font-weight:700;background:linear-gradient(100deg,#5b8cff,#8467ef,#ea4da6);cursor:pointer}.secondary{background:#202a44}.danger{background:#71313b}code{background:#101625;border-radius:8px;padding:8px 10px;word-break:break-all}details{border:1px solid #303b59;border-radius:10px;padding:12px}summary{cursor:pointer;color:#9aa4bb}@media(max-width:600px){.row{grid-template-columns:1fr}.field-tooltip{left:auto;right:0;top:calc(100% + 8px);transform:none}}
  </style></head><body><main class="card stack"><h1>Respawn Jam-Controller</h1>
  <p class="muted">Dieser eine Controller verbindet Respawn mit Spotify. Alle Teilnehmenden bedienen Titel, Playlists, Songwünsche und Wiedergabe im Respawn-Browser; Spotify Client-ID und Tokens bleiben ausschließlich auf diesem Gerät.</p>
  ${message ? `<p class="${isError ? 'error' : 'ok'}">${htmlEscape(message)}</p>` : ''}
  ${needsPairing && hasSpotify ? `<div class="stack">
    <h2>Vorhandenen Controller wieder verbinden</h2>
    <p class="muted">Kein Download und keine neue Spotify-Anmeldung nötig. Auf der Respawn-Jam-Seite einen neuen Kopplungscode erzeugen und hier eintragen.</p>
    <form method="post" action="/reconnect" class="stack">
      ${csrf}
      <label>Respawn-Adresse<input name="respawnBaseUrl" type="url" required value="${htmlEscape(state.respawnBaseUrl || DEFAULT_RESPAWN_URL)}"></label>
      <div class="row"><label>Kopplungscode<input name="pairingCode" required autocomplete="off" maxlength="12" value="${htmlEscape(state.pairingCode || '')}"></label><label>Gerätename<input name="label" required value="${htmlEscape(state.label || 'LAN-Musik-PC')}"></label></div>
      <button>Wieder verbinden</button>
    </form>
  </div>` : needsPairing ? `<div class="stack">
    <h2>Controller einmalig einrichten</h2>
    <p class="muted">Respawn-Adresse und Kopplungscode stammen aus dem Downloadpaket. Nach dieser Einrichtung genügen Autostart oder dieselbe Startdatei; das Paket muss nicht erneut heruntergeladen werden.</p>
    <form method="post" action="/setup" class="stack">${csrf}
      <input type="hidden" name="intent" value="initial">
      ${setupFields({ includePairing: true })}
      <button>Einmalig mit Spotify verbinden</button>
    </form>
  </div>` : !hasSpotify ? `<div class="stack">
    <h2>Spotify-Anmeldung erneuern</h2>
    <p class="warning">Der Respawn-Controller ist erreichbar, aber Spotify benötigt eine neue Anmeldung.</p>
    <form method="post" action="/setup" class="stack">${csrf}<input type="hidden" name="intent" value="spotify">${setupFields({ includePairing: false })}<button>Spotify neu verbinden</button></form>
  </div>` : `<div class="stack">
    <p><strong>${htmlEscape(state.label)}</strong> · ${htmlEscape(state.spotifyDisplayName || 'Spotify')}</p>
    <div class="status"><span>Respawn</span><strong class="${runtime.respawn === 'connected' ? 'ok' : 'warning'}">${htmlEscape(statusLabel(runtime.respawn))}</strong></div>
    <div class="status"><span>Spotify</span><strong class="${runtime.spotify === 'connected' ? 'ok' : 'warning'}">${htmlEscape(statusLabel(runtime.spotify))}</strong></div>
    ${runtime.respawnMessage ? `<p class="muted">${htmlEscape(runtime.respawnMessage)}</p>` : ''}
    ${runtime.spotifyMessage ? `<p class="muted">${htmlEscape(runtime.spotifyMessage)}</p>` : ''}
    <p class="muted">Verbunden mit ${htmlEscape(state.respawnBaseUrl)}. Der Controller führt Titel-, Playlist- und Wiedergabebefehle aus. Netzwerkabbrüche werden automatisch erneut versucht; diese Browserseite muss nicht offen bleiben.</p>
    <form method="post" action="/retry">${csrf}<button>Verbindung jetzt prüfen</button></form>
    <form method="post" action="/autostart">${csrf}<input type="hidden" name="enabled" value="${autostart ? '0' : '1'}"><button class="secondary">${autostart ? 'Autostart deaktivieren' : 'Beim Anmelden automatisch starten'}</button></form>
    <details><summary>Verbindung verwalten</summary><div class="stack">
      <form method="post" action="/setup" class="stack">${csrf}<input type="hidden" name="intent" value="spotify">${setupFields({ includePairing: false })}<button class="secondary">Spotify-Anmeldung erneuern</button></form>
      <form method="post" action="/disconnect">${csrf}<button class="danger">Controller vollständig zurücksetzen</button></form>
    </div></details>
  </div>`}
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

async function readLocalForm(req) {
  const form = await readBody(req);
  if (form.get('_csrf') !== LOCAL_FORM_TOKEN) throw new Error('Lokale Anfrage ist ungültig oder abgelaufen.');
  return form;
}

function base64url(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: abort.signal });
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error(`Zeitüberschreitung nach ${Math.ceil(timeoutMs / 1_000)} Sekunden.`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function markPairingRequired(message = 'Der Controller muss erneut mit Respawn gekoppelt werden.') {
  const newlyRequired = !runtime.needsPairing;
  runtime.needsPairing = true;
  runtime.respawn = 'authorization_required';
  runtime.respawnMessage = message;
  if (newlyRequired) {
    localPageOpened = false;
    openSetupPageOnce();
  }
}

function markSpotifyAuthorizationRequired(message = 'Spotify benötigt eine neue Anmeldung.') {
  const newlyRequired = runtime.spotify !== 'authorization_required' || Boolean(state.refreshToken);
  const hadStoredSpotifyToken = Boolean(state.accessTokenSpotify || state.refreshToken || state.expiresAt);
  runtime.spotify = 'authorization_required';
  runtime.spotifyMessage = message;
  delete state.accessTokenSpotify;
  delete state.refreshToken;
  delete state.expiresAt;
  if (hadStoredSpotifyToken) saveState();
  if (newlyRequired) {
    localPageOpened = false;
    openSetupPageOnce();
  }
}

async function registerController({ respawnBaseUrl, pairingCode, label, accessToken, spotifyDisplayName }) {
  return respawnFetch('/api/music/controller/register', {
    method: 'POST', body: JSON.stringify({ pairingCode, label, spotifyDisplayName }),
  }, { respawnBaseUrl, accessToken });
}

async function beginOauth(form, res) {
  const intent = String(form.get('intent') || 'initial');
  const respawnBaseUrl = String(form.get('respawnBaseUrl') || '').trim().replace(/\/+$/, '');
  const pairingCode = String(form.get('pairingCode') || '').trim().toUpperCase();
  const label = String(form.get('label') || state.label || 'LAN-Musik-PC').trim();
  const clientId = String(form.get('clientId') || '').trim();
  const accessToken = String(form.get('accessToken') || '').trim();
  const registerAfterOauth = intent !== 'spotify' || !state.controllerToken || runtime.needsPairing;
  if (!respawnBaseUrl || !label || !clientId || (registerAfterOauth && !pairingCode)) throw new Error('Alle Pflichtfelder ausfüllen.');
  const verifier = base64url(crypto.randomBytes(64));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  const oauthState = base64url(crypto.randomBytes(24));
  oauthPending = { verifier, oauthState, respawnBaseUrl, pairingCode, label, clientId, accessToken, registerAfterOauth };
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
  const tokenResponse = await fetchWithTimeout('https://accounts.spotify.com/api/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: oauthPending.clientId, grant_type: 'authorization_code', code,
      redirect_uri: REDIRECT_URI, code_verifier: oauthPending.verifier,
    }),
  });
  const tokens = await tokenResponse.json();
  if (!tokenResponse.ok || !tokens.refresh_token) throw new Error(tokens.error_description || 'Spotify-Token konnte nicht abgerufen werden.');
  const profileResponse = await fetchWithTimeout('https://api.spotify.com/v1/me', { headers: { Authorization: `Bearer ${tokens.access_token}` } });
  const profile = await profileResponse.json();
  if (!profileResponse.ok) throw new Error('Spotify-Profil konnte nicht geladen werden.');
  const registration = oauthPending.registerAfterOauth
    ? await registerController({ ...oauthPending, spotifyDisplayName: profile.display_name || profile.id })
    : { controllerId: state.controllerId, controllerToken: state.controllerToken, groupId: state.groupId };
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
    pairingCode: '',
  };
  oauthPending = null;
  runtime = {
    needsPairing: false,
    respawn: 'connecting',
    respawnMessage: null,
    lastRespawnAt: null,
    spotify: 'connected',
    spotifyMessage: null,
  };
  localPageOpened = false;
  saveState();
  void sendHeartbeat();
}

async function reconnectController(form) {
  const respawnBaseUrl = String(form.get('respawnBaseUrl') || '').trim().replace(/\/+$/, '');
  const pairingCode = String(form.get('pairingCode') || '').trim().toUpperCase();
  const label = String(form.get('label') || '').trim();
  if (!respawnBaseUrl || !pairingCode || !label) throw new Error('Respawn-Adresse, Kopplungscode und Gerätename ausfüllen.');
  const registration = await registerController({
    respawnBaseUrl,
    pairingCode,
    label,
    accessToken: state.accessToken || '',
    spotifyDisplayName: state.spotifyDisplayName || 'Spotify',
  });
  state = {
    ...state,
    respawnBaseUrl,
    label,
    controllerId: registration.controllerId,
    controllerToken: registration.controllerToken,
    groupId: registration.groupId,
  };
  state.pairingCode = '';
  runtime.needsPairing = false;
  runtime.respawn = 'connecting';
  runtime.respawnMessage = null;
  localPageOpened = false;
  saveState();
  await sendHeartbeat();
}

async function respawnFetch(endpoint, options = {}, override = state) {
  const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
  if (override.accessToken) headers['x-access-token'] = override.accessToken;
  if (override.controllerToken) headers['x-music-controller-token'] = override.controllerToken;
  const response = await fetchWithTimeout(`${override.respawnBaseUrl}${endpoint}`, { ...options, headers });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new HttpResponseError(data.error || `Respawn antwortet mit ${response.status}.`, response.status);
  return data;
}

async function spotifyToken() {
  if (state.accessTokenSpotify && Date.now() < Number(state.expiresAt || 0) - 60_000) return state.accessTokenSpotify;
  if (!state.refreshToken || !state.clientId) throw new SpotifyAuthorizationError('Spotify benötigt eine neue Anmeldung.');
  const response = await fetchWithTimeout('https://accounts.spotify.com/api/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: state.clientId, grant_type: 'refresh_token', refresh_token: state.refreshToken }),
  });
  const data = await response.json();
  if (!response.ok) {
    if (data.error === 'invalid_grant' || response.status === 401) {
      throw new SpotifyAuthorizationError('Die Spotify-Anmeldung ist abgelaufen oder wurde widerrufen.');
    }
    throw new Error(data.error_description || 'Spotify-Anmeldung konnte nicht aktualisiert werden.');
  }
  state.accessTokenSpotify = data.access_token;
  if (data.refresh_token) state.refreshToken = data.refresh_token;
  state.expiresAt = Date.now() + Number(data.expires_in || 3600) * 1000;
  saveState();
  return state.accessTokenSpotify;
}

async function spotify(pathname, options = {}) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = await spotifyToken();
    const response = await fetchWithTimeout(`https://api.spotify.com/v1${pathname}`, {
      ...options, headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) },
    });
    if (response.status === 204) return null;
    const data = await response.json().catch(() => null);
    if (response.status === 401 && attempt === 0) {
      delete state.accessTokenSpotify;
      state.expiresAt = 0;
      saveState();
      continue;
    }
    if (response.status === 401) throw new SpotifyAuthorizationError('Spotify benötigt eine neue Anmeldung.');
    if (!response.ok) throw new Error(data?.error?.message || `Spotify antwortet mit ${response.status}.`);
    return data;
  }
  throw new SpotifyAuthorizationError('Spotify benötigt eine neue Anmeldung.');
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

function publicPlaylist(playlist) {
  if (!playlist?.id || playlist.uri !== `spotify:playlist:${playlist.id}` || !playlist.name) return null;
  const trackCount = Number(playlist.items?.total ?? playlist.tracks?.total ?? 0);
  return {
    id: playlist.id,
    uri: playlist.uri,
    name: playlist.name,
    owner: playlist.owner?.display_name || playlist.owner?.id || 'Spotify',
    imageUrl: playlist.images?.[0]?.url || null,
    trackCount: Number.isSafeInteger(trackCount) && trackCount >= 0 ? trackCount : 0,
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
    const data = await spotify(`/search?type=track,playlist&limit=10&q=${encodeURIComponent(payload.query)}`);
    return {
      tracks: (data.tracks?.items || []).map(publicTrack).filter(Boolean),
      playlists: (data.playlists?.items || []).map(publicPlaylist).filter(Boolean),
    };
  }
  if (type === 'track') return publicTrack(await spotify(`/tracks/${encodeURIComponent(payload.trackId)}`));
  if (type === 'playUris') {
    await spotify(`/me/player/play?device_id=${encodeURIComponent(payload.deviceId)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ uris: payload.uris, position_ms: 0 }),
    });
    return { ok: true };
  }
  if (type === 'playContext') {
    if (!/^spotify:playlist:[A-Za-z0-9]{22}$/.test(payload.uri || '')) throw new Error('Ungültige Spotify-Playlist.');
    await spotify(`/me/player/play?device_id=${encodeURIComponent(payload.deviceId)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ context_uri: payload.uri, position_ms: 0 }),
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
  if (type === 'next') {
    await spotify(`/me/player/next?device_id=${encodeURIComponent(payload.deviceId)}`, { method: 'POST' });
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
  if (polling || !state.controllerToken || runtime.needsPairing) return;
  polling = true;
  const controllerToken = state.controllerToken;
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
  } catch (error) {
    if (error instanceof HttpResponseError && error.status === 401) {
      if (state.controllerToken === controllerToken) {
        markPairingRequired('Respawn kennt diese Controller-Verbindung nicht mehr. Bitte mit einem neuen Code wieder verbinden.');
      }
    } else {
      runtime.respawn = 'retrying';
      runtime.respawnMessage = 'Respawn ist gerade nicht erreichbar. Der Controller versucht es automatisch erneut.';
    }
    console.error('[Jam] Respawn-Verbindung:', error.message);
  }
  finally { polling = false; }
}

async function sendHeartbeat() {
  if (heartbeating || !state.controllerToken || runtime.needsPairing) return;
  heartbeating = true;
  const controllerToken = state.controllerToken;
  let playbackAvailable = false;
  let publicPlayback = null;
  try {
    const playback = await spotify('/me/player');
    playbackAvailable = true;
    publicPlayback = playback ? {
      track: publicTrack(playback.item), deviceId: playback.device?.id || null,
      context: playback.context ? { type: playback.context.type || null, uri: playback.context.uri || null } : null,
      isPlaying: Boolean(playback.is_playing), progressMs: Number(playback.progress_ms || 0),
    } : null;
    runtime.spotify = 'connected';
    runtime.spotifyMessage = null;
  } catch (error) {
    if (error instanceof SpotifyAuthorizationError) {
      markSpotifyAuthorizationRequired(error.message);
    } else {
      runtime.spotify = 'unavailable';
      runtime.spotifyMessage = 'Spotify ist vorübergehend nicht erreichbar. Es wird automatisch erneut versucht.';
      console.error('[Jam] Spotify-Status:', error.message);
    }
  }
  try {
    const heartbeat = {
      spotifyDisplayName: state.spotifyDisplayName,
      connectionStatus: { spotify: runtime.spotify, message: runtime.spotifyMessage },
    };
    if (playbackAvailable) heartbeat.playback = publicPlayback;
    await respawnFetch('/api/music/controller/heartbeat', { method: 'POST', body: JSON.stringify(heartbeat) });
    runtime.needsPairing = false;
    runtime.respawn = 'connected';
    runtime.respawnMessage = null;
    runtime.lastRespawnAt = Date.now();
  } catch (error) {
    if (error instanceof HttpResponseError && error.status === 401) {
      if (state.controllerToken === controllerToken) {
        markPairingRequired('Respawn kennt diese Controller-Verbindung nicht mehr. Bitte mit einem neuen Code wieder verbinden.');
      }
    } else {
      runtime.respawn = 'retrying';
      runtime.respawnMessage = 'Respawn ist gerade nicht erreichbar. Der Controller versucht es automatisch erneut.';
    }
    console.error('[Jam] Heartbeat:', error.message);
  }
  finally { heartbeating = false; }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);
    if (req.method === 'POST' && url.pathname === '/setup') {
      await beginOauth(await readLocalForm(req), res);
      return;
    }
    if (req.method === 'GET' && url.pathname === '/callback') {
      await finishOauth(url);
      res.writeHead(302, { Location: '/' }).end();
      return;
    }
    if (req.method === 'POST' && url.pathname === '/reconnect') {
      await reconnectController(await readLocalForm(req));
      res.writeHead(302, { Location: '/' }).end();
      return;
    }
    if (req.method === 'POST' && url.pathname === '/retry') {
      await readLocalForm(req);
      await sendHeartbeat();
      res.writeHead(302, { Location: '/' }).end();
      return;
    }
    if (req.method === 'POST' && url.pathname === '/autostart') {
      const form = await readLocalForm(req);
      setAutostart(String(form.get('enabled') || '') === '1');
      res.writeHead(302, { Location: '/' }).end();
      return;
    }
    if (req.method === 'POST' && url.pathname === '/disconnect') {
      await readLocalForm(req);
      state = {
        respawnBaseUrl: state.respawnBaseUrl || DEFAULT_RESPAWN_URL,
        accessToken: state.accessToken || '',
        label: state.label || 'LAN-Musik-PC',
        clientId: state.clientId || '',
        pairingCode: '',
      };
      runtime = {
        needsPairing: false,
        respawn: 'setup',
        respawnMessage: null,
        lastRespawnAt: null,
        spotify: 'authorization_required',
        spotifyMessage: 'Spotify muss verbunden werden.',
      };
      saveState();
      res.writeHead(302, { Location: '/' }).end();
      return;
    }
    res.writeHead(200, pageHeaders());
    res.end(page());
  } catch (error) {
    res.writeHead(400, pageHeaders());
    res.end(page(error instanceof Error ? error.message : 'Einrichtung fehlgeschlagen.', true));
  }
});

server.listen(PORT, HOST, () => {
  serverReady = true;
  console.log(`Respawn Jam-Controller: ${REDIRECT_URI.replace('/callback', '')}`);
  console.log(`Spotify Redirect URI: ${REDIRECT_URI}`);
  if (!state.controllerToken || !state.refreshToken) openSetupPageOnce();
});

server.on('error', (error) => {
  if (error?.code === 'EADDRINUSE') {
    console.log(`Der Jam-Controller läuft bereits auf ${REDIRECT_URI.replace('/callback', '')}.`);
    openSetupPage();
    return;
  }
  throw error;
});

function openSetupPage() {
  if (process.env.JAM_CONTROLLER_NO_OPEN === '1') return;
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

function openSetupPageOnce() {
  if (localPageOpened || !serverReady) return;
  localPageOpened = true;
  openSetupPage();
}

setInterval(pollCommands, 500).unref();
setInterval(sendHeartbeat, 3_000).unref();
if (state.controllerToken) void sendHeartbeat();
