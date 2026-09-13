# Controls

## 1. Status und Zweck

Dieser Vertrag trennt Bedeutung, Breite und Geometrie interaktiver Controls und ist die normative
Detailquelle für ihre Größen-, Umbruch-, Fokus- und Eigentumsregeln. Standardcontrols verwenden auf
Desktop und Mobile `--control-height`; eine automatische Größenumschaltung nach Viewport oder
Eingabemodalität existiert nicht.

Paket 1 (Arcade-Segmentpilot und Erstellungszeile) sowie Paket 2 (globale Basiscontrols,
Pollbewertung und DataRowAction) sind umgesetzt. Folgepakete bleiben eigenständige Aufträge.

## 2. Quelle

- Tokens und globale Controls: `public/css/style.css`
- Arcade-Segment und Erstellungszeile: `public/css/arcade.css`
- Segment-Markup: `public/js/arcade/lobbyReady.js`
- DataRowAction: `public/css/domains.css`, Kontozugangszeilen in `public/js/views/admin.js`
- Pollbewertung: `public/js/views/eventPolls.js`
- Reine Registry-Daten: [component-registry.mjs](../component-registry.mjs)
- Browserabdeckung: bestehende Owner `authGate.e2e.test.ts`, `flowsShell.fixture.ts`,
  `eventDatePoll.e2e.test.ts` und `authGateArcade.e2e.test.ts` unter `src/test/e2e/`

`lobbyReady.js` und die Arcade-Viewdateien bleiben in Paket 2 unverändert.

## 3. CSS-Eigentümerschaft

`style.css` besitzt `.btn`, `.btn-sm`, `.btn-square`, `.btn-block`, `.btn-equal`, `.icon-btn`,
globale Inputs/Selects/Textareas, Selection-Toolbar, ActionMenu und die Controltokens.

`arcade.css` besitzt `.arcade-mode-toggle*` sowie ausschließlich das Containerlayout der
`.arcade-lobby-create-row`. Domänen-CSS DARF Platzierung, Reihenfolge, Außenabstand und dokumentierte
Containerstapelung besitzen, aber keine innere Controlgeometrie überschreiben. Eine Bedeutungs- oder
Breitenklasse DARF keine eigene Höhe, Typografie oder Innengeometrie definieren.

## 4. Varianten

Die Selektoren und Eigentümer stehen in der Registry; diese IDs beschreiben ihre Geometrie.
Bedeutung und Breite werden mit der Basisvariante kombiniert.

| Registry-ID | Einzeilige Höhe | Breite |
|---|---:|---|
| `button`, `button-small`, `button-meaning`, `button-width` | 31–33 px | Inhalt bzw. gewählte Breitenregel |
| `native-fields` | 31–33 px; Textarea wächst über rows/Inhalt | Container |
| `icon-button`, `selection-icons`, `info-trigger` | 31–33 px | mindestens 44 px |
| `button-square` | exakt 32 px | exakt 32 px |
| `arcade-segment` | 31–33 px | Segment/Pille |
| `action-menu-trigger` | 31–33 px | Inhalt |
| `action-menu-entry` | mindestens 44 px | mindestens 44 px |
| `number-stepper` | zwei interne Hälften des 32-px-Felds | interne Spalte |

Es gibt keine `.btn-touch`-Klasse und keine Variante `kompakt-touch`. Eine segmentierte Einstellung
besitzt genau zwei Optionen; ab drei benannten exklusiven Optionen MUSS ein natives `select`
verwendet werden. Selection-Toolbars, Filterchips, Tabs und Feasibility-Abstimmungen sind keine
segmentierte Einstellung im Sinne dieser Regel.

### Strukturziele mit 44 px

`--tap-target-size` bleibt unverändert für die folgenden Strukturziele: topbar/section/page-title
header rows, navigation rail button, collapsible-section header, food-order and seating rows,
searchable-select option rows, calendar day grid, game-board/memory cells and the kiosk TV canvas
(its own device class). Icon-Controls verwenden den Token regelmäßig als Mindestbreite, nicht als
Standardhöhe. Die Registry-IDs `calendar-days`, `search-options`, `structural-cards`, `player-card`,
`player-selection-actions`, `structural-disclosure`, `arcade-tile`, `battleship-grid`,
`battleship-ship-display`, `global-search-result`, `challenge-targets` und `scribble-word-choice`
erhalten ihre vorhandene Strukturgeometrie.
Ganze Karten, Spielreaktionsflächen und die große Wortauswahl können größer als 44 px sein;
die Normalisierung definiert ihre bestehenden Spielmaße nicht neu.

