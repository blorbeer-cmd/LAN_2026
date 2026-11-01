# Punkteverlauf

## 1. Status und Zweck

Status: `umgesetzt`. Der Verlauf stellt das vollständige LAN-Punktekonto als Stufenkurve dar.
Die Buchungsliste liefert die exakten Werte und Details; Filter verändern ausschließlich die Liste.

## 2. Quelle

`public/js/pointsPresentation.js`: `pointTimeline(entries)`, `pointsChartHtml(entries, { label })` und `journalSourceState(entries, sourceId)`.
`public/js/pointsCategories.js` liefert Kategorie-Zusammenfassung, Verlauf, Admin-Journal und Buchungsdetails.
Aufrufer: `public/js/views/points.js`, Route `points`.

## 3. CSS-Eigentümerschaft

`public/css/domains.css` besitzt `.points-chart` einschließlich SVG-Linie, Grundlinie und Beschriftung.
Die Komponente enthält keine eigenen Controls. Buchungsaktionen verwenden die gemeinsamen Controls.

## 4. Varianten

Vollständige, nichtinteraktive Stufenkurve sowie getrennte Kategorie-Verläufe mit eigenem
zugänglichem Namen: `umgesetzt`. Ohne Buchungen kein SVG. Kategorie-Suche filtert nur die Liste,
nicht die vollständige Kurve der ausgewählten Kategorie.

## 5. Erlaubte Anpassungen

Der Aufrufer darf Außenplatzierung und verfügbare Breite bestimmen. Keine gefilterten Teilkonten übergeben.

## 6. Komponenteneigene Invarianten

Die Eingabe folgt der aufsteigenden Journalreihenfolge einschließlich stabiler Reihenfolge bei gleicher
Zeit. Die Summe beginnt bei null; jede Buchung verändert die Höhe an ihrem tatsächlichen Zeitpunkt.
Reservierte Einsätze sind kein Punkteverlust. Auszahlungen werden als Nettoänderung gebucht.
Negative Konten bleiben darstellbar. Die API-Zeitnamen `createdAt` und `created_at` sind gleichwertig. Ein einzelner Zeitpunkt erzeugt keine Division durch null.
Linie: `--accent`; Grundlinie: `--border`; Beschriftung: `--text-muted`, `--font`, `--font-size-sm`.
Die SVG-Koordinaten beschreiben ausschließlich Datengeometrie, keine Controlmaße. Grenzen
und Zeitpunkte stehen als HTML-Beschriftung außerhalb des skalierten SVG, damit sie auch auf
Telefonen in der normalen Textgröße lesbar bleiben.

## 7. Erreichbare Zustände

Grundstock allein; zusätzliche Orga-Buchungen; Gewinne und Verluste; Erstattungen mit Netto null;
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
und aktueller Revision korrigiert werden, auch eigene; Wett-/Wallet-Korrekturwege bleiben offen.
