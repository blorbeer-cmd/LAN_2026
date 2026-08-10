// Trusted adapter that requests the native Codex review for a Claude implementation.
//
// The Codex integration submits the actual head-bound GitHub review. This adapter only posts the
// explicit `@codex review` request after the shared readiness model has selected Codex as reviewer.
// It never publishes a result marker, approves a pull request or changes the merge gate.
//
// The request only counts when it comes from an identity the Codex integration authorizes. Posted
// with the job token it arrives as `github-actions[bot]`, which the integration answers with a
// connector hint instead of a review, so the pull request waits for a review that can never come.
// This adapter therefore posts exclusively with the separate `AGENT_PIPELINE_REVIEW_REQUEST_TOKEN`
// credential, never falls back to the job token, and reports a missing credential or a refused
// request as a failed review attempt so the pull request says so instead of waiting.

import { appendFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig } from "./agent-pipeline.mjs";
import {
  deriveReadiness,
  fetchSnapshot,
} from "./agent-pipeline-reconcile.mjs";
// Both cross-review workflows announce a review that never started through the same marker and the
// same comment, so the notice has exactly one implementation. Only the way-out text is per provider.
import {
  findReviewStartNotice,
  renderReviewStartNotice,
} from "./agent-claude-review.mjs";

export const CODEX_REVIEW_REQUEST_MARKER = "<!-- agent-pipeline:codex-review-request";
const CODEX_REVIEW_REQUEST_PATTERN =
  /<!--\s*agent-pipeline:codex-review-request\s+([0-9a-f]{40})\s*-->/;

// The identity that answers `@codex review` — with a review when it accepts the request, and with
// the refusal below when it does not know the requesting account.
export const CODEX_CONNECTOR_AUTHOR = "chatgpt-codex-connector[bot]";
// The observed refusal is a single sentence pointing at the connector settings. Recognising it is
// what separates "Codex declined to start" from "Codex is still working": both look identical from
// the review side, and only this comment says which one happened.
const CODEX_REQUEST_REFUSAL_PATTERN =
  /to use codex here|codex\/cloud\/settings\/connectors/i;
