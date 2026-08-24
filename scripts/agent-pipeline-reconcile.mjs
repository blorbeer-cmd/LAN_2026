// Stateless readiness reconciler for the agent pipeline.
//
// Readiness is derived from the current GitHub state on every run instead of from an own event
// stream. It keeps no private history: durable delivery and decision records live in marked GitHub
// comments and are part of the snapshot. The same snapshot therefore always produces the same
// plan, and a duplicated, delayed or out-of-order event cannot corrupt the result. Every head-bound
// classification falls back to "unknown", and therefore to blocking, when it does not belong to
// the current head SHA.
//
// Besides reporting readiness on the pull request, this module owns the merge gate: the
// `Agent pipeline / ready for human merge` commit status for the current head SHA. It still starts
// no agent and never approves or merges anything — the status only states whether the conditions
// from section 11 of the plan hold, and the merge itself stays a human decision.

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  loadConfig,
  parseTaskContract,
  validateTaskContract,
} from "./agent-pipeline.mjs";

export const STATUS_COMMENT_MARKER = "<!-- agent-pipeline:status -->";
// The UI/UX notice records the head it was written for, so a later commit invalidates it:
// `<!-- agent-pipeline:ui-notice <40-char head sha> -->`
export const UI_NOTICE_MARKER = "<!-- agent-pipeline:ui-notice";
const UI_NOTICE_PATTERN = /<!--\s*agent-pipeline:ui-notice\s+([0-9a-f]{40})\s*-->/;

// The head SHA a review-mode label was first observed at, written by the reconciler into its own
// status comment: `<!-- agent-pipeline:review-decision <40-char head sha> mode=cross since=<ts> -->`.
// It is what makes a choice expire with its head, so the next head asks again instead of silently
// inheriting the previous answer.
export const REVIEW_DECISION_MARKER = "<!-- agent-pipeline:review-decision";
// A separate, mention-bearing comment is the durable GitHub fallback for actively delivering the
// choice. Unlike the sticky status comment it creates a new notification, and the head-bound
// marker makes scheduled and repeated reconciliations idempotent.
export const REVIEW_DECISION_NOTIFICATION_MARKER =
  "<!-- agent-pipeline:review-decision-notification";
export const CODEX_EVENT_MARKER = "<!-- agent-pipeline:codex-event";
const REVIEW_DECISION_NOTIFICATION_PATTERN =
  /<!--\s*agent-pipeline:review-decision-notification\s+([0-9a-f]{40})\s*-->/;

// Written only into the sticky status comment after the notification POST failed. It survives
// until a later retry succeeds, making delivery failure a visible gate blocker rather than a log
// line that disappears with the workflow run.
export const REVIEW_DECISION_DELIVERY_FAILURE_MARKER =
  "<!-- agent-pipeline:review-decision-delivery-failure";
const REVIEW_DECISION_DELIVERY_FAILURE_PATTERN =
  /<!--\s*agent-pipeline:review-decision-delivery-failure\s+([0-9a-f]{40})\s*-->/;
// `mode=none` records that the reconciler saw this head while nothing was chosen. That state is
// what lets the next run tell a fresh answer from one that predates the head entirely.
//
// `since` is when this head's choice was first seen and is carried through unchanged while head and
// mode hold. It is optional so records written before it existed keep parsing, and its format is
// pinned here rather than parsed loosely: the value re-enters the reconciler from a comment body.
const REVIEW_DECISION_PATTERN =
  /<!--\s*agent-pipeline:review-decision\s+([0-9a-f]{40})\s+mode=(cross|self|human|none)(?:\s+since=(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z))?\s*-->/;

// Published by a review session or by a trusted provider adapter when GitHub carries no native
// evidence for its result:
// `<!-- agent-pipeline:review-result <sha> mode=self verdict=pass session=<id> read-only=true -->`
export const REVIEW_RESULT_MARKER = "<!-- agent-pipeline:review-result";
export const REVIEW_RESULT_SOURCE =
  "<!--\\s*agent-pipeline:review-result\\s+([0-9a-f]{40})\\s+mode=(cross|self|human)\\s+verdict=(pass|changes-required|blocked)\\s+session=(\\S+)\\s+read-only=(true|verified|false)\\s*-->";
// Written by the cross-review workflow when a chosen review produced no published result:
// `<!-- agent-pipeline:review-start-notice <sha> mode=cross outcome=failed -->`. It lives here
// rather than beside the workflow adapter so the reconciler can report the failed attempt in its
// own status comment: that comment is what agents read, and without this they cannot tell a review
// that died from one still running.
export const REVIEW_START_NOTICE_MARKER = "<!-- agent-pipeline:review-start-notice";
// `mode` was `cross` only until the self-review workflow started writing this same marker; it is
// captured rather than fixed so both review-mode adapters share one parser.
export const REVIEW_START_NOTICE_PATTERN =
  /<!--\s*agent-pipeline:review-start-notice\s+([0-9a-f]{40})\s+mode=(cross|self)\s+outcome=(declined|failed)(?:\s+code=([a-z-]+))?(?:\s+attempt=([A-Za-z0-9._-]+))?\s*-->/;

/**
 * Reads the newest review-start notice, so the status comment can name a failed attempt.
 *
 * Only trusted authors count: the notice explains why a gate is still closed, and anyone able to
 * comment could otherwise fake an outcome for a head.
 */
export function parseReviewStartNotice(comments) {
  let found = null;
  for (const comment of comments ?? []) {
    if (!isTrustedCommentAuthor(comment)) continue;
    const match = comment?.body?.match(REVIEW_START_NOTICE_PATTERN);
    if (match) found = { headSha: match[1], mode: match[2], outcome: match[3] };
  }
  return found;
}

// Written by the reconciler itself, once, after it re-dispatches a cross-review workflow that
// declined only because the head was not ready yet at label time:
// `<!-- agent-pipeline:review-retrigger <sha> provider=claude -->`. The label-triggered workflow
// never retries on its own, so without this record every later reconciliation of the same head
// would see the identical "review declined, now ready" state and dispatch the workflow again.
export const REVIEW_RETRIGGER_MARKER = "<!-- agent-pipeline:review-retrigger";
const REVIEW_RETRIGGER_PATTERN =
  /<!--\s*agent-pipeline:review-retrigger\s+([0-9a-f]{40})\s+provider=(claude|codex)\s*-->/;

/**
 * Head SHAs the reconciler has already re-dispatched a cross-review workflow for.
 *
 * Only the reconciler's own identity counts: an untrusted comment claiming this marker could
 * otherwise suppress the one automatic retry a stuck head is waiting for.
 */
export function parseReviewRetriggerHeadShas(comments, config = loadConfig()) {
  const allowed = config.reviewRetriggerAuthors ?? [];
  const found = new Set();
  for (const comment of comments ?? []) {
    if (!allowed.includes(comment?.author)) continue;
    const match = comment?.body?.match(REVIEW_RETRIGGER_PATTERN);
    if (match) found.add(match[1]);
  }
  return [...found];
}

export const CLAUDE_CROSS_REVIEW_HEADING = "## Claude Cross-Review";
export const CLAUDE_CROSS_REVIEW_SOURCE = "claude-cross-review";
// Published by the same restricted, credential-read-only workflow as the cross-review, but for a
// same-provider `self` review: GitHub carries no native evidence for it either, so the trusted
// publisher's structured result is a second accepted source alongside a manually posted marker
// from one of the implementation provider's own identities.
export const CLAUDE_SELF_REVIEW_HEADING = "## Claude Self-Review";
export const CLAUDE_SELF_REVIEW_SOURCE = "claude-self-review";
export const REVIEW_START_FAILURE_MARKER = "<!-- agent-pipeline:review-start-failure";
const REVIEW_START_FAILURE_PATTERN =
  /<!--\s*agent-pipeline:review-start-failure\s+([0-9a-f]{40})\s+attempt=([A-Za-z0-9._-]+)\s*-->/;

// How strongly the reviewing session was kept away from the code, weakest first. The order is the
// comparison: a level satisfies a minimum when its index is at least the minimum's.
//
// - `false`    nothing outside the prompt stopped a write.
// - `verified` the launcher removed the editing tools, denied the writing git/gh commands, ran the
//              review in a throwaway worktree detached at the reviewed SHA, and checked afterwards
//              that the worktree was untouched. Credentials could still have written elsewhere, so
//              this detects a violation rather than preventing one.
// - `true`     additionally credentials without code write access, so a write fails server-side.
//
// `verified` exists because `true` is not reachable everywhere: a session whose only credentials
// can push cannot honestly claim it, which used to leave self-review unusable in exactly those
// environments. It is deliberately weaker, and the status comment says which level was reached.
export const REVIEW_READ_ONLY_LEVELS = ["false", "verified", "true"];
export const DEFAULT_SELF_REVIEW_MINIMUM = "verified";

/**
 * Whether `level` is at least as strong as `minimum`.
 *
 * The two arguments fail in opposite directions on purpose. An unknown `level` is read as the
 * weakest possible claim, so an unparseable marker never comes out stronger than an honest `false`.
 * An unknown `minimum` throws instead: it is repository policy, and silently ranking it at zero
 * would let a typo in `selfReviewMinimumEnforcement` — `"verifed"` for `"verified"` — accept every
 * marker including `read-only=false`, disabling the whole check without a failing test or a log
 * line. A misconfigured gate has to be loud.
 */
export function meetsReadOnlyMinimum(level, minimum = DEFAULT_SELF_REVIEW_MINIMUM) {
  if (!REVIEW_READ_ONLY_LEVELS.includes(minimum)) {
    throw new Error(
      `selfReviewMinimumEnforcement must be one of ${REVIEW_READ_ONLY_LEVELS.join(", ")}; got ` +
        `${JSON.stringify(minimum)}.`,
    );
  }
  const rank = (value) => {
    const index = REVIEW_READ_ONLY_LEVELS.indexOf(value);
    return index === -1 ? 0 : index;
  };
  return rank(level) >= rank(minimum);
}

export const REVIEW_MODES = ["cross", "self", "human"];

// Labels this phase owns and may both add and remove. Every other label on the pull request stays
// untouched, including labels a human added by hand.
const MANAGED_LABEL_KEYS = [
  "pipeline",
  "implementing",
  "ciFix",
  "conflictFix",
  "review",
  "readyForMerge",
  "uiChanged",
];

// The review-mode labels (`review:cross`, `review:self`, `review:human`) are the user's answer to
// who reviews the current head. They are read as input and never added here; the single write this
// module performs on them is removing one that was bound to an earlier head, which is what makes
// the question be asked again instead of an old answer applying to code the user never saw.

// Read as input, never written and never cleared: `needsHuman` (escalations raised by a human or
// by the later provider phases, for example an exhausted round limit, which cannot be derived from
// GitHub state), `waiting` and `reviewFallback` (owned by those phases), and `noAuto` (the manual
// kill switch). The one escalation this phase can derive — a protected path awaiting human
// approval — gets its own phase instead of borrowing this label, so that clearing it needs no
// label bookkeeping and a genuine escalation is never wiped by a sweep.

// Phases without an entry carry no phase label of their own. `waiting` and `needs-human` are
// already described by the label that produced them, and `awaiting-human-approval` has no label in
// the plan's set — inventing one here would go beyond this phase.
const PHASE_LABEL_KEYS = {
  implementing: "implementing",
  "ci-fix": "ciFix",
  "conflict-fix": "conflictFix",
  review: "review",
  "ready-for-merge": "readyForMerge",
};

const FAILING_CONCLUSIONS = new Set([
  "failure",
  "timed_out",
  "cancelled",
  "action_required",
  "startup_failure",
  "stale",
]);

const PASSING_CONCLUSIONS = new Set(["success", "neutral", "skipped"]);

// GitHub's author_association values that imply write access to this repository. Anything else —
// CONTRIBUTOR, FIRST_TIME_CONTRIBUTOR, NONE — is an outsider on a public repository.
const WRITE_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

function labelName(config, key) {
  return config.labels[key];
}

/** The regular cross-review always comes from the other provider. */
export function reviewerProviderFor(implementer, config) {
  const providers = Object.keys(config.branchPrefixes ?? {});
  return providers.find((provider) => provider !== implementer) ?? null;
}

function isBotLogin(login) {
  return typeof login === "string" && login.endsWith("[bot]");
}

