import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

// `playwright install-deps` shells out to apt-get, and apt-get blocks
// indefinitely when an Ubuntu mirror stalls mid-transfer. A stall like that
// burns the whole job timeout, and a job killed by its own timeout ends as
// `cancelled` rather than `failure` — a state that is far harder to recover
// than an ordinary failed step, so the run stays short of green and the
// post-merge deploy never happens. A hard per-attempt timeout turns such a
// stall into a normal, retryable step failure instead.
export const CHROMIUM_COMMANDS = {
  browser: {
    command: "npx",
    args: ["playwright", "install", "--with-deps", "chromium"],
  },
  // Best effort on purpose: this mode only runs on a Playwright cache hit, so
  // the browser bundle is already there and this step merely re-asserts the apt
  // libraries the runner image ships anyway. A mirror that refuses to serve
  // them must not cost the whole pipeline — and a genuinely missing library
  // still surfaces immediately, because Playwright names it when Chromium
  // fails to launch. The browser bundle itself has no such fallback, so that
  // mode stays fatal.
  deps: {
    command: "npx",
    args: ["playwright", "install-deps", "chromium"],
    bestEffort: true,
  },
};

export const DEFAULT_ATTEMPT_TIMEOUT_MS = 180_000;
export const DEFAULT_ATTEMPTS = 2;
export const DEFAULT_RETRY_DELAY_MS = 10_000;
export const DEFAULT_KILL_GRACE_MS = 10_000;

// Exported for the regression test that proves a timed-out attempt takes the
// whole process tree with it.
export function runCommandWithTimeout({
  command,
  args,
  timeoutMs,
  killGraceMs = DEFAULT_KILL_GRACE_MS,
}) {
  return new Promise((resolve) => {
    // `detached` puts the command into its own process group. apt-get runs as
    // a grandchild of npx, so signalling only the direct child leaves it alive
    // holding /var/lib/apt/lists/lock — the retry then dies immediately with
    // "Could not get lock ... held by process N" and the timeout buys nothing.
    const child = spawn(command, args, { stdio: "inherit", detached: true });
    let timedOut = false;
    let killTimer;

    const signalGroup = (signal) => {
      try {
        process.kill(-child.pid, signal);
      } catch {
        try {
          child.kill(signal);
        } catch {
          // The process tree is already gone; nothing left to signal.
        }
      }
      // `playwright install-deps` runs apt-get through sudo, which both makes
      // it root-owned and (with sudo's default use_pty) moves it out of our
      // process group — so the kill above cannot reach it. It then keeps
      // /var/lib/apt/lists/lock and the retry dies instantly with "Could not
      // get lock". Clear it with the runner's passwordless sudo; failures are
      // ignored on purpose because a machine without sudo has no such leftover.
      // `-x` matches the process name, not the command line: `-f apt-get`
      // would also match this very `sudo … pkill … apt-get` invocation.
      spawnSync(
        "sudo",
        ["-n", "pkill", `-${signal.replace("SIG", "")}`, "-x", "apt-get"],
        { stdio: "ignore", timeout: 15_000 },
      );
    };

    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      signalGroup("SIGTERM");
      // apt releases its lock on SIGTERM; SIGKILL is the fallback for a
      // process that ignores the polite signal.
      killTimer = setTimeout(() => signalGroup("SIGKILL"), killGraceMs);
    }, timeoutMs);

    const finish = (result) => {
      clearTimeout(timeoutTimer);
      clearTimeout(killTimer);
      resolve(result);
    };

    child.on("error", (error) =>
      finish({ outcome: "error", detail: error.message }),
    );
    child.on("close", (code) => {
      if (timedOut) return finish({ outcome: "timeout" });
      finish(
        code === 0
          ? { outcome: "success" }
          : { outcome: "failure", detail: `exit code ${code}` },
      );
    });
  });
}

export async function installChromium(mode, options = {}) {
  const spec = CHROMIUM_COMMANDS[mode];
  if (!spec)
    throw new Error(
      `Unknown Chromium install mode: ${mode}. Expected one of ${Object.keys(CHROMIUM_COMMANDS).join(", ")}.`,
    );
  const attempts = options.attempts ?? DEFAULT_ATTEMPTS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_ATTEMPT_TIMEOUT_MS;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const killGraceMs = options.killGraceMs ?? DEFAULT_KILL_GRACE_MS;
  if (!Number.isInteger(attempts) || attempts < 1)
    throw new Error(`Attempts must be a positive integer, got ${attempts}.`);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new Error(`Timeout must be a positive number, got ${timeoutMs}.`);
  const run = options.run ?? runCommandWithTimeout;
  const sleep = options.sleep ?? delay;
  const log = options.log ?? ((message) => console.error(message));

  const outcomes = [];
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const result = await run({ ...spec, timeoutMs, killGraceMs, mode, attempt });
    outcomes.push(result.outcome);
    if (result.outcome === "success") return { ok: true, outcomes };
    const reason =
      result.outcome === "timeout"
        ? `timed out after ${Math.round(timeoutMs / 1000)}s`
        : `failed (${result.detail ?? "unknown reason"})`;
    log(
      `::warning::Chromium install (${mode}) attempt ${attempt}/${attempts} ${reason}.`,
    );
    if (attempt < attempts) await sleep(retryDelayMs);
  }
  return { ok: false, outcomes, bestEffort: spec.bestEffort === true };
}

function positiveNumberFromEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(`${name} must be a positive number, got "${raw}".`);
  return value;
}

async function main() {
  const mode = process.argv[2];
  try {
    const { ok, bestEffort } = await installChromium(mode, {
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
    if (bestEffort) {
      console.error(
        `::warning::Chromium install (${mode}) did not succeed. Continuing: these packages ship with the runner image, and Chromium reports a genuinely missing library when it launches.`,
      );
      return;
    }
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
  await main();
