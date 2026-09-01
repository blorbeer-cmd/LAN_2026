# Tests

Qualität wird über automatisierte Tests abgesichert. Bewusst schlank gehalten – kein schweres
Framework, sondern der **eingebaute Node-Test-Runner** (`node:test`) plus **supertest** für die API
und **Playwright** für echte Browser-Klickpfade.

## Verbindliche Test-Design-Regeln

Gelten für neue Tests und für Änderungen an bestehenden Tests. Ziel ist maximale Fehlererkennung
bei minimaler Testmenge, geringer Komplexität und hoher Deterministik. Mehr Tests, mehr Assertions
oder höhere Coverage sind für sich genommen kein Qualitätsgewinn.

1. **Niedrigste geeignete Testebene wählen.** Unit für isolierte Logik, Integration für API,
   Datenbank und Realtime, Browser-E2E nur für Verhalten, das tatsächlich einen echten Browser oder
   einen vollständigen Benutzerpfad braucht. Verhalten, das ein Unit- oder Integrationstest
   zuverlässig beweist, wird nicht zusätzlich als E2E-Test dupliziert. E2E-Tests sind bewusst teuer
   und brauchen einen eigenen Integrationsnutzen.
2. **Vor einem neuen Test die vorhandene Abdeckung prüfen.** Zuerst nach Tests für dasselbe
   fachliche Verhalten suchen und prüfen, ob ein bestehender Test es sinnvoll mit abdecken kann.
   Eine Produktionscodeänderung allein rechtfertigt keinen neuen Test; ein neuer Test braucht
   zusätzliche Fehlererkennung gegenüber der bestehenden Suite.
3. **Beobachtbares Verhalten prüfen, keine Implementierungsdetails.** Keine internen
   Aufrufreihenfolgen ohne fachliche Bedeutung, keine internen Datenstrukturen ohne
   Vertragscharakter, keine trivialen Framework- oder Sprachfunktionen. Ein Refactoring ohne
   Verhaltensänderung soll möglichst keine Teständerung erzwingen.
4. **Auf Zustände warten, nicht auf Zeit.** `waitForTimeout`, `setTimeout` als Synchronisationshilfe
   und vergleichbare Pauschalwartezeiten sind unzulässig; gewartet wird auf ein konkret
   beobachtbares Ereignis oder einen konkreten Zustand. Zulässig bleibt das Verstreichenlassen einer
   echten, produktiv existierenden Frist, die selbst Prüfgegenstand ist — etwa Countdown-, Reveal-
   und Deadline-Übergänge in den Fast-Timer-Profilen. Solche Stellen benennen im Kommentar die
   Frist, auf die gewartet wird.
5. **Tests sind unabhängig** von Ausführungsreihenfolge, anderen Tests, realer Uhrzeit,
   ungeseedetem Zufall, fremden Ports, externem Netzwerk, Produktionsdaten sowie bereits
   vorhandenem Prozess- oder Browserzustand. Die unten benannte E2E-Ausnahme gilt ausschließlich
   für geteilten Zustand zwischen Geschwistertests desselben Owners; alle anderen Anforderungen
   bleiben bestehen. Ein sporadisch fehlschlagender Test gilt als defekt und wird ursächlich
   behoben, nicht durch größere Timeouts, zusätzliche Retries, schwächere Assertions oder
   Überspringen. Retries bleiben reine Diagnose- und Infrastrukturhilfe (siehe
   „Laufzeitregressionen“) und machen einen roten Lauf nie grün.
6. **Bestehende Tests dürfen vereinfacht, zusammengeführt oder entfernt werden**, wenn sie
   nachweislich dasselbe Verhalten redundant abdecken, ausschließlich Implementierungsdetails
   prüfen, unnötig komplex sind oder durch einen kleineren stabilen Test auf niedrigerer Ebene
   ersetzt werden können. *Relevante* Abdeckung darf dabei nie verloren gehen. Jede Entfernung oder
   Zusammenführung wird im Abschluss kurz begründet und benennt den Test, der die betroffene
   Regression weiterhin erkennt.

Bewusste Ausnahmen:

- Der Parallel-Request-Integrationstest für race-relevante Handler aus Abschnitt 3 der
  Server-Richtlinie [`DEVELOPMENT_GUIDELINES.md`](DEVELOPMENT_GUIDELINES.md) bleibt eine
  schematische Pflicht, weil er Produktziel 1 unmittelbar absichert.
