# Respawn – Punkte und Wertung: verbleibende Implementierung

Stand: Auswertung des [Claude-Reviews zu PR #749](https://github.com/blorbeer-cmd/LAN_2026/pull/749)
für `6f5e02868626238f34d449cd53ad5a098027283a`. Maßgeblich bleibt das
[Konzept](KONZEPT-PUNKTE-WERTUNG.md). Empfehlungen unten entscheiden keine offenen Fachfragen.
Dieses Dokument ersetzt die bisherige Aufteilung in acht Restpakete.

## Ausgangspunkt und Reviewbewertung

Vorhanden sind Kategorie-Journal und Konten, Admin-Korrektur-API, automatische Spielpunkte,
Wettbewerbs-/Bestell-Orga, dauerhafter Skill-Bonus, Event-Sichtbarkeit und Kiosk-Ergebnisfeed.
Sichtbare LAN-Punkte, To-do-Belohnungen, Wetten und Endwertungs-Snapshots verwenden dagegen noch
das gemeinsame alte Konto. Der bestehende Wettumfang ist keine vollständige Umsetzung des Ziels.

Die beiden Code-Findings sind berechtigt und gehören vor die nächsten Fachpakete:

- **F1:** Ein belohntes To-do muss auch bei festgeschriebener Wertung erledigt werden können.
  Dann entfällt nur die Buchung; Aufgabenstatus, bestehende Salden und Endstand bleiben konsistent.
- **F2:** Spielfilter und eventübergreifende Ranglisten dürfen keine LAN-Kontostände samt
  Grundstock zu Spielpunkten addieren. Diese Abfragen verwenden ausschließlich Spielpunkte.
  Die ausdrücklich gewählte einzelne LAN ohne Spielfilter behält vorläufig ihr bisheriges Konto;
  dessen Ablösung gehört in die Umstellung. Hall of Fame und Event-Export besitzen dieselbe
  dokumentierte Altmodell-Ausnahme, bis Kategorie- und Gesamtwertung sie ersetzen.

K1–K11 des Reviews werden durch den Umstellungsvertrag, die folgende Paketfolge und die
erweiterte Liste offener Entscheidungen im Konzept berücksichtigt. Insbesondere ist die Zahl
vorhandener Konten weder die Teilnehmerzahl N noch eine Entscheidung über die Wertungsberechtigung.
Aktuelle Backfills können auch beendete beziehungsweise nicht für LAN-Punkte konfigurierte Events
erreichen. Ob diese Events künftig gewertet werden, bleibt offen; dieser Review-Fix schränkt
ihren bisherigen Buchungsumfang nicht eigenmächtig ein.

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

## Paket 0 – Umstellungsvertrag

Ein eigenes Umstellungspaket ist notwendig. Es legt die technische Ablösung fest, ohne alte
Summen ungeprüft als neue Kategorie- oder Wallet-Werte zu übernehmen.

| Bestand | Neuer Verantwortungsbereich / abzuschaltender Pfad |
|---|---|
| `point_entries`, `start:<player>` | Wett-Startguthaben ausschließlich im neuen Wallet; kein Startbonus in Rohwerten |
| `awardTaskPoints`, `points_task_rewards`, Helferansprüche | Ein Orga-Anspruch je beschlossenem To-do-Vorgang; keine zusätzliche Altbuchung |
| Bisherige Wettreservierung und Abrechnung | Wallet und Wett-Nettowert im Journal; ein Abrechnungspfad je Markt |
| `points_sources`, `points_journal`, automatische Abgleichstände | Bestehende Ansprüche, Revisionen und begründete Korrekturen erhalten |
| Punkteansicht und Punkteverwaltung | Kategorie-/Wallet-Ansichten mit eindeutigem Kontobezug |
| `pointStandings` in Rangliste, Hall of Fame und Export | Neue, einheitliche Kategorie-/Gesamtwertung; Sporttabellen behalten ihren eigenen Zweck |
| `points_settings.closed_at`, `points_snapshots` | Einheitlicher Abschluss für den definierten Wertungsumfang und alle Kategorien |
| Kiosk-Ergebnisfeed | Bereits am Spieljournal; weiter keine Kontenanlage oder Buchung durch Anzeigen |

**Offen U1 – Übergangsweg:** Empfehlung des Reviews ist, das Altmodell innerhalb dieses PRs
vollständig abzulösen und den fertigen Umfang gemeinsam auszuliefern. Alternativ ist bei früherer
Auslieferung eine kontrollierte Umstellung je Event nötig. Diese Auswahl ist noch nicht getroffen.
Ein ungemergter PR und übersprungene CI-Deployments belegen nicht den tatsächlichen produktiven
Datenbestand; dieser muss vor einer Datenmigration geprüft werden. Weder Tabellenlöschung noch
die Annahme „es gibt keine alten Nutzerdaten“ sind durch das Review autorisiert.

Für den gewählten Weg muss die Umsetzung nachweisen:

1. Pro Quelle gibt es genau einen finanziell wirksamen Erzeuger. Alte und neue Schlüssel werden
   eindeutig zugeordnet; Wiederholung, Neustart und Abbruch erzeugen keine zweite Auszahlung.
2. Alte Buchungen werden nach ihrer Herkunft getrennt. Eine alte Gesamtsumme aus Grundstock,
   Orga und Wettnetto lässt sich nicht pauschal in das Wallet kopieren. Der Fall bereits als
   Wetteinsatz verwendeter alter Orga-Punkte ist ausdrücklich zu behandeln.
3. Offene Reservierungen werden erhalten oder nachvollziehbar erstattet. Ausbezahlte Märkte,
   negative Konten, manuelle Korrekturen und vorhandene Endstände bleiben erklärbar.
4. Erzeuger, Leser und Endwertung wechseln konsistent. Ein teilweise umgestelltes Event darf
   keine additive Auswertung beider Modelle erhalten. Ein dauerhaftes Modellmerkmal je Event
   ist eine mögliche Lösung für eine gestaffelte Umstellung, keine bereits beschlossene Vorgabe.
5. Ein Wiederholungslauf verändert den übernommenen Bestand nicht. Fehler rollen den betroffenen
   Wechsel zurück; es gibt keinen stillen Verlust von Ansprüchen oder Einsätzen.

Abnahme: Fixtures für ausschließlich alte, ausschließlich neue und bereits teilweise gebuchte
Quellen, offene Märkte, Alt-Orga im Wetteinsatz, negative Korrekturen und festgeschriebene Events.
Das Paket definiert auch, welche Events teilnehmen dürfen und wann diese Entscheidung greift.
Historische Endstände werden nicht ohne eine festgelegte Übernahmeregel neu interpretiert.

## Paket 1 – Rohwerte und Journal zuerst

- Eigenes Konto mit Orga-, Spiel- und Wett-Rohwert sowie Verlauf aus dem Journal anzeigen.
- Admin-Journal mit Begründung und Revisionsschutz bedienbar machen; eigene Korrekturen bleiben
  erlaubt. Noch ungeklärte Wallet-/Wett-Korrekturwege nicht durch die Oberfläche vorentscheiden.
- Bis zum Wallet-Wechsel keine alte Summe als neues Wettguthaben ausgeben. Der Kontobezug muss
  erkennbar sein. Rang und Platzpunkte folgen in Paket 7.
- Sichtbarkeit, direkte Links, Realtime, leere und negative Konten sowie eigene/fremde
  Zugriffsgrenzen prüfen. Keine neuen Buchungen allein durch einen Seitenaufruf.

## Pakete 2–4 – weitere Orga-Erzeuger

**To-dos:** Punktwert am To-do speichern, Übernahme und Erledigung durch eine andere Person
nach den beschlossenen Regeln vergüten. Vorhandene explizite Belohnungen müssen im Übergang
zugeordnet werden; ein historisch unbekannter Wert darf nicht als neuer Anspruch erfunden werden.
Ein eigenes Wiederöffnen existiert bisher nicht und muss einschließlich Rechten und Rückbuchung
gebaut werden. Alte Helferplätze und das Orga-Budget sind keine beschlossenen Zielregeln.
Offen bleiben höhere Werte, mehrere Helfer, Direktzuweisung als Übernahme, `item_request`
und die Übernahme bisheriger Zusagen. Die neue Quelle ersetzt den alten Belohnungspfad.

**Ankunft/Abreise:** Anspruch mit dauerhaftem Zustand wie beim Skill-Bonus speichern.
`arrival_at` und `departure_at` sind vorhanden; ob `note` oder weitere Angaben zur Vollständigkeit
gehören und wie verschobene Eventstarts behandelt werden, ist offen. Die Abgabefrist gilt nach
dem derzeitigen Konzept nur für diese Reiseboni, nicht für Bestellpunkte. Ein bereits verdienter
Bonus geht durch spätere Änderungen nicht verloren.

**Umfragen/Spieleabstimmungen:** `vote_rounds.created_by` und die Verknüpfung von Stichwahlen
nutzen. Historisch unbekannte Ersteller bleiben unzugeordnet. Allgemeine Umfragen sind bislang
nicht als eigenes generisches Modul vorhanden; Terminumfragen liegen in `event_date_polls`.
Ob diese gemeint sind oder eine neue Umfragefunktion benötigt wird, ist offen. Veröffentlichung,
Abschluss, Stichwahlen und Kontingente müssen vor der Vergabe abgegrenzt werden.

Abnahme je Erzeuger: erfüllter und nicht erfüllter Anspruch, Wiederholung, relevante Parallelzugriffe,
atomarer Fehlerfall, Korrektur/Löschung und unveränderte manuelle Korrektur. Änderungen der
Fachquelle bleiben bei geschlossener Wertung nutzbar; deren Punkte und Snapshot bleiben eingefroren.

## Pakete 5a/5b – Wallet und Marktregeln

- Gleiches separates Startguthaben einmalig vergeben; Höhe, Konfigurierbarkeit und späte Zusage
  sind offen. Grundstock und Erstattungen sind kein Wett-Nettogewinn.
- Einsätze, Reservierungen, Auszahlung und Nettowert gemeinsam im Journal abbilden. Negative
  Korrekturen bleiben möglich; negatives verfügbares Guthaben verhindert neue Tipps.
- Markt-Neuberechnung und Admin-Korrekturen zusammen definieren. Die Zulässigkeit eigener
  Korrekturen ist entschieden; daraus folgt keine Ausnahme von der Nullsumme.
- Zielregeln ersetzen ausdrücklich alte Regeln: vorläufige Pool-Quoten sichtbar, formatabhängiger
  Remis-Tipp, beschlossene vollständige Erstattungen, Abrunden und Rest an den größten richtigen
  Einsatz. Gleiche größte Einsätze und gesperrte unabgerechnete Märkte bleiben offene Randfälle.
- W1/W2 und der Umgang mit alten Tages-/Rundenlimits müssen geklärt sein. Alte Werte 10/30/6
  werden nicht stillschweigend zum neuen Regelwerk.
- Eigenes Spiel, eigenes Team, Gegner und Turniersieger bleiben erlaubte Tipps. Offizielle Runden,
  Öffnungsmitteilungen und die Anzeige direkt am Match/Turnier bleiben erhalten.

Abnahme: Nullsumme pro Markt, identische Wiederholung, Korrektur bereits verwendeter Gewinne,
Erstattungsfälle, Remis je Format, negative Guthaben, Sichtbarkeit und Übergang alter Reservierungen.
Vor Aktivierung des neuen Wallets darf das alte Konto keinen zweiten Grundstock oder Wettabschluss
mehr für dieselben Vorgänge erzeugen.

## Pakete 6/7 – Wertung und vollständige Ansichten

Paket 6 berechnet positive Rohwerte, geteilte Ränge und N-basierte Platzpunkte gemäß Konzept.
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
