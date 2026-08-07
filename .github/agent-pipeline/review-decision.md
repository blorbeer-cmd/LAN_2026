# Review-Entscheidung nach Abschluss einer Aufgabe

Dieser Ablauf gehört zur Agenten-Pipeline aus
[`../../docs/plans/auto-feature-to-deploy-pipeline.md`](../../docs/plans/auto-feature-to-deploy-pipeline.md).
Er beschreibt den einen Punkt, an dem der Nutzer entscheidet: **wer** das Review durchführt.
Alles danach — Review starten, Findings übergeben, Findings beheben, Threads auflösen — läuft
automatisch weiter.

## Wann fragen

- Nach abgeschlossener Implementierung, sobald der Branch gepusht und die einschlägigen Prüfungen
  grün sind.
- Nach jedem Fix-Commit erneut, denn jeder neue Commit entwertet das vorherige Verdikt.
- Nicht fragen, solange CI rot ist, ein Mergekonflikt offen ist oder der PR ein Draft ist. Diese
  Punkte behebt der Implementierungs-Agent zuerst ohne Rückfrage.
- Nicht fragen, wenn `agent:no-auto`, `agent:needs-human` oder `agent:waiting` gesetzt sind.

## Die drei Optionen

| Option              | Modus    | Label          | Unabhängigkeit                                                     |
| ------------------- | -------- | -------------- | ------------------------------------------------------------------ |
| a) Cross-Review     | `cross`  | `review:cross` | höchste: der jeweils andere Anbieter                                |
| b) Gleicher Agent   | `self`   | `review:self`  | reduziert: derselbe Anbieter in frischer, schreibgeschützter Session |
| c) Menschlich       | `human`  | `review:human` | Review und Merge liegen bei derselben Person                        |

Es gibt bewusst keine vierte Option „kein Review". Wenn kein Agenten-Review mehr nötig erscheint,
ist c) die richtige Wahl: das Review findet dann beim Menschen statt und wird durch seine Approval
des exakten Head-SHAs sichtbar.

## Empfehlung bilden

Die Empfehlung ist beratend und ändert das Merge-Gate nie. Der Reconciler kennt nur die geänderten
Pfade und ob ein früherer Head bereits ein Review bestanden hat; die Session kennt zusätzlich die
Schweregrade der zuletzt behobenen Findings und den Umfang des Fixes. Deshalb verfeinert die
Session die Empfehlung aus dem Statuskommentar:

**Cross-Review empfehlen**, wenn mindestens einer dieser Punkte zutrifft:

- die letzte Runde enthielt `critical`- oder `high`-Findings,
- der Fix hat Dateien oder Bereiche außerhalb des jeweiligen Findings berührt,
- betroffen sind geschützte Pfade, Datenbankmigrationen, Authentifizierung, Gruppen-/Mandantengrenzen
  oder Realtime-Logik,
- die CI war nach dem Fix rot,
- für diesen Pull Request hat noch kein Review bestanden.

**Selbst-Review empfehlen**, wenn alle Punkte zutreffen:

- es lagen nur `low`- oder `medium`-Findings vor,
- der Fix blieb eng am Finding,
- die einschlägigen Tests sind grün,
- ein früherer Head hat bereits ein Review bestanden.

**Menschliches Review empfehlen**, wenn seit dem letzten bestandenen Review nur Dokumentation,
Kommentare oder Changelog-Einträge geändert wurden.

Zusätzlich immer nennen, was für die Budgetentscheidung zählt: welcher Anbieter bei a) reviewen
würde und ob für einen der Anbieter bereits ein Limit oder ein Timeout beobachtet wurde.

## Frageformat

Die Frage wird als Auswahl mit genau diesen drei Optionen gestellt und nennt vorab kompakt:

- Implementierer und wer bei a) reviewen würde,
- Head-SHA und was sich seit dem letzten Review geändert hat (Dateien, Umfang),
- Schweregrade der zuletzt behobenen Findings, sonst „erste Runde",
- offene Review-Threads,
- Empfehlung mit einer Zeile Begründung.

Beispiel:

```text
Head 4f2ab19, Implementierung: claude, Cross-Review käme von codex.
Seit dem letzten Review: 2 Dateien, ~40 Zeilen, Fix zu 1 medium-Finding.
Offene Threads: 0. Empfehlung: b) Selbst-Review — der Fix blieb eng am Finding,
Tests grün, ein früherer Head hat bereits bestanden.

a) Cross-Review durch codex
b) Selbst-Review durch claude (frische, schreibgeschützte Session)
c) Menschliches Review
```

