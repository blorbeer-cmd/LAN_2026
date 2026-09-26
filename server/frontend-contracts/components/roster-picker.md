# RosterPicker

## 1. Status und Zweck

Status: `umgesetzt`.

RosterPicker ist die gemeinsame Auswahlkomponente für Spielerteilnahmen in Matchmaking und
Turniererstellung. Sie verbindet eine Selection-Toolbar, die gemeinsame SelectionSearch, ein
Checkboxkarten-Raster und optionale spielerbezogene Zusatzinformationen. Spieleauswahl,
Packlisten und andere Listen mit abweichender Fachsemantik sind keine RosterPicker-Varianten.

## 2. Quelle

- Helper: `public/js/rosterPicker.js`
- Suche: `public/js/selectionSearch.js`
- Öffentliche Datenfunktionen:
  `pruneRosterSelection(selectedIds, players)`, `visibleRosterIds(players, query)`,
  `setVisibleRosterSelection(selectedIds, players, query, checked)` und
  `allVisibleRosterSelected(selectedIds, players, query)`
- Markup:
  `rosterPickerHtml({ id, players, selectedIds, query, toolbarLeadingHtml, toolbarLabel,
  searchLabel, gridClass, renderTrailing, showBulkActions, showSearch, emptyText, searchId,
  itemAttribute, playerAttribute, emptyAttribute, selectAllId })`
- Verdrahtung:
  `wireRosterPicker(container, { id, players, selectedIds, searchId, onQueryChange,
  onSelectionChange })`
- Externer Filter: `filterRosterPicker(container, id, query)` für ein Roster ohne eigenes Suchfeld

`toolbarLeadingHtml` und das Ergebnis von `renderTrailing(player)` sind vertrauenswürdiges,
aufruferseitig erzeugtes Markup. IDs, Labels, Klassenparameter, Spielernamen und Spieler-IDs
werden vom Helper escaped.

## 3. CSS-Eigentümerschaft

`public/css/style.css` besitzt `.selection-toolbar`, `.selection-search`,
`.player-selection-grid` und deren innere Raster-, Abstands-, Umbruch- und Namensregeln.
`public/css/domains.css` besitzt die allgemeine Zeilenstruktur `.check-row` und ausschließlich die
Matchmaking-spezifische dritte Desktopspalte. Die Basisgeometrie der Controls bleibt im
[Controls-Vertrag](controls.md).

Aufrufer-CSS DARF die äußere Platzierung und über `gridClass` eine bereits dokumentierte
Domänenklasse bestimmen. Es DARF weder innere Checkboxkartengeometrie noch Such-/Toolbarmaße
duplizieren.

## 4. Varianten

| Variante | API/Markup | Status | Bedeutung |
|---|---|---|---|
| Standardroster | `rosterPickerHtml(...)` | umgesetzt | Checkboxkarten mit Suche und einem sichtbarkeitsbezogenen Sammel-Umschalter |
| Ohne Sammelaktionen | `showBulkActions: false` | umgesetzt | Suche und Einzelwahl ohne Sammel-Umschalter |
| Ohne eigene Suche | `showSearch: false` plus `filterRosterPicker(...)` | umgesetzt | ein Suchfeld eines anderen Rosters filtert mit, etwa die Captains im Captain Draft |
| Erweiterte Toolbar | `toolbarLabel`, `toolbarLeadingHtml` | umgesetzt | fachliches Label oder aufruferspezifisches Control vor den Standardaktionen |
| Spielerzusatz | `renderTrailing(player)` | umgesetzt | vorhandene Skill-/Rolleninformation am Zeilenende |
| Kompatibilitätsanker | `itemAttribute`, `playerAttribute`, `emptyAttribute`, explizite IDs | umgesetzt | stabile bestehende View-Selektoren während der gemeinsamen Nutzung |

Es gibt keinen Disabled-Gesamtzustand und keine Variante für eine insgesamt leere Spielerliste.

## 5. Erlaubte Anpassungen

- Aufrufer DÜRFEN Suchlabels, Such-ID, den Text für keinen Suchtreffer und die angebotenen
  Sammelaktionen festlegen.
- Aufrufer DÜRFEN vertrauenswürdiges führendes Toolbar-Markup und vertrauenswürdiges
  spielerbezogenes End-Markup liefern.
- Eine zusätzliche `gridClass` DARF nur bereits dokumentierte Domänenplatzierung ergänzen.
- Aufrufer MÜSSEN `selectedIds` als langlebiges `Set` halten und Suchbegriff sowie Auswahl bei
  eigenen Re-Renders wieder übergeben.
- Fachliche Mindestzahlen, Disabled-Aktionen und Folgeschritte gehören dem Aufrufer.

## 6. Komponenteneigene Invarianten

- Die direkte Reihenfolge MUSS Toolbar → Raster → Suchtrefferstatus bleiben. Als `.stack`-Kinder
  besitzen Toolbar und Raster `gap: var(--space-3)`; das sind derzeit 12 px.
- Ein `toolbarLabel` (`.selection-toolbar-label`) steht wie jedes Feldlabel `var(--space-1)` über
  den Controls seiner Toolbar. Dadurch liegen Suche und Raster mit `toolbarLabel` und mit einem
  beschrifteten `toolbarLeadingHtml`-Feld (Anzahl Teams) auf derselben Höhe; der Wechsel zwischen
  Auslosung und Captain Draft verschiebt sie nicht. Ein Label ohne folgende Controls (Captains)
  behält den normalen Toolbarabstand.
