#!/usr/bin/env node
// Local PR companion. Credentials stay with gh; no daemon, token storage or main push.
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  readdirSync,
  unlinkSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

const SHA = /^[0-9a-f]{40}$/;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const FIELDS =
  "number,title,state,headRefName,headRefOid,baseRefName,baseRefOid,isCrossRepository,isDraft,mergeable,mergeStateStatus,reviewDecision,url";
export const reviewMarker = (head, base, verdict) =>
  `<!-- pr-review:v1 head=${head} base=${base} verdict=${verdict} -->`;

export function parseReview(review, pr) {
  const match =
    /^<!-- pr-review:v1 head=([0-9a-f]{40}) base=([0-9a-f]{40}) verdict=(pass|changes-required|incomplete) -->\r?\n/.exec(
      review.body ?? "",
    );
  if (
    !match ||
    !review.body.slice(match[0].length).trim() ||
    !review.submitted_at ||
    review.state === "DISMISSED" ||
    review.state === "PENDING"
  )
    return null;
  if (
    review.commit_id !== pr.headRefOid ||
    match[1] !== pr.headRefOid ||
    match[2] !== pr.baseRefOid
  )
    return null;
  return {
    verdict: match[3],
    login: review.user?.login,
    id: review.id,
    url: review.html_url,
  };
}

export function mergeBlockers(snapshot, grant) {
  const { pr, reviews, threads, checks, requiredChecks } = snapshot;
  const reasons = [];
  if (pr.state !== "OPEN") reasons.push("PR is not open");
  if (pr.isCrossRepository || pr.baseRefName !== "main")
    reasons.push("Only same-repository PRs into main are supported");
  if (pr.isDraft) reasons.push("PR is still a draft");
  if (pr.mergeable !== "MERGEABLE" || pr.mergeStateStatus !== "CLEAN")
    reasons.push("GitHub has not reported a clean, current merge state");
  if (
    pr.reviewDecision === "CHANGES_REQUESTED" ||
    pr.reviewDecision === "REVIEW_REQUIRED"
  )
    reasons.push("GitHub review requirements are not satisfied");
  if (
    !grant ||
    grant.head !== pr.headRefOid ||
    grant.branch !== pr.headRefName ||
    grant.pr !== pr.number
  )
    reasons.push(
      "Explicit merge authorization for this head is missing or stale",
    );
  if (!requiredChecks.length)
    reasons.push("Required checks could not be established");
  for (const name of requiredChecks) {
    const check = checks.find((entry) => entry.name === name);
    if (!check || !["pass", "skipping"].includes(check.bucket))
      reasons.push(`Required check not successful: ${name}`);
  }
  if (threads.some((thread) => !thread.isResolved))
    reasons.push("Unresolved review threads");
  const current = reviews.filter(
    (review) =>
      review.commit_id === pr.headRefOid &&
      review.state !== "DISMISSED" &&
      review.state !== "PENDING",
  );
  if (current.some((review) => review.state === "CHANGES_REQUESTED"))
    reasons.push("Changes requested on this head");
  // GitHub creates empty COMMENTED reviews for individual inline comments/replies.
  // Their findings are covered by thread resolution, not by replacing a full report.
  const evidence = current
    .filter((review) => review.state !== "COMMENTED" || review.body?.trim())
    .map((review) => ({ review, parsed: parseReview(review, pr) }));
  const latest = evidence
    .filter((entry) => entry.review.user?.login === grant?.reviewerLogin)
    .sort((a, b) => b.review.id - a.review.id)[0];
  if (!latest || latest.parsed?.verdict !== "pass")
    reasons.push(
      "Complete current-head/base review by the chosen reviewer is missing",
    );
  // Other reviewers' findings cannot be overruled by a pass from the selected reviewer.
  const byAuthor = new Map();
  for (const entry of evidence.sort((a, b) => a.review.id - b.review.id))
    byAuthor.set(entry.review.user?.login, entry.parsed);
  if ([...byAuthor.values()].some((entry) => entry?.verdict !== "pass"))
    reasons.push("A current reviewer reports findings or an incomplete review");
  return reasons;
}

