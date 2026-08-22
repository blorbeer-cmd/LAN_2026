# Konzept: Terminfindung vor einem Event

## Ziel und Einordnung

Die Terminfindung ist ein eigener vorgelagerter Ablauf und noch kein Event. Sie beantwortet zuerst
„An welchem Wochenende können möglichst viele teilnehmen?“. Erst nach der Entscheidung und der
Unterkunftsbuchung wird daraus ein Event mit festem Zeitraum, Einladungen und Abrechnung.

Der Ablauf soll den typischen Prozess abbilden:

1. Ersteller schlägt mehrere Zeiträume vor.
2. Eingeladene Mitglieder antworten je Zeitraum.
3. Ersteller entscheidet sich bewusst für einen Zeitraum.
4. Unterkunft wird außerhalb von Respawn gebucht.
5. Aus der abgeschlossenen Abstimmung wird ein Event angelegt; Zeitraum, Personen und optional die
   Unterkunftskosten werden übernommen.

## Erkenntnisse aus bestehenden Terminfindungswerkzeugen

- Doodle und Framadate verwenden drei aussagekräftige Verfügbarkeitsstufen: Ja, wenn nötig und Nein.
  Das ist für mehrtägige LAN-Termine hilfreicher als ein binärer Vote, weil ein Notfalltermin nicht
  gleichwertig mit einem bevorzugten Wochenende behandelt wird.
- Doodle macht Antwortfrist, Erinnerungen an noch nicht antwortende Personen und optional verborgene
  Teilnehmerantworten zu expliziten Einstellungen. Für Respawn sollten Frist und gezielte Erinnerung
  Bestandteil des Kernablaufs sein; eine verborgene Abstimmung ist für die feste Freundesgruppe kein
  MVP-Bedarf.
- Rallly trennt Abstimmung und Terminentscheidung: Der Organisator prüft das Ergebnis, wählt einen
  Termin und schließt damit weitere Stimmen. Das passt besser als eine automatische Auswahl, weil
  Preis und Verfügbarkeit einer Unterkunft ebenfalls in die Entscheidung eingehen.
- Rallly stellt Ergebnisse je Option auf einen Blick dar und konvertiert Uhrzeiten in die Zeitzone
  der Teilnehmenden. Für LAN-Wochenenden sollte Respawn in Version 1 bewusst kalendarische Zeiträume
  ohne Uhrzeit verwenden. Sie werden als ISO-Datum gespeichert; erst die Event-Konvertierung bildet
  sie nach einer festgelegten lokalen Zeitzonenregel auf die UTC-Zeitpunkte des Events ab.
- Framadate erlaubt die nachträgliche Änderung der eigenen Antwort, solange die Abstimmung offen ist.
  Das ist wichtig, weil sich private Termine während einer mehrwöchigen Suche verändern können.

Quellen:

