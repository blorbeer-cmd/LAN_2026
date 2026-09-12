# Frontend-Komponentenverträge

Dieser Index ordnet Frontend-Helper und CSS-Komponenten ihrer normativen Vertragsdatei und ihrem
CSS-Eigentümer zu. Vor Änderungen an einem Helper, einer Klasse oder einem Control zuerst den
zugehörigen Vertrag vollständig lesen. Der Designkern bleibt in
[`DESIGN_SYSTEM.md`](../DESIGN_SYSTEM.md); fachliche Seitenabläufe gehören nicht in diese Dateien.

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
| `rosterPicker.js` | Vertrag folgt (Paket 3) | `public/css/style.css`, `public/css/domains.css` |
| `selectionSearch.js` | Vertrag folgt (Paket 3) | `public/css/style.css` |
| `modal.js` | Vertrag folgt (Paket 3) | `public/css/overlays.css` |
| `dateTimeField.js` | Vertrag folgt (Paket 3) | `public/css/style.css`, `public/css/overlays.css` |
| `emptyState.js` | Vertrag folgt (Paket 3) | `public/css/style.css` |
| `actionMenu.js` | Vertrag folgt (Paket 3) | `public/css/style.css` |

Neue Komponenten oder Varianten verwenden
[`_contract-template.md`](_contract-template.md). Vertrag, repräsentatives Beispiel und
Regressionstest entstehen im selben Änderungspaket.
