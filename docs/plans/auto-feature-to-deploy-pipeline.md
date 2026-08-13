# Konzept: Automatisierte Agenten-Pipeline bis zum menschlich freigegebenen Merge

Status: beschlossenes Zielkonzept; Phasen 0 bis 2 umgesetzt (Task-Vertrag, Labels, stateless
Readiness-Reconciler) sowie Phase 7 (Commit-Status `Agent pipeline / ready for human merge`, aktiv
als Required Check auf `main`). Aus Phase 4 sind die Pilotpfade Codex-Implementierung →
Claude-Cross-Review und Claude-Implementierung → Codex-Cross-Review umgesetzt; Self-Review ist
in beiden Provider-Richtungen pilotiert. Die Sechs-Felder-Matrix ist table-driven abgesichert.
Die post-#396 Human-Pilotfälle in beiden Implementierer-Richtungen sind noch nicht abgenommen.
Für Codex-Implementierungen liefert der externe Task-Monitor inzwischen jeden distincten
Current-Head-CI-Fehlversuch sowie fehlgeschlagene post-merge `main`-CI/CD-Läufe zurück an die
ursprüngliche Task; diese informiert den Nutzer und führt die sichere Fix-/Retry-Arbeit automatisch
fort. Ein unabhängiger Fix-Worker, Claude-Session-Zustellung, Konflikt-Fixes, formale Rundenzähler
und die vollständige Findings-Fix-Schleife fehlen weiterhin. Stand: 2026-08-13

Der Reviewer wird nicht mehr automatisch bestimmt, sondern vom Nutzer pro Head-SHA gewählt. Die
Herleitung dieser Änderung steht in [`review-mode-selection.md`](review-mode-selection.md), der
Ablauf in `.github/agent-pipeline/review-decision.md`.

Dieses Dokument beschreibt, wie eine Aufgabe von Codex oder Claude Code implementiert, vom
jeweils anderen Coding-Agent geprüft und anhand der Review-Findings automatisch korrigiert wird.
CI-Fehler und Mergekonflikte werden ebenfalls automatisch bearbeitet. Der Ablauf endet bei einem
vollständig geprüften, merge-bereiten Pull Request. **Den Merge gibt ausschließlich der Nutzer
frei.** Ein Push auf `main` startet danach wie bisher die bestehende CI/CD- und Deployment-Pipeline.

Das Konzept ersetzt den ursprünglichen Stand aus PR #173. Insbesondere entfallen Auto-Merge,
Review-Skip und eine automatische Changelog-Änderung nach dem Merge.

## 1. Ziel und Abgrenzung

### Ziel

Ein Nutzer stellt einem Coding-Agent eine Aufgabe. Danach läuft alles automatisch, mit genau einer
wiederkehrenden Entscheidung des Nutzers — wer das Review durchführt:

1. Implementierung auf einem eigenen Branch und Eröffnung eines Draft-PRs.
2. Ausführung der bestehenden Pflichtprüfungen; ein Draft blockiert dabei weder die
   Review-Auswahl noch den Review-Start.
3. Automatische Behebung von CI-Fehlern und Mergekonflikten durch den Implementierungs-Agent.
4. Aktive, genau einmalige Zustellung der Review-Auswahl für den aktuellen Head-SHA und Auswahl des
   Modus durch den Nutzer, mit Empfehlung:
   - `cross`: Review durch den jeweils anderen Anbieter.
   - `self`: Review durch den Implementierungs-Anbieter in einer frischen, isolierten und
     schreibgeschützten Session.
   - `human`: Review durch den Nutzer selbst.
5. Automatischer Start des gewählten Reviews, automatische Umsetzung berechtigter Review-Findings
   und danach erneut Auswahl und vollständiges Review für den neuen Head-SHA.
6. Bei UI/UX-Änderungen eine Nachricht mit Änderung, Branch, PR und Prüfanleitung.
7. Abschließender Status `agent:ready-for-merge`; erst danach entscheidet der Nutzer über den
   Merge.

### Nicht Bestandteil

- Kein automatischer Merge und kein automatisches Aktivieren von Auto-Merge.
- Keine Umgehung von Nutzungslimits oder Sicherheitsgrenzen.
- Kein automatisches Überspringen eines Reviews.
- Keine Wahl des Review-Modus durch einen Agenten. Eine interaktive Session setzt das
  `review:*`-Label als Übertragung einer ausdrücklichen Nutzerantwort; sie erfindet, ändert oder
  ersetzt es nie. Unbeaufsichtigte Automatik — Reconciler, Dispatcher, Review-Session, CI-Job —
  setzt es nie, denn ein Agent, der seinen eigenen Reviewmodus wählt, bedient sich am Merge-Gate.
- Kein stillschweigender Wechsel des Review-Modus bei Anbieter-Ausfall und kein Auto-Start nach
  Zeitablauf, wenn die Auswahl unbeantwortet bleibt.
- Keine Agenten-Schreibrechte auf `main` und keine Deploy-Berechtigungen für Agenten.
- Keine automatische Änderung von `.github/workflows/**`, `infra/**`, Secrets oder
  Branch-Protection durch die laufende Pipeline.
- Keine automatische Changelog-Pflege nach dem Merge. Eine solche Historienpflege wäre ein
  eigener, vom Nutzer freizugebender Auftrag.
- Keine Automatisierung der fachlichen Aufgabenplanung vor dem Implementierungsauftrag.

## 2. Bestehende Grundlage

- `.github/workflows/deploy.yml` klassifiziert Änderungen und führt die einschlägigen Server-,
  Frontend-, E2E-, Agent- und Image-Prüfungen aus.
- Ein Push auf `main` veröffentlicht und deployt weiterhin automatisch. Die vorhandene
  `production-deploy`-Concurrency und das Rollback bleiben unverändert.
- `main` verlangt aktuell einen aktuellen Branch, die bestehenden Pflichtchecks und aufgelöste
  Review-Konversationen. Force-Pushes und Branch-Löschung sind gesperrt.
- Auto-Merge ist deaktiviert und bleibt deaktiviert.
- Codex und Claude können bereits Branches bzw. PRs bearbeiten. Vor der Automatisierung müssen
  ihre konkreten GitHub-Identitäten und Schreibrechte auf Feature-Branches verifiziert werden.

## 3. Zielablauf

