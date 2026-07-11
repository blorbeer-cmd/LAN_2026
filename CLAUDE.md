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
  (Prozessname → Spiel). Meldet Start/Stop, sonst nichts (die Zuordnung Prozessname → Spiel bleibt
  zentral auf dem Server, der Agent muss dafür nie angefasst werden). Als `.exe` paketierbar
  (`pkg`), personalisiert als ZIP direkt aus dem Web-Tool herunterladbar (Server-URL + eigener
  API-Key sind schon eingetragen, `install.bat`/`uninstall.bat` liegen bei). Optional (Opt-in, aus
  im Standard): Aktivitäts-Tracking (aktives Fenster + Leerlaufzeit) für „davon aktiv gespielt".
  Bringt ein **lokales Kontroll-Tool** mit: Tray-Icon unter Windows plus eine kleine Web-Oberfläche
  auf `http://127.0.0.1:47813` (nur lokal erreichbar, nie über LAN) zum Pausieren/Fortsetzen,
  Umschalten von Aktivitäts-Tracking und Windows-Autostart, sowie komplettem Deinstallieren – ohne
  den Agent neu herunterzuladen oder Dateien von Hand anzufassen. Details: `agent/README.md`.

## Datenmodell (Kern)

Gruppiert nach Feature-Bereich (vollständiges Schema in `server/src/db.ts`):