// How the Codex integration reports a review that found nothing.
//
// It submits a native GitHub review only when it has findings; a clean pass arrives as a plain
// comment, so the head it reviewed was invisible to a gate that reads submitted reviews only. That
// left the pull request blocked on a review which demonstrably happened — observed on #392, where
// the requested review answered with exactly this and `get_reviews` stayed empty.
//
// The comment does name its head, which is what makes it usable: `**Reviewed commit:** `836976f3ff``.
// Both halves are required, because the same integration prints that line on the comment that
// accompanies *findings* too, and only the clean-pass wording separates the two.
const PROVIDER_REVIEWED_COMMIT_PATTERN = /reviewed commit:?\**\s*`?([0-9a-f]{7,40})`?/i;
const PROVIDER_CLEAN_PASS_PATTERN = /did\s?n[o']t find any (?:major )?issues/i;

/**
 * Whether the counter provider reported a finding-free review of this exact head in a comment.
 *
 * Deliberately narrow. The author must be the configured reviewer identity, so no one else can
 * declare a review; the comment must name a SHA that is a prefix of the current head, so it cannot
 * be inherited by a later commit; and it must carry the clean-pass wording, so the comment that
 * accompanies findings is not mistaken for one. A wording change on the provider's side makes this
 * return false again — the gate becomes stricter, never looser, which is the safe direction.
 */
export function parseProviderCleanPass(comments, headSha, allowedReviewerLogins) {
  if (!/^[0-9a-f]{40}$/.test(headSha ?? "")) return false;
  const allowed = allowedReviewerLogins ?? [];
  return (comments ?? []).some((comment) => {
    const author = comment?.author ?? null;
    if (!allowed.includes(author) || !isBotLogin(author)) return false;
    const body = comment?.body ?? "";
    if (!PROVIDER_CLEAN_PASS_PATTERN.test(body)) return false;
    const reviewed = body.match(PROVIDER_REVIEWED_COMMIT_PATTERN)?.[1];
    return Boolean(reviewed) && headSha.startsWith(reviewed.toLowerCase());
  });
}

/**
 * Reduces the reviews that belong to the current head SHA to a single verdict.
 *
 * Reviews for any other SHA are dropped entirely, so a stale approval can never open the gate.
 * Only the latest review per author counts, and a plain comment never carries a verdict.
 */
export function evaluateReviews(
  reviews,
  headSha,
  allowedReviewerLogins,
  pullRequestAuthorLogin = null,
) {
  // `allowedReviewerLogins` must be the reviewer allowlist, never the author allowlist: the latter
  // contains the human maintainer, whose approval would otherwise silently count as the counter
  // provider's cross-review and collapse both gates into one click.
  const currentHead = (reviews ?? []).filter(
    (review) => review.commitSha === headSha,
  );

  const latestByAuthor = new Map();
  for (const review of currentHead) {
    if (review.state === "COMMENTED" || review.state === "DISMISSED") continue;
    const previous = latestByAuthor.get(review.author);
    if (
      !previous ||
      (review.submittedAt ?? "") >= (previous.submittedAt ?? "")
    ) {
      latestByAuthor.set(review.author, review);
    }
  }

  const isCounterProvider = (review) =>
    (allowedReviewerLogins ?? []).includes(review.author) &&
    // A human is never the counter provider, even if their login were listed by mistake.
    isBotLogin(review.author);

  const decisive = [...latestByAuthor.values()];
  const fromReviewer = decisive.filter(isCounterProvider);

  let verdict = "none";
  if (fromReviewer.some((review) => review.state === "CHANGES_REQUESTED")) {
    verdict = "changes-required";
  } else if (fromReviewer.some((review) => review.state === "APPROVED")) {
    verdict = "pass";
  }

  // Did the counter provider look at *this* head at all? Deliberately counts `COMMENTED`, which
  // the loop above skips because it decides nothing on its own.
  //
  // This exists because the Codex integration never submits an approving review. Requiring
  // `APPROVED` therefore left `cross` permanently unsatisfiable — the review ran, found real
  // defects, confirmed the fixes, and the gate still reported that nothing had reviewed the head.
  //
  // What it does submit depends on how the review came about, and the difference matters:
  //
  // - An **automatic** pass with nothing to say may only leave a thumbs-up reaction. That is no
  //   evidence here and cannot become any: a reaction carries no commit SHA, so it could never be
  //   bound to the head it supposedly judged.
  // - An **explicitly requested** review — how this pipeline always asks — is submitted as
  //   `COMMENTED`, including when it reports no findings.
  //
  // Stating only the first half of that once cost a review round: it reads as "a clean pass leaves
  // nothing to read", which would make this whole function pointless, and it was filed as a defect
  // on exactly those grounds.
  //
  // `DISMISSED` stays excluded: a withdrawn review is not a review.
  const reviewedByProvider = currentHead.some(
    (review) => review.state !== "DISMISSED" && isCounterProvider(review),
  );

  // The repository is public, so anyone with a GitHub account can approve a pull request here.
  // Only an approval from someone who could write to the repository anyway may satisfy the
  // protected-path gate; a drive-by approval from an outsider must not.
  //
  // GitHub never lets a pull-request author approve their own pull request. In the explicitly
  // chosen human-review mode, the author's native `COMMENTED` review is therefore the only review
  // signal they can submit themselves. It still carries the exact commit SHA, and the author plus
  // write-association checks below keep it from becoming an arbitrary issue comment or outsider
  // signal. Protected paths deliberately do not use this exception: they still need an independent
  // approval.
  const latestAuthorReview = currentHead
    .filter(
      (review) =>
        review.author === pullRequestAuthorLogin &&
        !isBotLogin(review.author),
    )
    .reduce(
      (latest, review) =>
        !latest || (review.submittedAt ?? "") >= (latest.submittedAt ?? "")
          ? review
          : latest,
      null,
    );
  const authorReview =
    latestAuthorReview?.state === "COMMENTED" &&
    WRITE_ASSOCIATIONS.has(latestAuthorReview.authorAssociation);
  const humanApproval = decisive.some(
    (review) =>
      review.state === "APPROVED" &&
      !isBotLogin(review.author) &&
      WRITE_ASSOCIATIONS.has(review.authorAssociation),
  );
  const humanReview = humanApproval || authorReview;

  return { verdict, humanApproval, humanReview, reviewedByProvider };
}

// What counts as evidence that the counter provider reviewed the current head.
//
// - `approval`             an approving review, the strongest signal GitHub offers.
// - `reviewed-and-resolved` the counter provider reviewed this exact head and none of the findings
//                           it raised are still open.
//
// The second is weaker and says so: it infers "nothing left to object to" from an absence rather
// than reading a statement. It is the default because the first is not reachable with the current
// Codex integration, and a gate condition nothing can ever satisfy is not a stricter gate — it is a
// broken one that pushes everyone towards `human` or towards not using the pipeline at all.
export const CROSS_REVIEW_EVIDENCE_MODES = ["approval", "reviewed-and-resolved"];
export const DEFAULT_CROSS_REVIEW_EVIDENCE = "reviewed-and-resolved";

/**
 * True for check runs the pipeline produces itself.
 *
 * The reconcile workflow runs on `pull_request_target`, and those check runs attach to the pull
 * request's head SHA — the very list this function guards. Without the exclusion the reconciler
 * reads its own job as a gating check: `in_progress` while it runs, and `cancelled` after
 * `cancel-in-progress` aborts it, which would look like a CI failure that never existed.
 *
 * Matrix jobs are reported as `<job name> (<value>)`, so a configured name also matches its
 * parenthesised variants. `selfCheckNames` must stay in sync with the job names in
 * `.github/workflows/agent-pipeline-reconcile.yml`.
 */
export function isOwnCheckRun(name, config) {
  if (typeof name !== "string") return false;
  if (name === config.statusContext) return true;
  return (config.selfCheckNames ?? []).some(
    (own) => name === own || name.startsWith(`${own} (`),
  );
}

/**
 * Check runs are fetched per SHA. A snapshot carrying results for a different SHA counts as
 * unknown rather than as a pass.
 */
export function evaluateChecks(snapshot, config) {
  if (
    snapshot.checkRunsHeadSha &&
    snapshot.checkRunsHeadSha !== snapshot.headSha
  ) {
    return { state: "unknown", failing: [], pending: [] };
  }

  const relevant = (snapshot.checkRuns ?? []).filter(
    (run) => !isOwnCheckRun(run.name, config),
  );

  const failing = [];
  const pending = [];
  for (const run of relevant) {
    if (run.status !== "completed") {
      pending.push(run.name);
    } else if (FAILING_CONCLUSIONS.has(run.conclusion)) {
      failing.push(run.name);
    } else if (!PASSING_CONCLUSIONS.has(run.conclusion)) {
      // An unknown conclusion is not evidence of success.
      pending.push(run.name);
    }
  }

  if (failing.length) return { state: "failing", failing, pending };
  if (pending.length) return { state: "pending", failing, pending };
  if (!relevant.length) return { state: "unknown", failing, pending };
  return { state: "passing", failing, pending };
}

/**
 * An unresolved, non-outdated review thread blocks the gate. An outdated thread points at code
 * that no longer exists on the current head and is therefore not actionable.
 */
// Matches the configured value on purpose: a deleted or broken key should behave like the intended
// setting, not silently switch the escalation to a different, quieter one.
export const DEFAULT_WAITING_ESCALATION_HOURS = 2;

/** A missing or nonsensical setting must not disable the escalation, so it falls back. */
export function waitingEscalationHours(config = loadConfig()) {
  const configured = Number(config?.waitingEscalationHours);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_WAITING_ESCALATION_HOURS;
}

/**
 * How long the current head has been waiting for a review it was already cleared for.
 *
 * The clock starts at the later of two moments, because a review can only stall once both have
 * passed: the newest completion among the head's *foreign* checks, and the moment its review mode
 * was chosen. Own check runs are excluded — they complete on every sweep and would push the anchor
 * forward forever, so a stalled review would never age. Counting from the checks alone would do the
 * opposite: a mode picked hours after CI went green would be reported overdue the instant it was
 * chosen, before its reviewer had a moment to start.
 *
 * Returns null while no anchor exists, so an unknown age never escalates on its own.
 */
export function reviewWaitingHours(snapshot, config = loadConfig(), chosenAt = null) {
  const observed = Date.parse(snapshot?.observedAt ?? "");
  if (!Number.isFinite(observed)) return null;
  let anchor = null;
  for (const run of snapshot?.checkRuns ?? []) {
    if (isOwnCheckRun(run?.name, config)) continue;
    const completed = Date.parse(run?.completedAt ?? "");
    if (!Number.isFinite(completed)) continue;
    if (anchor === null || completed > anchor) anchor = completed;
  }
  const chosen = Date.parse(chosenAt ?? "");
  if (Number.isFinite(chosen) && (anchor === null || chosen > anchor)) anchor = chosen;
  if (anchor === null) return null;
  return Math.max(0, (observed - anchor) / 3_600_000);
}

export function evaluateReviewThreads(threads) {
  const blocking = (threads ?? []).filter(
    (thread) => !thread.isResolved && !thread.isOutdated,
  );
  return { blockingCount: blocking.length };
}

/**
 * True for a comment the pipeline may act on.
 *
 * The repository is public, so anyone can comment on a participating pull request. A marker in a
 * stranger's comment must not clear a gate or be adopted as the pipeline's own status comment.
 * Apps can only comment once an admin installed them, so a bot author counts as trusted.
 */
export function isTrustedCommentAuthor(comment) {
  return (
    isBotLogin(comment?.author) ||
    WRITE_ASSOCIATIONS.has(comment?.authorAssociation)
  );
}

/**
 * Extracts the head SHA a UI/UX notice was written for.
 *
 * Only trusted authors count: the notice satisfies a merge gate, so anyone able to post one could
 * otherwise declare a UI change reviewed that nobody ever looked at. Returns the newest match so a
 * re-sent notice supersedes an older one, and null when no trusted comment carries a well-formed
 * marker.
 */
export function parseUiNoticeHeadSha(comments) {
  let found = null;
  for (const comment of comments ?? []) {
    if (!isTrustedCommentAuthor(comment)) continue;
    const match = comment?.body?.match(UI_NOTICE_PATTERN);
    if (match) found = match[1];
  }
  return found;
}

/**
 * Head SHAs whose review choice was actively delivered in a separate GitHub comment.
 *
 * Only the configured reconciler identity counts. Trusting every installed bot here would let an
 * unrelated app suppress the one notification the maintainer is supposed to receive.
 */
export function parseReviewDecisionNotificationHeadShas(
  comments,
  config = loadConfig(),
) {
  const allowed = config.reviewDecisionNotificationAuthors ?? [];
  const found = new Set();
  for (const comment of comments ?? []) {
    if (!allowed.includes(comment?.author)) continue;
    const match = comment?.body?.match(REVIEW_DECISION_NOTIFICATION_PATTERN);
    if (match) found.add(match[1]);
  }
  return [...found];
}

/** The current head whose last delivery attempt failed, as recorded in the sticky comment. */
export function parseReviewDecisionDeliveryFailure(body) {
  const match = body?.match(REVIEW_DECISION_DELIVERY_FAILURE_PATTERN);
  return match?.[1] ?? null;
}

/**
 * Reads the review-mode binding out of a status comment body.
 *
 * The caller decides whose comment this is — see `statusCommentBody`, which is what actually
 * enforces "the reconciler's own".
 */
export function parseReviewDecision(body) {
  // The reconciler writes this record as the final line of its own status comment. Requiring that
  // position prevents a PR-controlled value interpolated earlier in the body from impersonating
  // the observation record, even if a future field misses output escaping.
  const finalRecordPattern = new RegExp(`${REVIEW_DECISION_PATTERN.source}\\s*$`);
  const match = body?.match(finalRecordPattern);
  return match ? { headSha: match[1], mode: match[2], since: match[3] ?? null } : null;
}

export function parseHandledReviewStartFailure(body) {
  const match = String(body ?? "").match(REVIEW_START_FAILURE_PATTERN);
  return match ? { headSha: match[1], attempt: match[2] } : null;
}

/**
 * The status comment body, but only from an identity that may write the pipeline's own comment.
 *
 * The snapshot picks the status comment by marker prefix and `isTrustedCommentAuthor`, which is
 * deliberately wide — it accepts every `[bot]` login so that installed apps can be read at all.
 * That is fine for adopting a comment to update, and too wide for the decision record: since this
 * record became gate-relevant, a decoy comment carrying the marker could otherwise bind an old
 * label to the current head whenever the real status comment is missing. `statusCommentAuthors`
 * narrows that to the identities that actually run this reconciler.
 */
export function statusCommentBody(snapshot, config = loadConfig()) {
  const allowed = config.statusCommentAuthors ?? [];
  return allowed.includes(snapshot.statusCommentAuthor)
    ? (snapshot.statusCommentBody ?? null)
    : null;
}

/**
 * Collects every published review result, in comment order.
 *
 * Only trusted authors count, for the same reason the UI notice does: a result satisfies a merge
 * gate, so an outsider must not be able to declare a review passed that nobody performed.
 */
export function parseReviewResults(comments) {
  const results = [];
  for (const comment of comments ?? []) {
    if (!isTrustedCommentAuthor(comment)) continue;
    const matches = comment?.body?.matchAll(new RegExp(REVIEW_RESULT_SOURCE, "g")) ?? [];
    for (const match of matches) {
      results.push({
        headSha: match[1],
        mode: match[2],
        verdict: match[3],
        sessionId: match[4],
        // The level as published. Whether it satisfies the gate is a separate question, answered by
        // `meetsReadOnlyMinimum` against repository policy rather than by a boolean here.
        readOnly: match[5],
        author: comment.author ?? null,
        // The Actions publisher has to share github-actions[bot] with the reconciler and possibly
        // other workflows. Its exact leading heading therefore forms an additional provenance
        // boundary: a marker merely echoed inside another bot comment is not Claude evidence.
        source: String(comment.body).startsWith(`${CLAUDE_CROSS_REVIEW_HEADING}\n`)
          ? CLAUDE_CROSS_REVIEW_SOURCE
          : String(comment.body).startsWith(`${CLAUDE_SELF_REVIEW_HEADING}\n`)
            ? CLAUDE_SELF_REVIEW_SOURCE
            : null,
        createdAt: comment.createdAt ?? null,
      });
    }
  }
  return results;
}

const FINDING_SEVERITIES = ["high", "medium", "low"];

function reviewEvidenceAuthors(config) {
  return new Set([
    ...Object.values(config.providerAuthorAllowlist ?? {}).flat(),
    ...Object.values(config.providerReviewerAllowlist ?? {}).flat(),
    ...Object.values(config.crossReviewResultAuthors ?? {}).flat(),
  ]);
}

/** Counts structured finding severities for one reviewed head without trusting unrelated text. */
export function summarizeReviewFindings(
  comments,
  reviews,
  headSha,
  config = loadConfig(),
) {
  const counts = { high: 0, medium: 0, low: 0 };
  let known = false;
  const bodies = [];
  const allowedAuthors = reviewEvidenceAuthors(config);

  for (const comment of comments ?? []) {
    if (!isTrustedCommentAuthor(comment) || !allowedAuthors.has(comment.author)) continue;
    const body = String(comment.body ?? "");
    const markers = [...body.matchAll(new RegExp(REVIEW_RESULT_SOURCE, "g"))];
    if (!markers.some((match) => match[1] === headSha)) continue;
    bodies.push(body);
  }
  for (const review of reviews ?? []) {
    if (
      review.commitSha !== headSha ||
      review.state === "DISMISSED" ||
      !allowedAuthors.has(review.author)
    ) {
      continue;
    }
    if (review.body) bodies.push(String(review.body));
  }

  for (const body of bodies) {
    for (const line of body.split(/\r?\n/)) {
      const named = line.match(/\[(high|medium|low)\]/i)?.[1]?.toLowerCase();
      if (named && FINDING_SEVERITIES.includes(named)) {
        counts[named] += 1;
        known = true;
        continue;
      }
      const priority = line.match(/\[P([0-3])\]/i)?.[1];
      if (priority !== undefined) {
        counts[priority === "0" || priority === "1" ? "high" : priority === "2" ? "medium" : "low"] += 1;
        known = true;
      }
    }
  }

  return { known, ...counts, total: counts.high + counts.medium + counts.low };
}

/** Most recently completed review head before the current one, or null for the first round. */
export function previousReviewedHead(
  reviewResults,
  reviews,
  currentHeadSha,
  config = loadConfig(),
) {
  const candidates = [];
  const allowedAuthors = reviewEvidenceAuthors(config);
  for (const result of reviewResults ?? []) {
    if (result.headSha === currentHeadSha || !allowedAuthors.has(result.author)) continue;
    candidates.push({
      headSha: result.headSha,
      at: result.createdAt ?? "",
      order: candidates.length,
    });
  }
  for (const review of reviews ?? []) {
    if (
      !/^[0-9a-f]{40}$/i.test(review.commitSha ?? "") ||
      review.commitSha === currentHeadSha ||
      review.state === "DISMISSED" ||
      !allowedAuthors.has(review.author)
    ) {
      continue;
    }
    candidates.push({
      headSha: review.commitSha,
      at: review.submittedAt ?? "",
      order: candidates.length,
    });
  }
  candidates.sort((left, right) =>
    left.at === right.at ? left.order - right.order : left.at.localeCompare(right.at),
  );
  return candidates.at(-1)?.headSha ?? null;
}

function summarizeChangedFiles(files, baseSha, headSha, commits = null) {
  const list = files ?? [];
  return {
    baseSha,
    headSha,
    commits,
    filesChanged: list.length,
    additions: list.reduce((sum, file) => sum + (Number(file.additions) || 0), 0),
    deletions: list.reduce((sum, file) => sum + (Number(file.deletions) || 0), 0),
    files: list.map((file) => file.filename).filter(Boolean),
  };
}

/** Trusted provider-start failures, newest last. A legacy notice uses its comment id as attempt. */
export function parseReviewStartFailures(
  comments,
  allowedAuthors = loadConfig().crossReviewResultAuthors?.claude ?? [],
) {
  const failures = [];
  for (const comment of comments ?? []) {
    if (!isTrustedCommentAuthor(comment) || !allowedAuthors.includes(comment.author)) continue;
    const match = String(comment.body ?? "").match(REVIEW_START_NOTICE_PATTERN);
    if (!match) continue;
    const reason = String(comment.body ?? "").match(/^- Grund: `([^`]+)`/m)?.[1] ?? "unknown";
    failures.push({
      headSha: match[1],
      mode: match[2],
      outcome: match[3],
      code: match[4] ?? "unknown",
      attempt: match[5] ?? `comment-${comment.id}`,
      reason,
    });
  }
  return failures;
}

function latestReviewStartFailure(failures, headSha) {
  let found = null;
  for (const failure of failures ?? []) {
    if (failure.headSha === headSha) found = failure;
  }
  return found;
}

/**
 * The newest published result for exactly this head and mode, from an identity allowed to produce
 * one, or null. Callers supply either the implementation provider's self-review identities or a
 * counter-provider adapter's dedicated publisher identities.
 *
 * `isTrustedCommentAuthor` alone is too wide here: it accepts every `[bot]` login, so any app
 * installed on the repository could post a passing result. Native cross-reviews use
 * `providerReviewerAllowlist`; structured cross-results use their separate publisher allowlist and
 * source discriminator. Self-review callers pass only the implementation provider's identities.
 */
export function latestReviewResult(
  results,
  headSha,
  mode,
  allowedAuthors,
  requiredSource = null,
) {
  const allowed = allowedAuthors ?? [];
  let found = null;
  for (const result of results ?? []) {
    if (result.headSha !== headSha || result.mode !== mode) continue;
    if (!allowed.includes(result.author)) continue;
    if (requiredSource && result.source !== requiredSource) continue;
    found = result;
  }
  return found;
}

/**
 * Like `latestReviewResult`, but accepts a result matching any of several (authors, source) pairs.
 *
 * A `self` review has two legitimate origins: a manually posted marker from one of the
 * implementation provider's own identities (no source heading required), or a structured result
 * from the trusted, credential-read-only workflow (author plus its self-review source heading,
 * exactly like the cross-review publisher). Both are valid evidence, and whichever comment is
 * newest — by iteration order, the same rule `latestReviewResult` uses — wins.
 */
export function latestReviewResultFromAny(results, headSha, mode, candidates) {
  let found = null;
  for (const result of results ?? []) {
    if (result.headSha !== headSha || result.mode !== mode) continue;
    const eligible = candidates.some(
      ({ authors, source }) =>
        (authors ?? []).includes(result.author) && (!source || result.source === source),
    );
    if (!eligible) continue;
    found = result;
  }
  return found;
}

/** Identities that may publish a review result for a provider: its agent and its human operator. */
export function resultAuthorsFor(provider, config = loadConfig()) {
  return [
    ...(config.providerReviewerAllowlist?.[provider] ?? []),
    ...(config.providerAuthorAllowlist?.[provider] ?? []),
  ];
}

/**
 * Resolves which review mode applies to the current head.
 *
 * The label is the user's answer and is never written by the pipeline. What makes an answer belong
 * to one head is the observation record in the reconciler's own status comment, which is written on
 * every run — including as `mode=none` when nothing is chosen yet. That "seen this head, no choice
 * yet" state is what the whole binding rests on:
 *
 * - A label only binds when a record for the *current* head already exists. The run that wrote that
 *   record removed any label standing at the time, so a label sitting next to it must have arrived
 *   afterwards, and therefore refers to this head.
 * - No record for the current head means the reconciler cannot vouch for the label: it may predate
 *   the head entirely (status comment deleted, automation paused, bootstrap run skipped). It is
 *   removed and the question is asked again.
 *
 * Without the `none` state those two cases are indistinguishable, and the ambiguity resolves
 * towards accepting an answer the user gave for code they never saw. It resolves towards asking
 * once more instead — at the price of one extra round when a label is set in the same moment a new
 * head appears.
 *
 * Switching the label at the same head is a legitimate correction — the counter provider running
 * out of quota is exactly the case this feature exists for — and simply rebinds to the new mode.
 */
export function evaluateReviewDecision(snapshot, config = loadConfig()) {
  const labels = new Set(snapshot.labels ?? []);
  const modeLabels = config.reviewModeLabels ?? {};
  const chosen = REVIEW_MODES.filter((mode) => labels.has(modeLabels[mode]));

  // Written on every run, so the next one can tell "this head was already seen" from "no idea".
  const observed = { headSha: snapshot.headSha, mode: "none", since: null };
  const record = parseReviewDecision(statusCommentBody(snapshot, config));
  const seenThisHead = record?.headSha === snapshot.headSha;

  if (chosen.length > 1) {
    // Two answers are no answer. Removing one would be picking for the user — and because nothing
    // is removed here, this run must not record the head either: a record says "any label standing
    // now arrived after me", which would be false while two untouched labels remain. Writing it
    // would let one of them bind to a head it was never chosen for once the other is removed. The
    // previous record is carried through unchanged instead.
    return {
      mode: null,
      ambiguous: true,
      chosenLabels: chosen.map((mode) => modeLabels[mode]),
      staleLabels: [],
      record,
    };
  }

  if (!chosen.length) {
    return {
      mode: null,
      ambiguous: false,
      chosenLabels: [],
      staleLabels: [],
      record: observed,
    };
  }

  const mode = chosen[0];
  if (!seenThisHead) {
    return {
      mode: null,
      ambiguous: false,
      chosenLabels: [modeLabels[mode]],
      staleLabels: [modeLabels[mode]],
      record: observed,
      unboundReason: record ? "earlier-head" : "never-observed",
    };
  }

  // The choice's own clock starts when this head's mode was first observed and is carried through
  // untouched while head and mode hold. Re-stamping on every sweep would keep a stalled review
  // permanently young; taking the head's check completion instead would age a choice the user had
  // not yet made.
  const since =
    record?.mode === mode && record.since ? record.since : (snapshot.observedAt ?? null);

  return {
    mode,
    ambiguous: false,
    chosenLabels: [modeLabels[mode]],
    staleLabels: [],
    record: { headSha: snapshot.headSha, mode, since },
  };
}

/** True when a review already passed for some earlier head of this pull request. */
export function hasEarlierPassingReview(snapshot, allowedReviewerLogins) {
  const earlierApproval = (snapshot.reviews ?? []).some(
    (review) =>
      review.commitSha !== snapshot.headSha &&
      review.state === "APPROVED" &&
      ((allowedReviewerLogins ?? []).includes(review.author) ||
        (!isBotLogin(review.author) &&
          WRITE_ASSOCIATIONS.has(review.authorAssociation))),
  );
  const earlierResult = (snapshot.reviewResults ?? []).some(
    (result) => result.headSha !== snapshot.headSha && result.verdict === "pass",
  );
  return earlierApproval || earlierResult;
}

function isDocumentationPath(path) {
  return path.startsWith("docs/") || path.endsWith(".md");
}

/**
 * Advises which review mode fits the current head. Advisory only — it never changes the gate.
 *
 * It reasons about what the reconciler can actually see: the changed paths and whether an earlier
 * head already passed a review. The severity of the findings that were just fixed is the stronger
 * signal, but it lives in the review session, not in GitHub state, so the session-side flow in
 * `.github/agent-pipeline/review-decision.md` refines this recommendation rather than replacing it.
 */
export function recommendReviewMode(
  { changedFiles, protectedPaths, priorReviewPassed },
  config = loadConfig(),
) {
  const files = changedFiles ?? [];

  if ((protectedPaths ?? []).length) {
    return {
      mode: "cross",
      reason:
        "workflow or infrastructure paths changed and need the most independent review available",
    };
  }

  const sensitive = matchingPaths(files, config.sensitivePathPrefixes);
  if (sensitive.length) {
    return {
      mode: "cross",
      reason: `sensitive paths changed (${sensitive.slice(0, 3).join(", ")})`,
    };
  }

  if (files.length && files.every(isDocumentationPath)) {
    return {
      mode: "human",
      reason: "only documentation changed, so a read-through is enough",
    };
  }

  if (priorReviewPassed) {
    return {
      mode: "self",
      reason:
        "an earlier head already passed a review and the remaining change touches no sensitive path",
    };
  }

  return {
    mode: "cross",
    reason: "no review has passed for this pull request yet",
  };
}

function evaluateMergeability(snapshot) {
  if (snapshot.mergeable === false) return "conflicted";
  if (snapshot.mergeable !== true) return "unknown";
  if (snapshot.mergeStateStatus === "BEHIND") return "behind";
  return "clean";
}

function matchingPaths(changedFiles, prefixes) {
  return (changedFiles ?? []).filter((path) =>
    (prefixes ?? []).some((prefix) => path.startsWith(prefix)),
  );
}

/**
 * Computes phase, blockers and derived facts from a snapshot.
 *
 * Pure: no I/O, no clock, no randomness. The caller decides what to do with the result.
 */
export function deriveReadiness(snapshot, config = loadConfig()) {
  const labels = snapshot.labels ?? [];
  const hasLabel = (key) => labels.includes(labelName(config, key));

  // Closed/merged first: a pull request is history the moment it leaves the open state, and
  // labels outlive that transition, so a stale `agent:no-auto` must never resurrect it as
  // "still being worked on" below.
  if (snapshot.state !== "open") {
    return {
      participating: false,
      mutate: false,
      phase: "closed",
      ready: false,
      blockers: [],
    };
  }

  // Kill switch: an operator disabled automation for this pull request.
  if (hasLabel("noAuto")) {
    return {
      participating: true,
      mutate: false,
      phase: "no-auto",
      ready: false,
      blockers: [
        "Automation is disabled for this pull request via the kill-switch label.",
      ],
    };
  }

  // Fork pull requests never take part in the writing automation. The pull-request body is under
  // the fork author's control, so deciding this after parsing the contract would let an outsider
  // steer the pipeline bot into labelling and commenting on their own pull request.
  if (snapshot.headRepository !== snapshot.repository) {
    return {
      participating: false,
      mutate: false,
      phase: "fork",
      ready: false,
      blockers: [],
    };
  }

  const parsed = parseTaskContract(snapshot.body);
  const pipelineLabel = labelName(config, "pipeline");
  const agentBranch = Object.values(config.branchPrefixes ?? {}).some((prefix) =>
    snapshot.headBranch?.startsWith(prefix),
  );
  const explicitlyLabeled = (snapshot.labels ?? []).includes(pipelineLabel);
  if (!parsed.participating && !agentBranch && !explicitlyLabeled) {
    return {
      participating: false,
      mutate: false,
      phase: "not-participating",
      ready: false,
      blockers: [],
    };
  }

  // An agent-looking pull request may not opt out of the required readiness gate by deleting or
  // leaving the task contract untouched. A genuinely manual branch outside the agent namespaces
  // still receives the stable "does not apply" success verdict above.
  if (!parsed.participating) {
    const uiPathChanged =
      matchingPaths(snapshot.changedFiles, config.uiPathPrefixes).length > 0;
    return {
      participating: true,
      mutate: true,
      phase: "contract-invalid",
      ready: false,
      blockers: [
        "Invalid task contract: an agent branch or agent:pipeline label requires an activated task contract.",
      ],
      contract: null,
      details: {
        uiChanged: uiPathChanged,
        reviewDecision: { record: parseReviewDecision(statusCommentBody(snapshot, config)) },
      },
    };
  }

  const validation = validateTaskContract(
    parsed.contract,
    {
      repository: snapshot.repository,
      headRepository: snapshot.headRepository,
      authorLogin: snapshot.authorLogin,
      baseBranch: snapshot.baseBranch,
      headBranch: snapshot.headBranch,
      changedFiles: snapshot.changedFiles ?? [],
    },
    config,
  );

  // Derived from the changed paths alone, so it survives a temporarily broken contract.
  const uiPathChanged =
    matchingPaths(snapshot.changedFiles, config.uiPathPrefixes).length > 0;

  const contractErrors = [...parsed.errors, ...validation.errors];
  if (contractErrors.length) {
    // A broken contract is a diagnosis, never a reason to guess and act. It stays self-healing:
    // fixing the pull-request body clears it without human label bookkeeping, and the contract
    // check already blocks the merge on its own.
    return {
      participating: true,
      mutate: true,
      phase: "contract-invalid",
      ready: false,
      blockers: contractErrors.map((error) => `Invalid task contract: ${error}`),
      contract: validation.normalized,
      // Keep reporting a UI change here; dropping it would strip a still-correct `ui:changed`.
      // The decision record is carried through for the same reason: this branch still rewrites the
      // status comment, so omitting it would erase the binding of an unchanged head, and repairing
      // the pull-request body would cost the user a second answer about code they already judged.
      details: {
        uiChanged: uiPathChanged,
        reviewDecision: { record: parseReviewDecision(statusCommentBody(snapshot, config)) },
      },
    };
  }

  const contract = validation.normalized;
  const blockers = [];

  // Escalations this phase cannot derive: raised by a human or by a later provider phase, and
  // cleared the same way. Automation must not resume on its own while one is set.
  const escalated = hasLabel("needsHuman");
  if (escalated) {
    blockers.push(
      "A human decision is pending; the escalation label is still set.",
    );
  }
  const waiting = hasLabel("waiting");
  if (waiting) {
    blockers.push("A required provider or service is temporarily unavailable.");
  }
  if (snapshot.isDraft) {
    blockers.push("The pull request is still a draft.");
  }

  const mergeability = evaluateMergeability(snapshot);
  if (mergeability === "conflicted") {
    blockers.push("The pull request has a merge conflict with its base branch.");
  } else if (mergeability === "behind") {
    blockers.push("The branch is behind its base branch and must be updated.");
  } else if (mergeability === "unknown") {
    blockers.push(
      "GitHub has not reported a mergeable state for the current head yet.",
    );
  }

  const checks = evaluateChecks(snapshot, config);
  if (checks.state === "failing") {
    blockers.push(`Checks are failing: ${checks.failing.join(", ")}.`);
  } else if (checks.state === "pending") {
    blockers.push(`Checks are still running: ${checks.pending.join(", ")}.`);
  } else if (checks.state === "unknown") {
    blockers.push("No check results are available for the current head SHA.");
  }

  // Computed before the review evidence because the review mode decides what evidence even counts,
  // and because a missing choice is only worth reporting once everything mechanical is green.
  const threadsReadable = snapshot.reviewThreadsReadable !== false;
  const threads = evaluateReviewThreads(snapshot.reviewThreads);
  const protectedPaths = matchingPaths(
    snapshot.changedFiles,
    config.protectedPathPrefixes,
  );
  // Draft status blocks the final merge gate, but deliberately does not block choosing or
  // running the review. This lets the implementation stay non-mergeable while review feedback
  // is already processed.
  const mechanicallyGreen =
    !escalated &&
    !waiting &&
    threadsReadable &&
    mergeability === "clean" &&
    checks.state === "passing";

  const reviewerProvider = reviewerProviderFor(contract.implementer, config);
  const allowedReviewers =
    config.providerReviewerAllowlist?.[reviewerProvider] ?? [];
  const reviews = evaluateReviews(
    snapshot.reviews,
    snapshot.headSha,
    allowedReviewers,
    snapshot.authorLogin,
  );
  // A provider that submits a review only when it has findings would otherwise leave a clean pass
  // unreadable, blocking a head it demonstrably reviewed. The comment names the head it checked, so
  // it is evidence for that head and no other.
  const providerCleanPass = parseProviderCleanPass(
    snapshot.comments,
    snapshot.headSha,
    allowedReviewers,
  );
  if (providerCleanPass) reviews.reviewedByProvider = true;
  // Some provider integrations return structured output instead of submitting a native GitHub
  // review. Only the dedicated publisher identities configured for that provider may bridge such
  // an output into the same head-bound result marker used by self reviews. Keeping this allowlist
  // separate avoids treating every github-actions[bot] review as if it came from Claude.
  const crossResult = latestReviewResult(
    snapshot.reviewResults,
    snapshot.headSha,
    "cross",
    config.crossReviewResultAuthors?.[reviewerProvider] ?? [],
    reviewerProvider === "claude" ? CLAUDE_CROSS_REVIEW_SOURCE : null,
  );

  // Who reviews this head is the user's decision, not the pipeline's. Everything after the
  // decision — starting the review, handing over the findings, fixing them — stays automatic.
  let decision = evaluateReviewDecision(snapshot, config);
  const reviewDecisionNotificationDelivered = (
    snapshot.reviewDecisionNotificationHeadShas ?? []
  ).includes(snapshot.headSha);
  // A self-review is run by the implementation provider, so only its identities may report one —
  // either a marker one of them posted directly, or a structured result the trusted, credential-
  // read-only self-review workflow published on that provider's behalf.
  const selfResult = latestReviewResultFromAny(snapshot.reviewResults, snapshot.headSha, "self", [
    { authors: resultAuthorsFor(contract.implementer, config) },
    {
      authors: config.selfReviewResultAuthors?.[contract.implementer] ?? [],
      source: CLAUDE_SELF_REVIEW_SOURCE,
    },
  ]);
  // Repository policy, not a per-run choice: how strongly a self-review session must have been kept
  // away from the code before its verdict counts. Lowering it to `false` is a deliberate decision to
  // accept a verdict nothing outside the prompt backed up.
  const selfReviewMinimum =
    config.selfReviewMinimumEnforcement ?? DEFAULT_SELF_REVIEW_MINIMUM;
  const crossEvidence = config.crossReviewEvidence ?? DEFAULT_CROSS_REVIEW_EVIDENCE;
  if (!CROSS_REVIEW_EVIDENCE_MODES.includes(crossEvidence)) {
    // Same reasoning as the self-review minimum: a misconfigured gate is loud, never lenient.
    throw new Error(
      `crossReviewEvidence must be one of ${CROSS_REVIEW_EVIDENCE_MODES.join(", ")}; got ` +
        `${JSON.stringify(crossEvidence)}.`,
    );
  }

  const reviewStartFailure = latestReviewStartFailure(
    snapshot.reviewStartFailures,
    snapshot.headSha,
  );
  const handledStartFailure = parseHandledReviewStartFailure(
    statusCommentBody(snapshot, config),
  );
  const failureHandled =
    handledStartFailure?.headSha === snapshot.headSha &&
    handledStartFailure?.attempt === reviewStartFailure?.attempt;
  const completedCrossReview =
    providerCleanPass ||
    reviews.verdict === "pass" ||
    reviews.verdict === "changes-required" ||
    crossResult?.verdict === "pass" ||
    crossResult?.verdict === "changes-required";
  const completedSelfReview =
    selfResult?.verdict === "pass" || selfResult?.verdict === "changes-required";
  // A failure record predates `self`, so a legacy or hand-built one without a `mode` field is read
  // as `cross` — the only mode that ever produced one before this workflow existed. A parsed marker
  // always carries an explicit mode.
  const failedMode = reviewStartFailure?.mode ?? "cross";
  const invalidatedStartFailure =
    reviewStartFailure &&
    !failureHandled &&
    decision.mode === failedMode &&
    (decision.mode === "cross" ? !completedCrossReview : !completedSelfReview);
  if (invalidatedStartFailure) {
    const staleLabel = config.reviewModeLabels[decision.mode];
    decision = {
      ...decision,
      mode: null,
      staleLabels: [...new Set([...(decision.staleLabels ?? []), staleLabel])],
      record: { headSha: snapshot.headSha, mode: "none", since: null },
      unboundReason: "provider-start-failed",
    };
  }

  // Whether the chosen mode is still waiting for its verdict, as opposed to having one already.
  let evidenceOutstanding = false;
  if (decision.ambiguous) {
    blockers.push(
      `More than one review-mode label is set (${decision.chosenLabels.join(", ")}); keep exactly one.`,
    );
  } else if (!decision.mode) {
    // Before that, the pull request is not ready to be reviewed at all and the gate is already
    // blocked by the mechanical condition; asking then would only burn quota on a head that is
    // about to change. Draft status is intentionally excluded from that condition: it blocks
    // merging, not the review round.
    if (mechanicallyGreen) {
      blockers.push(
        decision.unboundReason === "provider-start-failed"
          ? `The selected ${reviewStartFailure.mode ?? "cross"} review did not start (${reviewStartFailure.reason}); choose the review mode again.`
          : decision.unboundReason === "earlier-head"
          ? "The review mode was chosen for an earlier head SHA; choose again for the current head."
          : decision.unboundReason === "never-observed"
            ? "A review-mode label was set before this head was first seen and could not be bound to it; set it again."
            : "No review mode has been chosen for the current head SHA.",
      );
    }
  } else if (decision.mode === "cross") {
    // An explicit rejection always blocks, whatever the configured evidence mode is.
    if (reviews.verdict === "changes-required" || crossResult?.verdict === "changes-required") {
      blockers.push("The cross-review requested changes for the current head SHA.");
    } else if (reviews.verdict === "pass") {
      // An approving review is accepted under every mode.
    } else if (
      crossEvidence === "reviewed-and-resolved" &&
      crossResult?.verdict === "pass" &&
      crossResult.readOnly === "true"
    ) {
      // The trusted publisher, not the model, appends `read-only=true` after a workflow that has
      // no code-write credentials and exposes no editing or shell tool to the review session.
    } else if (crossResult?.verdict === "blocked") {
      evidenceOutstanding = true;
      blockers.push(
        `The ${reviewerProvider ?? "cross"} review reported \`blocked\` for the current head SHA.`,
      );
    } else if (crossResult && crossResult.readOnly !== "true") {
      evidenceOutstanding = true;
      blockers.push(
        `The ${reviewerProvider ?? "cross"} review reports read-only level ` +
          `\`${crossResult.readOnly}\`; an automated cross-review requires \`true\`.`,
      );
    } else if (crossEvidence !== "reviewed-and-resolved") {
      evidenceOutstanding = true;
      blockers.push(
        `No ${reviewerProvider ?? "cross"} review has approved the current head SHA yet.`,
      );
    } else if (!reviews.reviewedByProvider) {
      evidenceOutstanding = true;
      // Naming the remedy matters here: the evidence is a *submitted review* bound to this head, and
      // the counter provider only submits one when a review is requested for it. A provider that
      // merely reacted — Codex answers a clean automatic pass with a thumbs-up — leaves nothing this
      // gate can read, because a reaction carries no commit SHA and could never be head-bound.
      blockers.push(
        `No ${reviewerProvider ?? "cross"} review covers the current head SHA yet; request one for ` +
          "this head (a reaction is not evidence, only a submitted review is).",
      );
    } else if (!threadsReadable || threads.blockingCount > 0) {
      // The findings are the verdict here: a provider that never approves says "no objection" by
      // leaving nothing open. Unreadable threads must block rather than read as "nothing open".
      blockers.push(
        `The ${reviewerProvider ?? "cross"} review of the current head SHA has unresolved findings.`,
      );
    }
  } else if (decision.mode === "self") {
    // GitHub carries no native evidence for a same-provider review, so the published result is all
    // there is. It is deliberately weaker than a cross-review: the gate can check that the record
    // is head-bound, complete and posted by a trusted identity, but not that the session really was
    // independent. That reduced independence is the user's explicit choice here.
    if (!selfResult) {
      evidenceOutstanding = true;
      blockers.push("No self-review result has been published for the current head SHA.");
    } else if (!meetsReadOnlyMinimum(selfResult.readOnly, selfReviewMinimum)) {
      // A review round is still owed: only a new session that actually reaches the configured level
      // can clear this, so the pull request waits on a review rather than on the implementer.
      evidenceOutstanding = true;
      blockers.push(
        `The self-review reports read-only level \`${selfResult.readOnly}\`, below the required ` +
          `\`${selfReviewMinimum}\` for this repository.`,
      );
    } else if (selfResult.verdict === "changes-required") {
      blockers.push("The self-review requested changes for the current head SHA.");
    } else if (selfResult.verdict !== "pass") {
      // `blocked` means the review could not be completed, not that the code needs work.
      evidenceOutstanding = true;
      blockers.push(`The self-review reported \`${selfResult.verdict}\` for the current head SHA.`);
    }
  } else if (decision.mode === "human") {
    // Review and merge collapse into the same person here. That is only acceptable because it was
    // deliberately chosen for this head, is visible as a label, and is recorded below.
    if (!reviews.humanReview) {
      evidenceOutstanding = true;
      blockers.push(
        "No human review covers the current head SHA yet. A PR author can submit a Comment " +
          "review; another reviewer must approve.",
      );
    }
  }

  // A chosen review that never produces a result is the pipeline's quietest failure: every gate
  // reads "waiting for the review", which is indistinguishable from a review that is simply still
  // running. Only an outstanding round is timed — with a verdict in, nobody is waiting.
  const waitingHours = evidenceOutstanding
    ? reviewWaitingHours(snapshot, config, decision.record?.since ?? null)
    : null;
  const escalationHours = waitingEscalationHours(config);
  const reviewStalled = waitingHours !== null && waitingHours >= escalationHours;
  if (reviewStalled) {
    blockers.push(
      `The chosen \`${decision.mode}\` review has produced no result for ${Math.floor(waitingHours)} ` +
        `hours (escalation threshold ${escalationHours}h); start it again for the current head or ` +
        "choose another review mode.",
    );
  }

  // The workflow already announced a failed attempt in its own comment. Repeating it here is the
  // point: the status comment is the machine-readable surface, and an agent reading only "no review
  // covers this head" cannot tell a review that died from one still running.
  const startNotice =
    evidenceOutstanding &&
    snapshot.reviewStartNotice?.headSha === snapshot.headSha &&
    // A missing mode predates `self` and is read as `cross`, the only mode that wrote this marker
    // before; a mode switch on the same head must not surface a notice that belongs to the old one.
    (snapshot.reviewStartNotice?.mode ?? "cross") === decision.mode
      ? snapshot.reviewStartNotice
      : null;
  if (startNotice) {
    blockers.push(
      `The last ${decision.mode} review attempt for the current head SHA produced no result ` +
        `(\`${startNotice.outcome}\`); see the review-start notice comment for the cause and the ` +
        "way out.",
    );
  }

  // An unreadable discussion blocks, but it must say so rather than invent an open thread the
  // maintainer would go looking for.
  if (!threadsReadable) {
    blockers.push(
      "Review threads could not be read completely for the current head SHA.",
    );
  } else if (threads.blockingCount > 0) {
    blockers.push(
      `${threads.blockingCount} review thread(s) are still unresolved.`,
    );
  }

  // Automation must not resolve this itself: a workflow or infrastructure change needs a human to
  // approve the exact current head. Escalation is derived from that condition rather than from a
  // label, so approving the head clears it again without any label bookkeeping.
  const needsHumanApproval =
    protectedPaths.length > 0 && !reviews.humanApproval;
  if (needsHumanApproval) {
    blockers.push(
      `Workflow or infrastructure paths changed and need an explicit human approval of the current head: ${protectedPaths.join(", ")}.`,
    );
  }

  const uiChanged = uiPathChanged || contract.uiChanged === true;
  if (uiChanged && snapshot.uiNoticeHeadSha !== snapshot.headSha) {
    blockers.push(
      snapshot.uiNoticeHeadSha
        ? "The UI/UX review notice does not cover the current head SHA."
        : "A visible UI/UX change still needs its review notice.",
    );
  }

  let recommendation = recommendReviewMode(
    {
      changedFiles: snapshot.changedFiles,
      protectedPaths,
      priorReviewPassed: hasEarlierPassingReview(snapshot, allowedReviewers),
    },
    config,
  );
  if (!decision.mode && reviewStartFailure) {
    // A missing mode predates `self` and is read as `cross`, matching how the marker itself falls
    // back (see `failedMode` above); a parsed marker always carries an explicit mode.
    const failedMode = reviewStartFailure.mode ?? "cross";
    const retryable = new Set(["phase", "mode", "provider", "disabled"]);
    recommendation = retryable.has(reviewStartFailure.code)
      ? {
          mode: failedMode,
          reason: `the last ${failedMode}-review was declined (${reviewStartFailure.reason}); retrying the same mode remains appropriate`,
        }
      : failedMode === "cross"
        ? {
            mode: "self",
            reason: `the ${reviewerProvider ?? "cross"} provider failed (${reviewStartFailure.reason}); a fresh same-provider review avoids another automatic switch`,
          }
        : {
            mode: "cross",
            reason: `the self-review failed to start (${reviewStartFailure.reason}); an independent ${reviewerProvider ?? "cross"} cross-review avoids repeating the same failure`,
          };
  }

  // Delivery is a separate state from rendering the question in the sticky comment. It becomes
  // eligible only after every prerequisite that can invalidate the head is closed. Draft status
  // remains intentionally absent: a draft may be reviewed, it merely cannot be merged yet.
  const reviewDecisionNotificationRequired =
    !decision.ambiguous &&
    !decision.mode &&
    mechanicallyGreen &&
    threads.blockingCount === 0 &&
    !needsHumanApproval;
  const reviewDecisionDeliveryFailed =
    reviewDecisionNotificationRequired &&
    !reviewDecisionNotificationDelivered &&
    snapshot.reviewDecisionDeliveryFailureHeadSha === snapshot.headSha;
  if (reviewDecisionDeliveryFailed) {
    blockers.unshift(
      "The review-choice notification could not be delivered for the current head SHA; the reconciler will retry and no review mode was selected.",
    );
  }

  let phase;
  if (escalated) {
    // Set from outside and cleared from outside; nothing here may override it.
    phase = "needs-human";
  } else if (waiting) {
    // `agent:waiting` already describes this. Adding a phase label on top would claim an agent is
    // working while the pull request waits for a provider that is not available.
    phase = "waiting";
  } else if (mergeability === "conflicted") {
    // Conflicts and CI failures rank above the human-approval wait: an agent can resolve them, and
    // the plan classifies both as work to do without asking. The approval blocker stays in the
    // list either way, so readiness remains closed.
    phase = "conflict-fix";
  } else if (checks.state === "failing") {
    phase = "ci-fix";
  } else if (needsHumanApproval) {
    // Nothing an agent does can clear this one, so it must outrank review and ready-for-merge.
    phase = "awaiting-human-approval";
  } else if (reviewDecisionDeliveryFailed) {
    phase = "review-decision-delivery-failed";
  } else if (decision.ambiguous || (!decision.mode && mechanicallyGreen)) {
    // Waiting on the user to say who reviews this head. No agent may answer this, so it outranks
    // the review phase, and deliberately nothing starts meanwhile: an automatic fallback would
    // spend exactly the quota this decision exists to protect.
    phase = "awaiting-review-decision";
  } else if (!blockers.length) {
    phase = "ready-for-merge";
  } else if (
    mechanicallyGreen &&
    // Only while a review round is genuinely outstanding. With a verdict already in, nobody is
    // reviewing and the label would contradict the verdict shown in the status comment.
    evidenceOutstanding &&
    threads.blockingCount === 0
  ) {
    // Everything mechanical is green; the pull request is waiting on its review round.
    phase = "review";
  } else {
    phase = "implementing";
  }

  return {
    participating: true,
    mutate: true,
    phase,
    ready: blockers.length === 0,
    blockers,
    contract,
    reviewerProvider,
    details: {
      checks,
      reviews,
      threads,
      mergeability,
      protectedPaths,
      uiChanged,
      mechanicallyGreen,
      reviewMode: decision.mode,
      reviewDecision: decision,
      selfResult,
      crossResult,
      selfReviewMinimum,
      recommendation,
      reviewWaitingHours: waitingHours,
      reviewStalled,
      reviewStartFailure,
      handledStartFailure:
        invalidatedStartFailure || failureHandled ? reviewStartFailure : null,
      reviewStartNotice: startNotice,
      reviewDecisionDelivery: {
        required: reviewDecisionNotificationRequired,
        delivered: reviewDecisionNotificationDelivered,
        failed: reviewDecisionDeliveryFailed,
      },
    },
  };
}