```text
Aufgabe an Codex oder Claude
  └─ Implementierung auf Feature-Branch
       └─ Draft-PR + Task-Vertrag
            ├─ CI rot ───────────────→ Implementierungs-Agent korrigiert ─┐
            ├─ Mergekonflikt ─────────→ Implementierungs-Agent löst ihn ──┤
            └─ CI grün + konfliktfrei (auch im Draft)                      │
                 └─ Auswahl an den Nutzer: Empfehlung + a/b/c              │
                      ├─ keine Antwort → `awaiting-review-decision`, nichts startet
                      ├─ a) `review:cross`  → Gegen-Anbieter reviewt        │
                      ├─ b) `review:self`   → frische, read-only Session    │
                      │                        des Implementierungs-Anbieters
                      ├─ c) `review:human`  → Nutzer reviewt selbst         │
                      │                                                     │
                      ├─ gewählter Anbieter nicht verfügbar → melden        │
                      │   und erneut zur Auswahl                            │
                      ├─ Findings → Implementierungs-Agent korrigiert ──────┘
                      └─ Verdikt `pass` zum aktuellen Head-SHA
                           ├─ ggf. UI/UX-Nachricht an Nutzer
                           └─ `agent:ready-for-merge`
                                └─ Nutzer prüft und merged
                                     └─ bestehendes Deployment
```

Jeder neue Commit macht ein vorheriges positives Review ungültig. Der aktuelle Head-SHA muss
erneut CI und Review durchlaufen — und erneut die Auswahl des Review-Modus, weil ein an einen
früheren Head gebundenes Wahl-Label verfällt.

## 4. Rollen und Review-Unabhängigkeit

| Modus            | Reviewer                                       | Findings/Fixes         | Unabhängigkeit                               |
| ---------------- | ---------------------------------------------- | ---------------------- | -------------------------------------------- |
| `cross` (Normal) | Gegen-Anbieter (Claude ↔ Codex)                | Implementierungs-Agent | höchste                                      |
| `self`           | frische, isolierte Session desselben Anbieters | Implementierungs-Agent | reduziert, bewusst gewählt                   |
| `human`          | Nutzer                                         | Implementierungs-Agent | Review und Merge liegen bei derselben Person |

Der Cross-Review bleibt der empfohlene Normalfall. `self` und `human` sind kein Überspringen des
Reviews, sondern ein Review mit geringerer Unabhängigkeit; sie gelten nur, wenn der Nutzer sie für
den konkreten Head-SHA gewählt hat, und sind über das gesetzte `review:*`-Label und den
Statuskommentar dauerhaft nachvollziehbar. `agent:review-fallback` bleibt dem Fall vorbehalten, in
dem der zuerst gewählte Anbieter ausgefallen ist.

### Anforderungen an ein Review durch den Implementierungs-Anbieter (`self`, `fallback`)

- Neue Session beziehungsweise neuer Review-Subagent; niemals die Implementierungs-Konversation
  einfach um eine Selbsteinschätzung bitten.
- Kein Zugriff auf den Implementierungs-Chatverlauf oder dessen Begründungskette.
- Als Kontext nur Task-Vertrag, Repository-Regeln, Diff gegen `main`, CI-Ergebnisse und bereits
  veröffentlichte PR-Diskussion.
- Frischer Checkout oder Worktree auf dem geprüften Head-SHA.
- Read-only muss technisch abgesichert sein; eine reine Prompt-Anweisung genügt nie. Es gibt zwei
  ausreichende Stufen: `true` — Sandbox, Berechtigungsmodus **und** schreibgeschützte Credentials —
  sowie `verified` — Werkzeugentzug, gesperrte schreibende git-/gh-Befehle, eigener auf den Head-SHA
  detachter Worktree und eine Prüfung von außen nach der Session, dass darin nichts verändert wurde.
  Welche Stufe genügt, legt `selfReviewMinimumEnforcement` fest (Standard `verified`). Erreicht die
  gewählte Oberfläche nicht einmal `verified`, gilt der Reviewer als nicht verfügbar.
- `verified` ist bewusst schwächer als `true`: die Prüfung erkennt eine Verletzung, sie verhindert
  sie nicht. Sie existiert, weil `true` in Umgebungen, deren einzige Credentials pushen können, gar
  nicht erreichbar ist — dort war `self` vorher schlicht unbenutzbar, was kein Sicherheitsgewinn ist,
  sondern ein Verfahren, das unbemerkt aufhört zu funktionieren.
- Gleiches strukturiertes Reviewformat und dieselben Qualitätsregeln wie beim Cross-Review.
- Das Ergebnis muss Anbieter, Sessiontyp und geprüften Head-SHA nennen.

Eine neue Session behebt Kontextprobleme, aber kein kontoweites Nutzungslimit. Ist auch der
Implementierungs-Anbieter nicht verfügbar, wechselt der PR zu `agent:waiting` und wird nach dem
regulären Limit-Reset erneut versucht. Es gibt keinen Pfad, der ein Review überspringt: `human`
verlagert das Review auf den Nutzer, statt es zu entfallen.

## 5. Task-Vertrag und sichere Klassifikation

Jeder automatisierte PR enthält einen maschinenlesbaren Task-Vertrag, beispielsweise als
HTML-Kommentar im PR-Text:

```text
task-id: agent-20260726-001
implementer: codex
base-branch: main
base-sha: <sha>
head-branch: codex/<name>
scope: frontend
ui-change: yes|no|unknown
max-ci-fix-rounds: 3
max-review-rounds: 3
```

Der sichtbare Teil des PR-Texts nennt zusätzlich Ziel, Abnahmekriterien, geänderte Bereiche,
Prüfungen und bekannte Einschränkungen.

Branchpräfix und PR-Autor sind nur Plausibilitätsmerkmale. Die Automatik startet ausschließlich,
wenn Task-Vertrag, Branch, Head-Repository und erlaubte GitHub-App-Identität zusammenpassen.
Fork-PRs nehmen nicht an der schreibenden Automatik teil.

## 6. Zustandsmodell

### Sichtbare Labels

| Label                   | Bedeutung                                                         |
| ----------------------- | ----------------------------------------------------------------- |
| `agent:pipeline`        | PR nimmt an der Automatik teil                                    |
| `agent:implementing`    | Implementierungs-Agent arbeitet                                   |
| `agent:ci-fix`          | CI-Fehler wird bearbeitet                                         |
| `agent:conflict-fix`    | Mergekonflikt wird bearbeitet                                     |
| `agent:review`          | gewähltes Review läuft oder steht aus                             |
| `agent:review-fallback` | Ausweichreview, weil der zuerst gewählte Anbieter ausgefallen ist |
| `review:cross`          | Nutzerwahl: Review durch den Gegen-Anbieter                       |
| `review:self`           | Nutzerwahl: isoliertes Review des Implementierungs-Anbieters      |
| `review:human`          | Nutzerwahl: menschliches Review                                   |
| `agent:waiting`         | benötigter Anbieter oder Dienst ist vorübergehend nicht verfügbar |
| `agent:needs-human`     | kritische Entscheidung oder Rundenlimit erreicht                  |
| `agent:ready-for-merge` | alle maschinellen Gates für den aktuellen Head-SHA erfüllt        |
| `ui:changed`            | PR enthält eine sichtbare UI/UX-Änderung                          |
| `agent:no-auto`         | manueller Kill-Switch für diesen PR                               |

