// Minimal adapter between the agent-pipeline readiness model and Claude Code Action.
//
// `dispatch` decides from the same GitHub snapshot as the reconciler whether this exact head is
// waiting for a Claude cross-review. `publish` validates Claude's structured output, verifies that
// the pull-request head did not move, and only then appends the trusted, head-bound result marker.

import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig } from "./agent-pipeline.mjs";
import {
  CLAUDE_CROSS_REVIEW_HEADING,
  CLAUDE_CROSS_REVIEW_SOURCE,
  deriveReadiness,
  fetchSnapshot,
  isTrustedCommentAuthor,
  latestReviewResult,
  parseReviewResults,
  // The notice marker lives with the reconciler: it reads the notice back into its status comment,
  // and this module only writes it. One definition, one shape.
  REVIEW_START_NOTICE_MARKER,
  REVIEW_START_NOTICE_PATTERN,
} from "./agent-pipeline-reconcile.mjs";

const VERDICTS = new Set(["pass", "changes-required", "blocked"]);
const SEVERITIES = new Set(["critical", "high", "medium", "low"]);
const DISPOSITIONS = new Set(["actionable", "needs-human"]);
const MAX_FINDINGS = 20;
const MAX_TEXT = 4_000;
const MAX_RENDERED_DETAIL = 400;
export const MAX_REVIEW_COMMENT_LENGTH = 60_000;

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

