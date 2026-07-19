# Tests

Qualität wird über automatisierte Tests abgesichert. Bewusst schlank gehalten – kein schweres
Framework, sondern der **eingebaute Node-Test-Runner** (`node:test`) plus **supertest** für die API
und **Playwright** für echte Browser-Klickpfade.

## Test-Arten

| Art               | Womit                                                   | Was                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Unit**          | `node:test` + `assert`                                  | Reine Logik ohne I/O: Zugangs-Guard, Live-Status-Ableitung, Matchmaking-Balancing, Leaderboard-Scoring (`src/*.test.ts`). Ebenso die DOM-freien Frontend-Helfer (Formatierung, Avatar-Palette, Prozessnamen-Vorschläge, State-Lookups, `dateTimeFieldHtml`) direkt unter `public/js/*.test.js` — läuft ohne Build-Step als ESM (`public/package.json` setzt `"type": "module"` nur für den Node-Testlauf, ohne Auswirkung auf die im Browser statisch ausgelieferten Dateien). |
| **Integration**   | `node:test` + `supertest`                               | Echte HTTP-Requests gegen die Express-App (`src/test/*.test.ts`), gegen eine **In-Memory-DB**.                                                                                                                                                                                                                                                                                                                                                                                 |
| **E2E (Browser)** | `node:test` + Playwright (`src/test/e2e/*.e2e.test.ts`) | Startet den echten gebauten Server + einen echten Chromium und klickt durch die Web-UI: Spieler anlegen, Teams auslosen, abstimmen, Ergebnis eintragen, Zugangs-Token-Login.                                                                                                                                                                                                                                                                                                   |

## Ausführen

```bash
cd server
npm test              # schnell: Unit + Integration (In-Memory-DB, kein Server/Browser nötig)
npm run test:coverage # wie npm test, zusätzlich mit Zeilen-/Branch-/Funktions-Coverage-Report
npm run test:e2e      # langsamer: startet Server-Prozess(e) + Chromium, klickt durch die UI
```

Falls Playwright noch keinen Chromium-Browser installiert hat, einmalig aus `server/` ausführen:

```bash
npx playwright install chromium
```

Unter Linux kann bei fehlenden Systembibliotheken zusätzlich `npx playwright install --with-deps chromium`
nötig sein.

`test:coverage` nutzt Node's eingebautes `--experimental-test-coverage` (keine zusätzliche
Abhängigkeit) und blendet Testdateien selbst aus dem Report aus. Kein hartes Minimum hinterlegt –
der Report ist als Signal beim Review gedacht (sinkt die Zeilen-/Branch-Abdeckung einer Datei durch
eine Änderung spürbar, ist das ein Hinweis, neue Pfade mitzutesten statt nur den Happy Path).

- Unit/Integration laufen gegen eine **In-Memory-SQLite** (`DB_FILE=:memory:`), berühren also nie
  echte Daten.
- E2E startet den gebauten Server (`dist/index.js`) als eigenen Kindprozess auf einem Test-Port,
  ebenfalls mit `DB_FILE=:memory:`, und schließt ihn danach automatisch wieder.
- Jede Test-Datei läuft in einem eigenen Prozess (Isolation durch den Node-Runner).
- Die verpflichtende Zwei-Gruppen-Autorisierungsmatrix liegt in
  `src/test/api.groupAuthorization.required.test.ts`. Sie prüft fremde Ressourcen (`404`),
  unzureichende Rollen (`403`), sofortige Rollenwirkung, gruppengebundene Events/Audits,
  Test-Spieler-Eigentum, den Last-Owner-Race, deaktivierte Owner, den Entfernungsschutz der
  Startgruppe und die Archivierungssperre bei laufendem Tracking.
- Der Phase-5c-Cluster Votes/Drafts hat eine eigene Zwei-Gruppen-Suite in
  `src/test/api.groupVotesDrafts.required.test.ts`. Sie deckt gruppenlokale CRUD-/Listen-Zustände,
  Rollen, aktive Spieler-Mitgliedschaften, historische Snapshots, Aggregationen, Foreign Keys und
  Event-Exporte ab.
- Seating/Pings wird entsprechend in `src/test/api.groupSeatingPings.required.test.ts` geprüft:
  getrennte Gruppenraum-/Event-Historien, fremde Spieler- und Eventreferenzen, 403-Rollenpfade,
  bekannte Fremd-IDs sowie Datenbank-Trigger und -Foreign-Keys.
- Organisation/Kommunikation liegt in
  `src/test/api.groupOrganisationCommunication.required.test.ts`: Zwei Gruppen, Gruppenraum- und
  Event-Empfänger, Broadcast-/Push-Historien, Infoboard-Rollen, Aggregationen, Event-Export,
  Cross-Tenant-404s und der bewusst ausbleibende Web-Push-Transport werden gemeinsam geprüft.

## Datenbank-Migrationen

Beim Start legt der Server die Tabelle `schema_migrations` an und führt fehlende Migrationen in
aufsteigender Reihenfolge aus. Jede Version wird erst nach erfolgreichem Abschluss ihrer
Transaktion eingetragen und bei späteren Starts übersprungen.

Eine neue Migration wird in `src/db.ts` als nummerierte `runMigration({ version, name, up })`-
Definition ergänzt. Die bestehende Prüfung per `PRAGMA table_info(...)` bleibt innerhalb der
Migration, damit auch ältere Zwischenstände sicher aktualisiert werden können. Für Änderungen an
der Migrationslogik deckt `src/test/db.migrations.test.ts` sowohl Legacy-Datenbanken als auch den
Wiederholungsfall ab.

## Konventionen

- Unit-Testdateien heißen `*.test.ts` und liegen neben dem Code. Für die Frontend-Helfer unter
  `public/js/` entsprechend `*.test.js` direkt daneben.
- Integrationstests liegen unter `src/test/*.test.ts`.
- E2E-Tests liegen unter `src/test/e2e/*.e2e.test.ts` und laufen **nicht** in `npm test` mit (eigenes
  Script `test:e2e`), da sie einen Server + Browser brauchen und entsprechend langsamer sind.
- Die E2E-Dateien laufen parallel (eine pro Prozess) und starten je einen eigenen Server — jede
  Datei braucht deshalb einen **eigenen Test-Port** (aktuell: 3901 `flows`, 3902 `access`,
  3903 `arcade`, 3910 Agent-Integration in `agent/`). Ein doppelt vergebener Port lässt alle Tests
  der betroffenen Datei mit „Server did not become ready“ scheitern.
- Der Produktions-Build (`npm run build`) schließt alle Testdateien aus – sie landen nie in `dist/`.
- `index.ts` startet den Server nur, wenn es direkt ausgeführt wird (`require.main === module`),
  damit Tests die App importieren können, ohne einen Port zu belegen.

## Vor jedem Commit

`npm run build` **und** `npm test` müssen grün sein (siehe Qualitäts-Checkliste in
`../DEVELOPMENT_GUIDELINES.md`).
`npm run test:e2e` sollte laufen, wenn sich am Frontend oder an view-übergreifenden Abläufen etwas
geändert hat.
