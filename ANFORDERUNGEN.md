# Anforderungen – LAN 2026 Tool

Vollständige Anforderungsliste für das LAN-Party-Tool, geordnet nach **empfohlener Priorität**.
Jede Anforderung hat eine ID (`FR` = funktional, `NFR` = nicht-funktional) zur Nachverfolgung.

## Prioritätsstufen

| Stufe | Bedeutung | Wann umsetzen |
|-------|-----------|---------------|
| **P0** | Muss – ohne das ist das Tool nicht sinnvoll nutzbar (MVP) | Zuerst |
| **P1** | Soll – deutlicher Mehrwert, klar geplant | Nach dem MVP |
| **P2** | Kann – nettes Extra, wenn Zeit bleibt | Später / optional |

Die Reihenfolge der Blöcke unten entspricht der empfohlenen **Umsetzungsreihenfolge**.

---

## P0 – Fundament & MVP

Ohne diese Punkte funktioniert nichts anderes. Zuerst bauen.

### Datenbasis & Server-Grundgerüst

| ID | Anforderung |
|----|-------------|
| FR-01 | Zentraler Server liefert die Web-Oberfläche aus und stellt eine JSON-REST-API bereit. |
| FR-02 | Daten werden dauerhaft in einer dateibasierten DB (SQLite) gespeichert; ein Server-Neustart verliert keine Daten. |
| FR-03 | Realtime-Updates werden per WebSocket (Socket.IO) an alle verbundenen Clients gepusht (kein manuelles Neuladen). |
| FR-04 | Kern-Datenmodell existiert: `players`, `games`, `game_process_names`, `skills`, `live_status`, `votes`, `matches`. |

### Spieler & Spiele verwalten

| ID | Anforderung |
|----|-------------|
| FR-05 | Teilnehmer anlegen, umbenennen und entfernen (Name, Anzeigefarbe). |
| FR-06 | Jeder Spieler erhält einen eindeutigen, privaten API-Key (für den Agent). Key ist in der UI anzeigbar/kopierbar. |
| FR-07 | Spiele anlegen/bearbeiten/entfernen (Name, Icon/Emoji, min./max. Teamgröße). |
| FR-08 | Startdatensatz mit unseren Spielen vorbefüllt (CS2, Rocket League, LoL, Warcraft 3, Golf with your Friends). |

### Live-Status (automatisch)

| ID | Anforderung |
|----|-------------|
| FR-09 | Agent auf jedem Spieler-PC scannt periodisch laufende Prozesse und meldet dem Server das aktuell laufende Spiel. |
| FR-10 | Prozessname→Spiel-Zuordnung ist zentral gepflegt (`game_process_names`), erweiterbar ohne Agent-Update. |
| FR-11 | Server authentifiziert Agent-Meldungen über den API-Key des Spielers; ungültige Keys werden abgewiesen. |
| FR-12 | Server erkennt „offline" automatisch: bleibt eine Agent-Meldung länger als ein Timeout aus, wird der Status auf offline gesetzt. |
| FR-13 | Live-Status-Board zeigt für alle Spieler: welches Spiel, seit wann, Zustand (spielt / pausiert / offline) mit klarer Farbcodierung. |
| FR-14 | Ein Client-Fehler oder abgestürzter Agent darf niemals Server oder andere Clients beeinträchtigen. |

### Skill-Ratings & Matchmaking

| ID | Anforderung |
|----|-------------|
| FR-15 | Pro (Spieler, Spiel) ein Skill-Rating 1–10 pflegen; schnelle Eingabe (Slider/Buttons), sofort gespeichert. |
| FR-16 | Für ein gewähltes Spiel faire Teams auslosen: Eingabe = anwesende/ausgewählte Spieler, Ausgabe = Teams mit möglichst gleicher Skill-Summe. |
| FR-17 | Team-Anzahl/-Größe wählbar bzw. aus min/max des Spiels abgeleitet; Umgang mit ungerader Spielerzahl. |
| FR-18 | Neu-Auslosen möglich (leicht unterschiedliche Ergebnisse), damit nicht immer dieselbe Konstellation entsteht. |

### Abstimmung „nächstes Spiel"

| ID | Anforderung |
|----|-------------|
| FR-19 | Abstimmung starten: Spieler stimmen für das nächste Spiel; Ergebnisse aktualisieren sich live für alle. |
| FR-20 | Anzeige, welches Spiel zuletzt gespielt wurde bzw. wie oft ein Spiel schon dran war (History-Hinweis). |
| FR-21 | Abstimmung zurücksetzen/beenden; Gewinner klar hervorgehoben. |

---

## P1 – Wichtige Erweiterungen

Deutlicher Mehrwert, direkt nach dem MVP.

### Leaderboard & Ergebnisse

| ID | Anforderung |
|----|-------------|
| FR-22 | Match-Ergebnis erfassen: Spiel, beteiligte Teams/Spieler, Gewinner. |
| FR-23 | Punktesystem übers Wochenende (z. B. Punkte je Sieg/Teilnahme), aggregiertes Gesamt-Leaderboard. |
| FR-24 | Leaderboard filterbar pro Spiel und als Gesamtwertung; Gesamtsieger der LAN klar erkennbar. |
| FR-25 | Ergebnisse editierbar/löschbar (Korrektur von Fehleingaben). |

### Komfort Live-Status & Matchmaking

