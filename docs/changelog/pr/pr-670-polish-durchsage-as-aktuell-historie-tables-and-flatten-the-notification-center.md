# PR #670: Polish Durchsage as Aktuell/Historie tables and flatten the notification center

- Datum des Merges: 2026-09-25
- Branch: `claude/durchsage-ui-polish-dda219`
- Merge-Commit: [`37a4691`](https://github.com/blorbeer-cmd/LAN_2026/commit/37a4691)
- Pull Request: [#670](https://github.com/blorbeer-cmd/LAN_2026/pull/670)

## Changelog

- Durchsage: laufende Durchsagen in der offenen Karte „Aktuell“, beendete und abgelaufene in der zugeklappten „Historie“.
- Flache Tabelle mit Nachricht (40 Zeichen), Absender, kurzem Zustand und fester Spalte „Beenden“; ein Zeilenklick öffnet den Detail-Dialog.
- Formular mit einzeilig startendem, mitwachsendem Nachrichtenfeld und kleinem „Senden“ unten rechts.
- Benachrichtigungszentrale: graue Meta-Zeile statt Pillen, „Beendet“ statt „Obsolet“, der ganze Eintrag ist der Link, gleich breite Fußleiste.
- Kiosk: Durchsagen bis zu zwei Zeilen.

## Historischer Kontext

Teil der UI-Polish-Runde. Die Tabellenklassen `broadcast-table-*` nutzt später auch die Feedback-Seite.
