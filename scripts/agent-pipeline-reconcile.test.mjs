import assert from "node:assert/strict";
import { test } from "node:test";

import { loadConfig } from "./agent-pipeline.mjs";
import {
  CLAUDE_CROSS_REVIEW_HEADING,
  dedupeCheckRunsByName,
  DEFAULT_WAITING_ESCALATION_HOURS,
  deriveReadiness,
  evaluateChecks,
  evaluateReviewDecision,
  evaluateReviews,
  fetchReviewThreads,
  GATE_DESCRIPTION_LIMIT,
  hasEarlierPassingReview,
  isOwnCheckRun,
  isTrustedCommentAuthor,
  meetsReadOnlyMinimum,
  paginate,
  parseReviewDecision,
  parseReviewResults,
  parseUiNoticeHeadSha,
  planGateStatus,
  planLabels,
  recommendReviewMode,
  reconcile,
  renderStatusComment,
  reviewerProviderFor,
  reviewWaitingHours,
  STATUS_COMMENT_MARKER,
  statusCommentBody,
  UI_NOTICE_MARKER,
  waitingEscalationHours,
} from "./agent-pipeline-reconcile.mjs";

const config = loadConfig();
const HEAD = "a".repeat(40);
const OLD_HEAD = "b".repeat(40);
const BASE = "c".repeat(40);

const CODEX_REVIEWER = "chatgpt-codex-connector[bot]";

