# Konzept: Event-Abstimmungen und flexible Teilnahme

## Entscheidung und Ziel

Respawn erhält keinen eigenen Typ „Planungs-Event“ und keinen separaten Erstellungsweg dafür.
Stattdessen wird jedes Event über „Event anlegen“ erstellt. Unter „Orga“ gibt es einen eigenen Tab
„Abstimmungen“, in dem die zugehörigen Eventumfragen angelegt, beantwortet und entschieden werden.
Noch ungeklärte Angaben wie Termin, Ort, Dauer oder Preis dürfen beim Anlegen fehlen. `draft` bleibt
dafür ein interner Lebenszykluszustand desselben regulären Events und wird in der Oberfläche als
„In Planung“ dargestellt.

Innerhalb eines Events können mehrere voneinander unabhängige Umfragen laufen, beispielsweise zu:

1. Termin oder Zeitraum,
2. Ort oder Unterkunft,
3. Dauer,
4. Budget oder Preisrahmen,
5. Programm, Verpflegung oder Anreise.

Die Terminabstimmung ist damit eine spezialisierte Umfrage im allgemeinen Abstimmungsbereich und
kein eigenes Produkt mehr. Frühere und neue Abstimmungsrunden, Entscheidungen, Einladungen,
Teilnahme, Zahlungen und Abrechnung bleiben dauerhaft an derselben Event-ID gebündelt.

Davon getrennt beantwortet jede Person die Frage, ob sie am Event teilnehmen möchte. Neben einer
festen Zusage gibt es „Interessiert / unter Vorbehalt“. Diese Antwort drückt echtes Interesse aus,
zählt aber noch nicht als sichere Teilnahme. Die eigene Entscheidung kann später in eine feste
Zusage oder Absage geändert werden. Auch nach einer festen Zusage ist eine spätere Absage möglich.

Das Zielbild eignet sich nicht nur für LANs, sondern auch für Ausflüge, Spieleabende, Turniere,
Feiern oder andere Gruppenevents. Unterkunft, Zahlung und Abrechnung bleiben optionale Module und
werden nur gezeigt, wenn sie für das Event verwendet werden.

## Produktgrundsätze

- Ein Event besitzt vom ersten Entwurf bis zur Abrechnung genau eine ID.
- Es gibt nur einen Erstellungsweg „Event anlegen“, nicht zusätzlich „Planungs-Event anlegen“.
- „Abstimmungen“ ist ein eigener Tab direkt unter „Orga“. Jede Abstimmung bleibt trotzdem genau
  einem Event zugeordnet.
- Eine Umfrage sammelt Meinungen oder Verfügbarkeiten; sie ist weder eine Eventzusage noch bereits
  eine Entscheidung.
- Das System empfiehlt nachvollziehbar, entscheidet aber nie automatisch. Die Eventverwaltung
  übernimmt ein Ergebnis bewusst als Evententscheidung.
- Mehrere Entscheidungsstränge dürfen gleichzeitig offen sein, zum Beispiel Termin und Ort. Pro
  Event und Entscheidungsstrang gibt es höchstens eine offene oder geschlossene, noch nicht
  entschiedene Runde. Mehrere voneinander unabhängige freie Abstimmungen bleiben dadurch möglich.
- Entscheidungen und frühere Runden bleiben als Historie sichtbar und werden nicht überschrieben.
- Teilnahme unter Vorbehalt wird klar von einer belastbaren Zusage unterschieden und nie für
  Zahlungen, Tracking oder sichere Kapazitäten mitgezählt.
- Formulierungen und Datenmodell bleiben neutral: „Event“, „Abstimmung“ und „Teilnehmende“ statt
  fest eingebauter LAN-, Unterkunfts- oder Reiseannahmen.

## Wahrscheinliche Umfragen

Nicht jede denkbare Frage braucht einen eigenen technischen Umfragetyp. Häufige Themen erhalten
Vorlagen mit passenden Feldern und Ergebnislogik; seltene Fragen verwenden „Eigene Abstimmung“.

| Priorität | Vorlage | Typische Frage | Empfohlener Antwortmodus | Wirkung einer Entscheidung |
|---|---|---|---|---|
| sehr häufig | Termin / Zeitraum | „An welchem Wochenende könnt ihr?“ | Passt / wenn nötig / passt nicht je Option | setzt Eventzeitraum |
| sehr häufig | Ort / Unterkunft | „Welcher Ort passt für euch?“ | Passt / wenn nötig / passt nicht | setzt optional Ort, Link und Unterkunft |
| sehr häufig | Dauer | „Wie lange soll das Event dauern?“ | Passt / wenn nötig / passt nicht | setzt geplante Dauer; Termin bleibt separat |
| sehr häufig | Budget / Preisrahmen | „Welcher Preis wäre für dich noch okay?“ | eine Auswahl aus geordneten Preisstufen | setzt Planungswert, nicht automatisch einen Zahlungsbetrag |
| häufig | Programm / Aktivität | „Was soll stattfinden?“ | Mehrfachauswahl | übernimmt eine oder mehrere Programmentscheidungen |
| häufig | Verpflegung | „Welche Verpflegung sollen wir organisieren?“ | Einzel- oder Mehrfachauswahl | setzt Planungsentscheidung |
| häufig | Anreise / Abreise | „Welche gemeinsame Anreise passt?“ | Einzel- oder Mehrfachauswahl | setzt Planungsentscheidung |
| gelegentlich | Ausstattung / Bedarf | „Was wird vor Ort benötigt?“ | Mehrfachauswahl | liefert Bedarf; ersetzt keine Aufgabenliste |
| gelegentlich | Spiel / Turnierformat | „Was spielen wir?“ | Einzel- oder Mehrfachauswahl | setzt Programmentscheidung |
| Auffanglösung | Eigene Abstimmung | freie, eventbezogene Frage | Einzel-, Mehrfach- oder Eignungsantwort | nur dokumentierte Entscheidung |

