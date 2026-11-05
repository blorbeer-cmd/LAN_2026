# LAN-Punkte und Sieger-Tipps

Die Punktefunktion verwendet getrennte Konten für **Orga**, **Spielen**, **Wetten** und
**Wettguthaben**. Kategorie-Rohwerte und Wettguthaben werden nicht addiert.
Das [Zielkonzept](../KONZEPT-PUNKTE-WERTUNG.md) und der
[Implementierungsplan](../IMPLEMENTIERUNGSPLAN-PUNKTE-WERTUNG.md) beschreiben die umgesetzte
Wallet-Abrechnung (5a), Marktanbindungen (5b), Kategorieplätze und Gesamtwertung (6/7) sowie
Punktefehler-Meldungen und endgültigen Abschluss (8/9).

## Neustart ohne Punkteübernahme

Migration 131 setzt die bisherigen Punkte aller bestehenden Events einmalig zurück. Es werden
keine Orga-, Spiel- oder Wettpunkte übernommen. Alte Kontobuchungen, To-do-Belohnungszusagen,
Wetten einschließlich Reservierungen und Punkte-Endstände entfallen. Spiele, Aufgaben,
Bestellungen, Umfragen und persönliche Angaben bleiben erhalten. Historisch abgeschlossene
Quellen und schon erfüllte persönliche Boni erzeugen beim Hintergrundabgleich keine neue
Gutschrift. Neue Vorgänge sammeln regulär Punkte. Offene Altaufgaben verwenden die feste
3-Punkte-Regel, bereits abgeschlossene Aufgaben bekommen keinen nachträglichen Bonus.

Der Reset läuft atomar mit der Startvergabe. Ein Fehler rollt alles zurück; ein dauerhafter
Marker verhindert eine Wiederholung. Ein weiterer Start erhält danach verdiente Punkte.
Dies beschreibt die beschlossene Upgrade-Migration, keine bereits ausgeführte produktive Änderung.

## Wettguthaben

Jeder berechtigte Teilnehmer erhält einmalig **fest 100 Wettpunkte je Event**, auch bei später
Zusage. Der Betrag ist nicht konfigurierbar. Austreten und erneut Zusagen zahlen nicht erneut.
Die technische Wettteilnahme verwendet weiterhin aktive bestätigte Teilnehmer ohne Testkonten;
dies ist auch die beschlossene Teilnehmerbasis N der laufenden Gesamtwertung. Späte Zusagen
zählen sofort. Austritte entfernen die Person aus der laufenden Rangliste, erhalten aber ihren
Verlauf. Beim Abschluss werden Teilnehmerbasis und N gemeinsam mit dem Ergebnis festgehalten.

Orga- und Spielpunkte erhöhen kein Wettguthaben. Neue To-dos bringen fest 3 Orga-Punkte für
den ersten fremden Helfer; ein altes Orga-Budget, alte Belohnungsauszahlungen und individuelle
Wunschwerte sind als Finanzpfad abgeschaltet.

Das Konto zeigt Wettguthaben insgesamt, reservierte Einsätze und verfügbare Mittel. Ein offener
oder gesperrter Einsatz reserviert ausschließlich Wallet-Punkte. Die Wallet-Journalsumme ist
das verfügbare Guthaben; insgesamt verfügbar plus reserviert ergibt das gesamte Wettguthaben.
Der vollständige Wallet-Verlauf zeigt auch Reservierung, Änderung und Freigabe von Einsätzen.
Ein gemeinsamer Punkteverlauf bietet die Kontoauswahl Orga, Spielen, Wetten und Wettguthaben.
Such- und Quellenfilter ändern nur die Liste, nicht die Kurve des ausgewählten Kontos. Die
Buchungen der Konten bleiben getrennt; nur Wettguthaben bietet den Quellenfilter.

## Anzeige während des Events steuern

