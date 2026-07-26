# Agent pipeline foundation

This directory contains configuration for the agent PR pipeline described in
`docs/plans/auto-feature-to-deploy-pipeline.md`.

## Current rollout state

The foundation is deliberately read-only:

- `.github/workflows/agent-pipeline-contract.yml` validates an activated task contract.
- `scripts/agent-pipeline.mjs` parses contracts and provides the tested state reducer for later
  orchestration phases.
- `review-session-prompt.md` contains the copy-paste prompt and operating instructions for an
  isolated Codex or Claude review session.
- The `pull_request_target` workflow definition is loaded from the trusted default branch and runs
  the validator and configuration from that same trusted branch. The declared PR base must equal the
  configured default branch. The pull-request head is fetched only as diff data, never executed,
  and the workflow currently has no write permissions or secrets.
- No agent is invoked, no label or commit status is written, and no branch-protection setting is
  changed yet.

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
declared implementer. The declared scope must cover every non-documentation path in the merge-base
diff; use `root` for intentional multi-area changes. `ui-change: unknown` remains blocking until a
later classification resolves it.

Protected workflow and infrastructure paths remain blocked until a human explicitly approves the
current head. Readiness also requires a current-head reconciliation confirming that no blocking
review threads remain.

## Local verification

```powershell
node --test scripts/agent-pipeline.test.mjs
node --test scripts/agent-preflight.test.mjs
git diff --check
```

The state reducer is not persisted or connected to GitHub yet. Later phases will add an
idempotent status writer, labels, reconciler, agent adapters and finally the required
`Agent pipeline / ready for human merge` status.

For a manual cross- or fallback-review during the rollout, follow
[`review-session-prompt.md`](review-session-prompt.md). A new commit invalidates the previous
verdict and requires a fresh session for the new head SHA.

## Manual setup still required

Before enabling agent mutations:

1. Connect Claude's GitHub App and store `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` as an
   Actions secret.
2. Enable Codex Cloud code review for the repository, without global automatic reviews; the
   orchestrator will request one review per current head SHA.
3. Store the GitHub username for notifications in repository variable `AGENT_PIPELINE_OWNER`.
4. Verify both app identities can update their own feature branches but cannot push or merge to
   `main`.
5. Add the final readiness status to branch protection only after that status exists and has been
   validated in the pilot.

Repository workflow defaults may remain read-only. Future jobs must request only the granular
permissions they need.
