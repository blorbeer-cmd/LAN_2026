import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  changedFiles,
  createPipelineState,
  labelsForState,
  loadConfig,
  parseTaskContract,
  transitionPipelineState,
  validateBaseShaAncestry,
  validateTaskContract,
} from "./agent-pipeline.mjs";

const baseSha = "1".repeat(40);
const headSha = "2".repeat(40);
const nextHeadSha = "3".repeat(40);
const config = loadConfig();
const crossReview = {
  mode: "cross",
  reviewerProvider: "claude",
  isolatedSession: true,
  readOnlyEnforced: true,
  reviewSessionId: "claude-review-1",
};

function clearReviewThreads(state) {
  return transitionPipelineState(state, {
    type: "REVIEW_THREADS_UPDATED",
    checkedHeadSha: state.headSha,
    blockingThreadIds: [],
  });
}

function passCi(state, overrides = {}) {
  return transitionPipelineState(state, {
    type: "CI_PASSED",
    checkedHeadSha: state.headSha,
    runId: "ci-run-1",
    runSequence: 1,
    runAttempt: 1,
    conflictFree: true,
    ...overrides,
  });
}

function startCrossReview(state, overrides = {}) {
  const reconciled =
    state.blockingReviewThreadIds === null ? clearReviewThreads(state) : state;
  return transitionPipelineState(reconciled, {
    type: "REVIEW_STARTED",
    reviewedHeadSha: reconciled.headSha,
    ...crossReview,
    ...overrides,
  });
}

function passCrossReview(state, overrides = {}) {
  return transitionPipelineState(state, {
    type: "REVIEW_PASSED",
    reviewedHeadSha: state.headSha,
    reviewId: "review-result-1",
    ...crossReview,
    ...overrides,
  });
}

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
  const parsed = parseTaskContract(body({ scope: "root" }));
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
  state = passCi(state);
  state = startCrossReview(state);
  state = passCrossReview(state);
  assert.equal(state.phase, "ready-for-merge");
  assert.deepEqual(state.blockers, []);
  assert.ok(labelsForState(state, config).includes("agent:ready-for-merge"));
});

test("a stale review cannot open the gate", () => {
  const contract = validContract();
  let state = createPipelineState(contract, headSha);
  state = passCi(state);
  state = startCrossReview(state);
  assert.throws(
    () =>
      transitionPipelineState(state, {
        type: "REVIEW_PASSED",
        reviewedHeadSha: baseSha,
        reviewId: "review-result-stale",
        ...crossReview,
      }),
    /Stale review/,
  );
});

test("a new head invalidates CI, review and readiness", () => {
  const contract = validContract();
  let state = createPipelineState(contract, headSha);
  state = passCi(state);
  state = startCrossReview(state);
  state = passCrossReview(state);
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
  state = passCi(state);
  state = startCrossReview(state);
  state = passCrossReview(state);
  assert.equal(state.phase, "review");
  assert.deepEqual(state.blockers, ["ui-notification"]);
  state = transitionPipelineState(state, {
    type: "UI_NOTIFIED",
    notifiedHeadSha: headSha,
  });
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
  ciState = transitionPipelineState(ciState, {
    type: "CI_FAILED",
    checkedHeadSha: headSha,
    runId: "ci-failure-1",
    runSequence: 1,
    runAttempt: 1,
  });
  ciState = transitionPipelineState(ciState, {
    type: "HEAD_UPDATED",
    headSha: nextHeadSha,
  });
  ciState = transitionPipelineState(ciState, {
    type: "CI_FAILED",
    checkedHeadSha: nextHeadSha,
    runId: "ci-failure-2",
    runSequence: 2,
    runAttempt: 1,
  });
  assert.equal(ciState.phase, "needs-human");
  assert.deepEqual(ciState.blockers, ["ci-round-limit"]);

  let reviewState = createPipelineState(contract, headSha);
  reviewState = startCrossReview(reviewState);
  reviewState = transitionPipelineState(reviewState, {
    type: "REVIEW_CHANGES_REQUESTED",
    reviewedHeadSha: headSha,
    reviewId: "review-failure-1",
    ...crossReview,
  });
  assert.equal(reviewState.phase, "implementing");
  reviewState = transitionPipelineState(reviewState, {
    type: "HEAD_UPDATED",
    headSha: nextHeadSha,
  });
  reviewState = startCrossReview(reviewState, {
    reviewSessionId: "claude-review-2",
  });
  reviewState = transitionPipelineState(reviewState, {
    type: "REVIEW_CHANGES_REQUESTED",
    reviewedHeadSha: nextHeadSha,
    reviewId: "review-failure-2",
    ...crossReview,
    reviewSessionId: "claude-review-2",
  });
  assert.equal(reviewState.phase, "needs-human");
  assert.deepEqual(reviewState.blockers, ["review-round-limit"]);
});