Admins und der gespeicherte Event-Ersteller steuern unter **Events & Gruppen → Event → LAN-Punkte**
die Anzeige. Der Ersteller erhält durch diese Rolle keine Finanz- oder Teilnehmerrechte.
Gleichzeitige Änderungen derselben Anzeigeversion werden abgewiesen.

Ausblenden entfernt Punktekonto, Verlauf, Ranglisten, Home-/Profil-Verweise, Wettbereiche und
Wettmitteilungen für Teilnehmer. Direkte Teilnehmer-API-Zugriffe sind gesperrt. Die administrative
Punkteverwaltung bleibt erreichbar. Automatische Kategorie-Gutschriften und bestehende Wetten
werden weiter abgewickelt; die Sichtbarkeit setzt nichts zurück. Neue Tipps, Änderungen und
neue Runden sind während des Ausblendens gesperrt. Bereits ausgelieferter Web-Push lässt sich
auf Geräten nicht zurückrufen. Der Kiosk zeigt Ergebnisse weiterhin ohne Punkte.

## Wetten am Match und Turnier

Beim Anlegen eines Matches mit mindestens zwei Teams entscheidet der Ersteller über **Wetten erlauben**. Die Wahl
wird auch bei Captain Drafts und Rematches gespeichert. Dafür braucht der Ersteller keine
zusätzliche Adminrolle. Bei einem Nein entsteht kein Markt; auch die weiterhin administrative
separate Markt-API kann die Entscheidung nicht umgehen. Turniersieger-Märkte und einzelne
Turniermatches mit feststehenden Gegnern werden immer automatisch angeboten, ohne Freischalter.
Bei jeder neuen Anlage ist Wetten für Matches, Drafts mit mindestens zwei Captains und Rematches
vorbelegt erlaubt. Der Ersteller kann die Option ausschalten. Eine fehlende API-Angabe
verwendet denselben Standard; gespeicherte Entscheidungen werden nicht nachträglich geändert.
Alle berechtigten Teilnehmer dürfen auf sich, ihr Team oder den Gegner tippen.

**W1/W5 sind umgesetzt:** maximal 20 Punkte pro Person und Wettmarkt, keine zusätzlichen
Tageslimits und keine Höchstzahl von Wettrunden pro Event. Alte gespeicherte Konfigurationswerte
begrenzen keine Wetten mehr; die API zeigt Tages-/Rundenlimits als `null`.
W2 verlangt mindestens zwei regulär abgerechnete Tipps für eine Wettplatzierung.
Vollständig erstattete Märkte und
zurückgenommene Tipps zählen nicht zur Mindestzahl; Gewinne werden unabhängig davon ausgezahlt.
Die persönliche API liefert die Anzahl regulärer Abrechnungen und das Erreichen der Mindestzahl;
die Kategorieplatzierung ist angebunden. Für Matches ist W4 ebenfalls beschlossen:
Der Ersteller entscheidet direkt beim Anlegen vor Spielbeginn über „Wetten zulassen“, ohne
zusätzliche Adminrolle. Bei ausgeschalteter Option darf kein anderer einen Markt für dieses
Match eröffnen. Bei Turnieren werden Wetten auf Turniersieger und einzelne Turnierspiele immer
ohne optionalen Freischalter angeboten. Die bestehenden Regeln zu Sichtbarkeit, feststehenden
Gegnern, Tippschluss und Spielbeginn gelten weiterhin. Topf und Einsätze je Ausgang sind schon
vor Tippschluss sichtbar. Auf Nutzerentscheidung werden Quoten vollständig aus der Oberfläche
entfernt, einschließlich Match, Turnier, LAN-Punkte, Tippdialog und Hilfetext.
Die API veröffentlicht dabei keine individuellen fremden Tipps. Freie Matches mit zwei oder mehr Teams sowie
Liga- und Gruppenspiele bieten „Unentschieden“ als regulär gewinnenden Tipp. K.-o.-Spiele und
Turniersieger-Märkte bieten ihn nicht; ältere Märkte behalten ihre ursprüngliche Auswahl.
Eine neue Runde verbraucht keinen Kontingentplatz. Auch ein gespeichertes altes `maxRounds=0`
deaktiviert keine neuen Wetten mehr. Sichtbarkeit und Festschreibung behalten ihre Wirkung.

