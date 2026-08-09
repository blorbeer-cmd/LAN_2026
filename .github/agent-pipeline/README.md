# Agent pipeline foundation

This directory contains configuration for the agent PR pipeline described in
`docs/plans/auto-feature-to-deploy-pipeline.md`.

## Current rollout state

The pipeline reports state and has one deliberately narrow provider action:

- `.github/workflows/agent-pipeline-contract.yml` validates an activated task contract.
- `scripts/agent-pipeline.mjs` parses and validates task contracts.
- `scripts/agent-pipeline-reconcile.mjs` derives the readiness state and keeps the pipeline labels,
  the sticky status comment and the merge-gate commit status in sync (phases 2 and 7 of the plan).
- `scripts/agent-pipeline-select-prs.mjs` limits scheduled safety sweeps to pull requests with an
  activated task contract or a missing merge-gate status.
- `.github/workflows/agent-pipeline-reconcile.yml` runs that reconciler per pull request.
- `.github/workflows/agent-pipeline-claude-review.yml` starts one read-only Claude cross-review
  after the user chooses `review:cross` for a Codex implementation.
- `scripts/agent-claude-review.mjs` reuses the readiness snapshot, validates Claude's structured
  result and publishes its head-bound marker.
- `.github/workflows/agent-pipeline-tests.yml` runs the unit tests for both.
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
- Only the Claude cross-review adapter invokes an agent. It has no automatic retry, round counter,
  fix loop, approval, merge or branch-protection mutation. A user may manually retry a `blocked`
  result. The merge-gate status is written but is not a required check until someone adds it by
  hand.

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
- removes a `review:*` label that was bound to an earlier head, so the choice is asked again,
- writes the `Agent pipeline / ready for human merge` commit status for the current head SHA.

What the reconciler deliberately does not do:

- start an agent, request a review, or push a fix; the separate Claude adapter owns its one launch,
- approve or merge anything,
- set or clear `agent:waiting` and `agent:review-fallback`, which belong to the provider phases,
- choose the review mode, or set any `review:*` label.

Who may satisfy the `cross` review is configured in `providerReviewerAllowlist`, deliberately
separate from `providerAuthorAllowlist`. The author list contains the human maintainer, so reusing
it would let a single human approval count as the counter provider's review — and in `cross` mode
also satisfy the protected-path approval at the same time, two independent gates collapsing into
one click. Only agent identities can produce a cross-review verdict; a human approval counts as the
human approval, and satisfies the review itself only in the explicitly chosen `human` mode.

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
| `review:cross` | `cross` | per `crossReviewEvidence`: a native counter-provider review, or for Claude a credential-read-only structured result published by the dedicated trusted workflow for this exact head                                     |
| `review:self`  | `self`  | a published `agent-pipeline:review-result` marker: same head, `verdict=pass`, a `read-only` level meeting `selfReviewMinimumEnforcement` (default `verified`), from one of the implementation provider's own identities |
| `review:human` | `human` | an approving review from an account with write access, covering exactly this head                                                                                                                                       |

With no label set and everything mechanical green, the pull request sits in the
`awaiting-review-decision` phase and the status comment asks the question, with a recommendation
derived from the changed paths and whether an earlier head already passed. Nothing starts on a
timeout: an automatic fallback would spend exactly the quota this decision exists to steer. Two
labels at once block rather than picking a winner.

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
no conflict, resolved threads, the UI/UX notice, human approval of protected paths — applies
unchanged in all three modes, and the merge stays with the user in all of them.

## Automated Claude cross-review

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

This is intentionally not the complete provider loop. A failed action or `blocked` result is
retried by removing and reapplying the review label or by a manual workflow dispatch. A new commit
invalidates the result and the existing decision logic asks for the review mode again. Automatic
provider retries, review-round counting, fallback selection and findings-to-fix orchestration
remain later phases.

Escalations the reconciler cannot derive from GitHub state — an exhausted round limit, a critical
decision, the 24-hour waiting escalation — stay with `agent:needs-human`, exactly as the plan
describes: raised by a human or by a later provider phase, blocking while set, and never written
or cleared here. The one escalation this phase can derive, a protected path awaiting human
approval, uses its own `awaiting-human-approval` phase instead of borrowing that label, so
approving the head clears it without label bookkeeping and no genuine escalation is ever wiped by
a sweep. To stop automation by hand, use `agent:no-auto`.

The pipeline's own check runs are excluded from the CI evaluation via `selfCheckNames`. The
reconcile and Claude-review workflows run on `pull_request_target`, whose check runs attach to the
pull request's head SHA, so
without that exclusion the reconciler would read its own job as a running — or, after
`cancel-in-progress`, a cancelled and therefore failing — CI check. `selfCheckNames` must stay in
sync with the job names in both workflow files.

