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
vorläufigen Marktregeln; Paket 5b und die Gesamtwertung sind nicht umgesetzt.

Die beiden Code-Findings sind berechtigt und gehören vor die nächsten Fachpakete:

- **F1:** Ein belohntes To-do muss auch bei festgeschriebener Wertung erledigt werden können.
  Dann entfällt nur die Buchung; Aufgabenstatus, bestehende Salden und Endstand bleiben konsistent.
- **F2:** Spielfilter und eventübergreifende Ranglisten dürfen keine LAN-Kontostände samt
  Grundstock zu Spielpunkten addieren. Diese Abfragen verwenden ausschließlich Spielpunkte.
  Die damalige Altmodell-Ausnahme für einzelne LANs, Hall of Fame und Export ist seit Paket 5a
  abgelöst: Diese Ansichten verwenden vorläufig Spiel-Rohwerte. Kategorie- und Gesamtwertung
  folgen weiterhin in Paket 6.

K1–K11 des Reviews werden durch den Umstellungsvertrag, die folgende Paketfolge und die
erweiterte Liste offener Entscheidungen im Konzept berücksichtigt. Insbesondere ist die Zahl
vorhandener Konten weder die Teilnehmerzahl N noch eine Entscheidung über die Wertungsberechtigung.
Die endgültige Wertungsberechtigung von beendeten und nicht für LAN-Punkte konfigurierten Events
bleibt E1 zugeordnet. Der beschlossene Neustart in Paket 5a schließt historische Ansprüche
aus dem Abgleich aus, ohne den endgültigen Umfang der künftigen Wertung festzulegen.

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
| Bisherige LAN-Auswertungen | Vorläufig Spiel-Rohwerte statt gemeinsamer Kontosumme; keine Gesamtplatzpunkte |
| Einheitliche Kategorie-/Gesamtwertung, Snapshots | Folgen in Paketen 6 und 9 |

Die bisherige technische Wettteilnahme (aktive bestätigte Teilnehmer ohne Testkonten) bleibt
vorläufig bestehen; sie entscheidet weder N noch den endgültigen Wertungsumfang E1/E2.
Historische Sportstatistiken bleiben Ergebnis-Auswertungen, ohne Punkte ins neue Journal zu buchen.

## Paket 1 – Rohwerte und Journal zuerst

**Umgesetzt als additive Oberfläche auf dem bestehenden Journal.** Bei ihrer Einführung blieben LAN-Summe und Wetten separat. Paket 5a ersetzt diesen
Zwischenstand durch das separate Wallet ohne Guthabenübernahme. Der Browserfall prüft eigene und fremde Korrekturen, negative Ansprüche, die Bearbeitung
älterer Buchungen, einen Revisionskonflikt, Ladefehler mit erneutem Versuch, Realtime und die
Sichtbarkeit auf Telefon und Desktop. Kategorienränge und Platzpunkte folgen weiterhin später.
Der aktuelle Umstellungsvertrag steht in Paket 0; offene Markt- und Gesamtwertungsfragen
bleiben den Paketen 5b und 6 zugeordnet.

- Eigenes Konto mit Orga-, Spiel- und Wett-Rohwert sowie Verlauf aus dem Journal anzeigen.
- Admin-Journal mit Begründung und Revisionsschutz bedienbar machen; eigene Korrekturen bleiben
  erlaubt. Wallet und Wett-Nettowerte bleiben im allgemeinen Journal gemäß W6 schreibgeschützt.
- Keine alte Summe als neues Wettguthaben ausgeben. Der Kontobezug muss
  erkennbar sein. Rang und Platzpunkte folgen in Paket 7.
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
- Neustart aller bestehenden Punktebestände gemäß Paket 0; keine finanzielle Übernahme.
- Ein offener oder gesperrter Einsatz bucht nur eine negative Wallet-Reservierung. Nach Abrechnung
  ersetzt Auszahlung minus Einsatz diesen Anspruch und wird zugleich als Wett-Nettowert gebucht.
  Rücknahme und vollständige Erstattung setzen den Anspruch auf 0. Grundstock ist kein Nettogewinn.
- Ein kanonischer Schlüssel `bet:<roundId>` bleibt über alle Abrechnungsversionen erhalten.
  Alle Personen, Wallet und Wett-Nettowerte werden atomar gebucht. Wiederholungen zahlen nicht doppelt;
  die Summe der Auszahlungen muss genau den Einsätzen entsprechen, einschließlich anonymisierter Tipps.
- Korrekturen erfolgen ausschließlich durch begründete Markt-Neuberechnung oder Storno (W6),
  auch bei eigenen Wetten. Eine Korrektur kann bereits weiterverwendete Gewinne zurücknehmen und
  negatives verfügbares Guthaben erzeugen. Dieses sperrt neue Tipps und Änderungen; die Rücknahme
  eines noch offenen Tipps bleibt möglich. Begründung und Admin werden protokolliert.
- Oberfläche und Datenschutzexport lesen das neue Journal. Der Wallet-Verlauf zeigt verfügbare
  Mittel einschließlich Reservierungen. Orga-/Spielkorrekturen bleiben im Kategorie-Journal.
  Das alte Budget, die alte To-do-Auszahlung und einseitige Entzüge aus dem alten Konto sind abgeschaltet.
- Die bisherige LAN-Rangliste, Hall of Fame und der Event-Export lesen vorläufig Spiel-Rohwerte,
  keine Wallet-Summen. Kategorieplätze und die Gesamtwertung folgen weiterhin in Paket 6.

