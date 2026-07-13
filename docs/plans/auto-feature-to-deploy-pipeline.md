# Konzept: Autonome Pipeline von „Feature fertig“ bis „deployed“

Ziel dieses Dokuments: ein Konzept und ein umsetzbarer Schritt-für-Schritt-Plan, um den gesamten
Weg eines fertigen Features bis zum Produktiv-Deployment zu automatisieren – inklusive Push,
Pull-Request-Erstellung, Behebung von Pipeline-Fehlern und Merge-Konflikten, automatischem
Cross-Review (Codex reviewt Claude-PRs und umgekehrt), Umsetzung von Review-Kommentaren,
Auto-Merge und Deployment.

## 1. Ausgangslage

Bereits vorhanden und **nicht Teil dieses Vorhabens**:

- `.github/workflows/deploy.yml` führt bei jedem PR die vollständigen Pflichtchecks aus
  (Design-Tokens, Lint, Format, Build, Unit-/Integrations-/E2E-Tests für Server und Agent) und
  baut das Runtime-Image als Deployment-Gate.
- Ein Push auf `main` baut und veröffentlicht das Image nach GHCR und deployt es per SSH auf den
  Hetzner-Server, inklusive Rollback bei fehlgeschlagenem `docker compose up`.
- Beide Coding-Agents erstellen heute schon Branches und PRs: Claude Code auf `claude/*`-Branches,
  Codex auf `codex/*`-Branches.

**Manuell** sind heute: Review anstoßen und durchführen, CI-Fehler auf dem PR-Branch beheben,
Merge-Konflikte auflösen, Review-Kommentare umsetzen, mergen und die Changelog-Pflege nach
Abschnitt 10 der `DEVELOPMENT_GUIDELINES.md`.

## 2. Zielbild

Der PR-Lebenszyklus wird zu einer Zustandsmaschine, die ohne menschliches Eingreifen bis zum
Deployment läuft und nur bei definierten Eskalationsfällen stoppt:

```
Feature fertig (Agent-Session)
  └─ Push + PR (macht der Agent bereits heute)
       └─ Label `auto-pipeline` gesetzt → Automatik aktiv
            ├─ CI läuft (bestehendes deploy.yml)
            │    └─ rot → Autor-Agent analysiert Logs, fixt, pusht  ──┐
            ├─ Merge-Konflikt erkannt → Autor-Agent merged main,      │ max. N Runden,
            │    löst Konflikte auf, pusht                        ────┤ sonst Label
            ├─ Cross-Review: Gegen-Agent reviewt                      │ `needs-human`
            │    └─ Änderungswünsche → Autor-Agent setzt um,          │ + Benachrichtigung
            │         antwortet, fordert Re-Review an             ────┘
            └─ CI grün + Review ohne offene Punkte
                 └─ Auto-Merge (Squash) in main
                      ├─ bestehender Deploy-Job baut + deployt
                      └─ Post-Merge-Job pflegt docs/changelog/ nach
```

### Rollenmodell (Cross-Review)

| PR-Autor | Erkennung | Reviewer | Fixes/Kommentar-Umsetzung |
|---|---|---|---|
| Claude Code | Branch `claude/*` bzw. PR-Autor = Claude-App | **Codex** | Claude (Autor-Agent) |
| Codex | Branch `codex/*` bzw. PR-Autor = Codex-Integration | **Claude** | Codex (Autor-Agent) |
| Mensch | alles andere | optional beide, standardmäßig keine Automatik | Mensch |

Grundregel: **Der Autor-Agent repariert und setzt um, der Gegen-Agent reviewt.** Damit bleibt die
Vier-Augen-Trennung erhalten – kein Agent approvt seine eigene Arbeit.

## 3. Bausteine

1. **Claude GitHub App + `anthropics/claude-code-action`** (GitHub Action): führt Reviews aus,
   reagiert auf `@claude`-Mentions und kann mit einem Prompt gezielt beauftragt werden
   („behebe den CI-Fehler auf diesem Branch“, „setze die Review-Kommentare um“). Authentifizierung
   über `ANTHROPIC_API_KEY` oder `CLAUDE_CODE_OAUTH_TOKEN` als Repository-Secret.
