# Konzept: Flexible Eventtypen und konfigurierbare Eventbereiche

Stand: 2026-08-23 · Status: **Konzept, nicht umgesetzt**

## 1. Kurzfassung und Produktentscheidung

Respawn soll sich von einer fest auf LAN-Partys zugeschnittenen Oberfläche zu einem privaten,
modularen Event-Arbeitsraum weiterentwickeln. Der vorhandene LAN-Funktionsumfang bleibt dabei
erhalten; andere Events zeigen nur die Bereiche, die für sie tatsächlich relevant sind.

Die zentralen Entscheidungen sind:

1. Beim Anlegen wird ein **Eventtyp** gewählt, zum Beispiel „LAN-Party“, „Gartenparty & Feier“,
   „Spieleabend“, „Wochenendtrip“, „Workshop & Treffen“ oder „Benutzerdefiniert“.
2. Der Eventtyp liefert eine **empfohlene Startkonfiguration**. Er ist keine dauerhafte Sperre und
   kein Berechtigungsmerkmal.
3. Vor dem Anlegen kann die Startkonfiguration unter „Bereiche anpassen“ verändert werden.
4. Das Event speichert eine eigene **Momentaufnahme der aktivierten Bereiche**. Spätere Änderungen
   an einer Produktvorlage verändern bestehende Events nicht stillschweigend.
5. Kernfunktionen wie Eventdetails, Einladungen, Teilnehmer, Benachrichtigungen, Berechtigungen und
   der Eventwechsel sind immer vorhanden. Nur fachliche Arbeitsbereiche sind optional.
6. Deaktivierte Bereiche verschwinden vollständig aus Navigation, Home, Suche, Kiosk,
   Benachrichtigungen und neuen Schreibaktionen. Bestehende Daten werden nie automatisch gelöscht.
7. Die Navigation richtet sich nach dem aktuell gewählten Event. Eine Gartenparty zeigt also weder
   „Match“ noch „Spiele“ noch Trackingkarten; eine LAN bleibt in der heutigen Struktur vertraut.
8. Der **Adminbereich steuert zentral**, welche Bereiche instanzweit verfügbar sind und welche
   Position sie je Eventtyp standardmäßig erhalten: Hauptnavigation oder „Mehr“. Die
   Eventerstellung wählt daraus nur die für das einzelne Event aktiven Bereiche.
9. Nicht nur ganze Seiten, sondern auch eingebettete Funktionen auf Home, Profil, Admin,
   Onboarding, Suche und Kiosk folgen derselben effektiven Bereichskonfiguration. Ein Sitzplan darf
   beispielsweise auf einer Feier erscheinen, ein Live-Status-Agent dagegen nur bei aktiviertem
   Tracking.
10. Die separat konzipierte Terminfindung bleibt ein eigener Planungsfluss am Event. Sie wird weder
   dupliziert noch als allgemeines Umfragetool in dieses Konzept aufgenommen.

Damit wird kein zweites Eventprodukt neben Respawn gebaut. Die vorhandenen Funktionen werden zu
einem fokussierten Baukasten zusammengeführt und nur um Lücken ergänzt, die mehrere neue
Eventtypen tatsächlich benötigen.

## 2. Ziel, Nicht-Ziele und Erfolgsmaßstab

### 2.1 Ziel

Eine organisierende Person soll in höchstens zwei kurzen Schritten ein passendes Event anlegen
können und danach einen Arbeitsraum erhalten, dessen Navigation, Startseite, nächste Schritte und
Benachrichtigungen zum Event passen.

Eine teilnehmende Person soll ohne Erklärung erkennen:

- worum es geht,
- wann und wo das Event stattfindet,
- ob und wie sie antworten muss,
- welche offenen Aufgaben oder Beiträge sie betreffen,
- welche Bereiche für dieses Event relevant sind.

### 2.2 Nicht-Ziele

Dieses Konzept macht Respawn nicht zu einer öffentlichen Ticket- oder Marketingplattform. Bewusst
nicht angestrebt werden zunächst:

- öffentlicher Event-Marktplatz und Reichweitenwerbung,
- Steuer-, Rechnungs-, Auszahlungs- und Erstattungslogik wie bei Ticketplattformen,
- Vendor-CRM, Verträge, Angebote und Venue-Vertrieb,
- Badge-Druck, Messemanagement und Enterprise-Check-in,
- frei programmierbare Formulare oder Workflows,
- mandantenfähige Organisationen mit komplexen Rollenmodellen,
- ein zweites allgemeines Umfragesystem neben der separat entwickelten Terminfindung.

### 2.3 Erfolgsmaßstab

Das Ziel ist erreicht, wenn:

- eine Gartenparty ohne Gaming-, Match-, Turnier-, Arcade- oder Trackingelemente nutzbar ist,
- eine LAN-Party den heutigen Funktionsumfang ohne zusätzliche Einrichtungsarbeit behält,
- eine benutzerdefinierte Auswahl jederzeit möglich ist,
- Eventtyp und Bereichsauswahl später gefahrlos angepasst werden können,
- ein Admin Verfügbarkeit und Navigationsort ohne Codeänderung zentral pflegen kann,
- deaktivierte Bereiche keine leeren Navigationseinträge oder irreführenden Hinweise hinterlassen,
- die Oberfläche auf Telefon und Laptop weiterhin schnell erfassbar bleibt.

## 3. Heutiger Ausgangspunkt

Respawn besitzt bereits einen großen Teil eines privaten Eventplaners. Der heutige Code deckt
unter anderem ab:

| Fähigkeit | Heutiger Stand | Einordnung im Zielbild |
|---|---|---|
| Eventname, Zeitraum, Ort/Kartenlink, Notiz | vorhanden | Kernfunktion |
| Persönlicher Event-Arbeitsraum und Eventwechsel | vorhanden | Kernfunktion |
| Einladungen, Zu-/Absage und Teilnehmerliste | vorhanden | Kernfunktion |
| Beitrag pro Person, Unterkunftskosten, Zahlungsziel und PayPal-Handoff | vorhanden | optionaler Bereich „Kosten“ |
| Tracking starten/stoppen, Live-Status und Spielzeit | vorhanden | optionales LAN-Modul |
| Packliste und To-Dos | vorhanden | optionale Planungsbereiche |
| An-/Abreise und Fahrgemeinschaften | vorhanden | optionaler Logistikbereich |
| Sammelbestellungen | vorhanden | optionaler Bereich „Essen“ |
| Spielekatalog, Bock-/Skill-Werte und Spiele-Vote | vorhanden | optionale Gamingbereiche |
| Teams, Captain Draft, Matches und Turniere | vorhanden | optionaler Wettkampfbereich |
| Arcade, Jam/Musik und Kiosk | vorhanden | optionale Erlebnisbereiche |
| Sitzplan, Durchsagen, Infoboard und PDF-Andenken | vorhanden | teils Kern, teils optional |
| Home mit Live-Status, Rangliste und Sitzplan | fest kombiniert | muss in bereichsabhängige Home-Bausteine zerlegt werden |
| Profil mit Agent, Monitoren und Statistik | fest kombiniert | Identität bleibt Kern; LAN-spezifische Abschnitte werden optional |
| Admin mit LAN-Bereitschaft, Agent-Diagnose und festen Werkzeugen | fest kombiniert | wird zum dynamischen Event-Cockpit plus zentraler Bereichssteuerung |
| Dynamische Bereiche pro Event | nicht vorhanden | zentrale strukturelle Lücke |
| Ablauf/Agenda und Programmpunkte | nicht vorhanden | hohe eventübergreifende Lücke |
| Individuelle RSVP-Fragen | nicht vorhanden | hohe eventübergreifende Lücke |
| Kapazität, Warteliste und Plus-1 | nicht vorhanden | relevante Einladungslücke |
| Helfer-, Schicht- oder Mitbring-Slots mit Menge | nur teilweise über To-Dos/Packliste | relevante Planungslücke |
| Kalenderdatei/-übergabe | nicht vorhanden | kleine, häufig nützliche Lücke |
| Tatsächlicher Check-in/Anwesenheit | nicht vorhanden | spätere Vor-Ort-Erweiterung |
| Gemeinsames Budget mit Ausgaben | nur feste Kosten und Zahlstatus | spätere Finanz-Erweiterung |

Die feste Informationsarchitektur ist derzeit an einer LAN ausgerichtet: Home, Match, Vote,
Essen, Spiele und Mehr bilden die Hauptnavigation; weitere Funktionen liegen in Bereichen wie
Orga, Auswertung und Arcade. Das neue Modell soll diese Struktur nicht verwerfen, sondern sie je
Event filtern und sinnvoll neu zusammensetzen.

Relevante technische Ausgangspunkte für eine spätere Umsetzung sind insbesondere:

- `server/public/index.html`: feste Hauptnavigation,
- `server/public/js/sectionNav.js`: feste Bereichs- und Tabzuordnung,
- `server/public/js/views/home.js`: fest eingebettete Live-, Ranglisten- und Sitzplanabschnitte,
- `server/public/js/views/profile.js`: fest eingebettete Agent-, Tracking-, Monitor- und
  Statistikabschnitte,
