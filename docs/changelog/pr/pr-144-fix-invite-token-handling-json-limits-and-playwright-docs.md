# PR #144: Fix invite token handling, JSON limits and Playwright docs

- Datum des Merges: 2026-07-12
- Branch: `fix/issues-31-19-25`
- Merge-Commit: [`a0f40b6`](https://github.com/blorbeer-cmd/Respawn/commit/a0f40b6)
- Pull Request: [#144](https://github.com/blorbeer-cmd/Respawn/pull/144)

## Changelog

- Invite-Token nach erfolgreichem Auto-Login aus der URL entfernt.
- Zu große JSON-Anfragen werden mit HTTP 413 beantwortet.
- Playwright-Chromium-Installation in `server/TESTING.md` dokumentiert.
- Tests für Token-URL-Bereinigung und Request-Limit ergänzt.

## Geschlossene Issues

- [#31](https://github.com/blorbeer-cmd/Respawn/issues/31)
- [#19](https://github.com/blorbeer-cmd/Respawn/issues/19)
- [#25](https://github.com/blorbeer-cmd/Respawn/issues/25)
