# PR #636: Move the info tooltip glyph closer to the text it explains

- Datum des Merges: 2026-09-16
- Branch: `claude/tooltip-icon-placement-rules-yk18d5`
- Merge-Commit: [`d79eb5b`](https://github.com/blorbeer-cmd/LAN_2026/commit/d79eb5b)
- Pull Request: [#636](https://github.com/blorbeer-cmd/LAN_2026/pull/636)

## Changelog

- Der Hilfe-Trigger der Kontexthilfe ist ein `--control-height`-Quadrat statt 44 px breit; der
  optische Abstand zum erklärten Text sinkt von 18 px auf 12 px.
- Das Glyph misst fest 16 × 16 px. Zuvor erbte der `<button>` keine Schriftgröße, sodass `1.2em`
  gegen die Browservorgabe aufgelöst wurde und die Einheitlichkeit nur zufällig entstand.
- Neuer Komponentenvertrag `server/frontend-contracts/components/info-tooltip.md` mit Platzierung,
  Geometrie, Panelverhalten, Zuständen und Accessibility; `infoTooltip.js` war der einzige
  Render-Helper ohne eigenen Vertrag.
- Zwei Hilfe-Trigger aus einem Audit aller 67 Aufrufstellen korrigiert: der Battleship-Aufbautitel
  rutschte durch `justify-content: space-between` ans rechte Zeilenende, der Titel des aktiven
  Arcade-Spiels erbte eine 8-px-Zeile.
- Neuer E2E-Helfer `assertInfoTooltipPlacement` prüft Trefferfläche, Glyph, Abstand und vertikale
  Zentrierung in drei Suites.
- Vier visuelle Referenzen aus dem CI-Artefakt aufgefrischt, weil das Formular „Spiel vorschlagen“
  den Trigger enthält.

## Historischer Kontext

Aus der Frage, ob der Komponentenvertrag die Platzierung des Info-Icons regelt. Er tat es nicht:
verbindlich war nur die Trefferfläche, die Platzierungsregel stand als einzelner Satz im
Designkern, und die tatsächliche Geometrie hing an einer Browservorgabe. Der PR verschiebt die
Regel in einen eigenen Vertrag und macht sie messbar.
