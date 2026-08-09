import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  deriveCodexReviewDispatch,
  hasCodexReviewRequest,
  requestCommand,
  renderCodexReviewRequest,
} from "./agent-codex-review.mjs";

const HEAD = "a".repeat(40);
const OTHER_HEAD = "b".repeat(40);

test("dispatch starts only an outstanding Codex cross-review", () => {
  const readiness = {
    phase: "review",
    reviewerProvider: "codex",
    details: {
      reviewMode: "cross",
      reviews: { reviewedByProvider: false },
    },
  };
  assert.equal(deriveCodexReviewDispatch(readiness).shouldRun, true);

  for (const changed of [
    { phase: "implementing" },
    { reviewerProvider: "claude" },
    { details: { reviewMode: "self", reviews: { reviewedByProvider: false } } },
    { details: { reviewMode: "cross", reviews: { reviewedByProvider: true } } },
  ]) {
    assert.equal(
      deriveCodexReviewDispatch({ ...readiness, ...changed }).shouldRun,
      false,
    );
  }
});

test("the request is bound to the exact head and deduplicates trusted adapter comments", () => {
  const body = renderCodexReviewRequest(HEAD);
  assert.match(body, /^@codex review\n/);
  assert.match(body, new RegExp(`agent-pipeline:codex-review-request ${HEAD}`));
  assert.equal(
    hasCodexReviewRequest(
      [{ author: "github-actions[bot]", body }],
      HEAD,
    ),
    true,
  );
  assert.equal(
    hasCodexReviewRequest(
      [{ user: { login: "github-actions[bot]" }, body }],
      HEAD,
    ),
    true,
  );
  assert.equal(
    hasCodexReviewRequest(
      [{ author: "github-actions[bot]", body }],
      OTHER_HEAD,
    ),
    false,
  );
  assert.equal(
    hasCodexReviewRequest([{ author: "blorbeer-cmd", body }], HEAD),
    false,
  );
});

test("request rendering rejects non-full SHAs", () => {
  assert.throws(() => renderCodexReviewRequest("short"), /full lowercase SHA/);
});

test("repeated request dispatches post exactly once for the same head", async () => {
  const comments = [];
  const postedBodies = [];
  const previousToken = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = "test-token";

  const githubApiFn = async (path, { method = "GET", body } = {}) => {
    if (path.includes("/issues/381/comments?")) return comments;
    if (path.endsWith("/pulls/381")) return { head: { sha: HEAD } };
    if (path.endsWith("/issues/381/comments") && method === "POST") {
      postedBodies.push(body.body);
      const comment = {
        user: { login: "github-actions[bot]" },
        body: body.body,
        html_url: `https://github.test/comment/${postedBodies.length}`,
      };
      comments.push(comment);
      return comment;
    }
    throw new Error(`Unexpected GitHub API call: ${method} ${path}`);
  };
  const dependencies = {
    loadConfigFn: () => ({}),
    fetchSnapshotFn: async () => ({
      snapshot: {
        headSha: HEAD,
        headBranch: "claude/example",
        baseSha: OTHER_HEAD,
        baseBranch: "main",
      },
    }),
    deriveReadinessFn: () => ({
      phase: "review",
      reviewerProvider: "codex",
      contract: { implementer: "claude" },
      details: {
        reviewMode: "cross",
        reviews: { reviewedByProvider: false },
      },
    }),
    githubApiFn,
  };

  try {
    const args = ["--repository", "owner/repo", "--pr", "381"];
    await requestCommand(args, dependencies);
    await requestCommand(args, dependencies);
  } finally {
    if (previousToken === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = previousToken;
  }

  assert.equal(postedBodies.length, 1);
  assert.equal(hasCodexReviewRequest(comments, HEAD), true);
});

test("the workflow requests Codex through the trusted default branch", () => {
  const workflowPath = fileURLToPath(
    new URL("../.github/workflows/agent-pipeline-codex-review.yml", import.meta.url),
  );
  const workflow = readFileSync(workflowPath, "utf8");
  assert.match(workflow, /pull_request_target:\s*\n\s+types: \[labeled\]/);
  assert.match(workflow, /pull-requests: write/);
  assert.doesNotMatch(workflow, /issues: write/);
  assert.match(workflow, /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /name: Request Codex cross-review/);
  assert.match(workflow, /node scripts\/agent-codex-review\.mjs request/);
  assert.match(
    workflow,
    /group: agent-pipeline-codex-review-\$\{\{ github\.event\.pull_request\.number \|\| inputs\.pull_request \}\}/,
  );
  assert.match(workflow, /cancel-in-progress: false/);
  assert.doesNotMatch(workflow, /CLAUDE_CODE_OAUTH_TOKEN/);
});
