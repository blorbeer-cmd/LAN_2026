# RespawnHQ – Agent

Kleines Programm, das auf jedem Spieler-PC läuft. Es kennt nur drei Dinge: die Server-URL, den
eigenen API-Key und wie oft es nachschauen soll. Es scannt periodisch die laufenden Prozesse und
meldet sie dem Server – die Zuordnung „welcher Prozessname gehört zu welchem Spiel" liegt zentral
auf dem Server (`⚙️ Spiele verwalten` im Web-Tool) und muss hier nicht gepflegt werden.

## Für Teilnehmer: fertiges Download (empfohlen)

Im Web-Tool auf der eigenen Profil-Seite: „📥 Agent für Windows herunterladen". Die ZIP enthält die
fertige `.exe` mit bereits eingetragener Server-Adresse und eigenem API-Key sowie ein
`install.bat`, das alles einrichtet (inkl. Autostart bei jedem Windows-Login) – kein Node.js, keine
Config-Datei von Hand nötig. Der folgende Abschnitt ist nur für die manuelle/Nicht-Windows-Variante
relevant.

## Manuelle Einrichtung

1. `agent.config.example.json` zu `agent.config.json` kopieren.
2. Server-URL und den persönlichen API-Key eintragen (den Key gibt's im Web-Tool unter
   „Spieler" → auf den eigenen Namen tippen → „API-Key kopieren").

```json
{
  "serverUrl": "http://192.168.1.50:3000",
  "apiKey": "dein-persoenlicher-api-key",
  "pollIntervalMs": 10000,
  "trackActivity": false
}
```

3. Starten:

```bash
npm install
npm start
```

Die Konsole zeigt den Verbindungsstatus (✅ verbunden / ❌ Fehler) – Netzwerk-Aussetzer oder ein
Server-Neustart sind kein Problem, der Agent versucht es beim nächsten Intervall automatisch erneut.

## Aktivitäts-Tracking (optional, standardmäßig aus)

Normal weiß der Server nur: „läuft der Spiele-Prozess gerade". Mit `"trackActivity": true` meldet
der Agent zusätzlich, welches Fenster gerade im Vordergrund ist und wie lange keine Maus-/
Tastatureingabe kam. Der Server kann damit unterscheiden, ob ein Spiel nur im Hintergrund lief oder
tatsächlich aktiv gespielt wurde (z. B. in der Rangliste als „davon aktiv gespielt: 2h 15m").

- **Nur Windows** – nutzt `user32.dll` über ein kleines PowerShell-Skript. Auf anderen Systemen
  wird die Option ignoriert.
- **Opt-in** – jeder Spieler entscheidet selbst, ob sein Agent das mitschickt. Standard ist `false`.
- **Was tatsächlich übertragen wird**: der Prozessname des aktuell fokussierten Fensters (das kann
  grundsätzlich jedes laufende Programm sein, nicht nur eines unserer Spiele) sowie die Leerlaufzeit
  in Sekunden als Zahl. Der Server nutzt das nur, wenn es zu einem der konfigurierten Spiele passt –
  alles andere wird verworfen und nirgends gespeichert oder angezeigt. Wer das nicht möchte, lässt
  `trackActivity` einfach auf `false`.

## Als eigenständige `.exe` paketieren

Für den Ein-Klick-Download oben braucht der Server eine gebaute `.exe` unter
`server/agent-dist/lan2026-agent.exe` (siehe dessen README). Gebaut wird sie mit
[`pkg`](https://github.com/yao-pkg/pkg) (gepflegter Fork), auf einer Maschine mit normalem
Internetzugang (pkg lädt beim ersten Lauf eine Node-Runtime für das Ziel-Betriebssystem herunter):

```bash
npm install -g @yao-pkg/pkg
npx pkg src/index.js --targets node18-win-x64 --output ../server/agent-dist/lan2026-agent.exe
```

Alternativ direkt neben eine `agent.config.json` legen und manuell starten – fertig.

## Tests

```bash
npm test        # Unit-Tests: Config-Validierung, Prozessnamen-Parsing
npm run test:e2e  # Startet den echten Server + den echten Agent-Loop und prüft das Live-Board
```
