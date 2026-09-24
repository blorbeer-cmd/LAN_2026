# InfoTooltip

## 1. Status und Zweck

Status: `umgesetzt` für Hilfe-Trigger, Warn-Trigger und Panel.

Der InfoTooltip trägt gekürzte Erklärtexte, die neben dem erklärten Text auffindbar bleiben
müssen, ohne die Zeile zu verlängern. Er ersetzt das native `title`-Attribut, das auf Handys
unerreichbar ist.

Nicht-Ziele: kein Klick-zum-Anheften, kein Menü, keine interaktiven Inhalte im Panel und kein
Ersatz für sichtbaren Pflichttext. Eine Aussage, die zur Bedienung nötig ist, bleibt sichtbar.

## 2. Quelle

`server/public/js/infoTooltip.js` mit `infoTooltipHtml(id, label, text, variant)` und
`wireInfoTooltips(root)`. Das Markup ist
`.info-tooltip[data-info-tooltip]` > `.info-tooltip-trigger[data-info-tooltip-trigger]` +
`.info-tooltip-panel[role='tooltip'][hidden]`. Das Glyph stammt aus `icon('info')`
(`server/public/js/icons.js`).

## 3. CSS-Eigentümerschaft

`server/public/css/style.css` besitzt Geometrie, Glyphmaß, Farben, Zustände und Panel.

Domänen- und Aufrufer-CSS DÜRFEN ausschließlich die Trägerzeile gestalten (Anzeige, Umbruch,
`gap`) und den Außenabstand des Trägers setzen. Sie DÜRFEN keine Breite, Höhe, Innenabstände,
Ausrichtung im Trigger oder Glyphmaße setzen. Die einzige Ausnahme ist der benannte
Überschriftenausgleich in `server/public/css/domains.css`
(`.grouped-page-section-title`/`.card h2.title-with-info`), der ausschließlich `margin-block` setzt.

## 4. Varianten

- `.info-tooltip-trigger` (Hilfe, `registry:info-trigger`): `--text-muted`, im geöffneten Zustand
  `--accent` auf `--bg-elevated-2`. Sie steht neben dem erklärten **Text** oder dem erklärten
  **Control**; der Abstand gilt in beiden Fällen ab dessen Elementkante.
- `.info-tooltip-trigger--warning` (`variant: 'warning'`, `registry:info-warning-state`):
  `--danger`, geöffnet auf `--danger-bg`. Sie nennt den Grund für ein aktuell **deaktiviertes
  Control** und steht neben diesem Control, nicht neben dessen Beschriftung. Sie erbt die
  Innengeometrie der Hilfevariante vollständig.

Die Hilfevariante erklärt in zwei Fällen etwas: einen sichtbaren **Text** oder ein **Control**.
Beide Fälle verwenden dieselbe Variante und dieselbe Geometrie und unterscheiden sich nur darin,
woran der Trigger andockt; die Platzierungsregeln unten nennen beide getrennt. Ein Control erklärt
sie, wenn die Aussage die Aktion betrifft und nicht deren Beschriftung, etwa
„Übernahme bestätigen“ in der Kalenderbestätigung oder „Tracking starten“ in der Eventzeile.

## 5. Erlaubte Anpassungen

Aufrufer wählen die Trägerzeile und deren Umbruchverhalten. Reihenfolge, Abstand zum Text und
jedes Innenmaß sind vorgegeben.

Aufrufer DÜRFEN NICHT: Breite, Höhe, `padding`, `justify-content` oder `margin` am Trigger setzen,
das Glyph skalieren, den Trigger per `margin-inline-start: auto` oder `justify-content:
space-between` an den Zeilenrand schieben oder ihn in einen eigenen Umbruch zwingen.

## 6. Komponenteneigene Invarianten

### Platzierung

- Der Trigger MUSS Geschwisterelement unmittelbar **nach** dem Element sein, das den erklärten
  sichtbaren Text enthält (`<label>`, `<strong>`, Titel-`<span>`). Er steht nie **in** diesem
  Element und nie davor. Ein Button in einem `<label for=…>` erzeugt zwei konkurrierende
  Aktivierungsflächen und ist deshalb ausgeschlossen.
- Erklärt der Trigger ein **Control** statt eines Textes, steht er als Geschwisterelement
  unmittelbar nach diesem Control. Er MUSS in dessen Zeile bleiben — auch auf schmalen Viewports.
  Ein Trägerlayout, das ihn auf eine eigene Zeile unter das Control schiebt, ist ausgeschlossen:
  gelöst vom Control gelesen erklärt er nichts mehr.
- Die Trägerzeile MUSS `display: flex`, `align-items: center` und `gap: var(--space-1)` besitzen.
  `.title-with-info` ist die Standardform; ein neuer lokaler Wrapper ist nur zulässig, wenn
  `.title-with-info` die Zeile nachweislich nicht tragen kann.
