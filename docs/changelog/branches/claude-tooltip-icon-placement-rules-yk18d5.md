# Branch: `claude/tooltip-icon-placement-rules-yk18d5`

## Themenstrang

Dieser Branch ist mit 1 PR in der GitHub-Historie vertreten.

| PR | Status | Titel |
|---:|---|---|
| [#636](https://github.com/blorbeer-cmd/LAN_2026/pull/636) | offen (Draft) | Move the info tooltip glyph closer to the text it explains |

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

## Referenz-Refresh

Erledigt. Die vier Referenzen `core-modal-390`, `core-form-390`, `core-modal-1024` und
`core-form-1024` enthalten den Info-Trigger am Trailer-Feld und wurden aus dem Artefakt
`e2e-core-failure-diagnostics` 10441959292 des CI-Laufs 35087200565 übernommen, jede einzeln gegen
ihr Diff geprüft: einzige Abweichung ist ein 22-×-16-px-Block am Trigger, 156 Pixel je Szene, ohne
Umgebungsunterschied. Prüfsummen und `provenance` im Referenzprofil sind nachgezogen; der
Core-Bildvergleich ist in CI-Lauf 35091900593 grün.

## Offene Punkte

Keine.
