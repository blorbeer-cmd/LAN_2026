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
const SCOPES = [
  'user-read-playback-state',
  'user-modify-playback-state',
  'streaming',
  'user-read-email',
  'user-read-private',
].join(' ');
const WEB_PLAYBACK_SCOPES = ['streaming', 'user-read-email', 'user-read-private'];
const DEFAULT_RESPAWN_URL = 'https://lan.dbehnke.dev';
const REQUEST_TIMEOUT_MS = Math.max(100, Number(process.env.JAM_CONTROLLER_REQUEST_TIMEOUT_MS || 10_000));
const SPOTIFY_API_BASE_URL = String(
  process.env.JAM_CONTROLLER_SPOTIFY_API_BASE_URL || 'https://api.spotify.com/v1',
).replace(/\/+$/, '');
const SPOTIFY_STATUS_GRACE_MS = Math.max(
  0,
  Number(process.env.JAM_CONTROLLER_SPOTIFY_STATUS_GRACE_MS || 30_000),
);
const HEARTBEAT_INTERVAL_MS = Math.max(
  100,
  Number(process.env.JAM_CONTROLLER_HEARTBEAT_INTERVAL_MS || 3_000),
);
// Spotify counts every request against one shared quota per developer app.
// A controller that asked at the heartbeat rate around the clock got the app
// blocked for hours. So the Respawn heartbeat keeps its pace, but Spotify is
// asked right after every change, shortly after the expected end of the song
// and otherwise only rarely. Respawn extrapolates the progress in between.
const SPOTIFY_ACTIVE_STATUS_INTERVAL_MS = Math.max(
  100,
  Number(process.env.JAM_CONTROLLER_SPOTIFY_ACTIVE_STATUS_INTERVAL_MS || 20_000),
);
const SPOTIFY_IDLE_STATUS_INTERVAL_MS = Math.max(
  100,
  Number(process.env.JAM_CONTROLLER_SPOTIFY_IDLE_STATUS_INTERVAL_MS || 60_000),
);
// Gives Spotify time to switch to the next song before asking again.
const SPOTIFY_TRACK_END_DELAY_MS = 1_500;
// While the Respawn browser player on this computer plays, it reports every
// song change and pause itself. Spotify is then asked only as a safety net.
const SPOTIFY_BROWSER_STATUS_INTERVAL_MS = Math.max(
  100,
  Number(process.env.JAM_CONTROLLER_SPOTIFY_BROWSER_STATUS_INTERVAL_MS || 60_000),
);
const BROWSER_STATE_MAX_BYTES = 8_000;
const LOCAL_FORM_TOKEN = crypto.randomBytes(24).toString('base64url');

let state = { ...loadBootstrap(), ...loadState() };
let oauthPending = null;
let scheduledPlayback = null;
let polling = false;
let heartbeating = false;
let queueRefreshing = false;
let localPageOpened = false;
let serverReady = false;
let lastSpotifyPlaybackAt = 0;
let nextSpotifyStatusAt = 0;
let spotifyStatusRequests = 0;
// Older Respawn servers do not report the Jam state. Until a heartbeat says
// otherwise, keep the Jam rate so a running Jam never goes stale.
let jamSessionActive = true;
let spotifyQueueRefreshRequested = false;
// Latest playback reported by the local browser player, in the shape of
// Spotify's GET /me/player answer, waiting for the next heartbeat.
let browserPlayback = null;
// Spotify device of the browser player while it reports its own state.
let browserDeviceId = null;
let lastSpotifyQueueContextUri = null;
let lastSpotifyQueueTrackUri = null;
let spotifyRetryAt = 0;
// Times of the Spotify Web API requests in the last hour, shown on the local
// page so the load can be checked against Spotify's quota before a LAN.
let spotifyRequestTimes = [];
let spotifyQueueCache = { contextUri: null, currentTrackUri: null, tracks: [] };
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
    // Browsers apply form-action to redirects as well: the Spotify login
    // form posts here and is redirected to Spotify's authorization page.
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://accounts.spotify.com; base-uri 'none'; frame-ancestors 'none'",
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  };
}

function spotifyScopes() {
  return new Set(String(state.spotifyScopes || '').split(/\s+/).filter(Boolean));
}

function webPlaybackAuthorized() {
  const scopes = spotifyScopes();
  return Boolean(state.refreshToken) && WEB_PLAYBACK_SCOPES.every((scope) => scopes.has(scope));
}

function respawnOrigin() {
  try {
    return new URL(state.respawnBaseUrl).origin;
  } catch {
    return null;
  }
}

