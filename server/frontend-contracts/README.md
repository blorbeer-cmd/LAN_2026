# Frontend-Komponentenverträge

Dieser Index trennt drei normative Zuständigkeiten:

- [Designkern](../DESIGN_SYSTEM.md): globale Prinzipien, Tokenquellen, kurze Komponenten-
  Kernregeln und Accessibility.
- Komponentenverträge in [`components/`](components/): API, Innengeometrie, Interaktion,
  Komponenten-Accessibility und Varianten.
- [Produktregeln](../../docs/product/README.md): Routen, Rollen, Geschäftsabläufe, Fachtexte
  und Fachzustände.

Vor Änderungen an einem Helper, einer Klasse oder einem Control zuerst den Designkern lesen und
anschließend nur die betroffenen Komponentenverträge und Produktregeldateien vollständig lesen.

Control-Selektoren und ihre Zuordnung stehen in der reinen
[Registry](component-registry.mjs); der Index referenziert deren IDs.

| Helper/Registry-ID | Vertrag | CSS-Eigentümer |
|---|---|---|
| `button`, `button-small`, `button-meaning`, `button-width` | [Controls](components/controls.md) | `public/css/style.css` |
| `native-fields` | [Controls](components/controls.md) | `public/css/style.css` |
| `icon-button`, `button-square`, `selection-toolbar` | [Controls](components/controls.md) | `public/css/style.css` |
| `arcade-segment` | [Controls](components/controls.md) | `public/css/arcade.css` |
| `action-menu-trigger`, `action-menu-entry` | [Controls](components/controls.md) | `public/css/style.css` |
| `number-stepper` | [Controls](components/controls.md) | `public/css/style.css` |
| `data-row-action` | [Controls](components/controls.md) | `public/css/domains.css` |
| `rosterPicker.js` | [RosterPicker](components/roster-picker.md) | `public/css/style.css`, `public/css/domains.css` |
| `selectionSearch.js` | [SelectionSearch](components/selection-search.md) | `public/css/style.css` |
| `modal.js` | [Modal](components/modal.md) | `public/css/overlays.css`; etablierte Präsentationsmodifier in `public/css/style.css` |
| `dateTimeField.js` | [DateTimeField](components/date-time-field.md) | `public/css/style.css`; Modalgrenze in `public/css/overlays.css` |
| `emptyState.js` | [EmptyState](components/empty-state.md) | `public/css/style.css` |
| `actionMenu.js` | [ActionMenu](components/action-menu.md) | `public/css/style.css`; bestehende Kartenlage in `public/css/domains.css` |

Neue Komponenten oder Varianten verwenden
[`_contract-template.md`](_contract-template.md). Vertrag, repräsentatives Beispiel und
Regressionstest entstehen im selben Änderungspaket.

## Snapshot-Komponentencheck (Paket 5)

Aus `server/`: `npm run check:components` liest standardmäßig `--staged` aus dem Git-Index.
`npm run check:components -- --head` liest den Commitbaum; `--json` liefert den vollständigen
maschinenlesbaren Bericht. Es gibt keinen Arbeitsbaummodus und keinen Fallback auf ungestagte
Dateien. Auch Registry und Vertragsanker stammen aus demselben Snapshot. Der Check liest die
Blob-IDs einmal aus Index beziehungsweise HEAD und lädt anschließend genau diese Objekte.

`npm test` führt die Fixtures und eine schreibgeschützte `--staged`-Prüfung des Repositorys aus.
Im frischen CI-Checkout entspricht der Index dem HEAD; lokal bleiben ungestagte Änderungen bewusst
außerhalb dieser Prüfung. Tests mit veränderten Snapshots verwenden ausschließlich temporäre
Repositories und räumen diese in `finally` vollständig auf. Vor einem Commit eigene Dateien
stagen, `--staged` ausführen und nach dem Commit `--head` mit demselben Bericht vergleichen.

Der klammerbewusste CSS-Leser verarbeitet ausschließlich `style.css`, `domains.css`, `arcade.css`,
`overlays.css` und `kiosk.css` unter `public/css/`. Kommentare, Strings, Selektorlisten,
Funktions-/Attributklammern und verschachtelte At-Rules werden getrennt gelesen. Pro Selektor
entscheidet das Subjekt-Compound; ein Control nur in einem Vorfahren oder `:has`-Argument macht
einen fremden Nachfahren nicht zum Control. Interne SVG-/`ui-icon`-Maße werden zusätzlich dem
Control zugeordnet. Kontextregeln benötigen einen exakten permanenten Selektor oder eine exakte
befristete Ausnahme. Optionale `properties` begrenzen eine Variante auf ihre dokumentierten
Eigenschaften. Der Check simuliert weder DOM noch Kaskade, Spezifität, Layout oder Tokenwerte.

