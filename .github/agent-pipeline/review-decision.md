# Review-Entscheidung nach Abschluss einer Aufgabe

Dieser Ablauf gehört zur Agenten-Pipeline aus
[`../../docs/plans/auto-feature-to-deploy-pipeline.md`](../../docs/plans/auto-feature-to-deploy-pipeline.md).
Er beschreibt den einen Punkt, an dem der Nutzer entscheidet: **wer** das Review durchführt.
Alles danach — Review starten, Findings übergeben, Findings beheben, Threads auflösen — läuft
automatisch weiter.

## Wann fragen

Die Frage gehört zu genau einem Head-SHA und wird für diesen Head genau einmal gestellt.

- Nach abgeschlossener Implementierung, sobald der Branch gepusht und die einschlägigen Prüfungen
  grün sind. Das gilt auch, wenn der PR noch ein Draft ist.
- Nach jedem Fix-Commit erneut, denn jeder neue Commit entwertet das vorherige Verdikt. Allein ein
  neuer Head-SHA eröffnet die Frage erneut.

## Wann nicht erneut fragen

Vor jeder Frage prüft die Session die folgenden Punkte am aktuellen GitHub-Zustand — nicht aus dem
Gedächtnis, das ein Wecken, ein neuer Container oder eine Kompaktierung verliert. Trifft einer zu,
wird die Frage nicht gestellt und eine bereits gestellte nicht wiederholt:

- Der Pull Request ist gemergt oder geschlossen. Damit endet dieser Ablauf endgültig; für einen
  solchen PR wird nie wieder eine Wahl erfragt, auch nicht nach später eintreffenden Ereignissen.
  Der Reconciler schreibt für ihn ebenfalls nichts mehr, weil ein geschlossener Pull Request
  Geschichte ist. Folgearbeit beginnt auf einem neuen Branch und in einem neuen Ablauf.
- Für den aktuellen Head liegt bereits eine Wahl vor: Der Statuskommentar nennt diesen Head mit
  `mode=cross`, `mode=self` oder `mode=human`, oder das zugehörige Label ist für diesen Head
  gebunden. Die Entscheidung ist getroffen, das Review läuft oder wartet auf sein Ergebnis. Die
  Session berichtet dann den Fortschritt, statt erneut zu fragen.
- Die Session hat die Frage für genau diesen Head bereits gestellt. Weitere Reconciler-Läufe,
  aktualisierte Statuskommentare, erneute Benachrichtigungen, CI-Ereignisse oder eine Wiederaufnahme
  der Session sind kein neuer Anlass. Auch eine noch unbeantwortete Frage wird nicht neu gestellt,
  sondern abgewartet.
- Die Antwort liegt vor, aber das Label ist noch nicht gesetzt, weil der Statuskommentar den
  aktuellen Head noch nicht führt (siehe „Nach der Antwort“, Punkt 1). Die Antwort bleibt gültig;
  die Session wartet auf den Eintrag und setzt das Label anschließend, ohne die Frage zu wiederholen.
- Für den aktuellen Head liegt bereits ein bestandenes Reviewergebnis vor.
- CI ist rot oder ein Mergekonflikt ist offen. Diese Punkte behebt der Implementierungs-Agent
  zuerst ohne Rückfrage.
- `agent:no-auto`, `agent:needs-human` oder `agent:waiting` sind gesetzt.
- Review-Threads sind noch offen beziehungsweise nicht vollständig lesbar, oder eine geschützte
  Pfadfreigabe fehlt. Dann erfolgt keine aktive Zustellung.

Ein Ereignis, das lediglich einen dieser Zustände erneut meldet, wird still übergangen. Sichtbar
gemeldet wird stattdessen der Fortschritt: welches Review läuft, worauf gewartet wird und wie das
Ergebnis ausfiel.

Ob die Frage für diesen Head schon gestellt wurde, weiß nur die Session selbst. Kann sie das nach
einem Wecken nicht mehr beurteilen, wird im Zweifel **nicht** gefragt: Für einen reviewbereiten Head
existiert der Zustellkommentar des Reconcilers ohnehin dauerhaft im Pull Request, eine Wiederholung
bringt dem Nutzer also nichts und kostet ihn nur eine weitere Unterbrechung. Die Session berichtet
dann den Zustand und wartet auf die Antwort.

