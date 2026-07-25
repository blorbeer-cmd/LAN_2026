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
- The workflow runs the validator from the trusted PR base commit. It never executes code from the
  pull-request head and currently has no write permissions.
- No agent is invoked, no label or commit status is written, and no branch-protection setting is
  changed yet.

Do not make `Agent pipeline / contract` a required check until this foundation has been merged:
the trusted base branch must contain the validator before the workflow can execute it.

## Activating a PR

Replace the placeholder values in the hidden `agent-pipeline:task` block from
`.github/pull_request_template.md`. Leaving the template untouched keeps a human PR outside the
pipeline. A participating PR must use a same-repository `codex/*` or `claude/*` branch matching its
declared implementer.

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