test("CI results are SHA-bound and require explicit conflict confirmation", () => {
  const initial = createPipelineState(validContract(), headSha);
  assert.throws(
    () =>
      transitionPipelineState(initial, {
        type: "CI_PASSED",
        checkedHeadSha: baseSha,
        runId: "stale-ci",
        runSequence: 1,
        runAttempt: 1,
        conflictFree: true,
      }),
    /Stale CI result/,
  );
  const noMergeability = transitionPipelineState(initial, {
    type: "CI_PASSED",
    checkedHeadSha: headSha,
    runId: "ci-without-mergeability",
    runSequence: 1,
    runAttempt: 1,
  });
  assert.equal(noMergeability.ciPassed, true);
  assert.equal(noMergeability.conflictFree, false);
  assert.ok(noMergeability.blockers.includes("merge-conflict"));
});

test("terminal states ignore delayed events until explicitly resumed", () => {
  let state = createPipelineState(validContract(), headSha);
  state = passCi(state);
  state = transitionPipelineState(state, {
    type: "DISABLE",
    reason: "User kill switch.",
  });
  const delayed = passCrossReview(state);
  assert.equal(delayed.phase, "disabled");
  assert.deepEqual(delayed.blockers, ["no-auto"]);
  assert.throws(
    () => transitionPipelineState(delayed, { type: "RESUME" }),
    /explicit human authorization/,
  );
  const resumed = transitionPipelineState(delayed, {
    type: "RESUME",
    authorization: "human",
    authorizedBy: "repository-owner",
  });
  assert.equal(resumed.phase, "implementing");
  assert.equal(resumed.ciPassed, false);
});

test("duplicate head and repeated CI failures for one head are idempotent", () => {
  let state = createPipelineState(validContract(), headSha);
  state = passCi(state);
  const duplicateHead = transitionPipelineState(state, {
    type: "HEAD_UPDATED",
    headSha,
  });
  assert.deepEqual(duplicateHead, state);

  state = createPipelineState(validContract(), headSha);
  const failure = {
    type: "CI_FAILED",
    checkedHeadSha: headSha,
    runId: "same-ci-failure",
    runSequence: 1,
    runAttempt: 1,
  };
  state = transitionPipelineState(state, failure);
  state = transitionPipelineState(state, {
    ...failure,
    runId: "different-run-same-head",
    runSequence: 2,
  });
  assert.equal(state.ciFixRounds, 1);
});

test("duplicate review failure deliveries are idempotent", () => {
  let state = createPipelineState(validContract(), headSha);
  state = startCrossReview(state);
  const failure = {
    type: "REVIEW_CHANGES_REQUESTED",
    reviewedHeadSha: headSha,
    reviewId: "review-failure-delivery-1",
    ...crossReview,
  };
  state = transitionPipelineState(state, failure);
  state = transitionPipelineState(state, failure);
  assert.equal(state.reviewRounds, 1);
});

