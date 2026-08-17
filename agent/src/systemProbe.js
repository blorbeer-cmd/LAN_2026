// One look at the local machine per tick, answering both questions the server
// cares about in a single query:
//
//   1. which of the configured game processes are running right now, and
//   2. optionally (opt-in) whether one of them is the focused window and how
//      long the player has been idle.
//
// Deliberately *targeted*: the agent asks the operating system only about the
// process names the server has mapped to a game, so every other program on the
// player's PC (browser, chat, work stuff, ...) is never read into the agent to
// begin with — not just filtered out before sending. That is the whole reason
// someone should feel comfortable installing this on their private machine.
// The focused window is held to the same rule: its name is only ever read out
// of the query if it belongs to a configured game.
//
// Windows (the real target) runs a small generated PowerShell script:
// `Get-Process -Name <list>` for the lookup plus, when activity tracking is on,
// a `user32.dll` P/Invoke for foreground window and idle time. Both used to be
// separate PowerShell invocations; keeping them in one script halves the
// process starts on the player's machine, which is the expensive part.
// A `pgrep -x` fallback covers macOS/Linux so the agent (and its tests) also
// work during development on non-Windows machines; activity tracking stays
// Windows-only and reports nulls there.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { exec } = require('child_process');

// The names come from the server's game→process mapping (admin input) and end
// up inside a PowerShell script and a pgrep pattern. Only this conservative
// charset is ever passed on; anything else is dropped rather than escaped, so
// no mapping entry can turn into a shell or PowerShell construct. Wildcards
// (`*`, `?`, `[`) are excluded on purpose too: `Get-Process -Name` would treat
// them as patterns and match processes that were never configured.
const SAFE_PROCESS_NAME = /^[a-z0-9 ._+()-]{1,64}$/;

// A wedged shell must not stall the report loop forever — the interval is
// measured in seconds, so anything this slow is broken, not slow.
const PROBE_TIMEOUT_MS = 15_000;

const EMPTY_PROBE = { processNames: [], foregroundProcessName: null, idleSeconds: null };

// Foreground window + idle time. Wrapped in try/catch inside PowerShell so a
// failure here (an antivirus blocking Add-Type, a locked-down machine) can
// never cost us the running-game detection this script exists for — activity
// data is a nice-to-have on top of it.
// The here-string terminator `"@` has to start its own line at column 0, hence
// the unindented block.
const ACTIVITY_BLOCK = `try {
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
  $focused = $null
  try { $focused = ((Get-Process -Id $procId -ErrorAction Stop).ProcessName).ToLower() } catch {}
  if ($focused -and ($running -contains $focused)) { $foreground = $focused }
  $lii = New-Object LanPartyNative+LASTINPUTINFO
  $lii.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($lii)
  [void][LanPartyNative]::GetLastInputInfo([ref]$lii)
  $idleSeconds = [Math]::Round(([Environment]::TickCount - $lii.dwTime) / 1000)
} catch {}`;

function execAsync(cmd, { emptyOnExitCode1 = false } = {}) {
  return new Promise((resolve, reject) => {
    exec(cmd, { windowsHide: true, timeout: PROBE_TIMEOUT_MS, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      // pgrep exits 1 when simply nothing matched, which is a perfectly normal
      // "no game running" result rather than a failure.
      if (err && !(emptyOnExitCode1 && err.code === 1 && !err.signal)) return reject(err);
      resolve(stdout || '');
    });
  });
}

// The server stores names the way Windows displays them (`cs2.exe`), while
// both Get-Process and pgrep want the bare name. Strip the extension for the
// lookup; hits are mapped back to the configured spelling afterwards.
function toLookupName(name) {
  return name.replace(/\.exe$/, '');
}

// Normalizes the server's allow-list into the names to ask the OS about, keyed
// by lookup name so a hit can be reported back in exactly the spelling the
// server has configured. Unsafe or empty entries are silently dropped.
function buildLookup(allowedProcessNames) {
  const byLookup = new Map();
  for (const raw of Array.isArray(allowedProcessNames) ? allowedProcessNames : []) {
    if (typeof raw !== 'string') continue;
    const name = raw.trim().toLowerCase();
    if (!name || !SAFE_PROCESS_NAME.test(name)) continue;
    const lookup = toLookupName(name);
    if (!lookup) continue;
    const configured = byLookup.get(lookup);
    if (!configured) byLookup.set(lookup, [name]);
    else if (!configured.includes(name)) configured.push(name);
  }
  return byLookup;
}

// Translates the bare names the OS reported back into the configured spellings
// the server expects in a report.
function mapHitsToConfiguredNames(hits, byLookup) {
  const names = [];
  for (const hit of hits) {
    for (const name of byLookup.get(hit) || []) {
      if (!names.includes(name)) names.push(name);
    }
  }
  return names;
}

