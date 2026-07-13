# PR #173: Konzept für autonome Feature-zu-Deploy-Pipeline

- Datum des Merges: 2026-07-13
- Branch: `claude/automated-deployment-pipeline-jw2zf1`
- Merge-Commit: [`2ea0a27`](https://github.com/blorbeer-cmd/LAN_2026/commit/2ea0a27129d3b3aee3fbd20138220144ce1a93a7)
- Pull Request: [#173](https://github.com/blorbeer-cmd/LAN_2026/pull/173)

## Changelog

- Neues Plan-Dokument `docs/plans/auto-feature-to-deploy-pipeline.md`: Konzept und
  Schritt-für-Schritt-Plan (7 Phasen), um den Weg von „Feature fertig“ bis „deployed“ zu
  automatisieren – Push, PR-Erstellung, CI-Fehler-Behebung, Merge-Konflikt-Auflösung,
  Umsetzung von Review-Kommentaren, Auto-Merge und Changelog-Pflege.
- Cross-Review-Rollenmodell: Codex reviewt PRs von Claude Code (`claude/*`), Claude reviewt
  PRs von Codex (`codex/*`); kein Agent approvt eigene Änderungen.
- Zustandsmaschine über Labels (`auto-pipeline`, `no-auto`, `auto:fixing`, `auto:waiting`,
  `review:skip`, `review:self`, `needs-human`) statt zusätzlicher Infrastruktur.
- Leitplanken: Rundenlimits, kein Force-Push, `.github/workflows/**` und `infra/**` für die
  Automatik tabu, bestehende Deploy-Pipeline und Secrets bleiben unangetastet.
- Regelung für Nichtverfügbarkeit durch Nutzungslimits: Warten mit Retry statt Umgehen,
  sofortige Benachrichtigung bei verzögertem Review und menschliche Override-Optionen
  `review:skip` (Review-Verzicht) und `review:self` (Selbst-Review durch den Autor-Agent).
- Nur Dokumentation, keine Code- oder Workflow-Änderungen.
