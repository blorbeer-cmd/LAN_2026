# Plan: Essensbestellung ohne Warenkorb — Bezahlen an der Summe

## Stand und Zuschnitt

Dieses Dokument ist die Mockup-Fassung von Runde 6. Es beschreibt vollständig, **was** gebaut werden
soll; die Umsetzung ist ausdrücklich noch nicht Teil dieses Arbeitspakets. Es ersetzt die
Warenkorb-Entscheidungen aus [`food-order-cart-concept.md`](food-order-cart-concept.md)
(Leitentscheidungen 1–6, AP1.4, AP1.5, AP2.1–AP2.3, AP3.5); alles Übrige dort — insbesondere die
Bezahl-Härtung aus PR #444, die Bestellliste (AP4) und die Klapp-Regeln der Bestellergruppen
(AP3.1–AP3.4, AP3.6–AP3.11) — bleibt unverändert gültig.

Interaktives Mockup mit allen Zuständen. Die Panels sind mit den echten Tokens aus
`server/public/css/style.css` nachgebaut und anklickbar:

- im Repository: [`docs/mockups/food-order-direct-payment.html`](../mockups/food-order-direct-payment.html)
  (Datei im Browser öffnen)
- veröffentlicht: <https://claude.ai/code/artifact/41da182f-1b93-4904-9353-4decd116a1b7>

## Ziel

Der Warenkorb verlangt für jede Zahlung einen Sammelschritt, auch wenn nur eine einzelne Position
gemeint ist — und genau das ist der Normalfall. An seine Stelle tritt ein Bezahlweg direkt an der
Summe: einer je Position und einer je Person. Zusätzlich starten mehrere gleichzeitig offene
Bestellungen eingeklappt, zeigen im eingeklappten Kasten aber alles, was die Entscheidung „muss ich
hier rein?“ trägt.

## Leitentscheidungen

1. **Kein Warenkorb.** Korb-Kasten, Korb-Umschalter an Zeile und Gruppe, „Alle als bezahlt
   markieren“ im Korb und das `shoppingCart`-Icon entfallen ersatzlos. `cartItemIds` und
   `groupCartState()` verschwinden mitsamt Tests.
2. **Bezahlen steht bei der Summe** — an der Position und an der Personensumme, beide mit
   PayPal-Icon. Die Popup- und Staleness-Härtung aus PR #444 bleibt Wort für Wort erhalten
   (synchron geöffneter Tab, `popup.opener = null`, frischer `api.foodOrders.list()`-Abgleich
   unmittelbar vor dem Navigieren, `ctx.rerender()` in allen Zweigen); sie arbeitet künftig nur mit
   einer variablen Positionsmenge statt mit der Korb-Auswahl.
3. **Kopieren steht bei jeder Summe**, an der Position wie an der Person. Ebenso **Löschen**: an
   der Personensumme entfernt es alle eigenen Positionen auf einmal.
4. **Die Bezahlt-Marke gibt es auch je Person**, mit drei Zuständen. Vorwärts markiert sie alle noch
   offenen Positionen der Person; rückwärts setzt sie alle wieder auf offen.
5. **Die Lebenssumme der Person steht links** unter dem Namen bei der Positionszusammenfassung, nicht
   mehr unter dem offenen Betrag.
6. **Mehrere offene Bestellungen starten eingeklappt**, eine per Direktlink geöffnete ausgeklappt.
7. **Texte bleiben knapp.** Keine Erklärsätze, keine Wiederholung dessen, was die Darstellung schon
   sagt. Tooltips und `aria-label` dürfen ausführlicher sein, sie sind die Barrierefreiheitsebene.

## AP1 — Warenkorb entfernen

- `renderCartBox()`, `handleCartPay()`, `handleCartMarkPaid()`, `markCartItemsPaid()`s Korb-Bindung,
  `cartItemIds`, `groupCartState()` und die zugehörigen `data-toggle-cart`,
  `data-group-cart-toggle`, `data-cart-remove`, `data-cart-pay`, `data-cart-mark-paid` entfallen.