## 5. Erlaubte Anpassungen

- Bedeutung: neutral (`.btn`), primär (`.btn-primary`), destruktiv (`.btn-danger`) oder bereit
  (`.btn-ready`).
- Breite: normal, voller Container (`.btn-block`) oder gruppenweit gleich (`.btn-equal`).
- Geometrie: Standard, kompakte Textdarstellung, Icon-Control, quadratische Skala,
  Arcade-Segmentgruppe, strukturelle Menüzeile oder registriertes zusammengesetztes Control.
- Aufrufer DÜRFEN Platzierung, DOM-Reihenfolge, Außenabstand und dokumentierte Containerstapelung
  bestimmen. Sie DÜRFEN Nutzertext nicht kürzen, um eine Aktion passend zu machen.
- Sichtbare Ellipse ist nur für ein dokumentiertes Textfeld zulässig; vollständiger DOM- und
  Accessible Name bleiben erhalten.

## 6. Komponenteneigene Invarianten

### Tokens und einzeilige Controls

- `--control-height: 32px` ist normativ; die gemessene einzeilige Border-Box MUSS 31–33 px betragen.
- `--control-line-height: 1.25` ist die Zeilenhöhe einzeiliger Controls.
- `--tap-target-size: 44px` ist ausschließlich Strukturhöhe oder Icon-Mindestbreite.
- Umbruchfähige Controls MÜSSEN `min-height` statt starrer Höhe verwenden. Wachstum über 33 px ist
  nur bei tatsächlichem Umbruch oder dokumentiert mehrzeiligem Inhalt zulässig.
- Inhalt MUSS vertikal zentriert bleiben. Vertikales Padding DARF auf ganze Pixel gerundet werden.
- Icon und Text eines Basisbuttons haben `--space-1` Abstand; dokumentierte zusammengesetzte
  Varianten dürfen ihren eigenen Abstand behalten.

Basisbuttons verwenden vertikal 6 px, native Felder 5 px Padding mit der Control-Zeilenhöhe.
Die Mindesthöhe hält auch kleinere Schrift einzeilig bei 32 px; echter Umbruch wächst ohne
Clipping. Quadratische Skalen haben die ausdrücklich feste 32×32-px-Geometrie. Textareas
besitzen keine starre Höhe; einzeilige und mehrzeilige rows-Zustände werden getrennt gemessen.

### Zusatzklassen und zusammengesetzte Controls

Das mechanische Inventar am PR-Head ordnet jede tokenbasierte Höhendeklaration in den fünf
CSS-Dateien und jede Klasse an interaktiven JS-Markup-Elementen genau einer Registry-Rolle zu:
1 Standard-/Icon-Control, 2 permanentes Strukturziel, 3 interner Teil eines zusammengesetzten
Controls oder 4 befristete Ausnahme. Jede Fundstelle mit Datei, Zeile und Selektor steht am PR.
Modifier und Zustandsmarker erben die Geometrie des Trägers; ihre Registrierung erlaubt keine
eigenen Innenmaße. Die Registry bleibt reine Daten; Paket 5 validiert sie mit dem Snapshot-Komponentencheck.

Die Standardfamilien `date-fields`, `search-select`, `profile-controls`, `row-icons`,
`arrival-controls`, `filter-chip`, `section-tab`, `poll-choice`, `admin-controls`, `vote-fields`,
`food-fields`, `payment-controls`, `result-fields`, `arcade-mute` und `music-controls`
verwenden die passende Basisvariante.

Die internen Familien `selection-toolbar`, `number-stepper`, `data-row-action`, `food-action-slots`,
`result-actions`, `bracket-row`, `rating-slider`, `rating-suggestion`, `row-layout`, `selection-state`,
`payment-state`, `scribble-tools` und `arcade-segment` behalten ihre dokumentierte Einbettung.
NumberStepper-Hälften ergänzen das native Zahlenfeld; Slider, Zeichenpalette und Bracketzeilen
sind keine unabhängigen Standardbuttons. Zustands-/Layoutmarker besitzen keine eigene Controlhöhe.

`poll-disclosure` und `food-disclosure` enthalten Überschrift plus Runden-/Frist- bzw.
Personen-/Bestellmetadaten und dürfen in diesem mehrzeiligen Zustand höher als 33 px sein.
Die bloße Zustandsänderung eines normalen Buttons erzeugt keinen mehrzeiligen Sonderfall.

