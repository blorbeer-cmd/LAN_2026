# Konzept: Allgemeiner Abstimmungsbereich je Event

Status: umgesetzt in PR #482
Stand: 23. August 2026

## 1. Ziel

Im Orga-Bereich gibt es einen eigenen Tab **Abstimmungen**. Dort können bestätigte Teilnehmer des
aktiven Events voneinander unabhängige Abstimmungen starten, beantworten und in mehreren Runden
fortführen. Typische Fragen sind Termin/Zeitraum, Ort, Dauer, Budget, Verpflegung oder eine freie
Entscheidung.

Eine Abstimmung dokumentiert ausschließlich Meinungen und ein optional festgehaltenes Ergebnis.
Sie verändert niemals automatisch den Termin, Ort, Preis, die Dauer, Teilnahme oder andere Daten
des Events. Eine spätere Funktion „Ergebnis ins Event übernehmen“ ist ausdrücklich nicht Teil dieses
Umfangs.

## 2. Leitentscheidungen

- Das Event wird zuerst über den bestehenden Event-Bereich angelegt.
- Das aktive Event wird ausschließlich im vorhandenen Event-Umschalter oben rechts gewählt. Im
  Abstimmungs-Tab und im Erstell-Dialog gibt es keine zweite Eventauswahl.
- Mit aktivem Basis-Kontext „Allgemein“ zeigt der Tab einen eindeutigen Hinweis, zuerst ein Event zu
  wählen.
- Sichtbarkeit und Aktionen folgen dem etablierten Event-Teilnehmermodell: Nur Personen mit
  bestätigter Teilnahme (`accepted`) können Abstimmungen dieses Events sehen, erstellen oder
  beantworten. Eventänderungen machen diese Zusage nicht ungültig.
- Eine offene Einladung, eine abgelehnte Einladung oder eine Adminrolle ohne bestätigte Teilnahme
  gewährt keinen Zugriff.
- Jeder bestätigte Teilnehmer darf eine neue Abstimmung erstellen. Die einzelne Abstimmung wird von
  ihrem Ersteller verwaltet. Nur wenn dessen Konto nicht mehr aktiv ist, darf ein bestätigter Owner
  übernehmen.
- Der Teilnehmerkreis wird automatisch aus den bestätigten Eventteilnehmern gebildet. Es gibt keine
  manuelle Teilnehmerauswahl je Abstimmung.
- Die Event-Teilnahme wird nicht im Abstimmungsbereich bearbeitet. Der bestehende Einladungs- und
  Zusage-Flow bleibt unverändert.

## 3. Fachliches Modell

### 3.1 Abstimmung und Runde

Eine **Abstimmung** ist die dauerhaft zusammengehörige Frage, identifiziert durch `decision_key`.
Beispiel: „Wo übernachten wir?“

Eine **Runde** ist ein konkreter Durchlauf dieser Abstimmung mit:

- fortlaufender Rundennummer innerhalb genau dieser Abstimmung,
- Titel und optionaler Beschreibung,
- zwei bis acht freien Textoptionen,
- optionaler kurzer Notiz und HTTP-/HTTPS-Link je Option,
- Antwortmodus,
- optionaler maximaler Stimmenzahl bei Mehrfachauswahl,
- Abstimmungsfrist,
- Antworten und Erinnerungsstatus,
- optional festgehaltenem Ergebnis.

Eine neue, unabhängige Abstimmung beginnt immer mit Runde 1. Eine Folgerunde übernimmt als
Ausgangspunkt Titel, Antwortmodus und Optionen der vorherigen Runde, kann im Dialog aber angepasst
werden. Frühere Runden bleiben unveränderlich in der Historie sichtbar.

### 3.2 Antwortmodi

#### Jede Option bewerten (`feasibility`)

Für jede Option kann genau ein Zustand gewählt werden:

- **Passt** (`can`)
- **Wenn nötig** (`if_needed`)
- **Passt nicht** (`cannot`)
- **Offen** (keine gespeicherte Bewertung für diese Option)

„Offen“ ist ein ausdrücklicher vierter UI-Zustand und erlaubt auch, eine frühere Bewertung wieder
zurückzunehmen. Technisch wird dafür keine Antwortzeile gespeichert. Solange mindestens eine Option
offen ist, gilt die Person als noch nicht vollständig abgestimmt und bleibt erinnerungsberechtigt.

