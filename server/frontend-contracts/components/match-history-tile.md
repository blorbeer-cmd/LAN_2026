# Match-Historienkachel

## 1. Status und Zweck

Status: umgesetzt. Eine Kachel zeigt den Ergebnisüberblick und klappt Match- oder Turnierteams
auf. Die Historie besitzt einen eigenen einklappbaren Rahmen; offene Auslosungen und laufende
Turniere stehen in einem separaten, zunächst geschlossenen Abschnitt darüber.

## 2. Quelle

`public/js/historyItem.js`: `historyItemHtml(id, title, meta, actions, details,
{ open, extraClass, isMine })` liefert den gemeinsamen Kartenkopf, getrennte Aktionen und den
aufklappbaren Inhalt. Titel und Kennungen werden escaped; Meta-, Aktions- und Detailmarkup
kommen bereits escaped vom Aufrufer.
`public/js/views/matchmaking.js`: `renderHistory`, `renderOpenDraws`, `wireHistory` und
`wireOpenDraws`.

## 3. CSS-Eigentümerschaft

`public/css/style.css` besitzt `.matchmaking-history-*`. Die vorhandenen `.card`, `.chip`,
`.btn`, `.lb-rank` und Ergebnis-Chips bleiben bei ihren jeweiligen Eigentümern.

## 4. Varianten

Erfasstes Match mit Ergebnis und Stift/Rematch, Turnier mit direktem Detail-Link und
nachladbaren Teamdetails; „Ohne Ergebnis“ als separater Abschnitt mit bearbeitbaren Auslosungen
und laufenden Turnieren. Jede Kartenart besitzt einen Papierkorb mit Bestätigung.
Jede Auslosung in diesem Abschnitt ist selbst eine einklappbare Kachel mit Aktionen im Kopf.
Wettaktionen stehen im Kopf, außerhalb des Aufklappbuttons. Das gilt auch für Turnierkacheln;
deren Tippdialog bündelt Turniersieger und bereits angelegte Spieltipps.

## 5. Erlaubte Anpassungen

Aufrufer dürfen Spielname, Zeit, Ergebnistext und Aktionen liefern. Der Pfeil steht ganz links
im Aufklappbutton, vor Titel und Metadaten; Aktionen stehen getrennt rechts und werden nie darin verschachtelt.

## 6. Komponenteneigene Invarianten

