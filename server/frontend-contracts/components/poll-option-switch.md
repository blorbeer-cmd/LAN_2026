# PollOptionSwitch

## 1. Status und Zweck

Umgesetzt. Der Schalter steuert, ob eine Umfrageoption wählbar ist. Er erscheint in den Formularen zum Erstellen und Bearbeiten einer Umfrage.

## 2. Quelle

Markup und Wertauslesung: `public/js/views/eventPolls.js` (`optionRowHtml`, `optionValuesFromForm`). Darstellung: `public/css/style.css` (`.poll-option-switch`).

## 3. CSS-Eigentümerschaft

`style.css` besitzt über `.poll-option-switch` Schalterfläche, Knauf, Farben und Fokusmarkierung. Der Optionsformular-Container bestimmt nur die Platzierung.

## 4. Varianten

Eine Variante: `.poll-option-switch` auf `input[type='checkbox']` mit `role='switch'` innerhalb von `.event-poll-option-active`; ein ist wählbar, aus ist deaktiviert.

## 5. Erlaubte Anpassungen

Aufrufer dürfen die Zeile innerhalb einer Optionskarte platzieren. Die Schaltergeometrie und Statusfarben bleiben komponenteneigen.

## 6. Komponenteneigene Invarianten

Die Spur ist 44 × 24 px aus `--space-*`-Tokens; der Knauf ist 16 px groß. Der Schalter steht direkt rechts neben „Option N“. Bei aktiven Optionen steht daneben kein Text; im ausgeschalteten Zustand erscheint „Deaktiviert“ und der Optionsname ist durchgestrichen. Beide Markierungen folgen dem Schalter sofort. Neue Optionen starten eingeschaltet, gespeicherte Optionen spiegeln ihren aktiven Zustand. Mindestens eine Option bleibt aktiv.

## 7. Erreichbare Zustände

Aktiv und deaktiviert; beide Zustände lassen sich im offenen Poll bearbeiten. Beim Erstellen sind neue Zeilen zunächst aktiv.

## 8. Accessibility

Der native Checkbox-Input erhält `role='switch'` und einen eindeutigen deutschen Namen über `aria-label`. Leertaste schaltet um; `:focus-visible` zeigt einen Fokusrahmen. Der Zustand bleibt als natives `checked` lesbar.

## 9. Repräsentative Aufrufer

`public/js/views/eventPolls.js`: „Umfrage starten“ und „Umfrage bearbeiten“, geprüft in `src/test/e2e/eventDatePoll.e2e.test.ts` auf Handy- und Desktopbreite.

## 10. Prüfungen und Abnahmebeispiele

`eventDatePoll.e2e.test.ts` prüft neue standardmäßig aktive Optionen, das Deaktivieren und Wiederaktivieren einer bestehenden Option sowie die sichtbare Statusmarkierung und Durchstreichung im Bearbeitungsdialog. `check:components` und `check:tokens` prüfen CSS-Eigentümerschaft und Tokenverwendung.

## 11. Permanente Varianten und befristete Ausnahmen

- `registry:poll-option-switch`: einzige permanente Schaltervariante für Umfrageoptionen; keine befristete Ausnahme.