function localApiHeaders(req) {
  // This is a browser-origin boundary: it prevents an arbitrary website from
  // reading the Spotify token through loopback. It is deliberately not an OS
  // process boundary. A process running as this user can already read the
  // same token from STORE_FILE; LOCAL_FORM_TOKEN protects state-changing HTML
  // forms but cannot be shared with the cross-origin Respawn Web Player.
  const origin = String(req.headers.origin || '');
  if (!origin || origin !== respawnOrigin()) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Private-Network': 'true',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'Vary': 'Origin',
    'X-Content-Type-Options': 'nosniff',
  };
}

function writeJson(res, status, data, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(JSON.stringify(data));
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
  return `
    <ol class="steps">
      <li><span class="num">1</span><span><a href="https://developer.spotify.com/dashboard" target="_blank" rel="noopener">Spotify Developer Dashboard</a> öffnen und eine App öffnen oder einmalig anlegen</span></li>
      <li><span class="num">2</span><span>In der App <strong>Web API</strong> und <strong>Web Playback SDK</strong> aktivieren</span></li>
      <li><span class="num">3</span><span>Unter „Redirect URIs“ exakt <code>${REDIRECT_URI}</code> eintragen</span></li>
      <li><span class="num">4</span><span>Die Client-ID aus „Basic Information“ unten eintragen</span></li>
    </ol>
    <label><span class="field-label">Respawn-Adresse</span><input name="respawnBaseUrl" type="url" required placeholder="https://lan.example.de" value="${htmlEscape(state.respawnBaseUrl || DEFAULT_RESPAWN_URL)}"></label>
    ${includePairing ? `<div class="row"><label><span class="field-label">Kopplungscode</span><input name="pairingCode" required autocomplete="off" maxlength="12" placeholder="WU8EV66L" value="${htmlEscape(state.pairingCode || '')}"></label><label><span class="field-label">Gerätename</span><input name="label" required placeholder="Kiosk-Pi Wohnzimmer" value="${htmlEscape(state.label || 'LAN-Musik-PC')}"></label></div>` : ''}
    <label><span class="field-label">Spotify Client-ID</span><input name="clientId" required autocomplete="off" placeholder="35e006839ca741a28d63cbbd8f1d51b4" value="${htmlEscape(state.clientId || '')}"></label>
    <details class="section"><summary>Erweitert<span class="chevron" aria-hidden="true">›</span></summary><div class="section-body"><label><span class="field-label">Respawn-Zugangstoken</span><input name="accessToken" type="password" value="${htmlEscape(state.accessToken || '')}"></label><p class="note">Nur für einen Respawn-Server mit altem gemeinsamen Zugangsschutz nötig.</p></div></details>`;
}

