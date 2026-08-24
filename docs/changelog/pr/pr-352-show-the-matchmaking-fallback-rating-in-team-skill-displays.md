# PR #352: Show the matchmaking fallback rating in team skill displays

- Datum des Merges: 2026-08-05
- Branch: `claude/unbewertet-spieler-skill-anzeige-yn6zxv`
- Merge-Commit: [`e973e6a`](https://github.com/blorbeer-cmd/LAN_2026/commit/e973e6a551bc4a3e8264bb0f5eceefd3652639af)
- Pull Request: [#352](https://github.com/blorbeer-cmd/LAN_2026/pull/352)

## Changelog

- Spieler ohne eigene Skill-Bewertung erscheinen in den Teamansichten mit dem neutralen
  Matchmaking-Fallback in Klammern statt mit einem Gedankenstrich; die Teamsumme zählt ihn mit und
  nennt dahinter die Anzahl der unbewerteten Spieler. Vorher zählte die Anzeige fehlende
  Bewertungen mit `0` und widersprach damit der Summe, nach der tatsächlich ausgelost wurde.
- Der Captain Draft stellt nach Zugreihenfolge statt nach Bewertungen zusammen und behält deshalb
  den Gedankenstrich; weder Zeile noch Teamkopf behaupten dort eine Verrechnung mit dem Fallback.
- Der gespeicherte Auslosungs-Snapshot hält für einen unbewerteten Spieler jetzt `rating: null`
  statt des bereits ersetzten Werts, und die Historie zeigt genau diese gespeicherten Werte. Eine
  später nachgetragene Bewertung verändert eine bereits ausgeloste Aufstellung damit nicht mehr
  rückwirkend.
