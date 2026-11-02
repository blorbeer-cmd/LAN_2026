# LAN-Punkte und Sieger-Tipps

Die Punktefunktion verwendet getrennte Konten für **Orga**, **Spielen**, **Wetten** und
**Wettguthaben**. Kategorie-Rohwerte und Wettguthaben werden nicht addiert.
Das [Zielkonzept](../KONZEPT-PUNKTE-WERTUNG.md) und der
[Implementierungsplan](../IMPLEMENTIERUNGSPLAN-PUNKTE-WERTUNG.md) beschreiben die umgesetzte
Wallet-Abrechnung (5a), Marktanbindungen (5b), Kategorieplätze und Gesamtwertung (6/7) sowie
die noch ausstehende Meldefunktion und weitergehenden Abschlussregeln (8/9).

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

Beim Anlegen eines Zweiermatches entscheidet der Ersteller über **Wetten erlauben**. Die Wahl
wird auch bei Captain Drafts und Rematches gespeichert. Dafür braucht der Ersteller keine
zusätzliche Adminrolle. Bei einem Nein entsteht kein Markt; auch die weiterhin administrative
separate Markt-API kann die Entscheidung nicht umgehen. Turniersieger-Märkte und einzelne
Turniermatches mit feststehenden Gegnern werden immer automatisch angeboten, ohne Freischalter.
Bei jeder neuen Anlage ist Wetten für Zweiermatches, Drafts mit zwei Captains und Rematches
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
Gegnern, Tippschluss und Spielbeginn gelten weiterhin. Topf, Anzahl Tipps,
Einsätze je Ausgang und vorläufige Pool-Quoten sind schon vor Tippschluss sichtbar. Eine Quote
ist nur bei einem Einsatz auf diesen Ausgang berechenbar; neue Einsätze können sie verändern.
Die API veröffentlicht dabei keine individuellen fremden Tipps. Freie Zweiermatches sowie
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
Fristen bleiben wirksam. Ein Ergebnis bei noch offenen Tipps führt zur Erstattung.
Der Hintergrundlauf arbeitet auch ohne offenen Browser. Nach Tippschluss sind Einsätze unveränderlich.
Erzeugung der Quelle und ihrer Märkte laufen atomar; Benachrichtigungen folgen erst nach Commit.
Nach Eventende sind neue Tipps gesperrt, während Ergebnisse und Verlauf sichtbar bleiben.

## Abrechnung und Korrektur

Der Pool besteht ausschließlich aus den Einsätzen. Gewinner erhalten ihn anteilig ohne Gebühr
oder Hausanteil. Auszahlungen werden zunächst ganzzahlig abgerundet. Restpunkte erhalten
die größten Nachkommaanteile; bei gleichen Anteilen gewinnt der früher abgegebene Tipp.
Maßgeblich ist dessen erste Speicherung, bei gleichem Zeitstempel die Einfügereihenfolge.
Die vorher geplante Vergabe an den größten Einsatz entfällt. Die Nullsumme bleibt erhalten;
die Gewichtung der Kategorien wird unabhängig davon durch ihre Platzpunkte geregelt.

Auszahlung minus Einsatz wird atomar im Wallet und als Wett-Nettowert erfasst. Vollständige
Erstattung ergibt 0 Nettogewinn. Grundstock ist kein Wett-Nettogewinn. Die Auszahlungen müssen
in Summe exakt dem Pool entsprechen, einschließlich anonymisierter Tipps gelöschter Konten.
Ein Markt behält seinen kanonischen Journalvorgang über alle Revisionen; Wiederholung zahlt
nicht erneut aus. Wettstatus, Sportergebnis und Buchungen werden gemeinsam zurückgerollt,
wenn eine Teilbuchung scheitert.

Ein nicht am Markt wählbares Remis, fehlende Tipps auf das eingetretene Ergebnis, Einsätze
auf nur einen Ausgang und ein abgebrochener Wettbewerb führen zur vollständigen Erstattung.
Ein angebotenes Remis kann dagegen regulär gewinnen und wird genauso abgerechnet wie ein Sieger-Tipp.
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
Wettguthaben wird niemals hinzuaddiert. Reguläre veröffentlichte LANs werden gewertet und
bleiben nach Ende sichtbar; Testevents, Entwürfe, abgesagte Events und andere Eventtypen sind
ausgeschlossen. Klassische Sportstatistiken und Spielfilter werten weiterhin dokumentierte
Spielergebnisse aus; sie buchen keine historischen Punkte ins Journal.

Der bestehende Abschluss speichert N, Teilnehmerliste, Kategorienwerte und Gesamtstand und sperrt weitere Punktebuchungen.
Offene oder gesperrte Runden verhindern ihn weiterhin. Begründetes Wiederöffnen und erneuter
Abschluss behalten die Versionen seit dem Neustart. Meldungen, automatische Erstattung und
weitergehende Regeln der einheitlichen Festschreibung folgen in Paket 9.