// Any `@codex review`, not just this adapter's marked one. A later request opens its own
// request-and-answer window, and the integration answers requests in order.
const CODEX_REVIEW_MENTION_PATTERN = /(^|[^\w`])@codex\s+review\b/i;

const REQUEST_TOKEN_VARIABLE = "AGENT_PIPELINE_REVIEW_REQUEST_TOKEN";
const REFUSAL_POLL_ATTEMPTS = 6;
const REFUSAL_POLL_DELAY_MS = 10_000;

// Stable identifiers for why no request is outstanding. The reason string stays human-facing; the
// code decides whether the pull request has to be told and which way out the notice names.
export const REQUEST_CODES = {
  run: "run",
  phase: "phase",
  mode: "mode",
  provider: "provider",
  reviewExists: "review-exists",
  requestExists: "request-exists",
  disabled: "disabled",
  missingToken: "missing-token",
  identity: "identity",
  refused: "refused",
  failed: "failed",
};

// A request that is outstanding or already answered needs no announcement, and a `review:cross`
// that belongs to Claude is announced by that provider's workflow. Everything else leaves the pull
// request waiting for a review nobody will start, which is exactly what the notice exists for.
const SILENT_REQUEST_CODES = new Set([
  REQUEST_CODES.run,
  REQUEST_CODES.provider,
  REQUEST_CODES.reviewExists,
  REQUEST_CODES.requestExists,
]);

export function shouldAnnounceCodexRequestFailure(code) {
  return !SILENT_REQUEST_CODES.has(code);
}

/**
 * Whether a failure without a decision may still be announced.
 *
 * A job that died before the dispatch — during checkout, Node setup or the first snapshot read —
 * reports no code, and the fallback says nothing about the head it died on or who was supposed to
 * review it. The notice would then be anchored to whatever the current head is, so nothing short
 * of full current eligibility justifies writing it: a head whose review mode was withdrawn, whose
 * label now names another mode, or that has moved on is not waiting for a Codex review, and the
 * notice comment is shared with the workflow that may genuinely own that head.
 */
export function mayAnnounceUndecidedFailure(readiness) {
  return deriveCodexReviewDispatch(readiness).shouldRun;
}

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

function commentAuthor(comment) {
  return comment?.author ?? comment?.user?.login ?? null;
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** Pure eligibility check shared with the reconciler's readiness decision. */
export function deriveCodexReviewDispatch(readiness) {
  if (readiness.phase !== "review") {
    return {
      shouldRun: false,
      code: REQUEST_CODES.phase,
      reason: `phase is ${readiness.phase}`,
    };
  }
  if (readiness.details?.reviewMode !== "cross") {
    return {
      shouldRun: false,
      code: REQUEST_CODES.mode,
      reason: "review mode is not cross",
    };
  }
  if (readiness.reviewerProvider !== "codex") {
    return {
      shouldRun: false,
      code: REQUEST_CODES.provider,
      reason: `counter provider is ${readiness.reviewerProvider ?? "unknown"}`,
    };
  }
  if (readiness.details?.reviews?.reviewedByProvider) {
    return {
      shouldRun: false,
      code: REQUEST_CODES.reviewExists,
      reason: "this head already has a Codex review",
    };
  }
  return {
    shouldRun: true,
    code: REQUEST_CODES.run,
    reason: "current head is ready for one Codex cross-review",
  };
}

export function renderCodexReviewRequest(headSha) {
  const currentHeadSha = requireHeadSha(headSha);
  return `@codex review\n\n${CODEX_REVIEW_REQUEST_MARKER} ${currentHeadSha} -->\n`;
}

/**
 * Locates this head's own request comment.
 *
 * The author is part of the identity: a request from an account Codex refused is not a request that
 * is being worked on, and once an authorized credential exists the same head must be asked again.
 * Returns the newest match together with its position, because the answer is whatever the Codex
 * integration posted after it.
 */
export function findCodexReviewRequest(comments, headSha, author) {
  const currentHeadSha = requireHeadSha(headSha);
  let found = null;
  (comments ?? []).forEach((comment, index) => {
    if (author && commentAuthor(comment) !== author) return;
    if (comment?.body?.match(CODEX_REVIEW_REQUEST_PATTERN)?.[1] === currentHeadSha) {
      found = { comment, index };
    }
  });
  return found;
}

export function hasCodexReviewRequest(comments, headSha, author) {
  return findCodexReviewRequest(comments, headSha, author) !== null;
}

export function isCodexRequestRefusal(comment) {
  return (
    commentAuthor(comment) === CODEX_CONNECTOR_AUTHOR &&
    CODEX_REQUEST_REFUSAL_PATTERN.test(comment?.body ?? "")
  );
}

/**
 * The refusal that answered this head's request, or null.
 *
 * Position decides, not wording: only a refusal posted after the request can belong to it, so a
 * refusal left over from an earlier head or an earlier requesting identity never marks the current
 * attempt as failed. GitHub returns issue comments in creation order.
 *
 * The window ends at the next `@codex review` from anyone. Somebody else's request — a maintainer
 * asking by hand is the normal case — is answered on its own, and blaming its refusal on this
 * adapter would report a working credential as refused and suppress every rerun for the head.
 */
export function findCodexRequestRefusal(comments, headSha, author) {
  const request = findCodexReviewRequest(comments, headSha, author);
  if (!request) return null;
  for (const comment of (comments ?? []).slice(request.index + 1)) {
    if (CODEX_REVIEW_MENTION_PATTERN.test(comment?.body ?? "")) return null;
    if (isCodexRequestRefusal(comment)) return comment;
  }
  return null;
}

// What the reader has to do next, per request code. Kept beside the codes so a new reason cannot
// silently inherit a way out that does not fit it.
function codexRequestGuidance(code, reason) {
  switch (code) {
    case REQUEST_CODES.missingToken:
      return [
        `Das Actions-Secret \`${REQUEST_TOKEN_VARIABLE}\` fehlt oder ist leer. Die Codex-Integration`,
        "weist ein `@codex review` von `github-actions[bot]` ab, deshalb setzt dieser Workflow ohne",
        "eigene, von Codex autorisierte Identität bewusst keine Anfrage ab, statt eine zu senden, die",
        "sicher abgelehnt wird.",
        "",
        "Abhilfe: das Secret mit einem Token eines mit Codex verbundenen GitHub-Kontos hinterlegen,",
        "danach `review:cross` abnehmen und erneut setzen. Bis dahin bringt nur ein manueller",
        "`@codex review`-Kommentar dieser Identität das Review in Gang.",
      ].join("\n");
    case REQUEST_CODES.identity:
      return [
        `Das hinterlegte Token aus \`${REQUEST_TOKEN_VARIABLE}\` konnte seine eigene GitHub-Identität`,
        "nicht auflösen. Ohne bekannte Identität wird keine Anfrage abgesetzt: Genau die Identität",
        "des Kommentarautors entscheidet, ob Codex die Anfrage annimmt.",
        "",
        "Abhilfe: Gültigkeit und Ablaufdatum des Tokens prüfen und es neu hinterlegen, danach",
        "`review:cross` abnehmen und erneut setzen.",
      ].join("\n");
    case REQUEST_CODES.refused:
      return [
        "Die Codex-Integration hat die Anfrage für diesen Head abgewiesen und auf ihre",
        "Verbindungseinstellungen verwiesen. Das hinterlegte Token gehört damit zu einem Konto, das",
        "in dieser Integration nicht verbunden ist. Ein erneuter Versuch derselben Identität würde",
        "genauso enden, deshalb wurde keine weitere Anfrage abgesetzt.",
        "",
        `Abhilfe: das Konto mit Codex verbinden oder in \`${REQUEST_TOKEN_VARIABLE}\` ein Token einer`,
        "bereits verbundenen Identität hinterlegen, danach `review:cross` abnehmen und erneut setzen.",
      ].join("\n");
    case REQUEST_CODES.phase:
      return [
        `Die Pipeline stand beim Auslösen noch in Phase \`${String(reason).replace(/^phase is /, "")}\`,`,
        "nicht in `review`. Der Workflow startet ausschließlich beim Setzen des Labels und versucht es",
        "danach nicht erneut — das Label allein bewirkt jetzt nichts mehr.",
        "",
        "Abhilfe: warten, bis der Statuskommentar Phase `review` meldet, dann `review:cross` abnehmen",
        "und erneut setzen.",
      ].join("\n");
    case REQUEST_CODES.mode:
      return [
        "Für diesen Head-SHA ist nicht `cross` als Reviewmodus gebunden. Ein Label, das zu einem",
        "früheren Head gehörte, zählt nicht mehr.",
        "",
        "Abhilfe: den Reviewmodus für den aktuellen Head wählen.",
      ].join("\n");
    case REQUEST_CODES.disabled:
      return [
        "Die Agenten-Pipeline ist über die Repository-Variable `AGENT_PIPELINE_DISABLED` global",
        "abgeschaltet. Bis sie wieder aktiv ist, startet kein automatisches Review.",
      ].join("\n");
    case REQUEST_CODES.failed:
      return [
        "Der Anfrage-Schritt ist fehlgeschlagen, bevor eine Anfrage im Pull Request stand. Damit",
        "wartet die Pipeline unverändert auf ein Review für diesen Head.",
        "",
        "Abhilfe: den verlinkten Workflow-Lauf öffnen; der Schritt `Request native Codex review`",
        "nennt den Fehler. Nach der Behebung `review:cross` abnehmen und erneut setzen.",
      ].join("\n");
    default:
      return [
        "Es wurde keine Review-Anfrage abgesetzt und kein Ergebnis veröffentlicht. Die Pipeline",
        "wartet unverändert auf ein Review für diesen Head.",
      ].join("\n");
  }
}

