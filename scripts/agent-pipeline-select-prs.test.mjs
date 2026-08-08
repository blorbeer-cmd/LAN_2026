import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { loadConfig } from "./agent-pipeline.mjs";
import {
  selectSweepPullRequests,
  sweepReasons,
} from "./agent-pipeline-select-prs.mjs";

const config = loadConfig();

function readinessStatus() {
  return {
    __typename: "StatusContext",
    context: config.statusContext,
    state: "SUCCESS",
  };
}

function pullRequest(overrides = {}) {
  return {
    number: 1,
    body: "A normal pull request.",
    labels: [],
    statusCheckRollup: [readinessStatus()],
    ...overrides,
  };
}

test("the sweep skips an ordinary pull request whose readiness status exists", () => {
  assert.deepEqual(sweepReasons(pullRequest(), config), []);
  assert.deepEqual(selectSweepPullRequests([pullRequest()], config), []);
});

test("the sweep selects every activated task contract, including an invalid one", () => {
  const active = pullRequest({
    number: 8,
    body: "<!--\nagent-pipeline:task\ntask-id: agent-20260808-sweep\nagent-pipeline:end\n-->",
  });
  assert.deepEqual(sweepReasons(active, config), ["activated task contract"]);
  assert.deepEqual(selectSweepPullRequests([active], config), [8]);
});

test("the untouched task-contract template does not activate the sweep", () => {
  const template = pullRequest({
    body: "<!--\nagent-pipeline:task\ntask-id: agent-YYYYMMDD-NNN\nagent-pipeline:end\n-->",
  });
  assert.deepEqual(selectSweepPullRequests([template], config), []);
});

test("labels alone do not select a pull request outside the pipeline", () => {
  const stale = pullRequest({
    labels: [
      { name: config.labels.waiting },
      { name: config.reviewModeLabels.self },
    ],
  });
  assert.deepEqual(selectSweepPullRequests([stale], config), []);
});

test("a missing readiness status selects even a non-pipeline pull request", () => {
  const missing = pullRequest({ number: 2, statusCheckRollup: [] });
  assert.deepEqual(sweepReasons(missing, config), [
    "missing readiness status",
  ]);
  assert.deepEqual(selectSweepPullRequests([missing], config), [2]);
});

test("a check run with the readiness name is not mistaken for the status", () => {
  const missing = pullRequest({
    statusCheckRollup: [
      {
        __typename: "CheckRun",
        name: config.statusContext,
        conclusion: "SUCCESS",
      },
    ],
  });
  assert.deepEqual(selectSweepPullRequests([missing], config), [1]);
});

test("the command-line selector emits compact matrix JSON", () => {
  const script = fileURLToPath(
    new URL("./agent-pipeline-select-prs.mjs", import.meta.url),
  );
  const selected = execFileSync(process.execPath, [script], {
    encoding: "utf8",
    input: JSON.stringify([
      pullRequest({ number: 9, statusCheckRollup: [] }),
      pullRequest({ number: 7 }),
    ]),
  });
  assert.equal(selected, "[9]");
});