### Maschinenzustand

Die drei `review:*`-Labels gehören dem Nutzer. Unbeaufsichtigte Automatik setzt sie nie. Eine
interaktive Agenten-Session darf genau eines ausschließlich als Übertragung einer ausdrücklichen,
zum aktuellen Head-SHA gehörenden Nutzerantwort setzen. Die Pipeline entfernt genau eines davon:
das an einen früheren Head gebundene, damit die Auswahl für den neuen Head erneut gestellt wird
statt eine alte Antwort auf ungesehenen Code anzuwenden. Welcher Head zu einer Wahl gehört, hält
die Pipeline in ihrem eigenen Statuskommentar fest; die Label-Historie des Pull Requests bleibt
der eigentliche Prüfpfad, wer wann welchen Modus gewählt hat.

Labels sind nicht der alleinige Zustandsspeicher. Ein einzelner, von der Pipeline aktualisierter
Status enthält mindestens:

- Task-ID und PR-Nummer,
- Implementierungs- und Review-Anbieter,
- gewählten Review-Modus und den Head-SHA, für den er gilt,
- aktuellen Head-SHA und zuletzt geprüften SHA,
- CI-Fix-, Konflikt- und Reviewrunde,
- reguläres oder Fallback-Review,
- letzte Aktion und Zeitstempel,
- UI/UX-Benachrichtigungsstatus,
- SHA-gebundener Zustellungsstatus der Review-Auswahl und gegebenenfalls Zustellungsfehler,
- gegebenenfalls Warte- oder Eskalationsgrund.

Die Umsetzung kann dafür einen eindeutig markierten, aktualisierbaren PR-Kommentar plus einen
Commit-Status verwenden. Kommentare werden nicht als Rundenzähler ausgewertet. Jeder Übergang ist
idempotent: derselbe Event darf weder eine zweite Agenten-Session noch einen zweiten Fix starten.

`concurrency` serialisiert Mutationen pro PR. Ein regelmäßiger Reconciler prüft zusätzlich offene
PRs, falls Webhooks, Kommentare oder Anbieterreaktionen verloren gehen.

Die Review-Auswahl wird nicht nur in diesem Sticky-Status gerendert. Sobald alle Vorbedingungen
erfüllt sind, erzeugt der Reconciler einen neuen, `AGENT_PIPELINE_OWNER` erwähnenden PR-Kommentar
mit Head-SHA, Implementierer, Gegenanbieter, Änderungsumfang seit der letzten Review-Runde,
vorherigen Finding-Schweregraden, offenen Threads, Provider-/Timeout-Zustand, Empfehlung,
Begründung und a/b/c. Der Marker
`agent-pipeline:review-decision-notification <head-sha>` dedupliziert alle Wiederholungsläufe. Ein
neuer Head erhält nach erneut grünen Vorbedingungen eine neue Nachricht; die alte Wahl verfällt.
Scheitert die Zustellung, werden Sticky-Kommentar und Commit-Status sichtbar auf
`review-decision-delivery-failed` gesetzt und der Workflow schlägt fehl.

Eine direkte Codex-Task-Zustellung bleibt aus GitHub Actions nicht verfügbar: Die in der
Desktop-App vorhandenen Thread-Werkzeuge sind keine aus einem Repository-Workflow aufrufbare API.
Der externe Adapter läuft deshalb als einzelner Codex-seitiger Fünf-Minuten-Heartbeat-Monitor.
GitHub bildet seine dauerhafte Outbox; der Monitor beobachtet Zustellmarker, provider-spezifische
Review-Check-Runs, Current-Head-CI-Checks und abgeschlossene `main`-CI/CD-Läufe, ordnet PR und
`task-id` über das optionale `codex-thread-id` oder den eindeutigen Head-Branch der ursprünglichen
Codex-Task zu, weckt diese und quittiert erst nach erfolgreichem Versand mit
`agent-pipeline:codex-delivery`. Ein tatsächlich laufender oder erfolgreich angenommener Review-
Check erzeugt dabei eine positive Startmeldung; ein bloßer Workflow-Trigger nicht. Leere Scans
bleiben bei `failed_runs_only` still. Für
Claude-Implementierungen existiert keine belastbare Claude-Session-Wakeup-Schnittstelle; der
Adapter erzeugt für sie deshalb keine Codex-Zustellereignisse und erfindet keine Task-ID. GitHub
bleibt deren dokumentierte Outbox. Die interaktive Task überträgt weiterhin nur eine ausdrückliche
Antwort für denselben Head-SHA als genau eines der drei Labels.

## 7. CI-Fehler und Mergekonflikte

### CI-Fehler

1. Fehlgeschlagenen Workflow, Jobs und Logs erfassen.
2. Infrastruktur-/Providerfehler von einem reproduzierbaren Codefehler unterscheiden.
3. Implementierungs-Agent mit Run-Link und betroffenen Jobs beauftragen.
4. Ursache beheben, die einschlägigen lokalen Prüfungen ausführen und pushen.
5. Ursache, Änderung und Prüfergebnis im PR dokumentieren.
6. Maximal drei echte Fix-Runden. Ein bloßer Retry ohne Codeänderung zählt nur, wenn ein
   nachgewiesener transienter Infrastrukturfehler vorlag.

Tests dürfen nicht gelöscht, gelockert oder mit pauschalen Timeouts überdeckt werden, um einen
Lauf grün zu bekommen.

### Testlauf-Regressionen

Die CI misst Unit-/Integration-, Core-E2E-, Arcade-Smoke- und Arcade-E2E-Laufzeit getrennt von
Setup und Build.
Mehr als 20 Prozent und mindestens 30 Sekunden gegenüber dem Median der letzten fünf erfolgreichen
`main`-Läufe lösen zunächst einen automatischen Wiederholungslauf der auffälligen Suite aus. Der
stabile Required Check `Test performance` aggregiert Detektor und Wiederholung fail closed. Ein
bestätigter Rückschritt oder ein technischer Fehler wird zum CI-Fehler und durchläuft die normale
CI-Fix-Schleife. Der
Implementierungs-Agent untersucht dann Ursache und langsamste Tests und reduziert die Laufzeit,
ohne Abdeckung oder Assertions zu schwächen. Ist zusätzliche Laufzeit wegen notwendiger neuer
Abdeckung unvermeidbar, wird sie im PR nachvollziehbar begründet und im Review bewertet.

