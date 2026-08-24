# PR #238: Enforce group- and event-scoped realtime delivery

- Datum des Merges: 2026-07-20
- Branch: `claude/multigroup-realtime-delivery-pschci`
- Merge-Commit: [`601d43e`](https://github.com/blorbeer-cmd/LAN_2026/commit/601d43ee18b0b102c22e2ccbf47f089a7de14aad) (Squash)
- Pull Request: [#238](https://github.com/blorbeer-cmd/LAN_2026/pull/238)

## Changelog

- Required-Mode-Broadcasts sind default-deny und werden unmittelbar vor Auslieferung gegen aktive
  Gruppen-/Eventberechtigung revalidiert; Eventzugriff gilt für Teilnehmer sowie aktive
  Gruppen-Admins/-Owner, Rollen- und Membership-Entzug wirken auf offene Sockets.
- Arrivals und Food Orders lösen ihr Event gruppenlokal auf; bekannte fremde IDs antworten 404
  ohne Realtime-Signal.
- Arcade-Lobbys und -Matches tragen einen unveränderlichen `groupId`/`eventId`-Scope, der bei
  jeder Aktion, Watch, Replay, Vote und Kiosk-Auslieferung revalidiert wird.
- Legacy-Modus sendet persönlich adressierte Push-Payloads nicht mehr global aus.
- Der Offline-Sweep wird gegen konkrete Empfänger je Gruppe getestet; der Seating-E2E prüft beide
  dokumentierten Breakpoints statt auf einen geleakten Desktop-Viewport zu vertrauen.
- Unabhängiges Delta-Review (`bd93ef9..9379aeb`) vor Merge: `DELTA APPROVED`.
