# PR #639: Keep the help trigger beside what it explains in every layout

- Datum des Merges: 2026-09-16
- Branch: `claude/tooltip-icon-placement-rules-yk18d5`
- Merge-Commit: [`7801b07`](https://github.com/blorbeer-cmd/LAN_2026/commit/7801b07)
- Pull Request: [#639](https://github.com/blorbeer-cmd/LAN_2026/pull/639)

## Changelog

- Der Hilfe-Trigger neben einem **Control** ist ein benannter Fall des Vertrags. Zuvor kannte ihn
  nur die Warnvariante; Variantenliste und `server/DESIGN_SYSTEM.md` sprachen ausschließlich vom
  erklärten Text und widersprachen damit dem tatsächlichen Verhalten.
- Die Kalenderbestätigung ist bei jeder Breite eine zentrierte Zeile. Unter 640 px war sie
  `flex-direction: column`, sodass das Glyph auf dem Handy unter „Übernahme bestätigen“ stand und
  sich als eigenständiges Control las. Gemessen sind es jetzt 12 px ab Rahmenkante des Buttons,
  dieselbe Zahl wie im Textfall.
- Die Umfrageoptionszeile behält den Trigger beim Titel, ohne den Titel zu quetschen. Der Umbruch
  in `.event-poll-option-title-row` ist raus; stattdessen bricht das Ergebnisbadge unterhalb
  `--bp-md` per `flex-wrap` in eine eigene Zeile, sobald der ungekürzte Titel den Platz braucht.
  Bei 320 px behält ein 89-Zeichen-Titel 118 px von 202 px über 7 Zeilen statt 70 px über 13.
- Der tote Basisblock von `.event-poll-option-header` ist entfernt. Der Renderer setzt auf dieselbe
  Zeile `row-between`, und die später deklarierte, gleich spezifische `.row-between` überschrieb
  `display`, `grid-template-columns`, `align-items` und `gap` vollständig — eine Falle, in die ein
  erster Korrekturversuch in diesem PR prompt gelaufen ist.
- `assertInfoTooltipPlacement` misst für Text wie Control die Border-Box des erklärten Elements.
  Die vorherige `Range`-Messung meldete bei umbrechendem Text 16 bis 25 px statt der tatsächlichen
  12 px und hätte korrekt platzierte Trigger als Fehler ausgewiesen.
- Die Abnahme im Vertrag misst zusätzlich den erklärten Text. `eventDatePoll.e2e.test.ts` prüft
  eine Option mit langem Titel, Notiz, Link und — nach gespeicherter Antwort — sichtbarem
  Ergebnisbadge: Die Titelzeile behält unterhalb 640 px die ganze Headerzeile, das Badge steht
  darunter.
- Der Bestätigungslauf der CI-Laufzeitprüfung hat wieder eine ausdrückliche Statusfunktion. Das
  implizite `success()` jeder `needs`-Beziehung hatte ihn über einen übersprungenen Vorgänger
  mitabgeschaltet, worauf der fail-closed-Aggregator eine nie gelaufene Bestätigung einforderte.
  Der Ausgang `has_suspicions` ist entfallen; die Verdachtsliste ist der einzige Vertrag zwischen
  Skript und Workflow.

## Historischer Kontext

Folge-PR zu #636. Das dortige Audit ließ drei Platzierungsfälle offen, die der neue Vertrag
entweder verbot oder nicht kannte. Drei Codex-Review-Runden waren nötig: Die erste deckte auf, dass
der Wegfall des Umbruchs eine schwerere Regression eintauschte und dass eine boolesche Bedingung
das implizite `success()` nicht überschreiben kann; die zweite, dass die daraufhin gewählte
Grid-Korrektur an der CSS-Kaskade wirkungslos blieb und der Testhelfer mehrzeiligen Text falsch
maß; die dritte, dass der neue Regressionstest mangels gespeicherter Antwort einen leeren
Badge-Container vermaß und die normativen Kurzregeln den Control-Fall weiterhin nicht kannten.
