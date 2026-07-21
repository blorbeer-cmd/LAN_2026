# PR #245: Avoid reload flicker when toggling checklist items and paid status

- Datum des Merges: 2026-07-20
- Branch: `claude/packliste-abhaken-ruckler-44nl8m`
- Merge-Commit: [`f2c46b6`](https://github.com/blorbeer-cmd/LAN_2026/commit/f2c46b64e1029fb6d65bb6d0f01238ae9d6869ee)
- Pull Request: [#245](https://github.com/blorbeer-cmd/LAN_2026/pull/245)

## Changelog

- Packlisten- und Bezahlt-Checkboxen aktualisieren den lokalen Cache nach erfolgreichem API-Aufruf statt die ganze Ansicht mit Ladezustand neu aufzubauen.
