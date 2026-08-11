# Separate agent review session

Use this prompt for a review that must not inherit the implementation session's reasoning or
write access. It works for the regular cross-review and for the reduced-independence fallback
review described in `docs/plans/auto-feature-to-deploy-pipeline.md`.

## Information to collect first

Replace every `<PLACEHOLDER>` before starting the review:

| Placeholder              | Value                                                                                              |
| ------------------------ | -------------------------------------------------------------------------------------------------- |
| `<REPOSITORY>`           | GitHub repository, for example `blorbeer-cmd/LAN_2026`                                             |
| `<PR_NUMBER_OR_URL>`     | Pull-request number or full URL                                                                    |
| `<BASE_BRANCH>`          | Normally `main`                                                                                    |
| `<EXPECTED_HEAD_BRANCH>` | Exact feature branch                                                                               |
| `<EXPECTED_HEAD_SHA>`    | Full 40-character PR head SHA                                                                      |
| `<IMPLEMENTER>`          | `codex` or `claude`                                                                                |
| `<REVIEWER_PROVIDER>`    | Provider running this review: `codex` or `claude`                                                  |
| `<REVIEW_MODE>`          | `cross` or `self` — a fallback review runs as `self`, see "Review modes" below                      |
| `<REVIEW_SESSION_ID>`    | Unique identifier for this fresh, isolated review session                                          |
| `<READ_ONLY_ENFORCED>`   | `true`, `verified` or `false` — see "Read-only levels" below. `false` is allowed and honest; the review then informs a human and must publish no marker |
| `<TASK_GOAL>`            | Original objective and acceptance criteria, without the implementation session's private reasoning |

## Review modes

The mode is the user's answer to the question in [`review-decision.md`](review-decision.md), never
a decision this session makes:

| Mode       | When                                                                     | Reviewer                       |
| ---------- | ------------------------------------------------------------------------ | ------------------------------ |
| `cross`    | user chose `review:cross`                                                | the other provider             |
| `self`     | user chose `review:self`, usually to spare the other provider's quota    | implementation provider, fresh |
| _fallback_ | the chosen provider turned out to be unavailable and the user re-chose it | implementation provider, fresh |

`fallback` is a reason, not a value. It runs as `review_mode: self`, is held to exactly the same bar,
and is marked on the pull request with `agent:review-fallback`. Neither the merge gate nor
`agent-review-session.mjs` accepts a third mode — a `mode=fallback` marker would be published, cost
quota and then be ignored in silence.

A `self` review publishes its verdict as the `agent-pipeline:review-result` marker described in
[`review-decision.md`](review-decision.md), because GitHub carries no native evidence for a
same-provider review. A Codex cross-review uses its native head-bound review. An automated Claude
cross-review returns structured JSON to the trusted workflow, which validates and publishes the
same kind of exact-head marker without giving the review session code-write access.

Resolve the current head immediately before the review. For example:

```powershell
gh pr view <PR_NUMBER> --repo <REPOSITORY> --json headRefName,headRefOid,baseRefName,url
```

If the PR receives a new commit, discard the old verdict and start another review for the new
head SHA.

## Copy-paste review prompt

