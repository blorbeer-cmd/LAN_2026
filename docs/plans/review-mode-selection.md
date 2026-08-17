# Konzept: Nutzergesteuerte Review-Modus-Wahl in der Agenten-Pipeline

Status: vom Nutzer beschlossen und umgesetzt. Stufe A (Auswahlpunkt in der Session) und Stufe B
(Wahl und Gate auf GitHub) sind implementiert; `self` und `human` dürfen das Merge-Gate öffnen,
sichtbar über Label und Protokoll.
Stand: 2026-08-07
Bezug: ändert [`auto-feature-to-deploy-pipeline.md`](auto-feature-to-deploy-pipeline.md) in den
Abschnitten 1, 3, 4, 6, 8, 9, 11, 12 und 14. Der Ablauf steht in
`.github/agent-pipeline/review-decision.md`.

## 1. Auftrag

Nach Fertigstellung einer Aufgabe soll der Nutzer immer eine Auswahl erhalten:

- **a) Cross-Review** durch den Gegen-Anbieter,
- **b) Review durch denselben Anbieter** in einer frischen, isolierten Session,
- **c) menschliches Review**.

Bei a) und b) korrigiert der Implementierungs-Agent die Findings automatisch. Danach erscheint
dieselbe Auswahl erneut, zusammen mit einer Empfehlung, ob überhaupt noch ein Review nötig ist.
Automatisch bleiben: Start des Reviews, Übergabe der Findings, Fix, Thread-Auflösung, CI- und
Konfliktkorrektur. Manuell wird ausschließlich die Frage, **wer** reviewt — Motiv ist die
Steuerung des verbleibenden Token-Budgets pro Anbieter.

## 2. Bewertung der Anfrage

Die Anfrage ist sinnvoll und passt zum bestehenden Konzept. Sie verschiebt genau eine Entscheidung
vom Automaten zum Nutzer und lässt die teure Mechanik (Findings-Schleife, Fix, erneutes Review)
unangetastet. Sie ersetzt außerdem eine Automatik, die heute ohnehin schlecht entscheidbar ist:
der automatische Wechsel auf das Fallback-Review bei Anbieter-Ausfall rät über ein Kontingent, das
nur der Nutzer wirklich kennt.

Drei Punkte müssen dabei bewusst entschieden werden, sonst entsteht ein widersprüchliches System:

1. **Das Merge-Gate kennt heute nur einen gültigen Review.** `deriveReadiness` verlangt eine
   Approval aus `providerReviewerAllowlist` des Gegen-Anbieters. Bei b) und c) wird diese Bedingung
   nie erfüllt, der PR bliebe dauerhaft blockiert. Die Wahl muss also gateseitig sichtbar sein,
   sonst ist sie wirkungslos.
2. **b) und c) senken die Unabhängigkeit.** Bei b) prüft derselbe Anbieter seine eigene Arbeit; bei
   c) fallen Review und Merge-Freigabe auf dieselbe Person. Letzteres ist genau die
   Gate-Verschmelzung, vor der `.github/agent-pipeline/README.md` heute ausdrücklich warnt. Das ist
   vertretbar, wenn es eine bewusste Wahl pro Head-SHA ist und im PR protokolliert wird — nicht,
   wenn es unbemerkt passiert.
3. **Die Modus-Wahl darf kein Agent selbst treffen.** Sonst ist sie ein Selbstbedienungs-Bypass des
   Merge-Gates. Das Label *im Auftrag* des Nutzers zu setzen, direkt nach dessen Antwort, ist
   dagegen genau die Bequemlichkeit, die den Ablauf brauchbar macht — die Grenze verläuft zwischen
   Übertragen und Entscheiden, nicht zwischen Mensch und Agent an der Tastatur.

Der bestehende Grundsatz „ein Review wird nie übersprungen" bleibt erhalten: c) ist kein
Überspringen, sondern die Verlagerung des Reviews auf den Menschen. Genau deshalb deckt c) auch den
Fall ab, in dem die Empfehlung „kein weiteres Agenten-Review nötig" lautet; eine vierte Option
„gar kein Review" wird nicht gebraucht und sollte es auch nicht geben.

## 3. Ausgangslage — was wirklich existiert

Wichtig für die Aufwandseinschätzung, weil der Auftrag „soll weiterhin automatisch laufen" mehr
voraussetzt, als heute vorhanden ist:

| Baustein                                            | Zustand                                  |
| --------------------------------------------------- | ---------------------------------------- |
| Task-Vertrag, Labels, PR-Vorlage (Phase 1)          | umgesetzt                                |
| Zustandsloser Readiness-Reconciler (Phase 2)        | umgesetzt                                |
| Merge-Gate-Commit-Status (Phase 7)                  | umgesetzt, noch kein Required Check       |
| Automatische CI-/Konfliktkorrektur (Phase 3)        | **nicht umgesetzt**                       |
| Automatisches Anfordern eines Reviews (Phase 4)     | **nicht umgesetzt**                       |
| Automatische Findings-Übergabe und Fix (Phase 4)    | **nicht umgesetzt**                       |
| Fallback-Review und Limit-Retry (Phase 5)           | **nicht umgesetzt**                       |

Heute meldet die Pipeline nur Zustand. Sie startet keinen Agenten und pusht keinen Fix. Review und
Fix laufen faktisch dadurch, dass eine Session den Ablauf aus
`.github/agent-pipeline/review-session-prompt.md` von Hand ausführt. Die gewünschte Automatik
„Review starten → Findings übergeben → fixen" ist also nicht vorhanden und ist unabhängig von
dieser Anfrage das eigentliche große Thema.

## 4. Zielablauf

```text
Implementierung fertig (oder Fix-Commit gepusht)
  └─ CI grün, konfliktfrei
       └─ Auswahlpunkt: Empfehlung + a) Cross  b) Selbst-Review  c) Mensch
            ├─ a) Gegen-Anbieter reviewt (read-only, isoliert)
            │     └─ Findings → Implementierungs-Agent fixt → Push
            │           └─ zurück zum Auswahlpunkt (neuer Head-SHA)
            ├─ b) frische, isolierte Session des Implementierungs-Anbieters
            │     └─ identischer Findings-/Fix-Weg
            └─ c) Nutzer reviewt selbst
                  ├─ Approval oder Autoren-`COMMENTED`-Review für den Head → Gate offen
                  └─ Findings als Review-Kommentare → Agent fixt → Auswahlpunkt
```

Unverändert: Jeder neue Commit entwertet das vorherige Verdikt. Die Wahl gilt deshalb **pro
Head-SHA**, nicht pro Pull Request; nach jedem Fix-Commit wird erneut gefragt. Der gewählte Anbieter
kann seine Wahl nicht auf einen späteren Head „mitziehen".

Kein Auto-Start bei ausbleibender Antwort. Ein Timeout, der ersatzweise das Cross-Review startet,
würde exakt das Budget verbrauchen, das der Nutzer schützen will. Ohne Antwort bleibt der PR in
`agent:awaiting-review-decision` stehen — sichtbar, aber ohne Kosten.

Ist der gewählte Anbieter nicht verfügbar (Limit, Ausfall), wird **nicht** stillschweigend auf b)
ausgewichen. Damit entfällt der automatische Fallback aus Abschnitt 9 des Hauptkonzepts; das
Fallback-Review wird von der Notlösung zur regulären, wählbaren Option b).

Gemeldet wird der Ausfall immer; ob die Auswahl dabei neu vorgelegt wird, richtet sich nach der
Ursache. Nennt sie ein erkennbares Ende — ein Nutzungslimit mit Reset-Zeitpunkt, ein Rate-Limit, ein
einzelner technischer Fehler —, gilt die Antwort weiter: derselbe Modus wird nach dem Wegfall der
Ursache einmal erneut versucht, gebunden an denselben Head. Ist die Ursache unklar, kein Ende
benennbar oder scheitert dieser Versuch erneut, wird die Auswahl mit angepasster Empfehlung erneut
vorgelegt. Eine Antwort für Code, den der Nutzer gesehen hat, soll ein Anbieterausfall nicht
entwerten — ein neuer Head dagegen schon.

## 5. Review-Modi und Merge-Gate

| Modus       | Label            | Was das Gate für den aktuellen Head-SHA verlangt                                                                              |
| ----------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `cross` (a) | `review:cross`   | wie heute: Approval eines Accounts aus `providerReviewerAllowlist` des Gegen-Anbieters, `verdict: pass`, alle Threads gelöst  |
| `self` (b)  | `review:self`    | Ergebnis-Marker eines Accounts des Implementierungs-Anbieters mit `mode=self`, `read-only=true`, eigener `session=`, `verdict=pass`, alle Threads gelöst |
| `human` (c) | `review:human`   | Approval eines Menschen mit Schreibzugriff oder `COMMENTED`-Review des PR-Autors für exakt diesen Head-SHA, alle Threads gelöst |