Die Bezeichnung „Toggle“ registriert keine eigene Geometrie. Ein Button mit `aria-pressed` folgt
seiner tatsächlichen Klassenvariante.

### Text, Enge und Reflow

- Standardbuttons und Menüeinträge DÜRFEN umbrechen und dadurch wachsen.
- Basisbuttons behalten ihre automatische Mindestbreite als Flex-Item und verwenden
  `overflow-wrap: break-word`: echter Überlauf darf umbrechen, die min-content-Wortbreite wird
  nicht auf einzelne Zeichen reduziert. Menüeinträge behalten ihr eigenes `anywhere`.
- `.btn-sm` DARF nur bei kurzem anwendungseigenem Text `nowrap` verwenden, wenn führender Inhalt
  ellipsiert oder die gesamte Aktion gestapelt werden kann.
- Gruppen MÜSSEN ganze Controls statt einzelner Labels stapeln; ein Textlabel DARF nicht durch ein
  Icon ersetzt werden. DOM- und Tab-Reihenfolge bleiben unverändert. Die Arcade-Zeile bewahrt dabei
  ihre bereits bestehende mobile visuelle Reihenfolge CTA → Modus → Gegner.
- Inputs, Selects und gezielt schrumpfende Text-/Layoutbereiche verwenden `min-width: 0`.
  Allgemeine Zeilen und verschachtelte Aktionsgruppen behalten ihre automatische Mindestbreite;
  sie dürfen nicht unter die benötigte Breite ihrer Controls schrumpfen.
- Einladungszeilen lassen die vollständige Aktionsgruppe bei Platzmangel in die nächste Zeile
  umbrechen. Nur die Textseite darf innerhalb ihrer verfügbaren Breite schrumpfen und umbrechen;
  Namen und Metadaten bleiben vollständig erhalten.
  Dasselbe Reflow-Prinzip gilt für Namen und Statusgruppe in den Agent-Diagnosezeilen.
- Desktop-Reflow wird als 1024×768 → 512×384 und 1440×900 → 720×450 geprüft. Phone-Reflow wird
  separat mindestens bei 320×568 geprüft; 390×844 wird nicht künstlich halbiert.
- Es darf weder horizontalen Seitenoverflow noch abgeschnittene Labels geben; alle Controls bleiben
  tastaturerreichbar.

### Arcade-Segmentgruppe

- Pille und jedes Segment MÜSSEN eine echte Border-Box von 31–33 px besitzen.
- Die Pille besitzt kein Innenpadding und keinen layoutwirksamen Rahmen; die Kontur ist ein inset
  `box-shadow`.
- Segmente verwenden `padding-block: 0`, `line-height: var(--control-line-height)`, behalten das
  horizontale Padding und kurze Labels mit `nowrap` und füllen die Pillenhöhe.
- Der aktive Hintergrund füllt das Segment vollflächig. Er DARF die inset Kontur an der aktiven
  Außenkante verdecken.
- Die Pille DARF kein `overflow: hidden` verwenden; `:focus-visible` mit `outline-offset` MUSS
  unbeschnitten bleiben. Pseudo-Elemente außerhalb der Border-Box zählen nicht zur Trefferfläche.

### Arcade-Erstellungszeile und Schwelle S

- `.arcade-lobby-create-row` besitzt mindestens `--control-height`; unter 640 px verwendet das Grid
  Autozeilen von mindestens `--control-height`, ab 640 px bleibt die Flex-Zeile `nowrap`.
- `.arcade-lobby-create-actions` ist ein Inline-Size-Container. Unter `S = 188px` Innenbreite stehen
  CTA, Moduspille und Gegnerpille in drei vollen Zeilen; fehlende Pillen erzeugen keine leere Zeile.
  Der Tooltip bleibt in der Zeile seines CTA. Bei 390 px bleibt das bestehende zweizeilige Layout.
- Die Messung mit Chromium und Zielgeometrie prüfte 100–360 px in 1-px-Schritten: Tetris 165 px,
  Pong 184 px, Snake 165 px, Blobby 184 px. Die rohe schlechteste Labelgrenze ist damit 184 px.
  Der 320-px-Viewport liefert 186 px Containerinnenbreite; die reine 184-px-Grenze würde die
  ausdrücklich geforderte Dreizeiligkeit nicht auslösen. `S = 188px` ist deshalb die kleinste
  notwendige Anpassung: genau ein weiterer 4-px-Rasterschritt. Bei 390 px stehen 256 px zur
  Verfügung, sodass die Stopbedingung sicher nicht greift.
