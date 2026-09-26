# PR #662: Polish Match, Vote and tournament result UI

- Datum des Merges: 2026-09-24
- Branch: `claude/match-page-ui-improvements-0e9371`
- Merge-Commit: [`0677920`](https://github.com/blorbeer-cmd/LAN_2026/commit/0677920)
- Pull Request: [#662](https://github.com/blorbeer-cmd/LAN_2026/pull/662)

## Changelog

- Match > Teams: ein Umschalt-Button für alle Spieler, sichtbares Feld „Spieler suchen“, Touch-Alternative zu Drag and Drop per nativem Team-Picker.
- Ergebnisse einheitlich mit „Win“-Chip, grauen Verlierern und „Remis“; feste Aktionsspalte „+“ oder Stift und ein gemeinsamer kompakter Ergebnis-Dialog.
- Turniere: echte Tabelle (Sp/S/U/N/+/−/Pkt), Fortschritt „X/Y Partien“ oder „Sieger“ in der Liste, Detail ohne Zurück und ohne Info-Tooltips.
- Vote: Spiele alphabetisch, kompakte Karten, „X/Y abgegeben“, Abschicken rechts statt über die volle Breite, Top 10 einklappbar.
- Global: kein blauer Rahmen um Hauptkarten und kein Fokusring um per Skript fokussierte Überschriften.

## Historischer Kontext

Teil der UI-Polish-Runde. Die abgestimmten Stilregeln hält #663 im Designsystem fest. Visuelle Referenzen `core-roster-*` und `core-filters-*` wurden aus CI-Artefakten erneuert.