Core- und Arcade-E2E sind getrennte Checks. Eine getestete Pfadklassifikation startet den
vollständigen Arcade-Lauf nur für Arcade-spezifische Bereiche. Gemeinsame Dateien und unbekannte
Produktionspfade fallen sicher auf Core-E2E plus einen begrenzten Arcade-Smoke-Test zurück.
Allgemeiner Socket-Transport und Arcade-Watcher-/Kiosk-Streaming sind in getrennten Modulen
gekapselt, sodass Änderungen am allgemeinen Realtime-Modul keinen Arcade-Test benötigen. Die
gemeinsamen Unit-/Integrationstests bleiben dabei verpflichtend. Ein täglicher Volltest bleibt als
Sicherheitsnetz bestehen.

### Mergekonflikte

1. Aktuelles `main` in den Feature-Branch mergen.
2. Beide Seiten des Konflikts inhaltlich verstehen; nie pauschal `ours` oder `theirs` wählen.
3. Betroffene Prüfungen erneut ausführen und den Merge-Commit pushen.
4. Danach CI und Review für den neuen Head-SHA vollständig wiederholen.

Kein Rebase mit Force-Push. Konflikte in Authentifizierung, Datenbankmigrationen, Workflows,
Infrastruktur oder widersprüchlicher Fachlogik werden nicht geraten, sondern eskaliert.

## 8. Reviewformat und Findings-Schleife

Jedes Review liefert maschinenlesbar:

```text
reviewer-provider: claude|codex
review-mode: cross|self
reviewed-head-sha: <sha>
verdict: pass|changes-required|blocked
findings:
  - id: <finding-id>
    severity: critical|high|medium|low
    disposition: actionable|needs-human
    anchor: inline|none
    file: <path or null>
    line: <line or null>
    summary: <short text>
    rationale: <why this matters>
    verification: <how to verify the fix>
```

Actionable Findings werden als auflösbare Inline-Review-Threads mit konkretem Datei-/Zeilenanker
veröffentlicht. Top-Level-PR-Kommentare können Kontext dokumentieren, gelten aber nicht als
blockierende Findings und können das Merge-Gate nicht erfüllen. Gibt es keinen stabilen Inline-
Anker, wird mit `disposition: needs-human`, `anchor: none`, `file: null`, `line: null` und
`verdict: blocked` gekennzeichnet; die vollständigen Finding-Details bleiben im Ergebnis erhalten
und das Gate bleibt blockiert.

Der Implementierungs-Agent bearbeitet jedes Finding nachvollziehbar:

- `fixed`: Änderung und Prüfung nennen,
- `rejected`: fachliche Begründung liefern; der Reviewer entscheidet erneut. Bestätigt der Reviewer
  die Zurückweisung oder erklärt das Finding für obsolet, wird der ursprüngliche Thread ebenfalls
  abgeschlossen,
- `needs-human`: bei kritischer oder mehrdeutiger Entscheidung eskalieren.

Nach einem bestätigten `fixed`, einer akzeptierten Zurückweisung oder einer bestätigten Obsoleszenz
markiert der Implementierungs-Agent den zugehörigen Inline-Review-Thread und die darin enthaltenen
Kommentare als gelöst. Ein Finding gilt für das Merge-Gate erst als abgeschlossen, wenn die
Behebung beziehungsweise Entscheidung geprüft und die zugehörige Review-Konversation gelöst ist.

Nach jedem Fix-Commit beginnt ein vollständiger Review des neuen Head-SHAs, und zwar erneut mit der
Auswahl des Modus samt Empfehlung. Nach drei erfolglosen Reviewrunden wird nicht weiter zwischen
Agenten gependelt; der PR wechselt zu `agent:needs-human`.

Ein Review durch den Implementierungs-Anbieter besitzt in GitHub keine eigene Entsprechung. Es
veröffentlicht sein Verdikt deshalb zusätzlich als maschinenlesbaren Marker im PR. Wird das Review
über `agent-review-session.mjs --headless` gestartet, schreibt die Review-Session selbst nichts: Sie
gibt ihr Ergebnis nur aus, der Launcher prüft danach den Arbeitsbaum und hängt den Marker erst an,
wenn diese Prüfung bestanden ist. Dadurch kann eine Verletzung keinen bereits veröffentlichten
Marker hinterlassen, und die Review-Session braucht überhaupt keinen GitHub-Zugriff. Ein
Fallback-Review verwendet denselben Marker mit `mode=self` und wird durch
`agent:review-fallback` als solches ausgewiesen; einen vierten Marker-Modus kennt das Gate nicht:

```text
<!-- agent-pipeline:review-result <head-sha> mode=self verdict=pass session=<id> read-only=true -->
```

Nur ein Marker mit einer ausreichenden `read-only`-Stufe, passendem Head-SHA und `verdict=pass` von
einer dafür erlaubten Identität erfüllt das Gate. Die Autorenprüfung ist bewusst enger als
„vertrauenswürdiger Kommentarautor", der jedes `[bot]`-Konto einschließt. Im Modus `self` muss die
Identität zum Implementierungs-Anbieter gehören. Im Modus `cross` kann eine provider-spezifische,
vertrauenswürdige Workflow-Identität das strukturierte Ergebnis eines credential-read-only
Review-Laufs veröffentlichen, wenn die Anbieterintegration kein natives GitHub-Review erzeugt.
Im Modus `human` bleibt ein natives Review zum exakten Head-SHA der Nachweis: eine Approval oder,
wenn der Mensch selbst PR-Autor ist, dessen `COMMENTED`-Review. GitHub verbietet Autoren die
Approval des eigenen Pull Requests.

## 9. Nutzungslimits und Nichtverfügbarkeit

### Erkennung

- Claude: Action-Ausgang, strukturierte Fehlermeldung und bekannte Rate-/Budgetfehler auswerten.
- Codex: Reaktion auf `@codex review` sowie Review-/Kommentarereignisse beobachten. Eine bekannte
  Kontingentmeldung gilt sofort als Limit; ohne Reaktion greift ein konfigurierbarer Timeout.
- Timeout allein ist kein sicherer Beweis für ein Nutzungslimit. Der Status nennt deshalb den
  tatsächlich beobachteten Grund.

### Reihenfolge

