# Sicherung und Wiederherstellung der früheren Review-Automatik

Gesichert am 2026-09-06 auf Nutzerauftrag. Diese Anleitung aktiviert nichts automatisch.

## Gesicherter Stand

- Vollständiger Repository-Stand vor dem Rückbau:
  [`backup/review-automation-before-removal-20260906`](https://github.com/blorbeer-cmd/LAN_2026/tree/backup/review-automation-before-removal-20260906),
  Commit `e91a3f47006750ae46e6fcdb335c4b10fdb857b4`. Der annotierte Tag ist auf GitHub gepusht.
- [Branch-Schutz vor der Umstellung](protection.json),
  [Workflow-IDs und ursprüngliche Zustände](workflows.json),
  [Human-merge-Ruleset](human-merge-ruleset.json): unveränderte Momentaufnahmen vom 2026-09-05,
  unmittelbar vor dem Abschalten. Keine Secret-Werte enthalten.
- Lokale zusätzliche Sicherung:
  `C:\Users\BOB\Backups\LAN_2026\review-automation-20260906`.
  Sie enthält das vollständige alte Repository als ZIP, die drei GitHub-Momentaufnahmen,
  vorhandene persönliche Skill-Backups und ein SHA-256-Manifest. ZIP-Integrität und erwartete
  Pipeline-Dateien wurden geprüft. Die Sicherung liegt außerhalb von Temp und den Worktrees.
- Die Pipeline-Secrets `CLAUDE_CODE_OAUTH_TOKEN` und `AGENT_PIPELINE_REVIEW_REQUEST_TOKEN`
  waren am 2026-09-06 weiterhin auf GitHub vorhanden; ihre Werte sind nicht auslesbar und wurden
  weder exportiert noch gelöscht. Vorhandensein beweist keine Gültigkeit. Repository-Variable
  `AGENT_PIPELINE_OWNER` war `blorbeer-cmd`; `AGENT_PIPELINE_DISABLED` war nicht gesetzt.
- Kein aktiver passender lokaler Codex-/Windows-Monitor war auffindbar. Deshalb enthält die
  Sicherung keinen angeblich exportierten Monitor. Dessen Einrichtung muss bei Bedarf anhand
  der alten README und der dann verfügbaren Codex-Funktionen neu erfolgen.

Die Sicherung bewahrt den früheren Stand, einschließlich seiner bekannten Probleme. Sie ist
keine Zusicherung, dass Tokens, Anbieter-Integrationen und externe APIs künftig unverändert arbeiten.

## Wiederherstellen

1. **Zeitpunkt klären.** Solange PR #547 noch nicht gemergt ist, liegen die alten Dateien bereits
   auf `main`. Dann keinen Code-Revert durchführen. Nach einem Merge einen neuen Feature-Branch
   und eigenen Worktree vom aktuellen `origin/main` erstellen. Der ursprüngliche Rückbau-Commit
   ist zusätzlich durch den Remote-Tag `backup/review-automation-removal-commit-20260907`
   gesichert. Auch in einem frischen Clone nach Squash-Merge und Branch-Löschung zuerst laden:

   ```powershell
   git fetch origin tag backup/review-automation-removal-commit-20260907
   git rev-parse 'backup/review-automation-removal-commit-20260907^{commit}'
   git revert --no-commit 77e4ffe744c7a4b9780182c6895a42c405576f94
   ```

   Die SHA-Ausgabe muss `77e4ffe744c7a4b9780182c6895a42c405576f94` sein; andernfalls stoppen.
   Der inverse Patch benötigt keine Vorfahrenbeziehung zu `main`. Konflikte mit späteren
   Änderungen inhaltlich lösen und vor dem Commit den gesamten Diff prüfen. Insbesondere
   später ergänzte manuelle Beobachtungsregeln mit den wiederhergestellten Pipeline-Regeln
   abstimmen. Nicht den gesamten Squash-Commit von PR #547 revertieren: Das würde auch die
   später hinzugefügte Sicherungsanleitung und Konfigurationssnapshots entfernen. Diese Dateien
   erhalten. Niemals `main` auf einen alten Tag zurücksetzen. Der Vorher-Tag bleibt die
   unabhängige Quelle zum Vergleichen und für einzelne alte Dateien.
2. **Code und Regeln gemeinsam zurückholen.** Der Revert stellt Workflow-Dateien, alle neun
   Pipeline-Skriptpaare samt Tests, Konfiguration, PR-Task-Vertrag und alte Agenten-Regeln wieder
   her. Er entfernt auch die neu eingeführten manuellen Skillvorlagen und den Ersatz-Tooling-
   Workflow. Später hinzugekommene notwendige Verbesserungen gezielt erhalten. Die persönlichen
   Skills außerhalb des Repositorys werden durch Git nicht verändert: den manuellen Review-Skill
   vorerst nicht benutzen oder bewusst mit den alten Regeln abstimmen. Er ersetzt keinen alten
   Pipeline-Nachweis und stellt keine technisch abgesicherte Reviewer-Session bereit.
3. **Voraussetzungen prüfen.** Im gesicherten Stand `.github/agent-pipeline/README.md`,
   `config.json` und die Review-Session-Anleitung lesen. Node.js 24, `gh`, Anbieterzugriff,
   gültige oben genannte Secrets, Owner-Variable, konfigurierte Reviewer-Identitäten, benötigte
   Labels und die Codex-/Claude-GitHub-Anbindungen prüfen. Credentials nicht aus dem ZIP erwarten.
   Alte Task-Verträge für Pilot-PRs mit tatsächlichem Anbieter, Branch, Ausgangs-SHA und neuer
   Task-ID ausfüllen; keinen alten Vertrag oder Review-Erfolg kopieren.
4. **Prüfen und menschlich mergen.** Die Tests aus dem wiederhergestellten
   `.github/workflows/agent-pipeline-tests.yml` lokal ausführen und normale CI prüfen. Den
   Wiederherstellungs-PR manuell reviewen lassen und vom Nutzer mergen lassen. Die deaktivierten
   Pipeline-Workflows während der Vorbereitung deaktiviert lassen. Alte Anforderungen an
   technische Isolation erfordern die tatsächliche Einrichtung; ein Skilltext genügt nicht.
5. **Workflows bewusst aktivieren.** Erst wenn die alten Dateien wieder auf `main` liegen,
   mit `gh workflow enable ID --repo blorbeer-cmd/LAN_2026` einzeln aktivieren:

   | ID | Workflow |
   | --- | --- |
   | 330335257 | Agent pipeline Claude cross-review |
   | 334586866 | Agent pipeline Claude self-review |
   | 330697536 | Agent pipeline Codex review |
   | 320507855 | Agent pipeline contract |
   | 327784872 | Agent pipeline reconcile |
   | 327144941 | Agent pipeline tests |

   IDs vorher gegen die aktuellen Workflow-Pfade abgleichen. Aktivierung kann sofort vorhandene
   passende PRs verarbeiten; vorab offene PRs, deren Verträge und Wahl-Labels prüfen. Bei Bedarf
   den dokumentierten Schalter `AGENT_PIPELINE_DISABLED=true` während der Einrichtung nutzen
   und erst für den kontrollierten Pilot deaktivieren. Keinen anbieterfremden Modus als Ersatz
   für einen fehlgeschlagenen Start verwenden.
6. **Optionalen Host-Monitor neu einrichten.** Für Codex-Zustellung und Codex-Self-Review den in
   der alten README beschriebenen Fünf-Minuten-Monitor in einer dedizierten Codex-Task anlegen.
   Er verwendet den vertrauenswürdigen `main`-Stand, `scan` und `ack`, die echten Task-Zuordnungen
   und den alten Sandbox-Runner. Bestehende Automationen zuerst prüfen, um Doppelzustellungen
   zu vermeiden. Ohne diesen Host-Teil funktioniert die gesamte alte Automatik nicht vollständig.
7. **Pilot vor dem Pflichtcheck.** Einen dafür vorgesehenen PR vollständig durch Auswahl,
   Reviewstart, Ergebnispublikation, Findings-Zustellung und gegebenenfalls Fix/erneutes Review
   führen. Der alte Check muss für den aktuellen Head zuverlässig erscheinen. Erst danach den
   Required Check `Agent pipeline / ready for human merge` wieder hinzufügen. Aktuellen Schutz
   neu lesen und dessen `checks` um den fehlenden Eintrag aus `protection.json` ergänzen
   (`app_id: 15368`, zuvor gegen die tatsächliche App verifizieren). Mit
   `PATCH repos/blorbeer-cmd/LAN_2026/branches/main/protection/required_status_checks` nur
   `strict` und die ergänzte aktuelle `checks`-Liste senden. Keine komplette alte Schutzdatei
   zurückschreiben: Spätere legitime Schutzänderungen müssen erhalten bleiben.
8. **Nachkontrolle.** Pflichtchecks und Schutzregeln zurücklesen, CI und Review für den aktuellen
   Head prüfen, keine doppelten Monitore, keine verwaisten Pending-Checks. Der finale Merge bleibt
   beim Nutzer. Bei Problemen zunächst die sechs Workflows wieder deaktivieren und nur den
   wieder hinzugefügten Pipeline-Pflichtcheck entfernen; normale CI und Human-merge-Schutz erhalten.

Das Wiederherstellungsverfahren ist dokumentiert, wurde aber bewusst nicht gegen das laufende
Repository ausgeführt. Verifiziert sind Sicherungsintegrität, Remote-Tag und die Konfigurations-
Momentaufnahmen. Ein echter Ende-zu-Ende-Test erfordert die spätere kontrollierte Reaktivierung.
