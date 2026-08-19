import assert from "node:assert/strict";
import { rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import {
  CHROMIUM_COMMANDS,
  DEFAULT_ATTEMPTS,
  installChromium,
  runCommandWithTimeout,
} from "./ci-install-chromium.mjs";

const collector = () => {
  const calls = [];
  const messages = [];
  const sleeps = [];
  return {
    calls,
    messages,
    sleeps,
    options: (outcomes) => ({
      run: (invocation) => {
        calls.push(invocation);
        return Promise.resolve(outcomes[calls.length - 1] ?? {
          outcome: "success",
        });
      },
      sleep: (ms) => {
        sleeps.push(ms);
        return Promise.resolve();
      },
      log: (message) => messages.push(message),
    }),
  };
};

test("a successful install runs the mode's command exactly once", async () => {
  const spy = collector();
  const result = await installChromium(
    "deps",
    spy.options([{ outcome: "success" }]),
  );

  assert.deepEqual(result, { ok: true, outcomes: ["success"] });
  assert.equal(spy.calls.length, 1);
  assert.equal(spy.calls[0].command, CHROMIUM_COMMANDS.deps.command);
  assert.deepEqual(spy.calls[0].args, CHROMIUM_COMMANDS.deps.args);
  assert.deepEqual(spy.messages, []);
  assert.deepEqual(spy.sleeps, []);
});

test("the browser mode installs the bundle together with its system dependencies", async () => {
  const spy = collector();
  await installChromium("browser", spy.options([{ outcome: "success" }]));

  assert.deepEqual(spy.calls[0].args, [
    "playwright",
    "install",
    "--with-deps",
    "chromium",
  ]);
});

test("a hung install times out and the retry can still succeed", async () => {
  const spy = collector();
  const result = await installChromium(
    "deps",
    spy.options([{ outcome: "timeout" }, { outcome: "success" }]),
  );

  assert.deepEqual(result, { ok: true, outcomes: ["timeout", "success"] });
  assert.equal(spy.calls.length, 2);
  assert.equal(spy.sleeps.length, 1);
  assert.match(spy.messages[0], /attempt 1\/2 timed out after 180s/);
});

test("exhausting every attempt reports failure instead of hanging the job", async () => {
  const spy = collector();
  const result = await installChromium(
    "deps",
    spy.options([{ outcome: "timeout" }, { outcome: "timeout" }]),
  );

  assert.equal(result.ok, false);
  assert.deepEqual(result.outcomes, ["timeout", "timeout"]);
  assert.equal(spy.calls.length, DEFAULT_ATTEMPTS);
  // No delay after the final attempt: the step should fail immediately.
  assert.equal(spy.sleeps.length, 1);
});

test("only the system dependencies are best effort, never the browser bundle", async () => {
  const spy = collector();
  const deps = await installChromium(
    "deps",
    spy.options([{ outcome: "timeout" }, { outcome: "timeout" }]),
  );
  const browser = await installChromium(
    "browser",
    collector().options([{ outcome: "timeout" }, { outcome: "timeout" }]),
  );

  // The runner image ships the apt libraries, and Chromium names a genuinely
  // missing one when it launches — so a dead mirror must not stop the run.
  // A missing browser bundle has no such fallback.
  assert.equal(deps.bestEffort, true);
  assert.equal(browser.bestEffort, false);
});

test("a successful install is never reported as best effort", async () => {
  const spy = collector();
  const result = await installChromium(
    "deps",
    spy.options([{ outcome: "success" }]),
  );

  assert.equal(result.ok, true);
  assert.equal(result.bestEffort, undefined);
});

test("a non-zero exit is retried and reported with its exit code", async () => {
  const spy = collector();
  const result = await installChromium(
    "deps",
    spy.options([
      { outcome: "failure", detail: "exit code 100" },
      { outcome: "failure", detail: "exit code 100" },
    ]),
  );

  assert.equal(result.ok, false);
  assert.match(spy.messages[0], /attempt 1\/2 failed \(exit code 100\)/);
});

test("each attempt receives the configured timeout", async () => {
  const spy = collector();
  await installChromium("deps", {
    ...spy.options([{ outcome: "timeout" }, { outcome: "success" }]),
    timeoutMs: 5_000,
    retryDelayMs: 250,
  });

  assert.deepEqual(
    spy.calls.map((call) => call.timeoutMs),
    [5_000, 5_000],
  );
  assert.deepEqual(spy.sleeps, [250]);
  assert.match(spy.messages[0], /timed out after 5s/);
});

test("an unknown mode is rejected instead of silently skipping the install", async () => {
  await assert.rejects(
    () => installChromium("firefox"),
    /Unknown Chromium install mode/,
  );
  await assert.rejects(
    () => installChromium(undefined),
    /Unknown Chromium install mode/,
  );
});

test("a non-positive attempt count or timeout is rejected", async () => {
  const spy = collector();
  await assert.rejects(
    () => installChromium("deps", { ...spy.options([]), attempts: 0 }),
    /positive integer/,
  );
  await assert.rejects(
    () => installChromium("deps", { ...spy.options([]), timeoutMs: 0 }),
    /positive number/,
  );
  assert.equal(spy.calls.length, 0);
});

test("a command that finishes on its own reports its real exit status", async () => {
  assert.deepEqual(
    await runCommandWithTimeout({
      command: "sh",
      args: ["-c", "exit 0"],
      timeoutMs: 10_000,
    }),
    { outcome: "success" },
  );
  assert.deepEqual(
    await runCommandWithTimeout({
      command: "sh",
      args: ["-c", "exit 100"],
      timeoutMs: 10_000,
    }),
    { outcome: "failure", detail: "exit code 100" },
  );
});

test("a timed-out attempt kills the whole process tree, not just the direct child", async () => {
  // Regression guard for the real failure this helper exists for: apt-get runs
  // as a grandchild of npx. Killing only the direct child leaves apt-get alive
  // holding /var/lib/apt/lists/lock, and the retry dies instantly with
  // "Could not get lock" — which is exactly what happened in run 32226375160.
  const marker = path.join(
    tmpdir(),
    `ci-install-chromium-${process.pid}-${Date.now()}.marker`,
  );
  writeFileSync(marker, "");
  const sizeOfMarker = () => statSync(marker).size;

  try {
    const result = await runCommandWithTimeout({
      command: "sh",
      args: [
        "-c",
        `sh -c 'while :; do printf x >> "${marker}"; sleep 0.05; done' & sleep 30`,
      ],
      timeoutMs: 400,
      killGraceMs: 200,
    });

    assert.equal(result.outcome, "timeout");
    await delay(500);
    const afterKill = sizeOfMarker();
    await delay(400);
    assert.equal(
      sizeOfMarker(),
      afterKill,
      "the grandchild kept running after the timeout",
    );
    assert.ok(afterKill > 0, "the grandchild never ran, so nothing was proven");
  } finally {
    rmSync(marker, { force: true });
  }
});
