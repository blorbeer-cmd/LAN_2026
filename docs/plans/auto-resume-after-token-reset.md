# Konzept: Automatische Wiederaufnahme von Claude-Code- und Codex-Sessions nach Token-Reset (Windows)

Ziel dieses Dokuments: ein Konzept und eine Schritt-für-Schritt-Anleitung, damit lokal auf dem
Windows-Rechner unterbrochene Claude-Code- und Codex-Sessions nach dem Zurücksetzen des
Nutzungslimits (Token-Reset) **automatisch weiterarbeiten**, ohne dass jede Session manuell neu
angestoßen werden muss.

Abgrenzung: `docs/plans/auto-feature-to-deploy-pipeline.md` behandelt Nutzungslimits auf der
GitHub-Seite (PR-Automatik, Label `auto:waiting`). Dieses Dokument behandelt die **lokale Seite**:
Sessions in Terminals bzw. Konversationen auf dem eigenen Windows-Rechner.

## 1. Ausgangslage

- Beide CLIs unterliegen rollierenden Nutzungslimits: Claude (Abo) mit 5-Stunden-Fenster plus
  Wochenlimit, Codex ebenfalls mit 5-Stunden- und Wochenfenster. Nach Ablauf des Fensters setzt
  sich das Limit von selbst zurück.
- Trifft eine Session das Limit, stoppt sie mit einer Meldung wie
  „Claude usage limit reached. Your limit will reset at …“ bzw.
  „You've hit your usage limit. Try again at …“. Danach passiert nichts mehr, bis jemand die
  Session von Hand fortsetzt.
- Beide CLIs speichern Konversationen lokal und können sie per Kommando fortsetzen – auch
  **nicht-interaktiv** (headless), also ohne offenes Terminalfenster:

| CLI | Sessions liegen unter | Fortsetzen (interaktiv) | Fortsetzen (headless) |
|---|---|---|---|
| Claude Code | `%USERPROFILE%\.claude\projects\<Projektpfad>\*.jsonl` | `claude --continue` bzw. `claude --resume <session-id>` | `claude -p "<Prompt>" --continue` (im Projektordner) |
| Codex | `%USERPROFILE%\.codex\sessions\` | `codex resume --last` bzw. `codex resume <session-id>` | `codex exec resume --last "<Prompt>"` |

Genaue Flags vor der Einrichtung einmal gegen die installierte Version prüfen
(`claude --help`, `codex exec resume --help`) – beide CLIs entwickeln sich schnell.

## 2. Zielbild

Ein kleines PowerShell-Skript („Resume-Runner“) plus Windows-Aufgabenplanung:

```
Session läuft ins Limit
  └─ Projekt landet in einer Warteschlangen-Datei (pending.txt)
       └─ Aufgabenplanung startet den Resume-Runner stündlich
            ├─ Limit noch aktiv → CLI meldet Limit-Fehler → Eintrag bleibt in der Queue,
            │                      nächster Lauf in einer Stunde versucht es erneut
            └─ Limit zurückgesetzt → Session wird headless mit dem Prompt
                                     „Mach an der Stelle weiter, an der du unterbrochen
                                     wurdest“ fortgesetzt → Eintrag wird aus der Queue entfernt
