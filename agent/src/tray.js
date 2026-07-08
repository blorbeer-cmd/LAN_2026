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
//
// Wrapped in try/catch with a checkpoint after every step, all written to
// its own trace log — the process exited clean (code 0, no stderr) on the
// very first real test, meaning it finished *without* ever actually
// blocking on Application.Run(), and there was nothing to tell us why.
function buildTrayScript(controlUrl, agentPid) {
  return `
$traceLog = "$env:TEMP\\lan2026-agent-tray-${agentPid}.trace.log"
function Trace($msg) { Add-Content -Path $traceLog -Value "$(Get-Date -Format o) $msg" }

try {
  Trace "start (PSVersion=$($PSVersionTable.PSVersion), STA=$([System.Threading.Thread]::CurrentThread.GetApartmentState()))"

  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  Trace "assemblies loaded"

  $controlUrl = "${controlUrl}"
  $agentPid = ${agentPid}

  $icon = New-Object System.Windows.Forms.NotifyIcon
  $icon.Icon = [System.Drawing.SystemIcons]::Application
  $icon.Text = "RespawnHQ-Agent"
  $icon.Visible = $true
  Trace "notify icon created and visible"

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
  Trace "menu wired, entering message loop"

  [System.Windows.Forms.Application]::Run()
  Trace "Application.Run() returned (icon should be gone now)"
} catch {
  Trace "EXCEPTION: $($_ | Out-String)"
}
Trace "script end"
`.trim();
}

// Hides the agent's own console window (Windows only; a Node child process
// spawned without its own new console attaches to the parent's, so hiding it
// from inside this short-lived helper hides the same window the agent owns).
// Deliberately does NOT pass windowsHide/CREATE_NO_WINDOW here — that flag
// detaches the child from any console entirely, so GetConsoleWindow() inside
// it would return NULL and ShowWindow would silently no-op instead of
// hiding the actual shared window. Synchronous and best-effort — never
// throws, so a failure here just leaves the console visible instead of
// breaking startup.
function hideConsoleWindow(log = () => {}) {
  if (os.platform() !== 'win32') return;
  const script =
    'Add-Type -Name W -Namespace RespawnHQ -MemberDefinition ' +
    '\'[DllImport("kernel32.dll")]public static extern IntPtr GetConsoleWindow();' +
    '[DllImport("user32.dll")]public static extern bool ShowWindow(IntPtr h,int n);\'; ' +
    '[RespawnHQ.W]::ShowWindow([RespawnHQ.W]::GetConsoleWindow(), 0)';
  try {
    const result = spawnSync('powershell', ['-NoProfile', '-Command', script], { timeout: 5000 });
    if (result.error) log(`Konsole ausblenden fehlgeschlagen: ${result.error.message}`);
    else if (result.status !== 0) log(`Konsole ausblenden: PowerShell endete mit Code ${result.status}.`);
  } catch (err) {
    log(`Konsole ausblenden fehlgeschlagen: ${err.message}`);
  }
}

// Starts the tray icon as a detached process so it keeps running
// independently of the agent's own event loop. Returns the child process (so
// callers can kill it on shutdown/uninstall) or null if not on Windows / the
// spawn itself failed synchronously.
//
// -STA matters: WinForms (NotifyIcon, ContextMenuStrip, Application.Run)
// needs a single-threaded apartment, but powershell.exe defaults to MTA —
// without this flag, creating the icon throws.
//
// `log` (optional) gets every step of what happened — every previous
// failure here was completely silent (nothing launched, no error anywhere),
// which made it undiagnosable over chat. Antivirus/Defender silently
// blocking an unsigned .exe from spawning a hidden PowerShell with an inline
// script is a real possibility, so this needs to be visible in the agent's
// own log/console, not just a temp file the player has to go find.
function startTrayIcon(controlUrl, agentPid, log = () => {}) {
  if (os.platform() !== 'win32') return null;

  let scriptPath;
  let errorLogPath;
  try {
    scriptPath = path.join(os.tmpdir(), `lan2026-agent-tray-${agentPid}.ps1`);
    errorLogPath = path.join(os.tmpdir(), `lan2026-agent-tray-${agentPid}.err.log`);
    fs.writeFileSync(scriptPath, buildTrayScript(controlUrl, agentPid), 'utf8');
    log(`Tray: Skript geschrieben (${scriptPath}).`);
  } catch (err) {
    log(`Tray: Skript konnte nicht geschrieben werden: ${err.message}`);
    return null;
  }

  let child;
  try {
    const errorFd = fs.openSync(errorLogPath, 'a');
    child = spawn(
      'powershell',
      [
        '-NoProfile',
        '-STA',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-WindowStyle',
        'Hidden',
        '-File',
        scriptPath,
      ],
      { windowsHide: true, detached: true, stdio: ['ignore', 'ignore', errorFd] }
    );
  } catch (err) {
    log(`Tray: PowerShell konnte nicht gestartet werden: ${err.message}`);
    return null;
  }

  log(`Tray: PowerShell gestartet (PID ${child.pid}).`);
  child.on('error', (err) => log(`Tray: Prozessfehler: ${err.message}`));
  child.on('exit', (code, signal) => {
    log(`Tray: Prozess beendet (code=${code}, signal=${signal}) – Details ggf. in ${errorLogPath}.`);
  });
  child.unref();
  return child;
}

module.exports = { buildTrayScript, hideConsoleWindow, startTrayIcon };