- Containerlayout DARF keine Höhe, Schrift, Innenabstände oder Zeilenhöhe des CTA ändern.
- Der Warn-Tooltiptrigger bleibt 44 px breit und 31–33 px hoch. Disabled- und Aktivzustand besitzen
  dieselben Controlhöhen.

### Selection-Toolbar und Pollbewertung

Selection-Toolbar-Textbuttons folgen 31–33 px; Iconbuttons messen mindestens 44×32 px. Pollwerte
1–5 verwenden `.btn.btn-square`, messen gewählt wie ungewählt 32×32 px und behalten
`gap: var(--space-2)`. Eine Reihe benötigt `5 × 32 + 4 × 8 = 192px`; unterhalb dieser verfügbaren
Elternbreite bricht sie geordnet 1–5 um. Beide kollidierenden Kontextregeln berücksichtigen die
Quadratvariante; die konkurrierenden Höhen-/Mindestbreitenvorgaben und der frühere
30×30-Override sind ersetzt. Gemessen wird die verfügbare Elternbreite, nicht die fit-content-Breite
der Toolbar; die Browserprüfung erzwingt zusätzlich 192 und 191 px Elternbreite.

### DataRowAction

Registry-ID `data-row-action` bezeichnet ausschließlich die Kontozugangszeile in `accountRows`
(Name, Aktiv/Noch nicht übernommen, Reset-Link/Claim-Link). Nur ihr eigener Container besitzt die
Inline-Size-Abfrage; allgemeine Zeilen und die separate Spieler-Verwaltung erhalten keine Regel.

Ab 320 px Innenbreite stehen Name/Badge/Aktion in einer Zeile; darunter belegen Name/Badge
Zeile 1 und die vollständige Aktion Zeile 2. Der Button folgt 31–33 px. Nur der Name erhält
`min-width: 0` und sichtbare Ellipse, vollständiger DOM- und Accessible Name bleiben erhalten.
Badge schrumpft nicht; Badge und kurzes anwendungseigenes Aktionslabel bleiben `nowrap`.

Die Innenbreite wird als clientWidth abzüglich horizontalem Padding erfasst. Da clientWidth
ganzzahlig rundet, wird der fraktionale Grenzfall zusätzlich über die Border-Box abzüglich
Rahmen/Padding überprüft. Die CSS-Range-Abfrage auf die tatsächliche Containerbreite erfasst
auch 319,75 px; 320 px bleibt einzeilig. Die rohe 320-px-Schwelle besitzt den Kommentar
`design-token-ok: DataRowAction-Schwelle` auf derselben Zeile.

## 7. Erreichbare Zustände

- Standard: aktiv, Hover nur auf Hover-Geräten, Tastaturfokus und deaktiviert.
- Segment: erste oder zweite Option aktiv; beide Optionen können fachlich deaktiviert sein.
- Arcade-Erstellungszeile: beide Pillen, nur Modus, nur Gegner, keine Pille; aktiver CTA oder eigene
  offene Lobby/aktives Spiel mit deaktiviertem CTA und Warn-Tooltip.
- Segmentierte Optionen bleiben fachlich erhalten: Tetris/Snake `Duell`/`Arena`, Pong/Blobby
  `Duell`/`Doppel`, Gegner `Mensch`/`KI`.

## 8. Accessibility

- Controls verwenden semantische Elemente und verständliche deutsche Namen.
- Segmentgruppen besitzen `role="group"`, eine Gruppenbeschriftung und `aria-pressed` pro Option;
  Auswahl wird nicht nur über Farbe vermittelt.
- DOM- und Tab-Reihenfolge bleiben bei Reflow unverändert. Jede erreichbare Option, der CTA, ein
  vorhandener Warn-Tooltip und die Gegneroptionen MÜSSEN per Tastatur erreichbar sein.
- Der globale `:focus-visible`-Ring MUSS sichtbar bleiben; kein Vorfahr zwischen Segment und
  Lobbykarte DARF ihn durch nicht sichtbaren Overflow beschneiden.
- Bei 320×568 MUSS jedes Segment `scrollWidth <= clientWidth` erfüllen; dasselbe gilt für das
  Dokument. Lange Beschriftungen führen zum Stapeln ganzer Controls, nicht zu Textersatz.

## 9. Repräsentative Aufrufer

