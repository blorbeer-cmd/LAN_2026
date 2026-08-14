import assert from "node:assert/strict";
import { test } from "node:test";

import { loadConfig } from "./agent-pipeline.mjs";
import {
  acknowledge,
  CODEX_DELIVERY_MARKER,
  collectCodexDeliveryEvents,
  collectMainWorkflowFailureEvent,
  resolveCodexTaskTarget,
  scan,
  unresolvedMainWorkflowFailures,
} from "./agent-pipeline-codex-adapter.mjs";

const config = loadConfig();
const HEAD = "a".repeat(40);
const THREAD = "019ff043-2b15-7923-bd6d-dfaac7d41c81";

function body(overrides = {}) {
  const values = {
    "task-id": "agent-20260811-adapter",
    "codex-thread-id": THREAD,
    implementer: "codex",
    "base-branch": "main",
    "base-sha": "b".repeat(40),
    "head-branch": "codex/adapter",
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

function pull(overrides = {}) {
  return {
    repository: "blorbeer-cmd/LAN_2026",
    headRepository: "blorbeer-cmd/LAN_2026",
    number: 401,
    url: "https://github.com/blorbeer-cmd/LAN_2026/pull/401",
    state: "open",
    body: body(),
    labels: [{ name: "agent:pipeline" }],
    authorLogin: "blorbeer-cmd",
    baseBranch: "main",
    headBranch: "codex/adapter",
    headSha: HEAD,
    changedFiles: ["scripts/agent-pipeline-codex-adapter.mjs"],
    ...overrides,
  };
}

test("an undecided current-head choice is delivered with the explicit task id", () => {
  const comments = [
    {
      id: 1,
      author: "github-actions[bot]",
      body: `## Choose who reviews this head\n\n<!-- agent-pipeline:codex-event type=review-choice-required id=review-choice-${HEAD} -->\n<!-- agent-pipeline:review-decision-notification ${HEAD} -->`,
    },
  ];
  const events = collectCodexDeliveryEvents(pull(), comments, [], config);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "review-choice-required");
  assert.equal(events[0].codexThreadId, THREAD);
  assert.equal(events[0].implementer, "codex");
  assert.match(events[0].message, /official, SHA-bound review choice/);
});

test("Codex routing prefers an explicit task id and otherwise requires one unique branch match", () => {
  const explicit = resolveCodexTaskTarget(
    { implementer: "codex", codexThreadId: THREAD, headBranch: "codex/adapter" },
    [],
  );
  assert.deepEqual(explicit, { kind: "thread-id", threadId: THREAD });

  const fallback = resolveCodexTaskTarget(
    { implementer: "codex", codexThreadId: null, headBranch: "codex/adapter" },
    [{ id: THREAD, checkedOutBranch: "codex/adapter" }],
  );
  assert.deepEqual(fallback, { kind: "branch", threadId: THREAD });

  assert.equal(
    resolveCodexTaskTarget(
      { implementer: "codex", codexThreadId: null, headBranch: "codex/adapter" },
      [],
    ).kind,
    "unresolved",
  );
  assert.equal(
    resolveCodexTaskTarget(
      { implementer: "codex", codexThreadId: null, headBranch: "codex/adapter" },
      [
        { id: THREAD, checkedOutBranch: "codex/adapter" },
        { id: "019ff043-2b15-7923-bd6d-dfaac7d41c82", checkedOutBranch: "codex/adapter" },
      ],
    ).kind,
    "ambiguous",
  );
});

test("Claude implementations have no Codex target or Codex delivery event", () => {
  const claude = pull({
    body: body({ implementer: "claude", "head-branch": "claude/adapter" }),
    headBranch: "claude/adapter",
  });
  const event = {
    id: 1,
    author: "github-actions[bot]",
    body: `Choice\n<!-- agent-pipeline:review-decision-notification ${HEAD} -->`,
  };
  assert.equal(resolveCodexTaskTarget({ implementer: "claude", headBranch: "claude/adapter" }).kind, "unsupported-provider");
  assert.deepEqual(collectCodexDeliveryEvents(claude, [event], [], config), []);
});

test("a choice is suppressed after a label or a trusted delivery acknowledgement", () => {
  const choice = {
    id: 1,
    author: "github-actions[bot]",
    body: `Choice\n<!-- agent-pipeline:review-decision-notification ${HEAD} -->`,
  };
  assert.deepEqual(
    collectCodexDeliveryEvents(
      pull({ labels: [{ name: "agent:pipeline" }, { name: "review:cross" }] }),
      [choice],
      [],
      config,
    ),
    [],
  );
  assert.deepEqual(
    collectCodexDeliveryEvents(
      pull(),
      [
        choice,
        {
          id: 2,
          author: "blorbeer-cmd",
          body: `${CODEX_DELIVERY_MARKER} review-choice-${HEAD} thread=${THREAD} -->`,
        },
      ],
      [],
      config,
    ),
    [],
  );
});

test("an acknowledged choice does not starve a later provider-start failure", () => {
  const comments = [
    {
      id: 20,
      author: "github-actions[bot]",
      createdAt: "2026-08-11T09:00:00Z",
      body: `Choice\n<!-- agent-pipeline:review-decision-notification ${HEAD} -->`,
    },
    {
      id: 21,
      author: "blorbeer-cmd",
      createdAt: "2026-08-11T09:01:00Z",
      body: `${CODEX_DELIVERY_MARKER} review-choice-${HEAD} thread=${THREAD} -->`,
    },
    {
      id: 22,
      author: "github-actions[bot]",
      createdAt: "2026-08-11T09:02:00Z",
      body: `Review failed.\n<!-- agent-pipeline:review-start-notice ${HEAD} mode=cross outcome=failed code=provider attempt=run-22 -->`,
    },
  ];

  const events = collectCodexDeliveryEvents(pull(), comments, [], config);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "review-start-failed");
  assert.equal(events[0].eventId, `review-start-failed-${HEAD}-run-22`);
});

