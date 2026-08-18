# Plan: Essensbestellung als Warenkorb

## Ziel und Zuschnitt

Die Sammelbestellung wird von „Sammelzahlung“ auf eine Warenkorb-Logik umgestellt: Positionen werden
in einen Warenkorb gelegt, dort gemeinsam bezahlt und im Ganzen als bezahlt abgehakt. Dazu kommen
die Rückfragen, die dieser Ablauf braucht, ausklappbare Besteller-Gruppen und eine konsolidierte
Bestellliste für die Person, die die Bestellung aufgibt.

Das Konzept wurde in vier Runden mit dem Nutzer erarbeitet und in zwei interaktiven Mockups
festgehalten. Dieser Plan ist die verbindliche, selbsttragende Fassung: Er nennt alle Entscheidungen
und Anforderungen im Volltext, damit eine Umsetzung ohne die Mockups auskommt.

- Aktueller Stand (Runde 4, verbindlich):
  <https://claude.ai/code/artifact/82b98e9a-bd73-4af5-9dd1-a1bff7ef2154>
- Vorstufe (Runde 3, teilweise überholt):
  <https://claude.ai/code/artifact/e618e65b-6b21-4d73-9857-26c61285d12f>

Der Umbau wird in vier aufeinander aufbauenden Pull Requests umgesetzt. Jedes Arbeitspaket ist für
sich lauffähig, einzeln reviewbar und einzeln abbrechbar. Jedes bekommt einen eigenen Branch, einen
eigenen Worktree und eine eigene Session.

## Ausgangslage

`main` enthält seit `16f7c33` den gemergten PR #444 („Rework food order position row“). Daraus
bleibt unverändert bestehen und darf nicht versehentlich zurückgebaut werden:

- der synchron im Klick geöffnete PayPal-Tab mit anschließend gesetztem `popup.opener = null`
  (Popup-Blocking auf Safari/iOS),
- die Staleness-Prüfung unmittelbar vor dem Öffnen: erneuter `api.foodOrders.list()`-Abruf, Abbruch
  mit Meldung, wenn Bestellung oder Position verschwunden ist oder inzwischen woanders als bezahlt
  markiert wurde, samt `ctx.rerender()` in **allen** Zweigen,
- „bezahlte Position ist gesperrt“ und „als bezahlt markieren entfernt die Auswahl“,
- die einzeilige Positionszeile und der Mülleimer statt des blanken X,
- der E2E-Test, dessen `window.open`-Stub `null` zurückgibt, wenn `'noopener'` übergeben wird.

Überholt sind ausschließlich Anordnung, Bildsprache und Wortwahl der Zeile sowie der Bezahlen-Knopf
an der einzelnen Position.

## Leitentscheidungen

1. **Ein Bezahlweg.** Bezahlt wird ausschließlich über den Warenkorb. Der Bezahlen-Knopf an der
   einzelnen Position entfällt, ein Bezahlen-Knopf im Gruppenkopf kommt nicht. Damit gibt es genau
   eine Stelle mit Popup-Handling, Staleness-Prüfung, Rückfrage und Test.
2. **Anordnung der Zeile:** `Bezahlt-Marke │ Menge × Bezeichnung │ Betrag │ Kopieren ┊ Warenkorb │
   Löschen`. Der Zustand steht vorne, Kopieren gehört an den Betrag (es kopiert genau ihn), eine
   Haarlinie trennt davon die beiden Aktionen, die die Zeile verändern; Löschen bleibt außen.
3. **Bildsprache:** `shoppingCart` für den Warenkorb (schlicht, weil der Knopf in beide Richtungen
   schaltet — kein `cartPlus`), `wallet` für den Bezahlen-Knopf des Warenkorbs (PayPal ist keine
   Kartenzahlung), `trash`, `copy`, `check`/`circleDashed` für den Bezahlt-Zustand unverändert.
   Keine Währungssymbole als Icon: neben „12,50 €“ sagt ein €-Icon dasselbe zweimal, ein $-Icon
   liest sich im Euro-Kontext als Währungswechsel. Beträge bleiben in Euro.
4. **Wortwahl:** „Warenkorb“ statt „Sammelzahlung“ in Text, Tooltip, `aria-label` und Design System.
   Der Knopf heißt „Bezahlen · <Summe>“, nicht „Zur Kasse“ — der Klick öffnet direkt PayPal.
5. **Gruppen in Stufen:** Stufe 1 (Klappen + Warenkorb je Gruppe) wird gebaut, Stufe 2 (Bezahlt je
   Gruppe) zurückgestellt, Stufe 3 (Bezahlen und Löschen je Gruppe) verworfen.