- `server/public/js/views/admin.js`: fest eingebettete LAN-Bereitschaft, Agent-Diagnose und
  Werkzeugliste,
- `server/public/js/views/more.js`, `searchPalette.js`, `onboarding.js` und `aktuellStatus.js`:
  weitere heute statische oder LAN-bezogene Einstiegspunkte,
- `server/public/js/viewManifest.js`: vollständiges View-Register,
- `server/public/js/views/events.js`: heutiger Event-Anlege- und Bearbeitungsfluss,
- `server/src/routes/events.ts` und `server/src/events.ts`: Eventvertrag und Lebenszyklus,
- `server/src/db.ts`: Event-, Teilnahme-, Zahlungs- und Event-Scope-Daten.

## 4. Erkenntnisse aus anderen Werkzeugen

Der Vergleich dient nicht dazu, möglichst viele Funktionen zu kopieren. Entscheidend ist, welche
Muster in Respawns privatem, kleinen und bereits gut vernetztem Nutzungskontext fehlen.

| Werkzeug | Relevantes Muster | Konsequenz für Respawn |
|---|---|---|
| Doodle | Terminoptionen, Gruppenabstimmung, Festlegen und Kalenderübergabe | Terminfindung bleibt das parallele Nachbarvorhaben; Kalenderübergabe ist anschließend sinnvoll. |
| Partiful | leichtgewichtige Einladung, RSVP-Fragen, Co-Hosts, Gastfreigabe, Plus-1, Privatsphäre, Erinnerungen und Fotoalbum | RSVP-Fragen und Mitorganisatoren sind wichtiger als ein öffentlicher Eventauftritt; Plus-1/Fotos sind spätere Optionen. |
| Spond | einmalige, wiederkehrende und saisonale Events, Treffzeit, Kapazität, Warteliste und eventbezogene Zahlung | Eventserie, separate Treffzeit und Warteliste sind für Sport, Ausflüge und Treffen relevant. |
| SignUpGenius | konkrete Rollen, Schichten oder Mitbringposten mit Kapazität, automatischen Erinnerungen und Warteliste | To-Dos und Packliste sollten später um verbindliche Slots/Mengen ergänzt werden, statt ein zweites Listenmodul zu bauen. |
| Eventbrite | Ticketarten, individuelle Registrierungsfragen, Kapazität, Check-in und zeitgebundener Eintritt | Fragen, Kapazität und einfacher Check-in sind übertragbar; Ticketverkauf und Marketing bleiben außerhalb des Zielbilds. |
| RSVPify | bedingte Fragen, Essens-/Allergieangaben, Teilveranstaltungen, Sitzordnung und Check-in | Bedürfnisse pro Person und optionale Programmpunkte/Sub-Events sind wertvoll; komplexe Formdesigner sind nicht nötig. |
| Planning Pod | Agenda/Timelines, Aufgaben, Budgets, Dateien, Anbieter und Vorlagen | Ablauf, schlankes Ausgabenbuch und Wiederverwendung sind sinnvoll; Anbieter-CRM wäre überdimensioniert. |

### 4.1 Wichtigste Produktlücken

Aus dem Vergleich entstehen fünf prioritäre Lücken:

1. **Teilnehmerbedürfnisse:** Essenswünsche, Allergien, Barrierefreiheit, Übernachtung,
   Fahrbedarf oder frei definierte kurze Fragen fehlen heute.
2. **Ablauf:** Ein Event kann einen Termin haben, aber noch keinen strukturierten Tagesplan mit
   Treffzeit, Programmpunkten, Orten und Verantwortlichen.
3. **Verbindliche Beiträge:** To-Dos und Packliste bilden nicht sauber ab, dass beispielsweise
   genau zwei Salate, drei Aufbauschichten oder ein Beamer benötigt werden.
4. **Kapazität und Gäste:** Obergrenze, Warteliste, Plus-1 und Gastfreigabe fehlen.
5. **Übergaben:** Kalenderexport, kopierbare Eventzusammenfassung und gezielte Erinnerungen fehlen
   als einfacher Abschluss des Einladungsflusses.

Diese Lücken werden priorisiert, aber nicht alle sind Voraussetzung für die erste Einführung von
Eventtypen. Die Modularisierung kann zunächst ausschließlich vorhandene Funktionen fokussieren.

## 5. Begriffe und Modell

### 5.1 Eventtyp

Ein Eventtyp beschreibt die Absicht des Events und liefert eine empfohlene Konfiguration. Beispiele
sind `lan`, `celebration`, `game-night`, `trip`, `workshop` und `custom`.

Der Typ bestimmt nicht:

- wer das Event sehen darf,
- ob ein Bereich serverseitig autorisiert ist,
- ob eine Funktion gerade läuft,
- welche Daten gelöscht werden,
- wie ein später umgestelltes Event automatisch auszusehen hat.

### 5.2 Bereich

„Bereich“ ist die sichtbare Produktsprache für eine zusammenhängende Eventfähigkeit. Ein Bereich
kann eine einzelne View sein oder mehrere bestehende Views gruppieren. Beispiele:

- „Aufgaben & Mitbringen“ bündelt To-Dos und Packliste,
- „Match & Turniere“ bündelt Teams, Matches und Turniere,
- „Tracking & Auswertung“ bündelt Agent-Tracking, Live-Status und eventbezogene Statistik.

### 5.3 Kernfunktion

Kernfunktionen können nicht deaktiviert werden:

- Home/Eventüberblick,
- Eventdetails und aktueller Zeitraum,
- Einladung, Zu-/Absage und Teilnehmer,
- persönliche Benachrichtigungen und Eventwechsel,
- Berechtigungsprüfung, Eventverwaltung und Sicherheit,
- Profil, globale Suche, Feedback und notwendige Adminfunktionen.

Kernfunktionen müssen nicht alle als eigener Navigationspunkt erscheinen. Teilnehmer und
Eventdetails können beispielsweise direkt vom Home-Cockpit erreichbar sein.

### 5.4 Bereichszustände

Drei Zustände dürfen nicht miteinander vermischt werden:

| Zustand | Bedeutung | Beispiel |
|---|---|---|
| aktiviert | Der Bereich gehört zum Event und ist sichtbar. | „Essen“ ist für die Gartenparty aktiviert. |
| eingerichtet | Alle nötigen Angaben sind vorhanden. | Ein Zahlungsbetrag ist gesetzt. |
| läuft | Eine zeitlich begrenzte Aktion ist aktiv. | Tracking läuft oder eine Abstimmung ist offen. |

Das Aktivieren von „Tracking & Auswertung“ startet deshalb niemals automatisch Tracking. Das
Aktivieren von „Vote“ eröffnet keine Abstimmung.

### 5.5 Vier Steuerungsebenen

Damit „zentral gesteuert“ und „pro Event individuell“ nicht in Konflikt geraten, wird die
wirksame Oberfläche aus vier Ebenen gebildet:

1. **Produktkatalog:** Der Code kennt verfügbare Bereiche, Abhängigkeiten und die Oberflächen, auf
   denen ein Bereich Inhalte beisteuern kann.
2. **Adminrichtlinie:** Ein Instanzadmin gibt Bereiche grundsätzlich frei oder sperrt sie und legt
   je Eventtyp deren Standardaktivierung, Navigationsort und Reihenfolge fest.
3. **Eventkonfiguration:** Ersteller oder Mitorganisator aktivieren für ein einzelnes Event nur
   Bereiche, die der Admin freigegeben hat. Diese Auswahl bleibt eine Eventmomentaufnahme.
4. **Rolle und Zustand:** Innerhalb eines aktiven Bereichs entscheiden Berechtigung und Zustand,
   ob eine konkrete Aktion sichtbar oder erlaubt ist. Ein Adminwerkzeug bleibt beispielsweise
   admin-only; ein Tracking-Start bleibt bis zu einem festen Termin gesperrt.

Kurzform:

`sichtbar = im Produkt vorhanden ∧ vom Admin freigegeben ∧ im Event aktiviert ∧ für Rolle erlaubt`

Die **Position** eines sichtbaren Bereichs kommt dagegen aus der Adminrichtlinie. Eventersteller
können in der ersten Ausbaustufe Bereiche an- oder abwählen, aber nicht für alle Teilnehmer
beliebig umsortieren.

Die Adminrichtlinie unterscheidet drei Änderungen mit bewusst verschiedener Wirkung:

| Adminänderung | Wirkung |
|---|---|
| Standardaktivierung eines Eventtyps ändern | gilt nur als Empfehlung für neu angelegte Events; bestehende Eventmomentaufnahmen bleiben gleich |
| Hauptnavigation/„Mehr“ oder Reihenfolge ändern | gilt sofort für bestehende Events dieses Typs; verändert keine Fachdaten |
| Bereich instanzweit sperren | nimmt ihn nach Sicherheitsprüfung aus allen Events; Daten und bisherige Eventauswahl bleiben erhalten und werden bei erneuter Freigabe wieder wirksam |

