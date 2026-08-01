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
- Bei Änderungsaufträgen den gemeinsamen Preflight genau einmal mit dem passendsten Bereich
  (`root`, `server`, `frontend`, `agent`, `docs` oder `infra`) ausführen, zum Beispiel
  `node ./scripts/agent-preflight.mjs --scope frontend`. Seine Ausgabe ersetzt getrennte
  Einstiegsaufrufe für Git-Status, Laufzeit, Abhängigkeiten und Standardprüfungen.
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

## Agenten-Pipeline für Pull Requests

Sobald ein Coding-Agent im Rahmen eines Nutzerauftrags einen Branch oder Pull Request erstellen,
pushen oder weiterbearbeiten soll, gilt zusätzlich
[`docs/plans/auto-feature-to-deploy-pipeline.md`](docs/plans/auto-feature-to-deploy-pipeline.md).
Das vollständige Konzept nur für Arbeiten am PR-Lebenszyklus oder an der Pipeline selbst laden;
für normale Implementierungsdetails gelten diese Kurzregeln:

- Agenten-PRs erhalten den maschinenlesbaren Task-Vertrag aus der PR-Vorlage. Anbieter, Branch,
  Scope und Ausgangs-SHA müssen der tatsächlichen Arbeit entsprechen.
- Der Implementierungs-Agent behebt eigene CI-Fehler, Mergekonflikte und berechtigte
  Review-Findings. Nach jedem neuen Commit sind CI und Review für den neuen Head-SHA erneut nötig.
- Claude-Implementierungen werden regulär von Codex, Codex-Implementierungen von Claude geprüft.
  Ist der Gegen-Agent nicht verfügbar, erfolgt das Review in einer frischen, isolierten und
  schreibgeschützten Session des Implementierungs-Anbieters. Ein Review darf nie übersprungen
  werden. Separate Reviews verwenden den Prompt und Ablauf unter
  `.github/agent-pipeline/review-session-prompt.md`.
- Nur kritische oder wesentlich mehrdeutige Entscheidungen werden dem Nutzer vorgelegt. Normale
  Fixes laufen bis zum grünen, konfliktfreien und vollständig reviewten PR automatisch weiter.
- Bei sichtbaren UI/UX-Änderungen den Nutzer informieren, sobald der Branch sinnvoll prüfbar ist:
  Änderung, exakter Branch, PR-Link und konkrete Prüfschritte nennen.
- Kein Coding-Agent approvt oder merged. `main`, Branch-Schutz, Workflows, Infrastruktur, Secrets
  und Deploy-Berechtigungen bleiben außerhalb automatischer Fixes. Der finale Merge gehört immer
  dem Nutzer.
- Nach der Behebung eines Review-Findings markiert der Implementierungs-Agent die zugehörigen
  Review-Threads und Kommentare als gelöst. Vor dem Merge ist dieser Zustand zu prüfen.
