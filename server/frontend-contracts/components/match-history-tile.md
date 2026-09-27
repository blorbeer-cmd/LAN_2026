# Match-Historienkachel

## 1. Status und Zweck

Status: umgesetzt. Eine Kachel zeigt den Ergebnisüberblick und klappt Teams oder offene
Auslosungen auf. Die ganze Historie besitzt zusätzlich ihren eigenen einklappbaren Rahmen.

## 2. Quelle

`public/js/views/matchmaking.js`: `historyItemHtml`, `renderHistory` und `wireHistory`.

## 3. CSS-Eigentümerschaft

`public/css/style.css` besitzt `.matchmaking-history-*`. Die vorhandenen `.card`, `.chip`,
`.btn`, `.lb-rank` und Ergebnis-Chips bleiben bei ihren jeweiligen Eigentümern.

## 4. Varianten

Erfasstes Match mit Ergebnis und Rematch/Stift, Turnier mit direktem Detail-Link sowie die
letzte Sammelkachel „Ohne Ergebnis“ mit ihren bearbeitbaren Auslosungen.

## 5. Erlaubte Anpassungen

Aufrufer dürfen Spielname, Zeit, Ergebnistext und Aktionen liefern. Der Pfeil bleibt ein
eigenständiger Button neben den Aktionen; Aktionen werden nie darin verschachtelt.

## 6. Komponenteneigene Invarianten

Alle Kacheln beginnen geschlossen und behalten ihren Zustand bei einem Neuzeichnen. Ein gerade
gespeichertes Ergebnis öffnet seine Kachel. Spielnamen kürzen nur visuell; der vollständige
DOM-Text bleibt. Die Aktionsgruppe ist gleich hoch und darf auf schmalen Ansichten als Ganzes
unter den Titel rücken. Teams stehen breit nebeneinander, bis zu vier Spalten, und zeigen
nur ihre gespeicherte Skill-Summe. „Ohne Ergebnis“ bleibt die letzte Kachel.
Ihre bearbeitbaren Auslosungen werden erst beim Aufklappen aufgebaut und beim Schließen
wieder aus dem DOM entfernt; die Anzahl und Erreichbarkeit aller offenen Auslosungen bleiben erhalten.

## 7. Erreichbare Zustände

Geschlossen, geöffnet, neu gespeichertes Ergebnis, offener Draw, laufendes oder beendetes
Turnier, Ladefehler und leerer Filter.

## 8. Accessibility

Der Pfeil-Button verwendet `aria-expanded` und `aria-controls`, ist über die Tastatur bedienbar
und zeigt Fokus sichtbar. Sein Ziel ist mindestens `--tap-target-size` hoch. Die drei Filterchips benutzen `aria-pressed`. Aktionsknöpfe haben
einen eigenen Namen und Fokus; der Stift heißt „Ergebnis bearbeiten“.

## 9. Repräsentative Aufrufer

`views/matchmaking.js` auf 390 px mit umbrochener Aktionsgruppe und auf 1024 px mit
nebeneinanderliegenden Teams.

## 10. Prüfungen und Abnahmebeispiele

E2E prüft Aufklappen, Ergebnis/Rematch, Filter und Nachladen. Auf 390 und 1024 px gibt es
keinen horizontalen Überlauf; ein langer Spielname schneidet keine Aktion ab.

## 11. Permanente Varianten und befristete Ausnahmen

`registry:match-history-disclosure` besitzt die Geometrie des Pfeil-Buttons. Keine
befristete Ausnahme.