test("delivery events require the centrally validated task contract", () => {
  const choice = {
    id: 23,
    author: "github-actions[bot]",
    body: `Choice\n<!-- agent-pipeline:review-decision-notification ${HEAD} -->`,
  };

  assert.deepEqual(
    collectCodexDeliveryEvents(pull({ authorLogin: "drive-by" }), [choice], [], config),
    [],
  );
  assert.deepEqual(
    collectCodexDeliveryEvents(
      pull({ body: body({ "codex-thread-id": "not-a-uuid" }) }),
      [choice],
      [],
      config,
    ),
    [],
  );
  assert.deepEqual(
    collectCodexDeliveryEvents(pull({ headBranch: "claude/wrong-provider" }), [choice], [], config),
    [],
  );
});

test("a trusted Claude result wakes the Codex implementation task exactly once", () => {
  const session = "claude-action-123-1";
  const result = {
    id: 3,
    author: "github-actions[bot]",
    body: `## Claude Cross-Review\n\n#### [high] Finding\n\n<!-- agent-pipeline:review-result ${HEAD} mode=cross verdict=changes-required session=${session} read-only=true -->`,
  };
  const first = collectCodexDeliveryEvents(
    pull({ labels: [{ name: "agent:pipeline" }, { name: "review:cross" }] }),
    [result],
    [],
    config,
  );
  assert.equal(first.length, 1);
  assert.equal(first[0].type, "review-completed");
  assert.equal(first[0].verdict, "changes-required");
  assert.match(first[0].message, /implement all justified fixes automatically/);

  const acknowledged = {
    id: 4,
    author: "blorbeer-cmd",
    body: `${CODEX_DELIVERY_MARKER} ${first[0].eventId} thread=${THREAD} -->`,
  };
  assert.deepEqual(
    collectCodexDeliveryEvents(
      pull({ labels: [{ name: "agent:pipeline" }, { name: "review:cross" }] }),
      [result, acknowledged],
      [],
      config,
    ),
    [],
  );
});

test("untrusted result markers and stale heads never wake a task", () => {
  const marker = `<!-- agent-pipeline:review-result ${HEAD} mode=cross verdict=pass session=fake read-only=true -->`;
  assert.deepEqual(
    collectCodexDeliveryEvents(
      pull({ labels: [{ name: "agent:pipeline" }, { name: "review:cross" }] }),
      [{ id: 5, author: "drive-by", body: `## Claude Cross-Review\n${marker}` }],
      [],
      config,
    ),
    [],
  );
  assert.deepEqual(
    collectCodexDeliveryEvents(
      pull({ labels: [{ name: "agent:pipeline" }, { name: "review:cross" }] }),
      [
        {
          id: 6,
          author: "github-actions[bot]",
          body: `## Claude Cross-Review\n${marker.replace(HEAD, "c".repeat(40))}`,
        },
      ],
      [],
      config,
    ),
    [],
  );
});

