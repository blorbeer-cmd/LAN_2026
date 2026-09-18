// Tiny local control panel for the agent: a plain node:http server (no new
// dependency to bundle into the .exe) bound to 127.0.0.1 only, serving one
// HTML page plus a small JSON API. This is the "GUI" a player uses to pause
// tracking, toggle Windows autostart, or uninstall — all things that
// previously required editing files or the task manager by hand.
//
// Kept deliberately dumb: single page, polls its own status every few
// seconds, no build step, no framework — same philosophy as the rest of this
// project's frontend.

const http = require('http');
const crypto = require('crypto');
const { URL } = require('url');

const ACCESS_KEY_HEADER = 'x-respawn-control-key';
const LAUNCH_TICKET_HEADER = 'x-respawn-control-ticket';
const SESSION_COOKIE = 'respawn_control_session';
const LAUNCH_TICKET_TTL_MS = 30_000;

function randomToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function generateControlAccessKey() {
  return randomToken();
}

function renderPage(scriptNonce = randomToken()) {
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Respawn-Agent – Steuerung</title>
<style>
  :root { color-scheme: dark light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    background: #0f1115; color: #e8e8ea; padding: 24px;
  }
  @media (prefers-color-scheme: light) {
    body { background: #f4f5f7; color: #16181d; }
  }
  .card {
    width: 100%; max-width: 420px; background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.08); border-radius: 16px; padding: 28px;
  }
  @media (prefers-color-scheme: light) {
    .card { background: #fff; border-color: rgba(0,0,0,0.08); box-shadow: 0 2px 12px rgba(0,0,0,0.06); }
  }
  h1 { font-size: 1.15rem; margin: 0 0 4px; }
  .sub { font-size: 0.85rem; opacity: 0.6; margin: 0 0 20px; word-break: break-all; }
  .badge {
    display: inline-flex; align-items: center; gap: 6px; padding: 6px 14px; border-radius: 999px;
    font-size: 0.9rem; font-weight: 600; margin-bottom: 20px;
  }
  .badge.playing { background: rgba(52, 199, 89, 0.15); color: #34c759; }
  .badge.paused { background: rgba(255, 159, 10, 0.18); color: #ff9f0a; }
  .row {
    display: flex; align-items: center; justify-content: space-between; gap: 12px;
    padding: 14px 0; border-top: 1px solid rgba(128,128,128,0.15);
  }
  .row:first-of-type { border-top: none; }
  button {
    font: inherit; cursor: pointer; border: none; border-radius: 10px; padding: 10px 16px;
    font-weight: 600; font-size: 0.9rem; white-space: nowrap;
  }
  .btn-primary { background: #3b82f6; color: white; }
  .btn-danger { background: transparent; color: #ff453a; border: 1px solid rgba(255,69,58,0.5); width: 100%; }
  .btn-cancel { background: rgba(128,128,128,0.15); color: inherit; }
  .switch { position: relative; width: 44px; height: 26px; flex-shrink: 0; }
  .switch input { opacity: 0; width: 0; height: 0; }
  .slider {
    position: absolute; inset: 0; background: rgba(128,128,128,0.4); border-radius: 999px; cursor: pointer;
    transition: 0.15s;
  }
  .slider::before {
    content: ""; position: absolute; width: 20px; height: 20px; left: 3px; top: 3px;
    background: white; border-radius: 50%; transition: 0.15s;
  }
  input:checked + .slider { background: #34c759; }
  input:disabled + .slider { opacity: 0.4; cursor: not-allowed; }
  input:checked + .slider::before { transform: translateX(18px); }
  .danger-zone { margin-top: 22px; padding-top: 16px; border-top: 1px solid rgba(255,69,58,0.25); }
  .hint { font-size: 0.78rem; opacity: 0.55; margin-top: 2px; }
  #msg { font-size: 0.82rem; margin-top: 14px; min-height: 1em; }
</style>
</head>
<body>
  <div class="card" id="card">
    <h1>Respawn-Agent</h1>
    <p class="sub" id="serverUrl">wird geladen…</p>
    <div class="badge" id="statusBadge">…</div>

    <div class="row">
      <div>
        <div>Tracking</div>
        <div class="hint">Fragt den PC nur nach den Spielen aus der Server-Liste und meldet, welche davon laufen. Live-Status, Spielzeit und Auswertungen entstehen nur für das aktuell in deinem Konto ausgewählte Event, wenn es läuft, du zugesagt hast, die Orga Tracking aktiviert hat und deine Einwilligung zum Event-Tracking gültig ist. Andere gleichzeitig laufende Events erhalten daraus keine Live-Daten oder Spielzeit. Ohne diese Voraussetzungen landen die erkannten Spielnamen nur in der Agent-Diagnose, solange der Agent läuft und nicht pausiert ist. Andere Programme werden nicht ausgelesen.</div>
      </div>
      <button class="btn-primary" id="toggleBtn">…</button>
    </div>

    <div class="row">
      <div>
        <div>Erweiterte Daten senden</div>
        <div class="hint" id="activityHint"></div>
      </div>
      <label class="switch">
        <input type="checkbox" id="activityToggle">
        <span class="slider"></span>
      </label>
    </div>

    <div class="row">
      <div>
        <div>Autostart bei Windows-Login</div>
        <div class="hint" id="autostartHint"></div>
      </div>
      <label class="switch">
        <input type="checkbox" id="autostartToggle">
        <span class="slider"></span>
      </label>
    </div>

    <div class="danger-zone">
      <button class="btn-danger" id="uninstallBtn">🗑 Agent komplett deinstallieren</button>
      <div id="uninstallConfirmRow" style="display:flex;gap:10px;margin-top:10px;" hidden>
        <button class="btn-cancel" id="uninstallCancelBtn" style="flex:1;">Abbrechen</button>
        <button class="btn-danger" id="uninstallConfirmBtn" style="width:auto;flex:1;">Ja, deinstallieren</button>
      </div>
      <div class="hint">Entfernt Autostart, beendet den Agent und löscht alle Dateien von diesem PC.</div>
    </div>

    <div id="msg"></div>
  </div>

<script nonce="${scriptNonce}">
const launchTicket = new URLSearchParams(window.location.hash.slice(1)).get('ticket');
if (window.location.hash) history.replaceState(null, '', window.location.pathname);

let sessionReady;
if (launchTicket) {
  sessionReady = fetch('/api/session', {
    method: 'POST',
    headers: { 'X-Respawn-Control-Ticket': launchTicket },
  }).then((res) => {
    if (!res.ok) throw new Error('Der sichere Zugriff ist abgelaufen.');
  });
} else {
  // A reload has no ticket anymore, but can reuse the HttpOnly session cookie.
  sessionReady = Promise.resolve();
}

async function controlFetch(path, options) {
  await sessionReady;
  return fetch(path, options);
}

async function loadStatus() {
  const res = await controlFetch('/api/status');
  if (!res.ok) throw new Error('Bitte die Steuerung über das Tray-Icon oder die Desktop-Verknüpfung öffnen.');
  const s = await res.json();
  document.getElementById('serverUrl').textContent = 'Server: ' + s.serverUrl;
  const badge = document.getElementById('statusBadge');
  badge.textContent = s.paused ? '⏸ Pausiert' : '▶ Aktiv – trackt';
  badge.className = 'badge ' + (s.paused ? 'paused' : 'playing');
  document.getElementById('toggleBtn').textContent = s.paused ? '▶ Fortsetzen' : '⏸ Pausieren';
  const activityToggle = document.getElementById('activityToggle');
  activityToggle.checked = s.trackActivity;
  document.getElementById('activityHint').textContent = s.activityTrackingSupported
    ? 'Zusätzlich: ob eines dieser Spiele im Vordergrund ist und wie lange keine Eingabe kam. Trennt aktive Spielzeit von einem nur nebenbei offenen Spiel (siehe README).'
    : 'Nur unter Windows wirksam, hier ohne Effekt.';
  const autostartToggle = document.getElementById('autostartToggle');
  autostartToggle.checked = s.autostart;
  autostartToggle.disabled = !s.autostartSupported;
  document.getElementById('autostartHint').textContent = s.autostartSupported
    ? (s.autostart ? 'Startet automatisch mit Windows.' : 'Muss manuell gestartet werden.')
    : 'Nur mit der installierten .exe verfügbar.';
  return s;
}

function showMsg(text, isError) {
  const el = document.getElementById('msg');
  el.textContent = text;
  el.style.color = isError ? '#ff453a' : '#34c759';
}

document.getElementById('toggleBtn').addEventListener('click', async () => {
  const s = await loadStatus();
  const action = s.paused ? 'resume' : 'pause';
  const res = await controlFetch('/api/' + action, { method: 'POST' });
  if (res.ok) { await loadStatus(); showMsg(action === 'pause' ? 'Pausiert.' : 'Fortgesetzt.'); }
  else showMsg('Fehler beim Umschalten.', true);
});

document.getElementById('activityToggle').addEventListener('change', async (e) => {
  const enable = e.target.checked;
  const res = await controlFetch('/api/activity-tracking/' + (enable ? 'enable' : 'disable'), { method: 'POST' });
  if (res.ok) { showMsg(enable ? 'Erweiterte Daten aktiviert.' : 'Erweiterte Daten deaktiviert.'); }
  else { e.target.checked = !enable; showMsg('Fehler.', true); }
  await loadStatus();
});

document.getElementById('autostartToggle').addEventListener('change', async (e) => {
  const enable = e.target.checked;
  const res = await controlFetch('/api/autostart/' + (enable ? 'enable' : 'disable'), { method: 'POST' });
  const body = await res.json().catch(() => ({}));
  if (res.ok) showMsg(enable ? 'Autostart aktiviert.' : 'Autostart deaktiviert.');
  else { e.target.checked = !enable; showMsg(body.error || 'Fehler.', true); }
  await loadStatus();
});

document.getElementById('uninstallBtn').addEventListener('click', () => {
  document.getElementById('uninstallBtn').hidden = true;
  document.getElementById('uninstallConfirmRow').hidden = false;
  // Default focus lands on Abbrechen, not the destructive action -- native
  // confirmation dialogs leave focus and the Enter key under the browser's
  // control rather than this page's, which is the hazard this avoids.
  document.getElementById('uninstallCancelBtn').focus();
});
document.getElementById('uninstallCancelBtn').addEventListener('click', () => {
  document.getElementById('uninstallConfirmRow').hidden = true;
  document.getElementById('uninstallBtn').hidden = false;
});
document.getElementById('uninstallConfirmBtn').addEventListener('click', async () => {
  const res = await controlFetch('/api/uninstall', { method: 'POST' });
  if (res.ok) {
    document.getElementById('card').innerHTML =
      '<h1>Deinstalliert</h1><p class="sub">Der Agent wurde beendet und alle Dateien wurden entfernt. Dieses Fenster kannst du jetzt schließen.</p>';
  } else {
    showMsg('Deinstallation fehlgeschlagen.', true);
    document.getElementById('uninstallConfirmRow').hidden = true;
    document.getElementById('uninstallBtn').hidden = false;
  }
});

loadStatus().catch((err) => showMsg(err.message, true));
setInterval(() => loadStatus().catch((err) => showMsg(err.message, true)), 5000);
</script>
</body>
</html>`;
}

function applySecurityHeaders(res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
}

function sendJson(res, status, body) {
  applySecurityHeaders(res);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function expectedOrigin(req) {
  return `http://127.0.0.1:${req.socket.localPort}`;
}

function hasExpectedHost(req) {
  return req.headers.host === `127.0.0.1:${req.socket.localPort}`;
}

function hasForeignBrowserProvenance(req, origin) {
  const requestOrigin = req.headers.origin;
  const fetchSite = req.headers['sec-fetch-site'];
  return (
    (requestOrigin !== undefined && requestOrigin !== origin) ||
    (fetchSite !== undefined && fetchSite !== 'same-origin' && fetchSite !== 'none')
  );
}

function isTopLevelOrSameOriginNavigation(req) {
  const fetchSite = req.headers['sec-fetch-site'];
  if (fetchSite === 'same-origin') return true;
  return (
    fetchSite === 'none' && req.headers['sec-fetch-mode'] === 'navigate' && req.headers['sec-fetch-dest'] === 'document'
  );
}

function isSameOriginBrowserRequest(req, origin, requireOrigin) {
  if (req.headers['sec-fetch-site'] !== 'same-origin') return false;
  if (req.headers.origin !== undefined && req.headers.origin !== origin) return false;
  return !requireOrigin || req.headers.origin === origin;
}

function safeTokenEqual(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string') return false;
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
}

function readCookie(req, name) {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return null;
}

function sessionCookieName(req) {
  return `${SESSION_COOKIE}_${req.socket.localPort}`;
}

// handlers: { getStatus, pause, resume, enableActivityTracking, disableActivityTracking,
// enableAutostart, disableAutostart, uninstall } — all may be sync or return a Promise;
// getStatus returns the full status object.
function createControlServer(handlers, { accessKey } = {}) {
  if (typeof accessKey !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(accessKey)) {
    throw new Error('Ein sicherer lokaler Zugriffsschlüssel ist erforderlich.');
  }

  const launchTickets = new Map();
  const sessions = new Set();

  function pruneLaunchTickets() {
    const now = Date.now();
    for (const [ticket, expiresAt] of launchTickets) {
      if (expiresAt <= now) launchTickets.delete(ticket);
    }
  }

  function issueLaunchTicket() {
    pruneLaunchTickets();
    const ticket = randomToken();
    launchTickets.set(ticket, Date.now() + LAUNCH_TICKET_TTL_MS);
    return ticket;
  }

  function consumeLaunchTicket(ticket) {
    pruneLaunchTickets();
    const expiresAt = launchTickets.get(ticket);
    if (!expiresAt) return false;
    launchTickets.delete(ticket);
    return expiresAt > Date.now();
  }

  function hasSession(req) {
    const session = readCookie(req, sessionCookieName(req));
    return typeof session === 'string' && sessions.has(session);
  }

  return http.createServer(async (req, res) => {
    if (!hasExpectedHost(req)) {
      return sendJson(res, 403, { error: 'Ungültiger Host.' });
    }

    const origin = expectedOrigin(req);
    if (hasForeignBrowserProvenance(req, origin)) {
      return sendJson(res, 403, { error: 'Ungültige Herkunft.' });
    }

    let pathname;
    try {
      pathname = new URL(req.url, origin).pathname;
    } catch {
      return sendJson(res, 400, { error: 'Ungültige Anfrage.' });
    }

    try {
      if (req.method === 'POST' && pathname === '/api/launch') {
        if (req.headers.origin !== undefined || req.headers['sec-fetch-site'] !== undefined) {
          return sendJson(res, 403, { error: 'Browserzugriff ist hier nicht erlaubt.' });
        }
        if (!safeTokenEqual(req.headers[ACCESS_KEY_HEADER], accessKey)) {
          return sendJson(res, 401, { error: 'Zugriff verweigert.' });
        }
        return sendJson(res, 200, { ticket: issueLaunchTicket() });
      }

      if (req.method === 'GET' && pathname === '/') {
        if (!isTopLevelOrSameOriginNavigation(req)) {
          return sendJson(res, 403, { error: 'Ungültige Browsernavigation.' });
        }
        const scriptNonce = randomToken();
        const page = renderPage(scriptNonce);
        applySecurityHeaders(res);
        res.setHeader(
          'Content-Security-Policy',
          `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${scriptNonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
        );
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(page);
      }

      if (req.method === 'POST' && pathname === '/api/session') {
        if (!isSameOriginBrowserRequest(req, origin, true)) {
          return sendJson(res, 403, { error: 'Ungültige Herkunft.' });
        }
        const ticket = req.headers[LAUNCH_TICKET_HEADER];
        if (typeof ticket !== 'string' || !consumeLaunchTicket(ticket)) {
          return sendJson(res, 401, { error: 'Ungültiger oder abgelaufener Zugriff.' });
        }
        const session = randomToken();
        sessions.add(session);
        applySecurityHeaders(res);
        res.setHeader('Set-Cookie', `${sessionCookieName(req)}=${session}; HttpOnly; SameSite=Strict; Path=/`);
        res.writeHead(204);
        return res.end();
      }

      if (pathname.startsWith('/api/')) {
        const requireOrigin = req.method !== 'GET' && req.method !== 'HEAD';
        if (!isSameOriginBrowserRequest(req, origin, requireOrigin)) {
          return sendJson(res, 403, { error: 'Ungültige Herkunft.' });
        }
        if (!hasSession(req)) {
          return sendJson(res, 401, { error: 'Zugriff verweigert.' });
        }
      }

      if (req.method === 'GET' && pathname === '/api/status') {
        return sendJson(res, 200, await handlers.getStatus());
      }
      if (req.method === 'POST' && pathname === '/api/pause') {
        await handlers.pause();
        return sendJson(res, 200, { ok: true });
      }
      if (req.method === 'POST' && pathname === '/api/resume') {
        await handlers.resume();
        return sendJson(res, 200, { ok: true });
      }
      if (req.method === 'POST' && pathname === '/api/activity-tracking/enable') {
        await handlers.enableActivityTracking();
        return sendJson(res, 200, { ok: true });
      }
      if (req.method === 'POST' && pathname === '/api/activity-tracking/disable') {
        await handlers.disableActivityTracking();
        return sendJson(res, 200, { ok: true });
      }
      if (req.method === 'POST' && pathname === '/api/autostart/enable') {
        await handlers.enableAutostart();
        return sendJson(res, 200, { ok: true });
      }
      if (req.method === 'POST' && pathname === '/api/autostart/disable') {
        await handlers.disableAutostart();
        return sendJson(res, 200, { ok: true });
      }
      if (req.method === 'POST' && pathname === '/api/uninstall') {
        await handlers.uninstall();
        return sendJson(res, 200, { ok: true });
      }
      return sendJson(res, 404, { error: 'Nicht gefunden.' });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  });
}

// Binds to 127.0.0.1 only (never LAN-reachable — this is a per-player local
// control panel, not something teammates should be able to poke at) and
// falls back to the next port if the preferred one is taken.
function listenWithRetry(server, preferredPort, attempts = 5) {
  return new Promise((resolve, reject) => {
    let port = preferredPort;
    let triesLeft = attempts;

    function onError(err) {
      if (err.code === 'EADDRINUSE' && triesLeft > 0) {
        triesLeft -= 1;
        port += 1;
        attempt();
      } else {
        reject(err);
      }
    }

    function attempt() {
      server.once('error', onError);
      server.listen(port, '127.0.0.1', () => {
        server.removeListener('error', onError);
        resolve({ port });
      });
    }

    attempt();
  });
}

module.exports = { createControlServer, generateControlAccessKey, listenWithRetry, renderPage };
