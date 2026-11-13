# PR #756: Keep betting markets usable after lineup and result corrections

- Datum des Merges: 2026-11-13
- Branch: `ccr-ce451f03-d7nhep`
- Merge-Commit: [`1178160`](https://github.com/blorbeer-cmd/LAN_2026/commit/1178160)
- Pull Request: [#756](https://github.com/blorbeer-cmd/LAN_2026/pull/756)

## Changelog

- Spieler verschieben (Feinschliff) beendet die Wette nicht mehr endgültig: Ein Markt ohne Tipps übernimmt die neue Aufstellung; ein offener Markt mit Tipps wird erstattet und im selben Schritt durch einen neuen Markt für dieselbe Auslosung ersetzt. Eine explizite Frist gilt für den Nachfolger weiter; geschlossene Märkte bleiben geschlossen.
- Ein korrigiertes Halbfinale macht das Finale wieder wettbar; die neue Finalpaarung erhält einen eigenen Markt.
- Märkte, die wegen eines falsch eingetragenen Ergebnisses erstattet wurden und Tipps auf mindestens zwei Ausgängen haben, werden bei der begründeten Admin-Ergebniskorrektur neu abgerechnet.
- Beim Einblenden der LAN-Punkte entstehen die Märkte wartender Wettbewerbe sofort statt erst beim 30-Sekunden-Abgleich.
- Migration 137 speichert den Erstattungsgrund (`refund_cause`) und beschränkt die Eindeutigkeit je Quelle auf nicht ersetzte Runden. Die Punkte-API liefert dazu `replaced` und `rebooksOnCorrection`.

## Historischer Kontext

Behebt die Bugs A1, A3, A4 und A6 aus dem Wett-Feedback in Issue #755. Ein `pr-review` verlangte im ersten Durchgang, die explizite Tippfrist auf Ersatzmärkte zu übertragen; das wurde vor dem Merge ergänzt. Die Zusammenfassung stammt aus der PR-Beschreibung und dem Diff.
