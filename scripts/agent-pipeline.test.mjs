import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  createPipelineState,
  labelsForState,
  loadConfig,
  parseTaskContract,
  transitionPipelineState,
  validateTaskContract,
} from "./agent-pipeline.mjs";

const baseSha = "1".repeat(40);
const headSha = "2".repeat(40);
const nextHeadSha = "3".repeat(40);
const config = loadConfig();

function body(overrides = {}) {
  const values = {
    "task-id": "agent-20260726-foundation",
    implementer: "codex",
    "base-branch": "main",
    "base-sha": baseSha,
    "head-branch": "codex/agent-pipeline-foundation",
    scope: "infra",
    "ui-change": "no",
    "max-ci-fix-rounds": "3",
    "max-review-rounds": "3",
    ...overrides,
  };
  return `<!--\nagent-pipeline:task\n${Object.entries(values)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n")}\nagent-pipeline:end\n-->`;
}

function context(changedFiles = ["scripts/agent-pipeline.mjs"]) {
  return {
    repository: "blorbeer-cmd/LAN_2026",
    headRepository: "blorbeer-cmd/LAN_2026",
    baseBranch: "main",
    headBranch: "codex/agent-pipeline-foundation",
    changedFiles,
  };
}

function validContract(overrides = {}, changedFiles) {
  const parsed = parseTaskContract(body(overrides));
  assert.equal(parsed.participating, true);
  const validation = validateTaskContract(
    parsed.contract,
    context(changedFiles),
    config,
  );
  assert.deepEqual(validation.errors, []);
  return validation.normalized;
}

function runValidatorCli(prBody, eventOverrides = {}) {
  const directory = mkdtempSync(join(tmpdir(), "agent-pipeline-test-"));
  const eventPath = join(directory, "event.json");
  const outputPath = join(directory, "output.txt");
  const summaryPath = join(directory, "summary.md");
  const event = {
    repository: { full_name: "blorbeer-cmd/LAN_2026" },
    pull_request: {
      body: prBody,
      base: { ref: "main" },
      head: {
        ref: "codex/agent-pipeline-foundation",
        repo: { full_name: "blorbeer-cmd/LAN_2026" },
      },
    },
    ...eventOverrides,
  };
  writeFileSync(eventPath, JSON.stringify(event), "utf8");
  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL("./agent-pipeline.mjs", import.meta.url)),
      "validate-event",
      "--event",
      eventPath,
    ],
    {
      encoding: "utf8",
      windowsHide: true,
      env: {
        ...process.env,
        GITHUB_OUTPUT: outputPath,
        GITHUB_STEP_SUMMARY: summaryPath,
      },
    },
  );
  const output = readFileSync(outputPath, "utf8");
  const summary = readFileSync(summaryPath, "utf8");
  rmSync(directory, { recursive: true, force: true });
  return { result, output, summary };
}

test("an untouched PR template does not activate the pipeline", () => {
  const parsed = parseTaskContract(
    `agent-pipeline:task\nTask-id: ignored\ntask-id: agent-YYYYMMDD-NNN\nagent-pipeline:end`,
  );
  assert.equal(parsed.participating, false);
});

test("a complete task contract is parsed and normalized", () => {
  const contract = validContract();
  assert.equal(contract.taskId, "agent-20260726-foundation");
  assert.equal(contract.implementer, "codex");
  assert.equal(contract.maxCiFixRounds, 3);
  assert.equal(contract.uiChanged, false);
});

test("the CLI exposes validated contract metadata as GitHub outputs", () => {
  const { result, output, summary } = runValidatorCli(body());
  assert.equal(result.status, 0, result.stderr);
  assert.match(output, /^participating=true$/m);
  assert.match(output, /^valid=true$/m);
  assert.match(output, /^task_id=agent-20260726-foundation$/m);
  assert.match(summary, /Agent pipeline contract/);
});

test("the CLI rejects an active contract from a fork", () => {
  const { result, output } = runValidatorCli(body(), {
    repository: { full_name: "blorbeer-cmd/LAN_2026" },
    pull_request: {
      body: body(),
      base: { ref: "main" },
      head: {
        ref: "codex/agent-pipeline-foundation",
        repo: { full_name: "someone/fork" },
      },
    },
  });
  assert.equal(result.status, 1);
  assert.match(output, /^valid=false$/m);
  assert.match(result.stderr, /fork pull requests/);
});