test("a trusted provider-start failure is delivered and never changes the review mode", () => {
  const comments = [
    {
      id: 7,
      author: "github-actions[bot]",
      body: `Review failed.\n<!-- agent-pipeline:review-start-notice ${HEAD} mode=cross outcome=failed code=provider attempt=run-7 -->`,
    },
  ];
  const events = collectCodexDeliveryEvents(
    pull({ labels: [{ name: "agent:pipeline" }, { name: "review:cross" }] }),
    comments,
    [],
    config,
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "review-start-failed");
  assert.match(events[0].message, /Never switch providers or modes silently/);
});

test("a running review check actively confirms that the selected review started", () => {
  const selected = pull({
    labels: [{ name: "agent:pipeline" }, { name: "review:cross" }],
  });
  const checkRuns = [
    {
      id: 7001,
      name: "Run Claude cross-review",
      status: "in_progress",
      conclusion: null,
      url: "https://github.com/blorbeer-cmd/LAN_2026/actions/runs/7001",
      startedAt: "2026-08-13T09:00:00Z",
    },
  ];
  const events = collectCodexDeliveryEvents(selected, [], [], config, checkRuns);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "review-started");
  assert.equal(events[0].reviewerProvider, "claude");
  assert.match(events[0].message, /Inform the user now/);
  assert.match(events[0].message, /Do not describe it as completed yet/);
});

test("review checks do not claim a start without the matching choice or after failure", () => {
  const running = {
    id: 7002,
    name: "Run Claude cross-review",
    status: "in_progress",
    conclusion: null,
    startedAt: "2026-08-13T09:00:00Z",
  };
  assert.deepEqual(
    collectCodexDeliveryEvents(pull(), [], [], config, [running]),
    [],
  );
  assert.deepEqual(
    collectCodexDeliveryEvents(
      pull({ labels: [{ name: "agent:pipeline" }, { name: "review:cross" }] }),
      [],
      [],
      config,
      [{ ...running, status: "completed", conclusion: "failure" }],
    ),
    [],
  );
});

test("failing PR checks wake the implementation task for an automatic CI fix", () => {
  const checkRuns = [
    {
      id: 7101,
      name: "Server lint, build and tests",
      status: "completed",
      conclusion: "failure",
      url: "https://github.com/blorbeer-cmd/LAN_2026/actions/runs/7101",
      completedAt: "2026-08-13T09:05:00Z",
    },
    {
      id: 7102,
      name: "Reconcile pull request",
      status: "completed",
      conclusion: "cancelled",
      completedAt: "2026-08-13T09:06:00Z",
    },
  ];
  const events = collectCodexDeliveryEvents(pull(), [], [], config, checkRuns);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "ci-failed");
  assert.deepEqual(events[0].failedChecks, [
    {
      name: "Server lint, build and tests",
      conclusion: "failure",
      url: "https://github.com/blorbeer-cmd/LAN_2026/actions/runs/7101",
    },
  ]);
  assert.match(events[0].message, /continue automatically/);
  assert.equal(events[0].maxCiFixRounds, 3);
  assert.match(events[0].message, /contracted limit of 3 CI-fix rounds/);

  const tighter = collectCodexDeliveryEvents(
    pull({ body: body({ "max-ci-fix-rounds": "1" }) }),
    [],
    [],
    config,
    checkRuns,
  );
  assert.equal(tighter[0].maxCiFixRounds, 1);
  assert.match(tighter[0].message, /contracted limit of 1 CI-fix rounds/);
});

