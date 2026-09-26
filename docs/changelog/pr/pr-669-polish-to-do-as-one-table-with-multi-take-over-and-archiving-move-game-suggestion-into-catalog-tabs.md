# PR #669: Polish To-Do as one table with multi take-over and archiving; move game suggestion into catalog tabs

- Datum des Merges: 2026-09-25
- Branch: `claude/todo-ui-polish-37b1f5`
- Merge-Commit: [`f508852`](https://github.com/blorbeer-cmd/LAN_2026/commit/f508852)
- Pull Request: [#669](https://github.com/blorbeer-cmd/LAN_2026/pull/669)

## Changelog

- To-Do ist eine Karte mit einer ruhigen Tabelle: Suche, Sortierung, Filter und „To-Do erstellen“ in einer Leiste, feste Spalte „Übernehmen“ oder „Abgeben“.
- Ein Klick auf die Zeile öffnet einen Detail-Dialog; erledigte To-Dos bleiben durchgestrichen, bis jemand sie archiviert, danach stehen sie in der „Historie“.
- Server: neues Feld `checklist_tasks.archived_at` und neue Tabelle `checklist_task_assignees`; mehrere Personen können ein To-Do übernehmen, neue Routen für Archivieren und Bearbeiten.
- Kein Zähler mehr im Orga-Reiter und in der Desktop-Leiste; „Meine To-Dos“ auf Home nutzt die kompakten Zeilen von „Aktuell“.
- Spiele: „Spiel vorschlagen“ steht rechts in der Reiterzeile.

## Historischer Kontext

Teil der UI-Polish-Runde. Mehrfachübernahme, Archivieren und Bearbeiten wurden im Verlauf mit dem Nutzer abgestimmt.