// Mirrors the Respawn design tokens (server/public/css/style.css). The page is
// served standalone by the controller, so it cannot load the app stylesheet.
const PAGE_CSS = `
:root{color-scheme:dark;--bg:#0f1420;--bg-elevated:#171e2e;--bg-elevated-2:#1e2740;--border:rgba(122,141,195,.21);--text:#eef1f8;--text-muted:#8b93a7;--accent:#5b8cff;--accent-gradient:linear-gradient(135deg,#5b8cff 0%,#9163f5 55%,#ef5da8 100%);--danger:#ef4444}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:start center;padding:48px 16px;background:var(--bg);color:var(--text);font:15px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.card{width:min(640px,100%);display:grid;gap:12px;padding:16px;border:1px solid var(--border);border-radius:14px;background:var(--bg-elevated)}
h1,h2,p{margin:0}h1{font-size:1.3rem;font-weight:800}h2{font-size:1.15rem;font-weight:700}
.meta,.note{color:var(--text-muted);font-size:.85rem}.error{color:var(--danger);font-size:.85rem}.ok{font-size:.85rem}
a{color:var(--accent)}
.status{display:grid}.status div{display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-top:1px solid var(--border)}.status span{color:var(--text-muted)}.status div:last-child{padding-bottom:0}
.steps{display:grid;margin:0;padding:0;list-style:none}.steps li{display:grid;grid-template-columns:20px minmax(0,1fr);gap:12px;padding:8px 0;border-top:1px solid var(--border);font-size:.85rem;color:var(--text-muted)}.steps .num{font-weight:700}.steps strong{color:var(--text)}
form{display:grid;gap:12px}label{display:grid;gap:4px}.field-label{margin-left:2px;color:var(--text-muted);font-size:.78rem}
input{min-height:32px;padding:5px 12px;border:1px solid var(--border);border-radius:8px;background:var(--bg-elevated-2);color:var(--text);font:inherit}input::placeholder{font-style:italic;color:var(--text-muted)}input:focus-visible,button:focus-visible,summary:focus-visible,a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.reset,.divided{padding-top:12px;border-top:1px solid var(--border)}.divided .steps li:first-child{border-top:0;padding-top:0}.check{display:flex;align-items:center;gap:8px;color:var(--text-muted);font-size:.85rem}.check input{min-height:0;width:16px;height:16px;accent-color:var(--accent)}
.actions{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px}.actions form{display:contents}.actions.equal{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}.actions.equal button{width:100%}
button{min-height:32px;padding:6px 20px;border:0;border-radius:8px;background:var(--bg-elevated-2);color:var(--text);font:inherit;font-size:.85rem;font-weight:600;cursor:pointer;white-space:nowrap}
button.primary{background:var(--accent-gradient);color:#fff}
code{padding:1px 6px;border-radius:4px;background:var(--bg);font-size:.85em;word-break:break-all}
details.section{border:1px solid var(--border);border-radius:14px;background:var(--bg-elevated)}details.section>summary{display:flex;justify-content:space-between;align-items:center;min-height:44px;padding:0 16px;font-weight:700;cursor:pointer;list-style:none}details.section>summary::-webkit-details-marker{display:none}.chevron{color:var(--text-muted);transition:transform .15s ease}details[open]>summary .chevron{transform:rotate(90deg)}.section-body{display:grid;gap:12px;padding:0 16px 16px}
.card details.section{background:transparent;border-radius:8px}.card details.section>summary{font-weight:600;font-size:.85rem;padding:0 12px}.card .section-body{padding:0 12px 12px}
@media(prefers-reduced-motion:reduce){.chevron{transition:none}}
@media(max-width:600px){.row{grid-template-columns:1fr}.actions.equal button{white-space:normal}.actions>button,.actions form>button{flex:1 1 auto}}
`;

