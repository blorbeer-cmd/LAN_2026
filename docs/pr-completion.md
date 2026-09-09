# PRs aktuell halten und nach Nutzerfreigabe abschließen

Dieser Ablauf ergänzt die manuellen Reviews. Er führt die entfernte Agenten-Pipeline nicht
wieder ein. Die Implementierungs-Session begleitet genau ihren PR mit dem vorhandenen
15-Minuten-Scheduler. `scripts/pr-completion.mjs` erledigt die wiederkehrenden Git-/GitHub-Prüfungen
und begrenzt Branch-Update und Merge. Node.js 24, Git mit `merge-tree --write-tree` und eine
authentifizierte `gh`-CLI sind erforderlich. Bestehende GitHub-Schutzregeln bleiben bestehen.

## Bedienung

1. Einen kleinen Änderungsauftrag erteilen. Der Implementierer erstellt wie bisher Branch,
   Worktree und Draft-PR, prüft CI und meldet Reviewbereitschaft mit PR-Nummer und Startbefehlen.
2. Review manuell mit `/pr-review URL` beziehungsweise `$pr-review URL` in einer frischen
   Unterhaltung starten. Alternativ ausdrücklich beauftragen: „Starte für PR #123 eine neue
   Codex-Review-Task und bei weiteren Commits erneut eine frische Review-Task mit Codex.“ Der
   gewählte Anbieter bleibt für diese Folgereviews bestehen; ohne diesen Auftrag werden keine
   neuen Tasks automatisch erzeugt. Keine Implementierungs-Konversation an den Reviewer forken.
3. Neue Findings werden durch die Implementierung bearbeitet. CI und vollständiges Review müssen
   den aktuellen Head prüfen. Die Review-Session veröffentlicht ihr Ergebnis am PR; die
   Implementierungs-Session liest es von dort und bestätigt es nicht aus eigener Erinnerung.
4. Mit „PR #123 zum Merge freigegeben“ den Abschluss autorisieren. Vor dem Übertragen den
   aktuellen Head nennen beziehungsweise eine eindeutig dazugehörige Bereitschaftsmeldung
   zuordnen. Bei zwischenzeitlich geändertem Code erst den neuen Stand vorlegen. Die Anweisung
   als Wortlaut sichern; niemals eine Freigabe erfinden oder aus „Review ist durch“ ableiten.
5. Die Implementierung hält den Branch aktuell, wartet auf CI, lässt bei Bedarf ein ausdrücklich
   autorisiertes Folgereview laufen und merged bei vollständiger Bereitschaft. Bei manueller
   Reviewwahl liefert sie den neuen Startbefehl und wartet auf das Ergebnis. Ein Draft wird erst
   nach vollständigem Review auf „Ready“ gesetzt. Danach prüft der Merge-Helfer alles erneut.
6. Nach bestätigtem Merge die Beobachtung beenden und einmal den Abschluss melden. Folgearbeit
   beginnt auf einem neuen Branch. „Merge-Freigabe für PR #123 zurückziehen“ widerruft sie sofort.

Eine Freigabe kann schon vor fertiger CI erteilt werden; sie löst keinen vorzeitigen Merge aus.
Sie umfasst konfliktfreie `main`-Updates, die der Helfer selbst berechnet, ausführt und anhand
von beiden Eltern-Commits und dem vollständigen Git-Tree nachweist. Ein neuer Fix, eine manuelle
Konfliktlösung, ein fremder Push oder eine unklare Übertragung entwertet die Freigabe. Normale
Fixes werden trotzdem fertiggestellt; erst dann wird der neue Stand zur Freigabe vorgelegt.
Die Reviewer-Wahl und die Merge-Freigabe sind getrennt: die Wahl kann für Folgereviews gelten,
ein altes positives Ergebnis gilt niemals für den neuen Commit.

## Eindeutige Sessionnamen

- Implementierung: `PR #123 · Umsetzung · Packliste`.
- Review: `PR #123 · Review · Codex · a1b2c3d` beziehungsweise `Claude`.
- Beobachtung: `PR #123 · Begleitung`.
- Vor PR-Erstellung: `Task <Branch-Kurzname> · Umsetzung · <Thema>`; anschließend einmal ersetzen.

Codex verwendet `set_thread_title` für die eigene Task beziehungsweise einen bekannten,
ausdrücklich zugeordneten Review-Task. Bei `create_thread` den Titel direkt mitgeben. Im
Implementierungs-Kontext PR-URL, eigener Worktree, Implementierungs-Task-ID und Review-Task-ID
festhalten; im Review-Prompt nur PR, erwarteter Head und Rückverweis auf die Implementierungs-Task
nennen, keine Implementierungsbegründung. Nach jedem Review steht die PR-Nummer auch am Anfang
des Berichts und der Abschlussmeldung. Der Reviewbericht enthält die echte Session-ID, soweit
die Oberfläche sie liefert; niemals eine ID erfinden. GitHub bleibt die Quelle für Ergebnisse.