Abnahme: Reset samt Replay/Rollback und Hintergrundabgleich; neue Vergaben nach Reset;
Startguthaben bei später Zusage; Nullsumme, wiederholte Abrechnung, parallele Reservierungen,
Rücknahmen, Ergebnisänderungen mit bereits eingesetzten Gewinnen, negative Mittel,
Finanz-/Sport-Rollback und Datenschutz. Browser prüfen 320/390/1440 Pixel, Sichtbarkeit,
Journal, feste Startvergabe, Marktstorno und Kategorie-Korrekturen.

## Paket 5b – vollständige Marktregeln (teilweise umgesetzt)

**Umgesetzt:** Vorläufiger Topf, Anzahl Tipps, Einsätze je Ausgang und Pool-Quoten sind
bereits vor Tippschluss sichtbar. Ein nicht belegter Ausgang hat keine berechenbare Quote.
Freie Zweiermatches, Ligaspiele und Gruppenspiele bieten einen regulär gewinnenden Remis-Tipp;
K.-o.-Spiele und Turniersieger-Märkte bieten ihn nicht. Bei älteren Märkten ohne Remis-Auswahl
wird ein eingetretenes Remis weiterhin vollständig erstattet. Die Auswahl erweitert nicht die
gespeicherten Teilnehmerseiten eines Wettbewerbs.

Vorläufig bleiben die bisherigen konfigurierten Marktgrenzen und die bisherige
Pool-Verteilung aktiv. Dies ist ausdrücklich keine Entscheidung über die Zielregeln.

- Zielregeln ersetzen die alten Regeln: sichtbare vorläufige Pool-Quoten, formatabhängiger
  Remis-Tipp, vollständige Erstattungen und Abrunden mit Rest an den größten richtigen Einsatz.
- W1, W2, W4, W5 und W7 bleiben offen: Einsatzgrenze, Mindestzahl einschließlich Erstattungszählung,
  Markteröffnung, Ablösung alter Tages-/Rundenlimits, gleiche größte Einsätze und gesperrte,
  unabgerechnete Märkte bei der Festschreibung. Alte Werte 10/30/6 sind keine Zielvorgaben.
- Eigenwetten, Mitteilungen und die Anzeige direkt an Match/Turnier bleiben erhalten.

## Pakete 6/7 – Wertung und vollständige Ansichten

Paket 6 berechnet positive Rohwerte, geteilte Ränge und N-basierte Platzpunkte gemäß Konzept.
Die reine Berechnung liegt in `server/src/categoryScoring.ts` und ist anhand der Konzeptbeispiele
geprüft. Ihre Eingaben sind die extern bestimmte Teilnehmermenge und Wettberechtigung; sie trifft
keine Auswahl nach Eventstatus, Teilnehmerstatus oder Mindestzahl von Tipps. API, Auswertungen
und Oberfläche verwenden diese Berechnung erst nach Entscheidung der folgenden Fachfragen.
Wett-Mindestzahl, N samt Stichtag, ehemalige/späte Teilnehmer, Testkonten und Eventumfang sind
Eingaben, die zuerst entschieden werden müssen. Die Kontenmenge darf nicht als N verwendet werden.
Der Umgang mit geteilten Turnierboni ist ebenfalls ausdrücklich offen; der Ist-Code vergibt in
Ligen den vollen Bonus des geteilten Platzes (zum Beispiel 5/5/1).

Rangliste, Hall of Fame und Export werden gemeinsam auf die neuen Kategorien und Gesamtstände
umgestellt. `pointStandings` darf danach nicht weiter unbemerkt das Gesamtergebnis liefern.
Paket 7 ergänzt Rang und Platzpunkte in den bereits bestehenden Rohwert-/Verlaufsansichten.
Abnahme: alle Konzeptbeispiele, Gleichstände, inaktive Kategorien, fehlende Wettberechtigung,
negative/Null-Rohwerte und identische Werte in allen Ansichten und Exporten.

## Pakete 8/9 – Melden und Festschreiben

Meldungen verwenden stabile Kennungen für Journalvorgänge, Ergebnisse, Tipps und To-dos.
Der Melder bleibt gegenüber dem Gemeldeten geschützt, auch in personenbezogenen Exporten,
Löschpfaden und Protokollen. Eine Meldung friert nichts ein. Der Meldende sieht den Status;
eine Person kann je Eintrag höchstens eine offene Meldung haben. Ungeklärte Empfänger-/Vertretungsfälle
bleiben vor ihrer Umsetzung offen; eigene administrative Korrekturen bleiben erlaubt.

Die Festschreibung prüft offene Meldungen und Marktstände zusammen mit dem Schreiben des
Kategorie-/Gesamtsnapshots in einer `immediate`-Transaktion. Noch offene Märkte werden gemäß
Konzept erstattet. Die Behandlung bereits gesperrter, unabgerechneter Märkte muss vorher
entschieden werden. Snapshot und Live-Wertung verwenden dieselben Rohwerte, Ränge und N.
Begründetes Wiederöffnen und erneutes Festschreiben erhalten die alten Versionen.

Abnahme: paralleles Melden gegen Abschluss, parallele Ergebnis-/Marktänderung, vollständiger
Rollback, versionsgetreuer Export, Identitätsschutz und weiterhin nutzbare Orga-Funktionen nach
Festschreibung. Technische Prüfungen und Regressionen werden pro Paket ausgeführt; grüne CI
ersetzt weder diese Fachentscheidungen noch ein Review des jeweils aktuellen Heads.
