# PR #732: Arcade: Spielfeld passt sich automatisch an, Vollbild statt „vergrößern“

- Datum des Merges: 2026-10-11
- Branch: `claude/arcade-spielfeld-responsive-znpn1k`
- Merge-Commit: [`21bf313`](https://github.com/blorbeer-cmd/LAN_2026/commit/21bf313)
- Pull Request: [#732](https://github.com/blorbeer-cmd/LAN_2026/pull/732)

## Changelog

- Alle skalierbaren Arcade-Spielfelder (Scribble, Blobby, Pong, Snake, Tetris) messen die freie Höhe der Ansicht und füllen sie aus; Punkteleiste, Chat und Match-Steuerung bleiben sichtbar. Neues Modul `arcade/arcadePlayfield.js`.
- Der Button „Spielfeld vergrößern“ entfällt; die Spielraum-Kopfzeile bietet stattdessen „Vollbild“. Es blendet die App-Leisten aus und fordert echtes Browser-Vollbild an, mit Esc- und Ansichtswechsel-Ausstieg auch ohne Browserunterstützung.
- Scribble zeigt Spieler und Chat auf Querformat-Handys und Laptops neben der Zeichenfläche; die gestapelte Tetris-Arena passt auf Handys nur das eigene Brett ein.
- Zuschauen skaliert für Pong, Blobby, Snake und Tetris ebenfalls; Schiffe versenken, Challenge Rush und Chimp behalten ihr festes Layout.

## Historischer Kontext

Ergebnis einer Messung aller Arcade-Spielfelder bei verschiedenen Auflösungen: Ein fester Vergrößerungsschalter nutzte große Bildschirme kaum und überlief kleine. Die Zusammenfassung stammt aus der PR-Beschreibung und dem Diff.
