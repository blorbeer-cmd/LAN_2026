# PR #145: Fix stale live status and agent proxy URLs

- Datum des Merges: 2026-07-12
- Branch: `fix/live-status-agent-url`
- Merge-Commit: [`78a2413`](https://github.com/blorbeer-cmd/LAN_2026/commit/78a2413)
- Pull Request: [#145](https://github.com/blorbeer-cmd/LAN_2026/pull/145)

## Changelog

- Manuelle Pause-Notizen überschreiben bei veraltetem Agent-Report nicht mehr den Offline-Status.
- Pausieren und Roster-Entfernung schließen Live-Spiele und offene Sessions sofort.
- Agent-Downloads unterstützen `PUBLIC_BASE_URL` hinter HTTPS-Reverse-Proxies.
- Tests für Live-Status, Session-Cleanup, Roster-Entfernung und Download-URL ergänzt.

## Geschlossene Issues

- [#20](https://github.com/blorbeer-cmd/LAN_2026/issues/20)
- [#18](https://github.com/blorbeer-cmd/LAN_2026/issues/18)
- [#17](https://github.com/blorbeer-cmd/LAN_2026/issues/17)
