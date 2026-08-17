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
  `DEVELOPMENT_GUIDELINES.md` und im Pipeline-Konzept bleiben verbindlich.
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

Jeder Änderungsauftrag aktiviert nach erfolgreicher Umsetzung und den einschlägigen Prüfungen
standardmäßig den Abschluss über Commit, Push des eigenen Feature-Branches und Draft-PR. Der Nutzer
kann diesen Abschluss ausdrücklich ganz oder teilweise ausschließen. Sobald ein Coding-Agent im
Rahmen eines Nutzerauftrags einen Branch oder Pull Request erstellen, pushen oder weiterbearbeiten
soll, gilt zusätzlich
[`docs/plans/auto-feature-to-deploy-pipeline.md`](docs/plans/auto-feature-to-deploy-pipeline.md).
Das vollständige Konzept nur für Arbeiten am PR-Lebenszyklus oder an der Pipeline selbst laden;
für normale Implementierungsdetails gelten diese Kurzregeln:

- Ein fehlgeschlagenes `gh auth status` innerhalb einer Sandbox beweist keinen ungültigen Token.
  Netzwerk-, DNS-, Socket-, Timeout- und Sandboxfehler von einer GitHub-Authentifizierungsantwort
  unterscheiden und dieselbe schreibgeschützte Prüfung bei Bedarf über den erlaubten
  Netzwerk-/Freigabepfad wiederholen. Die Anmeldung zusätzlich mit einer echten lesenden
  GitHub-Abfrage wie `gh api user` oder einer Repository-Abfrage verifizieren. `gh auth login` erst
  verlangen, wenn eine netzwerkfähige Prüfung tatsächlich `401 Bad credentials` oder einen
  gleichwertigen eindeutigen Authentifizierungsfehler von GitHub liefert. Nach dem Branch-Push den
  PR bevorzugt über die GitHub-App erstellen; `gh pr create` bleibt der Fallback.
- Agenten-PRs erhalten den maschinenlesbaren Task-Vertrag aus der PR-Vorlage. Die Task-ID wird beim
  Erstellen aus aktuellem Datum und einem aufgabenspezifischen, kleingeschriebenen Bezeichner im
  Format `agent-YYYYMMDD-<id>` gebildet; bei einer Kollision einen kurzen eindeutigen Suffix
  anhängen und niemals den Vorlagenwert übernehmen. Anbieter, Branch, Scope und Ausgangs-SHA
  müssen der tatsächlichen Arbeit entsprechen.
- Der Implementierungs-Agent behebt eigene CI-Fehler, Mergekonflikte und berechtigte
  Review-Findings. Nach jedem neuen Commit sind CI und Review für den neuen Head-SHA erneut nötig.
- Wer reviewt, entscheidet der Nutzer pro Head-SHA: Cross-Review durch den Gegen-Anbieter
  (`review:cross`), Review durch denselben Anbieter in einer frischen, isolierten und
  schreibgeschützten Session (`review:self`) oder menschliches Review (`review:human`). Der Agent
  legt die Auswahl mit einer Empfehlung vor, sobald CI grün und der PR konfliktfrei ist, und setzt
  danach das gewählte Label selbst. Ohne ausdrückliche Antwort des Nutzers wird nie ein Wahl-Label
  gesetzt oder geändert. Ablauf und Empfehlungsregeln:
  `.github/agent-pipeline/review-decision.md`.
- Die Auswahl wird als gewöhnlicher Text am Ende des Zuges vorgelegt, nie über ein blockierendes
  Frage-Werkzeug. Sie ist bewusst asynchron, steht dauerhaft als PR-Kommentar bereit und darf die
  Eingabe der Session nicht sperren; der Nutzer antwortet mit einem normalen Prompt oder setzt das
  Label selbst.
- Pro Head-SHA wird höchstens einmal gefragt. Nicht erneut gefragt wird, wenn der Pull Request
  gemergt oder geschlossen ist, wenn für den aktuellen Head bereits eine Wahl oder ein bestandenes
  Review vorliegt oder wenn die Frage für diesen Head schon gestellt und noch unbeantwortet ist.
  Ein erneutes Wecken durch Check-in, CI- oder PR-Ereignis ist kein neuer Anlass; dann wird nur der
  Fortschritt berichtet. Der Zustand wird vor jeder Frage aus GitHub gelesen, nicht aus dem
  Gedächtnis der Session.
- Mit dem Merge oder dem Schließen des Pull Requests endet die Begleitung endgültig: eigene
  wiederkehrende Check-ins und PR-Ereignis-Abonnements abbestellen, das Ende einmal melden und
  danach für diesen Pull Request nichts mehr fragen. Folgearbeit beginnt auf einem neuen Branch.
- Nach der Wahl laufen Reviewstart, Findings-Übergabe und Fix wieder automatisch. Ein Review darf
  nie übersprungen werden; ist der gewählte Anbieter nicht verfügbar, wird der Ausfall gemeldet und
  die Auswahl erneut vorgelegt, nie stillschweigend ein anderer Modus verwendet. Separate Reviews
  verwenden den Prompt und Ablauf unter `.github/agent-pipeline/review-session-prompt.md`.
- Nur kritische oder wesentlich mehrdeutige Entscheidungen werden dem Nutzer vorgelegt. Normale
  Fixes laufen bis zum grünen, konfliktfreien und vollständig reviewten PR automatisch weiter.
- Bei sichtbaren UI/UX-Änderungen den Nutzer informieren, sobald der Branch sinnvoll prüfbar ist:
  Änderung, exakter Branch, PR-Link und konkrete Prüfschritte nennen.
- Kein Coding-Agent approvt oder merged. `main`, Branch-Schutz, Workflows, Infrastruktur, Secrets
  und Deploy-Berechtigungen bleiben außerhalb automatischer Fixes. Der finale Merge gehört immer
  dem Nutzer.
- Nach der Behebung eines Review-Findings oder einer bestätigten Zurückweisung/Obsoleszenz markiert
  der Implementierungs-Agent den zugehörigen auflösbaren Inline-Review-Thread einschließlich seiner
  Kommentare als gelöst. Vor dem Merge ist dieser Zustand zu prüfen.