/**
 * Replacement body for a failure notice that a later request has answered.
 *
 * The reconciler reads the notice marker into its status comment, so a stale one would keep
 * reporting a failed attempt while a request is genuinely outstanding — and would invite another
 * recovery that is not needed. Dropping the marker retires the machine-readable claim while the
 * pull request keeps the record that the attempt happened.
 */
export function renderSupersededRequestNotice({ repository, pullNumber, headSha, commentUrl }) {
  if (!/^[0-9a-f]{40}$/.test(headSha ?? "")) throw new Error("headSha must be a full SHA.");
  const lines = [
    "## Codex Cross-Review angefragt (früherer Fehlversuch)",
    "",
    `- Repository: \`${repository}\``,
    `- Pull Request: \`#${Number(pullNumber)}\``,
    `- Head-SHA: \`${headSha}\``,
    ...(commentUrl ? [`- Neue Anfrage: ${commentUrl}`] : []),
    "",
    "Für diesen Head wurde eine neue Review-Anfrage abgesetzt, nachdem ein früherer Versuch",
    "gescheitert war. Der ursprüngliche Hinweis gilt nicht mehr; die Pipeline wartet jetzt auf das",
    "Review zu diesem Head.",
    "",
    "---",
    "_Maintained by the trusted agent-pipeline workflow. It reports state only; it does not approve or merge._",
  ];
  return `${lines.join("\n")}\n`;
}