- `markCartItemsPaid()` bleibt als Sammel-Markierung erhalten, wird aber von der Personenmarke
  aufgerufen und passend umbenannt. Der Server-Kontrakt ändert sich nicht: erneut laden, bereits
  anderswo erledigte oder verschwundene Positionen überspringen statt doppelt zu markieren, den Rest
  parallel per `PATCH /api/food-orders/:id/items/:itemId`, und die Zahl der **tatsächlich**
  geänderten Positionen melden.
- `shoppingCart` aus `icons.js` entfernen, sofern kein anderer Aufrufer bleibt.
- „Warenkorb“ verschwindet aus Text, Tooltips, `aria-label` und `DESIGN_SYSTEM.md`. Die Bestellung
  selbst bleibt durchgehend eine „Sammelbestellung“.

## AP2 — Bezahlen und Kopieren an der Summe

- **AP2.1 Positionszeile**, links nach rechts:
  `Marke │ Menge × Bezeichnung │ Betrag │ Kopieren ┊ PayPal │ Löschen`.
  Der PayPal-Knopf sitzt genau dort, wo bisher der Korb-Umschalter saß — gleiche Breite, gleiche
  Haarlinie davor. Alles andere an der Zeile bleibt wie in AP1.1–AP1.3 des Vorgängerplans.
- **AP2.2 Gruppenkopf**, links nach rechts:
  `Chevron · Punkt · Name über Meta-Zeile │ Marke │ offener Betrag │ Kopieren ┊ PayPal`.
  Erst der Zustand, dann der Betrag, dann die Aktionen — dieselbe Leserichtung wie in der
  Positionszeile.
- **AP2.3 Meta-Zeile der Gruppe** trägt jetzt auch die Lebenssumme:
  `<n> Positionen · <n> bezahlt · Gesamt <x,xx €>`. Der mittlere Teil nur, wenn er zutrifft. Fehlt
  einer Position der Preis, steht dort `Gesamt <Teilsumme> · Preis fehlt`, und wenn gar kein Preis
  eingetragen ist, nur `kein Preis eingetragen`.
- **AP2.4 Der offene Betrag** bleibt die Summe der unbezahlten Positionen inkl. Trinkgeld — exakt
  das, was der PayPal-Knopf daneben überträgt. Fehlt darin ein Preis, steht „Betrag offen“ statt
  einer irreführend vollständigen Summe. Ist alles bezahlt, entfällt der offene Betrag ganz (0,00 €
  ist keine Information); die grüne Marke trägt den Zustand.
- **AP2.5 Gesperrte Bezahlen-Knöpfe** statt fehlender: bezahlte Position, vollständig bezahlte
  Gruppe, Position ohne Preis und geschlossene Bestellung zeigen den Knopf `disabled` mit dem Grund
  in `title`/`aria-label`.
- **AP2.6 Ohne PayPal-Link der Bestellung** entfallen Bezahlen-Knopf und Trennlinie in der ganzen
  Karte — nicht zeilenweise. Ein Abstandhalter wäre dort sinnlos, weil keine einzige Zeile der Karte
  einen Knopf trägt, mit dem etwas fluchten müsste. Innerhalb einer Bestellung **mit** Link bleibt
  der Platz reserviert, wenn nur einzelne Zeilen keinen Knopf haben.
