# Branch: `claude/reset-plan-r4-migrations-v0zond`

## Themenstrang

Reset-Plan Phase R4 (Migrations-Hygiene, F7 + F8) gemäß `docs/plans/reset-single-group.md`,
Abschnitt 5. Läuft gruppenunabhängig und parallel zum Hauptstrang R0→R1→R2.

- F7: DB-Migrationen werden vor der Ausführung nach `version` sortiert statt in
  Registrierungsreihenfolge ausgeführt (v44/v45 waren vor v41–v43 registriert). Jede Version bleibt
  einzeln über `schema_migrations` abgesichert; bereits angewandte Versionen laufen nicht erneut,
  keine Version wird übersprungen.
- F8: Das zuvor ungeschützte `ALTER TABLE play_sessions ADD COLUMN allocation_weight` (v44) ist mit
  einer `PRAGMA table_info`-Existenzprüfung abgesichert. `createPushMuteTable()` bleibt als
  ausdrücklich dokumentierte, idempotente Ausnahme außerhalb des Migrationszählers und läuft hinter
  dem Migrationsrunner.
- Tests: aufsteigende Ausführungsreihenfolge, erzwungene v44-Wiederholung ohne Crash, verlustfreies
  erneutes Anwenden der umsortierten Migrationen v41–v45 über befüllten Daten.
- Die finale Angleichung der `TESTING.md`-Migrationsbehauptung an das neue Verhalten bleibt laut
  Plan Phase R5.

## Pull Requests

- [PR #257](https://github.com/blorbeer-cmd/LAN_2026/pull/257), offen (Draft): R4: Run DB migrations
  in version order and guard v44 schema changes (F7 + F8).