Eine instanzweite Sperre ist damit ein bewusster administrativer Eingriff und kein schneller
Layoutschalter. Laufende Vorgänge müssen wie beim Deaktivieren eines Eventbereichs zuerst beendet
werden.

## 6. Vorgeschlagene Eventtypen

Die Vorauswahl bleibt bewusst klein. Zu viele spezialisierte Typen machen den ersten Schritt
langsamer und erzeugen scheinbare Produktversprechen, die Respawn noch nicht erfüllt.

### 6.1 LAN-Party

Ziel: heutiger Standard ohne Funktionsverlust.

Empfohlen aktiv:

- Aufgaben & Mitbringen,
- An- & Abreise,
- Essen,
- Kosten,
- Musik,
- Spiele & Spiele-Vote,
- Match & Turniere,
- Arcade,
- Sitzplan,
- Tracking & Auswertung,
- Kiosk.

### 6.2 Gartenparty & Feier

Ziel: Geburtstag, Grillabend, Gartenparty oder private Feier.

Empfohlen aktiv:

- Aufgaben & Mitbringen,
- Essen,
- Kosten,
- Musik,
- optional An- & Abreise.

Später besonders wertvoll:

- RSVP-Fragen zu Essen/Allergien,
- Mitbringposten mit benötigter Menge,
- Plus-1 und Kapazität,
- optional Tisch-/Sitzordnung für gesetztes Essen oder größere Feier,
- Schlechtwetter-/Alternativplan,
- Fotos.

Gaming, Match, Turniere, Arcade, Sitz-/Tischplan und Tracking sind standardmäßig aus.

### 6.3 Spieleabend

Ziel: Brettspiel-, Konsolen- oder kleiner PC-Spieleabend ohne LAN-Vollprogramm.

Empfohlen aktiv:

- Essen,
- Musik,
- Spiele & Spiele-Vote,
- optional Teams/Matches.

Tracking, Turnier, Arcade, Sitzplan, Kiosk und vollständige LAN-Logistik bleiben zunächst aus.

### 6.4 Wochenendtrip & Ausflug

Ziel: gemeinsames Wochenende, Hütte, Tagesausflug oder Gruppenreise.

Empfohlen aktiv:

- Ablauf,
- Aufgaben & Mitbringen,
- An- & Abreise,
- Essen,
- Kosten.

Später besonders wertvoll:

- Zimmer-/Schlafplatzbedarf,
- Buchungs- und Dokumentlinks,
- gemeinsames Ausgabenbuch,
- wetterabhängige Alternativen.

### 6.5 Workshop & Treffen

Ziel: Workshop, Vereinstreffen, Planungstag oder kleiner Community-Termin.

Empfohlen aktiv:

- Ablauf,
- Aufgaben,
- Kosten nur bei Bedarf.

Später besonders wertvoll:

- Material-/Technikbedarf,
- Sessions und Verantwortliche,
- RSVP-Fragen,
- einfacher Check-in,
- Ergebnis-/Dateiablage.

### 6.6 Benutzerdefiniert

Ziel: minimale Ausgangsbasis ohne Annahmen.

Aktiv sind nur die Kernfunktionen. Die organisierende Person wählt alle weiteren Bereiche selbst.

### 6.7 Preset-Matrix

Legende: **●** standardmäßig aktiv, **○** als sinnvolle Ergänzung angeboten, **–** standardmäßig
aus. Kernfunktionen sind nicht Teil der Matrix, da sie immer vorhanden sind.

| Bereich | LAN | Gartenparty | Spieleabend | Trip | Workshop | Benutzerdefiniert |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| Ablauf | ○ | ○ | ○ | ● | ● | – |
| Aufgaben & Mitbringen | ● | ● | ○ | ● | ● | – |
| An- & Abreise | ● | ○ | – | ● | ○ | – |
| Essen | ● | ● | ● | ● | ○ | – |
| Kosten | ● | ● | ○ | ● | ○ | – |
| Musik | ● | ● | ● | ○ | – | – |
| Spiele & Spiele-Vote | ● | – | ● | ○ | – | – |
| Match & Turniere | ● | – | ○ | – | – | – |
| Arcade | ● | – | ○ | – | – | – |
| Sitz-/Tischplan | ● | ○ | – | ○ | ○ | – |
| Tracking & Auswertung | ● | – | – | – | – | – |
| Kiosk | ● | – | – | – | ○ | – |

Die Matrix ist eine Produktempfehlung, keine harte Regel. Eine Gartenparty mit Arcade oder ein
Workshop mit Musik bleibt möglich.

## 7. Bereichskatalog

### 7.1 Bereiche der ersten Ausbaustufe

Diese Ausbaustufe nutzt fast ausschließlich vorhandene Funktionen.

| Bereich | Enthaltene Funktionen | Abhängigkeit/Regel |
|---|---|---|
| Aufgaben & Mitbringen | To-Dos, Mitbring-Anfragen, persönliche Packliste | keine harte Abhängigkeit |
| An- & Abreise | Ankunft, Abfahrt, Fahrgemeinschaften | Teilnehmer erforderlich |
| Essen | Sammelbestellungen und Zahlungsstatus je Bestellung | keine harte Abhängigkeit |
| Kosten | Beitrag, Unterkunftssumme, Zahlungsziel, PayPal, Abrechnung | nur sichtbar, wenn aktiviert; Aktivierung verlangt noch keinen Betrag |
| Musik | Jam und gemeinsamer Wiedergabekontext | Controller nur bei tatsächlicher Nutzung nötig |
| Spiele & Spiele-Vote | Spielekatalog, Bock/Skill, spielbezogene Abstimmung | Katalog bleibt gruppenweit; seine Eventnavigation ist optional |
| Match & Turniere | Teams, Draft, Matches und Turniere | aktiviert „Spiele“ als harte Abhängigkeit mit |
| Arcade | Lobbys, Spiele und eventbezogene Ergebnisse | unabhängig von Desktop-Tracking |
| Sitz-/Tischplan | Tisch-, Raum-, Zimmer- oder Platzzuordnung; LAN optional mit Arbeitsplätzen | Teilnehmer erforderlich; Monitorbeziehungen nur im LAN-/Arbeitsplatzmodus |
| Tracking & Auswertung | Agent-Tracking, Live-Status, Spielzeit, Ranglisten und Auswertung | fester Zeitraum, Einwilligung und Agent nötig; Start bleibt separate Aktion |
| Kiosk | read-only Eventanzeige | Adminzugang und eventgebundener Token; Inhalt richtet sich nach aktivierten Bereichen |

„Durchsagen“ und allgemeine Eventinformationen werden nicht als abwählbarer Bereich behandelt.
Sie sind Teil der Kernkommunikation, erscheinen aber nur dann prominent, wenn es aktuelle Inhalte
gibt.

### 7.2 Neue universelle Bereiche

Diese Bereiche schließen die wichtigsten Lücken, sind aber nicht Voraussetzung für das erste
Release der Eventtypen.

#### Ablauf

Ein einfacher, chronologischer Plan mit:

- Beginn und optionalem Ende,
- Titel,
- Ort oder Treffpunkt,
- optional verantwortlicher Person,
- kurzer Notiz,
- Kennzeichnung „läuft“, „als Nächstes“ und „vorbei“.

Kein Kalender- oder Projektmanagementsystem. Verschieben und Bearbeiten reichen aus. Ein
Programmpunkt darf später als begrenzter Slot oder Teilveranstaltung erweitert werden.

#### Teilnahmefragen

Kurze, typisierte Fragen im Einladungsfluss:

- eine Auswahl,
- mehrere Auswahlen,
- Ja/Nein,
- kurzer Freitext.

Typische Vorlagen sind Essenswunsch, Allergien, Übernachtung, Fahrbedarf und Barrierefreiheit.
Antworten sind standardmäßig nur für Organisierende sichtbar. Sensible Angaben erhalten eine
explizite Zweckangabe und werden nicht in Exporte oder Teilnehmerlisten übernommen, wenn dies
nicht erforderlich ist.

#### Beiträge & Slots

Eine Weiterentwicklung der bestehenden Mitbring-Anfrage statt eines neuen parallelen Tools:

- „2 Salate“, „1 Beamer“, „3 Personen Aufbau 16–17 Uhr“,
- Anzahl benötigter und belegter Plätze,
- optionaler Zeitraum,
- Selbstübernahme oder Zuweisung,
- Warteliste nur bei echten Personen-Slots,
- Erinnerung an eigene Zusagen.

Persönliche Packlisten bleiben davon getrennt: „Ich muss mein Ladekabel einpacken“ ist kein
gemeinsamer Beitrag.

#### Kapazität & Warteliste

Optionales Maximum für angenommene Teilnahmen. Nach Erreichen der Grenze werden weitere Zusagen
auf eine Warteliste gesetzt. Frei werdende Plätze werden nicht zwingend automatisch vergeben; für
private Gruppen ist eine bewusste Freigabe durch Organisierende zunächst nachvollziehbarer.

#### Kalender & Teilen

Nach feststehendem Termin:

