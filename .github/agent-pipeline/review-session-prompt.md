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
| `<REVIEW_MODE>`          | `cross`, `self` or `fallback` — see "Review modes" below                                            |
| `<REVIEW_SESSION_ID>`    | Unique identifier for this fresh, isolated review session                                          |
| `<READ_ONLY_ENFORCED>`   | Must be `true`; otherwise the reviewer is unavailable and the review is blocked                    |
| `<TASK_GOAL>`            | Original objective and acceptance criteria, without the implementation session's private reasoning |

## Review modes

The mode is the user's answer to the question in [`review-decision.md`](review-decision.md), never
a decision this session makes:

| Mode       | When                                                                     | Reviewer                       |
| ---------- | ------------------------------------------------------------------------ | ------------------------------ |
| `cross`    | user chose `review:cross`                                                | the other provider             |
| `self`     | user chose `review:self`, usually to spare the other provider's quota    | implementation provider, fresh |
| `fallback` | the chosen provider turned out to be unavailable and the user re-chose it | implementation provider, fresh |

`self` and `fallback` run identically and are equally strict; they differ only in why they were
used, and the pull request records which one applied. `self` and `fallback` publish their verdict
as the `agent-pipeline:review-result` marker described in `review-decision.md`, because GitHub
carries no native evidence for a same-provider review. A `cross` review needs no marker: its
evidence is the counter provider's approval of the exact head SHA.

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
Review-Modus: <REVIEW_MODE> (cross | self | fallback)
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
  "review_mode": "cross|self|fallback",
  "review_session_id": "<REVIEW_SESSION_ID>",
  "isolated_session": true,
  "read_only_enforced": true,
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
2. In the Codex app, set **Settings → General → Code review → Detached** when using `/review`, or
   open a completely new task for the repository. Do not continue or fork the implementation
   conversation.
3. Use a clean worktree for the PR branch when reviewing local code. Do not reuse a dirty
   implementation worktree.
4. Start `/review` against `<BASE_BRANCH>` with custom review instructions, or paste the complete
   prompt above into the new task and name the PR explicitly.
5. Require an enforced read-only sandbox/tool mode and credentials without repository write
   permissions. If the selected surface cannot guarantee both, treat Codex as unavailable and do
   not perform the review. A prompt restriction and a later `git status` check are insufficient.
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
node ./scripts/agent-review-session.mjs --pr 363 --mode self
```

`--mode cross|self|fallback`, `--implementer codex|claude` (otherwise read from the branch prefix),
`--focus-file` and `--goal-file` to override the defaults, `--print-only` to just get the prompt and
the command without launching anything.

That final check is why the script exists at all. A prompt cannot enforce read-only on the session
it is addressed to — it can only ask. The launcher removes the capability beforehand and verifies
the outcome afterwards, so `read_only_enforced: true` stops being a claim the reviewer makes about
itself. If the worktree did change, the script says so and tells you to treat the review as invalid
before the merge gate reads any marker it posted.

The manual route below stays valid, and explains what the script sets up.

## Enforcing read-only for a Claude review session

`<READ_ONLY_ENFORCED>` must be `true`, and a review session that cannot confirm it has to stop with
`blocked`. That is not a formality: at `self` and `fallback` the same provider judges its own work,
so a session able to write could quietly repair what it found and then report `pass` — the finding
and the fix would both be invisible. Enforcement is what separates "reviewed and judged" from
"tidied up and declared fine".

Three layers, in increasing strength. Use at least the first two; only with the third is
`read_only_enforced: true` fully truthful.

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

- Review in a separate worktree and take write permission off it for the duration
  (`git worktree add ../review-<pr> <head-branch>`, then make the tree read-only for your user).
- Use credentials without code write access. A fine-grained token with `Contents: Read-only` and
  `Pull requests: Read and write` can post the findings comment but cannot push, so a push attempt
  fails server-side rather than being talked out of.

Without layer 3, report the review honestly as `read_only_enforced: false`. It is then still a
useful review for a human, but it does not satisfy the `self` merge-gate condition — the gate checks
exactly this flag.

## Step-by-step: Claude separate session

1. Fetch the PR metadata and fill every placeholder.
2. Open a new Claude Code process or a new Claude task. Do not use `--continue`, `--resume`, or the
   implementation conversation.
3. Prefer a clean, dedicated worktree checked out at `<EXPECTED_HEAD_BRANCH>`. Start Claude only
   with a technically enforced non-editing permission mode and credentials without repository
   write access. If that cannot be guaranteed, treat Claude as unavailable.
   A review subagent restricted to read-only tools satisfies the enforcement requirement, because
   the restriction lives in the tool surface rather than in the prompt. Its task description must
   then be built solely from the task contract, the diff and the published pull-request discussion —
   passing along the implementation session's reasoning would reintroduce exactly the dependency
   the separate session exists to avoid.
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
implementation provider, the mode is `fallback`.

`self` and `fallback` are held to the same bar as `cross`: a fresh session, no implementation
conversation, no reasoning carried over, and technically enforced read-only permissions. Never rely
on prompt-only write restrictions, and never change `verdict` to `pass` merely because the
preferred reviewer ran out of quota.

The reviewer does not resolve threads itself because the session is read-only. After a finding is
confirmed fixed, an accepted rejection, or confirmed obsolete, the implementation session must
mark the associated review threads and comments as resolved; a finding is complete only after the
review conversation is resolved. A `needs-human` finding remains unresolved and blocks the gate.
