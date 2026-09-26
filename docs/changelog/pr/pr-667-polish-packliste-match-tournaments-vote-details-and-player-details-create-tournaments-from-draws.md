# PR #667: Polish Packliste, Match, tournaments, vote details and player details; create tournaments from draws

- Datum des Merges: 2026-09-24
- Branch: `claude/packliste-ui-polish-9039c2`
- Merge-Commit: [`9ea95f3`](https://github.com/blorbeer-cmd/LAN_2026/commit/9ea95f3)
- Pull Request: [#667](https://github.com/blorbeer-cmd/LAN_2026/pull/667)

## Changelog

- Packliste: Kopf „Eingepackt 7/20“ mit Fortschrittsbalken, eine alphabetische Liste flacher Zeilen, Entfernen nur im Modus „Bearbeiten“.
- Match > Teams: Auslosung und Captain Draft flach in der Karte; aus einer Auslosung entsteht per „Turnier erstellen“ direkt ein Turnier.
- Server: neues Feld `matchmaking_draws.tournament_id`; `POST /api/tournaments` nimmt optional `drawId` und beansprucht die Auslosung atomar (409 bei Konflikt).
- Turniere: das eigene Formular „Neues Turnier“ entfällt; die Detailseite zeigt Zähler in der Meta-Zeile, Lobbys als flache Zeilen und einklappbare Teams.
- Umfragen-Stimmen als Tabelle Person × Option, Spieler-Details als sortierbare Tabelle Spiel · Bock · Skill.
- Kontexthilfe in Dialogen: Escape schließt nur die Hilfe, nicht den Dialog.

## Historischer Kontext

Teil der UI-Polish-Runde. Folgt den Stilregeln aus #662, #664 und #666.
