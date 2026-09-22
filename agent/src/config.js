// Loads and validates the agent's local config file. Kept dependency-free
// (just fs/path) so the agent has as little as possible that can break on a
// random Windows PC.

const fs = require('fs');
const path = require('path');

const DEFAULT_POLL_INTERVAL_MS = 10_000;

// The installed .exe always sits next to its own agent.config.json, but its
// working directory is whatever started it — install.bat runs from the
// unpacked download folder, the autostart shortcut from the install
// directory. Resolving the default relative to the .exe keeps the install
// directory (and with it the state file, the log and the local control
// panel's runtime file) in one place no matter who launched the agent.
// Unpackaged dev runs have no install directory and stay on the cwd.
function defaultConfigPath() {
  const baseDir = typeof process.pkg === 'undefined' ? process.cwd() : path.dirname(process.execPath);
  return path.join(baseDir, 'agent.config.json');
}

function loadConfig(configPath) {
  const resolved = configPath ? path.resolve(configPath) : defaultConfigPath();

  if (!fs.existsSync(resolved)) {
    throw new Error(
      `Config-Datei nicht gefunden: ${resolved}\n` +
        'Kopiere agent.config.example.json zu agent.config.json und trage Server-URL + API-Key ein.'
    );
  }

  const raw = fs.readFileSync(resolved, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`Config-Datei ist kein gültiges JSON (${resolved}): ${err.message}`);
  }

  if (typeof parsed.serverUrl !== 'string' || !parsed.serverUrl.trim()) {
    throw new Error('Config: "serverUrl" fehlt oder ist ungültig.');
  }
  if (typeof parsed.apiKey !== 'string' || !parsed.apiKey.trim()) {
    throw new Error('Config: "apiKey" fehlt oder ist ungültig.');
  }

  const pollIntervalMs =
    typeof parsed.pollIntervalMs === 'number' && Number.isFinite(parsed.pollIntervalMs) && parsed.pollIntervalMs > 0
      ? parsed.pollIntervalMs
      : DEFAULT_POLL_INTERVAL_MS;

  // Opt-in: reports which process has the focused window + how long since the
  // last keyboard/mouse input, so the server can tell "was actually played"
  // apart from "was just running in the background". Off by default —
  // players should explicitly choose to share this extra bit of activity
  // data about themselves. Windows-only (relies on user32.dll); ignored on
  // other platforms regardless of this setting.
  const trackActivity = parsed.trackActivity === true;

  return {
    serverUrl: parsed.serverUrl.trim().replace(/\/+$/, ''),
    apiKey: parsed.apiKey.trim(),
    pollIntervalMs,
    trackActivity,
    configPath: resolved,
  };
}

module.exports = { defaultConfigPath, loadConfig, DEFAULT_POLL_INTERVAL_MS };
