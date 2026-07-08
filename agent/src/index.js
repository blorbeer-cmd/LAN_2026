// Agent main loop: periodically scans running processes and reports them to
// the server. Deliberately minimal — this is the one piece of the tool that
// runs unattended on someone else's PC, so it must never crash and must make
// its own connection status obvious (FR-32) without needing a GUI for the
// core loop. It does now expose one thing via a tiny local control panel: the
// player's own way to pause tracking, toggle autostart, or uninstall — see
// controlServer.js.
//
// The pause flag has exactly one source of truth: the player's
// tracking_paused column on the server. Pausing/resuming here pushes it to
// the server (best-effort — see the pause/resume handlers below); pausing/
// resuming via the web profile is picked up here on the next tick() via the
// report response, so the local control panel never silently disagrees with
// the web app.
//
// Once packaged (.exe, not `npm start`) and on Windows, the console window
// gets hidden in favor of a system tray icon (see tray.js) — a visible
// window logging every 10 seconds was the whole thing players complained
// about. Since that removes the only place errors were visible, log() also
// mirrors everything into a small log file in the install dir.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadConfig } = require('./config');
const { getRunningProcessNames } = require('./processList');
const { getActivitySnapshot } = require('./activity');
const { reportToServer, syncTrackingPaused } = require('./report');
const { loadState, setPaused, setTrackActivity } = require('./state');
const { getStartupShortcutPath, isAutostartEnabled, enableAutostart, disableAutostart } = require('./autostart');
const { scheduleUninstall } = require('./uninstaller');
const { createControlServer, listenWithRetry } = require('./controlServer');
const { startTrayIcon, hideConsoleWindow } = require('./tray');

const DEFAULT_CONTROL_PORT = 47813;
const LOG_FILE_MAX_BYTES = 2 * 1024 * 1024; // reset instead of growing forever across a multi-day LAN party

let logFilePath = null;

// toISOString() would print UTC, which reads as "wrong" (and was, in
// Germany, consistently 1-2h behind) to anyone glancing at the console —
// pad manually since toLocaleTimeString()'s output format isn't guaranteed
// across locales/Node builds.
function formatLocalTime(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function log(message) {
  const ts = formatLocalTime(new Date());
  const line = `[${ts}] ${message}`;
  console.log(line);
  if (logFilePath) {
    try {
      fs.appendFileSync(logFilePath, line + '\n');
    } catch {
      // Logging itself must never be why the agent goes down.
    }
  }
}

function setUpLogFile(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (stat.size > LOG_FILE_MAX_BYTES) fs.unlinkSync(filePath);
  } catch {
    // No existing file yet — nothing to reset.
  }
  logFilePath = filePath;
}

function getStartupDir() {
  return path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
}

async function tick(config, stateFilePath) {
  const state = loadState(stateFilePath, { trackActivity: config.trackActivity });
  try {
    // While locally paused, skip the (mildly expensive) process scan but
    // still ping the server with an empty report — that's how this agent
    // learns a web-profile-initiated resume happened, without the player
    // needing to come back to this PC to notice.
    const processNames = state.paused ? [] : await getRunningProcessNames();
    // Opt-in only: reveals which process is focused + idle time, so the
    // server can tell "actually played" apart from "just running". The
    // player can flip this later via the control panel, so the state file
    // (not the original downloaded config) is the source of truth here.
    const activitySnapshot = !state.paused && state.trackActivity ? await getActivitySnapshot() : null;
    const result = await reportToServer(config, processNames, activitySnapshot);

    // The server's tracking_paused column is the single source of truth for
    // the pause flag — mirror it locally so a pause/resume made via the web
    // profile shows up here too (the control panel, and this same gate).
    if (typeof result?.trackingPaused === 'boolean' && result.trackingPaused !== state.paused) {
      setPaused(stateFilePath, result.trackingPaused);
    }

    if (state.paused) {
      log('⏸ Pausiert – kein Tracking.');
    } else {
      const count = result?.gameIds?.length ?? 0;
      log(count > 0 ? `✅ Verbunden – ${count} Spiel(e) erkannt.` : '✅ Verbunden – kein bekanntes Spiel aktiv.');
    }
  } catch (err) {
    // Never let a single failed tick crash the loop: a Wi-Fi hiccup or a
    // server restart must self-heal on the next tick, not require the
    // player to notice and restart their agent.
    log(`❌ Fehler beim Melden: ${err.message}`);
  }
}