2. **Codex GitHub-Integration (Codex Cloud)**: wird über die Codex-/ChatGPT-Einstellungen mit dem
   Repository verbunden. Danach reagiert Codex auf `@codex review` bzw. `@codex fix …`-Mentions in
   PR-Kommentaren und kann PRs automatisch reviewen. Die genauen Fähigkeiten (automatisches Review
   bei PR-Eröffnung vs. nur Mention-getrieben) sind vor Phase 2 gegen die aktuelle Codex-Doku zu
   verifizieren – die Integration entwickelt sich schnell.
3. **Eigene, schlanke Orchestrierungs-Workflows** unter `.github/workflows/`: kleine YAML-Dateien,
   die auf PR-Ereignisse reagieren und den jeweils zuständigen Agent anstoßen. Keine zusätzliche
   Infrastruktur, kein eigener Server – passt zum Grundsatz „schlanke Wartbarkeit“.
4. **GitHub-Bordmittel**: Branch-Ruleset auf `main` (Pflichtchecks, Review-Pflicht,
   Conversation-Resolution), natives Auto-Merge, Labels als Zustandsspeicher.

### Wichtige technische Stolperfalle

Aktionen, die ein Workflow mit dem Standard-`GITHUB_TOKEN` ausführt (Kommentare, Pushes, Reviews),
**lösen keine weiteren Workflows aus**. Damit die Kette „Agent pusht Fix → CI läuft erneut“
funktioniert, müssen agentische Pushes und Kommentare über die **GitHub-App-Identität** (Claude
App bzw. Codex-Integration) oder ein App-Token laufen, nicht über `GITHUB_TOKEN`. Die Claude- und
Codex-Integrationen tun das von Haus aus; nur selbstgebaute Schritte (z. B. das
Auto-Merge-Aktivieren) dürfen `GITHUB_TOKEN` nutzen, weil dort kein Folge-Trigger nötig ist.

## 4. Steuerung über Labels (Zustandsmaschine)

| Label | Bedeutung |
|---|---|
| `auto-pipeline` | Automatik für diesen PR aktiv (Opt-in; wird für `claude/*`- und `codex/*`-PRs automatisch gesetzt) |
| `no-auto` | Opt-out: Automatik fasst diesen PR nicht an, auch wenn er von einem Agent stammt |
| `auto:fixing` | Autor-Agent arbeitet gerade (verhindert parallele Läufe zusätzlich zur `concurrency`-Gruppe) |
| `needs-human` | Eskalation: Rundenlimit erreicht oder Fall, den die Automatik nicht entscheiden darf |

Labels sind bewusst der einzige Zustandsspeicher: sichtbar in der PR-Übersicht, manuell
korrigierbar und ohne zusätzliche Datenhaltung.

## 5. Leitplanken (nicht verhandelbar)

- **Kein Agent approvt oder merged eigene Änderungen.** Approval kommt immer vom Gegen-Agent bzw.
  vom Gate-Workflow, der das Gegen-Review geprüft hat.
- **Rundenlimits:** maximal 3 CI-Fix-Runden und maximal 3 Review-Runden pro PR. Danach
  `needs-human` + Benachrichtigung statt Endlosschleife. Das deckt sich mit der Richtlinie, einen
  roten Pflichtcheck nicht durch bloßes Wiederholen zu umgehen: jede Runde muss eine echte
  Ursachenanalyse enthalten.
- **Kein Force-Push, keine destruktiven Git-Operationen.** Konflikte werden durch Merge von `main`
  in den PR-Branch gelöst, nie durch Rebase mit Force-Push.
- **`.github/workflows/**` und `infra/**` sind für die Automatik tabu:** Auto-Fixes dürfen die
  Pipeline und die Server-Provisionierung nicht selbst umschreiben (Prompt-Regel plus Absicherung
  im Gate: Änderungen an diesen Pfaden setzen `needs-human`).
- **Tests bleiben Pflicht:** Der Autor-Agent darf Tests reparieren, aber nicht löschen oder
  aufweichen, um grün zu werden (Abschnitt 8 der Richtlinien gilt unverändert; steht explizit im
  Fix-Prompt).
- **Kill-Switch:** Jeder Orchestrierungs-Workflow lässt sich über die GitHub-UI deaktivieren
  („Disable workflow“); zusätzlich wirkt `no-auto` pro PR.
- **Secrets:** nur `ANTHROPIC_API_KEY` bzw. `CLAUDE_CODE_OAUTH_TOKEN` als neues Repo-Secret. Die
  Codex-Seite authentifiziert über die installierte Integration, kein API-Key im Repo. Bestehende
  Deploy-Secrets bleiben unangetastet.