/**
 * Turns a readiness result into a concrete label add/remove set.
 *
 * Idempotent by construction: a label already in the desired state produces no operation, so
 * re-running the reconciler on an unchanged pull request issues no writes at all.
 */
export function planLabels(currentLabels, readiness, config = loadConfig()) {
  if (!readiness.mutate) return { add: [], remove: [] };

  const current = new Set(currentLabels ?? []);
  const desired = new Set([labelName(config, "pipeline")]);

  const phaseLabelKey = PHASE_LABEL_KEYS[readiness.phase];
  if (phaseLabelKey) desired.add(labelName(config, phaseLabelKey));
  if (readiness.details?.uiChanged) desired.add(labelName(config, "uiChanged"));

  const managed = MANAGED_LABEL_KEYS.map((key) => labelName(config, key));

  // The review-mode labels belong to the user and are never added here. The one exception is
  // removing a label that was bound to an earlier head: leaving it in place would answer the
  // question for code the user never saw, and removing it is what makes the choice be asked again.
  const staleChoiceLabels = (readiness.details?.reviewDecision?.staleLabels ?? []).filter(
    (label) => current.has(label),
  );

  return {
    add: [...desired].filter(
      (label) => !current.has(label) && managed.includes(label),
    ),
    remove: [
      ...managed.filter((label) => current.has(label) && !desired.has(label)),
      ...staleChoiceLabels,
    ],
  };
}

