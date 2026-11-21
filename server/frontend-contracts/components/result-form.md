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
- Pflicht-Punktestand (`requireAllScores`, mit `fixedMode`): Match setzt ihn, sobald die
  Top-2- oder Top-3-Wette der Auslosung Tipps hat. Ohne Modusknöpfe, ohne „0“-Platzhalter und mit
  `required` an jedem Zahlenfeld; jedes Team braucht einen eingetragenen Wert, eine eingegebene 0
  ist gültig.

## 5. Erlaubte Anpassungen

Aufrufer dürfen Titel, Unterzeile, Teamnamen, Startmodus und Speichern-Funktion bestimmen.
Sie dürfen die äußere Dialogbreite begrenzen, aber die innere Reihenfolge und Farbbedeutung
nicht ändern.

## 6. Komponenteneigene Invarianten

Die beiden Modusknöpfe verwenden `btn btn-sm`, der aktive `btn-primary` und `aria-pressed`.
Ein Ergebnis wird ausschließlich durch den kompakten, rechtsbündigen Knopf „Speichern“
gesichert. Auswahllabels sind mindestens `--tap-target-size` hoch und innerhalb einer Radiogruppe
gleich hoch, auch „Unentschieden“. Die Auswahl markiert nur ein dezenter Akzentrahmen ohne
Erfolgsfüllung. Beide Modusflächen belegen dieselbe Layoutfläche; die gerade inaktive ist nicht
sichtbar, nicht fokussierbar und für Screenreader verborgen. So bleibt die Dialoghöhe beim Umschalten
stabil. Zahlenfelder nutzen die registrierte `result-fields`-Höhe. Gleiche Punkte teilen sich den Platz, Platz 1 nutzt nur
die goldene Rangzahl. Ein eindeutiger Höchstwert gewinnt. Im normalen Punktestand zählen leere
Felder als null; alle Felder leer sperrt das Speichern mit einer verständlichen Meldung. Im
Pflicht-Punktestand sperrt schon ein leeres Feld das Speichern mit dem Hinweis „Bitte für jedes
Team einen Punktestand eintragen, auch 0.“ und setzt den Fokus in das erste leere Feld.
`onSave` erhält zusätzlich `complete`: wahr nur im Punktestand ohne leeres Feld. Match sendet
das als `placementsConfirmed`, das der Server für Top-Wetten mit Tipps verlangt. Während der
Anfrage ist „Speichern“ gesperrt; ein Fehler erhält den Formularzustand.
Beim Speichern eines Unentschiedens setzen Match- und Admin-Aufrufer ausdrücklich `isDraw: true`;
ein fehlender Sieger ohne dieses Kennzeichen zählt als fehlendes Ergebnis.

## 7. Erreichbare Zustände

Ungewählt, gewählt, ausgefüllt, Bearbeitung mit vorgewähltem Ergebnis, laufende Anfrage und
Speicherfehler. Das Turnier kann „Unentschieden“ je Phase unterbinden. Gehen bei offenem
Match-Dialog Top-Tipps ein, schließt Match ihn beim Speichern und öffnet ihn im
Pflicht-Punktestand neu, mit den bereits eingetippten Werten; leere Felder bleiben leer.
Auslöser ist der Fehlercode `placements_required` der Match-API oder, bei sichtbaren LAN-Punkten,
die Vorabprüfung des Wettstands. Ein während dieser Prüfung geschlossener Dialog speichert nichts
und öffnet nicht erneut.

## 8. Accessibility

Die Radiogruppe heißt „Sieger“ und verwendet native Radios; Labels sind über Tastatur und
Screenreader erreichbar. Zahlenfelder benennen Team und Punktestand. Modus und Rangänderungen
sind ohne Farbsehen lesbar. Der Fokus bleibt bei Validierungs- und Speicherfehlern erhalten;
einzige Ausnahme ist das leere Feld im Pflicht-Punktestand, das den Fokus erhält.

## 9. Repräsentative Aufrufer

`views/matchmaking.js` zeigt das Formular auf einem 390-px-Handy und einem 1024-px-Laptop;
`views/tournament.js` verwendet es auf der breiten Turnierdetailseite. Admin kann mehr als
sechs Personen als Frei-für-alle erfassen.
Der Tippdialog in `views/points.js` übernimmt nur die Sieger-Radiogruppe (`result-winner-list`,
`tournament-result-pick`, `tournament-result-pick-players`) als Teamauswahl, ohne Punktestand und
ohne „Speichern“ des Formulars. Die zweite Zeile nennt dort Einsatzsumme und Tippende. Höhe,
Akzentrahmen und Tastaturbedienung bleiben unverändert.

## 10. Prüfungen und Abnahmebeispiele

E2E bei 390 und 1024 px: Radiowahl erst nach „Speichern“ wirksam, gleiche Höhe aller
Radiokarten und stabile Dialoghöhe beim Moduswechsel, Punktestand und Rang live,
Gleichstand, ungültige Punkte, K.-o. ohne Remis, Admin mit vielen Personen, Tastatur und
kein horizontaler Überlauf. `resultRanks` prüft Gleichstände mit mindestens drei Teams.

## 11. Permanente Varianten und befristete Ausnahmen

Registry-IDs `registry:result-fields`, `registry:result-pick` und
`registry:result-score-row`; keine befristete Ausnahme.

Bei finanziell abgerechneten Match-/Turnierergebnissen sperrt der Aufrufer für Nicht-Admins die
nativen Eingaben und Buttons des Ergebnisformulars. Das gespeicherte Ergebnis und ein Hinweis
auf die nötige Adminrolle bleiben lesbar; der Server prüft die Korrekturberechtigung unverändert.
Diesen Korrekturblock (Begründung oder Adminhinweis) setzt `views/points.js` als
`.result-correction` zwischen Unterzeile und Formular. Er hält zur Modusgruppe denselben Abstand
`--space-4` wie die Unterzeile, damit Eingabefeld und Modusknöpfe nicht aneinanderstoßen.
