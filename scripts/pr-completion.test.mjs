import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  assertOwned,
  carryAuthorization,
  mergeBlockers,
  parseReview,
  readRequiredChecks,
  reviewMarker,
  readGrant,
  revokeGrant,
  acquireMutationLock,
  assertReviewsUnchanged,
  queueBlocker,
  readBaseTip,
  updateBranch,
} from "./pr-completion.mjs";

const head = "a".repeat(40);
const base = "b".repeat(40);
const other = "c".repeat(40);

test("revoke works through the CLI despite a stale lock and survives an in-flight grant write", () => {
  const directory = mkdtempSync(join(tmpdir(), "pr-revoke-test-"));
  const git = (...args) => {
    const result = spawnSync("git", args, {
      cwd: directory,
      encoding: "utf8",
      windowsHide: true,
    });
    assert.equal(result.status, 0, result.stderr);
  };
  try {
    git("init", "--initial-branch=main");
    git("remote", "add", "origin", "https://github.com/owner/repo.git");
    const stateDirectory = join(
      directory,
      ".git",
      "pr-completion",
      "owner--repo",
    );
    mkdirSync(stateDirectory, { recursive: true });
    const statePath = join(stateDirectory, "123.json");
    const lockPath = join(stateDirectory, "mutation.lock");
    const grant = { pr: 123, head, revocationId: null };
    writeFileSync(statePath, JSON.stringify(grant));
    writeFileSync(
      lockPath,
      JSON.stringify({ pid: 123456, time: "2026-09-09T00:00:00Z" }),
    );
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL("./pr-completion.mjs", import.meta.url)),
        "revoke",
        "--repo",
        "owner/repo",
        "--pr",
        "123",
      ],
      { cwd: directory, encoding: "utf8", windowsHide: true },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).action, "revoked");
    assert.equal(readGrant(statePath), null);
    // Model an update that saved its pre-revocation in-memory copy after revoke.
    writeFileSync(statePath, JSON.stringify({ ...grant, head: other }));
    assert.equal(readGrant(statePath), null);
    const revocationId = JSON.parse(
      readFileSync(`${statePath}.revoked`, "utf8"),
    ).id;
    writeFileSync(statePath, JSON.stringify({ ...grant, revocationId }));
    assert.ok(readGrant(statePath)); // a genuinely later authorization can use the new generation
    revokeGrant(statePath);
    assert.equal(readGrant(statePath), null);
    assert.throws(
      () => acquireMutationLock(lockPath),
      /PID 123456, since 2026-09-09T00:00:00Z.*Revoke remains available/,
    );
    assert.equal(JSON.parse(readFileSync(lockPath, "utf8")).pid, 123456);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("evidence freshness detects new, edited and dismissed reviews", () => {
  const {
    snapshot: { reviews },
  } = fixture();
  assert.doesNotThrow(() =>
    assertReviewsUnchanged(reviews, structuredClone(reviews)),
  );
  assert.throws(
    () =>
      assertReviewsUnchanged(reviews, [
        ...reviews,
        { ...reviews[0], id: 2, state: "CHANGES_REQUESTED" },
      ]),
    /Reviews changed/,
  );
  for (const change of [
    { body: "New finding" },
    { state: "DISMISSED" },
    { commit_id: other },
    { user: { login: "other" } },
  ]) {
    assert.throws(
      () => assertReviewsUnchanged(reviews, [{ ...reviews[0], ...change }]),
      /Reviews changed/,
    );
  }
  assert.throws(() => assertReviewsUnchanged(reviews, []), /Reviews changed/);
});