function page(message = '', isError = false) {
  const hasController = Boolean(state.controllerToken);
  const hasSpotify = Boolean(state.refreshToken);
  const needsPairing = !hasController || runtime.needsPairing;
  const autostart = autostartEnabled();
  const browserPlaybackReady = webPlaybackAuthorized();
  const csrf = `<input type="hidden" name="_csrf" value="${LOCAL_FORM_TOKEN}">`;
  const statusLabel = (value) => value === 'connected' ? 'Verbunden' : value === 'connecting' ? 'Verbindet' : value === 'authorization_required' ? 'Anmeldung nötig' : value === 'setup' ? 'Einrichtung nötig' : 'Neuer Versuch läuft';
  const spotifyForm = (label, primary) => `<form method="post" action="/setup">${csrf}<input type="hidden" name="intent" value="spotify">${setupFields({ includePairing: false })}<div class="actions"><button${primary ? ' class="primary"' : ''}>${label}</button></div></form>`;
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Respawn Jam-Controller</title><style>${PAGE_CSS}</style></head><body><main class="card">
  <h1>Jam-Controller</h1>
  <p class="meta">${hasController && !needsPairing
    ? `<strong>${htmlEscape(state.label)}</strong> · ${htmlEscape(state.spotifyDisplayName || 'Spotify')}`
    : 'Spotify läuft auf diesem Gerät.'}</p>
  ${message ? `<p class="${isError ? 'error' : 'ok'}">${htmlEscape(message)}</p>` : ''}
  ${needsPairing && hasSpotify ? `
    <h2>Wieder verbinden</h2>
    <p class="note">Auf der Jam-Seite in Respawn einen neuen Kopplungscode erzeugen und hier eintragen. Kein Download und keine neue Spotify-Anmeldung nötig.</p>
    <form method="post" action="/reconnect">
      ${csrf}
      <label><span class="field-label">Respawn-Adresse</span><input name="respawnBaseUrl" type="url" required placeholder="https://lan.example.de" value="${htmlEscape(state.respawnBaseUrl || DEFAULT_RESPAWN_URL)}"></label>
      <div class="row"><label><span class="field-label">Kopplungscode</span><input name="pairingCode" required autocomplete="off" maxlength="12" placeholder="WU8EV66L" value="${htmlEscape(state.pairingCode || '')}"></label><label><span class="field-label">Gerätename</span><input name="label" required placeholder="Kiosk-Pi Wohnzimmer" value="${htmlEscape(state.label || 'LAN-Musik-PC')}"></label></div>
      <div class="actions"><button class="primary">Wieder verbinden</button></div>
    </form>` : needsPairing ? `
    <h2>Einmalig einrichten</h2>
    <p class="note">Respawn-Adresse und Kopplungscode stammen aus dem Paket. Danach genügen Autostart oder dieselbe Startdatei.</p>
    <form method="post" action="/setup">${csrf}
      <input type="hidden" name="intent" value="initial">
      ${setupFields({ includePairing: true })}
      <div class="actions"><button class="primary">Mit Spotify verbinden</button></div>
    </form>` : !hasSpotify ? `
    <h2>Spotify-Anmeldung erneuern</h2>
    <p class="note">Respawn ist erreichbar, aber Spotify braucht eine neue Anmeldung.</p>
    ${spotifyForm('Spotify neu verbinden', true)}` : `
    <div class="status">
      <div><span>Respawn</span><strong>${htmlEscape(statusLabel(runtime.respawn))}</strong></div>
      <div><span>Spotify</span><strong>${htmlEscape(statusLabel(runtime.spotify))}</strong></div>
      <div><span>Browser-/Kiosk-Ton</span><strong>${browserPlaybackReady ? 'Bereit' : 'Freigabe nötig'}</strong></div>
      <div><span>Spotify-Anfragen in der letzten Stunde</span><strong>${spotifyRequestsLastHour()}</strong></div>
    </div>
    ${spotifyRequestTimes.length ? `<p class="note" id="spotify-request-kinds">Davon: ${htmlEscape(spotifyRequestBreakdown())}</p>` : ''}
    ${runtime.respawnMessage ? `<p class="note">${htmlEscape(runtime.respawnMessage)}</p>` : ''}
    ${runtime.spotifyMessage ? `<p class="note">${htmlEscape(runtime.spotifyMessage)}</p>` : ''}
    <p class="note">Verbunden mit ${htmlEscape(state.respawnBaseUrl)}. Abbrüche werden automatisch erneut versucht; diese Seite muss nicht offen bleiben.</p>
    <div class="actions equal">
      <form method="post" action="/autostart">${csrf}<input type="hidden" name="enabled" value="${autostart ? '0' : '1'}"><button>${autostart ? 'Autostart deaktivieren' : 'Autostart aktivieren'}</button></form>
      <form method="post" action="/retry">${csrf}<button>Verbindung prüfen</button></form>
    </div>
    ${browserPlaybackReady ? '' : `<details class="section" open><summary>Browser-Wiedergabe freigeben<span class="chevron" aria-hidden="true">›</span></summary><div class="section-body">
      <p class="note">Damit der Musik-PC den Ton über Browser, HDMI oder TV ausgibt, Spotify einmal neu freigeben.</p>
      ${spotifyForm('Freigeben', true)}
    </div></details>`}
    <details class="section"><summary>Verbindung verwalten<span class="chevron" aria-hidden="true">›</span></summary><div class="section-body">
      <form method="post" action="/reconnect">
        ${csrf}
        <p class="note">Mit einem neuen Kopplungscode von der Jam-Seite lässt sich dieser Controller an einen anderen Respawn-Server oder neu koppeln.</p>
        <label><span class="field-label">Respawn-Adresse</span><input name="respawnBaseUrl" type="url" required placeholder="https://lan.example.de" value="${htmlEscape(state.respawnBaseUrl || DEFAULT_RESPAWN_URL)}"></label>
        <div class="row"><label><span class="field-label">Kopplungscode</span><input name="pairingCode" required autocomplete="off" maxlength="12" placeholder="WU8EV66L"></label><label><span class="field-label">Gerätename</span><input name="label" required placeholder="Kiosk-Pi Wohnzimmer" value="${htmlEscape(state.label || 'LAN-Musik-PC')}"></label></div>
        <div class="actions"><button>Neu koppeln</button></div>
      </form>
      <form method="post" action="/setup" id="renew-form" class="divided">${csrf}<input type="hidden" name="intent" value="spotify">${setupFields({ includePairing: false })}</form>
      <form method="post" action="/disconnect" id="reset-form" class="reset">${csrf}<label class="check"><input type="checkbox" required><span>Zum Zurücksetzen bestätigen: Spotify-Anmeldung und Kopplung auf diesem Gerät löschen</span></label></form>
      <div class="actions equal"><button form="renew-form">Spotify-Anmeldung erneuern</button><button form="reset-form">Zurücksetzen</button></div>
    </div></details>`}
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

function readJsonBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let body = '';
    let tooLarge = false;
    req.on('data', (chunk) => {
      if (tooLarge) return;
      body += chunk;
      if (Buffer.byteLength(body) > maxBytes) tooLarge = true;
    });
    req.on('end', () => {
      if (tooLarge) { reject(new Error('Anfrage ist zu groß.')); return; }
      try { resolve(JSON.parse(body || 'null')); } catch { reject(new Error('Anfrage ist kein gültiges JSON.')); }
    });
    req.on('error', reject);
  });
}