- **Produktionsschutz unverändert:** Deployt wird weiterhin ausschließlich durch den bestehenden
  `deploy`-Job nach Push auf `main`. Die Automatik erhält keinerlei SSH- oder Deploy-Rechte.

## 6. Schritt-für-Schritt-Plan

### Phase 0 – Voraussetzungen und Bestandsaufnahme (manuell, einmalig)

1. **Claude GitHub App installieren** (falls noch nicht geschehen): in einer lokalen Claude-Code-
   Session `/install-github-app` ausführen oder über github.com/apps/claude installieren und dem
   Repo `blorbeer-cmd/LAN_2026` Zugriff geben.
2. **Secret anlegen:** `ANTHROPIC_API_KEY` (oder `CLAUDE_CODE_OAUTH_TOKEN` aus einem
   Claude-Abo) unter *Settings → Secrets and variables → Actions*.
3. **Codex-GitHub-Integration verbinden:** in den Codex-Einstellungen (ChatGPT → Codex →
   Code Review / GitHub) das Repo verbinden und prüfen: Reagiert Codex auf `@codex review`?
   Gibt es automatisches Review bei PR-Eröffnung? Ergebnis im Plan-Dokument nachtragen, weil
   Phase 2 davon abhängt.
4. **Repo-Einstellungen:** unter *Settings → General* „Allow auto-merge“ aktivieren und unter
   *Settings → Actions → General* „Allow GitHub Actions to create and approve pull requests“
   erlauben (wird vom Merge-Gate in Phase 5 benötigt).
5. **Branch-Ruleset für `main`** anlegen bzw. prüfen: Required Status Check „Build and test“,
   mindestens 1 Approval, „Require conversation resolution before merging“. Damit ist Auto-Merge
   technisch erst möglich, wenn CI grün ist und ein Gegen-Review vorliegt.
6. **Labels anlegen:** `auto-pipeline`, `no-auto`, `auto:fixing`, `needs-human`.

Verifikation Phase 0: Test-PR von Hand öffnen, `@claude` und `@codex` je einmal erwähnen und
prüfen, dass beide antworten.

### Phase 1 – Cross-Review-Workflow (`.github/workflows/agent-review.yml`)

Trigger: `pull_request` (`opened`, `ready_for_review`, `synchronize` nach Fix-Runden über
Re-Review-Anforderung).

1. Job „classify“: bestimmt aus Head-Branch-Präfix (`claude/`, `codex/`) und PR-Autor den
   Autor-Agent; setzt bei Agent-PRs das Label `auto-pipeline` (sofern nicht `no-auto`).
2. Job „request-review“ (nur mit `auto-pipeline`, nicht bei Draft):
   - Autor = Claude → Kommentar `@codex review` posten (bzw. den in Phase 0 verifizierten
     Codex-Review-Mechanismus nutzen).
   - Autor = Codex → `anthropics/claude-code-action` mit Review-Prompt starten. Der Prompt
     verlangt ein Review nach `DEVELOPMENT_GUIDELINES.md` (Race-Sicherheit, Testmatrix,
     Design-Tokens, Doku-Pflicht) und als Abschluss ein klares maschinenlesbares Urteil im
     Review-Text: `VERDICT: approve` oder `VERDICT: request-changes` mit begründeten
     Einzelkommentaren.
3. `concurrency: agent-review-${{ github.event.pull_request.number }}` verhindert überlappende
   Reviews desselben PRs.

Verifikation: je ein Dummy-PR von Claude- und Codex-Seite; erwartet wird genau ein Review vom
jeweils anderen Agent.

### Phase 2 – Auto-Fix bei CI-Fehlern (`.github/workflows/agent-autofix.yml`)

Trigger: `workflow_run` (Workflow „CI/CD“, `conclusion == failure`), zugeordneten PR ermitteln.

1. Vorbedingungen prüfen: PR offen, Label `auto-pipeline`, kein `no-auto`/`needs-human`,
   Fix-Rundenzähler < 3 (Zählung über die Anzahl bisheriger Auto-Fix-Kommentare des Workflows am
   PR – kein separater Speicher nötig).
