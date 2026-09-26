# RankedList

## 1. Status und Zweck

Status:

- Wertliste und Rangliste in „Meine Statistiken“: `umgesetzt`.
- Übrige Ranglisten und Wertlisten (`lb-row` in `leaderboard-list-grid`): `Zielvertrag,
  Umsetzung im Folgepaket „Ranglisten angleichen“`.

RankedList zeigt eine Liste von Einträgen mit genau einem Wert je Eintrag, etwa Spielzeit, Punkte
oder Anzahl. Die Liste liest sich von oben nach unten, auch wenn sie zwei Spalten belegt. Ist die
Reihenfolge eine Rangfolge, trägt jede Zeile ihre Platznummer.

Nicht-Ziele: RankedList ist keine Tabelle mit Spaltenköpfen (Stände bleiben nach Designregel 11
echte Tabellen), keine Auswahl- oder Aktionsliste und kein Kartenraster. Eine Rangliste sortiert
der Aufrufer nach ihrem Wert; eine Liste ohne Rang sortiert die Komponente selbst alphabetisch.

## 2. Quelle

- Helper: `public/js/rankedList.js`
- Markup: `rankedListHtml(items, { ranked = false, label = '' })`
- Spaltengrenze: `rankedListColumnBreak(count)` liefert den Index der ersten Zeile der rechten
  Spalte (`Math.ceil(count / 2)`).
- Eintrag: `{ title, meta?, value, lead?, rank?, sortKey? }`. `title`, `meta`, `value` und
  `lead` sind bereits escaptes HTML. `rank` überschreibt die Platznummer bei geteilten Plätzen.
  `sortKey` ist der Klartext für die alphabetische Sortierung; ohne ihn gilt der Titel ohne
  Markup.
- Sortierung ohne Rang: `sortUnrankedItems(items)`, `Intl.Collator('de', { numeric: true,
  sensitivity: 'base' })`.

## 3. CSS-Eigentümerschaft

`public/css/style.css` besitzt `.ranked-list`, `.ranked-list-row`, `.ranked-list-rank`,
`.ranked-list-lead`, `.ranked-list-text`, `.ranked-list-title`, `.ranked-list-meta`,
`.ranked-list-value`, die Zustandsklassen `is-ranked`, `has-lead`, `is-column-top` sowie die
Tokens `--ranked-list-value-width` und `--ranked-list-value-width-compact`. Aufrufer besitzen
nur die umgebende Karte und den Inhalt der Einträge.

## 4. Varianten

| Variante | API | Status | Bedeutung |
|---|---|---|---|
| Wertliste | `rankedListHtml(items)` | umgesetzt | ohne Rangbedeutung, alphabetisch sortiert, etwa Erfolge |
| Rangliste | `rankedListHtml(items, { ranked: true })` | umgesetzt | Reihenfolge ist eine Rangfolge; jede Zeile trägt ihre Platznummer |
| Mit Führungselement | Eintrag mit `lead` | umgesetzt | Avatar oder Spielersymbol vor dem Titel, etwa Spieler-Ranglisten |
| Geteilte Plätze | Eintrag mit `rank` | Zielvertrag | gleicher Wert, gleiche Platznummer, etwa Vote-Ergebnisse |

Dieselbe Lese- und Sortierregel gilt für mehrspaltige Kachelraster gleichartiger Einträge, die
keine RankedList sind: Sie füllen die linke Spalte zuerst. Erster Aufrufer ist der Live-Status auf
Home (`.home-live-grid`): zwei Spalten ab `--bp-md`, drei im Desktop-Modus, Zeilenzahl je
Spaltenzahl über `--home-live-rows-2` und `--home-live-rows-3`. Dort bleibt die fachliche Gruppe
(„Spielt“, „Online“, „Pause“, „Offline“) die erste Sortierstufe, innerhalb der Gruppe gilt das
Alphabet.

## 5. Erlaubte Anpassungen

- Aufrufer DÜRFEN die Reihenfolge einer Rangliste sowie Inhalt von Titel, Meta-Zeile, Wert und
  Führungselement bestimmen. Die Reihenfolge einer Wertliste bestimmt die Komponente.
- Aufrufer DÜRFEN die Liste in eine Karte oder in den Inhalt einer `.collapsible-section` setzen.
- Aufrufer DÜRFEN keine eigenen Rahmen, Hintergründe oder Kachelflächen an die Zeilen setzen und
  die Spaltenanordnung nicht überschreiben.

## 6. Komponenteneigene Invarianten

