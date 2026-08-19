import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// `playwright install-deps` shells out to apt-get, and apt-get blocks
// indefinitely when an Ubuntu mirror stalls mid-transfer. A stall like that
// burns the whole job timeout, and a job killed by its own timeout ends as
// `cancelled` rather than `failure` — which GitHub's "Re-run failed jobs"
// silently skips, so the run can never reach green again and the post-merge
// deploy stays blocked. A hard per-attempt timeout turns such a stall into an
// ordinary, retryable step failure instead.
export const CHROMIUM_COMMANDS = {
  browser: {
    command: "npx",
    args: ["playwright", "install", "--with-deps", "chromium"],
  },
  deps: { command: "npx", args: ["playwright", "install-deps", "chromium"] },
};

export const DEFAULT_ATTEMPT_TIMEOUT_MS = 180_000;
export const DEFAULT_ATTEMPTS = 2;
export const DEFAULT_RETRY_DELAY_MS = 10_000;

function runWithTimeout({ command, args, timeoutMs }) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    timeout: timeoutMs,
    killSignal: "SIGKILL",
  });
  if (result.error?.code === "ETIMEDOUT" || result.signal === "SIGKILL")
    return { outcome: "timeout" };
  if (result.error) return { outcome: "error", detail: result.error.message };
  return result.status === 0
    ? { outcome: "success" }
    : { outcome: "failure", detail: `exit code ${result.status}` };
}

function sleepSync(ms) {
  if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function installChromium(mode, options = {}) {
  const spec = CHROMIUM_COMMANDS[mode];
  if (!spec)
    throw new Error(
      `Unknown Chromium install mode: ${mode}. Expected one of ${Object.keys(CHROMIUM_COMMANDS).join(", ")}.`,
    );
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_ATTEMPT_TIMEOUT_MS;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  if (!Number.isInteger(attempts) || attempts < 1)
    throw new Error(`Attempts must be a positive integer, got ${attempts}.`);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new Error(`Timeout must be a positive number, got ${timeoutMs}.`);
  const run = options.run ?? runWithTimeout;
  const sleep = options.sleep ?? sleepSync;
  const log = options.log ?? ((message) => console.error(message));

  const outcomes = [];
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = run({ ...spec, timeoutMs, mode, attempt });
    outcomes.push(result.outcome);
    if (result.outcome === "success") return { ok: true, outcomes };
    const reason =
      result.outcome === "timeout"
        ? `timed out after ${Math.round(timeoutMs / 1000)}s`
        : `failed (${result.detail ?? "unknown reason"})`;
    log(
      `::warning::Chromium install (${mode}) attempt ${attempt}/${attempts} ${reason}.`,
    );
    if (attempt < attempts) sleep(retryDelayMs);
  }
  return { ok: false, outcomes };
}

function positiveNumberFromEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(`${name} must be a positive number, got "${raw}".`);
  return value;
}

function main() {
  const mode = process.argv[2];
  try {
    const { ok } = installChromium(mode, {
      attempts: positiveNumberFromEnv(
        "CHROMIUM_INSTALL_ATTEMPTS",
        DEFAULT_ATTEMPTS,
      ),
      timeoutMs: positiveNumberFromEnv(
        "CHROMIUM_INSTALL_TIMEOUT_MS",
        DEFAULT_ATTEMPT_TIMEOUT_MS,
      ),
    });
    if (ok) return;
    console.error(
      `Chromium install (${mode}) did not succeed; failing the step so a re-run can pick it up.`,
    );
    process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main();
