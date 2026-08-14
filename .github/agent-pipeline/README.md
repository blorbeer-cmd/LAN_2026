# Agent pipeline foundation

This directory contains configuration for the agent PR pipeline described in
`docs/plans/auto-feature-to-deploy-pipeline.md`.

## Current rollout state

The pipeline reports state and has narrow provider actions for both regular cross-review directions:

- `.github/workflows/agent-pipeline-contract.yml` validates an activated task contract.
- `scripts/agent-pipeline.mjs` parses and validates task contracts.
- `scripts/agent-pipeline-reconcile.mjs` derives the readiness state, keeps the pipeline labels,
  sticky status comment and merge-gate commit status in sync, and actively delivers one
  mention-bearing review choice per eligible head (phases 2 and 7 of the plan).
- `scripts/agent-pipeline-select-prs.mjs` limits scheduled safety sweeps to pull requests with an
  activated task contract, an agent branch/label, or a missing merge-gate status.
- `.github/workflows/agent-pipeline-reconcile.yml` runs that reconciler per pull request.
- `.github/workflows/agent-pipeline-claude-review.yml` starts one read-only Claude cross-review
  after the user chooses `review:cross` for a Codex implementation.
- `scripts/agent-claude-review.mjs` reuses the readiness snapshot, validates Claude's structured
  result and publishes its head-bound marker.
- `.github/workflows/agent-pipeline-codex-review.yml` requests one native Codex cross-review after
  the user chooses `review:cross` for a Claude implementation.
- `scripts/agent-codex-review.mjs` reuses the readiness snapshot and posts one exact-head-bound
  `@codex review` request under the identity in `AGENT_PIPELINE_REVIEW_REQUEST_TOKEN`; Codex submits
  the native GitHub review and the reconciler evaluates it.
- `.github/workflows/agent-pipeline-claude-self-review.yml` starts one read-only Claude review after
  the user chooses `review:self` for a Claude implementation — the automated, credential-read-only
  equivalent of running `scripts/agent-review-session.mjs --mode self --headless` locally. It shares
  its restricted-job shape (inert diff-only PR-head input, no write credentials, no editing or shell
  tools) with the cross-review workflow, but the same provider judges its own implementation, so the
  result is still reduced independence, exactly as an interactively launched self-review would be.
- `scripts/agent-claude-self-review.mjs` reuses the readiness snapshot, validates Claude's
  structured result and publishes its head-bound `mode=self` marker; `selfReviewResultAuthors` adds
  this workflow's `github-actions[bot]` identity as a second accepted source for that marker,
  alongside a manually posted one from `claude[bot]` or the human operator. It only ever fires for a
  Claude implementer — a Codex self-review still runs through the detached Codex `/review` route
  described in `review-session-prompt.md`, which this workflow does not touch.
- `scripts/agent-pipeline-codex-adapter.mjs` exposes the trusted GitHub outbox to the single
  persistent Codex heartbeat monitor. It emits undelivered review choices, completed reviews and
  provider-start failures only for Codex implementations, maps them to an explicit
  `codex-thread-id` or a unique matching head branch, and records a durable GitHub acknowledgement
  only after the task message was sent successfully. Claude implementations have no Codex target:
  their GitHub comments remain the documented outbox until a real Claude-session connector exists.
- `.github/workflows/agent-pipeline-tests.yml` runs the pipeline and provider-adapter unit tests.
- `review-session-prompt.md` contains the copy-paste prompt and operating instructions for an
  isolated Codex or Claude review session.
- `review-decision.md` describes the one decision that is not automated: who reviews the current
  head.
- The `pull_request_target` workflow definitions are loaded from the trusted default branch and run
  the validator, reconciler and configuration from that same trusted branch. The declared PR base
  must equal the configured default branch. The Claude workflow checks the pull-request head out
  only long enough to render an inert diff, then removes the checkout before the provider secret is
  exposed. Claude receives the diff but no PR-owned `CLAUDE.md`, `AGENTS.md` or `.claude` settings;
  no pull-request code, tests, hooks or package-manager commands are executed.
