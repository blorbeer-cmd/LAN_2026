// Agent main loop: periodically scans running processes and reports them to
// the server. Deliberately minimal — this is the one piece of the tool that
// runs unattended on someone else's PC, so it must never crash and must make
// its own connection status obvious (FR-32) without needing a GUI.

const { loadConfig } = require('./config');
const { getRunningProcessNames } = require('./processList');
const { getActivitySnapshot } = require('./activity');
const { reportToServer } = require('./report');

function log(message) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[${ts}] ${message}`);
}

async function tick(config) {
  try {
    const processNames = await getRunningProcessNames();
    // Opt-in only: reveals which process is focused + idle time, so the
    // server can tell "actually played" apart from "just running".
    const activitySnapshot = config.trackActivity ? await getActivitySnapshot() : null;
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
  log(
    `LAN-2026-Agent gestartet. Server: ${config.serverUrl} · Intervall: ${config.pollIntervalMs}ms` +
      (config.trackActivity ? ' · Aktivitäts-Tracking: an' : '')
  );

  tick(config);
  const timer = setInterval(() => tick(config), config.pollIntervalMs);
  return () => clearInterval(timer);
}

process.on('uncaughtException', (err) => log(`Unerwarteter Fehler: ${err.message}`));
process.on('unhandledRejection', (reason) => log(`Unerwarteter Promise-Fehler: ${reason}`));

if (require.main === module) {
  start(process.argv[2]);
}

module.exports = { start };
