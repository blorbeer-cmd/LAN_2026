# EmptyState

## 1. Status und Zweck

Status: `umgesetzt`.

EmptyState erzeugt sichere, knappe Leer-, Lade- und Fehlerzustände. Er unterstützt einfachen
Klartext sowie eine strukturierte Form mit etablierter Illustration oder direkter
Wiederherstellungsaktion. Er ist kein allgemeiner HTML-Container und führt keine fachliche Aktion
selbst aus.

## 2. Quelle

- Markup: `public/js/emptyState.js`
- Basisdarstellung: `public/css/style.css`
- API für Klartext:
  `emptyStateHtml(text, { className, style })`
- Strukturierte API:
  `emptyStateHtml({ text, illustration, action, className, style })`
- `illustration`: `{ src, alt, width, height, className }`
- `action`: `{ id, navigate, label, className }`

Text, Bildattribute, Klassen, Inline-Style und Aktionsattribute werden escaped. `style` und
`className` bleiben reale Schnittstellen. Paket 5 inventarisiert ihre Aufrufer statisch:
geschützte Innenwerte gehören in registrierte Besitzerklassen; reine Außenabstände bleiben beim Aufrufer.

## 3. CSS-Eigentümerschaft

`public/css/style.css` besitzt `.empty-state`, `.empty-state-structured` und
`.empty-state-actions`. Die Basisgeometrie einer Recovery-Aktion stammt aus dem
[Controls-Vertrag](controls.md). Domänen-CSS DARF nur äußere Platzierung oder eine bereits
etablierte, über `className` gesetzte Kontextklasse besitzen; es DARF den Komponenteninhalt nicht
als zweite EmptyState-Implementierung nachbauen.

## 4. Varianten

| Variante | API | Status | Bedeutung |
|---|---|---|---|
| Escaped Klartext | `emptyStateHtml(text, presentation)` | umgesetzt | knapper Lade-, Fehler- oder Leertext |
| Strukturierter Text | `emptyStateHtml({ text })` | umgesetzt | explizites strukturiertes Layout ohne Roh-HTML |
| Etablierte Illustration | `illustration` | umgesetzt | vorhandene, ausdrücklich dokumentierte Markenillustration |
| Direkte Recovery-Aktion | `action` | umgesetzt | ein echter Button direkt im Leerzustand |
| Registrierte Präsentation | `className`, `style` | umgesetzt | Registry-Klasse oder reine äußere Platzierung; keine aufrufereigenen Innenwerte |

Dekorative Icons und beliebiges Body-HTML sind keine Varianten.

## 5. Erlaubte Anpassungen

- Aufrufer DÜRFEN kurzen Klartext oder strukturierten Text festlegen.
- Eine Illustration DARF nur eine bereits etablierte und dokumentierte Markenillustration sein.
- Eine direkte Aktion DARF ID, Navigationsziel, Label und eine vorhandene Buttonkombination
  erhalten. Ohne `className` gilt `btn btn-primary btn-sm`.
- `className` DARF registrierte Präsentationsklassen kombinieren. `style` DARF ausschließlich
  aufrufereigene Außenplatzierung enthalten; geschützte Innenwerte werden vom Paket-5-Check abgewiesen.
- Aufrufer besitzen Aktionseffekt und Eventverdrahtung.

## 6. Komponenteneigene Invarianten

- Jeder sichtbare Text und jedes Attribut aus der API MUSS escaped werden; Roh-HTML wird nicht
  interpretiert.
- Standardzustände verwenden eine kurze, regulär gewichtete Textzeile. Kontext kommt aus
  benachbarter Überschrift und Controls statt aus wiederholter Erklärung.
- „Noch keine …“ bezeichnet eine unbenutzte Sammlung, „Keine … gefunden“ ein gefiltertes
  Ergebnis. Fachqualifizierungen gehören in den umgebenden Bereich.
- EmptyStates besitzen keine dekorativen Icons. Die Home-Maskottchenillustration ist die
  etablierte Markenausnahme.
- Die strukturierte Form ordnet Illustration, Text und Aktion zentriert mit dem gemeinsamen
  Abstand an.
- Die Default-Recovery-Aktion MUSS einzeilig 31–33 px hoch sein. Ein echter Textumbruch DARF die
  Border-Box über 33 px wachsen lassen und MUSS vollständig ohne Clipping sichtbar bleiben.
- Fehlende Illustration oder fehlendes Aktionslabel erzeugt kein leeres Element.

