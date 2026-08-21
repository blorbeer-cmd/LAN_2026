# Übergabe: Essensbestellung ohne Warenkorb — Umsetzung

Diese Datei ist die vollständige, selbsttragende Arbeitsanweisung für die Umsetzung. Sie ist aus
sieben Abstimmungsrunden mit dem Nutzer entstanden und ersetzt für die Implementierung alle
früheren Fassungen.

## Ausgangslage

- **Bisher existiert keine Zeile Implementierung.** Der Branch `claude/orders-display-payment-5jelmf`
  und der Draft-PR **#462** enthalten ausschließlich Dokumentation.
- **Verbindlich ist das Mockup** `docs/mockups/food-order-direct-payment.html` (Runde 7). Im Browser
  öffnen — es ist anklickbar und mit den echten Tokens aus `server/public/css/style.css` nachgebaut.
  Veröffentlicht unter <https://claude.ai/code/artifact/41da182f-1b93-4904-9353-4decd116a1b7>.
- **`docs/plans/food-order-direct-payment.md` ist veraltet** (Runde 6). Es beschreibt noch Bezahlen
  an der Einzelposition und einen dreiwertigen Zustand — beides ist gestrichen. Wo dieses Dokument
  und der Plan sich widersprechen, gilt dieses Dokument. Der Plan ist im Umsetzungs-PR an den
  Zielzustand anzugleichen.