- The provider adapters have no automatic retry, round counter, approval or merge. The Codex task
  delivery adapter wakes only the Codex implementation task with completed findings and tells it to
  run the normal fix/re-review procedure; the pipeline still has no independent fix worker. A
  trusted terminal start failure is reconciled back to the user's review choice, where the user may
  select the same provider again. The merge-gate status is active as a required check on `main`.

The local automation `agent-pipeline-codex-zustellung` is a five-minute heartbeat bound to exactly
one dedicated monitor task. Empty scans use `failed_runs_only` and produce no notification. The
monitor never changes `review:*` labels and acknowledges an event only after the thread send
returns successfully. A second scheduled run is still required as an operational acceptance check
after this configuration change; no new sidebar task is expected from either run.

## Readiness reconciler

The reconciler reads the complete current state from GitHub on every run and computes readiness as
a pure function of that snapshot. It keeps no history of its own, so a duplicated, delayed or
out-of-order event cannot corrupt the result, and every head-bound fact that does not belong to the
current head SHA falls back to "unknown" and therefore blocks. This is the architecture fixed in
`docs/plans/auto-feature-to-deploy-pipeline.md`; the earlier event-reducer draft was rejected.

What it does:

- maintains `agent:pipeline` plus at most one phase label
  (`agent:implementing`, `agent:ci-fix`, `agent:conflict-fix`, `agent:review`,
  `agent:ready-for-merge`) and `ui:changed`. A pull request held by `agent:waiting`,
  `agent:needs-human` or the human-approval wait gets no phase label, because those states are
  already named by their own label or by the status comment,
- maintains one sticky status comment marked with `<!-- agent-pipeline:status -->`,
- reports every open blocker in that comment, asks for the review mode while it is missing (also on
  draft pull requests) and records the answer,
- creates one separate, machine-marked `@AGENT_PIPELINE_OWNER` notification per eligible head and
  records delivery failure as a visible blocker,
- removes a `review:*` label that was bound to an earlier head, so the choice is asked again,
- writes the `Agent pipeline / ready for human merge` commit status for the current head SHA.

What the reconciler deliberately does not do:

- start an agent, request a review, or push a fix; the separate provider adapters own their launches,
- approve or merge anything,
- set or clear `agent:waiting` and `agent:review-fallback`, which belong to the provider phases,
- choose the review mode, or set any `review:*` label.

Who may satisfy the `cross` review is configured in `providerReviewerAllowlist`, deliberately
separate from `providerAuthorAllowlist`. The author list contains the human maintainer, so reusing
it would let a single human approval count as the counter provider's review — and in `cross` mode
also satisfy the protected-path approval at the same time, two independent gates collapsing into
one click. Only agent identities can produce a cross-review verdict; human review evidence counts
only for the human gate and satisfies the review itself only in the explicitly chosen `human` mode.

## Review-mode selection

Who reviews the current head is the user's decision, taken per head SHA, because it is really a
question about which provider's quota to spend. Everything else stays automatic.

The answer is one of three labels. An interactive session sets the label for the user right after
they answer, so nobody has to switch to GitHub for it — but only ever as a transcription of an
explicit answer, never invented or changed on its own. Unattended automation never sets one: not
the reconciler, not a later dispatcher, not a review session, not a CI job. An agent choosing its
own review mode would be helping itself past the merge gate. The gate cannot verify that
provenance — it only sees a label — so the rule is binding and the pull request's label history is
the audit trail.

| Label          | Mode    | What satisfies the gate for the current head SHA                                                                                                                                                                        |
| -------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `review:cross` | `cross` | per `crossReviewEvidence`: a native counter-provider review, a finding-free review the counter provider reported in a comment naming this exact head, or for Claude a credential-read-only structured result published by the dedicated trusted workflow for this exact head |
| `review:self`  | `self`  | a published `agent-pipeline:review-result` marker: same head, `verdict=pass`, a `read-only` level meeting `selfReviewMinimumEnforcement` (default `verified`), from one of the implementation provider's own identities |
| `review:human` | `human` | an approving review from an account with write access, or the PR author's `COMMENTED` review when GitHub forbids self-approval, covering exactly this head                                                       |