6. **Rückfragen sparsam:** genau drei Dialoge (siehe AP 2). Herausnehmen aus dem Korb, Abhaken einer
   einzelnen Position und Kopieren bleiben ohne Nachfrage — sie sind mit einem Tipp umkehrbar.
7. **Texte auf das Nötigste.** Beschriftungen tragen Information oder entfallen. Erklärsätze im
   Warenkorb, Wiederholungen der Metapher und Hinweise, die sich aus der Darstellung ergeben, werden
   nicht geschrieben. Tooltips und `aria-label` bleiben davon unberührt, sie sind die
   Barrierefreiheits-Ebene und dürfen ausführlicher sein als der sichtbare Text.

## Arbeitspaket 1 — Zeile und Warenkorb

Rein visuell und sprachlich, keine neue Logik. Kleinster und risikoärmster Schritt.

- **AP1.1 Anordnung** wie in Leitentscheidung 2. Auf Handybreite bricht der Betragsblock wie bisher
  auf eine eigene Zeile um; die Aktionen wandern gemeinsam mit.
- **AP1.2 Betrag ist Anzeige, kein Knopf.** Die Zeile zeigt den zahlbaren Betrag als Text, darunter
  klein „inkl. <x> % Trinkgeld“. Der Hinweis muss bleiben: ohne ihn passt die Zahl nicht zum Preis
  auf der Speisekarte. Ohne Trinkgeld entfällt die Zeile.
- **AP1.3 Bezahlt-Marke** links: im Zustand „bezahlt“ grün mit Haken und Wort „Bezahlt“, im offenen
  Zustand nur der gestrichelte Kreis ohne Wort. Sie bleibt auch auf einer gesperrten Zeile bedienbar
  — sie ist der einzige Weg zurück.
- **AP1.4 Warenkorb-Knopf** je Zeile mit `aria-pressed`; aktiver Zustand über Akzentring plus die
  bestehende Akzentschiene an der Zeile.
- **AP1.5 Warenkorb-Kasten**: Kopf „Warenkorb“ mit Anzahl-Badge, darunter die Positionen mit
  Farbpunkt und Namen des ursprünglichen Bestellers, Summenzeile „Summe“, Knopf „Bezahlen ·
  <Summe>“. Jede Korbzeile bekommt ein eigenes X zum Herausnehmen. Kein erklärender Untertitel. Der
  Kasten erscheint weiterhin erst, wenn etwas drin liegt.
- **AP1.6 Besteller in der Liste** bleibt wie heute die Gruppierung aus `itemsGroupedByPlayer()`
  (Farbpunkt, Name, eingerückte Positionen; auf schmalen Geräten ohne Einrückung).
- **AP1.7 Icons**: `shoppingCart` und `wallet` in `icons.js` ergänzen. `creditCard` prüfen und
  entfernen, falls durch diesen Umbau ungenutzt.

## Arbeitspaket 2 — Rückfragen und Sammel-Markierung

Hier liegt die Logik. Alle Dialoge nutzen die bestehende Struktur aus `server/public/js/modal.js`
(`confirmDialog` bzw. `openModal` für die Variante mit Positionsliste): Titel, ein Satz, Abbrechen
links, Bestätigen rechts, Fokus startet auf der harmlosen Seite, Escape bricht ab.

- **AP2.1 „Alle als bezahlt“** im Warenkorb: markiert alle Positionen im Korb als bezahlt, hebt ihre
  Korb-Markierung auf; der Korb ist danach leer und verschwindet. Betrifft ausschließlich Positionen
  im Korb, nie die ganze Bestellung. Positionen, die zwischenzeitlich anderswo als bezahlt markiert
  wurden, werden übersprungen statt doppelt markiert; die Meldung nennt die Zahl der tatsächlich
  geänderten Positionen.
- **AP2.2 Rückfrage „Bezahlt?“** nach jedem Bezahlen-Klick, unmittelbar nachdem der PayPal-Tab
  geöffnet wurde. Text: „<Summe> für <n> Positionen an PayPal übergeben.“ plus die Liste mit
  Besteller. „Ja, bezahlt“ markiert alle Positionen des Korbs als bezahlt und leert ihn; „Noch
  nicht“, Escape und Klick daneben ändern nichts. Keine Erfolgsmeldung behaupten — Respawn bekommt
  von PayPal keine Rückmeldung.
- **AP2.3 Rückfrage vor der Sammel-Markierung**: „<n> Positionen · <Summe>. Der Warenkorb wird
  geleert.“ plus Liste. Bestätigen blau, nicht rot: umkehrbar durch erneutes Abhaken.
- **AP2.4 Rückfrage vor dem Löschen**: Titel „<Menge> × <Bezeichnung> löschen?“, Text „Lässt sich
  nicht rückgängig machen.“, Bestätigen rot (`btn-danger`). Für bezahlte Positionen erscheint der
  Dialog nicht, sie bleiben gesperrt.