```

Entwurfsentscheidungen:

1. **Stündliches Polling statt Reset-Zeitpunkt parsen.** Die Limit-Meldungen enthalten zwar den
   Reset-Zeitpunkt, aber Format und Wortlaut ändern sich immer wieder. Ein stündlicher
   Wiederholungsversuch ist robuster, kostet bei aktivem Limit fast nichts (der Aufruf schlägt
   sofort fehl) und verspätet die Wiederaufnahme um maximal ~1 Stunde. Wer schneller sein will,
   stellt den Task auf 15/30 Minuten.
2. **Explizite Warteschlange statt „alle Projekte blind fortsetzen“.** Nur Sessions, die
   tatsächlich wegen eines Limits hängen, stehen in `pending.txt`. Das verhindert, dass der
   Runner abgeschlossene Konversationen sinnlos „weiterführt“ und dabei Tokens verbrennt.
   Einträge kommen auf zwei Wegen hinein:
   - **Manuell (Standard, eine Zeile):** Wenn eine Session ins Limit läuft, einmal
     `resume-queue.ps1 add` im Projektordner ausführen (Abschnitt 4, Schritt 3).
   - **Automatisch (optional):** Der Runner selbst re-queued Einträge, deren Fortsetzung erneut
     am Limit scheitert. Läuft also ein headless fortgesetzter Lauf wieder ins Limit, bleibt das
     Projekt automatisch in der Queue – nur der allererste Eintrag ist Handarbeit.
3. **Headless-Fortsetzung setzt die Konversation fort, nicht das Terminalfenster.** Ein offenes
   interaktives Fenster bleibt an der Limit-Meldung stehen. Der Runner führt dieselbe
   Konversation im Hintergrund weiter; das Ergebnis steht anschließend im Session-Verlauf und
   lässt sich jederzeit wieder interaktiv öffnen (`claude --resume` bzw. `codex resume`). Das
   alte Fenster kann man einfach schließen.
4. **Kill-Switch:** Task in der Aufgabenplanung deaktivieren oder `pending.txt` leeren – mehr
   Zustand gibt es nicht.

## 3. Leitplanken für unbeaufsichtigte Läufe

- **Berechtigungen bewusst wählen.** Ein headless fortgesetzter Lauf kann keine
  Berechtigungs-Rückfragen beantworten:
  - Claude Code: `--permission-mode acceptEdits` erlaubt Dateiänderungen im Projekt, fragt aber
    weiterhin bei allem anderen – nicht Beantwortbares bleibt dann liegen und die Session stoppt
    sauber. Wer mehr Autonomie will, pflegt eine Allow-List in `.claude/settings.json` statt
    pauschal `--dangerously-skip-permissions` zu setzen. Der Skip-Schalter gehört nicht in einen
    unbeaufsichtigten, stündlich laufenden Task.
  - Codex: `codex exec` läuft ohnehin nicht-interaktiv in der Sandbox; `--sandbox
    workspace-write` (bzw. `--full-auto`) erlaubt Schreibzugriff im Arbeitsbereich. Netzwerk-
    oder Vollzugriff nicht pauschal freischalten.
- **Ein Lauf pro Projekt gleichzeitig.** Der Runner arbeitet die Queue sequenziell ab und legt
  eine Lock-Datei an, damit sich überlappende Task-Starts nicht dieselbe Session doppelt
  fortsetzen.
- **Logs statt Blindflug.** Jeder Lauf schreibt nach `logs\resume-YYYY-MM-DD.log`, damit
  nachvollziehbar bleibt, was nachts passiert ist.
- **Fortsetzungs-Prompt bleibt neutral.** Er sagt nur „mach weiter“, erteilt aber keine neuen
  Aufträge – die Session soll ihren ursprünglichen Auftrag zu Ende bringen, nichts anderes.

## 4. Schritt-für-Schritt-Anleitung (Windows)

### Schritt 0 – Voraussetzungen

1. Claude Code und Codex CLI sind installiert und eingeloggt (`claude --version`,
   `codex --version`; einmal interaktiv starten und Login prüfen).
2. PowerShell 5.1 oder neuer (in Windows enthalten; `pwsh` von PowerShell 7 funktioniert ebenso).
3. Einmalig prüfen, dass beide CLIs in einer **nicht-interaktiven** Shell gefunden werden:
   `powershell -NoProfile -Command "claude --version; codex --version"`. Schlägt das fehl, den
   Installationspfad in das Skript aus Schritt 2 eintragen (Variablen `$ClaudeCmd`/`$CodexCmd`).

### Schritt 1 – Arbeitsordner anlegen

```powershell
New-Item -ItemType Directory -Force C:\tools\agent-resume, C:\tools\agent-resume\logs | Out-Null
```

### Schritt 2 – Runner-Skript `C:\tools\agent-resume\resume-agents.ps1` anlegen

```powershell
# Setzt wegen Nutzungslimit unterbrochene Claude-Code-/Codex-Sessions headless fort.
# Queue-Format (pending.txt), eine Zeile pro Session:
#   claude|C:\Pfad\zum\Projekt
#   codex|C:\Pfad\zum\Projekt
$ErrorActionPreference = 'Continue'
$Base      = 'C:\tools\agent-resume'
$Queue     = Join-Path $Base 'pending.txt'
$Lock      = Join-Path $Base 'run.lock'
$LogFile   = Join-Path $Base ("logs\resume-{0:yyyy-MM-dd}.log" -f (Get-Date))
$ClaudeCmd = 'claude'   # ggf. voller Pfad, z. B. "$env:USERPROFILE\.local\bin\claude.exe"
$CodexCmd  = 'codex'    # ggf. voller Pfad
$Prompt    = 'Du wurdest durch das Nutzungslimit unterbrochen. Mach genau an der Stelle weiter, an der du aufgehoert hast, und schliesse den urspruenglichen Auftrag ab. Keine neuen Aufgaben beginnen.'