function requiredText(value, name, max = MAX_TEXT) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} must be a non-empty string.`);
  }
  const text = value.trim();
  if (text.length > max) throw new Error(`${name} exceeds ${max} characters.`);
  return text;
}

function optionalText(value, name, max = MAX_TEXT) {
  if (value === null || value === undefined || value === "") return null;
  return requiredText(value, name, max);
}

function markdownText(value) {
  return String(value)
    .replace(/<!--[\s\S]*?-->/g, "[HTML comment removed]")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/!\[/g, "!\\[")
    .replace(/\]\(/g, "\\]\\(")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
}

function boundedMarkdownText(value, maximum = MAX_RENDERED_DETAIL) {
  const rendered = markdownText(value);
  if (rendered.length <= maximum) return rendered;
  const suffix = "… [gekürzt]";
  return `${rendered.slice(0, maximum - suffix.length)}${suffix}`;
}

function rejectUnknownKeys(value, allowed, name) {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length) throw new Error(`${name} contains unknown field(s): ${unknown.join(", ")}.`);
}

function rejectSecretEcho(raw) {
  for (const [name, secret] of [
    ["GITHUB_TOKEN", process.env.GITHUB_TOKEN],
    ["CLAUDE_CODE_OAUTH_TOKEN", process.env.CLAUDE_CODE_OAUTH_TOKEN_FOR_SCAN],
  ]) {
    if (typeof secret === "string" && secret.length >= 12 && String(raw).includes(secret)) {
      throw new Error(`Claude structured output contains ${name}; result discarded.`);
    }
  }
}

export function isTerminalClaudeReviewResult(result) {
  return Boolean(result && result.verdict !== "blocked");
}

// Stable identifiers for why a dispatch declined. The reason string stays human-facing; the code is
// what the notice renders from, so its wording can change without breaking the announcement.
export const DISPATCH_CODES = {
  run: "run",
  phase: "phase",
  mode: "mode",
  provider: "provider",
  resultExists: "result-exists",
  disabled: "disabled",
  failed: "failed",
  publishFailed: "publish-failed",
};

/** Pure eligibility check; the workflow calls it only after deriving current readiness. */
export function deriveClaudeReviewDispatch(readiness) {
  if (readiness.phase !== "review") {
    return {
      shouldRun: false,
      code: DISPATCH_CODES.phase,
      reason: `phase is ${readiness.phase}`,
    };
  }
  if (readiness.details?.reviewMode !== "cross") {
    return {
      shouldRun: false,
      code: DISPATCH_CODES.mode,
      reason: "review mode is not cross",
    };
  }
  if (readiness.reviewerProvider !== "claude") {
    return {
      shouldRun: false,
      code: DISPATCH_CODES.provider,
      reason: `counter provider is ${readiness.reviewerProvider ?? "unknown"}`,
    };
  }
  if (isTerminalClaudeReviewResult(readiness.details?.crossResult)) {
    return {
      shouldRun: false,
      code: DISPATCH_CODES.resultExists,
      reason: "this head already has a Claude result",
    };
  }
  return {
    shouldRun: true,
    code: DISPATCH_CODES.run,
    reason:
      readiness.details?.crossResult?.verdict === "blocked"
        ? "the previous Claude review was blocked and may be retried"
        : "current head is ready for one Claude cross-review",
  };
}

// Only a decline that leaves the pull request waiting is worth announcing. A head that already
// carries a Claude result has its answer, and this workflow reacting to a `review:cross` meant for
// the other provider is the normal case on every Claude-implemented pull request — announcing
// either would put a "review did not start" notice on pull requests where none was ever due.
const SILENT_DISPATCH_CODES = new Set([
  DISPATCH_CODES.run,
  DISPATCH_CODES.resultExists,
  DISPATCH_CODES.provider,
]);

export function shouldAnnounceReviewStartFailure(code) {
  return !SILENT_DISPATCH_CODES.has(code);
}

/** Validates and normalizes the only model-controlled value that the publisher accepts. */
export function validateClaudeReviewOutput(raw) {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch (error) {
      throw new Error(`Claude structured output is not valid JSON: ${error.message}`);
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Claude structured output must be a JSON object.");
  }
  rejectUnknownKeys(value, ["verdict", "findings", "residual_risks"], "review output");

  if (!VERDICTS.has(value.verdict)) {
    throw new Error("verdict must be pass, changes-required or blocked.");
  }
  if (!Array.isArray(value.findings) || value.findings.length > MAX_FINDINGS) {
    throw new Error(`findings must be an array with at most ${MAX_FINDINGS} entries.`);
  }
  if (!Array.isArray(value.residual_risks) || value.residual_risks.length > MAX_FINDINGS) {
    throw new Error(`residual_risks must be an array with at most ${MAX_FINDINGS} entries.`);
  }

  const findings = value.findings.map((finding, index) => {
    const prefix = `findings[${index}]`;
    if (!finding || typeof finding !== "object" || Array.isArray(finding)) {
      throw new Error(`${prefix} must be an object.`);
    }
    rejectUnknownKeys(
      finding,
      [
        "severity",
        "disposition",
        "title",
        "file",
        "line",
        "problem",
        "impact",
        "evidence",
        "verification",
      ],
      prefix,
    );
    if (!SEVERITIES.has(finding.severity)) {
      throw new Error(`${prefix}.severity is invalid.`);
    }
    if (!DISPOSITIONS.has(finding.disposition)) {
      throw new Error(`${prefix}.disposition is invalid.`);
    }
    if (
      finding.line !== null &&
      (!Number.isSafeInteger(finding.line) || finding.line < 1)
    ) {
      throw new Error(`${prefix}.line must be null or a positive integer.`);
    }
    return {
      severity: finding.severity,
      disposition: finding.disposition,
      title: requiredText(finding.title, `${prefix}.title`, 200),
      file: optionalText(finding.file, `${prefix}.file`, 500),
      line: finding.line,
      problem: requiredText(finding.problem, `${prefix}.problem`),
      impact: requiredText(finding.impact, `${prefix}.impact`),
      evidence: requiredText(finding.evidence, `${prefix}.evidence`),
      verification: requiredText(finding.verification, `${prefix}.verification`),
    };
  });

  if (value.verdict === "pass" && findings.length > 0) {
    throw new Error("A passing review must not contain findings.");
  }
  if (value.verdict === "changes-required" && findings.length === 0) {
    throw new Error("A changes-required review must contain at least one finding.");
  }

  return {
    verdict: value.verdict,
    findings,
    residualRisks: value.residual_risks.map((risk, index) =>
      requiredText(risk, `residual_risks[${index}]`),
    ),
  };
}

export function renderClaudeReviewComment({
  repository,
  pullNumber,
  headSha,
  sessionId,
  result,
}) {
  if (!/^[0-9a-f]{40}$/.test(headSha)) throw new Error("headSha must be a full SHA.");
  if (!/^[A-Za-z0-9._-]+$/.test(sessionId)) throw new Error("sessionId is invalid.");

  const lines = [
    CLAUDE_CROSS_REVIEW_HEADING,
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
    `<!-- agent-pipeline:review-result ${headSha} mode=cross verdict=${result.verdict} session=${sessionId} read-only=true -->`,
    "",
    "---",
    "_Generated by [Claude Code](https://claude.ai/code); validated and published by the trusted agent-pipeline workflow._",
  );
  const body = `${lines.join("\n")}\n`;
  if (body.length > MAX_REVIEW_COMMENT_LENGTH) {
    throw new Error(
      `Rendered Claude review comment exceeds ${MAX_REVIEW_COMMENT_LENGTH} characters.`,
    );
  }
  return body;
}

// What the reader has to do next, per decline code. Kept beside the codes so a new decline reason
// cannot silently fall back to a message that does not fit it.
function reviewStartGuidance(code, reason) {
  switch (code) {
    case DISPATCH_CODES.phase:
      return [
        `Die Pipeline stand beim Auslösen noch in Phase \`${markdownText(String(reason).replace(/^phase is /, ""))}\`,`,
        "nicht in `review`. Der Workflow startet ausschließlich beim Setzen des Labels und versucht es",
        "danach nicht erneut — das Label allein bewirkt jetzt nichts mehr.",
        "",
        "Abhilfe: warten, bis dieser Statuskommentar Phase `review` meldet, dann `review:cross`",
        "abnehmen und erneut setzen.",
      ].join("\n");
    case DISPATCH_CODES.mode:
      return [
        "Für diesen Head-SHA ist nicht `cross` als Reviewmodus gebunden. Ein Label, das zu einem",
        "früheren Head gehörte, zählt nicht mehr.",
        "",
        "Abhilfe: den Reviewmodus für den aktuellen Head wählen.",
      ].join("\n");
    case DISPATCH_CODES.provider:
      return [
        "Der Gegen-Anbieter für diesen Pull Request ist nicht `claude`, deshalb ist dieser Workflow",
        "nicht zuständig.",
        "",
        "Abhilfe: den Implementierungs-Anbieter im Task-Vertrag prüfen.",
      ].join("\n");
    case DISPATCH_CODES.disabled:
      return [
        "Die Agenten-Pipeline ist über die Repository-Variable `AGENT_PIPELINE_DISABLED` global",
        "abgeschaltet. Bis sie wieder aktiv ist, startet kein automatisches Review.",
      ].join("\n");
    case DISPATCH_CODES.publishFailed:
      return [
        "Das Review lief und lieferte ein Ergebnis, aber die Veröffentlichung wurde abgelehnt —",
        "etwa durch die Schemaprüfung des Ergebnisses, den Secret-Scan oder die GitHub-API. Damit",
        "ist kein Verdikt im Pull Request angekommen und die Pipeline wartet unverändert weiter.",
        "",
        "Abhilfe: den verlinkten Workflow-Lauf öffnen; der Publish-Schritt nennt den",
        "Ablehnungsgrund. Nach der Behebung `review:cross` abnehmen und erneut setzen.",
      ].join("\n");
    case DISPATCH_CODES.failed:
      return [
        "Der Reviewlauf wurde gestartet, hat aber kein gültiges strukturiertes Ergebnis geliefert.",
        "Damit ist nichts veröffentlicht worden und die Pipeline wartet unverändert auf ein Review",
        "für diesen Head.",
        "",
        "Abhilfe: den verlinkten Workflow-Lauf öffnen. Der Schritt `Report Claude failure details`",
        "nennt Fehlerart und Fehlertext. Nach der Behebung `review:cross` abnehmen und erneut setzen.",
      ].join("\n");
    default:
      return [
        "Es wurde kein Review gestartet und kein Ergebnis veröffentlicht. Die Pipeline wartet",
        "unverändert auf ein Review für diesen Head.",
      ].join("\n");
  }
}

