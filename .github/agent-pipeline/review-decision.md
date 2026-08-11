# Review-Entscheidung nach Abschluss einer Aufgabe

Dieser Ablauf gehört zur Agenten-Pipeline aus
[`../../docs/plans/auto-feature-to-deploy-pipeline.md`](../../docs/plans/auto-feature-to-deploy-pipeline.md).
Er beschreibt den einen Punkt, an dem der Nutzer entscheidet: **wer** das Review durchführt.
Alles danach — Review starten, Findings übergeben, Findings beheben, Threads auflösen — läuft
automatisch weiter.

## Wann fragen

- Nach abgeschlossener Implementierung, sobald der Branch gepusht und die einschlägigen Prüfungen
  grün sind. Das gilt auch, wenn der PR noch ein Draft ist.
- Nach jedem Fix-Commit erneut, denn jeder neue Commit entwertet das vorherige Verdikt.
- Nicht fragen, solange CI rot oder ein Mergekonflikt offen ist. Diese Punkte behebt der
  Implementierungs-Agent zuerst ohne Rückfrage.
- Nicht fragen, wenn `agent:no-auto`, `agent:needs-human` oder `agent:waiting` gesetzt sind.
- Keine aktive Zustellung, solange Review-Threads nicht vollständig lesbar beziehungsweise noch
  offen sind oder eine geschützte Pfadfreigabe fehlt.

Ein Draft blockiert nur das menschliche Merge-Gate. Die Review-Auswahl und das anschließende Review
werden bereits auf dem Draft-PR gestartet; erst nach bestandenem Review darf der PR auf „Ready for
review“ wechseln.

## Aktive Zustellung

Der Sticky-Statuskommentar bleibt die vollständige Zustandsansicht, zählt aber ausdrücklich nicht
als Zustellung. Sobald der aktuelle Head mechanisch grün, konfliktfrei und sonst reviewbereit ist,
erstellt der Reconciler zusätzlich genau einen neuen PR-Kommentar für diesen Head. Er erwähnt den in
`AGENT_PIPELINE_OWNER` konfigurierten GitHub-Nutzer und enthält Head-SHA, Implementierer,
Gegenanbieter, Empfehlung samt Begründung sowie a/b/c. Der Marker

```text
<!-- agent-pipeline:review-decision-notification <head-sha> -->
```

bindet die Zustellung an den vollständigen SHA. Reconciler-, Schedule- und wiederholte Workflow-
Läufe lesen alle vorhandenen Kommentare und erzeugen für denselben SHA keinen zweiten. Ein neuer
Head macht die alte Frage und Antwort ungültig und erhält nach erneut erfüllten Vorbedingungen eine
neue Nachricht.

GitHub Actions besitzt derzeit keinen erreichbaren Codex-App-Endpunkt, der eine bestimmte lokale
Codex-Task anhand von Repository und PR wecken oder ihr eine Nachricht senden kann. Die neue,
mention-tragende GitHub-Nachricht ist deshalb der belastbare aktive Fallback. Der noch fehlende
externe Adapter muss den Marker beobachten, `task-id`/PR der ursprünglichen Codex-Task zuordnen,
diese Task wecken, die Nachricht dort zustellen und eine ausdrückliche, SHA-gleiche Nutzerantwort
als genau eines der drei Labels übertragen. App-interne Thread-Werkzeuge einer bereits laufenden
Codex-Sitzung sind keine aus einem Repository-Workflow aufrufbare API und dürfen nicht als solche
dokumentiert werden.

Scheitert der Kommentar-POST oder fehlt `AGENT_PIPELINE_OWNER`, schreibt der Reconciler den Marker
`agent-pipeline:review-decision-delivery-failure` in den Sticky-Kommentar, setzt den Merge-Gate-
Status auf `review-decision-delivery-failed` und lässt den Workflow fehlschlagen. Der nächste Lauf
versucht erneut; ein möglicherweise trotz verlorener HTTP-Antwort angelegter Kommentar wird über
seinen Zustellmarker erkannt und nicht dupliziert.