test("review provider, isolation and session identity are enforced", () => {
  const initial = createPipelineState(validContract(), headSha);
  assert.throws(
    () =>
      transitionPipelineState(initial, {
        type: "REVIEW_STARTED",
        reviewedHeadSha: headSha,
        ...crossReview,
        reviewerProvider: "codex",
      }),
    /must be performed by claude/,
  );
  assert.throws(
    () =>
      transitionPipelineState(initial, {
        type: "REVIEW_STARTED",
        reviewedHeadSha: headSha,
        ...crossReview,
        isolatedSession: false,
      }),
    /fresh isolated/,
  );
  assert.throws(
    () =>
      transitionPipelineState(initial, {
        type: "REVIEW_STARTED",
        reviewedHeadSha: headSha,
        ...crossReview,
        readOnlyEnforced: false,
      }),
    /enforced read-only/,
  );
});

test("successful reviews do not consume the findings round limit", () => {
  let state = createPipelineState(validContract(), headSha);
  state = startCrossReview(state);
  state = passCrossReview(state);
  assert.equal(state.reviewRounds, 0);
});

test("fallback review disclosure remains visible after readiness", () => {
  let state = createPipelineState(validContract(), headSha);
  state = passCi(state);
  const fallbackIdentity = {
    mode: "fallback",
    reviewerProvider: "codex",
    isolatedSession: true,
    readOnlyEnforced: true,
    reviewSessionId: "codex-fallback-1",
  };
  state = clearReviewThreads(state);
  state = transitionPipelineState(state, {
    type: "REVIEW_STARTED",
    reviewedHeadSha: headSha,
    ...fallbackIdentity,
  });
  state = transitionPipelineState(state, {
    type: "REVIEW_PASSED",
    reviewedHeadSha: headSha,
    reviewId: "fallback-pass-1",
    ...fallbackIdentity,
  });
  assert.equal(state.phase, "ready-for-merge");
  assert.ok(labelsForState(state, config).includes("agent:review-fallback"));
});

test("unknown UI classification blocks readiness until explicitly resolved", () => {
  let state = createPipelineState(
    validContract({ "ui-change": "unknown" }),
    headSha,
  );
  assert.equal(state.uiChanged, null);
  state = passCi(state);
  state = startCrossReview(state);
  state = passCrossReview(state);
  assert.deepEqual(state.blockers, ["ui-classification"]);
  state = transitionPipelineState(state, {
    type: "UI_CLASSIFIED",
    classifiedHeadSha: headSha,
    uiChanged: false,
  });
  assert.equal(state.phase, "ready-for-merge");
});

test("a new UI head invalidates the previous notification", () => {
  let state = createPipelineState(
    validContract({ "ui-change": "yes" }),
    headSha,
  );
  state = transitionPipelineState(state, {
    type: "UI_NOTIFIED",
    notifiedHeadSha: headSha,
  });
  state = transitionPipelineState(state, {
    type: "HEAD_UPDATED",
    headSha: nextHeadSha,
    uiChanged: true,
  });
  assert.equal(state.uiNotifiedHeadSha, null);
});

test("declared scope must cover non-documentation changed paths", () => {
  const parsed = parseTaskContract(body({ scope: "docs" }));
  const invalid = validateTaskContract(
    parsed.contract,
    context(["server/src/index.ts"]),
    config,
  );
  assert.equal(invalid.valid, false);
  assert.match(invalid.errors.join("\n"), /scope docs does not cover/);

  const root = validateTaskContract(
    parseTaskContract(body({ scope: "root" })).contract,
    context(["server/src/index.ts", ".github/workflows/deploy.yml"]),
    config,
  );
  assert.equal(root.valid, true);
});

