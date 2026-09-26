# PR #668: Polish Essen page: invoice-style food order cards

- Datum des Merges: 2026-09-24
- Branch: `claude/ui-polish-food-orders-0f1343`
- Merge-Commit: [`e78360a`](https://github.com/blorbeer-cmd/LAN_2026/commit/e78360a)
- Pull Request: [#668](https://github.com/blorbeer-cmd/LAN_2026/pull/668)

## Changelog

- Die Bestellkarte liest sich wie eine Rechnung: keine Randstreifen und Badges, ein neutraler Button für den nächsten Schritt plus „Aktion“-Menü im Kopf.
- Eine Meta-Zeile mit Status, Ersteller, Zeit, Personen und offenem Betrag; die Info steht als graue Zeile.
- Personen als flache Zeilen mit gleichen Controls: Bezahlt-Kästchen, PayPal, Kopieren und alle Beträge in einer rechten Spalte.
- Die Bestellübersicht ist eine Tabelle mit Summen als Fußzeile; „Alle eigenen Positionen löschen“ und Kopieren je Position entfallen.
- Fix: `viewRenderState.js` verwechselte Aktion-Menüs und Historie beim Live-Re-Render; `actionMenuHtml` erhält dafür einen optionalen `key`.

## Historischer Kontext

Teil der UI-Polish-Runde. Der Merge-Commit trägt den Titel „Polish the Essen page: invoice-style order cards with header actions“.
