# Plan für Issue #29: DB-Migrationen versionieren

Issue: [#29](https://github.com/blorbeer-cmd/LAN_2026/issues/29)

## Ausgangslage

`server/src/db.ts` führt die Schema-Erstellung und viele spätere Upgrades gemeinsam aus. Die
Migrationen prüfen jeweils per `PRAGMA table_info(...)`, ob einzelne Spalten oder Tabellen bereits
existieren. Das ist für die aktuelle Größe funktional, wird aber mit jedem Feature länger und macht
die Reihenfolge der Änderungen schwerer nachvollziehbar.

## Ziel

Ein kleines, eigenes Migrationssystem ohne ORM:

- Eine Tabelle `schema_migrations` speichert die erfolgreich ausgeführten Versionsnummern.
- Jede Migration ist eine nummerierte Funktion mit kurzer Beschreibung.
- Eine Migration läuft genau einmal und innerhalb einer SQLite-Transaktion.
- Neue Installationen und bestehende Datenbanken landen beim gleichen Schema-Endstand.
- Der Server startet nicht mit einem halbfertigen Schema, wenn eine Migration fehlschlägt.

## Vorgeschlagene Struktur

```ts
type Migration = {
  version: number;
  name: string;
  up: () => void;
};

const migrations: Migration[] = [
  { version: 1, name: 'food order send_at', up: migrateFoodOrderSendAtColumn },
  // weitere historische und neue Migrationen
];
```

Beim Start wird zuerst `schema_migrations` angelegt. Danach werden die Migrationen nach Version
sortiert, die bereits eingetragenen übersprungen und alle fehlenden in einer Transaktion ausgeführt.
Nach erfolgreichem Abschluss wird die Versionsnummer mit Zeitstempel und Name eingetragen.

## Umsetzungsschritte

1. Alle bestehenden `migrate...()`-Funktionen und ihre Reihenfolge in `db.ts` inventarisieren.
2. Einen stabilen Baseline-Punkt festlegen: das aktuell deklarierte Frischinstallationsschema bleibt
   unverändert.
3. `schema_migrations` und den kleinen Runner ergänzen.
4. Bestehende historische Upgrades in nummerierte Migrationen überführen. Die Prüfungen auf einzelne
   Spalten bleiben zunächst innerhalb der Migrationen, damit Datenbanken aus älteren Zwischenständen
   sicher aktualisiert werden können.
5. Die bisher direkten Aufrufe durch den Runner ersetzen.
6. Eine neue Migration testweise anlegen und prüfen, dass sie bei einem zweiten Serverstart nicht
   erneut ausgeführt wird.
7. Dokumentation für neue Migrationen in `server/TESTING.md` oder einer kurzen `server/DB.md`
   ergänzen.

## Tests

- Frische In-Memory-Datenbank erreicht den aktuellen Schema-Endstand.
- Bestehende Legacy-Fixtures werden bis zum aktuellen Stand migriert.
- Jede Migration wird bei wiederholtem Start nur einmal ausgeführt.
- Ein absichtlich fehlschlagender Schritt hinterlässt keine halbe Änderung.
- Die Reihenfolge wird geprüft; fehlende Vorgängerversionen dürfen nicht übersprungen werden.
- Bestehende API- und DB-Migrationstests bleiben grün.

## Risiken und Entscheidungen

- Die Migrationen dürfen nicht einfach nur anhand der aktuellen Tabellenstruktur neu sortiert werden;
  ältere reale Datenbanken können Zwischenstände enthalten.
- Die bestehende Datenbank wird nicht automatisch neu geschrieben oder zurückgesetzt.
- Die alte `PRAGMA`-Logik sollte erst entfernt werden, wenn alle historischen Upgrade-Pfade durch
  Fixtures abgedeckt sind.
- Ein Rollback einer bereits ausgeführten Migration ist zunächst nicht vorgesehen. Falls später nötig,
  bekommt eine Migration eine bewusst getestete `down`- oder Reparaturmigration.

## Nicht Bestandteil dieses Issues

- Kein ORM und keine externe Migration-Abhängigkeit.
- Keine Änderung am fachlichen Datenmodell.
- Keine Bereinigung der Git-Historie oder produktiver Datenbanken.