2. Autor = Claude → `claude-code-action` checkt den PR-Branch aus, liest die fehlgeschlagenen
   Job-Logs, analysiert die Ursache, fixt, führt die betroffenen Prüfungen aus der Testmatrix
   lokal aus und pusht. Autor = Codex → Kommentar `@codex Die CI ist fehlgeschlagen (Link zum
   Run). Analysiere die Ursache und pushe einen Fix auf diesen Branch.`
3. Jede Runde hinterlässt einen kurzen PR-Kommentar (Ursache → Fix), damit die Historie
   nachvollziehbar bleibt und der Rundenzähler daraus ablesbar ist.
4. Limit erreicht oder Fix unmöglich (z. B. Ursache in `.github/**`): Label `needs-human`,
   zusammenfassender Kommentar mit Diagnose.

### Phase 3 – Merge-Konflikte automatisch auflösen

Gleicher Workflow wie Phase 2, zusätzlicher Trigger: `push` auf `main` sowie `schedule`
(z. B. alle 2 Stunden als Fangnetz, GitHub liefert für Konflikt-Zustände kein Event).

1. Alle offenen `auto-pipeline`-PRs auflisten; bei `mergeable_state == dirty` den Autor-Agent
   beauftragen: `git merge origin/main` auf dem PR-Branch, Konflikte inhaltlich auflösen (beide
   Seiten verstehen, nicht schematisch „ours/theirs“), betroffene Prüfungen ausführen, pushen.
2. Konflikte in Changelog-Dateien (`docs/changelog/**`) sind der häufigste Fall und fast immer
   additiv lösbar (beide Einträge behalten, Chronologie wahren) – das steht explizit im Prompt.
3. Kein Force-Push; scheitert die Auflösung, `needs-human` + Kommentar mit Konfliktdateien.

### Phase 4 – Review-Kommentare automatisch umsetzen

Trigger: `pull_request_review` (`submitted`) und `issue_comment`/`pull_request_review_comment`
vom Gegen-Agent.

1. Nur reagieren, wenn das Review vom Reviewer-Agent stammt und Änderungen fordert
   (`request-changes`-Verdict bzw. `changes_requested`).
2. Autor-Agent setzt die Kommentare um: jede Anmerkung entweder umsetzen (Commit + kurze Antwort
   am Thread) oder mit fachlicher Begründung ablehnen (Antwort am Thread, Thread bleibt offen für
   den Reviewer). Danach Re-Review anfordern → Phase 1 greift erneut.
3. Rundenlimit 3 (Zählung über die Anzahl der Reviews des Gegen-Agents). Sind sich die Agents
   danach uneinig, `needs-human` – Meinungsverschiedenheiten zwischen zwei Modellen sind ein
   erwünschter Stopp-Grund, kein Fehler.

### Phase 5 – Merge-Gate und Auto-Merge (`.github/workflows/agent-automerge.yml`)

Trigger: `pull_request_review` (`submitted`), `workflow_run` (CI erfolgreich).

1. Gate-Bedingungen: Label `auto-pipeline`, kein `needs-human`/`no-auto`, letztes Review des
   Gegen-Agents enthält `VERDICT: approve`, alle Review-Threads resolved, PR ist kein Draft,
   Diff enthält keine Änderungen unter `.github/workflows/**` oder `infra/**`.
2. Gate erfüllt → formales Approval durch den Gate-Job (github-actions-Bot, deshalb die
   Einstellung aus Phase 0.4) und natives Auto-Merge (Squash) aktivieren. GitHub merged dann
   selbstständig, sobald der Pflichtcheck grün ist – Reihenfolgeprobleme zwischen „Review fertig“
   und „CI fertig“ löst Auto-Merge von allein.
3. Merge auf `main` → bestehender `deploy`-Job baut, veröffentlicht und deployt unverändert.
   Die `production-deploy`-Concurrency-Gruppe serialisiert mehrere schnell aufeinanderfolgende
   Auto-Merges bereits heute korrekt.

### Phase 6 – Changelog-Automatik (`.github/workflows/agent-changelog.yml`)

Trigger: `pull_request` (`closed`, `merged == true`).

1. `claude-code-action` legt gemäß Abschnitt 10 der Richtlinien den Eintrag unter
   `docs/changelog/pr/` an, aktualisiert `docs/changelog/branches/` und `docs/changelog/README.md`
   – mit den **echten** Merge-Metadaten aus dem Event (PR-Nummer, Datum, Branch, Merge-SHA),
   niemals erfundenen.