- **AP2.7 PayPal-Icon**: neuer Eintrag `paypal` in `icons.js` mit dem **offiziellen Monogramm**
  (Pfad aus dem npm-Paket `simple-icons`, 24×24). Der vorhandene Satz hat 88 Einträge, aber keinen,
  der „PayPal“ bedeutet; `wallet` sagt „Geld allgemein“ und `squareArrowOutUpRight` sagt „öffnet
  extern“ — beide wurden geprüft und verworfen, ebenso eine selbst gezeichnete Strichvariante des
  Doppel-P, die bei 18 px zu zwei unklaren Haken zerfällt. Ein Bezahlen-Knopf lebt davon, ohne Lesen
  erkannt zu werden, und erkannt wird die Marke, nicht eine Annäherung an sie.
  Rechtlich: Die SVG-Sammlung von `simple-icons` steht unter CC0, das Markenrecht bleibt bei PayPal;
  die Beschriftung eines echten PayPal-Bezahlwegs ist der benennende Gebrauch, für den das zulässig
  ist. Der Pfad wird als Konstante übernommen, nicht das Paket als Abhängigkeit.
- **AP2.8 Gefüllte Icons**: `icon()` setzt heute fest `fill="none" stroke="currentColor"`. Ein
  Markenglyph ist eine Fläche. `icons.js` bekommt dafür einen schmalen Satz `FILLED_ICONS`, der nur
  die Malweise umschaltet — keine zweite Funktion, keine neue Komponente, der übrige Satz bleibt
  unberührt. `wallet` entfällt, wenn kein anderer Aufrufer bleibt.

## AP3 — Bezahlt-Marke je Person

- **AP3.1 Drei Zustände**, abgeleitet aus den Positionen, nie gespeichert:
  keine bezahlt („Offen“, neutral) · teilweise („Teilweise“, Bernstein `--state-paused`) · alle
  bezahlt („Bezahlt“, grün `--state-playing`). Farbe trägt nie allein: jeder Zustand steht als Wort
  in der Marke, der Tooltip nennt zusätzlich die Wirkung des Klicks.
- **AP3.2 Vorwärts** (aus „Offen“ und „Teilweise“) markiert alle noch offenen Positionen der Person.
  Bereits bezahlte bleiben unangetastet, ihre `paid_by`-Zuordnung geht nicht verloren.
- **AP3.3 Rückwärts** (aus „Bezahlt“) setzt alle Positionen der Person wieder auf offen. Das ist der
  einzige Weg, der fremde Bestätigungen zurückdreht, und deshalb der einzige an dieser Marke mit
  eigener, benannter Rückfrage (siehe AP4.3).
- **AP3.4 Die grüne Gruppen-Bezahlt-Plakette** (`.food-order-group-paid-badge`) entfällt: die Marke
  zeigt denselben Zustand und ist zusätzlich bedienbar.
- **AP3.5 Ist alles bezahlt, wird die Gesamtsumme in der Meta-Zeile durchgestrichen** und auf
  `--text-muted` gesetzt — dieselbe Erledigt-Sprache wie beim Betrag einer bezahlten Einzelposition.
  Der offene Betrag rechts entfällt in diesem Zustand ganz; 0,00 € ist keine Information.
- **AP3.6 Gesperrt** ist die Personenmarke nur bei geschlossener Bestellung, wie die Positionsmarke
  auch. „Abgeschickt“ sperrt sie nicht — danach wird ja erst richtig kassiert.
- **AP3.7 Löschen an der Personensumme**, ganz außen im Aktionscluster, exakt wie am Zeilenende:
  entfernt alle Positionen dieser Person auf einmal. Es erscheint nur an der **eigenen** Gruppe —
  `DELETE /api/food-orders/:id/items/:itemId` erlaubt ohnehin nur eigene Positionen (403 sonst), es
  ist also keine Rechteerweiterung — und nur, solange die Bestellung offen ist. Enthält die Gruppe
  eine bezahlte Position, ist der Knopf `disabled` mit der Begründung im Tooltip: bezahlte Zeilen
  sind einzeln geschützt, das darf der Sammelweg nicht umgehen. An fremden Gruppen steht ein
  Abstandhalter derselben Breite, damit die Köpfe fluchten. Umgesetzt wird es als `Promise.all` über
  dieselbe Einzel-Route; ein Bulk-Endpunkt kommt bei dieser Größenordnung nicht.

