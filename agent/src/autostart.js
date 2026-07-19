// Enables/disables Windows autostart for the packaged agent .exe by
// creating/removing a shortcut in the current user's Startup folder — the
// same mechanism install.bat already sets up on first install, just exposed
// as a toggle so a player can turn it off without editing anything by hand.
//
// Reading the current state (isAutostartEnabled) is just a file-existence
// check, so it works everywhere. Actually creating the shortcut shells out to
// PowerShell's WScript.Shell COM object, same as install.bat — Windows-only.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');

const SHORTCUT_NAME = 'Respawn-Agent.lnk';

function getStartupShortcutPath(startupDir) {
  return path.join(startupDir, SHORTCUT_NAME);
}

function isAutostartEnabled(startupDir) {
  return fs.existsSync(getStartupShortcutPath(startupDir));
}

function execAsync(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { windowsHide: true, timeout: 10_000 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr?.trim() || err.message));
      resolve(stdout);
    });
  });
}

async function enableAutostart({ startupDir, exePath, installDir }) {
  if (os.platform() !== 'win32') {
    throw new Error('Autostart wird nur unter Windows unterstützt.');
  }
  fs.mkdirSync(startupDir, { recursive: true });
  const shortcutPath = getStartupShortcutPath(startupDir);
  const psCommand =
    `$s = (New-Object -ComObject WScript.Shell).CreateShortcut('${shortcutPath}'); ` +
    `$s.TargetPath = '${exePath}'; $s.WorkingDirectory = '${installDir}'; $s.WindowStyle = 7; $s.Save()`;
  await execAsync(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${psCommand}"`);
  return true;
}

function disableAutostart(startupDir) {
  const shortcutPath = getStartupShortcutPath(startupDir);
  if (fs.existsSync(shortcutPath)) fs.unlinkSync(shortcutPath);
  return true;
}

module.exports = { getStartupShortcutPath, isAutostartEnabled, enableAutostart, disableAutostart };