/** Pure renderer for the PR-facing notice; the caller decides whether it is warranted. */
export function renderReviewStartNotice({
  repository,
  pullNumber,
  headSha,
  outcome,
  code,
  reason,
  runUrl,
  attempt,
}) {
  if (!/^[0-9a-f]{40}$/.test(headSha ?? "")) throw new Error("headSha must be a full SHA.");
  if (outcome !== "declined" && outcome !== "failed") {
    throw new Error("outcome must be declined or failed.");
  }
  if (!/^[A-Za-z0-9._-]+$/.test(attempt ?? "")) {
    throw new Error("attempt must be a stable workflow-attempt identifier.");
  }
  if (!/^[a-z-]+$/.test(code ?? "")) throw new Error("code is invalid.");
  const lines = [
    "## Claude Cross-Review nicht gestartet",
    "",
    `- Repository: \`${markdownText(repository)}\``,
    `- Pull Request: \`#${Number(pullNumber)}\``,
    `- Head-SHA: \`${headSha}\``,
    `- Ergebnis: \`${outcome}\``,
    `- Grund: \`${boundedMarkdownText(reason ?? "unknown", 200)}\``,
    ...(runUrl ? [`- Workflow-Lauf: ${markdownText(runUrl)}`] : []),
    "",
    reviewStartGuidance(code, reason),
    "",
    `${REVIEW_START_NOTICE_MARKER} ${headSha} mode=cross outcome=${outcome} code=${code} attempt=${attempt} -->`,
    "",
    "---",
    "_Maintained by the trusted agent-pipeline workflow. It reports state only; it does not approve or merge._",
  ];
  const body = `${lines.join("\n")}\n`;
  if (body.length > MAX_REVIEW_COMMENT_LENGTH) {
    throw new Error(`Rendered notice exceeds ${MAX_REVIEW_COMMENT_LENGTH} characters.`);
  }
  return body;
}