Claude unterstützt benannte Starts mit `claude --name "PR #123 · Review · Claude"` und den
interaktiven Befehl `/rename PR #123 · Review · Claude`. Falls die installierte Oberfläche dem
Agenten kein Titelwerkzeug bereitstellt, beginnt er mindestens seine erste Antwort mit diesem
Identifier und liefert den `/rename`-Befehl. Er behauptet dann keine erfolgreiche automatische
Umbenennung und verändert keine internen Session-Dateien. Siehe
[Claude Sessions](https://code.claude.com/docs/en/sessions).

## Helfer für die Implementierungs-Session

Alle Befehle im **eigenen PR-Worktree** ausführen. Die folgenden Werte sind Beispiele, keine
Freigabe für einen vorhandenen PR. `status` liest GitHub inklusive aller Review-Seiten und
Inline-Threads. Bei fehlenden Zugriffsrechten, unbekanntem Mergezustand oder während des Lesens
geänderten SHAs stoppt die Aktion.

```powershell
node scripts/pr-completion.mjs status --repo blorbeer-cmd/LAN_2026 --pr 123
node scripts/pr-completion.mjs update --repo blorbeer-cmd/LAN_2026 --pr 123
```

`update` prüft Repository, Branch, sauberen Arbeitsbaum und Gleichheit mit dem Remote-Head.
Es holt `main`, berechnet einen konfliktfreien Merge ohne Arbeitsbaumänderung, merged ohne
Rebase/Force-Push und pusht nur den eigenen Feature-Branch. Konflikte lösen keine automatische
Seitenwahl aus. Eindeutige Konflikte darf die Implementierung separat beheben; kritische oder
mehrdeutige Konflikte werden vorgelegt. Diese Lösung braucht eine neue Merge-Freigabe.

Nach **ausdrücklicher** Nutzerfreigabe deren tatsächlichen Wortlaut in eine temporäre UTF-8-Datei
außerhalb des Repositorys schreiben. Reviewer-Konto aus dem bekannten Review beziehungsweise
der verbundenen Review-Identität bestimmen, nicht aus Branchpräfix oder PR-Autor raten.

```powershell
node scripts/pr-completion.mjs authorize --repo blorbeer-cmd/LAN_2026 --pr 123 --head FULL_HEAD_SHA --reviewer-login GITHUB_LOGIN --request-file ABSOLUTE_REQUEST_FILE
node scripts/pr-completion.mjs merge --repo blorbeer-cmd/LAN_2026 --pr 123
node scripts/pr-completion.mjs revoke --repo blorbeer-cmd/LAN_2026 --pr 123
```

Der Freigabebefehl veröffentlicht die übertragene Nutzeranweisung mit SHA und Bedingungen am PR.
Er ersetzt keine Zustimmung: der aufrufende Agent darf ihn ausschließlich aufgrund der echten
Nutzerantwort ausführen. Freigaben liegen außerhalb des Arbeitsbaums unter
`<git-common-dir>/pr-completion/<owner>--<repo>/<PR>.json`. Die lokale Datei und der Reviewmarker
sind keine Sicherheitsgrenze gegen einen böswilligen Prozess mit denselben Schreibrechten.
Sie machen den normalen Agentenablauf prüfbar und verhindern versehentliche Übertragungen.

Der Merge erfordert: offener PR ins eigene `main`, kein Draft, aktueller konfliktfreier Branch,
alle von GitHub gemeldeten Pflichtchecks erfolgreich (einschließlich legitim übersprungener
Jobs), keine offenen Threads/Änderungsanforderungen und vollständiges natives Review für den
aktuellen Head **und** die aktuelle Base vom festgelegten Konto. Das Review beginnt mit dem
unten beschriebenen Marker; ein normaler Kommentar oder ein altes Review ohne Marker genügt
dem automatischen Helfer nicht. Der Agent liest zusätzlich die normalen PR-Kommentare und den
gesamten Bericht auf neue Findings. Ein unvollständiger Bericht darf keinen Pass-Marker erhalten.
Der Helfer verwendet `gh pr merge --squash --match-head-commit`, niemals `--admin`, `--auto` oder
einen Push auf `main`. GitHub prüft seine Schutzregeln zusätzlich beim Merge.

## Queue, Beobachtung und Wiederaufnahme

Freigegebene PRs desselben lokalen Repositorys werden in Reihenfolge ihrer Freigabe bearbeitet.
Ein gemeinsames Dateilock serialisiert Mutationen über alle verlinkten Worktrees; spätere
freigegebene PRs melden `waiting`, bis der vordere gemergt, geschlossen, widerrufen oder durch
einen fremden Head entwertet wurde. Sie werden nicht nach jedem Merge alle zugleich aktualisiert.
Getrennte Klone oder Rechner teilen diese Queue nicht. Pro PR nur eine zuständige Implementierung.

Der 15-Minuten-Heartbeat speichert PR, Worktree, Head, eigene Scheduler-ID, Review-Task-IDs,
autorisierte Folgereview-Wahl und bearbeitete Ergebnis-IDs. Bei einem Check:

1. GitHub-Zustand, Reviews, normale Kommentare und Threads frisch lesen; neue Findings bearbeiten.
2. Bei Merge/Schließen/Nutzerstopp eigene Beobachtung beenden; vorhandene Freigabe widerrufen.
3. Bei laufendem Review keinen vorsorglichen Base-Merge erzeugen. Vor dem nächsten Review und
   vor dem Abschluss `update` ausführen. Queue-Wartezustände still lassen.
4. CI abwarten; eigene Fehler beheben. Bei neuem Head genau ein vollständiges Review starten,
   sofern neue Review-Sessions mit festem Anbieter ausdrücklich autorisiert sind. Sonst einmal
   die manuellen Startbefehle vorlegen. In Codex `create_thread` nur unter dieser ausdrücklichen
   Autorisierung verwenden und den echten Titel/die ID speichern; ein Fork der Umsetzung ist
   kein frisches Review. Bei Claude nur tatsächlich verfügbare Werkzeuge verwenden.
5. Vollständiges Ergebnis prüfen, berechtigte Findings beheben und Threads auflösen. Bei drei
   erfolglosen Fixrunden oder einer wesentlichen Entscheidung anhalten und den Grund nennen.
6. Liegt noch eine gültige Freigabe vor, bei Bereitschaft den Helfer `merge` ausführen. Ohne
   Freigabe einmal mergebereit melden und die Beobachtung beenden. Eine spätere Freigabe
   aktiviert dieselbe Beobachtung erneut. Ohne neue relevante Ergebnisse still bleiben.

Der Helfer selbst startet keinen Scheduler und keinen Reviewer. Die Einrichtung ist erst
abgeschlossen, wenn das jeweilige Scheduling-Werkzeug eine echte ID zurückgegeben hat.
Codex benötigt eine laufende App und einen verfügbaren Rechner. Claude-Sessionjobs können beim
Beenden verloren gehen und laufen spätestens nach sieben Tagen ab; nach Wiederaufnahme prüfen.
Bei Anbieter-Ausfall oder fehlender Start-/Titel-/Scheduler-Schnittstelle die konkrete Grenze
einmal melden. Keine unbeaufsichtigte Ersatzwahl, kein stummes Aufgeben und keine Doppelstarts.

Nach einem abgebrochenen Update zuerst lokalen/Remote-Head und GitHub prüfen. Keine blinden
Wiederholungspushes. Ist die konfliktfreie Übertragung nicht vollständig belegt, die Freigabe
verwerfen. Ein nach Prozessabbruch verbliebenes `mutation.lock` nur entfernen, wenn der darin
genannte Prozess nachweislich nicht mehr arbeitet. Nie fremde Worktrees resetten oder stashen.

## Review-Ergebnisformat

Für diesen Ablauf beginnt der **native GitHub-Reviewbody** mit genau einer Zeile:

```text
<!-- pr-review:v1 head=FULL_HEAD_SHA base=FULL_BASE_SHA verdict=pass -->
```

Beide SHAs sind echte vollständige 40-stellige Werte.
`base` ist dabei `baseRefOid`, die beim Review verifizierte aktuelle Spitze des Base-Branches
(`main`), nicht der Git-Merge-Base. Der Merge-Base begrenzt weiterhin den zu prüfenden Diff.
Erlaubte Ergebnisse: `pass`,
`changes-required`, `incomplete`. Danach folgen PR-Nummer, Reviewer, echte Session-ID soweit
bekannt, Prüfungsumfang, Findings, Prüfungen und Grenzen. `commit_id` muss dem Head entsprechen.
Der Marker allein ist kein Review und kein GitHub-Approval. Ein Reviewer veröffentlicht nur
sein eigenes tatsächliches Ergebnis; die Implementierung darf fehlende Marker nicht ergänzen
oder ein fremdes Ergebnis zu `pass` umschreiben. Bei älteren Skills ein neues Review anfordern
oder den PR weiterhin manuell abschließen.

## Validierung

```powershell
node --test scripts/pr-completion.test.mjs scripts/agent-preflight.test.mjs
```

Tests decken veraltete Freigaben und Reviews, falsche Identitäten, fehlende/rote Checks,
unaufgelöste Threads, konkurrierende Heads, fremde/verschmutzte Worktrees und die Beweisgrenzen
konfliktfreier Base-Merges ab. Der Git-Test erzeugt dafür ein temporäres Repository. Ein echter
Merge-/Scheduler-Pilot benötigt einen separat freigegebenen PR; Tests erteilen keine Freigabe
für diesen Einrichtungs-PR oder andere offene PRs.
