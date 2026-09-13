# DateTimeField

## 1. Status und Zweck

Status: `umgesetzt`.

DateTimeField ist das gemeinsame, dunkel thematisierte Datum-/Zeit-Control mit manueller deutscher
Eingabe, lokalem Hidden-`datetime-local`-Vertrag und einem tastaturfähigen Kalender. Zwei Instanzen
können zu einem echten Zeitraum gekoppelt werden. Die Komponente ändert keine fachlichen Fristen
und migriert in diesem Paket weder Signaturen noch die bestehende 640-px-Grenze.

## 2. Quelle

- Verhalten und Markup: `public/js/dateTimeField.js`
- Komponentengeometrie: `public/css/style.css`
- Modalintegration: `public/js/modal.js`, `public/css/overlays.css`
- Markup-API:
  `dateTimeFieldHtml(id, rawValueMs, { label, dateOnly, clearable, disabled })`
- Wiring-API: `wireDateTimeField(container, id)`
- Zeitraum-API:
  `wireDateTimeRange(container, startId, endId, { minimumGapMs, message })`
- Draft-API: `captureDateTimeFieldDraft(container, id)` und
  `restoreDateTimeFieldDraft(container, id, draft)`
- Reine Parsing-/Normalisierungsfunktionen:
  `parseDatetimeLocalMs`, `normalizeDatetimeLocalMs`, `parseDateInput`, `parseTimeInput`,
  `formatDateTyping`, `formatTimeTyping` und `calendarMonthTargetMs`

`wireDateTimeField` liefert einen Controller mit `hidden`, `currentMs`, `applyMs`, `setError`,
`setMinimum(ms)` und `setRange(startMs, endMs)`. Das Minimum wird über `setMinimum` gesetzt, nicht
als Option von `dateTimeFieldHtml`.

## 3. CSS-Eigentümerschaft

`public/css/style.css` besitzt alle `.dt-*`-Selektoren, Felder, Kalenderaktionen,
Popovergeometrie, Tagesraster und die inklusive 640-px-Bottom-Sheet-Grenze.
`public/css/overlays.css` besitzt nur den umgebenden Modalbackdrop und dessen lokale
Scroll-/Layergrenze; es besitzt keine DateTimeField-Innengeometrie.

Aufrufer-CSS DARF äußere Formularplatzierung und verfügbare Breite festlegen. Es DARF weder die
Popoverbreite, Tageszellengröße, Breakpointlogik noch innere Controlmaße überschreiben.

## 4. Varianten

| Variante | Option/Zustand | Status | Bedeutung |
|---|---|---|---|
| Datum und Uhrzeit | `dateOnly: false` oder nicht gesetzt | umgesetzt | Datum plus Uhrzeit, Minuten auf 5-Minuten-Schritt normalisiert |
| Nur Datum | `dateOnly: true` | umgesetzt | keine Uhrzeiteingabe, lokaler Tagesbeginn bei manueller Wahl |
| Pflichtfeld | `clearable: false` oder nicht gesetzt | umgesetzt | sichtbare Eingaben tragen `required`, keine Löschen-Aktion |
| Löschbar | `clearable: true` | umgesetzt | optionales Feld mit kontextbenannter Löschen-Aktion |
| Deaktiviert | `disabled: true` | umgesetzt | alle sichtbaren Controls deaktiviert |
| Einzelcontroller | `wireDateTimeField(...)` | umgesetzt | manuelle Eingabe und Kalender synchronisiert |
| Zeitraum | `wireDateTimeRange(...)` | umgesetzt | Ende-Mindestwert, Abstand, Bereichsmarkierung und Fehlermeldung |
| Mobiler Kalender | Viewportbreite höchstens 640 px | umgesetzt | fixiertes Bottom-Sheet |
| Desktopkalender | Viewportbreite über 640 px | umgesetzt | Popover am Trigger, maximal `--date-picker-width` = 360 px |

## 5. Erlaubte Anpassungen

- Aufrufer DÜRFEN `label`, `dateOnly`, `clearable` und `disabled` setzen.
- Aufrufer DÜRFEN zwei bereits verdrahtete Felder mit `minimumGapMs` und eigener `message`
  koppeln.
- Aufrufer DÜRFEN den Controller für ein fachlich notwendiges Minimum über `setMinimum(ms)` und
  zur Bereichsdarstellung über `setRange(startMs, endMs)` verwenden.
- Aufrufer DÜRFEN Draftwerte über die vorhandene Draft-API über eigene Re-Renders retten.
- Eine Änderung der 640-px-Grenze MUSS CSS und `matchMedia` gemeinsam ändern und ist eine eigene
  deklarierte Vertragsänderung. Paket 3 ändert sie ausdrücklich nicht auf 639 px.

## 6. Komponenteneigene Invarianten

- `dateTimeFieldHtml` erzeugt genau ein Hidden-Feld mit der Aufrufer-ID und sichtbare Eingaben im
  Format `TT.MM.JJJJ` sowie optional `HH:MM`.
- `required` gilt genau dann, wenn `clearable` false ist. Bei `dateOnly` gilt es nur für die
  Datumseingabe; bei Datum/Zeit für beide sichtbaren Eingaben.
- `disabled` MUSS Datum, Uhrzeit, Kalendertrigger und vorhandene Löschen-Aktion gemeinsam
  deaktivieren.
- Vollständige gültige manuelle Eingaben aktualisieren Hidden-Wert und Range synchron beim
  `input`-Ereignis. Zwischenstände bleiben stehen; Blur/Change validiert und normalisiert.
