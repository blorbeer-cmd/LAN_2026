// Trusted adapter that requests the native Codex review for a Claude implementation.
//
// The Codex integration submits the actual head-bound GitHub review. This adapter only posts the
// explicit `@codex review` request after the shared readiness model has selected Codex as reviewer.
// It never publishes a result marker, approves a pull request or changes the merge gate.

import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig } from "./agent-pipeline.mjs";
import {
  deriveReadiness,
  fetchSnapshot,
} from "./agent-pipeline-reconcile.mjs";

export const CODEX_REVIEW_REQUEST_MARKER = "<!-- agent-pipeline:codex-review-request";
const CODEX_REVIEW_REQUEST_PATTERN =
  /<!--\s*agent-pipeline:codex-review-request\s+([0-9a-f]{40})\s*-->/;
const REQUEST_AUTHOR = "github-actions[bot]";

function option(args, name) {
  const index = args.indexOf(name);
  if (index === -1 || index + 1 >= args.length) return null;
  return args[index + 1];
}

function repositoryParts(repository) {
  const match = String(repository ?? "").match(/^([^/\s]+)\/([^/\s]+)$/);
  if (!match) throw new Error("Expected --repository <owner/repo>.");
  return { owner: match[1], repo: match[2] };
}

function output(name, value) {
  const rendered = String(value ?? "").replace(/[\r\n]+/g, " ");
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${rendered}\n`, "utf8");
  }
}

function requireHeadSha(headSha) {
  if (!/^[0-9a-f]{40}$/.test(headSha ?? "")) {
    throw new Error("headSha must be a full lowercase SHA.");
  }
  return headSha;
}

/** Pure eligibility check shared with the reconciler's readiness decision. */
export function deriveCodexReviewDispatch(readiness) {
  if (readiness.phase !== "review") {
    return { shouldRun: false, reason: `phase is ${readiness.phase}` };
  }
  if (readiness.details?.reviewMode !== "cross") {
    return { shouldRun: false, reason: "review mode is not cross" };
  }
  if (readiness.reviewerProvider !== "codex") {
    return {
      shouldRun: false,
      reason: `counter provider is ${readiness.reviewerProvider ?? "unknown"}`,
    };
  }
  if (readiness.details?.reviews?.reviewedByProvider) {
    return { shouldRun: false, reason: "this head already has a Codex review" };
  }
  return {
    shouldRun: true,
    reason: "current head is ready for one Codex cross-review",
  };
}

export function renderCodexReviewRequest(headSha) {
  const currentHeadSha = requireHeadSha(headSha);
  return `@codex review\n\n${CODEX_REVIEW_REQUEST_MARKER} ${currentHeadSha} -->\n`;
}

export function hasCodexReviewRequest(comments, headSha) {
  const currentHeadSha = requireHeadSha(headSha);
  return (comments ?? []).some(
    (comment) =>
      comment?.author === REQUEST_AUTHOR &&
      comment?.body?.match(CODEX_REVIEW_REQUEST_PATTERN)?.[1] === currentHeadSha,
  );
}

async function githubApi(path, { token, method = "GET", body } = {}) {
  const base = process.env.GITHUB_API_URL ?? "https://api.github.com";
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub API ${method} ${path} failed (${response.status}): ${text}`);
  }
  return response.status === 204 ? null : response.json();
}

async function pullComments({ owner, repo, pullNumber, token }) {
  const comments = [];
  for (let page = 1; ; page += 1) {
    const batch = await githubApi(
      `/repos/${owner}/${repo}/issues/${pullNumber}/comments?per_page=100&page=${page}`,
      { token },
    );
    comments.push(...batch);
    if (batch.length < 100) return comments;
  }
}

async function requestCommand(args) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("request requires GITHUB_TOKEN.");
  const repository = option(args, "--repository") ?? process.env.GITHUB_REPOSITORY;
  const pullNumber = option(args, "--pr");
  if (!/^[1-9][0-9]*$/.test(pullNumber ?? "")) {
    throw new Error("request requires --pr <positive number>.");
  }
  const { owner, repo } = repositoryParts(repository);

  if ((process.env.AGENT_PIPELINE_DISABLED ?? "").toLowerCase() === "true") {
    output("should_run", "false");
    output("reason", "agent pipeline is globally disabled");
    console.log("Codex cross-review skipped: agent pipeline is globally disabled.");
    return;
  }

  const config = loadConfig();
  const { snapshot } = await fetchSnapshot({ owner, repo, pullNumber, token });
  const readiness = deriveReadiness(snapshot, config);
  const decision = deriveCodexReviewDispatch(readiness);
  const values = {
    should_run: decision.shouldRun,
    reason: decision.reason,
    repository,
    pull_number: Number(pullNumber),
    pull_url: `https://github.com/${repository}/pull/${Number(pullNumber)}`,
    head_sha: snapshot.headSha,
    head_branch: snapshot.headBranch,
    base_sha: snapshot.baseSha,
    base_branch: snapshot.baseBranch,
    implementer: readiness.contract?.implementer ?? "",
  };
  for (const [name, value] of Object.entries(values)) output(name, value);

  if (!decision.shouldRun) {
    console.log(JSON.stringify({ phase: readiness.phase, ...values }, null, 2));
    return;
  }

  const comments = await pullComments({ owner, repo, pullNumber, token });
  if (hasCodexReviewRequest(comments, snapshot.headSha)) {
    output("requested", "false");
    output("reason", "this head already has a Codex review request");
    console.log(`Codex review request for ${snapshot.headSha} already exists.`);
    return;
  }

  // Avoid posting a request for a stale head if a push raced the snapshot above.
  const currentPull = await githubApi(`/repos/${owner}/${repo}/pulls/${pullNumber}`, { token });
  if (currentPull.head?.sha !== snapshot.headSha) {
    throw new Error(
      `Pull request #${pullNumber} moved from ${snapshot.headSha} to ${currentPull.head?.sha}; ` +
        "Codex request discarded.",
    );
  }

  const comment = await githubApi(`/repos/${owner}/${repo}/issues/${pullNumber}/comments`, {
    token,
    method: "POST",
    body: { body: renderCodexReviewRequest(snapshot.headSha) },
  });
  output("requested", "true");
  output("comment_url", comment.html_url ?? "");
  console.log(`Requested Codex cross-review: ${comment.html_url ?? "comment created"}`);
}

const isMainModule =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  const [command, ...args] = process.argv.slice(2);
  try {
    if (command === "request") await requestCommand(args);
    else {
      throw new Error(
        "Usage: agent-codex-review.mjs request --repository <owner/repo> --pr <number>",
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
