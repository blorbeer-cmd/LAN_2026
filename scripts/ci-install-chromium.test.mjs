import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CHROMIUM_COMMANDS,
  DEFAULT_ATTEMPTS,
  installChromium,
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
        return outcomes[calls.length - 1] ?? { outcome: "success" };
      },
      sleep: (ms) => sleeps.push(ms),
      log: (message) => messages.push(message),
    }),
  };
};

test("a successful install runs the mode's command exactly once", () => {
  const spy = collector();
  const result = installChromium("deps", spy.options([{ outcome: "success" }]));

  assert.deepEqual(result, { ok: true, outcomes: ["success"] });
  assert.equal(spy.calls.length, 1);
  assert.equal(spy.calls[0].command, CHROMIUM_COMMANDS.deps.command);
  assert.deepEqual(spy.calls[0].args, CHROMIUM_COMMANDS.deps.args);
  assert.deepEqual(spy.messages, []);
  assert.deepEqual(spy.sleeps, []);
});

test("the browser mode installs the bundle together with its system dependencies", () => {
  const spy = collector();
  installChromium("browser", spy.options([{ outcome: "success" }]));

  assert.deepEqual(spy.calls[0].args, [
    "playwright",
    "install",
    "--with-deps",
    "chromium",
  ]);
});

test("a hung install times out and the retry can still succeed", () => {
  const spy = collector();
  const result = installChromium(
    "deps",
    spy.options([{ outcome: "timeout" }, { outcome: "success" }]),
  );

  assert.deepEqual(result, { ok: true, outcomes: ["timeout", "success"] });
  assert.equal(spy.calls.length, 2);
  assert.equal(spy.sleeps.length, 1);
  assert.match(spy.messages[0], /attempt 1\/2 timed out after 180s/);
});

test("exhausting every attempt reports failure instead of hanging the job", () => {
  const spy = collector();
  const result = installChromium(
    "deps",
    spy.options([{ outcome: "timeout" }, { outcome: "timeout" }]),
  );

  assert.equal(result.ok, false);
  assert.deepEqual(result.outcomes, ["timeout", "timeout"]);
  assert.equal(spy.calls.length, DEFAULT_ATTEMPTS);
  // No delay after the final attempt: the step should fail immediately.
  assert.equal(spy.sleeps.length, 1);
});

test("a non-zero exit is retried and reported with its exit code", () => {
  const spy = collector();
  const result = installChromium(
    "deps",
    spy.options([
      { outcome: "failure", detail: "exit code 100" },
      { outcome: "failure", detail: "exit code 100" },
    ]),
  );

  assert.equal(result.ok, false);
  assert.match(spy.messages[0], /attempt 1\/2 failed \(exit code 100\)/);
});

test("each attempt receives the configured timeout", () => {
  const spy = collector();
  installChromium("deps", {
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

test("an unknown mode is rejected instead of silently skipping the install", () => {
  assert.throws(
    () => installChromium("firefox"),
    /Unknown Chromium install mode/,
  );
  assert.throws(
    () => installChromium(undefined),
    /Unknown Chromium install mode/,
  );
});

test("a non-positive attempt count or timeout is rejected", () => {
  const spy = collector();
  assert.throws(
    () => installChromium("deps", { ...spy.options([]), attempts: 0 }),
    /positive integer/,
  );
  assert.throws(
    () => installChromium("deps", { ...spy.options([]), timeoutMs: 0 }),
    /positive number/,
  );
  assert.equal(spy.calls.length, 0);
});
