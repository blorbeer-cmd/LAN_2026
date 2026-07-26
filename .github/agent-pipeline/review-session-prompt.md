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
| `<REVIEW_MODE>`          | `cross` for the other provider, `fallback` for a fresh session of the implementation provider      |
| `<REVIEW_SESSION_ID>`    | Unique identifier for this fresh, isolated review session                                          |
| `<TASK_GOAL>`            | Original objective and acceptance criteria, without the implementation session's private reasoning |

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
Review-Modus: <REVIEW_MODE>
Review-Session-ID: <REVIEW_SESSION_ID>

Ziel und Abnahmekriterien:
<TASK_GOAL>

Unabhängigkeits- und Sicherheitsregeln:

1. Dies ist ausschließlich ein Review. Ändere keine Datei, erstelle keinen Commit, pushe nichts,
   approviere und merge den PR nicht und löse keine Review-Threads auf.
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
9. Belege jedes Finding mit engem Datei-/Zeilenbezug, einem reproduzierbaren Szenario oder einer
   klaren Ausführungskette und einer konkreten Verifikation des Fixes. Erfinde keine
   Testergebnisse. Lies vorhandene CI-Ergebnisse, führe aber keine zustandsändernden Aktionen aus.
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
  "review_mode": "<REVIEW_MODE>",
  "review_session_id": "<REVIEW_SESSION_ID>",
  "isolated_session": true,
  "implementer": "<IMPLEMENTER>",
  "base_branch": "<BASE_BRANCH>",
  "head_branch": "<EXPECTED_HEAD_BRANCH>",
  "reviewed_head_sha": "<EXPECTED_HEAD_SHA>",
  "verdict": "pass|changes-required|blocked",
  "findings": [
    {
      "id": "R1",
      "severity": "critical|high|medium|low",
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

## Step-by-step: Codex separate session

1. Fetch the PR metadata with the command above and fill every placeholder.
2. In the Codex app, set **Settings → General → Code review → Detached** when using `/review`, or
   open a completely new task for the repository. Do not continue or fork the implementation
   conversation.
3. Use a clean worktree for the PR branch when reviewing local code. Do not reuse a dirty
   implementation worktree.
4. Start `/review` against `<BASE_BRANCH>` with custom review instructions, or paste the complete
   prompt above into the new task and name the PR explicitly.
5. Keep the permission mode read-only. If the selected surface cannot guarantee read-only tools,
   rely on the prompt restriction and verify afterward that `git status --short` is unchanged.
6. Confirm that the final `reviewed_head_sha` equals the current GitHub head SHA. Treat a mismatch,
   missing JSON block or `blocked` verdict as no completed review.
7. Put actionable findings into the PR discussion or hand the complete result to the
   implementation session. Do not ask this review session to fix them.
8. After fixes are pushed, close this review context and start another detached review for the new
   SHA.

## Step-by-step: Claude separate session

1. Fetch the PR metadata and fill every placeholder.
2. Open a new Claude Code process or a new Claude task. Do not use `--continue`, `--resume`, or the
   implementation conversation.
3. Prefer a clean, dedicated worktree checked out at `<EXPECTED_HEAD_BRANCH>`. Start Claude with a
   non-editing permission mode, for example `claude --permission-mode plan`, and paste the complete
   prompt.
4. Do not use `--from-pr` if it would resume a session previously linked to the implementation PR;
   session separation is more important than convenience.
5. Confirm that no files changed and that the final `reviewed_head_sha` matches GitHub.
6. Publish or forward only the review result. The implementation session handles all fixes.
7. Start a new review session after every fix commit.

## Fallback use

For the normal cross-review, set `review_mode` to `cross` and use the provider opposite the
implementer. If that provider is unavailable, start a fresh session of the implementation
provider and set `review_mode` to `fallback`. Never reuse the implementation conversation and
never change `verdict` to `pass` merely because the preferred reviewer ran out of quota.