/** Pure renderer for the PR-facing notice; the caller decides whether it is warranted. */
export function renderCodexRequestNotice({
  repository,
  pullNumber,
  headSha,
  outcome,
  code,
  reason,
  runUrl,
}) {
  return renderReviewStartNotice({
    provider: "codex",
    repository,
    pullNumber,
    headSha,
    outcome,
    code,
    reason,
    runUrl,
    guidance: codexRequestGuidance(code, reason),
  });
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

async function pullComments({ owner, repo, pullNumber, token }, githubApiFn = githubApi) {
  const comments = [];
  for (let page = 1; ; page += 1) {
    const batch = await githubApiFn(
      `/repos/${owner}/${repo}/issues/${pullNumber}/comments?per_page=100&page=${page}`,
      { token },
    );
    comments.push(...batch);
    if (batch.length < 100) return comments;
  }
}

/**
 * Resolves the login the request will be posted under.
 *
 * The identity is the whole point of the separate credential, so an unusable one is a failed
 * attempt rather than a reason to fall back to the job token.
 */
async function resolveRequestIdentity(requestToken, githubApiFn) {
  try {
    const identity = await githubApiFn("/user", { token: requestToken });
    return typeof identity?.login === "string" && identity.login ? identity.login : null;
  } catch (error) {
    console.error(`Could not resolve the review-request identity: ${error.message}`);
    return null;
  }
}

/**
 * Waits a bounded time for Codex to refuse the request that was just posted.
 *
 * A refusal arrives within seconds, while a real review takes minutes, so a short wait separates
 * the two without holding the job. Silence is not treated as acceptance — it only means nothing
 * refused the request yet.
 */
async function waitForRequestRefusal(
  { owner, repo, pullNumber, token, headSha, author, attempts, delayMs },
  githubApiFn,
  sleepFn,
) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await sleepFn(delayMs);
    const comments = await pullComments({ owner, repo, pullNumber, token }, githubApiFn);
    const refusal = findCodexRequestRefusal(comments, headSha, author);
    if (refusal) return refusal;
  }
  return null;
}

