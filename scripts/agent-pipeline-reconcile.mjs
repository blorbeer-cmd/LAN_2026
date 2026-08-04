// Stateless readiness reconciler for the agent pipeline.
//
// Readiness is derived from the current GitHub state on every run instead of from an own event
// stream. Nothing here keeps history, so the same snapshot always produces the same plan and a
// duplicated, delayed or out-of-order event cannot corrupt the result. Every head-bound
// classification falls back to "unknown", and therefore to blocking, when it does not belong to
// the current head SHA.
//
// This phase reports readiness only. It starts no agent, writes no commit status, and never
// approves or merges anything.

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  loadConfig,
  parseTaskContract,
  validateTaskContract,
} from "./agent-pipeline.mjs";

export const STATUS_COMMENT_MARKER = "<!-- agent-pipeline:status -->";
// The UI/UX notice records the head it was written for, so a later commit invalidates it:
// `<!-- agent-pipeline:ui-notice <40-char head sha> -->`
export const UI_NOTICE_MARKER = "<!-- agent-pipeline:ui-notice";
const UI_NOTICE_PATTERN = /<!--\s*agent-pipeline:ui-notice\s+([0-9a-f]{40})\s*-->/;

// Labels this phase owns and may both add and remove. Every other label on the pull request stays
// untouched, including labels a human added by hand.
const MANAGED_LABEL_KEYS = [
  "pipeline",
  "implementing",
  "ciFix",
  "conflictFix",
  "review",
  "readyForMerge",
  "uiChanged",
];

// `needsHuman` is add-only: automation may raise it, but only a human may clear it again.
// `noAuto` is never written at all. `waiting` and `reviewFallback` belong to the provider phases
// that do not exist yet, so this reconciler must neither set nor clear them.
const ADD_ONLY_LABEL_KEYS = ["needsHuman"];

const PHASE_LABEL_KEYS = {
  implementing: "implementing",
  "ci-fix": "ciFix",
  "conflict-fix": "conflictFix",
  review: "review",
  "ready-for-merge": "readyForMerge",
  "needs-human": "needsHuman",
};

const FAILING_CONCLUSIONS = new Set([
  "failure",
  "timed_out",
  "cancelled",
  "action_required",
  "startup_failure",
  "stale",
]);

const PASSING_CONCLUSIONS = new Set(["success", "neutral", "skipped"]);

function labelName(config, key) {
  return config.labels[key];
}

/** The regular cross-review always comes from the other provider. */
export function reviewerProviderFor(implementer, config) {
  const providers = Object.keys(config.branchPrefixes ?? {});
  return providers.find((provider) => provider !== implementer) ?? null;
}

function isBotLogin(login) {
  return typeof login === "string" && login.endsWith("[bot]");
}

/**
 * Reduces the reviews that belong to the current head SHA to a single verdict.
 *
 * Reviews for any other SHA are dropped entirely, so a stale approval can never open the gate.
 * Only the latest review per author counts, and a plain comment never carries a verdict.
 */
export function evaluateReviews(reviews, headSha, allowedReviewerLogins) {
  const currentHead = (reviews ?? []).filter(
    (review) => review.commitSha === headSha,
  );

  const latestByAuthor = new Map();
  for (const review of currentHead) {
    if (review.state === "COMMENTED" || review.state === "DISMISSED") continue;
    const previous = latestByAuthor.get(review.author);
    if (
      !previous ||
      (review.submittedAt ?? "") >= (previous.submittedAt ?? "")
    ) {
      latestByAuthor.set(review.author, review);
    }
  }

  const decisive = [...latestByAuthor.values()];
  const fromReviewer = decisive.filter((review) =>
    (allowedReviewerLogins ?? []).includes(review.author),
  );

  let verdict = "none";
  if (fromReviewer.some((review) => review.state === "CHANGES_REQUESTED")) {
    verdict = "changes-required";
  } else if (fromReviewer.some((review) => review.state === "APPROVED")) {
    verdict = "pass";
  }

  const humanApproval = decisive.some(
    (review) => review.state === "APPROVED" && !isBotLogin(review.author),
  );

  return { verdict, humanApproval };
}