test("queue reports lost own authorization instead of an undefined or unrelated predecessor", () => {
  const own = { pr: 123, authorizedAt: "2026-09-09T12:00:00Z" };
  const first = { pr: 100, authorizedAt: "2026-09-09T11:00:00Z" };
  assert.equal(queueBlocker([own], 123), null);
  assert.deepEqual(queueBlocker([own, first], 123), {
    action: "waiting",
    reason: "PR #100 is ahead in the local merge queue",
  });
  for (const queue of [[], [first]]) {
    assert.equal(queueBlocker(queue, 123).action, "blocked");
    assert.match(
      queueBlocker(queue, 123).blockers[0],
      /authorization was revoked or invalidated/,
    );
  }
});
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
  const tips = { before: base, after: base };
  assert.equal(
    carryAuthorization(grant, pr, after, commit, tree, tips).head,
    other,
  );
  // PR base metadata may lag behind main; only the verified branch tip binds the update.
  const staleMetadata = { baseRefOid: "e".repeat(40) };
  assert.equal(
    carryAuthorization(
      grant,
      { ...pr, ...staleMetadata },
      { ...after, ...staleMetadata },
      commit,
      tree,
      tips,
    ).head,
    other,
  );
  for (const patch of [
    { parents: [head] },
    { parents: [base, head] },
    { parents: [head, base, other] },
    { tree: other },
    { sha: head },
  ])
    assert.equal(
      carryAuthorization(grant, pr, after, { ...commit, ...patch }, tree, tips),
      null,
    );
  for (const patch of [
    { number: 124 },
    { headRefName: "codex/foreign" },
    { state: "MERGED" },
  ])
    assert.equal(
      carryAuthorization(grant, pr, { ...after, ...patch }, commit, tree, tips),
      null,
    );
  for (const movedOrUnknown of [
    { before: base, after: other },
    { before: other, after: other },
    { before: "short", after: "short" },
    undefined,
  ])
    assert.equal(
      carryAuthorization(grant, pr, after, commit, tree, movedOrUnknown),
      null,
    );
  assert.equal(
    carryAuthorization({ ...grant, head: other }, pr, after, commit, tree, tips),
    null,
  );
});

test("the base tip is read from the branch ref and must be a commit SHA", () => {
  const read = (object) => () => ({ ref: "refs/heads/main", object });
  assert.equal(
    readBaseTip("owner/repo", "main", read({ type: "commit", sha: base })),
    base,
  );
  for (const object of [
    { type: "tag", sha: base },
    { type: "commit", sha: "short" },
    undefined,
  ])
    assert.throws(
      () => readBaseTip("owner/repo", "main", read(object)),
      /Unable to read the current main tip/,
    );
});