export async function requestCommand(
  args,
  {
    loadConfigFn = loadConfig,
    fetchSnapshotFn = fetchSnapshot,
    deriveReadinessFn = deriveReadiness,
    githubApiFn = githubApi,
    sleepFn = sleep,
    refusalPollAttempts = REFUSAL_POLL_ATTEMPTS,
    refusalPollDelayMs = REFUSAL_POLL_DELAY_MS,
  } = {},
) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("request requires GITHUB_TOKEN.");
  const requestToken = process.env[REQUEST_TOKEN_VARIABLE];
  const repository = option(args, "--repository") ?? process.env.GITHUB_REPOSITORY;
  const pullNumber = option(args, "--pr");
  if (!/^[1-9][0-9]*$/.test(pullNumber ?? "")) {
    throw new Error("request requires --pr <positive number>.");
  }
  const { owner, repo } = repositoryParts(repository);

  const decline = (code, reason) => {
    output("requested", "false");
    output("code", code);
    output("reason", reason);
    console.log(`No Codex review request was posted: ${reason}`);
  };

  if ((process.env.AGENT_PIPELINE_DISABLED ?? "").toLowerCase() === "true") {
    output("should_run", "false");
    decline(REQUEST_CODES.disabled, "agent pipeline is globally disabled");
    return;
  }

  const config = loadConfigFn();
  const { snapshot } = await fetchSnapshotFn({ owner, repo, pullNumber, token });
  const readiness = deriveReadinessFn(snapshot, config);
  const decision = deriveCodexReviewDispatch(readiness);
  // `code`, `reason` and `requested` are deliberately written exactly once, at the point the
  // outcome is final. A second line for the same output would leave the notice job's behaviour
  // depending on how duplicate keys in the outputs file are resolved.
  const values = {
    should_run: decision.shouldRun,
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
    decline(decision.code, decision.reason);
    return;
  }

  // Deliberately no fallback to the job token: a request from `github-actions[bot]` is refused, and
  // an attempt that is certain to fail would leave the pull request waiting instead of reporting.
  if (!requestToken) {
    decline(
      REQUEST_CODES.missingToken,
      `${REQUEST_TOKEN_VARIABLE} is not configured; no review request was posted`,
    );
    return;
  }
  const author = await resolveRequestIdentity(requestToken, githubApiFn);
  if (!author) {
    decline(
      REQUEST_CODES.identity,
      `the credential in ${REQUEST_TOKEN_VARIABLE} did not resolve to a GitHub identity`,
    );
    return;
  }
  output("request_author", author);

  const comments = await pullComments({ owner, repo, pullNumber, token }, githubApiFn);
  // A refusal for this head is deliberately not a permanent block. The notice tells the operator to
  // connect the account and set `review:cross` again, and that retry only works if the same
  // identity may ask once more — the refusal describes the account's state at the time, not a
  // property of the head. Re-asking costs one comment per deliberate retry.
  //
  // An unanswered request from the authorized identity is different: it is an outstanding request,
  // not a failed attempt, so a reapplied label, a manual dispatch or a duplicate event must find
  // the run green and must not repeat the request while Codex is still working on it.
  if (
    !findCodexRequestRefusal(comments, snapshot.headSha, author) &&
    hasCodexReviewRequest(comments, snapshot.headSha, author)
  ) {
    output("requested", "true");
    output("code", REQUEST_CODES.requestExists);
    output("reason", "this head already has an outstanding Codex review request");
    console.log(`Codex review request for ${snapshot.headSha} already exists.`);
    return;
  }

  // Avoid posting a request for a stale head if a push raced the snapshot above.
  const currentPull = await githubApiFn(`/repos/${owner}/${repo}/pulls/${pullNumber}`, { token });
  if (currentPull.head?.sha !== snapshot.headSha) {
    throw new Error(
      `Pull request #${pullNumber} moved from ${snapshot.headSha} to ${currentPull.head?.sha}; ` +
        "Codex request discarded.",
    );
  }

  const comment = await githubApiFn(`/repos/${owner}/${repo}/issues/${pullNumber}/comments`, {
    token: requestToken,
    method: "POST",
    body: { body: renderCodexReviewRequest(snapshot.headSha) },
  });
  output("comment_url", comment.html_url ?? "");
  console.log(`Requested Codex cross-review: ${comment.html_url ?? "comment created"}`);


  const answer = await waitForRequestRefusal(
    {
      owner,
      repo,
      pullNumber,
      token,
      headSha: snapshot.headSha,
      author,
      attempts: refusalPollAttempts,
      delayMs: refusalPollDelayMs,
    },
    githubApiFn,
    sleepFn,
  );
  if (answer) {
    decline(
      REQUEST_CODES.refused,
      `Codex refused the review request posted as ${author}`,
    );
    output("refusal_url", answer.html_url ?? "");
    return;
  }

  // A retry after a refusal leaves that refusal's notice on the head, and the reconciler reads its
  // marker into the status comment. Left alone it would report a failed attempt while this request
  // is outstanding and invite a recovery nobody needs. Retired only now, with positive evidence
  // that the request stands: had it been refused too, the notice job rewrites the head's notice.
  const stale = findReviewStartNotice(
    comments.map((entry) => ({
      id: entry.id,
      author: entry.user?.login ?? entry.author ?? null,
      authorAssociation: entry.author_association,
      body: entry.body,
    })),
    snapshot.headSha,
  );
  if (stale) {
    // The job token wrote that notice and rewrites it; the request credential stays reserved for
    // the one comment whose identity has to be the one Codex authorizes.
    await githubApiFn(`/repos/${owner}/${repo}/issues/comments/${stale.id}`, {
      token,
      method: "PATCH",
      body: {
        body: renderSupersededRequestNotice({
          repository,
          pullNumber: Number(pullNumber),
          headSha: snapshot.headSha,
          commentUrl: comment.html_url ?? "",
        }),
      },
    });
    console.log(`Superseded the earlier failure notice for ${snapshot.headSha}.`);
  }

  output("requested", "true");
  output("code", REQUEST_CODES.run);
}