- Nicht-`dateOnly`-Werte werden auf den nächsten 5-Minuten-Schritt normalisiert. Kurze manuelle
  Formen bleiben bis zum Commit editierbar.
- Ein Fehler benennt die Wiederherstellung, setzt Custom Validity und `aria-invalid` an allen
  betroffenen sichtbaren Eingaben.
- Es ist höchstens ein DateTime-Popover geöffnet. Erneute Aktivierung oder Escape schließt es mit
  Fokus auf dem Trigger; Außeninteraktion schließt ohne erzwungenen Fokuswechsel.
- Innerhalb eines Modals MUSS das Popover an dessen Backdrop hängen, damit der Modal-Fokusfang
  seine Controls einschließt.
- Der Kalender rendert immer sechs vollständige Wochen. Monat/Jahr, Pfeile, Tagesraster und
  „Heute“ bleiben geometrisch stabil.
- `wireDateTimeRange` ruft `setMinimum(start + minimumGapMs)` am Endcontroller auf. Wird ein zuvor
  gültiger Beginn über das Ende hinaus verschoben, folgt das Ende unter Erhalt der gültigen Dauer,
  mindestens aber um `minimumGapMs`.
- CSS `@media (max-width: 640px)` und JavaScript
  `matchMedia('(max-width: 640px)')` MÜSSEN übereinstimmen. Bis einschließlich 640 px werden
  `top`/`left` entfernt und die CSS-Bottom-Sheet-Position verwendet; darüber wird am Trigger
  positioniert.
- Oberhalb 640 px misst das Popover höchstens `--date-picker-width`; an schmaleren Viewports
  überschreitet es nie die Viewportbreite.

Registry-Bezüge: `date-fields`, `calendar-days`, `native-fields`, `icon-button`, `button` und
`button-small` in [component-registry.mjs](../component-registry.mjs).

## 7. Erreichbare Zustände

- leer oder mit Anfangswert;
- Datum/Zeit oder nur Datum;
- Pflichtfeld, löschbar oder deaktiviert;
- vollständige gültige manuelle Eingabe;
- unvollständiges Zwischenstadium;
- ungültiges Datum, ungültige Uhrzeit oder ungültiger Zeitraum;
- Kalender geschlossen oder geöffnet;
- heute, ausgewählter Tag, Bereichstag und durch Minimum deaktivierter Tag;
- mobiler Bottom-Sheet bei 640 px einschließlich und Desktoppopover oberhalb 640 px.

## 8. Accessibility

- Datum, Uhrzeit, Kalendertrigger, Monat, Jahr und Navigation besitzen kontextbezogene deutsche
  Accessible Names. Der Trigger verwendet `aria-haspopup="dialog"` und aktuelles
  `aria-expanded`.
- Fehlertext ist über `aria-describedby` verbunden und besitzt `aria-live="polite"`.
- Das Popover ist ein benannter Dialog; der Kalender ist ein `grid` mit Spaltenüberschriften und
  benannten Tagesbuttons. Der gewählte Tag verwendet `aria-selected`.
- Pfeiltasten bewegen tage-/wochenweise; Home/End an Wochenränder; PageUp/PageDown monatsweise,
  mit Shift jahresweise. Enter wählt, Escape schließt.
- Fokus bleibt bei Monat-/Jahrauswahl auf dem Select und nach Tageswahl/Schließen auf dem
  Kalendertrigger.
- Bedeutung von heute, Auswahl, Bereich, Minimum und Fehler darf nicht nur über Farbe vermittelt
  werden.

## 9. Repräsentative Aufrufer

- Datum/Zeit und Zeitraum: `public/js/views/events.js`
- Löschbares Datum/Zeit: `public/js/views/foodOrders.js`
- Nur-Datum und eigener Draft: `public/js/views/checklist.js` und
  `public/js/views/eventPolls.js`

## 10. Prüfungen und Abnahmebeispiele

- `public/js/dateTimeField.test.js` prüft Markup, `required`/`clearable`, `disabled`,
  `dateOnly`, Parsing, Eingabemasken, Rundung und Monatsnavigation gegen ein Minimum.
- `src/test/e2e/flowsShell.fixture.ts` prüft im echten Eventdialog manuelle synchrone Eingabe,
  Blur-Normalisierung, Rangefehler, Minimumtage, Tastaturnavigation, Fokus und Popovergeometrie.
- Bei exakt 640 px MUSS das Popover links und rechts mit `var(--space-2)` als fixiertes
  Bottom-Sheet sitzen. Bei 641 px und Desktop MUSS es am Trigger positioniert und höchstens 360 px
  breit sein.
- Bei 320×568, 390×844, 512×384 und 720×450 bleiben alle sichtbaren Controls erreichbar; das
  Tagesraster scrollt nicht horizontal und ein Modal hält das Popover innerhalb seines Backdrops.
- Tagesauswahl, Escape, Tab/Shift+Tab im umgebenden Modal sowie vollständige manuelle Eingabe
  MÜSSEN sichtbaren Fokus beziehungsweise synchronen Hidden-Wert beweisen.

## 11. Permanente Varianten und befristete Ausnahmen

Die Registry-ID `date-fields` beschreibt die Standardcontrols, `calendar-days` das permanente
44-px-Strukturziel der sechs Kalenderwochen. `native-fields`, `icon-button`, `button` und
`button-small` liefern die gemeinsame Controlgeometrie. Die inklusive 640-px-Grenze ist eine
bewusst bewahrte Istvariante; sie ist keine befristete Ausnahme. Es gibt keine befristete
DateTimeField-Ausnahme.

- `registry:calendar-month-fields`: Month/year selectors are internal calendar parts at the shared control height.