- `.ics`-Download beziehungsweise native Kalenderübergabe,
- kopierbare Kurzfassung mit Name, Zeitraum, Ort und Link,
- Aktualisierungshinweis bei Termin- oder Ortsänderung,
- Absagehinweis mit eindeutiger Eventreferenz.

### 7.3 Spätere Bereiche

- **Check-in:** einfache Liste oder QR-Code, tatsächliche Ankunft und No-Show-Status.
- **Budget & Ausgaben:** geplante Kosten, Ausgaben, zahlende Person, Beleglink und Ausgleich; keine
  Buchhaltungssoftware.
- **Dateien & Fotos:** eventgebundene Links/Anhänge, nach dem Event optionales Album.
- **Teilprogramme/Sub-Events:** zum Beispiel Freitagabend, Workshop-Slot oder Turnierfinale mit
  eigener Kapazität und Einladung innerhalb desselben Events.
- **Eventserie:** wiederkehrende Treffen mit gemeinsamer Vorlage, aber getrennten Teilnahmen,
  Zahlungen und Ergebnissen pro Termin.

## 8. Regeln für Abhängigkeiten und Bereichsänderungen

### 8.1 Harte und weiche Abhängigkeiten

- „Match & Turniere“ benötigt „Spiele“. Beim Aktivieren wird „Spiele“ sichtbar mitaktiviert.
- Der heutige Spiele-Vote gehört zu „Spiele“; ein späteres allgemeines Umfragemodul ist davon
  fachlich getrennt.
- „Tracking & Auswertung“ setzt Teilnehmer, feststehenden Zeitraum, Einwilligung und Agent voraus,
  darf aber bereits vorher konfiguriert werden.
- „Sitzplan“, „An- & Abreise“ und Check-in benötigen Teilnehmerdaten, aber keinen eigenen
  Teilnehmerbereich in der Navigation.
- „Sitzplan“ ist **nicht** grundsätzlich LAN-spezifisch. Er kann bei Feier, Workshop oder Dinner
  als Tisch-, Raum- oder Platzzuordnung dienen. Die heutige Funktion „Sichtbare Monitore“ ist
  dagegen eine LAN-Unterfunktion und setzt zusätzlich den Arbeitsplatz-/LAN-Modus voraus.
- „Kosten“ und „Essen“ sind unabhängig. Eventbeitrag und einzelne Sammelbestellungen dürfen nicht
  miteinander vermischt werden.

### 8.2 Deaktivieren ohne Datenverlust

Beim Deaktivieren gilt:

1. Ohne vorhandene Daten wird der Bereich unmittelbar verborgen.
2. Mit vorhandenen offenen Vorgängen nennt ein Bestätigungsdialog konkret die Folgen, etwa eine
   offene Abstimmung, ein laufendes Turnier oder aktives Tracking.
3. Laufende Vorgänge müssen zuerst sauber beendet oder abgebrochen werden.
4. Historische Daten bleiben erhalten und werden nicht kaskadierend gelöscht.
5. Reaktivieren stellt die Daten und bisherigen Einstellungen wieder her.
6. Ein endgültiges Löschen fachlicher Daten ist eine separate, ausdrücklich destruktive
   Adminaktion und nicht Teil des Bereichsschalters.

### 8.3 Eventtyp nachträglich ändern

Ein Typwechsel öffnet eine Vergleichsansicht:

- „Durch neue Vorlage empfohlen“,
- „bereits aktiv“,
- „würde entfallen“.

Nichts wird automatisch abgeschaltet. Der Typ kann geändert werden, während die bestehende
Bereichsmomentaufnahme unverändert bleibt, oder die organisierende Person übernimmt einzelne
Empfehlungen bewusst. Vor dem Speichern zeigt die Vorschau zusätzlich, wie die vom Admin für den
neuen Typ festgelegte Hauptnavigation aussehen wird; diese Positionsänderung folgt dem neuen Typ,
auch wenn die aktive Bereichsauswahl unverändert bleibt.

## 9. Informationsarchitektur und Navigation

### 9.1 Grundregel

Der aktive Eventkontext bleibt die zentrale Arbeitsraumgrenze. Die Navigation wird aus den für
dieses Event aktivierten Bereichen abgeleitet und anschließend mit der zentralen Adminrichtlinie
geschnitten. Ein Eintrag kann daher nicht allein deshalb erscheinen, weil eine View technisch
existiert oder historische Daten vorhanden sind.

### 9.2 Admin: „Bereiche & Navigation“

Die Steuerung erhält im Adminbereich einen eigenen, immer verfügbaren Einstieg. Sie soll keine
technische Feature-Flag-Tabelle sein, sondern eine verständliche Vorschau der späteren App.

Der empfohlene Aufbau:

1. **Instanzweite Freigabe:** Liste aller Produktbereiche mit „Verfügbar“ oder „Gesperrt“.
   Kernfunktionen stehen sichtbar auf „Immer verfügbar“ und können nicht abgeschaltet werden.
2. **Navigation je Eventtyp:** Auswahl von LAN, Gartenparty, Spieleabend, Trip, Workshop oder
   Benutzerdefiniert. Pro Bereich legt der Admin „Hauptnavigation“ oder „Mehr“ und eine stabile
   Reihenfolge fest.
3. **Standardbereiche je Eventtyp:** Im selben Kontext markiert der Admin, welche freigegebenen
   Bereiche bei neuen Events empfohlen aktiv sind. Das überschreibt keine bestehenden Events.
4. **Live-Vorschau:** Telefonvorschau mit Home, bis zu vier Bereichen und Mehr sowie einer Liste
   der Ziele unter Mehr. Desktop und Rollenfilter brauchen keine eigene Konfiguration.
5. **Auswirkungsprüfung:** Vor einer instanzweiten Sperre nennt die Oberfläche betroffene Events,
   laufende Vorgänge und offene Aktionen. Eine reine Positionsänderung kann direkt gespeichert
   werden.

„Generell im Admin steuern“ bedeutet damit **zentral verwaltet**, aber nicht zwangsläufig „für
jeden Eventtyp identisch“. Eine einzige globale Reihenfolge wäre zu grob: Für eine LAN sind Match
und Spiele primär, für einen Trip dagegen Ablauf und Anreise. Die Administration bleibt trotzdem
an einer Stelle; der gewählte Eventtyp ist lediglich der Konfigurationskontext.

Für die erste Ausbaustufe gelten folgende Grenzen:

- Home und Mehr sind fest und nicht verschiebbar.
- Pro Eventtyp können höchstens vier Bereiche als Hauptnavigation markiert werden. Der Adminscreen
  verhindert einen ungültigen fünften Eintrag und zeigt den Engpass direkt in der Vorschau.
- Ein als „Mehr“ konfigurierter Bereich rückt nicht automatisch nach oben, nur weil andere
  Hauptbereiche im konkreten Event deaktiviert sind. Dadurch bleibt „Mehr“ eine verlässliche
  Entscheidung und die Navigation darf bewusst kürzer sein.
- Eventersteller wählen nur Aktivität, nicht Platzierung. Eine abweichende Position für ein
  einzelnes Event ist zunächst nicht vorgesehen.
- Rollenfilter wirken nach der Platzierung: Adminziele erscheinen normalen Teilnehmern weiterhin
  nicht.

### 9.3 Telefon-Navigation

Die feste Obergrenze von sechs Zielen bleibt erhalten:

1. **Home** ist immer das erste Ziel.
2. Bis zu vier aktive, vom Admin für den Eventtyp als primär festgelegte Bereiche folgen in der
   administrierten Reihenfolge.
3. **Mehr** ist immer das letzte Ziel und enthält die übrigen aktivierten Bereiche sowie Profil und
   berechtigte Adminfunktionen.

Beispiele:

| Event | Hauptnavigation |
|---|---|
| LAN-Party | Home · Match · Vote · Essen · Spiele · Mehr |
| Gartenparty | Home · Orga · Essen · Musik · Mehr |
| Wochenendtrip | Home · Ablauf · Orga · Kosten · Mehr |
| Workshop | Home · Ablauf · Orga · Mehr |

Das sind auslieferungsseitige Startwerte. Ein Admin kann sie zentral anpassen; alle Personen sehen
innerhalb desselben Eventtyps dieselbe Platzierung.

### 9.4 Bereiche mit Tabs

Nur aktivierte Tabs werden angezeigt. Besitzt ein Bereich danach nur noch einen Tab, entfällt die
Tabzeile vollständig. Beispiele:

- Orga zeigt nur Aufgaben, Packliste und/oder An-/Abreise, die tatsächlich aktiviert sind.
- Match erscheint nur, wenn Teams oder Turniere aktiv sind.
- Auswertung erscheint nur bei Tracking/Auswertung und bleibt rollenabhängig.

### 9.5 Home als Event-Cockpit

Home zeigt keine leeren Standardkarten, sondern relevante Zustände in vier Prioritätsstufen:

1. **Du musst handeln:** Einladung beantworten, Terminoptionen bewerten, Zahlungsziel,
   überfällige Aufgabe, Teilnahmefrage.
