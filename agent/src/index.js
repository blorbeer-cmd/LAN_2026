// Agent main loop: periodically scans running processes and reports them to
// the server. Deliberately minimal — this is the one piece of the tool that
// runs unattended on someone else's PC, so it must never crash and must make
// its own connection status obvious (FR-32) without needing a GUI for the
// core loop. It does now expose one thing via a tiny local control panel: the
// player's own way to pause tracking, toggle autostart, or uninstall — see
// controlServer.js.

const os = require('os');
const path = require('path');
const { loadConfig } = require('./config');
const { getRunningProcessNames } = require('./processList');
const { getActivitySnapshot } = require('./activity');
const { reportToServer } = require('./report');
const { loadState, setPaused, setTrackActivity } = require('./state');
const { getStartupShortcutPath, isAutostartEnabled, enableAutostart, disableAutostart } = require('./autostart');
const { scheduleUninstall } = require('./uninstaller');
const { createControlServer, listenWithRetry } = require('./controlServer');

const DEFAULT_CONTROL_PORT = 47813;

function log(message) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${message}`);
}

function getStartupDir() {
  return path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
}

async function tick(config, stateFilePath) {
  const state = loadState(stateFilePath, { trackActivity: config.trackActivity });
  if (state.paused) {
    log('⏸ Pausiert – kein Reporting an den Server.');
    return;
  }
  try {
    const processNames = await getRunningProcessNames();
    // Opt-in only: reveals which process is focused + idle time, so the
    // server can tell "actually played" apart from "just running". The
    // player can flip this later via the control panel, so the state file
    // (not the original downloaded config) is the source of truth here.
    const activitySnapshot = state.trackActivity ? await getActivitySnapshot() : null;
    const result = await reportToServer(config, processNames, activitySnapshot);
    const count = result?.gameIds?.length ?? 0;
    log(count > 0 ? `✅ Verbunden – ${count} Spiel(e) erkannt.` : '✅ Verbunden – kein bekanntes Spiel aktiv.');
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
    pause: () => setPaused(stateFilePath, true),
    resume: () => setPaused(stateFilePath, false),
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
      // Give the HTTP response time to flush to the browser before we exit.
      setTimeout(() => process.exit(0), 300);
    },
  });

  listenWithRetry(controlServer, DEFAULT_CONTROL_PORT)
    .then(({ port }) => log(`🖥️  Steuerung erreichbar unter http://127.0.0.1:${port}`))
    .catch((err) => log(`⚠️ Steuer-Oberfläche konnte nicht gestartet werden: ${err.message}`));

  return () => {
    clearInterval(timer);
    try {
      controlServer.close();
    } catch {
      // not listening yet / already closed — nothing to do
    }
  };
}

process.on('uncaughtException', (err) => log(`Unerwarteter Fehler: ${err.message}`));
process.on('unhandledRejection', (reason) => log(`Unerwarteter Promise-Fehler: ${reason}`));

if (require.main === module) {
  start(process.argv[2]);
}

module.exports = { start };
