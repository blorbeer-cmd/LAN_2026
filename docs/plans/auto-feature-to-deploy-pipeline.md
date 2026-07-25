# Konzept: Automatisierte Agenten-Pipeline bis zum menschlich freigegebenen Merge

Status: beschlossenes Zielkonzept; read-only Foundation für Task-Vertrag und Zustandslogik in Umsetzung
Stand: 2026-07-26

Dieses Dokument beschreibt, wie eine Aufgabe von Codex oder Claude Code implementiert, vom
jeweils anderen Coding-Agent geprüft und anhand der Review-Findings automatisch korrigiert wird.
CI-Fehler und Mergekonflikte werden ebenfalls automatisch bearbeitet. Der Ablauf endet bei einem
vollständig geprüften, merge-bereiten Pull Request. **Den Merge gibt ausschließlich der Nutzer
frei.** Ein Push auf `main` startet danach wie bisher die bestehende CI/CD- und Deployment-Pipeline.

Das Konzept ersetzt den ursprünglichen Stand aus PR #173. Insbesondere entfallen Auto-Merge,
Review-Skip und eine automatische Changelog-Änderung nach dem Merge.

## 1. Ziel und Abgrenzung

### Ziel

Ein Nutzer stellt einem Coding-Agent eine Aufgabe. Danach läuft ohne weitere Interaktion:

1. Implementierung auf einem eigenen Branch und Eröffnung eines Draft-PRs.
2. Ausführung der bestehenden Pflichtprüfungen.
3. Automatische Behebung von CI-Fehlern und Mergekonflikten durch den Implementierungs-Agent.
4. Cross-Review durch den anderen Anbieter:
   - Codex-Implementierung → Claude-Review.
   - Claude-Implementierung → Codex-Review.
5. Automatische Umsetzung berechtigter Review-Findings und erneutes vollständiges Review.
6. Bei UI/UX-Änderungen eine Nachricht mit Änderung, Branch, PR und Prüfanleitung.
7. Abschließender Status `agent:ready-for-merge`; erst danach entscheidet der Nutzer über den
   Merge.

### Nicht Bestandteil

- Kein automatischer Merge und kein automatisches Aktivieren von Auto-Merge.
- Keine Umgehung von Nutzungslimits oder Sicherheitsgrenzen.
- Kein automatisches Überspringen eines Reviews.
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
            └─ CI grün + konfliktfrei                                      │
                 └─ Gegen-Agent reviewt                                    │
                      ├─ nicht verfügbar → isoliertes Fallback-Review       │
                      │   durch frische Session des Implementierungs-Anbieters
                      ├─ Findings → Implementierungs-Agent korrigiert ──────┘
                      └─ keine Findings zum aktuellen Head-SHA
                           ├─ ggf. UI/UX-Nachricht an Nutzer
                           └─ `agent:ready-for-merge`
                                └─ Nutzer prüft und merged
                                     └─ bestehendes Deployment
