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
dies ist auch die beschlossene Teilnehmerbasis N der laufenden Gesamtwertung. In Testevents zählen
zusätzlich die Testkonten, damit Admins den Ablauf mit den Test-Identitäten proben können. Späte Zusagen
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
neue Runden sind während des Ausblendens gesperrt. Beim Einblenden entstehen die Märkte bereits
wartender Wettbewerbe sofort, nicht erst beim nächsten Wiederherstellungsabgleich. Bereits ausgelieferter Web-Push lässt sich
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
entfernt, einschließlich Match, Turnier, LAN-Punkte, Tippdialog und Hilfetext. Auch eine
Gewinnschätzung („bei Sieg etwa +X P.“) entfällt, weil sie faktisch eine Quote wäre; sichtbar ist
nur die feste Obergrenze „Gewinn höchstens in Höhe deines Einsatzes“.
Fremde Tipps sind nach Nutzerentscheidung zu #755 (Stufe 3) sofort mit Namen sichtbar: Die
Punkte-API nennt je Ausgang die Tippenden mit Einsatz (`tippers`). Einsätze gelöschter Konten
bleiben ohne Namen. Freie Matches mit zwei oder mehr Teams sowie
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
Stummschaltung und wird nicht doppelt gesendet. Für eine Auslosung geht sie erst 30 Sekunden nach
dem Auslosen hinaus; wird in dieser Zeit neu ausgelost, erhält nur die behaltene Aufstellung eine
Mitteilung. Märkte, die gemeinsam für ein Turnier öffnen, teilen sich eine Mitteilung („6 Spiele
und der Turniersieger“). Sie wird zurückgezogen, sobald keiner dieser Turniermärkte mehr Tipps
annimmt. Später einzeln öffnende Turnierspiele erhalten eine eigene Mitteilung.

Wird für dasselbe Spiel und dieselben Spieler erneut „Teams auslosen“ gewählt, verwirft das die
zuvor angezeigte Auslosung ohne Ergebnis: Sie bietet dauerhaft keine Wetten mehr an, auch wenn
die LAN-Punkte gerade ausgeblendet sind und noch kein Markt besteht. Ein offener Markt schließt,
angenommene Tipps werden erstattet. Eine Auslosung für andere Spieler oder ein anderes Spiel, eine bereits geschlossene
Tippabgabe und eine Auslosung mit Ergebnis bleiben unberührt. Neue automatische Märkte bleiben bis zur
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
Migration 136 erweitert dieselben Trigger auf Testkonten in Testevents und finanziert deren
fehlendes Startguthaben in offenen Wertungen einmalig nach.
Während der Festschreibung neu berechtigte Konten werden erst beim begründeten Wiederöffnen
finanziert. Die fehlende Startgutschrift und das Wiederöffnen bilden eine gemeinsame Transaktion;
frühere Endstände bleiben unverändert.
Nach Eventende sind neue Tipps gesperrt, während Ergebnisse und Verlauf sichtbar bleiben.

Ändert sich die Aufstellung eines Wettbewerbs vor dem Spiel, etwa durch Verschieben eines Spielers
im Feinschliff oder durch ein korrigiertes Vorrundenspiel im K.-o.-Baum, gilt:

- Ohne Tipps übernimmt der bestehende Markt die neue Aufstellung. Link und Mitteilung bleiben gültig.
- Ein offener Markt mit Tipps wird vollständig erstattet. Im selben Schritt öffnet für dieselbe
  Auslosung beziehungsweise Partie ein neuer Markt mit neuer Mitteilung, sobald beide Seiten
  feststehen. Eine explizite Frist des ersetzten Marktes gilt für den neuen Markt weiter. Tipps auf
  den ersetzten Markt werden abgewiesen. Er bleibt nur im Punkteverlauf.
- Ein bereits geschlossener Markt mit Tipps oder abgelaufener Frist wird erstattet; die Tippabgabe
  bleibt geschlossen.

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

Eine Ergebniskorrektur berechnet nicht nur abgerechnete Märkte neu, sondern auch Märkte, die
wegen des eingetragenen Ergebnisses erstattet wurden und Tipps auf mindestens zwei Ausgängen
haben. Trifft das korrigierte Ergebnis einen getippten Ausgang, wird der Markt regulär abgerechnet.
Diese Korrektur verlangt wie bei abgerechneten Märkten einen Admin mit Begründung. Märkte, die nach
keiner Korrektur auszahlen können, sowie Admin-Erstattungen und Stornos bleiben unverändert.
Migration 137 speichert dafür den Erstattungsgrund und erlaubt je Quelle einen neuen Markt nach
einem ersetzten. Bestehende Märkte, Tipps und Buchungen bleiben unverändert.

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
Wettguthaben wird niemals hinzuaddiert. Veröffentlichte LANs werden gewertet und bleiben nach
Ende sichtbar; Entwürfe, abgesagte Events und andere Eventtypen sind ausgeschlossen. Testevents
lassen sich wie reguläre LANs werten, bleiben aber wie alle Testdaten außerhalb des Admin-Modus
samt Rangliste, Hall of Fame und Export unsichtbar. Klassische Sportstatistiken und Spielfilter werten weiterhin dokumentierte
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
sich aufklappen; die LAN-Punkteansicht enthält keine Spieleliste, nur die Tippübersicht. Seltenere Informationen stehen in Details oder der bestehenden Hilfe.

