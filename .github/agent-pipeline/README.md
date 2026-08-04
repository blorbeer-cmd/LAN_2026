# Agent pipeline foundation

This directory contains configuration for the agent PR pipeline described in
`docs/plans/auto-feature-to-deploy-pipeline.md`.

## Current rollout state

The pipeline reports state; it does not act on it yet:

- `.github/workflows/agent-pipeline-contract.yml` validates an activated task contract.
- `scripts/agent-pipeline.mjs` parses and validates task contracts.
- `scripts/agent-pipeline-reconcile.mjs` derives the readiness state and keeps the pipeline labels
  and the sticky status comment in sync (phase 2 of the plan).
- `.github/workflows/agent-pipeline-reconcile.yml` runs that reconciler per pull request.
- `.github/workflows/agent-pipeline-tests.yml` runs the unit tests for both.
- `review-session-prompt.md` contains the copy-paste prompt and operating instructions for an
  isolated Codex or Claude review session.
- The `pull_request_target` workflow definitions are loaded from the trusted default branch and run
  the validator, reconciler and configuration from that same trusted branch. The declared PR base
  must equal the configured default branch. The pull-request head is fetched only as diff data and
  is never executed by those workflows.
- No agent is invoked, no commit status is written, and no branch-protection setting is changed yet.

## Readiness reconciler

The reconciler reads the complete current state from GitHub on every run and computes readiness as
a pure function of that snapshot. It keeps no history of its own, so a duplicated, delayed or
out-of-order event cannot corrupt the result, and every head-bound fact that does not belong to the
current head SHA falls back to "unknown" and therefore blocks. This is the architecture fixed in
`docs/plans/auto-feature-to-deploy-pipeline.md`; the earlier event-reducer draft was rejected.

What it does:

- maintains `agent:pipeline` plus exactly one phase label
  (`agent:implementing`, `agent:ci-fix`, `agent:conflict-fix`, `agent:review`,
  `agent:ready-for-merge`) and `ui:changed`,
- maintains one sticky status comment marked with `<!-- agent-pipeline:status -->`,
- reports every open blocker in that comment.

What it deliberately does not do:

- start an agent, request a review, or push a fix,
- write the `Agent pipeline / ready for human merge` commit status (phase 7),
- approve or merge anything,
- set or clear `agent:waiting` and `agent:review-fallback`, which belong to the provider phases,
- accept a fallback review as satisfying the gate. Only an approval from the counter provider's
  allowlist counts, so a pull request reviewed through the fallback path described in the plan
  still reports a missing cross-review. Phase 5 owns the fallback flow; wiring it up here, where
  `agent:review-fallback` is only a hand-set label and nothing verifies that a fallback review
  actually happened, would turn the label into a gate bypass.

`agent:needs-human` is derived from the live escalation condition rather than kept as its own
state, so it clears again once that condition is gone. Reading it back as an input would make the
phase depend on its own previous value and could strand a pull request under it forever. To stop
automation by hand, use `agent:no-auto`.

Its own check runs are excluded from the CI evaluation via `selfCheckNames`. The reconcile
workflow runs on `pull_request_target`, whose check runs attach to the pull request's head SHA, so
without that exclusion the reconciler would read its own job as a running — or, after
`cancel-in-progress`, a cancelled and therefore failing — CI check. `selfCheckNames` must stay in
sync with the job names in `.github/workflows/agent-pipeline-reconcile.yml`.

Idempotence: labels already in the desired state produce no API call, and an unchanged status
comment body is not rewritten. Re-running the reconciler on an unchanged pull request performs no
writes at all.

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

Changes below `.github/workflows/` and `infra/` are reported as protected paths. The reconciler
escalates such a pull request to `agent:needs-human` until an approval review from a non-bot
account covers the exact current head SHA, because no agent can clear that condition itself.

Note for the current transitional setup: GitHub forbids approving your own pull request. While
agent pull requests are authored by the repository owner's own account rather than by
`claude[bot]`, that approval cannot be given, and a protected-path pull request stays escalated
until it is merged by hand. Once the pipeline opens pull requests under the app identity, the
owner can approve them normally.

## Local verification

```powershell
node --test scripts/agent-pipeline.test.mjs
node --test scripts/agent-pipeline-reconcile.test.mjs
node --test scripts/agent-preflight.test.mjs
git diff --check
```

The validator and the test suites write nothing to GitHub. The reconciler writes only pipeline
labels and its own sticky status comment, and only when invoked with `--apply`. Later phases add
the agent adapters and finally the required `Agent pipeline / ready for human merge` status.
`config.json` already declares the labels and timeouts those phases will use; the ones this phase
does not own are inert until then.

For a manual cross- or fallback-review during the rollout, follow
[`review-session-prompt.md`](review-session-prompt.md). A new commit invalidates the previous
verdict and requires a fresh session for the new head SHA.

## Manual setup

Completed for this repository:

1. Claude's GitHub App is connected and `CLAUDE_CODE_OAUTH_TOKEN` is stored as an Actions secret.
2. Codex code review is enabled without global automatic reviews; the orchestrator will request one
   review per current head SHA.
3. The GitHub username for notifications is stored in repository variable `AGENT_PIPELINE_OWNER`.
4. `providerAuthorAllowlist` lists the verified actors for both providers.
5. Pipeline labels from `config.json` exist in the repository.

Still required before enabling agent mutations:

1. Verify in a pilot pull request that both app identities can update their own feature branches
   but cannot push or merge to `main`.
2. Add the final readiness status to branch protection only after that status exists and has been
   validated in the pilot. Adding it earlier blocks every agent pull request.

Repository workflow defaults may remain read-only. Future jobs must request only the granular
permissions they need.
