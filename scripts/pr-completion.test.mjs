import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  assertOwned,
  carryAuthorization,
  mergeBlockers,
  parseReview,
  readRequiredChecks,
  reviewMarker,
} from "./pr-completion.mjs";

const head = "a".repeat(40);
const base = "b".repeat(40);
const other = "c".repeat(40);
function fixture() {
  const pr = {
    number: 123,
    state: "OPEN",
    headRefName: "codex/example",
    headRefOid: head,
    baseRefName: "main",
    baseRefOid: base,
    isCrossRepository: false,
    isDraft: false,
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    reviewDecision: "",
  };
  const grant = {
    head,
    branch: pr.headRefName,
    pr: 123,
    reviewerLogin: "reviewer",
    updates: [],
  };
  const review = {
    id: 1,
    state: "COMMENTED",
    body: `${reviewMarker(head, base, "pass")}\nFull review without findings.`,
    submitted_at: "2026-09-09T10:00:00Z",
    commit_id: head,
    user: { login: "reviewer" },
  };
  return {
    grant,
    snapshot: {
      pr,
      reviews: [review],
      threads: [],
      requiredChecks: ["Unit", "E2E"],
      checks: [
        { name: "Unit", bucket: "pass" },
        { name: "E2E", bucket: "skipping" },
      ],
    },
  };
}

test("only a current, authorized, fully reviewed and green PR can merge", () => {
  const { grant, snapshot } = fixture();
  assert.deepEqual(mergeBlockers(snapshot, grant), []);
  const mutations = [
    (s) => {
      s.pr.state = "CLOSED";
    },
    (s) => {
      s.pr.isDraft = true;
    },
    (s) => {
      s.pr.isCrossRepository = true;
    },
    (s) => {
      s.pr.baseRefName = "release";
    },
    (s) => {
      s.pr.mergeStateStatus = "BEHIND";
    },
    (s) => {
      s.pr.mergeStateStatus = "UNKNOWN";
    },
    (s) => {
      s.pr.mergeable = "CONFLICTING";
    },
    (s) => {
      s.pr.reviewDecision = "REVIEW_REQUIRED";
    },
    (s) => {
      s.pr.headRefOid = other;
    },
    (s) => {
      s.pr.baseRefOid = other;
    },
    (s) => {
      s.checks[0].bucket = "pending";
    },
    (s) => {
      s.checks[0].bucket = "fail";
    },
    (s) => {
      s.checks.pop();
    },
    (s) => {
      s.requiredChecks = [];
    },
    (s) => {
      s.threads.push({ isResolved: false });
    },
    (s) => {
      s.reviews[0].user.login = "stranger";
    },
    (s) => {
      s.reviews[0].state = "DISMISSED";
    },
    (s) => {
      s.reviews[0].state = "CHANGES_REQUESTED";
    },
    (s) => {
      s.reviews[0].commit_id = other;
    },
    (s) => {
      s.reviews[0].body = "Looks good";
    },
    (s) => {
      s.reviews[0].body = `${reviewMarker(head, base, "incomplete")}\nUnable to complete review`;
    },
  ];
  for (const mutate of mutations) {
    const copy = structuredClone(snapshot);
    mutate(copy);
    assert.ok(mergeBlockers(copy, grant).length, mutate.toString());
  }
  assert.ok(mergeBlockers(snapshot, null).length);
  assert.ok(mergeBlockers(snapshot, { ...grant, pr: 124 }).length);
  assert.ok(
    mergeBlockers(snapshot, { ...grant, branch: "codex/other" }).length,
  );
});

test("a newer incomplete review supersedes a pass and another reviewer can block", () => {
  const { grant, snapshot } = fixture();
  const incomplete = {
    ...snapshot.reviews[0],
    id: 2,
    body: `${reviewMarker(head, base, "incomplete")}\nNot finished`,
  };
  snapshot.reviews.unshift(incomplete);
  assert.ok(mergeBlockers(snapshot, grant).length);
  incomplete.user = { login: "second-reviewer" };
  assert.ok(mergeBlockers(snapshot, grant).length);
  snapshot.reviews.push({
    ...incomplete,
    id: 3,
    body: `${reviewMarker(head, base, "pass")}\nCompleted follow-up`,
  });
  assert.deepEqual(mergeBlockers(snapshot, grant), []);
});

test("quoted or embedded markers cannot masquerade as a native full review", () => {
  const { snapshot } = fixture();
  for (const body of ["Example:\n", "```\n", "> "]) {
    assert.equal(
      parseReview(
        { ...snapshot.reviews[0], body: body + snapshot.reviews[0].body },
        snapshot.pr,
      ),
      null,
    );
  }
});

test("newer unstructured reviews and empty pass markers fail closed", () => {
  const { grant, snapshot } = fixture();
  snapshot.reviews.push({
    ...snapshot.reviews[0],
    id: 2,
    body: "New finding requires investigation",
  });
  assert.ok(mergeBlockers(snapshot, grant).length);
  snapshot.reviews[1].body = `${reviewMarker(head, base, "pass")}\n`;
  assert.ok(mergeBlockers(snapshot, grant).length);
});

