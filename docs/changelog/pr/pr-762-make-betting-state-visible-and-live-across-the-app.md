# PR #762: Make betting state visible and live across the app

- Datum des Merges: 2026-11-14
- Branch: `claude/betting-app-visibility`
- Merge-Commit: [`c8b9595`](https://github.com/blorbeer-cmd/LAN_2026/commit/c8b9595)
- Pull Request: [#762](https://github.com/blorbeer-cmd/LAN_2026/pull/762)

## Changelog

- Fremde Tipps sind nach Nutzerentscheidung sofort mit Namen sichtbar (`tippers` je Ausgang). Gelöschte Konten, Konten mit Newsticker-Opt-out und Testkonten außerhalb von Testevents bleiben anonyme Einsätze ohne Name und ID. Turnierspiele tragen den Phasennamen des Baums.
- Neues Echtzeitsignal `betting:changed` für Tipps, Schließen und Wiederöffnen; ein offener Tippdialog übernimmt Änderungen anderer Geräte live, einschließlich neu entstandener Turniermärkte.
- Match- und Turnierkarten zeigen Status, Topf, Tippanzahl und den eigenen Tipp; „Spiel starten“ ist eine eigene, bestätigte Aktion. Der Tippdialog bietet Teamflächen mit Einsätzen und Tippenden, die feste Gewinnobergrenze statt einer Schätzung und eine Speicherbestätigung.
- „Ohne Ergebnis“ und der Tippfilter umfassen alle Spiele. Die Punkteseite listet die eigenen Tipps, die Punkteverwaltung alle Wettrunden; die Endwertungsbestätigung nennt offene Runden. Bei ausgeblendeten LAN-Punkten erklärt ein Hinweis Admins und dem Event-Ersteller, warum Tipps fehlen.

## Historischer Kontext

Setzt B1–B8, C1 und C4 aus Issue #755 um (Kiosk und Ticker, C2/C3/C5, folgen separat). Ein `pr-review` verlangte im ersten Durchgang den Newsticker-Opt-out für öffentliche Tipps, neue Turniermärkte im offenen Dialog und einen korrekten Abschlussstatus von Turnierkarten; alle drei wurden vor dem Merge ergänzt, das zweite Review auf `e39815d` blieb ohne Findings. Die Zusammenfassung stammt aus PR-Beschreibung, Reviews und Diff.