Pro Person und Runde gibt es einen Tipp. Bis zum Schließen lassen sich Auswahl und Einsatz
ändern oder der Tipp zurücknehmen. Annahme und Journalreservierung erfolgen gemeinsam;
parallele Einsätze können verfügbare Mittel nicht mehrfach verbrauchen. Bei negativem
verfügbarem Guthaben sind neue Tipps und Änderungen gesperrt. Eine vollständige Rücknahme
eines noch offenen Tipps bleibt möglich.

Die persönliche Öffnungsmitteilung nennt Event und Runde, berücksichtigt Einwilligung und
Stummschaltung und wird nicht doppelt gesendet. Neue automatische Märkte bleiben bis zur
ausdrücklichen Startaktion offen. Mitspieler oder Admins schließen vor Spielbeginn; beim
ersten Turnierspiel wird zugleich der Gesamtsieger-Markt geschlossen. Bestehende explizite
Fristen bleiben wirksam. Wird bei noch offenen Tipps ein Ergebnis eingetragen, schließt dies
die Tippabgabe und rechnet die bereits angenommenen Tipps regulär ab. Ergebnis, Schließung
und Abrechnung sind atomar; spätere Tipps werden abgewiesen. Das erste Turnierergebnis
schließt auch den Gesamtsieger-Markt, dessen Abrechnung bis zum Turnierende wartet.
Der Hintergrundlauf arbeitet auch ohne offenen Browser. Bei geschlossener Tippabgabe sind Einsätze unveränderlich.
Mitspieler und Admins können eine manuell geschlossene Tippabgabe vor dem Ergebnis wieder öffnen.
Dabei bleiben Einsätze und Wallet unverändert; auch ein leerer oder einseitiger Topf bleibt beim
manuellen Schließen zunächst gesperrt und wird erst mit dem Ergebnis oder beim LAN-Abschluss
abgerechnet beziehungsweise erstattet. Eine bereits abgelaufene feste Frist, ein begonnenes oder
beendetes Turnier und eine festgeschriebene Wertung lassen sich damit nicht umgehen. Der
Turniersieger-Markt bleibt geschlossen, solange ein Turnierspiel als gestartet markiert ist.
Das Wiederöffnen und sein Audit werden atomar gespeichert; zwei gleichzeitige Versuche ergeben
200/409. Bereits abgerechnete oder erstattete Märkte können nicht wieder geöffnet werden. Das gilt
auch für bereits bezahlte Pools, die nach einer Ergebniskorrektur wieder auf ein Ergebnis warten.
Der Sekundentakt gleicht nur Events mit fälliger Frist ab; ohne solche Frist nimmt er keine
Schreibsperre für einen Quellenabgleich. Beim Start und alle 30 Sekunden läuft zusätzlich ein
eventweise isolierter Wiederherstellungsabgleich. Fehler eines Events halten andere Events
nicht auf; dauerhaft fehlerhafte Quellen werden bis zur Erholung nur einmal protokolliert.
Erzeugung der Quelle und ihrer Märkte laufen atomar; Benachrichtigungen folgen erst nach Commit.
Der Abruf des Punktekontos berechnet keine Ansprüche neu und schreibt keine Punkte.
Teilnahme-/Einstellungsschreibzugriffe sowie Reaktivierung, Aktivierung der Mitgliedschaft
und der Wechsel vom Testkonto zum normalen Konto buchen fehlendes Startguthaben über Datenbank-Trigger;
Quellenänderungen und der Prozessstart synchronisieren die Kategorieansprüche.
Migration 134 ergänzt diese Aktivierungspfade und finanziert bereits übersehene berechtigte
Konten offener Wertungen einmalig nach. Bestehende Guthaben, Einsätze und abgeschlossene
Wertungen bleiben erhalten; es gibt keinen erneuten Reset und keine zweite Startgutschrift.
Während der Festschreibung neu berechtigte Konten werden erst beim begründeten Wiederöffnen
finanziert. Die fehlende Startgutschrift und das Wiederöffnen bilden eine gemeinsame Transaktion;
frühere Endstände bleiben unverändert.
Nach Eventende sind neue Tipps gesperrt, während Ergebnisse und Verlauf sichtbar bleiben.

