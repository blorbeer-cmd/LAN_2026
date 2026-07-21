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
  `./scripts/agent-preflight.ps1 -Scope frontend`. Seine Ausgabe ersetzt getrennte Einstiegsaufrufe
  für Git-Status, Laufzeit, Abhängigkeiten und Standardprüfungen.
- Mit genannten Pfaden beginnen. Ohne Pfadangabe anhand der untenstehenden Landkarte gezielt
  suchen; keine vorsorgliche repositoryweite Volltextsuche oder vollständige Dokumentationslektüre.
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