2. **Als Nächstes:** nächster Programmpunkt, Treffzeit, Bestellschluss, offene Mitbringposten.
3. **Gerade aktiv:** laufendes Tracking, Turnier, Vote, Arcade-Lobby oder Musik – ausschließlich
   wenn der jeweilige Bereich aktiviert ist.
4. **Eventüberblick:** Zeitraum, Ort, Teilnehmer, wichtige Nachricht.

Eine deaktivierte Funktion erzeugt weder eine Homekarte noch einen leeren Zustand.

Die heutige Home-Seite muss dafür in unabhängige Beiträge zerlegt werden:

| Home-Baustein | Wann sichtbar? | Zielbild |
|---|---|---|
| Eventüberblick mit Termin, Ort, Status und Teilnehmerzahl | immer | neutraler Kern statt LAN-Begriffen wie „Spieler“ |
| „Du musst handeln“ und „Als Nächstes“ | Container nur bei Inhalt | sammelt ausschließlich Aktionen aktiver Bereiche |
| Teilnehmer/Gäste | immer erreichbar; kompakte Home-Vorschau, wenn Platz | statische Teilnahme darf nicht vom Agent-Live-Status abhängen |
| Live-Status, „Dein Status“, aktive Spiele | nur Tracking & Auswertung | vollständig ausblenden, wenn kein Tracking vorgesehen ist |
| Ranglistenvorschau | nur Tracking/Auswertung oder Wettkampfergebnisse und passende Rolle | kein leerer Adminlink bei Feier oder Workshop |
| Sitz-/Tischplanvorschau | nur Sitzplan | für Feier und Workshop ebenso zulässig wie für LAN |
| nächster Ablaufpunkt | nur Ablauf | für Workshop, Trip und Feier hoher Home-Rang |
| offene Zusage/Teilnahmefragen | Einladung beziehungsweise Teilnahmefragen | persönlich und vor allgemeinen Hinweisen |
| Mitbring-, Helfer- und Aufgabenstatus | Aufgaben/Slots | nur persönliche oder zeitkritische Einträge zeigen |
| Essen, Zahlung, Vote, Turnier, Arcade, Musik | jeweiliger Bereich | bestehende „Aktuell“-Karten einzeln an den Bereich koppeln |
| Anreise, Check-in oder Kapazität | jeweiliger Bereich | nur Abweichungen und Handlungsbedarf, keine dauerhaften Leerstände |

Der zentrale Teilnehmerüberblick und der technische Live-Status werden ausdrücklich getrennt.
Heute ersetzt der Live-Status faktisch die Teilnehmerliste; das funktioniert ohne Tracking nicht.

### 9.6 Profil, Admin und weitere Querschnittsflächen

Bereiche bestehen nicht nur aus Navigationszielen. Jeder Bereich beschreibt, ob er Beiträge zu
Home, Profil, Admin, Suche, Kiosk, Onboarding und Benachrichtigungen liefert. Diese Zuordnung ist
Teil des Produktkatalogs und wird nicht als Sammlung dutzender unabhängiger Adminschalter
angeboten. So genügt beispielsweise „Tracking deaktiviert“, um Agent-Setup, Monitorlogik,
Statistikhinweise und LAN-Onboarding konsistent zu entfernen.

#### Profil

Das Profil bleibt kurz und trennt globale Kontodaten von eventbezogenen Angaben:

| Profilfunktion | Einordnung |
|---|---|
| Profilbild, Anzeigename/Name, Farbe, Passwort, Abmelden | immer sichtbar; globale Identität und Sicherheit |
| offene Eventeinladungen | immer, wenn vorhanden |
| Push-Grundaktivierung | immer; Themenkanäle nur für aktive Bereiche des gewählten Events |
| „Für dieses Event“ mit eigener Zusage, Antworten, Plus-1, Beitrag, Anreise, Slot oder Sitzplatz | nur die jeweils aktivierten Bereiche; sensible Antworten bleiben eventbezogen und werden nicht ungefragt als globale Präferenz gespeichert |
| Bock-/Skill-Hinweis | nur Spiele; niemals Pflicht-Onboarding bei Feier, Trip oder Workshop |
| Live-Status-Agent, Trackingpause, Aktivitätstracking, Download und API-Key | nur Tracking & Auswertung; technische Details optional unter „Erweitert“ |
| „Sichtbare Monitore“ | nur Sitzplan **und** LAN-/Arbeitsplatzmodus; nicht bei einem Tischplan für Dinner oder Workshop |
| „Meine Statistiken“ | nur bei persönlichen Ergebnissen aus Tracking, Match oder Arcade; bei leerer Historie kein leerer Link |
| Benachrichtigungseinstellungen pro Event | sobald mindestens ein optionaler Bereich Mitteilungen erzeugt |

Hat eine Person Zugriff auf ein anderes Tracking-Event, bleibt die Agentkonfiguration dort
erreichbar. Sie muss nicht im Profil einer aktuell gewählten Gartenparty sichtbar bleiben.

#### Admin

Der Adminbereich wird selbst modular:

| Adminfunktion | Einordnung |
|---|---|
| Bereiche & Navigation | immer; zentrale Instanz- und Eventtypsteuerung |
| Eventverwaltung, Konten/Rollen, Einladungslinks, Backup, Sicherheit, Feedback | immer |
| „Event-Bereitschaft“ | immer als Hülle, aber aus Prüfungen aktiver Bereiche zusammengesetzt; Bezeichnung nicht fest „LAN-Bereitschaft“ |
| Agent-Diagnose und Trackingbereitschaft | nur Tracking & Auswertung |
| Spiele-/Prozessdiagnose und spielbezogene Testdaten | nur Spiele beziehungsweise Tracking |
| Sitz-/Tischplan-Werkzeug | nur Sitzplan |
| Kioskverwaltung | nur Kiosk |
| Rangliste, Statistik und Hall of Fame | nur Tracking/Auswertung oder passende Wettkampfergebnisse |
| Zahlungs-/Abrechnungswerkzeuge | nur Kosten |
| Datenschutz-/Aufbewahrungsprüfung | sobald sensible Teilnahmefragen oder Check-in-Daten genutzt werden |
| Nutzungsauswertung | instanzweites Produktwerkzeug, unabhängig vom Eventtyp |

Zusätzlich ist eine Adminaktion „Als Teilnehmer ansehen“ sinnvoll. Sie zeigt die effektive
Navigation und Home ohne Adminziele und verhindert, dass eine scheinbar aufgeräumte
Administratorenansicht eine unpassende Teilnehmeroberfläche verdeckt.

#### Mehr, Suche, Onboarding, Info und Kiosk

- „Mehr“ enthält nur aktive, dort platzierte Bereiche sowie Profil und rollenberechtigte
  Adminziele. Es ist kein Ablageort für deaktivierte Funktionen.
- Suche indexiert nur aktive Bereiche und deren erlaubte Inhalte. Beschreibungstexte passen sich
  an; „Profil, Agent und Push“ darf ohne Tracking nicht weiter den Agent bewerben.
- Onboarding wird aus den aktiven Bereichen zusammengesetzt. Die heutige Pflichtbewertung von
  Bock/Skill entfällt vollständig, wenn Spiele deaktiviert sind.
- Eventinfo bleibt Kern, seine Inhalte werden aber neutral: WLAN, Discord, Gameserver und
  Monitorhinweise erscheinen nur, wenn sie für das Event gepflegt beziehungsweise relevant sind;
  Anfahrt, Barrierefreiheit, Parken oder Schlechtwetterplan funktionieren unabhängig davon.
- Der Kiosk rendert nur freigegebene Eventbausteine. Ein Feier-Kiosk kann Ablauf, Hinweise und
  Sitz-/Tischplan zeigen, ohne Rang, Vote oder Live-Tracking zu erwähnen.

### 9.7 Suche, Push und Deep Links

- Die globale Suche listet nur Ziele aktiver Bereiche.
- Ein Deep Link in einen deaktivierten Bereich führt zum Event-Home mit der knappen Erklärung
  „Dieser Bereich ist für das Event nicht aktiviert.“
- Serverzugriffe verlassen sich nicht auf die ausgeblendete Navigation, sondern prüfen den
  Bereichszustand und die Eventteilnahme selbst.
- Benachrichtigungen tragen Event und Bereich. Beim Öffnen werden Eventzugriff und Bereich erneut
  geprüft.
- Hintergrundjobs für Erinnerungen oder Tracking laufen nur für aktivierte Bereiche.

## 10. User Flows

### 10.1 Neues Event mit Empfehlung

1. Organisierende Person wählt „Event anlegen“.
2. Sie wählt unter „Was planst du?“ einen Eventtyp.
3. Sie gibt Name, Terminstrategie, Zeitraum, Ort und optionale Notiz ein.
4. Eine kompakte Zusammenfassung zeigt die vom Admin freigegebenen und für diesen Typ empfohlenen
   Bereiche.