function statusText(value) {
  return String(value)
    .replace(/<!--/g, "&lt;!--")
    .replace(/-->/g, "--&gt;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/`/g, "\\`")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
}

function formatList(items) {
  if (!items.length) return "_none_";
  return items.map((item) => `- ${statusText(item)}`).join("\n");
}

/**
 * Renders the sticky status comment.
 *
 * Deterministic for a given snapshot, so the caller can skip the API write when nothing changed.
 * The comment reports state; round counters are never derived from comment history.
 */
function reviewModeLine(readiness, config) {
  const details = readiness.details ?? {};
  const mode = details.reviewMode;
  if (!mode) return "- Review mode: `not chosen for this head`";

  // For `self` the read-only level is part of how much the verdict is worth, so it belongs in the
  // permanent record next to the mode rather than only in a blocker that disappears once it passes.
  const selfIndependence = () => {
    const level = details.selfResult?.readOnly;
    const base = "same provider, reduced independence — chosen deliberately";
    if (!level) return base;
    return level === "true"
      ? `${base}; read-only enforced by restricted credentials`
      : level === "verified"
        ? `${base}; read-only verified by the launcher, not by credentials`
        : `${base}; read-only not enforced`;
  };

  const independence =
    mode === "cross"
      ? "independent counter provider"
      : mode === "self"
        ? selfIndependence()
        : "human review, chosen deliberately; review and merge are the same person";
  const label = config.reviewModeLabels?.[mode] ?? mode;
  return `- Review mode: \`${mode}\` via \`${label}\` (${independence})`;
}

/**
 * Renders the review-mode question, which is the actual choice surface on GitHub.
 *
 * Only rendered while the answer is missing, so a decided pull request does not keep asking.
 */
function shortSha(value) {
  return /^[0-9a-f]{40}$/i.test(value ?? "") ? value.slice(0, 12) : "unknown";
}

function safeInline(value) {
  return statusText(value).replace(/@/g, "&#64;");
}

/** Canonical data shown on every surface that asks the user to choose a review mode. */
export function buildReviewDecisionPayload(readiness, snapshot, config = loadConfig()) {
  const context = snapshot.reviewDecisionContext ?? {};
  const delta = context.delta ?? {
    baseSha: snapshot.baseSha ?? null,
    headSha: snapshot.headSha ?? null,
    commits: null,
    filesChanged: (snapshot.changedFiles ?? []).length,
    additions: null,
    deletions: null,
    files: snapshot.changedFiles ?? [],
  };
  const recommendation = readiness.details?.recommendation ?? {
    mode: "cross",
    reason: "the independent review is the safe default",
  };
  const startFailure = readiness.details?.reviewStartFailure;
  const providerState = (snapshot.labels ?? []).includes(labelName(config, "waiting"))
    ? "temporarily unavailable"
    : startFailure
      ? `${startFailure.outcome}: ${startFailure.reason}`
      : "available";

  return {
    eventId: `review-choice-${snapshot.headSha}`,
    headSha: snapshot.headSha,
    taskId: readiness.contract?.taskId ?? null,
    codexThreadId: readiness.contract?.codexThreadId ?? null,
    headBranch: snapshot.headBranch ?? null,
    implementer: readiness.contract?.implementer ?? "unknown",
    reviewer: readiness.reviewerProvider ?? "unknown",
    recommendation,
    round: context.round ?? "first",
    priorHeadSha: context.priorHeadSha ?? null,
    priorFindings: context.priorFindings ?? null,
    delta,
    openThreads: readiness.details?.threads?.blockingCount ?? null,
    providerState,
    reviewTimeoutMinutes: config.reviewTimeoutMinutes ?? null,
    waitingEscalationHours: waitingEscalationHours(config),
  };
}

/** Shared fact block for the sticky status, active GitHub notification and Codex prompt. */
export function renderReviewDecisionFacts(payload, config = loadConfig()) {
  const modeLabels = config.reviewModeLabels ?? {};
  const delta = payload.delta ?? {};
  const stats = [
    `${delta.filesChanged ?? "unknown"} file(s)`,
    delta.additions === null || delta.additions === undefined
      ? null
      : `+${delta.additions}`,
    delta.deletions === null || delta.deletions === undefined
      ? null
      : `-${delta.deletions}`,
    delta.commits === null || delta.commits === undefined
      ? null
      : `${delta.commits} commit(s)`,
  ].filter(Boolean);
  const visibleFiles = (delta.files ?? []).slice(0, 8).map(safeInline);
  const remainingFiles = Math.max(0, (delta.files ?? []).length - visibleFiles.length);
  const findings = payload.priorFindings;
  const previousFindingText =
    payload.round === "first"
      ? "first review round"
      : findings?.known
        ? `${findings.high} high, ${findings.medium} medium, ${findings.low} low`
        : "no structured severity summary available";
  const timeout = payload.reviewTimeoutMinutes
    ? `${payload.reviewTimeoutMinutes}m job timeout`
    : "no configured job timeout";

  return [
    `- Head SHA: \`${safeInline(payload.headSha)}\``,
    `- Task: \`${safeInline(payload.taskId ?? "unknown")}\``,
    `- Codex task: ${payload.codexThreadId ? `\`${safeInline(payload.codexThreadId)}\`` : "resolve uniquely from the head branch"}`,
    `- Implementer: \`${safeInline(payload.implementer)}\``,
    `- Counter provider: \`${safeInline(payload.reviewer)}\``,
    `- Review round: \`${safeInline(payload.round)}\`` +
      (payload.priorHeadSha ? ` after \`${shortSha(payload.priorHeadSha)}\`` : ""),
    `- Changes since ${payload.priorHeadSha ? "last completed review" : "PR base"}: ${stats.join(", ")}` +
      (delta.unavailable ? " (exact comparison unavailable; showing current PR scope)" : ""),
    `- Files: ${visibleFiles.length ? visibleFiles.map((file) => `\`${file}\``).join(", ") : "_none_"}` +
      (remainingFiles ? `, and ${remainingFiles} more` : ""),
    `- Previous findings: ${previousFindingText}`,
    `- Open review threads: \`${payload.openThreads ?? "unknown"}\``,
    `- Provider/limits: \`${safeInline(payload.reviewer)}\` is ${safeInline(payload.providerState)}; ${timeout}; ` +
      `escalation after ${payload.waitingEscalationHours}h; no silent fallback`,
    `- Recommendation: \`${modeLabels[payload.recommendation?.mode] ?? modeLabels.cross}\` — ` +
      `${safeInline(payload.recommendation?.reason ?? "the independent review is the safe default")}.`,
  ];
}