#### Eine Option wählen (`single_choice`)

Jede Person wählt genau eine Option. Die Oberfläche beschriftet den Button an jeder Option eindeutig
mit „Diese Option wählen“ beziehungsweise „Ausgewählt“.

#### Mehrere Optionen wählen (`multiple_choice`)

Jede Person wählt mindestens eine Option. Optional kann der Ersteller „höchstens N Optionen“
festlegen. Ohne Wert dürfen alle Optionen gewählt werden. Auch hier sind die Aktionen an jeder
Option klar mit „Option auswählen“ beziehungsweise „Ausgewählt“ beschriftet.

#### Jede Option von 1 bis 5 bewerten (`rating_1_5`)

Jede Person vergibt für jede Option genau eine Bewertung von **1** bis **5**. Die Übersicht zeigt
den Durchschnitt, die Zahl der Bewertungen und noch offene Antworten. Die beste Bewertung wird erst
markiert, sobald tatsächlich mindestens eine Bewertung vorliegt.

### 3.3 Rundenstatus

- `open`: **Abstimmung läuft**; Antworten können gespeichert und geändert werden.
- `closed`: **Abstimmung beendet**; Antworten sind schreibgeschützt. Der Ersteller kann ein Ergebnis
  festhalten oder mit neuer Frist wieder öffnen.
- `scheduled`: historischer Datenbankname für eine abgeschlossene Runde mit festgehaltenem Ergebnis;
  in der UI heißt der Status **Ergebnis festgehalten**.
- `superseded`: eine ältere abgeschlossene Runde, die durch ein Ergebnis einer neueren Runde ersetzt
  wurde.
- `cancelled`: abgebrochene Runde; bleibt in der Historie.

Die Schaltfläche „Ergebnis festhalten“ erscheint erst nach „Abstimmung beenden“. Der zugehörige Hinweis
erklärt, dass das Ergebnis nur in der Rundenhistorie gespeichert wird und keine Eventdaten ändert.

## 4. Teilnehmerkreis und Berechtigungen

### 4.1 Lesen und Antworten

Der Zugriff wird serverseitig bei jeder Listen-, Detail- und Mutationsroute geprüft. Eine UI-Sperre
allein reicht nicht. Maßgeblich ist derselbe zentralisierte SQL-Prädikatsausdruck wie für andere
Event-Arbeitsbereiche.

Neu bestätigte Teilnehmer werden einer offenen Runde beim nächsten Zugriff automatisch hinzugefügt
und können sofort abstimmen. Verlässt eine Person den bestätigten Teilnehmerkreis, verliert sie den
Zugriff und wird nicht mehr erinnert. Bereits gespeicherte Antworten abgeschlossener Runden bleiben
als Historie erhalten.

### 4.2 Erstellen und Verwalten

- Neue Abstimmung: jeder bestätigte Teilnehmer.
- Frist, Optionen, Erinnerungen, Abstimmung beenden, wieder öffnen, Abstimmung abbrechen und Ergebnis
  festhalten: Ersteller der Abstimmung.
- Owner-Fallback: nur wenn der Ersteller deaktiviert/entfernt ist und der Owner selbst bestätigter
  Teilnehmer des Events ist.
- Admin/Owner ohne bestätigte Teilnahme: weder lesen noch verwalten.

## 5. Fristen und Erinnerungen

Jede Runde benötigt eine zukünftige Frist. Beim Erreichen der Frist wird eine noch offene Runde
idempotent geschlossen. Das passiert beim ersten nachfolgenden Zugriff und wird genau einmal
protokolliert und per Realtime-Signal verteilt.

Bestätigte Teilnehmer mit noch unvollständiger Antwort werden automatisch erinnert:

- 48 Stunden vor Fristende,
- 2 Stunden vor Fristende,
- bei später Erstellung nur in der noch sinnvollen Stufe.

Der Ersteller kann zusätzlich „Erinnerung versenden (N)“ auslösen. Manuelle Erinnerungen haben eine
Mindestpause von 24 Stunden je Person und Runde; sie unterdrücken die beiden festen automatischen
Zeitpunkte nicht. Bereits vollständig abgestimmte oder nicht mehr bestätigte Personen werden
übersprungen. Jede Person und Abstimmung besitzt einen stabilen Mitteilungseintrag: Eine weitere
Erinnerung aktualisiert dessen Zeitpunkt und schiebt ihn nach oben, statt einen Duplikateintrag zu
erzeugen.

