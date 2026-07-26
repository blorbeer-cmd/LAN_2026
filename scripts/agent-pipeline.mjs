import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configPath = resolve(
  repoRoot,
  ".github",
  "agent-pipeline",
  "config.json",
);

export function loadConfig(path = configPath) {
  return JSON.parse(readFileSync(path, "utf8"));
}

const contractKeys = new Set([
  "task-id",
  "implementer",
  "base-branch",
  "base-sha",
  "head-branch",
  "scope",
  "ui-change",
  "max-ci-fix-rounds",
  "max-review-rounds",
]);

export function parseTaskContract(body) {
  const text = typeof body === "string" ? body : "";
  const match = text.match(
    /(?:<!--\s*)?agent-pipeline:task\s*\r?\n([\s\S]*?)\r?\n\s*agent-pipeline:end(?:\s*-->)?/,
  );

  if (!match) return { participating: false, contract: null, errors: [] };

  const values = {};
  const errors = [];
  for (const originalLine of match[1].split(/\r?\n/)) {
    const line = originalLine.trim();
    if (!line) continue;
    const separator = line.indexOf(":");
    if (separator < 1) {
      errors.push(`Malformed task-contract line: ${line}`);
      continue;
    }

    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (!contractKeys.has(key)) {
      errors.push(`Unknown task-contract key: ${key}`);
      continue;
    }
    if (Object.hasOwn(values, key)) {
      errors.push(`Duplicate task-contract key: ${key}`);
      continue;
    }
    values[key] = value;
  }

  const untouchedTemplate = values["task-id"] === "agent-YYYYMMDD-NNN";
  if (untouchedTemplate) {
    return { participating: false, contract: null, errors: [] };
  }

  return { participating: true, contract: values, errors };
}

function parseRoundLimit(value, key, errors) {
  if (!/^\d+$/.test(value ?? "")) {
    errors.push(`${key} must be an integer between 1 and 3.`);
    return null;
  }
  const parsed = Number(value);
  if (parsed < 1 || parsed > 3) {
    errors.push(`${key} must be between 1 and 3.`);
    return null;
  }
  return parsed;
}

function scopeCoversPath(scope, path, config) {
  if (scope === "root") return true;
  if (config.scopeSharedPaths.some((prefix) => path.startsWith(prefix))) {
    return true;
  }
  return (config.scopePathPrefixes[scope] ?? []).some((prefix) =>
    path.startsWith(prefix),
  );
}

