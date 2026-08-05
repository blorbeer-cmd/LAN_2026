// Stateless readiness reconciler for the agent pipeline.
//
// Readiness is derived from the current GitHub state on every run instead of from an own event
// stream. Nothing here keeps history, so the same snapshot always produces the same plan and a
// duplicated, delayed or out-of-order event cannot corrupt the result. Every head-bound
// classification falls back to "unknown", and therefore to blocking, when it does not belong to
// the current head SHA.
//
// Besides reporting readiness on the pull request, this module owns the merge gate: the
// `Agent pipeline / ready for human merge` commit status for the current head SHA. It still starts
// no agent and never approves or merges anything — the status only states whether the conditions
// from section 11 of the plan hold, and the merge itself stays a human decision.

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

// Read as input, never written and never cleared: `needsHuman` (escalations raised by a human or
// by the later provider phases, for example an exhausted round limit, which cannot be derived from
// GitHub state), `waiting` and `reviewFallback` (owned by those phases), and `noAuto` (the manual
// kill switch). The one escalation this phase can derive — a protected path awaiting human
// approval — gets its own phase instead of borrowing this label, so that clearing it needs no
// label bookkeeping and a genuine escalation is never wiped by a sweep.

// Phases without an entry carry no phase label of their own. `waiting` and `needs-human` are
// already described by the label that produced them, and `awaiting-human-approval` has no label in
// the plan's set — inventing one here would go beyond this phase.
const PHASE_LABEL_KEYS = {
  implementing: "implementing",
  "ci-fix": "ciFix",
  "conflict-fix": "conflictFix",
  review: "review",
  "ready-for-merge": "readyForMerge",
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

// GitHub's author_association values that imply write access to this repository. Anything else —
// CONTRIBUTOR, FIRST_TIME_CONTRIBUTOR, NONE — is an outsider on a public repository.
const WRITE_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

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
  // `allowedReviewerLogins` must be the reviewer allowlist, never the author allowlist: the latter
  // contains the human maintainer, whose approval would otherwise silently count as the counter
  // provider's cross-review and collapse both gates into one click.
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
  const fromReviewer = decisive.filter(
    (review) =>
      (allowedReviewerLogins ?? []).includes(review.author) &&
      // A human is never the counter provider, even if their login were listed by mistake.
      isBotLogin(review.author),
  );

  let verdict = "none";
  if (fromReviewer.some((review) => review.state === "CHANGES_REQUESTED")) {
    verdict = "changes-required";
  } else if (fromReviewer.some((review) => review.state === "APPROVED")) {
    verdict = "pass";
  }

  // The repository is public, so anyone with a GitHub account can approve a pull request here.
  // Only an approval from someone who could write to the repository anyway may satisfy the
  // protected-path gate; a drive-by approval from an outsider must not.
  const humanApproval = decisive.some(
    (review) =>
      review.state === "APPROVED" &&
      !isBotLogin(review.author) &&
      WRITE_ASSOCIATIONS.has(review.authorAssociation),
  );

  return { verdict, humanApproval };
}

/**
 * True for check runs the pipeline produces itself.
 *
 * The reconcile workflow runs on `pull_request_target`, and those check runs attach to the pull
 * request's head SHA — the very list this function guards. Without the exclusion the reconciler
 * reads its own job as a gating check: `in_progress` while it runs, and `cancelled` after
 * `cancel-in-progress` aborts it, which would look like a CI failure that never existed.
 *
 * Matrix jobs are reported as `<job name> (<value>)`, so a configured name also matches its
 * parenthesised variants. `selfCheckNames` must stay in sync with the job names in
 * `.github/workflows/agent-pipeline-reconcile.yml`.
 */