## AP4 — Rückfragen

Alle Dialoge nutzen die bestehende Struktur aus `server/public/js/modal.js` beziehungsweise das
vorhandene `confirmWithList()`: Titel, ein Satz, Positionsliste, Abbrechen links, Bestätigen rechts,
Fokus auf der harmlosen Seite, Escape bricht ab.

- **AP4.1 „Bezahlt?“** nach jedem Bezahlen-Klick, an der Position wie an der Person, unmittelbar
  nachdem der PayPal-Tab geöffnet wurde. Text: „<Summe> für <n> Positionen an PayPal übergeben.“
  plus Liste mit Besteller. „Ja, bezahlt“ markiert die übergebenen Positionen als bezahlt; „Noch
  nicht“, Escape und Klick daneben ändern nichts. Nie einen Erfolg behaupten — Respawn bekommt von
  PayPal keine Rückmeldung.
- **AP4.2 Person vorwärts markieren**: „<n> Positionen · <Summe>.“ plus Liste, Bestätigen blau
  (umkehrbar).
- **AP4.3 Person zurückdrehen** (neu): Titel „Bezahlt-Markierung für <Name> aufheben?“, Text
  „<n> Positionen werden wieder als offen geführt.“, Liste mit „bestätigt von <Name>“ je Position,
  und wenn fremde Bestätigungen dabei sind, zusätzlich „Darunter sind Bestätigungen von anderen.“
  Bestätigen blau, nicht rot: es ist umkehrbar, aber es braucht die Namen.
- **AP4.4 Position löschen** bleibt unverändert: „<Menge> × <Bezeichnung> löschen?“, „Lässt sich
  nicht rückgängig machen.“, rot.
- **AP4.5 Ganze Personengruppe löschen** (neu): Titel „Deine <n> Positionen löschen?“, Text „Lässt
  sich nicht rückgängig machen.“, darunter die vollständige Liste der betroffenen Positionen, rot.
  Die Liste ist hier Pflicht, nicht Zierde: Es ist die einzige unumkehrbare Sammelaktion im Bereich,
  und man muss sehen, was verschwindet, bevor es verschwindet.
- **Ohne Rückfrage** bleiben: die Positionsmarke in beide Richtungen und jedes Kopieren.

## AP5 — Eingeklappte Bestellungen und Direktlink

- **AP5.1 Startregel**: Gibt es mehr als eine offene Bestellung, starten alle eingeklappt. Zeigt der
  Aufruf über einen Direktlink auf eine bestimmte Bestellung, startet genau diese ausgeklappt. Eine
  einzige offene Bestellung bekommt weiterhin gar keine Klapp-Hülle.
- **AP5.2 Die Regel gilt einmal** je Ansicht und Sitzung. Danach gehört der Zustand dem Nutzer und
  überlebt jedes Realtime-Rerender unverändert — dieselbe Zusage wie bei den Bestellergruppen
  (AP3.7 des Vorgängerplans).
- **AP5.3 Der eingeklappte Kasten zeigt**: Titel und Status-Badge, „von <Ersteller> ·
  <Erstellzeitpunkt>“, den Infokasten (Versandzeit, Hinweis, Bestellliste, Speisekarte, PayPal
  öffnen) und darunter die Zusammenfassungszeile. Eingeklappt sind nur Bestellergruppen,
  Hinzufügen-Formular, Werkzeugleiste und Bestellaktionen.
- **AP5.4 Kein `<details>` mehr.** Der immer sichtbare Teil enthält Knöpfe und Links; die dürfen
  nicht in einem `<summary>` liegen. Stattdessen derselbe Aufbau wie beim Gruppenkopf: ein
  Umschalt-Button mit `aria-expanded` als Geschwister neben Badge und Rest — kein Knopf im Knopf.