/**
 * Same facts as `renderReviewDecisionFacts`, with the audit-trail detail (files, round, provider
 * state, timeouts) folded behind a collapsed `<details>` block and only the head SHA and
 * recommendation left visible. A pull request that goes through several heads gets one of these
 * per head, so leaving everything expanded turns the thread into mostly-repeated boilerplate;
 * folding it keeps the same information one tap away instead of forcing a scroll past it. The
 * head SHA specifically stays visible because callers refer back to "the head SHA shown here" as
 * the thing this choice is bound to — folding it away would make that reference false.
 */
function renderReviewDecisionFactsFolded(payload, config = loadConfig()) {
  const facts = renderReviewDecisionFacts(payload, config);
  const headSha = facts[0];
  const recommendation = facts[facts.length - 1];
  const rest = facts.slice(1, -1);
  return [
    headSha,
    recommendation,
    "",
    "<details>",
    "<summary>Details (files, round, provider status)</summary>",
    "",
    ...rest,
    "",
    "</details>",
  ];
}

function reviewDecisionSection(readiness, snapshot, config) {
  const details = readiness.details ?? {};
  const modeLabels = config.reviewModeLabels ?? {};
  const payload = buildReviewDecisionPayload(readiness, snapshot, config);
  const lines = [
    "### Who reviews this head?",
    "",
    ...(details.reviewStartFailure
      ? [
          `The last cross-review start for this head ended as \`${details.reviewStartFailure.outcome}\`: ` +
            `${statusText(details.reviewStartFailure.reason)}. Retrying \`${modeLabels.cross}\` remains available.`,
          "",
        ]
      : []),
    ...renderReviewDecisionFactsFolded(payload, config),
    "",
    "Set exactly one label:",
    "",
    `- \`${modeLabels.cross}\` — cross-review by ${readiness.reviewerProvider ?? "the other provider"}; most independent.`,
    `- \`${modeLabels.self}\` — fresh, read-only session of ${statusText(readiness.contract?.implementer ?? "the implementer")}; spares the other provider's quota, less independent.`,
    `- \`${modeLabels.human}\` — you review it yourself; approve this exact head, or submit a Comment review when you are the PR author.`,
    "",
    "The chosen review starts automatically, its findings are fixed automatically, and the",
    "question returns for the next head SHA. Nothing starts until a label is set.",
  ];
  return lines.join("\n");
}

