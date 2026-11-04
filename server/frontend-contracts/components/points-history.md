# Punkteverlauf

## 1. Status und Zweck

Status: `umgesetzt`. Der Verlauf stellt das vollständige LAN-Punktekonto als Stufenkurve dar.
Die Buchungsliste liefert die exakten Werte und Details; Filter verändern ausschließlich die Liste.

## 2. Quelle

`public/js/pointsPresentation.js`: `pointTimeline(entries)`, `pointsChartHtml(entries, { label })` und `journalSourceState(entries, sourceId)`.
`public/js/pointsCategories.js` liefert Kategorie-Zusammenfassung, Kategorie-Ranglisten, Verlauf, Admin-Journal und Buchungsdetails.
`pointsSectionHtml(key, title, content, { open, flat, meta, metaHtml, label })` komponiert die
vorhandene native Disclosure. `content` und `metaHtml` sind vertrauenswürdiges, bereits escaptes
Markup; normale Titel und Metadaten werden im Helper escaped.
Aufrufer: `public/js/views/points.js`, Route `points`.

## 3. CSS-Eigentümerschaft

`public/css/domains.css` besitzt `.points-chart` einschließlich SVG-Linie, Grundlinie und Beschriftung.
Die Komponente enthält keine eigenen Controls. Buchungsaktionen verwenden die gemeinsamen Controls.

## 4. Varianten

Vollständige, nichtinteraktive Stufenkurve für das im gemeinsamen Punkteverlauf ausgewählte
Konto (Orga, Spielen, Wetten oder Wettguthaben) mit eigenem zugänglichem Namen: `umgesetzt`.
Ohne Buchungen kein SVG. Die Suche filtert nur die Liste, nicht die vollständige Kurve des
ausgewählten Kontos.

## 5. Erlaubte Anpassungen

Der Aufrufer darf Außenplatzierung und verfügbare Breite bestimmen. Keine gefilterten Teilkonten übergeben.

## 6. Komponenteneigene Invarianten

Die Eingabe folgt der aufsteigenden Journalreihenfolge einschließlich stabiler Reihenfolge bei gleicher
Zeit. Die Summe beginnt bei null; jede Buchung verändert die Höhe an ihrem tatsächlichen Zeitpunkt.
Der Wallet-Verlauf zeigt verfügbare Mittel: Reservierungen senken sie, Freigaben erhöhen sie;
dies ist kein Wett-Nettogewinn. Die getrennte Wettkategorie enthält ausschließlich Nettoänderungen
gültiger Abrechnungen.
Negative Konten bleiben darstellbar. Die API-Zeitnamen `createdAt` und `created_at` sind gleichwertig. Ein einzelner Zeitpunkt erzeugt keine Division durch null.
Linie: `--accent`; Grundlinie: `--border`; Beschriftung: `--text-muted`, `--font`, `--font-size-sm`.
Die SVG-Koordinaten beschreiben ausschließlich Datengeometrie, keine Controlmaße. Grenzen
und Zeitpunkte stehen als HTML-Beschriftung außerhalb des skalierten SVG, damit sie auch auf
Telefonen in der normalen Textgröße lesbar bleiben.

## 7. Erreichbare Zustände

Die persönliche Zusammenfassung zeigt für jede Kategorie getrennt Rohwert, Rang und
Platzpunkte aus `categoryStanding.categories`. `rank: null` erscheint als „Kein Platz“ mit
0 Platzpunkten. Gesamtplatz und Summe der Platzpunkte stehen darunter; Wettguthaben bleibt
separat. `participantCount` nennt die gemeinsame Teilnehmerbasis. Bei fehlendem eigenen
Wertungseintrag bleibt der Verlauf zugänglich und die fehlende Teilnahme wird benannt.

Startguthaben allein; Reservierungen/Freigaben im Wallet und getrennte Kategorie-Gutschriften; Gewinne und Verluste; Erstattungen mit Netto null;
negative Korrektur; abgeschlossenes Konto.

## 8. Accessibility

SVG mit `role="img"` und zugänglichem Namen aus Anzahl und Endstand. Die vollständigen Werte sind
über die Liste mit echten Details-Buttons verfügbar. Farben sind keine alleinigen Informationsträger.
Die Grafik passt sich der Containerbreite an; Datumsbeschriftungen dürfen umbrechen.

## 9. Repräsentative Aufrufer

`views/points.js`: eigenes Punktekonto bei 320×568 sowie 1440×900, mit identischer Buchungsquelle.

## 10. Prüfungen und Abnahmebeispiele

`pointsPresentation.test.js` prüft gleiche Zeitpunkte beider API-Formate, negative Korrekturen,
Einpunktkonten, vollständige Vorgangsansprüche und escaped Kategorie-/Journaltexte.
`points.e2e.test.ts` prüft Kategorieauswahl, Verlauf, eigene/fremde und veraltete Korrekturen,
Realtime, ausgeblendete Punkte sowie Reflow bei 320/390/512/1440 Pixel.
`flowsCompetition.fixture.ts` prüft den bedienbaren Punktefluss, Filter, Buchungsdetails und Reflow.

## 11. Permanente Varianten und befristete Ausnahmen