- **AP5.5 Folge für den Sprung aus der Suche**: `focusPendingSearchTarget()` in `app.js` kann sich
  nicht mehr auf `element instanceof HTMLDetailsElement` und `element.open = true` verlassen. Die
  Essen-Ansicht muss die Ziel-Bestellung vor dem Rendern als ausgeklappt eintragen; `app.js` scrollt
  und markiert danach wie bisher.
- **AP5.6 Direktlink mit Bestell-ID**: Die Push-Benachrichtigung zur neuen Sammelbestellung zeigt
  heute auf `/#foodOrders` ohne ID (`server/src/routes/foodOrders.ts`). Damit „Direktlink“ nicht nur
  über die Suchpalette funktioniert, bekommt sie `/#foodOrders/<id>`; die Ansicht liest die ID beim
  Eintritt aus und behandelt sie wie ein Suchziel. Ein unbekanntes oder nicht mehr vorhandenes
  Ziel wird still ignoriert und fällt auf die Standardregel zurück.

## AP6 — Werkzeugleiste, Bestellinfo, Hinzufügen

- **AP6.1 Die Bestellliste zieht in den Infokasten**, an die erste Stelle der Knopfreihe vor
  „Speisekarte“ und „PayPal öffnen“. Sie ist als einzige der drei immer vorhanden, steht also
  vorn, damit ihr Platz nicht springt, wenn ein Link fehlt. `renderOrderListButton()` und der
  separate Werkzeugleisten-Platz entfallen; die Knopfreihe wird damit auch dann gerendert, wenn
  weder Speisekarte noch PayPal hinterlegt sind.
- **AP6.2 Die Bestellliste ist für jede angemeldete Person zu öffnen**, nicht mehr nur für Aufgeber
  und Admins. Sie enthält weder Namen noch Bezahlt-Zustände, sondern ausschließlich, was insgesamt
  bestellt wurde — es gibt daran nichts zu schützen, und wer beim Abholen mitliest, braucht sie
  genauso. Der Sichtbarkeits-Check in `renderOrderListButton()` fällt ersatzlos weg.
- **AP6.3 Reihenfolge in der Karte**: Titel und Badge, Meta-Zeile, Infokasten,
  Zusammenfassungszeile, dann die Werkzeugleiste mit „Alle ausklappen“/„Alle einklappen“ — links,
  allein in ihrer Zeile. Der Schalter erscheint nur im ausgeklappten Zustand und nur bei mehr als
  einer Bestellergruppe: Er klappt die Gruppen innerhalb der Bestellung, solange die Karte zu ist,
  hat er keinen Gegenstand.
- **AP6.4 Bestellinfo**: Das Wort „Versand“ neben der Uhr entfällt, das Komma nach dem Datum
  ebenfalls — also `<Uhr-Icon> 20.08. 19:30 Uhr`. Das Komma stammt aus
  `toLocaleString('de-DE')`; die Essen-Ansicht bekommt dafür einen eigenen schmalen Formatierer,
  statt `formatDateTime()` app-weit umzustellen und damit unbeteiligte Ansichten zu verändern.
  Ohne Zeitpunkt bleibt es beim schlichten „Kein Zeitpunkt festgelegt“ ohne Icon.
- **AP6.5 „Hinzufügen“** wird ein ganz normaler `.btn`. Heute setzen drei verstreute Regeln
  `padding-right: 0` (Desktop) beziehungsweise `var(--space-3)` (Handy) gegen die 18 px links aus
  `.btn` — daher der aus der Mitte gerutschte Text — und `align-self: center` macht den Knopf
  niedriger als die Felder daneben, was beim Hovern als abweichender Umriss auffällt. Neu: eine
  Regel, `grid-column: -2 / -1`, `align-self: stretch`, kein Padding-Eingriff; auf Handybreite wie
  bisher volle Breite in eigener Zeile.