Alle Kacheln beginnen geschlossen und behalten ihren Zustand bei einem Neuzeichnen. `data-history-item` und `data-history-toggle` identifizieren Karte und Aufklappbutton. Wettmenüs
sind Geschwister des Aufklappbuttons, niemals darin verschachtelt. Tippabgabe öffnet keine Karte.
Alle Karten verwenden `.card`; die globalen Flächen wechseln je Kartenebene zwischen
`--bg-elevated` und `--bg-elevated-2`, unabhängig vom Aufklappzustand. Ist der
angemeldete Spieler beteiligt, steht der Spielname im geschlossenen Kopf fett; im Detail wird
nur sein Spielername fett. Ein gerade
gespeichertes Ergebnis öffnet seine Kachel. Spielnamen kürzen nur visuell; der vollständige
DOM-Text bleibt. Die Aktionsgruppe ist gleich hoch und darf auf schmalen Ansichten als Ganzes
unter den Titel rücken. Teams stehen breit nebeneinander, bis zu vier Spalten, auch in der neuen
Auslosung. Matchteams zeigen ihre gespeicherte Skill-Summe; alte Drafts ohne Snapshot und
Turnierteams zeigen ausdrücklich den aktuellen Team-Skill. Die Summe steht direkt am Teamnamen,
Ergebnispunkte stehen in derselben Kopfzeile, Spielernamen darunter.
Turnierkacheln laden beim Öffnen Teams, Spieler und verfügbare Ergebnisdaten nach; Fehler bieten
einen erneuten Ladeversuch. „Ohne Ergebnis“ steht über der Historie und ist zu Beginn geschlossen.
Beendete Turniere nennen Sieger und Platz zwei ausdrücklich; Ligateams zeigen ihre Tabellenplätze.
Platzangaben stehen als kompakte Nummer wie bei Matchteams in derselben Kopfzeile wie der
Teamname; Titel und zugänglicher Name nennen den Platz ausdrücklich. Die Platznummer ersetzt
das zusätzliche Win-Chip in der Teamkarte; das Win-Chip im Spielkopf bleibt. Bei K.-o.-Teams ohne eindeutigen
Platz steht die Ausscheidungsrunde in der Kontextzeile unter den Spielernamen.
Seine bearbeitbaren Auslosungen werden erst beim Aufklappen aufgebaut und beim Schließen
wieder aus dem DOM entfernt; die Anzahl und Erreichbarkeit aller offenen Auslosungen bleiben erhalten.
Laufende Turniere stehen dort ebenfalls; erst nach Abschluss wechseln sie in die Historie.
Ein stets erreichbares Filtermenü nach dem Muster des Spielekatalogs steht vor „Ohne Ergebnis“
und „Historie“. Die Chips unter „Art“ (Alle, Matches, Turniere) gelten für beide Abschnitte. Die laufende Turnierübersicht bleibt
davon unabhängig und zeigt immer alle laufenden Turniere.
Der Filterchip „Meine“ lässt sich mit jeder Art kombinieren und berücksichtigt die
Teamteilnahme des angemeldeten Spielers, auch bei älteren nachgeladenen Ergebnissen. Filterwechsel
erhalten die geöffneten Abschnitte und Kacheln; ein leerer Treffer entfernt nie die Filterzeile.
Ein gelöschter Match-Datensatz verschwindet auch aus der Rangliste. Turniere nutzen den bestehenden
Löschweg, der bereits gespeicherte Match-Ergebnisse in der Rangliste belässt und Platzierungsboni
entfernt; die Rückfrage nennt beides. Nur ein ausdrücklich erfasstes Unentschieden heißt „Remis“;
ein gespeicherter Eintrag ohne Sieger und ohne Remis-Kennzeichen heißt „Ohne Ergebnis“.
Nach dem Öffnen des Abschnitts beginnen die einzelnen Auslosungen geschlossen. Ihre Teamdetails
lassen sich unabhängig voneinander öffnen und wieder schließen; dieser Zustand bleibt beim
Neuzeichnen erhalten.
Teamdetails bleiben aufklappbar, während Wettaktionen im Header auch geschlossen erreichbar sind.
Die Chips „Noch offen“ und „Abgegeben“ unter „Dein Tipp · offene Spiele“ filtern nach noch
nicht getippten offenen oder bereits abgegebenen Tipps und wirken ausschließlich auf „Ohne Ergebnis“. Ein Turnier passt, wenn mindestens einer
seiner Märkte passt. Nicht zum Tippen freigegebene Matches passen zu keinem aktiven Tippfilter.
Ein erneuter Klick auf den aktiven Tippstatus zeigt wieder alle Tipps.
Abschnittsüberschriften, Chiplisten und Rücksetzen nutzen exakt die Katalogkomponenten.
Die Filter sind kombinierbar, zeigen ihre aktive Anzahl und lassen sich gemeinsam zurücksetzen.
Die unabhängige Übersicht laufender Turniere bleibt erhalten; eine leere gefilterte Menge zeigt
einen kompakten Leerzustand und lässt das Filtermenü erreichbar.
Neue Wettmenüs beginnen geschlossen und übernehmen niemals den Aufklappzustand der Historie.
„Ohne Ergebnis“ und „Historie“ besitzen stabile `data-matchmaking-section`-Kennungen. Gespeichert
wird ihr tatsächlicher nativer Aufklappzustand, auch nach programmatischer Wiederherstellung.
Ein Neuaufbau liest ihn vor dem Ersetzen des DOM; verzögerte Toggle-Ereignisse abgelöster alter
Knoten ändern den neuen Zustand nicht. Ein vorübergehend ausgeblendeter Abschnitt öffnet sich
beim Wiedererscheinen wie zuvor. Ergebniseingaben erhalten die übrigen geöffneten Spiele;
das gespeicherte Ergebnis bleibt in seiner geöffneten Historienkachel sichtbar.

## 7. Erreichbare Zustände

Geschlossen, geöffnet, neu gespeichertes Ergebnis, offener Draw, laufendes oder beendetes
Turnier, Ladefehler und leerer Filter.

## 8. Accessibility

Der Pfeil-Button verwendet `aria-expanded` und `aria-controls`, ist über die Tastatur bedienbar
und zeigt Fokus sichtbar. Sein Ziel ist mindestens `--tap-target-size` hoch. Filterchips verwenden `aria-pressed` und sind mit Enter/Space erreichbar; das Filterpanel nutzt den
vorhandenen Popover-Modus, damit es auf Telefonen nicht vom View-Container abgeschnitten wird. Aktionsknöpfe haben
einen eigenen Namen und Fokus; der Stift heißt „Ergebnis bearbeiten“.

## 9. Repräsentative Aufrufer

`views/matchmaking.js` auf 390 px mit umbrochener Aktionsgruppe und auf 1024 px mit
nebeneinanderliegenden Teams.

## 10. Prüfungen und Abnahmebeispiele

E2E prüft Aufklappen, Ergebnis/Rematch, Turnierdetails, Filter und Nachladen. Auf 390 und 1024 px gibt es
keinen horizontalen Überlauf; ein langer Spielname schneidet keine Aktion ab. Der Punkte-/Match-Browserfall
prüft zusätzlich per Tastatur: tippen bei geschlossener Karte, geschlossen bleiben nach dem Speichern,
geöffnet bleiben beim verzögerten Live-Refresh sowie die kombinierten Tipp- und Beteiligungsfilter.

## 11. Permanente Varianten und befristete Ausnahmen

`registry:match-history-disclosure` besitzt die Geometrie des Pfeil-Buttons. Keine
befristete Ausnahme.
