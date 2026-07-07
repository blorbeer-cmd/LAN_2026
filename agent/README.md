# LAN 2026 – Agent

Kleines Programm, das auf jedem Spieler-PC läuft. Es kennt nur drei Dinge: die Server-URL, den
eigenen API-Key und wie oft es nachschauen soll. Es scannt periodisch die laufenden Prozesse und
meldet sie dem Server – die Zuordnung „welcher Prozessname gehört zu welchem Spiel" liegt zentral
auf dem Server (`⚙️ Spiele verwalten` im Web-Tool) und muss hier nicht gepflegt werden.

## Einrichtung

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

Damit auf den Spieler-PCs kein Node.js installiert sein muss, lässt sich der Agent mit
[`pkg`](https://github.com/yao-pkg/pkg) (gepflegter Fork) bündeln:

```bash
npm install -g @yao-pkg/pkg
pkg . --targets node18-win-x64 --output lan2026-agent.exe
```

Die erzeugte `lan2026-agent.exe` neben eine `agent.config.json` legen und starten – fertig.

## Tests

```bash
npm test        # Unit-Tests: Config-Validierung, Prozessnamen-Parsing
npm run test:e2e  # Startet den echten Server + den echten Agent-Loop und prüft das Live-Board
```
