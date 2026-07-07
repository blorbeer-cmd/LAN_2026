// Optional activity snapshot: which process owns the focused window, and how
// many seconds since the last keyboard/mouse input anywhere on the system.
// Together these let the server distinguish "the game was just running in the
// background" from "someone was actually at the keyboard playing it".
//
// Windows-only (relies on user32.dll via a small PowerShell/P-Invoke script).
// Only ever called when the player has opted in (config.trackActivity).

const os = require('os');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

// ProcessName from Get-Process has no extension, so we append ".exe" to match
// the convention every other process-name mapping in this project uses
// (tasklist output, game_process_names entries).
const PS_SCRIPT = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class LanPartyNative {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [StructLayout(LayoutKind.Sequential)] public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
  [DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
}
"@
$hwnd = [LanPartyNative]::GetForegroundWindow()
$procId = 0
[void][LanPartyNative]::GetWindowThreadProcessId($hwnd, [ref]$procId)
$fgName = $null
try { $fgName = ((Get-Process -Id $procId -ErrorAction Stop).ProcessName) + ".exe" } catch {}
$lii = New-Object LanPartyNative+LASTINPUTINFO
$lii.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($lii)
[void][LanPartyNative]::GetLastInputInfo([ref]$lii)
$idleMs = [Environment]::TickCount - $lii.dwTime
$idleSeconds = [Math]::Round($idleMs / 1000)
$result = @{ foreground = $fgName; idleSeconds = $idleSeconds }
$result | ConvertTo-Json -Compress
`.trim();

let scriptPath = null;

function ensureScriptFile() {
  if (scriptPath && fs.existsSync(scriptPath)) return scriptPath;
  scriptPath = path.join(os.tmpdir(), 'lan2026-agent-activity.ps1');
  fs.writeFileSync(scriptPath, PS_SCRIPT, 'utf8');
  return scriptPath;
}

function execAsync(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { windowsHide: true, timeout: 5000 }, (err, stdout) => {
      if (err) return reject(err);
      resolve(stdout);
    });
  });
}

// Parses the PowerShell script's compact JSON output into a normalized
// snapshot. Exported separately so it's unit-testable without Windows.
function parseActivityOutput(raw) {
  const trimmed = (raw || '').trim();
  if (!trimmed) return { foregroundProcessName: null, idleSeconds: null };

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { foregroundProcessName: null, idleSeconds: null };
  }

  const foregroundProcessName =
    typeof parsed.foreground === 'string' && parsed.foreground ? parsed.foreground.toLowerCase() : null;
  const idleSeconds =
    typeof parsed.idleSeconds === 'number' && Number.isFinite(parsed.idleSeconds) ? parsed.idleSeconds : null;

  return { foregroundProcessName, idleSeconds };
}

// Returns { foregroundProcessName, idleSeconds }, both null if unavailable
// (non-Windows, or the PowerShell call failed for any reason — never throws,
// since this is a nice-to-have on top of the core process scan).
async function getActivitySnapshot() {
  if (os.platform() !== 'win32') {
    return { foregroundProcessName: null, idleSeconds: null };
  }
  try {
    const script = ensureScriptFile();
    const out = await execAsync(`powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${script}"`);
    return parseActivityOutput(out);
  } catch {
    return { foregroundProcessName: null, idleSeconds: null };
  }
}

module.exports = { getActivitySnapshot, parseActivityOutput };