- **Spieler & Events:** `players` (id, name, optionaler richtiger Name, api_key, farbe, avatar,
  tracking_paused – der richtige Name wird, wo gesetzt, klein neben dem Gamer-Namen im Sitzplan
  angezeigt),
  `events` (mehrere LAN-Termine parallel möglich, aber nur eines gleichzeitig „trackt"),
  `event_participants`.
- **Spiele:** `games` (name, icon/eigenes Bild, min/max Teamgröße), `game_process_names`
  (Prozessname → Spiel, für den Agent-Scan).
- **Skills, Bock & Sitzplan:** `skills` (Rating pro Spieler+Spiel, 1–10), `preferences`
  („Bock"-Rating pro Spieler+Spiel, 1–10 – wie sehr will ich das *gerade* spielen),
  `seat_neighbors` (selbst deklarierte Sitznachbarn, Basis für „Sitzplan" und die
  Matchmaking-Option „Sitznachbarn nicht gegeneinander").
- **Live-Status:** `live_status` (Zustand je Spieler: spielt/pausiert/offline, seit wann),
  `live_status_games` (mehrere gleichzeitig laufende Spiele pro Spieler), `play_sessions`
  (abgeschlossene Sessions, Basis für Spielzeit-Auswertungen/Awards). Angezeigt auf der
  „Home"-Ansicht (Landing Page), die zusätzlich die Kiosk-Inhalte bündelt
  (Abstimmung/Turnier/Bestellung/Arcade-Lobby/Rangliste, samt persönlicher Skill-Bewertungs-
  Nudge) und ganz unten den Mitteilungs-Verlauf zeigt. Die jeweils neueste Mitteilung für den
  aktuellen Nutzer ist zusätzlich immer oben im App-Header sichtbar, auf jeder Ansicht,
  inklusive Direktlink zum betreffenden Bereich (`notificationBanner.js`).
- **Abstimmung:** `votes`, `vote_rounds` (Historie geschlossener Runden).
- **Matchmaking & Ergebnisse:** `matches` (Ergebnisse fürs Leaderboard), `matchmaking_draws`
  (History der „Teams auslosen"-Ergebnisse).
- **Turniere:** `tournaments` (K.O., Liga/Round-Robin, Gruppenphase+K.O.), `tournament_teams`,
  `tournament_matches` (Bracket-Struktur über `round`/`slot`, siehe `tournament.ts`).
- **Orga & Kommunikation:** `drafts` (Captain-Draft: genau einer aktiv, Snake-Pick-Reihenfolge,
  fertige Teams landen zusätzlich in `matchmaking_draws`), `broadcasts` (Durchsagen an alle),
  `info_entries` (Info-Board: WLAN, Links, Server-IPs), `food_orders` / `food_order_items`
  (Sammelbestellungen: offen → jeder trägt selbst ein → schließen friert ein; der optionale
  Versand-Zeitpunkt bleibt unabhängig davon jederzeit editierbar, auch nach dem Schließen).
- **Sonstiges:** `push_subscriptions` (Web-Push-Opt-in), `push_log` (Verlauf gesendeter
  Push-Nachrichten inkl. Empfängerliste und Deep-Link – füttert Kiosk-Banner und den
  „Mitteilungen"-Feed auf Home), `app_state` (einfache Key/Value-Ablage, z. B. laufende
  Vote-Runde).

## Race-Sicherheit

Auf einer LAN-Party lösen mehrere Leute fast zeitgleich dieselbe Aktion aus (alle tippen auf
„Abstimmung starten", zwei Leute melden dasselbe Turnier-Match). Da `better-sqlite3` synchron ist,
serialisieren sich Requests von selbst – **aber jeder Handler mit einem Check-dann-Schreiben-Muster
braucht trotzdem einen expliziten Guard**, sonst gewinnt einfach der zweite Request und dupliziert
oder überschreibt Daten (siehe `votesRouter`, das `409` liefert statt eine zweite Runde zu öffnen,
oder die Turnier-Ergebniserfassung, die ein bereits entschiedenes Match mit `409` ablehnt statt den
Turnierbaum zu korrumpieren). Neue Handler mit gemeinsamem, veränderlichem Zustand (laufende
Abstimmung, Turnier-Ergebnisse, Event-Tracking-Konflikte, eindeutige Namen) bekommen denselben
Guard **plus** einen Test in `server/src/test/api.concurrency.test.ts` (parallele Requests via
`Promise.all`, erwartetes Ergebnis: genau einer gewinnt, der Rest bekommt einen sauberen 409).

## Konventionen

- **Sprache:** UI-Texte auf Deutsch. Code, Kommentare, Commit-Messages auf Englisch.
- **IDs:** kurze, URL-sichere IDs (`nanoid`) statt Auto-Increment nach außen.
- **Zeit:** immer UTC-Timestamps (ms) speichern, im Frontend lokal formatieren.
- **API-Format:** JSON, `{ "error": "..." }` bei Fehlern, passende HTTP-Statuscodes.
- **Commits:** klein und beschreibend, imperativ (`add matchmaking endpoint`).

## Design-System (Frontend)

- **Single Source of Truth:** Alle Design-Tokens (Farben, Spacing, Typografie,
  Radius, Schatten, Avatar-Größen, Breakpoints) sind als CSS-Custom-Properties
  im `:root`-Block von `server/public/css/style.css` definiert und in
  **[`server/DESIGN_SYSTEM.md`](server/DESIGN_SYSTEM.md)** vollständig
  dokumentiert (Tabellen, Verwendungsbeispiele, Do/Don't). UI-Änderungen
  laufen ausschließlich über diese Tokens bzw. die dort beschriebenen
  Basis-Komponenten (`.btn`, `.card`, `.badge`, `.chip`, `.list-row`, …) –
  keine neuen hartcodierten Hex-Farben, Pixel-Werte oder Font-Größen im Code.
  Fehlt ein Token für einen neuen Fall, wird es zuerst in `style.css`
  ergänzt (mit kurzem Kommentar, wofür), nicht am Verwendungsort neu erfunden.
  Ausnahmen (ein Wert passt bewusst zu keinem Token) werden mit einem
  Kommentar begründet statt stillschweigend hartcodiert – siehe „When a value
  genuinely doesn't fit" in `DESIGN_SYSTEM.md`.
- **UI-Symbole:** Für neue oder geänderte UI-Symbole ausschließlich den lokalen Lucide-Style-Icon-Helper in `server/public/js/icons.js` verwenden (`icon(...)` bzw. passende spezialisierte Helfer). Keine Emoji, Unicode-Piktogramme oder externen Icon-CDNs in UI-Chrome, Überschriften, Buttons, Status-Badges, Chips, Empty States oder Toasts. Das RespawnHQ-Logo ist die einzige bewusste Ausnahme. Bestehende freie Nutzerinhalte (z. B. Spielnamen und Bestelltexte) dürfen Emoji enthalten.

- **Spacing-Skala:** `--space-1` … `--space-8` in `style.css` statt einzelner Pixel-Werte für
  Card-Padding, Row-/Stack-/Grid-Abstände, Section-Titel. Neue Komponenten daraus ableiten, keine
  neuen Magic Numbers einführen.
- **Listen-Zeilen:** Spieler-/Spiele-/Turniere-Liste und der „Mehr"-Hub teilen sich `.list-row`
  (+ `.list-row-icon` / `.list-row-desc`) statt jede ihr eigenes inline-`style` zu bauen – garantiert
  gleiche Höhe/Icon-Größe unabhängig vom Textinhalt. Eine variable Beschreibungslänge darf nie zu
  unterschiedlich hohen Zeilen in derselben Liste führen (Zeilen reservieren ihre Maximalhöhe, z. B.
  per `-webkit-line-clamp` oder `visibility:hidden` auf einer optionalen Zeile).
- **Turnierbaum:** rekursiv verschachtelte Boxen (`buildBracketNode` in `tournament.js`) statt
  flacher Spalten mit `justify-content:space-around` – Flexbox zentriert dadurch jede Box exakt über
  ihren beiden Zubringer-Boxen, unabhängig von deren Höhe. Jede Match-Box hat eine feste Höhe/Breite
  (`--bracket-match-h/-w`), damit Freilos/TBD/entschieden/Punkteeingabe optisch nicht springen.
  Connector-Linien nutzen einen aus der festen Höhe berechneten `--conn-half`-Wert, kein Messen im
  Browser.
- **Bewegung & Barrierefreiheit:** jede Animation/Transition greift global unter
  `@media (prefers-reduced-motion: reduce)`. Hover-Effekte nur unter `@media (hover: hover)`, damit
  Touch-Geräte keinen „hängenden" Hover-Zustand nach dem Tippen zeigen.

## Tests (Qualität absichern)

- **Wo möglich Unit-Tests.** Reine Logik (Matchmaking, Skill-Berechnung, Status-Ableitung,
  Validierung) bekommt direkte Tests mit dem eingebauten `node:test`-Runner.
- **Wo möglich Integration-/E2E-Tests.** API-Endpunkte werden per HTTP getestet (`supertest`),
  Frontend-Klickpfade per Playwright (`server/src/test/e2e/`) – Onboarding, Spieler/Spiele-Verwaltung,
  Matchmaking, Abstimmung, Leaderboard, Turnier (K.O. bis zum Champion durchgespielt),
  Zugangsschutz.
- **Race-Conditions gehören zu den Integrationstests.** Gemeinsamer, veränderlicher Zustand
  (laufende Abstimmung, Turnier-Ergebnisse, Event-Tracking, eindeutige Namen) bekommt einen Test mit
  parallelen Requests (`Promise.all`) in `api.concurrency.test.ts` – siehe „Race-Sicherheit" oben.
- Tests laufen gegen eine In-Memory-DB, nie gegen echte Daten. Details in `server/TESTING.md`.
- Neue Features kommen mit Tests; `npm test` muss grün sein.

## Qualitäts-Checkliste vor jedem Commit

- [ ] Server startet ohne Fehler (`npm run build` läuft durch, keine TS-Fehler).
- [ ] `npm test` ist grün (Unit + Integration), neue Logik ist durch Tests abgedeckt.
- [ ] Eingaben werden validiert, keine ungefangenen Exceptions in Handlern.
- [ ] Neuer Handler mit gemeinsamem Zustand (Start/Stop, Ergebnis-Report, eindeutige Namen)?
  Parallele Requests sauber mit `409` statt Doppel-Effekt – siehe „Race-Sicherheit" oben.
- [ ] Neue Realtime-Events werden auch im Frontend behandelt.
- [ ] `npm run test:e2e` läuft, wenn sich am Frontend oder view-übergreifenden Abläufen etwas
  geändert hat.
- [ ] Bedienung getestet: Feature ist ohne Erklärung auffindbar und in wenigen Klicks nutzbar.
- [ ] Nichts Geheimes (Keys, DB-Dateien) landet im Repo.
- [ ] Neue/geänderte UI nutzt ausschließlich Tokens aus `server/DESIGN_SYSTEM.md` (keine neuen
  hartcodierten Hex-Farben, Pixel- oder Font-Größen-Werte) – echte Ausnahmen sind kommentiert.

## Branch & Workflow

- Entwicklung auf `claude/lan-party-tools-6jqu4g`.
- Commit + Push, wenn eine in sich abgeschlossene Einheit fertig ist.