Kategorien und Journal verwenden ausschließlich vorhandene KPI-, Filter-, Listen- und
Dialoggeometrie. Controls folgen dem Controls-Vertrag; keine neuen Controlvarianten,
CSS-Eigentümer oder befristeten Ausnahmen. Kategorie-Details schließen bei Wechsel des
Kontos/Events oder ausgeblendeten Teilnehmeransichten. Admin-Details bleiben beim Ausblenden
verfügbar und schließen bei Rollen-/Kontextwechsel. Orga-/Spiel-Ansprüche können mit Begründung
und aktueller Revision korrigiert werden, auch eigene; Wett-/Wallet-Korrekturen erfolgen ausschließlich als begründete Markt-Neuberechnung oder Storno.

„Punktefehler melden“ öffnet den gemeinsamen Modal für eine konkrete Buchung. Status und
Prüfung verwenden dieselben Controls; freie Meldungstexte werden escaped und umbrechen auch
als langes Einzelwort. Der einzige Admin sieht eigene gemeldete Vergaben ohne Absender,
Freitext und genaue Meldezeit. Rollen- und Eventwechsel entfernen alte Dialogdaten; persönliche
Realtime-Signale laden nur den geschützten Posteingang neu. Frühere Endstände werden über
eine native Versionsauswahl als JSON heruntergeladen. Die Abnahme in `points.e2e.test.ts`
umfasst Meldung per Tastatur, Status-Realtime, anonymen Admin, 320/1440 px, Abschluss mit
Erstattung offener/gesperrter Märkte und den heruntergeladenen Endstand.

## Kompakte Darstellung

Kategorien, Gesamtwertung, Verläufe und einzelne Wettrunden verwenden native Disclosures mit
stabilen `data-points-section`-Kennungen; Spielkarten verwenden den gemeinsamen
Match-Historienhelper mit `data-history-item="points-round-<id>"`. Kategorie-Ranglisten
bleiben flache Zeilen innerhalb ihrer Hauptkarte (`flat`), statt je eine zusätzliche gepolsterte Karte anzulegen.
RankedList sortiert nach den fachlichen Kategorieplätzen einschließlich Gleichständen. Die
persönlichen Kategoriepunkte (UI-Bezeichnung „Punkte“) bleiben auch bei geschlossener Rangliste
im Header sichtbar.

Diagramme sind separat einklappbar; Filter verändern weiterhin nur die Liste. Laden im Hintergrund
ersetzt bestehende Daten nicht durch eine leere Fläche. Die gemeinsame Zustandssicherung erhält
Disclosures und Scrollposition. Die Browserprüfung hält die GET-Antwort nach einer echten
Tippänderung gezielt zurück und prüft sowohl den ausstehenden als auch den fertigen Refresh.

Die Spieleübersicht verwendet `historyItemHtml` aus `historyItem.js` wie die Match-Historie:
kompakter Aufklappbutton mit Marktart, Status und eigenem Einsatz sowie eine getrennte rechte
Aktionsgruppe. „Wetten“ ist bei geschlossener Karte bedienbar; eine Tippabgabe ändert den
Aufklappzustand nicht. Der aufklappbare Inhalt ergänzt die alphabetische `rankedListHtml`-Wertliste
der Einsätze je Ergebnis. Eigener Tipp und Gewinner stehen an der jeweiligen Zeile. `.card`
übernimmt die wechselnden Flächen je Verschachtelungsebene; es gibt keine eigene Spielelisten-
Geometrie oder abweichende Controlgröße.
Wettaktionen verwenden ausschließlich ActionMenu und Standardbuttons. `competitionBettingHtml`
liefert dieselben Controls an Match, Turnier und LAN-Punkte. Quotenanzeigen entfallen überall,
einschließlich Auswahloptionen, Tippdetails und Hilfetexten. Die Turnierpräsentation erhält
einen optionalen, vertrauenswürdigen Rendercallback für Controls; ohne diesen bleibt
sie unverändert. Bracket-Höhe und Verbindungslinien bleiben erhalten, Wett- und Ergebnisaktionen
teilen sich eine kompakte Seitenspalte. Liga-/Gruppenzeilen setzen auf schmalen Geräten die
Aktionen gemeinsam darunter. Menüs dürfen nicht vom Turnierbaum abgeschnitten werden.
Die zugehörigen Containermaße gehören `domains.css`; Controls selbst behalten ihre Eigentümer.

Die schreibgeschützten Tippdetails nennen den eigenen gewählten Ausgang ausdrücklich neben
Einsatz, Auszahlung und Netto. Die Meldeschaltfläche steht mit dem Standardabstand in einer
eigenen Aktionszeile unter den Details.
Die Abrechnung folgt der am Markt gespeicherten Auszahlungsregel. Neue Märkte
begrenzen den Nettogewinn auf den eigenen Einsatz; die bestehende Tipp-Hilfe
erklärt Begrenzung und anteilige Rückzahlung. Historische Märkte behalten ihre damalige Regel.

Der gemeinsame Punkteverlauf ersetzt die getrennten Kategorie- und Wettguthaben-Verlaufsbereiche.
Die Kontoauswahl umfasst alle vier Konten. Nur Wettguthaben bietet zusätzlich die bisherige
Buchungsart-Auswahl; seine Details behalten Einsatz, Auszahlung und Originalbuchung. Die
Konten werden weder addiert noch ineinander umgerechnet. Die Kurve verwendet stets alle
Buchungen des Kontos, unabhängig von Suchtext und Buchungsart.
