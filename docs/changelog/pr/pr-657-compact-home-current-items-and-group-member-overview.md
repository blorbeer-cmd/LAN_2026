# PR #657: Compact Home current items and group member overview

- Datum des Merges: 2026-09-21
- Branch: `codex/home-current-variants`
- Merge-Commit: [`3f8bc58`](https://github.com/blorbeer-cmd/LAN_2026/commit/3f8bc58)
- Pull Request: [#657](https://github.com/blorbeer-cmd/LAN_2026/pull/657)

## Changelog

- „Aktuell“ ist eine volle Karte über „Meine To-Dos“ mit kompakten, einzeiligen Navigationszeilen; zugewiesene To-Dos nutzen dieselben Zeilen.
- Gruppen ohne Termin (Event-Typ `group`) zeigen auf Home eine eigene Mitglieder-Übersicht mit Link in die Gruppenverwaltung.
- Der Ausblenden-Button (X) an jeder Meldung in „Aktuell“ entfällt.
- Neue Controls `home-group-member`, `home-group-overview-open`, `home-todo-navigate` und `home-current-compact-navigate` sind registriert; `home-current-dismiss` ist aus der Registry entfernt.

## Historischer Kontext

Teil der UI-Polish-Runde. Erster Schritt der UI-Polish-Runde. `dismissAktuellItem` in `aktuellStatus.js` blieb ungenutzt stehen.
