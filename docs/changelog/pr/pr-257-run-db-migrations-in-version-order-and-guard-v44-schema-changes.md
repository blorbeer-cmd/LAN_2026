# PR #257: R4: Run DB migrations in version order and guard v44 schema changes (F7 + F8)

- Datum des Merges: 2026-07-21
- Branch: `claude/reset-plan-r4-migrations-v0zond`
- Merge-Commit: [`f91ca2c`](https://github.com/blorbeer-cmd/LAN_2026/commit/f91ca2c38b6dab0baf3353faed145e70e478fae1)
- Pull Request: [#257](https://github.com/blorbeer-cmd/LAN_2026/pull/257)

## Changelog

Reset-Plan Phase R4 (Migrations-Hygiene) gemäß `docs/plans/reset-single-group.md` Abschnitt 5,
gruppenunabhängig und ohne Bezug zum Ein-/Mehrgruppen-Rückschnitt.

- F7: DB-Migrationen in `server/src/db.ts` werden nicht mehr in Registrierungsreihenfolge
  ausgeführt. Jede Migration wird über `registerMigration()` nur gesammelt und am Dateiende über
  `runRegisteredMigrations()` nach `version` sortiert ausgeführt. Damit läuft nie eine höhere
  Version vor einer niedrigeren (zuvor waren v44/v45 vor v41–v43 registriert). Der Guard pro Version
  über `schema_migrations` bleibt: bereits angewandte Versionen laufen nicht erneut, keine Version
  wird übersprungen; Doppelversionen werfen beim Modulladen einen Fehler.
- F8: Das zuvor ungeschützte `ALTER TABLE play_sessions ADD COLUMN allocation_weight` (v44) ist mit
  einer `PRAGMA table_info`-Existenzprüfung abgesichert, wie jede andere spaltenaddierende
  Migration; ein wiederholter Start bzw. eine erneute Ausführung von v44 crasht nicht mehr an einer
  Duplicate-Column. `createPushMuteTable()` bleibt als ausdrücklich dokumentierte, idempotente
  Ausnahme (`CREATE TABLE/INDEX IF NOT EXISTS`) außerhalb des Migrationszählers und läuft hinter dem
  Migrationsrunner, damit die von v30 erzeugte `groups`-Tabelle auf einer frischen DB existiert.
- Tests (`server/src/test/db.migrations.test.ts`): aufsteigende Ausführungsreihenfolge (1..51),
  erzwungene v44-Wiederholung ohne Crash an der abgesicherten ALTER, verlustfreies erneutes Anwenden
  der umsortierten Migrationen v41–v45 über befüllten Daten. Beide neuen Guards schlagen gegen das
  alte Verhalten nachweislich fehl.
- `server/TESTING.md` minimal an `registerMigration()` und die versionssortierte Ausführung
  angepasst. Die umfassende Angleichung der Migrationsbehauptung bleibt Phase R5.
- Keine destruktive Schemamigration; `groups`/`group_memberships`/`group_id` und das
  Startgruppen-Seeding unangetastet; Node 24 unverändert.