test("CI delivery is independent from the newest review lifecycle event", () => {
  const selected = pull({
    labels: [{ name: "agent:pipeline" }, { name: "review:cross" }],
  });
  const checkRuns = [
    {
      id: 7201,
      name: "Run Claude cross-review",
      status: "in_progress",
      conclusion: null,
      startedAt: "2026-08-13T09:00:00Z",
    },
    {
      id: 7202,
      name: "Browser E2E Core",
      status: "completed",
      conclusion: "failure",
      completedAt: "2026-08-13T09:01:00Z",
    },
  ];
  const first = collectCodexDeliveryEvents(selected, [], [], config, checkRuns);
  assert.deepEqual(first.map((event) => event.type), ["ci-failed", "review-started"]);

  const comments = [
    {
      author: "blorbeer-cmd",
      body: `${CODEX_DELIVERY_MARKER} ci-failed-${HEAD}-7202 thread=${THREAD} -->`,
    },
  ];
  const second = collectCodexDeliveryEvents(selected, comments, [], config, checkRuns);
  assert.deepEqual(second.map((event) => event.type), ["review-started"]);
});

test("a failed rerun on the same head creates a new tracked CI event", () => {
  const firstRun = {
    id: 7251,
    name: "Browser E2E Core",
    status: "completed",
    conclusion: "failure",
    completedAt: "2026-08-13T09:00:00Z",
  };
  const first = collectCodexDeliveryEvents(pull(), [], [], config, [firstRun]);
  assert.equal(first[0].eventId, `ci-failed-${HEAD}-7251`);
  const comments = [
    {
      author: "blorbeer-cmd",
      body: `${CODEX_DELIVERY_MARKER} ${first[0].eventId} thread=${THREAD} -->`,
    },
  ];
  const rerun = {
    ...firstRun,
    id: 7252,
    completedAt: "2026-08-13T09:05:00Z",
  };
  const second = collectCodexDeliveryEvents(
    pull(),
    comments,
    [],
    config,
    [firstRun, rerun],
  );
  assert.equal(second[0].eventId, `ci-failed-${HEAD}-7252`);
});

test("a failed post-merge CI/CD run returns to the originating Codex task", () => {
  const merged = pull({ state: "closed", mergedAt: "2026-08-13T09:00:00Z" });
  const run = {
    id: 7301,
    attempt: 2,
    name: "CI/CD",
    event: "push",
    headBranch: "main",
    headSha: "d".repeat(40),
    conclusion: "failure",
    url: "https://github.com/blorbeer-cmd/LAN_2026/actions/runs/7301",
  };
  const jobs = [
    {
      name: "deploy",
      conclusion: "failure",
      url: `${run.url}/job/99`,
    },
    { name: "publish", conclusion: "success", url: `${run.url}/job/98` },
  ];
  const event = collectMainWorkflowFailureEvent(merged, [], run, jobs, config);
  assert.equal(event.type, "ci-cd-failed");
  assert.equal(event.eventId, "ci-cd-failed-7301-2");
  assert.equal(event.deploymentSha, "d".repeat(40));
  assert.deepEqual(event.failedJobs.map((job) => job.name), ["deploy"]);
  assert.match(event.message, /a merge is not proof that production was deployed/);
  assert.match(event.message, /never push to main or reuse its merged branch/);

  const acknowledged = {
    author: "blorbeer-cmd",
    body: `${CODEX_DELIVERY_MARKER} ${event.eventId} thread=${THREAD} -->`,
  };
  assert.equal(
    collectMainWorkflowFailureEvent(merged, [acknowledged], run, jobs, config),
    null,
  );
});

test("only unresolved main failures newer than the latest success are delivered", () => {
  const mainRun = (id, conclusion, completedAt, overrides = {}) => ({
    id,
    attempt: 1,
    event: "push",
    headBranch: "main",
    headSha: String(id).padStart(40, "0"),
    conclusion,
    completedAt,
    ...overrides,
  });
  const runs = [
    mainRun(4, "failure", "2026-08-13T10:04:00Z"),
    mainRun(3, "timed_out", "2026-08-13T10:03:00Z"),
    mainRun(2, "success", "2026-08-13T10:02:00Z"),
    mainRun(1, "failure", "2026-08-13T10:01:00Z"),
    mainRun(5, "failure", "2026-08-13T10:05:00Z", { headBranch: "feature" }),
  ];
  assert.deepEqual(
    unresolvedMainWorkflowFailures(runs, config).map((run) => run.id),
    [4, 3],
  );
  assert.deepEqual(
    unresolvedMainWorkflowFailures(
      [mainRun(6, "success", "2026-08-13T10:06:00Z"), ...runs],
      config,
    ),
    [],
  );
});