## Abrechnung und Korrektur

Der Pool besteht ausschließlich aus den Einsätzen. Der Nettogewinn ist je Person auf den eigenen
Einsatz begrenzt. Umverteilt wird der kleinere Betrag aus Gewinner-Einsätzen und allen übrigen
Einsätzen. Gewinner erhalten ihren Einsatz plus anteiligen Gewinn; Verlierer bekommen ihren
Einsatz abzüglich des anteiligen Verlustes zurück. Bei 1 Punkt gegen 15 und einem Sieg der
1-Punkt-Wette sind die Auszahlungen 2 und 14 (Netto +1/−1). Es entstehen keine Punkte, keine
Gebühren und kein Hausanteil. Die Oberflächenänderung verändert die Abrechnungsregel nicht.

Gewinne und Verluste werden auf beiden Seiten getrennt ganzzahlig abgerundet. Restpunkte erhalten
jeweils die größten Nachkommaanteile; bei gleichen Anteilen entscheidet der früher abgegebene Tipp.
Maßgeblich ist dessen erste Speicherung, bei gleichem Zeitstempel die Einfügereihenfolge.
Die vorher geplante Vergabe an den größten Einsatz entfällt. Die Nullsumme bleibt erhalten;
die Gewichtung der Kategorien wird unabhängig davon durch ihre Platzpunkte geregelt.
Teilrückzahlungen überschüssiger Einsätze sind reguläre Abrechnungen und zählen zur Mindestzahl.

Migration 135 speichert die Regel am Markt. Neue und noch nie abgerechnete offene/gesperrte
Märkte offener Wertungen erhalten die Gewinnbegrenzung. Bereits abgerechnete oder erstattete
Märkte, frühere Finanzkorrekturen und festgeschriebene Wertungen behalten die bisherige Poolregel,
auch bei späterer Neuberechnung. Migration und Wiederholung verändern keine Guthaben,
Reservierungen, Auszahlungen oder Journaleinträge. Historische Berechnungen bleiben über die
API unter ihrer gespeicherten Regel lesbar.

Auszahlung minus Einsatz wird atomar im Wallet und als Wett-Nettowert erfasst. Vollständige
Erstattung ergibt 0 Nettogewinn. Grundstock ist kein Wett-Nettogewinn. Die Auszahlungen müssen
in Summe exakt dem Pool entsprechen, einschließlich anonymisierter Tipps gelöschter Konten.
Ein Markt behält seinen kanonischen Journalvorgang über alle Revisionen; Wiederholung zahlt
nicht erneut aus. Wettstatus, Sportergebnis und Buchungen werden gemeinsam zurückgerollt,
wenn eine Teilbuchung scheitert.

Ein nicht am Markt wählbares Remis, fehlende Tipps auf das eingetretene Ergebnis, Einsätze
auf nur einen Ausgang und ein abgebrochener Wettbewerb führen zur vollständigen Erstattung.
Ein angebotenes Remis kann dagegen regulär gewinnen und wird genauso abgerechnet wie ein Sieger-Tipp.
Bei freien Matches gilt dieselbe Ergebnisinterpretation wie für Spielpunkte: vollständige
Teamränge haben Vorrang vor einem separaten Siegerfeld, ein geteilter erster Rang gilt als Remis.
Ein geteilter Turniersieg ist im Gesamtsieger-Markt nicht wählbar und führt deshalb zur
Erstattung. Die Turniertitel und Platzierungsboni bleiben für alle gleichplatzierten Sieger erhalten.

