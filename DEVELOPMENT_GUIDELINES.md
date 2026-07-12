# Gemeinsame Entwicklungsrichtlinien

Diese Datei ist die **verbindliche gemeinsame Quelle** für alle Coding-Agents und Menschen, die an
RespawnHQ arbeiten. `AGENTS.md` und `CLAUDE.md` sind lediglich agent-spezifische Einstiegspunkte und
verweisen hierher. Gemeinsame Regeln werden nicht in mehreren Dateien dupliziert.

## 1. Arbeitsweise mit diesen Richtlinien

- Diese Datei vor Analyse, Planung oder Änderung vollständig lesen.
- Bei Änderungen unter `server/public/` zusätzlich `server/DESIGN_SYSTEM.md` vollständig lesen.
- Bereichsspezifische Dokumentation lesen, wenn sie für den Auftrag relevant ist:
  - Server-Tests: `server/TESTING.md`
  - Windows-Agent und lokales Kontroll-Tool: `agent/README.md`
- Dokumentation und Implementierung müssen gemeinsam aktuell bleiben. Ändert ein Feature ein hier
  beschriebenes Verhalten, wird die passende Dokumentation im selben Arbeitspaket aktualisiert.
- Quellcode und Schema sind für aktuelle Implementierungsdetails maßgeblich. Bei Abweichungen nicht
  blind die Dokumentation nachbauen: Verhalten prüfen, Abweichung benennen und im erlaubten Umfang
  korrigieren.

## 2. Produktziele – in dieser Reihenfolge

1. **Zuverlässigkeit:** Das System läuft die gesamte dreitägige LAN ohne manuellen Neustart. Ein
   fehlerhafter oder verschwundener Client darf Server und andere Clients nicht beeinträchtigen.
2. **Einfache und schnelle Bedienung:** Die wichtigen Aktionen sind auf Handy und Laptop ohne
   Erklärung in wenigen Schritten erreichbar.
3. **Modernes, intuitives Design:** Aufgeräumt, dark-mode-freundlich, responsive und mit klaren,
   zugänglichen Zuständen für „spielt“, „pausiert“ und „offline“.
4. **Schlanke Wartbarkeit:** Keine unnötigen Abstraktionen oder Abhängigkeiten. Lösungen sollen für
   rund 15 Teilnehmende robust und verständlich sein, nicht auf Enterprise-Skalierung optimiert.

Wenn Ziele konkurrieren, gewinnt die weiter oben stehende Priorität. Eine optische Verbesserung
darf beispielsweise keine zusätzliche Fehlerquelle oder kompliziertere Bedienung schaffen.

## 3. Architekturgrenzen

- **Server (`server/`):** Express für REST und statische Dateien, Socket.IO für Realtime-Push und
  `better-sqlite3` als synchrone, dateibasierte Datenbank.
- **Frontend (`server/public/`):** statische Single-Page-App mit Vanilla JavaScript und modernem
  CSS. Kein Frontend-Framework, kein Bundler und kein zusätzlicher Build-Step.
- **Agent (`agent/`):** eigenständiger, als Windows-EXE paketierbarer Node-Prozess. Er kennt nur
  Server-URL, API-Key und die vom Server gelieferte Prozesszuordnung. Die zentrale Zuordnung
  Prozessname → Spiel bleibt auf dem Server.
- **Agent-Kontrolle:** Das lokale Kontroll-Tool bindet ausschließlich an `127.0.0.1:47813` und darf
  nie über das LAN erreichbar werden. Aktivitäts-Tracking bleibt optional und standardmäßig aus.
- **Datenbank:** Produktive DB-Dateien liegen außerhalb des Repositories oder unter dem ignorierten
  Pfad `server/data/*.db`. Tests verwenden ausschließlich isolierte Test- bzw. In-Memory-Datenbanken.
- **Aktuelles Schema:** `server/src/db.ts` ist die Quelle für Tabellen, Spalten und Migrationen.
  Neue Schemaänderungen brauchen eine migrationssichere Behandlung bestehender Installationen.

Architekturwechsel, neue Frameworks oder größere Produktionsabhängigkeiten werden nicht nebenbei
eingeführt. Sie brauchen einen klaren Nutzen, eine Folgenabschätzung und die Zustimmung des Nutzers.

## 4. Zuverlässigkeit, Sicherheit und Fehlerbehandlung