With no label set and everything mechanical green, the pull request sits in the
`awaiting-review-decision` phase. The sticky status comment keeps showing the full state, but it is
not delivery. The reconciler also creates one new, mention-bearing comment for that head SHA,
marked `agent-pipeline:review-decision-notification`; it names the implementer, counter provider,
head-bound change delta, prior finding severities, open threads, provider/timeout state,
recommendation, reason and all three choices. `AGENT_PIPELINE_OWNER` supplies the mentioned GitHub
login. Existing markers deduplicate event, schedule and workflow reruns, while a new head gets a
new notification only after CI, mergeability, review-thread and protected-path prerequisites are
clear. Nothing starts on a timeout: an automatic fallback would spend exactly the quota this
decision exists to steer. Two labels at once block rather than picking a winner.

GitHub Actions has no callable Codex App or task-wakeup API. GitHub is therefore the durable outbox,
while a Codex scheduled monitor is the external adapter: it runs `scan`, resolves the task from the
optional `codex-thread-id` contract field or from a unique local task whose checked-out branch
equals the PR head, sends the canonical message with the Codex thread tool, and runs `ack` only
after the send succeeds. The acknowledgement marker
`agent-pipeline:codex-delivery <event-id> thread=<thread-id>` deduplicates later runs across
machines. Unresolved mappings and failed sends remain unacknowledged and are retried; the monitor
never sets a `review:*` label itself.

This boundary is provider-specific. The Codex desktop tools expose no reliable wake-up interface
for an original Claude session, so the adapter emits no Codex delivery event for a Claude
implementation, never invents a Claude task ID, and never treats a `claude/*` branch as a Codex
task. Claude's GitHub review comments and workflow events are therefore its durable outbox until a
real, separately authenticated Claude connector is available.

A failed notification POST is not folded into the sticky update. The reconciler writes an
`agent-pipeline:review-decision-delivery-failure` record into the sticky comment, posts a pending
`review-decision-delivery-failed` merge-gate status, and fails the workflow. A later run retries.
Mutating requests are not blindly retried, so a lost HTTP response cannot create a duplicate: if
GitHub accepted the comment, its marker is read before the next attempt.

Draft status does not prevent this question or the selected review from starting. It remains a
merge blocker, so the final readiness status stays pending until the pull request is marked ready
for review.

The choice expires with its head. Every run records the head it saw in the reconciler's own status
comment (`agent-pipeline:review-decision`), including as `mode=none` while nothing is chosen. A
label binds only when a record for the _current_ head already exists — the run that wrote it removed
any label standing at the time, so a label next to it must have arrived afterwards. Without a record
for the current head the label cannot be vouched for, is removed, and the question is asked again.

The record counts only from an identity in `statusCommentAuthors`. Adopting a comment to update
uses the wide trusted-author check, which accepts every `[bot]` login; the binding may not, or a
decoy comment carrying the marker could bind an old label whenever the real status comment is
missing.

A run that changes no labels records no head either — with two review-mode labels standing, or with
a broken task contract, the previous record is carried through unchanged. Recording a head asserts
"any label standing now arrived after me", and that is only true of a run that cleared them.

That `none` state is what closes the hole: with it, "no record" is distinguishable from "chosen for
this head". Without it, a deleted status comment, a paused pipeline or a skipped bootstrap run was
enough for a choice made at head A to apply at head D — the ambiguity resolved towards accepting an
answer the user gave for code they never saw. The price is one extra round when a label is set in
the same moment a new head appears; the safe direction is asking twice, not binding once too often.

Switching the label at the same head is a legitimate correction — the counter provider running out
of quota mid-round is the case this exists for — and simply rebinds.

`self` and `human` are weaker than a cross-review, deliberately and visibly:

- In `self` mode the gate can verify that the result marker is head-bound, complete and posted by
  one of that provider's own identities — not that the session really was independent or read-only.
  It believes a claim made by the provider that also implemented the change. The author check is
  deliberately narrower than `isTrustedCommentAuthor`, which accepts every `[bot]` login: any app
  installed on the repository would otherwise be able to declare a self-review passed.
- In `human` mode review and merge are the same person.

Both are acceptable only because they were explicitly chosen for one specific head, stay visible as
a label, and are named as reduced independence in the status comment. The pull request's label
history is the audit trail for who chose what and when. Every other gate condition — green checks,
no conflict, resolved threads, the UI/UX notice, human review of protected paths — applies
unchanged in all three modes, and the merge stays with the user in all of them.

## Six-field acceptance matrix and pilot status

The acceptance standard is table-driven in `scripts/agent-pipeline-reconcile.test.mjs` and covers
every implementer/mode pair:

| Implementer | `cross` | `self` | `human` |
| --- | --- | --- | --- |
| `codex` | Claude evidence | Codex result marker | native human review |
| `claude` | Codex native review | Claude result marker | native human review |

Each cell checks the reviewer/evidence type, exact head binding, pass and `changes-required`, stale
evidence, new-commit invalidation, selected-mode exclusivity, absence of automatic fallback or
label replacement, and unresolved-thread blocking. Adapter tests additionally cover explicit task
IDs, unique and ambiguous branch fallback, missing targets, Claude's lack of a Codex target, clean
pass versus findings, event order and acknowledgement idempotence.

