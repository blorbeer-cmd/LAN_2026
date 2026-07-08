// Local, mutable agent state, persisted next to the config file so it
// survives restarts (a PC reboot while paused should stay paused, a toggled
// activity-tracking preference should stick). Deliberately tiny and
// dependency-free, same spirit as config.js — a corrupt or missing state
// file must never crash the agent, just fall back to sane defaults.
//
// trackActivity starts out mirroring whatever was baked into the downloaded
// config.json, but once the player changes it via the control panel, this
// file becomes the source of truth — re-downloading the agent later would
// only reset it if the state file is also removed (i.e. a real reinstall).

const fs = require('fs');

function readRaw(stateFilePath) {
  try {
    if (!fs.existsSync(stateFilePath)) return {};
    const parsed = JSON.parse(fs.readFileSync(stateFilePath, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeRaw(stateFilePath, raw) {
  fs.writeFileSync(stateFilePath, JSON.stringify(raw), 'utf8');
}

function loadState(stateFilePath, defaults = {}) {
  const raw = readRaw(stateFilePath);
  return {
    paused: raw.paused === true,
    trackActivity: typeof raw.trackActivity === 'boolean' ? raw.trackActivity : defaults.trackActivity === true,
  };
}

function setPaused(stateFilePath, paused) {
  const raw = readRaw(stateFilePath);
  raw.paused = paused === true;
  writeRaw(stateFilePath, raw);
}

function setTrackActivity(stateFilePath, trackActivity) {
  const raw = readRaw(stateFilePath);
  raw.trackActivity = trackActivity === true;
  writeRaw(stateFilePath, raw);
}

module.exports = { loadState, setPaused, setTrackActivity };
