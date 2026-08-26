# Frontend Priority 3: Architekturentscheidungen

Stand: 2026-08-26

## Gemeinsame View Registry

`server/public/js/viewManifest.js` ist die Source of Truth für jede Browser-View. Ein Eintrag
beschreibt Route, sichtbares Label, Bereich und Reihenfolge, Icon, Rollenanforderung,
Event-Feature, Suchbegriffe, Bottom-/Mehr-Navigation, Lazy Loader und Lifecycle-Metadaten.
`sectionNav.js`, `bottomNav.js`, `searchPalette.js`, `eventFeatures.js`, `domainIcons.js` und
`views/more.js` projizieren daraus nur noch die jeweils benötigte Darstellung. Damit bleibt die
bisherige Reihenfolge erhalten, während eine neue View nicht mehr in mehreren unabhängigen Listen
nachgetragen werden muss.

Rollenanforderungen sind absichtlich Metadaten der View. Die Registry ersetzt jedoch keine
serverseitige Autorisierung. `deniedView` ist nur bei den bisherigen harten Admin-Weiterleitungen
gesetzt; Views mit eigener, differenzierter Read-only-/Admin-Darstellung behalten diese Logik.

## Lifecycle und Renderzustand

Jede View deklariert `eventScoped`, `invalidateOn`, `refreshOn` und `preserveState`.
`viewLifecycle.js` besitzt die zugehörigen Invalidierungsfunktionen. `app.js` verarbeitet nur noch
fachliche Signale wie Eventwechsel, Reconnect oder `foodOrders:changed` und kennt keine
View-spezifischen Cache-Module mehr. Der bestehende Unterschied zwischen harter Invalidierung und
leiser Aktualisierung bleibt erhalten; insbesondere wird die gerade offene Essen-Ansicht weiter
ohne Ladeplatzhalter aktualisiert.

Der bestehende zentrale `viewRenderState`-Vertrag schützt Scrollposition, Fokus, Eingabe-Drafts
und offene Details bei unvermeidbaren View-Renders. Essen ergänzt ihn in `foodOrderViewState.js`
um stabile Bestellkarten-Anker und seine drei Felddrafts. Der gemeinsame `rosterPicker.js` nutzt
Event Delegation und aktualisiert sichtbare Checkboxen bei Sammelaktionen direkt. In der
Turniererstellung löst eine einzelne Auswahl deshalb nur dann einen vollständigen Render aus,
wenn eine bereits ausgeloste Vorschau entfernt werden muss.

Vote und Packliste verwenden den Roster-Vertrag bewusst nicht: Vote wählt Fachoptionen statt
Personen, die Packliste verwaltet zugewiesene Aufgaben. Eine gemeinsame Abstraktion würde dort
unterschiedliche Berechtigungs-, Mengen- und Statusregeln verstecken.

## Dateischnitt

- `app.js` orchestriert Shell, Routing und Realtime; `viewLifecycle.js` besitzt View-Caches.
- `views/events.js` behält Controller, Formulare und Aktionen; `eventModel.js` enthält reine
  Teilnahme-/Zahlungsberechnungen und `eventPresentation.js` wiederverwendbare Kartendarstellung.
- `views/foodOrders.js` behält Controller, Aktionen und fachliches Rendering;
  `foodOrderModel.js` enthält reine Preis-/Gruppenberechnungen und `foodOrderViewState.js` den
  spezialisierten stabilen Renderzustand.
- `views/tournament.js` behält Laden, Erstellen und Aktionen; `tournamentPresentation.js` rendert
  Lobby, K.O.-Baum, Liga, Gruppen und Teams aus einem unveränderlichen Render-Snapshot.
- CSS wird in gleicher Kaskadenreihenfolge als `style.css` (Tokens, Basis, Shell und Komponenten),
  `domains.css` (Event-, Live-, Team-, Turnier-, Vote-, Rang- und Essen-Fachbereiche) und
  `overlays.css` (Login, Toast, Countdown, Modal, Onboarding, Sitzplan und Musik) geladen.

Das ist kein Framework-Umbau. Es gibt keine neue Produktionsabhängigkeit und keine neue
Build-Stufe; alle Module bleiben native Browser-ES-Module.

## Design-Token-Vertrag

Der bereinigte Altbestand verwendet für `gap`, `padding` und `margin` nur noch vorhandene
Spacing-Tokens oder eine begründete `design-token-ok`-Ausnahme. Jede responsive
Breiten-/Höhen-Media-Query nennt den passenden `--bp-*`-Token oder begründet einen
domänenspezifischen Breakpoint. `check-design-tokens.js` prüft diese beiden bereinigten Regeln nun
im vollständigen Frontend-Snapshot; Farb-, Typografie- und Radiusregeln bleiben zusätzlich als
Diff-Guard aktiv.

## Entscheidung gegen eine Umstellung auf natives `<dialog>`

Die Browserunterstützung von `<dialog>` und `showModal()` ist für die unterstützten aktuellen
Browser grundsätzlich ausreichend. Eine Migration senkt die Eigenlogik hier derzeit trotzdem
nicht belastbar:

- Der Helper unterstützt gestapelte Dialoge und schließt bei Escape nur den obersten.
- Backdrop-Pointerdown/-up wird unterschieden, damit ein Drag aus dem Dialog nicht versehentlich
  schließt.
- destruktive Bestätigungen setzen den sicheren Fokus, Dialoge geben Fokus an den Auslöser zurück
  und der bestehende Trap hat Regressionstests.
- Auf Mobilgeräten ist derselbe Vertrag als Bottom Sheet gestaltet; verschachtelte Info-Dialoge
  müssen dabei Fokus und Hintergrundsperre behalten.
- Bestehende Integrations- und E2E-Tests referenzieren bewusst `.modal-backdrop` und prüfen diese
  Interaktionen.

Native Dialoge würden deshalb weiterhin eine eigene Stack-, Backdrop-, Bestätigungs-,
Fokuswiederherstellungs- und Mobile-Sheet-Schicht benötigen, zusätzlich zu einer breiten Migration
aller Aufrufer und Tests. Der Helper bleibt bestehen. Eine spätere Umstellung ist sinnvoll, wenn
gestapelte Dialoge entfallen oder ein kleiner Prototyp nachweist, dass alle genannten Pfade mit
weniger Code und mindestens denselben Browserregressionen funktionieren.
