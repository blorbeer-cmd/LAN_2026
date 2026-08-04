import assert from "node:assert/strict";
import { test } from "node:test";

import { loadConfig } from "./agent-pipeline.mjs";
import {
  deriveReadiness,
  evaluateChecks,
  evaluateReviews,
  isOwnCheckRun,
  parseUiNoticeHeadSha,
  planLabels,
  reconcile,
  renderStatusComment,
  reviewerProviderFor,
  STATUS_COMMENT_MARKER,
  UI_NOTICE_MARKER,
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
    labels: [],
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
  assert.match(readiness.blockers.join("\n"), /No codex review has approved/);
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

test("protected path changes require an explicit human approval", () => {
  const withBotOnly = deriveReadiness(
    readySnapshot({
      body: contractBody({ scope: "infra" }),
      changedFiles: [".github/workflows/agent-pipeline-reconcile.yml"],
    }),
    config,
  );
  assert.equal(withBotOnly.ready, false);
  assert.match(withBotOnly.blockers.join("\n"), /explicit human approval/);
  // No agent can clear this, so it must escalate visibly instead of parking under "review".
  assert.equal(withBotOnly.phase, "needs-human");
  assert.deepEqual(planLabels([], withBotOnly, config).add, [
    config.labels.pipeline,
    config.labels.needsHuman,
  ]);

  const withHuman = deriveReadiness(
    readySnapshot({
      changedFiles: [".github/workflows/agent-pipeline-reconcile.yml"],
      reviews: [
        {
          author: CODEX_REVIEWER,
          state: "APPROVED",
          commitSha: HEAD,
          submittedAt: "2026-08-04T10:00:00Z",
        },
        {
          author: "blorbeer-cmd",
          state: "APPROVED",
          commitSha: HEAD,
          submittedAt: "2026-08-04T11:00:00Z",
        },
      ],
    }),
    config,
  );
  assert.equal(withHuman.ready, true);
  // The escalation label must come off again once the human approved that exact head.
  assert.deepEqual(
    planLabels([config.labels.pipeline, config.labels.needsHuman], withHuman, config)
      .remove,
    [config.labels.needsHuman],
  );
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

test("the escalation label is derived, not read back as its own cause", () => {
  // A stale agent:needs-human on an otherwise green pull request must not keep it stopped, or the
  // phase would depend on its own previous value and could never recover.
  const readiness = deriveReadiness(
    readySnapshot({ labels: [config.labels.needsHuman] }),
    config,
  );
  assert.equal(readiness.phase, "ready-for-merge");
  assert.equal(readiness.ready, true);

  const plan = planLabels([config.labels.needsHuman], readiness, config);
  assert.ok(plan.remove.includes(config.labels.needsHuman));
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
  };
  const second = reconcile(applied, config);
  assert.deepEqual(second.labels, { add: [], remove: [] });
  assert.equal(second.comment, null);

  // And a third delivery stays just as quiet.
  const third = reconcile(applied, config);
  assert.deepEqual(third.labels, { add: [], remove: [] });
  assert.equal(third.comment, null);
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

test("a UI notice written with the exported marker is parsed back", () => {
  // Guards the marker and the parser against drifting apart: a notice that cannot be read back
  // would block every UI pull request forever.
  const notice = `${UI_NOTICE_MARKER} ${HEAD} -->\n\nPlease check the home view.`;
  assert.equal(parseUiNoticeHeadSha([{ body: notice }]), HEAD);

  const readiness = deriveReadiness(
    {
      ...readySnapshot({
        body: contractBody({ scope: "frontend", "ui-change": "yes" }),
        changedFiles: ["server/public/js/views/home.js"],
      }),
      uiNoticeHeadSha: parseUiNoticeHeadSha([{ body: notice }]),
    },
    config,
  );
  assert.equal(readiness.ready, true);
});

test("UI notice parsing ignores malformed markers and prefers the newest", () => {
  assert.equal(parseUiNoticeHeadSha([]), null);
  assert.equal(parseUiNoticeHeadSha([{ body: "no marker here" }]), null);
  assert.equal(
    parseUiNoticeHeadSha([{ body: `${UI_NOTICE_MARKER} not-a-sha -->` }]),
    null,
  );
  assert.equal(
    parseUiNoticeHeadSha([
      { body: `${UI_NOTICE_MARKER} ${OLD_HEAD} -->` },
      { body: `${UI_NOTICE_MARKER} ${HEAD} -->` },
    ]),
    HEAD,
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
