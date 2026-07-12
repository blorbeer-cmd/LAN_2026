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
| 🏠 **Home** | Die Startseite für jeden Spieler: Live-Status (wer zockt gerade was, via kleinem Agent auf jedem PC – auch mehrere Spiele gleichzeitig, inkl. Vordergrund-Erkennung), manuelles Pausieren („Pause/Essen"), die Kiosk-Inhalte zum Antippen – laufende Abstimmung (inkl. Titel), aktives Turnier, offene Essensbestellung, offene Arcade-Lobby, persönliche „Skill bewerten"-Erinnerung – Rangliste-Top-3, Sitzplan und ganz unten der Mitteilungs-Verlauf. Die jeweils neueste Mitteilung ist zusätzlich immer oben im App-Header sichtbar, auf jeder Seite, mit Direktlink in den passenden Bereich. |
| ⚔️ **Turniere** | K.O.-Baum, Liga „jeder gegen jeden" (optional mit Hin-/Rückspielen) oder Gruppenphase + K.O. – Teams werden skill-balanciert vorgeschlagen, Ergebnisse (mit oder ohne Punktestand) direkt im Turnierbaum eintragbar, der sich automatisch weiterentwickelt. Bei neuem/anstehendem Match gibt's einen Push-Hinweis an die Beteiligten. |
| ⚖️ **Teams auslosen** | Für ein Spiel automatisch faire Teams aus den anwesenden Spielern auslosen (skill-basiert), optional unter Berücksichtigung der Sitznachbarn (nicht gegeneinander). Ergebnis lässt sich direkt als Match-Ergebnis übernehmen. |
| 👑 **Captain-Draft** | Die soziale Alternative zum Auslosen: 2–4 Captains picken abwechselnd (Snake-Reihenfolge) live aus dem Pool – jeder verfolgt den Draft auf dem eigenen Handy, nur der Captain am Zug kann picken. Ergebnis landet in der Team-Historie und lässt sich direkt als Match eintragen. |
| 🗳️ **Abstimmung** | „Was zocken wir als Nächstes?" – jeder gibt seine Stimme/Punkte ab, sieht dabei aber nur die eigene Wahl, nicht den Zwischenstand (kein Bandwagon-Voting). Die volle Punkteverteilung gibt's erst nach Rundenende. Historie vergangener Runden lässt sich jederzeit erneut öffnen, um das Detail-Ergebnis einer Runde nachträglich anzusehen. |
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
| 👤 **Selbst-Onboarding** | Neue Geräte landen automatisch auf der Profil-Seite statt auf Home: Name (eindeutig), Profilbild, Skill-Ratings und der eigene Agent-Download richten sich alle selbst ein. |
| 🎪 **Events** | Mehrere LAN-Termine können nebeneinander in derselben Installation existieren; nur eines „trackt" gleichzeitig (Live-Status/Spielzeit). Was außerhalb eines getrackten Events passiert, läuft normal unter „Außerhalb von Events". |
| 🔗 **Einladungslink & QR-Code** | Ein Link (trägt bei Bedarf das Zugangs-Token) führt neue Leute direkt zur Profil-Erstellung – auch als QR-Code zum Aushängen, serverseitig gerendert statt über einen Drittanbieter. |
| 🖥️ **TV-/Kiosk-Ansicht** | Read-only Dashboard (`/kiosk.html`) für einen gemeinsamen Bildschirm/Beamer: Live-Status, Abstimmung, Rangliste, laufendes Turnier – aktualisiert sich von selbst, keine Bedienung nötig. |
| 🔔 **Push-Benachrichtigungen** | Optionaler Web-Push-Opt-in fürs Handy: neue Abstimmung, neue Durchsage, anstehendes Turnier-Match – auch wenn die Seite gerade nicht offen ist. Ein Tipp auf die Benachrichtigung springt direkt in den passenden Bereich; verpasste Nachrichten stehen zusätzlich im Mitteilungs-Feed auf Home. |
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

Das Projekt verwendet Node.js 24. Die Version steht in `.nvmrc`; mit `nvm use` wird sie automatisch
ausgewählt. Server und Agent deklarieren Node 24 zusätzlich über `engines`.

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

### Code-Qualität

Für einheitlichen Code stehen ESLint und Prettier bereit:

```bash
cd server
npm run lint
npm run format:check

cd ../agent
npm run lint
```

Die Regeln gelten zunächst als gemeinsame Grundlage für neue und geänderte Dateien; eine
vollständige automatische Umformatierung der bestehenden Anwendung ist bewusst ein eigener Schritt.

## Deployment (24/7 auf `lan.dbehnke.dev`)

Läuft dauerhaft auf einem Hetzner-VPS, containerisiert per Docker, per GitHub Actions deployt,
per Cloudflare Tunnel ans Internet gehängt. Threat model bewusst schlank: kein Fremder greift in
eine laufende LAN-Session ein, Ziel ist nur "kein leichtes Opfer für Zufallsfunde/Bots" – siehe
`CLAUDE.md` für die volle Begründung.

**Architektur:** `lan.dbehnke.dev` → Cloudflare (TLS, DNS, DDoS/WAF) → Cloudflare Tunnel
(`cloudflared`, Origin hat **keinen offenen Port 80/443**) → `app`-Container (kein published Port,
nur intern im Docker-Netz erreichbar) → SQLite-Datei auf einem Bind-Mount, überlebt jedes Redeploy.
SSH (Port 22) bleibt offen, aber nur Key-Auth, kein Root-Login, `fail2ban`.

### Einmalige Vorbereitung (bevor der erste Deploy läuft)

1. **Deploy-Keypair erzeugen** (lokal, einmalig):
   ```bash
   ssh-keygen -t ed25519 -f lan2026-deploy -N "" -C "lan2026-deploy"
   ```
2. **Cloudflare Tunnel anlegen** (einmalig, im [Zero Trust Dashboard](https://one.dash.cloudflare.com/)
   → Networks → Tunnels → Create a tunnel → "Cloudflared"): Name z. B. `lan2026`, Public Hostname
   `lan.dbehnke.dev` → Service `HTTP` → `app:3000` (der Service-Name `app` ist der Compose-Service,
   nicht die Server-IP). Den angezeigten **Tunnel-Token** kopieren.
3. **GitHub Secrets anlegen** (Repo → Settings → Secrets and variables → Actions → *Secrets*, bewusst
   keine *Variables* – die wären für alle mit Schreibzugriff auf das Repo lesbar, Secrets nicht):

   | Secret | Wert |
   |---|---|
   | `HETZNER_API_TOKEN` | Hetzner Cloud Projekt → Security → API Tokens (Read & Write) |
   | `HETZNER_SSH_PUBLIC_KEY` | Inhalt von `lan2026-deploy.pub` |
   | `SSH_PRIVATE_KEY` | Inhalt von `lan2026-deploy` (**ohne** `.pub`) |
   | `CF_TUNNEL_TOKEN` | Token aus Schritt 2 |
   | `APP_ACCESS_TOKEN` | starkes Zufallstoken, z. B. `openssl rand -hex 24` |
   | `GHCR_PULL_TOKEN` | GitHub → Settings → Developer settings → **Tokens (classic)** (fine-grained Tokens haben **kein** Packages-Permission – GitHub-seitige Lücke, nicht behebbar; und da das Repo nicht dir gehört, tauchte es dort im Repo-Auswahldialog ohnehin nicht auf). Scopes: `read:packages` + `repo` (`repo` sorgt dafür, dass GitHub deine bestehenden Collaborator-Rechte auf dem privaten Repo für das Package durchreicht). Ablaufdatum setzen und dir merken, das Secret + `.env` auf dem Server (siehe "Alltag" unten) danach zu erneuern. **Bewusst kein Fix "Package auf public stellen"** – das Image bleibt privat, der Server authentifiziert sich stattdessen selbst beim Pullen. |

4. **`Provision Hetzner Server`-Workflow manuell starten** (Actions-Tab → Workflow auswählen →
   "Run workflow"). Legt SSH-Key + Firewall (nur Port 22 offen) + einen `cx23`-Server in Helsinki
   (`hel1`) in Hetzner an, installiert Docker via Cloud-Init, loggt sich per `GHCR_PULL_TOKEN` bei
   GHCR ein und startet `cloudflared` direkt beim ersten Boot. Läuft **einmalig** – ein zweiter Lauf
   überspringt die Server-Erstellung, wenn `lan2026` schon existiert.

   Der `app`-Container startet bei diesem allerersten Boot noch **nicht** – es gibt ja noch kein
   gepushtes Image (das entsteht erst in Schritt 6). Das ist erwartet und kein Fehler; `cloudflared`
   läuft trotzdem schon (`lan.dbehnke.dev` zeigt bis Schritt 6 kurz einen Cloudflare-Fehler wie
   `502`/`523`, weil noch nichts hinter dem Tunnel lauscht).
5. Die im Job-Summary ausgegebene **Server-IP als Secret `HETZNER_HOST`** anlegen.
6. Push nach `main` → `CI/CD`-Workflow baut, testet, baut das Docker-Image, pusht es (privat) nach
   GHCR und deployt per SSH – die Anmeldedaten aus Schritt 4 sind schon da, dieser erste Deploy
   läuft direkt durch. Ab hier ist jeder weitere Push nach `main` ein normaler Deploy.

### Alltag

- **Deploy:** einfach nach `main` pushen. Tests (Unit + Integration + E2E) müssen grün sein, sonst
  wird nicht gebaut/deployt.
- **Rollback:** auf dem Server (`ssh deploy@<HETZNER_HOST>`) `/opt/lan2026/rollback.sh <git-sha>`
  ausführen – pinnt das Docker-Image auf einen früheren, bereits gebauten Stand.
- **Backups:** noch nicht eingerichtet (siehe Security-Review) – für echte Daten vor der ersten
  "richtigen" LAN auf dem neuen Server unbedingt einen Cron-Job mit `sqlite3 .backup` ergänzen.
- **`GHCR_PULL_TOKEN` erneuern** (Fine-grained Tokens laufen ggf. ab): neuen Token erzeugen, das
  GitHub-Secret aktualisieren, dann auf dem Server (`ssh deploy@<HETZNER_HOST>`) die Zeile in
  `/opt/lan2026/.env` von Hand ersetzen und `/opt/lan2026/docker-login.sh` erneut ausführen –
  `provision.yml` läuft nach dem ersten Mal nicht automatisch nochmal.

### Lokale Entwicklung / manuelles Hosting (unverändert möglich)

Der Server ist weiterhin ein normaler Node.js-Prozess mit einer SQLite-Datei und läuft genauso gut
auf jedem beliebigen kleinen Linux-Server/VPS ohne Docker – für die LAN-Party selbst reicht wie
bisher `npm install && npm run build && npm start` auf einem Laptop im WLAN.

### Umgebungsvariablen

| Variable | Standard | Bedeutung |
|---|---|---|
| `PORT` | `3000` | Port, auf dem der Server lauscht. |
| `DB_FILE` | `server/data/lan.db` | Pfad zur SQLite-Datei. Wird beim ersten Start angelegt. |
| `ACCESS_TOKEN` | *(leer = kein Schutz)* | Geteiltes Zugangs-Token für die Web-Oberfläche. **Für den Live-Betrieb unbedingt setzen**, sonst ist das Tool für jeden im Internet offen. |
| `ADMIN_PIN` | *(leer = offener Admin-Modus)* | Derzeit ungenutzt: Der Admin-Modus ist bewusst ohne PIN (Ein-Klick-Umschalter im Web-Tool, siehe `docs/KONZEPT-TEST-USER.md`). Leer lassen – mit gesetztem PIN würden Admin-Aktionen aus der Oberfläche fehlschlagen, bis die PIN-Abfrage im Frontend zurückkommt. |
| `OFFLINE_TIMEOUT_MS` | `60000` | Nach wie vielen ms ohne Agent-Meldung ein Spieler als „offline" gilt. |
| `NODE_ENV` | *(leer)* | Auf `production` gesetzt (macht der Docker-Container automatisch): verweigert den Start, wenn `ACCESS_TOKEN` leer ist, und beendet den Prozess statt weiterzulaufen, wenn ein unerwarteter Fehler durchschlägt (Docker startet ihn dann per `restart: unless-stopped` sofort neu). Für die LAN-Party selbst (kein Supervisor) bewusst **nicht** setzen. |

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