Für alle drei Modi gilt unverändert: CI grün, konfliktfrei, kein `agent:waiting`/`agent:needs-human`/
`agent:no-auto`, UI/UX-Nachricht vorhanden, geschützte Pfade unabhängig menschlich freigegeben.
Die Autoren-`COMMENTED`-Ausnahme des Modus `human` ersetzt diese separate Freigabe nicht.

Ehrliche Grenze von b): Das Gate kann hier keine unabhängige Identität prüfen — es glaubt dem
Ergebnis-Record des Anbieters, der auch implementiert hat. Die Kontrollen sind Prozess-, keine
technischen Garantien: der Record wird nur von einer vertrauenswürdigen Identität akzeptiert
(bestehende `isTrustedCommentAuthor`-Prüfung), er nennt Sessiontyp und Read-only-Erzwingung, und er
ist an den Head-SHA gebunden. Das Restrisiko trägt bewusst der Nutzer, der b) gewählt hat; es ist
im PR sichtbar und der Merge bleibt menschlich.

Ehrliche Grenze von c): Review und Merge sind dieselbe Person. Das ist zulässig, weil es explizit
gewählt wurde, aber `review:human` darf nie Default sein und nie stillschweigend gesetzt werden.
GitHub verbietet dem PR-Autor eine native Approval. Deshalb akzeptiert der Reconciler in diesem
ausdrücklich gewählten Modus ein natives `COMMENTED`-Review des PR-Autors, sofern dessen
`commit_id` exakt dem aktuellen Head entspricht und der Autor Schreibzugriff hat.

## 6. Wie die Wahl technisch ausgedrückt wird

Die Wahl muss aus dem GitHub-Zustand ableitbar sein, damit das zustandslose Reconciler-Prinzip
erhalten bleibt (kein eigener Eventstrom, keine Snapshot-IDs).

- **Träger der Wahl ist ein Label** (`review:cross`, `review:self`, `review:human`). Die
  interaktive Session setzt es unmittelbar nach der Antwort des Nutzers, damit dieser dafür nicht
  auf GitHub wechseln muss. Labels kann in diesem Repository nur setzen, wer Schreibrechte hat —
  damit ist die Wahl automatisch gegen Fremdsteuerung geschützt, ohne neue Prüflogik.
- **Head-Bindung über einen Beobachtungs-Datensatz:** Der Reconciler hält in seinem eigenen
  Statuskommentar fest, welchen Head er gesehen hat — auch dann, wenn noch nichts gewählt ist
  (`mode=none`). Ein Wahl-Label bindet nur, wenn für den aktuellen Head bereits ein Datensatz
  existiert; der Lauf, der ihn geschrieben hat, hat ein damals gesetztes Label entfernt, also kann
  ein danebenstehendes Label nur später gekommen sein. Fehlt der Datensatz, ist die Wahl nicht
  zuzuordnen und wird entfernt statt geraten.
- **Genau ein Wahl-Label gleichzeitig.** Mehrere gesetzte Labels sind ein Blocker mit klarer
  Meldung, kein geratener Vorrang.
- **Das Review-Ergebnis** bleibt beim bestehenden Format aus Abschnitt 8 des Hauptkonzepts und wird
  im Modus `self` zusätzlich als maschinenlesbarer Kommentar-Marker abgelegt, analog zur
  bestehenden UI-Notiz. Alle Felder sind Pflicht, ein unvollständiger Marker wird nicht erkannt:
  `<!-- agent-pipeline:review-result <head-sha> mode=self verdict=pass session=<id> read-only=true -->`.
  Für `cross` und `human` ist die Approval zum exakten Head-SHA der Nachweis; beim `human`-Mode
  genügt für den PR-Autor wegen GitHubs Self-Approval-Regel ein natives `COMMENTED`-Review mit
  demselben Head-SHA. Dort gibt es keinen Ergebnis-Marker.
- **Ein Agent darf ein Wahl-Label nur als Übertragung einer ausdrücklichen Nutzerantwort setzen**,
  nie von sich aus und nie unbeaufsichtigt. Die einzige Label-Schreiboperation der Automatik bleibt
  das Entfernen eines veralteten Labels durch den Reconciler. Das gehört in die
  Nicht-Bestandteil-Liste des Hauptkonzepts.

Neue Phase im Reconciler: `awaiting-review-decision` — alles Mechanische grün, kein gültiges
Wahl-Label für den aktuellen Head. Sie rangiert unter `conflict-fix`/`ci-fix` (die darf der Agent
weiter selbst beheben) und über `review`.

