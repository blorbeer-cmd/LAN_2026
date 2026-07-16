# PR #166: Fix arcade spectator rendering

- Datum des Merges: 2026-07-13
- Branch: `codex/fix-arcade-spectator-views`
- Merge-Commit: [`8e47760`](https://github.com/blorbeer-cmd/Respawn/commit/8e477606ab7f1e06e870ff769c0ab1b6b63f5f8f)
- Pull Request: [#166](https://github.com/blorbeer-cmd/Respawn/pull/166)

## Changelog

- Gemeinsamen Renderer für Kiosk und Zuschaueransicht eingeführt.
- Arcade-Streams behalten die korrekten Spielwelt-Seitenverhältnisse.
- Tetris-Boards zeigen die Spielernamen auch im Kiosk.
- Scribble-Streams verwenden weißes Zeichenpapier und rendern einzelne Punkte sichtbar.
- Gemeinsame Renderer-Unit- und E2E-Tests ergänzt.
