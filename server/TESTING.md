# Tests

Qualität wird über automatisierte Tests abgesichert. Bewusst schlank gehalten – kein schweres
Framework, sondern der **eingebaute Node-Test-Runner** (`node:test`) plus **supertest** für die API
und **Playwright** für echte Browser-Klickpfade.

## Test-Arten

| Art               | Womit                                                   | Was                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Unit**          | `node:test` + `assert`                                  | Reine Logik ohne I/O: Zugangs-Guard, Live-Status-Ableitung, Matchmaking-Balancing, Leaderboard-Scoring (`src/*.test.ts`). Ebenso die DOM-freien Frontend-Helfer (Formatierung, Avatar-Palette, Prozessnamen-Vorschläge, State-Lookups, `dateTimeFieldHtml`) direkt unter `public/js/*.test.js` — läuft ohne Build-Step als ESM (`public/package.json` setzt `"type": "module"` nur für den Node-Testlauf, ohne Auswirkung auf die im Browser statisch ausgelieferten Dateien). |
| **Integration**   | `node:test` + `supertest`                               | Echte HTTP-Requests gegen die Express-App (`src/test/*.test.ts`), gegen eine **In-Memory-DB**.                                                                                                                                                                                                                                                                                                                                                                                 |
| **E2E (Browser)** | `node:test` + Playwright (`src/test/e2e/*.e2e.test.ts`) | Startet den echten gebauten Server + einen echten Chromium und klickt durch die Web-UI: Spieler anlegen, Teams auslosen, abstimmen, Ergebnis eintragen, Zugangs-Token-Login und Event-Einladungen mit zwei offenen Clients.                                                                                                                                                                                                                                                    |

## Ausführen

