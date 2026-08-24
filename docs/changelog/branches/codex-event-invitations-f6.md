# Branch: `codex/event-invitations-f6`

## Themenstrang

Backlog-Finding F6 als Ein-Gruppen-Produktfeature: Event-Teilnahmen erhalten die Zustände
`invited`, `accepted` und `declined`. Admins/Owner laden aktive Mitglieder ein; nur die eingeladene
Person beantwortet ihre Einladung. Ausschließlich `accepted` zählt als normale Teilnahme für
Tracking, Realtime, Push und teilnehmergebundene Event-Domänen. Bestehende Owner-/Admin- sowie
Kiosk-/Allowlist-Verträge bleiben unverändert.

Die nummerierte Migration v53 übernimmt alle vorhandenen Event-Teilnahmen verlustfrei als
`accepted`. API-, Migrations-, Realtime- und Zwei-Client-Browsertests decken Rollen, ungültige
Übergänge, erneute Einladung und konkurrierendes Accept-vs-Decline ab.

## Pull Requests

- [PR #264](https://github.com/blorbeer-cmd/LAN_2026/pull/264), gemergt am 2026-07-21 als
  [`06a3c8b`](https://github.com/blorbeer-cmd/LAN_2026/commit/06a3c8bde6e87b7d5b8c6d96730ad62bf965addc):
  Add event invitation responses.
