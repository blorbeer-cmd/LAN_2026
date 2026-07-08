// Windows-only system tray icon, so the agent doesn't need a visible console
// window logging every poll to stay reachable. No new npm/native dependency —
// same trick as activity.js/autostart.js: a small embedded script (here,
// WinForms via PowerShell) run as its own detached process, since pkg-built
// exes can't easily bundle native tray addons.
//
// The tray process is intentionally dumb: it only opens the agent's own
// local control panel (controlServer.js) in the browser, or stops the agent.
// All actual pause/resume/autostart/uninstall logic still lives there, one
// place, reachable from either the desktop shortcut or the tray icon.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

// Exported (pure) so it's unit-testable without Windows: verifies the right
// URL/PID get embedded and the expected menu actions are present.
function buildTrayScript(controlUrl, agentPid) {
  return `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$controlUrl = "${controlUrl}"
$agentPid = ${agentPid}

$icon = New-Object System.Windows.Forms.NotifyIcon
$icon.Icon = [System.Drawing.SystemIcons]::Application
$icon.Text = "RespawnHQ-Agent"
$icon.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$openItem = $menu.Items.Add("Steuerung oeffnen")
$exitItem = $menu.Items.Add("Beenden")
$icon.ContextMenuStrip = $menu

$openAction = { Start-Process $controlUrl }
$openItem.add_Click($openAction)
$icon.add_DoubleClick($openAction)

$exitItem.add_Click({
  $icon.Visible = $false
  try { Stop-Process -Id $agentPid -Force -ErrorAction SilentlyContinue } catch {}
  [System.Windows.Forms.Application]::Exit()
})

[System.Windows.Forms.Application]::Run()
`.trim();
}

// Hides the agent's own console window (Windows only; a Node child process
// spawned without its own new console attaches to the parent's, so hiding it
// from inside this short-lived helper hides the same window the agent owns).
// Synchronous and best-effort — never throws, so a failure here just leaves
// the console visible instead of breaking startup.
function hideConsoleWindow() {
  if (os.platform() !== 'win32') return;
  const script =
    'Add-Type -Name W -Namespace RespawnHQ -MemberDefinition ' +
    '\'[DllImport("kernel32.dll")]public static extern IntPtr GetConsoleWindow();' +
    '[DllImport("user32.dll")]public static extern bool ShowWindow(IntPtr h,int n);\'; ' +
    '[RespawnHQ.W]::ShowWindow([RespawnHQ.W]::GetConsoleWindow(), 0)';
  try {
    spawnSync('powershell', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', script], {
      windowsHide: true,
      timeout: 5000,
    });
  } catch {
    // Leave the console visible rather than crash startup over this.
  }
}

// Starts the tray icon as a detached process so it keeps running
// independently of the agent's own event loop. Returns the child process (so
// callers can kill it on shutdown/uninstall) or null if not on Windows / the
// spawn itself failed synchronously.
function startTrayIcon(controlUrl, agentPid) {
  if (os.platform() !== 'win32') return null;
  try {
    const scriptPath = path.join(os.tmpdir(), `lan2026-agent-tray-${agentPid}.ps1`);
    fs.writeFileSync(scriptPath, buildTrayScript(controlUrl, agentPid), 'utf8');
    const child = spawn(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', scriptPath],
      { windowsHide: true, detached: true, stdio: 'ignore' }
    );
    child.unref();
    return child;
  } catch {
    return null;
  }
}

module.exports = { buildTrayScript, hideConsoleWindow, startTrayIcon };