- `docs/plans/food-order-cart-concept.md` beschreibt den heutigen Warenkorb und wird abgelöst; seine
  Abschnitte zur Bezahl-Härtung (#444), zur Bestellübersicht (AP4) und zu den Klapp-Regeln der
  Bestellergruppen (AP3.1–AP3.4, AP3.6–AP3.11) bleiben gültig.

## Branch

Bevorzugt: PR #462 (Doku) mergen lassen, dann einen **neuen** Branch vom aktuellen `origin/main` —
so verlangt es `DEVELOPMENT_GUIDELINES.md` Abschnitt 2 für eine neue Phase. Soll #462 offen bleiben,
stattdessen von `claude/orders-display-payment-5jelmf` abzweigen, damit Mockup und Übergabe
verfügbar sind. Niemals direkt auf `main`.

## Zielzustand

### 1. Der Warenkorb entfällt vollständig

Ersatzlos entfernen: `renderCartBox()`, `handleCartPay()`, `handleCartMarkPaid()`, `groupCartState()`,
`cartItemIds`, die Attribute `data-toggle-cart`, `data-group-cart-toggle`, `data-cart-remove`,
`data-cart-pay`, `data-cart-mark-paid`, alle `.food-order-cart*`-Regeln und das Wort „Warenkorb“ aus
Text, Tooltip, `aria-label` und `DESIGN_SYSTEM.md`. Die Bestellung selbst heißt weiterhin
durchgehend „Sammelbestellung“. `shoppingCart` und `wallet` aus `icons.js` entfernen, falls kein
anderer Aufrufer bleibt.

### 2. Bezahlt wird ausschließlich pro Person

Genau ein Bezahlweg: ein PayPal-Knopf am Kopf jeder Bestellergruppe. Es gibt **keinen**
Bezahlen-Knopf an der Einzelposition und **keinen** an der Bestell-Gesamtsumme.

**Die Bezahl-Härtung aus PR #444 bleibt Wort für Wort erhalten** und wandert nur an die neue Stelle:
synchron im Klick geöffneter Tab, danach `popup.opener = null`, unmittelbar vor dem Navigieren ein
frischer `api.foodOrders.list()`-Abgleich mit Abbruch und Meldung, wenn Bestellung oder Position
verschwunden ist oder inzwischen woanders als bezahlt markiert wurde, `ctx.rerender()` in **allen**
Zweigen. Der bestehende E2E-Test, dessen `window.open`-Stub `null` zurückgibt, wenn `'noopener'`
übergeben wird, bleibt gültig.

### 3. Positionszeile

Links nach rechts: `Menge × Bezeichnung │ Betrag │ Kopieren │ Löschen`.

- **Keine Bezahlt-Marke** mehr an der Zeile. Wird die Person als bezahlt markiert, erhalten alle
  ihre Positionszeilen den abgeleiteten `is-paid`-Zustand und Beschreibung sowie Betrag werden
  durchgestrichen; beim Zurücksetzen verschwindet das direkt wieder.
- **Keine Haarlinie** im Aktionscluster — sie trennte Kopieren von Aktionen, die es dort nicht mehr
  gibt.
- **Betrag** bleibt Anzeige: die trinkgeldhaltige Summe, darunter klein `Menge × Einzelpreis` und
  `inkl. x% Trinkgeld`, sofern zutreffend. Ohne Preis steht „Betrag offen“.
- **Kopieren** kopiert genau den angezeigten Betrag. Bleibt bewusst erhalten (Anteil innerhalb einer
  Gruppe benennen). Ohne Preis entfällt es, der Platz bleibt als Abstandhalter reserviert.
- **Löschen** nur an eigenen Zeilen und nur solange die Bestellung offen ist. `disabled`, sobald
  **diese Position** bezahlt ist — dieselbe Grenze, die `DELETE /api/food-orders/:id/items/:itemId`
  serverseitig zieht (403 bei fremden Positionen). An fremden Zeilen ein Abstandhalter gleicher
  Breite, damit die Zeilen fluchten.
- Auf Handybreite bricht der Betragsblock wie bisher auf eine eigene Zeile um.

### 4. Gruppenkopf (Bestellergruppe)

Links nach rechts:
`Chevron · Farbpunkt · Name über Meta-Zeile │ Bezahlt-Marke │ Summe │ Kopieren · PayPal │ Löschen`.

Der Kopf ist ein Flex-Container mit Geschwistern, **kein Knopf im Knopf**: links ein Button mit
`aria-expanded` für Chevron, Punkt, Name und Meta-Zeile, rechts die übrigen Elemente daneben.

- **Meta-Zeile**: nur noch `<n> Positionen`, mengenbewertet gezählt (Menge 2 zählt als 2). Fehlt
  einer Position der Preis, kommt ` · Preis fehlt` dazu. Keine Summe, kein „n bezahlt“.
- **Summe**: **immer die volle Summe der Person** inklusive Trinkgeld, nie ein Restbetrag. Es gibt
  keine Teilzahlung mehr, also nichts herunterzurechnen. Ist die Person bestätigt, wird die Summe
  **durchgestrichen** und auf `--text-muted` gesetzt — dieselbe Erledigt-Sprache, die vorher die
  bezahlte Einzelposition hatte. Fehlt ein Preis: „Betrag offen“ (bzw. die Teilsumme gedämpft, wenn
  wenigstens ein Preis vorhanden ist).
- Direkt unter der Summe steht bei gesetztem Trinkgeld `inkl. x % Trinkgeld` in kleiner, gedämpfter
  Schrift. Ohne Trinkgeld entfällt die Zusatzzeile.
- **Kopieren** kopiert diese Summe. **PayPal** hängt sie nur an einen einfachen `paypal.me`-Link an;
  bei anderen PayPal-/Zahlungslinks wird nur die hinterlegte Adresse geöffnet. Gesperrt bei: bereits
  bezahlt, Preis unvollständig, Bestellung geschlossen — jeweils mit dem Grund in
  `title`/`aria-label`.
- **Löschen** entfernt alle Positionen dieser Person auf einmal. Nur an der **eigenen** Gruppe (der
  Server erlaubt ohnehin nur eigene Positionen, also keine Rechteerweiterung), nur bei offener
  Bestellung, und `disabled`, sobald **irgendeine** ihrer Positionen bezahlt ist. Umsetzung als
  `Promise.all` über dieselbe Einzel-Route; kein Bulk-Endpunkt. An fremden Gruppen ein Abstandhalter.
- Die grüne Plakette `.food-order-group-paid-badge` entfällt — die Marke zeigt denselben Zustand und
  ist zusätzlich bedienbar.

### 5. Bezahlt-Marke — zwei Zustände

Nur noch an der Person, zweiwertig: „Offen“ mit gestricheltem Kreis (neutral) und „Bezahlt“ mit
Haken (grün, `--state-playing`). Ein Zwischenzustand kann nicht mehr entstehen; die Bernstein-Farbe
`--state-paused` verschwindet aus dieser Komponente. Zustand nie über Farbe allein: das Wort steht in
der Marke, der Tooltip nennt die Wirkung des Klicks und im Zustand „Bezahlt“ auch, wer bestätigt hat.

- **Vorwärts (offen → bezahlt): ohne Rückfrage.** Das ist die alltägliche Aktion und mit einem Tipp
  umkehrbar. Setzt alle Positionen der Person auf bezahlt; bereits bezahlte bleiben unangetastet,
  ihre `paid_by`-Zuordnung geht nicht verloren.
- **Rückwärts (bezahlt → offen): ohne Rückfrage.** Ein Tipp setzt alle Positionen der Person direkt
  wieder auf offen. Der Tooltip nennt vor dem Klick weiterhin, wer die Zahlung bestätigt hat.
- Gesperrt ist die Marke nur bei **geschlossener** Bestellung. „Abgeschickt“ sperrt sie nicht —
  danach wird erst richtig kassiert.
- Der Zustand wird bei jedem Rendern aus den Positionen abgeleitet, nie als eigenes Feld gespeichert.
  Das `paid`-Feld je Position bleibt der Speicher, die Oberfläche setzt es nur noch im Block. Für die
  Anzeige der bestätigenden Person ergänzt Migration 76 `paid_by` und `paid_at`; ein eigenes
  Gruppenzustandsfeld gibt es nicht.

### 6. Rückfragen — es bleiben drei

1. **„Bezahlt?“** unmittelbar nach dem Öffnen des PayPal-Tabs: Bei `paypal.me` steht, dass die Summe
   übergeben wurde; sonst, dass PayPal geöffnet, die Summe dort aber nicht vorausgefüllt wurde.
   Darunter stehen die Positionen mit Beträgen sowie kopierbare Aktionen für Summe und hinterlegte
   PayPal-Adresse. „Ja, bezahlt“ setzt die Person auf bezahlt; „Noch nicht“, Escape und Klick daneben
   ändern nichts. **Nie einen Erfolg behaupten** — Respawn bekommt von PayPal keine Rückmeldung.
2. **Position löschen**: „&lt;Menge&gt; × &lt;Bezeichnung&gt; löschen?“, „Lässt sich nicht rückgängig
   machen.“, rot.
3. **Ganze eigene Gruppe löschen**: „Deine &lt;n&gt; Positionen löschen?“, „Lässt sich nicht
   rückgängig machen.“, **mit vollständiger Liste der betroffenen Positionen**, rot. Die Liste ist
   Pflicht: es ist die einzige unumkehrbare Sammelaktion im Bereich.

Alle Dialoge nutzen die bestehende Struktur aus `server/public/js/modal.js` bzw. das vorhandene
`confirmWithList()`. Keine neue Komponente. Ohne Rückfrage bleiben: die Bezahlt-Marke in beide
Richtungen und jedes Kopieren.

### 7. Zusammenfassungszeile der Bestellung

Eine gedämpfte Zeile, mengenbewertet gezählt, **Personen statt Positionen** beim Bezahlstand:

`<n> Positionen von <m> Personen · <k> von <m> bezahlt · Gesamt <x,xx €> · offen <y,yy €>`

„offen“ nur wenn > 0, und es summiert die Personen, die **nicht** vollständig bestätigt sind. Fehlen
Preise, wird nicht der Betrag durch „Betrag offen“ ersetzt, sondern die tatsächliche Teilsumme
gezeigt und am Ende ` · Preise unvollständig` angehängt. Die Bestell-Gesamtsumme unten heißt dann
„Gesamtsumme … (unvollständig)“.

### 8. Infokasten

- **Bestellübersicht rechts verankert** (`margin-left: auto`) in der Knopfreihe, hinter „Speisekarte“ und
  „PayPal öffnen“. Sie ist als einzige der drei immer vorhanden; ihr Platz darf nicht davon abhängen,
  wie viele Links davor stehen. `renderOrderListButton()` und der Werkzeugleisten-Platz entfallen;
  die Knopfreihe wird auch dann gerendert, wenn weder Speisekarte noch PayPal hinterlegt sind.
- **Für alle sichtbar.** Der Check auf Aufgeber/Admin fällt ersatzlos weg. Die Liste enthält weder
  Namen noch Bezahlt-Zustände, nur was insgesamt bestellt wurde.
- **„PayPal öffnen“ bekommt das PayPal-Icon** vorangestellt.
- **Versandzeit**: das Wort „Versand“ neben der Uhr entfällt, das Komma nach dem Datum ebenfalls —
  Ergebnis `<Uhr-Icon> 20.08. 19:30 Uhr`. Das Komma stammt aus `toLocaleString('de-DE')`; dafür
  bekommt die Essen-Ansicht einen eigenen schmalen Formatierer, statt `formatDateTime()` app-weit
  umzustellen und unbeteiligte Ansichten zu verändern. Ohne Zeitpunkt bleibt es beim schlichten
  „Kein Zeitpunkt festgelegt“ ohne Icon.

### 9. Reihenfolge in der Karte und Klapp-Zustand

Reihenfolge: Titel und Status-Badge · Meta-Zeile „von &lt;Ersteller&gt; · &lt;Erstellzeitpunkt&gt;“ ·
Infokasten · Zusammenfassungszeile · Werkzeugleiste · Bestellergruppen · Gesamtsumme ·
Hinzufügen-Formular · Bestellaktionen.

- **Werkzeugleiste** trägt nur noch „Alle ausklappen“/„Alle einklappen“, **links**, allein in ihrer
  Zeile. Sie erscheint nur im ausgeklappten Zustand und nur bei mehr als einer Bestellergruppe.
- **Mehrere offene Bestellungen starten eingeklappt.** Eine einzige offene Bestellung bekommt gar
  keine Klapp-Hülle.
- **Ein Direktlink klappt genau die verlinkte offene Bestellung auf.** Liegt sie bereits in der
  Historie, öffnet er die Historie, sodass das Ziel unmittelbar sichtbar ist.
- Eingeklappt sind nur Bestellergruppen, Werkzeugleiste, Hinzufügen-Formular und Bestellaktionen.
  Sichtbar bleiben Titel, Badge, Ersteller, Erstellzeitpunkt, Infokasten (mit Versandzeit, Hinweis,
  Bestellübersicht, Speisekarte, PayPal) und Zusammenfassungszeile.
- **Kein `<details>`/`<summary>` mehr** für die Karte: der immer sichtbare Teil enthält Knöpfe und
  Links, die dort nicht liegen dürfen. Stattdessen derselbe Aufbau wie beim Gruppenkopf — ein
  Umschalt-Button mit `aria-expanded` als Geschwister neben Badge und Rest.
- **Folge in `server/public/js/app.js`**: `focusPendingSearchTarget()` kann sich nicht mehr auf
  `element instanceof HTMLDetailsElement` und `element.open = true` verlassen. Die Essen-Ansicht muss
  die Ziel-Bestellung **vor** dem Rendern als ausgeklappt eintragen; `app.js` scrollt und markiert
  danach wie bisher.
- **Push-URL mit Bestell-ID**: `server/src/routes/foodOrders.ts` zeigt heute auf `/#foodOrders` ohne
  ID. Damit „Direktlink“ nicht nur über die Suchpalette funktioniert, wird daraus
  `/#foodOrders/<id>`; die Ansicht liest die ID beim Eintritt aus und behandelt sie wie ein Suchziel.
  Ein unbekanntes oder verschwundenes Ziel wird still ignoriert und fällt auf die Standardregel
  zurück.
- Die Klapp-Regel gilt **einmal je Ansicht und Sitzung**. Danach gehört der Zustand dem Nutzer und
  überlebt jedes Realtime-Rerender unverändert — dieselbe Zusage wie bei den Bestellergruppen. Ablage
  als Modul-Variable, nicht persistiert.

### 10. „Hinzufügen“-Knopf

Wird ein ganz normaler `.btn`. Heute setzen **drei** verstreute Regeln in `style.css`
`padding-right: 0` (Desktop) bzw. `var(--space-3)` (Handy) gegen die 18 px links aus `.btn` — daher
der aus der Mitte gerutschte Text — und `align-self: center` macht den Knopf niedriger als die Felder
daneben, was beim Hovern als abweichender Umriss auffällt. Neu: **eine** Regel,
`grid-column: -2 / -1`, `align-self: stretch`, kein Padding-Eingriff. Auf Handybreite wie bisher
volle Breite in eigener Zeile.

### 11. PayPal-Icon

Neuer Eintrag `paypal` in `server/public/js/icons.js` mit dem **offiziellen Monogramm**, 24×24,
Pfad aus dem npm-Paket `simple-icons` (nur der Pfad als Konstante übernehmen, **nicht** das Paket als
Abhängigkeit aufnehmen):

```
M15.607 4.653H8.941L6.645 19.251H1.82L4.862 0h7.995c3.754 0 6.375 2.294 6.473 5.513-.648-.478-2.105-.86-3.722-.86m6.57 5.546c0 3.41-3.01 6.853-6.958 6.853h-2.493L11.595 24H6.74l1.845-11.538h3.592c4.208 0 7.346-3.634 7.153-6.949a5.24 5.24 0 0 1 2.848 4.686M9.653 5.546h6.408c.907 0 1.942.222 2.363.541-.195 2.741-2.655 5.483-6.441 5.483H8.714Z
```

`icon()` setzt heute fest `fill="none" stroke="currentColor"`. Ein Markenglyph ist eine Fläche.
Dafür bekommt `icons.js` einen schmalen Satz `FILLED_ICONS = new Set(['paypal'])`, der **nur die
Malweise** umschaltet (`fill="currentColor" stroke="none"`) — keine zweite Funktion, keine neue
Komponente, der übrige Satz bleibt unberührt.

Geprüft und verworfen: `wallet` („Geld allgemein“), `squareArrowOutUpRight` („öffnet extern“) und
eine selbst gezeichnete Strichvariante des Doppel-P, die bei 18 px zu zwei unklaren Haken zerfällt.
Der Vergleich bei 18/24/40 px steht in Plate 05 des Mockups. Rechtlich: die SVG-Sammlung von
`simple-icons` steht unter CC0, das Markenrecht bleibt bei PayPal; die Beschriftung eines echten
PayPal-Bezahlwegs ist der benennende Gebrauch, für den das zulässig ist.

### 12. Randfall, der bewusst so bleibt

Trägt jemand eine Position nach, **nachdem** die Person bestätigt wurde, springt ihre Marke zurück
auf „Offen“ und ihre Summe zeigt wieder **alles** — nicht nur den tatsächlich noch offenen Rest. Der
Restbetrag ließe sich nur mit genau der Teilzahlungs-Buchhaltung darstellen, die hier bewusst
entfallen ist. Das ist eine getroffene Entscheidung, kein Fehler; nicht „reparieren“. Im Mockup als
dritte Karte in Plate 07 abgebildet.

Ebenso bewusst weggefallen: Wer für jemand anderen mitbestellt, kann seinen eigenen Teil nicht mehr
getrennt abhaken — die fremde Position steht unter seinem Namen und wird mitbezahlt. Wer trennen
will, lässt die andere Person selbst eintragen.

### 13. Stündliche Zahlungserinnerung

- Erst wenn eine Bestellung seit mindestens einer Stunde abgeschickt ist, werden aktive Personen
  mit noch unbezahlten Positionen berücksichtigt. Finalisierte Bestellungen werden nicht erinnert.
- Pro Person und Event gibt es höchstens eine direkte Push-Erinnerung innerhalb einer rollierenden
  Stunde. Ein eigener, per Migration angelegter Datenbankzustand hält diese Sperre auch nach
  Neustarts und unabhängig vom auf 50 Einträge begrenzten Push-Verlauf fest.
- Eine einzelne betroffene Bestellung verlinkt direkt auf sie; bei mehreren führt der Link allgemein
  in den Essen-Bereich. Unter Home → Aktuell wird die bestehende Bestellzeile zum Zahlungshinweis
  erweitert, statt einen doppelten Eintrag anzulegen.

## Tests

Neue und geänderte Logik bekommt Tests für Happy Path, Validierungsfehler und Zustandskonflikte:

- **Bezahlen pro Person**: Happy Path, Abbruch über „Noch nicht“, eine Position inzwischen anderswo
  bezahlt, eine Position inzwischen gelöscht, PayPal-Link inzwischen entfernt, Bestellung ohne
  PayPal-Link.
- **Marke**: in beide Richtungen ohne Dialog, alle Positionen gemeinsam durchgestrichen bzw. wieder
  aktiviert, gesperrt bei geschlossener Bestellung, nicht gesperrt bei „Abgeschickt“.
- **Gruppen-Löschen**: Happy Path, Abbruch, gesperrt sobald eine Position bezahlt ist, nicht
  vorhanden an fremden Gruppen, Teil-Fehlschlag beim parallelen Löschen (Cache verwerfen, neu laden).
- **Klapp-Zustand**: mehrere offene Bestellungen starten zu, Direktlink klappt genau eine auf bzw.
  öffnet bei abgeschicktem Ziel die Historie, ein Realtime-Rerender ändert den Zustand nicht, eine
  einzige offene Bestellung hat keine Klapp-Hülle.
- **Bestellübersicht**: für eine Person erreichbar, die weder Aufgeberin noch Admin ist.
- **Erinnerung**: frühestens eine Stunde nach dem Abschicken, Aggregation je Person/Event, dauerhafte
  Stundensperre auch ohne Push-Log-Eintrag und Ende nach vollständiger Bezahlung.

Der Essensbestellung-E2E-Flow in `server/src/test/e2e/flows.fixture.ts` wird mitgeführt, nicht am
Ende nachgezogen. Tests nicht löschen, lockern oder mit Timeouts kaschieren.

## Betroffene Stellen

- `server/public/js/views/foodOrders.js` — Hauptarbeit.
- `server/public/js/icons.js` — `paypal` + `FILLED_ICONS`; `shoppingCart`/`wallet` prüfen.
- `server/public/css/style.css` — `.food-order-cart*` raus; `.food-order-group-*`,
  `.food-order-item-*`, `.food-order-card-toolbar`, `.food-order-detail-links`,
  `.food-order-add-button` anpassen.
- `server/public/js/app.js` — `focusPendingSearchTarget()`.
- `server/src/routes/foodOrders.ts` — Push-URL mit Bestell-ID.
- `server/src/foodOrderReminders.ts` und `server/src/db.ts` — stündlicher Job und dauerhafte Sperre.
- `server/src/test/e2e/flows.fixture.ts` und die Essen-Tests.
- `server/DESIGN_SYSTEM.md` — Abschnitt „Food orders“ im selben PR nachziehen.
- `docs/plans/food-order-direct-payment.md` — an den Zielzustand angleichen (steht auf Runde 6).

## Definition of Done

Vor Preflight `node ./scripts/agent-preflight.mjs --scope frontend` ausführen. Danach mindestens:

```
npm --prefix server run lint
npm --prefix server run build
npm --prefix server test
npm --prefix server run check:tokens
npm --prefix server run test:e2e
```

Alle Tippziele bleiben bei mindestens 32 px, es werden ausschließlich bestehende Abstands-, Farb- und
Typo-Token verwendet, `check:tokens` bleibt grün. Zustände nie allein über Farbe. Ergebnis bei Handy-
und Laptopbreite prüfen. Abschluss über Commit, Push des Feature-Branches und Draft-PR mit gültigem
Task-Vertrag; kein Approve, kein Merge, kein Push auf `main`.