## Die drei Optionen

| Option              | Modus    | Label          | Unabhängigkeit                                                     |
| ------------------- | -------- | -------------- | ------------------------------------------------------------------ |
| a) Cross-Review     | `cross`  | `review:cross` | höchste: der jeweils andere Anbieter                                |
| b) Gleicher Agent   | `self`   | `review:self`  | reduziert: derselbe Anbieter in frischer, schreibgeschützter Session |
| c) Menschlich       | `human`  | `review:human` | Review und Merge liegen bei derselben Person                        |

Es gibt bewusst keine vierte Option „kein Review". Wenn kein Agenten-Review mehr nötig erscheint,
ist c) die richtige Wahl: das Review findet dann beim Menschen statt und wird durch seine Approval
des exakten Head-SHAs sichtbar. Ist der Mensch selbst der PR-Autor, kann GitHub keine Approval
annehmen; in diesem Fall zählt ein natives `COMMENTED`-Review des Autors für genau diesen Head.

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

1. Die interaktive Agenten-Session setzt das zugehörige Label selbst am Pull Request, sofort nach
   der ausdrücklichen, zum aktuellen Head-SHA gehörenden Antwort und ohne
   weitere Rückfrage. Der Nutzer muss dafür nicht auf GitHub wechseln. Genau ein Wahl-Label
   gleichzeitig: ein zuvor gesetztes anderes wird dabei entfernt. Erst das Label bringt die Wahl
   ins Merge-Gate und macht sie außerhalb der Session sichtbar. Solange der externe Codex-Task-
   Adapter fehlt, kann der Nutzer alternativ genau eines der drei Labels direkt in GitHub setzen;
   auch diese Handlung ist eine ausdrückliche Antwort. Eine Antwort auf den SHA einer älteren
   Benachrichtigung darf nie auf den aktuellen Head übertragen werden.
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

   Bei einem Lauf mit `--headless` schreibt nicht die Session, sondern der Launcher: Er nimmt das
   Review entgegen, prüft den Arbeitsbaum und hängt den Marker erst danach an. Eine Verletzung führt
   dann dazu, dass gar nichts veröffentlicht wird — statt dass ein bereits gesetzter Marker gegen den
   Reconciler-Zeitplan gelöscht werden muss.

   `verdict=changes-required` oder `verdict=blocked` blockieren das Gate; `read-only=false` zählt
   nicht als Review. Alle Felder sind Pflicht — ein unvollständiger Marker wird nicht erkannt und
   das Gate meldet weiterhin ein fehlendes Review. Der Kommentar muss von einer Identität des
   Implementierungs-Anbieters stammen (`providerAuthorAllowlist` oder `providerReviewerAllowlist`);
   ein beliebiges `[bot]`-Konto genügt nicht. Der Marker gehört zum vollständigen,
   menschenlesbaren Reviewergebnis, nicht an dessen Stelle.
   Ein Fallback-Review — der zuerst gewählte Anbieter war nicht verfügbar — verwendet denselben
   Marker mit `mode=self` und wird zusätzlich mit `agent:review-fallback` gekennzeichnet.
5. Bei a) zählt, was `crossReviewEvidence` verlangt: eine Approval des Gegen-Anbieters oder —
   Standard `reviewed-and-resolved` — dessen Review genau dieses Heads mit aufgelösten Findings.
   Der Standard existiert, weil die Codex-Integration nie approvt: Sie kommentiert bei Findings und
   reagiert sonst mit einem Daumen. Bei c) die Approval des Menschen beziehungsweise bei einem
   PR-Autor dessen natives `COMMENTED`-Review — jeweils für exakt den aktuellen Head-SHA. Ein
   Ergebnis-Marker ist dort nicht nötig.
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
