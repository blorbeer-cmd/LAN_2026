# PR #534: Automate Codex self-review pipeline

- Datum des Merges: 2026-09-02
- Branch: `codex/automate-codex-self-review`
- Merge-Commit: [`36903e9`](https://github.com/blorbeer-cmd/LAN_2026/commit/36903e9d6fa5f2f9d9d39cd1fb1d3c221ba53159)
- Pull Request: [#534](https://github.com/blorbeer-cmd/LAN_2026/pull/534)

## Changelog

- Die bislang manuelle Codex-Self-Review-Strecke wird zu einer vollständig automatischen,
  exact-head-gebundenen Kette: vertrauenswürdiger GitHub-Outbox-Request, lokales
  Codex-Host-Review, validierter Publisher und Reconciler-Evidenz.
- Der bestehende Codex-Review-Workflow behandelt weiterhin `review:cross` und legt für `review:self`
  bei Codex-Implementierungen genau einen vertrauenswürdigen Host-Auftrag ab. Der Codex-Adapter
  liefert Self-Review-Aufträge als festes lokales Kommando statt als Prompt an die
  Implementierungs-Task.
- Neu ist der Host-Runner `scripts/agent-codex-self-review.mjs`: Er prüft Identität, Request, Modus,
  Implementierer und Head erneut und arbeitet in einem frischen Detached-Worktree mit ephemerem
  `codex exec review`, OS-`read-only`, Approval `never`, deaktivierten Apps, Browser und Websuche
  und ohne GitHub-Credentials.
- Striktes JSON-Schema, SHA-, Session- und Read-only-Prüfung, RIGHT-side-Diff-Anker und ein zweiter
  Head-/Request-Check sichern die Veröffentlichung als ein natives COMMENT-Review mit atomaren
  Inline-Findings.
- Dauerhafte Start- und Fehlermarker begrenzen jeden Request auf zwei Versuche, erkennen
  abgebrochene Prozesse und erlauben nach einem terminalen Fehler eine ausdrücklich neu gewählte
  Runde auf demselben Head.
- Reconciler, `config.json`, Dokumentation und Tests erkennen die neue Codex-Self-Review-Quelle,
  ohne die Cross-, Claude-Self- oder Human-Pfade zu verändern. Die Pipeline-Suite umfasst danach
  316 Tests.
- Verifiziert wurde ein realer lokaler exact-head-Codex-Pilot auf `1ff1e3db` mit Codex CLI
  `0.151.0-alpha.7.2`, ephemer, Approval `never`, Sandbox `read-only` (mit dokumentiertem
  Windows-`unelevated`-Fallback) — ohne Findings, der Pilot-Worktree danach separat als sauber und
  weiterhin exakt auf diesem Head geprüft. Zwei frühere Pilotrunden hatten drei berechtigte Probleme
  gefunden (CLI-Argumentposition, Same-head-Neuwahl nach Terminalfehler, Request-/Abbruch-Evidenz),
  alle behoben.
- Offener Punkt zum Merge-Zeitpunkt: Der erste vollständige GitHub-End-to-End-Pilot von
  `pull_request_target` über den fünfminütigen Desktop-Heartbeat bis zum Host-Publisher ist erst
  nach dem Merge beweiskräftig, weil Workflow und Monitor absichtlich nur Code vom
  vertrauenswürdigen Default-Branch laden.
- Ein Claude-Cross-Review meldete zwei Findings für den Head `1ff1e3db`, die vor dem Merge nicht
  mehr eingearbeitet wurden; sie sind mit
  [#535](pr-535-order-review-results-by-publication-tie-the-review-lock-to-its-timeout.md)
  nachgezogen worden.
- Keine sichtbare UI/UX-Änderung.