- Vollständige Segmentzeile: `public/js/arcade/views/tetris.js`, `pong.js`, `snake.js`, `blobby.js`
- Nur Gegnerpille: `public/js/arcade/views/arcade.js` (Quiz), `arcadeScribble.js`, `battleship.js`
- Keine Pille: `public/js/arcade/views/challengeRush.js`
- Disabled mit Warn-Tooltip: eigene offene Tetris-Lobby in `tetris.js`

## 10. Prüfungen und Abnahmebeispiele

`authGateArcade.e2e.test.ts` prüft mit isolierter In-Memory-Datenbank:

- Tetris, Pong, Snake und Blobby bei 640, 1024 und 1440 px: CTA, beide Pillen und jedes Segment
  31–33 px; paarweise Mittellinienabweichung höchstens 1 px.
- Quiz, Scribble und Battleship bei 1024 px: CTA/Gegnerpille 31–33 px und gleiche Mittellinie; bei
  1440 px derselbe linke CTA-Einzug wie Tetris (Toleranz 1 px).
- Challenge Rush: CTA 31–33 px bei unveränderter Breite und symmetrischem Einzug.
- Tetris bei 390 px: CTA in Zeile 1, beide Pillen in Zeile 2, Containerregel inaktiv, kein Label-
  oder Seitenoverflow.
- Tetris bei 320 px: CTA/Modus/Gegner in drei vollen Zeilen, jede Border-Box 31–33 px, keine
  Änderung an DOM-/Tab-Reihenfolge und kein Overflow.
- Eigene offene Lobby bei 390 und 1024 px: CTA und Gegnersteuerung deaktiviert, Tooltip 31–33 px,
  unveränderte Mittellinie.
- Tastaturreihenfolge, sichtbarer unbeschnittener Fokus sowie aktive und deaktivierte Zustände.

Die bestehenden Core-Owner prüfen zusätzlich bei 320×568, 390×844, 512×384, 720×450,
1024×768 und 1440×900:

- Standardbutton, kompakte/Bedeutungs-/Breitenvarianten, native Felder und Iconcontrols:
  31–33 px, zentrierte Inhalte (höchstens 1 px Abweichung), Iconbreite mindestens 44 px.
- Echten Textumbruch mit wachsender Border-Box ohne Clipping sowie Textarea mit rows 1 und 3.
- Pollwerte 1–5 gewählt/ungewählt exakt 32×32 px, 8 px Abstand, verfügbare Elternbreite,
  192/191-px-Grenze und unveränderte Tastaturreihenfolge in beiden Richtungen.
- ActionMenu-Trigger 31–33 px und Einträge mindestens 44×44 px.
- Echte Admin-Einladungszeilen bei 320/390 px: Anzeigen/Widerrufen einzeilig bei 31–33 px
  vollständig innerhalb der Zeile; der tatsächliche View-Container darf nicht horizontal
  überlaufen. Die kanonische Zurück-Navigation behält 4 px Icon-/Textabstand.
- Infoboard-Aktionsgruppen bleiben bei 390 px neben einem langen Titel innerhalb ihrer Zeile.
- DataRowAction bei 320/319/319,75 px Innenbreite: volle zweite Aktionszeile, unverkleinertes
  Badge, vollständiger Name im DOM und Accessibility Tree, sichtbarer Tastaturfokus.
- Kein horizontaler Seitenoverflow. Die Tests verwenden isolierte In-Memory-Daten.

Die vollständige Verifikation umfasst außerdem `lint`, `build`, Unit-/Integrationstests,
`check:tokens`, Arcade-Smoke und die vollständige E2E-Suite.

## 11. Permanente Varianten und befristete Ausnahmen

Die IDs aus `permanentVariants` dokumentieren bestehende Kontextregeln und Strukturziele.
Eine permanente Kontextregel darf weiterhin nur ihre angegebene Eigenschaft besitzen;
ihre Registrierung ist keine Erlaubnis für neue Innengeometrie.

