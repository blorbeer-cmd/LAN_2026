# PR #677: Polish Mein Profil and Meine Statistiken as row cards with a shared RankedList

- Datum des Merges: 2026-09-26
- Branch: `claude/ui-polish-profile`
- Merge-Commit: [`d0b9006`](https://github.com/blorbeer-cmd/LAN_2026/commit/d0b9006)
- Pull Request: [#677](https://github.com/blorbeer-cmd/LAN_2026/pull/677)

## Changelog

- Mein Profil: eine Spalte vollbreiter Karten, Einstellungen als Zeilen mit grauer Meta-Zeile und einer Aktion in fester rechter Spalte.
- Einladungen mit Detail-Dialog; Passwort und Sichtbare Monitore im Dialog; „Live-Status & Agent“, „Datenschutz“ und „Meine Daten“ als eingeklappte Karten.
- Meine Statistiken: Event-Filter in der Titelzeile, Kennzahlen in gleichen Spalten, Listen als eingeklappte RankedLists.
- Neuer Vertrag RankedList (Designregel 14): Ranglisten nach Wert nummeriert, übrige Listen alphabetisch, linke Spalte zuerst; auch für Home „Rangliste“ und „Live-Status“.
- Sitzplan mit Umrissen statt gestrichelter Flächen, Ausreden-Generator mit Auswahlfeld, zufällige Startfarbe für neue Konten.

## Historischer Kontext

Teil der UI-Polish-Runde. Die übrigen `lb-row`-Listen in Auswertung, Hall of Fame, Arcade und Vote sind als befristete Ausnahme für einen Folge-PR vermerkt.
