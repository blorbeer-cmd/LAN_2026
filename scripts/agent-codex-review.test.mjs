import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  deriveCodexReviewDispatch,
  hasCodexReviewRequest,
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

test("the workflow requests Codex through the trusted default branch", () => {
  const workflowPath = fileURLToPath(
    new URL("../.github/workflows/agent-pipeline-codex-review.yml", import.meta.url),
  );
  const workflow = readFileSync(workflowPath, "utf8");
  assert.match(workflow, /pull_request_target:\s*\n\s+types: \[labeled\]/);
  assert.match(workflow, /issues: write/);
  assert.match(workflow, /pull-requests: read/);
  assert.match(workflow, /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /name: Request Codex cross-review/);
  assert.match(workflow, /node scripts\/agent-codex-review\.mjs request/);
  assert.doesNotMatch(workflow, /CLAUDE_CODE_OAUTH_TOKEN/);
});