## 6. Oberfläche und Design

Der Bereich verwendet ausschließlich die vorhandenen Designbausteine und Tokens:

- `.card` für je eine Abstimmung,
- kompakte verschachtelte Zeilen für Optionen und `.tournament-section-panel` nur für den
  Ergebnisbereich,
- `.selection-toolbar` für Bewertungen beziehungsweise eine Auswahl,
- `.collapsible-section` für Personenlisten, weitere Aktionen und Historie,
- `dateTimeFieldHtml(..., { dateOnly: true })` für Fristen,
- existierende Badges, Buttons, Abstände, Radien und semantische Farben.

### 6.1 Übersicht

- Kein eigener Seiten- oder Untertitel unterhalb der Orga-Tabs; das aktive Event ist bereits im
  Umschalter oben rechts sichtbar.
- Die kompakte Aktion „Abstimmung starten“ steht rechts oberhalb der Liste und trägt kein Pluszeichen.
- Jede Abstimmung ist eine einklappbare Karte mit Titel, Ersteller, aktueller Rundennummer, Status und
  Antwortfortschritt bereits im eingeklappten Kopf.
- „Erinnerung versenden (N)“, „Beenden“ und „Abbrechen“ bleiben für den
  Ersteller ebenfalls im Kopf erreichbar, auch wenn die Karte eingeklappt ist.
- Beim ersten Laden wird eine laufende Abstimmung geöffnet; weitere Karten bleiben eingeklappt.
- In der Karte stehen aktuelle Runde und Optionen zuerst. Frühere Runden liegen in einer eigenen,
  zunächst eingeklappten „Frühere Runden (N)“-Sektion.
- Auf Mobilgeräten werden Kopf, Fortschritt und Aktionsleisten untereinander angeordnet, ohne
  horizontalen Überlauf.

### 6.2 Optionen und Antworten

Optionen sind kompakte, stabile Zeilen. Jede Option zeigt:

- Bezeichnung,
- Ergebnis-/Empfehlungsbadge, falls zutreffend,
- verständliche Zählwerte,
- die passenden kompakten Antwortbuttons in derselben Inhaltszeile,
- optional eine kurze Notiz und einen direkt aufrufbaren Link,
- eine gemeinsame einklappbare Namensliste der abgegebenen Antworten.

Das Speichern erfolgt bewusst gesammelt über die kompakte Aktion „Speichern“. So werden nie unbemerkte
Teilantworten erzeugt.

### 6.3 Erstell-Dialog

Der Dialog enthält in dieser Reihenfolge:

1. Titel,
2. optionale Beschreibung,
3. ein normales Auswahlfeld mit vier Antwortarten und einem angrenzenden Info-Popover,
4. bei Mehrfachauswahl optional „Stimmen pro Person“,
5. strukturierte, einzeln entfernbare Freitext-Optionszeilen mit optional einklappbarer kurzer Notiz
   und Link sowie „+ Option hinzufügen“,
6. themenkonforme Datumsauswahl für die Frist; die Erinnerungserklärung sitzt ausschließlich im
   angrenzenden Info-Popover,
7. die volle Primäraktion „Abstimmung starten“.

Ein Themen-Dropdown, Datumssyntax in einem Freitextfeld und eine lange Teilnehmer-Checkboxliste gibt
es nicht. Beim Schließen warnt der Dialog nur, wenn tatsächlich Eingaben geändert wurden.

### 6.4 Verständliche Verwaltungsaktionen

- **Erinnerung versenden (N)**: sendet jetzt eine Erinnerung an noch nicht fertige, nicht im
  Cooldown befindliche Teilnehmer.
- **Abstimmung beenden**: stoppt weitere Antworten; ein Bestätigungsdialog erklärt Wiederöffnung und
  Ergebnisworkflow.
- **Ergebnis festhalten**: speichert ausgewählte Ergebnisoptionen nur in der Historie.
- **Wieder öffnen**: verlangt eine neue zukünftige Frist.
- **Abstimmung abbrechen**: ist direkt im Kartenkopf erreichbar und bleibt als destruktive Aktion in
  der Historie nachvollziehbar.
- **Neue Runde starten**: erscheint nach Abschluss oder Abbruch für den Abstimmungsersteller.

