# AGENTS.md

Verbindlicher Einstiegspunkt für Coding-Agents in diesem Repository.

## Pflichtlektüre

1. Vor Analyse, Planung oder Änderung die gemeinsame Richtlinie
   **[`DEVELOPMENT_GUIDELINES.md`](DEVELOPMENT_GUIDELINES.md) vollständig lesen**.
2. Vor jeder Änderung unter `server/public/` zusätzlich
   **[`server/DESIGN_SYSTEM.md`](server/DESIGN_SYSTEM.md) vollständig lesen**.
3. Für bereichsspezifische Details die dort verlinkte Dokumentation lesen, insbesondere
   `server/TESTING.md` und `agent/README.md`, wenn der Auftrag den jeweiligen Bereich betrifft.

`DEVELOPMENT_GUIDELINES.md` ist die einzige gemeinsame Quelle für Produkt-, Architektur-,
Qualitäts- und Workflow-Regeln. Diese Datei enthält bewusst keine Kopie davon, damit die Vorgaben
für verschiedene Agents nicht auseinanderlaufen.

## Geltung und Konflikte

- Nutzer- und Systemanweisungen haben Vorrang.
- Danach gelten die nächstgelegene `AGENTS.md` und die gemeinsame Richtlinie.
- Bei einem Widerspruch zwischen dieser Datei, `CLAUDE.md` und der gemeinsamen Richtlinie gilt
  `DEVELOPMENT_GUIDELINES.md`. Den Widerspruch nicht stillschweigend auslegen, sondern im Rahmen
  eines passenden Dokumentationsauftrags beheben oder dem Nutzer melden.
- Vorhandene, nicht zum Auftrag gehörende Änderungen im Arbeitsbaum gehören dem Nutzer und werden
  nicht überschrieben, zurückgesetzt, formatiert oder mitcommittet.