## 7. Empfehlung, ob noch ein Review nötig ist

Die Empfehlung steht im Sticky-Status-Kommentar und in der Session-Rückfrage. Sie ist beratend und
verändert das Gate nie.

- **Erneutes Cross-Review empfehlen**, wenn seit dem letzten `pass` gilt: es gab `critical`- oder
  `high`-Findings; der Fix hat Dateien oder Bereiche außerhalb des Findings berührt; geschützte
  Pfade, Datenbankmigrationen, Authentifizierung oder Realtime-Logik sind betroffen; oder die CI
  war nach dem Fix rot.
- **Selbst-Review genügt**, wenn nur `low`/`medium`-Findings vorlagen, der Fix eng am Finding
  blieb und die einschlägigen Tests grün sind.
- **Menschliches Review genügt**, wenn das letzte Review `pass` war und seither nur Dokumentation,
  Kommentare oder Changelog-Einträge geändert wurden.
- Zusätzlich wird der beobachtete Anbieter-Zustand genannt (bekanntes Limit, Timeout), damit die
  Budget-Entscheidung informiert getroffen wird.

Die Rückfrage nennt jedes Mal: Implementierer, wer bei a) reviewen würde, Diff-Umfang seit dem
letzten Review, Schweregrade der zuletzt behobenen Findings, offene Threads und die Empfehlung mit
Begründung in einem Satz.

## 8. Umsetzung in zwei Stufen

### Stufe A — Auswahlpunkt in der Session (klein, sofort nutzbar)

Deckt den Alltag ab, solange der Nutzer ohnehin in der Session sitzt, und braucht keine
GitHub-Automatik.

1. Regel in `AGENTS.md` (Kurzregeln der Pipeline): Nach abgeschlossener Implementierung und nach
   jedem Fix-Commit legt der Agent die Auswahl a/b/c mit Empfehlung vor und startet erst danach
   ein Review.
2. Neuer Abschnitt in `review-session-prompt.md`: `review_mode` erhält den Wert `self` für die
   bewusst gewählte Selbstprüfung; `fallback` bleibt für den Ausfall-Fall. Ergänzung, wie die
   isolierte Session in Claude Code konkret erzeugt wird (eigener Subagent mit rein lesendem
   Werkzeugsatz, Prompt ausschließlich aus Task-Vertrag, Diff und PR-Daten — nie aus der
   Implementierungsbegründung).
3. Ablaufdatei `.github/agent-pipeline/review-decision.md` mit Frageformat, Empfehlungsregeln und
   dem Text der drei Optionen.
4. Dieses Konzept und die geänderten Abschnitte des Hauptkonzepts angleichen.

Umfang: reine Dokumentation, kein Code, keine neuen Tests. Ein kleiner PR.

### Stufe B — Wahl und Gate auf GitHub (mittel, klar begrenzt)

Nötig, sobald die Entscheidung auch außerhalb einer laufenden Session gelten soll oder das
Merge-Gate zum Required Check wird.

| Datei                                    | Änderung                                                                                                  |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `.github/agent-pipeline/config.json`     | Labels `review:cross`/`review:self`/`review:human`, Modus-Liste, Marker-Präfix des Ergebnis-Records        |
| `scripts/agent-pipeline-reconcile.mjs`   | Wahl-Label lesen und gegen den Head-Commit-Zeitpunkt validieren; Gate-Bedingung je Modus; Ergebnis-Record parsen; Phase `awaiting-review-decision`; Empfehlungstext im Status-Kommentar; veraltetes Wahl-Label entfernen |
| `scripts/agent-pipeline-reconcile.test.mjs` | je Modus Happy Path, veraltetes Label, mehrere Labels, fehlender/fremder Ergebnis-Record, Ergebnis für falschen SHA, Wechsel des Modus am selben Head                                       |
| `.github/workflows/agent-pipeline-reconcile.yml` | Timeline-/Commit-Zeitpunkt-Abfrage; `labeled`/`unlabeled` sind bereits abonniert                   |
| `.github/agent-pipeline/README.md`       | Modi, Gate-Semantik je Modus, ausdrückliche Nennung der reduzierten Unabhängigkeit bei `self` und `human`  |
| `docs/plans/auto-feature-to-deploy-pipeline.md` | Abschnitte 3, 4, 6, 8, 9, 11, 12 an den Auswahlpunkt anpassen; automatischen Fallback streichen     |
| `.github/pull_request_template.md`       | optional: Hinweis, dass der Review-Modus über Labels pro Head gewählt wird                                 |