function Log($msg) { "{0:u}  {1}" -f (Get-Date), $msg | Tee-Object -FilePath $LogFile -Append }

if (-not (Test-Path $Queue)) { return }
if (Test-Path $Lock) { Log 'Lock vorhanden, anderer Lauf aktiv - Abbruch.'; return }
New-Item -ItemType File $Lock | Out-Null
try {
  $entries = Get-Content $Queue | Where-Object { $_.Trim() -ne '' } | Select-Object -Unique
  $remaining = @()
  foreach ($entry in $entries) {
    $tool, $dir = $entry -split '\|', 2
    if (-not (Test-Path $dir)) { Log "Pfad fehlt, Eintrag verworfen: $entry"; continue }
    Log "Setze fort: $entry"
    Push-Location $dir
    try {
      if ($tool -eq 'claude') {
        $out = & $ClaudeCmd -p $Prompt --continue --permission-mode acceptEdits 2>&1
      } else {
        $out = & $CodexCmd exec resume --last --sandbox workspace-write $Prompt 2>&1
      }
      $text = $out | Out-String
      if ($LASTEXITCODE -ne 0 -and $text -match '(usage limit|rate limit|try again)') {
        Log "Limit weiterhin aktiv, bleibt in der Queue: $entry"
        $remaining += $entry
      } elseif ($LASTEXITCODE -ne 0) {
        Log "Fehlgeschlagen (Exit $LASTEXITCODE), bleibt in der Queue: $entry"
        Log ($text.Trim())
        $remaining += $entry
      } else {
        Log "Erfolgreich fortgesetzt: $entry"
      }
    } finally { Pop-Location }
  }
  Set-Content -Path $Queue -Value $remaining
} finally { Remove-Item $Lock -ErrorAction SilentlyContinue }
```

### Schritt 3 – Queue-Helfer `C:\tools\agent-resume\resume-queue.ps1` anlegen

Damit das Eintragen einer hängenden Session ein Einzeiler ist:

```powershell
# Aufruf im Projektordner:  resume-queue.ps1 add [claude|codex]
param([string]$Action = 'add', [ValidateSet('claude','codex')][string]$Tool = 'claude')
$Queue = 'C:\tools\agent-resume\pending.txt'
switch ($Action) {
  'add'  { Add-Content $Queue "$Tool|$(Get-Location)"; Write-Host "Eingetragen: $Tool|$(Get-Location)" }
  'list' { if (Test-Path $Queue) { Get-Content $Queue } }
  'clear'{ Clear-Content $Queue -ErrorAction SilentlyContinue; Write-Host 'Queue geleert.' }
}
```

Optional den Ordner in den `PATH` aufnehmen, dann genügt künftig `resume-queue add codex`.

### Schritt 4 – Geplante Aufgabe anlegen

Per PowerShell (**als normaler Benutzer**, kein Admin nötig):

```powershell
$action  = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument '-NoProfile -ExecutionPolicy Bypass -File C:\tools\agent-resume\resume-agents.ps1'
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(5) `
  -RepetitionInterval (New-TimeSpan -Hours 1)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable `
  -DontStopOnIdleEnd -ExecutionTimeLimit (New-TimeSpan -Hours 2)
Register-ScheduledTask -TaskName 'Agent-Session-Resume' `
  -Action $action -Trigger $trigger -Settings $settings
```

Oder über die GUI (Aufgabenplanung → „Einfache Aufgabe erstellen“):

