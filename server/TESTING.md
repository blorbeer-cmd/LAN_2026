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
- Eine Instanz bedient genau eine Gruppe (`docs/plans/reset-single-group.md`); Events sind die
  einzige verbleibende Scoping-Dimension. Die required-mode-Suiten unter `src/test/api.group*.
  required.test.ts` prüfen deshalb Rollen (`403` für unzureichende Rechte, sofortige Rollenwirkung),
  unbekannte Ressourcen-IDs (`404`), Datenbank-Trigger/Foreign-Keys sowie — wo die jeweilige Domäne
  event-gebundene Daten hält — die Isolation zwischen zwei nacheinander getrackten Events derselben
  Gruppe:
  `api.groupAuthorization.required.test.ts` (Rollen, Last-Owner-Schutz, Entfernungsschutz der
  Startgruppe, Gruppen- vs. Instanz-Audit), `api.groupVotesDrafts.required.test.ts`,
  `api.groupOrganisationCommunication.required.test.ts`, `api.groupCompetition.required.test.ts`,
  `api.groupSeatingPings.required.test.ts`, `api.groupArcadeData.required.test.ts`,
  `api.groupCatalogPresence.required.test.ts` und `api.groupChecklist.required.test.ts`.
- Die Phase-5e-Socket-Isolation läuft in `src/test/e2e/phase5eIsolation.e2e.test.ts`: eine
  authentifizierte Verbindung abonniert die eine reale Gruppe, eine zweite versucht eine unbekannte
  Gruppen-ID zu abonnieren (wird abgelehnt) und erhält entsprechend keine Signale (default-deny).
  Kiosk-Token-Hashing, Scope und Widerruf werden zusätzlich in `src/test/kioskTokens.test.ts` geprüft.
- Die Zustellmatrix des gescopten Broadcast-Modells liegt in
  `src/test/realtime.delivery.required.test.ts`: default-deny für unabonnierte Sockets, Kiosk-Token
  samt Event-Allowlist, Eventzugriff für Teilnehmer/Admins/Owner, Produzenten eventgebundener
  Payloads, empfängergebundene Legacy-Pushes, immutable Arcade-Lobby-/Match-Scopes samt
  Watch-/Replay-Pfaden, Mitgliedschaftsentzug und Gruppenwechsel bei offenem Socket, ungescopte
  Fach-Broadcasts sowie das globale Instanz-Signal. Ein Teil dieser Suite legt ihre Testgruppen
  direkt per SQL an (nicht über die API) und bleibt damit unabhängig vom Ein-Gruppen-Rückschnitt
  eine gültige Regression für den weiterhin bestehenden `groups`/`group_memberships`-Mechanismus
  („Stilllegen statt Rückbau“, siehe `docs/plans/reset-single-group.md` Abschnitt 2). Der
  Offline-Sweep über mehrere Gruppen wird mit konkreten Empfänger- und Negativassertions in
  `src/liveStatus.sweepOnce.test.ts` abgedeckt.

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