5. Mit „Event anlegen“ wird die Empfehlung übernommen.
6. Home öffnet das neue Event und zeigt die nächsten sinnvollen Schritte: Termin klären,
   Teilnehmer einladen, Ort ergänzen oder relevante Bereiche einrichten.

Der schnelle Weg darf keine vollständige Funktionsmatrix erzwingen.

### 10.2 Bereiche individuell wählen

1. Im Anlegefluss aktiviert die Person „Bereiche anpassen“.
2. Bereiche erscheinen gruppiert unter Planen, Versorgung, Unterhaltung und Vor Ort.
3. Kernfunktionen sind sichtbar als „Immer dabei“, aber nicht als deaktivierbare Checkboxen.
4. Empfohlene Bereiche sind bereits gewählt und mit „Empfohlen“ gekennzeichnet.
5. Das Aktivieren einer harten Abhängigkeit erklärt und aktiviert diese sofort.
6. Eine kleine Navigationsvorschau zeigt, wie der Event-Arbeitsraum mit der administrierten
   Platzierung aussehen wird. Die Vorschau ist hier informativ, nicht umsortierbar.
7. Das Event wird mit dieser Momentaufnahme angelegt.

### 10.3 Bestehendes Event anpassen

1. Unter Eventdetails öffnet ein Organisator „Bereiche verwalten“.
2. Die Oberfläche zeigt aktiv, empfohlen und zusätzlich vom Admin verfügbar. Instanzweit
   gesperrte Bereiche werden nicht als scheinbar aktivierbare Option angeboten.
3. Das Ausschalten eines unbenutzten Bereichs wirkt direkt nach Bestätigung.
4. Bei vorhandenen Daten nennt die Oberfläche offene Vorgänge und verlangt deren Abschluss.
5. Nach dem Speichern aktualisieren sich Navigation, Suche, Home und offene Clients in Echtzeit.

### 10.4 Admin ändert Bereiche und Navigation

1. Admin öffnet „Bereiche & Navigation“ und wählt einen Eventtyp.
2. Die Vorschau zeigt dessen Standardbereiche, vier mögliche Hauptplätze und die Liste unter
   „Mehr“.
3. Admin ändert Standardaktivierung, Platzierung oder Reihenfolge.
4. Die Oberfläche unterscheidet klar: „gilt für neue Events“ bei Empfehlungen und „ändert die
   Navigation bestehender Events“ bei Platzierung.
5. Speichern verteilt die neue Position in Echtzeit an geöffnete Events dieses Typs. Die aktive
   Bereichsauswahl und Fachdaten bleiben unverändert.
6. Bei einer instanzweiten Sperre folgt stattdessen eine Auswirkungsansicht. Sie blockiert, solange
   betroffene Events laufendes Tracking, offene Abstimmungen oder andere nicht sicher
   unterbrechbare Vorgänge besitzen.

Ein Bereich, der für ein konkretes Event nicht aktiviert ist, erscheint trotz Hauptplatzierung
nicht. Sind dadurch nur zwei primäre Bereiche aktiv, bleibt die Navigation bewusst kürzer.

### 10.5 Einladung aus Teilnehmersicht

1. Die Einladung zeigt ausschließlich Eventkern, Kostenhinweis und gegebenenfalls relevante
   Teilnahmefragen.
2. Die Person sagt zu, ab oder tritt bei voller Kapazität der Warteliste bei.
3. Nach Zusage werden Kalenderübergabe und der fokussierte Event-Arbeitsraum angeboten.
4. Es gibt keinen Rundgang durch deaktivierte Funktionen.
5. Eine spätere wesentliche Änderung an Termin, Ort oder Kosten erzeugt eine klare persönliche
   Aktualisierung.

### 10.6 Event kopieren

„Als Vorlage verwenden“ übernimmt:

- Eventtyp,
- aktivierte Bereiche,
- nicht personenbezogene Bereichseinstellungen,
- optional wiederverwendbare Aufgaben- und Beitragsvorlagen.

Die Navigationsposition wird nicht in die Eventkopie eingebrannt; sie folgt weiterhin der aktuellen
Adminrichtlinie für den Eventtyp.

Nicht übernommen werden:

- Zusagen und Einladungsantworten,
- Zahlungen,
- offene Bestellungen,
- Tracking- und Livezustände,
- Abstimmungsergebnisse,
- Matches, Turniere und Arcade-Ergebnisse,
- sensible Teilnahmefragen-Antworten.

### 10.7 Live- und Abschlussphase

Während des Events priorisiert Home laufende Bereiche und nächste Programmpunkte. Nach dem Ende
wechseln die Schwerpunkte auf:

- offene Zahlungen und Abrechnung,
- Fotos/Dateien, falls aktiviert,
- Ergebnis- und Andenkenexport,
- abgeschlossene Aufgaben und Historie,
- „Als Vorlage verwenden“.

Neue operative Aktionen bleiben nach Eventende gesperrt; Historie wird nicht versteckt.

## 11. Relevante Flows nach Eventtyp

### 11.1 Gartenparty

1. Typ wählen, Termin festlegen oder Terminfindung starten.
2. Kapazität und Plus-1 optional setzen.
3. Essenswünsche/Allergien abfragen.
4. Mitbringposten wie Salate, Getränke oder Sitzgelegenheiten veröffentlichen.
5. Orts-, Park- und Schlechtwetterhinweis senden.
6. Musik und Essen während des Events nutzen.
7. Offene Kosten abschließen und optional Fotos sammeln.

### 11.2 Wochenendtrip

1. Termin und Unterkunft planen.
2. Anreise, Fahrzeuge und Plätze koordinieren.
3. Übernachtungs- und Essensbedarf erfassen.
4. Ablauf und Verantwortliche festlegen.
5. Buchungslinks oder Dokumente bereitstellen.
6. Ausgaben und Beiträge nach dem Trip ausgleichen.

### 11.3 Workshop

1. Ziel, Ort, Kapazität und Agenda anlegen.
2. Teilnahme, Materialbedarf und Barrierefreiheit abfragen.
3. Programmpunkte Verantwortlichen zuordnen.
4. Aufbau-/Technikslots vergeben.
5. Vor Ort optional einchecken.
6. Ergebnisse, Links oder Dateien anschließend bereitstellen.

### 11.4 Spieleabend

1. Personen einladen und Essen koordinieren.
2. Über vorhandenen Spielekatalog Favoriten oder Vorschläge auswählen.
3. Optional Vote, Teams oder kleines Turnier aktivieren.
4. Keine Agentinstallation und kein Tracking verlangen.

### 11.5 LAN-Party

Der bestehende Ablauf bleibt der Referenzfall: Termin, Einladungen, Anreise, Packliste, Essen,
Spiele, Vote, Teams, Turniere, Arcade, Tracking, Kiosk und Auswertung. Die Modularisierung darf
hier weder zusätzliche Klicks noch reduzierte Funktionen verursachen.

## 12. Terminfindung und allgemeine Umfragen

Die separate Terminfindung wird über eine schmale, klare Schnittstelle integriert:

- „Termin steht fest“ und „Termin gemeinsam finden“ sind zwei Terminstrategien im Anlegefluss.
- Bei Terminfindung entsteht dasselbe Event bereits als Planungs-Event; es wird später nicht in ein
  zweites Event konvertiert.
- Die Terminfindung erscheint als prioritäre Home-Aufgabe und innerhalb der Eventdetails, nicht als
  dauerhafter Hauptnavigationspunkt.
- Nach Festlegung bleibt sie als Historie erhalten und übergibt den Termin an Kalender,
  Einladungsrevision und aktivierte Bereiche.
- Die Auswahl der Eventbereiche ist unabhängig von der Terminstrategie.
- Ein späteres allgemeines Umfragetool kann dieselben UI-Primitiven nutzen, bleibt aber fachlich
  getrennt von Terminfindung und Spiele-Vote. Status, Berechtigungen und Antworten dürfen nicht in
  einer unscharfen Universaltabelle vermischt werden.

Damit kann die parallele Session eigenständig fertiggestellt werden. Für die spätere Integration
braucht sie lediglich einen stabilen Planungsstatus, Terminänderungssignale und den bestehenden
Eventkontext.

## 13. Rollen, Privatsphäre und Sicherheit

### 13.1 Rollen

Kurzfristig bleiben Owner/Admin, Eventersteller und Teilnehmer maßgeblich. Als spätere, für andere
Eventtypen wichtige Ergänzung wird **Mitorganisator** empfohlen:

- Eventdetails und aktivierte Bereiche verwalten,
- Teilnehmer und Antworten einsehen, sofern freigegeben,
- Aufgaben/Ablauf pflegen,
- keine instanzweiten Adminrechte,
- Zahlungen oder sensible Antworten nur mit ausdrücklicher Teilberechtigung.

### 13.2 Teilnahmefragen

- Jede Frage besitzt einen sichtbaren Zweck.
- Antworten sind nur für die minimal nötigen Rollen sichtbar.
- Allergien, Barrierefreiheit und vergleichbare sensible Angaben erscheinen nicht in offenen
  Teilnehmerlisten, Kiosk, Pushvorschau oder globaler Suche.