/**
 * Check runs are fetched per SHA. A snapshot carrying results for a different SHA counts as
 * unknown rather than as a pass.
 */
export function evaluateChecks(snapshot, config) {
  if (
    snapshot.checkRunsHeadSha &&
    snapshot.checkRunsHeadSha !== snapshot.headSha
  ) {
    return { state: "unknown", failing: [], pending: [] };
  }

  // The readiness status itself must never gate readiness.
  const relevant = (snapshot.checkRuns ?? []).filter(
    (run) => run.name !== config.statusContext,
  );

  const failing = [];
  const pending = [];
  for (const run of relevant) {
    if (run.status !== "completed") {
      pending.push(run.name);
    } else if (FAILING_CONCLUSIONS.has(run.conclusion)) {
      failing.push(run.name);
    } else if (!PASSING_CONCLUSIONS.has(run.conclusion)) {
      // An unknown conclusion is not evidence of success.
      pending.push(run.name);
    }
  }

  if (failing.length) return { state: "failing", failing, pending };
  if (pending.length) return { state: "pending", failing, pending };
  if (!relevant.length) return { state: "unknown", failing, pending };
  return { state: "passing", failing, pending };
}

/**
 * An unresolved, non-outdated review thread blocks the gate. An outdated thread points at code
 * that no longer exists on the current head and is therefore not actionable.
 */
export function evaluateReviewThreads(threads) {
  const blocking = (threads ?? []).filter(
    (thread) => !thread.isResolved && !thread.isOutdated,
  );
  return { blockingCount: blocking.length };
}

/**
 * Extracts the head SHA a UI/UX notice was written for.
 *
 * Returns the newest match so a re-sent notice supersedes an older one, and null when no comment
 * carries a well-formed marker.
 */
export function parseUiNoticeHeadSha(comments) {
  let found = null;
  for (const comment of comments ?? []) {
    const match = comment?.body?.match(UI_NOTICE_PATTERN);
    if (match) found = match[1];
  }
  return found;
}

function evaluateMergeability(snapshot) {
  if (snapshot.mergeable === false) return "conflicted";
  if (snapshot.mergeable !== true) return "unknown";
  if (snapshot.mergeStateStatus === "BEHIND") return "behind";
  return "clean";
}

function matchingPaths(changedFiles, prefixes) {
  return (changedFiles ?? []).filter((path) =>
    (prefixes ?? []).some((prefix) => path.startsWith(prefix)),
  );
}

/**
 * Computes phase, blockers and derived facts from a snapshot.
 *
 * Pure: no I/O, no clock, no randomness. The caller decides what to do with the result.
 */
