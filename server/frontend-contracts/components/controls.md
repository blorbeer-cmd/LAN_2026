# Controls

## 1. Status und Zweck

Dieser Vertrag trennt Bedeutung, Breite und Geometrie interaktiver Controls und ist die normative
Detailquelle für ihre Größen-, Umbruch-, Fokus- und Eigentumsregeln. Standardcontrols verwenden auf
Desktop und Mobile `--control-height`; eine automatische Größenumschaltung nach Viewport oder
Eingabemodalität existiert nicht.

Der Arcade-Segmentpilot und seine Erstellungszeile sind umgesetzt. Die globale Normalisierung der
Basiscontrols, Pollbewertung und `DataRowAction` folgt ausschließlich in Paket 2.

## 2. Quelle

- Tokens und globale Controls: `public/css/style.css`
- Arcade-Segment und Erstellungszeile: `public/css/arcade.css`
- Segment-Markup: `public/js/arcade/lobbyReady.js`
- Repräsentative Browserabdeckung: `src/test/e2e/authGateArcade.e2e.test.ts`

`lobbyReady.js` und die Arcade-Viewdateien bleiben im Pilot unverändert.

## 3. CSS-Eigentümerschaft

`style.css` besitzt `.btn`, `.btn-sm`, `.btn-square`, `.btn-block`, `.btn-equal`, `.icon-btn`,
globale Inputs/Selects/Textareas, Selection-Toolbar, ActionMenu und die Controltokens.

`arcade.css` besitzt `.arcade-mode-toggle*` sowie ausschließlich das Containerlayout der
`.arcade-lobby-create-row`. Domänen-CSS DARF Platzierung, Reihenfolge, Außenabstand und dokumentierte
Containerstapelung besitzen, aber keine innere Controlgeometrie überschreiben. Eine Bedeutungs- oder
Breitenklasse DARF keine eigene Höhe, Typografie oder Innengeometrie definieren.

## 4. Varianten

| Variante | Klasse/Element | Einzeilige Höhe | Breite | Vertragsstatus |
|---|---|---:|---:|---|
| Standardbutton | `.btn` | `--control-height` (31–33 px) | Inhalt | interim auf Main, Normalisierung in Paket 2 |
| Kompakte Textdarstellung | `.btn.btn-sm` | `--control-height` (31–33 px) | Inhalt | interim auf Main, Normalisierung in Paket 2 |
| Standardfeld | relevante `input`-Typen, `select` | `--control-height` (31–33 px) | Container | interim auf Main, Normalisierung in Paket 2 |
| Textarea | `textarea` | mindestens `--control-height`, mehrzeilig über `rows`/Inhalt | Container | interim auf Main, Normalisierung in Paket 2 |
| Icon-Control | `.icon-btn` | `--control-height` (31–33 px) | mindestens `--tap-target-size` | interim auf Main, Normalisierung in Paket 2 |
| Quadratische Skala | `.btn.btn-square` | `--control-height` | `--control-height` | Zielvertrag, Umsetzung Paket 2 |
| Selection-Toolbar | registrierte Toolbarbuttons | `--control-height` (31–33 px) | je Variante | interim auf Main, Normalisierung in Paket 2 |
| Arcade-Segment | `.arcade-mode-toggle`, `.arcade-mode-toggle-btn` | `--control-height` (31–33 px) | Segment/Pille | umgesetzt |
| ActionMenu-Trigger | `.action-menu > summary.btn` | `--control-height` (31–33 px) | Inhalt | Zielvertrag, Umsetzung Paket 2 |
| ActionMenu-Eintrag | `.action-menu-panel .btn` | mindestens `--tap-target-size` | mindestens `--tap-target-size` | umgesetzt |
| NumberStepper-Hälfte | `.number-stepper-btn` in `.number-stepper` | je Hälfte des 32-px-Felds | interne Spalte | umgesetzt |

Es gibt keine `.btn-touch`-Klasse und keine Variante `kompakt-touch`. Eine segmentierte Einstellung
besitzt genau zwei Optionen; ab drei benannten exklusiven Optionen MUSS ein natives `select`
verwendet werden. Selection-Toolbars, Filterchips, Tabs und Feasibility-Abstimmungen sind keine
segmentierte Einstellung im Sinne dieser Regel.