export function assertOwned(pr, local) {
  if (pr.state !== "OPEN" || pr.isCrossRepository || pr.baseRefName !== "main")
    throw new Error(
      "Only an open, same-repository PR into main can be changed",
    );
  if (local.branch !== pr.headRefName || local.branch === "main")
    throw new Error("Run in the implementation worktree for this PR");
  if (local.dirty)
    throw new Error(
      "Worktree has uncommitted or untracked changes; preserve them first",
    );
  if (local.head !== pr.headRefOid)
    throw new Error(
      "Local and remote PR heads differ; reconcile the implementation worktree first",
    );
}

export function carryAuthorization(grant, before, after, commit, expectedTree) {
  if (!grant || grant.head !== before.headRefOid) return null;
  if (
    before.number !== after.number ||
    before.headRefName !== after.headRefName ||
    after.state !== "OPEN" ||
    after.isCrossRepository ||
    after.baseRefName !== "main" ||
    after.baseRefOid !== before.baseRefOid
  )
    return null;
  if (
    commit.parents.length !== 2 ||
    commit.parents[0] !== before.headRefOid ||
    commit.parents[1] !== before.baseRefOid ||
    commit.tree !== expectedTree ||
    commit.sha !== after.headRefOid
  )
    return null;
  return {
    ...grant,
    head: after.headRefOid,
    updates: [
      ...(grant.updates ?? []),
      {
        from: before.headRefOid,
        base: before.baseRefOid,
        to: after.headRefOid,
      },
    ],
  };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
    timeout: 120000,
    ...options,
  });
  if (
    result.error ||
    ![0, ...(options.acceptCodes ?? [])].includes(result.status)
  )
    throw new Error(
      result.error?.message ??
        (result.stderr.trim() || `${command} exited ${result.status}`),
    );
  return result.stdout.trim();
}
const git = (...args) => run("git", args);
function ghJson(args, options) {
  return JSON.parse(run("gh", args, options));
}
function api(endpoint, method = "GET", body) {
  return ghJson(
    [
      "api",
      "--hostname",
      "github.com",
      endpoint,
      "--method",
      method,
      ...(body ? ["--input", "-"] : []),
    ],
    body ? { input: JSON.stringify(body) } : {},
  );
}
function pages(endpoint) {
  return ghJson([
    "api",
    "--hostname",
    "github.com",
    endpoint,
    "--paginate",
    "--slurp",
  ]).flat();
}
function readPr(repo, pr) {
  return ghJson([
    "pr",
    "view",
    `${pr}`,
    "--repo",
    `https://github.com/${repo}`,
    "--json",
    FIELDS,
  ]);
}