Ein Draft blockiert nur das menschliche Merge-Gate. Die Review-Auswahl und das anschließende Review
werden bereits auf dem Draft-PR gestartet; erst nach bestandenem Review darf der PR auf „Ready for
review“ wechseln.

## Ende des Ablaufs

Mit dem Merge oder dem Schließen des Pull Requests endet dieser Ablauf endgültig — und mit ihm die
gesamte Begleitung des Pull Requests durch die Session. Die Session räumt dabei ihre eigenen
Weckquellen ab, statt sie weiterlaufen zu lassen:

- eigene wiederkehrende Check-ins für diesen Pull Request abbestellen,
- das Abonnement seiner PR-Ereignisse beenden,
- das Ende einmal melden: gemergt beziehungsweise geschlossen, und dass nichts mehr aussteht.

Danach erzeugt dieser Pull Request keine Frage, keine Empfehlung und keinen Statusbericht mehr.
Trifft später doch noch ein Ereignis zu ihm ein, wird es still übergangen. Folgearbeit beginnt auf
einem neuen Branch mit einem eigenen Ablauf.

Ein weiterlaufender Check-in auf einem gemergten Pull Request ist selbst dann ein Fehler, wenn er
nichts meldet: Er weckt die Session ohne Anlass und stellt damit genau die Fragen wieder her, die
dieser Abschnitt beendet.

## Aktive Zustellung

Der Sticky-Statuskommentar bleibt die vollständige Zustandsansicht, zählt aber ausdrücklich nicht
als Zustellung. Sobald der aktuelle Head mechanisch grün, konfliktfrei und sonst reviewbereit ist,
erstellt der Reconciler zusätzlich genau einen neuen PR-Kommentar für diesen Head. Er erwähnt den in
`AGENT_PIPELINE_OWNER` konfigurierten GitHub-Nutzer und enthält Head-SHA, Implementierer,
Gegenanbieter, Änderungsumfang seit der letzten Review-Runde, vorherige Finding-Schweregrade,
offene Threads, Provider-/Timeout-Zustand, Empfehlung samt Begründung sowie a/b/c. Der Marker

```text
<!-- agent-pipeline:review-decision-notification <head-sha> -->
```

bindet die Zustellung an den vollständigen SHA. Reconciler-, Schedule- und wiederholte Workflow-
Läufe lesen alle vorhandenen Kommentare und erzeugen für denselben SHA keinen zweiten. Ein neuer
Head macht die alte Frage und Antwort ungültig und erhält nach erneut erfüllten Vorbedingungen eine
neue Nachricht.

GitHub Actions besitzt keinen erreichbaren Codex-App-Endpunkt. Deshalb bleibt die GitHub-Nachricht
die dauerhafte Outbox. Ein Codex-seitiger Monitor ruft
`scripts/agent-pipeline-codex-adapter.mjs scan` auf, ordnet das Ereignis über `codex-thread-id` oder
den eindeutig ausgecheckten Head-Branch der ursprünglichen Task zu und sendet es mit dem
App-internen Thread-Werkzeug. Erst nach erfolgreichem Versand schreibt `ack` den GitHub-Marker
`agent-pipeline:codex-delivery`; andernfalls wird erneut versucht. Der Adapter stellt nur zu und
überträgt weiterhin ausschließlich eine ausdrückliche, SHA-gleiche Nutzerantwort als Label.

Scheitert der Kommentar-POST oder fehlt `AGENT_PIPELINE_OWNER`, schreibt der Reconciler den Marker
`agent-pipeline:review-decision-delivery-failure` in den Sticky-Kommentar, setzt den Merge-Gate-
Status auf `review-decision-delivery-failed` und lässt den Workflow fehlschlagen. Der nächste Lauf
versucht erneut; ein möglicherweise trotz verlorener HTTP-Antwort angelegter Kommentar wird über
seinen Zustellmarker erkannt und nicht dupliziert.