| ID | Anforderung |
|----|-------------|
| FR-26 | Matchmaking kann anwesende Spieler automatisch aus dem Live-Status vorbelegen. |
| FR-27 | „Aktuell im selben Spiel"-Gruppierung im Status-Board (wer zockt gerade zusammen was). |
| FR-28 | Manuelles Status-Override je Spieler (z. B. „Pause/Essen"), falls Agent nicht läuft. |
| FR-29 | Verlauf/Statistik: Spielzeit je Spieler und Spiel über das Wochenende (aus Live-Status abgeleitet). |

### Bedienung & Betrieb

| ID | Anforderung |
|----|-------------|
| FR-30 | Einfacher Admin-/Setup-Bereich (Spieler, Spiele, Prozess-Zuordnungen) getrennt vom „Spielbetrieb". |
| FR-31 | Agent als vorkonfigurierte `.exe` paketierbar; Ersteinrichtung pro PC in unter 2 Minuten. |
| FR-32 | Agent zeigt lokal einen klaren Verbindungsstatus (verbunden / kein Server / falscher Key). |

---

## P2 – Nice-to-have

Wenn Zeit bleibt oder für kommende Jahre.

| ID | Anforderung |
|----|-------------|
| FR-33 | Turnierbaum/Bracket-Generator (Single/Double Elimination) mit automatischer Aktualisierung. |
| FR-34 | Zufalls-Picker: wirft ein Spiel **und** ein Team-Setup aus, wenn keiner sich entscheiden kann. |
| FR-35 | Session-/Zeitplaner: grobe Slots über die 3 Tage, damit nicht mehrere Gruppen konkurrieren. |
| FR-36 | Mehrjahres-Historie: Sieger und Statistiken über verschiedene LAN-Jahre hinweg. |
| FR-37 | Sound-/Push-Hinweis im Browser, wenn eine Abstimmung startet oder ein Match ansteht. |
| FR-38 | Skill-Rating-Vorschlag aus vergangenen Ergebnissen (leichtes Auto-Tuning). |
| FR-39 | Export der Ergebnisse/Statistiken (CSV/JSON) als Andenken. |

---

## Nicht-funktionale Anforderungen (querschnittlich)

Diese gelten durchgängig – sie stehen bewusst hoch, weil sie die Produktziele aus `CLAUDE.md`
absichern.

### Zuverlässigkeit (höchste Priorität)

| ID | Anforderung |
|----|-------------|
| NFR-01 | Der Server läuft 3 Tage stabil durch, ohne Neustart. Keine Memory-Leaks bei Dauerbetrieb. |
| NFR-02 | Jeder API-Handler validiert Eingaben und fängt Fehler ab; keine ungefangenen Exceptions bringen den Prozess zum Absturz. |
| NFR-03 | Fehler oder Ausfall eines Clients/Agents beeinträchtigt niemals Server oder andere Nutzer. |
| NFR-04 | Klare, korrekte HTTP-Statuscodes und `{ "error": "..." }`-Format bei Fehlern. |
| NFR-05 | WebSocket-Verbindungen reconnecten automatisch nach kurzer Trennung (WLAN-Aussetzer). |

### Bedienbarkeit & Geschwindigkeit

| ID | Anforderung |
|----|-------------|
| NFR-06 | Jede Kernaktion ist in wenigen Klicks und ohne Erklärung erreichbar („Handy raus, URL auf, loslegen"). |
| NFR-07 | Funktioniert flüssig auf Handy und Laptop (responsive), Touch-freundliche Bedienelemente. |
| NFR-08 | Keine langen Formulare; sinnvolle Vorbelegungen und Defaults. |
| NFR-09 | Erste sinnvolle Anzeige lädt schnell (< ~1 s im LAN/über Cloud), auch bei ~15 gleichzeitigen Nutzern. |

### Design

| ID | Anforderung |
|----|-------------|
| NFR-10 | Modernes, aufgeräumtes UI; Dark-Mode-freundlich. |
| NFR-11 | Klare Farbcodierung für Status (spielt / pausiert / offline) und Team-/Spielerfarben. |
| NFR-12 | Konsistente Komponenten und Typografie über alle Views hinweg. |

### Sicherheit & Betrieb

| ID | Anforderung |
|----|-------------|
| NFR-13 | Keine Secrets im Code/Repo: Port/Basis-URL über Umgebungsvariablen, Agent-Key in lokaler Config (gitignored). |
| NFR-14 | DB-Datei liegt außerhalb des Repos bzw. ist in `.gitignore`. |
| NFR-15 | Agent-Meldungen sind nur mit gültigem, spielereigenem API-Key möglich. |
| NFR-16 | Da der Server in der Cloud erreichbar ist: einfacher Schutz gegen fremden Zugriff (z. B. gemeinsames Zugangs-Token für die Web-UI). |
| NFR-17 | Schlanke Codebasis ohne Frontend-Build-Step (Vanilla JS + moderne CSS), um bewegliche Teile und Bugs zu minimieren. |

### Konventionen (aus CLAUDE.md)

| ID | Anforderung |
|----|-------------|
| NFR-18 | UI-Texte Deutsch; Code, Kommentare, Commits Englisch. |
| NFR-19 | Externe IDs kurz & URL-sicher (`nanoid`). |
| NFR-20 | Zeit intern als UTC-Timestamp (ms), im Frontend lokal formatiert. |

---

## Empfohlene Umsetzungsreihenfolge (Zusammenfassung)

1. **Server-Grundgerüst + Datenmodell** (FR-01–04, NFR-01–05, NFR-13/14)
2. **Spieler & Spiele + Skills** (FR-05–08, FR-15)
3. **Live-Status inkl. Agent** (FR-09–14) – das Kern-Alleinstellungsmerkmal
4. **Matchmaking** (FR-16–18)
5. **Abstimmung** (FR-19–21)
6. **Leaderboard** (FR-22–25)
7. **Komfort & Betrieb** (FR-26–32)
8. **Nice-to-have** (FR-33–39) nach Bedarf

Design- und Zuverlässigkeits-Anforderungen (NFR) laufen als Querschnitt durch **jede** Stufe mit.
