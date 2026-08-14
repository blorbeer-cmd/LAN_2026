// Adapter between the agent-pipeline readiness model and a restricted, credential-read-only
// Claude Code Action run for a same-provider `self` review.
//
// This mirrors `agent-claude-review.mjs` exactly in shape: `dispatch` decides from the same
// GitHub snapshot as the reconciler whether this exact head is waiting for a Claude self-review,
// `publish` validates Claude's structured output, verifies the pull-request head did not move, and
// only then appends the trusted, head-bound result marker with `mode=self`. Only the eligibility
// rule and the prompt differ: cross reviews a Codex implementation as the counter provider, self
// reviews a Claude implementation as the same provider in a fresh, isolated, restricted job — the
// automated equivalent of running `scripts/agent-review-session.mjs --mode self --headless`
// locally. `resultAuthorsFor("claude", config)` already accepts a manually posted marker from
// `claude[bot]` or the human operator; this workflow adds a second, workflow-published source so a
// self-review can also run unattended in CI, exactly like cross-review already does.

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CLAUDE_SELF_REVIEW_HEADING,
  CLAUDE_SELF_REVIEW_SOURCE,
  deriveReadiness,
  fetchSnapshot,
  latestReviewResultFromAny,
  parseReviewResults,
  resultAuthorsFor,
} from "./agent-pipeline-reconcile.mjs";
import { loadConfig } from "./agent-pipeline.mjs";
import {
  boundedMarkdownText,
  DISPATCH_CODES,
  findReviewStartNotice,
  githubApi,
  isTerminalClaudeReviewResult,
  MAX_REVIEW_COMMENT_LENGTH,
  markdownText,
  option,
  output,
  pullComments,
  rejectSecretEcho,
  renderReviewStartNotice,
  repositoryParts,
  validateClaudeReviewOutput,
} from "./agent-claude-review.mjs";

/** Pure eligibility check; the workflow calls it only after deriving current readiness. */
export function deriveClaudeSelfReviewDispatch(readiness) {
  if (readiness.phase !== "review") {
    return {
      shouldRun: false,
      code: DISPATCH_CODES.phase,
      reason: `phase is ${readiness.phase}`,
    };
  }
  if (readiness.details?.reviewMode !== "self") {
    return {
      shouldRun: false,
      code: DISPATCH_CODES.mode,
      reason: "review mode is not self",
    };
  }
  if (readiness.contract?.implementer !== "claude") {
    return {
      shouldRun: false,
      code: DISPATCH_CODES.provider,
      reason: `implementer is ${readiness.contract?.implementer ?? "unknown"}`,
    };
  }
  if (isTerminalClaudeReviewResult(readiness.details?.selfResult)) {
    return {
      shouldRun: false,
      code: DISPATCH_CODES.resultExists,
      reason: "this head already has a self-review result",
    };
  }
  return {
    shouldRun: true,
    code: DISPATCH_CODES.run,
    reason:
      readiness.details?.selfResult?.verdict === "blocked"
        ? "the previous self-review was blocked and may be retried"
        : "current head is ready for one Claude self-review",
  };
}

// Only a decline that leaves the pull request waiting is worth announcing. A head that already
// carries a self-review result has its answer, and this workflow reacting to a `review:self` set
// for a Codex implementation (`provider`) is the normal case the local launcher and the detached
// Codex `/review` route still cover — announcing it would put a "review did not start" notice on
// every Codex self-review choice.
const SILENT_DISPATCH_CODES = new Set([
  DISPATCH_CODES.run,
  DISPATCH_CODES.resultExists,
  DISPATCH_CODES.provider,
]);

export function shouldAnnounceSelfReviewStartFailure(code) {
  return !SILENT_DISPATCH_CODES.has(code);
}