2. Commit direkt auf `main` (nur `docs/**`; die bestehende `paths-ignore`-Regel verhindert, dass
   dieser Docs-Commit ein erneutes Produktiv-Deployment auslöst). Alternative, falls das Ruleset
   direkte Pushes verbietet: Mini-PR mit `auto-pipeline`-Label, der denselben Weg durch das Gate
   nimmt.
3. Damit entfällt die Changelog-Pflege als manueller Schritt und als häufigste Konfliktquelle in
   Feature-PRs.

### Phase 7 – Pilotbetrieb und Feinschliff

1. Ein echtes, kleines Feature vollständig durch die Pipeline laufen lassen (Claude-PR → Codex-
   Review) und den Spiegel-Fall (Codex-PR → Claude-Review).
2. Bewusst einen CI-Fehler und einen Merge-Konflikt provozieren und die Fix-Runden beobachten.
3. Rundenlimits, Prompts und Schedule-Frequenz anhand der Ergebnisse justieren.
4. Betriebsdokumentation: Kill-Switch, Labels, Eskalationsweg und Kostenhinweise in `README.md`
   bzw. `server/OPERATIONS.md` ergänzen; Changelog-Eintrag für das Automatisierungs-PR selbst.

## 7. Aufwand, Kosten, Risiken

- **Kosten:** Jede Review-, Fix- und Changelog-Runde verbraucht Claude-API-Tokens bzw.
  Codex-Kontingent; die GitHub-Actions-Minuten selbst sind im öffentlichen/kleinen Rahmen
  vernachlässigbar. Die Rundenlimits begrenzen das Kostenrisiko nach oben.
- **Größtes fachliches Risiko:** Zwei Agents einigen sich auf eine falsche Lösung. Abmilderung:
  striktes Cross-Review (nie Selbst-Approval), unveränderte Pflicht-CI als objektives Gate,
  `needs-human` bei Uneinigkeit, Deploy-Rollback im bestehenden `deploy`-Job als letztes Netz.
- **Verhaltensdrift der Integrationen:** Sowohl `claude-code-action` als auch die
  Codex-Integration ändern sich laufend. Die Orchestrierung bleibt deshalb bewusst dünn
  (Mentions, Labels, ein Gate) statt eng an interne APIs gekoppelt.
- **Sicherheit:** Die Automatik arbeitet nur mit PR-Scope (contents/PR/issues write). Deploy-
  Secrets (`SSH_PRIVATE_KEY`, `HETZNER_HOST`) bleiben exklusiv beim bestehenden Deploy-Job mit
  Environment `production`.

## 8. Offene Entscheidungen (vor Phase 1 klären)

1. **Letzte menschliche Instanz vor Produktion?** Standard dieses Konzepts: vollautomatisch bis
   Produktion. Alternativ kann das GitHub-Environment `production` einen „Required reviewer“
   erhalten – dann läuft alles automatisch bis zum Merge, und nur das Deployment wartet auf einen
   Klick. Empfehlung: erst mit manueller Deploy-Freigabe pilotieren, nach stabilen Durchläufen auf
   vollautomatisch stellen.
2. **Gilt die Automatik auch für menschliche PRs?** Empfehlung: nein; Menschen setzen bei Bedarf
   selbst `auto-pipeline`.
3. **Codex-Fähigkeiten:** Ob Codex auf `@codex fix …` zuverlässig Commits auf Fremd-PR-Branches
   pusht, entscheidet, ob die Codex-Seite der Fix-Automatik (Phasen 2–4 für `codex/*`-PRs) sofort
   oder erst später kommt. Fallback: Claude übernimmt Fixes auch auf Codex-PRs, das Review bleibt
   trotzdem beim jeweils anderen Agent – die Vier-Augen-Trennung gilt dann pro Commit-Runde nur
   noch eingeschränkt und wird im Pilot bewertet.

## 9. Nicht Bestandteil dieses Vorhabens

- Keine Änderung an Test-, Build- oder Deploy-Logik in `deploy.yml` (außer keinerlei Änderung –
  die Orchestrierung liegt in neuen, separaten Workflow-Dateien).
- Kein eigener Orchestrierungs-Server, keine neue Produktionsabhängigkeit.
- Keine Automatisierung der Issue-/Feature-Planung („Feature fertig“ bleibt der Startpunkt).
- Keine Lockerung von Branch-Schutz, Tests oder Sicherheitsgrenzen zugunsten der Automatik.