Der lokale Codex-Monitor ist ein einzelner, an einen dedizierten Task gebundener Fünf-Minuten-
Heartbeat. Er verarbeitet ausschließlich Events mit einem Codex-Implementierer, löst das Ziel über
die gültige `codex-thread-id` oder einen eindeutig passenden Branch auf und quittiert erst nach
erfolgreichem Versand. Für Claude-Implementierungen gibt es in der Codex-App keine belastbare
Schnittstelle zum Wecken der ursprünglichen Claude-Session; dafür werden keine Codex-Events erzeugt
und kein Claude-Task erfunden. GitHub bleibt in diesem Fall die Outbox. Leere Scans bleiben still,
und der Monitor verändert keine `review:*`-Labels.

Nach einer Auswahl liefert derselbe Monitor nicht nur das Endergebnis oder einen Startfehler. Ein
laufender beziehungsweise erfolgreich angenommener provider-spezifischer Check erzeugt einmalig
`review-started`; die Implementierungs-Task informiert den Nutzer dadurch aktiv, dass das Review
tatsächlich läuft oder auf sein Ergebnis wartet, verlinkt den Run und verfolgt ihn weiter. Das bloße
Auslösen des Workflows gilt nicht als Startnachweis. Ein späteres Ergebnis oder ein vertrauenswürdig
publizierter Startfehler ersetzt diese Zwischenmeldung für denselben Head.

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

Die Frage wird als gewöhnlicher Text am Ende des Zuges vorgelegt und nie über ein blockierendes
Frage-Werkzeug gestellt. Sie ist bewusst asynchron: Ohne Antwort startet nichts, und dieselbe Wahl
liegt dauerhaft als PR-Kommentar vor. Ein modaler Dialog würde dagegen die Eingabe der Session
sperren, sodass der Nutzer bis zur Antwort keinen anderen Auftrag mehr abschicken kann — und jedes
Wecken der Session würde die Sperre erneut aufziehen. Nach dem Vorlegen endet der Zug; der Nutzer
antwortet mit einem normalen Prompt (`a`, `b`, `c`) oder setzt eines der drei Labels selbst. Beides
zählt gleichermaßen als ausdrückliche Antwort.

Die Auswahl nennt genau diese drei Optionen und vorab kompakt:

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

1. Bevor die interaktive Agenten-Session das Label setzt, prüft sie, dass der Sticky-Statuskommentar
   des Reconcilers (Marker `agent-pipeline:review-decision <head-sha> ...`) bereits genau den
   aktuellen Head-SHA nennt. Nur dieser vorherige Eintrag lässt den Reconciler das Label später
   diesem Head zuordnen (siehe Punkt 6 und `README.md`, Abschnitt „Review-mode selection"). Nennt
   der Statuskommentar noch einen älteren Head oder gar keinen — etwa weil die Prüfungen gerade erst
   grün wurden und der Reconciler für diesen Head noch nicht gelaufen ist —, wartet die Session kurz
   und prüft erneut, statt sofort zu setzen: Ein Label, das keinem vorherigen Eintrag folgt, wird vom
   nächsten Reconciler-Lauf als unbelegt entfernt, und die Frage würde unnötig ein weiteres Mal
   gestellt. Sobald der Eintrag für den aktuellen Head vorliegt, setzt die Session das zugehörige
   Label selbst am Pull Request, ohne weitere Rückfrage. Der Nutzer muss dafür nicht auf GitHub
   wechseln. Genau ein Wahl-Label gleichzeitig: ein zuvor gesetztes anderes wird dabei entfernt. Erst
   das Label bringt die Wahl ins Merge-Gate und macht sie außerhalb der Session sichtbar. Falls die
   Codex-Zustellung sichtbar fehlschlägt, kann der Nutzer alternativ genau eines der drei Labels
   direkt in GitHub setzen; auch diese Handlung ist eine ausdrückliche Antwort. Eine Antwort auf den
   SHA einer älteren Benachrichtigung darf nie auf den aktuellen Head übertragen werden.
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