export function renderClaudeSelfReviewComment({ repository, pullNumber, headSha, sessionId, result }) {
  if (!/^[0-9a-f]{40}$/.test(headSha)) throw new Error("headSha must be a full SHA.");
  if (!/^[A-Za-z0-9._-]+$/.test(sessionId)) throw new Error("sessionId is invalid.");

  const lines = [
    CLAUDE_SELF_REVIEW_HEADING,
    "",
    `- Repository: \`${markdownText(repository)}\``,
    `- Pull Request: \`#${Number(pullNumber)}\``,
    `- Geprüfter Head-SHA: \`${headSha}\``,
    `- Review-Session-ID: \`${sessionId}\``,
    "- Read-only-Stufe: `true`",
    `- Verdikt: \`${result.verdict}\``,
    "",
    "### Findings",
    "",
  ];

  if (result.findings.length === 0) {
    lines.push("Keine Findings zum geprüften Head-SHA.", "");
  } else {
    for (const finding of result.findings) {
      const location = finding.file
        ? `${boundedMarkdownText(finding.file, 500)}${finding.line ? `:${finding.line}` : ""}`
        : "kein stabiler Inline-Anker";
      lines.push(
        `#### [${finding.severity}] ${boundedMarkdownText(finding.title, 200)}`,
        "",
        `- Disposition: \`${finding.disposition}\``,
        `- Datei: ${location}`,
        `- Problem: ${boundedMarkdownText(finding.problem)}`,
        `- Auswirkung: ${boundedMarkdownText(finding.impact)}`,
        `- Evidenz: ${boundedMarkdownText(finding.evidence)}`,
        `- Verifikation: ${boundedMarkdownText(finding.verification)}`,
        "",
      );
    }
  }

  lines.push("### Rest-Risiken und Prüfgrenzen", "");
  if (result.residualRisks.length === 0) lines.push("Keine", "");
  else {
    for (const risk of result.residualRisks) {
      lines.push(`- ${boundedMarkdownText(risk)}`);
    }
    lines.push("");
  }

  lines.push(
    `<!-- agent-pipeline:review-result ${headSha} mode=self verdict=${result.verdict} session=${sessionId} read-only=true -->`,
    "",
    "---",
    "_Generated by [Claude Code](https://claude.ai/code); validated and published by the trusted agent-pipeline workflow._",
  );
  const body = `${lines.join("\n")}\n`;
  if (body.length > MAX_REVIEW_COMMENT_LENGTH) {
    throw new Error(
      `Rendered Claude self-review comment exceeds ${MAX_REVIEW_COMMENT_LENGTH} characters.`,
    );
  }
  return body;
}

async function dispatchCommand(args) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("dispatch requires GITHUB_TOKEN.");
  const repository = option(args, "--repository") ?? process.env.GITHUB_REPOSITORY;
  const pullNumber = option(args, "--pr");
  if (!/^[1-9][0-9]*$/.test(pullNumber ?? "")) {
    throw new Error("dispatch requires --pr <positive number>.");
  }
  const { owner, repo } = repositoryParts(repository);

  if ((process.env.AGENT_PIPELINE_DISABLED ?? "").toLowerCase() === "true") {
    output("should_run", "false");
    output("code", DISPATCH_CODES.disabled);
    output("reason", "agent pipeline is globally disabled");
    console.log("Claude self-review skipped: agent pipeline is globally disabled.");
    return;
  }

  const { snapshot } = await fetchSnapshot({ owner, repo, pullNumber, token });
  const readiness = deriveReadiness(snapshot, loadConfig());
  const decision = deriveClaudeSelfReviewDispatch(readiness);
  const values = {
    should_run: decision.shouldRun,
    code: decision.code,
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
  console.log(JSON.stringify({ phase: readiness.phase, ...values }, null, 2));
}

