# Branch: `claude/multigroup-realtime-delivery-pschci`

## Themenstrang

Absicherung der Phase-5e-Auslieferung und der unmittelbar betroffenen Ressourcenpfade:
explizites Default-Deny-Modell mit Gruppen-/Event-Scope für normale, Kiosk-, Watch- und
Arcade-Sockets, empfängergebundene Push-Payloads, gruppenlokale Arrivals/Food Orders sowie ein
empfängerisolierter Mehr-Gruppen-Offline-Sweep. Arcade-Lobbys und -Matches behalten ihren
Erzeugungs-Scope unveränderlich. Die fachfremde Search-Palette-Änderung wurde entfernt; der
Seating-E2E prüft nach dem bereits auf `main` vorhandenen Mobile-Reset explizit beide dokumentierten
Breakpoints, damit die vollständige CI nicht von einem geleakten Desktop-Viewport abhängt.

## Pull Requests

- [PR #238](https://github.com/blorbeer-cmd/LAN_2026/pull/238), offen (Ready for Review): Enforce
  group- and event-scoped realtime delivery including Arcade.
