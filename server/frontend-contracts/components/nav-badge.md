# Navigationszähler

## 1. Status und Zweck

Status: `umgesetzt`. Eine kleine Zahl auf dem Icon eines Navigationseintrags zeigt, wie viele neue
Mitteilungen und offene To-Dos in diesem Bereich warten. Nicht-Ziele: keine Zahlen in Bereich-Tabs,
keine Ersatzliste für „Meine To-Dos“ und keine Zählung über fremde Workspaces. Fachregeln:
[Navigationszähler](../../../docs/product/navigation-and-account-rules.md#navigationszähler).

## 2. Quelle

- `public/js/navBadgeModel.js`: reine Zähl- und Zuordnungslogik (`navBadgeItems`,
  `countForBottomNav`, `countForDesktopNav`, `countForMoreCard`, `itemsSeenByOpening`,
  `navBadgeText`, `navBadgeLabel`).
- `public/js/navBadges.js`: `initNavBadges()`, `renderNavBadges()`, `noteNavViewOpened(view)`.
  `app.js` ruft `noteNavViewOpened` in `switchView()` und `renderNavBadges` nach jeder
  Aktiv-Markierung der Navigation sowie nach dem Rendern von „Mehr“ auf.
- Datenquellen: `notificationFeedEntries()`/`markFeedEntriesSeen()` aus `notificationBanner.js`,
  `myTodoRows()`/`pendingVoteRounds()` aus `myTodos.js` (mit `keepMyTodosFresh()`).

## 3. CSS-Eigentümerschaft

`public/css/style.css` besitzt `.nav-badge` und die `position: relative` der Icon-Hosts
(`.nav-icon`, `.more-card .list-row-icon`) sowie die Zeilenvariante `.desktop-nav-btn > .nav-badge`.
Aufrufer setzen keine eigenen Badge-Stile.

## 4. Varianten

Eine Variante: `span.nav-badge` mit `.nav-count-value` (sichtbare Zahl, `aria-hidden`) und einem
`.visually-hidden`-Text „, N neu“. Hosts: Bottom-Nav-Icon und Icon einer „Mehr“-Karte (obere
rechte Icon-Ecke); in der Desktop-Rail der Button selbst, dort schließt die Zahl die Zeile rechts
ab (`.desktop-nav-btn > .nav-badge`), weil das 18-px-Icon sonst das Label verdeckt.

## 5. Erlaubte Anpassungen

Keine. Die Platzierung (Icon-Ecke beziehungsweise Zeilenende in der Rail) ist komponenteneigen.

## 6. Komponenteneigene Invarianten

- MUSS den Marken-Verlauf `--accent-gradient` mit `--accent-text` verwenden, nicht `--danger`:
  Die Zahl weist auf Neues hin und ist keine Warnung. Dazu `--space-4` Höhe/Mindestbreite,
  `--radius-full`, `--font-size-2xs` und `--font-weight-bold`.
- MUSS die Ziffer optisch mittig zeigen: `.nav-count-value` schneidet den Textkasten auf
  Versalhöhe und Grundlinie zu (`text-box: trim-both cap alphabetic`). Abnahme bei 390 px: Die
  Mitte der Ziffer weicht höchstens 0,5 px von der Kreismitte ab.
- MUSS ab zehn „9+“ zeigen und bei null vollständig aus dem DOM verschwinden.
- MUSS ohne Animation erscheinen; es gibt keinen Bewegungszustand.
- DARF Klicks nicht abfangen (`pointer-events: none`) und die Geometrie des Eintrags nicht ändern.
- Der gerade geöffnete Eintrag zeigt nie eine Zahl.

## 7. Erreichbare Zustände

Ausgeblendet (null oder aktiver Eintrag), 1–9, „9+“. Vor dem ersten Laden und ohne Anmeldung gibt
es keine Zahl.

## 8. Accessibility

Die Zahl ist nie die einzige Information: Buttons mit `aria-label` (Bottom-Nav, Rail) erhalten
„<Label>, N neu“ aus `data-base-label`; „Mehr“-Karten ohne `aria-label` lesen den versteckten Text
„, N neu“ hinter ihrem Titel. Fokus und Tastaturbedienung bleiben die des Eintrags.

## 9. Repräsentative Aufrufer

- Schmal: Bottom-Navigation in `public/index.html` (`.nav-btn`), z. B. „Vote“ bei offener Runde.
- Breit: Desktop-Rail (`.desktop-nav-btn`, aus `renderDesktopNavigation()` in `app.js`).
- Hub: Karten in `public/js/views/more.js`.

## 10. Prüfungen und Abnahmebeispiele

`public/js/navBadgeModel.test.js` prüft Zählung, Workspace-Filter, Zuordnung zu Match/„Mehr“/Rail,
das Gesehen-Markieren beim Öffnen, die Begrenzung der Gesehen-Liste und „9+“/Namen.
`public/js/myTodos.test.js` prüft, dass die To-Do-Liste außerhalb von Home nachgeladen wird.
Visuell bei 390 px (Bottom-Nav) und ≥ 1280 px im Desktop-Modus: Zahl sitzt auf der Icon-Ecke,
verdeckt kein Label und verschiebt keine Nachbarn.

## 11. Permanente Varianten und befristete Ausnahmen

Keine.