- **AP2.5 Server-Kontrakt**: Die Sammel-Markierung nutzt weiterhin `PATCH
  /api/food-orders/:id/items/:itemId` je Position (`Promise.all`, bei Teil-Fehlschlag Cache
  verwerfen und neu laden). Ein Bulk-Endpunkt wird nicht eingeführt, solange die Größenordnung bei
  wenigen Positionen liegt.
- **AP2.6 Tests**: Happy Path, Abbruch über „Noch nicht“, bereits anderswo bezahlte Position beim
  Bestätigen, gelöschte Position beim Bestätigen, Löschen-Rückfrage abgebrochen und bestätigt.

## Arbeitspaket 3 — Besteller-Gruppen, Stufe 1

- **AP3.1 Klappen**: Jede Besteller-Gruppe ist auf- und zuklappbar. Die Kopfzeile ist ein Container:
  links ein Button mit `aria-expanded` für Chevron, Farbpunkt, Name und Meta-Zeile, rechts Betrag
  und Aktionen als Geschwister — kein Knopf im Knopf.
- **AP3.2 Kopf zeigt den offenen Betrag**: die Summe der noch nicht bezahlten Positionen dieser
  Person inklusive Trinkgeld — genau der Betrag, den der Korb-Knopf übernimmt. Die Gesamtsumme der
  Person steht nicht im Kopf; sie ist aus den Zeilen ablesbar, die Bestellsumme steht im Kartenkopf.
- **AP3.3 Bei 0 € übernimmt der Zustand**: Sind alle Positionen bezahlt, steht statt „0,00 €“ die
  grüne Bezahlt-Marke, der Korb-Knopf ist gesperrt. Das ist kein Automatismus, der etwas speichert:
  Der Gruppen-Zustand wird aus den Positionen abgeleitet — kein Feld, kein Schreibvorgang.
- **AP3.4 Meta-Zeile knapp**: „<n> Positionen · <n> bezahlt · <n> im Korb“, die letzten beiden Teile
  nur, wenn sie zutreffen.
- **AP3.5 Warenkorb je Gruppe**: ein Knopf mit drei Zuständen (keine / einige / alle offenen
  Positionen im Korb). Klick im gemischten Zustand legt den Rest dazu, im Zustand „alle“ nimmt er
  alle heraus. Symmetrisch erlaubt, weil der Korb unverbindlich ist.
- **AP3.6 Startregel**: Beim ersten Rendern einer Bestellung ist die eigene Gruppe offen, die
  übrigen zugeklappt; für die erstellende Person sind alle offen. Vollständig bezahlte Gruppen
  starten zugeklappt. Zusätzlich ein Schalter „Alle ausklappen/einklappen“ im Kartenkopf.
- **AP3.7 Die Regel gilt genau einmal** je Bestellung und Sitzung. Danach gehört der Zustand dem
  Nutzer. Ablage wie `selectedForPayment`: Modul-Variable je Bestellung, nicht persistiert. Wird die
  Regel bei jedem Realtime-Rerender erneut angewendet, klappt sie dem Nutzer Gruppen zu, während
  jemand anders eine Position einträgt.
- **AP3.8 Nach dem Hinzufügen** einer eigenen Position wird die eigene Gruppe zwingend aufgeklappt.
- **AP3.9 Keine Klapp-Hülle**, wenn die Bestellung nur eine einzige Gruppe hat.
- **AP3.10 Nichts klappt live zu**, wenn die letzte Position einer Gruppe bezahlt wird. Ein
  Layoutsprung mitten im Tippen ist schlimmer als eine Zeile zu viel.
- **AP3.11 Farbebenen trennen**: Die Akzentschiene bleibt den Positionszeilen vorbehalten; die
  Gruppe zeigt ihren offenen Zustand über dezenten Rahmen und Hintergrund, gemischte Sammel-Zustände
  über einen Punkt am Icon bzw. Bernstein statt Blau.

Stufe 2 (Bezahlt-Marke im Gruppenkopf) ist ausdrücklich **nicht** Teil dieses Arbeitspakets. Falls
sie später kommt: nur vorwärts wirkend (markiert alle offenen Positionen, gesperrt wenn alles
bezahlt ist), mit derselben Rückfrage wie AP2.3. Ein Umschalter würde sonst im Zustand „alles
bezahlt“ fremde, längst erledigte Zahlungen zurückdrehen.

## Arbeitspaket 4 — Konsolidierte Bestellliste

- **AP4.1 Zugang**: Knopf „Bestellliste“ im Kartenkopf, sichtbar für die erstellende Person und für
  Admins; für alle anderen existiert er nicht. Auch bei geschlossener Bestellung erreichbar — vor
  dem Aufgeben zum Abtippen, danach zum Abgleichen der Lieferung.