The live provider pilots currently documented for this repository are Codex → Claude cross-review
(PR #399), Claude → Codex cross-review (PR #394), Codex self-review (PR #383), and Claude
self-review (PR #391) — that last one via the local `agent-review-session.mjs --headless` launcher.
The Required Check `Agent pipeline / ready for human merge` is active on `main`. A post-#396,
no-bypass human pilot for both implementer directions is not yet fulfilled; it remains an explicit
acceptance blocker until the exact current head has a native human review, resolved threads and a
successful gate result. No administrative bypass is evidence for that pilot. The
`agent-pipeline-claude-self-review.yml` workflow automates the same Claude self-review path inside
CI and is not yet separately piloted; the gate treats its marker exactly like the launcher's,
so no acceptance criteria change, but a first live run should still be observed before relying on it.

## Automated provider cross-review

For a Codex implementation, applying `review:cross` starts the Claude adapter only when the shared
`deriveReadiness` result is actually in phase `review` and names Claude as the counter provider.
The label should therefore be applied only after the status comment asks for the review decision;
if a mechanical or protected-path blocker is still open, clear it and reapply the label afterwards.
Concurrency serializes the recoverable reconcile transition per pull request. The publisher stays
outside that lock so a regular reconcile run cannot cancel the only copy of a completed model
result. After a terminal `pass` or `changes-required` result is published, the current head-bound
marker makes later duplicate or manual events no-ops. A `blocked` result remains explicitly
retryable by reapplying the label or manually dispatching the workflow.

The read-only review job checks out trusted `main` at the workspace root and the exact pull-request
head in a temporary subdirectory. It generates the diff with external diff drivers and text
conversion disabled, deletes that subdirectory, and only then invokes Claude. The action is pinned
to a commit, receives a short-lived `GITHUB_TOKEN` whose repository permissions are all read-only,
and disables shell, editing and web tools. The action's base GitHub tools remain present, but the
job token makes every repository operation available to them read-only. The model returns only
schema-validated JSON whose length limits match the publisher. A separate publisher job has no PR
checkout; trusted repository code there verifies that the PR still points at the reviewed SHA,
rejects malformed or inconsistent verdicts, bounds the final comment size and neutralizes injected
Markdown and HTML. The gate accepts its marker only when the comment begins with the publisher's
exact heading, not when another `github-actions[bot]` comment merely echoes a marker.

A trusted publisher records terminal start failures with the exact head SHA and a unique workflow
attempt. The serialized recovery job consumes each attempt once, removes only the failed
head-bound `review:cross` choice and returns the PR to `awaiting-review-decision`. The status names
the observed reason and offers `cross`, `self` and `human` again; provider failures recommend a
fresh same-provider review, while declined preconditions may recommend retrying cross. It never
chooses or starts a fallback. Repeated notices are idempotent, stale-head notices are ignored, and
the same provider remains manually retryable after the handled-attempt marker is recorded. A new
commit likewise invalidates the result and asks again. Automatic provider retries, review-round
counting and findings-to-fix orchestration remain later phases.

For a Claude implementation, applying `review:cross` starts the Codex adapter under the same
readiness and concurrency rules. The adapter checks that Codex is the configured counter provider,
confirms that the current head has no submitted Codex review, and posts exactly one
`@codex review` comment with an exact-head marker. The marker is only a request and never counts as
review evidence. Codex must submit its native GitHub review; the reconciler then evaluates that
review for the current head and unresolved threads.

What comes back is asymmetric, and the gate has to know both shapes. With findings, Codex submits a
native GitHub review whose commit SHA GitHub itself binds. Without findings it submits nothing and
answers in a comment — `Codex Review: Didn't find any major issues.` followed by the reviewed
commit. That comment is the only head-bound record such a review leaves, so the reconciler reads it
as evidence when the configured reviewer identity wrote it and the named commit is the current head.
An `issue_comment` event from the exact Codex connector identity reconciles that clean pass
immediately; quoted wording from users or unrelated bots cannot start this path. A valid clean pass
also supersedes an older start-failure notice for the same head, just like a submitted review does.
The comment that accompanies findings prints the same commit line and is deliberately not accepted:
only the clean-pass wording distinguishes them, and its findings block through their open threads.

The identity of that comment decides whether Codex acts on it. A request posted with the job token
arrives as `github-actions[bot]`, which the integration answers with "To use Codex here, create a
Codex account and connect to github" instead of a review — the pull request then waits forever on a
review that was never accepted. The adapter therefore posts only with the separate Actions secret
`AGENT_PIPELINE_REVIEW_REQUEST_TOKEN`, which must hold a token of a GitHub account connected to
Codex, and it never falls back to the job token. Three cases are treated as a failed review attempt
rather than as a request: a missing or empty secret, a token whose identity cannot be resolved, and
a request the integration refuses. A refusal is recognised at the comment — a
`chatgpt-codex-connector[bot]` comment that names the connector settings, follows this head's own
request and precedes any later `@codex review` — so the adapter waits a short bounded time after
posting instead of inferring the failure from a review that never arrives, and somebody else's
refused request is never blamed on this one. A past refusal does not block the head: it describes
the account's state at the time, and the way out the notice names is to connect that account and
set `review:cross` again. Such a retry retires the earlier notice by rewriting it without the
marker, so the reconciler stops reporting a failed attempt while a request is outstanding. An
unanswered request is different and is never repeated.

Each failed attempt fails the request job and writes the `agent-pipeline:review-start-notice`
comment for the head, the same marker the Claude adapter uses, so the pull request names the cause
and the way out. The workflow then runs the reconciler itself, because that comment is written with
the job token and GitHub starts no workflow run from such an event — without it the announced
failure would stay out of the sticky status until the half-hourly sweep. Only one workflow ever
writes the notice for a head: the adapter whose provider is not the counter provider stays silent,
and a job that died before deriving anything re-checks current eligibility before writing at all.

For a Claude implementation, applying `review:self` starts `agent-pipeline-claude-self-review.yml`
under the same readiness, concurrency and diff-only-input rules as the Claude cross-review workflow
— restricted tools, no editing or shell access, a job token with read-only repository permissions,
and the PR-head checkout removed before the provider credential is used. The only differences are
the eligibility check (`reviewMode === "self"` and the *implementer*, not the counter provider, is
`claude`) and the published marker, which carries `mode=self` and the `## Claude Self-Review`
heading instead of the cross-review one. `deriveReadiness` accepts that marker from
`selfReviewResultAuthors.claude` (`github-actions[bot]`) exactly like `crossReviewResultAuthors`
already does for cross, alongside a manually posted marker from `claude[bot]` or the human operator
running `scripts/agent-review-session.mjs --mode self --headless`; both are valid evidence, and
whichever is newer for the current head wins. Because the same provider that implemented the change
also reviews it here, this stays reduced independence regardless of how the review was launched —
the merge gate already reflects that in the `self` mode row, and choosing this mode remains the
user's decision, never the pipeline's. A Codex self-review is not covered by any workflow: it still
runs through the detached Codex `/review` route in `review-session-prompt.md`, verified by an
operator independent of the implementation session before its marker is published by hand.

Escalations the reconciler cannot derive from GitHub state — an exhausted round limit, a critical
decision, the 24-hour waiting escalation — stay with `agent:needs-human`, exactly as the plan
describes: raised by a human or by a later provider phase, blocking while set, and never written
or cleared here. The one escalation this phase can derive, a protected path awaiting human
review, uses its own `awaiting-human-approval` phase instead of borrowing that label, so a native
review of the head clears it without label bookkeeping and no genuine escalation is ever wiped by
a sweep. To stop automation by hand, use `agent:no-auto`.

The pipeline's own check runs are excluded from the CI evaluation via `selfCheckNames`. The
reconcile, Claude-cross-review, Claude-self-review, and Codex-review workflows run on
`pull_request_target`, whose check runs attach to the pull request's head SHA, so without that
exclusion the reconciler would read its own job as a running — or, after `cancel-in-progress`, a
cancelled and therefore failing — CI check. `selfCheckNames` must stay in sync with the job names in
all four workflow files.

The CI/CD workflow reports the stable aggregate `Test performance`. `Detect test performance`
compares the measured suites and, only after a preliminary warning, starts
`Confirm test performance (<suite>)`. The aggregate consumes their artifacts and fails closed for
a confirmed regression or any detector/confirmation failure; it succeeds when no confirmation is
needed or the fresh rerun is below the threshold. Its summary reports suite, baseline, current
duration, deviation and verdict. Only the stable aggregate is the branch-protection context. The
thresholds and suite-to-step mapping live in `.github/test-performance.json`.

Idempotence: labels already in the desired state produce no API call, an unchanged status comment
body is not rewritten, an unchanged gate verdict is not posted again, and a head with an existing
review-choice notification marker is never notified again. Re-running the reconciler on an
unchanged pull request performs no writes at all.

Transient GitHub read failures are retried up to three times with bounded exponential backoff.
This covers network errors, rate limits and temporary `5xx` responses for REST `GET` requests and
the read-only GraphQL query. Mutating requests are deliberately never retried automatically,
because a lost response must not duplicate a comment or another write.

Event-scoped runs still reconcile exactly their pull request. The 30-minute safety sweep first
selects only open pull requests with an activated task contract, an agent-looking branch/label, or
without the `Agent pipeline / ready for human merge` status on their current head. The
missing-status case lets a future required context self-heal for ordinary and Dependabot pull
requests as well. The matrix and its per-pull-request concurrency remain in place, so scheduled
and event-driven writes cannot race.

## Merge gate

The `Agent pipeline / ready for human merge` commit status is the required check from section 11
of the plan. It is written for the pull request's current head SHA and knows two states:

- `success` once `deriveReadiness` reports no blocker left, described as "the merge stays yours",
- `pending` while any blocker is open, described as `<phase>: <first blocker> (+N more)`, trimmed
  to GitHub's 140-character limit and linked to the run that wrote it.

A blocked pull request is pending rather than failing: the pipeline is still working on it, and
the merge box should read as "waiting", not as a broken check. The reason lives in the
description, so the merge box shows it without opening the status comment.

Two cases deliberately get `success` even though the pipeline does not manage them at all:

- a genuinely manual same-repository pull request outside `codex/*`, `claude/*` and
  `agent:pipeline`, with no activated task contract,
- a fork pull request.

Both report "the agent-pipeline gate does not apply". Once this context is a required check, a
status that is never written leaves the pull request unmergeable forever, so staying silent would
deadlock every pull request the gate was never meant to cover. In contrast, an agent-looking branch
or `agent:pipeline` label without an activated valid contract is explicitly `pending` with an
invalid-contract blocker; omitting the contract cannot bypass the gate.

The kill switch is the one case where nothing else is written but the gate still is.
`agent:no-auto` suppresses every mutation, yet section 11 counts it as a gate condition of its
own; leaving an earlier `success` in place would make a paused pull request mergeable while
paused. A closed or merged pull request gets no verdict at all.

The reconcile workflow needs `statuses: write` for this and nothing more. That permission covers
commit statuses only — no code, no branches, and not the merge.

Kill switches:

- `agent:no-auto` on a pull request suppresses every mutation for that pull request,
- the repository variable `AGENT_PIPELINE_DISABLED=true` suppresses all runs,
- disabling the workflow stops it entirely.

Local dry run against a real pull request (reads only, writes nothing without `--apply`):

```powershell
$env:GITHUB_TOKEN = "<token with pull-requests: read>"
node scripts/agent-pipeline-reconcile.mjs reconcile --repository blorbeer-cmd/LAN_2026 --pr 123
```

Do not make `Agent pipeline / contract` a required check until this foundation has been merged and
the first post-merge pilot run has succeeded. GitHub does not run a newly introduced
`pull_request_target` workflow from the introducing PR; this is the intentional trust-preserving
bootstrap. Once the workflow exists on the default branch, its definition cannot be replaced by a
feature branch. Until the default branch contains the validator, it reports a documented skip and
executes no pull-request-head code.

## Activating a PR

Replace the placeholder values in the hidden `agent-pipeline:task` block from
`.github/pull_request_template.md`. Leaving the template untouched keeps a human PR outside the
pipeline. A participating PR must use a same-repository `codex/*` or `claude/*` branch matching its
declared implementer, and its verified PR author must appear in that provider's
`providerAuthorAllowlist`. The declared scope must cover every non-documentation path in the
merge-base diff; use `root` for intentional multi-area changes. `ui-change: unknown` remains
blocking until a later classification resolves it.

Codex implementations should also populate the optional `codex-thread-id` with the originating
desktop task UUID. `none` remains valid for Claude implementations and older tasks. When it is
absent, the delivery monitor falls back to a unique local Codex task whose checked-out branch
matches `head-branch`; an ambiguous fallback is deliberately left unacknowledged and retried.

Changes below `infra/` are reported as protected paths. The reconciler holds such a pull request
in the `awaiting-human-approval` phase until an independent human approval covers the exact current head SHA,
because no agent can clear that condition itself. Workflow changes below `.github/workflows/` remain
sensitive and therefore select the independent cross-review, but no longer require a second human
account solely because the workflow file changed. A merge conflict or a failing check still takes
precedence, since an agent can resolve those; the approval blocker stays listed and readiness
remains closed either way.

That approval only counts from an account with write access — `author_association` of `OWNER`,
`MEMBER` or `COLLABORATOR` — and its `commit_id` must match the current head. GitHub does not let
PR authors approve their own PRs, so protected-path changes require a collaborating account or an
administrator's manual bypass. This repository is public and allows forking, so any GitHub account
can submit reviews; without the write-access and exact-head checks, a drive-by review from an
outsider or an old review could satisfy the control.

Fork pull requests are dropped before the task contract is even parsed, and receive no label and
no comment. The pull-request body is under the fork author's control, so any later decision point
would let an outsider steer the pipeline bot into writing on their own pull request. This matches
the plan: the writing automation is for branches in the main repository only.

For the same reason, comments only count when they come from a bot identity or an account with
write access. The UI/UX notice satisfies a merge gate, so anyone able to post `<!--
agent-pipeline:ui-notice <head sha> -->` could otherwise declare a UI change reviewed that nobody
looked at. The sticky status comment is matched the same way, so a decoy comment carrying the
marker is never adopted and overwritten — the reconciler posts its own alongside it instead.

GitHub forbids approving your own pull request. To keep the solo-maintainer path usable, the
reconciler accepts the PR author's native `COMMENTED` review as human evidence only when it is
bound to the exact current head and the author has write access. A collaborating account still
uses a normal approval. This exception applies only to an explicitly selected `review:human` mode;
it does not satisfy the independent approval required for protected `infra/` paths. Workflow-only
changes continue to use the automated cross-review.

## Local verification

```powershell
node --test scripts/agent-pipeline.test.mjs
node --test scripts/agent-pipeline-reconcile.test.mjs
node --test scripts/agent-pipeline-select-prs.test.mjs
node --test scripts/agent-claude-review.test.mjs
node --test scripts/agent-claude-self-review.test.mjs
node --test scripts/agent-codex-review.test.mjs
node --test scripts/agent-preflight.test.mjs
git diff --check
```

The validator and the test suites write nothing to GitHub. With `--apply`, the reconciler writes
only pipeline labels, its own sticky status comment, the once-per-head review-choice notification
and the `Agent pipeline / ready for human merge` status. It never sets a review-mode label. The
Claude adapter writes one validated review result comment and then invokes that same reconciler;
the Codex adapter writes one `@codex review` request. Codex then submits the native review that the
reconciler evaluates. `config.json` already declares the labels and timeouts later phases will use;
the ones this rollout does not own are inert until then.

For a manual Codex cross-review or fallback review during the rollout, follow
[`review-session-prompt.md`](review-session-prompt.md). A new commit invalidates the previous
verdict and requires a fresh session for the new head SHA.

## Manual setup

Completed for this repository:

1. Claude's GitHub App is connected and `CLAUDE_CODE_OAUTH_TOKEN` is stored as an Actions secret.
2. Codex code review is enabled without global automatic reviews; the orchestrator will request one
   review per current head SHA.
3. The GitHub username for notifications is stored in repository variable `AGENT_PIPELINE_OWNER`.
4. `providerAuthorAllowlist` lists the verified actors for both providers.
5. Pipeline labels from `config.json` exist in the repository, including the three review-mode
   labels `review:cross`, `review:self` and `review:human`.
6. `AGENT_PIPELINE_REVIEW_REQUEST_TOKEN` is stored as an Actions secret. It holds a token of a
   GitHub account connected to Codex, because the integration refuses a review request from
   `github-actions[bot]`. A fine-grained token scoped to this repository with `Contents: read`,
   `Issues: read and write` and `Pull requests: read and write` covers what the workflow does:
   read the pull-request state and post one comment. Review requests therefore appear under that
   account. When the secret is missing or its token expires, no request is posted at all — the
   attempt is reported as failed instead, and the review can be requested by commenting
   `@codex review` by hand as the connected account.

Still required before expanding agent mutations:

1. After both provider workflows have reached the default branch, verify in pilot pull requests that
   applying `review:cross` to a ready Codex head produces one `github-actions[bot]` result comment,
   applying it to a ready Claude head produces one native Codex review, and both results name or
   cover the exact head SHA without repository file or branch changes.
2. Verify in a pilot pull request that both app identities can update their own feature branches
   but cannot push or merge to `main`.
3. Complete the post-#396 human-review pilot in both implementer directions without an admin
   bypass, and retain the PR/head/review/gate evidence. The `Agent pipeline / ready for human
   merge` context is already active as a required check on `main`; do not replace the existing
   required checks.

The context is already written by the active reconciler for relevant heads. Ordinary and fork pull
requests remain outside the agent-pipeline contract and do not use this required context.

Repository workflow defaults may remain read-only. Future jobs must request only the granular
permissions they need.

The repository-local `.codex/rules/agent-pipeline.rules` additionally forbids the common Codex
shell paths for `gh pr merge`, direct `main` pushes and option-first GitHub API merge requests.
Codex loads project rules only from a trusted project layer and after restart. This complements the
binding `AGENTS.md` prohibition; it cannot make GitHub distinguish a human from an app connector
that deliberately uses the same maintainer identity, so unattended environments should still use
a dedicated credential without merge or `main` write permission where one is available.
