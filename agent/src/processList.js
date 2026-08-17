// Looks up which of the game process names the server knows about are
// currently running. This is deliberately a *targeted* lookup instead of a
// full process scan: the agent asks the operating system only about the names
// that are actually mapped to a game, so every other program on the player's
// PC (browser, chat, work stuff, ...) is never read into the agent to begin
// with — not just filtered out before sending. That is the whole reason
// someone should feel comfortable installing this on their private machine.
//
// Windows (the real target) uses PowerShell's `Get-Process -Name <list>`; a
// `pgrep -x` fallback covers macOS/Linux so the agent (and its tests) also
// work during development on non-Windows machines. Both take the names to
// look for as input, so neither platform path can return anything else.

const { exec } = require('child_process');
const os = require('os');

// The names come from the server's game→process mapping (admin input) and end
// up inside a PowerShell argument and a pgrep pattern. Only this conservative
// charset is ever passed on; anything else is dropped rather than escaped, so
// no mapping entry can turn into a shell or PowerShell construct. Wildcards
// (`*`, `?`, `[`) are excluded on purpose too: `Get-Process -Name` would treat
// them as patterns and match processes that were never configured.
const SAFE_PROCESS_NAME = /^[a-z0-9 ._+()-]{1,64}$/;

// Windows caps a command line at roughly 8000 characters, so long allow-lists
// are split across several calls. Batches are sized by the characters they
// actually generate rather than by a name count, which could still overflow
// once the configured names get long.
const MAX_LOOKUP_COMMAND_CHARS = 4000;

// A wedged shell must not stall the report loop forever — the interval is
// measured in seconds, so anything this slow is broken, not slow.
const LOOKUP_TIMEOUT_MS = 15_000;

function execAsync(cmd, { emptyOnExitCode1 = false } = {}) {
  return new Promise((resolve, reject) => {
    exec(cmd, { windowsHide: true, timeout: LOOKUP_TIMEOUT_MS, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      // pgrep exits 1 when simply nothing matched, which is a perfectly normal
      // "no game running" result rather than a failure.
      if (err && !(emptyOnExitCode1 && err.code === 1 && !err.signal)) return reject(err);
      resolve(stdout || '');
    });
  });
}

// The server stores names the way Windows displays them (`cs2.exe`), while
// both Get-Process and pgrep want the bare name. Strip the extension for the
// lookup; the hit is mapped back to the configured spelling afterwards.
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

// Splits the lookup names into batches that each stay well inside the command
// line length a single call may produce.
function chunkLookupNames(lookupNames) {
  const chunks = [];
  let current = [];
  let length = 0;
  for (const name of lookupNames) {
    const cost = name.length + 3; // quotes plus separator
    if (current.length > 0 && length + cost > MAX_LOOKUP_COMMAND_CHARS) {
      chunks.push(current);
      current = [];
      length = 0;
    }
    current.push(name);
    length += cost;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

// `Get-Process ... | ForEach-Object { $_.ProcessName }` prints one bare process
// name per line (no extension, original casing).
function parseGetProcessOutput(output) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim().toLowerCase())
    .filter(Boolean);
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

async function queryWindows(lookupNames) {
  const quoted = lookupNames.map((name) => `'${name.replace(/'/g, "''")}'`).join(',');
  const out = await execAsync(
    `powershell -NoProfile -NonInteractive -Command "Get-Process -Name ${quoted} -ErrorAction SilentlyContinue | ForEach-Object { $_.ProcessName } | Sort-Object -Unique"`
  );
  return parseGetProcessOutput(out);
}

// `-x` makes pgrep require a full match of the whole process name, so the
// alternation below can never match a longer, unrelated name.
async function queryPosix(lookupNames) {
  const pattern = lookupNames.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const out = await execAsync(`pgrep -x -l '${pattern}'`, { emptyOnExitCode1: true });
  return parsePgrepOutput(out);
}

// Returns the subset of `allowedProcessNames` that is currently running. An
// empty allow-list means there is nothing worth asking the OS about at all, so
// no process query happens in that case.
async function getRunningProcessNames(allowedProcessNames) {
  const byLookup = buildLookup(allowedProcessNames);
  if (byLookup.size === 0) return [];

  const query = os.platform() === 'win32' ? queryWindows : queryPosix;
  const hits = [];
  for (const batch of chunkLookupNames([...byLookup.keys()])) {
    hits.push(...(await query(batch)));
  }
  return mapHitsToConfiguredNames(hits, byLookup);
}

module.exports = {
  getRunningProcessNames,
  buildLookup,
  mapHitsToConfiguredNames,
  chunkLookupNames,
  parseGetProcessOutput,
  parsePgrepOutput,
  MAX_LOOKUP_COMMAND_CHARS,
};
