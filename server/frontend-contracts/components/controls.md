# Controls

## 1. Status und Zweck

Dieser Vertrag trennt Bedeutung, Breite und Geometrie interaktiver Controls und ist die normative
Detailquelle für ihre Größen-, Umbruch-, Fokus- und Eigentumsregeln. Standardcontrols verwenden auf
Desktop und Mobile `--control-height`; eine automatische Größenumschaltung nach Viewport oder
Eingabemodalität existiert nicht.

Paket 1 (Arcade-Segmentpilot und Erstellungszeile) sowie Paket 2 (globale Basiscontrols,
Pollbewertung) sind umgesetzt. Folgepakete bleiben eigenständige Aufträge.

## 2. Quelle

- Tokens und globale Controls: `public/css/style.css`
- Arcade-Segment und Erstellungszeile: `public/css/arcade.css`
- Segment-Markup: `public/js/arcade/lobbyReady.js`
- Pollbewertung: `public/js/views/eventPolls.js`
- Reine Registry-Daten: [component-registry.mjs](../component-registry.mjs)
- Browserabdeckung: bestehende Owner `authGate.e2e.test.ts`, `flowsShell.fixture.ts`,
  `eventDatePoll.e2e.test.ts` und `authGateArcade.e2e.test.ts` unter `src/test/e2e/`

`lobbyReady.js` und die Arcade-Viewdateien bleiben in Paket 2 unverändert.

## 3. CSS-Eigentümerschaft