export async function noticeCommand(
  args,
  {
    githubApiFn = githubApi,
    loadConfigFn = loadConfig,
    fetchSnapshotFn = fetchSnapshot,
    deriveReadinessFn = deriveReadiness,
  } = {},
) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("notice requires GITHUB_TOKEN.");
  const repository = option(args, "--repository") ?? process.env.GITHUB_REPOSITORY;
  const pullNumber = option(args, "--pr");
  if (!/^[1-9][0-9]*$/.test(pullNumber ?? "")) {
    throw new Error("notice requires --pr <positive number>.");
  }
  const outcome = option(args, "--outcome");
  const code = option(args, "--code") || REQUEST_CODES.failed;
  const reason = option(args, "--reason") || "unknown";
  const runUrl = option(args, "--run-url") || "";
  const { owner, repo } = repositoryParts(repository);

  if (!shouldAnnounceCodexRequestFailure(code)) {
    console.log(`No notice needed for request code ${code}.`);
    return;
  }

  const pull = await githubApiFn(`/repos/${owner}/${repo}/pulls/${pullNumber}`, { token });
  if (pull.state !== "open") {
    console.log(`Pull request #${pullNumber} is no longer open; no notice was posted.`);
    return;
  }
  // `failed` is also the fallback for a job that never reached the dispatch, so it carries no
  // decision about the provider. Re-derive eligibility before touching the head's shared notice.
  if (code === REQUEST_CODES.failed) {
    const { snapshot } = await fetchSnapshotFn({ owner, repo, pullNumber, token });
    if (!mayAnnounceUndecidedFailure(deriveReadinessFn(snapshot, loadConfigFn()))) {
      console.log("No notice needed: this head's cross-review does not belong to Codex.");
      return;
    }
  }

  // The request reports the head it judged. When it never got that far, the pull request's current
  // head is the only truthful anchor for a notice about "no review covers this head".
  const declared = option(args, "--head-sha");
  const headSha = /^[0-9a-f]{40}$/.test(declared ?? "") ? declared : pull.head?.sha;

  const body = renderCodexRequestNotice({
    repository,
    pullNumber,
    headSha,
    outcome,
    code,
    reason,
    runUrl,
  });
  const comments = await pullComments({ owner, repo, pullNumber, token }, githubApiFn);
  const existing = findReviewStartNotice(
    comments.map((comment) => ({
      id: comment.id,
      author: comment.user?.login ?? comment.author ?? null,
      authorAssociation: comment.author_association,
      body: comment.body,
    })),
    headSha,
  );

  const posted = existing
    ? await githubApiFn(`/repos/${owner}/${repo}/issues/comments/${existing.id}`, {
        token,
        method: "PATCH",
        body: { body },
      })
    : await githubApiFn(`/repos/${owner}/${repo}/issues/${pullNumber}/comments`, {
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
    if (command === "request") await requestCommand(args);
    else if (command === "notice") await noticeCommand(args);
    else {
      throw new Error(
        "Usage: agent-codex-review.mjs request|notice --repository <owner/repo> --pr <number>",
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
