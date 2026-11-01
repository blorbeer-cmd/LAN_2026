# LAN-Punkte und Sieger-Tipps

Die Punktefunktion verwendet getrennte Konten für **Orga**, **Spielen**, **Wetten** und
**Wettguthaben**. Kategorie-Rohwerte und Wettguthaben werden nicht addiert.
Das [Zielkonzept](../KONZEPT-PUNKTE-WERTUNG.md) und der
[Implementierungsplan](../IMPLEMENTIERUNGSPLAN-PUNKTE-WERTUNG.md) unterscheiden die bereits
umgesetzte Wallet-Abrechnung (5a) von den noch offenen Marktregeln (5b), Kategorieplätzen
und der Gesamtwertung (6), Meldefunktion und einheitlichen Festschreibung.

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
dies legt die spätere Teilnehmerbasis N der Gesamtwertung nicht fest.

Orga- und Spielpunkte erhöhen kein Wettguthaben. Neue To-dos bringen fest 3 Orga-Punkte für
den ersten fremden Helfer; ein altes Orga-Budget, alte Belohnungsauszahlungen und individuelle
Wunschwerte sind als Finanzpfad abgeschaltet.

Das Konto zeigt Wettguthaben insgesamt, reservierte Einsätze und verfügbare Mittel. Ein offener
oder gesperrter Einsatz reserviert ausschließlich Wallet-Punkte. Die Wallet-Journalsumme ist
das verfügbare Guthaben; insgesamt verfügbar plus reserviert ergibt das gesamte Wettguthaben.
Der vollständige Wallet-Verlauf zeigt auch Reservierung, Änderung und Freigabe von Einsätzen.
Such- und Quellenfilter ändern nur die Liste, nicht die Kurve. Kategorie-Verläufe bleiben getrennt.

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

Bis zur Entscheidung über die vollständigen Zielregeln öffnen weiterhin Admins offizielle
Runden an ungespielten Zweier-Auslosungen, Turniermatches mit feststehenden Gegnern und auf
den Gesamtsieger eines noch nicht begonnenen Turniers. Auslosen allein öffnet keinen Markt.
Alle berechtigten Teilnehmer dürfen auf sich, ihr Team oder den Gegner tippen.

Die bisherigen konfigurierbaren Einsatz-/Tages-/Rundengrenzen bleiben vorläufig aktiv
(technische Anfangswerte 10/30/6). Die Tagesgrenze gilt pro Event in Europe/Berlin.
**Beschlossen sind inzwischen W1/W2/W5:** maximal 20 Punkte pro Person und Wettmarkt,
mindestens zwei regulär abgerechnete Tipps für eine Wettplatzierung und keine zusätzlichen
Tageslimits oder Höchstzahl von Wettrunden pro Event. Vollständig erstattete Märkte und
zurückgenommene Tipps zählen nicht zur Mindestzahl; Gewinne werden unabhängig davon ausgezahlt.
Diese Regeln sind technisch noch umzusetzen. Für Matches ist W4 ebenfalls beschlossen:
Der Ersteller entscheidet direkt beim Anlegen vor Spielbeginn über „Wetten zulassen“, ohne
zusätzliche Adminrolle. Bei ausgeschalteter Option darf kein anderer einen Markt für dieses
Match eröffnen. Bei Turnieren werden Wetten auf Turniersieger und einzelne Turnierspiele immer
ohne optionalen Freischalter angeboten. Die bestehenden Regeln zu Sichtbarkeit, feststehenden
Gegnern, Tippschluss und Spielbeginn gelten weiterhin. Auch diese Anbindungen stehen technisch
noch aus. Topf, Anzahl Tipps,
Einsätze je Ausgang und vorläufige Pool-Quoten sind schon vor Tippschluss sichtbar. Eine Quote
ist nur bei einem Einsatz auf diesen Ausgang berechenbar; neue Einsätze können sie verändern.
Die API veröffentlicht dabei keine individuellen fremden Tipps. Freie Zweiermatches sowie
Liga- und Gruppenspiele bieten „Unentschieden“ als regulär gewinnenden Tipp. K.-o.-Spiele und
Turniersieger-Märkte bieten ihn nicht; ältere Märkte behalten ihre ursprüngliche Auswahl.
Die neue Restverteilung bleibt der offenen Entscheidung in Paket 5b zugeordnet.
Eine Runde verbraucht dauerhaft einen Kontingentplatz. `maxRounds=0`
deaktiviert neue Wettrunden, ohne Kategorie-Gutschriften zu verhindern.