Ohne Antwort wird nichts gestartet. Ein Timeout, der ersatzweise ein Review startet, würde genau
das Kontingent verbrauchen, das diese Frage schützen soll.

## Nach der Antwort

1. Der Agent setzt das zugehörige Label selbst am Pull Request, sofort nach der Antwort und ohne
   weitere Rückfrage. Der Nutzer muss dafür nicht auf GitHub wechseln. Genau ein Wahl-Label
   gleichzeitig: ein zuvor gesetztes anderes wird dabei entfernt. Erst das Label bringt die Wahl
   ins Merge-Gate und macht sie außerhalb der Session sichtbar.
2. Bei a) und b) das Review nach
   [`review-session-prompt.md`](review-session-prompt.md) starten — `review_mode: cross`
   beziehungsweise `self`.
3. Findings automatisch beheben, Verifikation ausführen, pushen, die zugehörigen Inline-Threads
   auflösen. Keine Rückfrage für normale Fixes; eskaliert wird nur nach den Regeln aus Abschnitt 12
   des Hauptkonzepts.
4. Bei b) das Ergebnis als Kommentar veröffentlichen, damit das Gate es sehen kann:

   ```text
   <!-- agent-pipeline:review-result <head-sha> mode=self verdict=pass session=<review-session-id> read-only=true|verified -->
   ```

   `read-only` nennt, wie stark die Session vom Code ferngehalten wurde: `true` bei Credentials ohne
   Schreibrecht, `verified` wenn der Launcher Werkzeuge entzogen, in einem eigenen Worktree
   gearbeitet und danach von außen geprüft hat, dass darin nichts verändert wurde. Das Gate
   vergleicht den Wert mit `selfReviewMinimumEnforcement` aus `config.json` (Standard `verified`);
   Details in [`review-session-prompt.md`](review-session-prompt.md).

   `verdict=changes-required` oder `verdict=blocked` blockieren das Gate; `read-only=false` zählt
   nicht als Review. Alle Felder sind Pflicht — ein unvollständiger Marker wird nicht erkannt und
   das Gate meldet weiterhin ein fehlendes Review. Der Kommentar muss von einer Identität des
   Implementierungs-Anbieters stammen (`providerAuthorAllowlist` oder `providerReviewerAllowlist`);
   ein beliebiges `[bot]`-Konto genügt nicht. Der Marker gehört zum vollständigen,
   menschenlesbaren Reviewergebnis, nicht an dessen Stelle.
   Ein Fallback-Review — der zuerst gewählte Anbieter war nicht verfügbar — verwendet denselben
   Marker mit `mode=self` und wird zusätzlich mit `agent:review-fallback` gekennzeichnet.
5. Bei a) genügt die Approval des Gegen-Anbieters, bei c) die Approval des Menschen — beide für
   exakt den aktuellen Head-SHA. Ein Ergebnis-Marker ist dort nicht nötig.
6. Nach einem Fix-Commit beginnt der Ablauf von vorn: Der Reconciler entfernt das an den alten
   Head gebundene Wahl-Label, und die Frage wird erneut gestellt. Das neue Label erst setzen, wenn
   der Statuskommentar den neuen Head-SHA nennt — vorher kann der Reconciler die Antwort nicht
   diesem Head zuordnen und würde sie noch einmal erfragen.

## Was die Wahl nicht verändert

- Die Entscheidung gehört dem Nutzer. Der Agent überträgt sie nur: Er setzt das Label ausschließlich
  als Ergebnis einer ausdrücklichen Antwort in derselben Session und erfindet, ändert oder ersetzt
  es nie von sich aus. Ein Agent, der seinen eigenen Reviewmodus wählt, bedient sich am Merge-Gate.
  Das Gate kann diese Herkunft nicht prüfen — es sieht nur ein gesetztes Label —, deshalb ist die
  Regel verbindlich und die Label-Historie des Pull Requests der Prüfpfad.
- Unbeaufsichtigte Automatik setzt nie ein Wahl-Label: weder der Reconciler noch ein späterer
  Dispatcher, eine Review-Session oder ein CI-Job. Die einzige Label-Schreiboperation der Pipeline
  bleibt das Entfernen einer an einen früheren Head gebundenen Wahl.
- Alle übrigen Gate-Bedingungen gelten unverändert: grüne CI, konfliktfrei, aufgelöste Threads,
  UI/UX-Nachricht, menschliche Freigabe geschützter Pfade.
- Der Merge bleibt in jedem Modus beim Nutzer.
- Ist der gewählte Anbieter nicht verfügbar, wird nicht heimlich auf einen anderen Modus
  ausgewichen. Der Ausfall wird gemeldet und die Auswahl erneut vorgelegt.