```

Jeder neue Commit macht ein vorheriges positives Review ungültig. Der aktuelle Head-SHA muss
erneut CI und Review durchlaufen.

## 4. Rollen und Review-Unabhängigkeit

| Implementierung | Regulärer Reviewer | Findings/Fixes | Fallback bei Reviewer-Ausfall            |
| --------------- | ------------------ | -------------- | ---------------------------------------- |
| Claude Code     | Codex              | Claude Code    | frische, isolierte Claude-Review-Session |
| Codex           | Claude Code        | Codex          | frische, isolierte Codex-Review-Session  |

Der reguläre Cross-Review ist der Normalfall. Der Fallback ist kein Überspringen des Reviews,
sondern ein Review mit reduzierter Anbieter-Unabhängigkeit. Er wird im PR sichtbar als
`agent:review-fallback` ausgewiesen.

### Anforderungen an das Fallback-Review

- Neue Session beziehungsweise neuer Review-Subagent; niemals die Implementierungs-Konversation
  einfach um eine Selbsteinschätzung bitten.
- Kein Zugriff auf den Implementierungs-Chatverlauf oder dessen Begründungskette.
- Als Kontext nur Task-Vertrag, Repository-Regeln, Diff gegen `main`, CI-Ergebnisse und bereits
  veröffentlichte PR-Diskussion.
- Frischer Checkout oder Worktree auf dem geprüften Head-SHA.
- Read-only: keine Dateiänderung, kein Commit und kein Push durch die Review-Session.
- Gleiches strukturiertes Reviewformat und dieselben Qualitätsregeln wie beim Cross-Review.
- Das Ergebnis muss Anbieter, Sessiontyp und geprüften Head-SHA nennen.

Eine neue Session behebt Kontextprobleme, aber kein kontoweites Nutzungslimit. Ist auch der
Implementierungs-Anbieter nicht verfügbar, wechselt der PR zu `agent:waiting` und wird nach dem
regulären Limit-Reset erneut versucht. Es gibt keinen `review:skip`-Pfad.

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

| Label                   | Bedeutung                                                                 |
| ----------------------- | ------------------------------------------------------------------------- |
| `agent:pipeline`        | PR nimmt an der Automatik teil                                            |
| `agent:implementing`    | Implementierungs-Agent arbeitet                                           |
| `agent:ci-fix`          | CI-Fehler wird bearbeitet                                                 |
| `agent:conflict-fix`    | Mergekonflikt wird bearbeitet                                             |
| `agent:review`          | reguläres Cross-Review läuft                                              |
| `agent:review-fallback` | isoliertes Review des Implementierungs-Anbieters läuft oder wurde genutzt |
| `agent:waiting`         | benötigter Anbieter oder Dienst ist vorübergehend nicht verfügbar         |
| `agent:needs-human`     | kritische Entscheidung oder Rundenlimit erreicht                          |
| `agent:ready-for-merge` | alle maschinellen Gates für den aktuellen Head-SHA erfüllt                |
| `ui:changed`            | PR enthält eine sichtbare UI/UX-Änderung                                  |
| `agent:no-auto`         | manueller Kill-Switch für diesen PR                                       |

### Maschinenzustand

Labels sind nicht der alleinige Zustandsspeicher. Ein einzelner, von der Pipeline aktualisierter
Status enthält mindestens:

- Task-ID und PR-Nummer,
- Implementierungs- und Review-Anbieter,
- aktuellen Head-SHA und zuletzt geprüften SHA,
- CI-Fix-, Konflikt- und Reviewrunde,
- reguläres oder Fallback-Review,
- letzte Aktion und Zeitstempel,
- UI/UX-Benachrichtigungsstatus,
- gegebenenfalls Warte- oder Eskalationsgrund.

Die Umsetzung kann dafür einen eindeutig markierten, aktualisierbaren PR-Kommentar plus einen
Commit-Status verwenden. Kommentare werden nicht als Rundenzähler ausgewertet. Jeder Übergang ist
idempotent: derselbe Event darf weder eine zweite Agenten-Session noch einen zweiten Fix starten.

`concurrency` serialisiert Mutationen pro PR. Ein regelmäßiger Reconciler prüft zusätzlich offene
PRs, falls Webhooks, Kommentare oder Anbieterreaktionen verloren gehen.

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
review-mode: cross|fallback
reviewed-head-sha: <sha>
verdict: pass|changes-required
findings:
  - severity: critical|high|medium|low
    file: <path>
    line: <line or null>
    summary: <short text>
    rationale: <why this matters>
    verification: <how to verify the fix>
```

Der Implementierungs-Agent bearbeitet jedes Finding nachvollziehbar:

- `fixed`: Änderung und Prüfung nennen,
- `rejected`: fachliche Begründung liefern; der Reviewer entscheidet erneut,
- `needs-human`: bei kritischer oder mehrdeutiger Entscheidung eskalieren.

Nach jedem Fix-Commit beginnt ein vollständiger Review des neuen Head-SHAs. Nach drei erfolglosen
Reviewrunden wird nicht weiter zwischen Agenten gependelt; der PR wechselt zu
`agent:needs-human`.

## 9. Nutzungslimits und Nichtverfügbarkeit

### Erkennung

- Claude: Action-Ausgang, strukturierte Fehlermeldung und bekannte Rate-/Budgetfehler auswerten.
- Codex: Reaktion auf `@codex review` sowie Review-/Kommentarereignisse beobachten. Eine bekannte
  Kontingentmeldung gilt sofort als Limit; ohne Reaktion greift ein konfigurierbarer Timeout.
- Timeout allein ist kein sicherer Beweis für ein Nutzungslimit. Der Status nennt deshalb den
  tatsächlich beobachteten Grund.

### Reihenfolge

1. Regulären Reviewer anfordern.
2. Bei technischem Einzelfehler genau einmal neu zustellen.
3. Bei bestätigtem Limit oder erneutem Ausfall sofort isoliertes Fallback-Review beim
   Implementierungs-Anbieter starten.
4. Ist auch dieser nicht verfügbar, `agent:waiting` setzen und zeitgesteuert erneut versuchen.
5. Warteversuche zählen nicht als Reviewrunde.
6. Nach 24 Stunden ohne Fortschritt den Nutzer informieren; nur bei einer tatsächlich nötigen
   Entscheidung zusätzlich `agent:needs-human` setzen.

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
- der Branch aktuell und konfliktfrei ist,
- das Review exakt den aktuellen Head-SHA geprüft hat,
- das Review `pass` meldet,
- alle Review-Findings und blockierenden Threads erledigt sind,
- kein `agent:waiting`, `agent:needs-human` oder `agent:no-auto` aktiv ist,
- bei UI/UX-Änderungen die Prüfinformation versendet wurde,
- keine verbotenen automatischen Änderungen an Workflow, Infrastruktur oder Secrets vorliegen.

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
- Privilegierte Workflows verwenden ausschließlich die vertrauenswürdige Workflowversion aus dem
  Base-Branch. Kein Checkout eines untrusted PR-Heads zusammen mit Schreibtoken oder Secrets.
