# RespawnHQ – LAN-Party Tool

Ein kleines, selbst gehostetes Web-Tool für unsere jährliche LAN-Party (~15 Leute, 3 Tage).
Alles Wichtige an einem Ort: **Teams auslosen**, **abstimmen was als Nächstes gespielt wird**,
**live sehen wer gerade was zockt**, **Turniere durchspielen** und ein **Wochenend-Leaderboard**.
Jeder öffnet einfach die URL im Handy-Browser und legt sich in unter einer Minute selbst ein
Profil an – keine App-Installation, kein Account, kein langes Formular.

## Was kann das Tool?

### Spielbetrieb (die Haupt-Tabs)

| Feature | Beschreibung |
|---|---|
| 📡 **Live-Status** | Sieht automatisch, wer gerade welche(s) Spiel(e) offen hat (via kleinem Agent auf jedem PC) – auch mehrere gleichzeitig, inkl. Erkennung welches Fenster gerade wirklich im Vordergrund ist. Manuelles Pausieren („Pause/Essen"), spontanes „Jetzt zocken?"-Pingen wer Lust auf eine Runde hat, und ein persönliches Digest („was steht für mich gerade an") direkt auf der Startseite. |
| ⚔️ **Turniere** | K.O.-Baum, Liga „jeder gegen jeden" (optional mit Hin-/Rückspielen) oder Gruppenphase + K.O. – Teams werden skill-balanciert vorgeschlagen, Ergebnisse (mit oder ohne Punktestand) direkt im Turnierbaum eintragbar, der sich automatisch weiterentwickelt. Bei neuem/anstehendem Match gibt's einen Push-Hinweis an die Beteiligten. |
| ⚖️ **Teams auslosen** | Für ein Spiel automatisch faire Teams aus den anwesenden Spielern auslosen (skill-basiert), optional unter Berücksichtigung der Sitznachbarn (nicht gegeneinander). Ergebnis lässt sich direkt als Match-Ergebnis übernehmen. |
| 👑 **Captain-Draft** | Die soziale Alternative zum Auslosen: 2–4 Captains picken abwechselnd (Snake-Reihenfolge) live aus dem Pool – jeder verfolgt den Draft auf dem eigenen Handy, nur der Captain am Zug kann picken. Ergebnis landet in der Team-Historie und lässt sich direkt als Match eintragen. |
| 🗳️ **Abstimmung** | „Was zocken wir als Nächstes?" – live abstimmen. Zeigt an, was zuletzt dran war/wie oft. Historie vergangener Runden. |
| 🏆 **Rangliste** | Match-Ergebnisse eintragen (auch Frei-für-alle ohne Teams), Punkte übers ganze Wochenende, Gesamtsieger der LAN, Spielzeit pro Spieler und pro Spiel. |
| ☰ **Mehr** | Sammelstelle für alles Weitere: Info-Board, Essensbestellung, Durchsage, Spieler-Verwaltung, Spielzeit-Auswertungen, Spiele-&-Turnier-Statistiken, Hall of Fame, Sitzplan. |

### Auswertungen & Erinnerungsstücke

| Feature | Beschreibung |
|---|---|
| 🕒 **Spielzeit-Auswertungen** | Awards (z. B. „Marathon-Zocker"), beliebteste Spiele, wer wann was gespielt hat, ein Concurrency-Chart („wie viele haben X gleichzeitig gespielt") – filterbar nach Event bzw. Zeitraum. |
| 📊 **Spiele & Turniere** | Match-/Turnier-Statistiken abseits der reinen Punkte: Rivalitäten, erfolgreichste Duos, größte Underdog-Siege. |
| 🏛️ **Hall of Fame** | Champions über alle LAN-Partys hinweg (mehrere `events` in der DB) – Gesamtsieger je Event plus eine All-Time-Rangliste „wer hat am häufigsten gewonnen". |
| 🪑 **Sitzplan** | Wer neben wem sitzt (jeder trägt seine Nachbarn selbst im Profil ein), zu „Sitzgruppen" zusammengefasst – hilft Neulingen, ihre Freunde im Raum zu finden. |
| 📄 **Export als Andenken** | Ein Event per Knopfdruck als gestaltetes PDF exportieren (Rangliste, Spielzeit, Awards, Turnier-Champions). Dieselben Daten stehen auch roh als JSON über `GET /api/export` bereit, falls jemand eigenes Tooling anschließen will. |

### Komfort & Betrieb

| Feature | Beschreibung |
|---|---|
| 📢 **Durchsage** | Eine Nachricht an alle auf einmal („Essen ist da!"): Toast auf jedem offenen Gerät, großes Banner auf dem Kiosk-Bildschirm, Push-Benachrichtigung an alle Opt-ins – immer mit Absender-Name. |
| 📌 **Info-Board** | WLAN-Passwort, Discord-Link, Gameserver-IPs, Hausregeln: die Dinge, die sonst fünfmal pro Abend gefragt werden, als gepinnte Einträge mit Kopieren-Knopf. Jeder darf pflegen. |
| 🍕 **Essen bestellen** | Sammelbestellung öffnen („Pizza bei Luigi's"), optional mit Zeitpunkt „geht raus um …" (später jederzeit änderbar, auch nach dem Schließen), jeder trägt seine Positionen (mit optionalem Preis) vom eigenen Handy ein, Schließen friert die Liste ein – gruppiert pro Person mit Summen, bereit zum Vorlesen am Telefon. |
| 👤 **Selbst-Onboarding** | Neue Geräte landen automatisch auf der Profil-Seite statt auf dem Live-Board: Name (eindeutig), Profilbild, Skill-Ratings und der eigene Agent-Download richten sich alle selbst ein. |
| 🎪 **Events** | Mehrere LAN-Termine können nebeneinander in derselben Installation existieren; nur eines „trackt" gleichzeitig (Live-Status/Spielzeit). Was außerhalb eines getrackten Events passiert, läuft normal unter „Außerhalb von Events". |
| 🔗 **Einladungslink & QR-Code** | Ein Link (trägt bei Bedarf das Zugangs-Token) führt neue Leute direkt zur Profil-Erstellung – auch als QR-Code zum Aushängen, serverseitig gerendert statt über einen Drittanbieter. |
| 🖥️ **TV-/Kiosk-Ansicht** | Read-only Dashboard (`/kiosk.html`) für einen gemeinsamen Bildschirm/Beamer: Live-Status, Abstimmung, Rangliste, laufendes Turnier – aktualisiert sich von selbst, keine Bedienung nötig. |
| 🔔 **Push-Benachrichtigungen** | Optionaler Web-Push-Opt-in fürs Handy: neue Abstimmung, neuer Ping, anstehendes Turnier-Match – auch wenn die Seite gerade nicht offen ist. |
| ⚙️ **Spiele & Events verwalten** | Spiele, Icons/eigene Logos, Teamgrößen und Prozessname-Zuordnungen (für die Live-Erkennung) zentral pflegen; Events anlegen und Tracking gezielt starten/stoppen. |
| 🔒 **Zugangsschutz** | Leichtes, geteiltes Zugangs-Token schützt die Web-Oberfläche, falls der Server im Internet erreichbar ist. |
| 🛡️ **Race-sicher** | Gleichzeitige Aktionen mehrerer Geräte (zwei Leute starten dieselbe Abstimmung, zwei melden dasselbe Turnier-Match) werden serverseitig sauber aufgelöst statt Daten zu duplizieren/korrumpieren – siehe `CLAUDE.md` → „Race-Sicherheit". |

## Architektur (Kurzfassung)

```
┌──────────────────┐        HTTP / WebSocket        ┌────────────────────────┐
│  Browser (Handy/  │  ◀───────────────────────────▶ │   Server (Cloud)        │
│  Laptop jedes     │                                │   Node.js + Express     │
│  Teilnehmers)     │                                │   SQLite + Socket.IO    │
└──────────────────┘                                └────────────────────────┘
                                                              ▲
                                                              │  meldet laufendes Spiel
                                                              │  (Prozess-Scan, API-Key-Auth)
                                              ┌───────────────┴───────────────┐
                                              │  Agent (kleines Programm auf   │
                                              │  jedem Windows-Spieler-PC)     │
                                              │  ┌──────────────────────────┐  │
                                              │  │ Kontroll-Tool: Tray-Icon │  │
                                              │  │ + Web-Panel auf          │  │
                                              │  │ 127.0.0.1 (lokal only)   │  │
                                              │  └──────────────────────────┘  │
                                              └────────────────────────────────┘
```

- **Server**: läuft in der Cloud, hält alle Daten (SQLite), liefert die Web-Oberfläche aus und
  verteilt Live-Updates über WebSockets.
- **Agent**: winziges Programm, das jeder Teilnehmer einmal auf seinem PC installiert. Es scannt die
  laufenden Prozesse (z. B. `cs2.exe`) und meldet dem Server, welches Spiel gerade läuft. Bringt ein
  eigenes, rein lokales **Kontroll-Tool** mit (Tray-Icon + kleine Weboberfläche) zum Pausieren,
  Umschalten von Einstellungen und Deinstallieren, ohne Server-Zugriff und ohne dass ein Mitspieler
  im LAN darauf zugreifen könnte – siehe [„Agent-Steuerung"](#agent-steuerung-kontroll-tool) unten.
- **Web-UI**: keine Installation, jeder öffnet einfach die URL im Browser und legt sich selbst ein
  Profil an.

## Verzeichnisstruktur

```
LAN_2026/
├── server/            # Zentraler Server (Node.js + TypeScript)
│   ├── src/           # Quellcode (API, DB, WebSocket, PDF-Export)
│   ├── public/        # Web-Oberfläche (HTML/CSS/JS) + Kiosk-Ansicht
│   └── agent-dist/    # Gebaute agent.exe, die der Server personalisiert zum Download anbietet
├── agent/             # Windows-Client zum Prozess-Scannen + lokales Kontroll-Tool
│   └── src/
├── README.md
├── CLAUDE.md          # Entwicklungs-Leitlinien
└── ANFORDERUNGEN.md   # Vollständige, priorisierte Anforderungsliste
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

**Empfohlen (kein Node.js nötig):** Jeder Teilnehmer öffnet im Web-Tool sein eigenes **Profil**
(landet dort beim ersten Öffnen automatisch) und tippt auf **„📥 Agent für Windows
herunterladen"**. Der Server baut eine personalisierte ZIP: die fertige `.exe`, eine
`agent.config.json` mit bereits eingetragener Server-Adresse und dem eigenen API-Key, sowie
`install.bat`/`uninstall.bat`. `install.bat` doppelklicken – fertig, inkl. Autostart bei jedem
Windows-Login.

**Manuell (z. B. für Entwicklung/andere Betriebssysteme):**

1. Im Web-Tool unter **Profil** (oder **Mehr → Spieler**) den eigenen Namen antippen → **API-Key
   kopieren**.
2. `agent/agent.config.example.json` zu `agent.config.json` kopieren, Server-URL + den kopierten
   Key eintragen.
3. `npm install && npm start`.

Der Agent braucht sonst nichts zu wissen – neue Spiele bzw. neue Prozessname-Zuordnungen werden
zentral im Web-Tool unter „⚙️ Spiele verwalten" gepflegt und wirken sofort, ohne den Agent
anzufassen.

## Agent-Steuerung (Kontroll-Tool)

Läuft die installierte `.exe` unter Windows, erscheint kein Konsolenfenster, sondern ein kleines
Icon im System-Tray. Doppelklick darauf (oder die Desktop-Verknüpfung „RespawnHQ-Agent Steuerung",
die `install.bat` anlegt) öffnet eine kleine Weboberfläche unter `http://127.0.0.1:47813` – **rein
lokal**, nie über das LAN erreichbar, also nichts, worauf ein Mitspieler zugreifen könnte. Von dort
lässt sich alles einstellen/aktualisieren, ohne die ZIP neu herunterzuladen oder Dateien von Hand
anzufassen:

| Aktion | Wirkung |
|---|---|
| **Pausieren / Fortsetzen** | Stoppt sofort das Melden an den Server (Spieler erscheint nach dem üblichen Timeout als „offline"), ohne den Agent-Prozess zu beenden. Übersteht auch einen PC-Neustart. Dasselbe Pausieren geht auch direkt im Web-Tool über „Tracking pausieren" im Profil – beide Wege zeigen denselben Stand. |
| **Erweiterte Daten senden an/aus** | Schaltet das optionale Aktivitäts-Tracking (aktives Fenster + Leerlaufzeit, für „davon aktiv gespielt") live um. |
| **Autostart an/aus** | Entfernt bzw. erstellt die Verknüpfung im Windows-Autostart-Ordner. Nur mit der installierten `.exe` verfügbar. |
| **Komplett deinstallieren** | Entfernt den Autostart-Eintrag, beendet den Agent-Prozess und löscht den gesamten Installationsordner (`%LOCALAPPDATA%\RespawnHQ-Agent`) von diesem PC. |

Ist der Port belegt (z. B. zwei Agenten auf demselben PC), probiert der Agent automatisch die
nächsten Ports (47814, 47815, …). Klappt das Tray-Icon aus irgendeinem Grund nicht, bleibt das
Konsolenfenster einfach sichtbar und die Desktop-Verknüpfung funktioniert unverändert; zusätzlich
landet die Log-Ausgabe immer auch in `agent.log` im Installationsordner. Details, inkl. was beim
Aktivitäts-Tracking genau übertragen wird: [`agent/README.md`](agent/README.md).

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

- **Server**: Node.js, TypeScript, Express, better-sqlite3, Socket.IO, `web-push` (Push-Benachrichtigungen),
  `qrcode` + `pdfkit` (Einladungs-QR-Code, Event-Export als PDF), `archiver` (personalisierte Agent-ZIP)
- **Frontend**: Vanilla HTML/CSS/JS (kein Build-Schritt, bewusst schlank gehalten), eigenes kleines
  Design-System (Spacing-Skala, wiederverwendete Komponenten – siehe `CLAUDE.md` → „Design-System")
- **Agent**: Node.js (als `.exe` paketierbar via `pkg`, damit kein Node auf den Spieler-PCs nötig
  ist), inkl. eigenem lokalem HTTP-Kontrollserver für die Steuerungs-Oberfläche