- In Checkboxzeilen gilt die Reihenfolge Checkbox → Label → Trigger. Der Trigger tritt nie
  zwischen Checkbox und Label.
- Der Trigger DARF nie allein in eine eigene Zeile rutschen. Die Trägerzeile verwendet deshalb
  keinen Umbruch; ein zu langer Text bricht innerhalb seines eigenen Elements um, während der
  Trigger daneben stehen bleibt.
- Absolute Positionierung ist ausschließlich zulässig, wenn der Träger die Trefferfläche über
  reservierten Innenabstand freihält; die einzige solche Stelle ist `.food-order-paypal-label`
  mit `padding-right: calc(var(--control-height) + var(--space-1))`.
- Je erklärter Aussage steht genau ein Trigger. Ein zweiter Tooltip für denselben Sachverhalt in
  derselben Ansicht ist ausgeschlossen.

### Geometrie

- Die Trefferfläche ist ein Quadrat aus `var(--control-height)` in Breite und Höhe. Das
  Abnahmebeispiel ist 32 × 32 px.
- Der Trigger verwendet bewusst **nicht** `var(--tap-target-size)`: die 44-px-Breite der
  Icon-Buttons schiebt das Glyph 18 px vom erklärten Text weg, wodurch es als eigenes Control in
  der Zeile statt als Teil des Titels gelesen wird. Das Quadrat bleibt deutlich über dem
  Mindestzielmaß von 24 px.
- Das Glyph MUSS fest `16 × 16 px` messen. Der Trigger ist ein `<button>` und erbt keine
  Schriftgröße; ein `1.2em`-Glyph würde gegen die Browservorgabe aufgelöst und wäre nur zufällig
  einheitlich.
- Daraus folgt der normative optische Abstand: zwischen der rechten Kante des erklärten Elements
  und der linken Glyphkante liegen `var(--space-1) + (var(--control-height) - 16px) / 2`. Das
  Abnahmebeispiel ist **12 px (±1)** und gilt unverändert in jeder Textgröße.
- Maßgeblich ist die Kante des erklärten **Elements**, nicht die der letzten Textzeile. Bei
  einzeiligem Text fallen beide zusammen. Bricht der Text um, füllt sein Element die Zeile und der
  Trigger steht rechts daneben, vertikal auf dessen Mitte — der Abstand zum Ende der letzten Zeile
  ist dann größer und gerade nicht zu beanstanden.
- Neben einem Control gilt dieselbe Rechnung ab dessen Rahmenkante. Der sichtbare Abstand zur
  Beschriftung des Controls ist entsprechend um dessen Innenabstand größer.
- Die Glyphmitte MUSS auf der Mitte des Elements liegen, das sie erklärt; Toleranz 1 px.
- Die Trefferfläche DARF die Zeilenhöhe einer Überschrift nicht vergrößern. Zulässig ist
  ausschließlich der benannte negative `margin-block`-Ausgleich in `domains.css`; eine zweite
  Ausgleichsmechanik wird nicht eingeführt.
