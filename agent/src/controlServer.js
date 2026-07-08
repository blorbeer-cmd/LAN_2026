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
const { URL } = require('url');

function renderPage() {
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>RespawnHQ-Agent – Steuerung</title>
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
    <h1>RespawnHQ-Agent</h1>
    <p class="sub" id="serverUrl">wird geladen…</p>
    <div class="badge" id="statusBadge">…</div>

    <div class="row">
      <div>
        <div>Tracking</div>
        <div class="hint">Meldet laufende Spiele an den Server</div>
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
      <div class="hint">Entfernt Autostart, beendet den Agent und löscht alle Dateien von diesem PC.</div>
    </div>

    <div id="msg"></div>
  </div>

<script>
async function loadStatus() {
  const res = await fetch('/api/status');
  const s = await res.json();
  document.getElementById('serverUrl').textContent = 'Server: ' + s.serverUrl;
  const badge = document.getElementById('statusBadge');
  badge.textContent = s.paused ? '⏸ Pausiert' : '▶ Aktiv – trackt';
  badge.className = 'badge ' + (s.paused ? 'paused' : 'playing');
  document.getElementById('toggleBtn').textContent = s.paused ? '▶ Fortsetzen' : '⏸ Pausieren';
  const activityToggle = document.getElementById('activityToggle');
  activityToggle.checked = s.trackActivity;
  document.getElementById('activityHint').textContent = s.activityTrackingSupported
    ? 'Aktives Fenster + Leerlaufzeit, nur für bekannte Spiele (siehe README).'
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
  const res = await fetch('/api/' + action, { method: 'POST' });
  if (res.ok) { await loadStatus(); showMsg(action === 'pause' ? 'Pausiert.' : 'Fortgesetzt.'); }
  else showMsg('Fehler beim Umschalten.', true);
});

document.getElementById('activityToggle').addEventListener('change', async (e) => {
  const enable = e.target.checked;
  const res = await fetch('/api/activity-tracking/' + (enable ? 'enable' : 'disable'), { method: 'POST' });
  if (res.ok) { showMsg(enable ? 'Erweiterte Daten aktiviert.' : 'Erweiterte Daten deaktiviert.'); }
  else { e.target.checked = !enable; showMsg('Fehler.', true); }
  await loadStatus();
});

document.getElementById('autostartToggle').addEventListener('change', async (e) => {
  const enable = e.target.checked;
  const res = await fetch('/api/autostart/' + (enable ? 'enable' : 'disable'), { method: 'POST' });
  const body = await res.json().catch(() => ({}));
  if (res.ok) showMsg(enable ? 'Autostart aktiviert.' : 'Autostart deaktiviert.');
  else { e.target.checked = !enable; showMsg(body.error || 'Fehler.', true); }
  await loadStatus();
});

document.getElementById('uninstallBtn').addEventListener('click', async () => {
  if (!confirm('Agent wirklich komplett deinstallieren? Autostart wird entfernt, alle Dateien gelöscht und das Tracking gestoppt.')) return;
  const res = await fetch('/api/uninstall', { method: 'POST' });
  if (res.ok) {
    document.getElementById('card').innerHTML =
      '<h1>Deinstalliert</h1><p class="sub">Der Agent wurde beendet und alle Dateien wurden entfernt. Dieses Fenster kannst du jetzt schließen.</p>';
  } else {
    showMsg('Deinstallation fehlgeschlagen.', true);
  }
});

loadStatus();
setInterval(loadStatus, 5000);
</script>
</body>
</html>`;
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

// handlers: { getStatus, pause, resume, enableActivityTracking, disableActivityTracking,
// enableAutostart, disableAutostart, uninstall } — all may be sync or return a Promise;
// getStatus returns the full status object.
function createControlServer(handlers) {
  return http.createServer(async (req, res) => {
    let pathname;
    try {
      pathname = new URL(req.url, 'http://localhost').pathname;
    } catch {
      return sendJson(res, 400, { error: 'Ungültige Anfrage.' });
    }

    try {
      if (req.method === 'GET' && pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(renderPage());
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

module.exports = { createControlServer, listenWithRetry, renderPage };
