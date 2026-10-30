# Punkteverlauf

## 1. Status und Zweck

Status: `umgesetzt`. Der Verlauf stellt das vollständige LAN-Punktekonto als Stufenkurve dar.
Die Buchungsliste liefert die exakten Werte und Details; Filter verändern ausschließlich die Liste.

## 2. Quelle

`public/js/pointsPresentation.js`: `pointTimeline(entries)` und `pointsChartHtml(entries)`.
Aufrufer: `public/js/views/points.js`, Route `points`.

## 3. CSS-Eigentümerschaft

`public/css/domains.css` besitzt `.points-chart` einschließlich SVG-Linie, Grundlinie und Beschriftung.
Die Komponente enthält keine eigenen Controls. Buchungsaktionen verwenden die gemeinsamen Controls.

## 4. Varianten

Eine Variante: vollständige, nichtinteraktive Stufenkurve (`umgesetzt`). Ohne Buchungen kein SVG.

## 5. Erlaubte Anpassungen

Der Aufrufer darf Außenplatzierung und verfügbare Breite bestimmen. Keine gefilterten Teilkonten übergeben.

## 6. Komponenteneigene Invarianten

Die Eingabe folgt der aufsteigenden Journalreihenfolge einschließlich stabiler Reihenfolge bei gleicher
Zeit. Die Summe beginnt bei null; jede Buchung verändert die Höhe an ihrem tatsächlichen Zeitpunkt.
Reservierte Einsätze sind kein Punkteverlust. Auszahlungen werden als Nettoänderung gebucht.
Negative Konten bleiben darstellbar. Ein einzelner Zeitpunkt erzeugt keine Division durch null.
Linie: `--accent`; Grundlinie: `--border`; Beschriftung: `--text-muted`, `--font`, `--font-size-sm`.
Die SVG-Koordinaten beschreiben ausschließlich Datengeometrie, keine Controlmaße.

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

`pointsPresentation.test.js` prüft gleiche Zeitpunkte, negative Korrekturen und Einpunktkonten.
`flowsCompetition.fixture.ts` prüft den bedienbaren Punktefluss, Filter, Buchungsdetails und Reflow.

## 11. Permanente Varianten und befristete Ausnahmen

Keine Controlvarianten oder befristeten Ausnahmen.
