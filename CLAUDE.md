# CLAUDE.md – Entwicklungs-Leitlinien

Leitplanken für die Arbeit an diesem Projekt. Ziel ist ein **kleines, robustes, schön bedienbares**
Tool für eine LAN-Party mit ~15 Leuten. Kein Enterprise-Overkill, aber solide Qualität.

## Produktziele (in dieser Reihenfolge)

1. **Zuverlässigkeit** – Es läuft 3 Tage durch, ohne dass jemand den Server neu starten muss.
   Kaum Bugs. Fehler eines Clients dürfen nie den Server oder andere Clients beeinträchtigen.
2. **Einfache & schnelle Bedienung** – Alles ist in wenigen Klicks erreichbar. Keine langen Formulare,
   keine Erklärung nötig. „Handy raus, URL auf, loslegen."
3. **Modernes, intuitives Design** – Aufgeräumt, dark-mode-freundlich, funktioniert auf Handy und
   Laptop. Klare Farben für Status (spielt / pausiert / offline).

## Grundprinzipien

- **Schlank halten.** Keine Frameworks im Frontend (kein React/Build-Step). Vanilla JS + moderne
  CSS. Weniger bewegliche Teile = weniger Bugs auf der LAN.
- **Realtime by default.** Änderungen (Live-Status, Votes, Teams) werden über Socket.IO sofort an
  alle gepusht. Kein manuelles Neuladen.
- **Fehlertolerant.** Jeder API-Handler validiert Eingaben und antwortet mit klaren Statuscodes.
  Der Agent darf jederzeit weg sein/abstürzen – der Server geht davon sauber aus (Status wird nach
  Timeout auf „offline" gesetzt).
- **Keine Secrets im Code.** Server-Port, evtl. Basis-URLs etc. über Umgebungsvariablen. Der
  Agent-API-Key steht in einer lokalen Config-Datei, nicht im Repo.

## Architektur-Regeln

- **Server** (`server/`): Express für REST + statische Files, Socket.IO für Push, `better-sqlite3`
  als synchrone, dateibasierte DB (perfekt für diese Größe – keine DB-Installation nötig).
- **DB-Datei** liegt außerhalb des Repos bzw. ist in `.gitignore` (`server/data/*.db`).
- **Frontend** (`server/public/`): eine Single-Page-App aus statischem HTML/CSS/JS. Views werden
  clientseitig umgeschaltet (Tabs), Daten kommen per `fetch` + Socket.IO.
- **Agent** (`agent/`): eigenständiger Node-Prozess. Kennt nur: Server-URL, API-Key, Spiele-Mapping
  (Prozessname → Spiel). Meldet Start/Stop, sonst nichts. Als `.exe` paketierbar.

## Datenmodell (Kern)

- `players` – Teilnehmer (id, name, api_key, farbe).
- `games` – Spiele (id, name, min/max team size, icon).
- `game_process_names` – Zuordnung Prozessname → Spiel (für den Agent-Scan).
- `skills` – Skill-Rating pro (player, game), 1–10.
- `live_status` – aktueller Zustand pro Spieler (welches Spiel, seit wann, last_seen).
- `votes` – laufende Abstimmung „nächstes Spiel".
- `matches` / `match_results` – gespielte Matches + Ergebnisse fürs Leaderboard.

## Konventionen

- **Sprache:** UI-Texte auf Deutsch. Code, Kommentare, Commit-Messages auf Englisch.
- **IDs:** kurze, URL-sichere IDs (`nanoid`) statt Auto-Increment nach außen.
- **Zeit:** immer UTC-Timestamps (ms) speichern, im Frontend lokal formatieren.
- **API-Format:** JSON, `{ "error": "..." }` bei Fehlern, passende HTTP-Statuscodes.
- **Commits:** klein und beschreibend, imperativ (`add matchmaking endpoint`).

## Qualitäts-Checkliste vor jedem Commit

- [ ] Server startet ohne Fehler (`npm run build` läuft durch, keine TS-Fehler).
- [ ] Eingaben werden validiert, keine ungefangenen Exceptions in Handlern.
- [ ] Neue Realtime-Events werden auch im Frontend behandelt.
- [ ] Bedienung getestet: Feature ist ohne Erklärung auffindbar und in wenigen Klicks nutzbar.
- [ ] Nichts Geheimes (Keys, DB-Dateien) landet im Repo.

## Branch & Workflow

- Entwicklung auf `claude/lan-party-tools-6jqu4g`.
- Commit + Push, wenn eine in sich abgeschlossene Einheit fertig ist.
