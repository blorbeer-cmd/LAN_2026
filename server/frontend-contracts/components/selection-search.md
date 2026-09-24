# SelectionSearch

## 1. Status und Zweck

Status: `umgesetzt`.

SelectionSearch filtert bereits gerenderte Auswahlzeilen lokal und lässt deren Auswahlzustand
unangetastet. Der Helper stellt ein ständig sichtbares, benanntes Toolbar-Suchfeld („Spieler
suchen…“, „Spiel suchen…“) sowie die reine Verdrahtung eines bereits vorhandenen Suchfelds bereit. Er ist kein serverseitiges Suchsystem und
besitzt weder Ergebnisnavigation noch fachliche Auswahlregeln.

## 2. Quelle

- Helper: `public/js/selectionSearch.js`
- Normalisierung: `public/js/searchText.js`
- Markup:
  `selectionSearchHtml(inputId, query, { placeholder = 'Spieler suchen…',
  label = 'Spieler suchen' })`
- Vergleich: `matchesSelectionSearch(value, query)`
- Verdrahtung:
  `wireSelectionSearch(container, { inputId, itemSelector, emptySelector, onQueryChange })`

`itemSelector` bezeichnet Elemente, deren `data-selection-search` den durchsuchbaren Rohtext
enthält. `emptySelector` ist der vorhandene Trefferstatus des Aufrufers.

## 3. CSS-Eigentümerschaft

`public/css/style.css` besitzt `.selection-search`, `.selection-search-trigger`,
`.selection-search-field`, `.selection-search-close` sowie ihre Toolbar-, Control- und
Reflowgeometrie. Der Aufrufer besitzt ausschließlich das Layout der gefilterten Elemente und die
äußere Platzierung seines Suchfelds. Basismaße kommen aus dem [Controls-Vertrag](controls.md).

## 4. Varianten

| Variante | API/Markup | Status | Bedeutung |
|---|---|---|---|
| Sichtbares Toolbar-Suchfeld | `selectionSearchHtml(...)` plus `wireSelectionSearch(...)` | umgesetzt | benanntes Suchfeld ohne Icontrigger; der Platzhalter sagt, was gesucht wird |
| Beibehaltener Suchbegriff | nichtleeres `query` | umgesetzt | Suchbegriff steht im Feld und filtert sofort |
| Ständig sichtbares Suchfeld | nur `wireSelectionSearch(...)` | umgesetzt | vorhandenes `input[type='search']`, derzeit im Spielekatalog |

Ein Disabled-Gesamtzustand und eine asynchrone Suchvariante existieren nicht.

## 5. Erlaubte Anpassungen

- Aufrufer DÜRFEN ID, sichtbares/zugängliches Label, Platzhalter, Zielselektor und den vorhandenen
  Trefferstatus bestimmen.
- Aufrufer DÜRFEN die reine Verdrahtungsvariante mit einem eigenen sichtbaren Suchfeld verwenden.
- `onQueryChange` DARF den Suchbegriff für einen späteren View-Re-Render speichern.
- Der Aufrufer DARF die gefilterten Zeilen fachlich gestalten, aber nicht die innere Geometrie der
  Suchgruppe überschreiben.

## 6. Komponenteneigene Invarianten

- Leere oder nur aus Whitespace bestehende Suche MUSS alle Elemente zeigen und den
  Kein-Treffer-Status verbergen.
- Vergleich erfolgt case-insensitiv und diakritikrobust über `normalizeSearchText`; nichtlateinische
  Schriftzeichen bleiben erhalten.
- Filtern setzt ausschließlich `hidden` an den Zielzeilen. Checkbox-, Radio- oder anderer
  Auswahlzustand bleibt unverändert.
- Der Kein-Treffer-Status wird nur bei nichtleerem Suchbegriff und null sichtbaren Treffern
  eingeblendet.
- Das Suchfeld ist immer sichtbar; Leeren des Felds filtert synchron zurück auf den Vollbestand.
- Ein beibehaltener nichtleerer Suchbegriff steht schon im Markup und wird beim Wiring sofort
  angewendet.

Registry-Bezüge: `selection-toolbar`, `selection-icons`, `selection-search-actions` und
`native-fields` in [component-registry.mjs](../component-registry.mjs).

## 7. Erreichbare Zustände

- ohne Suchbegriff;
- mit beibehaltenem oder neu eingegebenem Suchbegriff;
- mindestens ein Treffer;
- kein Suchtreffer mit sichtbarem Status;
- geleertes Feld mit zurückgesetztem Filter;
- Re-Render des Aufrufers mit wieder übergebenem Suchbegriff.

## 8. Accessibility

- Das Suchfeld besitzt ein `aria-label` und einen sichtbaren Platzhalter mit demselben Zweck.
- Der Aufrufer MUSS den Kein-Treffer-Text als Statusregion bereitstellen.
- Eingabe und Leeren sind vollständig per Tastatur erreichbar; sichtbarer Fokus folgt dem
  Controls-Vertrag.
- Filtern verändert weder DOM- noch Tab-Reihenfolge der verbleibenden Elemente.

## 9. Repräsentative Aufrufer

- `public/js/rosterPicker.js` für Matchmaking und Turniererstellung
- `public/js/views/votes.js` für die Spielesuche („Spiel suchen…“) der neuen Abstimmung
- `public/js/views/gameCatalog.js` für das ständig sichtbare Suchfeld des Spielekatalogs

## 10. Prüfungen und Abnahmebeispiele

- `public/js/selectionSearch.test.js` prüft Normalisierung sowie das sichtbare, benannte Markup mit
  beibehaltenem Suchbegriff.
- `src/test/e2e/flowsCompetition.fixture.ts` prüft Matchmaking und Vote: ungefiltert, Treffer,
  kein Treffer, verborgene Auswahl, Sammeländerung und Zurücksetzen durch Leeren.
- `src/test/e2e/flowsShell.fixture.ts` prüft Turniererstellung und Spielekatalog einschließlich
  ständig sichtbarer Suche und wiederhergestelltem Vollbestand.
- Bei 320×568, 390×844, 512×384, 640 px, 720×450 und Desktop darf die Suchgruppe keinen
  horizontalen Overflow im tatsächlich scrollenden View-Container erzeugen. Das Suchfeld hat die
  Standardhöhe der Controls.

## 11. Permanente Varianten und befristete Ausnahmen

Die Registry-IDs `selection-search-actions`, `selection-icons`, `selection-toolbar` und
`native-fields` beschreiben die permanenten Control- und Containerrollen. Die ständig sichtbare
Suche im Spielekatalog ist eine dauerhafte Integrationsform der bestehenden Wiring-API, keine
zusätzliche CSS-Geometrie. Es gibt keine befristete SelectionSearch-Ausnahme.

- `registry:selection-search-field`: Shared search field fills its wrapping search container.