Das JavaScript-Inventar nutzt den bereits vorhandenen TypeScript-Parser ohne Codeausführung. Es
liest literales HTML-/Template-Markup in `public/js/**/*.js` einschließlich `views/`, Klassen an
nativen Controls sowie Zusatzklassen neben `btn`/`icon-btn`, statische Inline-Style-Eigenschaften,
direkte `.style.property`-/`.style['property']`-Zuweisungen und `style.setProperty('property', ...)`.
Literal erkennbare Buttonmodifier werden auch in einzelnen Klassenstrings geprüft. Werte dürfen
dynamisch sein, solange der Eigenschaftsname literal ist. Nicht auflösbare Klassenteile, Tags und
Eigenschaftsnamen werden als Erkennungsgrenzen ausgegeben, nicht geraten. Komplexe Datenflüsse,
beliebige DOM-APIs und zur Laufzeit erzeugtes HTML sind keine Browseremulation. Ein real benötigter
dynamischer Klassenaufruf wird über `dynamicUses` mit exakter Quelldatei, Templatefragment und
Begründung belegt; fehlende Control-Zuordnungen und entfernte Belege schlagen fehl. Die Registry
belegt die 63 vorhandenen dynamischen Control-Klassenaufrufe ausdrücklich, einschließlich
DateTime-Kalendertagen, Tooltip-Triggern und der EmptyState-Aktion. `calls` bindet exakte Datei/Aufruf/Eigenschaft/
Wert-Tupel an einen Besitzer, etwa den nichtinteraktiven Onboarding-Markierungsring. Auch einzelne
entfernte Call-Bindings schlagen fehl. `control: false` kennzeichnet Container, Zustandsmarker und
nichtinteraktive Teile; eine literal an einem Control verwendete Klasse bleibt trotzdem im Check.
Test-Fixtures unter `public/js/` stehen im Inventar, werden jedoch als statische Fehlkandidaten
klassifiziert, weil sie keine Anwendung aufrufen.

`component-registry.mjs` bleibt die einzige maschinenlesbare Registry und enthält ausschließlich
literale Daten. Jeder permanente Eintrag besitzt genau einen ausdrücklichen Eigentumsbezug
`registry:<ID>` im angegebenen Vertrag. Normale Querverweise auf gemeinsame Controls beanspruchen
keine zweite Eigentümerschaft. Fehlende Anker, doppelte IDs, fehlende Eigentümerdateien, unbekannte
Referenzen und stale/nicht referenzierte Einträge sind Fehler. Befristete Ausnahmen benötigen
Datei, exakten Selektor oder Aufrufschlüssel, Eigenschaft, Grund, konkreten Befund, Zielpaket und
Löschkriterium; ein optionaler Wert macht den Treffer zusätzlich wertgenau.

Kandidaten und Vertragsverstöße sind getrennt: Geometrie zählt je Deklaration ausschließlich
`width`, `height`, `min-width`, `max-width`, `min-height`, `max-height` mit eigenem literalem
`px`-Wert, auch neben `calc()`/`var()`. Farbe zählt je Deklaration mit `rgba(` im Wert.
Custom-Property-Definitionen und At-Rule-Präambeln zählen nicht. Nur ein CSS-Kommentar mit
`design-token-ok: <konkreter Grund>` auf derselben Deklarationszeile unterdrückt den zugehörigen
Kandidaten; er erteilt keine Komponentenfreigabe. Die Ausgabe sortiert stabil nach Datei, Zeile,
Eigenschaft und Wert. Kandidaten allein setzen keinen Fehlerstatus: Exit 0 bedeutet keine
Verstöße/Registrydiagnosen, Exit 1 bezeichnet solche Befunde, Exit 2 einen ungültigen oder nicht
lesbaren Snapshot beziehungsweise Aufruf. Die historischen 83/36 sind kein Sollwert.

Ausgangs- und Abschlussinventar sowie Fixzuordnung stehen unter [evidence/](evidence/README.md).
Paket 5b ist nicht umgesetzt; `.githooks/pre-commit` bleibt unverändert.