`style.css` besitzt `.btn`, `.btn-sm`, `.btn-square`, `.btn-block`, `.btn-equal`, `.icon-btn`,
`.game-icon-btn`, globale Inputs/Selects/Textareas, Selection-Toolbar, ActionMenu und die
Controltokens.

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
| `icon-button`, `selection-icons` | 31–33 px | mindestens 44 px |
| `info-trigger` | 31–33 px | exakt 32 px, siehe [InfoTooltip](info-tooltip.md#geometrie) |
| `button-square` | exakt 32 px | exakt 32 px |
| `game-catalog-link-action` | exakt 32 px | exakt 32 px |
| `game-catalog-detail-trigger` | 31–33 px | Spielname |
| `arcade-segment` | 31–33 px | Segment/Pille |
| `action-menu-trigger` | 31–33 px | Inhalt |
| `action-menu-entry` | mindestens 44 px | mindestens 44 px |
| `number-stepper` | zwei interne Hälften des 32-px-Felds | interne Spalte |

Es gibt keine `.btn-touch`-Klasse und keine Variante `kompakt-touch`. Eine segmentierte Einstellung
besitzt genau zwei Optionen; ab drei benannten exklusiven Optionen MUSS ein Select verwendet
werden: ein natives `select` oder die nicht durchsuchbare gemeinsame Auswahl
(`searchSelectHtml(..., { searchable: false })`), deren Liste im App-Stil unter dem Feld öffnet. Selection-Toolbars, Filterchips, Tabs und Feasibility-Abstimmungen sind keine
segmentierte Einstellung im Sinne dieser Regel.

### Strukturziele mit 44 px

`--tap-target-size` bleibt unverändert für die folgenden Strukturziele: topbar/section/page-title
header rows, navigation rail button, collapsible-section header, food-order and seating rows,
searchable-select option rows samt angehefteter Popup-Aktion, calendar day grid, game-board/memory
cells and the kiosk TV canvas
(its own device class). Icon-Controls verwenden den Token regelmäßig als Mindestbreite, nicht als
Standardhöhe. Die Registry-IDs `calendar-days`, `search-options`, `structural-cards`, `player-card`,
`player-selection-actions`, `structural-disclosure`, `arcade-tile`, `battleship-grid`,
`battleship-ship-display`, `global-search-result`, `challenge-targets`, `chimp-grid` und
`scribble-word-choice`
erhalten ihre vorhandene Strukturgeometrie.
Ganze Karten, Spielreaktionsflächen und die große Wortauswahl können größer als 44 px sein;
die Normalisierung definiert ihre bestehenden Spielmaße nicht neu.

Einklappbare Kopfzeilen zentrieren Titel beziehungsweise Titel-/Metadatenblock, Anzahl/Status und
Pfeil vertikal in geschlossenem und geöffnetem Zustand. Text bleibt linksbündig. Die gemeinsame
`.collapsible-section-header` besitzt diese Ausrichtung ohne ansichtsbezogene Selektorlisten;
ihre Mindesthöhe `--tap-target-size` darf bei Textumbruch wachsen. Zusammengesetzte Button-Auslöser
für Karten und Personen folgen derselben Ausrichtung innerhalb ihrer registrierten Geometrie.
Kartenflächen wechseln unabhängig vom geöffneten Zustand mit der Verschachtelungstiefe:
äußerste Karte `--bg-elevated`, Kindkarte `--bg-elevated-2`, Enkelkarte wieder
`--bg-elevated`. Das gilt auch für native einklappbare Bereiche, Teilnehmendenlisten und
Karten für Match, Events, Bestellungen und Umfragen. Eine einzelne Karte ohne
Einklappauslöser folgt derselben Ebenenregel. Flache Personen-/Positionszeilen und reine
Infoboxen behalten ihre eigene Darstellung.

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

### Spielkatalog-Linkaktionen

- `.game-icon-btn` ist ausschließlich für Plattform- und Trailer-Links in
  `public/js/views/gameCatalog.js` bestimmt.
- Jede Linkaktion besitzt eine feste Border-Box von 32×32 px. Sie ist damit eine dokumentierte
  dichte Ausnahme von der 44-px-Mindestbreite allgemeiner Icon-Controls.
- Die Gruppe hat vor und nach sich denselben Abstand `--space-2`: vor ihr Spielname und optionale
  Badges, nach ihr das Genre. Ihre DOM- und sichtbare Reihenfolge ist Plattform-Link, Trailer-Link,
  Trackbar-Markierung, Genre.
- Unter 640 px belegt das Genre eine eigene zweite Zeile. Spielname und Genre beginnen bündig mit
  der Bock-Zeile. Titel und Symbolgruppe schrumpfen dadurch nicht wegen des Genres.
- Die Linkaktionen besitzen keinen Zwischenraum. Die nicht interaktive Trackbar-Markierung bleibt
  ein zentriertes 18×18-px-Symbol in einem transparenten 32×32-px-Slot.
- Der Link bleibt ein semantisches `<a>`-Element mit deutschem Accessible Name. Auf Hover verwendet
  er Blau `--accent`; Tastaturfokus verwendet den globalen sichtbaren Fokus-Ring.

### Spielkatalog-Detailauslöser

- `.game-row-detail-trigger` erweitert ausschließlich den Basisbutton `.btn.btn-sm` für den
  klickbaren Spielnamen in `public/js/views/gameCatalog.js`.
- Der Auslöser behält die 32-px-Mindesthöhe. Auf breiteren Ansichten behält er seine führende
  Innenkante; nur das abschließende Inline-Padding ist null. Unter 640 px sind beide
  Inline-Innenkanten null, damit der Spielname bündig mit der Bock-Zeile beginnt. Der anschließende
  Link-Slot kann dadurch ohne überlappende Trefferfläche direkt am sichtbaren Spielnamen beginnen.
- Der Auslöser verwendet im Normalzustand die Standardtextfarbe und keinen gefüllten
  Button-Hintergrund. Auf Hover wechselt nur der Text in Blau `--accent`. Die Farbe ergänzt die
  vorhandene Tastatur- und Fokus-Rückmeldung.
- Der Text ist immer linksbündig. Das gilt auch für mehrzeilige Spielnamen bei mittleren Breiten.
- Der Button öffnet die bestehenden Spieldetails. Er bleibt per Tastatur erreichbar und verwendet
  den globalen sichtbaren Fokus-Ring.

### Umfrage-Stimmenstapel

- `.event-poll-voter-stack` erweitert ausschließlich den Basisbutton `.btn.btn-sm` für die
  Wählenden einer Umfrageoption in `public/js/views/eventPolls.js`.
- Der Stapel behält mindestens `--tap-target-size` Breite und die 32-px-Mindesthöhe. Beide
  Inline-Innenkanten und der Block-Innenabstand sind null; bei nur einer Stimme vergrößert die
  Mindestbreite die Trefferfläche auf 44 px, ohne den 24-px-Avatar an der rechten Kante zu
  verschieben. Der Buttonhintergrund bleibt
  transparent und die Optionszeile erhält keine zusätzliche Zeile.
- Ausschließlich sein Außenabstand gibt nach: ein negativer Blockabstand von `--space-1` je Seite
  lässt ihn in der 24-px-Badgezeile mitlaufen. Optionen mit und ohne Stimmen behalten dadurch
  dieselbe Zeilenhöhe. Innerhalb von `.event-poll-option-badges` steht der Stimmenstapel direkt
  in einer eigenen Spalte zwischen Ergebnisbalken und Antwortbuttons und vor einem Status-Badge.
  Den Abstand zu einem Badge liefert der eigene `--space-1`-Gap der Badgezeile, nicht der
  12-px-Gap von `.row`. Ab `--bp-md` ist die Spalte 7rem breit und der Inhalt linksbündig: der
  linke Avatar steht in jeder Zeile an derselben Kante, eine Anzahl „+N“ folgt rechts. Passt ein
  Badge wie „Lehne ich ab“ nicht mehr neben den Stapel, bricht die Badgezeile darunter um, statt
  über die Spalte hinaus an die Antwortbuttons zu reichen. Auf
  Telefonen steht der Stapel rechtsbündig neben dem Optionstitel.
- Er zeigt höchstens vier Avatare; weitere Personen erscheinen als zusammengefasste Anzahl. Die
  Avatare überlappen einander nur um `--space-1` und heben sich mit einem Ring von der
  Optionsfläche ab.
- Bild und Anzahl sind rein visuell. Der Accessible Name nennt die Option, die dargestellte
  Antwort und die Namen; die vollständige Aufstellung bleibt der Stimmen-Dialog, den der Button
  öffnet.
- Der Stapel erscheint nur, wenn der Server die Antwortdetails für diese Person freigibt. Er
  bleibt per Tastatur erreichbar und verwendet den globalen sichtbaren Fokus-Ring.

### Spielkatalog-Werkzeugleiste

- Suche, Sortierung und Filterauslöser bilden eine stabile Werkzeugleiste.
- Die Sortierung ist eine eindeutige Auswahl aus Feld und Richtung. Sie verwendet wie der Filter
  eine abgerundete Menüfläche und markiert die aktive Auswahl dezent.
- Der Filterauslöser zeigt die Anzahl aktiver Filter. Das Menü gruppiert offene Bewertungen und Genres.
- Sortierung und Filterauslöser verwenden dieselbe Typografie und dieselbe neutrale Oberfläche.
  Das Filtermenü bleibt schmal. Ein Querstrich trennt die beiden Filtergruppen.
- Sortierung und Filterauslöser sind gleich breit, kompakt und linksbündig. Kurze Sortiertexte vermeiden
  abgeschnittene Werte. Die Suche nutzt den verbleibenden Platz.
- Auf schmalen Ansichten steht die Suche über Sortierung und Filter. Das Filtermenü erscheint oberhalb der Hauptnavigation.
- Die Spieleliste im Dialog „Abstimmung starten“ (Vote) verwendet dieselbe Werkzeugleiste mit
  denselben Sortierauswahlen; ihr Filtermenü enthält nur die Genres, ohne „Offene Bewertungen“, und
  entfällt, solange kein Spiel ein Genre trägt. Dort steht die Suche immer allein in der ersten Zeile;
  darunter folgen der Sammelschalter der Auswahl, Sortierung und Filter. Im Dialog öffnen beide
  Menüs auch auf Telefonen direkt unter ihrem Auslöser, weil die Hauptnavigation verdeckt ist
  (`registry:vote-game-toolbar`, `registry:vote-game-menu-panel`).

Registry-Zuordnung: `registry:game-catalog-toolbar`, `registry:game-catalog-sort-trigger`,
`registry:game-catalog-sort-option`, `registry:game-catalog-filter-trigger`,
`registry:game-catalog-filter-chevron`, `registry:game-catalog-menu-glyph`,
`registry:game-catalog-filter-divider` und `registry:game-catalog-mobile-menu-panel`.

### Spielkatalog-Detailformular

- Das Infofeld beginnt einzeilig und kann bei Bedarf manuell vergrößert werden.
- Oberhalb und unterhalb des sichtbaren Inhalts der Sitznachbar-Zeile liegt ein optisch gleicher Abstand.
  Das Infofeld erzeugt keine zusätzliche Grundlinien-Lücke. Ein kleiner unterer Innenabstand positioniert
  die Trennlinie symmetrisch zum Abstand oberhalb der Zeile.

Registry-Zuordnung: `registry:game-detail-spacing` und `registry:section-label`.

### Zusatzklassen und zusammengesetzte Controls

Das mechanische Inventar am PR-Head ordnet jede tokenbasierte Höhendeklaration in den fünf
CSS-Dateien und jede Klasse an interaktiven JS-Markup-Elementen genau einer Registry-Rolle zu:
1 Standard-/Icon-Control, 2 permanentes Strukturziel, 3 interner Teil eines zusammengesetzten
Controls oder 4 befristete Ausnahme. Jede Fundstelle mit Datei, Zeile und Selektor steht am PR.
Modifier und Zustandsmarker erben die Geometrie des Trägers; ihre Registrierung erlaubt keine
eigenen Innenmaße. Die Registry bleibt reine Daten; Paket 5 validiert sie mit dem Snapshot-Komponentencheck.

Die ausdrücklichen Eigenschaftsgrenzen in der Registry setzen diese Trennung mechanisch um:
Bedeutung erlaubt nur den bestehenden Schatten, Breite nur ihre Breitenwerte, Auswahl nur
Outline und dessen Abstand. Reine Farb-, Verfügbarkeits- und Layoutmarker erlauben keine
geschützten Innenwerte. Zustände sind von den geometriebesitzenden Basiseinträgen getrennt.
Die vorhandene Battleship-Schusstypografie und die Maße der dekorativen Schiff-Verbindungen
gehören exakten permanenten Varianten; daraus entsteht keine allgemeine Geometriefreigabe für
einen Zustandsmarker. Diese Grenzen gelten auch neben einer Basisklasse und in anderen Dateien.

Die Standardfamilien `date-fields`, `search-select`, `profile-controls`, `row-icons`,
`game-catalog-link-action`, `arrival-controls`, `filter-chip`, `section-tab`, `poll-choice`,
`food-fields`, `payment-controls`, `result-fields`, `arcade-mute`
und `music-controls` verwenden die passende Basisvariante.

Die internen Familien `selection-toolbar`, `number-stepper`, `food-action-slots`,
`result-actions`, `result-pick`, `result-state`, `bracket-row`, `rating-suggestion`,
`row-layout`, `selection-state`, `payment-state`, `scribble-tools` und `arcade-segment` behalten ihre
dokumentierte Einbettung.
NumberStepper-Hälften ergänzen das native Zahlenfeld; Zeichenpalette und Bracketzeilen
sind keine unabhängigen Standardbuttons. Zustands-/Layoutmarker besitzen keine eigene Controlhöhe.

`poll-disclosure` verwendet einen links stehenden Pfeil, null inneres Padding und eine
44-px-Mindesthöhe; der Kartenkopf liefert den Standardkartenabstand genau einmal.
Kopf und aufgeklappter Inhalt werden durch Abstand ohne zusätzliche Trennlinie verbunden,
wie bei den nativen einklappbaren Bereichen.
`registry:poll-card-container`: Die äußere Umfragekarte hat kein eigenes Padding; Kartenkopf
und aufgeklappter Inhalt liefern ihre Innenabstände selbst, ohne doppelte Einrückung.
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
- Der Warn-Tooltiptrigger ist quadratisch und 31–33 px breit wie hoch; seine Geometrie besitzt
  [InfoTooltip](info-tooltip.md#geometrie). Disabled- und Aktivzustand besitzen dieselben
  Controlhöhen.

### Selection-Toolbar und Pollbewertung

Selection-Toolbar-Textbuttons folgen 31–33 px; Iconbuttons messen mindestens 44×32 px. Die
gemeinsame Zahlenskala 0–5 (`ratingScale.js`: Vote, Umfragen, Bock/Skill) verwendet
`.btn.btn-square`, misst gewählt wie ungewählt 32×32 px und behält `gap: var(--space-2)`. Eine
Reihe benötigt `6 × 32 + 5 × 8 = 232px`; unterhalb dieser verfügbaren Elternbreite bricht sie
geordnet 0–5 um. Beide kollidierenden Kontextregeln berücksichtigen die
Quadratvariante; die konkurrierenden Höhen-/Mindestbreitenvorgaben und der frühere
30×30-Override sind ersetzt. Gemessen wird die verfügbare Elternbreite, nicht die fit-content-Breite
der Toolbar; die Browserprüfung erzwingt zusätzlich 192 und 191 px Elternbreite.
Vote und 0–5-Umfragen verwenden die Skala samt 4-px-Füllbalken unter den Zahlen
in der umgesetzten Variante `tone: 'vote'` / `.rating-scale--vote`: derselbe
Verlauf von `--accent` zu `--accent-2` wie im Ergebnisbalken, mit `--accent-2` für die gewählte Ziffer.
Die Balken folgen dem lokalen Entwurf, bleiben bei 0 leer und sind ohne Bewertung gestrichelt.
Auf einem Vote-Stimmzettel markiert `hint` die Ziffer des eigenen Bocks mit einem schwachen,
gestrichelten Umriss (`.is-hint`) und nennt ihn in Name und Tooltip („dein Bock“); die gewählte
Ziffer und der Fokusring ersetzen diese Markierung.
Der gesamte Zahlen-/Balkenblock steht auf Telefonen unter dem Optionstitel und wird als Einheit
zwischen den Zeilentrennern zentriert; die Zahlen bleiben tastaturbedienbar.
Gepaarte Formularfelder mit Hilfe verwenden `.event-poll-form-pair`: wie jedes andere Feld des
Dialogs lassen sie `--space-1` (4 px) vom Beschriftungstext zum Eingabefeld. Ein Info-Trigger neben
dem Label behält seine 32-px-Trefferfläche über negativen Blockabstand und vergrößert die
Labelzeile nicht; beide Felder eines Paars beginnen an derselben Kante. Der Turnierdialog verwendet
die normale `.field-label`-Zeile mit 4 px Abstand ab dem Beschriftungstext; sein vorhandener
Info-Trigger-Ausgleich verhindert eine zusätzliche Labelhöhe durch die Hilfe.

### Gruppen-Home und kompakte Aktuell-Liste

Das Home einer Gruppe ohne Termin zeigt die Mitglieder als eigene Karten und verlinkt aus der
Übersicht in die Gruppenverwaltung. Die kompakte „Aktuell“-Liste stellt ihre Navigationszeilen
dichter dar, ohne neue Innengeometrie einzuführen.

- `registry:home-group-member`: Whole group member card keeps its existing row height as a navigation target into the member profile.
- `registry:home-group-overview-open`: Inline overview action links into group management and owns only its inline text metrics, without a filled button surface.
- `registry:home-current-compact-navigate`: Compact current list tightens its existing navigation rows to the tap-target height and inset.

## 7. Erreichbare Zustände

- Standard: aktiv, Hover nur auf Hover-Geräten, Tastaturfokus und deaktiviert.
- Segment: erste oder zweite Option aktiv; beide Optionen können fachlich deaktiviert sein.
- Arcade-Erstellungszeile: beide Pillen, nur Modus, nur Gegner, keine Pille; aktiver CTA oder eigene
  offene Lobby/aktives Spiel mit deaktiviertem CTA und Warn-Tooltip.
- Spielkatalog-Linkaktion: Plattform-Link und Trailer-Link können gemeinsam, einzeln oder gar
  nicht vorhanden sein; die Trackbar-Markierung ist unabhängig optional.
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
- Spielkatalog-Linkaktionen bleiben als Links per Tastatur erreichbar. Die Trackbar-Markierung ist
  kein interaktives Element und vermittelt ihren Status mit Namen und Tooltip.
- Bei 320×568 MUSS jedes Segment `scrollWidth <= clientWidth` erfüllen; dasselbe gilt für das
  Dokument. Lange Beschriftungen führen zum Stapeln ganzer Controls, nicht zu Textersatz.

## 9. Repräsentative Aufrufer

- Vollständige Segmentzeile: `public/js/arcade/views/tetris.js`, `pong.js`, `snake.js`, `blobby.js`
- Nur Gegnerpille: `public/js/arcade/views/arcade.js` (Quiz), `arcadeScribble.js`, `battleship.js`
- Keine Pille: `public/js/arcade/views/challengeRush.js`
- Disabled mit Warn-Tooltip: eigene offene Tetris-Lobby in `tetris.js`
- Spielkatalog: `public/js/views/gameCatalog.js` bei 390×844 und 1024×768

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
- Spielkatalog-Linkaktionen bei 390×844 und 1024×768: Links und Trackbar-Slot exakt 32×32 px,
  Reihenfolge Plattform, Trailer, Trackbar, kein Zwischenraum zwischen den Linkaktionen und kein
  Seitenoverflow.
- Echten Textumbruch mit wachsender Border-Box ohne Clipping sowie Textarea mit rows 1 und 3.
- Skalenwerte 0–5 gewählt/ungewählt exakt 32×32 px, 8 px Abstand, verfügbare Elternbreite,
  232/231-px-Grenze und unveränderte Tastaturreihenfolge in beiden Richtungen.
- ActionMenu-Trigger 31–33 px und Einträge mindestens 44×44 px.
- Infoboard-Aktionsgruppen bleiben bei 390 px neben einem langen Titel innerhalb ihrer Zeile.
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
| `game-catalog-link-action` | Plattform- und Trailer-Links stehen als dichte 32×32-px-Gruppe direkt an den Spielinformationen. |
| `selection-buttons`, `poll-secondary`, `poll-text-width`, `poll-choice-text` | Toolbarlayout und Bedeutung respektieren die gewählte Basis-/Quadratvariante. |
| `poll-selected-answer`, `poll-option-extra-toggle` | Die gewählte Umfrageantwort und der geöffnete Notiz-/Link-Schalter zeigen ihren Zustand mit Akzentumriss bzw. Akzentfarbe, ohne eigene Geometrie. |
| `rating-scale-selected` | Auf der Bock-/Skill-Skala nehmen die gewählte Ziffer und ihr Umriss die kräftige Farbe der Skala an, ohne eigene Geometrie. |
| `rating-scale-hint` | Auf einem Vote-Stimmzettel trägt die Ziffer des eigenen Bocks einen schwachen gestrichelten Umriss als Orientierung, ohne eigene Geometrie; Auswahl und Fokus ersetzen ihn. |
| `poll-note-field`, `poll-flag-checkbox` | Die einzeilige Umfragebeschreibung wächst bis vier Controlhöhen; die 20-px-Checkbox ist Teil der beschrifteten Umfrageeinstellung. |
| `search-field` | Natives Feld reserviert die Breite der integrierten Dropdownaktion. |
| `profile-preview` | Nichtinteraktive Vorschau folgt der benachbarten Controlzeile. |
| `arrival-sort-mobile`, `interactive-chip` | Bestehende Formular-/Sortierkontexte behalten Platzierung und kurze eigene Labels bei 32 px. |
| `team-move-picker` | Der transparente Team-Picker füllt seinen Iconplatz. |
| `food-position-slots`, `food-payment-marker`, `food-header` | Gleich breite Aktionsplätze der Personenzeile, 32-px-Zahlungsaktion und permanenter 44-px-Kartenkopf. |
| `food-open-section-action`, `food-amount-copy`, `food-inline-remove` | Die Kopfaktion der offenen Bestellungen bricht nicht um; Kopieren steht als 32-px-Quadrat vor dem Betrag; Löschen einer eigenen Position ist ein zeilenhohes Symbol hinter dem Gericht. |
| `arcade-toolbar-buttons`, `challenge-test-disclosure` | Standardhöhe mit echtem Textumbruch; Segment-/Erstellungsgeometrie bleibt beim Pilotvertrag. |
| `topbar-title`, `desktop-navigation`, `page-heading`, `subpage-heading`, `tabbed-subpage-heading`, `section-heading`, `section-title` | Bestehende 44-px-Kopf-/Navigationszeilen und mehrzeilige Headerreservierungen. |
| `seating-seat` | Sitzplatz-Kachel des Tischplans in Token-Größe mit Avatar, Name und Status; öffnet den Platz-Dialog. |
| `music-cover` | Unverändertes nichtinteraktives 76-px-Cover. |
| `kiosk-match-row` | Permanente 44-px-Ziele der eigenständigen TV-Geräteklasse. |
| `kiosk-live-dot` | Nichtinteraktiver 8-px-Seitenpunkt der Live-Status-Rotation. |

Die Glyphenvarianten `registry:event-card-detail-glyph`, `registry:desktop-navigation-glyph`,
`registry:list-row-glyph`, `registry:navigation-glyph`, `registry:badge-glyph`,
`registry:more-card-glyph`, `registry:game-track-glyph`, `registry:readiness-status-glyph` und
`registry:admin-indicator-glyph` verändern nur die Symbolgröße innerhalb der bestehenden
Komponenten. `registry:invite-link-row-field` lässt das schreibgeschützte Link-Feld im Einladungsdialog
die Textspalte seiner Zeile füllen.

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

- `registry:date-fields`: DateTime manual fields, native selects and adjacent calendar/clear actions.

- `registry:calendar-days`: Permanent six-row calendar grid and its 44px day cells.

- `registry:number-stepper`: Two supplementary half-buttons inside a 32px number field.

- `registry:search-select`: Field-integrated 44 by 32px dropdown trigger.

- `registry:search-options`: Permanent listbox option rows and the pinned popup action, at least 44px.

- `registry:profile-controls`: Profile controls use the standard field/button/icon variants; the color trigger is a small dot on the avatar with an enlarged invisible hit area.
- `registry:profile-row-open`: A profile invitation row's text opens its detail dialog: plain text without button chrome whose hit area covers the row's text column.
- `registry:profile-link-btn`: Quiet inline text action inside a muted meta line („Mehr erfahren“, „Key erneuern“); underlined text, no button chrome.

- `registry:row-icons`: Copy, dismiss and detail actions retain their 44px icon slot.

- `registry:checklist-item-remove`: Packliste remove action keeps the 44px icon slot, muted, and only renders while the list is in editing mode.

- `registry:checklist-task-title`: To-Do title opens the detail dialog: plain one-line text whose hit area covers the whole row, blue on row hover and struck through once done.
- `registry:broadcast-table-open`: Durchsage message opens the detail dialog: plain one-line text whose hit area covers the whole row, blue on row hover and muted once past.
- `registry:music-queue-open`: Jam request title opens the detail dialog: plain one-line text whose hit area covers the whole row, blue on row hover.
- `registry:notification-center-open`: The whole notification text block is the link that opens its target and marks it read; it reads as text, not as a button.

- `registry:game-catalog-suggest`: Spiel vorschlagen closes the catalog tab row; below --bp-sm it collapses to a 32 by 32px plus with the same accessible name.

- `registry:game-catalog-link-action`: Platform and trailer links use compact 32 by 32px slots next to the game details and use blue hover feedback.

- `registry:game-catalog-detail-trigger`: Game-name detail trigger has plain text and switches to blue on hover without a filled button surface.

- `registry:arrival-controls`: Native textarea rows and 32px sorting buttons (An- & Abreise and the Spieler-Details Bock/Skill table).

- `registry:filter-chip`: Interactive filter chips use 32px; passive chip labels are outside this control variant.

- `registry:section-tab`: Navigation button composed with the base button and optional meaning modifier.

- `registry:event-poll-voter-stack`: Voter avatars beside a poll option open the vote dialog without a filled button surface.

- `registry:poll-choice`: Compact choice text retains the standard minimum height.

- `registry:poll-disclosure`: Composite card header: title plus round/deadline metadata are a documented multiline state.




- `registry:food-fields`: Standard fields and add button retain their form-column placement.

- `registry:payment-controls`: 32px payment/copy actions; icon actions inherit the shared minimum width.

- `registry:event-roster-controls`: Event roster parts: the 32px remove icon, the shortened excuse that opens its full text as a text-styled button, and the excuse dialog's full-width submit.

- `registry:food-action-slots`: Group-row icon actions keep 44 by 32px slots; the position remove action is an inline icon after the dish.

- `registry:food-disclosure`: Card/roster heading and person plus metadata form a composite, optionally multiline disclosure.

- `registry:result-actions`: Result action in the fixed trailing slot of fixtures, draw cards and bracket boxes: plus for an open result, pencil for a recorded one.

- `registry:visually-hidden-control`: Native radio inputs in labeled result choices remain keyboard and screenreader accessible while their visible label owns the target.

- `registry:result-open-hosts`: Open bracket boxes and open fixture scores only recolor their host; the static open result action shares the marker class.

- `registry:poll-legend-open`: The open-answer legend dot only recolors itself; it shares the open marker class with result actions.

- `registry:result-state`: Open, primary next-step and draw markers recolor their result host without changing its geometry.

- `registry:bracket-row`: Each team is one half of the fixed composite bracket match; states own no separate height.

- `registry:rating-suggestion`: Inline application shortcut belongs to the rating label, with its existing icon/value geometry.

- `registry:structural-cards`: Whole navigation/result cards preserve their existing row or multiline card geometry.

- `registry:global-search-result`: Whole search-result row retains its icon, title and description geometry.

- `registry:player-card`: Whole player/selection rows preserve avatar, metadata and existing row geometry.

- `registry:player-selection-actions`: Whole roster cards for picking/reordering, not standalone text buttons.

- `registry:structural-disclosure`: Permanent disclosure headers and desktop rail rows retain their 44px minimum.

- `registry:row-layout`: Layout attachment; the semantic control variant still owns its interior.

- `registry:selection-state`: Context-owned selection markers; no standalone control geometry.

- `registry:payment-state`: Payment state marker inherits its host control geometry.

- `registry:arcade-segment`: Package-1 segment/pill contract remains 32px.

- `registry:arcade-mute`: 44 by 32px mute action beside standard toolbar text buttons.

- `registry:battleship-grid`: Square game-board cells sized by the grid; ship and shot markers never change the cell geometry.

- `registry:battleship-ship-display`: Ship decoration and orientation markers retain the structural board cell's hit box.

- `registry:challenge-targets`: Existing game reaction targets, choice tiles and memory cells keep their dedicated geometry.

- `registry:chimp-grid`: Square Chimp Test tiles sized by the grid; number, hidden, revealed and wrong states never change the cell geometry.

- `registry:scribble-tools`: Internal brush-width and color samples in the drawing palette retain existing dimensions.

- `registry:scribble-word-choice`: Dedicated word-selection game target retains its large type and padded choice surface.

- `registry:arcade-icon-button`: Square 32px icon actions (expand, mute) in the game header beside the compact match buttons.

- `registry:battleship-ship-option`: Ship picker tile with name, length bar and placed check; selected and placed states keep the tile geometry.

- `registry:scribble-thumb`: Thumbs-up action lines up its icon and count; the compact button owns the geometry.

- `registry:battleship-placed-state`: A placed ship in the picker only changes emphasis colors.

- `registry:arcade-stats-filter`: Hook for the statistics game filter; the native select keeps the shared field geometry.

- `registry:music-controls`: Pairing icon and result-type buttons inherit shared control geometry.

- `registry:native-control-line`: The shared native control line-height rule owns the element baseline.

- `registry:native-color`: Existing native color swatch is a structural picker surface, not a text field.

- `registry:poll-option-link`: Link action composes icon-button; only nonshrinking placement belongs to this attachment. Its empty property allowance prevents independent protected interior values, including padding and target dimensions.

- `registry:kiosk-open-link`: Literal event-card action hook inherits the base button; no independent interior geometry.

- `registry:arcade-player-surface`: Winner emphasis belongs to the existing player surface, not to an independent control.

- `registry:onboarding-target-ring`: Noninteractive tour decoration follows the highlighted element rectangle; it never resizes that control.

- `registry:action-menu-trigger`: Bordered 32px trigger with chevron; short application-owned label.

- `registry:action-menu-entry`: Permanent menu rows remain at least 44px high/wide and allow wrapping.

- `registry:topbar-icons`: Topbar placement reserves 44px width; interior belongs to icon-button.

- `registry:selection-buttons`: Selection actions keep the base minimum, including the numeric square variant.

- `registry:poll-secondary`: Only the secondary background is contextual.

- `registry:poll-text-width`: 44px text minimum excludes numeric squares in both selected and unselected states.

- `registry:poll-choice-text`: Compact text presentation keeps the standard 32px minimum.

- `registry:poll-selected-answer`: The chosen answer is marked by a 1px inset accent outline instead of the gradient; geometry stays with the base or square variant.

- `registry:profile-row-action`: Mein Profil keeps one fixed right-hand action column across all cards, so compact buttons and the view select share one width; the select matches the compact buttons' type size.
- `registry:rating-scale-selected`: On the Bock/Skill scale the chosen number and its inset outline take that scale's saturated color; geometry stays with the square variant.
- `registry:rating-scale-hint`: On a Vote ballot the viewer's own Bock gets a faint dashed outline as orientation; geometry stays with the square variant.

- `registry:checklist-table-action`: Übernehmen and Abgeben fill the fixed To-Do action column, so both share one width and line up from row to row.
- `registry:broadcast-table-action`: Beenden fills the fixed Durchsage action column, so it lines up from row to row.
- `registry:broadcast-send`: Senden is exactly as wide as the time field above it, so the form ends flush on one right edge.
- `registry:music-row-action`: Jam setup steps and search results keep one fixed right-hand action column, so their compact buttons share one width and line up from row to row.

- `registry:checklist-choice-selected`: The chosen To-Do kind is marked by a 1px inset accent outline instead of the gradient; geometry stays with the base variant.
- `registry:music-result-selected`: The chosen Jam result type is marked by a 1px inset accent outline instead of the gradient; geometry stays with the base variant.

- `registry:poll-note-field`: The poll description starts as one line and grows with its content up to four control heights.

- `registry:poll-option-extra-toggle`: Icon button that opens an option's note and link fields; only its expanded color is contextual.

- `registry:poll-flag-checkbox`: Native checkbox glyph is an internal 20px part of a labeled poll setting.

- `registry:search-field`: Native field reserves the integrated dropdown action width.

- `registry:selection-search-actions`: Matching search/open/close icon boxes.

- `registry:profile-preview`: Noninteractive preview exactly mirrors the adjacent 32px field height.


- `registry:team-move-picker`: Transparent native team picker covers its icon slot on touch layouts.


- `registry:arrival-sort-mobile`: Bordered phone sorting controls retain the same single-line height.

- `registry:interactive-chip`: 32px filter control; passive chips keep their existing label geometry.





- `registry:food-position-slots`: Group-row icon actions share one 44px slot width, so every row of an order card keeps the same controls column.

- `registry:food-payment-marker`: Group paid marker keeps the same 32px action line.

- `registry:food-header`: Permanent 44px card header row, including its disclosure and other actions.

- `registry:food-open-section-action`: The primary header action stays on one line; the section title wraps on phones instead.

- `registry:food-amount-copy`: The copy action directly before an amount is a 32px square, so person sums and the total share one right-aligned amount column.

- `registry:food-inline-remove`: The own position remove action sits inline after the dish name, exactly one text line high with a 14px glyph, so position rows keep a single amount column.

- `registry:arcade-toolbar-buttons`: Wrapped toolbar labels grow; no creation-row or segment geometry changes.

- `registry:challenge-test-disclosure`: 32px application-owned test-selector disclosure.

- `registry:topbar-title`: Permanent 44px brand/navigation row.

- `registry:desktop-navigation`: Permanent 44px desktop navigation rail rows.

- `registry:page-heading`: Permanent page-header alignment row.

- `registry:subpage-heading`: Permanent compact page-header alignment row.

- `registry:tabbed-subpage-heading`: Phone and laptop reserve two or three rows for tabs; desktop uses a compact single row.

- `registry:section-heading`: Permanent tabbed section-header reservation.

- `registry:section-title`: Permanent 44px heading line inside a section header.

- `registry:seating-seat`: A seat of the physical table plan keeps the token-sized seat tile with avatar, name and status instead of button chrome; it opens the seat dialog.


- `registry:music-cover`: Noninteractive 76px artwork belongs to the music-card structure.

- `registry:kiosk-match-row`: Permanent 44px team row on the dedicated TV canvas.

- `registry:kiosk-live-dot`: Noninteractive 8px pagination indicator for the TV Live-Status roster rotation, not a control.

- `registry:arcade-setting-row`: Existing composite checkbox setting row, not a standalone text button.

- `registry:arcade-game-icon`: The game symbol in a lobby row is a 20px glyph inside its noninteractive icon tile.

- `registry:arcade-lobby-join-width`: The join action fills the fixed action column of a lobby row so every row aligns.

- `registry:arcade-target-score-field`: The score-target field in a lobby card only needs room for two digits.

- `registry:arcade-create-dialog-segment`: Mode and opponent switches in the create dialog share one row with equal segment widths.

- `registry:arcade-stats-select-width`: The statistics filter sizes to its longest game name instead of the full card width.

- `registry:battleship-selected-cell`: The aimed cell gets an inset accent ring inside the unchanged cell.

- `registry:battleship-ship-check`: The placed check is a 12px glyph inside the ship picker tile.

- `registry:battleship-orientation-segment`: The orientation switch above the board uses wider segments for its longer labels.

- `registry:arcade-header-mute`: In the game header the mute toggle matches the 32px square expand icon beside it.

- `registry:arcade-answer-input`: Answer and guess fields may shrink beside their submit button instead of overflowing on phones.

- `registry:checkbox-in-row`: Native checkbox glyph is an internal 20px part of the labeled selection row.

- `registry:event-card-chevron`: A fixed 16px chevron lets the open Event card indent its sections exactly to the title edge.

- `registry:event-info-icon-actions`: Copy and map icons sit tight beside the calendar controls in an Infos row.

- `registry:event-roster-slot`: „Einladen“ fills the same fixed slot as the Bezahlt marker so both align flush right.

- `registry:nested-card-surface`: Nested card surfaces alternate colors by depth and omit redundant elevation.

- `registry:tournament-skill-field`: Team skill field fits the header alongside the team label.

- `registry:vote-selection-row`: Existing game-selection card frame and inset; native checkbox owns its glyph.

- `registry:kiosk-login-field`: Native login field fills the centered TV login card.

- `registry:kiosk-winner`: TV winner rail supplements its textual winner state.

- `registry:onboarding-rating-actions`: Existing rating-panel composite action row keeps its short application labels and horizontal density at the shared minimum height.

- `registry:seating-count-field`: Seat counts per side in the „Tisch ändern“ dialog hold two digits; the field is only as wide as its content.

- `registry:info-board-content-field`: The info entry content starts on one line and grows with its text up to eight control heights.

- `registry:event-context-toggle`: On phones the topbar event switcher keeps its toggle's tap target but sits the chevron at the right edge, so the event name keeps its room and ends in an ellipsis before it.

- `registry:arrival-header-action`: The carpool header action keeps one line while the long direction title wraps on phones.

- `registry:event-context-search-field`: Compact event switcher reserves its integrated selector action.

- `registry:search-status-reserve`: Searchable select reserves the established status icon inside the field.

- `registry:number-stepper-reserve`: Native number field reserves the internal half-stepper column.

- `registry:selection-number-width`: Existing numeric selection field has a stable toolbar column.

- `registry:tournament-count-width`: Team count fills its labeled field column.


- `registry:player-assignment-field`: Player assignment select fills its row column.

- `registry:icon-button-glyph`: Base icon-button owns its 20px glyph independently of hit-box geometry.

- `registry:ui-icon-glyph-base`: Shared icons own their default intrinsic size independently of surrounding controls.

- `registry:chip-glyph`: Chip component owns its 15px glyph.

- `registry:number-stepper-glyph`: Supplementary half-stepper owns its 11px arrow glyph.

- `registry:rating-suggestion-glyph`: Inline rating shortcut owns its 14px glyph.

- `registry:arrival-sort-glyph`: Sort control owns its font-relative glyph.

- `registry:poll-vote-cell-glyph`: Answer symbols of the vote table keep one compact glyph size so every cell reads at the same weight.

- `registry:draw-tournament-options`: Checkbox options share one wrapping row in the compact tournament dialog; the row gap replaces the list-row padding.

- `registry:invite-link-field`: Kompakte Einladungs-URL mit unveränderter Standardhöhe; der auf Textfelder begrenzte Eigentümerselektor setzt ausschließlich die kleine Schrift und gewinnt gegen die native Feldbasis. Der Browserflow prüft den berechneten Wert.

- `registry:calendar-day-state`: Calendar selection/today colors and inset emphasis preserve the day target.

- `registry:bracket-state`: Bracket availability and outcome preserve the host geometry; only winner elevation may differ.

- `registry:bracket-own-team`: The signed-in player's own bracket row keeps the host geometry; only its accent edge and the rounded outer corners of that edge may differ.

- `registry:rating-divergence-state`: Divergent suggestion only changes emphasis colors.

- `registry:battleship-shot-state`: Ship tiles and shot dots are decoration inside the unchanged cell: markers are sized pseudo-elements, ships drop the cell radius.

- `registry:battleship-orientation-state`: Orientation rounds only the bow and stern of a continuous ship bar; the cell keeps its geometry.

- `registry:chimp-tile-state`: Chimp Test tile states only change colors and the cursor; the grid cell keeps its geometry.

- `registry:scribble-swatch-state`: Selected swatch changes its border color without resizing the palette control.

- `registry:game-chip-focus-state`: Existing gameChipsHtml in format.js marks focused/background games by color and opacity; these are passive labels, with no protected interior override.

- `registry:card-open-menu-state`: actionMenu.js raises the card stacking order while its menu is open; it does not alter control interior.

- `registry:desktop-navigation-state`: app.js toggles the active desktop navigation entry; only colors, font weight and background change.

- `registry:player-dragging-state`: The tournament and matchmaking drag callers lower the moving roster row opacity without resizing it.

- `registry:readiness-status-glyph`: The Admin readiness status icon matches the size of its status text; the text keeps the meaning without color.

- `registry:admin-indicator-glyph`: The admin-mode shield on the topbar logo sizes its glyph to the small round badge; it is not interactive.

- `registry:invite-link-row-field`: The read-only invite URL fills the row's text column beside its copy action and may shrink below its intrinsic width.
