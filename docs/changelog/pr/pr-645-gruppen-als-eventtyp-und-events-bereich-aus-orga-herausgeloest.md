# PR #645: Gruppen als Eventtyp und Events-Bereich aus Orga herausgelöst

- Datum des Merges: 2026-09-17
- Branch: `claude/gruppen-eventtyp`
- Merge-Commit: [`97315b2`](https://github.com/blorbeer-cmd/LAN_2026/commit/97315b2)
- Pull Request: [#645](https://github.com/blorbeer-cmd/LAN_2026/pull/645)

## Changelog

- **Gruppe** ist ein dritter Eventtyp neben LAN-Party und Allgemeinem Event: ein dauerhafter Kreis
  ohne Zeitraum und ohne Kosten, mit den Bereichen To-Do, Essen, Musik, Spielekatalog, Arcade und
  Umfragen. Sie wird sofort veröffentlicht statt als Entwurf auf ein Datum zu warten, das nie
  kommt. `eventTypeIsUndated()` ist die eine Stelle, die alle Schreiber danach fragen.
- Der Server weist Zeitraum, Beitrag, Unterkunftskosten, PayPal-Link und Zahlungsziel für eine
  Gruppe ausdrücklich ab, statt sie stillschweigend zu verwerfen. Sonst blieben Zahlungs-
  erinnerungen und der Bezahlt-Status für einen Kontext erreichbar, der beides nicht kennt.
- „Beenden“ gilt auch für Gruppen. Es ist der einzige Lebenszyklusschritt, den beide Arten teilen,
  und der Weg, eine versehentlich angelegte Gruppe zu erledigen; eine beendete Gruppe meldet
  „Beendet“ statt ihrer Art und wandert in die Historie ihrer Liste.
- Die **Packliste** ist ein eigener schaltbarer Bereich, abgespalten von „Aufgaben & Mitbringen“.
  Erst dadurch kann eine Gruppe die gemeinsamen To-Dos behalten, ohne eine persönliche Packliste
  für eine Reise zu führen, die nie stattfindet. `/api/checklist/items` hängt an `packing`,
  `/api/checklist/tasks` an `tasks`; `/items` ist auch auf Leseseite geschützt, weil GET den
  Grundstock materialisiert und sonst Zeilen für einen abgeschalteten Bereich anlegen würde.
- **Events & Gruppen** verlässt die Orga-Tableiste. Orga organisiert Arbeit *innerhalb* des
  gewählten Arbeitsbereichs, während diese Ansicht die Arbeitsbereiche selbst wählt und anlegt —
  eine Ebene darüber. Sie ist erster Eintrag im „Mehr“-Hub, steht auf dem Desktop neben Home und
  ist über einen eigenen Eintrag im Umschalter direkt erreichbar. Orga behält Umfragen,
  An- & Abreise, Packliste und To-Do.
- Die Ansicht listet Events und Gruppen getrennt, jede Liste mit eigener Anlege-Aktion, eigenem
  Leertext, eigener „Abgesagt“- und „Historie“-Sektion und eigenem Aufklapp-Zustand.
- Wer einen Arbeitsbereich anlegt, ist Teil davon: `createEvent` schreibt die akzeptierte
  Roster-Zeile in derselben Transaktion. Bei einer Gruppe ist das zwingend, weil niemand sonst den
  Ersteller dorthin einladen kann. Sichtbare Folge für bestehende Abläufe: Der Veranstalter zählt
  bei den Zusagen mit, steht in der An-/Abreisetabelle und teilt sich die Unterkunftskosten.
- Die Gruppenkarte lässt weg, was eine Gruppe nicht hat, statt es gesperrt anzuzeigen: Zeitraum,
  Kalender-Export, Kosten- und Zahlungsblock, Tracking, PDF-Andenken und die Ausreden-Aktion. Ihr
  Roster heißt „Mitglieder“ statt „Teilnehmende“.
- Das Feld „Eventtyp“ heißt „Typ“. Ein Typwechsel im Dialog blendet Datums- und Kostenfelder live
  aus und wieder ein und passt Dialogtitel und Absendeknopf an; die Werte bleiben stehen, damit ein
  Hin- und Herwechseln nichts verwirft.
- Die bisherige „Gruppe“ — die interne Zugriffsgrenze — heißt in der Oberfläche jetzt
  **Community**: sechs sichtbare Texte und rund 25 Fehlermeldungen. Datenbank, Schnittstellen und
  Modulnamen bleiben bei `group`; eine technische Umbenennung hätte viel Risiko ohne sichtbaren
  Nutzen bedeutet, und so gehört das Wort „Gruppe“ in der Oberfläche eindeutig dem neuen Eventtyp.
- Migration 102 spaltet die Packliste als eigenes Feature ab und lässt jedes bestehende Event
  seinen bisherigen `tasks`-Zustand erben. Migration 103 baut `events` neu, um die Zeitraum-Pflicht
  aus Migration 83 zu entfernen — bewusst ohne Ersatz-Constraint, der `event_type_key` nennt, weil
  eine solche Bedingung die Spalte dauerhaft in der Tabellendefinition festnageln würde. Der
  Kiosk-Trigger wird mit der Tabelle neu angelegt.

## Historischer Kontext

Aus der Anforderung „Gruppen anlegen, quasi wie Events, aber ohne Zeitrahmen und ohne Bezahlung“.
Die Vorprüfung fand drei Dinge, die den Zuschnitt verändert haben: Das Wort „Gruppe“ war im Tool
bereits für die Zugriffsgrenze und für Turniergruppen belegt; der Spielekatalog samt Skill und Bock
gilt community-weit, nicht pro Event; und „Umfragen“ war kein Terminwerkzeug, sondern ein
allgemeines Abstimmungswerkzeug, dessen Themenfeld die Oberfläche nie angeboten hat.

Zwei Codex-Review-Runden: Die erste fand, dass der neue Packlisten-Schalter nur in der Navigation
wirkte, während die API weiter komplett an `tasks` hing, und dass der Hilfetext eine Löschung
versprach, die es für Gruppen nicht gab — woraufhin „Beenden“ für Gruppen freigegeben statt
gesperrt wurde. Die zweite fand, dass die beiden neuen Historien sich einen Aufklapp-Zustand und
einen einzigen Handler teilten, und einen Widerspruch in der Navigations-Produktregel.

Während der Reviewphase liefen #646 und #643 auf `main` ein und belegten nacheinander die
Migrationsnummern 100 und 101. Beide Kollisionen hätte Git ohne Textkonflikt zusammengeführt, weil
die Migrationsblöcke an verschiedenen Stellen der Datei stehen; erst der Serverstart wäre mit
„Doppelte Migrationsversion“ abgebrochen. Die Gruppen-Migrationen sind deshalb zweimal gerückt und
stehen final auf 102 und 103.