export function readRequiredChecks(repo, number, execute = spawnSync) {
  const result = execute(
    "gh",
    [
      "pr",
      "checks",
      `${number}`,
      "--repo",
      `https://github.com/${repo}`,
      "--required",
      "--json",
      "name,bucket,link",
    ],
    {
      encoding: "utf8",
      windowsHide: true,
      timeout: 120000,
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  const output = result.stdout?.trim() ?? "";
  const diagnostic = result.stderr?.trim() ?? "";
  if (result.error) throw new Error(result.error.message);
  // Before Actions registers checks, gh exits 1 without JSON. Do not mistake auth,
  // network or unexpected CLI failures with the same exit code for ordinary waiting.
  if (
    result.status === 1 &&
    !output &&
    /^no (?:required )?checks reported\b/.test(diagnostic)
  )
    return [];
  if (![0, 1, 8].includes(result.status) || !output)
    throw new Error(
      diagnostic ||
        `Unable to read required checks (gh exited ${result.status})`,
    );
  const checks = JSON.parse(output);
  if (!Array.isArray(checks))
    throw new Error("Expected a list of required checks from gh");
  return checks;
}

export function readSnapshot(repo, number) {
  const pr = readPr(repo, number);
  const reviews = pages(`repos/${repo}/pulls/${number}/reviews?per_page=100`);
  const [owner, name] = repo.split("/");
  let cursor = null;
  const threads = [];
  do {
    const result = api("graphql", "POST", {
      query: `query($owner:String!,$name:String!,$number:Int!,$cursor:String){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100,after:$cursor){nodes{isResolved} pageInfo{hasNextPage endCursor}}}}}`,
      variables: { owner, name, number, cursor },
    });
    if (result.errors) throw new Error("Unable to read all review threads");
    const page = result.data?.repository?.pullRequest?.reviewThreads;
    if (!page) throw new Error("Missing review thread data");
    threads.push(...page.nodes);
    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
    if (page.pageInfo.hasNextPage && !cursor)
      throw new Error("Incomplete thread pagination");
  } while (cursor);
  const protection = api(
    `repos/${repo}/branches/main/protection/required_status_checks`,
  );
  const requiredChecks = [
    ...new Set([
      ...(protection.contexts ?? []),
      ...(protection.checks ?? []).map((check) => check.context),
    ]),
  ];
  const checks = readRequiredChecks(repo, number);
  const after = readPr(repo, number);
  if (
    after.headRefOid !== pr.headRefOid ||
    after.baseRefOid !== pr.baseRefOid ||
    after.state !== pr.state
  )
    throw new Error("PR changed while collecting evidence; retry the read");
  assertReviewsUnchanged(
    reviews,
    pages(`repos/${repo}/pulls/${number}/reviews?per_page=100`),
  );
  return { pr: after, reviews, threads, checks, requiredChecks };
}

export function assertReviewsUnchanged(before, after) {
  const fingerprint = (reviews) =>
    JSON.stringify(
      reviews
        .map((review) => ({
          id: review.id,
          state: review.state,
          body: review.body,
          commit: review.commit_id,
          submitted: review.submitted_at,
          updated: review.updated_at,
          author: review.user?.login,
        }))
        .sort((a, b) => a.id - b.id),
    );
  if (fingerprint(before) !== fingerprint(after))
    throw new Error(
      "Reviews changed while collecting evidence; retry the read",
    );
}

function readState(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}
function saveState(path, state) {
  const temp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, path);
}

export function readGrant(path) {
  const grant = readState(path);
  return grant &&
    (grant.revocationId ?? null) === (readState(`${path}.revoked`)?.id ?? null)
    ? grant
    : null;
}

export function revokeGrant(path) {
  // Separate, permanent generation marker: an in-flight update cannot resurrect a
  // revoked grant by writing its old in-memory copy after this atomic replacement.
  saveState(`${path}.revoked`, {
    id: randomUUID(),
    time: new Date().toISOString(),
  });
}

export function acquireMutationLock(path) {
  try {
    writeFileSync(
      path,
      JSON.stringify({ pid: process.pid, time: new Date().toISOString() }),
      { flag: "wx" },
    );
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    let owner;
    try {
      owner = readState(path);
    } catch {
      owner = null;
    }
    throw new Error(
      `PR mutation lock exists: ${path} (PID ${owner?.pid ?? "unknown"}, since ${owner?.time ?? "unknown"}). Revoke remains available. Remove the lock only after verifying that its owning process has stopped; see docs/pr-completion.md.`,
    );
  }
}

export function queueBlocker(queue, number) {
  if (!queue.some((entry) => entry.pr === number))
    return {
      action: "blocked",
      blockers: [
        "This PR's merge authorization was revoked or invalidated by a changed head/state during the queue scan",
      ],
    };
  const first = [...queue].sort(
    (a, b) => a.authorizedAt.localeCompare(b.authorizedAt) || a.pr - b.pr,
  )[0];
  return first.pr === number
    ? null
    : {
        action: "waiting",
        reason: `PR #${first.pr} is ahead in the local merge queue`,
      };
}
function localState() {
  return {
    branch: git("branch", "--show-current"),
    head: git("rev-parse", "HEAD"),
    dirty: Boolean(git("status", "--porcelain")),
  };
}
function assertOrigin(repo) {
  const origin = git("remote", "get-url", "origin");
  const match =
    /^(?:https:\/\/github\.com\/|git@github\.com:)([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(
      origin,
    );
  if (!match || match[1].toLowerCase() !== repo.toLowerCase())
    throw new Error("origin must match the requested GitHub repository");
}

export function main(argv = process.argv.slice(2)) {
  const [action, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 2) {
    if (
      !/^--[a-z-]+$/.test(rest[index]) ||
      !rest[index + 1] ||
      rest[index + 1].startsWith("--") ||
      options[rest[index].slice(2)]
    )
      throw new Error("Expected unique --option value pairs");
    options[rest[index].slice(2)] = rest[index + 1];
  }
  if (
    !["status", "authorize", "revoke", "update", "merge"].includes(action) ||
    !REPO.test(options.repo ?? "") ||
    !/^[1-9][0-9]*$/.test(options.pr ?? "")
  )
    throw new Error(
      "Usage: node scripts/pr-completion.mjs status|authorize|revoke|update|merge --repo owner/repo --pr N [--head SHA --reviewer-login LOGIN --request-file FILE]",
    );
  const repo = options.repo;
  const number = Number(options.pr);
  if (!Number.isSafeInteger(number)) throw new Error("Invalid PR number");
  assertOrigin(repo);
  const directory = join(
    resolve(git("rev-parse", "--git-common-dir")),
    "pr-completion",
    repo.toLowerCase().replace("/", "--"),
  );
  mkdirSync(directory, { recursive: true });
  const statePath = join(directory, `${number}.json`);
  const lockPath = join(directory, "mutation.lock");
  if (action === "revoke") {
    revokeGrant(statePath);
    return {
      action: "revoked",
      pr: number,
      note: "An already submitted GitHub merge request cannot be recalled; verify the PR state.",
    };
  }
  const mutating = action !== "status";
  if (mutating) acquireMutationLock(lockPath);
  try {
    const revocationId = readState(`${statePath}.revoked`)?.id ?? null;
    let grant = readGrant(statePath);
    const pr = readPr(repo, number);
    if (pr.state !== "OPEN") {
      if (mutating) saveState(statePath, null);
      return { action: "finished", pr: number, state: pr.state };
    }
    if (action === "status") {
      const snapshot = readSnapshot(repo, number);
      grant = readGrant(statePath);
      return {
        pr: snapshot.pr,
        grant,
        blockers: mergeBlockers(snapshot, grant),
        reviews: snapshot.reviews,
        checks: snapshot.checks,
        unresolvedThreads: snapshot.threads.filter(
          (thread) => !thread.isResolved,
        ).length,
      };
    }
    assertOwned(pr, localState());
    if (action === "authorize") {
      if (
        !SHA.test(options.head ?? "") ||
        options.head !== pr.headRefOid ||
        !/^[a-zA-Z0-9][a-zA-Z0-9-]*(?:\[bot\])?$/.test(
          options["reviewer-login"] ?? "",
        )
      )
        throw new Error(
          "Authorization requires the exact current --head and chosen --reviewer-login",
        );
      if (!options["request-file"])
        throw new Error(
          "Supply the user's explicit merge request in --request-file; never infer authorization from a review",
        );
      const request = readFileSync(options["request-file"], "utf8").trim();
      if (!request || request.length > 12000)
        throw new Error(
          "Merge request must be nonempty and at most 12000 characters",
        );
      grant = {
        repo,
        pr: number,
        branch: pr.headRefName,
        head: pr.headRefOid,
        approvedHead: pr.headRefOid,
        reviewerLogin: options["reviewer-login"],
        request,
        authorizedAt: new Date().toISOString(),
        updates: [],
        revocationId,
      };
      // Save only after the audit comment succeeds. An uncertain write never enables a merge.
      const audit = api(`repos/${repo}/issues/${number}/comments`, "POST", {
        body: `PR #${number} · Merge-Freigabe durch den Nutzer\n\nÜbertragene Nutzeranweisung:\n\n${request
          .split("\n")
          .map((line) => `> ${line}`)
          .join(
            "\n",
          )}\n\nHead: \`${pr.headRefOid}\`\nReviewer-Konto: \`${grant.reviewerLogin}\`\nDie Freigabe umfasst ausschließlich nachweislich konfliktfreie main-Aktualisierungen. Eigene Codeänderungen benötigen eine neue Freigabe; CI und vollständiges Review gelten immer für den aktuellen Head und die aktuelle Base.`,
      });
      grant.auditUrl = audit.html_url;
      saveState(statePath, grant);
      if (!readGrant(statePath)) return { action: "revoked", pr: number };
      return { action: "authorized", grant };
    }
    if (grant && grant.head !== pr.headRefOid) {
      saveState(statePath, null);
      grant = null;
    }
    // One authorized PR at a time across linked worktrees. Closed grants are retired.
    if (grant) {
      const queue = [];
      for (const file of readdirSync(directory).filter((name) =>
        /^[0-9]+\.json$/.test(name),
      )) {
        const path = join(directory, file);
        const candidate = readGrant(path);
        if (!candidate) continue;
        const current = readPr(repo, candidate.pr);
        if (current.state !== "OPEN" || candidate.head !== current.headRefOid) {
          saveState(path, null);
          continue;
        }
        if (readGrant(path)) queue.push(candidate);
      }
      const blocker = queueBlocker(queue, number);
      if (blocker) return blocker;
    }
    if (action === "update") {
      git("fetch", "origin", `refs/heads/main:refs/remotes/origin/main`);
      const base = git("rev-parse", "refs/remotes/origin/main");
      if (base !== pr.baseRefOid)
        throw new Error("main changed; retry with a fresh snapshot");
      const ancestor = spawnSync(
        "git",
        ["merge-base", "--is-ancestor", base, pr.headRefOid],
        { windowsHide: true },
      );
      if (ancestor.status === 0)
        return { action: "current", head: pr.headRefOid };
      if (ancestor.status !== 1)
        throw new Error("Unable to determine branch ancestry");
      // merge-tree computes without modifying the worktree. Conflicts stop before a merge.
      const tree = git("merge-tree", "--write-tree", pr.headRefOid, base).split(
        /\r?\n/,
      )[0];
      if (!SHA.test(tree))
        throw new Error("Cannot prove a conflict-free base update");
      const fresh = readPr(repo, number);
      if (
        fresh.headRefOid !== pr.headRefOid ||
        fresh.baseRefOid !== base ||
        fresh.state !== "OPEN"
      )
        throw new Error("PR changed before update");
      git("merge", "--no-ff", "--no-edit", base);
      const sha = git("rev-parse", "HEAD");
      const commit = {
        sha,
        tree: git("rev-parse", "HEAD^{tree}"),
        parents: git("show", "-s", "--format=%P", "HEAD").split(" "),
      };
      if (
        commit.tree !== tree ||
        commit.parents.join(" ") !== `${pr.headRefOid} ${base}`
      )
        throw new Error(
          "Merge differs from the computed update; do not push or carry authorization",
        );
      git("push", "origin", `HEAD:refs/heads/${pr.headRefName}`);
      const after = readPr(repo, number);
      const carried = carryAuthorization(
        readGrant(statePath),
        pr,
        after,
        commit,
        tree,
      );
      saveState(statePath, carried);
      return {
        action: "updated",
        head: sha,
        authorizationPreserved: Boolean(readGrant(statePath)),
        next: "Run CI and a fresh full review for this head/base",
      };
    }
    const snapshot = readSnapshot(repo, number);
    assertOwned(snapshot.pr, localState());
    const blockers = mergeBlockers(snapshot, readGrant(statePath));
    if (blockers.length) return { action: "blocked", blockers };
    // gh's normal merge path plus expected head. Never --admin, --auto, or a push to main.
    run("gh", [
      "pr",
      "merge",
      `${number}`,
      "--repo",
      `https://github.com/${repo}`,
      "--squash",
      "--match-head-commit",
      snapshot.pr.headRefOid,
    ]);
    const after = readPr(repo, number);
    if (after.state !== "MERGED")
      throw new Error("Merge is not confirmed; inspect GitHub before retrying");
    saveState(statePath, null);
    return { action: "merged", pr: number, url: after.url };
  } finally {
    if (mutating) unlinkSync(lockPath);
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    console.log(JSON.stringify(main(), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