test("a completed review supersedes an older start failure for the same head", () => {
  const comments = [
    {
      id: 8,
      author: "github-actions[bot]",
      body: `Failed first.\n<!-- agent-pipeline:review-start-notice ${HEAD} mode=cross outcome=failed code=provider attempt=run-8 -->`,
    },
    {
      id: 9,
      author: "github-actions[bot]",
      body: `## Claude Cross-Review\n\n<!-- agent-pipeline:review-result ${HEAD} mode=cross verdict=pass session=run-9 read-only=true -->`,
    },
  ];
  const events = collectCodexDeliveryEvents(
    pull({ labels: [{ name: "agent:pipeline" }, { name: "review:cross" }] }),
    comments,
    [],
    config,
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "review-completed");
  assert.equal(events[0].verdict, "pass");
});

test("findings are never treated as a clean pass, while a clean Claude pass is delivered", () => {
  const finding = {
    id: 13,
    author: "github-actions[bot]",
    createdAt: "2026-08-11T09:01:00Z",
    body: `## Claude Cross-Review\n\n#### [high] SQL injection\n\n<!-- agent-pipeline:review-result ${HEAD} mode=cross verdict=changes-required session=claude-findings read-only=true -->`,
  };
  const cleanPass = {
    ...finding,
    id: 14,
    createdAt: "2026-08-11T09:02:00Z",
    body: `## Claude Cross-Review\n\n<!-- agent-pipeline:review-result ${HEAD} mode=cross verdict=pass session=claude-clean read-only=true -->`,
  };
  const selected = pull({ labels: [{ name: "agent:pipeline" }, { name: "review:cross" }] });
  const events = collectCodexDeliveryEvents(selected, [finding, cleanPass], [], config);
  assert.equal(events.length, 1);
  assert.equal(events[0].verdict, "pass");
  assert.equal(events[0].eventId, `review-completed-${HEAD}-claude-clean`);
});

test("the newest current-head review evidence wins and older evidence never leaks after ack", () => {
  const reviewer = config.providerReviewerAllowlist.codex[0];
  const selected = pull({ labels: [{ name: "agent:pipeline" }, { name: "review:cross" }] });
  const cleanPass = {
    id: 15,
    author: "github-actions[bot]",
    createdAt: "2026-08-11T09:02:00Z",
    body: `## Claude Cross-Review\n\n<!-- agent-pipeline:review-result ${HEAD} mode=cross verdict=pass session=claude-clean read-only=true -->`,
  };
  const olderFinding = {
    id: 16,
    author: "github-actions[bot]",
    createdAt: "2026-08-11T09:01:00Z",
    body: `## Claude Cross-Review\n\n<!-- agent-pipeline:review-result ${HEAD} mode=cross verdict=changes-required session=claude-old read-only=true -->`,
  };

  const newest = collectCodexDeliveryEvents(selected, [cleanPass], [olderFinding], config);
  assert.equal(newest.length, 1);
  assert.equal(newest[0].verdict, "pass");
  assert.equal(newest[0].eventId, `review-completed-${HEAD}-claude-clean`);

  const acknowledged = {
    id: 17,
    author: "blorbeer-cmd",
    createdAt: "2026-08-11T09:03:00Z",
    body: `${CODEX_DELIVERY_MARKER} ${newest[0].eventId} thread=${THREAD} -->`,
  };
  assert.deepEqual(
    collectCodexDeliveryEvents(selected, [cleanPass, acknowledged], [olderFinding], config),
    [],
  );

  const newerFinding = {
    ...olderFinding,
    id: 18,
    createdAt: "2026-08-11T09:04:00Z",
    body: `## Claude Cross-Review\n\n<!-- agent-pipeline:review-result ${HEAD} mode=cross verdict=changes-required session=claude-new read-only=true -->`,
  };
  const changed = collectCodexDeliveryEvents(selected, [cleanPass, newerFinding], [], config);
  assert.equal(changed.length, 1);
  assert.equal(changed[0].verdict, "changes-required");
  assert.equal(changed[0].eventId, `review-completed-${HEAD}-claude-new`);
});

