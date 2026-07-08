// Local pause state for the agent, persisted next to the config file so it
// survives restarts (PC reboot while paused should stay paused). Deliberately
// tiny and dependency-free, same spirit as config.js — a corrupt or missing
// state file must never crash the agent, just fall back to "not paused".

const fs = require('fs');

function loadState(stateFilePath) {
  try {
    if (!fs.existsSync(stateFilePath)) return { paused: false };
    const parsed = JSON.parse(fs.readFileSync(stateFilePath, 'utf8'));
    return { paused: parsed.paused === true };
  } catch {
    return { paused: false };
  }
}

function setPaused(stateFilePath, paused) {
  fs.writeFileSync(stateFilePath, JSON.stringify({ paused: paused === true }), 'utf8');
}

module.exports = { loadState, setPaused };
