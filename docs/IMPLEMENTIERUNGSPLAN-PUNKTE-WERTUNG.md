# Respawn – Punkte und Wertung: verbleibende Implementierung

Stand: Auswertung des [Claude-Reviews zu PR #749](https://github.com/blorbeer-cmd/LAN_2026/pull/749)
für `6f5e02868626238f34d449cd53ad5a098027283a`. Maßgeblich bleibt das
[Konzept](KONZEPT-PUNKTE-WERTUNG.md). Empfehlungen unten entscheiden keine offenen Fachfragen.
Dieses Dokument ersetzt die bisherige Aufteilung in acht Restpakete.

## Ausgangspunkt und Reviewbewertung

Vorhanden sind Kategorie-Journal und Konten, Admin-Korrektur-API, automatische Spielpunkte,
Wettbewerbs-/Bestell-Orga, dauerhafter Skill-Bonus, Event-Sichtbarkeit und Kiosk-Ergebnisfeed.
Kategorie-Rohwerte und Verlauf sind jetzt auch im persönlichen Konto sichtbar. Das Admin-Journal
erlaubt begründete, revisionsgeschützte Orga-/Spielkorrekturen einschließlich eigener Ansprüche;
Wallet und Wett-Nettowert bleiben dort schreibgeschützt; gemäß W6 erfolgen finanzielle
Korrekturen ausschließlich durch Markt-Neuberechnung oder Storno.
Wallet und Wetten verwenden seit Paket 5a ebenfalls das Kategorie-Journal. Das alte gemeinsame
Konto und alte To-do-Belohnungen sind abgeschaltet. Der Wettumfang enthält noch die ausdrücklich
Marktregeln aus Paket 5b einschließlich der Erstellerwahl und automatischer Turniermärkte.
Die Kategorie-/Gesamtwertung aus Paketen 6/7 ist ebenfalls angebunden.

Die beiden Code-Findings sind berechtigt und gehören vor die nächsten Fachpakete:

- **F1:** Ein belohntes To-do muss auch bei festgeschriebener Wertung erledigt werden können.
  Dann entfällt nur die Buchung; Aufgabenstatus, bestehende Salden und Endstand bleiben konsistent.
- **F2:** Spielfilter und eventübergreifende Ranglisten dürfen keine LAN-Kontostände samt
  Grundstock zu Spielpunkten addieren. Diese Abfragen verwenden ausschließlich Spielpunkte.
  Die damalige Altmodell-Ausnahme für einzelne LANs, Hall of Fame und Export ist seit Paket 5a
  abgelöst. Seit Paket 6 verwenden diese Ansichten Kategorie-Platzpunkte; klassische Spielfilter
  und eventübergreifende Sportstatistiken bleiben bei Spielpunkten.

K1–K11 des Reviews werden durch den Umstellungsvertrag, die folgende Paketfolge und die
erweiterte Liste offener Entscheidungen im Konzept berücksichtigt. Insbesondere ist die Zahl
vorhandener Konten weder die Teilnehmerzahl N noch eine Entscheidung über die Wertungsberechtigung.
E1 ist entschieden: Die Kategorienwertung gilt für reguläre veröffentlichte LANs und bleibt
nach deren Ende sichtbar. Testevents, Entwürfe, abgesagte Veranstaltungen und andere Eventtypen
sind ausgenommen. Der beschlossene Neustart in Paket 5a schließt historische Ansprüche weiterhin
aus dem Abgleich aus. E2 bestimmt die Teilnehmerbasis unabhängig von vorhandenen Konten.

## Paketfolge und Abhängigkeiten

| Paket | Ergebnis | Voraussetzung |
|---|---|---|
| 0 | Umstellungsvertrag, Erzeuger-/Leserinventar und Entscheidungen über den Wertungsumfang | Vor den neuen Fachpaketen; F1/F2 vorab korrigieren |
| 1 / bisher 6a | Kategorie-Rohwerte, Verlauf und Admin-Journal mit Korrektur-Oberfläche | Journal vorhanden; Darstellung der Kontomodelle aus Paket 0 |
| 2 | Neue To-do-Vergabe und Ablösung der alten To-do-Belohnung | To-do- und Umstellungsentscheidungen |
| 3 | Dauerhafte Ankunfts-/Abreiseboni | Vollständigkeit und Stichtagsdetails geklärt |
| 4 | Umfragen und Spieleabstimmungen | Umfragetyp, Zählweise und Kontingente geklärt |
| 5a | Wallet, Wettjournal und Abrechnung | Startguthaben, Korrekturweg und Umstellung geklärt |
| 5b | Vollständige Marktregeln und Wettoberfläche | 5a; offene Wettgrenzen und Randfälle geklärt |
| 6 | Kategorie-/Gesamtwertung und Umstellung der Auswertungen | Wett-Rohwerte, N und Wertungsumfang geklärt |
| 7 / bisher 6b | Ränge und Platzpunkte in den Punkteansichten | 6 |
| 8 | Meldefunktion einschließlich Identitätsschutz | Stabile Quellen aus To-dos und Wetten; Empfängerregeln geklärt |
| 9 | Einheitliche Festschreibung mit Kategorie-Snapshot | 6–8; Marktbehandlung bei Abschluss geklärt |

Pakete 2–4 sind fachlich weitgehend unabhängig. Die Journalansicht wird vorgezogen, damit
bereits laufende Buchungen sichtbar und administrativ korrigierbar werden. Die Wettabrechnung
liegt vor der Gesamtwertung, da deren Eingabe der Wett-Nettogewinn ist. Meldungen kommen vor
der Festschreibung, da offene Meldungen den Abschluss verhindern müssen.

## Paket 0 – Umstellungsvertrag (durch die Neustartentscheidung präzisiert)

**Beschlossen: Keine Punkteübernahme.** Für alle bestehenden Events werden weder Orga-,
Spiel- noch Wettpunkte übernommen. Migration 131 setzt die bisherigen Punktekonten zurück,
entfernt alte Wetten einschließlich Reservierungen, alte To-do-Zusagen und Punkte-Endstände.
Spiele, Aufgaben, Bestellungen, Umfragen, Reise- und Skillangaben bleiben erhalten.
Abgeschlossene historische Quellen werden als bereits vor dem Neustart vorhanden markiert,
damit weder Hintergrundabgleich noch spätere Änderungen ihre alten Punkte wieder erzeugen.
Bereits vollständige persönliche Bonusansprüche werden ebenso nicht erneut ausgezahlt.

Alle bisherigen Kategorie-Rohwerte beginnen bei 0. Berechtigte Teilnehmer erhalten einmalig
**fest 100 separate Wettpunkte pro Event**, auch bei später Zusage. Austritt und erneute Zusage
zahlen kein zweites Startguthaben aus. Orga- und Spielpunkte sind niemals Wettguthaben.
Offene oder übernommene Altaufgaben verwenden nach dem Neustart die feste 3-Punkte-Regel;
vorher abgeschlossene Aufgaben erhalten keine rückwirkende Vergütung.

Der Reset und die Startvergabe laufen gemeinsam in einer Migrationstransaktion. Scheitert eine
Teilbuchung, bleibt der gesamte bisherige Zustand erhalten. Ein dauerhafter Reset-Marker
verhindert einen zweiten Reset bei Neustart oder Migration-Replay. Dies ist die ausdrücklich
beschlossene einmalige Ausnahme vom Bestandsschutz und der Unveränderlichkeit alter Journale;
der normale Betrieb behält die Journal-Schutzregeln bei. Es wurde keine produktive Migration
und kein Deployment ausgeführt.

| Bestand | Zuständigkeit seit Paket 5a |
|---|---|
| `point_entries`, alter Grundstock und alte To-do-Zusagen | Zurückgesetzt und als Finanzpfad abgeschaltet; keine zweite Auszahlung |
| `points_accounts`, `points_sources`, `points_journal` | Einzige Grundlage aller aktuellen Punkte und des Wallets |
| Wettreservierungen und Abrechnungen | Ein kanonischer Journalvorgang je Markt, Person und Konto |
| Punkteansicht und Verwaltung | Getrennte Rohwerte und Wettguthaben; keine einseitigen Finanzkorrekturen |
| LAN-Auswertungen | Seit Paket 6 Kategorie-Platzpunkte statt gemeinsamer Kontosumme |
| Kategorie-/Gesamtstände und Teilnehmerbasis im Snapshot | In Paket 6 angebunden; weitergehende Abschlussregeln sind in Paket 9 umgesetzt |

Die bisherige technische Wettteilnahme (aktive bestätigte Teilnehmer ohne Testkonten) bleibt
bestehen; E1/E2 sind inzwischen ausdrücklich für die Kategorienwertung entschieden.
Historische Sportstatistiken bleiben Ergebnis-Auswertungen, ohne Punkte ins neue Journal zu buchen.

## Paket 1 – Rohwerte und Journal zuerst

**Umgesetzt als additive Oberfläche auf dem bestehenden Journal.** Bei ihrer Einführung blieben LAN-Summe und Wetten separat. Paket 5a ersetzt diesen
Zwischenstand durch das separate Wallet ohne Guthabenübernahme. Der Browserfall prüft eigene und fremde Korrekturen, negative Ansprüche, die Bearbeitung
älterer Buchungen, einen Revisionskonflikt, Ladefehler mit erneutem Versuch, Realtime und die
Sichtbarkeit auf Telefon und Desktop. Kategorienränge und Platzpunkte sind in Paket 7 ergänzt.
Der aktuelle Umstellungsvertrag steht in Paket 0; offene Markt- und Gesamtwertungsfragen
bleiben den Paketen 5b und 6 zugeordnet.

- Eigenes Konto mit Orga-, Spiel- und Wett-Rohwert sowie Verlauf aus dem Journal anzeigen.
- Admin-Journal mit Begründung und Revisionsschutz bedienbar machen; eigene Korrekturen bleiben
  erlaubt. Wallet und Wett-Nettowerte bleiben im allgemeinen Journal gemäß W6 schreibgeschützt.
- Keine alte Summe als neues Wettguthaben ausgeben. Der Kontobezug muss
  erkennbar sein. Rang und Platzpunkte sind in Paket 7 ergänzt.
- Sichtbarkeit, direkte Links, Realtime, leere und negative Konten sowie eigene/fremde
  Zugriffsgrenzen prüfen. Keine neuen Buchungen allein durch einen Seitenaufruf.

## Pakete 2–4 – weitere Orga-Erzeuger

**Paket 2 umgesetzt:** Neue Aufgaben bringen immer 3 Punkte, keine Budget-/Helferplatz-
Reservierung und eine Auszahlung an den ersten angemeldeten fremden Helfer. Direkte Zuweisung
zählt; eine Serie direkter Zuweisungen zahlt zusammen einmal aus. Mitbring-Anfragen zahlen keine
neuen Orga-Punkte. Ersteller, eingetragene Helfer und Admins können neue Aufgaben wieder öffnen;
die Gutschrift wird im selben Commit zurückgerechnet. Erneutes Erledigen stellt den Anspruch
wieder her. Eine Punkteauswahl oder höhere automatische Admin-Werte gibt es nicht.
Migration 130 übernimmt noch offene, unvergütete Aufgaben; erledigte unvergütete Altaufgaben
bleiben ohne rückwirkenden Bonus. Die historische Auszahlung alter LAN-Zusagen ist mit dem beschlossenen Neustart in Paket 5a
abgeschaltet; deren Werte werden nicht übernommen.

**Paket 3 umgesetzt:** Je 2 Punkte entstehen zum Eventstart für eine bis dahin eingetragene Ankunfts- beziehungsweise Abreisezeit. Die optionalen Notizen sind dafür nicht erforderlich. Die Vergabe läuft auch ohne offene App und bleibt nach Änderungen erhalten. Ein vor dem Start verschobener Eventtermin verwendet den neuen Start; bereits erworbene Boni bleiben erhalten. Für bereits beendete Events erfolgt keine nachträgliche Reisebonus-Vergabe; beim Beenden eines laufenden Events wird der Anspruch zuvor gesichert. Bestellpunkte sind unabhängig von Fristen.

**Paket 4 umgesetzt:** Jede abgeschlossene Umfrage mit mindestens drei unterschiedlichen Teilnehmenden bringt dem ursprünglichen Ersteller 3 Punkte; eine entsprechend abgeschlossene Spieleabstimmung 2 Punkte. Es gibt kein Kontingent. Stichwahlen bleiben Teil derselben Entscheidung. Wiederöffnen und Löschen berechnen den Anspruch neu. Historisch unbekannte Ersteller bleiben unzugeordnet.

Abnahme je Erzeuger: erfüllter und nicht erfüllter Anspruch, Wiederholung, relevante Parallelzugriffe,
atomarer Fehlerfall, Korrektur/Löschung und unveränderte manuelle Korrektur. Änderungen der
Fachquelle bleiben bei geschlossener Wertung nutzbar; deren Punkte und Snapshot bleiben eingefroren.

## Paket 5a – Wallet und Wettabrechnung (umgesetzt)

- Fest 100 Wettpunkte einmal je Event und berechtigtem Teilnehmer, einschließlich später Zusagen.
  Startguthaben wird bei Teilnahme beziehungsweise Event-Veröffentlichung im Hintergrund vergeben.
  Migration 134 schließt Reaktivierung, Mitgliedschaftsaktivierung und den Wechsel vom Testkonto
  zum normalen Konto ein; übersehene berechtigte Konten offener Wertungen werden beim Upgrade
  einmalig nachfinanziert. Bereits finanzierte oder festgeschriebene Konten erhalten keine neue
  Startgutschrift. Der Punkteabruf bleibt lesend, die Teilnahmehistorie unverändert.
- Neustart aller bestehenden Punktebestände gemäß Paket 0; keine finanzielle Übernahme.
- Ein offener oder gesperrter Einsatz bucht nur eine negative Wallet-Reservierung. Nach Abrechnung
  ersetzt Auszahlung minus Einsatz diesen Anspruch und wird zugleich als Wett-Nettowert gebucht.
  Rücknahme und vollständige Erstattung setzen den Anspruch auf 0. Grundstock ist kein Nettogewinn.
- Ein kanonischer Schlüssel `bet:<roundId>` bleibt über alle Abrechnungsversionen erhalten.
  Alle Personen, Wallet und Wett-Nettowerte werden atomar gebucht. Wiederholungen zahlen nicht doppelt;
  die Summe der Auszahlungen muss genau den Einsätzen entsprechen, einschließlich anonymisierter Tipps.
- Beschlossene Gewinnbegrenzung umgesetzt: Nettogewinn höchstens in Höhe des eigenen Einsatzes.
  Umverteilt wird `min(Gewinner-Einsätze, übrige Einsätze)`; Gewinn und Verlust werden je Seite
  anteilig einschließlich ganzzahliger Restverteilung zugeordnet. Überschüsse gehen zurück.
  Beispiel 1 gegen 15: Auszahlung 2/14, Netto +1/−1. Die interne Vorschau verwendet dieselbe Regel; Quoten werden nicht angezeigt.
  Migration 135 versioniert sie am Markt: neue und noch nie abgerechnete offene/gesperrte Märkte
  offener Wertungen erhalten die Begrenzung, historische/festgeschriebene Märkte behalten ihre
  bisherige Berechnung auch bei Korrekturen. Bestehende Finanzbuchungen bleiben unverändert.
- Korrekturen erfolgen ausschließlich durch begründete Markt-Neuberechnung oder Storno (W6),
  auch bei eigenen Wetten. Eine Korrektur kann bereits weiterverwendete Gewinne zurücknehmen und
  negatives verfügbares Guthaben erzeugen. Dieses sperrt neue Tipps und Änderungen; die Rücknahme
  eines noch offenen Tipps bleibt möglich. Begründung und Admin werden protokolliert.
- Oberfläche und Datenschutzexport lesen das neue Journal. Der Wallet-Verlauf zeigt verfügbare
  Mittel einschließlich Reservierungen. Orga-/Spielkorrekturen bleiben im Kategorie-Journal.
  Das alte Budget, die alte To-do-Auszahlung und einseitige Entzüge aus dem alten Konto sind abgeschaltet.
- Die LAN-Rangliste, Hall of Fame und der Event-Export lesen seit Paket 6 Kategorie-Platzpunkte,
  keine Wallet-Summen. Die zwischenzeitlichen Spiel-Rohwerte sind damit abgelöst.

Abnahme: Reset samt Replay/Rollback und Hintergrundabgleich; neue Vergaben nach Reset;
Startguthaben bei später Zusage; Nullsumme, wiederholte Abrechnung, parallele Reservierungen,
Rücknahmen, Ergebnisänderungen mit bereits eingesetzten Gewinnen, negative Mittel,
Finanz-/Sport-Rollback und Datenschutz. Browser prüfen 320/390/1440 Pixel, Sichtbarkeit,
Journal, feste Startvergabe, Marktstorno und Kategorie-Korrekturen.

## Paket 5b – vollständige Marktregeln (umgesetzt)

**Umgesetzt:** Vorläufiger Topf und Einsätze je Ausgang sind bereits vor Tippschluss sichtbar.
Auf Nutzerentscheidung entfallen sämtliche Quotenanzeigen, auch in Tippdialogen, Match- und
Turnieransichten. Die Spieleübersicht verwendet die gemeinsamen Match-Historienkarten mit Wettaktionen im Header und
Wertlisten. Ein gemeinsamer Punkteverlauf bietet die Konten Orga, Spielen, Wetten und
Wettguthaben; Reservierungen und Nettoänderungen bleiben fachlich getrennt.
Freie Matches mit mindestens zwei Teams, Ligaspiele und Gruppenspiele bieten einen regulär gewinnenden Remis-Tipp;
K.-o.-Spiele und Turniersieger-Märkte bieten ihn nicht. Bei älteren Märkten ohne Remis-Auswahl
wird ein eingetretenes Remis weiterhin vollständig erstattet. Die Auswahl erweitert nicht die
gespeicherten Teilnehmerseiten eines Wettbewerbs.

**W1/W5 umgesetzt:** Maximal 20 Punkte pro Person und Wettmarkt; keine zusätzlichen Tageslimits
oder Höchstzahl von Wettrunden pro Event. Alte gespeicherte Kontingente begrenzen keine Wetten
mehr und die API zeigt diese Grenzen als `null`. W2 ist mit zwei regulär abgerechneten Tipps
entschieden. Die persönliche API liefert deren Anzahl und die erreichte Mindestzahl; die
Kategorieplatzierung ist in Paket 6 angebunden. Vollständig erstattete Märkte und
zurückgenommene Tipps zählen nicht zur Mindestzahl. Auszahlungen sind davon unabhängig.

- Zielregeln ersetzen die alten Regeln: kompakte Wettansichten ohne Quoten, formatabhängiger
  Remis-Tipp, vollständige Erstattungen und ganzzahlige proportionale Pool-Auszahlungen.
- W1 umgesetzt: maximal 20 Punkte pro Person und Wettmarkt.
- W2 umgesetzt: Wettplatzierung erst ab zwei regulär abgerechneten Tipps und positivem Nettowert.
- W5 umgesetzt: alte Tages-/Rundenlimits als Beschränkungen abgeschaltet.
- W4 für Matches umgesetzt: Der Ersteller wählt direkt beim Anlegen vor Spielbeginn „Wetten
  zulassen“. Keine zusätzliche Adminrolle; eine ausgeschaltete Option darf nicht über die
  separate Markt-API umgangen werden. Die Auswahl gehört nicht in die spätere Ergebniseingabe.
- W4 für Turniere umgesetzt: Wetten auf Turniersieger und einzelne Turnierspiele immer ohne
  optionalen Freischalter anbieten. Bestehende Start-/Tippschluss- und Sichtbarkeitsregeln gelten.
- W7-Abrechnung umgesetzt: Restpunkte nach größtem Nachkommaanteil; gleiche Anteile nach
  früherer erster Tippabgabe und bei gleichem Zeitstempel nach gespeicherter Einfügereihenfolge.
  Pool und Nullsumme bleiben erhalten. Offen bleibt die Behandlung gesperrter, unabgerechneter
  Märkte bei der Festschreibung. Alte Werte 10/30/6 sind keine Zielvorgaben.
- Eigenwetten, Mitteilungen und die Anzeige direkt an Match/Turnier bleiben erhalten.

Migration 132 speichert die Erstellerwahl an Auslosungen und Captain Drafts. Rematches fragen
ebenfalls beim Anlegen nach der Freigabe. Bestehende explizite Märkte behalten ihre Freigabe;
andere Alt-Auslosungen beginnen ohne Freigabe. Die separate administrative Markt-API prüft
die Wahl ebenso und kann ein Nein nicht umgehen. Matches, Rematches und Captain Drafts unterstützen seit der UX-Nachbesserung auch mehr als
zwei Teams; die bestehende Sieger-/Remis-Abrechnung bleibt erhalten. Turniermärkte werden angeboten, sobald ihre Gegner feststehen, der Gesamtsieg
vor dem ersten Spiel. Mitspieler oder Admin schließen neue automatische Märkte vor Spielbeginn
über die vorhandene Startaktion. Beim ersten Turnierspiel
wird auch der Gesamtsieger-Markt geschlossen. Bestehende explizite Fristen bleiben wirksam.
Die Ergebniseingabe schließt eine noch offene Tippabgabe atomar und rechnet bereits angenommene
Tipps regulär ab. Beim ersten Turnierergebnis schließt sie auch den Gesamtsieger-Markt, dessen
Abrechnung weiterhin erst nach dem Turnierende erfolgt. Spätere Tipps werden abgewiesen. Neue Wetten nach
Eventende sind gesperrt; Ergebnisse und Verläufe bleiben sichtbar.

Erzeugung der Quelle und der Märkte laufen in derselben Transaktion, einschließlich des
letzten Draft-Picks und neu feststehender Turniergegner. Mitteilungen folgen erst nach Commit.
Ungültige/abgebrochene Quellen und nicht wählbare geteilte Turniersiege werden erstattet.
Hall of Fame und Export behalten auch bei Turnieren gemeinsame Sieger. Der bestätigte
Hinweis H1 beschreibt weiterhin die unveränderte Formel; die kompakte Oberfläche wiederholt
ihn nicht mehr als Erklärung unter jedem Spielverlauf.

Neue Matches, Drafts mit mindestens zwei Captains und Rematches erlauben Wetten standardmäßig.
Die Oberfläche wählt die Freigabe bei jeder neuen Anlage vor; ein ausdrückliches Nein gilt
für diesen Vorgang. Die API verwendet bei fehlender Angabe denselben formatabhängigen
Standard. Historische beziehungsweise ausdrücklich ausgeschaltete Freigaben bleiben unverändert.

## Pakete 6/7 – Wertung und vollständige Ansichten (umgesetzt)

Paket 6 berechnet positive Rohwerte, geteilte Ränge und N-basierte Platzpunkte gemäß Konzept.
Die reine Berechnung liegt in `server/src/categoryScoring.ts` und ist anhand der Konzeptbeispiele
geprüft. `pointStandings` verbindet sie mit den beschlossenen Regeln: reguläre veröffentlichte
oder beendete LAN, aktive bestätigte Teilnehmer ohne Testkonten, späte Zusagen sofort,
Austritte nur aus der laufenden Rangliste entfernen. N wird aus dieser Teilnehmerliste ermittelt,
niemals aus vorhandenen Konten. Für die Wettplatzierung zählen mindestens zwei regulär abgerechnete
Tipps und positiver Nettogewinn. S1 ist bestätigt: voller Bonus des geteilten Turnierplatzes,
zum Beispiel 5/5/1. Der vorhandene Abschluss speichert nun Teilnehmerbasis, Kategorien und
Gesamtstand; die weiteren Abschlussregeln einschließlich Meldungen sind in Paket 9 umgesetzt.

Rangliste, Hall of Fame und Export verwenden gemeinsam diese Kategorien und Gesamtstände.
Spielfilter und eventübergreifende Sportstatistiken vergleichen weiterhin ausschließlich
Spielpunkte; sie vermischen diese nicht mit Kategorie-Platzpunkten. Die Hall of Fame liefert
zusätzlich geteilte Kategoriesieger; ohne wertbare Ergebnisse gibt es keinen Sieger.
Paket 7 ergänzt Rohwert, Rang und Platzpunkte in den bestehenden Kategorie-/Verlaufsansichten
sowie deren Summe und Gesamtplatz. Wettguthaben bleibt separat.
Abnahme: alle Konzeptbeispiele, Gleichstände, inaktive Kategorien, fehlende Wettberechtigung,
negative/Null-Rohwerte und identische Werte in allen Ansichten und Exporten.

## Pakete 8/9 – Melden und Festschreiben (umgesetzt)

Gemeldet werden ausschließlich mutmaßlich falsch vergebene Punkte. „Punktefehler melden“
bezieht sich auf eine konkrete Buchung. Gewertete Ergebnisse, vergütete To-dos und abgerechnete
Wetten führen zu ihrer zugehörigen Punktevergabe. Offene Aufgaben und unabgerechnete Wetten
sind keine Meldungsziele. Betroffene Konten ergeben sich aus den tatsächlichen Buchungen;
reine Erstellerrollen und Korrekturen fremder Konten schließen einen Admin nicht pauschal aus.

Migration 133 legt private Meldungen mit stabilen Quellenkennungen und höchstens einer offenen
Meldung je Person und Eintrag an. Sie verändert keine Guthaben. Die API unter `/api/points/reports`
und die Dialoge bieten optionalen Grund, eigenen Status und einen rollenabhängigen Posteingang.
Einstiege liegen in Buchungs-, Ergebnis-, Wett- und To-do-Details; Status und Prüfung sind auch
über das Event erreichbar, wenn Punkte ausgeblendet sind. Nur Admins schließen als „korrigiert“
oder „in Ordnung“; eine Meldung bucht und sperrt selbst keine Punkte. Eine Korrektur erfolgt
weiterhin separat mit Begründung im Journal beziehungsweise als vollständige Marktkorrektur.

**M1 entschieden:** Unbetroffene Admins und der unbetroffene Event-Ersteller sehen Meldungen.
Der Event-Ersteller ohne Adminrolle liest nur. Ist der einzige aktive Admin selbst von der
Punktevergabe betroffen, darf er die Meldung anonym prüfen und abschließen. Absender, privater
Freitext und genaue Meldezeitpunkte werden ihm nicht ausgeliefert. Mit mehreren Admins entfällt
diese Ausnahme; ohne berechtigten Prüfer bleibt die Meldung offen. Ursprünglich betroffene
Konten bleiben auch nach Quellenänderungen geschützt; aktuelle Betroffene werden zusätzlich
geprüft. Rollenwechsel wirken unmittelbar. Persönliche Exporte enthalten nur eigene Meldungen.
Kontolöschung anonymisiert Absender und private Textkopien. Das allgemeine Adminprotokoll
enthält keine Meldungsidentitäten; Realtime-Signale gehen ohne Inhalt nur an Berechtigte.

**W7-Abschluss entschieden:** Alle bei Festschreibung noch unabgerechneten Märkte werden voll
zurückgezahlt, einschließlich bereits gesperrter Märkte. Ergebnisabgleich, Prüfung offener
Meldungen, Rückerstattungen, Punktesynchronisierung, Snapshot, Schließzustand und Adminaudit
liegen in einer gemeinsamen `immediate`-Transaktion. Benachrichtigungen folgen nach Commit.
Offene Meldungen verhindern die Festschreibung. Rückzahlungen erzeugen keine Wett-Nettopunkte
und zählen nicht als regulär abgerechnete Tipps.

Snapshot und Live-Wertung verwenden dieselben Rohwerte, Ränge und N; die angewandten Regeln
werden mitgespeichert. Begründetes Wiederöffnen erhält frühere Versionen. Gespeicherte
Endstände sind in Konto und Verwaltung auswählbar und als JSON herunterladbar.
`GET /api/points/snapshots` listet Versionen, `GET /api/points/snapshots/:revision` liefert einen
bestimmten Stand. Der Andenken-Export übernimmt mit `pointsRevision` gezielt dessen Wertung;
seine übrigen Eventdaten bleiben aktuell. Alte Snapshots erhalten keine erfundenen Regeln.
Sichtbarkeit und Anonymisierung nach Kontolöschung bleiben für alle Versionen wirksam.

Abnahme: paralleles Melden, Bearbeiten und Festschreiben; Ergebnis-/Marktänderungen gegen
Abschluss; vollständiger Rollback; versionsgetreuer Export; anonyme Selbstprüfung und
Rollenwechsel; weiterhin nutzbare Orga-Funktionen bei eingefrorenen Punkten. Der Browser prüft
Meldung, Status-Realtime, anonyme Bearbeitung, Rückzahlung offener/gesperrter Märkte und Download
bei Telefon- und Desktopbreite. Kein Merge und kein Deployment.