Für den ersten allgemeinen Ausbau sind Termin, Ort, Dauer, Budget und eine eigene Abstimmung die
wichtigsten Vorlagen. Programm, Verpflegung und Anreise verwenden bereits dieselbe technische
Basis und können anschließend als reine Vorlagen ergänzt werden. Aufgabenverteilung, Bestelllisten
und Checklisten bleiben eigene Werkzeuge; sie werden nicht in eine Umfrage gezwungen.

### Abgrenzung ähnlicher Themen

- „Termin / Zeitraum“ fragt, wann jemand kann, und enthält konkrete Kalenderoptionen.
- „Dauer“ fragt unabhängig davon nach gewünschter oder möglicher Länge, zum Beispiel zwei oder
  drei Nächte. Eine spätere Terminoption kann diese Dauer berücksichtigen.
- „Ort / Unterkunft“ fragt nach Eignung eines konkreten Orts. Preis, Kapazität und Link sind
  Zusatzinformationen der Option.
- „Budget“ fragt nach einer persönlichen Preisgrenze oder bevorzugten Preisspanne. Die Auswahl ist
  keine Zahlungszusage und verändert bestehende Zahlungen nicht.

## Erkenntnisse aus bestehenden Abstimmungswerkzeugen

- Doodle und Framadate verwenden drei Verfügbarkeitsstufen: Ja, wenn nötig und Nein. Das ist für
  Termin, Ort und Dauer aussagekräftiger als ein binärer Vote.
- Doodle behandelt Antwortfrist, Erinnerungen, verborgene Antworten und Teilnehmerlimits als
  explizite Einstellungen. Frist und Erinnerungen gehören in Respawn zum Kernablauf; verborgene
  Antworten und Limits können später ergänzt werden.
- Rallly trennt Ergebnis und Entscheidung: Die Abstimmung zeigt die beste Abdeckung, der
  Organisator wählt anschließend bewusst eine Option.
- Allgemeine Formularwerkzeuge unterscheiden Einzelwahl, Mehrfachwahl, Bewertung und Rangfolge.
  Respawn startet bewusst schlanker mit drei Antwortmodi, die für konkrete Evententscheidungen
  reichen.
- Eigene Antworten dürfen geändert werden, solange eine Abstimmung offen ist.

Quellen:

- [Doodle: Group Poll erstellen](https://help.doodle.com/en/articles/9457353-how-do-i-create-a-group-poll)
- [Doodle: Fristen, Erinnerungen und verborgene Antworten](https://help.doodle.com/en/articles/9457346-how-do-i-set-a-deadline-limit-participants-send-automatic-reminders-or-make-my-group-poll-hidden)
- [Rallly: Abstimmung anlegen](https://support.rallly.co/workflow/create)
- [Rallly: Termin auswählen](https://support.rallly.co/workflow/schedule)
- [Framadate: Antworten und Ergebnisse](https://docs.framasoft.org/en/framadate/prise-en-main.html)
- [Microsoft Forms: verfügbare Fragetypen](https://support.microsoft.com/en-us/office/create-a-form-with-microsoft-forms-4ffb64cc-7d5d-402f-b82e-b1d49418fd9d)

## Antwortmodi

### Eignung pro Option

Jede eingeladene Person bewertet jede Option mit genau einem Wert:

- „Passt“ (`can`),
- „Wenn nötig“ (`if_needed`),
- „Passt nicht“ (`cannot`).

Bei einer Terminumfrage darf die Vorlage weiterhin „Kann“, „Wenn nötig“ und „Kann nicht“ anzeigen.
„Offen“ ist kein wählbarer Wert, sondern bedeutet noch nicht beantwortet. Dieser Modus eignet sich
für Termin, Ort und Dauer, weil er Präferenz und harte Ausschlussgründe trennt.

### Einzelauswahl

Die Person wählt genau eine Option. Optional kann die Verwaltung „Keine Präferenz“ erlauben. Dieser
Modus eignet sich für geordnete Budgetstufen oder eine einfache Richtungsentscheidung.

### Mehrfachauswahl

Die Person wählt null bis mehrere Optionen. Die Verwaltung kann eine Mindest- und Höchstzahl
festlegen. Eine explizite Abgabe ohne Auswahl wird als beantwortet gespeichert und darf nicht mit
„Offen“ verwechselt werden. Dieser Modus eignet sich für Programm, Verpflegung und Ausstattung.

Rangfolge, Freitextantworten, numerische Eingaben und Skalen sind nicht Teil des ersten Ausbaus. Sie
können später ergänzt werden, ohne die drei vorhandenen Modi umzudeuten.

## Produktablauf

### 1. Reguläres Event anlegen

Im Bereich „Orga -> Events“ wählt die Verwaltung „Event anlegen“ und gibt mindestens einen
Arbeitstitel ein. Optional können Beschreibung, Eventart und bereits bekannte Angaben wie Termin
oder Ort hinterlegt werden. Fehlende Planungswerte sind erlaubt.

Das Event erhält `draft` und wird als „In Planung“ dargestellt, solange die Verwaltung es nicht
veröffentlicht. Es ist kein anderer Eventtyp. Eine Eventart wie „LAN“, „Ausflug“, „Spieleabend“ oder
„Sonstiges“ darf Vorlagen vorschlagen, ändert aber weder Rechte noch Datenmodell.

Ein Event in Planung ist sichtbar für:

- seinen Ersteller und dessen definierte Vertretung,
- aktive Mitglieder, die zu mindestens einer Abstimmung oder zur Teilnahme eingeladen sind,
- Personen, die bereits „Interessiert“, „Zugesagt“ oder „Abgesagt“ geantwortet haben.

Andere Gruppenmitglieder erhalten für Detailzugriffe 404. Bestehende Eventlisten, Tracking,
Statistiken und Agentenzuordnung müssen Events mit noch fehlendem Termin korrekt als Planung
darstellen und dürfen kein ungültiges Datum rendern.

### 2. Abstimmung starten

Im Tab „Orga -> Abstimmungen“ wählt die Verwaltung zuerst das zugehörige Event und danach eine
Vorlage oder „Eigene Abstimmung“. Ein Aufruf aus einer Eventansicht darf direkt in diesen Tab
springen und das Event vorauswählen. Erfasst werden:

- Thema und verständlicher Titel,
- mindestens zwei Optionen,
- der passende Antwortmodus,
- eine Antwortfrist,
- einzuladende aktive Mitglieder; standardmäßig sind bisherige Teilnehmende und bereits an der
  Planung beteiligte Personen vorausgewählt,
- optional eine Notiz.

Vorlagen validieren ihre Optionen fachlich:

- Terminoptionen enthalten Beginn und Ende als lokale Kalenderdaten; optionale Uhrzeiten bleiben
  eine spätere Erweiterung.
- Ortsoptionen besitzen einen Namen und optional Adresse, Kartenlink, Kapazität, Preis und Notiz.
- Daueroptionen besitzen eine positive Zahl von Tagen oder Nächten und eine lesbare Bezeichnung.
- Budgetoptionen besitzen nicht überlappende, aufsteigend sortierte Preisstufen in Cent.
- Eigene Optionen besitzen eine kurze Bezeichnung und optionale Beschreibung.

Mehrere unterschiedliche Entscheidungsstränge dürfen gleichzeitig offen sein. Für denselben
Entscheidungsstrang muss eine unentschiedene Runde zuerst entschieden oder abgebrochen werden,
bevor eine neue Runde beginnt. Vorlagen verwenden dafür stabile Schlüssel wie `date`, `location`
oder `duration`; eine freie Abstimmung erhält standardmäßig einen eigenen Schlüssel und kann bei
einer Neuabstimmung bewusst als weitere Runde desselben Strangs fortgesetzt werden.

### 3. Antworten

„Antwort speichern“ sichert die vollständige Antwort einer Person atomar. Die Oberfläche zeigt
deutlich, welche Optionen noch fehlen und ob die Antwort vollständig abgegeben wurde. Eigene
Antworten können bis zur Frist oder manuellen Schließung geändert werden.

Eine Abstimmungsantwort verändert niemals automatisch den Teilnahmezustand. „Alle Termine passen
nicht“ kann zu einer späteren Absage führen, ist aber technisch nicht dasselbe. Umgekehrt ist
„Zugesagt“ keine Stimme für eine konkrete Umfrageoption.

### 4. Ergebnis bewerten und Entscheidung übernehmen

Die Verwaltung sieht je nach Antwortmodus:

- Eignung: Anzahl „Passt“, „Wenn nötig“, „Passt nicht“ und „Offen“ sowie Namen je Kategorie,
- Einzelauswahl: Stimmen je Option, Anteil der abgegebenen Antworten und offene Personen,
- Mehrfachauswahl: Auswahlzahl je Option, Anteil der abgegebenen Antworten und offene Personen.

Eine nachvollziehbare Empfehlung hebt die beste Abdeckung hervor, entscheidet aber nicht. Die
Verwaltung kann eine oder bei Mehrfachentscheidungen mehrere Optionen bewusst als Ergebnis
übernehmen und optional eine kurze Entscheidungsnotiz hinterlegen.

Für den Eignungsmodus ist die stabile Sortierung:

1. höchste Anzahl „Passt“,
2. höchste Summe aus „Passt“ und „Wenn nötig“,
3. geringste Anzahl „Passt nicht“,
4. vorlagenspezifischer Gleichstand, beispielsweise frühester Termin oder niedrigerer Preis,
5. niedrigste gespeicherte Position,
6. niedrigste ID als letzter Gleichstand.

Für Einzel- und Mehrfachauswahl gilt zuerst die Stimmenzahl, danach die gespeicherte Position und
ID. Ein Gleichstand wird sichtbar ausgewiesen.

Die Übernahme ist vorlagenspezifisch:

- Termin setzt `starts_at` und `ends_at` des Events.
- Ort kann Name, Adresse und Kartenlink übernehmen; Unterkunftspreis und Kapazität werden nur nach
  expliziter Bestätigung übernommen.
- Dauer setzt einen dokumentierten Planungswert und verändert einen bestehenden Termin nicht
  stillschweigend.
- Budget setzt einen Planungsrahmen, aber weder Beitrag noch Zahlungspflicht.
- Eigene und Mehrfachentscheidungen erscheinen in der Entscheidungsübersicht des Events.

Entscheidung, Eventfelder, Revisionsänderung, Audit und Realtime-Ereignis werden atomar gespeichert.
Ein idempotenter Retry erzeugt keine zweite Entscheidung oder Benachrichtigung.

### 5. Teilnahme unter Vorbehalt

Sobald eine Person das Event sehen darf, kann sie ihren persönlichen Teilnahmezustand setzen:

- „Noch offen“ (`invited`) - Einladung gesehen oder noch unbeantwortet,
- „Interessiert / unter Vorbehalt“ (`interested`) - grundsätzliches Interesse, Details noch offen,
- „Fest zugesagt“ (`accepted`) - belastbare Zusage für den aktuellen Termin,
- „Abgesagt“ (`declined`) - nimmt nach aktuellem Stand nicht teil.

Die Oberfläche erklärt direkt bei „Interessiert“: Dieser Zustand hilft der Planung, ist aber keine
feste Zusage. Gründe wie Preis, Ort, Dauer oder Termin müssen nicht in einem Freitext offengelegt
werden. Optional kann die Person eine nur für die Eventverwaltung sichtbare kurze Notiz angeben;
sie ist nicht erforderlich.

Nur eine feste, für die aktuelle Terminrevision bestätigte Zusage zählt für:

- sichere Teilnehmerzahl und Kapazität,
- Beitrag pro Kopf und Zahlungsaufforderung,
- aktive Eventauswahl und Tracking,
- Auswertungen, die tatsächliche Teilnahme voraussetzen.

„Interessiert“ wird separat als Planungspotenzial angezeigt, beispielsweise „8 fest, 4
interessiert, 3 offen“. Interessen dürfen nie in einen scheinbar sicheren Preis pro Kopf
eingerechnet werden. Die Verwaltung kann zur verbindlichen Zu- oder Absage erinnern, sobald die
wesentlichen Eckdaten feststehen.

### 6. Eigene Zusage ändern oder absagen

Die eigene Teilnahmeentscheidung bleibt bis zum Eventende änderbar. Insbesondere sind folgende
Übergänge erlaubt:

- offen -> interessiert, zugesagt oder abgesagt,
- interessiert -> zugesagt oder abgesagt,
- zugesagt -> interessiert oder abgesagt,
- abgesagt -> interessiert oder zugesagt, solange das Event neue Teilnahme zulässt.

Vor „Fest zugesagt -> Abgesagt“ oder „Fest zugesagt -> Interessiert“ zeigt die Oberfläche einen
Bestätigungsdialog. Sind Zahlungen, reservierte Kosten oder aktives Tracking vorhanden, nennt er
diese Folgen ausdrücklich, verhindert die Änderung aber nicht. Niemand soll technisch als
Teilnehmer festgehalten werden, nur weil eine Rückzahlung organisatorisch noch offen ist.

Eine spätere Absage läuft atomar:

1. Teilnahmezustand und bestätigte Terminrevision werden aktualisiert.
2. Die Person zählt sofort nicht mehr als aktuelle feste Teilnahme.
3. Eine aktive Eventzuordnung und laufendes Tracking für dieses Event werden sicher beendet.
4. Bereits gespeicherte Zahlungen und Zahlungssnapshots bleiben erhalten.
5. Die Verwaltung erhält Audit, Realtime-Aktualisierung und persönliche Benachrichtigung.
6. Die Oberfläche markiert eine mögliche Rückzahlung oder Nachforderung zur manuellen Prüfung.

Abstimmungsantworten werden bei einer Absage nicht gelöscht. Sie bleiben als historische
Planungsinformation erhalten. Ein Eventabbruch oder Eventende sperrt neue Zusagen, lässt den eigenen
historischen Zustand aber lesbar.

### 7. Terminwechsel, andere Planänderungen und Information

Nur ein neuer oder geänderter Termin macht eine frühere feste Zu- oder Absage fachlich veraltet.
Das gilt unabhängig davon, ob der Termin aus einer Abstimmungsentscheidung oder einer direkten
Eventbearbeitung stammt. Dafür bleibt die bestehende `schedule_revision` maßgeblich:

- ein Terminwechsel erhöht `schedule_revision` genau einmal,
- eine frühere feste Zusage wird zu „Erneute Bestätigung erforderlich“ und zählt bis zur neuen
  Antwort nicht mehr als feste Teilnahme,
- eine frühere Absage wird als „Antwort vor Terminänderung“ dargestellt und kann neu beantwortet
  werden,
- „Interessiert“ bleibt interessiert,
- Zahlungen werden niemals gelöscht oder zurückgesetzt.

Andere Planänderungen machen eine Zu- oder Absage nicht ungültig. Das gilt insbesondere für:

- Ort, Unterkunft, Adresse oder Kartenlink,
- Dauer,
- Preis, Budget oder verpflichtenden Beitrag,
- Programm, Verpflegung, Anreise und Ausstattung,
- eigene als Entscheidung übernommene Abstimmungen.

Bei diesen Änderungen bleibt eine feste Zusage fest und wird weiterhin in Teilnehmerzahl, Preis
pro Kopf und Tracking berücksichtigt. Betroffene Personen müssen jedoch persönlich informiert
werden. Die Information wird sowohl bei einer übernommenen Abstimmungsentscheidung als auch bei
einer direkten Änderung derselben Eventdaten ausgelöst und enthält:

- verständlich, was sich geändert hat,
- bei Ort, Dauer und Preis den bisherigen und den neuen Stand,
- einen direkten Link zum Event beziehungsweise zum Tab „Abstimmungen“,
- die sichtbare Möglichkeit, die eigene Teilnahme anschließend auf „Interessiert“ oder „Abgesagt“
  zu ändern.

Informiert werden mindestens alle aktuell fest zugesagten und interessierten Personen sowie offene
Eventeingeladene, die von der Entscheidung betroffen sind. Bereits abgesagte Personen erhalten
diese Planänderungen standardmäßig nicht. Eingeladene einer konkreten Abstimmung erhalten deren
Entscheidungsnachricht unabhängig vom Teilnahmezustand.

Benachrichtigung, Audit-Eintrag und Realtime-Aktualisierung werden genau einmal an die erfolgreiche
Änderung gebunden. Schlägt die persönliche Zustellung vorübergehend fehl, bleibt die Änderung
gespeichert und die Benachrichtigung wird idempotent erneut versucht. Eine Änderung an
Schreibweise oder Notiz ohne fachlich neuen Wert darf keine unnötige Änderungsnachricht erzeugen.

### 8. Neue Abstimmungsrunde und Historie

Solange ein Event weder läuft noch beendet ist, kann die Verwaltung für einen Entscheidungsstrang
eine neue Runde starten. Dabei:

- bleibt die bisherige Entscheidung als „Bisheriger Stand“ sichtbar und vorläufig gültig,
- beginnt jede neue Runde mit neuen Antworten; alte Stimmen werden nie als aktuelle kopiert,
- können Optionen bewusst aus einer früheren Runde übernommen werden,
- sind bisherige Teilnehmende und Abstimmungsteilnehmende standardmäßig eingeladen,
- kann die neue Runde ohne Änderung des bisherigen Eventstands abgebrochen werden.

Wird eine neue Entscheidung übernommen, wechselt die frühere entschiedene Runde zu `superseded`.
Alle Runden, Optionen, Antworten und Entscheidungsnotizen bleiben in der Historie lesbar.

## Erinnerungen und Fristablauf

- Offene Personen erhalten automatisch eine persönliche Erinnerung 48 Stunden vor der Frist und
  eine zweite am Kalendertag der Frist. Bei später Erstellung wird nur die nächste sinnvolle Stufe
  versendet.
- „Offene erinnern“ zeigt vorab die betroffenen Personen. Über automatische und manuelle
  Erinnerungen gilt pro Person und Abstimmung ein rollierender Mindestabstand von 24 Stunden.
- Eine verlängerte Frist berechnet den Plan neu. Bereits versendete Benachrichtigungen bleiben im
  Verlauf, verhindern die neuen Friststufen aber nicht.
- Erinnerungen sind ausschließlich in `open` zulässig. `close`, `decide` oder `cancel` verwerfen
  ausstehende Erinnerungen; `reopen` erzeugt für die neue Frist einen frischen Plan.
- Der erste authentifizierte Zugriff nach Fristablauf materialisiert `open -> closed` lazy,
  idempotent und transaktional. Genau ein konkurrierender Zugriff schreibt Status und Audit und
  sendet genau ein Realtime-Signal.
- Ab der fachlich abgelaufenen Frist liefern Antworten und andere Schreibaktionen 409, auch wenn
  der gespeicherte Statusübergang noch nicht materialisiert war.
- Teilnahmeerinnerungen sind von Umfrageerinnerungen getrennt. Sie richten sich an offene,
  interessierte oder nach einer Revision erneut zu bestätigende Personen und nennen den Anlass.

## Zustände und Übergänge

### Eventstatus

Die bestehenden Eventzustände bleiben maßgeblich:

- `draft` - reguläres Event wird geplant; Termin, Ort oder andere Angaben können fehlen,
- `published` - Event ist veröffentlicht und besitzt die dafür erforderlichen Eckdaten,
- `cancelled` - Event wurde abgesagt,
- `ended` - Event ist beendet.

`cancelled` und `ended` sperren neue Abstimmungen und Zusagen. Tracking darf nur für `published`
mit festem Zeitraum und aktuell fest zugesagten Personen aktiviert werden.

### Abstimmungen

- `open` - Antworten möglich,
- `closed` - Frist abgelaufen oder manuell geschlossen, noch keine Entscheidung,
- `decided` - Ergebnis wurde als aktueller Stand für das Thema übernommen,
- `superseded` - frühere Entscheidung wurde durch eine neue ersetzt,
- `cancelled` - Runde verworfen; bestehende Eventwerte bleiben unverändert.

| Ausgang | Aktion | Ziel | Auswirkung |
|---|---|---|---|
| open | Frist oder close | closed | Antworten und Erinnerungen werden gesperrt |
| closed | reopen | open | zukünftige Frist und Erinnerungsplan werden atomar gesetzt |
| open, closed | decide | decided | Auswahl und optionale Eventfelder werden atomar übernommen |
| open, closed | cancel | cancelled | bestehender Eventstand bleibt bestehen |
| decided | neue Runde wird entschieden | superseded | historische Entscheidung bleibt lesbar |

Wiederholte oder konkurrierende Zustandswechsel liefern 409. Der idempotente Retry derselben
erfolgreichen Entscheidung liefert den erreichten Zustand, erzeugt aber keine zweite Revision.

### Teilnahme

Die gespeicherten Zustände sind `invited`, `interested`, `accepted` und `declined`. Zusätzlich wird
aus Status und Revision der abgeleitete UI-Zustand `needs_confirmation` gebildet. Er ist kein
fünfter frei wählbarer Status.

Nur `accepted` mit `confirmed_schedule_revision = events.schedule_revision` ist aktuell fest
zugesagt. Diese Bedingung wird als gemeinsames Prädikat zentralisiert und in Preis, Tracking,
Sichtbarkeit, Teilnehmerzahl und aktiver Eventauswahl wiederverwendet. Änderungen außerhalb des
Termins verändern diese Revisionen nicht.

## Änderungen während einer offenen Abstimmung

Metadaten wie Titel, Notiz und Antwortfrist können geändert werden. Optionen und Eingeladene
verwenden eigene Aktionen:

- Eine Option mit Antworten darf nicht inhaltlich geändert werden (409). Stattdessen wird eine neue
  Option ergänzt und die alte nach Bestätigung entfernt.
- Das Entfernen einer Option löscht zugehörige Antworten kaskadierend, wird auditiert und
  benachrichtigt alle Eingeladenen. Mindestens zwei Optionen müssen verbleiben.
- Neue Optionen und später hinzugefügte Personen beginnen als „Offen“.
- Das Entfernen einer Person löscht ihre Antworten dieser Runde kaskadierend, entzieht ihren
  Rundenzugriff und zeigt vorher einen Bestätigungsdialog. Ihr Event-Teilnahmezustand bleibt davon
  unberührt.
- Antwortmodus und Thema sind nach der ersten abgegebenen Antwort unveränderlich.
- Diese Änderungen sind nur in `open` erlaubt; sonst folgt 409.

## Berechtigungen und Sichtbarkeit

- Owner und Admins dürfen Events und Abstimmungen anlegen.
- Der gespeicherte Eventersteller entscheidet, öffnet wieder, bricht Runden ab und startet neue
  Runden.
- Wird der Ersteller deaktiviert, gelöscht oder verliert seine aktive Gruppenmitgliedschaft,
  übernimmt ausschließlich der Gruppen-Owner diese Aktionen als auditierte Vertretung.
- Solange der Ersteller aktiv ist, erhalten andere Admins keine zusätzlichen Entscheidungsrechte.
- Eingeladene aktive Mitglieder dürfen nur ihre eigenen Abstimmungsantworten und ihren eigenen
  Teilnahmezustand ändern.
- Eine Eventverwaltung darf Personen einladen oder entfernen, aber eine persönliche feste Zusage
  nicht stillschweigend im Namen der Person erzeugen.
- Abstimmungen sind nur für ihre Eingeladenen, Eventteilnehmende und berechtigte Verwalter lesbar.
  Nicht sichtbare Ressourcen liefern 404 statt Berechtigungsdetails offenzulegen.
- Ergebnisnamen sind im MVP für Eingeladene sichtbar. Verborgene Antworten bleiben eine spätere,
  pro Abstimmung konfigurierbare Option; die Verwaltung sieht sie weiterhin.

## Datenmodell

Das bestehende Event bleibt der fachliche Parent. Die bereits umgesetzten Terminabstimmungstabellen
werden in ein allgemeines Modell überführt, ohne Historie zu verlieren:

    events
      ...
      starts_at NULLABLE
      ends_at NULLABLE
      schedule_revision INTEGER NOT NULL DEFAULT 0

    event_polls
      id, event_id, topic, decision_key, round_number, title, description,
      response_mode, response_due_at, status, created_by, created_at, updated_at

    event_poll_options
      id, poll_id, label, description, position,
      option_payload_json

    event_poll_invitees
      poll_id, player_id, invited_at, last_reminder_at,
      automatic_reminder_stage, automatic_reminder_due_at

    event_poll_submissions
      poll_id, player_id, submitted_at, updated_at

    event_poll_responses
      poll_id, option_id, player_id, response, updated_at

    event_poll_decisions
      id, poll_id, selected_by, selected_at, decision_note

    event_poll_decision_options
      decision_id, option_id

    event_participants
      ...
      status in invited | interested | accepted | declined
      confirmed_schedule_revision INTEGER
      participation_note TEXT NULL

`topic` verwendet eine interne Allow-List wie `date_range`, `location`, `duration`, `budget`,
`program`, `travel`, `catering`, `equipment` oder `custom`. `decision_key` verbindet die Runden
desselben Entscheidungsstrangs. Für eingebaute Vorlagen entspricht er standardmäßig dem Thema;
freie Abstimmungen erhalten einen validierten, eventweit eindeutigen Schlüssel. `response_mode` ist
`feasibility`, `single_choice` oder `multiple_choice`.

`option_payload_json` enthält ausschließlich vorlagenspezifische Zusatzdaten. Es wird nicht als
beliebiges, ungeprüftes JSON behandelt: Request- und Response-Schema validieren pro `topic` Typ,
Länge, Wertebereiche, URLs, Datumslogik und unbekannte Felder. Felder, die häufig gefiltert oder für
Integrität benötigt werden, bleiben normale Spalten oder erhalten eigene Tabellen.

`event_poll_submissions` trennt „bewusst ohne Auswahl abgegeben“ von „noch offen“. Antworten werden
je nach Modus so gespeichert:

- `feasibility`: genau ein Wert `can | if_needed | cannot` pro Option,
- `single_choice`: genau eine ausgewählte Option oder eine explizite Enthaltung,
- `multiple_choice`: null bis zur konfigurierten Höchstzahl ausgewählte Optionen plus Submission.

Wichtige Constraints:

- fortlaufende eindeutige `round_number` pro Event und `decision_key`,
- höchstens eine unentschiedene Runde (`open` oder `closed`) pro Event und `decision_key`,
- höchstens eine aktuelle `decided`-Runde pro Event und `decision_key`,
- eindeutige Position und fachlich eindeutige Option pro Runde,
- eindeutige Submission pro Runde und Person,
- eindeutige Antwort pro Runde, Option und Person,
- Antworten referenzieren eine Einladung derselben Runde,
- Entscheidungsoptionen referenzieren Optionen derselben Runde und beachten Einzel- oder
  Mehrfachwahl,
- Entscheidung und Eventfelder werden in einer Transaktion geändert; nur eine Terminentscheidung
  erhöht dabei zusätzlich die `schedule_revision`.

Terminoptionen verwenden weiterhin streng validierte lokale ISO-Kalenderdaten (`YYYY-MM-DD`).
Zeitpunkte wie Fristen und Erinnerungen werden als UTC-Millisekunden gespeichert. Die
Gruppenzeitzone mit MVP-Fallback `Europe/Berlin` bildet eine gewählte Terminoption auf das Event ab:

- `starts_at` ist der lokale Tagesbeginn von `starts_on` in UTC-ms,
- `ends_at` ist der Beginn des Tages nach `ends_on` in UTC-ms,
- eine als Datum eingegebene Frist endet lokal um 23:59:59,999.

Die Umrechnung bleibt über Sommer- und Winterzeitwechsel getestet. Browser-Parsing mit
`new Date('YYYY-MM-DD')` ist dafür nicht zulässig.

## API-Skizze

Der allgemeine Erstellungsweg akzeptiert fehlende Planungsfelder:

    POST   /api/events
    GET    /api/events/:eventId/polls
    POST   /api/events/:eventId/polls
    GET    /api/events/:eventId/polls/:pollId
    PATCH  /api/events/:eventId/polls/:pollId
    POST   /api/events/:eventId/polls/:pollId/options
    DELETE /api/events/:eventId/polls/:pollId/options/:optionId
    POST   /api/events/:eventId/polls/:pollId/invitees
    DELETE /api/events/:eventId/polls/:pollId/invitees/:playerId
    PUT    /api/events/:eventId/polls/:pollId/my-response
    POST   /api/events/:eventId/polls/:pollId/reminders
    POST   /api/events/:eventId/polls/:pollId/close
    POST   /api/events/:eventId/polls/:pollId/reopen
    POST   /api/events/:eventId/polls/:pollId/decide
    POST   /api/events/:eventId/polls/:pollId/cancel
    PUT    /api/events/:eventId/my-participation
    POST   /api/events/:eventId/participation-reminders

`PUT .../my-participation` erhält den vollständigen Zielzustand und optional eine kurze Notiz. Die
bisherigen `invitation/accept`- und `invitation/decline`-Endpunkte können während einer
Kompatibilitätsphase intern darauf abbilden, werden aber nicht als alleiniger Ziel-API-Vertrag
weitergeführt.

Es gibt weder einen `planning`-spezifischen Event-Endpunkt noch einen `convert-to-event`-Endpunkt.
Unpassende Zustände liefern 409, ungültige Eingaben 400 und unbekannte oder nicht sichtbare
Ressourcen 404. Alle Mutationen senden erst nach erfolgreichem Commit ein gruppengebundenes
Realtime-Signal. Push-Nachrichten bleiben persönlich.

## UI-Struktur

„Abstimmungen“ ist ein eigener Tab direkt unter „Orga“, auf derselben Navigationsebene wie
„Events“. Die Zuordnung zum Event wird nicht über verschachtelte Eventkarten versteckt, sondern im
Tab selbst deutlich gezeigt:

1. Eventauswahl beziehungsweise Eventfilter im Kopf,
2. „Meine offenen Abstimmungen“ mit noch fehlenden eigenen Antworten,
3. offene Abstimmungen des gewählten Events,
4. je Abstimmung Frist, Fortschritt, eigene Antwort und einklappbares Ergebnis,
5. Verwaltungsaktionen „Abstimmung starten“, „Schließen“, „Entscheiden“ und „Erinnern“,
6. entschiedene und abgebrochene Abstimmungen in einer einklappbaren Historie.

Der Tab ist für alle aktiven Personen sichtbar, die mindestens eine Abstimmung sehen dürfen. Seine
Position unter „Orga“ verleiht keine zusätzlichen Verwaltungsrechte; Erstellen und Entscheiden
bleiben serverseitig geschützt. Ein Link aus Event, Benachrichtigung oder Startseite öffnet den Tab
mit vorausgewähltem Event und fokussierter Abstimmung.

Die Eventdetailansicht behält Teilnahmeauswahl, Zusammenfassung „fest / interessiert / offen /
abgesagt“ und die optionalen Eventmodule. Sie zeigt nur eine kompakte Abstimmungszusammenfassung mit
Anzahl offener eigener Antworten und einen Link „Zu den Abstimmungen“, nicht den vollständigen
Abstimmungsbereich.

Beim Anlegen einer Abstimmung zeigt die UI zuerst die fünf häufigsten Vorlagen:

- Termin / Zeitraum,
- Ort / Unterkunft,
- Dauer,
- Budget / Preisrahmen,
- Eigene Abstimmung.

Weitere Vorlagen stehen unter „Mehr“. Eventart-Vorschläge dürfen die Reihenfolge anpassen, aber
keine Vorlage erzwingen.

Die Oberfläche verwendet bestehende Felder, Toggles, Statuschips, einklappbare Listen und
Design-System-Abstände. Auf dem Telefon stehen Optionen untereinander. Status sind textlich
beschriftet und nicht nur über Farbe erkennbar. „Interessiert“ und „Fest zugesagt“ müssen auch ohne
Farben eindeutig unterscheidbar sein.

Bei Entscheidungen und Änderungen unterscheidet die UI klar:

- „Bisheriger Stand“,
- „Abstimmung läuft“,
- „Entscheidung übernommen“,
- bei Terminänderung „Erneute Bestätigung erforderlich“,
- bei anderen Änderungen „Deine Zusage bleibt gültig“ mit sichtbarer Möglichkeit zur Änderung,
- „Für aktuellen Termin fest zugesagt“.

## Migration und Kompatibilität

Die bestehende Implementierung der integrierten Terminabstimmung bildet den Ausgangspunkt. Die
Generalisierung erfolgt in einer neuen fortlaufenden Migration und bewahrt alle produktiven Daten:

- `event_date_polls` werden `event_polls` mit `topic = 'date_range'` und
  `response_mode = 'feasibility'`,
- Optionen, Eingeladene, Antworten, Fristen, Erinnerungsstände und Rundenhistorie werden vollständig
  übernommen,
- `scheduled` wird im allgemeinen Modell zu `decided`, ohne die ausgewählte Terminoption zu
  verlieren,
- eine Submission wird für jede Person erzeugt, deren bisherige Terminantwort vollständig ist,
- `events.schedule_revision` und `event_participants.confirmed_schedule_revision` bleiben als
  terminbezogene Bestätigungslogik unverändert erhalten,
- `interested` wird dem Status-Constraint hinzugefügt; Bestandszeilen behalten ihren bisherigen
  Zustand,
- der bisherige `POST /api/events/planning` wird durch den allgemeinen Event-Endpunkt ersetzt und
  während der Frontend-Umstellung höchstens als schmaler Kompatibilitätsalias behalten,
- Basis- und Außerhalb-Events erhalten keine Abstimmungen und werden nicht als unvollständige
  Planungs-Events umgedeutet.

Da SQLite Constraint-Änderungen Tabellenneuaufbauten erfordern können, muss die Migration alle
Spalten, Constraints, Indizes, Trigger und Fremdschlüssel explizit bewahren. Legacy-Fixture,
Wiederholung, vollständiger Fremdschlüsselcheck und injizierter Fehler belegen idempotenten Lauf und
vollständigen Rollback.

Die Umstellung darf nicht gleichzeitig alte und neue Tabellen als zwei fachliche Wahrheiten
betreiben. Entweder liest und schreibt die Anwendung nach der Migration nur das allgemeine Modell,
oder eine zeitlich begrenzte Kompatibilitätsschicht besitzt eine klar getestete Schreibrichtung.

## Tests

Die Umsetzung umfasst mindestens:

- Integrationstests für alle drei Antwortmodi, Vorlagenvalidierung, Sichtbarkeit, Berechtigungen,
  Zustandsübergänge, Fristen und Erinnerungen,
- Tests, dass Termin, Ort, Dauer, Budget und mehrere freie Abstimmungen gleichzeitig offen sein
  können, aber pro `decision_key` nur eine unentschiedene Runde existiert,
- Tests für vollständige Submission, explizite Enthaltung und atomare Änderung der eigenen Antwort,
- Tests für stabile Empfehlungen, sichtbare Gleichstände und bewusste Entscheidungen,
- Paralleltests für Schließen, Wiederöffnen, Entscheiden und konkurrierende Terminrevisionen,
- Tests für `interested`, alle erlaubten Selbstwechsel und insbesondere spätere Absage nach fester
  Zusage,
- Tests, dass Interessierte und veraltete Zusagen weder Preis pro Kopf noch Tracking, Kapazität oder
  aktive Teilnehmerzahl beeinflussen,
- Tests, dass eine Absage aktives Tracking und Eventzuordnung beendet, Zahlungen aber erhält,
- Tests, dass nur ein Terminwechsel genau eine neue `schedule_revision` erzeugt und eine erneute
  Bestätigung verlangt,
- Tests, dass Änderungen an Ort, Dauer, Preis und anderen Planungswerten die Zusage gültig lassen,
  aber genau eine persönliche Änderungsnachricht pro betroffener Person erzeugen,
- Tests für idempotente Wiederholung fehlgeschlagener Änderungsnachrichten und für die
  Unterdrückung rein redaktioneller Benachrichtigungen,
- Tests für Owner-Vertretung und dafür, dass Verwalter keine fremde feste Zusage stillschweigend
  erzeugen,
- Migrationstests für bestehende Terminrunden, Bestandsstatus, Legacy-Datenbank, Wiederholung,
  Kaskaden und Rollback,
- E2E-Tests in zwei Browsern für den eigenen Orga-Tab, vorausgewählte Event-Deep-Links, Realtime,
  Tastatur, Touch, mobile Breite und Änderung der eigenen Teilnahme,
- Zeitzonentests für Terminoptionen über Sommer- und Winterzeitwechsel.

Vor Abschluss laufen im Serverbereich mindestens `npm run lint`, `npm run build`, `npm test`,
`npm run check:tokens` nach dem Staging, die einschlägigen E2E-Partitionen sowie der vorgeschriebene
Testlauf-Performance-Check.

## MVP und spätere Erweiterungen

### MVP des allgemeinen Abstimmungsbereichs

- ein einheitlicher Erstellungsweg für reguläre Events mit optional noch fehlenden Eckdaten,
- ein eigener Tab „Abstimmungen“ direkt unter „Orga“ mit Eventfilter und offenen eigenen Antworten,
- mehrere parallele Abstimmungen pro Event, aber höchstens eine offene Runde je
  Entscheidungsstrang,
- Vorlagen für Termin, Ort, Dauer und Budget sowie eine eigene Abstimmung,
- Antwortmodi Eignung, Einzelwahl und Mehrfachwahl,
- Frist, Erinnerungen, Ergebnisübersicht, bewusste Entscheidung und Historie,
- Teilnahmezustände offen, interessiert, fest zugesagt und abgesagt,
- jederzeitige eigene Änderung einschließlich späterer Absage,
- erneute Teilnahmebestätigung nur nach einem Terminwechsel,
- persönliche Information bei Änderungen an Ort, Dauer, Preis und anderen Planungsentscheidungen,
- Erhalt bestehender Zahlungen und Abstimmungshistorie,
- Migration der bereits gebauten Terminabstimmung in das allgemeine Modell.

### Später, nur bei tatsächlichem Bedarf

- Vorlagen für Programm, Verpflegung, Anreise, Ausstattung und Turnierformat,
- Uhrzeit-Slots und gemischte Datum-/Uhrzeitoptionen für kurze Events,
- Rangfolge, Bewertungsskalen, numerische Antworten und Freitext,
- Kapazitätsgrenzen, Warteliste und automatische Nachrückangebote,
- verborgene Antworten oder nur für die Verwaltung sichtbare Ergebnisse,
- externe Gäste ohne Respawn-Konto,
- Kalenderexport nach einer Terminentscheidung,
- Abhängigkeiten zwischen Abstimmungen, etwa Orte erst nach einer Budgetentscheidung,
- wiederverwendbare Event- und Abstimmungsvorlagen.

Bewusst nicht im MVP sind anonyme öffentliche Links, ein vollwertiger Formularbaukasten,
Kalender-Synchronisation und vollautomatische Entscheidungen.

## Abnahmekriterien

- Es gibt nur „Event anlegen“; weder Oberfläche noch Ziel-API erzeugen einen separaten
  Planungs-Event-Typ.
- Unter „Orga“ gibt es einen eigenen Tab „Abstimmungen“; ein Eventlink öffnet ihn mit dem richtigen
  Event und der richtigen Abstimmung.
- Das Event besitzt vom Beginn der Planung bis zur Abrechnung dieselbe ID.
- Ein Event ohne Termin, Ort oder Preis verursacht in keiner Ansicht ungültige Werte und kann weder
  Tracking noch aktive Eventzuordnung auslösen.
- Pro Event können Termin, Ort, Dauer und Budget unabhängig voneinander abgestimmt werden.
- Eine eingeladene Person kann alle unterstützten Antwortmodi per Tastatur und Touch beantworten
  und die Antwort bis zum Schließen ändern.
- Nicht eingeladene Konten erhalten für Detail- und Schreibzugriffe 404.
- Abstimmung und Teilnahme sind fachlich getrennt; keine Stimme erzeugt automatisch eine Zu- oder
  Absage.
- „Interessiert“ ist sichtbar, zählt aber nicht als feste Teilnahme, Kapazität oder Preiszahler.
- Eine Person kann nach einer festen Zusage selbst auf „Interessiert“ oder „Abgesagt“ wechseln.
- Eine Absage entfernt die Person sofort aus aktuellen Teilnehmer-, Preis- und Trackingabfragen,
  ohne Zahlungen oder Abstimmungshistorie zu löschen.
- Ein Terminwechsel aktualisiert Abstimmung, Eventzeitraum und `schedule_revision` genau einmal und
  atomar; frühere feste Zusagen müssen nur dann erneut bestätigt werden.
- Änderungen an Ort, Dauer, Preis oder anderen Planungswerten lassen feste Zusagen gültig und
  informieren die betroffenen Personen persönlich über den alten und neuen Stand.
- Eine neue Runde überschreibt keine frühere Runde und kann ohne Änderung des bisherigen
  Eventstands abgebrochen werden.
- Gleichzeitiges Entscheiden erzeugt genau ein Ergebnis; konkurrierende Requests erhalten 409.
- Optionen und Eingeladene lassen sich während `open` nach den festgelegten Kaskaden-, Audit- und
  Benachrichtigungsregeln ändern.
- Erinnerungen respektieren Mindestabstand, Antwortstatus und Friständerung.
- Deaktivierte oder gelöschte Ersteller blockieren die Planung nicht; ausschließlich der Owner
  erhält die definierte Vertretungsberechtigung.
- Die Migration erhält bestehende Terminrunden, Antworten, Termine, Zusagen und Zahlungen, läuft
  wiederholbar und rollt bei Fehler vollständig zurück.
- Abstimmungen, Entscheidungen und Teilnahmezustände aktualisieren sich in zwei offenen Browsern
  ohne Reload.
- Telefon- und Laptopansicht verursachen keinen horizontalen Seiten-Scroll.
