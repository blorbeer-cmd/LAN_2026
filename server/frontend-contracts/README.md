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
