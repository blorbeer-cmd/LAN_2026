# PR #236: Stop a viewport-size leak from cascading between e2e tests

- Datum des Merges: 2026-07-20
- Branch: `claude/mobile-skill-slider-jank-i5osw2`
- Merge-Commit: [`002d228`](https://github.com/blorbeer-cmd/LAN_2026/commit/002d22828066fc2d4d9c74ad730fe31cf528dddf)
- Pull Request: [#236](https://github.com/blorbeer-cmd/LAN_2026/pull/236)

## Changelog

- Der Flows-E2E stellt den gemeinsamen Playwright-Viewport nach Desktop-Prüfungen wieder her und verhindert kaskadierende Mobile-Layout-Fehler.
