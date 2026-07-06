# LAN 2026 – LAN-Party Tool

Ein kleines, selbst gehostetes Web-Tool für unsere jährliche LAN-Party (~15 Leute, 3 Tage).
Alles Wichtige an einem Ort: **Teams auslosen**, **abstimmen was als Nächstes gespielt wird**,
**live sehen wer gerade was zockt** und ein **Wochenend-Leaderboard**.

## Was kann das Tool?

| Feature | Beschreibung |
|---|---|
| 👥 **Spieler & Skills** | Teilnehmer anlegen, pro Spiel ein Skill-Rating (1–10) pflegen. Basis für faire Teams. |
| ⚖️ **Matchmaking** | Für ein Spiel automatisch faire Teams aus den anwesenden Spielern auslosen (skill-basiert). |
| 🗳️ **Abstimmung** | „Was zocken wir als Nächstes?" – live abstimmen. Zeigt an, was zuletzt dran war. |
| 📡 **Live-Status** | Sieht automatisch, wer gerade welches Spiel offen hat (via kleinem Agent auf jedem PC). |
| 🏆 **Leaderboard** | Match-Ergebnisse eintragen, Punkte übers ganze Wochenende, Gesamtsieger der LAN. |

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
└── CLAUDE.md        # Entwicklungs-Leitlinien
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

## Deployment & Agent-Setup

Ausführliche Anleitung (Cloud-Server aufsetzen, Agent auf jedem PC installieren, neue Spiele
hinzufügen) folgt in diesem README bzw. in den jeweiligen Unterordnern, sobald die Komponenten
stehen.

## Tech-Stack

- **Server**: Node.js, TypeScript, Express, better-sqlite3, Socket.IO
- **Frontend**: Vanilla HTML/CSS/JS (kein Build-Schritt, bewusst schlank gehalten)
- **Agent**: Node.js (als `.exe` paketierbar, damit kein Node auf den Spieler-PCs nötig ist)
