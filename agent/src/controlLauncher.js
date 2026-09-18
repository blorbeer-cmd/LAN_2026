const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const CONTROL_ACCESS_FILENAME = '.respawn-control.json';

function getControlAccessPath(installDir) {
  return path.join(installDir, CONTROL_ACCESS_FILENAME);
}

function parseControlAccess(raw) {
  const value = JSON.parse(raw);
  if (value?.version !== 1 || typeof value.origin !== 'string' || typeof value.accessKey !== 'string') {
    throw new Error('Die lokalen Steuerungsdaten sind ungültig.');
  }

  const origin = new URL(value.origin);
  const port = Number(origin.port);
  if (
    origin.protocol !== 'http:' ||
    origin.hostname !== '127.0.0.1' ||
    origin.pathname !== '/' ||
    origin.search ||
    origin.hash ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    !/^[A-Za-z0-9_-]{43}$/.test(value.accessKey)
  ) {
    throw new Error('Die lokalen Steuerungsdaten sind ungültig.');
  }

  return { origin: origin.origin, accessKey: value.accessKey };
}

function writeControlAccess(accessPath, controlAccess) {
  const serialized = JSON.stringify({
    version: 1,
    ...parseControlAccess(JSON.stringify({ version: 1, ...controlAccess })),
  });
  const temporaryPath = `${accessPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, serialized, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporaryPath, accessPath);
}

function removeControlAccess(accessPath, accessKey) {
  try {
    const current = parseControlAccess(fs.readFileSync(accessPath, 'utf8'));
    if (current.accessKey === accessKey) fs.unlinkSync(accessPath);
  } catch {
    // Best-effort shutdown cleanup. A missing, replaced, or damaged runtime
    // file must never prevent the agent itself from stopping.
  }
}

async function requestControlLaunch(controlAccess, fetchImpl = fetch) {
  const { origin, accessKey } = parseControlAccess(JSON.stringify({ version: 1, ...controlAccess }));
  const response = await fetchImpl(`${origin}/api/launch`, {
    method: 'POST',
    headers: { 'X-Respawn-Control-Key': accessKey },
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) throw new Error('Die lokale Steuerung hat den Zugriff abgelehnt.');
  const body = await response.json();
  if (!/^[A-Za-z0-9_-]{43}$/.test(body?.ticket)) {
    throw new Error('Die lokale Steuerung hat eine ungültige Antwort geliefert.');
  }
  return `${origin}/#ticket=${encodeURIComponent(body.ticket)}`;
}

function openExternalUrl(url) {
  if (process.platform !== 'win32') throw new Error('Die Desktop-Steuerung ist nur unter Windows verfügbar.');
  const child = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.on('error', () => {});
  child.unref();
}

async function openControlPanel(accessPath, { fetchImpl = fetch, openUrl = openExternalUrl } = {}) {
  const controlAccess = parseControlAccess(fs.readFileSync(accessPath, 'utf8'));
  const launchUrl = await requestControlLaunch(controlAccess, fetchImpl);
  openUrl(launchUrl);
}

module.exports = {
  getControlAccessPath,
  openControlPanel,
  parseControlAccess,
  removeControlAccess,
  requestControlLaunch,
  writeControlAccess,
};