test("inline-only comment reviews preserve a pass while unresolved threads still block", () => {
  const { grant, snapshot } = fixture();
  for (const login of ["reviewer", "another-user"]) {
    snapshot.reviews.push({
      ...snapshot.reviews[0],
      id: snapshot.reviews.length + 1,
      user: { login },
      body: "",
    });
  }
  assert.deepEqual(mergeBlockers(snapshot, grant), []);
  snapshot.threads.push({ isResolved: false });
  assert.deepEqual(mergeBlockers(snapshot, grant), [
    "Unresolved review threads",
  ]);
  snapshot.threads[0].isResolved = true;
  snapshot.reviews.shift();
  assert.ok(
    mergeBlockers(snapshot, grant).includes(
      "Complete current-head/base review by the chosen reviewer is missing",
    ),
  );
});

test("the checks command distinguishes unregistered checks from failures", () => {
  const noChecks = {
    status: 1,
    stdout: "",
    stderr: "no checks reported on the 'feature' branch\n",
  };
  const checks = readRequiredChecks("owner/repo", 123, () => noChecks);
  assert.deepEqual(checks, []);
  const { grant, snapshot } = fixture();
  snapshot.checks = checks;
  assert.deepEqual(mergeBlockers(snapshot, grant), [
    "Required check not successful: Unit",
    "Required check not successful: E2E",
  ]);
  for (const [status, bucket] of [
    [0, "pass"],
    [1, "fail"],
    [8, "pending"],
  ]) {
    const expected = [{ name: "Unit", bucket }];
    assert.deepEqual(
      readRequiredChecks("owner/repo", 123, () => ({
        status,
        stdout: JSON.stringify(expected),
        stderr: "",
      })),
      expected,
    );
  }
  for (const stderr of [
    "HTTP 401: Bad credentials",
    "network connection failed",
    "",
  ]) {
    assert.throws(() =>
      readRequiredChecks("owner/repo", 123, () => ({ ...noChecks, stderr })),
    );
  }
  assert.throws(
    () =>
      readRequiredChecks("owner/repo", 123, () => ({
        ...noChecks,
        error: new Error("spawn failed"),
      })),
    /spawn failed/,
  );
});

test("ownership checks protect foreign worktrees and uncommitted changes", () => {
  const {
    snapshot: { pr },
  } = fixture();
  const local = { branch: pr.headRefName, head, dirty: false };
  assert.doesNotThrow(() => assertOwned(pr, local));
  for (const patch of [
    { branch: "main" },
    { branch: "codex/other" },
    { head: other },
    { dirty: true },
  ])
    assert.throws(() => assertOwned(pr, { ...local, ...patch }));
});

test("authorization survives only the exact computed two-parent base merge", () => {
  const {
    grant,
    snapshot: { pr },
  } = fixture();
  const after = { ...pr, headRefOid: other };
  const tree = "d".repeat(40);
  const commit = { sha: other, parents: [head, base], tree };
  assert.equal(carryAuthorization(grant, pr, after, commit, tree).head, other);
  for (const patch of [
    { parents: [head] },
    { parents: [base, head] },
    { parents: [head, base, other] },
    { tree: other },
    { sha: head },
  ])
    assert.equal(
      carryAuthorization(grant, pr, after, { ...commit, ...patch }, tree),
      null,
    );
  for (const patch of [
    { number: 124 },
    { headRefName: "codex/foreign" },
    { baseRefOid: other },
    { state: "MERGED" },
  ])
    assert.equal(
      carryAuthorization(grant, pr, { ...after, ...patch }, commit, tree),
      null,
    );
  assert.equal(
    carryAuthorization({ ...grant, head: other }, pr, after, commit, tree),
    null,
  );
});

test("real git merge-tree detects conflicts without touching the working tree", () => {
  const directory = mkdtempSync(join(tmpdir(), "pr-completion-test-"));
  function git(...args) {
    const result = spawnSync("git", args, {
      cwd: directory,
      encoding: "utf8",
      windowsHide: true,
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  }
  try {
    git("init", "--initial-branch=main");
    git("config", "user.email", "test@example.invalid");
    git("config", "user.name", "Test");
    mkdirSync(join(directory, "empty-hooks"));
    git("config", "core.hooksPath", join(directory, "empty-hooks"));
    writeFileSync(join(directory, "shared.txt"), "initial\n");
    git("add", "shared.txt");
    git("commit", "-m", "Initial");
    git("checkout", "-b", "feature");
    writeFileSync(join(directory, "feature.txt"), "feature\n");
    git("add", "feature.txt");
    git("commit", "-m", "Feature");
    const feature = git("rev-parse", "HEAD");
    git("checkout", "main");
    writeFileSync(join(directory, "base.txt"), "base\n");
    git("add", "base.txt");
    git("commit", "-m", "Base");
    const baseSha = git("rev-parse", "HEAD");
    const tree = git("merge-tree", "--write-tree", feature, baseSha);
    git("checkout", "feature");
    git("merge", "--no-ff", "--no-edit", baseSha);
    assert.equal(git("rev-parse", "HEAD^{tree}"), tree);
    writeFileSync(join(directory, "shared.txt"), "feature conflict\n");
    git("add", "shared.txt");
    git("commit", "-m", "Feature conflict");
    const conflictingFeature = git("rev-parse", "HEAD");
    git("checkout", "main");
    writeFileSync(join(directory, "shared.txt"), "main conflict\n");
    git("add", "shared.txt");
    git("commit", "-m", "Main conflict");
    const status = git("status", "--porcelain");
    const result = spawnSync(
      "git",
      ["merge-tree", "--write-tree", conflictingFeature, "HEAD"],
      { cwd: directory, encoding: "utf8", windowsHide: true },
    );
    assert.equal(result.status, 1);
    assert.equal(git("status", "--porcelain"), status);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
