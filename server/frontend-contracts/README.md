# Frontend-Komponentenverträge

Dieser Index ordnet Frontend-Helper und CSS-Komponenten ihrer normativen Vertragsdatei und ihrem
CSS-Eigentümer zu. Vor Änderungen an einem Helper, einer Klasse oder einem Control zuerst den
zugehörigen Vertrag vollständig lesen. Der Designkern bleibt in
[`DESIGN_SYSTEM.md`](../DESIGN_SYSTEM.md); fachliche Seitenabläufe gehören nicht in diese Dateien.

| Helper/Klasse | Vertrag | CSS-Eigentümer |
|---|---|---|
| `.btn`, `.btn-sm`, `.btn-primary`, `.btn-danger`, `.btn-ready`, `.btn-block`, `.btn-equal` | [Controls](components/controls.md) | `public/css/style.css` |
| native `input`, `select`, `textarea` | [Controls](components/controls.md) | `public/css/style.css` |
| `.icon-btn`, `.btn-square`, `.selection-toolbar*` | [Controls](components/controls.md) | `public/css/style.css` |
| `.arcade-mode-toggle`, `.arcade-mode-toggle-btn`, `.arcade-lobby-create-row` | [Controls](components/controls.md) | `public/css/arcade.css` |
| `.action-menu > summary.btn`, `.action-menu-panel .btn` | [Controls](components/controls.md) | `public/css/style.css` |
| `.number-stepper`, `.number-stepper-btn` | [Controls](components/controls.md) | `public/css/style.css` |
| `rosterPicker.js` | Vertrag folgt (Paket 3) | `public/css/style.css`, `public/css/domains.css` |
| `selectionSearch.js` | Vertrag folgt (Paket 3) | `public/css/style.css` |
| `modal.js` | Vertrag folgt (Paket 3) | `public/css/overlays.css` |
| `dateTimeField.js` | Vertrag folgt (Paket 3) | `public/css/style.css`, `public/css/overlays.css` |
| `emptyState.js` | Vertrag folgt (Paket 3) | `public/css/style.css` |
| `actionMenu.js` | Vertrag folgt (Paket 3) | `public/css/style.css` |

Neue Komponenten oder Varianten verwenden
[`_contract-template.md`](_contract-template.md). Vertrag, repräsentatives Beispiel und
Regressionstest entstehen im selben Änderungspaket.