**W6:** Finanzkorrekturen erfolgen ausschließlich über begründete Markt-Neuberechnung oder
Storno. Einseitige Wallet-/Wettänderungen über die allgemeine Journal-Korrektur oder den alten
Entzugsendpunkt sind gesperrt. Eigene administrative Marktkorrekturen bleiben erlaubt.
Sie brauchen eine aktive Adminrolle, Begründung und bei bereits abgerechneten Runden die
aktuelle Abrechnungsversion. Eine parallele veraltete Korrektur erhält 409. Journal und
Admin-Protokoll bleiben nachvollziehbar; die Nullsumme bleibt erhalten.

Bereits weiterverwendete Gewinne können nach Korrektur negative verfügbare Mittel erzeugen.
Andere reservierte Tipps werden dabei nicht stillschweigend verändert. Bezahlte Wettbewerbe
und kaskadierende Kataloglöschungen bleiben bis zum ausdrücklichen Storno geschützt.
Persönlicher Datenschutzexport und Kontolöschung berücksichtigen Journal und Wettquellen.

## Kategorienwertung und Abschluss

Kategorieansichten zeigen Rohwert, Rang, Platzpunkte und Verlauf. Nur positive Rohwerte erhalten
einen Platz, bei Wetten zusätzlich erst nach zwei regulären Abrechnungen. Platzpunkte sind
N minus Rang plus 1; N umfasst alle wertungsberechtigten Event-Teilnehmer. Gleiche Rohwerte
teilen den besseren Rang, zum Beispiel 1/2/2/4. Die Summe der drei Kategorien ergibt die
Gesamtwertung. Rangliste, Hall of Fame und Event-Export lesen dieselbe Berechnung und erhalten
geteilte Gesamtplätze und Kategoriesieger. Ohne wertbare Ergebnisse gibt es keinen Sieger.
Die LAN-Rangliste behält die Spielauswahl und „Ergebnis eintragen“. Ein ausgewähltes Spiel
zeigt weiterhin die klassische Spielwertung; „Alle Spiele“ führt zurück zu den LAN-Kategorien.
Wettguthaben wird niemals hinzuaddiert. Reguläre veröffentlichte LANs werden gewertet und
bleiben nach Ende sichtbar; Testevents, Entwürfe, abgesagte Events und andere Eventtypen sind
ausgeschlossen. Klassische Sportstatistiken und Spielfilter werten weiterhin dokumentierte
Spielergebnisse aus; sie buchen keine historischen Punkte ins Journal.

Der bestehende Abschluss speichert N, Teilnehmerliste, Kategorienwerte und Gesamtstand und sperrt weitere Punktebuchungen.
Offene oder gesperrte Runden verhindern ihn weiterhin. Begründetes Wiederöffnen und erneuter
Abschluss behalten die Versionen seit dem Neustart. Meldungen, automatische Erstattung und
weitergehende Regeln der einheitlichen Festschreibung folgen in Paket 9.

## Kompakte Punkte- und Wettansichten

Am Event steht die Sichtbarkeit als kompakte Checkbox „LAN-Punkte anzeigen“ neben den
Punktefehler-Meldungen. In der Punkteverwaltung gibt es keinen zweiten Sichtbarkeitsblock.
To-do-Zeilen, -Formulare und -Details wiederholen die einheitliche Punktevergütung nicht.

Die LAN-Übersicht bietet getrennte einklappbare Ranglisten für Orga, Spielen, Wetten und den
Gesamtstand. Jede Kategorie zeigt die eigenen „Punkte“, den Rang und die „Platzpunkte“; die Rangliste
verwendet dieselben berechtigten Plätze wie die Gesamtwertung. Verläufe und Diagramme lassen
sich aufklappen; die LAN-Punkteansicht enthält keine Spieleliste. Seltenere Informationen stehen in Details oder der bestehenden Hilfe.