### Strukturziele mit 44 px

`--tap-target-size` bleibt unverändert für die folgenden Strukturziele: topbar/section/page-title
header rows, navigation rail button, collapsible-section header, food-order and seating rows,
searchable-select option rows, calendar day grid, game-board/memory cells and the kiosk TV canvas
(its own device class). Icon-Controls verwenden den Token regelmäßig als Mindestbreite, nicht als
Standardhöhe.

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

Die auf Main vorhandenen starren Höhen sowie das Feldpadding `6px`, Buttonpadding `7px`,
`.btn-sm`-Padding und die behauptete Flush-Geometrie sind interim; Paket 2 normalisiert und misst
sie gemeinsam. Der Pilot ändert diese Regeln nicht.

### Zusatzklassen und zusammengesetzte Controls

Paket 2 klassifiziert jede Höhendeklaration mit `--control-height`/`--tap-target-size` sowie jede
Klasse, die im JS-Markup an `button`, `input`, `select`, `textarea` oder `summary` vorkommt, genau
als Standard-/Icon-Control, permanentes Strukturziel, internen Teil eines zusammengesetzten
Controls oder befristete Ausnahme. Dazu gehören insbesondere:

`.info-tooltip-trigger`, `.selection-toolbar-icon`, `.selection-search-trigger`,
`.selection-search-close`, `.dt-calendar-btn`, `.dt-clear-btn`, `.arcade-mute-btn`,
`.number-stepper-btn`, `.search-select-toggle`, `.event-poll-card-toggle`,
`.event-participant-toggle`, `.food-order-card-header-toggle`, `.food-order-group-toggle`,
`.vote-info-input`, `.topbar .icon-btn`, `.profile-color-trigger`,
`.profile-color-picker-copy`, `.tournament-lobby-copy`, `.home-current-dismiss`, `.game-icon-btn`,
`.arrival-note-input`, `.invite-link-row > input`, `.invite-link-row .btn`, `.arcade-toolbar .btn`,
`.admin-test-controls input`, `.admin-test-controls .btn`, `.food-order-item-action`,
`.food-order-item-action-spacer` und `.music-pairing-copy`.

Die Bezeichnung „Toggle“ registriert keine eigene Geometrie. Ein Button mit `aria-pressed` folgt
seiner tatsächlichen Klassenvariante.

### Text, Enge und Reflow

- Standardbuttons und Menüeinträge DÜRFEN umbrechen und dadurch wachsen.
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

### Selection-Toolbar und Pollbewertung (Paket 2)

Selection-Toolbar-Textbuttons folgen 31–33 px; Iconbuttons messen mindestens 44×32 px. Pollwerte
1–5 verwenden `.btn.btn-square`, messen gewählt wie ungewählt 32×32 px und behalten
`gap: var(--space-2)`. Eine Reihe benötigt `5 × 32 + 4 × 8 = 192px`; unterhalb dieser verfügbaren
Elternbreite bricht sie geordnet 1–5 um. Paket 2 entfernt die beiden kollidierenden Kontextregeln
und den heutigen 30×30-Override.

### DataRowAction (Paket 2)

Eine eigene `DataRowAction`-Klasse wird Inline-Size-Container. Ab 320 px Innenbreite stehen
Name/Badge/Aktion in einer Zeile; darunter wandert die Aktion vollständig in Zeile 2. Nur der Name
erhält `min-width: 0` und Ellipse, Badge und kurzes Aktionslabel bleiben `nowrap`. Der Button folgt
31–33 px. Die Containerregel MUSS auch fraktionale Breiten unter 320 px erfassen.

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

Die vollständige Verifikation umfasst außerdem `lint`, `build`, Unit-/Integrationstests,
`check:tokens`, Arcade-Smoke und die vollständige E2E-Suite.

## 11. Permanente Varianten und befristete Ausnahmen

Die maschinenlesbare Registry entsteht in Paket 2; bis dahin existieren keine Registry-IDs.
Dauerhaft gewollt sind die 44-px-ActionMenu-Einträge, die internen NumberStepper-Hälften und die
Arcade-lokale Segmentgeometrie. Die interim Basiscontrol-Geometrie ist keine neue Ausnahme dieses
Pilots und wird in Paket 2 normalisiert. Es wird keine zusätzliche Größenvariante eingeführt.