/**
 * Finds this head's existing notice so a repeat rewrites it instead of adding another comment.
 *
 * Only trusted authors count: anyone able to comment could otherwise plant the marker and have the
 * workflow keep editing a comment it never wrote.
 */
export function findReviewStartNotice(comments, headSha) {
  let found = null;
  for (const comment of comments ?? []) {
    if (!isTrustedCommentAuthor(comment)) continue;
    const match = comment?.body?.match(REVIEW_START_NOTICE_PATTERN);
    if (match && match[1] === headSha) found = comment;
  }
  return found;
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
    console.log("Claude cross-review skipped: agent pipeline is globally disabled.");
    return;
  }

  const { snapshot } = await fetchSnapshot({ owner, repo, pullNumber, token });
  const readiness = deriveReadiness(snapshot, loadConfig());
  const decision = deriveClaudeReviewDispatch(readiness);
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
  const existing = latestReviewResult(
    parseReviewResults(
      comments.map((comment) => ({
        author: comment.user?.login ?? null,
        authorAssociation: comment.author_association,
        body: comment.body,
      })),
    ),
    headSha,
    "cross",
    config.crossReviewResultAuthors?.claude ?? [],
    CLAUDE_CROSS_REVIEW_SOURCE,
  );
  if (isTerminalClaudeReviewResult(existing)) {
    console.log(`Claude result for ${headSha} already exists; no duplicate comment was posted.`);
    output("published", "false");
    return;
  }

  const rawResult = process.env.CLAUDE_REVIEW_OUTPUT ?? "";
  rejectSecretEcho(rawResult);
  const result = validateClaudeReviewOutput(rawResult);
  const body = renderClaudeReviewComment({
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
  console.log(`Published Claude cross-review result: ${comment.html_url ?? "comment created"}`);
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

  if (!shouldAnnounceReviewStartFailure(code)) {
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
        "Usage: agent-claude-review.mjs dispatch|publish|notice --repository <owner/repo> --pr <number>",
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
