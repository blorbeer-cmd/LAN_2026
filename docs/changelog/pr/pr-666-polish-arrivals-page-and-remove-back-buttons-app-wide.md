# PR #666: Polish arrivals page and remove back buttons app-wide

- Datum des Merges: 2026-09-24
- Branch: `claude/arrivals-departures-ui-polish-ebd09d`
- Merge-Commit: [`75a6622`](https://github.com/blorbeer-cmd/LAN_2026/commit/75a6622)
- Pull Request: [#666](https://github.com/blorbeer-cmd/LAN_2026/pull/666)

## Changelog

- An- & Abreise: zwei Hauptkarten für die Fahrgemeinschaften je Richtung, „Fahrt anlegen“ als kleiner Gradient-Button im Kopf, eine Meta-Zeile je Fahrt, freie Plätze als graue Zeilen.
- „Alle Zeiten“ ist einklappbar mit Zähler und nutzt flache Zeilen; „Speichern“ steht klein unten rechts.
- Der Zurück-Button ist app-weit entfernt (`backButton.js` gelöscht); Arcade-Zuschauen erhält „Beenden“ im Kopf als eigenen Ausgang.
- Das Uhrzeitfeld ist auf dem Handy linksbündig.

## Historischer Kontext

Teil der UI-Polish-Runde. Die Regel „No back buttons“ steht seither im Designsystem.