Umfang: ein PR, geschätzt 600–900 Zeilen inklusive Tests. Die Logik bleibt eine reine Funktion über
dem GitHub-Snapshot, also gut testbar; ein Architekturwechsel ist nicht nötig.

### Nicht Teil dieser Anfrage

Der automatische Start eines Agenten für Review und Fix (Phasen 3–5 des Hauptkonzepts) bleibt das
eigentliche Großprojekt. Die Modus-Wahl macht es nicht größer, sondern etwas kleiner: die
Verfügbarkeits- und Fallback-Automatik entfällt, weil der Nutzer entscheidet.

## 9. Aufwand und Risiken

- **Ist es ein größeres Thema?** Die Auswahl selbst nicht: Stufe A ist klein, Stufe B mittel und
  klar begrenzt. Größer ist der Teil, den der Auftrag als bestehend voraussetzt — der automatische
  Review-Start samt Findings-Übergabe und Fix existiert noch nicht.
- **Hauptrisiko:** ein Gate, das b) und c) anerkennt, ist schwächer als das heutige. Gegenmaßnahmen:
  Wahl nur durch Schreibberechtigte, Head-SHA-Bindung, sichtbares Label, Protokoll im
  Status-Kommentar, unveränderter menschlicher Merge.
- **Zweitrisiko:** ein Auswahlpunkt, der niemanden erreicht, blockiert den PR still. Deshalb
  eigene Phase, eigener Blockertext im Merge-Gate und Nennung im Status-Kommentar.
- **Drittrisiko:** mehr Rückfragen als gewünscht, wenn viele kleine Fix-Commits entstehen. Die
  Empfehlung mildert das; falls es stört, wäre eine ausdrücklich gesetzte Dauerwahl („bis ich es
  ändere") eine spätere, kleine Ergänzung — bewusst nicht Teil dieses Entwurfs, weil sie dem
  Auftrag „ich will jedes Mal entscheiden" widerspricht.

## 10. Entscheidungen des Nutzers

1. b) und c) dürfen das Merge-Gate öffnen, mit sichtbarem Label und Protokoll im Statuskommentar.
2. Stufe A und Stufe B wurden zusammen umgesetzt.
3. Die Auswahl erscheint nach jedem Head-Wechsel, auch nach reinen CI-Fix-Commits.

## 11. Abweichungen der Umsetzung vom Entwurf

Zwei Punkte wurden während der Umsetzung anders gelöst als oben skizziert:

- **Head-Bindung ohne Timeline-Abfrage.** Der Entwurf wollte den Zeitpunkt des `labeled`-Events mit
  dem Commit-Zeitpunkt des Head-SHAs vergleichen. Das ist in beide Richtungen unscharf: ein lokal
  früher erzeugter, später gepushter Commit könnte ein Label fälschlich als gültig erscheinen
  lassen. Stattdessen hält der Reconciler in seinem eigenen Statuskommentar fest, welchen Head er
  gesehen hat. Das braucht keine zusätzliche API und keine neue Berechtigung, und es bleibt bei der
  reinen Funktion über dem GitHub-Snapshot, weil der Datensatz selbst aus GitHub gelesen wird.
  Entscheidend ist dabei der Zustand `mode=none`: Ohne ihn wäre „kein Datensatz" nicht von „für
  diesen Head gewählt" zu unterscheiden, und die Mehrdeutigkeit fiele auf die gate-öffnende Seite —
  ein gelöschter Statuskommentar oder eine pausierte Automatik hätten genügt, damit eine Wahl aus
  Head A für Head D gilt. Das Review zu `5ebf032` hat genau das nachgewiesen; seither wird bei jedem
  Lauf ein Datensatz für den aktuellen Head geschrieben.
- **Der Ergebnis-Marker gilt nur für `self`.** Für `cross` und `human` ist ein natives Review zum
  exakten Head-SHA die stärkere und fälschungssichere Evidenz: eine Approval oder im `human`-Mode
  ein `COMMENTED`-Review des PR-Autors. Ein zusätzlicher Marker würde dort nur eine zweite,
  schwächere Quelle für dieselbe Aussage schaffen.

Bewusst streng geblieben: Der gewählte Modus entscheidet allein, welche Evidenz zählt. Eine
Cross-Approval erfüllt ein gewähltes `review:self` nicht, obwohl sie stärker wäre — wer sie nutzen
will, setzt `review:cross`. Das hält das Gate vorhersagbar statt nachsichtig.