- Schreibende Automatik nur für Branches im Hauptrepository, gültigen Task-Vertrag und erlaubte
  App-Identitäten.
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
4. Mit zwei Test-PRs prüfen:
   - `@codex review` reagiert und nennt den geprüften SHA,
   - Claude Code Action kann strukturiert reviewen,
   - beide Anbieter dürfen auf eigene Feature-Branches pushen,
   - keiner darf `main` pushen oder mergen.
5. GitHub-Benutzername für Pipeline-Benachrichtigungen als Repository-Variable hinterlegen.

Abnahme: dokumentierte Identitäten, Berechtigungen, Timeouts und tatsächlich beobachtete
Limitmeldungen beider Anbieter.

### Phase 1 – Task-Vertrag, Labels und PR-Vorlage

1. PR-Template um den Task-Vertrag und die sichtbare Zusammenfassung ergänzen.
2. Labels aus Abschnitt 6 anlegen.
3. Task-Vertrag validieren und Branch/Identität gegen eine Allow-List prüfen.
4. Ungültige oder fremde PRs sicher ignorieren und mit verständlicher Diagnose markieren.

Abnahme: gültige Agenten-PRs werden eindeutig klassifiziert; Forks und manipulierte Metadaten
erhalten keine schreibende Automatik.

### Phase 2 – Zustandsreducer und Reconciler

1. Kleine, testbare Zustandslogik implementieren, getrennt von den Workflow-YAML-Dateien.
2. Sticky-Status, Labels, SHA-Bindung und Rundenzähler idempotent aktualisieren.
3. `concurrency` pro PR und einen regelmäßigen Reconciler einrichten.
4. Doppelzustellung, verspätete Events und einen neuen Commit während eines Reviews testen.

Abnahme: Ein Event kann gefahrlos mehrfach eintreffen; nur ein Agent arbeitet gleichzeitig am PR.

### Phase 3 – Automatische CI- und Konfliktkorrektur

1. Fehlgeschlagene CI-Läufe dem PR und Head-SHA zuordnen.
2. Implementierungs-Agent mit Logs und klar begrenztem Fix-Auftrag starten.
3. Mergekonflikte nach Push auf `main` und im Reconciler erkennen.
4. Konfliktlösung, Tests, Push und erneute Gate-Auswertung automatisieren.
5. Rundenlimits und kritische Eskalationen durchsetzen.

Abnahme: je ein absichtlich erzeugter Codefehler, transienter CI-Fehler und einfacher
Mergekonflikt werden korrekt behandelt; ein riskanter Konflikt stoppt.

### Phase 4 – Cross-Review und strukturierte Ergebnisse

1. Claude-PRs automatisch an Codex, Codex-PRs automatisch an Claude routen.
2. Gemeinsamen Review-Prompt aus Repository-Richtlinien und bereichsspezifischen `AGENTS.md`
   erzeugen.
3. Reviewformat aus Abschnitt 8 validieren und an den exakten Head-SHA binden.
4. Findings an den Implementierungs-Agent zurückgeben und Antworten nachverfolgen.
5. Nach jedem Fix ein neues Review erzwingen.

Abnahme: beide Richtungen liefern reproduzierbare `pass`-/`changes-required`-Ergebnisse; ein
veraltetes Review kann das Gate nicht öffnen.

### Phase 5 – Reviewer-Fallback und Limit-Retry

1. Claude-Fehler und Codex-Kontingentkommentare erkennen; für fehlende Codex-Reaktionen Timeout
   und Watchdog ergänzen.
2. Bei Reviewer-Ausfall eine frische, read-only Review-Session des Implementierungs-Anbieters
   ohne Implementierungsverlauf starten.
3. Fallback im Status, Label und Review-Ergebnis sichtbar machen.
4. Bei Ausfall beider Anbieter `agent:waiting` und einen zeitgesteuerten Retry verwenden.
5. Mit simulierten Limitantworten testen; echte Limits nicht absichtlich verbrauchen.

Abnahme: kein Review wird übersprungen, der Fallback erhält keinen Schreibzugriff und Wartezyklen
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
- Cross-Review, Fallback-Review, Findings-Schleife, CI-Fix und Konfliktlösung sind getestet.
- Review und Gate sind immer an den aktuellen Head-SHA gebunden.
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
