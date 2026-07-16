# Respawn – LAN-Party Tool

Ein kleines, selbst gehostetes Web-Tool für unsere jährliche LAN-Party (~15 Leute, 3 Tage).
Alles Wichtige an einem Ort: **Teams zusammenstellen**, **abstimmen was als Nächstes gespielt wird**,
**live sehen wer gerade was zockt**, **Turniere durchspielen** und ein **Wochenend-Leaderboard**.
Jeder öffnet einfach die URL im Handy-Browser und legt sich in unter einer Minute selbst ein
Profil an – keine App-Installation, kein Account, kein langes Formular.

## Was kann das Tool?

### Spielbetrieb (die Haupt-Tabs)

| Feature | Beschreibung |
|---|---|
| 🏠 **Home** | Die gruppierte Startübersicht mit „Aktuell“, Live-Status, Rangliste und Sitzplan. Die neueste aktive Mitteilung erscheint als farbiger Direktlink unter der Kopfzeile; die Glocke öffnet die persönliche Historie mit Gelesen- und Löschaktionen. |
| ⚔️ **Turniere** | K.O.-Baum, Liga „jeder gegen jeden" (optional mit Hin-/Rückspielen) oder Gruppenphase + K.O. – Teams werden skill-balanciert vorgeschlagen, Ergebnisse (mit oder ohne Punktestand) direkt im Turnierbaum eintragbar, der sich automatisch weiterentwickelt. Bei neuem/anstehendem Match gibt's einen Push-Hinweis an die Beteiligten. |
| ⚖️ **Teams** | Für ein Spiel automatisch faire Teams aus den anwesenden Spielern auslosen (skill-basiert) oder per Captain Draft zusammenstellen, optional unter Berücksichtigung der Sitznachbarn. Ergebnisse und Rematches landen in einer gemeinsamen Historie. |
| 👑 **Captain Draft** | Die soziale Alternative zur Auslosung innerhalb von „Teams“: erst Teilnehmer, dann 2–4 Captains festlegen und anschließend abwechselnd aus den übrigen Spielern wählen. Das Ergebnis landet in derselben Historie wie Auslosungen und Matches. |
| 🗳️ **Vote** | Jeder gibt seine Stimme oder Punkte ab, sieht dabei aber nur die eigene Wahl und nicht den Zwischenstand. Die volle Punkteverteilung erscheint erst nach Rundenende; Unentschieden können direkt in eine Stichwahl übergehen. Vergangene Runden stehen in der eingeklappten Historie. |
| 🏆 **Rang** | Match-Ergebnisse eintragen (auch Frei-für-alle ohne Teams), Punkte übers ganze Wochenende, Gesamtsieger der LAN, gefilterte Spieler-Spielzeit und ein ungefilterter Vergleich der Spielzeit pro Spiel. |
| ☰ **Mehr** | Sammelstelle für An-/Abreise, Arcade, Auswertungen, Durchsage, Essen, Hall of Fame, Info, Spieler, Spiele, Einstellungen und weitere Werkzeuge. |

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
| 📌 **Info** | WLAN-Passwort, Discord-Link, Gameserver-IPs und Hausregeln als alphabetisch sortierte Einträge mit Kopieren-Knopf. |
| 🍕 **Essen bestellen** | Sammelbestellung öffnen („Pizza bei Luigi's"), optional mit Zeitpunkt „geht raus um …" (später jederzeit änderbar, auch nach dem Schließen), jeder trägt seine Positionen (mit optionalem Preis) vom eigenen Handy ein, Schließen friert die Liste ein – gruppiert pro Person mit Summen, bereit zum Vorlesen am Telefon. |
| 👤 **Selbst-Onboarding** | Neue Geräte landen automatisch auf der Profil-Seite statt auf Home: Name (eindeutig), Profilbild, Skill-Ratings und der eigene Agent-Download richten sich alle selbst ein. |
| 🎪 **Events** | Mehrere LAN-Termine können nebeneinander in derselben Installation existieren; nur eines „trackt" gleichzeitig (Live-Status/Spielzeit). Was außerhalb eines getrackten Events passiert, läuft normal unter „Außerhalb von Events". |
| 🔗 **Einladungslink & QR-Code** | Ein Link (trägt bei Bedarf das Zugangs-Token) führt neue Leute direkt zur Profil-Erstellung – auch als QR-Code zum Aushängen, serverseitig gerendert statt über einen Drittanbieter. |
| 🖥️ **TV-/Kiosk-Ansicht** | Scrollfreies Read-only-Dashboard (`/kiosk.html`) im 2×2-Aufbau: Live-Status und Rangliste oben, Live-Vote und Turnier unten. Offene Votes maskieren die Spiele, zeigen nach dem Ende einen Countdown und halten das Ergebnis anschließend zeitlich begrenzt sichtbar. |
| 🔔 **Push-Benachrichtigungen** | Optionaler Web-Push-Opt-in fürs Handy: neue Abstimmung, neue Durchsage, anstehendes Turnier-Match – auch wenn die Seite gerade nicht offen ist. Ein Tipp springt direkt in den passenden Bereich; verpasste Nachrichten stehen in der Glocke der Kopfzeile. |
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
Respawn/
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

Hinweise zur Log-Rotation für den Dauerbetrieb stehen in
[`server/OPERATIONS.md`](server/OPERATIONS.md).

**Architektur:** `lan.dbehnke.dev` → Cloudflare (TLS, DNS, DDoS/WAF) → Cloudflare Tunnel
(`cloudflared`, Origin hat **keinen offenen Port 80/443**) → `app`-Container (kein published Port,
nur intern im Docker-Netz erreichbar) → SQLite-Datei auf einem Bind-Mount, überlebt jedes Redeploy.
SSH (Port 22) bleibt offen, aber nur Key-Auth, kein Root-Login, `fail2ban`.

### Einmalige Vorbereitung (bevor der erste Deploy läuft)

1. **Deploy-Keypair erzeugen** (lokal, einmalig):
   ```bash
   ssh-keygen -t ed25519 -f respawn-deploy -N "" -C "respawn-deploy"
   ```
2. **Cloudflare Tunnel anlegen** (einmalig, im [Zero Trust Dashboard](https://one.dash.cloudflare.com/)
   → Networks → Tunnels → Create a tunnel → "Cloudflared"): Name z. B. `respawn`, Public Hostname
   `lan.dbehnke.dev` → Service `HTTP` → `app:3000` (der Service-Name `app` ist der Compose-Service,
   nicht die Server-IP). Den angezeigten **Tunnel-Token** kopieren.
3. **GitHub Secrets anlegen** (Repo → Settings → Secrets and variables → Actions → *Secrets*, bewusst
   keine *Variables* – die wären für alle mit Schreibzugriff auf das Repo lesbar, Secrets nicht):

   | Secret | Wert |
   |---|---|
   | `HETZNER_API_TOKEN` | Hetzner Cloud Projekt → Security → API Tokens (Read & Write) |
   | `HETZNER_SSH_PUBLIC_KEY` | Inhalt von `respawn-deploy.pub` |
   | `SSH_PRIVATE_KEY` | Inhalt von `respawn-deploy` (**ohne** `.pub`) |
   | `CF_TUNNEL_TOKEN` | Token aus Schritt 2 |
   | `APP_ADMIN_RECOVERY_CODE` | starkes, einmaliges Bootstrap-/Recovery-Secret, z. B. `openssl rand -hex 32`; nicht an Teilnehmende verteilen |
   | `APP_KIOSK_TOKEN` | eigener starker Read-only-Token für `/kiosk.html`; z. B. `openssl rand -hex 32` |
   | `APP_ACCESS_TOKEN` | starkes Zufallstoken für Rollbacks auf alte Images; aktuelle Images mit `AUTH_MODE=required` verwenden es nicht mehr |
   | `GHCR_PULL_TOKEN` | GitHub → Settings → Developer settings → **Tokens (classic)** (fine-grained Tokens haben **kein** Packages-Permission – GitHub-seitige Lücke, nicht behebbar; und da das Repo nicht dir gehört, tauchte es dort im Repo-Auswahldialog ohnehin nicht auf). Scopes: `read:packages` + `repo` (`repo` sorgt dafür, dass GitHub deine bestehenden Collaborator-Rechte auf dem privaten Repo für das Package durchreicht). Ablaufdatum setzen und dir merken, das Secret + `.env` auf dem Server (siehe "Alltag" unten) danach zu erneuern. **Bewusst kein Fix "Package auf public stellen"** – das Image bleibt privat, der Server authentifiziert sich stattdessen selbst beim Pullen. |

4. **`Provision Hetzner Server`-Workflow manuell starten** (Actions-Tab → Workflow auswählen →
   "Run workflow"). Legt SSH-Key + Firewall (nur Port 22 offen) + einen `cx23`-Server in Helsinki
   (`hel1`) in Hetzner an, installiert Docker via Cloud-Init, loggt sich per `GHCR_PULL_TOKEN` bei
   GHCR ein und startet `cloudflared` direkt beim ersten Boot. Läuft **einmalig** – ein zweiter Lauf
   überspringt die Server-Erstellung, wenn `respawn` schon existiert.

   Der `app`-Container startet bei diesem allerersten Boot noch **nicht** – es gibt ja noch kein
   gepushtes Image (das entsteht erst in Schritt 6). Das ist erwartet und kein Fehler; `cloudflared`
   läuft trotzdem schon (`lan.dbehnke.dev` zeigt bis Schritt 6 kurz einen Cloudflare-Fehler wie
   `502`/`523`, weil noch nichts hinter dem Tunnel lauscht).
5. Die im Job-Summary ausgegebene **Server-IP als Secret `HETZNER_HOST`** anlegen.
6. Push nach `main` → `CI/CD`-Workflow baut, testet, baut das Docker-Image, pusht es (privat) nach
   GHCR und deployt per SSH – die Anmeldedaten aus Schritt 4 sind schon da, dieser erste Deploy
   läuft direkt durch. Ab hier ist jeder weitere Push nach `main` ein normaler Deploy.

### Alltag

- **Deploy:** einfach eine relevante Änderung nach `main` pushen. Tests (Unit + Integration + E2E)
  und der vollständige Runtime-Image-Build müssen bereits im Pull Request grün sein. Reine
  Markdown-/`docs/`-Änderungen werden dort vollständig geprüft, lösen nach dem Merge aber keinen
  erneuten Image-Build oder Produktionsneustart aus. Der Deploy wartet auf den
  Container-Healthcheck und zeigt bei einem Startfehler automatisch Status und die letzten 100
  App-Logzeilen; anschließend stellt er das zuvor laufende Image wieder her.
- **Rollback:** auf dem Server (`ssh deploy@<HETZNER_HOST>`) `/opt/respawn/rollback.sh <git-sha>`
  ausführen – pinnt das Docker-Image auf einen früheren, bereits gebauten Stand.
- **Bestehenden Server auf persönliche Logins umstellen:** Vor dem ersten Required-Auth-Deploy in
  `/opt/lan2026/.env` ein starkes `ADMIN_RECOVERY_CODE`, einen separaten `KIOSK_TOKEN` ergänzen und
  `AUTH_MODE=required` setzen.
  Anschließend `docker compose up -d --wait app`. Beim ersten Aufruf `/?claim=<RECOVERY_CODE>`
  öffnen, das eigene bestehende Profil auswählen und ein Passwort setzen. Danach im Admin-Bereich
  die persönlichen Claim-Links für alle übrigen Profile erzeugen. Der Bootstrap-Pfad schließt
  sich, sobald das erste Admin-Konto beansprucht wurde; falls genau dieser einzige aktive Admin sein
  Passwort vergisst, kann derselbe Recovery-Code sein Passwort zurücksetzen. `ACCESS_TOKEN` für
  Rollbacks auf ältere Images in der `.env` belassen.
- **Backups:** noch nicht eingerichtet (siehe Security-Review) – für echte Daten vor der ersten
  "richtigen" LAN auf dem neuen Server unbedingt einen Cron-Job mit `sqlite3 .backup` ergänzen.
- **`GHCR_PULL_TOKEN` erneuern** (Fine-grained Tokens laufen ggf. ab): neuen Token erzeugen, das
  GitHub-Secret aktualisieren, dann auf dem Server (`ssh deploy@<HETZNER_HOST>`) die Zeile in
  `/opt/respawn/.env` von Hand ersetzen und `/opt/respawn/docker-login.sh` erneut ausführen –
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
| `AUTH_MODE` | `legacy` | `required` aktiviert persönliche Logins und ersetzt den geteilten Web-Zugang vollständig durch Session-Authentifizierung. |
| `ADMIN_RECOVERY_CODE` | *(leer)* | Starkes Bootstrap-/Recovery-Secret für den ersten beziehungsweise letzten Admin. In Produktion mit `AUTH_MODE=required` Pflicht. |
| `KIOSK_TOKEN` | *(leer = Kiosk in Required-Mode gesperrt)* | Separater Read-only-Zugang für die Kiosk-GET-Endpunkte und `kiosk:subscribe`; Aufruf als `/kiosk.html?token=...`. |
| `ACCESS_TOKEN` | *(leer = kein Schutz)* | Nur im Legacy-Modus: geteiltes Zugangs-Token für die Web-Oberfläche. Im Required-Modus wird es ignoriert. |
| `COOKIE_SECURE` | `1` | Sichere Session-Cookies; nur für bewusstes lokales HTTP-Hosting mit `0` abschalten. |
| `MULTI_GROUPS_ENABLED` | `0` | Aktiviert ausschließlich für Entwicklung und Tests das Anlegen weiterer Gruppen und Gruppeneinladungen. Bis Fach- und Trackingdaten vollständig gruppenbezogen isoliert sind, in Produktion auf `0` lassen. |
| `OFFLINE_TIMEOUT_MS` | `60000` | Nach wie vielen ms ohne Agent-Meldung ein Spieler als „offline" gilt. |
| `NODE_ENV` | *(leer)* | Auf `production` gesetzt (macht der Docker-Container automatisch): verlangt im Legacy-Modus `ACCESS_TOKEN`, im Required-Modus `ADMIN_RECOVERY_CODE`, und beendet den Prozess bei unerwarteten Fehlern, damit Docker sauber neu startet. Für die LAN-Party selbst ohne Supervisor bewusst **nicht** setzen. |

Beispiel:

```bash
PORT=3000 AUTH_MODE=required ADMIN_RECOVERY_CODE="$(openssl rand -hex 32)" KIOSK_TOKEN="$(openssl rand -hex 32)" node dist/index.js
```

Den Recovery-Code geheim halten: Er bootstrapt den ersten Admin und kann genau den einzigen aktiven
Admin wiederherstellen. Weitere Teilnehmende erhalten persönliche Einmal-Links aus dem Admin-Bereich.

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
Icon im System-Tray. Doppelklick darauf (oder die Desktop-Verknüpfung „Respawn-Agent Steuerung",
die `install.bat` anlegt) öffnet eine kleine Weboberfläche unter `http://127.0.0.1:47813` – **rein
lokal**, nie über das LAN erreichbar, also nichts, worauf ein Mitspieler zugreifen könnte. Von dort
lässt sich alles einstellen/aktualisieren, ohne die ZIP neu herunterzuladen oder Dateien von Hand
anzufassen:

| Aktion | Wirkung |
|---|---|
| **Pausieren / Fortsetzen** | Stoppt sofort das Melden an den Server (Spieler erscheint nach dem üblichen Timeout als „offline"), ohne den Agent-Prozess zu beenden. Übersteht auch einen PC-Neustart. Dasselbe Pausieren geht auch direkt im Web-Tool über „Tracking pausieren" im Profil – beide Wege zeigen denselben Stand. |
| **Erweiterte Daten senden an/aus** | Schaltet das optionale Aktivitäts-Tracking (aktives Fenster + Leerlaufzeit, für „davon aktiv gespielt") live um. |
| **Autostart an/aus** | Entfernt bzw. erstellt die Verknüpfung im Windows-Autostart-Ordner. Nur mit der installierten `.exe` verfügbar. |
| **Komplett deinstallieren** | Entfernt den Autostart-Eintrag, beendet den Agent-Prozess und löscht den gesamten Installationsordner (`%LOCALAPPDATA%\Respawn-Agent`) von diesem PC. |

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
  Design-System mit Tokens, gruppierten Seitenflächen und wiederverwendeten Komponenten – siehe
  [`server/DESIGN_SYSTEM.md`](server/DESIGN_SYSTEM.md)
- **Agent**: Node.js (als `.exe` paketierbar via `pkg`, damit kein Node auf den Spieler-PCs nötig
  ist), inkl. eigenem lokalem HTTP-Kontrollserver für die Steuerungs-Oberfläche