export function normalizeNotificationRecipient(value) {
  const login = String(value ?? "").trim().replace(/^@/, "");
  if (
    login.length < 1 ||
    login.length > 39 ||
    !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(login)
  ) {
    throw new Error(
      "AGENT_PIPELINE_OWNER must contain one valid GitHub login so the review choice can notify a maintainer.",
    );
  }
  return login;
}

/** Renders the separate, mention-bearing delivery comment for exactly one head SHA. */
export function renderReviewDecisionNotification(
  readiness,
  snapshot,
  recipient,
  config = loadConfig(),
) {
  const login = normalizeNotificationRecipient(recipient);
  const payload = buildReviewDecisionPayload(readiness, snapshot, config);
  const modeLabels = config.reviewModeLabels ?? {};
  const implementer = safeInline(payload.implementer);
  const reviewer = safeInline(payload.reviewer);

  return [
    `@${login} review choice required for this pull request.`,
    "",
    "## Choose who reviews this head",
    "",
    ...renderReviewDecisionFactsFolded(payload, config),
    "",
    `a) Cross-review by \`${reviewer}\` (\`${modeLabels.cross}\`)`,
    `b) Self-review by \`${implementer}\` in a fresh, technically read-only session (\`${modeLabels.self}\`)`,
    `c) Human review (\`${modeLabels.human}\`)`,
    "",
    "Give an explicit a/b/c answer in the originating Codex task, or set exactly one of the labels",
    "above in GitHub. The selected review starts automatically. This choice is valid only for the",
    "full head SHA shown here; no timeout or provider failure silently changes it.",
    "",
    `${CODEX_EVENT_MARKER} type=review-choice-required id=${payload.eventId} -->`,
    `${REVIEW_DECISION_NOTIFICATION_MARKER} ${snapshot.headSha} -->`,
  ].join("\n");
}

function planReviewDecisionNotification(
  readiness,
  snapshot,
  recipient,
  config,
) {
  const delivery = readiness.details?.reviewDecisionDelivery;
  if (!delivery?.required || delivery.delivered) return null;

  const failureStatus = {
    context: config.statusContext,
    state: "pending",
    description: trimDescription(
      "review-decision-delivery-failed: review-choice notification was not delivered; retry required.",
    ),
  };
  try {
    return {
      body: renderReviewDecisionNotification(readiness, snapshot, recipient, config),
      failureStatus,
    };
  } catch (error) {
    return {
      body: null,
      error: error instanceof Error ? error.message : String(error),
      failureStatus,
    };
  }
}

const PROVIDER_LABELS_FOR_RETRIGGER = { claude: "Claude", codex: "Codex" };

/** Renders the reconciler's own record that it re-dispatched a cross-review workflow. */
export function renderReviewRetriggerComment(snapshot, provider, config = loadConfig()) {
  const providerLabel = PROVIDER_LABELS_FOR_RETRIGGER[provider] ?? provider;
  const modeLabel = config.reviewModeLabels?.cross ?? "review:cross";
  return [
    "## Cross-review retriggered",
    "",
    `The chosen \`${modeLabel}\` review did not run when the label was set for this head — the pull`,
    "request was not ready yet (see the review-start notice above). It is ready now, so the",
    `reconciler re-dispatched the ${providerLabel} cross-review workflow for the current head SHA,`,
    "without waiting for a human to remove and reset the label.",
    "",
    `${REVIEW_RETRIGGER_MARKER} ${snapshot.headSha} provider=${provider} -->`,
    "",
    "---",
    "_Maintained by the agent pipeline reconciler. It reports state only; it does not approve or merge._",
  ].join("\n");
}

/** The trusted workflow file a given reviewer provider's cross-review runs in, from a closed set. */
function reviewWorkflowFileFor(provider, config) {
  return config.reviewWorkflowFiles?.[provider] ?? null;
}

/**
 * Whether the reconciler should re-dispatch the cross-review workflow for the current head.
 *
 * The label-triggered workflow runs exactly once, at the moment `review:cross` is set, and never
 * retries on its own — see `deriveClaudeReviewDispatch` / `deriveCodexReviewDispatch`. When the head
 * is not yet ready at that moment (still a draft, behind `main`, checks still running, or the
 * pipeline briefly disabled) it declines and leaves a `review-start-notice` for that exact head.
 * Nothing then asks it to try again unless a human removes and resets the label. This closes that
 * gap: once the reconciler observes the same head is genuinely eligible for the review the notice
 * describes, it dispatches the workflow itself.
 *
 * Deliberately narrow. A `failed` notice — the review actually ran and errored — is never retried
 * here: the remedy is diagnosing that workflow run, not spending another attempt blindly on a head
 * nothing here proved would behave differently. Eligibility is decided by what is true right now,
 * not by the notice: the notice is only the trigger to look again, never the reason to act.
 */
export function planReviewRetrigger(readiness, snapshot, config = loadConfig()) {
  if (readiness.phase !== "review") return null;
  if (readiness.details?.reviewMode !== "cross") return null;
  const notice = readiness.details?.reviewStartNotice;
  if (!notice || notice.outcome !== "declined") return null;
  const provider = readiness.reviewerProvider;
  const workflowFile = reviewWorkflowFileFor(provider, config);
  if (!workflowFile) return null;
  if ((snapshot.reviewRetriggerHeadShas ?? []).includes(snapshot.headSha)) return null;

  return {
    provider,
    workflowFile,
    ref: config.defaultBaseBranch,
    commentBody: renderReviewRetriggerComment(snapshot, provider, config),
  };
}

export function renderStatusComment(readiness, snapshot, config = loadConfig()) {
  const contract = readiness.contract ?? {};
  const details = readiness.details ?? {};
  const record = details.reviewDecision?.record;
  // Asked exactly when the blocker is raised: while anything required before a review is still
  // open the head may still change. Draft status is not such a blocker; it only keeps the merge
  // gate closed.
  const awaitingDecision =
    Boolean(details.reviewDecision) &&
    !details.reviewMode &&
    (details.mechanicallyGreen === true || details.reviewDecision.ambiguous === true);

  return [
    STATUS_COMMENT_MARKER,
    "## Agent pipeline status",
    "",
    `- Phase: \`${readiness.phase}\``,
    `- Ready for human merge: \`${readiness.ready}\``,
    `- Head SHA: \`${snapshot.headSha ?? "unknown"}\``,
    `- Task: \`${statusText(contract.taskId ?? "unknown")}\``,
    `- Implementer: \`${statusText(contract.implementer ?? "unknown")}\``,
    `- Reviewer: \`${readiness.reviewerProvider ?? "unknown"}\``,
    reviewModeLine(readiness, config),
    `- Checks: \`${details.checks?.state ?? "unknown"}\``,
    `- Review verdict: \`${details.reviews?.verdict ?? "unknown"}\``,
    ...(details.selfResult
      ? [`- Self-review result: \`${details.selfResult.verdict}\` (session \`${details.selfResult.sessionId}\`)`]
      : []),
    `- Unresolved review threads: \`${details.threads?.blockingCount ?? "unknown"}\``,
    `- Mergeability: \`${details.mergeability ?? "unknown"}\``,
    ...(details.reviewStartNotice
      ? [`- Last review attempt: \`${details.reviewStartNotice.outcome}\` without a result`]
      : []),
    ...(details.reviewStalled
      ? [
          `- Review overdue: \`${Math.floor(details.reviewWaitingHours)}h\` without a result ` +
            `(threshold \`${waitingEscalationHours(config)}h\`)`,
        ]
      : []),
    ...(details.reviewStartFailure
      ? [
          `- Last cross-review start: \`${details.reviewStartFailure.outcome}\` ` +
            `(\`${statusText(details.reviewStartFailure.code)}\`: ${statusText(details.reviewStartFailure.reason)})`,
        ]
      : []),
    "",
    ...(awaitingDecision ? [reviewDecisionSection(readiness, snapshot, config), ""] : []),
    "### Blockers",
    "",
    formatList(readiness.blockers ?? []),
    "",
    "_Maintained by the agent pipeline reconciler. It reports state only; it does not approve or",
    "merge. The final merge is always a human decision._",
    ...(details.handledStartFailure
      ? [
          `${REVIEW_START_FAILURE_MARKER} ${details.handledStartFailure.headSha} ` +
            `attempt=${details.handledStartFailure.attempt} -->`,
        ]
      : []),
    // Binds the review-mode label to the head it was chosen for. It remains the final line so no
    // interpolated or auxiliary marker can impersonate the gate-relevant binding.
    ...(record
      ? [
          `${REVIEW_DECISION_MARKER} ${record.headSha} mode=${record.mode}` +
            `${record.since ? ` since=${record.since}` : ""} -->`,
        ]
      : []),
  ].join("\n");
}

// GitHub rejects a longer status description, so the reason is trimmed rather than lost.
export const GATE_DESCRIPTION_LIMIT = 140;

function trimDescription(text) {
  if (text.length <= GATE_DESCRIPTION_LIMIT) return text;
  return `${text.slice(0, GATE_DESCRIPTION_LIMIT - 3)}...`;
}

/**
 * Decides the `Agent pipeline / ready for human merge` commit status for the current head SHA.
 *
 * Two states only: `success` once every gate condition holds, `pending` while any blocker is open.
 * A blocked pull request is not an error — the pipeline is still working on it — and the reason
 * travels in the description, where the merge box shows it without opening the status comment.
 *
 * Success for a pull request the pipeline does not manage is deliberate. Once this context is a
 * required check, a status that is never written leaves the pull request unmergeable forever, so
 * every non-participating pull request — a human one, a Dependabot bump, a fork — would
 * deadlock on a gate that was never meant to apply to it. The gate therefore states that it does
 * not apply instead of staying silent. It is not the control that keeps an agent PR honest: an
 * agent pull request without a task contract also gets no pipeline label and no status comment, so
 * its absence is visible, and the branch-protection review requirement still applies to everyone.
 *
 * Returns null when no status belongs on the commit at all.
 */