test("a newer review choice supersedes an older start failure even after delivery", () => {
  const eventId = `review-choice-${HEAD}`;
  const comments = [
    {
      id: 10,
      author: "github-actions[bot]",
      createdAt: "2026-08-11T09:00:00Z",
      body: `Failed first.\n<!-- agent-pipeline:review-start-notice ${HEAD} mode=cross outcome=declined code=phase attempt=run-10 -->`,
    },
    {
      id: 11,
      author: "github-actions[bot]",
      createdAt: "2026-08-11T09:01:00Z",
      body: `Choice\n<!-- agent-pipeline:review-decision-notification ${HEAD} -->`,
    },
    {
      id: 12,
      author: "blorbeer-cmd",
      createdAt: "2026-08-11T09:02:00Z",
      body: `${CODEX_DELIVERY_MARKER} ${eventId} thread=${THREAD} -->`,
    },
  ];
  assert.deepEqual(collectCodexDeliveryEvents(pull(), comments, [], config), []);
});

// The scan wiring is exercised against a fake GitHub API that returns raw payload shapes, so the
// normalization, the safety caps, the paging boundary and the label filter stay covered without
// touching the network or the `gh` binary.
const REPOSITORY = "blorbeer-cmd/LAN_2026";
const MERGE_SHA = "d".repeat(40);

function rawPull(overrides = {}) {
  const { labels, ...rest } = overrides;
  return {
    number: 401,
    html_url: `https://github.com/${REPOSITORY}/pull/401`,
    state: "open",
    body: body(),
    labels: labels ?? [{ name: "agent:pipeline" }],
    user: { login: "blorbeer-cmd" },
    base: { ref: "main" },
    head: { ref: "codex/adapter", sha: HEAD, repo: { full_name: REPOSITORY } },
    merged_at: null,
    ...rest,
  };
}

function mainRunPayload(id, conclusion, overrides = {}) {
  return {
    id,
    run_attempt: 1,
    name: "CI/CD",
    event: "push",
    head_branch: "main",
    head_sha: MERGE_SHA,
    conclusion,
    html_url: `https://github.com/${REPOSITORY}/actions/runs/${id}`,
    updated_at: `2026-08-13T10:${String(id % 60).padStart(2, "0")}:00Z`,
    ...overrides,
  };
}

function fakeApi(overrides = {}) {
  const calls = { pullFiles: [], mainWorkflowRuns: [], postedComments: [] };
  const api = {
    calls,
    listOpenPulls: () => [rawPull()],
    listPullFiles: (pullNumber) => {
      calls.pullFiles.push(pullNumber);
      return [{ filename: "scripts/agent-pipeline-codex-adapter.mjs" }];
    },
    listIssueComments: () => [],
    listPullReviews: () => [],
    listCheckRuns: () => ({ total_count: 0, check_runs: [] }),
    listMainWorkflowRuns: (workflowFile, branch, page) => {
      calls.mainWorkflowRuns.push({ workflowFile, branch, page });
      return { workflow_runs: [mainRunPayload(9000, "success")] };
    },
    listWorkflowJobs: () => ({ total_count: 0, jobs: [] }),
    listCommitPulls: () => [],
    postIssueComment: (pullNumber, commentBody) => {
      calls.postedComments.push({ pullNumber, body: commentBody });
      return {};
    },
    ...overrides,
  };
  return api;
}

test("scan turns a failing head check on a pipeline pull request into a ci-failed event", () => {
  const api = fakeApi({
    listCheckRuns: (headSha) => {
      assert.equal(headSha, HEAD);
      return {
        total_count: 1,
        check_runs: [
          {
            id: 8101,
            name: "Server lint, build and tests",
            status: "completed",
            conclusion: "failure",
            html_url: `https://github.com/${REPOSITORY}/actions/runs/8101`,
            completed_at: "2026-08-13T09:05:00Z",
          },
        ],
      };
    },
  });
  const result = scan(REPOSITORY, config, api);
  assert.equal(result.repository, REPOSITORY);
  assert.deepEqual(
    result.events.map((event) => event.eventId),
    [`ci-failed-${HEAD}-8101`],
  );
  assert.equal(result.events[0].pullNumber, 401);
  assert.deepEqual(api.calls.mainWorkflowRuns, [
    { workflowFile: config.deploymentWorkflowFile, branch: "main", page: 1 },
  ]);
});

test("scan never hydrates a pull request without the pipeline label", () => {
  const api = fakeApi({
    listOpenPulls: () => [rawPull({ labels: [{ name: "ui:changed" }] })],
  });
  assert.deepEqual(scan(REPOSITORY, config, api).events, []);
  assert.deepEqual(api.calls.pullFiles, []);
});