- Die Warnvariante folgt dem `gap` ihrer Controlzeile statt den 4 px der Textzeile, weil sie sich
  auf ein Control bezieht. Sie bleibt in der Zeile ihres CTA; die Zeilen- und Höhenregeln der
  Arcade-Erstellungszeile stehen in
  [Controls](controls.md#arcade-erstellungszeile-und-schwelle-s).

### Panel

- Das Panel öffnet unterhalb des Triggers mit `var(--space-1)` Abstand und linksbündig zu ihm. Es
  hält `var(--space-2)` Abstand zum Viewportrand und klappt nach oben, wenn es unten nicht passt.
- Es schließt bei `mouseleave` des Trägers ohne `:focus-visible`, bei `focusout` aus dem Träger,
  mit `Escape`, bei einem Zeigerdruck außerhalb, bei `resize` und beim Scrollen, sobald sich der
  Trigger tatsächlich bewegt hat.
- Es ist `pointer-events: none` und enthält keine interaktiven Elemente.

## 7. Erreichbare Zustände

Hilfe ruhend, Hilfe gehovert, Hilfe fokussiert, Hilfe geöffnet (`aria-expanded='true'`), Warnung
ruhend, Warnung gehovert, Warnung fokussiert und Warnung geöffnet. Ein deaktivierter Trigger
existiert nicht: der Trigger bleibt bedienbar, gerade wenn das erklärte Control deaktiviert ist.

## 8. Accessibility

- Der Trigger ist ein `<button type='button'>` mit deutschem `aria-label`
  („Mehr Informationen zu <Label>“ in der Hilfevariante, der Warngrund selbst in der Warnvariante).
- `aria-controls` verweist auf das Panel, `aria-expanded` spiegelt den Zustand, das Panel trägt
  `role='tooltip'` und `hidden`. Das Glyph ist dekorativ und für assistive Technik verborgen.
- Der Trigger öffnet auf `mouseenter`, `focus` und `click`. Hover allein genügt nicht: Fokus ist
  der Pfad für Tastatur und Touch. Der Trigger behält den normalen Zeiger (`cursor: default`).
- `Escape` schließt und gibt den Fokus an den Trigger zurück. Der Fokusring bleibt sichtbar und
  wird nicht beschnitten.

## 9. Repräsentative Aufrufer

- Schmal: `server/public/js/views/eventPolls.js` (Checkboxzeile „Anonyme Umfrage“ und die
  Optionsnotiz in `.event-poll-option-title-row`).
- Breit: `server/public/js/views/votes.js` (`h2.title-with-info` der laufenden Abstimmung).
- Neben einem Control: `server/public/js/eventPresentation.js` („Übernahme bestätigen“) und
  `server/public/js/views/events.js` (Tracking starten/stoppen in `.action-menu-row`).
- Warnvariante: `server/public/js/arcade/views/tetris.js` (eigene offene Lobby).

## 10. Prüfungen und Abnahmebeispiele

- `npm --prefix server run check:components` ordnet Trigger und Warnzustand diesem Vertrag zu.
- Browserprüfung bei 390 und 1024 px: Abstand rechte Kante des erklärten Elements → linke
  Glyphkante 12 px (±1) im Feldlabel (`--font-size-xs`), im Fließtext (`--font-size-md`), in der
  Kartenüberschrift (`--font-size-lg`) und neben einem Control; Trefferfläche 32 × 32 px; Glyph
  16 × 16 px; Glyphmitte auf der Mitte des erklärten Elements (±1 px).
- Bei 320 px bleibt der Trigger in der Zeile seines erklärten Elements: ein langer, frei
  eingegebener Optionstitel bricht innerhalb seines `<strong>` um, und die Kalenderbestätigung
  bleibt Button plus Trigger in einer Zeile.
- Die Abnahme misst dabei **auch den erklärten Text**, nicht nur die Glyphposition. Eine Zeile, die
  den Trigger festhält und dafür den Text auf Buchstabenbreite quetscht, erfüllt diesen Vertrag
  nicht. Prüffall ist die Umfrageoption mit Notiz, Link und Ergebnisbadge: bei 320 px rückt das
  Ergebnisbadge in eine eigene Zeile, und der Titel behält die ganze Zeile abzüglich Trigger, Link
  und Abständen. Gemessen mit 89 Zeichen in Chromium: 118 px von 202 px Zeilenbreite und 7 Zeilen;
  ohne den Umbruch des Badges waren es 80 px und 12 Zeilen. Ausschlaggebend ist der freigegebene
  Platz, nicht die Zeilenzahl selbst — sie hängt von den Schriftmaßen der Plattform ab. Die reine
  Geometriemessung besteht den fehlerhaften Zustand dagegen anstandslos — sie ersetzt diese Prüfung
  deshalb nicht, sondern ergänzt sie. Automatisiert abgedeckt ist der Platzanspruch in
  `server/src/test/e2e/eventDatePoll.e2e.test.ts`: eine Option mit langem Titel, Notiz und Link
  behält unterhalb 640 px die ganze Headerzeile für ihre Titelzeile, und mit gespeicherter Antwort
  — also sichtbarem Ergebnisbadge — gilt dasselbe zusätzlich mit der Zusicherung, dass das Badge
  unterhalb des Titels steht.
- Eine Überschrift mit Trigger ist nicht höher als dieselbe Überschrift ohne Trigger.
- Das geöffnete Panel bleibt vollständig im Viewport und schließt mit `Escape` unter Rückgabe des
  Fokus.
- DOM-Reihenfolge und Fokusverhalten sind in `server/src/test/e2e/eventDatePoll.e2e.test.ts`
  abgedeckt; die Warnvariante in `server/src/test/e2e/authGateArcade.e2e.test.ts` und
  `server/src/test/e2e/battleship.e2e.test.ts`.

## 11. Permanente Varianten und befristete Ausnahmen

- `registry:info-trigger`: Hilfe und Warnung verwenden dieselbe quadratische 32-×-32-px-Trefferfläche
  mit fest gepinntem 16-px-Glyph.

- `registry:info-warning-state`: Warnfarben erben das Innenleben des Hilfe-Triggers.

- `registry:info-trigger-glyph`: Das feste 16-px-Glyph gehört dem Trigger, weil ein `<button>` keine
  Schriftgröße erbt und `1.2em` sonst gegen die Browservorgabe aufgelöst würde.

Befristete Ausnahmen bestehen nicht.