1. Den vom Nutzer gewählten Reviewer anfordern.
2. Bei technischem Einzelfehler genau einmal neu zustellen.
3. Bei bestätigtem Limit oder erneutem Ausfall den beobachteten Grund melden und dieselbe Auswahl
   erneut vorlegen, mit angepasster Empfehlung. Kein stillschweigender Wechsel des Modus: gerade
   die Kontingentlage ist der Grund, aus dem der Nutzer diese Entscheidung selbst trifft. Wählt er
   daraufhin den Implementierungs-Anbieter, läuft dessen isoliertes Review als
   `agent:review-fallback`.
   Ein vertrauenswürdig publizierter terminaler Startfehler für den exakten Head wird dabei pro
   Workflow-Attempt genau einmal verarbeitet: Nur die fehlgeschlagene Auswahl wird gelöscht, der
   Zustand wird `awaiting-review-decision`, und keine Alternative wird automatisch gesetzt.
4. Ist kein Anbieter verfügbar und will der Nutzer nicht selbst reviewen, `agent:waiting` setzen
   und zeitgesteuert erneut versuchen.
5. Warteversuche und unbeantwortete Auswahlfragen zählen nicht als Reviewrunde.
6. Liefert ein gewähltes Review nach `waitingEscalationHours` aus `.github/agent-pipeline/config.json`
   (derzeit 2 Stunden) kein Ergebnis, meldet der Reconciler die Überfälligkeit als Blocker und als
   eigene Zeile im Statuskommentar; nur bei einer tatsächlich nötigen Entscheidung zusätzlich
   `agent:needs-human` setzen. Eine ausstehende Modus-Auswahl allein ist keine Eskalation, sondern
   der Normalzustand `awaiting-review-decision`.

Der lokale Plan `docs/plans/auto-resume-after-token-reset.md` kann unterbrochene lokale Sessions
ergänzend fortsetzen. Für parallele Arbeiten muss er konkrete Session-IDs statt `--last`
verwenden. Die GitHub-Pipeline bleibt die führende Quelle für den PR-Zustand.

## 10. UI/UX-Benachrichtigung

Eine UI/UX-Änderung wird zunächst über geänderte Pfade wie `server/public/**` erkannt. Der
Implementierungs-Agent bestätigt zusätzlich im Task-Vertrag, ob die Änderung sichtbar ist; so
werden auch serverseitig erzeugte Texte oder Zustände erfasst.

Sobald der Branch sinnvoll prüfbar ist, erhält der Nutzer eine aktualisierbare Nachricht mit:

- kurzer Beschreibung der sichtbaren Änderung,
- exaktem Branch-Namen,
- PR-Link,
- betroffenen Ansichten und relevanten Bildschirmgrößen,
- konkreten Schritten zur manuellen Prüfung,
- Screenshots oder Preview-Link, sofern verfügbar und sinnvoll,
- Hinweis auf bekannte Einschränkungen.

Verändert eine Review-Korrektur das Erscheinungsbild wesentlich, wird dieselbe Nachricht
aktualisiert. Unwesentliche Folgecommits erzeugen keine wiederholten Benachrichtigungen. Die
UI/UX-Nachricht ist Voraussetzung für `agent:ready-for-merge`, wenn `ui:changed` gesetzt ist.

## 11. Menschliches Merge-Gate

Der Required Status `Agent pipeline / ready for human merge` wird für den aktuellen Head-SHA nur
erfolgreich, wenn:

- der Task-Vertrag gültig ist,
- alle einschlägigen CI-Checks grün sind,
- kein bestätigter ungeklärter Testlauf-Rückschritt für den aktuellen Head offen ist,
- der Branch aktuell und konfliktfrei ist,
- der PR nicht mehr als Draft markiert ist,
- für den aktuellen Head-SHA genau ein Review-Modus gewählt ist,
- das Review exakt den aktuellen Head-SHA geprüft hat,
- das Review im gewählten Modus `pass` meldet: bei `cross` je nach `crossReviewEvidence` als
  Approval des Gegen-Anbieters oder — Standard — als dessen natives Review genau dieses Heads ohne
  offene Findings beziehungsweise als validierter, credential-read-only Ergebnis-Marker seines
  dedizierten Publishers; ein ausdrückliches `CHANGES_REQUESTED` oder `changes-required` blockiert.
  Weiter bei
  `self` als vertrauenswürdiger Ergebnis-Marker, dessen `read-only`-Stufe
  `selfReviewMinimumEnforcement` erreicht, bei `human` als Approval eines Menschen mit
  Schreibzugriff oder als `COMMENTED`-Review des schreibberechtigten PR-Autors,
- alle blockierenden Review-Findings erledigt und jeder zugehörige auflösbare Inline-Review-Thread
  als gelöst markiert ist,
- Thread-Snapshots für den aktuellen Head monoton versioniert sind und kein älterer Snapshot einen
  neueren Diskussionsstand überschreiben kann,
- kein `agent:waiting`, `agent:needs-human` oder `agent:no-auto` aktiv ist,
- bei UI/UX-Änderungen die Prüfinformation versendet wurde,
- Änderungen an Workflow oder Infrastruktur für den aktuellen Head ausdrücklich durch eine
  unabhängige menschliche Approval freigegeben wurden und keine Secrets automatisiert verändert
  werden. Die Autoren-`COMMENTED`-Ausnahme des Modus `human` erfüllt dieses Schutzgate nicht.

In den Modi `self` und `human` ist das Gate bewusst schwächer als beim Cross-Review: bei `self`
kann es nur prüfen, dass ein head-gebundener, vollständiger Ergebnis-Marker von einer
vertrauenswürdigen Identität stammt und welche Read-only-Stufe er nennt, nicht aber die tatsächliche
Unabhängigkeit der Session — die erreichte Stufe steht deshalb im Statuskommentar neben dem Modus; bei
`human` fallen Review und Merge auf dieselbe Person. Beides ist zulässig, weil es eine ausdrückliche
Wahl für genau diesen Head-SHA ist, als Label sichtbar bleibt und im Statuskommentar samt Hinweis
auf die reduzierte Unabhängigkeit protokolliert wird. Alle übrigen Gate-Bedingungen gelten in jedem
Modus unverändert.

Das Gate setzt `agent:ready-for-merge` und informiert den Nutzer. Es approvt und merged nicht.
Auto-Merge bleibt aus. Der Nutzer prüft den PR und führt den Merge selbst aus. Damit ist dieser
Klick zugleich die bewusste Freigabe für das anschließend automatisch startende
Produktionsdeployment.

## 12. Eskalationsregeln

### Ohne Rückfrage automatisch bearbeiten

