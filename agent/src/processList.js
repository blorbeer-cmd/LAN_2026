// Lists currently running process names. Windows (the real target) uses
// `tasklist`; a `ps`-based fallback covers macOS/Linux so the agent (and its
// tests) also work during development on non-Windows machines.

const { exec } = require('child_process');
const os = require('os');

function execAsync(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { windowsHide: true, maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
      if (err) return reject(err);
      resolve(stdout);
    });
  });
}

// `tasklist /fo csv /nh` prints one quoted CSV row per process, e.g.
// "cs2.exe","1234","Console","1","512,000 K"
function parseTasklistCsv(output) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^"([^"]+)"/);
      return match ? match[1].toLowerCase() : null;
    })
    .filter(Boolean);
}

// `ps -A -o comm=` prints one command per line, occasionally with a path.
function parsePsOutput(output) {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split('/').pop().toLowerCase());
}

async function getRunningProcessNames() {
  if (os.platform() === 'win32') {
    const out = await execAsync('tasklist /fo csv /nh');
    return parseTasklistCsv(out);
  }
  const out = await execAsync('ps -A -o comm=');
  return parsePsOutput(out);
}

module.exports = { getRunningProcessNames, parseTasklistCsv, parsePsOutput };