- [Doodle: Group Poll erstellen](https://help.doodle.com/en/articles/9457353-how-do-i-create-a-group-poll)
- [Doodle: Fristen, Erinnerungen und verborgene Teilnehmerliste](https://help.doodle.com/en/articles/9457346-how-do-i-set-a-deadline-limit-participants-send-automatic-reminders-or-make-my-group-poll-hidden)
- [Rallly: Abstimmung anlegen](https://support.rallly.co/workflow/create)
- [Rallly: Termin auswählen und Abstimmung schließen](https://support.rallly.co/workflow/schedule)
- [Framadate: Antworten und Ergebnisse](https://docs.framasoft.org/en/framadate/prise-en-main.html)
- [Framadate: Eigene Antwort bearbeiten](https://docs.framasoft.org/fr/framadate/fonctionnalites.html)

## Empfohlener Produktablauf

### 1. Abstimmung anlegen

Im Tab `Orga → Events` steht oberhalb der Eventliste eine zunächst eingeklappte Gruppe
`Terminfindung`. Der Ersteller gibt ein:

- Arbeitstitel, zum Beispiel „LAN Herbst 2027“
- optionale kurze Notiz
- zwei bis acht Zeiträume, jeweils `Beginn` und `Ende` als lokales Datum
- Antwortfrist
- einzuladende Mitglieder; standardmäßig sind alle aktiven Mitglieder vorausgewählt

Ein Zeitraum darf nicht rückwärts laufen oder einen anderen vorgeschlagenen Zeitraum exakt
duplizieren. Überschneidungen sind erlaubt, weil benachbarte Wochenendvarianten sinnvoll sein können.

### 2. Antworten

Jede eingeladene Person sieht pro Zeitraum genau eine Auswahl:

- `Kann` – regulär verfügbar
- `Wenn nötig` – möglich, aber nicht bevorzugt
- `Kann nicht`

Ein vierter Zustand `Offen` wird nicht aktiv gewählt, sondern bedeutet „noch keine Antwort“. Die
eigene Antwort kann bis zur Frist oder manuellen Schließung geändert werden. Eine Schaltfläche
`Antwort speichern` sichert die ganze Zeile atomar, damit kein teilweise gespeicherter Stand entsteht.

### 3. Ergebnis bewerten

Der Ersteller sieht pro Zeitraum:

- Anzahl `Kann`
- Anzahl `Wenn nötig`
- Anzahl `Kann nicht`
- Anzahl ausstehender Antworten
- die Namen je Kategorie in einer einklappbaren Detailansicht

Die Sortierung hebt Optionen nach folgenden Regeln hervor, entscheidet aber nie automatisch:

1. höchste Anzahl `Kann`
2. höchste Summe aus `Kann` und `Wenn nötig`
3. geringste Anzahl `Kann nicht`
4. frühester Beginn
5. frühestes Ende
6. niedrigste gespeicherte Position
7. niedrigste ID als absolut letzter, stabiler Gleichstand

Der Hinweis `Beste Abdeckung` ist eine Empfehlung. Nur der Ersteller kann `Termin auswählen`.

### 4. Erinnern, schließen und wieder öffnen

- Noch nicht antwortende Personen erhalten automatisch eine persönliche Erinnerung 48 Stunden vor
  der Frist und eine zweite am Kalendertag der Frist. Liegt die Erstellung bereits innerhalb eines
  Fensters, wird nur die nächste noch sinnvolle Stufe versendet.
- Der Ersteller kann zusätzlich `Offene erinnern` auslösen; die Aktion nennt vorab die betroffenen
  Personen. Pro Person gilt über automatische und manuelle Erinnerungen hinweg ein rollierender
  Mindestabstand von 24 Stunden.
- Wird die Frist verlängert, wird der automatische Erinnerungsplan auf die neue Frist bezogen neu
  berechnet. Bereits versendete Pushs bleiben im Verlauf, verhindern aber die neuen Friststufen nicht.
- Nach Fristablauf werden Antworten gesperrt, die Abstimmung bleibt aber sichtbar. Schreibversuche
  beantwortet die API mit `409`.
- Der Ersteller kann eine `closed`-Abstimmung ohne Terminwahl wieder öffnen. `reopen` akzeptiert
  dafür optional eine neue `responseDueAt`; ist die gespeicherte Frist bereits abgelaufen, ist ein
  neuer zukünftiger Wert verpflichtend und wird atomar mit dem Statuswechsel gespeichert.
- Scheitert die Unterkunftsbuchung nach der Terminwahl, hebt `Terminwahl aufheben` den Zustand
  `scheduled` auf: Die Abstimmung wechselt zurück nach `closed`, `selected_option_id` wird geleert,
  die Aktion wird auditiert und alle Eingeladenen werden benachrichtigt. Danach kann direkt eine
  andere bestehende Option gewählt oder die Abstimmung mit neuer Frist wieder geöffnet werden.
- `Termin auswählen` setzt genau eine Option als gewählt und schließt die Abstimmung atomar.

### 5. Nach der Unterkunftsbuchung als Event übernehmen

Eine entschiedene Abstimmung zeigt die primäre Aktion `Event anlegen`. Der vorausgefüllte Dialog
übernimmt:

- Titel und gewählten Zeitraum
- als Einladungsvorschlag alle Personen mit `Kann`
- optional zusätzlich Personen mit `Wenn nötig`
- optional Unterkunft, Ort/Kartenlink und Gesamtpreis der Unterkunft
- Beitrag pro Person, PayPal und Zahlungsziel

Das Event wird erst nach Bestätigung angelegt. Die Abstimmung speichert anschließend die erzeugte
Event-ID; ein Doppelklick oder Request-Retry darf kein zweites Event erzeugen. Die eingeladenen
Personen bleiben im Event zunächst `Einladung offen` und zählen erst nach ihrer Zusage in den
rechnerischen Unterkunftspreis pro Kopf.

### Änderungen während einer offenen Abstimmung

`PATCH /api/event-date-polls/:id` ändert ausschließlich Titel, Beschreibung und Antwortfrist. Für
Optionen und Eingeladene gibt es eigene Aktionen:

- Ein Zeitraum mit vorhandenen Antworten darf nicht inhaltlich geändert werden (`409`); stattdessen
  wird eine neue Option ergänzt und die alte nach Bestätigung entfernt.
- Das Entfernen einer Option löscht ihre Antworten per Fremdschlüssel-Kaskade, wird auditiert und
  informiert alle Eingeladenen. Mindestens zwei Optionen müssen verbleiben.
- Eine neu ergänzte Option beginnt für alle bisherigen Personen mit `Offen`; diese Personen erhalten
  eine persönliche Änderungsbenachrichtigung.
- Später hinzugefügte aktive Mitglieder beginnen für alle Optionen mit `Offen`; `invited_at` macht in
  Auswertung und Erinnerung sichtbar, dass sie erst später hinzugekommen sind.
- Das Entfernen einer eingeladenen Person löscht ihre Antworten kaskadierend, wird auditiert und
  entzieht den Detailzugriff. Vorher zeigt ein Bestätigungsdialog die betroffenen Antworten.
- Optionen und Eingeladene dürfen nur in `open` geändert werden; in jedem anderen Zustand folgt `409`.

## Zustände und Berechtigungen

Abstimmungszustände:

- `open` – Antworten möglich
- `closed` – Frist abgelaufen oder manuell geschlossen, noch kein Termin entschieden
- `scheduled` – Termin gewählt, Event kann angelegt werden
- `converted` – Event wurde angelegt
- `cancelled` – Terminfindung verworfen

Erlaubte Übergänge:

| Ausgang | Aktion | Ziel | Berechtigung | Konflikt |
|---|---|---|---|---|
| `open` | Frist oder `close` | `closed` | Ersteller/Vertretung | wiederholte oder konkurrierende Änderung: `409` |
| `closed` | `reopen` mit optionaler `responseDueAt` | `open` | Ersteller/Vertretung | Terminwahl vorhanden oder gespeicherte Frist ohne neue Frist abgelaufen: `409`; ungültige neue Frist: `400` |
| `open`, `closed` | `schedule` | `scheduled` | Ersteller/Vertretung | Option fremd/gelöscht oder Status inzwischen geändert: `409` |
| `scheduled` | `unschedule` | `closed` | Ersteller/Vertretung | `converted_event_id` bereits gesetzt oder Status inzwischen geändert: `409` |
| `scheduled` | `convert-to-event` | `converted` | Ersteller/Vertretung | paralleler Request erhält das bereits erzeugte Event, nie ein zweites |
| `open`, `closed`, `scheduled` | `DELETE`/Absagen | `cancelled` | Ersteller/Vertretung | terminaler Zustand: `409` |

`converted` und `cancelled` sind terminal und für alle fachlichen Schreibendpunkte gesperrt. Eine
Terminwahl darf nur vor der Konvertierung über `unschedule` aufgehoben werden; danach bleibt sie
historisch unveränderlich. Wird das verknüpfte Event später abgesagt, bleibt die Abstimmung `converted`, zeigt
den Status des verknüpften Events und dient als Historie. Sie wird weder zurückgesetzt noch hart
gelöscht. `DELETE` ist deshalb fachlich eine Absage und kein physisches Löschen.

Berechtigungen:

- Owner/Admin dürfen Abstimmungen anlegen und die nicht entscheidenden Metadaten verwalten.
- Der gespeicherte Ersteller entscheidet, öffnet wieder, sagt ab und konvertiert. Wird dieses Konto
  deaktiviert, gelöscht oder verliert seine aktive Gruppenmitgliedschaft, übernimmt der Gruppen-Owner
  diese Aktionen als dokumentierte Vertretung. Solange der Ersteller aktiv ist, erhalten andere
  Admins dadurch keine zusätzlichen Rechte.
- Eingeladene aktive Mitglieder dürfen nur ihre eigene Antwort schreiben.
- Die Abstimmung ist nur für eingeladene Mitglieder und berechtigte Verwalter lesbar.

## Datenmodell

```text
event_date_polls
  id, group_id, title, description, created_by, response_due_at,
  status, selected_option_id, converted_event_id, created_at, updated_at

event_date_poll_options
  id, poll_id, starts_on TEXT, ends_on TEXT, position

event_date_poll_invitees
  poll_id, player_id, invited_at, last_reminder_at,
  automatic_reminder_stage, automatic_reminder_due_at

event_date_poll_responses
  poll_id, option_id, player_id, response, updated_at
  response ∈ can | if_needed | cannot
```

Wichtige Constraints:

- eindeutige Option pro Poll und Zeitraum
- eindeutige Antwort pro Poll, Option und Person
- ausgewählte Option muss zur Abstimmung gehören
- erzeugtes Event ist höchstens einer Abstimmung zugeordnet
- Finalisierung und Event-Konvertierung laufen jeweils in einer Transaktion

`starts_on` und `ends_on` sind streng validierte ISO-Kalenderdaten (`YYYY-MM-DD`) und bewusst keine
Zeitpunkte. `response_due_at`, `invited_at`, `last_reminder_at`, `automatic_reminder_due_at` sowie
alle übrigen Zeitpunkte folgen der Repository-Regel und werden als UTC-Timestamps in Millisekunden
gespeichert. Die im Gruppenprofil konfigurierte Zeitzone (MVP-Fallback `Europe/Berlin`) bestimmt die
Abbildung bei der Event-Konvertierung:

- `events.starts_at` ist der lokale Tagesbeginn von `starts_on`, in UTC-ms umgerechnet.
- `events.ends_at` ist der Beginn des Tages nach `ends_on`, in UTC-ms umgerechnet; der Eventzeitraum
  bleibt damit halb-offen und umfasst den vollständigen Endtag.
- Eine als Datum eingegebene Antwortfrist endet lokal um 23:59:59,999 und wird als UTC-ms gespeichert.

Die Umrechnung verwendet eine zeitzonenfähige Bibliothek und wird ausdrücklich über Sommer- und
Winterzeitwechsel getestet; Browser-Parsing von `new Date('YYYY-MM-DD')` ist dafür nicht zulässig.

Fremdschlüsselregeln:

- Optionen, Eingeladene und Antworten werden beim physischen Löschen einer noch nie veröffentlichten
  Poll-Zeile per `ON DELETE CASCADE` entfernt.
- Antworten referenzieren zusätzlich Poll, Option und eingeladene Person; eine entfernte Option oder
  Einladung entfernt die zugehörigen Antworten per Kaskade.
- `created_by` verwendet `ON DELETE SET NULL`, damit die Owner-Vertretung übernehmen kann.
- `converted_event_id` verwendet `ON DELETE SET NULL`; eine fachliche Event-Absage löscht das Event
  jedoch nicht und lässt die historische Verknüpfung bestehen.

## API-Skizze

```text
GET    /api/event-date-polls
POST   /api/event-date-polls
GET    /api/event-date-polls/:id
PATCH  /api/event-date-polls/:id
POST   /api/event-date-polls/:id/options
DELETE /api/event-date-polls/:id/options/:optionId
POST   /api/event-date-polls/:id/invitees
DELETE /api/event-date-polls/:id/invitees/:playerId
PUT    /api/event-date-polls/:id/my-responses
POST   /api/event-date-polls/:id/reminders
POST   /api/event-date-polls/:id/close
POST   /api/event-date-polls/:id/reopen
POST   /api/event-date-polls/:id/schedule
POST   /api/event-date-polls/:id/unschedule
POST   /api/event-date-polls/:id/convert-to-event
DELETE /api/event-date-polls/:id
```

`PATCH` akzeptiert nur in `open` die Felder `title`, `description` und `responseDueAt`; in allen
anderen Zuständen folgt `409`. `POST /:id/reopen` akzeptiert ausschließlich ein optionales
`responseDueAt`, das bei bereits abgelaufener gespeicherter Frist verpflichtend und zukünftig sein
muss. Die vier Options-/Einladungsrouten setzen die oben beschriebenen Änderungsregeln um.
`POST /:id/unschedule` ist ausschließlich in `scheduled` vor einer Konvertierung zulässig, leert die
Auswahl atomar und erzeugt Audit- sowie persönliche Änderungsbenachrichtigungen. `DELETE /:id` setzt
`cancelled`; ein physisches Löschen ist nur für einen nie veröffentlichten, antwortlosen Entwurf als
interne Aufräumoperation zulässig. Unpassende Zustände liefern einheitlich `409`, unbekannte oder
nicht sichtbare Ressourcen `404` und ungültige Eingaben `400`.

Alle Mutationen senden nach erfolgreichem Commit ein gruppengebundenes Realtime-Signal. Die API
liefert fremde Antworten nur innerhalb der eingeladenen Gruppe; Push-Nachrichten bleiben persönlich.

## UI-Struktur

Die Oberfläche folgt der bestehenden Essen-/Event-Hierarchie:

1. kompakter Titel-/Statuskopf
2. ein gemeinsamer Infokasten mit Frist und Antwortfortschritt
3. darunter die Terminoptionen als stabile Zeilen
4. je Option eine einklappbare Personenliste
5. Erstelleraktionen in einem getrennten Footer

Auf dem Telefon stehen die Optionen untereinander. Auf breiten Ansichten kann die Ergebnisübersicht
zwei Spalten nutzen; die Namen bleiben einspaltige Zeilen. Antworten sind immer textlich beschriftet
und nicht nur über Farbe erkennbar.

## Migration und Tests

Die vier Poll-Tabellen werden gemeinsam in der nächsten freien, fortlaufenden Migration angelegt
(auf Basis dieses Konzepts Version 83 nach der bestehenden 82). Die Migration ist idempotent,
historisch sortiert und enthält alle oben festgelegten Fremdschlüssel und Indizes. Eine Legacy-Fixture
ohne Poll-Tabellen belegt den ersten Lauf; ein zweiter Start belegt die Wiederholbarkeit. Ein gezielt
injizierter Fehler muss die gesamte Migration einschließlich aller vier Tabellen zurückrollen.

Die spätere Umsetzung umfasst mindestens:

- Integrationstests für Berechtigungen, Statusübergänge, spätere Optionen/Eingeladene, Frist und
  Erinnerungsfenster sowie Event-Absage nach Konvertierung,
- parallele Requests per `Promise.all` für `schedule`, `convert-to-event`, `close`/`reopen` und jede
  weitere race-relevante Mutation; genau ein Request gewinnt, die übrigen erhalten `409` oder beim
  idempotenten Konvertieren dieselbe Event-ID,
- Migrationstests für Legacy-DB, Wiederholung, Fremdschlüssel-Kaskaden und Rollback bei Fehler,
- E2E-Tests in zwei Browsern für Realtime, Tastatur/Touch, Vertretung, mobile Breite und die
  Konvertierung einschließlich Sommer-/Winterzeitwechsel.

Vor Abschluss laufen im `server`-Bereich `npm run lint`, `npm run build`, `npm test`,
`npm run check:tokens` nach dem Staging und `npm run test:e2e`.

## MVP und spätere Erweiterungen

MVP:

- Zeiträume anlegen
- feste Respawn-Mitglieder einladen
- `Kann` / `Wenn nötig` / `Kann nicht`
- Antwortfrist und Erinnerung an offene Antworten
- Ergebnisübersicht, manuelle Terminauswahl und Umwandlung in ein Event

Später, nur bei tatsächlichem Bedarf:

- Kalenderexport nach der Entscheidung
- externe Gäste ohne Respawn-Konto
- private/verborgene Antworten
- Kommentarspalte pro Person oder Zeitraum
- mehrere gewählte Termine aus einer Abstimmung

Bewusst nicht im MVP: Kalender-Synchronisation, Uhrzeit-Slots, anonyme öffentliche Links und eine
vollautomatische Terminentscheidung. Sie erhöhen Sicherheits- und Bedienkomplexität, ohne den
beschriebenen LAN-Wochenendprozess wesentlich zu verbessern.

## Abnahmekriterien für eine spätere Umsetzung

- Eine eingeladene Person kann jede Option per Tastatur und Touch beantworten und bis zum Schließen
  ändern.
- Nicht eingeladene Konten erhalten für Detail- und Schreibzugriffe `404`.
- Gleichzeitiges Finalisieren wählt genau eine Option; konkurrierende Requests erhalten `409`.
- Die Event-Konvertierung ist idempotent und erzeugt höchstens ein Event.
- `converted` und `cancelled` sind terminal; alle unzulässigen Zustandswechsel liefern `409`.
- Eine fristbedingt geschlossene Abstimmung kann mit einer neuen zukünftigen Frist atomar wieder
  geöffnet werden; ohne neue Frist bleibt sie nach Fristablauf mit `409` geschlossen.
- Eine noch nicht konvertierte Terminwahl kann nach gescheiterter Unterkunftsbuchung nach `closed`
  zurückgesetzt werden, ohne Optionen, Einladungen oder Antworten zu verlieren; Auswahl, Audit und
  Benachrichtigungen werden dabei konsistent aktualisiert.
- Optionen und Eingeladene lassen sich während `open` nach den festgelegten Kaskaden-, Audit- und
  Benachrichtigungsregeln ergänzen oder entfernen.
- Nur `Kann` und optional `Wenn nötig` werden als Einladungsvorschlag übernommen.
- Der erzeugte Eventzeitraum entspricht nach der festgelegten lokalen Kalenderdatum-zu-UTC-Regel
  exakt der ausgewählten Option, auch über Sommer-/Winterzeitwechsel.
- Automatische und manuelle Erinnerungen respektieren pro Person den Mindestabstand; eine verlängerte
  Frist erzeugt einen neuen, nachvollziehbaren automatischen Erinnerungsplan.
- Deaktivierte oder gelöschte Ersteller blockieren die Abstimmung nicht; ausschließlich der Owner
  erhält dann die definierte Vertretungsberechtigung.
- Die Migration läuft auf einer bestehenden Datenbank wiederholbar und rollt bei Fehler vollständig zurück.
- Offene Antworten, Frist, Empfehlung und endgültige Auswahl aktualisieren sich in zwei offenen
  Browsern ohne Reload.
- Telefon- und Laptopansicht verursachen keinen horizontalen Seiten-Scroll.
