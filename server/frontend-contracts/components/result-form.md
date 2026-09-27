# Ergebnisformular

## 1. Status und Zweck

Status: umgesetzt. Ein gemeinsames Formular für Match, Turnier und freie Admin-Ergebnisse;
die jeweiligen Speicherfunktionen und Datenformate bleiben beim Aufrufer.

## 2. Quelle

`public/js/resultDialog.js` stellt `resultFormHtml`, `wireResultForm`, `resultRanks` und
`resultWinnerIndex` bereit. Aufrufer sind `views/matchmaking.js`, `views/tournament.js` und
`views/adminResultForm.js`.

## 3. CSS-Eigentümerschaft

`public/css/domains.css` besitzt Modusgruppe, Ergebniszeilen und Auswahlflächen. Globale
Buttons, Zahlenfelder, Chips und Rangzahlen behalten ihre Eigentümer und Tokens.

## 4. Varianten

- `Sieger`: benannte native Radiogruppe, Team mit Spielernamen, optional „Unentschieden“.
- `Punktestand`: Zeilen mit Rang, Team, Spielernamen und eindeutig beschriftetem Zahlenfeld.
- Turnier: `fixedMode`, durch `trackScore` festgelegt; ganze Punkte ab null und kein Remis
  in einer K.-o.-Runde. Match und Admin erlauben Kommazahlen.

## 5. Erlaubte Anpassungen

Aufrufer dürfen Titel, Unterzeile, Teamnamen, Startmodus und Speichern-Funktion bestimmen.
Sie dürfen die äußere Dialogbreite begrenzen, aber die innere Reihenfolge und Farbbedeutung
nicht ändern.

## 6. Komponenteneigene Invarianten

Die beiden Modusknöpfe verwenden `btn btn-sm`, der aktive `btn-primary` und `aria-pressed`.
Ein Ergebnis wird ausschließlich durch den kompakten, rechtsbündigen Knopf „Speichern“
gesichert. Auswahllabels sind mindestens `--tap-target-size` hoch; Zahlenfelder nutzen die
registrierte `result-fields`-Höhe. Gleiche Punkte teilen sich den Platz, Platz 1 nutzt nur
die goldene Rangzahl. Ein eindeutiger Höchstwert gewinnt. Leere Felder zählen als null;
alle Felder leer sperrt das Speichern mit einer verständlichen Meldung. Während der Anfrage
ist „Speichern“ gesperrt; ein Fehler erhält den Formularzustand.

## 7. Erreichbare Zustände

Ungewählt, gewählt, ausgefüllt, Bearbeitung mit vorgewähltem Ergebnis, laufende Anfrage und
Speicherfehler. Das Turnier kann „Unentschieden“ je Phase unterbinden.

## 8. Accessibility

Die Radiogruppe heißt „Sieger“ und verwendet native Radios; Labels sind über Tastatur und
Screenreader erreichbar. Zahlenfelder benennen Team und Punktestand. Modus und Rangänderungen
sind ohne Farbsehen lesbar. Der Fokus bleibt bei Validierungs- und Speicherfehlern erhalten.

## 9. Repräsentative Aufrufer

`views/matchmaking.js` zeigt das Formular auf einem 390-px-Handy und einem 1024-px-Laptop;
`views/tournament.js` verwendet es auf der breiten Turnierdetailseite. Admin kann mehr als
sechs Personen als Frei-für-alle erfassen.

## 10. Prüfungen und Abnahmebeispiele

E2E bei 390 und 1024 px: Radiowahl erst nach „Speichern“ wirksam, Punktestand und Rang live,
Gleichstand, ungültige Punkte, K.-o. ohne Remis, Admin mit vielen Personen, Tastatur und
kein horizontaler Überlauf. `resultRanks` prüft Gleichstände mit mindestens drei Teams.

## 11. Permanente Varianten und befristete Ausnahmen

Registry-IDs `registry:result-fields`, `registry:result-pick` und
`registry:result-score-row`; keine befristete Ausnahme.
