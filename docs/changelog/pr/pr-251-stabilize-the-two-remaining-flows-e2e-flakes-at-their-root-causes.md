# PR #251: Stabilize the two remaining flows-E2E flakes at their root causes

- Datum des Merges: 2026-07-20
- Branch: `claude/search-palette-keyboard-flake`
- Merge-Commit: [`938a178`](https://github.com/blorbeer-cmd/LAN_2026/commit/938a178b989c2fc70ac3e149fd51a44e50a66af9) (Squash)
- Pull Request: [#251](https://github.com/blorbeer-cmd/LAN_2026/pull/251)

## Changelog

- Global-Search-Keyboard-Flake ursächlich behoben: `searchPalette.js` reagiert auf `pointermove`
  statt `pointerover` (Chromiums synthetisches Re-Hover unter stehendem Cursor schnappte die
  Tastatur-Auswahl zurück) und stellt eine explizite Tastatur-Auswahl nach dem Late-Merge der
  Content-Einträge wieder her. Review-Finding eingearbeitet: Der Default-Top-Treffer (Index 0)
  wird bewusst nicht konserviert, damit ein besser gerankter nachgeladener Treffer ihn ersetzen
  kann.
- Click-through-Typografie-Race behoben (test-only): Die Shared-Typography-Assertion liest
  Computed-Styles über `waitForFunction` von einem frisch abgefragten Knoten statt von einem
  zuvor aufgelösten Handle, das ein `players:`/`live:changed`-Re-Render detachen konnte. Keine
  Assertion gelockert.
- Unabhängiges Review (frische Claude-Session): ein Fund, bestätigt behoben in `89ecf97`.