test("branch identity, repository origin and required keys are enforced", () => {
  const parsed = parseTaskContract(
    body({ implementer: "claude", "head-branch": "codex/wrong" }),
  );
  const result = validateTaskContract(
    parsed.contract,
    { ...context(), headRepository: "someone/fork" },
    config,
  );
  assert.equal(result.valid, false);
  assert.ok(
    result.errors.some((error) => error.includes("fork pull requests")),
  );
  assert.ok(result.errors.some((error) => error.includes("claude/")));
});

test("UI paths override an incorrect no declaration and protected paths are reported", () => {
  const parsed = parseTaskContract(body());
  const result = validateTaskContract(
    parsed.contract,
    context(["server/public/app.js", ".github/workflows/deploy.yml"]),
    config,
  );
  assert.equal(result.valid, true);
  assert.equal(result.normalized.uiChanged, true);
  assert.deepEqual(result.normalized.protectedPaths, [
    ".github/workflows/deploy.yml",
  ]);
  assert.equal(result.warnings.length, 1);
});

test("a passing current review opens the gate when no UI notice is needed", () => {
  const contract = validContract();
  let state = createPipelineState(contract, headSha);
  state = transitionPipelineState(state, { type: "CI_PASSED" });
  state = transitionPipelineState(state, {
    type: "REVIEW_PASSED",
    reviewedHeadSha: headSha,
    mode: "cross",
  });
  assert.equal(state.phase, "ready-for-merge");
  assert.deepEqual(state.blockers, []);
  assert.ok(labelsForState(state, config).includes("agent:ready-for-merge"));
});

test("a stale review cannot open the gate", () => {
  const contract = validContract();
  let state = createPipelineState(contract, headSha);
  state = transitionPipelineState(state, { type: "CI_PASSED" });
  assert.throws(
    () =>
      transitionPipelineState(state, {
        type: "REVIEW_PASSED",
        reviewedHeadSha: baseSha,
      }),
    /Stale review/,
  );
});

test("a new head invalidates CI, review and readiness", () => {
  const contract = validContract();
  let state = createPipelineState(contract, headSha);
  state = transitionPipelineState(state, { type: "CI_PASSED" });
  state = transitionPipelineState(state, {
    type: "REVIEW_PASSED",
    reviewedHeadSha: headSha,
  });
  state = transitionPipelineState(state, {
    type: "HEAD_UPDATED",
    headSha: nextHeadSha,
  });
  assert.equal(state.phase, "implementing");
  assert.equal(state.ciPassed, false);
  assert.equal(state.reviewedHeadSha, null);
  assert.equal(state.verdict, null);
});

test("UI changes block readiness until the user notification exists", () => {
  const contract = validContract({ "ui-change": "yes" });
  let state = createPipelineState(contract, headSha);
  state = transitionPipelineState(state, { type: "CI_PASSED" });
  state = transitionPipelineState(state, {
    type: "REVIEW_PASSED",
    reviewedHeadSha: headSha,
  });
  assert.equal(state.phase, "review");
  assert.deepEqual(state.blockers, ["ui-notification"]);
  state = transitionPipelineState(state, { type: "UI_NOTIFIED" });
  assert.equal(state.phase, "ready-for-merge");
});

test("reviewer unavailability selects fallback before waiting", () => {
  const contract = validContract();
  const initial = createPipelineState(contract, headSha);
  const fallback = transitionPipelineState(initial, {
    type: "REVIEWER_UNAVAILABLE",
    fallbackAvailable: true,
    reason: "Codex quota exhausted.",
  });
  assert.equal(fallback.phase, "review-fallback");
  assert.equal(fallback.reviewMode, "fallback");

  const waiting = transitionPipelineState(initial, {
    type: "REVIEWER_UNAVAILABLE",
    fallbackAvailable: false,
  });
  assert.equal(waiting.phase, "waiting");
});

test("CI and review round limits escalate instead of looping forever", () => {
  const contract = validContract({
    "max-ci-fix-rounds": "1",
    "max-review-rounds": "1",
  });
  let ciState = createPipelineState(contract, headSha);
  ciState = transitionPipelineState(ciState, { type: "CI_FAILED" });
  ciState = transitionPipelineState(ciState, { type: "CI_FAILED" });
  assert.equal(ciState.phase, "needs-human");
  assert.deepEqual(ciState.blockers, ["ci-round-limit"]);

  let reviewState = createPipelineState(contract, headSha);
  reviewState = transitionPipelineState(reviewState, {
    type: "REVIEW_CHANGES_REQUESTED",
    reviewedHeadSha: headSha,
  });
  assert.equal(reviewState.phase, "needs-human");
  assert.deepEqual(reviewState.blockers, ["review-round-limit"]);
});