export function validateTaskContract(contract, context, config = loadConfig()) {
  const errors = [];
  const warnings = [];
  const missing = [...contractKeys].filter(
    (key) => !Object.hasOwn(contract ?? {}, key) || contract[key] === "",
  );
  if (missing.length)
    errors.push(`Missing task-contract keys: ${missing.join(", ")}`);

  const implementer = contract?.implementer;
  if (!Object.hasOwn(config.branchPrefixes, implementer ?? "")) {
    errors.push("implementer must be codex or claude.");
  }
  const allowedAuthors = config.providerAuthorAllowlist?.[implementer] ?? [];
  if (
    typeof context.authorLogin !== "string" ||
    !allowedAuthors.includes(context.authorLogin)
  ) {
    errors.push(
      `PR author ${context.authorLogin ?? "unknown"} is not allowed for implementer ${implementer ?? "unknown"}.`,
    );
  }

  if (contract?.["base-branch"] !== context.baseBranch) {
    errors.push(
      `base-branch must match the PR base (${context.baseBranch ?? "unknown"}).`,
    );
  }
  if (context.baseBranch !== config.defaultBaseBranch) {
    errors.push(
      `PR base must be the configured default branch (${config.defaultBaseBranch}).`,
    );
  }
  if (contract?.["head-branch"] !== context.headBranch) {
    errors.push(
      `head-branch must match the PR head (${context.headBranch ?? "unknown"}).`,
    );
  }
  if (context.headRepository !== context.repository) {
    errors.push(
      "Agent-pipeline writes are not allowed for fork pull requests.",
    );
  }

  const expectedPrefix = config.branchPrefixes[implementer];
  if (
    expectedPrefix &&
    !contract?.["head-branch"]?.startsWith(expectedPrefix)
  ) {
    errors.push(
      `head-branch must start with ${expectedPrefix} for implementer ${implementer}.`,
    );
  }
  if (
    !/^agent-\d{8}-[a-z0-9][a-z0-9-]{2,31}$/.test(contract?.["task-id"] ?? "")
  ) {
    errors.push(
      "task-id must match agent-YYYYMMDD-<lowercase id> (3 to 32 id characters).",
    );
  }
  if (!/^[0-9a-f]{40}$/i.test(contract?.["base-sha"] ?? "")) {
    errors.push("base-sha must be a full 40-character commit SHA.");
  } else if (/^0{40}$/.test(contract["base-sha"])) {
    errors.push("base-sha must not be the template placeholder.");
  }
  if (!config.allowedScopes.includes(contract?.scope)) {
    errors.push(`scope must be one of: ${config.allowedScopes.join(", ")}.`);
  }
  if (!new Set(["yes", "no", "unknown"]).has(contract?.["ui-change"])) {
    errors.push("ui-change must be yes, no, or unknown.");
  }

  const maxCiFixRounds = parseRoundLimit(
    contract?.["max-ci-fix-rounds"],
    "max-ci-fix-rounds",
    errors,
  );
  const maxReviewRounds = parseRoundLimit(
    contract?.["max-review-rounds"],
    "max-review-rounds",
    errors,
  );

  const changedFiles = context.changedFiles ?? [];
  const uncoveredPaths = config.allowedScopes.includes(contract?.scope)
    ? changedFiles.filter(
        (path) => !scopeCoversPath(contract.scope, path, config),
      )
    : [];
  if (uncoveredPaths.length) {
    errors.push(
      `scope ${contract.scope} does not cover changed paths: ${uncoveredPaths.join(", ")}.`,
    );
  }
  const uiPathChanged = changedFiles.some((path) =>
    config.uiPathPrefixes.some((prefix) => path.startsWith(prefix)),
  );
  const protectedPaths = changedFiles.filter((path) =>
    config.protectedPathPrefixes.some((prefix) => path.startsWith(prefix)),
  );
  const uiChanged = uiPathChanged
    ? true
    : contract?.["ui-change"] === "yes"
      ? true
      : contract?.["ui-change"] === "no"
        ? false
        : null;
  if (contract?.["ui-change"] === "no" && uiPathChanged) {
    warnings.push(
      "ui-change was declared no, but a configured UI path changed; treating it as yes.",
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    normalized: {
      taskId: contract?.["task-id"] ?? null,
      implementer: implementer ?? null,
      baseBranch: contract?.["base-branch"] ?? null,
      baseSha: contract?.["base-sha"] ?? null,
      headBranch: contract?.["head-branch"] ?? null,
      scope: contract?.scope ?? null,
      uiChanged,
      maxCiFixRounds,
      maxReviewRounds,
      protectedPaths,
    },
  };
}

export function createPipelineState(contract, headSha) {
  if (!contract?.taskId || !/^[0-9a-f]{40}$/i.test(headSha ?? "")) {
    throw new Error("A normalized contract and full head SHA are required.");
  }
  return {
    schemaVersion: 4,
    taskId: contract.taskId,
    implementer: contract.implementer,
    phase: "implementing",
    headSha,
    reviewedHeadSha: null,
    reviewMode: null,
    reviewerProvider: null,
    reviewSessionId: null,
    reviewRequestId: `${contract.taskId}:${headSha}`,
    reviewSessionCompleted: false,
    lastReviewResultId: null,
    lastReviewFailureHeadSha: null,
    verdict: null,
    ciPassed: false,
    ciRunId: null,
    ciRunSequence: null,
    ciRunAttempt: null,
    ciConclusion: null,
    lastCiFailureRunId: null,
    lastCiFailureHeadSha: null,
    conflictFree: false,
    protectedPaths: [...(contract.protectedPaths ?? [])],
    protectedApprovedHeadSha: null,
    blockingReviewThreadIds: null,
    reviewThreadSnapshotSequence: null,
    reviewThreadSnapshotId: null,
    uiChanged: contract.uiChanged,
    uiNotifiedHeadSha: null,
    ciFixRounds: 0,
    reviewRounds: 0,
    maxCiFixRounds: contract.maxCiFixRounds,
    maxReviewRounds: contract.maxReviewRounds,
    blockers: [],
    lastReason: null,
  };
}

function ensureCurrentReview(state, event) {
  if (event.reviewedHeadSha !== state.headSha) {
    throw new Error(
      `Stale review for ${event.reviewedHeadSha ?? "unknown"}; current head is ${state.headSha}.`,
    );
  }
}

function ensureCurrentCi(state, event) {
  if (event.checkedHeadSha !== state.headSha) {
    throw new Error(
      `Stale CI result for ${event.checkedHeadSha ?? "unknown"}; current head is ${state.headSha}.`,
    );
  }
  if (typeof event.runId !== "string" || event.runId.length === 0) {
    throw new Error(`${event.type} requires a stable runId.`);
  }
  if (!Number.isSafeInteger(event.runSequence) || event.runSequence < 1) {
    throw new Error(`${event.type} requires a positive integer runSequence.`);
  }
  if (!Number.isSafeInteger(event.runAttempt) || event.runAttempt < 1) {
    throw new Error(`${event.type} requires a positive integer runAttempt.`);
  }
}

function compareCiOrder(state, event) {
  if (state.ciRunSequence === null) return 1;
  if (event.runSequence !== state.ciRunSequence) {
    return event.runSequence - state.ciRunSequence;
  }
  return event.runAttempt - state.ciRunAttempt;
}

function validateReviewIdentity(state, event, requireStarted = false) {
  if (!new Set(["codex", "claude"]).has(event.reviewerProvider)) {
    throw new Error("Review events require reviewerProvider codex or claude.");
  }
  if (!new Set(["cross", "fallback"]).has(event.mode)) {
    throw new Error("Review events require mode cross or fallback.");
  }
  const expectedCrossProvider =
    state.implementer === "codex" ? "claude" : "codex";
  if (
    event.mode === "cross" &&
    event.reviewerProvider !== expectedCrossProvider
  ) {
    throw new Error(
      `Cross-review for ${state.implementer} must be performed by ${expectedCrossProvider}.`,
    );
  }
  if (
    event.mode === "fallback" &&
    event.reviewerProvider !== state.implementer
  ) {
    throw new Error(
      `Fallback review must be performed by the implementation provider ${state.implementer}.`,
    );
  }
  if (
    event.isolatedSession !== true ||
    event.readOnlyEnforced !== true ||
    typeof event.reviewRequestId !== "string" ||
    event.reviewRequestId.length === 0 ||
    typeof event.reviewSessionId !== "string" ||
    event.reviewSessionId.length === 0
  ) {
    throw new Error(
      "Review events require a fresh isolated, enforced read-only session and reviewSessionId.",
    );
  }
  if (
    requireStarted &&
    (!state.reviewSessionId ||
      state.reviewSessionId !== event.reviewSessionId ||
      state.reviewRequestId !== event.reviewRequestId ||
      state.reviewerProvider !== event.reviewerProvider ||
      state.reviewMode !== event.mode ||
      state.reviewSessionCompleted)
  ) {
    throw new Error("Review result does not match the started review session.");
  }
}

function withReadiness(state) {
  const blockers = [];
  if (!state.ciPassed) blockers.push("ci");
  if (!state.conflictFree) blockers.push("merge-conflict");
  if (state.protectedPaths === null) {
    blockers.push("protected-path-status");
  } else if (
    state.protectedPaths.length > 0 &&
    state.protectedApprovedHeadSha !== state.headSha
  ) {
    blockers.push("protected-change");
  }
  if (state.blockingReviewThreadIds === null) {
    blockers.push("review-thread-status");
  } else if (state.blockingReviewThreadIds.length > 0) {
    blockers.push("review-threads");
  }
  if (state.verdict !== "pass" || state.reviewedHeadSha !== state.headSha) {
    blockers.push("review");
  }
  if (state.uiChanged === null) blockers.push("ui-classification");
  if (state.uiChanged === true && state.uiNotifiedHeadSha !== state.headSha) {
    blockers.push("ui-notification");
  }

  if (blockers.length === 0) {
    return { ...state, phase: "ready-for-merge", blockers: [] };
  }
  const activePhase = new Set([
    "implementing",
    "ci-fix",
    "conflict-fix",
    "waiting",
  ]).has(state.phase);
  return {
    ...state,
    blockers,
    phase: activePhase ? state.phase : "review",
  };
}

export function transitionPipelineState(current, event) {
  const state = structuredClone(current);
  const terminalPhase = new Set(["disabled", "needs-human"]).has(state.phase);
  if (
    terminalPhase &&
    !new Set(["RESUME", "DISABLE", "HEAD_UPDATED"]).has(event.type)
  ) {
    return state;
  }
  switch (event.type) {
    case "HEAD_UPDATED": {
      if (!/^[0-9a-f]{40}$/i.test(event.headSha ?? "")) {
        throw new Error("HEAD_UPDATED requires a full head SHA.");
      }
      if (event.headSha === state.headSha) return state;
      let protectedPaths = null;
      if (event.protectedPaths !== undefined) {
        if (
          event.protectedClassificationTrusted !== true ||
          !Array.isArray(event.protectedPaths) ||
          event.protectedPaths.some(
            (path) => typeof path !== "string" || path.length === 0,
          )
        ) {
          throw new Error(
            "HEAD_UPDATED protected paths require a trusted string-array classification.",
          );
        }
        protectedPaths = [...new Set(event.protectedPaths)].sort();
      }
      const uiChanged =
        event.uiChanged === true
          ? true
          : event.uiChanged === false && state.uiChanged === null
            ? false
            : state.uiChanged;
      return {
        ...state,
        phase: terminalPhase ? state.phase : "implementing",
        headSha: event.headSha,
        reviewedHeadSha: null,
        reviewMode: null,
        reviewerProvider: null,
        reviewSessionId: null,
        reviewRequestId: `${state.taskId}:${event.headSha}`,
        reviewSessionCompleted: false,
        lastReviewResultId: null,
        verdict: null,
        ciPassed: false,
        ciRunId: null,
        ciRunSequence: null,
        ciRunAttempt: null,
        ciConclusion: null,
        lastCiFailureRunId: null,
        conflictFree: false,
        protectedPaths,
        protectedApprovedHeadSha: null,
        blockingReviewThreadIds: null,
        reviewThreadSnapshotSequence: null,
        reviewThreadSnapshotId: null,
        uiChanged,
        uiNotifiedHeadSha: null,
        blockers: terminalPhase ? state.blockers : [],
        lastReason: terminalPhase ? state.lastReason : null,
      };
    }
    case "CI_FAILED": {
      ensureCurrentCi(state, event);
      const order = compareCiOrder(state, event);
      if (order <= 0 || event.runId === state.lastCiFailureRunId) return state;
      if (state.lastCiFailureHeadSha === state.headSha) {
        return {
          ...state,
          phase: "ci-fix",
          ciPassed: false,
          ciRunId: event.runId,
          ciRunSequence: event.runSequence,
          ciRunAttempt: event.runAttempt,
          ciConclusion: "failure",
          lastCiFailureRunId: event.runId,
          blockers: ["ci"],
          lastReason: event.reason ?? null,
        };
      }
      const nextRound = state.ciFixRounds + 1;
      if (nextRound > state.maxCiFixRounds) {
        return {
          ...state,
          phase: "needs-human",
          ciFixRounds: nextRound,
          ciRunId: event.runId,
          ciRunSequence: event.runSequence,
          ciRunAttempt: event.runAttempt,
          ciConclusion: "failure",
          lastCiFailureRunId: event.runId,
          lastCiFailureHeadSha: state.headSha,
          blockers: ["ci-round-limit"],
          lastReason: event.reason ?? "CI fix round limit exceeded.",
        };
      }
      return {
        ...state,
        phase: "ci-fix",
        ciPassed: false,
        ciRunId: event.runId,
        ciRunSequence: event.runSequence,
        ciRunAttempt: event.runAttempt,
        ciConclusion: "failure",
        ciFixRounds: nextRound,
        lastCiFailureRunId: event.runId,
        lastCiFailureHeadSha: state.headSha,
        blockers: ["ci"],
        lastReason: event.reason ?? null,
      };
    }
    case "CONFLICT_DETECTED": {
      ensureCurrentCi(state, event);
      if (compareCiOrder(state, event) <= 0) return state;
      return {
        ...state,
        phase: "conflict-fix",
        conflictFree: false,
        ciRunId: event.runId,
        ciRunSequence: event.runSequence,
        ciRunAttempt: event.runAttempt,
        ciConclusion: "conflict",
        blockers: ["merge-conflict"],
        lastReason: event.reason ?? null,
      };
    }
    case "CI_PASSED":
      ensureCurrentCi(state, event);
      if (compareCiOrder(state, event) <= 0) return state;
      return withReadiness({
        ...state,
        ciPassed: true,
        ciRunId: event.runId,
        ciRunSequence: event.runSequence,
        ciRunAttempt: event.runAttempt,
        ciConclusion: "success",
        conflictFree: event.conflictFree === true,
        phase: "review",
        lastReason: null,
      });
    case "REVIEW_STARTED":
      ensureCurrentReview(state, event);
      validateReviewIdentity(state, event);
      if (
        state.reviewSessionId === event.reviewSessionId &&
        state.reviewRequestId === event.reviewRequestId &&
        state.reviewerProvider === event.reviewerProvider &&
        state.reviewMode === event.mode
      ) {
        return state;
      }
      if (
        state.verdict === "changes-required" &&
        state.reviewedHeadSha === state.headSha
      ) {
        throw new Error(
          "A review with findings requires a new head before another review can start.",
        );
      }
      if (state.reviewRequestId !== event.reviewRequestId) {
        throw new Error(
          "Review start does not match the active review request.",
        );
      }
      return {
        ...state,
        phase: event.mode === "fallback" ? "review-fallback" : "review",
        reviewMode: event.mode,
        reviewerProvider: event.reviewerProvider,
        reviewSessionId: event.reviewSessionId,
        reviewRequestId: event.reviewRequestId,
        reviewSessionCompleted: false,
        blockers: ["review"],
        lastReason: null,
      };
    case "REVIEWER_UNAVAILABLE":
      if (event.reviewedHeadSha !== state.headSha) return state;
      if (
        typeof event.reviewRequestId !== "string" ||
        event.reviewRequestId.length === 0
      ) {
        throw new Error(
          "REVIEWER_UNAVAILABLE requires a stable reviewRequestId.",
        );
      }
      if (state.reviewRequestId !== event.reviewRequestId) {
        return state;
      }
      if (event.fallbackAvailable) {
        return {
          ...state,
          phase: "review-fallback",
          reviewMode: "fallback",
          reviewRequestId: event.reviewRequestId,
          blockers: ["review"],
          lastReason: event.reason ?? "Regular reviewer unavailable.",
        };
      }
      return {
        ...state,
        phase: "waiting",
        reviewRequestId: event.reviewRequestId,
        blockers: ["provider-unavailable"],
        lastReason: event.reason ?? "Both review paths unavailable.",
      };
    case "REVIEW_CHANGES_REQUESTED": {
      ensureCurrentReview(state, event);
      if (typeof event.reviewId !== "string" || event.reviewId.length === 0) {
        throw new Error("Review results require a stable reviewId.");
      }
      if (event.reviewId === state.lastReviewResultId) return state;
      validateReviewIdentity(state, event, true);
      if (state.lastReviewFailureHeadSha === state.headSha) {
        return state;
      }
      const nextRound = state.reviewRounds + 1;
      if (nextRound > state.maxReviewRounds) {
        return {
          ...state,
          phase: "needs-human",
          reviewedHeadSha: event.reviewedHeadSha,
          verdict: "changes-required",
          reviewRounds: nextRound,
          lastReviewResultId: event.reviewId,
          reviewSessionCompleted: true,
          lastReviewFailureHeadSha: state.headSha,
          blockers: ["review-round-limit"],
          lastReason: event.reason ?? "Review round limit reached.",
        };
      }
      return {
        ...state,
        phase: "implementing",
        reviewedHeadSha: event.reviewedHeadSha,
        verdict: "changes-required",
        reviewRounds: nextRound,
        lastReviewResultId: event.reviewId,
        reviewSessionCompleted: true,
        lastReviewFailureHeadSha: state.headSha,
        blockers: ["review-findings"],
        lastReason: event.reason ?? null,
      };
    }
    case "REVIEW_PASSED":
      ensureCurrentReview(state, event);
      if (typeof event.reviewId !== "string" || event.reviewId.length === 0) {
        throw new Error("Review results require a stable reviewId.");
      }
      if (event.reviewId === state.lastReviewResultId) return state;
      validateReviewIdentity(state, event, true);
      return withReadiness({
        ...state,
        reviewedHeadSha: event.reviewedHeadSha,
        verdict: "pass",
        lastReviewResultId: event.reviewId,
        reviewSessionCompleted: true,
        lastReason: null,
      });
    case "UI_CLASSIFIED":
      if (event.classifiedHeadSha !== state.headSha) {
        throw new Error(
          `Stale UI classification for ${event.classifiedHeadSha ?? "unknown"}; current head is ${state.headSha}.`,
        );
      }
      if (typeof event.uiChanged !== "boolean") {
        throw new Error("UI_CLASSIFIED requires uiChanged true or false.");
      }
      return withReadiness({
        ...state,
        uiChanged: state.uiChanged === true ? true : event.uiChanged,
        uiNotifiedHeadSha: event.uiChanged ? state.uiNotifiedHeadSha : null,
        lastReason: null,
      });
    case "REVIEW_THREADS_UPDATED":
      if (event.checkedHeadSha !== state.headSha) {
        throw new Error(
          `Stale review-thread status for ${event.checkedHeadSha ?? "unknown"}; current head is ${state.headSha}.`,
        );
      }
      if (
        !Array.isArray(event.blockingThreadIds) ||
        event.blockingThreadIds.some(
          (id) => typeof id !== "string" || id.length === 0,
        )
      ) {
        throw new Error(
          "REVIEW_THREADS_UPDATED requires an array of blocking thread IDs.",
        );
      }
      if (
        !Number.isSafeInteger(event.snapshotSequence) ||
        event.snapshotSequence < 1 ||
        typeof event.snapshotId !== "string" ||
        event.snapshotId.length === 0
      ) {
        throw new Error(
          "REVIEW_THREADS_UPDATED requires a positive snapshotSequence and stable snapshotId.",
        );
      }
      if (state.reviewThreadSnapshotSequence !== null) {
        if (event.snapshotSequence < state.reviewThreadSnapshotSequence) {
          return state;
        }
        if (event.snapshotSequence === state.reviewThreadSnapshotSequence) {
          if (event.snapshotId === state.reviewThreadSnapshotId) return state;
          throw new Error(
            "Conflicting review-thread snapshots share the same sequence.",
          );
        }
      }
      return withReadiness({
        ...state,
        blockingReviewThreadIds: [...new Set(event.blockingThreadIds)].sort(),
        reviewThreadSnapshotSequence: event.snapshotSequence,
        reviewThreadSnapshotId: event.snapshotId,
        lastReason: null,
      });
    case "PROTECTED_CHANGE_APPROVED":
      if (
        event.authorization !== "human" ||
        typeof event.authorizedBy !== "string" ||
        event.authorizedBy.length === 0
      ) {
        throw new Error(
          "PROTECTED_CHANGE_APPROVED requires explicit human authorization.",
        );
      }
      if (event.approvedHeadSha !== state.headSha) {
        throw new Error(
          `Stale protected-change approval for ${event.approvedHeadSha ?? "unknown"}; current head is ${state.headSha}.`,
        );
      }
      return withReadiness({
        ...state,
        protectedApprovedHeadSha: event.approvedHeadSha,
        lastReason: null,
      });
    case "UI_NOTIFIED":
      if (event.notifiedHeadSha !== state.headSha) {
        throw new Error(
          `Stale UI notification for ${event.notifiedHeadSha ?? "unknown"}; current head is ${state.headSha}.`,
        );
      }
      return withReadiness({
        ...state,
        uiNotifiedHeadSha: event.notifiedHeadSha,
        lastReason: null,
      });
    case "CRITICAL_BLOCKER":
      return {
        ...state,
        phase: "needs-human",
        blockers: ["critical-decision"],
        lastReason: event.reason ?? "Critical decision required.",
      };
    case "DISABLE":
      return {
        ...state,
        phase: "disabled",
        blockers: ["no-auto"],
        lastReason: event.reason ?? "Pipeline disabled.",
      };
    case "RESUME":
      if (
        event.authorization !== "human" ||
        typeof event.authorizedBy !== "string" ||
        event.authorizedBy.length === 0
      ) {
        throw new Error(
          "RESUME requires an explicit human authorization and actor.",
        );
      }
      return {
        ...state,
        phase: "implementing",
        reviewedHeadSha: null,
        reviewMode: null,
        reviewerProvider: null,
        reviewSessionId: null,
        reviewRequestId: `${state.taskId}:${state.headSha}`,
        reviewSessionCompleted: false,
        lastReviewResultId: null,
        lastReviewFailureHeadSha: null,
        verdict: null,
        ciPassed: false,
        ciRunId: null,
        ciRunSequence: null,
        ciRunAttempt: null,
        ciConclusion: null,
        lastCiFailureRunId: null,
        lastCiFailureHeadSha: null,
        conflictFree: false,
        protectedApprovedHeadSha: null,
        blockingReviewThreadIds: null,
        reviewThreadSnapshotSequence: null,
        reviewThreadSnapshotId: null,
        ciFixRounds: 0,
        reviewRounds: 0,
        blockers: [],
        lastReason: event.reason ?? "Pipeline explicitly resumed.",
      };
    default:
      throw new Error(`Unsupported pipeline event: ${event.type}`);
  }
}

export function labelsForState(state, config = loadConfig()) {
  const labels = new Set([config.labels.pipeline]);
  if (state.uiChanged) labels.add(config.labels.uiChanged);
  if (state.reviewMode === "fallback") {
    labels.add(config.labels.reviewFallback);
  }
  const phaseLabels = {
    implementing: config.labels.implementing,
    "ci-fix": config.labels.ciFix,
    "conflict-fix": config.labels.conflictFix,
    review: config.labels.review,
    "review-fallback": config.labels.reviewFallback,
    waiting: config.labels.waiting,
    "needs-human": config.labels.needsHuman,
    "ready-for-merge": config.labels.readyForMerge,
    disabled: config.labels.noAuto,
  };
  if (phaseLabels[state.phase]) labels.add(phaseLabels[state.phase]);
  return [...labels].sort();
}

export function changedFiles(baseSha, headSha, cwd = repoRoot) {
  if (!baseSha || !headSha) return [];
  const output = execFileSync(
    "git",
    ["diff", "--no-renames", "--name-only", "-z", `${baseSha}...${headSha}`],
    { cwd, encoding: "utf8", windowsHide: true },
  );
  return output.split("\0").filter(Boolean);
}

function isAncestor(baseSha, headSha) {
  if (!baseSha || !headSha) return true;
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", baseSha, headSha], {
      cwd: repoRoot,
      encoding: "utf8",
      windowsHide: true,
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
}

export function validateBaseShaAncestry(
  declaredBaseSha,
  prBaseSha,
  headSha,
  ancestor = isAncestor,
) {
  const errors = [];
  if (declaredBaseSha && headSha && !ancestor(declaredBaseSha, headSha)) {
    errors.push(
      "The declared base-sha must be an ancestor of the current PR head.",
    );
  }
  if (declaredBaseSha && prBaseSha && !ancestor(declaredBaseSha, prBaseSha)) {
    errors.push("The declared base-sha must belong to the PR base branch.");
  }
  return errors;
}

function writeGithubOutput(values) {
  if (!process.env.GITHUB_OUTPUT) return;
  const lines = Object.entries(values).map(
    ([key, value]) => `${key}=${value}\n`,
  );
  appendFileSync(process.env.GITHUB_OUTPUT, lines.join(""), "utf8");
}

function writeSummary(lines) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    `${lines.join("\n")}\n`,
    "utf8",
  );
}

