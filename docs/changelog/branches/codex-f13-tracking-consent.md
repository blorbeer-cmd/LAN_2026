# Branch: `codex/f13-tracking-consent`

## Themenstrang

Backlog-Finding F13 konsolidiert Gruppenraum- und Event-Tracking-Consent für das
Ein-Gruppen-Modell. Teilnehmerprivate Events verlangen `accepted` und eine aktive persönliche
Event-Einwilligung; Gruppenraum-Consent bleibt davon unabhängig. Zustimmung und Widerruf sind
idempotent, Consent-Historie bleibt erhalten, und ein Widerruf beendet den betroffenen Live- und
Session-Kontext mit sofortiger Realtime-Aktualisierung.

Required-Auth- und Legacy-Verhalten, Gruppen-/öffentliche Events sowie Owner/Admin- und
Kiosk-Verträge bleiben unverändert. Der Branch ergänzt zentrale Kontext-, API-, Agent- und
Realtime-Regressionstests; eine Schemaänderung ist nicht erforderlich.

## Pull Requests

- [Draft-PR #268](https://github.com/blorbeer-cmd/LAN_2026/pull/268) gegen `main`.