function contractBody(overrides = {}) {
  const values = {
    "task-id": "agent-20260804-reconciler",
    implementer: "claude",
    "base-branch": "main",
    "base-sha": BASE,
    "head-branch": "claude/agent-pipeline-reconciler",
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

const CROSS_LABEL = config.reviewModeLabels.cross;
const SELF_LABEL = config.reviewModeLabels.self;
const HUMAN_LABEL = config.reviewModeLabels.human;

/** Binds a review-mode label to a head, the way the reconciler's own status comment does. */
function decisionRecord(headSha, mode) {
  return `${STATUS_COMMENT_MARKER}\n<!-- agent-pipeline:review-decision ${headSha} mode=${mode} -->`;
}

/** A published `self` review result, the only evidence GitHub cannot represent natively. */
function selfResultComment(headSha, overrides = {}) {
  const values = {
    verdict: "pass",
    session: "claude-review-7f3",
    "read-only": "true",
    ...overrides,
  };
  return {
    author: "blorbeer-cmd",
    authorAssociation: "OWNER",
    body: `Review done.\n\n<!-- agent-pipeline:review-result ${headSha} mode=self verdict=${values.verdict} session=${values.session} read-only=${values["read-only"]} -->`,
  };
}

/** A structured Claude result published by the trusted Actions adapter. */
function claudeCrossResultComment(headSha, overrides = {}) {
  const values = {
    verdict: "pass",
    session: "claude-action-123-1",
    "read-only": "true",
    ...overrides,
  };
  return {
    author: "github-actions[bot]",
    authorAssociation: "NONE",
    body: `${CLAUDE_CROSS_REVIEW_HEADING}\n\n<!-- agent-pipeline:review-result ${headSha} mode=cross verdict=${values.verdict} session=${values.session} read-only=${values["read-only"]} -->`,
  };
}

/** A snapshot that satisfies every gate, so each test can break exactly one thing. */
function readySnapshot(overrides = {}) {
  return {
    state: "open",
    isDraft: false,
    body: contractBody(),
    repository: "blorbeer-cmd/LAN_2026",
    headRepository: "blorbeer-cmd/LAN_2026",
    authorLogin: "blorbeer-cmd",
    baseBranch: "main",
    headBranch: "claude/agent-pipeline-reconciler",
    headSha: HEAD,
    mergeable: true,
    mergeStateStatus: "CLEAN",
    // The user picked who reviews this head; without it the pipeline waits for that decision.
    labels: [CROSS_LABEL],
    // The reconciler has already seen this head, so the label above belongs to it. Without that
    // record a label could just as well predate the head, and the answer would not bind.
    statusCommentBody: decisionRecord(HEAD, "cross"),
    statusCommentAuthor: config.statusCommentAuthors[0],
    changedFiles: ["scripts/agent-pipeline-reconcile.mjs"],
    checkRunsHeadSha: HEAD,
    checkRuns: [
      { name: "Agent pipeline / contract", status: "completed", conclusion: "success" },
    ],
    reviews: [
      {
        author: CODEX_REVIEWER,
        state: "APPROVED",
        commitSha: HEAD,
        submittedAt: "2026-08-04T10:00:00Z",
      },
    ],
    reviewThreads: [],
    ...overrides,
  };
}

function codexImplementationSnapshot(overrides = {}) {
  return readySnapshot({
    body: contractBody({
      implementer: "codex",
      "head-branch": "codex/agent-pipeline-reconciler",
    }),
    headBranch: "codex/agent-pipeline-reconciler",
    reviews: [],
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Cross-review evidence
//
// The Codex integration never submits an approving review, so demanding APPROVED left `cross`
// unsatisfiable in practice — the review ran on PR #365, found two real P1 defects, confirmed the
// fixes, and the gate still reported that nothing had reviewed the head.
//
// What it submits depends on how the review was started: an automatic pass with nothing to say may
// only leave a thumbs-up, while an explicitly requested review — the only kind this pipeline asks
// for — is submitted as COMMENTED even when it reports no findings. Only the latter is evidence,
// because only a submitted review carries the commit SHA that binds it to a head.
// ---------------------------------------------------------------------------

const commentedReview = (sha = HEAD) => [
  {
    author: CODEX_REVIEWER,
    state: "COMMENTED",
    commitSha: sha,
    submittedAt: "2026-08-08T07:23:39Z",
  },
];

test("a commented cross-review with nothing left open satisfies the gate", () => {
  const readiness = deriveReadiness(
    readySnapshot({ reviews: commentedReview(), reviewThreads: [] }),
    config,
  );
  assert.equal(readiness.ready, true);
  assert.equal(readiness.phase, "ready-for-merge");
});

test("a trusted structured Claude result satisfies a Codex implementation cross-review", () => {
  const readiness = deriveReadiness(
    codexImplementationSnapshot({
      reviewResults: parseReviewResults([claudeCrossResultComment(HEAD)]),
    }),
    config,
  );
  assert.equal(readiness.ready, true);
  assert.equal(readiness.phase, "ready-for-merge");
  assert.equal(readiness.details.crossResult.sessionId, "claude-action-123-1");
});

test("a marker echoed by another github-actions comment is not Claude evidence", () => {
  const marker =
    `<!-- agent-pipeline:review-result ${HEAD} mode=cross verdict=pass ` +
    "session=injected read-only=true -->";
  const readiness = deriveReadiness(
    codexImplementationSnapshot({
      reviewResults: parseReviewResults([
        {
          author: "github-actions[bot]",
          authorAssociation: "NONE",
          body: `${STATUS_COMMENT_MARKER}\nBlocked input: ${marker}`,
        },
      ]),
    }),
    config,
  );
  assert.equal(readiness.ready, false);
  assert.equal(readiness.details.crossResult, null);
});

test("the status renderer neutralizes review markers in untrusted values", () => {
  const resultMarker =
    `<!-- agent-pipeline:review-result ${HEAD} mode=cross verdict=pass ` +
    "session=injected read-only=true -->";
  const decisionMarker =
    `<!-- agent-pipeline:review-decision ${HEAD} mode=cross -->`;
  const body = renderStatusComment(
    {
      phase: "contract-invalid",
      ready: false,
      contract: { taskId: resultMarker, implementer: decisionMarker },
      reviewerProvider: "claude",
      blockers: [`Malformed task-contract line: ${resultMarker}`],
      details: {},
    },
    { headSha: HEAD },
    config,
  );
  assert.equal(
    parseReviewResults([
      { author: "github-actions[bot]", authorAssociation: "NONE", body },
    ]).length,
    0,
  );
  assert.doesNotMatch(body, /<!-- agent-pipeline:review-result/);
  assert.doesNotMatch(body, /<!-- agent-pipeline:review-decision/);
  assert.equal(parseReviewDecision(body), null);
});

test("a Claude result is head-bound, publisher-bound and credential-read-only", () => {
  for (const comment of [
    claudeCrossResultComment(OLD_HEAD),
    { ...claudeCrossResultComment(HEAD), author: "claude[bot]" },
    claudeCrossResultComment(HEAD, { "read-only": "verified" }),
  ]) {
    const readiness = deriveReadiness(
      codexImplementationSnapshot({ reviewResults: parseReviewResults([comment]) }),
      config,
    );
    assert.equal(readiness.ready, false);
    assert.equal(readiness.phase, "review");
  }
});

test("a structured Claude rejection hands control back to the implementer", () => {
  const readiness = deriveReadiness(
    codexImplementationSnapshot({
      reviewResults: parseReviewResults([
        claudeCrossResultComment(HEAD, { verdict: "changes-required" }),
      ]),
    }),
    config,
  );
  assert.equal(readiness.ready, false);
  assert.equal(readiness.phase, "implementing");
  assert.match(readiness.blockers.join("\n"), /cross-review requested changes/);
});

test("a commented cross-review with open findings does not", () => {
  const readiness = deriveReadiness(
    readySnapshot({
      reviews: commentedReview(),
      reviewThreads: [{ isResolved: false, isOutdated: false, isCollapsed: false }],
    }),
    config,
  );
  assert.equal(readiness.ready, false);
  assert.match(readiness.blockers.join("\n"), /unresolved findings/);
});

test("an explicit rejection still blocks, whatever the evidence mode", () => {
  for (const evidence of ["approval", "reviewed-and-resolved"]) {
    const readiness = deriveReadiness(
      readySnapshot({
        reviews: [
          {
            author: CODEX_REVIEWER,
            state: "CHANGES_REQUESTED",
            commitSha: HEAD,
            submittedAt: "2026-08-08T07:23:39Z",
          },
        ],
      }),
      { ...config, crossReviewEvidence: evidence },
    );
    assert.equal(readiness.ready, false);
    assert.match(readiness.blockers[0], /requested changes/);
  }
});

test("the missing-review blocker names the remedy and rules out reactions", () => {
  // From the cross-review of 8db0d7f: Codex answers a clean automatic pass with a thumbs-up, and
  // reactions are never fetched. They also could not be — a reaction carries no commit SHA, so it
  // can never be head-bound. The gate therefore needs a review requested for this head, and the
  // blocker has to say so instead of leaving the operator guessing why a "reviewed" PR is stuck.
  const readiness = deriveReadiness(readySnapshot({ reviews: [] }), config);
  assert.equal(readiness.ready, false);
  const blocker = readiness.blockers.join("\n");
  assert.match(blocker, /request one for this head/);
  assert.match(blocker, /a reaction is not evidence/);
});

test("a comment for an earlier head is no evidence for this one", () => {
  const readiness = deriveReadiness(
    readySnapshot({ reviews: commentedReview("f".repeat(40)) }),
    config,
  );
  assert.equal(readiness.ready, false);
  assert.match(readiness.blockers.join("\n"), /covers the current head SHA/);
});

test("a withdrawn review is not a review", () => {
  const readiness = deriveReadiness(
    readySnapshot({
      reviews: [
        {
          author: CODEX_REVIEWER,
          state: "DISMISSED",
          commitSha: HEAD,
          submittedAt: "2026-08-08T07:23:39Z",
        },
      ],
    }),
    config,
  );
  assert.equal(readiness.ready, false);
  assert.match(readiness.blockers.join("\n"), /covers the current head SHA/);
});

test("a comment from anyone but the counter provider is no evidence", () => {
  // The author allowlist contains the human maintainer; only the reviewer allowlist may count here,
  // otherwise a maintainer comment would silently stand in for the counter provider.
  const readiness = deriveReadiness(
    readySnapshot({
      reviews: [
        {
          author: "blorbeer-cmd",
          state: "COMMENTED",
          commitSha: HEAD,
          submittedAt: "2026-08-08T07:23:39Z",
          authorAssociation: "OWNER",
        },
      ],
    }),
    config,
  );
  assert.equal(readiness.ready, false);
  assert.match(readiness.blockers.join("\n"), /covers the current head SHA/);
});

test("the strict evidence mode still demands an approval", () => {
  const strict = { ...config, crossReviewEvidence: "approval" };
  const commented = deriveReadiness(readySnapshot({ reviews: commentedReview() }), strict);
  assert.equal(commented.ready, false);
  assert.match(commented.blockers.join("\n"), /approved the current head SHA/);

  // The default snapshot carries an approving review, which passes under both modes.
  assert.equal(deriveReadiness(readySnapshot(), strict).ready, true);
});

test("an invalid evidence mode fails loudly instead of accepting everything", () => {
  assert.throws(
    () => deriveReadiness(readySnapshot(), { ...config, crossReviewEvidence: "resolved" }),
    /crossReviewEvidence must be one of/,
  );
});

test("a fully green snapshot reaches ready-for-merge", () => {
  const readiness = deriveReadiness(readySnapshot(), config);
  assert.equal(readiness.ready, true);
  assert.equal(readiness.phase, "ready-for-merge");
  assert.deepEqual(readiness.blockers, []);
});

test("the reviewer is always the other provider", () => {
  assert.equal(reviewerProviderFor("claude", config), "codex");
  assert.equal(reviewerProviderFor("codex", config), "claude");
});

test("a new commit during review invalidates the previous approval", () => {
  // The approval was submitted for the previous head and must not carry over.
  const readiness = deriveReadiness(
    readySnapshot({
      reviews: [
        {
          author: CODEX_REVIEWER,
          state: "APPROVED",
          commitSha: OLD_HEAD,
          submittedAt: "2026-08-04T10:00:00Z",
        },
      ],
    }),
    config,
  );
  assert.equal(readiness.ready, false);
  assert.equal(readiness.phase, "review");
  assert.match(readiness.blockers.join("\n"), /No codex review covers the current head SHA/);
});

test("check runs reported for another SHA count as unknown, not as a pass", () => {
  const checks = evaluateChecks(
    { headSha: HEAD, checkRunsHeadSha: OLD_HEAD, checkRuns: [] },
    config,
  );
  assert.equal(checks.state, "unknown");

  const readiness = deriveReadiness(
    readySnapshot({ checkRunsHeadSha: OLD_HEAD }),
    config,
  );
  assert.equal(readiness.ready, false);
  assert.match(readiness.blockers.join("\n"), /No check results/);
});

test("a stale approval cannot be resurrected by an out-of-order arrival", () => {
  // Both reviews exist at once; only the one bound to the current head may count.
  const reviews = [
    {
      author: CODEX_REVIEWER,
      state: "APPROVED",
      commitSha: OLD_HEAD,
      submittedAt: "2026-08-04T12:00:00Z",
    },
    {
      author: CODEX_REVIEWER,
      state: "CHANGES_REQUESTED",
      commitSha: HEAD,
      submittedAt: "2026-08-04T10:00:00Z",
    },
  ];
  const result = evaluateReviews(reviews, HEAD, [CODEX_REVIEWER]);
  assert.equal(result.verdict, "changes-required");
});

test("only the latest decisive review per author counts", () => {
  const reviews = [
    {
      author: CODEX_REVIEWER,
      state: "CHANGES_REQUESTED",
      commitSha: HEAD,
      submittedAt: "2026-08-04T10:00:00Z",
    },
    {
      author: CODEX_REVIEWER,
      state: "APPROVED",
      commitSha: HEAD,
      submittedAt: "2026-08-04T11:00:00Z",
    },
    {
      author: CODEX_REVIEWER,
      state: "COMMENTED",
      commitSha: HEAD,
      submittedAt: "2026-08-04T12:00:00Z",
    },
  ];
  // A later plain comment must not undo the approval, and the approval supersedes the request.
  assert.equal(evaluateReviews(reviews, HEAD, [CODEX_REVIEWER]).verdict, "pass");
});

test("an approval from an unexpected reviewer does not open the gate", () => {
  const result = evaluateReviews(
    [
      {
        author: "random-user",
        state: "APPROVED",
        commitSha: HEAD,
        submittedAt: "2026-08-04T10:00:00Z",
      },
    ],
    HEAD,
    [CODEX_REVIEWER],
  );
  assert.equal(result.verdict, "none");
});

test("unresolved review threads block, outdated ones do not", () => {
  const blocked = deriveReadiness(
    readySnapshot({
      reviewThreads: [{ isResolved: false, isOutdated: false }],
    }),
    config,
  );
  assert.equal(blocked.ready, false);
  assert.equal(blocked.phase, "implementing");
  assert.match(blocked.blockers.join("\n"), /1 review thread\(s\)/);

  const outdated = deriveReadiness(
    readySnapshot({
      reviewThreads: [
        { isResolved: false, isOutdated: true },
        { isResolved: true, isOutdated: false },
      ],
    }),
    config,
  );
  assert.equal(outdated.ready, true);
});

test("a merge conflict selects the conflict-fix phase", () => {
  const readiness = deriveReadiness(
    readySnapshot({ mergeable: false }),
    config,
  );
  assert.equal(readiness.phase, "conflict-fix");
  assert.match(readiness.blockers.join("\n"), /merge conflict/);
});

test("an unknown mergeable state blocks without claiming a conflict", () => {
  const readiness = deriveReadiness(readySnapshot({ mergeable: null }), config);
  assert.equal(readiness.ready, false);
  assert.notEqual(readiness.phase, "conflict-fix");
  assert.match(readiness.blockers.join("\n"), /not reported a mergeable state/);
});

test("a branch behind its base blocks readiness", () => {
  const readiness = deriveReadiness(
    readySnapshot({ mergeStateStatus: "BEHIND" }),
    config,
  );
  assert.equal(readiness.ready, false);
  assert.match(readiness.blockers.join("\n"), /behind its base branch/);
});

test("a failing check selects the ci-fix phase", () => {
  const readiness = deriveReadiness(
    readySnapshot({
      checkRuns: [
        { name: "server tests", status: "completed", conclusion: "failure" },
      ],
    }),
    config,
  );
  assert.equal(readiness.phase, "ci-fix");
  assert.match(readiness.blockers.join("\n"), /Checks are failing: server tests/);
});

test("dedupeCheckRunsByName keeps only the highest id per name across check suites", () => {
  // Each pull_request_target retrigger (an edited body, ready_for_review, ...) opens a new check
  // suite; the Check Runs API's filter=latest dedupes only within one suite, so a head SHA that
  // accumulated several suites still returns one "latest" entry per suite. A stale failing attempt
  // from an earlier suite must not keep gating readiness once a later suite passed.
  const deduped = dedupeCheckRunsByName([
    { id: 10, name: "Agent pipeline / contract", status: "completed", conclusion: "failure" },
    { id: 30, name: "Agent pipeline / contract", status: "completed", conclusion: "success" },
    { id: 20, name: "server tests", status: "completed", conclusion: "success" },
  ]);
  assert.deepEqual(
    deduped.map((run) => ({ id: run.id, name: run.name, conclusion: run.conclusion })),
    [
      { id: 30, name: "Agent pipeline / contract", conclusion: "success" },
      { id: 20, name: "server tests", conclusion: "success" },
    ],
  );
});

test("a running check blocks but does not start a fix", () => {
  const readiness = deriveReadiness(
    readySnapshot({
      checkRuns: [
        { name: "server tests", status: "in_progress", conclusion: null },
      ],
    }),
    config,
  );
  assert.equal(readiness.ready, false);
  assert.equal(readiness.phase, "implementing");
  assert.match(readiness.blockers.join("\n"), /still running/);
});

test("the reconciler's own check runs never gate readiness", () => {
  // The reconcile workflow runs on pull_request_target, so its jobs attach to the PR head SHA and
  // would otherwise be read back as CI. cancel-in-progress additionally leaves cancelled runs,
  // which would look like a failure that never happened.
  const checks = evaluateChecks(
    {
      headSha: HEAD,
      checkRunsHeadSha: HEAD,
      checkRuns: [
        { name: "Collect pull requests", status: "completed", conclusion: "cancelled" },
        { name: "Reconcile pull request (351)", status: "in_progress", conclusion: null },
        { name: "Reconcile Claude review result", status: "completed", conclusion: "cancelled" },
        { name: "server tests", status: "completed", conclusion: "success" },
      ],
    },
    config,
  );
  assert.equal(checks.state, "passing");
  assert.deepEqual(checks.failing, []);
  assert.deepEqual(checks.pending, []);
});

test("own check runs are recognised including matrix suffixes", () => {
  assert.equal(isOwnCheckRun("Collect pull requests", config), true);
  assert.equal(isOwnCheckRun("Reconcile pull request (7)", config), true);
  assert.equal(isOwnCheckRun("Reconcile Claude review result", config), true);
  assert.equal(isOwnCheckRun(config.statusContext, config), true);
  // A foreign check that merely starts similarly must still count.
  assert.equal(isOwnCheckRun("Reconcile pull requests upstream", config), false);
  assert.equal(isOwnCheckRun("server tests", config), false);
});

test("a fully green snapshot stays ready while the reconciler runs on it", () => {
  const readiness = deriveReadiness(
    readySnapshot({
      checkRuns: [
        { name: "Agent pipeline / contract", status: "completed", conclusion: "success" },
        { name: "Reconcile pull request (351)", status: "in_progress", conclusion: null },
      ],
    }),
    config,
  );
  assert.equal(readiness.ready, true);
  assert.equal(readiness.phase, "ready-for-merge");
});

test("the readiness status itself never gates readiness", () => {
  const checks = evaluateChecks(
    {
      headSha: HEAD,
      checkRunsHeadSha: HEAD,
      checkRuns: [
        { name: config.statusContext, status: "completed", conclusion: "failure" },
        { name: "server tests", status: "completed", conclusion: "success" },
      ],
    },
    config,
  );
  assert.equal(checks.state, "passing");
});

test("duplicate check-run entries for one name stay blocking", () => {
  // The API is asked for filter=latest, so this should not occur. If it ever does, erring toward
  // blocking is deliberate: deduplicating by name would open the gate on a partial view and would
  // also collapse two genuinely different checks that happen to share a name.
  const checks = evaluateChecks(
    {
      headSha: HEAD,
      checkRunsHeadSha: HEAD,
      checkRuns: [
        { name: "server tests", status: "completed", conclusion: "failure" },
        { name: "server tests", status: "completed", conclusion: "success" },
      ],
    },
    config,
  );
  assert.equal(checks.state, "failing");
  assert.deepEqual(checks.failing, ["server tests"]);
});

test("a draft pull request is never ready", () => {
  const readiness = deriveReadiness(readySnapshot({ isDraft: true }), config);
  assert.equal(readiness.ready, false);
  assert.match(readiness.blockers.join("\n"), /still a draft/);
});

test("a green draft pull request asks for the review mode", () => {
  const readiness = deriveReadiness(
    readySnapshot({
      isDraft: true,
      labels: [],
      statusCommentBody: decisionRecord(HEAD, "none"),
    }),
    config,
  );
  assert.equal(readiness.ready, false);
  assert.equal(readiness.phase, "awaiting-review-decision");
  assert.match(readiness.blockers.join("\n"), /still a draft/);
  assert.match(readiness.blockers.join("\n"), /No review mode has been chosen/);
  assert.match(renderStatusComment(readiness, { headSha: HEAD }), /Who reviews this head/);
});

test("a selected review runs while the pull request is still a draft", () => {
  const readiness = deriveReadiness(
    readySnapshot({ isDraft: true, reviews: [] }),
    config,
  );
  assert.equal(readiness.ready, false);
  assert.equal(readiness.phase, "review");
  assert.match(readiness.blockers.join("\n"), /still a draft/);
  assert.match(readiness.blockers.join("\n"), /No codex review covers/);
});

test("infrastructure changes require an explicit human approval", () => {
  const withBotOnly = deriveReadiness(
    readySnapshot({
      body: contractBody({ scope: "infra" }),
      changedFiles: ["infra/provisioning.yml"],
    }),
    config,
  );
  assert.equal(withBotOnly.ready, false);
  assert.match(withBotOnly.blockers.join("\n"), /explicit human approval/);
  // No agent can clear this, so it must not park under "review" as if one were running. It also
  // must not borrow agent:needs-human, which belongs to escalations this phase cannot derive.
  assert.equal(withBotOnly.phase, "awaiting-human-approval");
  assert.deepEqual(planLabels([], withBotOnly, config).add, [
    config.labels.pipeline,
  ]);

  const withHuman = deriveReadiness(
    readySnapshot({
      changedFiles: ["infra/provisioning.yml"],
      reviews: [
        {
          author: CODEX_REVIEWER,
          state: "APPROVED",
          commitSha: HEAD,
          submittedAt: "2026-08-04T10:00:00Z",
        },
        {
          author: "blorbeer-cmd",
          authorAssociation: "OWNER",
          state: "APPROVED",
          commitSha: HEAD,
          submittedAt: "2026-08-04T11:00:00Z",
        },
      ],
    }),
    config,
  );
  assert.equal(withHuman.ready, true);
});

test("an outsider approval cannot satisfy the infrastructure gate", () => {
  // The repository is public, so anyone may approve. Only someone who could write to it anyway
  // may clear a workflow or infrastructure change.
  for (const association of ["NONE", "CONTRIBUTOR", "FIRST_TIME_CONTRIBUTOR"]) {
    const readiness = deriveReadiness(
      readySnapshot({
        changedFiles: ["infra/provisioning.yml"],
        reviews: [
          {
            author: CODEX_REVIEWER,
            authorAssociation: "NONE",
            state: "APPROVED",
            commitSha: HEAD,
            submittedAt: "2026-08-04T10:00:00Z",
          },
          {
            author: "drive-by-stranger",
            authorAssociation: association,
            state: "APPROVED",
            commitSha: HEAD,
            submittedAt: "2026-08-04T11:00:00Z",
          },
        ],
      }),
      config,
    );
    assert.equal(readiness.ready, false, association);
    assert.equal(readiness.phase, "awaiting-human-approval", association);
    assert.match(readiness.blockers.join("\n"), /explicit human approval/);
  }
});

test("a collaborator approval does satisfy the infrastructure gate", () => {
  const readiness = deriveReadiness(
    readySnapshot({
      changedFiles: ["infra/provisioning.yml"],
      reviews: [
        {
          author: CODEX_REVIEWER,
          authorAssociation: "NONE",
          state: "APPROVED",
          commitSha: HEAD,
          submittedAt: "2026-08-04T10:00:00Z",
        },
        {
          author: "a-maintainer",
          authorAssociation: "COLLABORATOR",
          state: "APPROVED",
          commitSha: HEAD,
          submittedAt: "2026-08-04T11:00:00Z",
        },
      ],
    }),
    config,
  );
  assert.equal(readiness.ready, true);
});

test("workflow changes remain eligible for cross-review without a second human gate", () => {
  const readiness = deriveReadiness(
    readySnapshot({
      changedFiles: [".github/workflows/agent-pipeline-reconcile.yml"],
      reviews: commentedReview(),
    }),
    config,
  );
  assert.equal(readiness.details.protectedPaths.length, 0);
  assert.equal(readiness.ready, true);
  assert.doesNotMatch(readiness.blockers.join("\n"), /explicit human approval/);
});

test("a fork pull request gets no writing automation at all", () => {
  // The pull-request body is under the fork author's control, so the fork check must come first.
  const plan = reconcile(
    readySnapshot({
      headRepository: "attacker/LAN_2026",
      authorLogin: "attacker",
    }),
    config,
  );
  assert.equal(plan.readiness.phase, "fork");
  assert.equal(plan.readiness.participating, false);
  assert.equal(plan.readiness.mutate, false);
  assert.deepEqual(plan.labels, { add: [], remove: [] });
  assert.equal(plan.comment, null);
});

test("unreadable review threads block with their own reason", () => {
  const readiness = deriveReadiness(
    readySnapshot({ reviewThreads: [], reviewThreadsReadable: false }),
    config,
  );
  assert.equal(readiness.ready, false);
  assert.match(readiness.blockers.join("\n"), /could not be read completely/);
  // Must not claim an open thread the maintainer would go looking for.
  assert.doesNotMatch(readiness.blockers.join("\n"), /review thread\(s\) are still unresolved/);

  // A genuine open thread still reports the count.
  const real = deriveReadiness(
    readySnapshot({ reviewThreads: [{ isResolved: false, isOutdated: false }] }),
    config,
  );
  assert.match(real.blockers.join("\n"), /1 review thread\(s\) are still unresolved/);
});

test("a passed cross-review does not keep the review phase", () => {
  // Only the UI notice is missing; nobody is reviewing, so agent:review would contradict the
  // verdict the status comment shows.
  const readiness = deriveReadiness(
    readySnapshot({
      body: contractBody({ scope: "frontend", "ui-change": "yes" }),
      changedFiles: ["server/public/app.js"],
    }),
    config,
  );
  assert.equal(readiness.details.reviews.verdict, "pass");
  assert.equal(readiness.ready, false);
  assert.notEqual(readiness.phase, "review");

  // A genuinely outstanding review round still selects the review phase.
  const outstanding = deriveReadiness(readySnapshot({ reviews: [] }), config);
  assert.equal(outstanding.phase, "review");
});

test("a human approval never substitutes for the cross-review", () => {
  // providerAuthorAllowlist lists the human maintainer for both providers. Using it as the
  // reviewer list would let one human approval satisfy the cross-review and the protected-path
  // approval at once, so the reviewer list is a separate, bot-only allowlist.
  const humanOnly = deriveReadiness(
    readySnapshot({
      reviews: [
        {
          author: "blorbeer-cmd",
          state: "APPROVED",
          commitSha: HEAD,
          submittedAt: "2026-08-04T10:00:00Z",
        },
      ],
    }),
    config,
  );
  assert.equal(humanOnly.ready, false);
  assert.equal(humanOnly.details.reviews.verdict, "none");
  assert.match(humanOnly.blockers.join("\n"), /No codex review covers the current head SHA/);

  // On a protected path the same lone approval must not open both gates either.
  const humanOnlyProtected = deriveReadiness(
    readySnapshot({
      changedFiles: ["infra/provisioning.yml"],
      reviews: [
        {
          author: "blorbeer-cmd",
          state: "APPROVED",
          commitSha: HEAD,
          submittedAt: "2026-08-04T10:00:00Z",
        },
      ],
    }),
    config,
  );
  assert.equal(humanOnlyProtected.ready, false);
  assert.match(
    humanOnlyProtected.blockers.join("\n"),
    /No codex review covers the current head SHA/,
  );
});

test("an automatable state outranks the human-approval wait", () => {
  const protectedPath = {
    changedFiles: ["infra/provisioning.yml"],
  };

  const failing = deriveReadiness(
    readySnapshot({
      ...protectedPath,
      checkRuns: [
        { name: "server tests", status: "completed", conclusion: "failure" },
      ],
    }),
    config,
  );
  assert.equal(failing.phase, "ci-fix");
  assert.equal(failing.ready, false);
  assert.match(failing.blockers.join("\n"), /explicit human approval/);

  const conflicted = deriveReadiness(
    readySnapshot({ ...protectedPath, mergeable: false }),
    config,
  );
  assert.equal(conflicted.phase, "conflict-fix");
  assert.match(conflicted.blockers.join("\n"), /explicit human approval/);
});

test("a UI change blocks until its notice covers the current head", () => {
  const uiSnapshot = readySnapshot({
    body: contractBody({ scope: "frontend", "ui-change": "yes" }),
    changedFiles: ["server/public/js/views/home.js"],
  });

  const missing = deriveReadiness(uiSnapshot, config);
  assert.equal(missing.ready, false);
  assert.equal(missing.details.uiChanged, true);
  assert.match(missing.blockers.join("\n"), /needs its review notice/);

  const stale = deriveReadiness(
    { ...uiSnapshot, uiNoticeHeadSha: OLD_HEAD },
    config,
  );
  assert.match(stale.blockers.join("\n"), /does not cover the current head/);

  const current = deriveReadiness(
    { ...uiSnapshot, uiNoticeHeadSha: HEAD },
    config,
  );
  assert.equal(current.ready, true);
});

test("the kill-switch label suppresses every mutation", () => {
  const plan = reconcile(
    readySnapshot({ labels: [config.labels.noAuto] }),
    config,
  );
  assert.equal(plan.readiness.phase, "no-auto");
  assert.equal(plan.readiness.mutate, false);
  assert.deepEqual(plan.labels, { add: [], remove: [] });
  assert.equal(plan.comment, null);
});

test("a pull request without a task contract is left alone", () => {
  const plan = reconcile(
    readySnapshot({ body: "A regular human pull request." }),
    config,
  );
  assert.equal(plan.readiness.participating, false);
  assert.deepEqual(plan.labels, { add: [], remove: [] });
  assert.equal(plan.comment, null);
});

test("a closed pull request is left alone", () => {
  const plan = reconcile(readySnapshot({ state: "closed" }), config);
  assert.equal(plan.readiness.mutate, false);
  assert.deepEqual(plan.labels, { add: [], remove: [] });
});

test("an invalid contract reports a diagnosis and stays self-healing", () => {
  const readiness = deriveReadiness(
    readySnapshot({ body: contractBody({ scope: "docs" }) }),
    config,
  );
  assert.equal(readiness.phase, "contract-invalid");
  assert.equal(readiness.ready, false);
  assert.match(readiness.blockers.join("\n"), /Invalid task contract/);

  // No sticky escalation label, so fixing the body is enough to recover.
  const plan = planLabels([], readiness, config);
  assert.ok(!plan.add.includes(config.labels.needsHuman));
});

test("the escalation label stops automation and is never written or cleared here", () => {
  // agent:needs-human covers escalations this phase cannot derive, such as an exhausted round
  // limit. A sweep must not wipe one, or the escalation would silently disappear.
  const readiness = deriveReadiness(
    readySnapshot({ labels: [config.labels.needsHuman] }),
    config,
  );
  assert.equal(readiness.phase, "needs-human");
  assert.equal(readiness.ready, false);

  const plan = planLabels([config.labels.needsHuman], readiness, config);
  assert.ok(!plan.remove.includes(config.labels.needsHuman));
  assert.ok(!plan.add.includes(config.labels.needsHuman));
  // No phase label on top: the escalation label already describes the state.
  assert.deepEqual(plan.add, [config.labels.pipeline]);
});

test("a waiting pull request gets no contradictory implementing label", () => {
  // agent:waiting means no agent is working, so claiming agent:implementing alongside it would
  // report work nobody is doing.
  const readiness = deriveReadiness(
    readySnapshot({ labels: [config.labels.waiting] }),
    config,
  );
  assert.equal(readiness.phase, "waiting");
  assert.equal(readiness.ready, false);

  const plan = planLabels([config.labels.waiting], readiness, config);
  assert.deepEqual(plan.add, [config.labels.pipeline]);
  assert.ok(!plan.add.includes(config.labels.implementing));
  assert.deepEqual(plan.remove, []);
});

test("an invalid contract keeps a still-correct ui:changed label", () => {
  const readiness = deriveReadiness(
    readySnapshot({
      body: contractBody({ scope: "docs" }),
      changedFiles: ["server/public/app.js"],
    }),
    config,
  );
  assert.equal(readiness.phase, "contract-invalid");
  assert.equal(readiness.details.uiChanged, true);

  const plan = planLabels(
    [config.labels.pipeline, config.labels.uiChanged],
    readiness,
    config,
  );
  assert.deepEqual(plan.remove, []);
});

test("the waiting label blocks readiness and is never cleared here", () => {
  const readiness = deriveReadiness(
    readySnapshot({ labels: [config.labels.waiting] }),
    config,
  );
  assert.equal(readiness.ready, false);
  assert.match(readiness.blockers.join("\n"), /temporarily unavailable/);

  const plan = planLabels([config.labels.waiting], readiness, config);
  assert.ok(!plan.remove.includes(config.labels.waiting));
});

test("label planning leaves foreign labels untouched", () => {
  const readiness = deriveReadiness(readySnapshot(), config);
  const plan = planLabels(
    ["bug", "priority:high", config.labels.implementing],
    readiness,
    config,
  );
  assert.deepEqual(plan.add, [
    config.labels.pipeline,
    config.labels.readyForMerge,
  ]);
  // Only the pipeline's own stale phase label is removed.
  assert.deepEqual(plan.remove, [config.labels.implementing]);
});

test("a repeated run on an unchanged pull request plans no writes", () => {
  const snapshot = readySnapshot();
  const first = reconcile(snapshot, config);
  assert.ok(first.labels.add.length > 0);
  assert.ok(first.comment);

  // Second delivery of the same event, with the first run's effects already applied.
  const applied = {
    ...snapshot,
    labels: [...snapshot.labels, ...first.labels.add],
    statusCommentBody: first.comment.body,
    gateStatus: {
      state: first.status.state,
      description: first.status.description,
    },
  };
  const second = reconcile(applied, config);
  assert.deepEqual(second.labels, { add: [], remove: [] });
  assert.equal(second.comment, null);
  assert.equal(second.status, null);

  // And a third delivery stays just as quiet.
  const third = reconcile(applied, config);
  assert.deepEqual(third.labels, { add: [], remove: [] });
  assert.equal(third.comment, null);
  assert.equal(third.status, null);
});

test("paginate refuses to truncate instead of reading a partial list", async () => {
  // A short changedFiles would make protected-path and UI detection miss a path, and a short
  // comment list would hide the sticky comment and duplicate it on every run. Both fail open, so
  // the read must fail loudly instead.
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    return {
      ok: true,
      status: 200,
      json: async () => Array.from({ length: 100 }, (_, i) => ({ id: i })),
    };
  };

  try {
    await assert.rejects(
      () => paginate("/repos/o/r/pulls/1/files", "token"),
      /refusing to judge readiness on a truncated read/,
    );
    assert.equal(requests, 10);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("paginate returns everything when the last page is short", async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    return {
      ok: true,
      status: 200,
      json: async () =>
        requests === 1
          ? Array.from({ length: 100 }, (_, i) => ({ id: i }))
          : [{ id: 100 }],
    };
  };

  try {
    const items = await paginate("/repos/o/r/pulls/1/files", "token");
    assert.equal(items.length, 101);
    assert.equal(requests, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("paginate retries transient GitHub read failures", async () => {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  let requests = 0;
  let warnings = 0;
  console.warn = () => {
    warnings += 1;
  };
  globalThis.fetch = async () => {
    requests += 1;
    if (requests < 3) {
      return {
        ok: false,
        status: 500,
        headers: { get: () => "0" },
        body: { cancel: async () => {} },
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => [{ id: 1 }],
    };
  };

  try {
    const items = await paginate("/repos/o/r/pulls/1/files", "token");
    assert.deepEqual(items, [{ id: 1 }]);
    assert.equal(requests, 3);
    assert.equal(warnings, 2);
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
  }
});

test("paginate does not retry permanent GitHub read failures", async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    return {
      ok: false,
      status: 404,
      text: async () => "not found",
    };
  };

  try {
    await assert.rejects(
      () => paginate("/repos/o/r/pulls/1/files", "token"),
      /failed with 404: not found/,
    );
    assert.equal(requests, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GraphQL reads retry RATE_LIMITED errors returned with HTTP 200", async () => {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  let requests = 0;
  let warnings = 0;
  console.warn = () => {
    warnings += 1;
  };
  globalThis.fetch = async () => {
    requests += 1;
    return {
      ok: true,
      status: 200,
      headers: { get: () => "0" },
      json: async () =>
        requests === 1
          ? {
              errors: [
                { type: "RATE_LIMITED", message: "API rate limit exceeded" },
              ],
            }
          : {
              data: {
                repository: {
                  pullRequest: {
                    mergeStateStatus: "CLEAN",
                    reviewThreads: {
                      nodes: [],
                      pageInfo: { hasNextPage: false, endCursor: null },
                    },
                  },
                },
              },
            },
    };
  };

  try {
    const result = await fetchReviewThreads({
      owner: "o",
      repo: "r",
      pullNumber: 1,
      token: "token",
    });
    assert.deepEqual(result, {
      mergeStateStatus: "CLEAN",
      reviewThreads: [],
      readable: true,
    });
    assert.equal(requests, 2);
    assert.equal(warnings, 1);
  } finally {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
  }
});

test("the status comment is deterministic and carries its marker", () => {
  const snapshot = readySnapshot();
  const readiness = deriveReadiness(snapshot, config);
  const first = renderStatusComment(readiness, snapshot);
  const second = renderStatusComment(deriveReadiness(snapshot, config), snapshot);
  assert.equal(first, second);
  assert.ok(first.startsWith(STATUS_COMMENT_MARKER));
  assert.match(first, /Phase: `ready-for-merge`/);
  assert.match(first, new RegExp(HEAD));
});

/** A comment from an account that could write to the repository anyway. */
function trusted(body, overrides = {}) {
  return {
    body,
    author: "a-maintainer",
    authorAssociation: "COLLABORATOR",
    ...overrides,
  };
}

test("a UI notice written with the exported marker is parsed back", () => {
  // Guards the marker and the parser against drifting apart: a notice that cannot be read back
  // would block every UI pull request forever.
  const notice = trusted(
    `${UI_NOTICE_MARKER} ${HEAD} -->\n\nPlease check the home view.`,
  );
  assert.equal(parseUiNoticeHeadSha([notice]), HEAD);

  const readiness = deriveReadiness(
    {
      ...readySnapshot({
        body: contractBody({ scope: "frontend", "ui-change": "yes" }),
        changedFiles: ["server/public/js/views/home.js"],
      }),
      uiNoticeHeadSha: parseUiNoticeHeadSha([notice]),
    },
    config,
  );
  assert.equal(readiness.ready, true);
});

test("a UI notice from the pipeline's own bot identity counts", () => {
  const notice = {
    body: `${UI_NOTICE_MARKER} ${HEAD} -->`,
    author: "github-actions[bot]",
    // Bots often report no write association, so the bot identity itself is the trust signal.
    authorAssociation: "NONE",
  };
  assert.equal(parseUiNoticeHeadSha([notice]), HEAD);
});

test("a UI notice from an outsider cannot clear the gate", () => {
  // The repository is public: anyone can comment. Posting the marker must not declare a UI change
  // reviewed that nobody looked at.
  const hostile = {
    body: `${UI_NOTICE_MARKER} ${HEAD} -->`,
    author: "drive-by-stranger",
    authorAssociation: "NONE",
  };
  assert.equal(parseUiNoticeHeadSha([hostile]), null);

  const readiness = deriveReadiness(
    {
      ...readySnapshot({
        body: contractBody({ scope: "frontend", "ui-change": "yes" }),
        changedFiles: ["server/public/js/views/home.js"],
      }),
      uiNoticeHeadSha: parseUiNoticeHeadSha([hostile]),
    },
    config,
  );
  assert.equal(readiness.ready, false);
  assert.match(readiness.blockers.join("\n"), /needs its review notice/);
});

test("a status comment from an outsider is not adopted as the pipeline's own", () => {
  assert.equal(
    isTrustedCommentAuthor({
      author: "drive-by-stranger",
      authorAssociation: "NONE",
    }),
    false,
  );
  assert.equal(
    isTrustedCommentAuthor({
      author: "github-actions[bot]",
      authorAssociation: "NONE",
    }),
    true,
  );
  assert.equal(
    isTrustedCommentAuthor({
      author: "a-maintainer",
      authorAssociation: "COLLABORATOR",
    }),
    true,
  );
  // A comment with no author information at all is not trusted.
  assert.equal(isTrustedCommentAuthor({}), false);
});

test("UI notice parsing ignores malformed markers and prefers the newest", () => {
  assert.equal(parseUiNoticeHeadSha([]), null);
  assert.equal(parseUiNoticeHeadSha([trusted("no marker here")]), null);
  assert.equal(
    parseUiNoticeHeadSha([trusted(`${UI_NOTICE_MARKER} not-a-sha -->`)]),
    null,
  );
  assert.equal(
    parseUiNoticeHeadSha([
      trusted(`${UI_NOTICE_MARKER} ${OLD_HEAD} -->`),
      trusted(`${UI_NOTICE_MARKER} ${HEAD} -->`),
    ]),
    HEAD,
  );
  // An untrusted newer notice must not supersede a trusted older one.
  assert.equal(
    parseUiNoticeHeadSha([
      trusted(`${UI_NOTICE_MARKER} ${OLD_HEAD} -->`),
      {
        body: `${UI_NOTICE_MARKER} ${HEAD} -->`,
        author: "drive-by-stranger",
        authorAssociation: "NONE",
      },
    ]),
    OLD_HEAD,
  );
});

test("the status comment lists the blockers it reports", () => {
  const snapshot = readySnapshot({ isDraft: true, mergeable: false });
  const readiness = deriveReadiness(snapshot, config);
  const comment = renderStatusComment(readiness, snapshot);
  assert.match(comment, /still a draft/);
  assert.match(comment, /merge conflict/);
  assert.match(comment, /Ready for human merge: `false`/);
});

test("the merge gate succeeds only once every condition holds", () => {
  const readiness = deriveReadiness(readySnapshot(), config);
  const status = planGateStatus(readiness, config);
  assert.equal(status.context, config.statusContext);
  assert.equal(status.state, "success");
  assert.match(status.description, /merge stays yours/i);
});

test("a blocked pull request keeps the gate pending and names the reason", () => {
  // Pending, not failure: the pipeline is still working on this pull request, and the merge box
  // should read as "waiting" rather than as a broken check.
  const readiness = deriveReadiness(
    readySnapshot({ isDraft: true, mergeable: false }),
    config,
  );
  const status = planGateStatus(readiness, config);
  assert.equal(status.state, "pending");
  assert.match(status.description, /^conflict-fix: /);
  assert.match(status.description, /still a draft/);
  // More than one blocker is open, and the description says so instead of hiding the rest.
  assert.match(status.description, /\(\+\d+ more\)$/);
});

test("a long blocker list still fits into a status description", () => {
  // GitHub rejects a description over the limit; losing the status would leave the gate unwritten.
  const failing = Array.from({ length: 40 }, (_, index) => ({
    name: `Very long check name number ${index}`,
    status: "completed",
    conclusion: "failure",
  }));
  const readiness = deriveReadiness(
    readySnapshot({ checkRuns: failing }),
    config,
  );
  const status = planGateStatus(readiness, config);
  assert.equal(status.state, "pending");
  assert.ok(status.description.length <= GATE_DESCRIPTION_LIMIT);
  assert.match(status.description, /\.\.\.$/);
});

test("a pull request outside the pipeline is told the gate does not apply", () => {
  // Without this the required check would never be written for a human or Dependabot pull request,
  // and it could never be merged by anyone without administrator rights.
  const plan = reconcile(
    readySnapshot({ body: "A regular human pull request." }),
    config,
  );
  assert.equal(plan.readiness.participating, false);
  assert.deepEqual(plan.labels, { add: [], remove: [] });
  assert.equal(plan.comment, null);
  assert.equal(plan.status.state, "success");
  assert.match(plan.status.description, /does not apply/);
});

test("a fork pull request gets the gate verdict but no other write", () => {
  const plan = reconcile(
    readySnapshot({ headRepository: "outsider/LAN_2026" }),
    config,
  );
  assert.equal(plan.readiness.phase, "fork");
  assert.deepEqual(plan.labels, { add: [], remove: [] });
  assert.equal(plan.comment, null);
  assert.equal(plan.status.state, "success");
  assert.match(plan.status.description, /Fork pull request/);
});

test("a closed pull request gets no gate verdict at all", () => {
  const plan = reconcile(readySnapshot({ state: "closed" }), config);
  assert.equal(plan.status, null);
});

test("a closed pull request that still carries agent:no-auto gets no gate verdict either", () => {
  // Labels outlive the state transition: a pull request closed while paused must still read as
  // history, not resurrect the kill-switch's `pending` verdict on an already-final commit.
  const plan = reconcile(
    readySnapshot({ state: "closed", labels: [config.labels.noAuto] }),
    config,
  );
  assert.equal(plan.readiness.phase, "closed");
  assert.equal(plan.status, null);
});

test("the kill switch holds the gate closed instead of leaving it open", () => {
  // `agent:no-auto` stops every mutation, but section 11 of the plan counts it as a gate condition:
  // a paused pull request that kept an earlier `success` would be mergeable while paused.
  const plan = reconcile(
    readySnapshot({
      labels: [config.labels.noAuto],
      gateStatus: { state: "success", description: "stale verdict" },
    }),
    config,
  );
  assert.equal(plan.readiness.mutate, false);
  assert.deepEqual(plan.labels, { add: [], remove: [] });
  assert.equal(plan.comment, null);
  assert.equal(plan.status.state, "pending");
  assert.match(plan.status.description, /^no-auto: /);
});

test("a changed verdict is written and an unchanged one is not", () => {
  const ready = readySnapshot();
  const verdict = planGateStatus(deriveReadiness(ready, config), config);

  assert.equal(reconcile({ ...ready, gateStatus: verdict }, config).status, null);
  // A stale description for the same state is a real difference: it names the wrong blocker.
  assert.ok(
    reconcile(
      { ...ready, gateStatus: { state: "success", description: "something else" } },
      config,
    ).status,
  );
  assert.ok(
    reconcile(
      { ...ready, gateStatus: { state: "pending", description: verdict.description } },
      config,
    ).status,
  );
});

// ---------------------------------------------------------------------------
// Review-mode selection
//
// Who reviews a head is the user's decision, so the pipeline asks once per head SHA and never
// answers for them. Everything after the answer stays automatic.
// ---------------------------------------------------------------------------

test("a green pull request without a review-mode label waits for the decision", () => {
  const readiness = deriveReadiness(readySnapshot({ labels: [] }), config);
  assert.equal(readiness.ready, false);
  assert.equal(readiness.phase, "awaiting-review-decision");
  assert.deepEqual(readiness.blockers, [
    "No review mode has been chosen for the current head SHA.",
  ]);
});

test("the decision is not asked for while anything mechanical is still open", () => {
  // Asking now would bind the answer to a head that is about to change, and the gate is already
  // blocked by the failing check.
  const readiness = deriveReadiness(
    readySnapshot({
      labels: [],
      checkRuns: [{ name: "CI/CD", status: "completed", conclusion: "failure" }],
    }),
    config,
  );
  assert.equal(readiness.phase, "ci-fix");
  assert.deepEqual(readiness.blockers, ["Checks are failing: CI/CD."]);
});

test("more than one review-mode label blocks instead of picking one", () => {
  const snapshot = readySnapshot({ labels: [CROSS_LABEL, HUMAN_LABEL] });
  const readiness = deriveReadiness(snapshot, config);
  assert.equal(readiness.phase, "awaiting-review-decision");
  assert.match(readiness.blockers[0], /More than one review-mode label is set/);
  // Guessing a winner would answer the question for the user; nothing is removed.
  assert.deepEqual(planLabels(snapshot.labels, readiness, config).remove, []);
});

test("a decision bound to an earlier head is consumed and asked again", () => {
  const snapshot = readySnapshot({
    labels: [CROSS_LABEL],
    statusCommentBody: decisionRecord(OLD_HEAD, "cross"),
  });
  const readiness = deriveReadiness(snapshot, config);

  assert.equal(readiness.phase, "awaiting-review-decision");
  assert.deepEqual(readiness.blockers, [
    "The review mode was chosen for an earlier head SHA; choose again for the current head.",
  ]);
  // Removing the label is what makes the question return; the approval for the old head is gone
  // anyway, so nothing about the gate is weakened by it.
  assert.ok(planLabels(snapshot.labels, readiness, config).remove.includes(CROSS_LABEL));
});

test("switching the mode at the same head simply rebinds", () => {
  // The counter provider running out of quota mid-round is exactly why this feature exists.
  const readiness = deriveReadiness(
    readySnapshot({
      labels: [HUMAN_LABEL],
      statusCommentBody: decisionRecord(HEAD, "cross"),
      reviews: [
        {
          author: "blorbeer-cmd",
          authorAssociation: "OWNER",
          state: "APPROVED",
          commitSha: HEAD,
          submittedAt: "2026-08-07T10:00:00Z",
        },
      ],
    }),
    config,
  );
  assert.equal(readiness.details.reviewMode, "human");
  assert.deepEqual(readiness.details.reviewDecision.staleLabels, []);
  assert.equal(readiness.ready, true);
});

test("the pipeline never sets a review-mode label itself", () => {
  const readiness = deriveReadiness(readySnapshot({ labels: [] }), config);
  const plan = planLabels([], readiness, config);
  for (const label of Object.values(config.reviewModeLabels)) {
    assert.ok(!plan.add.includes(label), `${label} must never be added by the pipeline`);
  }
});

test("self mode needs a published result for exactly this head", () => {
  const withoutResult = deriveReadiness(
    readySnapshot({ labels: [SELF_LABEL], reviews: [] }),
    config,
  );
  assert.equal(withoutResult.phase, "review");
  assert.deepEqual(withoutResult.blockers, [
    "No self-review result has been published for the current head SHA.",
  ]);

  const staleResult = deriveReadiness(
    readySnapshot({
      labels: [SELF_LABEL],
      reviews: [],
      reviewResults: parseReviewResults([selfResultComment(OLD_HEAD)]),
    }),
    config,
  );
  assert.deepEqual(staleResult.blockers, [
    "No self-review result has been published for the current head SHA.",
  ]);
});

test("a passing self-review opens the gate for the head it names", () => {
  const readiness = deriveReadiness(
    readySnapshot({
      labels: [SELF_LABEL],
      // No cross approval at all: the chosen mode decides which evidence counts.
      reviews: [],
      reviewResults: parseReviewResults([selfResultComment(HEAD)]),
    }),
    config,
  );
  assert.equal(readiness.ready, true);
  assert.equal(readiness.phase, "ready-for-merge");
  assert.equal(readiness.details.selfResult.sessionId, "claude-review-7f3");
});

test("a self-review with no read-only backing at all does not count", () => {
  const readiness = deriveReadiness(
    readySnapshot({
      labels: [SELF_LABEL],
      reviews: [],
      reviewResults: parseReviewResults([
        selfResultComment(HEAD, { "read-only": "false" }),
      ]),
    }),
    config,
  );
  assert.equal(readiness.ready, false);
  assert.match(readiness.blockers[0], /read-only level `false`, below the required `verified`/);
});

test("a launcher-verified self-review satisfies the default minimum", () => {
  // `true` requires credentials that cannot write, which is unreachable wherever the only available
  // credentials can push. Without `verified` the self mode was simply unusable there.
  const readiness = deriveReadiness(
    readySnapshot({
      labels: [SELF_LABEL],
      reviews: [],
      reviewResults: parseReviewResults([
        selfResultComment(HEAD, { "read-only": "verified" }),
      ]),
    }),
    config,
  );
  assert.equal(readiness.ready, true);
  assert.equal(readiness.phase, "ready-for-merge");
  assert.equal(readiness.details.selfResult.readOnly, "verified");
});

test("a repository may still demand credential-level read-only", () => {
  const strict = { ...config, selfReviewMinimumEnforcement: "true" };
  const verified = deriveReadiness(
    readySnapshot({
      labels: [SELF_LABEL],
      reviews: [],
      reviewResults: parseReviewResults([selfResultComment(HEAD, { "read-only": "verified" })]),
    }),
    strict,
  );
  assert.equal(verified.ready, false);
  assert.match(verified.blockers[0], /below the required `true`/);

  const enforced = deriveReadiness(
    readySnapshot({
      labels: [SELF_LABEL],
      reviews: [],
      reviewResults: parseReviewResults([selfResultComment(HEAD, { "read-only": "true" })]),
    }),
    strict,
  );
  assert.equal(enforced.ready, true);
});

test("the read-only level reached is recorded next to the mode, not only while it blocks", () => {
  // Once the gate passes, the blocker is gone — but how independent the verdict actually was stays
  // relevant to whoever merges.
  const readiness = deriveReadiness(
    readySnapshot({
      labels: [SELF_LABEL],
      reviews: [],
      reviewResults: parseReviewResults([selfResultComment(HEAD, { "read-only": "verified" })]),
    }),
    config,
  );
  const comment = renderStatusComment(readiness, readySnapshot({ labels: [SELF_LABEL] }), config);
  assert.match(comment, /read-only verified by the launcher, not by credentials/);
});

test("an unknown read-only value is ranked as the weakest, never as a pass", () => {
  // A marker the parser cannot classify must not come out stronger than an honest `false`.
  assert.ok(!meetsReadOnlyMinimum("sort-of", "verified"));
  assert.ok(!meetsReadOnlyMinimum(undefined, "verified"));
  assert.ok(meetsReadOnlyMinimum("true", "false"));
});

test("an invalid configured minimum fails loudly instead of accepting everything", () => {
  // From the self-review of c16dd00: ranking an unknown minimum at zero made a typo in
  // selfReviewMinimumEnforcement accept every marker, `read-only=false` included — the entire
  // check disabled with no error, no log line and no failing test.
  for (const broken of ["verifed", "", "TRUE", null, 1]) {
    assert.throws(
      () => meetsReadOnlyMinimum("false", broken),
      /selfReviewMinimumEnforcement must be one of/,
      `a minimum of ${JSON.stringify(broken)} must not silently pass`,
    );
  }
  // The valid ones keep working, including the deliberate opt-out.
  assert.ok(meetsReadOnlyMinimum("false", "false"));
  assert.ok(!meetsReadOnlyMinimum("verified", "true"));
});

test("a broken minimum blocks the gate rather than opening it", () => {
  // The throw has to surface where the gate is computed, not be swallowed into a pass.
  assert.throws(
    () =>
      deriveReadiness(
        readySnapshot({
          labels: [SELF_LABEL],
          reviews: [],
          reviewResults: parseReviewResults([selfResultComment(HEAD, { "read-only": "false" })]),
        }),
        { ...config, selfReviewMinimumEnforcement: "verifed" },
      ),
    /selfReviewMinimumEnforcement must be one of/,
  );
});

test("a self-review reporting changes or blocked keeps the gate closed", () => {
  for (const [verdict, expected] of [
    ["changes-required", /requested changes/],
    ["blocked", /reported `blocked`/],
  ]) {
    const readiness = deriveReadiness(
      readySnapshot({
        labels: [SELF_LABEL],
        reviews: [],
        reviewResults: parseReviewResults([selfResultComment(HEAD, { verdict })]),
      }),
      config,
    );
    assert.equal(readiness.ready, false);
    assert.match(readiness.blockers[0], expected);
  }
});

test("a review result from an outsider is ignored", () => {
  // The repository is public: anyone can comment, and a result satisfies a merge gate.
  const results = parseReviewResults([
    {
      author: "drive-by",
      authorAssociation: "NONE",
      body: selfResultComment(HEAD).body,
    },
  ]);
  assert.deepEqual(results, []);
});

test("human mode needs a human approval with write access for this head", () => {
  const outstanding = deriveReadiness(
    readySnapshot({ labels: [HUMAN_LABEL] }),
    config,
  );
  // The bot approval in the fixture is a cross-review, never the human one.
  assert.equal(outstanding.ready, false);
  assert.deepEqual(outstanding.blockers, [
    "No human approval covers the current head SHA yet.",
  ]);

  const outsider = deriveReadiness(
    readySnapshot({
      labels: [HUMAN_LABEL],
      reviews: [
        {
          author: "drive-by",
          authorAssociation: "NONE",
          state: "APPROVED",
          commitSha: HEAD,
          submittedAt: "2026-08-07T10:00:00Z",
        },
      ],
    }),
    config,
  );
  assert.equal(outsider.ready, false);

  const approved = deriveReadiness(
    readySnapshot({
      labels: [HUMAN_LABEL],
      reviews: [
        {
          author: "blorbeer-cmd",
          authorAssociation: "OWNER",
          state: "APPROVED",
          commitSha: HEAD,
          submittedAt: "2026-08-07T10:00:00Z",
        },
      ],
    }),
    config,
  );
  assert.equal(approved.ready, true);
});

test("the chosen mode decides which evidence counts", () => {
  // A cross approval is stronger than a self-review, but it is not the mode that was chosen.
  // Switching the label is the way to use it, so the gate stays predictable.
  const readiness = deriveReadiness(readySnapshot({ labels: [SELF_LABEL] }), config);
  assert.equal(readiness.ready, false);
  assert.match(readiness.blockers[0], /No self-review result/);
});

test("human mode does not remove any other gate condition", () => {
  const readiness = deriveReadiness(
    readySnapshot({
      labels: [HUMAN_LABEL],
      reviews: [
        {
          author: "blorbeer-cmd",
          authorAssociation: "OWNER",
          state: "APPROVED",
          commitSha: HEAD,
          submittedAt: "2026-08-07T10:00:00Z",
        },
      ],
      reviewThreads: [{ isResolved: false, isOutdated: false }],
      body: contractBody({ scope: "frontend" }),
      changedFiles: ["server/public/js/views/admin.js"],
    }),
    config,
  );
  assert.equal(readiness.ready, false);
  assert.deepEqual(readiness.blockers, [
    "1 review thread(s) are still unresolved.",
    "A visible UI/UX change still needs its review notice.",
  ]);
});

test("the recommendation follows what the reconciler can actually see", () => {
  assert.equal(
    recommendReviewMode(
      { changedFiles: [".github/workflows/deploy.yml"], protectedPaths: [".github/workflows/deploy.yml"] },
      config,
    ).mode,
    "cross",
  );
  assert.equal(
    recommendReviewMode({ changedFiles: ["server/src/db.ts"], protectedPaths: [] }, config).mode,
    "cross",
  );
  assert.equal(
    recommendReviewMode(
      { changedFiles: ["docs/plans/x.md", "README.md"], protectedPaths: [] },
      config,
    ).mode,
    "human",
  );
  assert.equal(
    recommendReviewMode(
      { changedFiles: ["server/public/js/views/games.js"], protectedPaths: [], priorReviewPassed: true },
      config,
    ).mode,
    "self",
  );
  // Nothing has passed yet, so the first round gets the independent review.
  assert.equal(
    recommendReviewMode(
      { changedFiles: ["server/public/js/views/games.js"], protectedPaths: [], priorReviewPassed: false },
      config,
    ).mode,
    "cross",
  );
});

test("an approval on an earlier head counts as a prior passing review", () => {
  const snapshot = readySnapshot({
    reviews: [
      {
        author: CODEX_REVIEWER,
        state: "APPROVED",
        commitSha: OLD_HEAD,
        submittedAt: "2026-08-04T10:00:00Z",
      },
    ],
  });
  assert.equal(
    hasEarlierPassingReview(snapshot, config.providerReviewerAllowlist.codex),
    true,
  );
  assert.equal(hasEarlierPassingReview(readySnapshot(), config.providerReviewerAllowlist.codex), false);
});

test("the status comment asks the question and records the answer", () => {
  const undecided = readySnapshot({ labels: [] });
  const asking = renderStatusComment(deriveReadiness(undecided, config), undecided, config);
  assert.match(asking, /### Who reviews this head\?/);
  assert.match(asking, new RegExp(CROSS_LABEL));
  assert.match(asking, new RegExp(SELF_LABEL));
  assert.match(asking, new RegExp(HUMAN_LABEL));
  assert.match(asking, /Recommended: /);
  // Nothing is bound yet, but the head is recorded as seen — that is what lets the next run tell a
  // fresh answer from one that predates this head.
  assert.deepEqual(parseReviewDecision(asking), { headSha: HEAD, mode: "none" });

  const decided = readySnapshot();
  const answered = renderStatusComment(deriveReadiness(decided, config), decided, config);
  assert.doesNotMatch(answered, /### Who reviews this head\?/);
  // The protocol: which mode, and that it is bound to this head.
  assert.match(answered, /Review mode: `cross`/);
  assert.deepEqual(parseReviewDecision(answered), { headSha: HEAD, mode: "cross" });
});

test("the status comment names the reduced independence of self and human mode", () => {
  for (const [label, expected] of [
    [SELF_LABEL, /reduced independence/],
    [HUMAN_LABEL, /review and merge are the same person/],
  ]) {
    const snapshot = readySnapshot({ labels: [label] });
    const body = renderStatusComment(deriveReadiness(snapshot, config), snapshot, config);
    assert.match(body, expected);
  }
});

test("the decision record survives a full reconcile round trip", () => {
  const snapshot = readySnapshot();
  const first = reconcile(snapshot, config);
  assert.ok(first.comment);

  // Feeding the written comment back is what the next run reads from GitHub.
  const second = reconcile(
    { ...snapshot, statusCommentBody: first.comment.body },
    config,
  );
  assert.equal(second.comment, null, "an unchanged comment must not be rewritten");
  assert.equal(second.readiness.ready, true);
  assert.deepEqual(second.labels.remove, []);

  // A new head expires the binding, and the label goes with it.
  const afterFix = reconcile(
    { ...snapshot, headSha: OLD_HEAD, checkRunsHeadSha: OLD_HEAD, statusCommentBody: first.comment.body },
    config,
  );
  assert.equal(afterFix.readiness.phase, "awaiting-review-decision");
  assert.deepEqual(afterFix.labels.remove, [CROSS_LABEL]);
});

test("the merge gate reports the awaited decision", () => {
  const status = planGateStatus(
    deriveReadiness(readySnapshot({ labels: [] }), config),
    config,
  );
  assert.equal(status.state, "pending");
  assert.match(status.description, /^awaiting-review-decision: /);
  assert.ok(status.description.length <= GATE_DESCRIPTION_LIMIT);
});

// ---------------------------------------------------------------------------
// Binding an answer to one head
//
// The cases from the review of 5ebf032: without a "seen this head, nothing chosen" state, a label
// that predates the head is indistinguishable from a fresh answer, and the ambiguity resolved
// towards opening the gate.
// ---------------------------------------------------------------------------

test("a label the reconciler never saw at this head does not bind", () => {
  // The status comment was deleted, automation was paused across several pushes, or the bootstrap
  // run never wrote one. The label survives all of that; the binding must not.
  const snapshot = readySnapshot({ statusCommentBody: null });
  const readiness = deriveReadiness(snapshot, config);

  assert.equal(readiness.ready, false);
  assert.equal(readiness.phase, "awaiting-review-decision");
  assert.equal(readiness.details.reviewMode, null);
  assert.deepEqual(readiness.blockers, [
    "A review-mode label was set before this head was first seen and could not be bound to it; set it again.",
  ]);
  assert.deepEqual(planLabels(snapshot.labels, readiness, config).remove, [CROSS_LABEL]);
});

test("a self-review cannot open the gate for a head nobody was asked about", () => {
  // The published result is head-bound and genuine, so only the missing question separates this
  // from a legitimate pass. That is exactly the acceptance criterion.
  const readiness = deriveReadiness(
    readySnapshot({
      statusCommentBody: null,
      labels: [SELF_LABEL],
      reviews: [],
      reviewResults: parseReviewResults([selfResultComment(HEAD)]),
    }),
    config,
  );
  assert.equal(readiness.ready, false);
  assert.equal(readiness.phase, "awaiting-review-decision");
});

test("the run that sees a new head records it even with nothing chosen", () => {
  const snapshot = readySnapshot({ labels: [], statusCommentBody: null });
  const plan = reconcile(snapshot, config);
  assert.deepEqual(parseReviewDecision(plan.comment.body), { headSha: HEAD, mode: "none" });
});

test("an answer given after the head was seen binds without another round", () => {
  // Sequence: run at the new head records `none` and clears the old label, the user answers, the
  // next run binds. Two runs, no manual repetition.
  const fresh = readySnapshot({ labels: [], statusCommentBody: null });
  const observing = reconcile(fresh, config);
  assert.equal(observing.readiness.phase, "awaiting-review-decision");

  const answered = deriveReadiness(
    { ...fresh, labels: [CROSS_LABEL], statusCommentBody: observing.comment.body },
    config,
  );
  assert.equal(answered.details.reviewMode, "cross");
  assert.equal(answered.ready, true);
  assert.deepEqual(answered.details.reviewDecision.staleLabels, []);
});

test("a fix commit invalidates the binding and the question returns", () => {
  const bound = readySnapshot();
  const afterFix = reconcile(
    { ...bound, headSha: OLD_HEAD, checkRunsHeadSha: OLD_HEAD },
    config,
  );
  assert.equal(afterFix.readiness.phase, "awaiting-review-decision");
  assert.deepEqual(afterFix.labels.remove, [CROSS_LABEL]);
  assert.match(afterFix.readiness.blockers[0], /chosen for an earlier head SHA/);
  // And the run records the new head, so the next answer binds to it.
  assert.deepEqual(parseReviewDecision(afterFix.comment.body), {
    headSha: OLD_HEAD,
    mode: "none",
  });
});

test("two labels are never resolved by removing one", () => {
  const snapshot = readySnapshot({ labels: [CROSS_LABEL, SELF_LABEL] });
  const readiness = deriveReadiness(snapshot, config);
  assert.deepEqual(planLabels(snapshot.labels, readiness, config).remove, []);
  assert.match(readiness.blockers[0], /More than one review-mode label/);
});

test("only the implementation provider may publish a self-review result", () => {
  // Any app installed on the repository posts as some `[bot]`; that is not the same as being the
  // provider that ran the review.
  const foreign = deriveReadiness(
    readySnapshot({
      labels: [SELF_LABEL],
      reviews: [],
      reviewResults: parseReviewResults([
        { ...selfResultComment(HEAD), author: "dependabot[bot]", authorAssociation: "NONE" },
      ]),
    }),
    config,
  );
  assert.equal(foreign.ready, false);
  assert.match(foreign.blockers[0], /No self-review result/);

  const own = deriveReadiness(
    readySnapshot({
      labels: [SELF_LABEL],
      reviews: [],
      reviewResults: parseReviewResults([
        { ...selfResultComment(HEAD), author: "claude[bot]", authorAssociation: "NONE" },
      ]),
    }),
    config,
  );
  assert.equal(own.ready, true);
});

test("an unusable self-review waits on a review, not on the implementer", () => {
  for (const overrides of [{ "read-only": "false" }, { verdict: "blocked" }]) {
    const readiness = deriveReadiness(
      readySnapshot({
        labels: [SELF_LABEL],
        reviews: [],
        reviewResults: parseReviewResults([selfResultComment(HEAD, overrides)]),
      }),
      config,
    );
    // Only a new, properly enforced session can clear either one.
    assert.equal(readiness.phase, "review", JSON.stringify(overrides));
    assert.equal(readiness.ready, false);
  }

  // Changes requested is different: that one is the implementer's turn.
  const changes = deriveReadiness(
    readySnapshot({
      labels: [SELF_LABEL],
      reviews: [],
      reviewResults: parseReviewResults([
        selfResultComment(HEAD, { verdict: "changes-required" }),
      ]),
    }),
    config,
  );
  assert.equal(changes.phase, "implementing");
});

// ---------------------------------------------------------------------------
// From the review of 07f515b
// ---------------------------------------------------------------------------

test("two labels do not record the head they were not cleared at", () => {
  // Recording a head asserts "any label standing now arrived after me". With two untouched labels
  // that is false, and the survivor of a later removal would bind to a head nobody chose it for.
  const ambiguousAtNewHead = evaluateReviewDecision(
    {
      headSha: HEAD,
      labels: [CROSS_LABEL, SELF_LABEL],
      statusCommentBody: decisionRecord(OLD_HEAD, "none"),
      statusCommentAuthor: config.statusCommentAuthors[0],
    },
    config,
  );
  assert.equal(ambiguousAtNewHead.ambiguous, true);
  assert.deepEqual(ambiguousAtNewHead.record, { headSha: OLD_HEAD, mode: "none" });

  // So once the user removes one, the survivor is still recognised as predating this head.
  const survivor = evaluateReviewDecision(
    {
      headSha: HEAD,
      labels: [CROSS_LABEL],
      statusCommentBody: decisionRecord(OLD_HEAD, "none"),
      statusCommentAuthor: config.statusCommentAuthors[0],
    },
    config,
  );
  assert.equal(survivor.mode, null);
  assert.deepEqual(survivor.staleLabels, [CROSS_LABEL]);
});

test("a broken task contract does not cost the user their answer", () => {
  const bound = readySnapshot();
  assert.equal(deriveReadiness(bound, config).details.reviewMode, "cross");

  // Same head, same code, only a field in the pull-request body is temporarily wrong.
  const broken = reconcile(
    { ...bound, body: contractBody({ scope: "not-a-scope" }) },
    config,
  );
  assert.equal(broken.readiness.phase, "contract-invalid");
  assert.deepEqual(broken.labels.remove, [], "a contract error must not consume the choice");
  assert.deepEqual(parseReviewDecision(broken.comment.body), { headSha: HEAD, mode: "cross" });

  // And after the body is repaired the binding is still there.
  const repaired = reconcile(
    { ...bound, statusCommentBody: broken.comment.body },
    config,
  );
  assert.equal(repaired.readiness.details.reviewMode, "cross");
  assert.deepEqual(repaired.labels.remove, []);
});

test("the decision record counts only from an identity that runs this pipeline", () => {
  // The snapshot adopts a status comment from any trusted author, which includes every installed
  // app. That is wide enough to update a comment, too wide to decide whether an answer binds.
  const decoy = deriveReadiness(
    readySnapshot({ statusCommentAuthor: "dependabot[bot]" }),
    config,
  );
  assert.equal(decoy.details.reviewMode, null);
  assert.deepEqual(decoy.details.reviewDecision.staleLabels, [CROSS_LABEL]);

  assert.equal(statusCommentBody(readySnapshot(), config), decisionRecord(HEAD, "cross"));
  assert.equal(
    statusCommentBody(readySnapshot({ statusCommentAuthor: "someone[bot]" }), config),
    null,
  );
});

test("the review-stall clock ignores the pipeline's own checks", () => {
  const base = {
    observedAt: "2026-08-09T12:00:00Z",
    checkRuns: [
      { name: "Core", status: "completed", conclusion: "success", completedAt: "2026-08-08T06:00:00Z" },
      // Own checks re-run on every sweep; if they counted, a stalled review would never age.
      {
        name: config.selfCheckNames[0],
        status: "completed",
        conclusion: "success",
        completedAt: "2026-08-09T11:59:00Z",
      },
    ],
  };
  assert.equal(reviewWaitingHours(base, config), 30);

  // Without an anchor the age is unknown, and unknown must never escalate.
  assert.equal(reviewWaitingHours({ ...base, checkRuns: [] }, config), null);
  assert.equal(
    reviewWaitingHours({ ...base, checkRuns: [{ name: "Core", completedAt: null }] }, config),
    null,
  );
  assert.equal(reviewWaitingHours({ ...base, observedAt: undefined }, config), null);
  // A check completing after the snapshot was read is clock skew, not negative waiting time.
  assert.equal(
    reviewWaitingHours(
      { ...base, checkRuns: [{ name: "Core", completedAt: "2026-08-09T13:00:00Z" }] },
      config,
    ),
    0,
  );

  assert.equal(waitingEscalationHours(config), config.waitingEscalationHours);
  for (const broken of [{}, { waitingEscalationHours: 0 }, { waitingEscalationHours: "soon" }]) {
    assert.equal(waitingEscalationHours(broken), DEFAULT_WAITING_ESCALATION_HOURS);
  }
});

test("a chosen review that never lands is escalated instead of waiting forever", () => {
  const anchor = "2026-08-08T06:00:00Z";
  const checkRuns = [
    { name: "Core", status: "completed", conclusion: "success", completedAt: anchor },
  ];
  // Cross-review chosen, nothing published for this head: exactly the silent stall.
  const stalled = deriveReadiness(
    readySnapshot({
      observedAt: "2026-08-09T12:00:00Z",
      checkRuns,
      reviews: [],
      reviewThreads: [],
    }),
    config,
  );
  assert.equal(stalled.phase, "review");
  assert.equal(stalled.details.reviewStalled, true);
  assert.equal(Math.floor(stalled.details.reviewWaitingHours), 30);
  assert.equal(
    stalled.blockers.some((blocker) => /produced no result for 30 hours/.test(blocker)),
    true,
  );
  assert.match(renderStatusComment(stalled, readySnapshot(), config), /- Review overdue: `30h`/);

  // Below the threshold the pull request is simply still waiting, and says nothing extra.
  const fresh = deriveReadiness(
    readySnapshot({
      observedAt: "2026-08-08T07:00:00Z",
      checkRuns,
      reviews: [],
      reviewThreads: [],
    }),
    config,
  );
  assert.equal(fresh.details.reviewStalled, false);
  assert.doesNotMatch(renderStatusComment(fresh, readySnapshot(), config), /Review overdue/);

  // With the verdict in, nobody is waiting — an overdue note would contradict the result.
  const answered = deriveReadiness(
    readySnapshot({ observedAt: "2026-08-09T12:00:00Z", checkRuns }),
    config,
  );
  assert.equal(answered.details.reviewStalled, false);

  // The escalation is a blocker and a status line only; the review-mode labels stay the user's.
  const plan = planLabels(readySnapshot().labels, stalled, config);
  assert.equal(plan.add.includes(config.labels.waiting), false);
  assert.equal(plan.remove.includes(CROSS_LABEL), false);
});