- **AP4.2 Zusammenfassung**: Schlüssel ist die normalisierte Bezeichnung (Mehrfach-Leerzeichen
  zusammengefasst, Groß-/Kleinschreibung egal) plus Einzelpreis. Gleiche Bezeichnung mit
  abweichendem Einzelpreis bleibt eine eigene, als solche markierte Zeile — sonst stimmt die Summe
  nicht. Positionen ohne Preis erscheinen mit „kein Preis“ und fehlen in der Zwischensumme, die
  dafür als unvollständig gekennzeichnet wird.
- **AP4.3 Inhalt je Zeile**: Menge, Bezeichnung, Einzelpreis, Zeilensumme. Keine Namen, keine
  Bezahlt-Zustände, keine Warenkorb-Markierungen.
- **AP4.4 Sortierung** alphabetisch mit `localeCompare('de')`, damit Umlaute dort stehen, wo man sie
  sucht.
- **AP4.5 Trinkgeld getrennt**: Die Zeilen zeigen die reinen Preise. Darunter Zwischensumme, „+ <x>
  % Trinkgeld“, Gesamt. Trinkgeldhaltige Einzelpreise wären in einer Liste zum Abtippen schlicht
  falsch.
- **AP4.6 Kopieren** legt die Liste als einfachen Text in die Zwischenablage: Titel, je Zeile „2 ×
  Margherita“, darunter die Summen. Das ist der eigentliche Anwendungsfall — einfügen ins
  Bestellformular, in eine Telefonnotiz oder in den Gruppenchat.
- **AP4.7 Offene Bestellung** wird benannt („Bestellung ist noch offen.“) und kann direkt aus dem
  Dialog geschlossen werden. Die Liste aktualisiert sich, während der Dialog offen ist; eine
  eingefrorene Liste wäre die gefährlichere Variante.

## Verbindliche Randbedingungen

- Die Bezahl-Härtung aus #444 bleibt vollständig erhalten (siehe Ausgangslage). Wer den
  Bezahlen-Knopf verschiebt, verschiebt den Handler mit — er wird nicht neu geschrieben.
- Zustände nie allein über Farbe: Tooltip und `aria-label` benennen den aktuellen Zustand und die
  Wirkung des Klicks.
- Alle Tippziele bleiben bei mindestens 32 px, die bestehenden Abstands-, Farb- und Typo-Token
  werden verwendet; `npm run check:tokens` muss grün bleiben.
- Neue und geänderte Logik bekommt Tests für Happy Path, Validierungsfehler und Zustandskonflikte.
  Der Essensbestellung-E2E-Test wird je Arbeitspaket mitgeführt, nicht am Ende nachgezogen.
- `server/DESIGN_SYSTEM.md` wird im selben PR nachgezogen, in dem sich die Komponente ändert.
- Sichtbare UI-Änderungen: Prüfhinweis mit Branch, PR-Link und konkreten Prüfschritten an den
  Nutzer, sobald der Branch prüfbar ist.

## Betroffene Stellen

- `server/public/js/views/foodOrders.js` — `renderItems()`, `renderPaymentSelector()`,
  `renderOrderSummary()`, `itemsGroupedByPlayer()`, der `[data-pay-order]`-Handler und
  `[data-mark-selected-paid]`.
- `server/public/js/icons.js` — `shoppingCart`, `wallet` ergänzen; `creditCard` prüfen.
- `server/public/css/style.css` — `.food-order-*`; neu: Gruppen-Kopf, Klapp-Zustand, Korbzeilen.
- `server/public/js/modal.js` — bestehende Dialoge wiederverwenden, keine neue Komponente.
- `server/src/test/e2e/flows.fixture.ts` — Essensbestellung-Flow je Arbeitspaket erweitern.
- `server/DESIGN_SYSTEM.md` — Positionszeile, Warenkorb, Gruppen, Bestellliste.

## Offene Entscheidungen

- **Startregel für die erstellende Person.** Festgelegt ist „alle offen“. Ab etwa fünf Bestellern
  bekommt damit ausgerechnet die Person die längste Liste, die eher die Übersicht braucht. Der
  Schalter im Kartenkopf entschärft das; bei Beschwerden auf „alle zu außer der eigenen“ umstellen.
- **Bezahlt-Marke auf Handybreite.** Die Marke mit Wort kostet Breite. Falls die Bezeichnung dort zu
  stark gedrängt wird, auf die reine Icon-Form umstellen — Bedeutung bleibt über Tooltip und
  `aria-label` erhalten.
- **Stufe 2 der Gruppen** (Bezahlt je Gruppe) wird erst gebaut, wenn sich im Betrieb zeigt, dass
  Leute regelmäßig alles von einer Person auf einmal abhaken wollen.
