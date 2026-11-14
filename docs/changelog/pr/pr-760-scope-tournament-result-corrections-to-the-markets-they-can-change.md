# PR #760: Scope tournament result corrections to the markets they can change

- Datum des Merges: 2026-11-13
- Branch: `claude/a5-scoped-tournament-corrections`
- Merge-Commit: [`22e61a2`](https://github.com/blorbeer-cmd/LAN_2026/commit/22e61a2)
- Pull Request: [#760](https://github.com/blorbeer-cmd/LAN_2026/pull/760)

## Changelog

- Eine Turnier-Ergebniskorrektur zählt nur noch die Märkte, die sie ändern kann: das korrigierte Spiel, seine Folgespiele im K.-o.-Baum (nach einem Halbfinale auch das Spiel um Platz 3), nach einem Gruppenspiel die gesamte K.-o.-Phase sowie den Turniersieger-Markt.
- Abgerechnete Märkte anderer Spiele machen eine Korrektur nicht mehr zur Admin-Aufgabe; Teilnehmende tragen solche Korrekturen wieder selbst ein. `assertTournamentEditable` (Turnier löschen) prüft unverändert alle Märkte.
- Der Ergebnisdialog fragt die Admin-Korrektur nur für dieselben Spiele an; `bracketDescendants` ist die gemeinsame Quelle für Korrekturauswahl und Bereinigung des Baums.

## Historischer Kontext

Behebt Bug A5 aus dem Wett-Feedback in Issue #755. Abgesichert mit Integrations- und Parallel-Request-Test sowie Mutationsgegenprobe. Ohne Review gemergt; die Zusammenfassung stammt aus PR-Beschreibung und Diff.