function boundedText(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function boundedInteger(value, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(0, Math.round(number))) : 0;
}

// Turns the compact report of the browser player into the shape of Spotify's
// GET /me/player answer, so heartbeat and queue code need no second path.
// Returns undefined for an invalid report and null when the player stopped.
function browserPlaybackFromReport(report) {
  const deviceId = typeof report?.deviceId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(report.deviceId)
    ? report.deviceId
    : null;
  if (!deviceId || !Object.hasOwn(report, 'state')) return undefined;
  if (report.state === null) return null;
  const reported = report.state;
  const track = reported?.track;
  if (!track || typeof track.uri !== 'string' || !/^spotify:track:[A-Za-z0-9]{22}$/.test(track.uri)) return undefined;
  if (typeof reported.isPlaying !== 'boolean') return undefined;
  const contextUri = typeof reported.contextUri === 'string'
    && /^spotify:(playlist|album|artist):[A-Za-z0-9]{22}$/.test(reported.contextUri)
    ? reported.contextUri
    : null;
  const durationMs = boundedInteger(track.durationMs, 24 * 60 * 60_000);
  const imageUrl = typeof track.imageUrl === 'string' && /^https:\/\/[^\s"'<>]{1,500}$/.test(track.imageUrl)
    ? track.imageUrl
    : null;
  return {
    item: {
      id: track.uri.slice('spotify:track:'.length),
      uri: track.uri,
      name: boundedText(track.name, 300),
      duration_ms: durationMs,
      artists: (Array.isArray(track.artists) ? track.artists : []).slice(0, 10)
        .map((name) => ({ name: boundedText(name, 200) })).filter((artist) => artist.name),
      album: { name: boundedText(track.album, 300), images: imageUrl ? [{ url: imageUrl }] : [] },
    },
    device: { id: deviceId },
    context: contextUri ? { type: contextUri.split(':')[1], uri: contextUri } : null,
    is_playing: reported.isPlaying,
    progress_ms: Math.min(durationMs, boundedInteger(reported.progressMs, durationMs)),
  };
}

function acceptBrowserPlayback(playback) {
  if (playback === null) {
    // The browser player stopped or Spotify moved on to another device: only
    // Spotify itself knows what plays now.
    browserPlayback = null;
    browserDeviceId = null;
    requestSpotifyStatus();
  } else {
    browserPlayback = playback;
    browserDeviceId = playback.device.id;
  }
  void sendHeartbeat();
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
  // A new app gets one fresh attempt. In practice Spotify's long quota block
  // applied to the account across apps; the attempt then restores the block.
  if (oauthPending.clientId !== state.clientId) spotifyRetryAt = 0;
  state = {
    respawnBaseUrl: oauthPending.respawnBaseUrl,
    accessToken: oauthPending.accessToken,
    label: oauthPending.label,
    clientId: oauthPending.clientId,
    controllerId: registration.controllerId,
    controllerToken: registration.controllerToken,
    groupId: registration.groupId,
    spotifyDisplayName: profile.display_name || profile.id,
    spotifyScopes: tokens.scope || SCOPES,
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
  void refreshSpotifyStatusNow();
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
  await refreshSpotifyStatusNow();
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
  if (data.scope) state.spotifyScopes = data.scope;
  state.expiresAt = Date.now() + Number(data.expires_in || 3600) * 1000;
  saveState();
  return state.accessTokenSpotify;
}

function spotifyRequestKind(pathname, method = 'GET') {
  const path = pathname.split('?')[0];
  if (method === 'GET' && path === '/me/player') return 'Status';
  if (method === 'GET' && path === '/me/player/queue') return 'Warteschlange';
  if (path === '/me/player/devices') return 'Geräte';
  if (path === '/search') return 'Suche';
  if (path.startsWith('/tracks/') || path.startsWith('/playlists/')) return 'Titel und Playlists';
  return 'Befehle';
}

function spotifyRequestsLastHour() {
  const since = Date.now() - 60 * 60_000;
  spotifyRequestTimes = spotifyRequestTimes.filter((entry) => entry.time > since);
  return spotifyRequestTimes.length;
}

// Shows where the quota goes, so the load can be checked before a LAN.
function spotifyRequestBreakdown() {
  const counts = new Map();
  spotifyRequestsLastHour();
  for (const { kind } of spotifyRequestTimes) counts.set(kind, (counts.get(kind) || 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1]).map(([kind, count]) => `${kind} ${count}`).join(' · ');
}

async function spotify(pathname, options = {}) {
  if (Date.now() < spotifyRetryAt) {
    throw new Error('Spotify begrenzt Anfragen gerade. Der Controller wartet vor dem nächsten Versuch.');
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const token = await spotifyToken();
    spotifyRequestTimes.push({ time: Date.now(), kind: spotifyRequestKind(pathname, options.method) });
    if (spotifyRequestTimes.length > 5_000) spotifyRequestsLastHour();
    const response = await fetchWithTimeout(`${SPOTIFY_API_BASE_URL}${pathname}`, {
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
    if (response.status === 429) {
      const retryAfter = response.headers.get('retry-after');
      const seconds = Number(retryAfter);
      const retryAfterMs = Number.isFinite(seconds)
        ? seconds * 1000
        : Math.max(0, Date.parse(retryAfter || '') - Date.now());
      spotifyRetryAt = Date.now() + Math.max(1_000, retryAfterMs || 5_000);
      throw new Error('Spotify begrenzt Anfragen gerade. Der Controller versucht es automatisch erneut.');
    }
    if (response.status >= 500 && attempt === 0) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      continue;
    }
    if (!response.ok) throw new Error(data?.error?.message || `Spotify antwortet mit ${response.status}.`);
    spotifyRetryAt = 0;
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

// Only commands that change what plays replace the planned switch at the
// end of the current song. Lookups (search, track, playlist, devices) must
// keep it: otherwise a search during the last request cancels the pause
// and Spotify's own autoplay fills the silence with unrequested songs.
const PLAYBACK_COMMANDS = new Set(['playUris', 'playContext', 'transfer', 'pause', 'resume', 'next']);

async function executeCommand(type, payload = {}) {
  if (PLAYBACK_COMMANDS.has(type)) clearSchedule();
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
  if (type === 'playlist') {
    if (!/^[A-Za-z0-9]{22}$/.test(payload.playlistId || '')) throw new Error('Ungültige Spotify-Playlist.');
    return publicPlaylist(await spotify(`/playlists/${encodeURIComponent(payload.playlistId)}?fields=id,uri,name,owner(display_name,id),images,tracks(total)`));
  }
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
  if (type === 'transfer') {
    await spotify('/me/player', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_ids: [payload.deviceId], play: Boolean(payload.playing) }),
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
        const type = payload.uris?.length ? 'playUris' : 'pause';
        await executeCommand(type, { deviceId: payload.deviceId, uris: payload.uris });
        followUpCommand(type, { deviceId: payload.deviceId });
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
        // A started or changed Jam must show its new state at once, even
        // before the next heartbeat reports the session as active.
        followUpCommand(command.type, command.payload);
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

function prepareSpotifyQueueCache(playback) {
  const contextUri = playback?.context?.type === 'playlist' ? playback.context.uri || null : null;
  const currentTrackUri = playback?.item?.uri || null;
  if (!contextUri) {
    spotifyQueueCache = { contextUri: null, currentTrackUri: null, tracks: [] };
    return;
  }
  if (spotifyQueueCache.contextUri !== contextUri || spotifyQueueCache.currentTrackUri !== currentTrackUri) {
    spotifyQueueCache = { contextUri, currentTrackUri, tracks: [] };
  }
}

function publicSpotifyPlayback(playback) {
  const playlistContext = playback?.context?.type === 'playlist';
  const contextUri = playlistContext ? playback.context.uri || null : null;
  const upcomingTracks = contextUri && spotifyQueueCache.contextUri === contextUri
    ? spotifyQueueCache.tracks
    : [];
  return playback ? {
    track: publicTrack(playback.item), deviceId: playback.device?.id || null,
    context: playback.context ? { type: playback.context.type || null, uri: playback.context.uri || null } : null,
    nextTrack: upcomingTracks[0] || null,
    ...(playlistContext ? { upcomingTracks } : {}),
    isPlaying: Boolean(playback.is_playing), progressMs: Number(playback.progress_ms || 0),
  } : null;
}

async function refreshSpotifyQueue(playback) {
  const contextUri = playback?.context?.type === 'playlist' ? playback.context.uri || null : null;
  if (!contextUri || queueRefreshing) return;
  const currentTrackUri = playback?.item?.uri || null;
  const playbackChanged = lastSpotifyQueueContextUri !== contextUri
    || lastSpotifyQueueTrackUri !== currentTrackUri;
  // The upcoming songs only change with the song, the playlist or a request.
  if (!playbackChanged && !spotifyQueueRefreshRequested) return;

  queueRefreshing = true;
  spotifyQueueRefreshRequested = false;
  lastSpotifyQueueContextUri = contextUri;
  lastSpotifyQueueTrackUri = currentTrackUri;
  try {
    const queue = await spotify('/me/player/queue');
    if (spotifyQueueCache.contextUri === contextUri
      && spotifyQueueCache.currentTrackUri === currentTrackUri) {
      spotifyQueueCache = {
        contextUri,
        currentTrackUri,
        tracks: (queue?.queue || []).slice(0, 10).map(publicTrack).filter(Boolean),
      };
    }
  } catch (error) {
    spotifyQueueRefreshRequested = true;
    console.error('[Jam] Spotify-Warteschlange:', error.message);
  } finally {
    queueRefreshing = false;
  }
}

async function postControllerHeartbeat(controllerToken, playbackAvailable, playback) {
  try {
    const heartbeat = {
      spotifyDisplayName: state.spotifyDisplayName,
      connectionStatus: { spotify: runtime.spotify, message: runtime.spotifyMessage },
    };
    if (playbackAvailable) heartbeat.playback = publicSpotifyPlayback(playback);
    const response = await respawnFetch('/api/music/controller/heartbeat', { method: 'POST', body: JSON.stringify(heartbeat) });
    const wasActive = jamSessionActive;
    jamSessionActive = response?.sessionActive !== false;
    if (jamSessionActive && !wasActive) requestSpotifyStatus();
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
}

function requestSpotifyStatus({ queue = true } = {}) {
  spotifyStatusRequests += 1;
  nextSpotifyStatusAt = 0;
  if (queue) spotifyQueueRefreshRequested = true;
}

// Decides what Spotify must be asked after a successful command. Every check
// costs quota, so only what the command can have changed is read again.
function followUpCommand(type, payload = {}) {
  if (type === 'queueTrack') {
    // Only Spotify's live queue changes, and Respawn shows it for playlists only.
    if (spotifyQueueCache.contextUri) requestSpotifyStatus();
    return;
  }
  if (!PLAYBACK_COMMANDS.has(type)) return;
  const queueMayChange = type !== 'pause' && type !== 'resume';
  if (browserDeviceId && payload.deviceId === browserDeviceId) {
    // The browser player reports the new state itself.
    if (queueMayChange) spotifyQueueRefreshRequested = true;
    return;
  }
  requestSpotifyStatus({ queue: queueMayChange });
}

function scheduleSpotifyStatus(playback) {
  const now = Date.now();
  let next = now + (jamSessionActive ? SPOTIFY_ACTIVE_STATUS_INTERVAL_MS : SPOTIFY_IDLE_STATUS_INTERVAL_MS);
  const durationMs = Number(playback?.item?.duration_ms || 0);
  if (jamSessionActive && playback?.is_playing && durationMs > 0) {
    const remainingMs = Math.max(0, durationMs - Number(playback.progress_ms || 0));
    next = Math.min(next, now + remainingMs + SPOTIFY_TRACK_END_DELAY_MS);
  }
  nextSpotifyStatusAt = next;
}

const SPOTIFY_LONG_BLOCK_MS = 60_000;

function markSpotifyUnavailable() {
  const now = Date.now();
  const longBlock = spotifyRetryAt - now > SPOTIFY_LONG_BLOCK_MS;
  const withinGracePeriod = lastSpotifyPlaybackAt > 0 && now - lastSpotifyPlaybackAt <= SPOTIFY_STATUS_GRACE_MS;
  if (withinGracePeriod && !longBlock) return;
  runtime.spotify = 'unavailable';
  if (!longBlock) {
    runtime.spotifyMessage = 'Spotify ist vorübergehend nicht erreichbar. Es wird automatisch erneut versucht.';
    return;
  }
  // A long Spotify block outlasts any retry, so name its end on the local
  // page and in Jam instead of suggesting a short outage.
  const until = new Date(spotifyRetryAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  runtime.spotifyMessage = `Spotify sperrt die Wiedergabesteuerung dieses Spotify-Kontos wegen zu vieler Anfragen bis etwa ${until} Uhr. `
    + 'Eine andere Spotify-App hilft dagegen nicht. Danach verbindet sich der Controller automatisch wieder.';
}

async function sendHeartbeat() {
  if (heartbeating || !state.controllerToken || runtime.needsPairing) return;
  heartbeating = true;
  const controllerToken = state.controllerToken;
  try {
    let playbackAvailable = false;
    let publicPlayback = null;
    const now = Date.now();
    if (browserPlayback) {
      // Fresh from the browser player: needs no Spotify request, even during
      // a Spotify block. A change requested meanwhile keeps its own check.
      const playback = browserPlayback;
      browserPlayback = null;
      playbackAvailable = true;
      lastSpotifyPlaybackAt = now;
      prepareSpotifyQueueCache(playback);
      publicPlayback = playback;
      if (nextSpotifyStatusAt > 0) nextSpotifyStatusAt = Math.max(nextSpotifyStatusAt, now + SPOTIFY_BROWSER_STATUS_INTERVAL_MS);
    } else if (now < spotifyRetryAt) {
      // Asking again during a Spotify block only fills the log.
      markSpotifyUnavailable();
    } else if (now >= nextSpotifyStatusAt) {
      // Planned before the request: a failure waits for the next regular slot.
      // A change requested meanwhile keeps its immediate check, because this
      // answer may predate it.
      const requestsBefore = spotifyStatusRequests;
      scheduleSpotifyStatus(null);
      try {
        const playback = await spotify('/me/player');
        if (spotifyStatusRequests === requestsBefore) scheduleSpotifyStatus(playback);
        playbackAvailable = true;
        lastSpotifyPlaybackAt = Date.now();
        prepareSpotifyQueueCache(playback);
        publicPlayback = playback;
        runtime.spotify = 'connected';
        runtime.spotifyMessage = null;
      } catch (error) {
        if (error instanceof SpotifyAuthorizationError) {
          markSpotifyAuthorizationRequired(error.message);
        } else {
          markSpotifyUnavailable();
          console.error('[Jam] Spotify-Status:', error.message);
        }
      }
    }
    await postControllerHeartbeat(controllerToken, playbackAvailable, publicPlayback);
    if (playbackAvailable && publicPlayback) void refreshSpotifyQueue(publicPlayback);
  } finally {
    heartbeating = false;
  }
}

function refreshSpotifyStatusNow() {
  requestSpotifyStatus();
  return sendHeartbeat();
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${HOST}:${PORT}`);
    if (url.pathname === '/web-player/state') {
      const headers = localApiHeaders(req);
      if (!headers) {
        writeJson(res, 403, { error: 'Diese lokale Anfrage ist für die konfigurierte Respawn-Adresse nicht freigegeben.' });
        return;
      }
      if (req.method === 'OPTIONS') {
        res.writeHead(204, headers).end();
        return;
      }
      if (req.method !== 'POST') {
        writeJson(res, 405, { error: 'Methode nicht erlaubt.' }, headers);
        return;
      }
      let playback;
      try {
        playback = browserPlaybackFromReport(await readJsonBody(req, BROWSER_STATE_MAX_BYTES));
      } catch (error) {
        writeJson(res, 400, { error: error.message }, headers);
        return;
      }
      if (playback === undefined) {
        writeJson(res, 400, { error: 'Ungültiger Wiedergabestand.' }, headers);
        return;
      }
      acceptBrowserPlayback(playback);
      res.writeHead(204, headers).end();
      return;
    }
    if (url.pathname === '/web-player/status' || url.pathname === '/web-player/token') {
      const headers = localApiHeaders(req);
      if (!headers) {
        writeJson(res, 403, { error: 'Diese lokale Anfrage ist für die konfigurierte Respawn-Adresse nicht freigegeben.' });
        return;
      }
      if (req.method === 'OPTIONS') {
        res.writeHead(204, headers).end();
        return;
      }
      if (req.method !== 'GET') {
        writeJson(res, 405, { error: 'Methode nicht erlaubt.' }, headers);
        return;
      }
      const ready = webPlaybackAuthorized();
      if (url.pathname === '/web-player/status') {
        writeJson(res, 200, {
          available: true,
          ready,
          playerName: `Respawn · ${state.label || 'Musik-PC'}`,
          message: ready ? null : 'Spotify im lokalen Controller einmal für Browser-Wiedergabe neu freigeben.',
        }, headers);
        return;
      }
      if (!ready) {
        writeJson(res, 409, {
          error: 'Spotify im lokalen Controller einmal für Browser-Wiedergabe neu freigeben.',
        }, headers);
        return;
      }
      writeJson(res, 200, { accessToken: await spotifyToken() }, headers);
      return;
    }
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
      await refreshSpotifyStatusNow();
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
setInterval(sendHeartbeat, HEARTBEAT_INTERVAL_MS).unref();
if (state.controllerToken) void sendHeartbeat();