function option(args, name) {
  const index = args.indexOf(name);
  if (index === -1 || index + 1 >= args.length) return null;
  return args[index + 1];
}

function validateEventCommand(args) {
  const eventPath = option(args, "--event");
  const baseSha = option(args, "--base-sha");
  const headSha = option(args, "--head-sha");
  if (!eventPath) throw new Error("validate-event requires --event <path>.");

  const event = JSON.parse(readFileSync(eventPath, "utf8"));
  const pr = event.pull_request;
  if (!pr) throw new Error("GitHub event does not contain a pull_request.");

  const parsed = parseTaskContract(pr.body);
  if (!parsed.participating) {
    writeGithubOutput({ participating: "false" });
    writeSummary([
      "## Agent pipeline contract",
      "",
      "This pull request does not contain an active agent-pipeline task contract.",
    ]);
    return;
  }

  const sameRepository =
    pr.head?.repo?.full_name === event.repository?.full_name;
  const shaErrors = [];
  if (sameRepository) {
    for (const [name, sha] of [
      ["base-sha", baseSha],
      ["head-sha", headSha],
    ]) {
      if (!/^[0-9a-f]{40}$/i.test(sha ?? "")) {
        shaErrors.push(
          `Active same-repository contracts require --${name} with a full commit SHA.`,
        );
        continue;
      }
      try {
        execFileSync("git", ["cat-file", "-e", `${sha}^{commit}`], {
          cwd: repoRoot,
          encoding: "utf8",
          windowsHide: true,
          stdio: "pipe",
        });
      } catch {
        shaErrors.push(`--${name} does not resolve to an available commit.`);
      }
    }
  }
  const result = validateTaskContract(
    parsed.contract,
    {
      repository: event.repository?.full_name,
      headRepository: pr.head?.repo?.full_name,
      authorLogin: pr.user?.login,
      baseBranch: pr.base?.ref,
      headBranch: pr.head?.ref,
      changedFiles:
        sameRepository && shaErrors.length === 0
          ? changedFiles(baseSha, headSha)
          : [],
    },
    loadConfig(),
  );
  result.errors.unshift(...parsed.errors);
  result.errors.push(...shaErrors);
  if (sameRepository && shaErrors.length === 0) {
    result.errors.push(
      ...validateBaseShaAncestry(result.normalized.baseSha, baseSha, headSha),
    );
  }
  result.valid = result.errors.length === 0;

  writeGithubOutput({
    participating: "true",
    valid: String(result.valid),
    task_id: result.normalized.taskId ?? "",
    implementer: result.normalized.implementer ?? "",
    ui_changed:
      result.normalized.uiChanged === null
        ? "unknown"
        : String(result.normalized.uiChanged),
    protected_changed: String(result.normalized.protectedPaths.length > 0),
  });
  writeSummary([
    "## Agent pipeline contract",
    "",
    `- Task: \`${result.normalized.taskId ?? "unknown"}\``,
    `- Implementer: \`${result.normalized.implementer ?? "unknown"}\``,
    `- UI/UX change: \`${result.normalized.uiChanged === null ? "unknown" : result.normalized.uiChanged}\``,
    `- Protected paths changed: \`${result.normalized.protectedPaths.length > 0}\``,
    ...(result.warnings.length
      ? ["", "### Warnings", ...result.warnings.map((item) => `- ${item}`)]
      : []),
    ...(result.errors.length
      ? ["", "### Errors", ...result.errors.map((item) => `- ${item}`)]
      : []),
  ]);

  for (const warning of result.warnings) console.warn(`warning: ${warning}`);
  if (!result.valid) {
    throw new Error(
      `Invalid agent-pipeline task contract:\n- ${result.errors.join("\n- ")}`,
    );
  }
}

const isMainModule =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  const [command, ...args] = process.argv.slice(2);
  try {
    if (command === "validate-event") validateEventCommand(args);
    else
      throw new Error(
        "Usage: node scripts/agent-pipeline.mjs validate-event --event <path> [--base-sha <sha> --head-sha <sha>]",
      );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