```text
Du bist der unabhängige, ausschließlich lesende Reviewer für einen Pull Request.

Repository: <REPOSITORY>
Pull Request: <PR_NUMBER_OR_URL>
Base-Branch: <BASE_BRANCH>
Erwarteter Head-Branch: <EXPECTED_HEAD_BRANCH>
Erwarteter Head-SHA: <EXPECTED_HEAD_SHA>
Implementierungs-Agent: <IMPLEMENTER>
Review-Anbieter: <REVIEWER_PROVIDER>
Review-Modus: <REVIEW_MODE> (cross | self)
Review-Session-ID: <REVIEW_SESSION_ID>
Read-only technisch erzwungen: <READ_ONLY_ENFORCED>

Ziel und Abnahmekriterien:
<TASK_GOAL>

Unabhängigkeits- und Sicherheitsregeln:

1. Dies ist ausschließlich ein Review. Ändere keine Datei, erstelle keinen Commit, pushe nichts,
   approviere und merge den PR nicht und löse keine Review-Threads auf.
   Diese Einschränkung muss zusätzlich durch Sandbox, Berechtigungsmodus oder einen technisch
   schreibgeschützten Token erzwungen sein. Eine reine Prompt-Anweisung genügt nicht. Kann die
   Umgebung das nicht garantieren, stoppe mit verdict "blocked".
2. Verwende keinen Implementierungs-Chatverlauf und übernimm keine dortige Begründung. Leite das
   Verhalten selbst aus Auftrag, Diff, aktuellem Quellcode, Tests und Repository-Regeln ab.
3. Lies zuerst AGENTS.md und DEVELOPMENT_GUIDELINES.md vollständig. Lade danach nur die für die
   geänderten Pfade vorgeschriebenen Bereichsregeln. Führe keinen Änderungs-Preflight aus, weil
   dieses Review schreibgeschützt ist.
4. Prüfe vor der Analyse Repository, PR, Base-Branch, Head-Branch und vollständigen Head-SHA.
   Weicht etwas von den erwarteten Werten ab, stoppe mit verdict "blocked" und nenne die
   Abweichung. Ein Review eines älteren SHAs ist ungültig.
5. Reviewe den vollständigen Diff vom Merge-Base mit <BASE_BRANCH> bis <EXPECTED_HEAD_SHA>, nicht
   nur den letzten Commit. Berücksichtige relevante Aufrufer, Datenflüsse, Schema- und
   Realtime-Auswirkungen sowie bereits vorhandene Tests.
6. Prüfe insbesondere Korrektheit, Regressionen, Zustandskonflikte, Nebenläufigkeit,
   Validierung, Authentifizierung/Autorisierung, Mandanten- und Gruppengrenzen, Datenverlust,
   Security, Fehlerpfade, Testlücken und Widersprüche zwischen Dokumentation und Verhalten.
7. Bei UI/UX-Änderungen prüfe zusätzlich responsive Zustände, Tastaturbedienung,
   Barrierefreiheit, Design-Tokens, Lade-/Fehler-/Leerzustände und ob die manuelle Prüfanleitung
   die sichtbare Änderung tatsächlich abdeckt.
8. Melde nur konkrete, durch den Diff verursachte und vom Autor behebbare Findings. Keine
   allgemeinen Stilwünsche, keine bloßen Fragen und keine Punkte, die ausschließlich ein bereits
   grüner deterministischer Linter abdeckt.
9. Belege jedes Finding nach Möglichkeit mit engem Datei-/Zeilenbezug, einem reproduzierbaren
   Szenario oder einer klaren Ausführungskette und einer konkreten Verifikation des Fixes. Wenn kein
   stabiler Inline-Anker existiert, verwende `disposition: needs-human`, `anchor: none`,
   `file: null`, `line: null` und `verdict: blocked`; erfinde keinen Datei-/Zeilenanker. Erfinde
   keine Testergebnisse. Lies vorhandene CI-Ergebnisse, führe aber keine zustandsändernden Aktionen
   aus.
10. Schweregrade:
    - critical: Datenverlust, Sicherheitsgrenze, produktiver Ausfall oder sicher falsches
      Kernverhalten; blockiert zwingend.
    - high: wahrscheinlicher funktionaler Fehler oder relevante Regression; blockiert.
    - medium: realer Fehler in begrenztem Pfad oder wesentliche Testlücke; blockiert bis behoben
      oder fachlich überzeugend widerlegt.
    - low: kleiner, realer Defekt; nicht für Geschmacksfragen verwenden.
11. Wenn du keine Findings findest, sage das ausdrücklich. Ein positives Urteil ist nur für den
    exakt geprüften Head-SHA gültig.

Arbeitsablauf:

1. Identität und SHA verifizieren.
2. Pflichtregeln bestimmen und lesen.
3. PR-Beschreibung, Task-Vertrag, CI-Status und Review-Diskussion erfassen.
4. Vollständigen Diff und betroffene Aufrufer untersuchen.
5. Tests gegen die geänderten Erfolgs-, Validierungs- und Konfliktpfade abgleichen.
6. Findings priorisieren und auf Duplikate prüfen.
7. Ergebnis im folgenden Format ausgeben. Keine Änderungen vornehmen.

Ausgabeformat:

Zuerst "Findings" mit Findings in absteigender Schwere. Für jedes Finding:

[severity] Kurzer imperativer Titel
- Datei: <pfad>:<zeile>
- Problem: <konkretes Fehlverhalten und Auslöser>
- Auswirkung: <warum relevant>
- Evidenz: <Codepfad, reproduzierbares Szenario oder Testlücke>
- Verifikation: <wie der Fix geprüft werden soll>

Wenn keine Findings existieren, schreibe unter "Findings" exakt:
Keine Findings zum geprüften Head-SHA.

Danach "Rest-Risiken und Prüfgrenzen". Nenne nicht ausgeführte Prüfungen oder "Keine", aber
wiederhole keine Findings.

Beende die Antwort mit genau einem JSON-Block und danach keinem weiteren Text:

{
  "schema_version": 1,
  "repository": "<REPOSITORY>",
  "pull_request": "<PR_NUMBER_OR_URL>",
  "reviewer_provider": "<REVIEWER_PROVIDER>",
  "review_mode": "cross|self",
  "review_session_id": "<REVIEW_SESSION_ID>",
  "isolated_session": true,
  "read_only_enforced": "true|verified|false",
  "implementer": "<IMPLEMENTER>",
  "base_branch": "<BASE_BRANCH>",
  "head_branch": "<EXPECTED_HEAD_BRANCH>",
  "reviewed_head_sha": "<EXPECTED_HEAD_SHA>",
  "verdict": "pass|changes-required|blocked",
  "findings": [
    {
      "id": "R1",
      "severity": "critical|high|medium|low",
      "disposition": "actionable|needs-human",
      "anchor": "inline|none",
      "title": "...",
      "file": "path/to/file",
      "line": 1,
      "problem": "...",
      "impact": "...",
      "evidence": "...",
      "verification": "..."
    }
  ],
  "residual_risks": ["..."]
}
```