export function isOwnCheckRun(name, config) {
  if (typeof name !== "string") return false;
  if (name === config.statusContext) return true;
  return (config.selfCheckNames ?? []).some(
    (own) => name === own || name.startsWith(`${own} (`),
  );
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

  const relevant = (snapshot.checkRuns ?? []).filter(
    (run) => !isOwnCheckRun(run.name, config),
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
 * True for a comment the pipeline may act on.
 *
 * The repository is public, so anyone can comment on a participating pull request. A marker in a
 * stranger's comment must not clear a gate or be adopted as the pipeline's own status comment.
 * Apps can only comment once an admin installed them, so a bot author counts as trusted.
 */
export function isTrustedCommentAuthor(comment) {
  return (
    isBotLogin(comment?.author) ||
    WRITE_ASSOCIATIONS.has(comment?.authorAssociation)
  );
}

/**
 * Extracts the head SHA a UI/UX notice was written for.
 *
 * Only trusted authors count: the notice satisfies a merge gate, so anyone able to post one could
 * otherwise declare a UI change reviewed that nobody ever looked at. Returns the newest match so a
 * re-sent notice supersedes an older one, and null when no trusted comment carries a well-formed
 * marker.
 */
export function parseUiNoticeHeadSha(comments) {
  let found = null;
  for (const comment of comments ?? []) {
    if (!isTrustedCommentAuthor(comment)) continue;
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

  // Fork pull requests never take part in the writing automation. The pull-request body is under
  // the fork author's control, so deciding this after parsing the contract would let an outsider
  // steer the pipeline bot into labelling and commenting on their own pull request.
  if (snapshot.headRepository !== snapshot.repository) {
    return {
      participating: false,
      mutate: false,
      phase: "fork",
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

  // Derived from the changed paths alone, so it survives a temporarily broken contract.
  const uiPathChanged =
    matchingPaths(snapshot.changedFiles, config.uiPathPrefixes).length > 0;

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
      // Keep reporting a UI change here; dropping it would strip a still-correct `ui:changed`.
      details: { uiChanged: uiPathChanged },
    };
  }

  const contract = validation.normalized;
  const blockers = [];

  // Escalations this phase cannot derive: raised by a human or by a later provider phase, and
  // cleared the same way. Automation must not resume on its own while one is set.
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
    config.providerReviewerAllowlist?.[reviewerProvider] ?? [],
  );
  if (reviews.verdict === "changes-required") {
    blockers.push("The cross-review requested changes for the current head SHA.");
  } else if (reviews.verdict !== "pass") {
    blockers.push(
      `No ${reviewerProvider ?? "cross"} review has approved the current head SHA yet.`,
    );
  }

  // An unreadable discussion blocks, but it must say so rather than invent an open thread the
  // maintainer would go looking for.
  const threadsReadable = snapshot.reviewThreadsReadable !== false;
  const threads = evaluateReviewThreads(snapshot.reviewThreads);
  if (!threadsReadable) {
    blockers.push(
      "Review threads could not be read completely for the current head SHA.",
    );
  } else if (threads.blockingCount > 0) {
    blockers.push(
      `${threads.blockingCount} review thread(s) are still unresolved.`,
    );
  }

  const protectedPaths = matchingPaths(
    snapshot.changedFiles,
    config.protectedPathPrefixes,
  );
  // Automation must not resolve this itself: a workflow or infrastructure change needs a human to
  // approve the exact current head. Escalation is derived from that condition rather than from a
  // label, so approving the head clears it again without any label bookkeeping.
  const needsHumanApproval =
    protectedPaths.length > 0 && !reviews.humanApproval;
  if (needsHumanApproval) {
    blockers.push(
      `Workflow or infrastructure paths changed and need an explicit human approval of the current head: ${protectedPaths.join(", ")}.`,
    );
  }

  const uiChanged = uiPathChanged || contract.uiChanged === true;
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
    threadsReadable &&
    mergeability === "clean" &&
    checks.state === "passing";

  let phase;
  if (escalated) {
    // Set from outside and cleared from outside; nothing here may override it.
    phase = "needs-human";
  } else if (waiting) {
    // `agent:waiting` already describes this. Adding a phase label on top would claim an agent is
    // working while the pull request waits for a provider that is not available.
    phase = "waiting";
  } else if (mergeability === "conflicted") {
    // Conflicts and CI failures rank above the human-approval wait: an agent can resolve them, and
    // the plan classifies both as work to do without asking. The approval blocker stays in the
    // list either way, so readiness remains closed.
    phase = "conflict-fix";
  } else if (checks.state === "failing") {
    phase = "ci-fix";
  } else if (needsHumanApproval) {
    // Nothing an agent does can clear this one, so it must outrank review and ready-for-merge.
    phase = "awaiting-human-approval";
  } else if (!blockers.length) {
    phase = "ready-for-merge";
  } else if (
    mechanicallyGreen &&
    // Only while a review round is genuinely outstanding. With a verdict already in, nobody is
    // reviewing and the label would contradict the verdict shown in the status comment.
    reviews.verdict === "none" &&
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

  return {
    add: [...desired].filter(
      (label) => !current.has(label) && managed.includes(label),
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

// GitHub rejects a longer status description, so the reason is trimmed rather than lost.
export const GATE_DESCRIPTION_LIMIT = 140;

function trimDescription(text) {
  if (text.length <= GATE_DESCRIPTION_LIMIT) return text;
  return `${text.slice(0, GATE_DESCRIPTION_LIMIT - 3)}...`;
}

/**
 * Decides the `Agent pipeline / ready for human merge` commit status for the current head SHA.
 *
 * Two states only: `success` once every gate condition holds, `pending` while any blocker is open.
 * A blocked pull request is not an error — the pipeline is still working on it — and the reason
 * travels in the description, where the merge box shows it without opening the status comment.
 *
 * Success for a pull request the pipeline does not manage is deliberate. Once this context is a
 * required check, a status that is never written leaves the pull request unmergeable forever, so
 * every non-participating pull request — a human one, a Dependabot bump, a fork — would
 * deadlock on a gate that was never meant to apply to it. The gate therefore states that it does
 * not apply instead of staying silent. It is not the control that keeps an agent PR honest: an
 * agent pull request without a task contract also gets no pipeline label and no status comment, so
 * its absence is visible, and the branch-protection review requirement still applies to everyone.
 *
 * Returns null when no status belongs on the commit at all.
 */
export function planGateStatus(readiness, config = loadConfig()) {
  // A closed or merged pull request is history; writing a verdict on it now would be noise.
  if (readiness.phase === "closed") return null;

  if (!readiness.participating) {
    const reason =
      readiness.phase === "fork"
        ? "Fork pull request: the agent-pipeline gate does not apply."
        : "No agent task contract: the agent-pipeline gate does not apply.";
    return { context: config.statusContext, state: "success", description: reason };
  }

  if (readiness.ready) {
    return {
      context: config.statusContext,
      state: "success",
      description: "Every gate condition holds for this head. The merge stays yours.",
    };
  }

  const blockers = readiness.blockers ?? [];
  const remaining = blockers.length > 1 ? ` (+${blockers.length - 1} more)` : "";
  const first = blockers[0] ?? "Readiness could not be determined for this head.";
  return {
    context: config.statusContext,
    state: "pending",
    description: trimDescription(`${readiness.phase}: ${first}${remaining}`),
  };
}

/**
 * Full plan for one pull request: labels, the sticky status comment and the merge-gate status.
 *
 * The gate is planned even when no mutation is allowed. `agent:no-auto` stops the pipeline from
 * acting on a pull request, and section 11 of the plan counts that kill switch as a gate condition
 * of its own; leaving the status behind at a stale `success` would turn a paused pull request into
 * a mergeable one. The same holds for pull requests the pipeline does not manage, which need the
 * "does not apply" verdict precisely because nothing else will ever write it.
 */
export function reconcile(snapshot, config = loadConfig()) {
  const readiness = deriveReadiness(snapshot, config);
  const gate = planGateStatus(readiness, config);
  // An unchanged verdict needs no API call. Statuses are append-only, so rewriting one on every
  // sweep would bury the commit's status history under identical entries.
  const current = snapshot.gateStatus;
  const status =
    gate &&
    (current?.state !== gate.state || current?.description !== gate.description)
      ? gate
      : null;

  if (!readiness.mutate) {
    return { readiness, labels: { add: [], remove: [] }, comment: null, status };
  }

  const body = renderStatusComment(readiness, snapshot);
  return {
    readiness,
    labels: planLabels(snapshot.labels, readiness, config),
    // An unchanged body needs no API call at all.
    comment: snapshot.statusCommentBody === body ? null : { body },
    status,
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

const PAGE_LIMIT = 10;

/**
 * Reads every page of a REST collection.
 *
 * Throws rather than truncating when the cap is reached: a short `changedFiles` would make the
 * protected-path and UI detection miss a path, and a short comment list would hide the sticky
 * status comment and duplicate it on every run. Failing the run leaves the previous state intact,
 * which is the safe direction.
 */
export async function paginate(path, token) {
  const items = [];
  for (let page = 1; page <= PAGE_LIMIT; page += 1) {
    const separator = path.includes("?") ? "&" : "?";
    const batch = await api(`${path}${separator}per_page=100&page=${page}`, {
      token,
    });
    const list = Array.isArray(batch) ? batch : (batch?.check_runs ?? []);
    items.push(...list);
    if (list.length < 100) return items;
  }
  throw new Error(
    `GitHub API ${path} returned more than ${PAGE_LIMIT * 100} entries; refusing to judge readiness on a truncated read.`,
  );
}

const REVIEW_THREADS_QUERY = `
  query($owner: String!, $repo: String!, $number: Int!, $after: String) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        mergeStateStatus
        reviewThreads(first: 100, after: $after) {
          nodes { isResolved isOutdated }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  }
`;

/**
 * Reads mergeStateStatus and every review thread, following the GraphQL cursor.
 *
 * Reports `readable: false` when the query fails or the page cap is reached, so the caller blocks
 * on an incompletely read discussion and can say so instead of reporting a thread that does not
 * exist. Failures are logged: a systematically failing query would otherwise hold every pull
 * request without leaving a trace in the job log.
 */
async function fetchReviewThreads({ owner, repo, pullNumber, token }) {
  const nodes = [];
  let after = null;
  let mergeStateStatus = null;

  for (let page = 1; page <= 10; page += 1) {
    let data;
    try {
      data = await graphql(
        REVIEW_THREADS_QUERY,
        { owner, repo, number: Number(pullNumber), after },
        token,
      );
    } catch (error) {
      console.error(
        `Could not read review threads for #${pullNumber}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { mergeStateStatus, reviewThreads: nodes, readable: false };
    }

    const pullRequest = data?.repository?.pullRequest;
    if (!pullRequest) {
      console.error(
        `Review-thread query for #${pullNumber} returned no pull request.`,
      );
      return { mergeStateStatus, reviewThreads: nodes, readable: false };
    }
    mergeStateStatus = pullRequest.mergeStateStatus ?? mergeStateStatus;
    nodes.push(...(pullRequest.reviewThreads?.nodes ?? []));

    const pageInfo = pullRequest.reviewThreads?.pageInfo;
    if (!pageInfo?.hasNextPage) {
      return { mergeStateStatus, reviewThreads: nodes, readable: true };
    }
    after = pageInfo.endCursor;
  }

  // More threads exist than the cap allows. Block instead of judging on a partial read.
  console.error(
    `Review threads for #${pullNumber} exceed the page cap; readiness stays blocked.`,
  );
  return { mergeStateStatus, reviewThreads: nodes, readable: false };
}

/**
 * Keeps only the most recent check run per name across every check suite for the head SHA.
 *
 * The Check Runs API's `filter=latest` dedupes only within a single check suite. Each
 * `pull_request_target` retrigger (an edited body, `ready_for_review`, ...) creates a new check
 * suite for the same head SHA, so a head that accumulated several suites still gets one "latest"
 * entry per suite back from the API — a stale failing attempt from an earlier suite then keeps
 * sitting alongside the newer, passing one under the same check name, and `evaluateChecks` treats
 * any failing entry as gating. Check-run ids are assigned in strictly increasing order regardless
 * of which suite they belong to, so the highest id per name is reliably the actually-latest attempt.
 */
export function dedupeCheckRunsByName(checkRuns) {
  const latestByName = new Map();
  for (const run of checkRuns ?? []) {
    const existing = latestByName.get(run.name);
    if (!existing || run.id > existing.id) latestByName.set(run.name, run);
  }
  return [...latestByName.values()];
}

/** Reads everything the pure logic needs, all bound to the current head SHA. */
export async function fetchSnapshot({ owner, repo, pullNumber, token }) {
  const pr = await api(`/repos/${owner}/${repo}/pulls/${pullNumber}`, { token });
  const headSha = pr.head.sha;

  const [files, checkRuns, reviews, comments, graph, combinedStatus] = await Promise.all([
    paginate(`/repos/${owner}/${repo}/pulls/${pullNumber}/files`, token),
    // `filter=latest` keeps only the most recent attempt per check, so a rerun of a failed job on
    // an unchanged head supersedes its earlier failure. Set explicitly rather than relying on the
    // API default staying that way.
    paginate(
      `/repos/${owner}/${repo}/commits/${headSha}/check-runs?filter=latest`,
      token,
    ),
    paginate(`/repos/${owner}/${repo}/pulls/${pullNumber}/reviews`, token),
    paginate(`/repos/${owner}/${repo}/issues/${pullNumber}/comments`, token),
    fetchReviewThreads({ owner, repo, pullNumber, token }),
    // The combined status reports only the latest entry per context, which is exactly the verdict
    // the gate would overwrite.
    api(`/repos/${owner}/${repo}/commits/${headSha}/status?per_page=100`, {
      token,
    }),
  ]);

  const trustedComments = comments.map((comment) => ({
    id: comment.id,
    body: comment.body,
    author: comment.user?.login ?? null,
    authorAssociation: comment.author_association,
  }));

  // A decoy comment carrying the marker must not become the comment the pipeline overwrites; when
  // one exists, the reconciler simply posts its own alongside it.
  const statusComment = trustedComments.find(
    (comment) =>
      comment.body?.startsWith(STATUS_COMMENT_MARKER) &&
      isTrustedCommentAuthor(comment),
  );

  const config = loadConfig();
  const gateStatus = (combinedStatus?.statuses ?? []).find(
    (status) => status.context === config.statusContext,
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
        graph?.mergeStateStatus ?? pr.mergeable_state?.toUpperCase() ?? null,
      labels: (pr.labels ?? []).map((label) => label.name),
      changedFiles: files.map((file) => file.filename),
      checkRunsHeadSha: headSha,
      checkRuns: dedupeCheckRunsByName(checkRuns).map((run) => ({
        name: run.name,
        status: run.status,
        conclusion: run.conclusion,
      })),
      reviews: reviews.map((review) => ({
        author: review.user?.login ?? null,
        authorAssociation: review.author_association,
        state: review.state,
        commitSha: review.commit_id,
        submittedAt: review.submitted_at,
      })),
      reviewThreads: graph?.reviewThreads ?? [],
      // A discussion that could not be read completely must block, and must say why.
      reviewThreadsReadable: graph?.readable === true,
      uiNoticeHeadSha: parseUiNoticeHeadSha(trustedComments),
      statusCommentBody: statusComment?.body ?? null,
      gateStatus: gateStatus
        ? { state: gateStatus.state, description: gateStatus.description ?? null }
        : null,
    },
    statusCommentId: statusComment?.id ?? null,
  };
}

async function applyPlan({
  owner,
  repo,
  pullNumber,
  token,
  plan,
  statusCommentId,
  headSha,
  targetUrl,
}) {
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

  // Last on purpose. A failure above aborts the run before the gate moves, so the verdict on the
  // commit can go stale only in the blocking direction, never towards an unearned `success`.
  if (plan.status) {
    try {
      await api(`/repos/${owner}/${repo}/statuses/${headSha}`, {
        method: "POST",
        body: {
          state: plan.status.state,
          context: plan.status.context,
          description: plan.status.description,
          ...(targetUrl ? { target_url: targetUrl } : {}),
        },
        token,
      });
      applied.push(`set ${plan.status.context} to ${plan.status.state}`);
    } catch (error) {
      // A head commit this repository cannot address — a fork branch deleted mid-run, for example
      // — carries no status. Report it and keep the labels and the status comment, which are the
      // part a maintainer actually reads.
      if (!String(error.message).includes("failed with 422")) throw error;
      console.error(
        `Could not write the merge-gate status: ${headSha} is not addressable in ${owner}/${repo}.`,
      );
      applied.push(`merge-gate status skipped for ${headSha}`);
    }
  }

  return applied;
}

function option(args, name) {
  const index = args.indexOf(name);
  if (index === -1 || index + 1 >= args.length) return null;
  return args[index + 1];
}

/**
 * Link target for the merge-gate status: the run that wrote it.
 *
 * The description holds only the first blocker, so the status needs somewhere to point for the
 * full picture. Returns null outside Actions, where no run exists to link to.
 */
function currentRunUrl() {
  const server = process.env.GITHUB_SERVER_URL;
  const repository = process.env.GITHUB_REPOSITORY;
  const runId = process.env.GITHUB_RUN_ID;
  if (!server || !repository || !runId) return null;
  return `${server}/${repository}/actions/runs/${runId}`;
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
        gateStatus: plan.status
          ? { state: plan.status.state, description: plan.status.description }
          : "no write needed",
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
    headSha: snapshot.headSha,
    targetUrl: option(args, "--target-url") ?? currentRunUrl(),
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
        "Usage: node scripts/agent-pipeline-reconcile.mjs reconcile --pr <number> [--repository <owner/repo>] [--target-url <url>] [--apply]",
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