// A local bare repository stands in for GitHub: its refs are the base tip that the branch
// ref API reports. PR metadata is stubbed separately so it can lag behind like GitHub's.
function updateFixture() {
  const root = mkdtempSync(join(tmpdir(), "pr-update-test-"));
  const origin = join(root, "origin.git");
  const hooks = join(root, "empty-hooks");
  mkdirSync(hooks);
  const git = (cwd, ...args) => {
    const result = spawnSync("git", args, {
      cwd,
      encoding: "utf8",
      windowsHide: true,
    });
    assert.equal(result.status, 0, `git ${args.join(" ")}: ${result.stderr}`);
    return result.stdout.trim();
  };
  const clone = (name) => {
    const directory = join(root, name);
    git(root, "clone", "--quiet", origin, directory);
    git(directory, "config", "user.email", "test@example.invalid");
    git(directory, "config", "user.name", "Test");
    git(directory, "config", "core.hooksPath", hooks);
    return directory;
  };
  const commitFile = (cwd, file, content) => {
    writeFileSync(join(cwd, file), content);
    git(cwd, "add", file);
    git(cwd, "commit", "--quiet", "-m", `Change ${file}`);
    return git(cwd, "rev-parse", "HEAD");
  };
  git(root, "init", "--quiet", "--bare", "--initial-branch=main", origin);
  const work = clone("work");
  git(work, "checkout", "--quiet", "-b", "main");
  const initialMain = commitFile(work, "shared.txt", "initial\n");
  git(work, "push", "--quiet", "origin", "main");
  git(work, "checkout", "--quiet", "-b", "feature");
  const feature = commitFile(work, "feature.txt", "feature\n");
  git(work, "push", "--quiet", "origin", "feature");
  const concurrent = clone("concurrent");
  let mainCommits = 0;
  const advanceMain = () => {
    mainCommits += 1;
    const sha = commitFile(concurrent, `main-${mainCommits}.txt`, "main\n");
    git(concurrent, "push", "--quiet", "origin", "main");
    return sha;
  };
  const remoteTip = (branch) =>
    git(root, "ls-remote", origin, `refs/heads/${branch}`).split(/\s+/)[0];
  const pr = {
    number: 123,
    state: "OPEN",
    headRefName: "feature",
    headRefOid: feature,
    baseRefName: "main",
    // Stale metadata: GitHub still reports the main commit of the last PR push.
    baseRefOid: initialMain,
    isCrossRepository: false,
  };
  return {
    root,
    work,
    git,
    pr,
    feature,
    advanceMain,
    remoteTip,
    readPr: () => ({ ...pr, headRefOid: remoteTip("feature") }),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

test("update uses the current base tip when PR base metadata is stale", () => {
  const repo = updateFixture();
  try {
    const main = repo.advanceMain();
    assert.notEqual(repo.pr.baseRefOid, main);
    const result = updateBranch({
      pr: repo.pr,
      readPr: repo.readPr,
      readBaseTip: () => repo.remoteTip("main"),
      cwd: repo.work,
    });
    assert.equal(result.action, "updated");
    assert.deepEqual(result.commit.parents, [repo.feature, main]);
    assert.equal(repo.remoteTip("feature"), result.head);
    assert.equal(result.after.headRefOid, result.head);
    const grant = { pr: 123, branch: "feature", head: repo.feature, updates: [] };
    const carried = carryAuthorization(
      grant,
      repo.pr,
      result.after,
      result.commit,
      result.tree,
      { before: result.base, after: result.baseAfter },
    );
    assert.deepEqual(carried.updates, [
      { from: repo.feature, base: main, to: result.head },
    ]);
    // The next run sees an up-to-date branch even though the metadata still lags.
    assert.deepEqual(
      updateBranch({
        pr: { ...repo.pr, headRefOid: result.head },
        readPr: repo.readPr,
        readBaseTip: () => repo.remoteTip("main"),
        cwd: repo.work,
      }),
      { action: "current", head: result.head, base: main },
    );
  } finally {
    repo.cleanup();
  }
});

test("real concurrent main or head changes still stop update before merging or pushing", () => {
  const scenarios = [
    {
      name: "main moves between fetch and the GitHub ref read",
      readBaseTip: (repo) => () => (repo.advanceMain(), repo.remoteTip("main")),
      error: /main changed; retry with a fresh snapshot/,
    },
    {
      name: "main moves after the conflict-free merge was computed",
      readBaseTip: (repo) => {
        let reads = 0;
        return () => {
          reads += 1;
          if (reads === 2) repo.advanceMain();
          return repo.remoteTip("main");
        };
      },
      error: /main changed; retry with a fresh snapshot/,
    },
    {
      name: "another push replaces the PR head",
      readBaseTip: (repo) => () => repo.remoteTip("main"),
      readPr: (repo) => () => ({ ...repo.pr, headRefOid: other }),
      error: /PR changed before update/,
    },
  ];
  for (const scenario of scenarios) {
    const repo = updateFixture();
    try {
      repo.advanceMain();
      assert.throws(
        () =>
          updateBranch({
            pr: repo.pr,
            readPr: scenario.readPr?.(repo) ?? repo.readPr,
            readBaseTip: scenario.readBaseTip(repo),
            cwd: repo.work,
          }),
        scenario.error,
        scenario.name,
      );
      assert.equal(repo.git(repo.work, "rev-parse", "HEAD"), repo.feature, scenario.name);
      assert.equal(repo.remoteTip("feature"), repo.feature, scenario.name);
      assert.equal(repo.git(repo.work, "status", "--porcelain"), "", scenario.name);
    } finally {
      repo.cleanup();
    }
  }
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
