# PR #144: Fix invite token handling, JSON limits and Playwright docs

- Datum des Merges: 2026-07-12
- Branch: `fix/issues-31-19-25`
- Merge-Commit: [`a0f40b6`](https://github.com/blorbeer-cmd/LAN_2026/commit/a0f40b6)
- Pull Request: [#144](https://github.com/blorbeer-cmd/LAN_2026/pull/144)

## Changelog

- Invite-Token nach erfolgreichem Auto-Login aus der URL entfernt.
- Zu große JSON-Anfragen werden mit HTTP 413 beantwortet.
- Playwright-Chromium-Installation in `server/TESTING.md` dokumentiert.
- Tests für Token-URL-Bereinigung und Request-Limit ergänzt.

## Geschlossene Issues

- [#31](https://github.com/blorbeer-cmd/LAN_2026/issues/31)
- [#19](https://github.com/blorbeer-cmd/LAN_2026/issues/19)
- [#25](https://github.com/blorbeer-cmd/LAN_2026/issues/25)
