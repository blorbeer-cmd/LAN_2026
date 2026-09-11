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
eigenen Innenmaße. Die Registry ist reine Daten, ohne Komponentencheck oder Hook-Integration.

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
- Inputs, Selects und Flex-/Grid-Eltern verwenden `min-width: 0`.
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
  neben den Metadaten; die kanonische Zurück-Navigation behält 4 px Icon-/Textabstand.
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

Die einzige befristete Ausnahme ist `legacy-secondary-modifier`: Der bestehende Kiosk-Passwort-
Retry trägt einen CSS-losen Altmodifier. Seine Geometrie folgt bereits der Basis; Paket 5
entfernt genau diesen ungenutzten Klassentoken. Befund, Aufruf, Eigenschaft und Löschkriterium
stehen in `temporaryExceptions`. Es wird keine zusätzliche Größenvariante eingeführt.
