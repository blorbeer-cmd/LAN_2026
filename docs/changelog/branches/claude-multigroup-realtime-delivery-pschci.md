# Branch: `claude/multigroup-realtime-delivery-pschci`

## Themenstrang

Absicherung der Phase-5e-Auslieferung und der unmittelbar betroffenen Ressourcenpfade:
explizites Default-Deny-Modell mit Gruppen-/Event-Scope für normale, Kiosk-, Watch- und
Arcade-Sockets, empfängergebundene Push-Payloads, gruppenlokale Arrivals/Food Orders sowie ein
empfängerisolierter Mehr-Gruppen-Offline-Sweep. Arcade-Lobbys und -Matches behalten ihren
Erzeugungs-Scope unveränderlich; fachfremde Search-/Seating-Änderungen wurden aus dem Branch
entfernt.

## Pull Requests

- [PR #238](https://github.com/blorbeer-cmd/LAN_2026/pull/238), offen (Ready for Review): Enforce
  group- and event-scoped realtime delivery including Arcade.