Bei `anchor: none` müssen `file` und `line` stattdessen als JSON-`null` ausgegeben werden.

## Step-by-step: Codex separate session

1. Fetch the PR metadata with the command above and fill every placeholder.
2. In the Codex app, set **Settings → General → Code review → Detached**, open a completely new task
   for the repository, and use the dedicated `/review` flow. Do not continue or fork the
   implementation conversation. A normal editable Codex chat with a review prompt is not an
   equivalent substitute.
3. Give the detached task a clean, dedicated worktree at the exact PR head SHA. Do not reuse the
   implementation worktree or check out the moving PR branch.
4. Before/after confirmation must come from a party independent of the implementation/coordination
   session — a human operator, or an automated check outside that session's control (analogous to
   the Claude launcher's after-the-fact worktree check). The implementation/coordination session may
   set up the worktree and start `/review` against `<BASE_BRANCH>` with the complete custom review
   instructions above, but recording the head/clean status beforehand and confirming the same head
   and untouched worktree afterward is the independent party's job, not the implementation session's
   own say-so — the same session judging its own work cannot also be the check that catches it.
5. The dedicated Codex `/review` surface is documented to report findings without changing the
   working tree. Together with **Detached**, an exact-head worktree, and the independent external
   before/after verification, that supports `read-only=verified`. Credentials without repository
   write permission raise the result to `read-only=true`; they are not required for the default
   `verified` gate. If `/review` is unavailable, falls back to a normal editable task, or the
   independent external verification cannot be completed, treat Codex as unavailable for this
   self-review.