- Nach Eventende können Organisierende Antworten löschen oder nach definierter Frist automatisch
  bereinigen; Ergebnisse und Zahlhistorie werden davon getrennt behandelt.

### 13.3 Bereiche sind keine Autorisierung

Das Ausblenden eines Bereichs schützt keine Daten. Eine spätere Umsetzung muss jeden API-Zugriff
weiterhin anhand von Eventteilnahme, Rolle, Bereichszustand und Ressourcen-Event prüfen. Unbekannte,
fremde oder deaktivierte Ressourcen liefern keine verräterischen Details.

## 14. Konzeptionelles Daten- und Konfigurationsmodell

Die spätere technische Ausgestaltung sollte folgende fachliche Informationen abbilden:

### Event

- `event_type_key`: gewählter Typ,
- `preset_version`: Version der bei Erstellung verwendeten Empfehlung,
- bestehende Eventdaten und Lebenszyklusfelder.

### Eventbereich

Pro Event und Bereich:

- stabiler `feature_key`,
- aktiviert/deaktiviert,
- Zeitpunkt und Akteur der letzten Änderung,
- keine beliebige unvalidierte Geschäftslogik in einem universellen JSON-Feld.

Bereichsspezifische Einstellungen bleiben in ihren fachlichen Tabellen oder validierten
Konfigurationen. Die Bereichstabelle beantwortet nur, ob die Fähigkeit zum Event gehört.

### Produktkatalog

Jeder Bereich besitzt einen versionierten Produktdeskriptor:

- stabiler Schlüssel, Titel, Icon und Beschreibung,
- Kern oder optional,
- harte und weiche Abhängigkeiten,
- mögliche Views und Tabs,
- Beiträge zu Home, Profil, Admin, Suche, Kiosk, Onboarding und Benachrichtigungen,
- zulässige Rollen und Bereichszustände,
- sichere Prüfregel vor Deaktivierung beziehungsweise instanzweitem Sperren.

Dieser Deskriptor verhindert verstreute Sonderprüfungen wie „wenn Gartenparty, dann Agent
verstecken“. Oberflächen fragen stattdessen die wirksame Fähigkeit ab.

### Adminrichtlinie

Persistiert werden mindestens:

- instanzweite Freigabe je `feature_key`,
- pro `event_type_key` die Standardaktivierung für neue Events,
- pro `event_type_key` die Platzierung `primary` oder `more`,
- pro `event_type_key` eine eindeutige Reihenfolge,
- Änderungszeitpunkt und Adminakteur.

Kernfunktionen können gespeichert angezeigt, aber nicht auf „gesperrt“ gesetzt werden. Für die
Hauptnavigation validiert das System maximal vier primäre optionale Bereiche pro Eventtyp. Die
Adminrichtlinie verändert keine Berechtigungsregeln und enthält keine fachlichen Bereichsdaten.

### Preset-Register

Die Produktpresets liegen versioniert im Anwendungscode und dienen als sichere Startwerte:

- Titel und Beschreibung,
- empfohlene Bereiche,
- optionale Ergänzungen,
- Navigationspriorität,
- Abhängigkeiten.

Beim ersten Einsatz werden daraus Adminrichtlinien vorbelegt. Danach kann ein Admin die
Standardaktivierung und Platzierung ohne Codeänderung anpassen. Das Event speichert beim Anlegen
weiterhin die tatsächliche Bereichsauswahl. Dadurch ändern neue Empfehlungen keine bestehenden
Eventmomentaufnahmen; zentrale Platzierungsänderungen bleiben dennoch bewusst sofort wirksam.

## 15. Zustände und Randfälle

| Situation | Erwartetes Verhalten |
|---|---|
| Eventtyp wird geändert | Neue Empfehlungen werden als Vergleich angeboten; keine automatische Abschaltung. |
| Bereich mit Daten wird deaktiviert | Offene Vorgänge zuerst schließen; Historie bleibt erhalten. |
| Deep Link zielt auf deaktivierten Bereich | Event-Home mit kurzer Erklärung; kein Fehlerstapel. |
| Teilnehmer verliert Eventzugriff | Event- und Bereichszugriff endet gemeinsam; persönliche rechtmäßige Historie folgt dem Event-Sichtbarkeitskonzept. |
| Event hat noch keinen Termin | Ablauf mit absoluten Zeiten, Tracking und Kalenderexport bleiben gesperrt; Terminfindung ist möglich. |
| Trackingbereich ist aktiviert, Tracking aber aus | Bereich zeigt Einrichtungs-/Pausenzustand, nicht „läuft“. |
| Ein Preset wird im Produkt geändert | Nur neu angelegte Events erhalten die neue Empfehlung. |
| Admin ändert die Standardaktivierung eines Typs | Nur neue Events erhalten die Empfehlung; bestehende Momentaufnahmen bleiben gleich. |
| Admin verschiebt einen Bereich zwischen Hauptnavigation und Mehr | Geöffnete Events dieses Typs aktualisieren die Navigation in Echtzeit; die aktuelle View bleibt offen, sofern der Bereich aktiv und erlaubt ist. |
| Admin markiert einen fünften Hauptbereich | Speichern wird mit konkretem Hinweis blockiert; kein stiller Überlauf nach Mehr. |
| Als primär markierter Bereich ist im Event aus | Eintrag fehlt; kein anderer Mehr-Bereich rückt ungefragt nach. |
| Admin will einen Bereich instanzweit sperren | Betroffene Events und offene Vorgänge werden geprüft; Sperre löscht keine Daten und darf laufende Vorgänge nicht unsauber abbrechen. |
| Sitzplan ist aktiv, Tracking aber aus | Allgemeine Tisch-/Platzzuordnung bleibt sichtbar; Monitorbeziehungen und Agentfunktionen fehlen. |
| Aktives Event hat kein Tracking | Profil zeigt keinen Agentzwang, keine Monitorangaben, keine leeren persönlichen Trackingstatistiken und kein Spiele-Pflichtonboarding. |
| Letzter sichtbarer Tab wird deaktiviert | Tabzeile verschwindet, verbleibende View wird direkt geöffnet. |
| Alle optionalen Bereiche sind aus | Home, Eventdetails, Teilnehmer, Benachrichtigungen und Mehr bleiben vollständig nutzbar. |
| Event wird beendet | Operative Mutationen stoppen, Historie/Abrechnung/Export bleiben zugänglich. |

## 16. Einführung in Stufen

### Stufe A — Modularer Kern

Ziel: andere Eventtypen mit vorhandenen Fähigkeiten sinnvoll nutzbar machen.

- Eventtyp im Anlege-/Bearbeitungsfluss,
- Presets und benutzerdefinierte Bereichsauswahl,
- Adminseite „Bereiche & Navigation“ mit Freigabe, typabhängiger Platzierung und Vorschau,
- Bereichsmomentaufnahme pro Event,
- Abhängigkeitsregeln,
- dynamische Hauptnavigation, Bereichstabs, Home, Profil, Admin, Suche, Onboarding und Kiosk,
- serverseitige Bereichsprüfung für neue Aktionen und Hintergrundprozesse,
- nichtdestruktives Aktivieren/Deaktivieren,
- LAN-Preset als vollständige Rückwärtskompatibilität.

### Stufe B — Universelle Planung

- Ablauf,
- kurze Teilnahmefragen mit Datenschutzgrenzen,
- Beiträge/Slots als Ausbau von To-Do/Mitbring-Anfrage,
- Kalenderübergabe,
- Event als Vorlage verwenden,
- Mitorganisatoren.

### Stufe C — Teilnehmersteuerung

- Kapazität und Warteliste,
- Plus-1 beziehungsweise externe Gäste nach eigenem Sicherheitskonzept,
- einfacher Check-in,
- Teilprogramme/Sub-Events.

### Stufe D — Nachbereitung und wiederkehrende Nutzung

- Budget/Ausgaben,
- Dateien/Fotos,
- Eventserien,
- erweiterte Exporte und Abschlussübersicht.

Die Stufen sind Produktpakete, keine Vorgabe für einen einzigen großen Pull Request. Besonders die
serverseitige Bereichsprüfung darf jedoch nicht später als die sichtbare Ausblendung eingeführt
werden.

## 17. Priorisierung

### Muss für die erste Umsetzung

- Eventtyp mit kleiner Vorauswahl,
- Empfehlung plus „Bereiche anpassen“,
- zentrale Adminfreigabe sowie Hauptnavigation/Mehr je Eventtyp,
- eigener Bereichssnapshot je Event,
- LAN, Gartenparty, Spieleabend, Trip, Workshop und Benutzerdefiniert,
- dynamische Navigation/Home/Profil/Admin/Suche/Onboarding,
- klare Abhängigkeiten und nichtdestruktives Deaktivieren,
- Integration der Terminfindung nur über die definierte Schnittstelle,
- Telefon- und Laptopverhalten.

### Sollte bald folgen

- Ablauf,
- Teilnahmefragen,
- Mitbring-/Helferslots,
- Kalenderexport,
- Kopieren als Vorlage,
- Mitorganisator.

