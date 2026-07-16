# PR #209: General UI polish pass with user-management merge integration

- Datum des Merges: 2026-07-16
- Branch: `codex/feedback-general-ui-polish`
- Merge-Commit: [`c586cec`](https://github.com/blorbeer-cmd/Respawn/commit/c586cec4c54947e2fcd44e1668a90a11338988b7)
- Pull Request: [#209](https://github.com/blorbeer-cmd/Respawn/pull/209)

## Changelog

- Großer UI-Polish-Durchgang über alle Views auf Basis von `docs/FEEDBACK-GENERELL.md`:
  Produktname durchgängig „Respawn“, gruppierte Seitenhierarchie (`grouped-page-sections`),
  globale Suche (Strg/Cmd + K), Header-Notification-Center mit persönlicher Historie,
  konsolidierte Design-Tokens, Icon- und Accessibility-Regeln.
- Vote-Semantik verschärft: genau eine Abgabe pro Runde und Identität, atomarer 409 bei
  Wiederholung; Kiosk-Raumanzeige mit maskierten Spielnamen, Countdown-Reveal und
  10-Minuten-Ergebnisfenster.
- Turnier-Ergebnisse nachträglich korrigierbar (PUT), deterministische Lobby-Namen mit
  Phase/Runde/Match-Suffix; editierbarer Sitzplan im Admin-Modus.
- Integration des User-Managements von `main` (Phasen 1 bis 5c): 27 Konfliktdateien
  aufgelöst, Branch-Migrationen 26 bis 28 auf 36 bis 38 umnummeriert (kollisionsfrei zur
  Group-Scoping-Serie), Kiosk-Vote-Endpoint group-scoped und in die Kiosk-Token-Allowlist
  aufgenommen, Hall-of-Fame-Testdaten mit `group_id`, Push-Bulk-Endpoints und
  Food-Order-Items an die Session-Identitätsbindung angeschlossen, Backup und
  Testdaten-Cleanup mit Step-up-Reauthentifizierung.
- Login-/Auth-Oberflächen auf „Respawn“ und Respawn-Präfixe (Session-Cookie, Storage-Keys,
  Custom Events) vereinheitlicht.
- Reload stellt die aktive View aus dem History-State wieder her statt auf Home zu
  springen; der Agent-Vertragstest sendet die Geräte-Identität wie der echte Web-Client.
  Die E2E-Suite (46 Tests) läuft damit erstmals vollständig grün, lokal und in CI.