6. Confirm that the final `reviewed_head_sha` equals the current GitHub head SHA. Treat a mismatch,
   missing JSON block or `blocked` verdict as no completed review.
7. Hand the complete result to the implementation session. Actionable findings must be published
   as resolvable inline review threads with an exact file and line anchor; do not publish them only
   as top-level PR comments. If no stable inline anchor exists, classify the finding as
   `needs-human`/blocked and keep the merge gate blocked. Do not ask this review session to fix
   findings.
8. After fixes are pushed, close this review context and start another detached review for the new
   SHA.

## One command instead of this checklist

`scripts/agent-review-session.mjs` does everything below in one step: it reads the pull request,
creates a throwaway worktree detached at the exact head SHA, fills this prompt in, launches Claude
without the editing tools and with the read-only settings — and after the session ends it checks
from the outside whether that worktree is still untouched.

```powershell
node ./scripts/agent-review-session.mjs --pr 363 --mode self --headless
```

`--headless` is part of the default example on purpose: without it the run is interactive, stays at
`read-only=false` and writes no marker, so it informs a human but cannot satisfy the gate.

**The local launcher only ever runs `claude`, and only for `--mode self`.** Every other combination
is rejected before anything is created, and `--print-only` prepares its prompt. This limitation is
not a statement that Codex self-review is unavailable: for a Codex implementation in `self` mode,
use the detached Codex `/review` route above and publish its marker only after the independent
before/after verification succeeds.

- Whenever `reviewerFor()` resolves to codex — a Claude implementation in `cross` mode, a Codex
  implementation in `self` mode — launching would run Claude while prompt, session id and marker all
  say codex. In an unattended run nobody notices.
- A Codex `cross` review is evidenced by the counter provider's native review. A Claude `cross`
  review is launched only by `.github/workflows/agent-pipeline-claude-review.yml`, which enforces
  the restricted tool and credential boundary before its trusted publisher appends a marker.
  This local launcher still handles only `self`; use the `review:cross` label for either automated
  provider direction. The Codex adapter posts `@codex review` for a Claude implementation, while
  the Claude adapter runs the restricted workflow for a Codex implementation.

`--mode cross|self`, `--enforced`, `--implementer codex|claude` (otherwise read from the branch prefix),
`--focus-file` and `--goal-file` to override the defaults, `--print-only` to just get the prompt and
the command without launching anything.

By default the launch is **interactive**: the script starts a bare session and the operator pastes
the prompt in. That needs a TTY, and the script now says so instead of hanging when there is none.
Add `--headless` to feed the prompt in on stdin and let the whole thing run unattended:

```bash
node ./scripts/agent-review-session.mjs --pr 364 --mode self --headless
```

The read-only flags are unchanged by this — `--headless` only adds `--print`; it never trades away
the removed tools or the settings file.

### Who publishes the result

A headless run inverts the old order, and that matters more than the convenience:

| | interactive | headless |
| --- | --- | --- |
| writes the comment | the review session | the launcher |
| read-only level | `false` (or `true` with `--enforced`) | `verified` (or `true` with `--enforced`) |
| marker written | none, unless `--enforced` | only after the check passed |
| on a violation | with `--enforced`: a passing marker already exists; delete it before the reconciler reads it | nothing was published, the result is discarded |

The session in a headless run is told to write nothing at all and simply to output its review. The
launcher captures that, runs the worktree check, extracts the `Verdikt:` line and only then appends
the marker. An absent or ambiguous verdict — including the untouched
`pass | changes-required | blocked` template — produces **no** marker and a non-zero exit, because a
guessed verdict would go straight into the merge gate.

This also removes the reviewer's need for any GitHub access, which is what made the headless path
work at all where neither `gh` nor MCP tools exist: the session runs with `Read,Grep,Glob,Bash` and
nothing else. Where `gh` is present the launcher posts the comment itself; where it is not, the
result is written to `--result-file` with the marker already in place, to be posted verbatim.