- normale Implementierungsdetails innerhalb eindeutiger Abnahmekriterien,
- reproduzierbare CI-, Lint-, Build- und Testfehler,
- klar lösbare Mergekonflikte,
- konkrete Review-Findings mit eindeutigem Fix,
- temporäre Anbieter- und Nutzungslimits,
- Dokumentation und Tests, die unmittelbar zur Änderung gehören.

### Nutzer fragen und auf die Antwort warten

- wer das Review für den aktuellen Head-SHA durchführt. Diese Frage hält die Pipeline an, ohne sie
  zu eskalieren: kein Auto-Start nach Zeitablauf, keine Ersatzwahl durch einen Agenten.

### Nutzer informieren, aber nicht anhalten

- UI/UX-Änderung ist prüfbar,
- Fallback-Review wurde verwendet,
- zeitweiliges Warten auf einen Anbieter,
- transienter CI-Dienstfehler wurde erneut ausgeführt.

### Nutzer fragen und Pipeline anhalten

- möglicher Datenverlust oder destruktive Datenbankmigration,
- Änderung von Authentifizierung, Berechtigungen, Secrets oder Sicherheitsgrenzen,
- Änderung von Produktion, Infrastruktur oder Deployment,
- neue Architektur, neues Framework oder wesentliche Produktionsabhängigkeit,
- mehrere plausible Produktauslegungen mit deutlich unterschiedlichem Verhalten,
- notwendiges Löschen, Lockern oder Umgehen von Tests,
- semantisch riskanter Mergekonflikt,
- fachliche Uneinigkeit nach drei Reviewrunden,
- drei erfolglose echte CI-Fix-Runden,
- fehlende Berechtigung oder externer Zustand, den die Automatik nicht sicher ändern darf,
- finaler Merge.

## 13. Sicherheits- und Betriebsgrenzen

- GitHub-Workflow-Berechtigungen pro Job minimal vergeben; der globale Repository-Default kann
  read-only bleiben.
- Agenten dürfen nur den eigenen Feature-Branch ändern. Kein Token darf direkten Push auf `main`,
  Merge, Branch-Protection-Änderung oder Zugriff auf Deploy-Secrets erlauben.
- PR-validierende Workflows verwenden `pull_request_target` oder einen Default-Branch-eigenen Dispatcher,
  sodass GitHub ausschließlich die Workflowdefinition vom vertrauenswürdigen Default-Branch lädt.
  Validator und Konfiguration stammen ebenfalls ausschließlich vom Default-Branch; als PR-Base ist
  nur dieser konfigurierte Branch zulässig. Der PR-Head wird nur als Diff-Datenquelle verwendet und
  nie ausgeführt; insbesondere nie zusammen mit Schreibtoken oder Secrets.
- Schreibende Automatik nur für Branches im Hauptrepository, gültigen Task-Vertrag und erlaubte
  App-Identitäten. Der verifizierte PR-Autor muss dabei zur provider-spezifischen Allow-List passen.
- Drittanbieter-Actions auf feste Commit-SHAs pinnen und Updates bewusst prüfen.
- Aktionen des Standard-`GITHUB_TOKEN` lösen meist keine Folgeworkflows aus. Interne Übergänge
  deshalb explizit über `workflow_dispatch`/`repository_dispatch`, App-Ereignisse oder den
  Reconciler modellieren.
- Kill-Switches: Workflow deaktivieren, `agent:no-auto` pro PR und optional eine
  Repository-Variable für einen globalen Stopp.
- Jeder Agentenlauf und Zustandswechsel wird mit Task-ID, SHA, Anbieter und Ergebnis protokolliert.

## 14. Schritt-für-Schritt-Umsetzungsplan

### Phase 0 – Integrationen und Berechtigungen verifizieren

1. Claude GitHub App installieren beziehungsweise Zugriff auf das Repository prüfen.
2. `ANTHROPIC_API_KEY` oder `CLAUDE_CODE_OAUTH_TOKEN` als Actions-Secret konfigurieren.
3. Codex Cloud und Codex Code Review für das Repository aktivieren.
4. `AGENT_PIPELINE_REVIEW_REQUEST_TOKEN` als Actions-Secret hinterlegen: ein Token eines mit Codex
   verbundenen GitHub-Kontos. Die Codex-Integration weist ein `@codex review` von
   `github-actions[bot]` ab, deshalb setzt der Workflow ohne dieses Secret bewusst keine Anfrage ab
   und meldet den Fehlversuch am Pull Request.
5. Mit zwei Test-PRs prüfen:
   - `@codex review` reagiert und nennt den geprüften SHA,
   - Claude Code Action kann strukturiert reviewen,
   - beide Anbieter dürfen auf eigene Feature-Branches pushen,
   - keiner darf `main` pushen oder mergen.
6. GitHub-Benutzername für Pipeline-Benachrichtigungen als Repository-Variable hinterlegen.

Abnahme: dokumentierte Identitäten, Berechtigungen, Timeouts und tatsächlich beobachtete
Limitmeldungen beider Anbieter.

### Phase 1 – Task-Vertrag, Labels und PR-Vorlage

1. PR-Template um den Task-Vertrag und die sichtbare Zusammenfassung ergänzen.
2. Labels aus Abschnitt 6 anlegen.
3. Task-Vertrag validieren und Branch/Identität gegen eine Allow-List prüfen.
4. Ungültige oder fremde PRs sicher ignorieren und mit verständlicher Diagnose markieren.

Abnahme: gültige Agenten-PRs werden eindeutig klassifiziert; Forks und manipulierte Metadaten
erhalten keine schreibende Automatik.

### Phase 2 – Readiness-Modell und Reconciler

1. Kleine, testbare Zustandslogik implementieren, getrennt von den Workflow-YAML-Dateien.
2. Sticky-Status, Labels, SHA-Bindung, genau einmalige aktive Review-Auswahl-Zustellung und
   Rundenzähler idempotent aktualisieren.
3. `concurrency` pro PR und einen regelmäßigen Reconciler einrichten.
4. Doppelzustellung, verspätete Events und einen neuen Commit während eines Reviews testen.