export function deriveReadiness(snapshot, config = loadConfig()) {
  const labels = snapshot.labels ?? [];
  const hasLabel = (key) => labels.includes(labelName(config, key));

  // Kill switch first: an operator disabled automation for this pull request.
  if (hasLabel("noAuto")) {
    return {
      participating: true,
      mutate: false,
      phase: "no-auto",
      ready: false,
      blockers: [
        "Automation is disabled for this pull request via the kill-switch label.",
      ],
    };
  }

  if (snapshot.state !== "open") {
    return {
      participating: false,
      mutate: false,
      phase: "closed",
      ready: false,
      blockers: [],
    };
  }

  const parsed = parseTaskContract(snapshot.body);
  if (!parsed.participating) {
    return {
      participating: false,
      mutate: false,
      phase: "not-participating",
      ready: false,
      blockers: [],
    };
  }

  const validation = validateTaskContract(
    parsed.contract,
    {
      repository: snapshot.repository,
      headRepository: snapshot.headRepository,
      authorLogin: snapshot.authorLogin,
      baseBranch: snapshot.baseBranch,
      headBranch: snapshot.headBranch,
      changedFiles: snapshot.changedFiles ?? [],
    },
    config,
  );

  const contractErrors = [...parsed.errors, ...validation.errors];
  if (contractErrors.length) {
    // A broken contract is a diagnosis, never a reason to guess and act. It stays self-healing:
    // fixing the pull-request body clears it without human label bookkeeping, and the contract
    // check already blocks the merge on its own.
    return {
      participating: true,
      mutate: true,
      phase: "contract-invalid",
      ready: false,
      blockers: contractErrors.map((error) => `Invalid task contract: ${error}`),
      contract: validation.normalized,
    };
  }

  const contract = validation.normalized;
  const blockers = [];

  // Sticky escalation: only a human clears this, so automation must not resume on its own.
  const escalated = hasLabel("needsHuman");
  if (escalated) {
    blockers.push(
      "A human decision is pending; the escalation label is still set.",
    );
  }
  const waiting = hasLabel("waiting");
  if (waiting) {
    blockers.push("A required provider or service is temporarily unavailable.");
  }
  if (snapshot.isDraft) {
    blockers.push("The pull request is still a draft.");
  }

  const mergeability = evaluateMergeability(snapshot);
  if (mergeability === "conflicted") {
    blockers.push("The pull request has a merge conflict with its base branch.");
  } else if (mergeability === "behind") {
    blockers.push("The branch is behind its base branch and must be updated.");
  } else if (mergeability === "unknown") {
    blockers.push(
      "GitHub has not reported a mergeable state for the current head yet.",
    );
  }

  const checks = evaluateChecks(snapshot, config);
  if (checks.state === "failing") {
    blockers.push(`Checks are failing: ${checks.failing.join(", ")}.`);
  } else if (checks.state === "pending") {
    blockers.push(`Checks are still running: ${checks.pending.join(", ")}.`);
  } else if (checks.state === "unknown") {
    blockers.push("No check results are available for the current head SHA.");
  }

  const reviewerProvider = reviewerProviderFor(contract.implementer, config);
  const reviews = evaluateReviews(
    snapshot.reviews,
    snapshot.headSha,
    config.providerAuthorAllowlist?.[reviewerProvider] ?? [],
  );
  if (reviews.verdict === "changes-required") {
    blockers.push("The cross-review requested changes for the current head SHA.");
  } else if (reviews.verdict !== "pass") {
    blockers.push(
      `No ${reviewerProvider ?? "cross"} review has approved the current head SHA yet.`,
    );
  }

  const threads = evaluateReviewThreads(snapshot.reviewThreads);
  if (threads.blockingCount > 0) {
    blockers.push(
      `${threads.blockingCount} review thread(s) are still unresolved.`,
    );
  }

  const protectedPaths = matchingPaths(
    snapshot.changedFiles,
    config.protectedPathPrefixes,
  );
  if (protectedPaths.length && !reviews.humanApproval) {
    blockers.push(
      `Workflow or infrastructure paths changed and need an explicit human approval of the current head: ${protectedPaths.join(", ")}.`,
    );
  }

  const uiChanged =
    matchingPaths(snapshot.changedFiles, config.uiPathPrefixes).length > 0 ||
    contract.uiChanged === true;
  if (uiChanged && snapshot.uiNoticeHeadSha !== snapshot.headSha) {
    blockers.push(
      snapshot.uiNoticeHeadSha
        ? "The UI/UX review notice does not cover the current head SHA."
        : "A visible UI/UX change still needs its review notice.",
    );
  }

  const mechanicallyGreen =
    !snapshot.isDraft &&
    !escalated &&
    !waiting &&
    mergeability === "clean" &&
    checks.state === "passing";

  let phase;
  if (escalated) {
    phase = "needs-human";
  } else if (mergeability === "conflicted") {
    phase = "conflict-fix";
  } else if (checks.state === "failing") {
    phase = "ci-fix";
  } else if (!blockers.length) {
    phase = "ready-for-merge";
  } else if (
    mechanicallyGreen &&
    reviews.verdict !== "changes-required" &&
    threads.blockingCount === 0
  ) {
    // Everything mechanical is green; the pull request is waiting on its review round.
    phase = "review";
  } else {
    phase = "implementing";
  }

  return {
    participating: true,
    mutate: true,
    phase,
    ready: blockers.length === 0,
    blockers,
    contract,
    reviewerProvider,
    details: {
      checks,
      reviews,
      threads,
      mergeability,
      protectedPaths,
      uiChanged,
    },
  };
}