| Registry-ID | Dauerhafte Begründung |
|---|---|
| `action-menu-trigger`, `action-menu-entry` | Trigger 32 px; strukturelle Menüzeilen mindestens 44×44 px mit Textumbruch. |
| `topbar-icons`, `selection-search-actions` | Iconaktionen mit reservierter 44-px-Breite und globaler Innengeometrie. |
| `selection-buttons`, `poll-secondary`, `poll-text-width`, `poll-choice-text` | Toolbarlayout und Bedeutung respektieren die gewählte Basis-/Quadratvariante. |
| `search-field` | Natives Feld reserviert die Breite der integrierten Dropdownaktion. |
| `profile-preview`, `tournament-label` | Nichtinteraktive Vorschau bzw. Feldbeschriftung folgt der benachbarten Controlzeile. |
| `arrival-sort-mobile`, `interactive-chip`, `invite-link-controls`, `admin-test-fields` | Bestehende Formular-/Sortierkontexte behalten Platzierung und kurze eigene Labels bei 32 px. |
| `data-row-name`, `data-row-action-label` | Nur der Name ellipsiert; die vollständige kurze Aktion stapelt unter 320 px. |
| `food-position-slots`, `food-payment-marker`, `food-header` | Passende Aktions-/Leerplätze, 32-px-Zahlungsaktion und permanenter 44-px-Kartenkopf. |
| `vote-submitted-state` | Nichtinteraktive Bestätigung mit Statusinhalt. |
| `arcade-toolbar-buttons`, `challenge-test-disclosure` | Standardhöhe mit echtem Textumbruch; Segment-/Erstellungsgeometrie bleibt beim Pilotvertrag. |
| `topbar-title`, `desktop-navigation`, `page-heading`, `subpage-heading`, `tabbed-subpage-heading`, `section-heading`, `section-title` | Bestehende 44-px-Kopf-/Navigationszeilen und mehrzeilige Headerreservierungen. |
| `seating-pool`, `seating-player` | Strukturelle Sitzplatz-Ablagefläche und 44-px-Spielerzeile. |
| `music-copy-actions`, `music-cover` | Globale Kopieraktionen; unverändertes nichtinteraktives 76-px-Cover. |
| `kiosk-header-action`, `kiosk-match-row` | Permanente 44-px-Ziele der eigenständigen TV-Geräteklasse. |

Die bisherige Ausnahme `legacy-secondary-modifier` ist in Paket 5 aufgelöst: Der ungenutzte Modifier am Kiosk-Passwort-Retry wurde entfernt. Es bestehen keine offenen befristeten Ausnahmen.

- `registry:button`: Standard text button; meaning and width compose without changing its interior.

- `registry:button-meaning`: Color and state only; inherit the selected geometry.

- `registry:button-width`: Width only; inherit the selected geometry.

- `registry:button-small`: Compact text at the same 32px minimum height.

- `registry:button-square`: Numeric poll scale: exactly 32 by 32px, including selected values.

- `registry:icon-button`: 32px height and at least 44px width.

- `registry:native-fields`: 32px single-line fields; textarea rows/content may grow.

- `registry:selection-icons`: Selection and search icons inherit icon-button geometry.

- `registry:selection-toolbar`: Wrapping container preserves gap, whole controls and DOM order.

- `registry:info-trigger`: Help and warning use the same 44 by 32px hit box.

- `registry:date-fields`: DateTime manual fields, native selects and adjacent calendar/clear actions.

- `registry:calendar-days`: Permanent six-row calendar grid and its 44px day cells.

- `registry:number-stepper`: Two supplementary half-buttons inside a 32px number field.

- `registry:search-select`: Field-integrated 44 by 32px dropdown trigger.

- `registry:search-options`: Permanent listbox option rows, at least 44px.

- `registry:profile-controls`: Profile controls use the standard field/button/icon variants.

- `registry:row-icons`: Copy, dismiss and detail actions retain their 44px icon slot.

- `registry:arrival-controls`: Native textarea rows and 32px sorting buttons.

- `registry:filter-chip`: Interactive filter chips use 32px; passive chip labels are outside this control variant.

- `registry:section-tab`: Navigation button composed with the base button and optional meaning modifier.

- `registry:poll-choice`: Compact choice text retains the standard minimum height.

- `registry:poll-disclosure`: Composite card header: title plus round/deadline metadata are a documented multiline state.

- `registry:data-row-action`: Only the account-access row contains the 320px name/badge/action reflow query.

- `registry:admin-controls`: Role field; its container handles reflow without changing standard field height.

- `registry:vote-fields`: Textarea minimum; rows/content determine the multiline state.

- `registry:food-fields`: Standard fields and add button retain their form-column placement.

- `registry:payment-controls`: 32px payment/copy actions; icon actions inherit the shared minimum width.

- `registry:food-action-slots`: Composite position row reserves matching 44 by 32px action and empty slots.

- `registry:food-disclosure`: Card/roster heading and person plus metadata form a composite, optionally multiline disclosure.

- `registry:result-fields`: 32px score fields reserve the existing internal stepper column.

- `registry:result-actions`: Actions embedded in the score/bracket grid retain its reserved gutter and slot geometry.