- `.player-selection-grid` besitzt eine Spalte auf Phones und zwei Spalten ab `--bp-md`.
  Ausschließlich `#view-container[data-view='matchmaking']` im Desktop-Layoutmodus erhält drei
  gleich breite Spalten. Turnier- und andere Raster bleiben dort zweispaltig.
- `.check-row` stammt aus `domains.css`; das Roster ergänzt nur Kartenrahmen, Innenabstand und
  sicheren Namensumbruch.
- Filtern DARF bestehende Auswahl nicht verändern. Die Sammelaktion MUSS ausschließlich die
  aktuell sichtbaren Treffer ändern.
- Es gibt genau einen Sammel-Umschalter: Sind alle sichtbaren Treffer ausgewählt, wählt er sie ab
  (`listX`, „Sichtbare Spieler abwählen“), sonst wählt er sie aus (`listChecks`, „Sichtbare
  Spieler markieren“). Symbol und Name folgen Einzeländerungen und Suche ohne Re-Render.
- Einzeländerungen melden `onSelectionChange({ kind: 'single', playerId, checked })`,
  Sammeländerungen `onSelectionChange({ kind: 'bulk', checked })`.
- `pruneRosterSelection` entfernt ausschließlich IDs, die im aktuellen Roster nicht mehr
  vorkommen.
- Ein leerer Suchtreffer zeigt den komponenteneigenen `role="status"`-Text. Bei einer insgesamt
  leeren Spielerliste MUSS der Aufrufer stattdessen vor dem Picker einen EmptyState rendern; der
  Picker erzeugt keinen konkurrierenden allgemeinen Leerzustand.
- Lange Namen MÜSSEN innerhalb der Karte umbrechen können. Checkbox, Avatar und trailing
  Information schrumpfen nicht; es entsteht kein horizontaler Seitenoverflow.

Registry-Bezüge: `selection-toolbar`, `selection-icons`, `selection-buttons`,
`selection-search-actions`, `player-card` und `native-fields` in
[component-registry.mjs](../component-registry.mjs).

## 7. Erreichbare Zustände

- ungefiltertes Roster;
- gefiltertes Roster mit mindestens einem Treffer;
- Suchbegriff ohne Treffer;
- einzelne und sichtbarkeitsbezogene Sammelauswahl;
- bereits ausgewählte, durch den Filter versteckte Spieler;
- lange Spieler- und Gamertagnamen;
- keine insgesamt verfügbaren Spieler: EmptyState des Aufrufers, kein RosterPicker.

## 8. Accessibility

- Jede Spielerzeile ist ein echtes `label` mit nativem Checkbox-Control.
- Der sichtbare Name bleibt vollständig im DOM; ein Umbruch oder eine künftige zulässige Ellipse
  DARF den zugänglichen Namen nicht kürzen.
- Der Sammel-Umschalter trägt je nach Zustand den zugänglichen Namen „Sichtbare Spieler
  markieren“ oder „Sichtbare Spieler abwählen“ und zeigt sichtbare Fokusdarstellung.
- Die Suche ist beschriftet und ihr Trefferstatus verwendet `role="status"`.
- Filtern und Raster-Reflow DÜRFEN DOM- und Tab-Reihenfolge nicht verändern.

## 9. Repräsentative Aufrufer

- Schmal und breit: `public/js/views/matchmaking.js` für Auslosung, Draftteilnehmer und Captains;
  die Captains nutzen `showSearch: false` und werden vom Draftteilnehmer-Suchfeld mitgefiltert
- Schmal und breit: `public/js/views/tournament.js` für die Turniererstellung

## 10. Prüfungen und Abnahmebeispiele

- `public/js/rosterPicker.test.js` prüft Bereinigung, sichtbare IDs, Sammeländerungen, den
  Zustand des Sammel-Umschalters, die Variante ohne eigene Suche und das
  Markup-/Kompatibilitätsinterface.
- `src/test/e2e/flowsCompetition.fixture.ts` prüft Matchmaking mit ungefiltertem und gefiltertem
  Roster, keinem Treffer, Einzel-/Sammelauswahl, verborgener Auswahl, langem Namen,
  1-/2-/3-Spaltenlayout und gleicher Such-/Rasterhöhe beim Wechsel Auslosung ↔ Captain Draft.
- `src/test/e2e/flowsShell.fixture.ts` prüft denselben Helper in der Turniererstellung und bewahrt
  dort die 1-/2-Spaltenobergrenze.
- Bei 320×568 und 390×844 gilt eine Spalte, ab 640 px zwei. Bei 1280 px im aktiv gewählten
  Desktopmodus gilt nur für Matchmaking die dritte Spalte. Bei 512×384 und 720×450 dürfen Raster,
  Toolbar, lange Namen und der tatsächlich scrollende View-Container horizontal nicht überlaufen.
- Der gemessene Abstand von Toolbar-Unterkante zu Raster-Oberkante MUSS
  `var(--space-3)` entsprechen.

## 11. Permanente Varianten und befristete Ausnahmen

Die Registry-IDs `selection-toolbar`, `selection-icons`, `selection-buttons`,
`selection-search-actions` und `player-card` sind permanente, bereits begründete Varianten des
Controls-Vertrags. Die Matchmaking-Dreispalte ist eine permanente Domänenplatzierung, keine neue
Controlgeometrie. Es gibt keine befristete RosterPicker-Ausnahme.

- `registry:roster-selection-frame`: Shared roster owns the checkbox-card inset, border radius and safe name reflow.