Registry-Bezüge für die Recovery-Aktion: `button`, `button-small`, `button-meaning` und optional
`button-width` in [component-registry.mjs](../component-registry.mjs).

## 7. Erreichbare Zustände

- kurzer Lade-, Leer- oder Fehlertext;
- gefilterter Kein-Treffer-Text;
- strukturierter Text ohne Zusatz;
- strukturierter Text mit etablierter Illustration;
- strukturierter Text mit direkter Recovery-Aktion;
- strukturierter Text mit Illustration und Aktion;
- langes Aktionslabel mit echtem Umbruch;
- bestehende Kontextklasse oder tokenbasiertes Legacy-Inline-Style.

## 8. Accessibility

- Inhalt bleibt normaler lesbarer Text und wird nicht durch einen dekorativen Symbolnamen
  ersetzt.
- Illustrationen MÜSSEN einen zutreffenden Alternativtext erhalten; rein dekorative etablierte
  Markenillustrationen verwenden `alt=""`.
- Recovery ist ein echtes `button` mit vollständigem sichtbarem und zugänglichem Label.
- Dynamische Aufrufer DÜRFEN den umgebenden Bereich als Status-/Live-Region führen; der Helper
  erzwingt keine pauschale Ansage jedes Re-Renders.
- Fokusdarstellung und Controlgeometrie der Aktion folgen dem Controls-Vertrag.

## 9. Repräsentative Aufrufer

- Strukturiert mit etablierter Illustration und Aktion: `public/js/views/home.js`
- Klartext und Kontextklassen: `public/js/views/votes.js`, `tournament.js` und `hallOfFame.js`
- Klartext in schmalen sowie breiten Bereichen: `public/js/views/eventPolls.js`,
  `foodOrders.js`, `gameCatalog.js` und Arcade-Views

## 10. Prüfungen und Abnahmebeispiele

- `public/js/emptyState.test.js` prüft Klartextescaping, strukturierte Inhalte,
  Bildattribute, Legacy-`className`/`style` und die Default-Buttonklasse.
- `src/test/e2e/flowsShell.fixture.ts` prüft die Default-Recovery-Aktion bei 320×568, 390×844,
  512×384, 640 px, 720×450 und Desktop: einzeilig 31–33 px, langes Label wachsend und ohne
  Clipping, kein horizontaler Seitenoverflow, sichtbarer Tastaturfokus.
- Reale Core- und Arcade-Flows prüfen erreichbare Klartext-, Lade-, Such- und
  Illustrationszustände. Isolierte Testdaten dürfen keinen produktiven Leerzustand fälschen.

## 11. Permanente Varianten und befristete Ausnahmen

Die etablierte Home-Illustration und die direkte Recovery-Aktion sind permanente Varianten.
Recovery verwendet die Registry-IDs `button`, `button-small`, `button-meaning` und gegebenenfalls
`button-width`; sie besitzt keine eigene Controlgeometrie. `style` und `className` bleiben reale
Schnittstellen. Paket 5 hat jeden tatsächlichen Präsentationsaufrufer klassifiziert und nur
geschützte Inline-Innenwerte in die unten referenzierten Besitzerklassen übertragen. Bestehende
Kontextklassen und die drei reinen Außenabstände bleiben erhalten. Die vollständige Einzelspur
steht im [Paket-5-Inventar](../evidence/package-5-baseline.tsv). Es gibt keine befristete EmptyState-Ausnahme.

- `registry:empty-state`: Shared empty-state text, structure and recovery layout.

- `registry:empty-state-compact`: Preserves the individually inventoried 16px padding of shallow loading/result slots.

- `registry:empty-state-food-items`: Preserves small copy and vertical spacing in the empty food-position list.

- `registry:empty-state-kiosk-loading`: Preserves the TV loading canvas inset.

- `registry:empty-state-vote`: Centered result/history slot in Vote.

- `registry:empty-state-tournament`: Stable tournament collection empty slot.

- `registry:empty-state-hall-of-fame`: Hall-of-Fame result slot spans the result layout.

- `registry:empty-state-arrivals`: Empty arrival collection occupies the carpool grid.

- `registry:empty-state-notifications`: Shared empty/loading/error slot inside the notification panel.

- `registry:empty-state-music`: Centered current-playback placeholder.

- `registry:empty-state-kiosk`: TV vote placeholders fill their existing dashboard region.
