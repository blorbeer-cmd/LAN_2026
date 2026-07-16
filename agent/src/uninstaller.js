// Removes the agent entirely: startup shortcut, install directory, and the
// running process itself. A running .exe can't reliably delete its own file
// while it's still executing, so on Windows we hand off to a small detached
// helper script that waits for this process to exit and then deletes
// everything — the agent process itself just schedules the cleanup and exits
// shortly after (giving the HTTP response time to flush).

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

function scheduleUninstall({ installDir, startupShortcutPath }) {
  if (os.platform() !== 'win32') {
    // Dev/test convenience path — no running .exe to worry about.
    if (startupShortcutPath && fs.existsSync(startupShortcutPath)) fs.unlinkSync(startupShortcutPath);
    if (installDir && fs.existsSync(installDir)) fs.rmSync(installDir, { recursive: true, force: true });
    return;
  }

  const lines = [
    '@echo off',
    'timeout /t 2 /nobreak >nul',
    startupShortcutPath ? `if exist "${startupShortcutPath}" del /f /q "${startupShortcutPath}"` : '',
    installDir ? `if exist "${installDir}" rmdir /s /q "${installDir}"` : '',
  ].filter(Boolean);

  const scriptPath = path.join(os.tmpdir(), `respawn-agent-uninstall-${Date.now()}.bat`);
  fs.writeFileSync(scriptPath, lines.join('\r\n') + '\r\n', 'utf8');

  // The cleanup script deletes itself last isn't necessary — it lives in
  // tmp, which Windows sweeps on its own; not worth the extra complexity.
  spawn('cmd.exe', ['/c', scriptPath], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}

module.exports = { scheduleUninstall };