1. Name: `Agent-Session-Resume`.
2. Trigger: „Täglich“, danach in den Task-Eigenschaften unter *Trigger → Bearbeiten →
   Erweiterte Einstellungen*: „Wiederholen jede: 1 Stunde, für die Dauer von: 1 Tag“.
3. Aktion: Programm `powershell.exe`, Argumente
   `-NoProfile -ExecutionPolicy Bypass -File C:\tools\agent-resume\resume-agents.ps1`.
4. In den Eigenschaften: „Nur ausführen, wenn der Benutzer angemeldet ist“ belassen (die CLIs
   nutzen das Login-Profil des Benutzers) und „Aufgabe so schnell wie möglich nach einem
   verpassten Start ausführen“ aktivieren.

Wichtig: Der Task muss **unter dem eigenen Benutzerkonto** laufen, weil Claude- und
Codex-Anmeldedaten im Benutzerprofil liegen (`%USERPROFILE%\.claude`, `%USERPROFILE%\.codex`).

### Schritt 5 – Funktionstest (einmalig, ohne auf ein echtes Limit zu warten)

1. In einem Testprojekt eine kleine Claude-Session starten und beenden.
2. Dort `resume-queue.ps1 add claude` ausführen.
3. Den Task von Hand starten: `Start-ScheduledTask -TaskName 'Agent-Session-Resume'`.
4. Prüfen: `logs\resume-<Datum>.log` enthält „Erfolgreich fortgesetzt“, `pending.txt` ist leer,
   und `claude --resume` im Testprojekt zeigt die fortgesetzte Konversation.
5. Analog einmal mit `codex` testen.

### Ab jetzt im Alltag

Läuft eine Session ins Limit: einmal `resume-queue.ps1 add` (bzw. `… add codex`) im
Projektordner ausführen, Fenster kann zu bleiben oder geschlossen werden. Der Rest passiert
automatisch nach dem nächsten Token-Reset; das Ergebnis steht im Log und im Session-Verlauf.

## 5. Grenzen und Risiken

- **Offene Rückfragen stoppen den Lauf.** Braucht die fortgesetzte Session eine Entscheidung
  (Berechtigung, inhaltliche Rückfrage), endet der Headless-Lauf dort. Das ist gewollt – lieber
  sauber stehen bleiben als unbeaufsichtigt raten. Der Log-Eintrag zeigt, wo es hakt.
- **`--continue` bzw. `resume --last` nimmt die jeweils letzte Session des Projekts.** Wer in
  einem Projekt mehrere parallele Konversationen führt, sollte den Queue-Eintrag um die konkrete
  Session-ID erweitern (`claude --resume <id>` / `codex exec resume <id>`); das Queue-Format
  lässt sich dafür um ein drittes Feld ergänzen.
- **Wochenlimit statt 5-Stunden-Fenster:** Ist das Wochenkontingent erschöpft, versucht der Task
  tagelang stündlich sein Glück. Das ist harmlos (sofortiger Fehlschlag), steht aber im Log –
  bei Bedarf Task pausieren.
- **CLI-Änderungen:** Flag-Namen (`--permission-mode`, `exec resume`, Fehlertexte der
  Limit-Meldungen) können sich mit CLI-Updates ändern. Nach größeren Updates einmal den
  Funktionstest aus Schritt 5 wiederholen; die Limit-Erkennung im Skript matcht bewusst
  großzügig (`usage limit|rate limit|try again`).
- **Keine Interaktion mit laufenden Terminalfenstern:** Der Ansatz tippt nichts in offene
  Fenster (kein SendKeys o. Ä. – zu fragil). Wer die Fortsetzung im Fenster sehen will, öffnet
  die Session danach erneut interaktiv.

## 6. Nicht Bestandteil dieses Vorhabens

- Keine Änderungen am Server-, Agent- oder Frontend-Code dieses Repositories; die Skripte leben
  bewusst außerhalb des Repos auf dem Windows-Rechner.
- Keine Umgehung von Nutzungslimits – der Mechanismus wartet ausschließlich auf den regulären
  Reset.
- Die GitHub-seitige Limit-Behandlung der PR-Automatik bleibt unverändert
  (`docs/plans/auto-feature-to-deploy-pipeline.md`, Abschnitt 6).