## 7. Trennung vom Event

Die generische `/polls`-API besitzt keine „schedule“-/„apply“-Route. Insbesondere verändern weder
eine Zeitraumoption noch ein dokumentiertes Ergebnis:

- `events.starts_at` oder `events.ends_at`,
- `events.location`, Preise oder Beschreibung,
- `events.schedule_revision`,
- `event_participants.status` oder die Bestätigungsrevision.

Werden Eventdaten im Event-Bereich direkt geändert, bleibt eine bestehende Zusage gültig. Betroffene
Teilnehmer werden über die Änderung informiert; sie müssen wegen Ort, Termin, Dauer oder Preis nicht
erneut zusagen.

## 8. Datenmodell und Migration

Die vorhandenen Tabellen aus PR #482 werden weiterverwendet:

- `event_date_polls` als gespeicherte Runde,
- `event_date_poll_options`,
- `event_date_poll_invitees` für Roster-Snapshot und Erinnerungszustand,
- `event_date_poll_responses`,
- `event_poll_selected_options`.

Die historischen Tabellennamen bleiben eine interne Implementierungsentscheidung. Ergänzungen:

- `decision_key` gruppiert Runden einer Abstimmung,
- Eindeutigkeit `(event_id, decision_key, round_number)`,
- `response_mode`,
- `max_selections`,
- `decision_note` und mehrere Ergebnisoptionen.
- Antwortmodus `rating_1_5` und Antwortwerte `1` bis `5` über Migration 86.
- Optionsnotiz und Link verwenden die bereits vorhandenen Felder `description` und `payload_json`.

Eine zwischenzeitlich auf dem Feature-Branch eingeführte Teilnahmeform `interested` wird migriert:
entsprechende Entwicklungszeilen werden wieder zu `invited`; der etablierte Constraint lautet erneut
`invited | accepted | declined`.

## 9. API-Grundsätze

Basis: `/api/events/:eventId/polls`

- `GET /`: Runden des aktiven, bestätigten Teilnehmerkontexts.
- `POST /`: neue Abstimmung oder Folgerunde; der Server bestimmt den Teilnehmerkreis.
- `GET /:pollId`: Detail und eigene Antwort.
- `PUT /:pollId/my-responses`: vollständige Antwort atomar speichern.
- `PATCH /:pollId`: Beschreibung/Frist einer offenen Runde.
- `POST /:pollId/reminders`: offene Antworten erinnern.
- `POST /:pollId/close`: Abstimmung beenden.
- `POST /:pollId/reopen`: mit neuer Frist wieder öffnen.
- `POST /:pollId/cancel`: Abstimmung abbrechen.
- `POST /:pollId/decide`: Ergebnis einer geschlossenen Runde festhalten.

`inviteePlayerIds` wird bei der generischen Erstellung nicht akzeptiert. Eine Ergebnisantwort liefert
das Event höchstens als unveränderte Vergleichsdarstellung zurück.

## 10. Abnahmekriterien

- Der Tab liegt unter Orga und verwendet ausschließlich das oben rechts aktive Event.
- „Allgemein“ zeigt eine verständliche Leerseite; es gibt keine zweite Eventauswahl.
- Nur bestätigte Teilnehmer sehen den Bereich; Adminrechte allein reichen nicht.
- Jeder bestätigte Teilnehmer kann eine Abstimmung erstellen.
- Der Dialog ist auf Mobil- und Desktopbreite übersichtlich und folgt dem Designsystem.
- Freie Optionen mit optionaler Notiz/Link, alle vier Antwortmodi und ein optionales
  Mehrfachwahl-Limit funktionieren.
- Bei Bewertung stehen je Option **Passt / Wenn nötig / Passt nicht / Offen** bereit.
- Alternativ können alle Optionen unabhängig mit **1 bis 5** bewertet werden.
- Fristen schließen Runden, Erinnerungen beachten Antwortstatus, Teilnehmerstatus und Cooldown.
- Mehrere unabhängige Abstimmungen und mehrere Runden je Abstimmung haben korrekte Nummern und
  einklappbare Historien.
- Ergebnis, Abbruch und ältere Runden bleiben nachvollziehbar.
- Keine Poll-Aktion ändert Eventdaten oder Teilnahmestatus.
- Direkte Eventänderungen informieren Teilnehmer, ohne ihre Zusage zu invalidieren.
