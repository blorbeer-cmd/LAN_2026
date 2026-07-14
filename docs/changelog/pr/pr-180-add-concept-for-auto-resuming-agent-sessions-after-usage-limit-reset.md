# PR #180: docs: add concept for auto-resuming agent sessions after usage-limit reset

- Datum des Merges: 2026-07-13
- Branch: `claude/auto-resume-token-reset-0jl2dt`
- Merge-Commit: [`7090fd2`](https://github.com/blorbeer-cmd/LAN_2026/commit/7090fd2aeb29f4d13e6378e885940620dea177a5)
- Pull Request: [#180](https://github.com/blorbeer-cmd/LAN_2026/pull/180)

## Changelog

- Neues Plan-Dokument `docs/plans/auto-resume-after-token-reset.md`: Konzept und
  Schritt-für-Schritt-Anleitung, damit lokal auf dem Windows-Rechner wegen Nutzungslimits
  unterbrochene Claude-Code- und Codex-Sessions nach dem Token-Reset automatisch weiterarbeiten.
- Kern des Konzepts: eine Warteschlangen-Datei für limitbedingt hängende Sessions, ein
  PowerShell-Runner, der Sessions headless fortsetzt (`claude -p --continue` bzw.
  `codex exec resume --last`), und ein stündlicher Task der Windows-Aufgabenplanung als
  robustes Polling statt Parsen des Reset-Zeitpunkts.
- Leitplanken für unbeaufsichtigte Läufe (Permission-Mode/Sandbox statt Skip-Schaltern,
  Lock-Datei, Logs, Kill-Switch) sowie Grenzen, Risiken und Abgrenzung zur GitHub-seitigen
  Limit-Behandlung in `docs/plans/auto-feature-to-deploy-pipeline.md`.
- Nur Dokumentation; kein Server-, Agent- oder Frontend-Code betroffen.