- `registry:bracket-row`: Each team is one half of the fixed composite bracket match; states own no separate height.

- `registry:rating-slider`: Existing slider track/thumb geometry is internal to the rating control.

- `registry:rating-suggestion`: Inline application shortcut belongs to the rating label, with its existing icon/value geometry.

- `registry:structural-cards`: Whole navigation/result cards preserve their existing row or multiline card geometry.

- `registry:global-search-result`: Whole search-result row retains its icon, title and description geometry.

- `registry:player-card`: Whole player/selection rows preserve avatar, metadata and existing row geometry.

- `registry:player-selection-actions`: Whole roster cards for picking/reordering, not standalone text buttons.

- `registry:structural-disclosure`: Permanent disclosure headers and desktop rail rows retain their 44px minimum.

- `registry:row-layout`: Layout attachment; the semantic control variant still owns its interior.

- `registry:selection-state`: Context-owned selection markers; no standalone control geometry.

- `registry:payment-state`: Payment state marker inherits its host control geometry.

- `registry:arcade-segment`: Package-1 segment/pill and creation-row contract remains 32px; S stays 188px.

- `registry:arcade-mute`: 44 by 32px mute action beside standard toolbar text buttons.

- `registry:arcade-tile`: Whole game-selection tile retains its name, status and card geometry.

- `registry:battleship-grid`: Permanent 44px game-board cells; ship and hit states do not change geometry.

- `registry:battleship-ship-display`: Ship decoration and orientation markers retain the structural board cell's hit box.

- `registry:challenge-targets`: Existing game reaction targets, choice tiles and memory cells keep their dedicated geometry.

- `registry:scribble-tools`: Internal brush-width and color samples in the drawing palette retain existing dimensions.

- `registry:scribble-word-choice`: Dedicated word-selection game target retains its large type and padded choice surface.

- `registry:music-controls`: Pairing icon and result-type buttons inherit shared control geometry.

- `registry:native-control-line`: The shared native control line-height rule owns the element baseline.

- `registry:native-color`: Existing native color swatch is a structural picker surface, not a text field.

- `registry:native-range`: Native range track fills its rating row; thumb geometry remains with the slider.

- `registry:poll-option-link`: Link action composes icon-button; only nonshrinking placement belongs to this attachment. Its empty property allowance prevents independent protected interior values, including padding and target dimensions.

- `registry:kiosk-open-link`: Literal event-card action hook inherits the base button; no independent interior geometry.

- `registry:arcade-player-surface`: Winner emphasis belongs to the existing player surface, not to an independent control.

- `registry:draw-team-surface`: Winner emphasis belongs to the existing drawn-team surface.

- `registry:onboarding-target-ring`: Noninteractive tour decoration follows the highlighted element rectangle; it never resizes that control.

- `registry:action-menu-trigger`: Bordered 32px trigger with chevron; short application-owned label.

- `registry:action-menu-entry`: Permanent menu rows remain at least 44px high/wide and allow wrapping.

- `registry:topbar-icons`: Topbar placement reserves 44px width; interior belongs to icon-button.

- `registry:selection-buttons`: Selection actions keep the base minimum, including the numeric square variant.

- `registry:poll-secondary`: Only the secondary background is contextual.

- `registry:poll-text-width`: 44px text minimum excludes numeric squares in both selected and unselected states.

- `registry:poll-choice-text`: Compact text presentation keeps the standard 32px minimum.

- `registry:search-field`: Native field reserves the integrated dropdown action width.

- `registry:selection-search-actions`: Matching search/open/close icon boxes.

- `registry:profile-preview`: Noninteractive preview exactly mirrors the adjacent 32px field height.

- `registry:tournament-label`: Noninteractive field label occupies its sibling control line.

- `registry:arrival-sort-mobile`: Bordered phone sorting controls retain the same single-line height.

- `registry:interactive-chip`: 32px filter control; passive chips keep their existing label geometry.

- `registry:invite-link-controls`: Short application-owned link actions remain nowrap; native field yields width.

- `registry:admin-test-fields`: Dense test-data form keeps its existing font/columns while every one-line control is 32px.

- `registry:data-row-name`: Only this name may visibly ellipsize; its full DOM/accessible text remains intact.

- `registry:data-row-action-label`: Short application action stays nowrap; below 320px the whole action moves to row two.

- `registry:food-position-slots`: Matching action/spacer slots in a composite position row.

- `registry:food-payment-marker`: Group paid marker keeps the same 32px action line.

- `registry:food-header`: Permanent 44px card header row, including its disclosure and other actions.

