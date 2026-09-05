# AGENTS.md

Verbindlicher Einstiegspunkt für Coding-Agents im Repository.

## Pflichtlektüre

Vor Analyse, Planung oder Änderung
[`DEVELOPMENT_GUIDELINES.md`](DEVELOPMENT_GUIDELINES.md) vollständig lesen.

## Schneller Arbeitsstart

- Nutzeraufträge dürfen vollständig in Prosa stehen. Keine ausgefüllte Vorlage verlangen.
- Nach der Pflichtlektüre den Auftrag intern auf Ziel, Ist-Zustand, Soll-Zustand, betroffenen
  Bereich, Grenzen und Abnahmekriterien normalisieren. Fehlende Punkte zuerst aus Auftrag,
  genannten Dateien, Quellcode und Tests erschließen.
- Nur nachfragen, wenn mehrere plausible Auslegungen zu wesentlich verschiedenen Ergebnissen
  führen oder neue Berechtigungen bzw. schwer rückgängige externe Aktionen nötig wären.
  Der in diesem Repository für Änderungsaufträge festgelegte Abschluss über den eigenen
  Feature-Branch und einen Draft-PR ist bereits durch den Auftrag autorisiert und gilt nicht als
  neue Berechtigung oder schwer rückgängige Aktion; die Ausnahmen und Stop-Bedingungen in
  `DEVELOPMENT_GUIDELINES.md` bleiben verbindlich.
- Bei Änderungsaufträgen den gemeinsamen Preflight genau einmal mit dem passendsten Bereich
  (`root`, `server`, `frontend`, `agent`, `docs` oder `infra`) ausführen, zum Beispiel
  `node ./scripts/agent-preflight.mjs --scope frontend`. Seine Ausgabe ersetzt getrennte
  Einstiegsaufrufe für Git-Status, Laufzeit, Abhängigkeiten und Standardprüfungen. Auf einem
  branch-sicheren Worktree prüft er Node.js 24 und installiert fehlende oder durch ein geändertes
  Lockfile veraltete Abhängigkeiten für `server`, `frontend` oder `agent` automatisch. Bei einem
  Sicherheitsstopp bleibt der Arbeitsbaum einschließlich `node_modules` unangetastet. Für
  `server` und `frontend` führt der Bootstrap den bestehenden npm-`prepare`-Lifecycle aus; dessen
  `server/scripts/setup-git-hooks.js` setzt `core.hooksPath` auf `.githooks` in der gemeinsamen
  Git-Konfiguration und wirkt damit für alle verlinkten Worktrees dieses Repositorys.
- Mit genannten Pfaden beginnen. Ohne Pfadangabe anhand der untenstehenden Landkarte gezielt
  suchen; keine vorsorgliche repositoryweite Volltextsuche und keine Lektüre von Dokumentation,
  die weder vorgeschrieben noch für den Auftrag relevant ist.
- Planungstiefe an das Risiko anpassen. Kleine, klar begrenzte Änderungen direkt bearbeiten;
  komplexe oder mehrdeutige Vorhaben erst planen. Die Definition of Done bleibt in beiden Fällen
  unverändert.

## Repository-Landkarte

- `server/src/`: Express-/Socket.IO-Server, SQLite-Schema und TypeScript-Tests
- `server/public/`: Browser-Frontend ohne eigenes Framework
- `agent/src/`: Windows-Agent und lokales Kontroll-Tool in CommonJS
- `docs/`: Konzepte, Pläne, Reviews und Projekthistorie
- `infra/` und `.github/workflows/`: Betrieb, Provisionierung und CI/CD

Der Preflight nennt für den gewählten Bereich die einschlägigen Anweisungen und
Prüfkommandos. Er ersetzt nicht das Lesen der dort vorgeschriebenen Bereichsdokumente.

Zusätzliche Regeln werden nur im betroffenen Unterbaum geladen:

