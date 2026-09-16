# Branch: `claude/tooltip-icon-placement-rules-yk18d5`

## Themenstrang

Dieser Branch ist mit 2 PRs in der GitHub-Historie vertreten.

| PR | Status | Titel |
|---:|---|---|
| [#636](https://github.com/blorbeer-cmd/LAN_2026/pull/636) | gemergt am 2026-09-16 | Move the info tooltip glyph closer to the text it explains |
| [#639](https://github.com/blorbeer-cmd/LAN_2026/pull/639) | gemergt am 2026-09-16 | Keep the help trigger beside what it explains in every layout |

## Inhalt

Der Hilfe-Trigger der Kontexthilfe wird ein `--control-height`-Quadrat mit fest gepinntem
16-px-Glyph; der optische Abstand zum erklärten Text sinkt von 18 px auf 12 px und ist in jeder
Schriftgröße gleich. Platzierung, Geometrie, Panelverhalten und Accessibility stehen neu im
Komponentenvertrag `server/frontend-contracts/components/info-tooltip.md`, auf den die
Registry-Einträge `info-trigger`, `info-warning-state` und der neue `info-trigger-glyph` zeigen.

Ein Audit aller 67 Aufrufstellen gegen den neuen Vertrag fand zwei Hilfe-Trigger, die als direkte
Kinder einer Layoutzeile statt in einem eigenen `.title-with-info` standen: der Battleship-
Aufbautitel rutschte durch `justify-content: space-between` ans rechte Zeilenende, der Titel des
aktiven Arcade-Spiels erbte die 8-px-Zeile. Beide stehen jetzt bei 12 px.

#639 schließt die drei Platzierungsfälle, die das Audit offen ließ. Der Trigger neben einem
**Control** ist ein benannter Fall des Vertrags, und Kurzregeln wie Designkern nennen seither Text
oder Control mit der Elementkante als Bezug; die Kalenderbestätigung bleibt dadurch auch auf dem
Handy eine Zeile. Die Umfrageoptionszeile behält den Trigger am Titel, ohne ihn zu quetschen: Das
Ergebnisbadge bricht unterhalb `--bp-md` in eine eigene Zeile, sobald der Titel den Platz braucht.
Für mehrzeiligen Text ist die Elementkante maßgeblich, und `assertInfoTooltipPlacement` misst sie
seither für Text wie Control. Außerdem startet der Bestätigungslauf der CI-Laufzeitprüfung wieder,
weil eine ausdrückliche Statusfunktion das implizite `success()` der `needs`-Kette überschreibt.

## Referenz-Refresh

Erledigt. Die vier Referenzen `core-modal-390`, `core-form-390`, `core-modal-1024` und
`core-form-1024` enthalten den Info-Trigger am Trailer-Feld und wurden aus dem Artefakt
`e2e-core-failure-diagnostics` 10441959292 des CI-Laufs 35087200565 übernommen, jede einzeln gegen
ihr Diff geprüft: einzige Abweichung ist ein 22-×-16-px-Block am Trigger, 156 Pixel je Szene, ohne
Umgebungsunterschied. Prüfsummen und `provenance` im Referenzprofil sind nachgezogen; der
Core-Bildvergleich ist in CI-Lauf 35091900593 grün.

## Offene Punkte

Der Workflow-Fix aus #639 ist nicht am Verdachtsfall erprobt. Dass der Bestätigungslauf startet,
zeigt erst ein Lauf mit nichtleerer Verdachtsliste und übersprungenem Vorgänger; ein grüner Lauf
mit leerer Liste prüft den Fall nicht.