export function planGateStatus(readiness, config = loadConfig()) {
  // A closed or merged pull request is history; writing a verdict on it now would be noise.
  if (readiness.phase === "closed") return null;

  if (!readiness.participating) {
    const reason =
      readiness.phase === "fork"
        ? "Fork pull request: the agent-pipeline gate does not apply."
        : "No agent task contract: the agent-pipeline gate does not apply.";
    return { context: config.statusContext, state: "success", description: reason };
  }

  if (readiness.ready) {
    return {
      context: config.statusContext,
      state: "success",
      description: "Every gate condition holds for this head. The merge stays yours.",
    };
  }

  const blockers = readiness.blockers ?? [];
  const remaining = blockers.length > 1 ? ` (+${blockers.length - 1} more)` : "";
  const first = blockers[0] ?? "Readiness could not be determined for this head.";
  return {
    context: config.statusContext,
    state: "pending",
    description: trimDescription(`${readiness.phase}: ${first}${remaining}`),
  };
}

/**
 * Full plan for one pull request: labels, the sticky status comment and the merge-gate status.
 *
 * The gate is planned even when no mutation is allowed. `agent:no-auto` stops the pipeline from
 * acting on a pull request, and section 11 of the plan counts that kill switch as a gate condition
 * of its own; leaving the status behind at a stale `success` would turn a paused pull request into
 * a mergeable one. The same holds for pull requests the pipeline does not manage, which need the
 * "does not apply" verdict precisely because nothing else will ever write it.
 */
export function reconcile(
  snapshot,
  config = loadConfig(),
  { notificationRecipient = null } = {},
) {
  const readiness = deriveReadiness(snapshot, config);
  const delivery = readiness.details?.reviewDecisionDelivery;
  // A retry plan describes the state that should exist *after* its notification POST succeeds.
  // If that POST fails, applyPlan replaces these optimistic writes with the explicit failure
  // comment and status instead. Without this projection a successful retry would keep publishing
  // the old delivery-failed blocker until a later schedule happened to run.
  const plannedReadiness = delivery?.failed
    ? {
        ...readiness,
        phase: "awaiting-review-decision",
        blockers: readiness.blockers.slice(1),
        details: {
          ...readiness.details,
          reviewDecisionDelivery: {
            ...delivery,
            delivered: true,
            failed: false,
          },
        },
      }
    : readiness;
  const gate = planGateStatus(plannedReadiness, config);
  // An unchanged verdict needs no API call. Statuses are append-only, so rewriting one on every
  // sweep would bury the commit's status history under identical entries.
  const current = snapshot.gateStatus;
  const status =
    gate &&
    (current?.state !== gate.state || current?.description !== gate.description)
      ? gate
      : null;

  if (!readiness.mutate) {
    return {
      readiness,
      labels: { add: [], remove: [] },
      comment: null,
      notification: null,
      retrigger: null,
      status,
    };
  }

  const body = renderStatusComment(plannedReadiness, snapshot, config);
  return {
    readiness,
    labels: planLabels(snapshot.labels, plannedReadiness, config),
    // An unchanged body needs no API call at all.
    comment: snapshot.statusCommentBody === body ? null : { body },
    notification: planReviewDecisionNotification(
      readiness,
      snapshot,
      notificationRecipient,
      config,
    ),
    retrigger: planReviewRetrigger(readiness, snapshot, config),
    status,
  };
}

// ---------------------------------------------------------------------------
// GitHub I/O
//
// Deliberately thin: it only reads the current state into a snapshot and applies a plan. All
// decisions live in the pure functions above, where they are covered by tests.
// ---------------------------------------------------------------------------

const API_ROOT = process.env.GITHUB_API_URL ?? "https://api.github.com";
const READ_RETRY_ATTEMPTS = 3;
const READ_RETRY_DELAY_MS = 250;
const MAX_READ_RETRY_DELAY_MS = 5_000;
const RETRIABLE_READ_STATUSES = new Set([429, 500, 502, 503, 504]);

function retryAfterMs(response, attempt) {
  const value = response?.headers?.get?.("retry-after");
  if (value) {
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1_000, MAX_READ_RETRY_DELAY_MS);
    }

    const date = Date.parse(value);
    if (Number.isFinite(date)) {
      return Math.min(
        Math.max(0, date - Date.now()),
        MAX_READ_RETRY_DELAY_MS,
      );
    }
  }
  return Math.min(
    READ_RETRY_DELAY_MS * 2 ** (attempt - 1),
    MAX_READ_RETRY_DELAY_MS,
  );
}

function isRetriableReadResponse(response) {
  return (
    RETRIABLE_READ_STATUSES.has(response.status) ||
    (response.status === 403 && Boolean(response.headers?.get?.("retry-after")))
  );
}

async function fetchReadWithRetry(
  url,
  options,
  description,
  inspectResponse = null,
) {
  let attempt = 1;
  while (true) {
    let response;
    try {
      response = await fetch(url, options);
    } catch (error) {
      if (attempt === READ_RETRY_ATTEMPTS) throw error;
      const delay = retryAfterMs(null, attempt);
      console.warn(
        `${description} failed before receiving a response; retrying in ${delay} ms (attempt ${attempt + 1}/${READ_RETRY_ATTEMPTS}): ${error instanceof Error ? error.message : String(error)}`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
      attempt += 1;
      continue;
    }

    // Successful GraphQL responses can still carry a retriable API error in their JSON body.
    // Inspect only successful HTTP responses so a transient non-JSON 5xx body remains retryable.
    const inspection =
      response.ok && inspectResponse ? await inspectResponse(response) : null;
    const retryReason = isRetriableReadResponse(response)
      ? `returned ${response.status}`
      : inspection?.retryReason;

    if (!retryReason || attempt === READ_RETRY_ATTEMPTS) {
      return inspectResponse
        ? { response, value: inspection?.value }
        : response;
    }

    const delay = retryAfterMs(response, attempt);
    console.warn(
      `${description} ${retryReason}; retrying in ${delay} ms (attempt ${attempt + 1}/${READ_RETRY_ATTEMPTS}).`,
    );
    // Payload inspection already consumed the body; otherwise release it before retrying.
    if (!inspection) await response.body?.cancel?.();
    await new Promise((resolve) => setTimeout(resolve, delay));
    attempt += 1;
  }
}

async function api(path, { method = "GET", body, token } = {}) {
  const request = {
    method,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  };
  const response =
    method === "GET"
      ? await fetchReadWithRetry(
          `${API_ROOT}${path}`,
          request,
          `GitHub API GET ${path}`,
        )
      : await fetch(`${API_ROOT}${path}`, request);
  if (!response.ok) {
    throw new Error(
      `GitHub API ${method} ${path} failed with ${response.status}: ${await response.text()}`,
    );
  }
  return response.status === 204 ? null : response.json();
}

async function graphql(query, variables, token) {
  const { response, value } = await fetchReadWithRetry(
    `${API_ROOT.replace(/\/$/, "")}/graphql`,
    {
      method: "POST",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ query, variables }),
    },
    "GitHub GraphQL read",
    async (successfulResponse) => {
      const payload = await successfulResponse.json();
      return {
        value: payload,
        retryReason: payload.errors?.some(
          (error) => error?.type === "RATE_LIMITED",
        )
          ? "returned a RATE_LIMITED error"
          : null,
      };
    },
  );
  const payload = value ?? (await response.json());
  if (!response.ok || payload.errors) {
    throw new Error(`GitHub GraphQL failed: ${JSON.stringify(payload.errors ?? payload)}`);
  }
  return payload.data;
}

const PAGE_LIMIT = 10;

/**
 * Reads every page of a REST collection.
 *
 * Throws rather than truncating when the cap is reached: a short `changedFiles` would make the
 * protected-path and UI detection miss a path, and a short comment list would hide the sticky
 * status comment and duplicate it on every run. Failing the run leaves the previous state intact,
 * which is the safe direction.
 */
export async function paginate(path, token) {
  const items = [];
  for (let page = 1; page <= PAGE_LIMIT; page += 1) {
    const separator = path.includes("?") ? "&" : "?";
    const batch = await api(`${path}${separator}per_page=100&page=${page}`, {
      token,
    });
    const list = Array.isArray(batch) ? batch : (batch?.check_runs ?? []);
    items.push(...list);
    if (list.length < 100) return items;
  }
  throw new Error(
    `GitHub API ${path} returned more than ${PAGE_LIMIT * 100} entries; refusing to judge readiness on a truncated read.`,
  );
}

const REVIEW_THREADS_QUERY = `
  query($owner: String!, $repo: String!, $number: Int!, $after: String) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        mergeStateStatus
        reviewThreads(first: 100, after: $after) {
          nodes { isResolved isOutdated }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  }
`;

/**
 * Reads mergeStateStatus and every review thread, following the GraphQL cursor.
 *
 * Reports `readable: false` when the query fails or the page cap is reached, so the caller blocks
 * on an incompletely read discussion and can say so instead of reporting a thread that does not
 * exist. Failures are logged: a systematically failing query would otherwise hold every pull
 * request without leaving a trace in the job log.
 */
export async function fetchReviewThreads({ owner, repo, pullNumber, token }) {
  const nodes = [];
  let after = null;
  let mergeStateStatus = null;

  for (let page = 1; page <= 10; page += 1) {
    let data;
    try {
      data = await graphql(
        REVIEW_THREADS_QUERY,
        { owner, repo, number: Number(pullNumber), after },
        token,
      );
    } catch (error) {
      console.error(
        `Could not read review threads for #${pullNumber}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { mergeStateStatus, reviewThreads: nodes, readable: false };
    }

    const pullRequest = data?.repository?.pullRequest;
    if (!pullRequest) {
      console.error(
        `Review-thread query for #${pullNumber} returned no pull request.`,
      );
      return { mergeStateStatus, reviewThreads: nodes, readable: false };
    }
    mergeStateStatus = pullRequest.mergeStateStatus ?? mergeStateStatus;
    nodes.push(...(pullRequest.reviewThreads?.nodes ?? []));

    const pageInfo = pullRequest.reviewThreads?.pageInfo;
    if (!pageInfo?.hasNextPage) {
      return { mergeStateStatus, reviewThreads: nodes, readable: true };
    }
    after = pageInfo.endCursor;
  }

  // More threads exist than the cap allows. Block instead of judging on a partial read.
  console.error(
    `Review threads for #${pullNumber} exceed the page cap; readiness stays blocked.`,
  );
  return { mergeStateStatus, reviewThreads: nodes, readable: false };
}

/**
 * Keeps only the most recent check run per name across every check suite for the head SHA.
 *
 * The Check Runs API's `filter=latest` dedupes only within a single check suite. Each
 * `pull_request_target` retrigger (an edited body, `ready_for_review`, ...) creates a new check
 * suite for the same head SHA, so a head that accumulated several suites still gets one "latest"
 * entry per suite back from the API — a stale failing attempt from an earlier suite then keeps
 * sitting alongside the newer, passing one under the same check name, and `evaluateChecks` treats
 * any failing entry as gating. Check-run ids are assigned in strictly increasing order regardless
 * of which suite they belong to, so the highest id per name is reliably the actually-latest attempt.
 */
export function dedupeCheckRunsByName(checkRuns) {
  const latestByName = new Map();
  for (const run of checkRuns ?? []) {
    const existing = latestByName.get(run.name);
    if (!existing || run.id > existing.id) latestByName.set(run.name, run);
  }
  return [...latestByName.values()];
}