/**
 * Turns a readiness result into a concrete label add/remove set.
 *
 * Idempotent by construction: a label already in the desired state produces no operation, so
 * re-running the reconciler on an unchanged pull request issues no writes at all.
 */
export function planLabels(currentLabels, readiness, config = loadConfig()) {
  if (!readiness.mutate) return { add: [], remove: [] };

  const current = new Set(currentLabels ?? []);
  const desired = new Set([labelName(config, "pipeline")]);

  const phaseLabelKey = PHASE_LABEL_KEYS[readiness.phase];
  if (phaseLabelKey) desired.add(labelName(config, phaseLabelKey));
  if (readiness.details?.uiChanged) desired.add(labelName(config, "uiChanged"));

  const managed = MANAGED_LABEL_KEYS.map((key) => labelName(config, key));
  const writable = [
    ...managed,
    ...ADD_ONLY_LABEL_KEYS.map((key) => labelName(config, key)),
  ];

  return {
    add: [...desired].filter(
      (label) => !current.has(label) && writable.includes(label),
    ),
    remove: managed.filter(
      (label) => current.has(label) && !desired.has(label),
    ),
  };
}

function formatList(items) {
  if (!items.length) return "_none_";
  return items.map((item) => `- ${item}`).join("\n");
}

/**
 * Renders the sticky status comment.
 *
 * Deterministic for a given snapshot, so the caller can skip the API write when nothing changed.
 * The comment reports state; round counters are never derived from comment history.
 */
export function renderStatusComment(readiness, snapshot) {
  const contract = readiness.contract ?? {};
  const details = readiness.details ?? {};
  return [
    STATUS_COMMENT_MARKER,
    "## Agent pipeline status",
    "",
    `- Phase: \`${readiness.phase}\``,
    `- Ready for human merge: \`${readiness.ready}\``,
    `- Head SHA: \`${snapshot.headSha ?? "unknown"}\``,
    `- Task: \`${contract.taskId ?? "unknown"}\``,
    `- Implementer: \`${contract.implementer ?? "unknown"}\``,
    `- Reviewer: \`${readiness.reviewerProvider ?? "unknown"}\``,
    `- Checks: \`${details.checks?.state ?? "unknown"}\``,
    `- Review verdict: \`${details.reviews?.verdict ?? "unknown"}\``,
    `- Unresolved review threads: \`${details.threads?.blockingCount ?? "unknown"}\``,
    `- Mergeability: \`${details.mergeability ?? "unknown"}\``,
    "",
    "### Blockers",
    "",
    formatList(readiness.blockers ?? []),
    "",
    "_Maintained by the agent pipeline reconciler. It reports state only; it does not approve or",
    "merge. The final merge is always a human decision._",
  ].join("\n");
}

/** Full plan for one pull request: labels plus the sticky status comment. */
export function reconcile(snapshot, config = loadConfig()) {
  const readiness = deriveReadiness(snapshot, config);
  if (!readiness.mutate) {
    return { readiness, labels: { add: [], remove: [] }, comment: null };
  }

  const body = renderStatusComment(readiness, snapshot);
  return {
    readiness,
    labels: planLabels(snapshot.labels, readiness, config),
    // An unchanged body needs no API call at all.
    comment: snapshot.statusCommentBody === body ? null : { body },
  };
}