„Wetten“ steht im Header von Matchkarten, auch bei geschlossener Spielkarte. In der
Turnieransicht stehen Turniersiegertipp und „Turnierspiele tippen“ direkt unter Titel und
Turnierinfos. Turnierbaum, Liga- und Gruppenzeilen enthalten keine Wettbuttons.
Ein einzelnes verfügbares Angebot ist ein direkter Button, erst mehrere sind ein Dropdown.
Punktefehler-Meldungen stehen in den Tippdetails; ihre asynchrone Freigabe erzeugt kein Menü
mit nur einem sichtbaren Eintrag. Teilnahme und Adminrechte bestimmen weiterhin, ob neben
der Tippabgabe auch Schließen, Wiederöffnen oder Finanzkorrekturen angeboten werden.

Der Tippdialog nennt „Sieger tippen“ oder „Turniersieger tippen“ und zeigt kurze Angaben zu
Spiel, Turnier und Runde. Die Teamnamen stehen in der Auswahl und werden in der Kontextzeile
nicht wiederholt. Die Teamauswahl bei „Sieger tippen“ trägt die Beschriftung „Sieger“.
Im Turniermodal wählt man zuerst Runde beziehungsweise Gruppe und dann ein Spiel mit
feststehenden Teams. Turniersieger und Spiel um Platz 3 sind eigene Einträge. Spielauswahl
und Tippstatus nennen auch vorhandene eigene Tipps. Entwürfe und das zuletzt gewählte Spiel
je Runde bleiben erhalten. „Speichern & weiter“ führt zum nächsten noch offenen, noch nicht
getippten Markt und berücksichtigt auch frühere Runden der Auswahl. Schließen, Wiederöffnen
und begründete Erstattung/Storno des gewählten Spiels bleiben entsprechend der bisherigen
Mitspieler-/Adminrechte im Modal erreichbar. Bereits abgegebene Tipps bleiben änderbar, solange der jeweilige Markt offen ist; abgeschlossene Märkte
zeigen die eigenen Details. Quoten werden nirgends angezeigt. Einsätze und Regeln bleiben über
den Dialog zugänglich. Neue Wettmenüs beginnen geschlossen und öffnen die Spielkarte nicht.
Die geschützte Punkte-API liefert dafür den Turnierbezug einschließlich Spiel/Runde; es werden
keine individuellen fremden Tipps offengelegt.

Das Filtermenü im Match-Bereich verwendet dieselben Überschriften, Chiplisten und Filterchips
wie der Spielekatalog: Art, eigene Beteiligung und Tippstatus
sind kombinierbar, aktive Filter werden gezählt und lassen sich zurücksetzen. Die Art gilt für
offene und historische Spiele, der Tippstatus nur für offene Spiele. „Noch offen“ setzt
einen offenen Markt ohne eigenen Tipp voraus, „Abgegeben“ einen vorhandenen eigenen Tipp.
Bei Turnieren genügt ein passender Markt. Aktive Tippstatus-Chips lassen sich durch erneutes
Anklicken abwählen. Die laufende Turnierübersicht bleibt unabhängig.
Die Auswahl oder eine leere Trefferliste ändert keine Aufklappzustände.

Live-Aktualisierungen behalten die bisherigen Daten bis zur Antwort, die Scrollposition und
geöffnete Bereiche. Neue Spielbuchungen speichern die erreichte Platzierung im Anlass; die
Buchungsdetails zeigen sie ausdrücklich. Historische Einträge ohne diese Angabe erhalten keine
nachträglich erfundene Platzierung. „Punktefehler melden“ steht in Buchungs- und Ergebnisdetails,
aber nicht in den Formularen zum Eintragen oder Korrigieren von Ergebnissen.
