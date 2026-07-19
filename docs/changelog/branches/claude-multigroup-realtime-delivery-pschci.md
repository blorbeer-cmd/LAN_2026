# Branch: `claude/multigroup-realtime-delivery-pschci`

## Themenstrang

Fix der nicht-Arcade-bezogenen Realtime-Auslieferung nach dem direkten Phase-5e-Push auf `main`:
explizites default-deny Broadcast-Modell mit Pflicht-Gruppenscope, getrennten Empfängerregeln für
normale, Kiosk- und Legacy-Sockets, dokumentiertem globalen Instanz-Signalpfad und
Mehr-Gruppen-Offline-Sweep.

## Pull Requests

- [PR #238](https://github.com/blorbeer-cmd/LAN_2026/pull/238), offen (Draft): Enforce explicit
  group scope for non-arcade realtime delivery.
