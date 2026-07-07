# RespawnHQ – LAN-Party Tool

Ein kleines, selbst gehostetes Web-Tool für unsere jährliche LAN-Party (~15 Leute, 3 Tage).
Alles Wichtige an einem Ort: **Teams auslosen**, **abstimmen was als Nächstes gespielt wird**,
**live sehen wer gerade was zockt** und ein **Wochenend-Leaderboard**.

## Was kann das Tool?

| Feature | Beschreibung |
|---|---|
| 👥 **Spieler & Skills** | Teilnehmer anlegen, pro Spiel ein Skill-Rating (1–10) pflegen. Basis für faire Teams. |
| ⚖️ **Matchmaking** | Für ein Spiel automatisch faire Teams aus den anwesenden Spielern auslosen (skill-basiert). |
| 🗳️ **Abstimmung** | „Was zocken wir als Nächstes?" – live abstimmen. Zeigt an, was zuletzt dran war. |
| 📡 **Live-Status** | Sieht automatisch, wer gerade welche(s) Spiel(e) offen hat (via kleinem Agent auf jedem PC) – auch mehrere gleichzeitig. |
| 🏆 **Leaderboard** | Match-Ergebnisse eintragen, Punkte übers ganze Wochenende, Gesamtsieger der LAN. |
| ⚙️ **Spiele verwalten** | Spiele, Icons, Teamgrößen und Prozessname-Zuordnungen (für die Live-Erkennung) zentral pflegen. |
| 🔒 **Zugangsschutz** | Leichtes, geteiltes Zugangs-Token schützt die Web-Oberfläche, falls der Server im Internet erreichbar ist. |

## Architektur (Kurzfassung)

```
┌──────────────────┐        HTTP / WebSocket        ┌────────────────────────┐
│  Browser (Handy/  │  ◀───────────────────────────▶ │   Server (Cloud)        │
│  Laptop jedes     │                                │   Node.js + Express     │
│  Teilnehmers)     │                                │   SQLite + Socket.IO    │
└──────────────────┘                                └────────────────────────┘
                                                              ▲
                                                              │  meldet laufendes Spiel
                                                              │  (Prozess-Scan)
                                              ┌───────────────┴───────────────┐
                                              │  Agent (kleines Programm auf   │
                                              │  jedem Windows-Spieler-PC)     │
                                              └────────────────────────────────┘
```

- **Server**: läuft in der Cloud, hält alle Daten (SQLite), liefert die Web-Oberfläche aus und
  verteilt Live-Updates über WebSockets.
- **Agent**: winziges Programm, das jeder Teilnehmer einmal auf seinem PC startet. Es scannt die
  laufenden Prozesse (z. B. `cs2.exe`) und meldet dem Server, welches Spiel gerade läuft.
- **Web-UI**: keine Installation, jeder öffnet einfach die URL im Browser.

## Verzeichnisstruktur

```
LAN_2026/
├── server/          # Zentraler Server (Node.js + TypeScript)
│   ├── src/         # Quellcode (API, DB, WebSocket)
│   └── public/      # Web-Oberfläche (HTML/CSS/JS)
├── agent/           # Windows-Client zum Prozess-Scannen
│   └── src/
├── README.md
├── CLAUDE.md        # Entwicklungs-Leitlinien
└── ANFORDERUNGEN.md # Vollständige, priorisierte Anforderungsliste
```

## Schnellstart (lokal / Entwicklung)

```bash
# Server
cd server
npm install
npm run dev          # startet auf http://localhost:3000

# Agent (auf einem Spieler-PC)
cd agent
npm install
# agent.config.json anpassen (Server-URL + eigener API-Key)
npm start
```

Danach im Browser `http://localhost:3000` öffnen.

## Deployment (Server in der Cloud)

Der Server ist ein normaler Node.js-Prozess mit einer SQLite-Datei – läuft auf so ziemlich jedem
kleinen Linux-Server/VPS.

1. **Repo auf den Server bringen** (klonen oder per Deploy-Workflow) und ins `server/`-Verzeichnis
   wechseln.
2. **Bauen:**
   ```bash
   npm install
   npm run build
   ```
3. **Umgebungsvariablen setzen** (siehe Tabelle unten), dann starten:
   ```bash
   npm start
   ```
4. Den Prozess dauerhaft am Laufen halten (empfohlen: [`pm2`](https://pm2.keymetrics.io/),
   `systemd`-Service oder das Init-System deines Hosters), damit er einen Server-Neustart übersteht.
5. Firewall/Reverse-Proxy: Port (Standard `3000`) für die LAN-Party-Teilnehmer erreichbar machen,
   idealerweise per HTTPS (z. B. hinter Caddy/nginx), da das Zugangs-Token sonst im Klartext über
   die Leitung geht.

### Umgebungsvariablen

| Variable | Standard | Bedeutung |
|---|---|---|
| `PORT` | `3000` | Port, auf dem der Server lauscht. |
| `DB_FILE` | `server/data/lan.db` | Pfad zur SQLite-Datei. Wird beim ersten Start angelegt. |
| `ACCESS_TOKEN` | *(leer = kein Schutz)* | Geteiltes Zugangs-Token für die Web-Oberfläche. **Für den Live-Betrieb unbedingt setzen**, sonst ist das Tool für jeden im Internet offen. |
| `OFFLINE_TIMEOUT_MS` | `60000` | Nach wie vielen ms ohne Agent-Meldung ein Spieler als „offline" gilt. |

Beispiel:

```bash
PORT=3000 ACCESS_TOKEN="party-passwort-2026" node dist/index.js
```

Das Token dann einmalig an alle Teilnehmer weitergeben (z. B. per Gruppenchat) – die Web-App fragt
es beim ersten Öffnen ab und merkt es sich danach im Browser.

## Agent-Setup (auf jedem Spieler-PC)

Ausführliche Anleitung inkl. `.exe`-Paketierung steht in [`agent/README.md`](agent/README.md).
Kurzfassung:

1. Im Web-Tool unter **Spieler** den eigenen Namen antippen → **API-Key kopieren**.
2. `agent/agent.config.example.json` zu `agent.config.json` kopieren, Server-URL + den kopierten
   Key eintragen.
3. `npm install && npm start` (oder die vorpaketierte `.exe` verwenden, falls vorhanden).

Der Agent braucht sonst nichts zu wissen – neue Spiele bzw. neue Prozessname-Zuordnungen werden
zentral im Web-Tool unter „⚙️ Spiele verwalten" gepflegt und wirken sofort, ohne den Agent
anzufassen.

## Tests

```bash
cd server
npm test           # Unit + Integration (schnell, In-Memory-DB)
npm run test:e2e   # Browser-Klickpfade mit Playwright (startet echten Server + echten Browser)

cd ../agent
npm test           # Unit-Tests (Config, Prozessname-Parsing)
npm run test:e2e   # Echter Agent-Loop gegen echten Server
```

Details zur Teststrategie: [`server/TESTING.md`](server/TESTING.md).

## Tech-Stack

- **Server**: Node.js, TypeScript, Express, better-sqlite3, Socket.IO
- **Frontend**: Vanilla HTML/CSS/JS (kein Build-Schritt, bewusst schlank gehalten)
- **Agent**: Node.js (als `.exe` paketierbar, damit kein Node auf den Spieler-PCs nötig ist)