Pro Person und Runde gibt es einen Tipp. Bis zum Schließen lassen sich Auswahl und Einsatz
ändern oder der Tipp zurücknehmen. Annahme und Journalreservierung erfolgen gemeinsam;
parallele Einsätze können verfügbare Mittel nicht mehrfach verbrauchen. Bei negativem
verfügbarem Guthaben sind neue Tipps und Änderungen gesperrt. Eine vollständige Rücknahme
eines noch offenen Tipps bleibt möglich.

Die persönliche Öffnungsmitteilung nennt Event und Runde, berücksichtigt Einwilligung und
Stummschaltung und wird nicht doppelt gesendet. Mitspieler oder Admins schließen vor Spielbeginn,
alternativ greift die Frist. Ein Ergebnis bei noch offenen Tipps führt vorläufig zur Erstattung.
Der Hintergrundlauf arbeitet auch ohne offenen Browser. Nach Tippschluss sind Einsätze unveränderlich.

## Abrechnung und Korrektur

Der Pool besteht ausschließlich aus den Einsätzen. Gewinner erhalten ihn anteilig ohne Gebühr
oder Hausanteil. Die derzeitige Verteilung verwendet weiterhin den größten Nachkomma-Rest mit
stabiler Tipp-ID als Gleichstandsregel. Die Zielregel „Rest an den größten richtigen Einsatz“
ersetzt sie erst mit Paket 5b nach Klärung gleich großer größter Einsätze.

Auszahlung minus Einsatz wird atomar im Wallet und als Wett-Nettowert erfasst. Vollständige
Erstattung ergibt 0 Nettogewinn. Grundstock ist kein Wett-Nettogewinn. Die Auszahlungen müssen
in Summe exakt dem Pool entsprechen, einschließlich anonymisierter Tipps gelöschter Konten.
Ein Markt behält seinen kanonischen Journalvorgang über alle Revisionen; Wiederholung zahlt
nicht erneut aus. Wettstatus, Sportergebnis und Buchungen werden gemeinsam zurückgerollt,
wenn eine Teilbuchung scheitert.

Ein nicht am Markt wählbares Remis, fehlende Tipps auf das eingetretene Ergebnis, Einsätze
auf nur einen Ausgang und ein abgebrochener Wettbewerb führen zur vollständigen Erstattung.
Ein angebotenes Remis kann dagegen regulär gewinnen und wird genauso abgerechnet wie ein Sieger-Tipp.

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

## Vorläufige Auswertung und Abschluss

Kategorieansichten zeigen Rohwerte und Verlauf. Die frühere gemeinsame Kontosumme wird nicht
mehr als LAN-Gesamtwertung ausgegeben. Die einzelne LAN-Rangliste, Hall of Fame und Event-Export
verwenden bis Paket 6 vorläufig Spiel-Rohwerte. Klassische Sportstatistiken und Spielfilter
werten weiterhin dokumentierte Ergebnisse aus; sie buchen keine historischen Punkte ins Journal.
Gleiche Werte teilen sich den Rang; Namen bestimmen nur die Darstellung.

Der bisherige Abschluss speichert den vorläufigen Spielstand und sperrt weitere Punktebuchungen.
Offene oder gesperrte Runden verhindern ihn weiterhin. Begründetes Wiederöffnen und erneuter
Abschluss behalten die Versionen seit dem Neustart. Die endgültige Kategorie-/Gesamtwertung
mit Meldungen, automatischer Erstattung und einheitlichem Snapshot folgt in Paket 9.