test("changed files are classified from the merge base", () => {
  const directory = mkdtempSync(join(tmpdir(), "agent-pipeline-git-"));
  try {
    execFileSync("git", ["init", "-b", "main"], { cwd: directory });
    execFileSync("git", ["config", "user.name", "Agent Pipeline Test"], {
      cwd: directory,
    });
    execFileSync("git", ["config", "user.email", "agent@example.invalid"], {
      cwd: directory,
    });
    writeFileSync(join(directory, "common.txt"), "common\n", "utf8");
    mkdirSync(join(directory, "server", "src"), { recursive: true });
    writeFileSync(
      join(directory, "server", "src", "auth.ts"),
      "export {};\n",
      "utf8",
    );
    execFileSync("git", ["add", "."], { cwd: directory });
    execFileSync("git", ["commit", "-m", "common"], { cwd: directory });
    execFileSync("git", ["checkout", "-b", "feature"], { cwd: directory });
    mkdirSync(join(directory, "docs"), { recursive: true });
    execFileSync("git", ["mv", "server/src/auth.ts", "docs/auth.ts"], {
      cwd: directory,
    });
    writeFileSync(join(directory, "feature.txt"), "feature\n", "utf8");
    execFileSync("git", ["add", "."], { cwd: directory });
    execFileSync("git", ["commit", "-m", "feature"], { cwd: directory });
    const featureSha = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: directory,
      encoding: "utf8",
    }).trim();
    execFileSync("git", ["checkout", "main"], { cwd: directory });
    writeFileSync(join(directory, "main-only.txt"), "main\n", "utf8");
    execFileSync("git", ["add", "."], { cwd: directory });
    execFileSync("git", ["commit", "-m", "main"], { cwd: directory });
    const baseTip = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: directory,
      encoding: "utf8",
    }).trim();
    assert.deepEqual(changedFiles(baseTip, featureSha, directory), [
      "docs/auth.ts",
      "feature.txt",
      "server/src/auth.ts",
    ]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("declared base SHA must also belong to the PR base branch", () => {
  const fabricatedBase = headSha;
  const errors = validateBaseShaAncestry(
    fabricatedBase,
    baseSha,
    headSha,
    (ancestor, descendant) =>
      ancestor === descendant ||
      (ancestor === baseSha && descendant === headSha),
  );
  assert.ok(errors.some((error) => error.includes("base branch")));
});

test("later same-head CI failures cannot be overwritten by delayed passes", () => {
  let state = createPipelineState(validContract(), headSha);
  state = passCi(state, { runId: "run-a", runSequence: 10 });
  state = startCrossReview(state);
  state = passCrossReview(state);
  state = transitionPipelineState(state, {
    type: "CI_FAILED",
    checkedHeadSha: headSha,
    runId: "run-b",
    runSequence: 11,
    runAttempt: 1,
  });
  const failedState = state;
  state = passCi(state, { runId: "run-a", runSequence: 10 });
  assert.deepEqual(state, failedState);
  assert.equal(state.phase, "ci-fix");
  assert.equal(state.ciPassed, false);
});

test("protected changes require current-head human approval", () => {
  const contract = validContract({ scope: "root" }, [
    ".github/workflows/deploy.yml",
  ]);
  let state = createPipelineState(contract, headSha);
  state = passCi(state);
  state = startCrossReview(state);
  state = passCrossReview(state);
  assert.ok(state.blockers.includes("protected-change"));
  assert.equal(state.phase, "review");
  assert.throws(
    () =>
      transitionPipelineState(state, {
        type: "PROTECTED_CHANGE_APPROVED",
        approvedHeadSha: headSha,
      }),
    /human authorization/,
  );
  state = transitionPipelineState(state, {
    type: "PROTECTED_CHANGE_APPROVED",
    approvedHeadSha: headSha,
    authorization: "human",
    authorizedBy: "repository-owner",
  });
  assert.equal(state.phase, "ready-for-merge");
});

test("review starts are bound to the current head", () => {
  let state = createPipelineState(validContract(), headSha);
  state = startCrossReview(state);
  assert.throws(
    () =>
      transitionPipelineState(state, {
        type: "REVIEW_STARTED",
        reviewedHeadSha: baseSha,
        ...crossReview,
        reviewSessionId: "stale-session",
      }),
    /Stale review/,
  );
  assert.equal(state.reviewSessionId, crossReview.reviewSessionId);
});

test("one review session can produce only one terminal result", () => {
  let state = createPipelineState(validContract(), headSha);
  state = passCi(state);
  state = startCrossReview(state);
  state = transitionPipelineState(state, {
    type: "REVIEW_CHANGES_REQUESTED",
    reviewedHeadSha: headSha,
    reviewId: "changes-result",
    ...crossReview,
  });
  assert.throws(
    () =>
      transitionPipelineState(state, {
        type: "REVIEW_PASSED",
        reviewedHeadSha: headSha,
        reviewId: "contradicting-pass",
        ...crossReview,
      }),
    /started review session/,
  );
  assert.throws(
    () =>
      transitionPipelineState(state, {
        type: "REVIEW_STARTED",
        reviewedHeadSha: headSha,
        ...crossReview,
        reviewSessionId: "new-session-same-head",
      }),
    /requires a new head/,
  );
  state = transitionPipelineState(state, {
    type: "HEAD_UPDATED",
    headSha: nextHeadSha,
  });
  state = startCrossReview(state, {
    reviewSessionId: "new-session-new-head",
  });
  assert.equal(state.reviewSessionId, "new-session-new-head");
});

test("UI classifications are bound to the current head", () => {
  let state = createPipelineState(
    validContract({ "ui-change": "unknown" }),
    headSha,
  );
  assert.throws(
    () =>
      transitionPipelineState(state, {
        type: "UI_CLASSIFIED",
        classifiedHeadSha: baseSha,
        uiChanged: false,
      }),
    /Stale UI classification/,
  );
  state = transitionPipelineState(state, {
    type: "UI_CLASSIFIED",
    classifiedHeadSha: headSha,
    uiChanged: false,
  });
  assert.equal(state.uiChanged, false);
});

test("readiness updates preserve active fix phases", () => {
  let state = createPipelineState(validContract(), headSha);
  state = transitionPipelineState(state, {
    type: "CI_FAILED",
    checkedHeadSha: headSha,
    runId: "failed-run",
    runSequence: 1,
    runAttempt: 1,
  });
  state = transitionPipelineState(state, {
    type: "UI_NOTIFIED",
    notifiedHeadSha: headSha,
  });
  assert.equal(state.phase, "ci-fix");

  state = transitionPipelineState(state, {
    type: "CONFLICT_DETECTED",
    checkedHeadSha: headSha,
    runId: "conflict-check",
    runSequence: 2,
    runAttempt: 1,
  });
  state = clearReviewThreads(state);
  assert.equal(state.phase, "conflict-fix");
});

test("only the configured default base branch is accepted", () => {
  const parsed = parseTaskContract(
    body({ "base-branch": "agent-controlled-base" }),
  );
  const result = validateTaskContract(
    parsed.contract,
    {
      ...context(),
      baseBranch: "agent-controlled-base",
    },
    config,
  );
  assert.equal(result.valid, false);
  assert.match(result.errors.join("\n"), /configured default branch/);
});

test("terminal states record new heads without clearing terminal blockers", () => {
  let state = createPipelineState(validContract(), headSha);
  state = transitionPipelineState(state, {
    type: "DISABLE",
    reason: "User kill switch.",
  });
  state = transitionPipelineState(state, {
    type: "HEAD_UPDATED",
    headSha: nextHeadSha,
  });
  assert.equal(state.headSha, nextHeadSha);
  assert.equal(state.phase, "disabled");
  assert.deepEqual(state.blockers, ["no-auto"]);
  state = transitionPipelineState(state, {
    type: "RESUME",
    authorization: "human",
    authorizedBy: "repository-owner",
  });
  assert.equal(state.headSha, nextHeadSha);
});

test("blocking review threads prevent readiness until reconciled", () => {
  let state = createPipelineState(validContract(), headSha);
  state = passCi(state);
  state = startCrossReview(state);
  state = passCrossReview(state);
  assert.equal(state.phase, "ready-for-merge");
  state = transitionPipelineState(state, {
    type: "REVIEW_THREADS_UPDATED",
    checkedHeadSha: headSha,
    blockingThreadIds: ["thread-2", "thread-1", "thread-1"],
  });
  assert.deepEqual(state.blockingReviewThreadIds, ["thread-1", "thread-2"]);
  assert.ok(state.blockers.includes("review-threads"));
  state = transitionPipelineState(state, {
    type: "REVIEW_THREADS_UPDATED",
    checkedHeadSha: headSha,
    blockingThreadIds: [],
  });
  assert.equal(state.phase, "ready-for-merge");
});