The trade-off, stated plainly: the launcher runs in the implementation context, so it — not the
isolated session — is what puts the verdict on the pull request. The author allowlist already
assumed that identity, but the relay is a step the interactive route did not have.

### Without the GitHub CLI

The script reads the pull request through `gh` by default. Where that binary does not exist — a
Claude Code remote container reaches GitHub through MCP tools instead — pass the metadata directly:

```bash
node ./scripts/agent-review-session.mjs --pr-json pr.json --repository blorbeer-cmd/LAN_2026 --mode self
```

`pr.json` holds what `gh pr view --json` would have returned; `number`, `url`, `headRefName`,
`headRefOid` and `baseRefName` are required and validated, `title` and `body` feed the goal section.
Without `--repository` the name is derived from the `origin` remote. The head SHA must be the full
40 characters — a short one would otherwise surface as an obscure `git worktree add` failure.

Nothing in the file proves its fields belong together, so where `gh` *is* available the launcher
cross-checks head SHA, head branch and base branch against GitHub and refuses a mismatch: a review
bound to the wrong pull request is worse than none, because its marker looks entirely valid. Where
`gh` is missing that check cannot run, and the launcher says so rather than implying the metadata
was verified.

That final check is why the script exists at all. A prompt cannot enforce read-only on the session
it is addressed to — it can only ask. The launcher removes the capability beforehand and verifies
the outcome afterwards, so the read-only claim stops being something the reviewer says about itself:
that verification *is* the `verified` level. If the worktree did change, the script says so and tells
you to treat the review as invalid before the merge gate reads any marker it posted — which is also
why the check reports a violation for `verified` runs, not just for `--enforced` ones.

The manual route below stays valid, and explains what the script sets up.

## Enforcing read-only for a Claude review session

`<READ_ONLY_ENFORCED>` must be `true`, and a review session that cannot confirm it has to stop with
`blocked`. That is not a formality: in `self` mode the same provider judges its own work,
so a session able to write could quietly repair what it found and then report `pass` — the finding
and the fix would both be invisible. Enforcement is what separates "reviewed and judged" from
"tidied up and declared fine".

## Read-only levels

The marker carries one of three values, and the merge gate compares it against
`selfReviewMinimumEnforcement` in `config.json` (default `verified`):

| Level      | What backs it                                                                                                                   | Who can claim it |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `true`     | everything under `verified`, plus credentials without code write access, so a write fails server-side                            | the operator, via `--enforced` |
| `verified` | either the restricted Claude launcher checks an exact-head throwaway worktree afterwards, or Codex runs the dedicated detached `/review` flow and an operator independent of the implementation/coordination session confirms the exact head and untouched worktree afterwards | the Claude launcher, or an independent operator of a detached Codex `/review` |
| `false`    | nothing outside the prompt                                                                                                      | anything else, including an interactive launch and `--print-only` |

For launcher-produced markers, `verified` requires `--headless` because only a headless run publishes
from the launcher, i.e. *after* the check. An interactive launcher session posts its own comment
while it is still running, so it stays at `false` and writes no marker. A detached Codex `/review`
reaches `verified` by a different route: its dedicated no-working-tree-change review surface is
combined with an independent operator's exact-head before/after check — independent of the
implementation/coordination session, not that session confirming its own setup — and that operator
publishes the result marker only after the check succeeds. A normal editable Codex chat remains
`false`.

`verified` exists because `true` is not reachable everywhere. A session whose only credentials can
push cannot honestly assert it — and demanding it anyway left `self` unusable in exactly those
environments, which is not a security win but a process that quietly stops working. `verified` is
weaker on purpose and says so: it detects a violation after the fact rather than preventing it, and
the status comment records which level a verdict was reached under.

Lowering the repository minimum to `false` is possible and means accepting a verdict nothing outside
the prompt backed up. At that point the self-review gate is a formality — a deliberate choice, not
an oversight, and one worth revisiting rather than leaving set.

## Enforcing read-only in layers

Three layers, in increasing strength. Layers 1 and 2 plus the launcher's after-the-fact check are
what `verified` stands for; only with the third is `true` truthful.

