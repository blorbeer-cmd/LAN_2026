# PR #530: Make test design rules binding and stop schematic test growth

- Datum des Merges: 2026-09-01
- Branch: `claude/test-quality-stability-dn92zn`
- Merge-Commit: [`7f24f0f`](https://github.com/blorbeer-cmd/LAN_2026/commit/7f24f0f65d6046ee39cf80234040089431ae5185)
- Pull Request: [#530](https://github.com/blorbeer-cmd/LAN_2026/pull/530)

## Changelog

- `server/TESTING.md` erhält den Abschnitt „Verbindliche Test-Design-Regeln“ mit sechs Regeln:
  niedrigste geeignete Testebene, vorhandene Abdeckung vor jedem neuen Test prüfen, beobachtbares
  Verhalten statt Implementierungsdetails prüfen, auf Zustände statt auf Zeit warten,
  Unabhängigkeit und ursächliche Flake-Behebung, sowie die ausdrückliche Erlaubnis, nachweislich
  redundante Tests zu vereinfachen, zusammenzuführen oder zu entfernen. Anlass war eine externe
  Analyse der Testqualität; Ausgangspunkt waren 200 Testdateien und 38.029 Test-LOC gegenüber
  39.020 LOC in `server/src`.
- Sechs bestehende Regeln, die dem widersprochen hätten, wurden im selben PR aufgelöst: Coverage
  gilt als Diagnosewert statt als Treiber für neue Tests; aus „niemals Abdeckung entfernen“ wird
  „niemals *relevante* Abdeckung entfernen“ in `server/TESTING.md`, `DEVELOPMENT_GUIDELINES.md` und
  `docs/plans/auto-feature-to-deploy-pipeline.md`; die Eskalationsliste des Pipeline-Konzepts
  stoppt nur noch, wenn beim Löschen eines Tests relevante Abdeckung verloren geht, während
  Lockern und Umgehen eskalationswürdig bleiben; der Parallel-Request-Integrationstest für
  race-relevante Handler bleibt in `server/DEVELOPMENT_GUIDELINES.md` ausdrücklich eine bewusst
  schematische Pflicht; und Regel 5 nennt die absichtlich zustandsbehafteten E2E-Owner als eng
  gefasste Ausnahme, die nur für geteilten Zustand zwischen Geschwistertests desselben Owners gilt.
- `DEVELOPMENT_GUIDELINES.md` Abschnitt 4: „Happy Path, relevante Validierungsfehler und
  Zustandskonflikte“ wird von einer schematischen zu einer risikobasierten Anforderung und verweist
  für `server/` auf die neuen Regeln.
- `server/AGENTS.md` erhält den Abschnitt „Test-Qualität“: Die Regeln aus `TESTING.md` sind
  verbindliche Akzeptanzkriterien, und eine Produktionscodeänderung allein rechtfertigt keinen
  neuen Test.
- `.github/agent-pipeline/review-session-prompt.md` erhält Prüfpunkt 8 für Testqualität in beide
  Richtungen — der Reviewer darf ausdrücklich auch Entfernen, Zusammenführen und das Verschieben
  auf eine niedrigere Testebene empfehlen — mit einer Schweregrad-Obergrenze: grundsätzlich `low`,
  `medium` nur bei belegtem falschem Vertrauen, Flake-Risiko oder Laufzeitwirkung. Damit blockieren
  Testqualitäts-Findings einen PR nicht, solange sie keine echte Zuverlässigkeit kosten.
- Ein Testfix als erster Befund der neuen Regel 5: Der E2E-Flow „Orga Events tab and Profil use
  grouped help“ in `server/src/test/e2e/flows.fixture.ts` verließ sich auf den Formular-Default
  „jetzt“ als Event-Beginn und schlug an **jedem Monatsersten** fehl. Der Kalender des Endfelds
  öffnet im Monat seines Minimums und rendert Buttons nur für dessen eigene Tage; am 1. existiert
  kein gerenderter Tag davor, den die Disabled-Day-Assertions treffen könnten. Beginn und Uhrzeit
  liegen jetzt auf einem festen Datum mitten im Monat, das ungültige Ende wird daraus abgeleitet.
  Der Beginn wird zuerst gesetzt, weil `wireDateTimeRange` ein früher liegendes Ende nachzieht.
  Kein Produktionscode betroffen.
- Bewusst nicht enthalten: Mutation Testing, Coverage-Gates, neue CI-Checks und ein Audit des
  bestehenden Testbestands. Das Audit folgte separat mit
  [#532](pr-532-audit-the-test-suite-and-fix-its-findings.md).
- Bewusst nicht übernommen wurde das absolute Sleep-Verbot der Analysevorlage: Regel 4 lässt das
  Verstreichenlassen einer echten, produktiv existierenden Frist zu, weil es in
  `src/test/api.challengeRush.test.ts` dort keinen beobachtbaren Zwischenzustand zum Warten gibt.