Bauform: Readiness aus dem aktuellen GitHub-Stand ableiten, nicht aus einem eigenen Eventstrom.
GitHub hält Check-Runs, `mergeable_state`, Reviews und Review-Threads bereits pro SHA vor. Ein
Reconciler, der diesen Stand bei jedem Lauf vollständig liest und Readiness als reine Funktion
daraus berechnet, hat kein Ordnungsproblem: keine Sequenznummern, keine Snapshot-IDs, keine
verspäteten oder doppelten Events. Ein erster Entwurf als eventgetriebener Reducer wurde in
mehreren Reviewrunden verworfen, weil jeder Eventtyp seine Staleness-Prüfung selbst mitbringen
musste und dabei wiederholt Race Conditions entstanden. Falls doch eigener Zustand nötig wird:
genau eine zentrale Vorprüfung vor der Fallunterscheidung, genau eine Stelle, die Phase und
Blocker schreibt, und jede kopfbezogene Klassifizierung fällt bei einem neuen Head einheitlich
auf „unbekannt“ und damit blockierend zurück.

Abnahme: Ein Event kann gefahrlos mehrfach eintreffen; nur ein Agent arbeitet gleichzeitig am PR;
pro Head entsteht höchstens eine aktive Auswahlbenachrichtigung und ein Zustellungsfehler bleibt als
Pipeline-Blocker sichtbar.

### Phase 3 – Automatische CI- und Konfliktkorrektur

Teilstand: Der Codex-seitige Heartbeat erkennt für offene Codex-Agenten-PRs den jeweils neuesten
Check-Run pro Namen. Jeder neue fehlgeschlagene Versuch wird mit Job-/Run-Link an die ursprüngliche
Implementierungs-Task zugestellt und erst nach erfolgreichem Versand dauerhaft quittiert. Die Task
informiert den Nutzer, klassifiziert transient gegen reproduzierbar und setzt den normalen
Fix-/Retry-Ablauf automatisch fort; die Obergrenze ist das im Task-Vertrag des PR stehende
`max-ci-fix-rounds` und wird im Prompt genannt. Nach dem Merge werden nur aktuell ungelöste
fehlgeschlagene `CI/CD`-Runs seit dem letzten erfolgreichen `main`-Lauf über den Merge-Commit zum
Ursprungs-PR zurückverfolgt; ist diese Erfolgsgrenze im geblätterten Fenster nicht sichtbar, wird
gar nichts zugestellt statt eine abgeschnittene Historie nachzuspielen. Insbesondere ein
fehlgeschlagener Deploy weckt dieselbe Task mit der Pflicht, Rollback und Produktionszustand zu
verifizieren. Ein Code-Fix beginnt dann auf einem neuen Branch/PR, nie auf `main` oder dem gemergten
Branch. Diese Zustellung ist noch kein unabhängiger Fix-Worker und deckt mangels
Wake-up-Schnittstelle keine ursprünglichen Claude-Tasks ab.

1. Fehlgeschlagene CI-Läufe dem PR und Head-SHA zuordnen.
2. Implementierungs-Agent mit Logs und klar begrenztem Fix-Auftrag starten.
3. Mergekonflikte nach Push auf `main` und im Reconciler erkennen.
4. Konfliktlösung, Tests, Push und erneute Gate-Auswertung automatisieren.
5. Rundenlimits und kritische Eskalationen durchsetzen.
6. Bestätigte Testlauf-Regressionen wie andere reproduzierbare CI-Fehler an den Implementierungs-
   Agenten geben; unvermeidbare Laufzeit durch neue Abdeckung sichtbar begründen.

Abnahme: je ein absichtlich erzeugter Codefehler, transienter CI-Fehler und einfacher
Mergekonflikt werden korrekt behandelt; ein riskanter Konflikt stoppt.

### Phase 4 – Cross-Review und strukturierte Ergebnisse

Teilstand: Die Auswahl `review:cross` startet für mechanisch review-bereite Heads beide regulären
Richtungen: für eine Codex-Implementierung genau einen credential-read-only Claude-Lauf und für eine
Claude-Implementierung genau eine native Codex-Review-Anforderung. Das Claude-Ergebnis wird
validiert, an den aktuellen Head gebunden und vom vertrauenswürdigen Workflow veröffentlicht; der
Codex-Adapter bindet seine `@codex review`-Anforderung über einen exact-head Marker und überlässt
die Review-Evidenz dem nativen GitHub-Review. Der PR-Checkout wird nach der Diff-Erzeugung und vor
Übergabe des Provider-Secrets vollständig entfernt; damit können Gedächtnisdateien des Heads nicht
als Claude-Code-Anweisungen geladen werden. Findings-Schleife, Fallback und Rundenlimits bleiben
offen.

1. Auswahl des Review-Modus mit Empfehlung vorlegen und das Review an den gewählten Reviewer
   routen: `cross` an den Gegen-Anbieter, `self` an eine frische, schreibgeschützte Session des
   Implementierungs-Anbieters, `human` an den Nutzer.
2. Gemeinsamen Review-Prompt aus Repository-Richtlinien und bereichsspezifischen `AGENTS.md`
   erzeugen.
3. Reviewformat aus Abschnitt 8 validieren und an den exakten Head-SHA binden.
4. Findings an den Implementierungs-Agent zurückgeben und Antworten nachverfolgen.
5. Nach jedem Fix ein neues Review erzwingen, beginnend mit einer neuen Auswahl.

Abnahme: alle drei Modi liefern reproduzierbare `pass`-/`changes-required`-Ergebnisse; ein
veraltetes Review und eine an einen früheren Head gebundene Wahl können das Gate nicht öffnen.

Umsetzungsstand: Die Auswahl selbst, ihre GitHub-Outbox-Zustellung, der externe Codex-Task-Monitor
und beide regulären Provider-Adapter sind umgesetzt. Cross- und Self-Reviews wurden in beiden
Implementierer-Richtungen pilotiert; die Human-Piloten nach #396 sind in beiden Richtungen noch
nicht abgenommen. Der Reconciler kennt die drei `review:*`-Labels, bindet sie an den
Head-SHA, wertet die modusabhängige Evidenz aus, stellt die Frage im Statuskommentar samt Empfehlung
und erzeugt pro bereitem Head genau einen neuen, maschinenlesbar markierten und den Maintainer
erwähnenden Kommentar. Solange die Auswahl unbeantwortet ist, blockiert das Gate mit
`awaiting-review-decision`; ein Zustellungsfehler blockiert sichtbar mit
`review-decision-delivery-failed` und wird erneut versucht. Der Ablauf in der Session und die
GitHub-Outbox-/Codex-Monitor-Grenze stehen in `.github/agent-pipeline/review-decision.md`.
Für Codex-Implementierungen startet `review:cross`
den eng begrenzten Claude-Pilotpfad; für Claude-Implementierungen fordert der Codex-Adapter die
native Review an. Die Sechs-Felder-Matrix ist als table-driven Akzeptanzstandard getestet. Die
Findings-Fix-Schleife, automatische CI-/Konfliktkorrektur und Rundenzähler bleiben außerhalb
dieses Auftrags.