- Die unter „Konventionen“ dokumentierten, absichtlich zustandsbehafteten Cross-View-Owner und der
  Event-Workspace-Switch sind von der Unabhängigkeit zwischen Geschwistertests innerhalb ihres
  Owner-Prozesses ausgenommen. Auf Owner-Ebene bleiben sie isoliert: Jeder Prozess startet mit
  frischem Server, Browser und Datenbestand; nach dem ersten Fehler greift die Cascade Suppression,
  und ein gezielter Retry startet den Owner in einem neuen Prozess.

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
Abhängigkeit) und blendet Testdateien selbst aus dem Report aus. Kein hartes Minimum hinterlegt,
und Coverage ist ein Diagnosewert, keine Erfolgsmetrik. Ein spürbarer Abfall der
Zeilen-/Branch-Abdeckung einer Datei ist ein Anlass zu prüfen, ob ein neu entstandener Pfad eine
relevante Regression ungeschützt lässt; ein zusätzlicher Test folgt daraus nur, wenn genau das der
Fall ist.

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
  alle vier Domänen aus. Die ehemals monolithischen Cross-View-Flows registrieren ihre Tests in vier
  unabhängigen Prozessen für Shell, Wettbewerb, Community und Essensbestellungen. Der eigene
  Food-Order-Owner hält deren umfangreiche, zustandsbehaftete Lebenszyklus-Szenarien aus dem
  Community-Prozess heraus und startet sie mit einem frischen Server, Browser und Datenbestand.
  Arcade enthält die Arcade-, Stream-Renderer-,
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
  Zusätzlich legt jeder gestartete E2E-Testprozess zuerst einen konservativen Owner-Marker an und
  entfernt ihn nur nach Exit-Code 0. Dadurch bleiben auch Fehler in Datei-Hooks und
  Einstiegspunkten ohne Diagnose-Wrapper sowie Signal-, Timeout-, OOM- und SIGKILL-Abbrüche dem
  richtigen Retry zugeordnet. Auf Plattformen, die reguläres `SIGTERM`, `SIGINT` oder `SIGHUP` an
  Node ausliefern, wird der Marker vor der signalgerechten Beendigung noch um die konkrete Ursache
  ergänzt.
  Nach einem roten Browserlauf setzt CI `E2E_RETRY_FAILED_ONLY=1` und wiederholt mit `E2E_TRACE=1`
  ausschließlich die Owner-Dateien aus den Diagnosemetadaten. Mehrere Fehler werden dedupliziert,
  die ursprüngliche Partitionsreihenfolge bleibt erhalten. Fehlende, ungültige oder nicht zur
  gewählten Partition gehörende Metadaten des aktuellen Laufs brechen den Retry bewusst ab; es gibt
  keinen stillen Fallback auf die vollständige Partition. Jeder Nicht-Retry-Lauf erhält ein eigenes
  Unterverzeichnis und aktualisiert je Partition/Core-Auswahl einen kleinen Latest-Zeiger. Der
  anschließende Retry liest ausschließlich dieses Unterverzeichnis; ältere lokale Artefakte,
  beschädigte Metadaten früherer Läufe und parallel gepflegte andere Partitionen beeinflussen die
  Auswahl daher nicht. Dadurch bleibt die gemessene Laufzeit unverfälscht und
  ein reproduzierbarer Fehler erhält zusätzlich Playwright-Traces kurzlebiger Browser-Kontexte.
  Die absichtlich zustandsbehafteten Cross-View-Owner und der Event-Workspace-Switch teilen
  innerhalb ihres Prozesses veränderlichen Server-, Browser- und Seitenzustand. Nach dem ersten
  Testfehler werden ihre verbleibenden Geschwister deshalb sofort als durch den Primärfehler
  blockiert übersprungen, statt mit einem nicht mehr beweisbar sauberen Zustand weitere Timeouts
  zu erzeugen. Der Primärfehler bleibt rot und erhält die normalen Diagnoseartefakte;
  `stateful-summary.json` hält zusätzlich `primaryFailure`, `cascadeSuppressed` und `resetResult`
  maschinenlesbar fest. Der gezielte Owner-Retry startet die Datei in einem frischen Prozess und
  läuft dadurch wieder mit einem unverbrauchten Circuit Breaker.
  Anschließend lädt CI das Diagnoseverzeichnis sieben Tage lang als
  `*-failure-diagnostics`-Artefakt hoch. Lokal landen Fehler standardmäßig im ignorierten
  Verzeichnis `test-results/e2e/runs/<lauf-id>`; mit `E2E_ARTIFACT_DIR=<pfad>` lässt sich dessen
  Wurzelverzeichnis wählen. Derselbe arbeitsverzeichnisunabhängige Default gilt für Produzenten und
  einen lokalen gezielten Retry. `E2E_TRACE=1` aktiviert dort bei Bedarf dieselben Traces wie in CI.
  Erfolgreiche Tests entfernen ihre temporären Trace-Daten und Prozessmarker wieder.
- `npm run test:e2e` setzt `E2E_FAST_TIMERS=1`. Der Schnellmodus verkürzt Arcade- und
  Challenge-Rush-Countdowns nur zusammen mit `NODE_ENV=test`; in Produktion und bei allen anderen
  Aufrufen bleiben die regulären Zeiten aktiv. Challenge Rush verkürzt im E2E-Schnellmodus seine
  wiederholten Lese- und Reveal-Übergänge, behält aber die echte Challenge-Deadline, damit Fokus-
  und Vorschauphasen im Browser nicht vorzeitig abgeschnitten werden.
- Die Socket-Integrationssuite `src/test/api.challengeRush.test.ts` setzt zusätzlich
  `CHALLENGE_RUSH_FAST_TIMERS=1` zusammen mit `NODE_ENV=test`. Dieses Profil verkürzt zusätzlich die
  Challenge-Deadline für protokollnahe Zustandsprüfungen sowie die Merkphase eines Trials
  (`previewMs`), damit der serverseitige Wechsel von `preview` auf `input` innerhalb der
  verkürzten Runde überhaupt stattfinden kann. Im Browserprofil bleibt die Merkphase echt.
  Außerhalb von `NODE_ENV=test` werden beide Flags ignoriert.
- Zielgerichtete Challenge-Rush-Integrationstests wählen über den admin-geschützten
  `challengeKeys`-Pfad genau ihre relevante Challenge. Nur der vollständige Lifecycle-Test spielt
  weiterhin einmal den gesamten, auf 21 Aufgaben reduzierten Challenge-Katalog durch. Die
  Browser-Fixture deckt dabei die drei verbliebenen Interaktionsformen ab: direkte Reaktion,
  Zeitstopp sowie serverseitige Auswahl-/Memory-Matrix-Trials. Challenge Rush besitzt keinen
  Bot-Pfad mehr.
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
verursachen; Optimierung darf niemals relevante Abdeckung entfernen, Assertions lockern oder
Wartezeiten pauschal erhöhen. Das Entfernen nachweislich redundanter Abdeckung nach Regel 6 der
Test-Design-Regeln ist davon ausgenommen und im Pull Request zu begründen.

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