async function publishCommand(args) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("publish requires GITHUB_TOKEN.");
  const repository = option(args, "--repository") ?? process.env.GITHUB_REPOSITORY;
  const pullNumber = option(args, "--pr");
  const headSha = option(args, "--head-sha");
  const sessionId = option(args, "--session");
  if (!/^[1-9][0-9]*$/.test(pullNumber ?? "") || !headSha || !sessionId) {
    throw new Error("publish requires --pr, --head-sha and --session.");
  }
  const { owner, repo } = repositoryParts(repository);
  const pull = await githubApi(`/repos/${owner}/${repo}/pulls/${pullNumber}`, { token });
  if (pull.state !== "open") throw new Error(`Pull request #${pullNumber} is no longer open.`);
  if (pull.head?.sha !== headSha) {
    throw new Error(
      `Pull request #${pullNumber} moved from ${headSha} to ${pull.head?.sha}; result discarded.`,
    );
  }

  const config = loadConfig();
  const comments = await pullComments({ owner, repo, pullNumber, token });
  const results = parseReviewResults(
    comments.map((comment) => ({
      author: comment.user?.login ?? null,
      authorAssociation: comment.author_association,
      body: comment.body,
    })),
  );
  // Only this workflow's own prior publish counts as a duplicate here; a manually posted marker
  // from `claude[bot]` or the human operator is a separate, still-valid self-review this run must
  // not overwrite or duplicate either, so both sources are checked before publishing a new one.
  const existing = latestReviewResultFromAny(results, headSha, "self", [
    { authors: resultAuthorsFor("claude", config) },
    { authors: config.selfReviewResultAuthors?.claude ?? [], source: CLAUDE_SELF_REVIEW_SOURCE },
  ]);
  if (isTerminalClaudeReviewResult(existing)) {
    console.log(`Self-review result for ${headSha} already exists; no duplicate comment was posted.`);
    output("published", "false");
    return;
  }

  const rawResult = process.env.CLAUDE_REVIEW_OUTPUT ?? "";
  rejectSecretEcho(rawResult);
  const result = validateClaudeReviewOutput(rawResult);
  const body = renderClaudeSelfReviewComment({
    repository,
    pullNumber,
    headSha,
    sessionId,
    result,
  });
  const comment = await githubApi(`/repos/${owner}/${repo}/issues/${pullNumber}/comments`, {
    token,
    method: "POST",
    body: { body },
  });
  output("published", "true");
  output("comment_url", comment.html_url ?? "");
  console.log(`Published Claude self-review result: ${comment.html_url ?? "comment created"}`);
}

async function noticeCommand(args) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("notice requires GITHUB_TOKEN.");
  const repository = option(args, "--repository") ?? process.env.GITHUB_REPOSITORY;
  const pullNumber = option(args, "--pr");
  if (!/^[1-9][0-9]*$/.test(pullNumber ?? "")) {
    throw new Error("notice requires --pr <positive number>.");
  }
  const outcome = option(args, "--outcome");
  const code = option(args, "--code") || DISPATCH_CODES.failed;
  const reason = option(args, "--reason") || "unknown";
  const runUrl = option(args, "--run-url") || "";
  const attempt = option(args, "--attempt");
  const { owner, repo } = repositoryParts(repository);

  if (!shouldAnnounceSelfReviewStartFailure(code)) {
    console.log(`No notice needed for dispatch code ${code}.`);
    return;
  }

  const pull = await githubApi(`/repos/${owner}/${repo}/pulls/${pullNumber}`, { token });
  if (pull.state !== "open") {
    console.log(`Pull request #${pullNumber} is no longer open; no notice was posted.`);
    return;
  }
  // The dispatch reports the head it judged. When it never got that far, the pull request's current
  // head is the only truthful anchor for a notice about "no review covers this head".
  const declared = option(args, "--head-sha");
  const headSha = /^[0-9a-f]{40}$/.test(declared ?? "") ? declared : pull.head?.sha;

  const body = renderReviewStartNotice({
    mode: "self",
    repository,
    pullNumber,
    headSha,
    outcome,
    code,
    reason,
    runUrl,
    attempt,
  });
  const comments = await pullComments({ owner, repo, pullNumber, token });
  const existing = findReviewStartNotice(
    comments.map((comment) => ({
      id: comment.id,
      author: comment.user?.login ?? null,
      authorAssociation: comment.author_association,
      body: comment.body,
    })),
    headSha,
    "self",
  );

  const posted = existing
    ? await githubApi(`/repos/${owner}/${repo}/issues/comments/${existing.id}`, {
        token,
        method: "PATCH",
        body: { body },
      })
    : await githubApi(`/repos/${owner}/${repo}/issues/${pullNumber}/comments`, {
        token,
        method: "POST",
        body: { body },
      });
  output("notice_url", posted.html_url ?? "");
  console.log(
    `${existing ? "Updated" : "Posted"} review-start notice: ${posted.html_url ?? "comment written"}`,
  );
}

const isMainModule =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  const [command, ...args] = process.argv.slice(2);
  try {
    if (command === "dispatch") await dispatchCommand(args);
    else if (command === "publish") await publishCommand(args);
    else if (command === "notice") await noticeCommand(args);
    else {
      throw new Error(
        "Usage: agent-claude-self-review.mjs dispatch|publish|notice --repository <owner/repo> --pr <number>",
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