### Phase 5 – Reviewer-Fallback und Limit-Retry

1. Claude-Fehler und Codex-Kontingentkommentare erkennen; für fehlende Codex-Reaktionen Timeout
   und Watchdog ergänzen.
2. Bei Ausfall des gewählten Reviewers den beobachteten Grund melden und die Auswahl erneut
   vorlegen, statt den Modus selbst zu wechseln.
3. Ein daraufhin gewähltes Review des Implementierungs-Anbieters als Fallback in Status, Label und
   Review-Ergebnis sichtbar machen.
4. Bei Ausfall beider Anbieter `agent:waiting` und einen zeitgesteuerten Retry verwenden.
5. Mit simulierten Limitantworten testen; echte Limits nicht absichtlich verbrauchen.

Abnahme: kein Review wird übersprungen, kein Modus wechselt ohne Nutzerentscheidung, das Review des
Implementierungs-Anbieters erreicht mindestens die konfigurierte Read-only-Stufe und Wartezyklen
verbrauchen keine Reviewrunde.

### Phase 6 – UI/UX-Erkennung und Benachrichtigung

1. Pfadklassifikation und Agentenerklärung zu `ui:changed` kombinieren.
2. Ein wiederverwendbares Nachrichtenformat mit Branch, PR, Änderungen und Prüfschritten bauen.
3. Vorhandene Screenshots oder Preview-Artefakte verlinken; keine künstliche Pflicht erzeugen,
   wenn visuelle Evidenz keinen Mehrwert hat.
4. Nachricht nach wesentlichen visuellen Review-Fixes aktualisieren.

Abnahme: ein UI-Test-PR informiert den Nutzer genau einmal und bleibt bis zur Merge-Bereitschaft
aktuell; ein reiner Backend-PR erzeugt keine UI-Nachricht.

### Phase 7 – Readiness-Check und Branch-Schutz

1. Commit-Status `Agent pipeline / ready for human merge` implementieren.
2. Alle Bedingungen aus Abschnitt 11 in das Gate aufnehmen.
3. Den Status als Required Check für `main` eintragen.
4. Auto-Merge deaktiviert lassen und sicherstellen, dass Agenten nicht mergen können.
5. Bestehende CI/CD und Deployment-Workflows unverändert lassen.

Abnahme: Nur der Nutzer kann einen vollständig grünen PR mergen; ein neuer Commit, offenes
Finding oder fehlende UI-Nachricht schließt das Gate wieder.

Umsetzungsstand: Schritte 1, 2, 4 und 5 sind im Reconciler umgesetzt; der Status kennt `success`
und `pending` und trägt den ersten offenen Blocker in seiner Beschreibung. PRs ohne aktivierten
Task-Vertrag erhalten nur dann bewusst `success`, wenn sie echte manuelle PRs außerhalb der
Agenten-Namespaces/-Labels sind; Agenten-PRs ohne gültigen Vertrag bleiben `pending`. Fork-PRs
bleiben ausgenommen. Schritt 3 bleibt manuell und wird erst nach Merge dieses Stands und einem
erneuten Pilot ausgeführt. Am 2026-08-10 enthielt der Schutz von `main` weiterhin nur die sechs
bisherigen Required Checks; die exakte additive Post-Merge-Anweisung und Rücknahme stehen in
`.github/agent-pipeline/README.md`.

### Phase 8 – Pilot und schrittweise Aktivierung

1. Kleiner Codex-PR mit Claude-Review.
2. Kleiner Claude-PR mit Codex-Review.
3. Bewusstes Review-Finding und automatische Korrektur.
4. Bewusster CI-Fehler und einfacher Mergekonflikt.
5. Simulierter Ausfall beider Reviewer-Richtungen inklusive Fallback.
6. UI/UX-PR mit Nutzerbenachrichtigung.
7. Kill-Switch und Wiederaufnahme testen.
8. Erst nach erfolgreichen Pilotfällen die Automatik standardmäßig für Agenten-PRs aktivieren.

Abnahme: vollständige Auditspur für jeden Pilotfall, keine unerlaubte `main`-Mutation und jede
Freigabe endet am menschlichen Merge-Gate.

## 15. Definition of Done für die Gesamtumsetzung

- Beide Implementierungsrichtungen funktionieren Ende-zu-Ende.
- Cross-Review, Selbst-Review, menschliches Review, Findings-Schleife, CI-Fix und Konfliktlösung
  sind getestet.
- Die Auswahl des Review-Modus wird pro Head-SHA aktiv und höchstens einmal zugestellt, von keiner
  unbeaufsichtigten Automatik beantwortet und öffnet das Gate nur mit der zum Modus passenden
  Evidenz.
- Review und Gate sind immer an den aktuellen Head-SHA gebunden.
- Draft-PRs können bereits die Review-Auswahl und das Review durchlaufen; Draft blockiert nur das
  menschliche Merge-Gate.
- Kritische Fälle halten an; normale Korrekturen laufen ohne Rückfrage weiter.
- UI/UX-Änderungen erzeugen die vereinbarte prüfbare Benachrichtigung.
- Kein Agent kann `main` ändern, mergen, Branch-Schutz verändern oder Deploy-Secrets lesen.
- Auto-Merge bleibt deaktiviert.
- Der Nutzer ist die einzige finale Merge-Instanz.
- Betriebsdokumentation nennt Status, Logs, Retry, Kill-Switch und manuelle Wiederaufnahme.
- Alle neuen Workflow- und Zustandslogikpfade besitzen Tests beziehungsweise reproduzierbare
  Pilotnachweise.

## 16. Aufwand und Risiken

- Die größte technische Arbeit liegt nicht in den Agenten-Prompts, sondern in einer sicheren,
  idempotenten Zustandsmaschine über asynchrone GitHub- und Anbieterereignisse.
- Reviews, Fixes und erneute Reviews verbrauchen Kontingent. Rundenlimits begrenzen Kosten und
  Endlosschleifen.
- Ein Fallback-Review desselben Anbieters ist weniger unabhängig als ein Cross-Review. Die frische,
  read-only Session und die abschließende menschliche Mergeentscheidung begrenzen dieses Risiko.
- Anbieterintegrationen und CLI-Flags ändern sich. Ihre Fähigkeiten werden in Phase 0 praktisch
  verifiziert und die Orchestrierung bleibt auf kleine Adapter begrenzt.
- Agenten können gemeinsam eine falsche Lösung akzeptieren. Pflicht-CI, Repository-Regeln,
  SHA-gebundene Reviews und der menschliche Merge bleiben deshalb eigenständige Schutzschichten.