// ---------------------------------------------------------------------------
// GitHub I/O
//
// Deliberately thin: it only reads the current state into a snapshot and applies a plan. All
// decisions live in the pure functions above, where they are covered by tests.
// ---------------------------------------------------------------------------

const API_ROOT = process.env.GITHUB_API_URL ?? "https://api.github.com";

async function api(path, { method = "GET", body, token } = {}) {
  const response = await fetch(`${API_ROOT}${path}`, {
    method,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    throw new Error(
      `GitHub API ${method} ${path} failed with ${response.status}: ${await response.text()}`,
    );
  }
  return response.status === 204 ? null : response.json();
}

async function graphql(query, variables, token) {
  const response = await fetch(`${API_ROOT.replace(/\/$/, "")}/graphql`, {
    method: "POST",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  const payload = await response.json();
  if (!response.ok || payload.errors) {
    throw new Error(`GitHub GraphQL failed: ${JSON.stringify(payload.errors ?? payload)}`);
  }
  return payload.data;
}

async function paginate(path, token) {
  const items = [];
  for (let page = 1; page <= 10; page += 1) {
    const separator = path.includes("?") ? "&" : "?";
    const batch = await api(`${path}${separator}per_page=100&page=${page}`, {
      token,
    });
    const list = Array.isArray(batch) ? batch : (batch?.check_runs ?? []);
    items.push(...list);
    if (list.length < 100) break;
  }
  return items;
}

const REVIEW_THREADS_QUERY = `
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        mergeStateStatus
        reviewThreads(first: 100) {
          nodes { isResolved isOutdated }
        }
      }
    }
  }
`;

/** Reads everything the pure logic needs, all bound to the current head SHA. */
export async function fetchSnapshot({ owner, repo, pullNumber, token }) {
  const pr = await api(`/repos/${owner}/${repo}/pulls/${pullNumber}`, { token });
  const headSha = pr.head.sha;

  const [files, checkRuns, reviews, comments, graph] = await Promise.all([
    paginate(`/repos/${owner}/${repo}/pulls/${pullNumber}/files`, token),
    paginate(`/repos/${owner}/${repo}/commits/${headSha}/check-runs`, token),
    paginate(`/repos/${owner}/${repo}/pulls/${pullNumber}/reviews`, token),
    paginate(`/repos/${owner}/${repo}/issues/${pullNumber}/comments`, token),
    graphql(
      REVIEW_THREADS_QUERY,
      { owner, repo, number: Number(pullNumber) },
      token,
    ).catch(() => null),
  ]);

  const statusComment = comments.find((comment) =>
    comment.body?.startsWith(STATUS_COMMENT_MARKER),
  );

  return {
    snapshot: {
      state: pr.state,
      isDraft: pr.draft === true,
      body: pr.body ?? "",
      repository: `${owner}/${repo}`,
      headRepository: pr.head.repo?.full_name ?? null,
      authorLogin: pr.user?.login ?? null,
      baseBranch: pr.base.ref,
      headBranch: pr.head.ref,
      headSha,
      mergeable: pr.mergeable,
      mergeStateStatus:
        graph?.repository?.pullRequest?.mergeStateStatus ??
        pr.mergeable_state?.toUpperCase() ??
        null,
      labels: (pr.labels ?? []).map((label) => label.name),
      changedFiles: files.map((file) => file.filename),
      checkRunsHeadSha: headSha,
      checkRuns: checkRuns.map((run) => ({
        name: run.name,
        status: run.status,
        conclusion: run.conclusion,
      })),
      reviews: reviews.map((review) => ({
        author: review.user?.login ?? null,
        state: review.state,
        commitSha: review.commit_id,
        submittedAt: review.submitted_at,
      })),
      // A missing GraphQL result must not look like "no unresolved threads".
      reviewThreads:
        graph?.repository?.pullRequest?.reviewThreads?.nodes ??
        [{ isResolved: false, isOutdated: false }],
      uiNoticeHeadSha: parseUiNoticeHeadSha(comments),
      statusCommentBody: statusComment?.body ?? null,
    },
    statusCommentId: statusComment?.id ?? null,
  };
}

async function applyPlan({ owner, repo, pullNumber, token, plan, statusCommentId }) {
  const applied = [];

  if (plan.labels.add.length) {
    await api(`/repos/${owner}/${repo}/issues/${pullNumber}/labels`, {
      method: "POST",
      body: { labels: plan.labels.add },
      token,
    });
    applied.push(`added labels: ${plan.labels.add.join(", ")}`);
  }
  for (const label of plan.labels.remove) {
    try {
      await api(
        `/repos/${owner}/${repo}/issues/${pullNumber}/labels/${encodeURIComponent(label)}`,
        { method: "DELETE", token },
      );
      applied.push(`removed label: ${label}`);
    } catch (error) {
      // Someone else removed it between the read and this write. The desired state already holds,
      // so this must not fail the run.
      if (!String(error.message).includes("failed with 404")) throw error;
      applied.push(`label already absent: ${label}`);
    }
  }

  if (plan.comment) {
    if (statusCommentId) {
      await api(`/repos/${owner}/${repo}/issues/comments/${statusCommentId}`, {
        method: "PATCH",
        body: { body: plan.comment.body },
        token,
      });
      applied.push("updated status comment");
    } else {
      await api(`/repos/${owner}/${repo}/issues/${pullNumber}/comments`, {
        method: "POST",
        body: { body: plan.comment.body },
        token,
      });
      applied.push("created status comment");
    }
  }

  return applied;
}

function option(args, name) {
  const index = args.indexOf(name);
  if (index === -1 || index + 1 >= args.length) return null;
  return args[index + 1];
}

async function reconcileCommand(args) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("reconcile requires GITHUB_TOKEN in the environment.");

  // Global kill switch, independent of any single pull request.
  if ((process.env.AGENT_PIPELINE_DISABLED ?? "").toLowerCase() === "true") {
    console.log("Agent pipeline is globally disabled; no pull request was touched.");
    return;
  }

  const repository = option(args, "--repository") ?? process.env.GITHUB_REPOSITORY;
  const pullNumber = option(args, "--pr");
  const apply = args.includes("--apply");
  if (!repository || !pullNumber) {
    throw new Error("reconcile requires --repository <owner/repo> and --pr <number>.");
  }
  const [owner, repo] = repository.split("/");

  const { snapshot, statusCommentId } = await fetchSnapshot({
    owner,
    repo,
    pullNumber,
    token,
  });
  const plan = reconcile(snapshot, loadConfig());

  console.log(
    JSON.stringify(
      {
        pullNumber: Number(pullNumber),
        headSha: snapshot.headSha,
        phase: plan.readiness.phase,
        ready: plan.readiness.ready,
        blockers: plan.readiness.blockers,
        labels: plan.labels,
        commentChanged: Boolean(plan.comment),
      },
      null,
      2,
    ),
  );

  if (!apply) {
    console.log("Dry run: no changes were written.");
    return;
  }

  const applied = await applyPlan({
    owner,
    repo,
    pullNumber,
    token,
    plan,
    statusCommentId,
  });
  console.log(applied.length ? applied.join("\n") : "Nothing to change.");
}

const isMainModule =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  const [command, ...args] = process.argv.slice(2);
  try {
    if (command === "reconcile") await reconcileCommand(args);
    else {
      throw new Error(
        "Usage: node scripts/agent-pipeline-reconcile.mjs reconcile --pr <number> [--repository <owner/repo>] [--apply]",
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