**1. Remove the editing tools from the session.** They then do not exist and cannot be called:

```powershell
claude --tools "Read,Grep,Glob,Bash" `
       --settings .github/agent-pipeline/review-readonly.settings.json
```

**2. Block the writing paths that remain through Bash.**
`review-readonly.settings.json` denies committing, pushing, checkout, reset, merge, `gh pr
merge|review|edit` and `gh api`, and allows exactly what a review needs — including `gh pr comment`,
because publishing findings writes to the conversation, not to the code. A deny rule cannot be
granted by the model or by an approval prompt.

For a quick review without any file, `claude --permission-mode plan` also blocks edits; the
settings file is the reproducible form and additionally covers the Bash paths.

**3. Make writing fail even if something slips through.** This is the layer that makes the claim
hold, because layers 1 and 2 are pattern-based and a shell is a wide surface:

- Review in a separate worktree, detached at the reviewed SHA — never at the branch, which a push
  during the review would move out from under the verdict:
  `git worktree add --detach ../review-<pr> <EXPECTED_HEAD_SHA>`. Then take write permission off
  the tree for the duration.
- Use credentials without code write access. A fine-grained token with `Contents: Read-only` and
  `Pull requests: Read and write` can post the findings comment but cannot push, so a push attempt
  fails server-side rather than being talked out of.

Without layer 3 but with either the launcher's check or the detached Codex `/review` plus an
independent operator's external before/after check, report `verified`. Without those checks, report
`false`:
the review is then still useful input for a human, but it does not satisfy the `self` merge-gate
condition at the default minimum.

## Step-by-step: Claude separate session

1. Fetch the PR metadata and fill every placeholder.
2. Open a new Claude Code process or a new Claude task. Do not use `--continue`, `--resume`, or the
   implementation conversation.
3. Prefer a clean, dedicated worktree detached at `<EXPECTED_HEAD_SHA>`, not at the branch. Start
   Claude with a technically enforced non-editing permission mode; with credentials without
   repository write access on top, the review reaches `true` instead of `verified`.
   A review subagent does **not** by itself satisfy the enforcement requirement. Removing the
   editing tools is layer 1, and a subagent that still has `Bash` can run `git push` — the tool
   surface alone enforces nothing, which is why `review-readonly.settings.json` exists and says so
   in its own `//scope` note. A subagent counts only when its tool set excludes `Bash` as well, or
   when the launcher's worktree check backs it up. Either way its task description must be built
   solely from the task contract, the diff and the published pull-request discussion — passing along
   the implementation session's reasoning would reintroduce exactly the dependency the separate
   session exists to avoid.
4. Do not use `--from-pr` if it would resume a session previously linked to the implementation PR;
   session separation is more important than convenience.
5. Confirm that no files changed and that the final `reviewed_head_sha` matches GitHub.
6. Publish or forward only the review result. The implementation session handles all fixes.
7. Start a new review session after every fix commit.

## Choosing the mode

The user picks the mode per head SHA; this session never picks it. Set `review_mode` to whatever
the chosen `review:*` label says.

If the chosen provider turns out to be unavailable, do not quietly review with the other one: that
would spend exactly the quota the user was steering around. Report the observed reason — a known
quota message, an error, a timeout — and put the choice back to the user. If they then choose the
implementation provider, run it as `self` and label the pull request `agent:review-fallback`.

A same-provider review is held to the same bar as `cross`: a fresh session, no implementation
conversation, no reasoning carried over, and technically enforced read-only permissions. Never rely
on prompt-only write restrictions, and never change `verdict` to `pass` merely because the
preferred reviewer ran out of quota.

The reviewer does not resolve threads itself because the session is read-only. After a finding is
confirmed fixed, an accepted rejection, or confirmed obsolete, the implementation session must
mark the associated review threads and comments as resolved; a finding is complete only after the
review conversation is resolved. A `needs-human` finding remains unresolved and blocks the gate.