- `server/AGENTS.md` für Server, API, Datenbank, Realtime, Tests und Betrieb
- `server/public/AGENTS.md` zusätzlich für Frontendänderungen
- `agent/AGENTS.md` für den Windows-Agent
- `docs/changelog/AGENTS.md` für die Pflege der Projekthistorie

## Geltung

- Nutzer- und Systemanweisungen haben Vorrang.
- Danach gelten die nächstgelegene `AGENTS.md` und die gemeinsame Richtlinie.
- Vorhandene, sachfremde Änderungen im Arbeitsbaum gehören dem Nutzer und bleiben unangetastet.
- Bei Widersprüchen gilt `DEVELOPMENT_GUIDELINES.md`; den Konflikt melden oder in einem passenden
  Dokumentationsauftrag beheben.

## Pull Requests und manuelle Reviews

Jeder Änderungsauftrag umfasst nach Umsetzung und einschlägigen Prüfungen standardmäßig Commit,
Push des eigenen Feature-Branches und Draft-PR. Der Nutzer kann diesen Abschluss ausschließen.

- PRs beschreiben Ziel, Änderungen, Prüfungen und verbleibende Risiken; kein maschinenlesbarer
  Task-Vertrag und keine Review-Wahl-Labels sind erforderlich.
- Der Nutzer startet das Review selbst in einer frischen Claude- oder Codex-Unterhaltung mit
  dem Skill `pr-review` und PR-Link oder beauftragt einen Menschen. Eine frische Unterhaltung
  ohne Implementierungsverlauf genügt auch beim selben Anbieter. Eine technisch erzwungene
  Read-only-Sandbox oder ein Isolationsnachweis ist nicht vorgeschrieben. Der Reviewer ändert
  keinen Produktcode, approvt und merged nicht; er veröffentlicht das Ergebnis am PR.
- Vor dem menschlichen Merge sind grüne einschlägige CI-Checks, Konfliktfreiheit und ein
  vollständiges Review des aktuellen Head-SHA nötig. Nach einem Fix gelten ältere Reviews
  nicht für den neuen Commit; der Nutzer startet das Review erneut. Ein COMMENT-Review ohne
  Findings genügt fachlich, ist aber kein GitHub-Approval und kein automatischer Statuscheck.
- Der Implementierungs-Agent liest bei „Review ist durch“ die Reviews, Kommentare und offenen
  Threads direkt von GitHub, prüft deren Commit-Bezug und bewertet Findings selbst. Berechtigte
  Findings und eigene CI-Fehler beheben, Zurückweisungen begründen und erledigte oder nachweislich
  obsolete Inline-Threads auflösen. Keine Entscheidungen allein aus Session-Erinnerungen ableiten.
- Es gibt keinen automatischen Reviewstart, Anbieterwechsel oder dauerhaften Pipeline-Monitor.
  Eine ausdrücklich gewünschte, zeitlich begrenzte Beobachtung darf neue Ergebnisse an die
  Implementierung übergeben. Bei Merge, Schließen oder Ablauf endet sie; Details und Beispiele:
  [Manuelle PR-Reviews](docs/manual-pr-review.md).
- Kein Agent approvt, merged, aktiviert Auto-Merge oder pusht auf `main`. Änderungen an
  Schutzregeln, Workflows, Infrastruktur, Secrets und Deploy-Berechtigungen brauchen einen
  ausdrücklichen Auftrag und gehören nicht zu beiläufigen Review-Fixes.
- Nach einem Merge beginnt Folgearbeit auf einem neuen Branch und PR.
- Bei sichtbaren UI/UX-Änderungen Änderung, exakten Branch, PR-Link und Prüfschritte nennen.
- Bei GitHub-Zugriffsfehlern Netzwerkprobleme von eindeutigen Authentifizierungsfehlern trennen.
  Eine lesende GitHub-Abfrage zur Verifikation nutzen; `gh auth login` nur bei belegtem
  Authentifizierungsfehler verlangen. PR bevorzugt über die GitHub-App erstellen, sonst `gh`.