- **Sortierung:** Eine Rangliste MUSS nach ihrem Wert absteigend sortiert übergeben werden, bei
  „Längste“ und „Meiste“ also der größte Wert zuerst. Eine Wertliste behält die fachliche
  Reihenfolge der Quelle. Reihenfolgen der API, die keine Rangfolge sind (etwa „neuestes Event
  zuerst“), MÜSSEN vor einer Rangliste nach dem angezeigten Wert umsortiert werden.
- **Nummerierung:** Nur eine Rangliste trägt Platznummern. Sie beginnen bei 1, stehen in einer
  festen grauen Spalte vor dem Titel und laufen durch beide Spalten. Platz 1 bekommt keine
  Sonderfarbe und keinen Rahmen.
- **Spaltenordnung:** Ab `--bp-md` belegt die Liste zwei gleich breite Spalten und füllt sie
  spaltenweise, für Rang- und Wertlisten gleich: erst die linke Spalte von oben nach unten, dann
  die rechte. Links stehen die Einträge 1 bis `ceil(n / 2)`, rechts der Rest. Bei ungerader
  Anzahl ist die linke Spalte eine Zeile länger. Unter `--bp-md` ist die Liste einspaltig.
- **Zeilen:** flache Zeilen mit Haarlinie (`--border`) oben, keine Kacheln. Die erste Zeile jeder
  Spalte hat keine Haarlinie. Nebeneinanderstehende Zeilen haben denselben Innenabstand und
  teilen damit eine Mittellinie.
- **Wertspalte:** Der Wert steht fett, rechtsbündig und mit Tabellenziffern in einer festen
  Spalte (`--ranked-list-value-width`, unter `--bp-md` `--ranked-list-value-width-compact`). So
  stehen die Werte aller Zeilen und beider Spalten bündig.
- **Titel:** einzeilig, bei Überlänge mit Auslassung gekürzt. Die Meta-Zeile ist grau, kleiner
  und darf umbrechen. Leere Meta-Werte entfallen.

## 7. Erreichbare Zustände

- eine Zeile (nur linke Spalte);
- gerade und ungerade Anzahl;
- Einträge mit und ohne Meta-Zeile gemischt;
- sehr lange Titel;
- leere Liste: Der Aufrufer zeigt statt der Liste die einzeilige leere Karte aus Designregel 8.

## 8. Accessibility

- Die Liste trägt `role="list"`, jede Zeile `role="listitem"`, und über `label` einen
  zugänglichen Namen.
- Die DOM-Reihenfolge ist die Rangfolge; Screenreader und Tastatur lesen unabhängig von der
  Spaltenanordnung in der richtigen Reihenfolge.
- Die Platznummer ist sichtbarer Text, keine Farbe.

## 9. Repräsentative Aufrufer

- Schmal und breit: „Meine Statistiken“ (`public/js/views/myStats.js`) mit Erfolgen
  (Wertliste), Spielzeit pro Spiel, Spielzeit pro Event und Längsten Sessions (Ranglisten).
- Mit Führungselement: Karte „Rangliste“ auf Home (`public/js/views/home.js`), Top 6 mit Avatar.
- Vorbild vor diesem Vertrag: „Top 10 nach Bock-Level“ in Vote (`public/js/views/votes.js`,
  `.vote-ranking-columns`); Übernahme im Folgepaket.

## 10. Prüfungen und Abnahmebeispiele

- Unit-Test des Helpers: Spaltengrenze für 0, 1, 2, 5 und 18 Einträge; Wertliste alphabetisch
  mit natürlicher Zahlenordnung und unabhängig von Markup; Rangliste unverändert in
  Übergabereihenfolge; Platznummern nur mit `ranked`; `rank` überschreibt die Position; `is-column-top` genau an Index 0 und an der
  Spaltengrenze.
- Browser bei 390, 1100 und 1440 px: zwei Spalten ab 640 px, spaltenweise Nummern (18 Einträge:
  links 1 bis 9, rechts 10 bis 18; 13 Einträge: links 1 bis 7), keine Haarlinie über der ersten
  Zeile jeder Spalte, Werte bündig in einer Spalte, am Handy eine Spalte mit durchgehenden
  Haarlinien.

## 11. Permanente Varianten und befristete Ausnahmen

Keine Control-Klassen; die Zeilen sind nicht interaktiv. Befristet bestehen `lb-row` und
`leaderboard-list-grid` in Rangliste, Statistiken, Hall of Fame, Arcade und Vote weiter.
Löschkriterium: Umstellung dieser Aufrufer auf RankedList im Folgepaket. Der TV-Kiosk behält
seine Kacheln bewusst, weil er aus der Ferne gelesen wird.
