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

## Offene Punkte

Die visuellen Referenzen `core-modal-*` und `core-form-*` enthalten einen Info-Trigger und brauchen
den in `server/TESTING.md` beschriebenen Refresh aus dem CI-Artefakt dieses Branches.
