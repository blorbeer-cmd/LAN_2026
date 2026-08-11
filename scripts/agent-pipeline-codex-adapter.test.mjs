import assert from "node:assert/strict";
import { test } from "node:test";

import { loadConfig } from "./agent-pipeline.mjs";
import {
  CODEX_DELIVERY_MARKER,
  collectCodexDeliveryEvents,
  resolveCodexTaskTarget,
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