test("scan maps an unresolved post-merge main failure back to its merged pull request once", () => {
  const failedRuns = Array.from({ length: 100 }, (_, index) =>
    mainRunPayload(9100 + index, "failure"),
  );
  const api = fakeApi({
    listOpenPulls: () => [],
    listMainWorkflowRuns: (workflowFile, branch, page) => {
      api.calls.mainWorkflowRuns.push({ workflowFile, branch, page });
      // A full page of failures must not hide the recovery boundary: paging continues until a
      // successful main run is visible.
      return {
        workflow_runs: page === 1 ? failedRuns : [mainRunPayload(9000, "success")],
      };
    },
    listCommitPulls: (headSha) => {
      assert.equal(headSha, MERGE_SHA);
      return [
        rawPull({ state: "closed", merged_at: "2026-08-13T09:00:00Z" }),
        rawPull({ number: 399, state: "closed", merged_at: "2026-08-12T09:00:00Z" }),
      ];
    },
    listWorkflowJobs: (runId) => ({
      total_count: 1,
      jobs: [
        {
          id: 42,
          name: "deploy",
          conclusion: "failure",
          html_url: `https://github.com/${REPOSITORY}/actions/runs/${runId}/job/42`,
        },
      ],
    }),
  });
  const result = scan(REPOSITORY, config, api);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].type, "ci-cd-failed");
  assert.equal(result.events[0].pullNumber, 401);
  assert.deepEqual(
    result.events[0].failedJobs.map((job) => job.name),
    ["deploy"],
  );
  assert.deepEqual(
    api.calls.mainWorkflowRuns.map((call) => call.page),
    [1, 2],
  );
});

test("main failures stay silent while no recovery boundary is visible", () => {
  const withoutSuccess = [
    { id: 3, attempt: 1, event: "push", headBranch: "main", conclusion: "failure", completedAt: "2026-08-13T10:03:00Z" },
    { id: 2, attempt: 1, event: "push", headBranch: "main", conclusion: "failure", completedAt: "2026-08-13T10:02:00Z" },
  ];
  assert.deepEqual(unresolvedMainWorkflowFailures(withoutSuccess, config), []);

  const api = fakeApi({
    listOpenPulls: () => [],
    listMainWorkflowRuns: () => ({
      workflow_runs: [mainRunPayload(9101, "failure"), mainRunPayload(9100, "failure")],
    }),
    listCommitPulls: () => {
      throw new Error("an unbounded history must not be resolved to pull requests");
    },
  });
  assert.deepEqual(scan(REPOSITORY, config, api).events, []);
});

test("acknowledging writes the delivery marker exactly once", () => {
  const api = fakeApi();
  const first = acknowledge(REPOSITORY, "401", `ci-failed-${HEAD}-8101`, THREAD, config, api);
  assert.equal(first.acknowledged, true);
  assert.equal(api.calls.postedComments.length, 1);
  assert.match(
    api.calls.postedComments[0].body,
    new RegExp(`${CODEX_DELIVERY_MARKER} ci-failed-${HEAD}-8101 thread=${THREAD} -->`),
  );

  const alreadyDelivered = fakeApi({
    listIssueComments: () => [
      {
        user: { login: "blorbeer-cmd" },
        body: `${CODEX_DELIVERY_MARKER} ci-failed-${HEAD}-8101 thread=${THREAD} -->`,
      },
    ],
  });
  const second = acknowledge(
    REPOSITORY,
    "401",
    `ci-failed-${HEAD}-8101`,
    THREAD,
    config,
    alreadyDelivered,
  );
  assert.deepEqual(second.reason, "already-delivered");
  assert.equal(alreadyDelivered.calls.postedComments.length, 0);
});

test("acknowledging rejects malformed identifiers before any GitHub write", () => {
  const api = fakeApi();
  assert.throws(() => acknowledge(REPOSITORY, "abc", "e", THREAD, config, api), /--pull/);
  assert.throws(() => acknowledge(REPOSITORY, "401", "bad id", THREAD, config, api), /--event-id/);
  assert.throws(() => acknowledge(REPOSITORY, "401", "e", "not-a-uuid", config, api), /--thread-id/);
  assert.deepEqual(api.calls.postedComments, []);
});