The CI/CD workflow also reports `Test performance` and, only after a preliminary runtime warning,
`Confirm test performance (<suite>)`. The latter reruns the affected suite and fails only for a
confirmed regression. These are ordinary head-bound CI checks: an unresolved confirmed slowdown
therefore keeps readiness closed and later belongs to the same CI-fix phase as a reproducible test
failure. The thresholds and suite-to-step mapping live in `.github/test-performance.json`.

Idempotence: labels already in the desired state produce no API call, an unchanged status comment
body is not rewritten, and an unchanged gate verdict is not posted again. Re-running the
reconciler on an unchanged pull request performs no writes at all.

Transient GitHub read failures are retried up to three times with bounded exponential backoff.
This covers network errors, rate limits and temporary `5xx` responses for REST `GET` requests and
the read-only GraphQL query. Mutating requests are deliberately never retried automatically,
because a lost response must not duplicate a comment or another write.

Event-scoped runs still reconcile exactly their pull request. The 30-minute safety sweep first
selects only open pull requests with an activated task contract or without the
`Agent pipeline / ready for human merge` status on their current head. The second case lets a
future required status self-heal for ordinary and Dependabot pull requests as well. Old pipeline
labels alone do not select a pull request: without an activated contract the reconciler
intentionally owns no labels and therefore could not repair them. The matrix and its per-pull-
request concurrency remain in place, so scheduled and event-driven writes cannot race.

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

- a pull request without an activated task contract — a human one, a Dependabot bump,
- a fork pull request.

Both report "the agent-pipeline gate does not apply". Once this context is a required check, a
status that is never written leaves the pull request unmergeable forever, so staying silent would
deadlock every pull request the gate was never meant to cover. This is not the control that keeps
an agent pull request honest: such a pull request also gets no pipeline label and no status
comment, so the gap is visible, and the branch-protection review requirement still applies to
everyone.

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

Changes below `infra/` are reported as protected paths. The reconciler holds such a pull request
in the `awaiting-human-approval` phase until an approval review covers the exact current head SHA,
because no agent can clear that condition itself. Workflow changes below `.github/workflows/` remain
sensitive and therefore select the independent cross-review, but no longer require a second human
account solely because the workflow file changed. A merge conflict or a failing check still takes
precedence, since an agent can resolve those; the approval blocker stays listed and readiness
remains closed either way.

That approval only counts from an account with write access — `author_association` of `OWNER`,
`MEMBER` or `COLLABORATOR`. This repository is public and allows forking, so any GitHub account
can submit an approving review; without that restriction a drive-by approval from an outsider
would satisfy the one control the plan defines for workflow and infrastructure changes.

Fork pull requests are dropped before the task contract is even parsed, and receive no label and
no comment. The pull-request body is under the fork author's control, so any later decision point
would let an outsider steer the pipeline bot into writing on their own pull request. This matches
the plan: the writing automation is for branches in the main repository only.

For the same reason, comments only count when they come from a bot identity or an account with
write access. The UI/UX notice satisfies a merge gate, so anyone able to post `<!--
agent-pipeline:ui-notice <head sha> -->` could otherwise declare a UI change reviewed that nobody
looked at. The sticky status comment is matched the same way, so a decoy comment carrying the
marker is never adopted and overwritten — the reconciler posts its own alongside it instead.

Note for the current transitional setup: GitHub forbids approving your own pull request. The
remaining `infra/` protection therefore still needs a collaborating account or an explicit
administrator bypass. Workflow-only changes use the automated cross-review and do not hit this
solo-developer limitation.

## Local verification

```powershell
node --test scripts/agent-pipeline.test.mjs
node --test scripts/agent-pipeline-reconcile.test.mjs
node --test scripts/agent-pipeline-select-prs.test.mjs
node --test scripts/agent-claude-review.test.mjs
node --test scripts/agent-preflight.test.mjs
git diff --check
```

The validator and the test suites write nothing to GitHub. The reconciler writes only pipeline
labels, its own sticky status comment and the `Agent pipeline / ready for human merge` status, and
only when invoked with `--apply`. The Claude adapter writes one validated review result comment and
then invokes that same reconciler. `config.json` already declares the labels and timeouts later
phases will use; the ones this rollout does not own are inert until then.

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

Still required before expanding agent mutations:

1. After the Claude workflow has reached the default branch, verify in a pilot pull request that
   applying `review:cross` to a ready Codex head produces one `github-actions[bot]` result comment,
   the result names the exact head SHA and no repository file or branch changes.
2. Verify in a pilot pull request that both app identities can update their own feature branches
   but cannot push or merge to `main`.
3. Add `Agent pipeline / ready for human merge` to branch protection. The prerequisite pilot is
   complete: on 2026-08-08 every open pull request had the context on its current head, and both
   `success` and `pending` verdicts were observed. Enabling the requirement remains a deliberate
   operator action and is not performed by the workflow or an implementation agent.

If that context is already required while no run has written it, every open pull request sits at
"Expected — waiting for status to be reported". Removing it from branch protection or letting the
reconciler run once on the merged default branch both clear that state.

Repository workflow defaults may remain read-only. Future jobs must request only the granular
permissions they need.