- **AP6.6 Zusammenfassungszeile**: Beträge werden nicht mehr durch „Betrag offen“ ersetzt, wenn
  einzelne Preise fehlen. Stattdessen die tatsächliche Teilsumme plus der abschließende Hinweis
  „Preise unvollständig“ — dieselbe Konvention, die der Bestelllisten-Dialog mit „(unvollständig)“
  schon verwendet. Die Gesamtsumme der Bestellung wird entsprechend als
  „Gesamtsumme … (unvollständig)“ beschriftet.

## Workflows und Klickzahlen

Gezählt ab dem Moment, in dem die Position in der Bestellung steht, bis sie als bezahlt markiert
ist. Die Bestätigung zählt in beiden Modellen mit, das Eintippen der Position in keinem.

| | Szenario | Warenkorb | Direktzahlung |
|---|---|---:|---:|
| A | Eigene Position bezahlen (Normalfall) | 3 | **2** |
| B | Für jemanden mitbestellt, nur meins bezahlen | 3 | **2** |
| C | Für jemanden mitbestellt, beides bezahlen | 4 | **2** |
| D | Positionen einer anderen Person übernehmen | 3 | **2** |
| E | Eigene Gruppe **und** fremde Gruppe zusammen | 4 | 4 |
| F | Bar kassiert, nur abhaken | 3 | **2** |
| G | Nur den Betrag kopieren | 1 | 1 |
| H | Falsche Person abgehakt, zurückdrehen | n | **2** |
| I | Eigene Bestellung komplett zurückziehen (3 Positionen) | 6 | **2** |

Die Annahme des Nutzers hält: In acht von neun Szenarien braucht die Direktzahlung weniger oder
gleich viele Klicks, im häufigsten Fall A ein Drittel weniger. Der Grund ist strukturell — der Korb
verlangt immer einen Sammelschritt, auch für eine einzelne Position.

**Der einzige Verlust ist E**: zwei Gruppen in einer Überweisung. Gleiche Klickzahl, aber zwei
PayPal-Vorgänge statt einem. Empfänger und Beträge stimmen in beiden Fällen; für diesen Fall einen
Korb zu behalten, der in jedem anderen Szenario einen Zusatzklick kostet, wäre der schlechtere
Tausch.

Weitere Fälle, die der Aufbau mittragen muss:

- **Der Aufgeber kassiert.** Er liest den offenen Rest in der Zusammenfassungszeile und hakt Eingänge
  an der Personenmarke ab — ein Klick pro Person statt pro Position.
- **Position ohne Preis.** Bezahlen gesperrt, Marke bedienbar; bar bezahlen geht auch ohne
  hinterlegten Preis.
- **Zwei Leute bezahlen gleichzeitig.** Der Bezahlen-Knopf prüft unmittelbar vor dem Öffnen erneut
  gegen den Server und bricht mit Meldung ab, wenn eine Position inzwischen weg oder woanders
  bezahlt ist — unverändert aus PR #444.
- **Jemand trägt nach, während ich zahle.** Betrifft nur die Personensumme; die übergebene Summe
  bleibt gültig, die neue Position bleibt offen und wird separat bezahlt.

## Betroffene Stellen

- `server/public/js/views/foodOrders.js` — `renderItemRow()`, `renderGroupHeader()`,
  `renderItems()`, `renderOrderOverview()`, `renderOrderSummary()`, `renderOrderSummaryTotal()`,
  `renderCardToolbar()`, `renderDetails()`, `renderOpenOrder()`, `renderClosedOrder()`; entfallend:
  `renderCartBox()`, `handleCartPay()`, `handleCartMarkPaid()`, `groupCartState()`, `cartItemIds`,
  `renderOrderListButton()` (geht in `renderDetails()` auf).
- `server/public/js/icons.js` — `paypal` als gefüllten Markenglyph ergänzen, `FILLED_ICONS` in
  `icon()`; `shoppingCart` und `wallet` prüfen und entfernen, falls ungenutzt.
