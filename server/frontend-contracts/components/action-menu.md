# ActionMenu

## 1. Status und Zweck

Status: `umgesetzt`.

ActionMenu ist die gemeinsame kompakte Disclosure für Verwaltungsaktionen an Event-, Umfrage- und
Bestellkarten. Sie hält seltenere Aktionen aus dem Kartenkopf heraus, ohne deren Namen,
Tastaturpfade oder Trefferflächen zu verkleinern. Ein Menü lohnt den zusätzlichen Klick erst ab
mehreren Einträgen: Bis zur vom Aufrufer gewählten Grenze (Standard: ein Eintrag) rendert der Helper
die Einträge direkt als Buttons. Persönliche Teilnahme-, Zahlungs- und Kalenderaktionen bleiben
außerhalb dieses Menüs.

## 2. Quelle

- Markup und Verhalten: `public/js/actionMenu.js`
- Geometrie und offene Kartenlage: `public/css/style.css`
- Ergänzende bestehende Kartenlage: `public/css/domains.css`
- Markup-API: `actionMenuHtml(actions, label, { key, inlineMax })`; `actions` ist ein Array mit
  einem Eintrag je Aktion, leere Einträge fallen weg. Höchstens `inlineMax` Einträge (Standard `1`)
  werden direkt aneinandergereiht zurückgegeben, erst darüber entsteht das Menü. Der optionale
  `key` setzt
  `data-action-menu` als stabile Identität, damit die Zustandssicherung beim Live-Re-Render
  (`viewRenderState.js`) Menüs und andere `details`-Elemente nicht verwechselt.
- Verdrahtung: `wireActionMenus(container)`

Jeder Eintrag in `actions` ist vertrauenswürdiges, vom Aufrufer erzeugtes Button-Markup; Nutzerinhalte darin
MÜSSEN bereits escaped sein. `label` wird escaped und bezeichnet das Menü zugänglich.

## 3. CSS-Eigentümerschaft

`public/css/style.css` besitzt `.action-menu`, Trigger, Panel, Menüzeilen,
Eintragsgeometrie und `.has-open-action-menu`. `public/css/domains.css` DARF ausschließlich
bestehende Kartencontainer über `:has(.action-menu[open])` in derselben Layering-Semantik anheben.
Trigger- und Eintragsmaße bleiben im [Controls-Vertrag](controls.md) registriert.

Aufrufer-CSS DARF die Menüposition nicht neu definieren und keine abweichende Trigger- oder
Eintragsgröße erzeugen.

## 4. Varianten

| Variante | Selektor/API | Status | Bedeutung |
|---|---|---|---|
| Standardtrigger | `summary.btn.btn-sm` | umgesetzt | sichtbarer Text „Aktion“ plus Chevron |
| Standardpanel | `.action-menu-panel` | umgesetzt | vertikale Liste sekundärer/destruktiver Buttons |
| Eintrag mit Zusatzcontrol | `.action-menu-row` | umgesetzt | bestehende Zeile, zum Beispiel Aktion plus Infohilfe |
| Ohne Aktionen | `actionMenuHtml([], label)` | umgesetzt | rendert kein leeres Menü |
| Direkte Einträge | `actionMenuHtml(actions, label, { inlineMax })` | umgesetzt | bis `inlineMax` Einträge (Standard 1) stehen als normale Buttons im Kopf, ohne Trigger |

Eine dauerhaft geöffnete, verschachtelte oder mehrspaltige Variante existiert nicht.

## 5. Erlaubte Anpassungen

- Aufrufer DÜRFEN vorhandene `.btn`-/`.btn-sm`-Bedeutungsvarianten als vertrauenswürdiges
  `actions`-Markup liefern.
- Der zugängliche Kontext DARF Event- oder Umfragenamen enthalten, MUSS aber mit „Aktion“ beginnen.
- Jeder gerenderte View MUSS genau einmal seinen gemeinsamen Container nach dem Markupaufbau mit
  `wireActionMenus(container)` verdrahten. Ein Re-Render verdrahtet den neuen Container erneut.
- Aufrufer DÜRFEN persönliche, immer sichtbare Aktionen nicht in das Menü verschieben, nur um
  Platz zu sparen.
- Ein Menü mit genau einem Eintrag entsteht nie. Aufrufer DÜRFEN `inlineMax: 2` wählen, wenn zwei
  gleichrangige Verwaltungsaktionen im Kopf Platz haben; ein direkt stehender „Beenden“- oder
  „Löschen“-Button ist dann neutral, die Gefahr trägt sein Bestätigungsdialog. Ein zweiter
  direkter Button neben einer bereits vorhandenen Kopfaktion (etwa „Neue Runde“) bleibt im Menü,
  damit der Kopf nicht drei Buttons trägt.

## 6. Komponenteneigene Invarianten

- Sichtbarer Name und Accessible Name des Triggers MÜSSEN mit „Aktion“ beginnen.
- Der Trigger verwendet `summary.btn.btn-sm`, besitzt sichtbaren Rahmen und Chevron und misst
  einzeilig 31–33 px.