- Alle externen Eingaben an API-, Socket- und lokalen Agent-Endpunkten validieren: Typ, Format,
  Länge, erlaubte Werte und referenzierte Entitäten.
- Fehler als passendes HTTP-Ergebnis im Format `{ "error": "..." }` beantworten. Erwartbare
  Eingabefehler oder Konflikte dürfen keine ungefangenen Exceptions erzeugen.
- Fehler eines Socket-Handlers oder Clients lokal begrenzen. Kein einzelnes Event darf den Prozess
  oder andere Verbindungen beschädigen.
- Agent-Ausfälle sind normal: fehlende Heartbeats führen nach Timeout zu „offline“, nicht zu einem
  Serverfehler. Wiederholte oder verspätete Meldungen müssen sicher verarbeitet werden.
- Keine Secrets, API-Keys, produktiven Datenbanken oder personalisierten Agent-Konfigurationen
  committen. Konfiguration erfolgt über Umgebungsvariablen oder lokale, ignorierte Dateien.
- Bestehende Sicherheitsgrenzen wie Authentifizierung, Admin-Rechte, LAN-/Loopback-Bindung und
  Opt-in-Einstellungen nicht aus Bequemlichkeit aufweichen.
- Nutzerinhalte vor HTML-Ausgabe escapen. Dynamische SQL-Werte werden parametrisiert; Bezeichner
  oder SQL-Fragmente nur aus internen Allow-Lists zusammensetzen.

## 5. API, Realtime und Zeit

- Öffentliche IDs sind kurze, URL-sichere `nanoid`-IDs; keine internen Auto-Increments nach außen
  geben.
- Zeitpunkte werden als UTC-Timestamps in Millisekunden gespeichert und im Frontend lokal
  formatiert.
- REST-Antworten sind JSON. Statuscodes unterscheiden mindestens Erfolg (`2xx`), ungültige Eingabe
  (`400`), fehlende oder unzulässige Authentifizierung (`401`/`403`), nicht gefunden (`404`) und
  Zustandskonflikt (`409`).
- Zustandsänderungen, die für andere offene Clients sichtbar sind, werden nach erfolgreichem Commit
  über Socket.IO gepusht. Das Frontend muss neue Events abonnieren und seinen Zustand ohne Reload
  aktualisieren.
- Realtime-Nachrichten sind ein Aktualisierungssignal, keine zweite widersprüchliche Wahrheit neben
  der Datenbank. Nach Verbindungsabbruch muss der Client seinen Zustand sauber neu laden können.

## 6. Race-Sicherheit und Transaktionen

Auf einer LAN lösen mehrere Personen dieselbe Aktion nahezu gleichzeitig aus. Synchrones
`better-sqlite3` serialisiert Zugriffe, verhindert aber keine logischen Check-dann-Schreiben-Races.

- Jeder Handler mit gemeinsamem veränderlichem Zustand erhält einen atomaren Guard beziehungsweise
  eine passende Transaktion oder Datenbank-Constraint.
- Typische Fälle: eindeutige Namen, genau eine laufende Abstimmung, Event-Tracking-Konflikte,
  Captain-Draft-Picks und einmalig entscheidbare Turnier-Matches.
- Genau ein konkurrierender Request darf gewinnen. Verlierer erhalten einen sauberen `409`; sie
  dürfen weder duplizieren noch fremden Zustand überschreiben.
- Für jeden neuen oder geänderten Race-relevanten Handler kommt ein Integrationstest mit parallelen
  Requests (`Promise.all`) nach `server/src/test/api.concurrency.test.ts` oder in die fachlich
  zuständige Testdatei.
- Mehrschrittige DB-Änderungen, die nur gemeinsam gültig sind, laufen in einer Transaktion. Socket-
  Events werden erst nach erfolgreicher Transaktion ausgesendet.

## 7. Frontend und Design

- Für alle UI-Änderungen gilt `server/DESIGN_SYSTEM.md`; die CSS-Tokens in
  `server/public/css/style.css` sind die visuelle Single Source of Truth.
- Bestehende Basiskomponenten und Helfer wiederverwenden, bevor neue Varianten entstehen.
- UI-Texte sind Deutsch. Code, Kommentare, Testnamen und Commit-Messages sind Englisch.
- Neue oder geänderte UI-Symbole kommen ausschließlich aus dem lokalen Lucide-Style-Helper
  `server/public/js/icons.js`. Keine Emoji oder Unicode-Piktogramme für UI-Chrome; freie
  Nutzerinhalte dürfen sie enthalten.