- `server/public/css/style.css` — `.food-order-cart*` entfernen; `.food-order-card-toolbar`,
  `.food-order-group-*`, `.food-order-item-*`, `.food-order-add-button` anpassen.
- `server/public/js/app.js` — `focusPendingSearchTarget()` für den Ausklapp-Zustand statt
  `HTMLDetailsElement`.
- `server/src/routes/foodOrders.ts` — Push-URL mit Bestell-ID.
- `server/src/test/e2e/flows.fixture.ts` und die Essen-Tests — Korb-Pfade durch die neuen
  Bezahl- und Markierungspfade ersetzen.
- `server/DESIGN_SYSTEM.md` — Abschnitt „Food orders“ im selben PR nachziehen.

## Tests

- Positionsweises Bezahlen: Happy Path, Abbruch über „Noch nicht“, inzwischen anderswo bezahlt,
  inzwischen gelöscht, Bestellung ohne PayPal-Link.
- Personenweises Bezahlen: dieselben Fälle mit mehreren Positionen, plus „eine der Positionen ist
  inzwischen bezahlt“ (Teilmenge wird übergeben, Meldung nennt die tatsächliche Zahl).
- Personenmarke: vorwärts aus „Offen“ und aus „Teilweise“, rückwärts aus „Bezahlt“ mit Rückfrage,
  Abbruch, gesperrt bei geschlossener Bestellung.
- Gruppen-Löschen: Happy Path über alle eigenen Positionen, Abbruch im Dialog, gesperrt sobald eine
  Position bezahlt ist, nicht vorhanden an fremden Gruppen, Teil-Fehlschlag beim parallelen Löschen
  (Cache verwerfen und neu laden).
- Klapp-Zustand: mehrere offene Bestellungen starten zu, Direktlink klappt genau eine auf, ein
  Realtime-Rerender ändert den Zustand nicht, eine einzige offene Bestellung hat keine Klapp-Hülle.
- Bestellliste: für eine Person, die weder Aufgeberin noch Admin ist, erreichbar.

## Offene Entscheidungen

- **Zurückdrehen an der Personenmarke.** Der Auftrag sagt „auf bezahlt oder offen setzen“, also ein
  echter Umschalter; so ist es hier beschrieben, mit Rückfrage und Namensnennung. Alternative wäre
  „nur vorwärts“, Zurückdrehen bleibt Sache der einzelnen Zeile. **Vorschlag: Umschalter mit
  Rückfrage.**
- **Bezahlen an der Gesamtsumme der Bestellung.** Technisch dieselbe Mechanik, hieße aber „ich zahle
  für alle“ und macht das Abhaken für alle anderen unbrauchbar. **Vorschlag: nein**, dort bleibt es
  bei Kopieren.
- **Gefülltes Markenglyph im Strich-Icon-Satz.** Das offizielle PayPal-Monogramm ist eine Fläche und
  fällt neben den 88 Strichsymbolen auf. Genau das macht es an einem Bezahlen-Knopf erkennbar, es
  bleibt aber eine bewusste Ausnahme in einem bisher einheitlichen Satz. **Vorschlag: Ausnahme
  zulassen**, begrenzt auf Markenglyphen.
- **Löschen einer Gruppe mit bezahlten Positionen.** Der Sammelweg ist gesperrt, sobald eine Position
  bezahlt ist; man muss dann erst die Marke zurückdrehen. Alternative wäre, bezahlte Positionen
  stehen zu lassen und nur den Rest zu löschen — das hinterlässt aber eine Gruppe, die nach dem
  „alles löschen“ noch da ist. **Vorschlag: gesperrt lassen.**
- **Startregel für den Aufgeber** innerhalb einer aufgeklappten Bestellung bleibt „alle Gruppen
  offen“. Bei fünf Bestellern ist das die längste Liste ausgerechnet für den, der die Übersicht
  braucht — „Alle einklappen“ steht jetzt links direkt daneben. **Vorschlag: unverändert lassen.**