/** Reads everything the pure logic needs, all bound to the current head SHA. */
export async function fetchSnapshot({ owner, repo, pullNumber, token }) {
  const pr = await api(`/repos/${owner}/${repo}/pulls/${pullNumber}`, { token });
  const headSha = pr.head.sha;

  const [files, checkRuns, reviews, comments, graph, combinedStatus] = await Promise.all([
    paginate(`/repos/${owner}/${repo}/pulls/${pullNumber}/files`, token),
    // `filter=latest` keeps only the most recent attempt per check, so a rerun of a failed job on
    // an unchanged head supersedes its earlier failure. Set explicitly rather than relying on the
    // API default staying that way.
    paginate(
      `/repos/${owner}/${repo}/commits/${headSha}/check-runs?filter=latest`,
      token,
    ),
    paginate(`/repos/${owner}/${repo}/pulls/${pullNumber}/reviews`, token),
    paginate(`/repos/${owner}/${repo}/issues/${pullNumber}/comments`, token),
    fetchReviewThreads({ owner, repo, pullNumber, token }),
    // The combined status reports only the latest entry per context, which is exactly the verdict
    // the gate would overwrite.
    api(`/repos/${owner}/${repo}/commits/${headSha}/status?per_page=100`, {
      token,
    }),
  ]);
  const config = loadConfig();

  const trustedComments = comments.map((comment) => ({
    id: comment.id,
    body: comment.body,
    author: comment.user?.login ?? null,
    authorAssociation: comment.author_association,
    createdAt: comment.created_at ?? null,
  }));

  const normalizedReviews = reviews.map((review) => ({
    id: review.id,
    author: review.user?.login ?? null,
    authorAssociation: review.author_association,
    state: review.state,
    commitSha: review.commit_id,
    submittedAt: review.submitted_at,
    body: review.body ?? "",
  }));
  const reviewResults = parseReviewResults(trustedComments);
  const priorHeadSha = previousReviewedHead(
    reviewResults,
    normalizedReviews,
    headSha,
    config,
  );
  let reviewDelta = summarizeChangedFiles(
    files,
    pr.base.sha,
    headSha,
    null,
  );
  if (priorHeadSha) {
    try {
      const comparison = await api(
        `/repos/${owner}/${repo}/compare/${priorHeadSha}...${headSha}`,
        { token },
      );
      reviewDelta = summarizeChangedFiles(
        comparison.files ?? [],
        priorHeadSha,
        headSha,
        comparison.ahead_by ?? comparison.total_commits ?? null,
      );
    } catch (error) {
      console.error(
        `Could not compare prior review ${priorHeadSha} with ${headSha}: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
      reviewDelta = {
        ...reviewDelta,
        baseSha: priorHeadSha,
        unavailable: true,
      };
    }
  }
  const priorFindings = priorHeadSha
    ? summarizeReviewFindings(
        trustedComments,
        normalizedReviews,
        priorHeadSha,
        config,
      )
    : null;

  // A decoy comment carrying the marker must not become the comment the pipeline overwrites; when
  // one exists, the reconciler simply posts its own alongside it.
  const statusComment = trustedComments.find(
    (comment) =>
      comment.body?.startsWith(STATUS_COMMENT_MARKER) &&
      isTrustedCommentAuthor(comment),
  );

  const ownStatusCommentBody = (config.statusCommentAuthors ?? []).includes(
    statusComment?.author,
  )
    ? (statusComment?.body ?? null)
    : null;
  const gateStatus = (combinedStatus?.statuses ?? []).find(
    (status) => status.context === config.statusContext,
  );

  return {
    snapshot: {
      // Read once per snapshot so every derived age uses the same instant, and tests can pin it.
      observedAt: new Date().toISOString(),
      state: pr.state,
      isDraft: pr.draft === true,
      body: pr.body ?? "",
      repository: `${owner}/${repo}`,
      headRepository: pr.head.repo?.full_name ?? null,
      authorLogin: pr.user?.login ?? null,
      baseBranch: pr.base.ref,
      baseSha: pr.base.sha,
      headBranch: pr.head.ref,
      headSha,
      mergeable: pr.mergeable,
      mergeStateStatus:
        graph?.mergeStateStatus ?? pr.mergeable_state?.toUpperCase() ?? null,
      labels: (pr.labels ?? []).map((label) => label.name),
      changedFiles: files.map((file) => file.filename),
      checkRunsHeadSha: headSha,
      // Completion times anchor the review-stall clock; see `reviewWaitingHours`.
      checkRuns: dedupeCheckRunsByName(checkRuns).map((run) => ({
        name: run.name,
        status: run.status,
        conclusion: run.conclusion,
        completedAt: run.completed_at ?? null,
      })),
      reviews: normalizedReviews,
      reviewThreads: graph?.reviewThreads ?? [],
      // A discussion that could not be read completely must block, and must say why.
      reviewThreadsReadable: graph?.readable === true,
      uiNoticeHeadSha: parseUiNoticeHeadSha(trustedComments),
      // The counter provider's own comments. A clean pass never becomes a submitted review, so the
      // only head-bound record of it lives here.
      comments: trustedComments,
      // Why the last chosen review produced nothing, so the status comment can say so.
      reviewStartNotice: parseReviewStartNotice(trustedComments),
      // Kept separate from the body: the body drives the idempotence comparison for every adopted
      // comment, the author decides whether its decision record may be believed.
      statusCommentAuthor: statusComment?.author ?? null,
      // Published review verdicts for the `self` mode, which GitHub itself cannot represent.
      reviewResults,
      reviewDecisionContext: {
        round: priorHeadSha ? "follow-up" : "first",
        priorHeadSha,
        priorFindings,
        delta: reviewDelta,
      },
      reviewStartFailures: parseReviewStartFailures(trustedComments),
      reviewDecisionNotificationHeadShas:
        parseReviewDecisionNotificationHeadShas(trustedComments, config),
      reviewDecisionDeliveryFailureHeadSha:
        parseReviewDecisionDeliveryFailure(ownStatusCommentBody),
      // Heads the reconciler already re-dispatched a cross-review workflow for; see
      // `planReviewRetrigger`.
      reviewRetriggerHeadShas: parseReviewRetriggerHeadShas(trustedComments, config),
      statusCommentBody: statusComment?.body ?? null,
      gateStatus: gateStatus
        ? { state: gateStatus.state, description: gateStatus.description ?? null }
        : null,
    },
    statusCommentId: statusComment?.id ?? null,
  };
}

function renderDeliveryFailureComment(body, headSha, error) {
  const base = body ?? `${STATUS_COMMENT_MARKER}\n## Agent pipeline status`;
  if (parseReviewDecisionDeliveryFailure(base) === headSha) return base;

  const message = statusText(
    (error instanceof Error ? error.message : String(error)).slice(0, 500),
  );
  const section = [
    "### Review-choice notification delivery failed",
    "",
    `The active notification for head \`${headSha}\` was not delivered. No review mode was`,
    "selected. The reconciler will retry; inspect the linked workflow run for details.",
    "",
    `Error: \`${message}\``,
    "",
    `${REVIEW_DECISION_DELIVERY_FAILURE_MARKER} ${headSha} -->`,
  ].join("\n");
  const decisionRecordIndex = base.lastIndexOf(`\n${REVIEW_DECISION_MARKER}`);
  if (decisionRecordIndex === -1) return `${base}\n\n${section}`;
  return `${base.slice(0, decisionRecordIndex)}\n\n${section}${base.slice(decisionRecordIndex)}`;
}

async function recordDeliveryFailure({
  owner,
  repo,
  pullNumber,
  token,
  notification,
  statusCommentId,
  statusCommentBody,
  headSha,
  targetUrl,
  error,
  plannedCommentBody,
}) {
  const failures = [];
  const failureBody = renderDeliveryFailureComment(
    plannedCommentBody ?? statusCommentBody,
    headSha,
    error,
  );
  try {
    if (statusCommentId) {
      await api(`/repos/${owner}/${repo}/issues/comments/${statusCommentId}`, {
        method: "PATCH",
        body: { body: failureBody },
        token,
      });
    } else {
      await api(`/repos/${owner}/${repo}/issues/${pullNumber}/comments`, {
        method: "POST",
        body: { body: failureBody },
        token,
      });
    }
  } catch (reportError) {
    failures.push(
      `sticky comment: ${reportError instanceof Error ? reportError.message : String(reportError)}`,
    );
  }

  try {
    await api(`/repos/${owner}/${repo}/statuses/${headSha}`, {
      method: "POST",
      body: {
        ...notification.failureStatus,
        ...(targetUrl ? { target_url: targetUrl } : {}),
      },
      token,
    });
  } catch (reportError) {
    failures.push(
      `merge-gate status: ${reportError instanceof Error ? reportError.message : String(reportError)}`,
    );
  }

  if (failures.length) {
    throw new Error(
      "Review-choice notification delivery failed and its blocker could not be fully reported " +
        `(${failures.join("; ")}). Original error: ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export async function applyPlan({
  owner,
  repo,
  pullNumber,
  token,
  plan,
  statusCommentId,
  statusCommentBody,
  headSha,
  targetUrl,
}) {
  const applied = [];

  if (plan.labels.add.length) {
    await api(`/repos/${owner}/${repo}/issues/${pullNumber}/labels`, {
      method: "POST",
      body: { labels: plan.labels.add },
      token,
    });
    applied.push(`added labels: ${plan.labels.add.join(", ")}`);
  }
  for (const label of plan.labels.remove) {
    try {
      await api(
        `/repos/${owner}/${repo}/issues/${pullNumber}/labels/${encodeURIComponent(label)}`,
        { method: "DELETE", token },
      );
      applied.push(`removed label: ${label}`);
    } catch (error) {
      // Someone else removed it between the read and this write. The desired state already holds,
      // so this must not fail the run.
      if (!String(error.message).includes("failed with 404")) throw error;
      applied.push(`label already absent: ${label}`);
    }
  }

  // A successful POST is the delivery boundary. It runs before the sticky comment is cleared or
  // the gate is refreshed, so a failure can replace both with an explicit blocker. Mutating
  // requests are never retried blindly: if GitHub accepted the comment but the response was lost,
  // the next reconciliation sees its marker and deduplicates it.
  if (plan.notification) {
    try {
      if (plan.notification.error) throw new Error(plan.notification.error);
      await api(`/repos/${owner}/${repo}/issues/${pullNumber}/comments`, {
        method: "POST",
        body: { body: plan.notification.body },
        token,
      });
      applied.push(`delivered review choice for ${headSha}`);
    } catch (error) {
      await recordDeliveryFailure({
        owner,
        repo,
        pullNumber,
        token,
        notification: plan.notification,
        statusCommentId,
        statusCommentBody,
        headSha,
        targetUrl,
        error,
        plannedCommentBody: plan.comment?.body ?? null,
      });
      throw new Error(
        `Review-choice notification delivery failed for ${headSha}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // Best-effort on purpose. The blocker text already documents the manual remedy — remove and
  // reset the review-mode label — so a failed dispatch here must never abort the labels, the
  // sticky comment or the merge-gate status the rest of this run would otherwise apply. A dispatch
  // that succeeds but whose marker comment fails to post is not retried within this run either: the
  // next reconciliation sees no marker and simply tries again, which the target workflow's own
  // per-pull-request concurrency group and head-bound result check make safe to repeat.
  if (plan.retrigger) {
    try {
      await api(
        `/repos/${owner}/${repo}/actions/workflows/${plan.retrigger.workflowFile}/dispatches`,
        {
          method: "POST",
          body: {
            ref: plan.retrigger.ref,
            inputs: { pull_request: String(pullNumber) },
          },
          token,
        },
      );
      await api(`/repos/${owner}/${repo}/issues/${pullNumber}/comments`, {
        method: "POST",
        body: { body: plan.retrigger.commentBody },
        token,
      });
      applied.push(`retriggered ${plan.retrigger.workflowFile} for ${headSha}`);
    } catch (error) {
      console.error(
        `Could not retrigger ${plan.retrigger.workflowFile} for ${headSha}: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
      applied.push(`retrigger of ${plan.retrigger.workflowFile} failed for ${headSha}`);
    }
  }

  if (plan.comment) {
    if (statusCommentId) {
      await api(`/repos/${owner}/${repo}/issues/comments/${statusCommentId}`, {
        method: "PATCH",
        body: { body: plan.comment.body },
        token,
      });
      applied.push("updated status comment");
    } else {
      await api(`/repos/${owner}/${repo}/issues/${pullNumber}/comments`, {
        method: "POST",
        body: { body: plan.comment.body },
        token,
      });
      applied.push("created status comment");
    }
  }

  // Last on purpose. A failure above aborts the run before the gate moves, so the verdict on the
  // commit can go stale only in the blocking direction, never towards an unearned `success`.
  if (plan.status) {
    try {
      await api(`/repos/${owner}/${repo}/statuses/${headSha}`, {
        method: "POST",
        body: {
          state: plan.status.state,
          context: plan.status.context,
          description: plan.status.description,
          ...(targetUrl ? { target_url: targetUrl } : {}),
        },
        token,
      });
      applied.push(`set ${plan.status.context} to ${plan.status.state}`);
    } catch (error) {
      // A head commit this repository cannot address — a fork branch deleted mid-run, for example
      // — carries no status. Report it and keep the labels and the status comment, which are the
      // part a maintainer actually reads.
      if (!String(error.message).includes("failed with 422")) throw error;
      console.error(
        `Could not write the merge-gate status: ${headSha} is not addressable in ${owner}/${repo}.`,
      );
      applied.push(`merge-gate status skipped for ${headSha}`);
    }
  }

  return applied;
}

function option(args, name) {
  const index = args.indexOf(name);
  if (index === -1 || index + 1 >= args.length) return null;
  return args[index + 1];
}

/**
 * Link target for the merge-gate status: the run that wrote it.
 *
 * The description holds only the first blocker, so the status needs somewhere to point for the
 * full picture. Returns null outside Actions, where no run exists to link to.
 */
function currentRunUrl() {
  const server = process.env.GITHUB_SERVER_URL;
  const repository = process.env.GITHUB_REPOSITORY;
  const runId = process.env.GITHUB_RUN_ID;
  if (!server || !repository || !runId) return null;
  return `${server}/${repository}/actions/runs/${runId}`;
}

async function reconcileCommand(args) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("reconcile requires GITHUB_TOKEN in the environment.");

  // Global kill switch, independent of any single pull request.
  if ((process.env.AGENT_PIPELINE_DISABLED ?? "").toLowerCase() === "true") {
    console.log("Agent pipeline is globally disabled; no pull request was touched.");
    return;
  }

  const repository = option(args, "--repository") ?? process.env.GITHUB_REPOSITORY;
  const pullNumber = option(args, "--pr");
  const apply = args.includes("--apply");
  if (!repository || !pullNumber) {
    throw new Error("reconcile requires --repository <owner/repo> and --pr <number>.");
  }
  const [owner, repo] = repository.split("/");

  const { snapshot, statusCommentId } = await fetchSnapshot({
    owner,
    repo,
    pullNumber,
    token,
  });
  const plan = reconcile(snapshot, loadConfig(), {
    notificationRecipient: process.env.AGENT_PIPELINE_OWNER,
  });

  console.log(
    JSON.stringify(
      {
        pullNumber: Number(pullNumber),
        headSha: snapshot.headSha,
        phase: plan.readiness.phase,
        ready: plan.readiness.ready,
        blockers: plan.readiness.blockers,
        labels: plan.labels,
        commentChanged: Boolean(plan.comment),
        reviewChoiceNotification: plan.notification
          ? plan.notification.error
            ? `blocked: ${plan.notification.error}`
            : "delivery planned"
          : "no delivery needed",
        reviewRetrigger: plan.retrigger
          ? `dispatch planned: ${plan.retrigger.workflowFile}`
          : "no retrigger needed",
        gateStatus: plan.status
          ? { state: plan.status.state, description: plan.status.description }
          : "no write needed",
      },
      null,
      2,
    ),
  );

  if (!apply) {
    console.log("Dry run: no changes were written.");
    return;
  }

  const applied = await applyPlan({
    owner,
    repo,
    pullNumber,
    token,
    plan,
    statusCommentId,
    statusCommentBody: snapshot.statusCommentBody,
    headSha: snapshot.headSha,
    targetUrl: option(args, "--target-url") ?? currentRunUrl(),
  });
  console.log(applied.length ? applied.join("\n") : "Nothing to change.");
}

const isMainModule =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMainModule) {
  const [command, ...args] = process.argv.slice(2);
  try {
    if (command === "reconcile") await reconcileCommand(args);
    else {
      throw new Error(
        "Usage: node scripts/agent-pipeline-reconcile.mjs reconcile --pr <number> [--repository <owner/repo>] [--target-url <url>] [--apply]",
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
