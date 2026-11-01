# Kiosk-Ergebnisanzeige

## 1. Status und Zweck

Status: `umgesetzt`. Nichtinteraktive Ergebnisanzeige im bestehenden Broadcast-Raster.

## 2. Quelle

`public/js/kioskResults.js`: `createKioskResultsPanel({ results, tournament, title })`.
Öffentliche Methoden: `update`, `setTournament`, `hidePoints`, `error`, `dispose`.
Aufrufer: `public/js/kiosk.js`, Markup: `public/kiosk.html`.

## 3. CSS-Eigentümerschaft

`public/css/kiosk.css` besitzt `.kiosk-results` und `.kiosk-result-*`.
Aufrufer besitzen ausschließlich die äußere Rasterkachel und deren Überschrift.

## 4. Varianten

Ergebnisse mit oder ohne Spielpunkte, kompakte Darstellung bei knapper Höhe: umgesetzt.
Die bestehende Turnieransicht wechselt bei vorhandenem Turnier alle zehn Sekunden mit den
Ergebnissen. Ohne Ergebnisse bleibt das Turnier sichtbar.

## 5. Erlaubte Anpassungen

Der Aufrufer liefert Ergebnisdaten und vorhandene DOM-Container. Er verändert keine Innengeometrie.

## 6. Komponenteneigene Invarianten

Texte und Attribute werden escaped. Abstände verwenden `--space-1` und `--space-2`, Schriftgrößen
`--font-size-xs`, `--font-size-sm`, `--font-size-lg`, Farben vorhandene semantische Tokens.
Tabellenzeilen werden an die verfügbare Höhe angepasst und automatisch weitergeblättert; jede
Person erscheint. Die Kachel erhält weder eigene Scrollbars noch zusätzliche Controls.
Punkte werden beim Ausblenden auch aus dem unsichtbaren DOM entfernt. Fehler verbergen Punkte.

## 7. Erreichbare Zustände

Laden, keine Ergebnisse, Ergebnisse, korrigierte Ergebnisse, Remis, ausgeblendete Punkte,
vorübergehend nicht erreichbare API und Wechsel zur bestehenden Turnieransicht.

## 8. Accessibility

Native Tabelle mit Spaltenüberschriften, Spielname als zugänglicher Tabellenname. Korrekturen
und Sieger stehen als Text da. Automatischer Seitenwechsel setzt keinen Fokus und erzeugt keine
wiederholten Live-Ansagen. Der Broadcast ist ein unbeaufsichtigtes Display; der normale
Matchverlauf bleibt die bedienbare Ansicht für Teilnehmer.

## 9. Repräsentative Aufrufer

`public/kiosk.html`, angesteuert durch `public/js/kiosk.js`: derselbe reale Aufrufer bei 390 × 900
und 1440 × 900. Lange Namen werden umgebrochen beziehungsweise gekürzt, alle Teilnehmer paginiert.

## 10. Prüfungen und Abnahmebeispiele

`src/test/e2e/points.e2e.test.ts`: echter Kiosk-Token ohne Sitzung, acht Teilnehmer, lange Texte,
320/390/1280/1440 Pixel, jede sichtbare Zeile innerhalb der Kachel, alle Namen nach Seitenwechseln,
Live-Korrektur und live ausgeblendete Punkte. `api.leaderboardScoring.test.ts` und
`api.kioskRest.required.test.ts` prüfen Journalwerte, Ereignisgrenzen und ausschließlich Anzeigenamen.

## 11. Permanente Varianten und befristete Ausnahmen

`registry:kiosk-results` besitzt die nichtinteraktive Präsentation in `kiosk.css`.
Keine befristeten Ausnahmen.