function start(configPath) {
  const config = loadConfig(configPath);
  const installDir = path.dirname(config.configPath);
  const stateFilePath = path.join(installDir, 'agent.state.json');
  const startupDir = getStartupDir();
  const shortcutPath = getStartupShortcutPath(startupDir);
  // pkg (the packager used for the distributed .exe) sets process.pkg; running
  // from source (dev/tests) has no real install dir to manage autostart for.
  const isPackaged = typeof process.pkg !== 'undefined';
  const exePath = isPackaged ? process.execPath : null;

  // Only meaningful once the console might get hidden below — dev runs
  // (npm start) keep logging to the console only, no file to manage.
  if (isPackaged) setUpLogFile(path.join(installDir, 'agent.log'));

  let trayProcess = null;

  const initialTrackActivity = loadState(stateFilePath, { trackActivity: config.trackActivity }).trackActivity;
  log(
    `LAN-2026-Agent gestartet. Server: ${config.serverUrl} · Intervall: ${config.pollIntervalMs}ms` +
      (initialTrackActivity ? ' · Aktivitäts-Tracking: an' : '')
  );

  tick(config, stateFilePath);
  const timer = setInterval(() => tick(config, stateFilePath), config.pollIntervalMs);

  const controlServer = createControlServer({
    getStatus: () => {
      const state = loadState(stateFilePath, { trackActivity: config.trackActivity });
      return {
        serverUrl: config.serverUrl,
        pollIntervalMs: config.pollIntervalMs,
        paused: state.paused,
        trackActivity: state.trackActivity,
        activityTrackingSupported: os.platform() === 'win32',
        autostart: isAutostartEnabled(startupDir),
        autostartSupported: os.platform() === 'win32' && isPackaged,
      };
    },
    // Local state flips instantly regardless of network (the control panel
    // must feel responsive even offline); syncing it to the server is
    // best-effort so the web profile's toggle agrees too — a failure here
    // just means the next successful tick() will reconcile it instead.
    pause: async () => {
      setPaused(stateFilePath, true);
      try {
        await syncTrackingPaused(config, true);
      } catch (err) {
        log(`⚠️ Pausieren konnte nicht mit dem Server synchronisiert werden: ${err.message}`);
      }
    },
    resume: async () => {
      setPaused(stateFilePath, false);
      try {
        await syncTrackingPaused(config, false);
      } catch (err) {
        log(`⚠️ Fortsetzen konnte nicht mit dem Server synchronisiert werden: ${err.message}`);
      }
    },
    enableActivityTracking: () => setTrackActivity(stateFilePath, true),
    disableActivityTracking: () => setTrackActivity(stateFilePath, false),
    enableAutostart: () => {
      if (!isPackaged || !exePath) {
        throw new Error('Autostart kann nur mit der installierten .exe eingerichtet werden.');
      }
      return enableAutostart({ startupDir, exePath, installDir });
    },
    disableAutostart: () => disableAutostart(startupDir),
    uninstall: () => {
      scheduleUninstall({ installDir, startupShortcutPath: shortcutPath });
      if (trayProcess) {
        try {
          trayProcess.kill();
        } catch {
          // already gone — nothing to clean up
        }
      }
      // Give the HTTP response time to flush to the browser before we exit.
      setTimeout(() => process.exit(0), 300);
    },
  });

  listenWithRetry(controlServer, DEFAULT_CONTROL_PORT)
    .then(({ port }) => {
      const controlUrl = `http://127.0.0.1:${port}`;
      log(`🖥️  Steuerung erreichbar unter ${controlUrl}`);

      // Dev runs (npm start) keep their console — only the packaged .exe on
      // Windows gets the tray treatment, and only once the tray process is
      // still alive a moment later (so a spawn that starts but dies right
      // away — e.g. antivirus killing an unsigned .exe's hidden PowerShell
      // child — never leaves the agent invisible and uncontrollable).
      if (isPackaged && os.platform() === 'win32') {
        trayProcess = startTrayIcon(controlUrl, process.pid, log);
        if (trayProcess) {
          setTimeout(() => {
            if (trayProcess && trayProcess.exitCode === null && !trayProcess.killed) {
              hideConsoleWindow(log);
              log('🔽 Konsole ausgeblendet – Steuerung jetzt über das Tray-Icon oder ' + controlUrl + '.');
            } else {
              log('⚠️ Tray-Icon ist gleich nach dem Start wieder beendet, Konsole bleibt sichtbar.');
            }
          }, 1500);
        } else {
          log('⚠️ Tray-Icon konnte nicht gestartet werden, Konsole bleibt sichtbar.');
        }
      }
    })
    .catch((err) => log(`⚠️ Steuer-Oberfläche konnte nicht gestartet werden: ${err.message}`));

  return () => {
    clearInterval(timer);
    try {
      controlServer.close();
    } catch {
      // not listening yet / already closed — nothing to do
    }
    if (trayProcess) {
      try {
        trayProcess.kill();
      } catch {
        // already gone — nothing to clean up
      }
    }
  };
}

process.on('uncaughtException', (err) => log(`Unerwarteter Fehler: ${err.message}`));
process.on('unhandledRejection', (reason) => log(`Unerwarteter Promise-Fehler: ${reason}`));

if (require.main === module) {
  start(process.argv[2]);
}

module.exports = { start };