```bash
cd server
npm test              # schnell: Unit + Integration (In-Memory-DB, kein Server/Browser nötig)
npm run test:coverage # wie npm test, zusätzlich mit Zeilen-/Branch-/Funktions-Coverage-Report
npm run test:e2e      # langsamer: startet Server-Prozess(e) + Chromium, klickt durch die UI
npm run test:e2e:core   # nur allgemeine Browserpfade
npm run test:e2e:run:core -- auth # nach vorbereitetem Build nur Auth-Fixtures; ebenso checklist, invitations, flows
npm run test:e2e:arcade # nur Arcade-, Spiel- und Arcade-Cross-View-Pfade
npm run test:e2e:arcade-smoke # kurzer Arcade-Vertragstest für Shared-Änderungen
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
- E2E startet den gebauten Server (`dist/index.js`) als eigenen Kindprozess auf einem vom
  Betriebssystem vergebenen freien Test-Port,
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
  samt Event-Allowlist, teilnahmegebundener Eventzugriff ohne Admin-/Owner-Lesebypass, Produzenten eventgebundener
  Payloads, empfängergebundene Pushes, immutable Arcade-Lobby-/Match-Scopes samt
  Watch-/Replay-Pfaden, Mitgliedschaftsentzug und Gruppenwechsel bei offenem Socket, ungescopte
  Fach-Broadcasts sowie das globale Instanz-Signal. Ein Teil dieser Suite legt ihre Testgruppen
  direkt per SQL an (nicht über die API) und bleibt damit unabhängig vom Ein-Gruppen-Rückschnitt
  eine gültige Regression für den weiterhin bestehenden `groups`/`group_memberships`-Mechanismus
  („Stilllegen statt Rückbau“, siehe `docs/plans/reset-single-group.md` Abschnitt 2). Der
  Offline-Sweep über mehrere Gruppen wird mit konkreten Empfänger- und Negativassertions in
  `src/liveStatus.sweepOnce.test.ts` abgedeckt.
- Event-Einladungen werden in `src/test/api.eventInvitations.required.test.ts` als vollständige
  Status-/Rollenmatrix einschließlich parallelem Accept-vs-Decline geprüft. Der echte Zwei-Client-
  Browserpfad (Admin lädt ein, Mitglied nimmt per Tastatur an, beide Ansichten aktualisieren sich per
  Realtime) liegt in `src/test/e2e/eventInvitations.e2e.test.ts`.

## Datenbank-Migrationen

Beim Start legt der Server die Tabelle `schema_migrations` an und führt fehlende Migrationen in
aufsteigender Reihenfolge aus. Jede Version wird erst nach erfolgreichem Abschluss ihrer
Transaktion eingetragen und bei späteren Starts übersprungen.

Eine neue Migration wird in `src/db.ts` als nummerierte `registerMigration({ version, name, up })`-
Definition ergänzt; alle registrierten Migrationen werden anschließend gesammelt und nach `version`
sortiert ausgeführt, unabhängig von ihrer Registrierungsreihenfolge. Die bestehende Prüfung per
`PRAGMA table_info(...)` bleibt innerhalb der Migration, damit auch ältere Zwischenstände sicher
aktualisiert werden können. Für Änderungen an
der Migrationslogik deckt `src/test/db.migrations.test.ts` sowohl Legacy-Datenbanken als auch den
Wiederholungsfall ab.

## Konventionen

- Unit-Testdateien heißen `*.test.ts` und liegen neben dem Code. Für die Frontend-Helfer unter
  `public/js/` entsprechend `*.test.js` direkt daneben.
- Integrationstests liegen unter `src/test/*.test.ts`.
- E2E-Tests liegen unter `src/test/e2e/*.e2e.test.ts` und laufen **nicht** in `npm test` mit (eigenes
  Script `test:e2e`), da sie einen Server + Browser brauchen und entsprechend langsamer sind.
- `../scripts/e2e-partitions.mjs` ist die einzige maschinenlesbare Zuordnung von E2E-Dateien zu
  `core`, `arcade` und dem Arcade-Smoke-Subset. Runner und Pfadklassifizierer importieren dasselbe
  Manifest. Eine neue, gelöschte oder doppelt zugeordnete Datei lässt den Lauf mit einer
  namentlichen Fehlermeldung bewusst fehlschlagen. `test:e2e` führt beide Hauptpartitionen aus;
  CI kann `core` und `arcade` unabhängig starten.
- Core enthält die gezielt auswählbaren Domänen `auth`, `checklist`, `invitations` und `flows`.
  Gemeinsame oder unbekannte Änderungen verwenden `all`; manuelle und tägliche Läufe führen immer
  alle vier Domänen aus. Die ehemals monolithischen Cross-View-Flows registrieren ihre Tests in drei
  unabhängigen, laufzeitbalancierten Prozessen für Shell, Wettbewerb und Community. Arcade enthält
  die Arcade-, Stream-Renderer-,
  Battleship- und Challenge-Rush-Suiten sowie den eigenständig authentifizierten Arcade-Auth-Pfad
  und die Arcade-Partition der Cross-View-Flows. Der vollständige Challenge-Rush-Lifecycle, die
  Snake-Arena-Legenden sowie Navigation, Multiplayer-Layouts und Scribble laufen in getrennten
  Fixtures. `arcade-smoke` führt ausschließlich den dedizierten Lobby/Home-Grundfluss und den
  isolierten Auth-Pfad aus; beide Dateien bleiben regulärer Bestandteil der vollständigen
  Arcade-Partition.
- Die E2E-Dateien laufen parallel (eine pro Prozess) und starten je einen eigenen Server. Der
  Runner begrenzt die Dateiparallelität auf sechs, damit zusätzliche Shards nicht unbegrenzt viele
  Chromium-Prozesse starten. Die längsten Arcade-Fixtures stehen zuerst in der Partition. Der
  gemeinsame Helfer `src/test/e2e/e2eServer.ts` startet ihn mit `PORT=0`, liest den tatsächlich
  gebundenen Port aus der Startmeldung und liefert die passende Basis-URL. Dadurch kollidieren
  parallele Läufe und andere Worktrees nicht mehr auf statisch reservierten Ports. Das gilt auch
  für zusätzliche Server innerhalb einer Testdatei, etwa den Forfait-Reconnect-Test. Der
  Agent-Server-Integrationstest unter `agent/` verwendet denselben `PORT=0`-Ablauf.
- Die Browser-Fixtures sammeln bei einem Fehlschlag Browser-Konsole, Page- und Request-Fehler,
  den letzten Server-Output und Metadaten sowie Screenshots und DOM-Snapshots noch offener Seiten.
  Nach einem roten Browserlauf wiederholt CI dieselbe Partition einmal
  mit `E2E_TRACE=1`; dadurch bleibt die gemessene Laufzeit unverfälscht und ein reproduzierbarer
  Fehler erhält zusätzlich Playwright-Traces kurzlebiger Browser-Kontexte. Anschließend lädt CI
  das Diagnoseverzeichnis sieben Tage lang als `*-failure-diagnostics`-Artefakt hoch. Lokal landen
  Fehler standardmäßig im ignorierten Verzeichnis `test-results/e2e`; mit
  `E2E_ARTIFACT_DIR=<pfad>` lässt sich ein anderer Zielordner wählen. `E2E_TRACE=1` aktiviert dort
  bei Bedarf dieselben Traces wie in CI. Erfolgreiche Tests entfernen ihre temporären Trace-Daten
  wieder.
- `npm run test:e2e` setzt `E2E_FAST_TIMERS=1`. Der Schnellmodus verkürzt Arcade- und
  Challenge-Rush-Countdowns nur zusammen mit `NODE_ENV=test`; in Produktion und bei allen anderen
  Aufrufen bleiben die regulären Zeiten aktiv. Challenge Rush verkürzt im E2E-Schnellmodus seine
  wiederholten Lese- und Reveal-Übergänge, behält aber die echte Challenge-Deadline, damit Fokus-
  und Vorschauphasen im Browser nicht vorzeitig abgeschnitten werden.
- Die Socket-Integrationssuite `src/test/api.challengeRush.test.ts` setzt zusätzlich
  `CHALLENGE_RUSH_FAST_TIMERS=1` zusammen mit `NODE_ENV=test`. Dieses Profil verkürzt zusätzlich die
  Challenge-Deadline für protokollnahe Zustandsprüfungen. Außerhalb von `NODE_ENV=test` werden
  beide Flags ignoriert.
- Zielgerichtete Challenge-Rush-Integrationstests wählen über den admin-geschützten
  `challengeKeys`-Pfad genau ihre relevante Challenge. Nur der vollständige Lifecycle-Test spielt
  weiterhin einmal den gesamten 40-Challenge-Katalog durch.
- Der Produktions-Build (`npm run build`) schließt alle Testdateien aus – sie landen nie in `dist/`.
- `index.ts` startet den Server nur, wenn es direkt ausgeführt wird (`require.main === module`),
  damit Tests die App importieren können, ohne einen Port zu belegen.

## Laufzeitregressionen

CI misst nur die benannten Testschritte; Checkout, Abhängigkeitsinstallation, TypeScript-Build und
Chromium-Setup gehören nicht in den Vergleich. `.github/test-performance.json` definiert die vier
Suites `unit-integration`, `e2e-core`, `e2e-arcade-smoke` und `e2e-arcade`, die Schwelle von mehr als
20 Prozent plus mindestens 30 Sekunden sowie fünf erfolgreiche `main`-Läufe als rollende
Median-Basis.

Partielle Core-Läufe tragen ihren Scope im Schrittnamen, zum Beispiel
`Run measured Core E2E (auth,checklist)`. Nur `Run measured Core E2E (all)` wird mit der
Vollsuite-Baseline verglichen und kann einen Bestätigungslauf auslösen; dadurch werden kurze
Teilmengen nie fälschlich gegen vollständige Core-Läufe bewertet.

Ein erster Ausschlag ist nur ein Verdacht, weil GitHub-Runner schwanken. `Detect test performance`
startet dann für genau die auffällige Suite `Confirm test performance (<suite>)` auf einem frischen
Runner. Der stabile Aggregationsjob `Test performance` wertet Detektor und alle erforderlichen
Wiederholungen fail closed aus: kein Verdacht oder eine unauffällige Wiederholung wird grün, ein
bestätigter Rückschritt oder ein technischer Fehler wird rot. Nur dieser stabile Name gehört in den
Branch-Schutz. Seine Zusammenfassung nennt Suite, Median-Basis, aktuelle Dauer, Abweichung und
Ergebnis. Bei Rot sind die langsamsten Testdateien beziehungsweise Testfälle und die verursachende
Änderung zu untersuchen. Zusätzliche sinnvolle Abdeckung darf eine begründete Laufzeiterhöhung
verursachen; Optimierung darf niemals Abdeckung entfernen, Assertions lockern oder Wartezeiten
pauschal erhöhen.

Die Pfadklassifikation liegt testbar in `scripts/ci-path-classifier.mjs`. Reine Arcade-Änderungen
starten nur Arcade-E2E. Gekapselte Auth-, Checklisten- und allgemeine Flow-Pfade wählen nur ihre
Core-Domäne; direkte Änderungen am Einladungs-Browsertest wählen `invitations`. Mehrdeutige
Event-/Einladungspfade, gemischte Domänen und Shared-Dateien bleiben fail-closed bei `all`.
Allgemeines Socket-Scope,
Authentifizierung und Broadcasts liegen in `src/realtime.ts`; Arcade-Watcher, Kiosk-Replay und
Game-Streaming sind in `src/arcade/realtime.ts` gekapselt. Deshalb startet eine Änderung am
allgemeinen Realtime-Transport nur Core-E2E, eine Änderung am Arcade-Modul nur Arcade-E2E. Die
vollständigen Unit-/Integrationstests prüfen beide Module in jedem Server-Lauf. Tatsächlich
gemeinsame Dateien wie `src/db.ts`, `public/js/app.js`, CSS und unbekannte neue
Produktionsmodule starten Core-E2E plus den kurzen Arcade-Smoke-Test, nicht den vollständigen
Arcade-Lauf. Der stabile Präfix `public/js/arcade/` klassifiziert neue Arcade-Browsermodule ohne
Dateinamenliste. Direkte Arcade-Änderungen starten die vollständige Arcade-Partition; ein täglicher
geplanter Volltest hält alle Partitionen und ihre Laufzeitbaselines aktuell.

## Vor jedem Commit

`npm run build` **und** `npm test` müssen grün sein (siehe Qualitäts-Checkliste in
`../DEVELOPMENT_GUIDELINES.md`).
`npm run test:e2e` sollte laufen, wenn sich am Frontend oder an view-übergreifenden Abläufen etwas
geändert hat.
