# Server-Richtlinien

Diese Regeln gelten für Änderungen unter `server/` zusätzlich zu den gemeinsamen Richtlinien im
Repository-Root. Für Frontenddateien unter `public/` gilt außerdem `DESIGN_SYSTEM.md`.

## 1. Architektur

- Express liefert REST und statische Dateien aus, Socket.IO übernimmt Realtime-Push und
  `better-sqlite3` ist die synchrone, dateibasierte Datenbank.
- Das Frontend bleibt eine statische Single-Page-App mit Vanilla JavaScript und modernem CSS: kein
  Frontend-Framework, kein Bundler und kein zusätzlicher Build-Schritt.
- Der Server hält die zentrale Zuordnung Prozessname → Spiel. Der Agent erhält diese Zuordnung nur
  vom Server.
- Produktive DB-Dateien liegen außerhalb des Repositories oder unter dem ignorierten Pfad
  `data/*.db`. Tests verwenden ausschließlich isolierte In-Memory- oder Testdatenbanken.
- `src/db.ts` ist die Quelle für das aktuelle Schema und die Migrationen.

## 2. HTTP, Realtime und Zeit

- Fehler als passendes HTTP-Ergebnis im Format `{ "error": "..." }` beantworten.
- Statuscodes unterscheiden mindestens Erfolg (`2xx`), ungültige Eingabe (`400`), fehlende oder
  unzulässige Authentifizierung (`401`/`403`), nicht gefunden (`404`) und Zustandskonflikt (`409`).
- Öffentliche IDs sind kurze, URL-sichere `nanoid`-IDs; interne Auto-Increments nicht ausgeben.
- Zeitpunkte als UTC-Timestamps in Millisekunden speichern und im Frontend lokal formatieren.
- REST-Antworten sind JSON.
- Für andere Clients sichtbare Zustandsänderungen erst nach erfolgreichem Commit über Socket.IO
  senden. Das Frontend abonniert neue Events und aktualisiert sich ohne Reload.
- Realtime-Nachrichten sind Aktualisierungssignale, keine zweite Wahrheit neben der Datenbank. Nach
  Verbindungsabbruch muss ein Client seinen Zustand sauber neu laden können.
- Fehler eines Socket-Handlers oder Clients lokal begrenzen; kein einzelnes Event darf Prozess oder
  andere Verbindungen beschädigen.
- Agent-Ausfälle sind normal: fehlende Heartbeats führen nach Timeout zu „offline“. Wiederholte oder
  verspätete Meldungen sicher und idempotent verarbeiten.

## 3. Datenbank, Migrationen und konkurrierende Zugriffe

Synchrones `better-sqlite3` serialisiert Zugriffe, verhindert aber keine logischen
Check-dann-Schreiben-Races.

- Handler mit gemeinsamem veränderlichem Zustand erhalten einen atomaren Guard, eine Transaktion
  oder eine passende Datenbank-Constraint.
- Typische Fälle sind eindeutige Namen, genau eine laufende Abstimmung, Event-Tracking-Konflikte,
  Captain-Draft-Picks und einmalig entscheidbare Turnier-Matches.
- Genau ein konkurrierender Request darf gewinnen. Verlierer erhalten `409` und dürfen weder
  duplizieren noch fremden Zustand überschreiben.
- Mehrschrittige, nur gemeinsam gültige DB-Änderungen laufen in einer Transaktion. Socket-Events
  werden erst nach erfolgreicher Transaktion ausgesendet.
- Für jeden geänderten Race-relevanten Handler einen Integrationstest mit parallelen Requests
  (`Promise.all`) ergänzen.
- Schemaänderungen migrationssicher für bestehende Installationen umsetzen. Produktive DBs niemals
  neu aufbauen oder zurücksetzen, um Migrationen zu vereinfachen.
- Migrationen bleiben nummeriert, idempotent und in historischer Reihenfolge. Änderungen erhalten
  Legacy-Fixtures sowie Wiederholungs- und Rollback-bei-Fehler-Tests. Details stehen in
  `TESTING.md`; historische Planung bei Bedarf in `../docs/plans/issue-29-db-migrations.md`.

## 4. Frontend-Grundsätze

Für jede Änderung unter `public/` zuerst `DESIGN_SYSTEM.md` vollständig lesen.

- CSS-Tokens in `public/css/style.css` sind die visuelle Single Source of Truth.
- Vorhandene Basiskomponenten und Helfer wiederverwenden.
- UI-Texte sind Deutsch; Code, Kommentare, Testnamen und Commit-Messages Englisch.
- Neue oder geänderte UI-Symbole ausschließlich über `public/js/icons.js`; keine Emoji oder
  Unicode-Piktogramme für UI-Chrome.
- Kernaktionen auf Mobilgeräten und Desktop kurz und verständlich halten.
- Zustände nicht allein durch Farbe vermitteln. Tastaturbedienung, sichtbarer Fokus,
  verständliche Beschriftungen und `prefers-reduced-motion` gehören zu „fertig“.

## 5. Tests und Verifikation

Testaufbau, Ports und Konventionen stehen in `TESTING.md`. Die Pipeline in
`.github/workflows/deploy.yml` enthält die verbindlichen CI-Prüfungen. Fehlgeschlagene Pflichtchecks
nicht ignorieren oder ohne Ursachenklärung lediglich erneut starten. Lokale Prüfung und CI ergänzen
einander; keine von beiden ersetzt die andere.

| Änderung | Mindestens ausführen (aus `server/`) |
|---|---|
| Nur Dokumentation | Links, Pfade und genannte Scripts manuell prüfen |
| Server, DB, API oder gemeinsame Logik | `npm run lint`, `npm run build`, `npm test` |
| Frontend-CSS oder Frontend-JS | zusätzlich `npm run check:tokens`, `npm run test:e2e` |
| Tooling-/Format-Konfiguration | zusätzlich `npm run format:check` |
| Race-relevanter Zustand | zusätzlicher Parallel-Request-Integrationstest |

Ein manueller Workflow-Lauf führt standardmäßig nur Prüfungen aus. Veröffentlichung und produktives
Deployment brauchen bei manueller Ausführung ausdrücklich `deploy=true`; Pushes auf `main` behalten
den bestehenden automatischen Build-und-Deploy-Ablauf.

## 6. Betrieb

- Änderungen an Deployment, Logging, Backups oder Prozessbetrieb aktualisieren `OPERATIONS.md`.
- Log-Rotation liegt beim Container-/Prozessmanager und bleibt vom SQLite-Backup getrennt.
