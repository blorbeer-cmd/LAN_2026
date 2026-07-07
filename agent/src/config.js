// Loads and validates the agent's local config file. Kept dependency-free
// (just fs/path) so the agent has as little as possible that can break on a
// random Windows PC.

const fs = require('fs');
const path = require('path');

const DEFAULT_POLL_INTERVAL_MS = 10_000;

function loadConfig(configPath) {
  const resolved = configPath ? path.resolve(configPath) : path.join(process.cwd(), 'agent.config.json');

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
  };
}

module.exports = { loadConfig, DEFAULT_POLL_INTERVAL_MS };