- Bedienpfade für Kernaktionen kurz halten. Mobile Nutzung ist kein nachträglicher Sonderfall,
  sondern wird zusammen mit Desktop gestaltet und getestet.
- Zustände dürfen nicht allein durch Farbe vermittelt werden. Tastaturbedienung, sichtbarer Fokus,
  verständliche Beschriftungen und `prefers-reduced-motion` gehören zur Definition von „fertig“.

## 8. Tests und Verifikation

Tests laufen mit dem eingebauten `node:test`-Runner, Supertest und Playwright. Details stehen in
`server/TESTING.md`.

Die Pipeline in `.github/workflows/deploy.yml` führt die verbindlichen Prüfungen bei Pull Requests,
Änderungen an `main` und manuellen Ausführungen aus. Ein fehlgeschlagener Pflichtcheck wird nicht
ignoriert oder durch erneutes Ausführen ohne Ursachenklärung umgangen. Lokale Prüfung und CI
ergänzen einander; keine von beiden ersetzt die andere.

| Änderung | Mindestens ausführen |
|---|---|
| Nur Dokumentation | Links, Pfade und genannte Scripts manuell prüfen |
| Server, DB, API oder gemeinsame Logik | `npm run build` und `npm test` in `server/` |
| Frontend-CSS oder Frontend-JS | zusätzlich `npm run check:tokens` und `npm run test:e2e` |
| Agent | passende Scripts aus `agent/package.json`; Server-Vertragstests, falls Protokoll betroffen |
| Race-relevanter Zustand | zusätzlicher Parallel-Request-Integrationstest |

- Neue Logik erhält Tests für Happy Path, relevante Validierungsfehler und Zustandskonflikte.
- Ein Test darf keine produktive DB, keinen fremden Port und keine echte Nutzerkonfiguration nutzen.
- Tests nicht löschen, lockern oder mit pauschalen Timeouts kaschieren, nur um einen Lauf grün zu
  bekommen. Flaky Tests werden ursächlich stabilisiert.
- Wenn eine erforderliche Prüfung nicht ausgeführt werden kann, im Abschluss konkret nennen: welche
  Prüfung, warum und welches Restrisiko bleibt.

## 9. Arbeitsbaum, Scope und Git

- Vor Änderungen `git status --short` prüfen. Vorhandene Änderungen als Nutzereigentum behandeln.
- Nur Dateien ändern, die zum Auftrag gehören. Keine beiläufigen Großformatierungen oder
  Refactorings, die den Review erschweren.
- Keine fremden Änderungen zurücksetzen, überschreiben, verstecken oder in den eigenen Commit
  aufnehmen. Destruktive Git-Befehle sind ohne ausdrücklichen Auftrag tabu.
- Auf dem aktuell vom Nutzer gewählten Branch arbeiten. Keine fest codierten Agent-Branches;
  Branchwechsel oder neue Branches nur auf ausdrücklichen Wunsch.
- Commits klein, in sich geschlossen und imperativ auf Englisch benennen. Commit und Push erfolgen
  nur, wenn der Nutzer oder der aktuelle Auftrag dies verlangt; dabei den Scope vorher prüfen.
- Abhängigkeiten und Lockfiles nur ändern, wenn sie für den Auftrag notwendig sind. Neue Pakete
  begründen und auf Wartungs-, Sicherheits- und Offline-Auswirkungen prüfen.

## 10. Definition of Done

Eine Änderung ist erst fertig, wenn:

- das gewünschte Verhalten vollständig umgesetzt und ohne Erklärung auffindbar ist,
- Eingaben, Fehlerpfade und gegebenenfalls konkurrierende Requests abgesichert sind,
- relevante Realtime-Verbraucher aktualisiert wurden,
- erforderliche Unit-, Integrations- und E2E-Tests ergänzt und erfolgreich ausgeführt wurden,
- Build und Design-Token-Check entsprechend der Matrix grün sind,
- Dokumentation und tatsächliches Verhalten übereinstimmen,
- keine Secrets, produktiven Daten oder sachfremden Änderungen enthalten sind,
- der Abschluss geänderte Bereiche, ausgeführte Prüfungen und verbleibende Einschränkungen nennt.
