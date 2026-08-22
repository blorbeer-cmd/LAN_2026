# Konzept: Integrierte Terminabstimmung im Event

## Entscheidung und Ziel

Die Terminfindung ist kein separates Objekt mehr, das später in ein Event konvertiert wird. Das
Event entsteht bereits zu Beginn als gemeinsamer Planungskontext und enthält eine oder mehrere
Terminabstimmungsrunden. Damit bleiben Terminfindung, Unterkunft, Einladungen, Zusagen, Zahlungen
und Abrechnung dauerhaft an derselben Event-ID gebündelt.

Der Ablauf entspricht damit dem tatsächlichen Vorgehen:

1. Ein Ersteller legt ein Event zunächst ohne festen Termin als „In Planung“ an.
2. Im Event wird eine Terminabstimmung mit mehreren Zeiträumen gestartet.
3. Der Ersteller wählt nach der Abstimmung bewusst einen Termin.
4. Die Unterkunft wird außerhalb von Respawn gebucht und anschließend im Event hinterlegt.
5. Personen können noch zu- oder absagen oder später ergänzt werden.
6. Falls der Termin nachträglich nicht mehr möglich ist, startet im selben Event eine neue
   Abstimmungsrunde. Frühere Runden und Entscheidungen bleiben als Historie sichtbar.
7. Nach dem Event erfolgt die Abrechnung weiterhin im selben Event.

Die Event-ID ändert sich in diesem Ablauf nie. Eine Aktion „In Event umwandeln“ und eine
converted_event_id an der Abstimmung entfallen.

## Erkenntnisse aus bestehenden Terminfindungswerkzeugen

- Doodle und Framadate verwenden drei aussagekräftige Verfügbarkeitsstufen: Ja, wenn nötig und
  Nein. Das ist für mehrtägige LAN-Termine hilfreicher als ein binärer Vote.
- Doodle behandelt Antwortfrist und Erinnerungen an noch nicht antwortende Personen als explizite
  Einstellungen. Beides gehört in Respawn zum Kernablauf.
- Rallly trennt Ergebnis und Entscheidung: Das System empfiehlt, aber der Organisator wählt den
  Termin. Das ist wichtig, weil Unterkunftspreis und Buchbarkeit ebenfalls einfließen.
- Framadate erlaubt das Ändern der eigenen Antwort, solange die Abstimmung offen ist.
- Für LAN-Wochenenden verwendet Respawn im MVP kalendarische Zeiträume ohne Uhrzeit.

Quellen:

- [Doodle: Group Poll erstellen](https://help.doodle.com/en/articles/9457353-how-do-i-create-a-group-poll)
- [Doodle: Fristen und Erinnerungen](https://help.doodle.com/en/articles/9457346-how-do-i-set-a-deadline-limit-participants-send-automatic-reminders-or-make-my-group-poll-hidden)
- [Rallly: Abstimmung anlegen](https://support.rallly.co/workflow/create)
- [Rallly: Termin auswählen](https://support.rallly.co/workflow/schedule)
- [Framadate: Antworten und Ergebnisse](https://docs.framasoft.org/en/framadate/prise-en-main.html)
- [Framadate: Eigene Antwort bearbeiten](https://docs.framasoft.org/fr/framadate/fonctionnalites.html)

## Produktablauf

### 1. Event in Planung anlegen

Im Bereich „Orga -> Events“ wird ein Event mit Arbeitstitel und optionaler Beschreibung angelegt.
Ein Zeitraum ist in dieser Phase nicht erforderlich. Das Event erhält den bestehenden Status
draft und wird in der Oberfläche als „In Planung“ dargestellt.

Ein Planungs-Event ist sichtbar für:

- seinen Ersteller und dessen definierte Vertretung,
- aktive Mitglieder, die zu mindestens einer Abstimmungsrunde eingeladen sind,
- später zusätzlich die regulären Eventteilnehmer.

Andere Gruppenmitglieder erhalten für Detailzugriffe 404. Bestehende Eventlisten, Tracking,
Statistiken und Agentenzuordnung müssen Planungs-Events ohne Termin ausdrücklich ignorieren oder
korrekt als Planung darstellen; sie dürfen kein ungültiges Datum rendern.

### 2. Erste Abstimmungsrunde starten

Im Event wählt der Ersteller „Termin abstimmen“ und gibt ein:

- zwei bis acht Zeiträume mit Beginn und Ende als lokale Kalenderdaten,
- eine Antwortfrist,
- einzuladende aktive Mitglieder; standardmäßig sind alle aktiven Mitglieder vorausgewählt,
- optional eine kurze Notiz speziell für diese Runde.

Ein Zeitraum darf nicht rückwärts laufen oder einen anderen Zeitraum derselben Runde exakt
duplizieren. Überschneidungen sind erlaubt. Pro Event darf höchstens eine offene oder geschlossene,
noch nicht entschiedene Runde existieren.

### 3. Antworten

Jede eingeladene Person beantwortet jede Option mit genau einem Wert:

- „Kann“
- „Wenn nötig“
- „Kann nicht“

„Offen“ ist kein wählbarer Wert, sondern bedeutet noch nicht beantwortet. „Antwort speichern“
sichert alle Antworten der Person für die Runde atomar. Die eigene Antwort kann bis zur Frist oder
manuellen Schließung geändert werden.

### 4. Ergebnis bewerten und Termin festlegen

Der Ersteller sieht pro Zeitraum:

- Anzahl „Kann“, „Wenn nötig“, „Kann nicht“ und „Offen“,
- die Namen je Kategorie in einer einklappbaren Detailansicht,
- eine nachvollziehbare Empfehlung „Beste Abdeckung“.

Die Sortierung entscheidet nie automatisch und verwendet stabil:

1. höchste Anzahl „Kann“,
2. höchste Summe aus „Kann“ und „Wenn nötig“,
3. geringste Anzahl „Kann nicht“,
4. frühester Beginn,
5. frühestes Ende,
6. niedrigste gespeicherte Position,
7. niedrigste ID als letzter Gleichstand.

„Termin festlegen“ markiert genau eine Option als gewählt und übernimmt ihren Zeitraum atomar in
das Event. Bei der ersten Auswahl steigt schedule_revision des Events von 0 auf 1. Das Event bleibt
draft, bis der Ersteller die regulären Einladungen bzw. Veröffentlichung bestätigt.

### 5. Unterkunft und reguläre Einladungen

Nach der Terminwahl ergänzt der Ersteller im selben Event optional:

- Unterkunft, Ort oder Kartenlink,
- Gesamtpreis der Unterkunft,
- Beitrag pro Person,
- PayPal-Adresse bzw. PayPal.me-Link,
- Zahlungsziel.

Für die reguläre Eventeinladung schlägt die Oberfläche alle Personen mit „Kann“ und optional die
Personen mit „Wenn nötig“ vor. Erst nach Bestätigung werden sie in event_participants als invited
übernommen und das Event wird nach dem bestehenden Veröffentlichungsablauf sichtbar. Eine Antwort
in der Terminabstimmung ist noch keine verbindliche Eventzusage.

Nur Teilnehmende, die den aktuell gültigen Termin angenommen haben, zählen für den aktuellen Preis
pro Kopf. Der Gesamtpreis der Unterkunft bleibt davon unabhängig und bildet gemeinsam mit den
tatsächlich verbuchten Zahlungen die Abrechnungsdifferenz.

### 6. Spätere Neuabstimmung im selben Event

Solange das Event weder läuft noch beendet ist, kann der Ersteller „Neuen Termin abstimmen“
starten. Das gilt auch für ein bereits veröffentlichtes Event. Dabei:

- bleibt der bisher festgelegte Termin als „Bisheriger Termin“ sichtbar und vorläufig gültig,
- bleibt die zuvor ausgewählte Runde unverändert in der Historie,
- beginnt eine neue Runde mit neuen oder bewusst übernommenen Optionen,
- sind standardmäßig alle bisherigen Eventteilnehmer und bisherigen Abstimmungsteilnehmer
  vorausgewählt,
- beginnen alle Antworten der neuen Runde mit „Offen“; alte Antworten werden nur als Historie
  angezeigt und niemals als aktuelle Antwort kopiert,
- kann die neue Runde abgebrochen werden, ohne den bisherigen Termin zu verändern.

Wählt der Ersteller in der neuen Runde einen Termin, läuft eine gemeinsame Transaktion:

1. Die bisher ausgewählte Runde wird superseded.
2. Die neue Runde wird scheduled.
3. starts_at und ends_at des Events werden aktualisiert.
4. schedule_revision wird erhöht.
5. Audit-Eintrag, Realtime-Ereignis und persönliche Benachrichtigungen werden erzeugt.

Alle bisherigen Zu- und Absagen bleiben historisch erhalten, gelten aber nicht automatisch für die
neue Revision. Betroffene Personen sehen „Erneute Bestätigung erforderlich“ und müssen für den
neuen Termin erneut zu- oder absagen. Eine alte Zusage darf in Abrechnung, Teilnehmerzahl, Tracking
oder anderen fachlichen Abfragen nicht als aktuelle Zusage zählen.

Bereits gespeicherte Zahlungen werden bei einem Terminwechsel niemals gelöscht oder zurückgesetzt.
Der Ersteller sieht stattdessen:

- „Bezahlt, Teilnahme für neuen Termin offen“,
- die weiterhin verbuchte Summe,
- die Differenz zu den Unterkunftsausgaben,
- einen Hinweis, mögliche Rückzahlung oder Nachforderung manuell zu prüfen.

Sind Unterkunftskosten, Zahlungen oder bestätigte Teilnehmende vorhanden, zeigt die Aktion vor dem
Start und nochmals vor der Auswahl des neuen Termins einen Bestätigungsdialog mit den betroffenen
Zahlen. Ein Terminwechsel nach aktiviertem Tracking oder nach Eventende ist gesperrt.

## Erinnerungen und Fristablauf

- Offene Personen erhalten automatisch eine persönliche Erinnerung 48 Stunden vor der Frist und
  eine zweite am Kalendertag der Frist. Bei später Erstellung wird nur die nächste sinnvolle Stufe
  versendet.
- „Offene erinnern“ zeigt vorab die betroffenen Personen. Über automatische und manuelle
  Erinnerungen gilt pro Person ein rollierender Mindestabstand von 24 Stunden.
- Eine verlängerte Frist berechnet den Plan neu. Bereits versendete Pushs bleiben im Verlauf,
  verhindern die neuen Friststufen aber nicht.
- Automatische und manuelle Erinnerungen sind ausschließlich in open zulässig. Jeder Übergang aus
  open, insbesondere close, schedule oder cancel, leert alle noch ausstehenden
  automatic_reminder_due_at-Werte; bereits versendete Erinnerungen bleiben nur im Verlauf. Ein
  späteres reopen legt für die neue Frist einen frischen Plan an. „Offene erinnern“ liefert
  außerhalb von open 409.
- Der erste authentifizierte Zugriff nach Fristablauf materialisiert open -> closed lazy,
  idempotent und transaktional. Genau ein konkurrierender Zugriff schreibt Status und Audit,
  verwirft ausstehende Erinnerungen und sendet genau ein Realtime-Signal, aber keine persönliche
  Push-Nachricht. Ein Hintergrundjob darf diesen Übergang vorwegnehmen, ist aber nicht erforderlich.
- Ab der fachlich abgelaufenen Frist liefern Antworten und andere Schreibaktionen 409, auch wenn
  der lazy Statusübergang noch nicht gespeichert war.
- reopen verlangt eine neue zukünftige Frist, wenn die gespeicherte Frist bereits abgelaufen ist,
  und berechnet die Erinnerungen atomar neu.

## Zustände und Übergänge

### Eventstatus

Die bestehenden Eventzustände bleiben maßgeblich:

- draft - Event wird geplant; ein fester Termin kann noch fehlen.
- published - Termin und reguläre Einladungen sind veröffentlicht.
- cancelled - Event wurde abgesagt.
- ended - Event ist beendet.

cancelled und ended sperren neue Abstimmungsrunden. Tracking darf nur für published mit festem
Zeitraum aktiviert werden.

### Abstimmungsrunden

- open - Antworten möglich.
- closed - Frist abgelaufen oder manuell geschlossen, noch keine Auswahl.
- scheduled - aktuell für das Event ausgewählte Runde.
- superseded - frühere Auswahl, die durch eine neue Auswahl ersetzt wurde.
- cancelled - Runde verworfen; der zuvor gültige Eventtermin bleibt unverändert.

| Ausgang | Aktion | Ziel | Auswirkung |
|---|---|---|---|
| open | Frist oder close | closed | Antworten und Erinnerungen werden gesperrt |
| closed | reopen | open | zukünftige Frist und Erinnerungsplan werden atomar gesetzt |
| open, closed | schedule | scheduled | Eventtermin wird gesetzt oder ersetzt |
| open, closed | cancel | cancelled | bestehender Eventtermin bleibt bestehen |
| scheduled | neue Runde wird gewählt | superseded | historische Auswahl bleibt lesbar |

Wiederholte oder konkurrierende Zustandswechsel liefern 409. Ein idempotenter Retry derselben
erfolgreichen Terminwahl liefert den bereits erreichten Zustand, erzeugt aber keine zweite Revision
und keine doppelten Benachrichtigungen.

## Änderungen während einer offenen Runde

Metadaten wie Notiz und Antwortfrist können per PATCH geändert werden. Optionen und Eingeladene
verwenden eigene Aktionen:

- Eine Option mit Antworten darf nicht inhaltlich geändert werden (409). Stattdessen wird eine neue
  Option ergänzt und die alte nach Bestätigung entfernt.
- Das Entfernen einer Option löscht deren Antworten kaskadierend, wird auditiert und benachrichtigt
  alle Eingeladenen. Mindestens zwei Optionen müssen verbleiben.
- Neue Optionen und später hinzugefügte Personen beginnen überall mit „Offen“.
- Das Entfernen einer Person löscht ihre Antworten dieser Runde kaskadierend, entzieht ihren
  Rundenzugriff und zeigt vorher einen Bestätigungsdialog.
- Diese Änderungen sind nur in open erlaubt; sonst folgt 409.

## Berechtigungen

- Owner und Admins dürfen Planungs-Events und Abstimmungsrunden anlegen.
- Der gespeicherte Eventersteller entscheidet, öffnet wieder, bricht Runden ab und startet eine
  Neuabstimmung.
- Wird der Ersteller deaktiviert, gelöscht oder verliert seine aktive Gruppenmitgliedschaft,
  übernimmt ausschließlich der Gruppen-Owner diese Aktionen als auditierte Vertretung.
- Solange der Ersteller aktiv ist, erhalten andere Admins keine zusätzlichen Entscheidungsrechte.
- Eingeladene aktive Mitglieder dürfen nur ihre eigenen Antworten schreiben.
- Runden sind nur für ihre Eingeladenen, Eventteilnehmer und berechtigte Verwalter lesbar. Nicht
  sichtbare Ressourcen liefern 404 statt Berechtigungsdetails offenzulegen.

## Datenmodell

Das bestehende Event bleibt der fachliche Parent:

    events
      ...
      starts_at NULLABLE
      ends_at NULLABLE
      schedule_revision INTEGER NOT NULL DEFAULT 0

    event_date_polls
      id, event_id, round_number, note, created_by, response_due_at,
      status, selected_option_id, created_at, updated_at

    event_date_poll_options
      id, poll_id, starts_on TEXT, ends_on TEXT, position

    event_date_poll_invitees
      poll_id, player_id, invited_at, last_reminder_at,
      automatic_reminder_stage, automatic_reminder_due_at

    event_date_poll_responses
      poll_id, option_id, player_id, response, updated_at
      response in can | if_needed | cannot

    event_participants
      ...
      confirmed_schedule_revision INTEGER

event_participants.status enthält weiterhin die Antwort auf die Eventeinladung. Eine Teilnahme ist
fachlich nur aktuell bestätigt, wenn zusätzlich
confirmed_schedule_revision = events.schedule_revision gilt. Bei Annahme oder Ablehnung wird die
aktuelle Revision gespeichert. Alle bestehenden SQL-Abfragen und Guards für Teilnehmerzahl, Kosten,
Sichtbarkeit, Tracking und aktive Eventauswahl müssen auf dieses gemeinsame Prädikat geprüft und
zentralisiert werden.

Wichtige Constraints:

- fortlaufende, eindeutige round_number pro Event,
- höchstens eine unentschiedene Runde (open oder closed) pro Event,
- höchstens eine scheduled-Runde pro Event,
- eindeutige Option pro Runde und Zeitraum,
- eindeutige Antwort pro Runde, Option und Person,
- ausgewählte Option muss zur Runde gehören,
- Antworten referenzieren zusätzlich eine Einladung derselben Runde,
- Auswahl, Eventzeitraum und Terminrevision werden in einer Transaktion geändert.

starts_on und ends_on sind streng validierte ISO-Kalenderdaten (YYYY-MM-DD). Zeitpunkte wie Fristen
und Erinnerungen werden als UTC-Millisekunden gespeichert. Die Gruppenzeitzone mit MVP-Fallback
Europe/Berlin bildet die gewählte Option auf das Event ab:

- starts_at ist der lokale Tagesbeginn von starts_on in UTC-ms.
- ends_at ist der Beginn des Tages nach ends_on in UTC-ms; der Eventzeitraum umfasst damit den
  vollständigen Endtag.
- Eine als Datum eingegebene Frist endet lokal um 23:59:59,999.

Die Umrechnung verwendet eine zeitzonenfähige Bibliothek und wird über Sommer- und
Winterzeitwechsel getestet. Browser-Parsing mit new Date('YYYY-MM-DD') ist dafür nicht zulässig.

## API-Skizze

Die Event-ID ist Bestandteil jeder Route:

    POST   /api/events/planning
    GET    /api/events/:eventId/date-polls
    POST   /api/events/:eventId/date-polls
    GET    /api/events/:eventId/date-polls/:pollId
    PATCH  /api/events/:eventId/date-polls/:pollId
    POST   /api/events/:eventId/date-polls/:pollId/options
    DELETE /api/events/:eventId/date-polls/:pollId/options/:optionId
    POST   /api/events/:eventId/date-polls/:pollId/invitees
    DELETE /api/events/:eventId/date-polls/:pollId/invitees/:playerId
    PUT    /api/events/:eventId/date-polls/:pollId/my-responses
    POST   /api/events/:eventId/date-polls/:pollId/reminders
    POST   /api/events/:eventId/date-polls/:pollId/close
    POST   /api/events/:eventId/date-polls/:pollId/reopen
    POST   /api/events/:eventId/date-polls/:pollId/schedule
    POST   /api/events/:eventId/date-polls/:pollId/cancel

Es gibt keinen convert-to-event-Endpunkt. Das Anlegen eines Planungs-Events und seiner ersten Runde
kann optional in einem transaktionalen Request kombiniert werden, damit kein verwaistes leeres
Event entsteht.

Unpassende Zustände liefern 409, ungültige Eingaben 400 und unbekannte oder nicht sichtbare
Ressourcen 404. Alle Mutationen senden erst nach erfolgreichem Commit ein gruppengebundenes
Realtime-Signal. Push-Nachrichten bleiben persönlich.

## UI-Struktur

Terminfindung erscheint innerhalb der bestehenden Eventkarte bzw. Eventdetailansicht:

1. kompakter Eventkopf mit Planungs- oder Eventstatus,
2. gemeinsamer Infokasten mit aktuellem bzw. bisherigem Termin, Frist und Antwortfortschritt,
3. darunter die aktuelle Abstimmungsrunde mit stabilen Terminzeilen,
4. je Option eine standardmäßig eingeklappte Personenliste,
5. getrennte Erstelleraktionen im Footer,
6. einklappbarer Bereich „Frühere Abstimmungen“ für abgeschlossene, ersetzte oder abgebrochene
   Runden,
7. danach die bestehenden Bereiche für Teilnehmer, Unterkunft, Bezahlung und Abrechnung.

Bei einer Neuabstimmung unterscheidet die UI klar:

- „Bisheriger Termin“,
- „Neuabstimmung läuft“,
- „Erneute Bestätigung erforderlich“,
- „Aktueller Termin“ nach der neuen Auswahl.

Die Oberfläche verwendet Felder, Toggles, Statuschips, einklappbare Listen und Abstände des
Essen-Bestellbereichs. Auf dem Telefon stehen Optionen untereinander; Namen bleiben auch auf breiten
Ansichten einspaltig. Status sind textlich beschriftet und nicht nur über Farbe erkennbar.

## Migration und Kompatibilität

Die Umsetzung verwendet die nächste zum Implementierungszeitpunkt freie, fortlaufende Migration.
Sie muss:

- events.starts_at für draft-Planungs-Events nullable machen,
- events.schedule_revision ergänzen,
- event_participants.confirmed_schedule_revision ergänzen und bestehende Teilnahmen auf eine
  konsistente Ausgangsrevision migrieren,
- die vier Poll-Tabellen mit Fremdschlüsseln, Indizes und partiellen Eindeutigkeiten anlegen,
- bestehende veröffentlichte und beendete Events unverändert lauffähig halten.

Bestands-Events mit festem Zeitraum erhalten schedule_revision 1. Für bereits angenommene oder
abgelehnte Teilnahmen wird confirmed_schedule_revision ebenfalls auf 1 gesetzt; weiterhin offene
Einladungen bleiben unbestätigt. Die permanenten Basis- und Außerhalb-Events behalten ihre
Sonderbehandlung, dürfen keine Terminabstimmungen erhalten und werden nicht versehentlich zu
Planungs-Events umgedeutet.

Da SQLite das Entfernen eines NOT-NULL-Constraints einen Tabellenneuaufbau erfordern kann, muss die
Migration alle bestehenden Spalten, Constraints, Indizes und Fremdschlüssel explizit bewahren.
Legacy-Fixture, Wiederholung und injizierter Fehler belegen idempotenten Lauf und vollständigen
Rollback.

## Tests

Die spätere Umsetzung umfasst mindestens:

- Integrationstests für Sichtbarkeit, Berechtigungen, Statusübergänge, Frist, Erinnerungen,
  spätere Optionen und Eingeladene,
- Tests für ein Planungs-Event ohne Datum in sämtlichen Eventlisten und Serializern,
- Paralleltests per Promise.all für Schließen, Wiederöffnen, Terminwahl und konkurrierende
  Terminrevisionen,
- Paralleltest für zwei erste Zugriffe nach Fristablauf: genau ein lazy close, ein Audit-Eintrag und
  ein Realtime-Signal,
- Erinnerungstests, die nach close, schedule und cancel keine weitere Zustellung zulassen und nach
  reopen einen neuen Plan für die neue Frist belegen,
- Regressionstests, dass genau eine Runde scheduled ist und ein Retry keine zweite Revision
  erzeugt,
- Tests für Neuabstimmung mit bestehenden Zusagen, Absagen, Unterkunftskosten und Zahlungen,
- Tests, dass alte Zusagen nach einem Terminwechsel weder Preis pro Kopf noch Tracking oder aktive
  Teilnehmerzahl beeinflussen,
- Migrationstests für Legacy-Datenbank, Wiederholung, Kaskaden und Rollback,
- E2E-Tests in zwei Browsern für Realtime, Tastatur, Touch, Owner-Vertretung, mobile Breite sowie
  Sommer- und Winterzeitwechsel.

Vor Abschluss laufen im Serverbereich mindestens npm run lint, npm run build, npm test,
npm run check:tokens nach dem Staging und npm run test:e2e sowie der vorgeschriebene
Testlauf-Performance-Check.

## MVP und spätere Erweiterungen

MVP:

- Planungs-Event ohne festen Termin anlegen,
- eine oder mehrere aufeinanderfolgende Abstimmungsrunden im selben Event,
- feste Respawn-Mitglieder einladen,
- „Kann“, „Wenn nötig“ und „Kann nicht“,
- Frist und Erinnerungen,
- Ergebnisübersicht und manuelle Terminauswahl,
- spätere Neuabstimmung mit Historie und erneuter Teilnahmebestätigung,
- nahtloser Übergang zu Unterkunft, Einladungen, Zahlungen und Abrechnung im selben Event.

Später, nur bei tatsächlichem Bedarf:

- Kalenderexport nach der Entscheidung,
- externe Gäste ohne Respawn-Konto,
- private oder verborgene Antworten,
- Kommentarspalte pro Person oder Zeitraum,
- mehrere gleichzeitig gewählte Termine.

Bewusst nicht im MVP sind Kalender-Synchronisation, Uhrzeit-Slots, anonyme öffentliche Links und
eine vollautomatische Terminentscheidung.

## Abnahmekriterien

- Das Event besitzt vom Beginn der Planung bis zur Abrechnung dieselbe ID.
- Ein Planungs-Event ohne Datum verursacht in keiner Eventansicht „Invalid Date“ und kann weder
  Tracking noch aktive Eventzuordnung auslösen.
- Eine eingeladene Person kann jede Option per Tastatur und Touch beantworten und bis zum Schließen
  ändern.
- Nicht eingeladene Konten erhalten für Detail- und Schreibzugriffe 404.
- Gleichzeitiges Festlegen wählt genau eine Option; konkurrierende Requests erhalten 409.
- Eine neue Terminrunde überschreibt oder löscht keine frühere Runde und kann ohne Änderung des
  bisherigen Eventtermins abgebrochen werden.
- Die Auswahl eines neuen Termins aktualisiert Runde, Eventzeitraum und Revision genau einmal und
  atomar.
- Nach einem Terminwechsel müssen frühere Zu- und Absagen für die neue Revision erneut bestätigt
  werden. Bis dahin zählen sie nicht als aktuelle Teilnahme.
- Zahlungen und Zahlungs-Snapshots bleiben bei einem Terminwechsel erhalten; der Ersteller sieht
  offene Bestätigungen und die Abrechnungsdifferenz.
- Nur „Kann“ und optional „Wenn nötig“ werden für die erste reguläre Eventeinladung vorgeschlagen.
- Optionen und Eingeladene lassen sich während open nach den festgelegten Kaskaden-, Audit- und
  Benachrichtigungsregeln ändern.
- Erinnerungen respektieren den Mindestabstand und werden nach Friständerung nachvollziehbar neu
  geplant.
- Deaktivierte oder gelöschte Ersteller blockieren die Abstimmung nicht; ausschließlich der Owner
  erhält die definierte Vertretungsberechtigung.
- Die Datumsumrechnung bleibt auch über Sommer- und Winterzeitwechsel exakt.
- Die Migration erhält alle Bestandsdaten, läuft wiederholbar und rollt bei Fehler vollständig
  zurück.
- Frist, Antworten, Empfehlung, Terminwahl und erneute Bestätigung aktualisieren sich in zwei
  offenen Browsern ohne Reload.
- Telefon- und Laptopansicht verursachen keinen horizontalen Seiten-Scroll.