- `registry:vote-submitted-state`: Noninteractive confirmation is a status surface and may contain icon plus status copy.

- `registry:arcade-toolbar-buttons`: Wrapped toolbar labels grow; no creation-row or segment geometry changes.

- `registry:challenge-test-disclosure`: 32px application-owned test-selector disclosure.

- `registry:topbar-title`: Permanent 44px brand/navigation row.

- `registry:desktop-navigation`: Permanent 44px desktop navigation rail rows.

- `registry:page-heading`: Permanent page-header alignment row.

- `registry:subpage-heading`: Permanent compact page-header alignment row.

- `registry:tabbed-subpage-heading`: Permanent two/three-row header reservation follows existing responsive tab wrapping.

- `registry:section-heading`: Permanent tabbed section-header reservation.

- `registry:section-title`: Permanent 44px heading line inside a section header.

- `registry:seating-pool`: Permanent seating drop area includes the row and its surrounding padding.

- `registry:seating-player`: Permanent 44px seating player row.

- `registry:music-copy-actions`: Shared 44 by 32px copy actions in music rows.

- `registry:music-cover`: Noninteractive 76px artwork belongs to the music-card structure.

- `registry:kiosk-header-action`: Permanent 44px fullscreen action on the dedicated TV canvas.

- `registry:kiosk-match-row`: Permanent 44px team row on the dedicated TV canvas.

- `registry:arcade-create-width`: Creation-row container controls available width and stacking; no CTA interior dimensions.

- `registry:arcade-free-slot-width`: Join action fills its reserved free-player slot.

- `registry:arcade-entry-width`: Whole entry actions yield to their wrapping footer.

- `registry:arcade-setting-row`: Existing composite checkbox setting row, not a standalone text button.

- `registry:bracket-action-gutter`: Composite bracket row reserves the embedded result-action gutter.

- `registry:checkbox-in-row`: Native checkbox glyph is an internal 20px part of the labeled selection row.

- `registry:event-calendar-actions`: Calendar handoff labels may wrap within their equal-width action group.

- `registry:event-excuse-actions`: Parallel excuse actions wrap labels within the available footer.

- `registry:event-card-action-width`: Event card actions yield width to whole-group reflow.

- `registry:grouped-card-surface`: Nested card surface removes redundant elevation.

- `registry:tournament-skill-field`: Team skill field fits the header alongside the team label.

- `registry:vote-selection-row`: Existing game-selection card frame and inset; native checkbox owns its glyph.

- `registry:kiosk-player-card`: Read-only TV player surface retains the separate device-class text scale and inset.

- `registry:kiosk-title`: TV header keeps its documented title scale.

- `registry:kiosk-login-field`: Native login field fills the centered TV login card.

- `registry:kiosk-winner`: TV winner rail supplements its textual winner state.

- `registry:onboarding-rating-actions`: Existing rating-panel composite action row keeps its short application labels and horizontal density at the shared minimum height.

- `registry:seating-field-width`: Seating editor fields yield within their configuration grid.

- `registry:desktop-nav-indicator`: Internal active navigation indicator preserves the whole navigation target.

- `registry:arrival-action-width`: Carpool actions occupy the existing footer or free-seat action column.

- `registry:event-context-search-field`: Compact event switcher reserves its integrated selector action.

- `registry:search-status-reserve`: Searchable select reserves the established status icon inside the field.

- `registry:number-stepper-reserve`: Native number field reserves the internal half-stepper column.

- `registry:selection-number-width`: Existing numeric selection field has a stable toolbar column.

- `registry:tournament-count-width`: Team count fills its labeled field column.

- `registry:profile-agent-field`: Agent key field yields to its neighboring copy action.

- `registry:player-assignment-field`: Player assignment select fills its row column.

- `registry:icon-button-glyph`: Base icon-button owns its 20px glyph independently of hit-box geometry.

- `registry:chip-glyph`: Chip component owns its 15px glyph.

- `registry:number-stepper-glyph`: Supplementary half-stepper owns its 11px arrow glyph.

- `registry:rating-suggestion-glyph`: Inline rating shortcut owns its 14px glyph.

- `registry:arrival-sort-glyph`: Sort control owns its font-relative glyph.

- `registry:invite-link-field`: Kompakte Einladungs-URL mit unveränderter Standardhöhe; der auf Textfelder begrenzte Eigentümerselektor setzt ausschließlich die kleine Schrift und gewinnt gegen die native Feldbasis. Der Browserflow prüft den berechneten Wert.