// Builds the whole PowerShell script for one probe. Kept as a pure function so
// the generated script — the privacy-critical part, since it defines exactly
// what the agent is able to see — is unit-testable without Windows.
function buildProbeScript(lookupNames, includeActivity) {
  const lines = [];
  if (lookupNames.length > 0) {
    const quoted = lookupNames.map((name) => `'${name.replace(/'/g, "''")}'`).join(',');
    lines.push(`$names = @(${quoted})`);
    lines.push(
      '$running = @(Get-Process -Name $names -ErrorAction SilentlyContinue | ForEach-Object { $_.ProcessName.ToLower() } | Sort-Object -Unique)'
    );
  } else {
    // Get-Process refuses an empty -Name array, and an activity-only probe
    // still needs $running to exist for the foreground check below.
    lines.push('$running = @()');
  }
  lines.push('$foreground = $null');
  lines.push('$idleSeconds = $null');
  if (includeActivity) lines.push(ACTIVITY_BLOCK);
  lines.push('@{ processes = $running; foreground = $foreground; idleSeconds = $idleSeconds } | ConvertTo-Json -Compress');
  return lines.join('\n');
}

let cachedScript = null;

// The script only changes when the server's allow-list or the activity opt-in
// changes, so it is written once and reused across ticks instead of touching
// the disk every few seconds.
function ensureScriptFile(script) {
  const scriptPath = path.join(os.tmpdir(), 'respawn-agent-probe.ps1');
  if (script !== cachedScript || !fs.existsSync(scriptPath)) {
    fs.writeFileSync(scriptPath, script, 'utf8');
    cachedScript = script;
  }
  return scriptPath;
}

// Parses the probe script's compact JSON output. A missing or broken result is
// an error rather than an empty answer: silently reporting "no game running"
// would look like a working agent while tracking nothing.
function parseProbeOutput(raw) {
  const trimmed = (raw || '').trim();
  if (!trimmed) throw new Error('Prozessabfrage lieferte keine Ausgabe.');

  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error('Prozessabfrage lieferte keine gültige Antwort.');
  }

  // ConvertTo-Json collapses a single-element array to a scalar in some
  // PowerShell versions, so accept both shapes.
  const rawProcesses = parsed?.processes;
  const processes = (Array.isArray(rawProcesses) ? rawProcesses : rawProcesses ? [rawProcesses] : [])
    .filter((name) => typeof name === 'string' && name.trim())
    .map((name) => name.trim().toLowerCase());

  const foreground =
    typeof parsed?.foreground === 'string' && parsed.foreground.trim() ? parsed.foreground.trim().toLowerCase() : null;
  const idleSeconds =
    typeof parsed?.idleSeconds === 'number' && Number.isFinite(parsed.idleSeconds) ? parsed.idleSeconds : null;

  return { processes, foreground, idleSeconds };
}

// `pgrep -x -l` prints one `<pid> <name>` pair per match.
function parsePgrepOutput(output) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^\d+\s+/, '').toLowerCase())
    .filter(Boolean);
}

async function probeWindows(lookupNames, includeActivity) {
  const scriptPath = ensureScriptFile(buildProbeScript(lookupNames, includeActivity));
  const out = await execAsync(`powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${scriptPath}"`);
  return parseProbeOutput(out);
}

// `-x` makes pgrep require a full match of the whole process name, so the
// alternation below can never match a longer, unrelated name.
async function probePosix(lookupNames) {
  // An empty pattern would match every process — exactly the thing this module
  // exists to prevent, so it is guarded here as well as at the call site.
  if (lookupNames.length === 0) return { processes: [], foreground: null, idleSeconds: null };
  const pattern = lookupNames.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const out = await execAsync(`pgrep -x -l '${pattern}'`, { emptyOnExitCode1: true });
  return { processes: parsePgrepOutput(out), foreground: null, idleSeconds: null };
}

// Returns { processNames, foregroundProcessName, idleSeconds }. processNames is
// the subset of `allowedProcessNames` that is currently running, in the
// spelling the server configured. foregroundProcessName is one of those names
// or null; idleSeconds is null unless activity tracking is on and supported.
async function probeSystem({ allowedProcessNames, includeActivity = false } = {}) {
  const byLookup = buildLookup(allowedProcessNames);
  const lookupNames = [...byLookup.keys()];
  const activitySupported = os.platform() === 'win32';

  // Nothing configured to look for, and no activity data to read: there is no
  // reason to touch the player's machine at all.
  if (lookupNames.length === 0 && !(activitySupported && includeActivity)) return EMPTY_PROBE;

  const raw = activitySupported
    ? await probeWindows(lookupNames, includeActivity)
    : await probePosix(lookupNames);

  return {
    processNames: mapHitsToConfiguredNames(raw.processes, byLookup),
    foregroundProcessName: mapHitsToConfiguredNames(raw.foreground ? [raw.foreground] : [], byLookup)[0] ?? null,
    idleSeconds: raw.idleSeconds,
  };
}

module.exports = {
  probeSystem,
  buildLookup,
  mapHitsToConfiguredNames,
  buildProbeScript,
  parseProbeOutput,
  parsePgrepOutput,
};