Die Wettaktion steht im Header von Matchkarten, auch bei geschlossener Spielkarte. Ein einzelnes
Angebot behält seine Statusbeschriftung („Jetzt tippen“, „Tipp ändern“, „Tippdetails“), erst
mehrere bilden das Menü „Wetten“. Mitspieler und Admins starten ein Match über die eigene
Aktion „Spiel starten“ mit Bestätigung; sie schließt die Tipps für alle und steht nicht mehr
neben „Jetzt tippen“ im Menü. Die Metazeile der Karte nennt den Stand: „Tipps offen“,
„Tipps geschlossen“ oder „Abgerechnet“, Topf, Tippanzahl und den eigenen Tipp mit Team und
Einsatz beziehungsweise nach der Abrechnung den Nettowert. Die Kachel „Ohne Ergebnis“ und der
Tippfilter umfassen alle Spiele; die Spielauswahl steuert nur das nächste Auslosen, die Historie
bleibt je Spiel. In der Turnieransicht steht genau einmal „Tipps öffnen“ beziehungsweise
„Wetten“ direkt unter Titel und Turnierinfos. Turniersieger
und einzelne Spiele wählt man im gemeinsamen Modal aus; im Match-Bereich führt die
Turnierkachel in dasselbe Modal. Der Einstieg bleibt auch ohne Turniersiegermarkt verfügbar,
sobald Spielmärkte existieren, etwa nach dem Einblenden eines bereits gestarteten Turniers.
Es wird kein verspäteter Siegertipp angelegt; Verwaltungsaktionen für einen Spielmarkt
beziehen sich erst im Modal auf die gewählte Begegnung.
Turnierbaum, Liga- und Gruppenzeilen enthalten keine Wettbuttons.
Ein einzelnes verfügbares Angebot ist ein direkter Button, erst mehrere sind ein Dropdown.
Sind die LAN-Punkte ausgeblendet, sehen Admins und der Event-Ersteller an Auslosung und
laufendem Turnier „Tipps starten, sobald LAN-Punkte angezeigt werden“ mit einem Link zur
Einstellung; alle anderen sehen weiterhin keine Wettelemente.
Punktefehler-Meldungen stehen in den Tippdetails; ihre asynchrone Freigabe erzeugt kein Menü
mit nur einem sichtbaren Eintrag. Teilnahme und Adminrechte bestimmen weiterhin, ob neben
der Tippabgabe auch Schließen, Wiederöffnen oder Finanzkorrekturen angeboten werden.

Der Tippdialog nennt „Sieger tippen“ oder „Turniersieger tippen“ und zeigt kurze Angaben zu
Spiel, Turnier und Runde sowie Status, Topf und Tippanzahl. Die Teamnamen stehen in der Auswahl
und werden in der Kontextzeile nicht wiederholt. Die Teamauswahl bei „Sieger tippen“ trägt die
Beschriftung „Sieger“ und besteht aus großen Teamflächen; jede nennt Einsatzsumme und Tippende
mit Einsatz. Kein Team ist vorausgewählt. Nach dem Speichern bestätigt „Tipp gespeichert: Team,
Einsatz“, nach dem Zurücknehmen „Tipp zurückgenommen“. Ein offener Dialog übernimmt Tipps,
Schließen und Abrechnung anderer Geräte sofort und meldet „Tipps wurden gerade geschlossen“;
der Entwurf bleibt erhalten.
Im Turniermodal wählt man zuerst Runde beziehungsweise Gruppe und dann ein Spiel mit
feststehenden Teams. Runden heißen wie im Turnierbaum („Viertelfinale“, „Halbfinale“, „Finale“,
„Gruppe 1 · Runde 2“). Turniersieger und Spiel um Platz 3 sind eigene Einträge. Spielauswahl
und Tippstatus nennen auch vorhandene eigene Tipps. Entwürfe und das zuletzt gewählte Spiel
je Runde bleiben erhalten. „Speichern & weiter“ führt zum nächsten noch offenen, noch nicht
getippten Markt und berücksichtigt auch frühere Runden der Auswahl. Schließen, Wiederöffnen
und begründete Erstattung/Storno des gewählten Spiels bleiben entsprechend der bisherigen
Mitspieler-/Adminrechte im Modal erreichbar. Bereits abgegebene Tipps bleiben änderbar, solange der jeweilige Markt offen ist; abgeschlossene Märkte
zeigen die eigenen Details. Quoten werden nirgends angezeigt. Einsätze und Regeln bleiben über
den Dialog zugänglich. Neue Wettmenüs beginnen geschlossen und öffnen die Spielkarte nicht.
Die geschützte Punkte-API liefert dafür den Turnierbezug einschließlich Spiel, Runde und
Phasenname.

Die Punkteseite listet unter „Tipps“ alle Märkte des Events in drei Gruppen: „Noch nicht
getippt“, „Deine offenen Tipps“ (Team und Einsatz) und „Abgerechnet“ (Netto); jede Zeile öffnet
den Tippdialog. Gibt es offene Tipprunden, führt „Tipps ansehen“ auf Home dorthin. Admins finden in der
Punkteverwaltung unter „Wettrunden“ alle Märkte mit Status, Topf, Tippanzahl und den Aktionen
Schließen, Wiederöffnen, Erstatten und Stornieren. Vor „LAN-Endwertung festschreiben“ nennt die
Bestätigung die noch nicht abgerechneten Runden.

Tipps, Schließen und Wiederöffnen senden das Echtzeitsignal `betting:changed` mit der Runde.
Nur Ansichten mit Wettinhalt laden daraufhin das Punktekonto neu; Abrechnungen bleiben
`leaderboard:changed`.

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