### Kann später folgen

- Kapazität/Warteliste,
- Plus-1 und externe Gäste,
- Check-in,
- Budget/Ausgaben,
- Fotos/Dateien,
- Sub-Events und Serien.

### Bewusst nicht übernehmen

- Ticketverkauf und Zahlungsabwicklung wie Eventbrite,
- öffentliche Eventsuche,
- Marketingautomatisierung,
- Vendor- und Vertragsverwaltung,
- frei konfigurierbare Enterprise-Formulare,
- komplexe Badge-/Einlasshardware.

## 18. Abnahmekriterien für eine spätere Umsetzung

### Event anlegen

- Eventtyp ist mit Tastatur, Touch und Screenreader verständlich wählbar.
- Die empfohlene Auswahl ist ohne weitere Konfiguration übernehmbar.
- „Bereiche anpassen“ zeigt Kernfunktionen, Empfehlungen und Abhängigkeiten nachvollziehbar.
- Eine Navigationsvorschau passt sich sofort an und zeigt die vom Admin vorgegebene, im
  Anlegefluss nicht frei umsortierbare Platzierung.
- Der LAN-Typ erzeugt den heutigen sichtbaren Funktionsumfang.

### Admin konfigurieren

- Kernfunktionen sind als „Immer verfügbar“ erkennbar und nicht deaktivierbar.
- Ein Admin kann optionale Bereiche instanzweit freigeben oder nach Auswirkungsprüfung sperren.
- Standardaktivierung und Hauptnavigation/Mehr sind je Eventtyp an einer zentralen Stelle
  pflegbar.
- Mehr als vier Hauptbereiche können nicht gespeichert werden; die Vorschau erklärt den Konflikt.
- Standardänderungen verändern bestehende Eventauswahlen nicht, Positionsänderungen aktualisieren
  bestehende Events desselben Typs.
- Eine Teilnehmer-Vorschau enthält keine Adminziele.

### Event nutzen

- Gartenparty und Workshop zeigen keine Gaming- oder Trackingoberfläche, solange diese nicht
  bewusst aktiviert wurde.
- Deaktivierte Bereiche fehlen in Navigation, Mehr, Suche, Home, Kiosk und Benachrichtigungen.
- Ohne Tracking fehlen auf Home Live-Status und Rangliste sowie im Profil Agent, Trackingpause,
  sichtbare Monitore und leere Trackingstatistiken.
- Ein aktivierter Sitzplan kann als Tisch-/Platzplan ohne Tracking funktionieren; die
  Monitorfunktion bleibt dabei verborgen.
- Profil- und Onboardingtexte verlangen Bock/Skill nur bei aktivem Spielebereich.
- Admin-Bereitschaft und Werkzeugliste enthalten nur Prüfungen und Ziele wirksamer Bereiche.
- Direkte API- und Deep-Link-Zugriffe umgehen die Bereichsprüfung nicht.
- Eventwechsel baut den sichtbaren Arbeitsraum ohne Reload und ohne übrig gebliebene Daten des
  vorherigen Events neu auf.
- Ein Event mit nur Kernfunktionen bleibt vollständig bedienbar.

### Event ändern

- Aktivieren stellt einen vorhandenen historischen Bereich wieder her.
- Deaktivieren löscht keine Daten.
- Offene Vorgänge blockieren eine unsichere Deaktivierung mit konkreter Begründung.
- Ein Typwechsel verändert keinen Bereich stillschweigend.
- Gleichzeitig geöffnete Clients erhalten die neue Konfiguration in Echtzeit.

### Qualität

- Alle Zustände funktionieren bei 320 px und auf Laptopbreite ohne horizontalen Seitenscroll.
- Lange deutsche Namen und Eventtitel verdrängen keine Aktionen.
- Status ist nicht nur über Farbe erkennbar.
- Kernaktionen bleiben in wenigen Schritten erreichbar.
- Bestehende LAN-, Einladungs-, Zahlungs-, Eventkontext- und Trackingabläufe regressieren nicht.

## 19. Offene Produktentscheidungen mit Empfehlung

### 19.1 Eventtyp sichtbar umbenennen?

**Empfehlung:** Typ kann bearbeitet werden, ist aber auf Eventkarten nur als kleine sekundäre
Information sichtbar. Der Eventname bleibt dominant.

### 19.2 Dürfen Teilnehmer Bereiche aktivieren?

**Empfehlung:** Nein. Das ist eine strukturelle Evententscheidung für Ersteller,
Mitorganisatoren oder Adminvertretung. Inhalte innerhalb freigegebener Bereiche dürfen weiterhin
nach deren normalen Rollenregeln bearbeitet werden.

### 19.3 Abweichende Navigation je einzelnes Event?

**Empfehlung:** Nicht in der ersten Ausbaustufe. Der Admin pflegt eine globale Freigabe und je
Eventtyp eine einheitliche Hauptnavigation/Mehr-Zuordnung. Das einzelne Event wählt nur aktive
Bereiche. So bleibt die Oberfläche zentral beherrschbar und trotzdem passend für LAN, Feier oder
Trip. Ein Event-Override sollte erst ergänzt werden, wenn reale Sonderfälle die zusätzliche Ebene
rechtfertigen; auch dann ausschließlich für Admin oder Mitorganisatoren mit ausdrücklicher
Strukturberechtigung.

### 19.4 Plus-1 ohne Konto?

**Empfehlung:** Als eigenes späteres Sicherheits- und Datenschutzkonzept behandeln. Ein an ein
Mitglied gebundener, namenloser Plus-1-Platz ist ein risikoärmerer erster Schritt als frei
zugängliche Gastkonten oder öffentliche Links.

### 19.5 Allgemeine Umfragen?

**Empfehlung:** Nach Abschluss der Terminfindung separat konzipieren. Datumsvote, Spiele-Vote und
allgemeine Meinungsumfrage teilen Darstellungsmuster, aber nicht zwingend Lebenszyklus,
Berechtigung oder Datenmodell.

## 20. Quellen des Toolvergleichs

Abruf: 2026-08-23. Verwendet wurden offizielle Produkt- und Hilfeseiten:

- [Doodle: Group Poll](https://help.doodle.com/en/articles/9823082-introduction-to-group-poll)
- [Doodle: Group Poll und Sign-up Sheet](https://help.doodle.com/en/articles/9457211-when-to-use-sign-up-sheet-or-group-poll)
- [Partiful: Umfragen und RSVP-Fragen](https://help.partiful.com/hc/en-us/articles/24467301043355-Can-I-poll-or-survey-my-guests)
- [Partiful: Eventeinstellungen](https://help.partiful.com/hc/en-us/articles/28895223149979-What-features-are-available-to-change-in-my-Event-Settings)
- [Spond: Eventorganisation](https://www.spond.com/events/)
- [Spond: Eventbezogene Zahlungen](https://help.spond.com/app/en/articles/129968-payment-for-events)
- [SignUpGenius: Sign-ups, Slots und Erinnerungen](https://www.signupgenius.com/sign-ups)
- [Eventbrite: Registrierung und Teilnehmermanagement](https://www.eventbrite.com/features/registration/)
- [Eventbrite: Check-in](https://www.eventbrite.com/features/check-in-app/)
- [Luma: Warteliste](https://help.luma.com/p/waitlist)
- [RSVPify: Funktionsübersicht](https://rsvpify.com/features/)
- [Planning Pod: Eventplanung und -management](https://planningpod.com/solutions/use-cases/event-planning-and-management)

## 21. Schlussurteil

Die richtige Erweiterung ist kein universelles „alles kann alles“-Eventsystem, sondern ein
**fokussierter Eventbaukasten mit guten Voreinstellungen**. Der Eventtyp macht den Start schnell;
die Bereichsauswahl verhindert unnötige Oberfläche; der Eventkontext hält Daten und
Berechtigungen sauber getrennt. Die zentrale Adminrichtlinie ergänzt die fehlende Governance:
Admins entscheiden über Verfügbarkeit und Platzierung, ohne Eventerstellern die sinnvolle
Bereichsauswahl für ihr konkretes Event zu nehmen.

Mit Stufe A kann Respawn Gartenpartys, Spieleabende, Trips und Workshops bereits deutlich besser
abbilden, ohne neue große Fachmodule zu bauen. Ablauf, Teilnahmefragen und verbindliche Slots sind
danach die wertvollsten Ergänzungen, weil sie bei fast allen neuen Eventtypen wiederkehren. Alles,
was Respawn in Richtung öffentlicher Ticketplattform oder Enterprise-Venue-Software ziehen würde,
sollte bewusst außerhalb des Produkts bleiben.

Entscheidend für die Umsetzung ist, Modularität nicht auf die Bottom-Navigation zu reduzieren.
Home, Profil, Admin, Suche, Onboarding, Push und Kiosk müssen denselben wirksamen Bereichszustand
verwenden. Erst dann fühlt sich eine Gartenparty tatsächlich wie ein passendes Eventtool an und
nicht wie eine LAN-Oberfläche mit ausgeblendeten Menüpunkten.