- Menüeinträge MÜSSEN mindestens 44 px hoch und breit sein, nach links ausrichten und bei echtem
  Textüberlauf ohne Clipping umbrechen.
- Pro verdrahtetem View darf höchstens ein Menü offen sein. Öffnen eines Menüs schließt alle
  Geschwister und entfernt deren angehobenen Kartenstatus.
- Ein Außen-Pointer schließt offene Menüs ohne Fokusverschiebung.
- Escape schließt das offene Menü, verhindert die weitere Standardaktion und gibt den Fokus an
  dessen Trigger zurück.
- Die Wahl einer aktiven Buttonaktion schließt das Menü in der Capture-Phase und gibt den Fokus an
  den Trigger zurück, bevor der Aufrufer beispielsweise einen Dialog fokussiert.
- Einträge sind flache Listenzeilen ohne eigene Fläche: Hintergrund transparent, bei Hover die
  Fläche `--bg-elevated-2`. Ein destruktiver Eintrag (`.btn-danger`) behält die rote Schrift, trägt
  keine rote Box und steht hinter einer Haarlinie; bei Hover erhält er `--danger-bg`. Das Panel ist
  mindestens 11rem breit.
- Deaktivierte oder `aria-disabled="true"` Einträge lösen den Aktionswahl-Schließpfad nicht aus.
- Eine offene Karte MUSS über späteren Geschwistern liegen; beim Schließen wird der Marker
  entfernt.
- Das modulweite Wiring bricht die Listener des zuvor verdrahteten Containers ab. Damit bleiben
  nach Viewwechsel oder Re-Render keine konkurrierenden Dokumentlistener aktiv.

Registry-Bezüge: `action-menu-trigger`, `action-menu-entry`, `button`, `button-small` und
`button-meaning` in [component-registry.mjs](../component-registry.mjs).

## 7. Erreichbare Zustände

- kein Menü, weil keine Aktionen existieren;
- direkte Buttons, weil höchstens `inlineMax` Aktionen existieren;
- geschlossenes Menü;
- genau ein geöffnetes Menü;
- Wechsel vom offenen Menü zu einem Geschwistermenü;
- Schließen über Außen-Pointer, Escape oder aktive Aktionswahl;
- sekundäre und destruktive Einträge;
- vorhandener deaktivierter Eintrag;
- erneuter View-Render mit neu verdrahtetem Container.

## 8. Accessibility

- Native `details`/`summary` liefern Disclosure-Semantik und Tastaturaktivierung über Enter/Space.
- Trigger und Panelaktionen sind echte Buttons mit sichtbaren deutschen Labels. Der zugängliche
  Triggername beginnt mit „Aktion“ und ergänzt den fachlichen Kartenkontext.
- Escape und Aktionswahl geben Fokus zurück; Außen-Pointer respektiert den vom Pointerpfad
  bestimmten Fokus.
- Fokusreihenfolge folgt der DOM-Reihenfolge; Reflow und Kartenanhebung verändern sie nicht.
- Aktionsbedeutung wird über Text und vorhandene Buttonbehandlung, nicht nur über Farbe,
  vermittelt.

## 9. Repräsentative Aufrufer

- `public/js/views/eventPolls.js` für offene und beendete Umfragen mit Re-Render
- `public/js/views/events.js` für einklappbare Eventkarten und rollenabhängige Aktionen
  (`inlineMax: 2`)
- `public/js/views/foodOrders.js` für Bestellkarten mit stabilem `key`

## 10. Prüfungen und Abnahmebeispiele

- `src/test/e2e/eventDatePoll.e2e.test.ts` prüft mehrere reale Umfragemenüs: 31–33-px-Trigger,
  mindestens 44×44-px-Einträge, genau ein offenes Menü, Kartenlage, Escape- und
  Aktionswahl-Fokusrückgabe, Außen-Pointer ohne Fokusverschiebung und erneutes Wiring nach Re-Render.
- `public/js/actionMenu.test.js` prüft die Grenze zwischen direkten Einträgen und Menü samt
  `inlineMax`, `key` und escaptem Label.
- `src/test/e2e/eventWorkspaceSwitch.e2e.test.ts` prüft an einer allgemeinen Eventkarte ohne
  Tracking, dass „Bearbeiten“ und ein neutrales „Beenden“ ohne Menü direkt im Kopf stehen.
- Bei 320×568 und 390×844 bleibt das Panel innerhalb des Viewports; bei 512×384 und 720×450
  entsteht kein horizontaler Overflow im tatsächlich scrollenden View-Container. Desktop prüft
  dieselben Keyboard- und Pointerpfade.

## 11. Permanente Varianten und befristete Ausnahmen

Die Registry-IDs `action-menu-trigger` und `action-menu-entry` sind permanente Varianten: der
Trigger folgt der 32-px-Standardgeometrie, Einträge sind ausdrückliche 44-px-Strukturziele. Die
Button-IDs liefern Bedeutungs- und Textgeometrie. `.action-menu-row` ist eine interne
Zusammensetzung, keine weitere Größenvariante. Es gibt keine befristete ActionMenu-Ausnahme.
