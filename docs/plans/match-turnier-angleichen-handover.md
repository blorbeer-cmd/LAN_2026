# Übergabe: Match und Turnier angleichen — Umsetzung

Diese Datei ist die vollständige, eigenständige Arbeitsanweisung für die Umsetzung. Sie ist aus
mehreren Abstimmungsrunden mit dem Nutzer entstanden. Wo sie und das Mockup voneinander abweichen,
gilt diese Datei.

## Ausgangslage

- **Bisher gibt es keine Zeile Implementierung.** Der Branch `claude/trusting-cerf-2rq1ip` und sein
  Draft-PR enthalten nur diese Übergabe und das Mockup.
- **Die Umsetzung erfolgt vollständig in genau diesem einen PR** auf demselben Branch. Das hat der
  Nutzer ausdrücklich so festgelegt. Keine Aufteilung in mehrere PRs.
- **Verbindlich ist das Mockup** `docs/mockups/match-turnier-angleichen.html` (Version 7). Im Browser
  öffnen. Die App-Ansichten darin nutzen die echten Tokens aus `server/public/css/style.css`.
  Die Seite ist in Abschnitte mit Vorher- und Nachher-Mockups gegliedert.
- Das Mockup zeigt Aufbau, Reihenfolge, Texte und Farbbedeutungen, ist aber keine Pixelvorlage.
  Maßgeblich für Maße, Abstände und Komponenten bleiben `server/DESIGN_SYSTEM.md`, die
  Komponentenverträge in `server/frontend-contracts/` und die Produktregeln in `docs/product/`.
- Ausgangsstand der Analyse: `main` bei `156f039`.

## Grundregeln für alle Teile

- **Nur Farben, die die App schon nutzt**, mit ihrer heutigen Bedeutung:
  - Grün (`--state-playing`) = gewonnen: „Win“-Chip, grüne Siegerzahl, heutiger `.is-selected`-Rahmen
    im Ergebnis-Dialog.
  - Gold (`--rank-1-gold`) = nur die Zahl von Platz 1, wie `.lb-rank` in der Rangliste und die
    Turniertabelle. Keine goldenen Rahmen, Kreise oder Flächen.
  - Verlauf (`--accent-gradient`) = aktiver Modus-Knopf und „Speichern“.
  - Blau umrandet (`.chip.is-active`) = aktiver Filter.
  - Grau = neutral, Verlierer in grauer Schrift.
  - Keine grün hinterlegten Listenzeilen, keine neuen Farbtöne.
- **Wortwahl:** „Punktestand“ statt „Wert“, „Unentschieden“ statt „Kein Sieger“. Die kurze Anzeige
  „Remis“ bleibt wie in den Produktregeln.
- **Es gibt keine eigene Rangfolge-Eingabe.** Kein Drag & Drop für Plätze, kein Feld „Platz“. Eine
  Rangfolge entsteht ausschließlich aus dem Punktestand.

## Teil 1: Gemeinsamer Ergebnis-Dialog

Heute bauen `openDrawResultDialog` in `server/public/js/views/matchmaking.js` und `openResultDialog`
in `server/public/js/views/tournament.js` ihren Dialog getrennt von Hand; nur die CSS-Klassen
(`.tournament-result-*` in `server/public/css/domains.css`) sind geteilt. Daraus wird **ein**
gemeinsamer Baustein (z. B. `server/public/js/resultDialog.js`), den beide Bereiche nutzen. Die
Bereiche übergeben Teams, Titel/Untertitel, Regeln und die Speicherfunktion.

Anforderungen:

1. **Zwei Modi: „Sieger | Punktestand“**, dargestellt wie der Match-Umschalter
   „Auslosung | Captain Draft“ (`btn btn-sm`, aktiver Knopf `btn-primary`). Das ersetzt den Textknopf
   „Mit Werten eintragen“ / „Nur Sieger wählen“.
2. **Im Turnier keine Modus-Knöpfe.** Die Turnier-Option `trackScore` legt den Modus fest.
3. **Modus „Sieger“:** eine Zeile je Team (`.tournament-result-pick` mit Teamname und Spielernamen
   darunter), dazu „Unentschieden“. Kein einleitender Satz „Wer hat gewonnen?“. Antippen wählt nur
   aus (heutiger grüner `.is-selected`-Stil); nichts ist vorausgewählt, außer beim Bearbeiten das
   gespeicherte Ergebnis. Die anderen Teams erhalten keinen Platz (`rank: null`).
4. **Modus „Punktestand“:** eine Liste, bei 2 Teams genauso wie bei 6. Jede Zeile: Platzzahl links,
   Teamname mit Spielernamen darunter, rechts das Zahlenfeld. Keine Tafel „A : B“ mehr im Dialog.
   - Die Platzzahl rechnet beim Tippen live mit; gleiche Punkte teilen sich den Platz. Platz 1 als
     goldene Zahl, sonst grau (Stil wie `.lb-rank`).
   - Die Zeilen springen beim Tippen nicht um.
   - Leere Felder zählen als ihr Platzhalter „0“; nur ein komplett leerer Dialog wird abgelehnt
     (bestehende Regel in `server/public/js/resultScores.js`).
   - Sieger = eindeutig bester Punktestand, sonst Unentschieden. Plätze folgen aus den Punkten.
   - **Nur im Match:** Kommazahlen erlaubt und ein Schalter „umdrehen“ (Hinweiszeile „Mehr Punkte =
     besser · umdrehen“) für Spiele, bei denen weniger besser ist. Umgedreht bestimmen die kleineren
     Punkte Platz und Sieger. Der Schalter wird nicht am Spiel gespeichert; beim Bearbeiten wird er
     aus den gespeicherten Plätzen und Punkten abgeleitet.
   - **Nur im Turnier:** ganze Zahlen ab 0; im K.-o.-Modus kein Gleichstand.
5. **Immer ausdrücklich „Speichern“**, in beiden Modi und auch bei 2 Teams. Das heutige sofortige
   Speichern per Tipp entfällt in Match und Turnier.
6. **„Unentschieden“** nur, wenn erlaubt: nicht im K.-o.-Modus (Finale, Turnierbaum,
   K.-o.-Runde von „Gruppenphase + K.O.“).
7. **Titel „Ergebnis“** mit Unterzeile: im Match „Spiel · N Teams“ (z. B. „Mario Kart · 4 Teams“),
   im Turnier „Turniername · Phase“ (z. B. „Rocket League Cup · Halbfinale“).
8. **Gleiche Rückmeldung:** nach dem Speichern in beiden Bereichen „Ergebnis gespeichert.“. Beendet
   das Ergebnis ein Turnier, ersetzt der bestehende Hinweis „Turnier beendet – Sieger: …“ diesen.
9. **Gleiche Fehlertexte** in beiden Bereichen, z. B. einheitlich „Bitte mindestens einen
   Punktestand eintragen.“.
10. **Beim Bearbeiten** öffnet der Dialog im passenden Modus: mit gespeicherten Punkten im Modus
    „Punktestand“, sonst „Sieger“, jeweils vorbefüllt.
11. **Admin-Dialog „Ergebnis eintragen“** in der Auswertung (`openMatchForm` in
    `server/public/js/views/leaderboard.js`): Spielwahl, Teamzuordnung und „Frei-für-alle“ bleiben.
    Der Ergebnis-Teil nutzt dieselben Modi und Zeilen wie oben statt Radio-Chips und der Felder
    „Wert“/„Platz“. Das Feld „Platz“ entfällt. Bei Frei-für-alle heißt die Option „Unentschieden“
    statt „Kein Sieger“. Den ungenutzten Pfad für `presetTeams`/`presetDrawId` samt veraltetem
    Kommentar entfernen (kein Aufrufer übergibt sie mehr).

Serverseitig ist nichts nötig: `matches` speichert je Team schon `score` und `rank`, gleiche Plätze
sind erlaubt, und Ranglisten-Punkte gibt es nur für den Sieger.

## Teil 2: Match-Historie neu

Betroffen: `renderHistory` und `renderDrawCard` in `server/public/js/views/matchmaking.js`, CSS um
`.matchmaking-draw-*` in `server/public/css/style.css`. Vorbild ist das Muster der Umfragen-Karten
(`event-poll-card` in `server/public/js/views/eventPolls.js`).

1. **Jeder Eintrag ist eine einklappbare Kachel.** Links ein Pfeil (`chevronRight`, zeigt aufgeklappt
   nach unten), die ganze Kopfzeile außer den Knöpfen ist die Klickfläche, mit `aria-expanded`.
   Alle Einträge starten zugeklappt; der Zustand bleibt beim Neuzeichnen erhalten. Ein gerade
   eingetragenes oder bearbeitetes Ergebnis klappt auf. „Neue Auslosung“ über der Historie bleibt
   eine offene, volle Karte wie heute.
2. **Kopfzeile (zugeklappt sichtbar):**
   - Zeile 1: Spielname (einzeilig, mit Auslassungspunkten).
   - Zeile 2: Zeit, dann das Ergebnis: „Win“-Chip mit Siegerteam und dessen Punkten (z. B. „Team 2 ·
     45“), bei 2 Teams mit Punkten stattdessen der Chip „3 : 1“; bei Unentschieden der Chip „Remis“;
     dazu die Teamanzahl. Das Badge „Captain Draft“ bleibt.
   - Rechts: bei eingetragenem Ergebnis „Rematch“ und der Stift; bei offener Auslosung „+“ und
     „Turnier erstellen“; bei einem Turnier der Knopf mit dem Turniernamen.
3. **Aufgeklappt:** Teams nach Platz sortiert, je Zeile Platzzahl (wie `.lb-rank`, Platz 1 gold),
   Teamname, dahinter **nur die Skill-Summe des Teams** mit dem bisherigen Skill-Symbol
   (`teamSkillHtml` mit `activity`-Icon, grau, „8 (1)“ = davon 1 Spieler ohne eigene Bewertung),
   darunter die Spielernamen **ohne** einzelne Skill-Level, rechts die Punkte. Verlierer grau.
   Ohne gespeicherte Plätze (Modus „Sieger“) steht das Siegerteam zuerst mit „Win“-Chip, die
   übrigen ohne Platzzahl in Losreihenfolge. Die gespeicherten Skill-Werte der Auslosung verwenden
   (`stored: true`, bei Captain Draft `balanced: false`), damit sich nichts nachträglich ändert.
   Der Hinweis zu Sitznachbarn erscheint aufgeklappt.
4. **Offene Auslosungen** stehen gesammelt in einer eigenen, eingeklappten Gruppe
   **„Ohne Ergebnis (n)“** am Ende der Historie (Stil wie „Frühere Runden (n)“ bei Umfragen). Der
   Server verwirft nichts. Aufgeklappt bleiben sie so bearbeitbar wie heute (Spieler verschieben,
   Team-Auswahl auf Touch-Geräten, „+“, „Turnier erstellen“).
5. **Filter „Alle | Matches | Turniere“** oben in der Historie, als Filterchips wie im
   Spielekatalog (`.chip`, aktiv `.chip.is-active`, `aria-pressed`), genau einer aktiv, Standard
   „Alle“, Auswahl bleibt beim Neuzeichnen erhalten.
   - „Matches“: Auslosungen ohne Turnier (mit Ergebnis und „Ohne Ergebnis“).
   - „Turniere“: Auslosungen, aus denen ein Turnier wurde. Die Kopfzeile zeigt Badge „Turnier“ und
     „Sieger: …“ bzw. „Läuft“. Dafür bevorzugt die Historie-Antwort von
     `GET /api/matchmaking/history` um Turnierstatus und Siegername erweitern (die Turnierliste
     liefert `championName` bereits); alternativ im Frontend aus der Turnierliste ergänzen.
   - Leerer Filter zeigt einen passenden leeren Zustand.
   - Die Historie bleibt wie heute auf das gewählte Spiel beschränkt.

## Teil 3: Turniere

### K.-o.-Runde mit nur 2 Teams

Besteht eine K.-o.-Runde aus genau einem Spiel, wird kein Turnierbaum gezeichnet, sondern eine
normale 1:1-Spielzeile wie im Spielplan (`fixtureRowHtml` in
`server/public/js/tournamentPresentation.js`), in einer Karte mit der Überschrift „Finale“.

- Gilt für „Gruppenphase + K.O.“, wenn insgesamt nur 2 Teams aufsteigen, und ebenso für ein reines
  K.-o.-Turnier mit 2 Teams.
- Kein Siegerfeld „Sieger“ neben der Zeile; den Sieger zeigt die bestehende Karte „Turnier beendet“.
- Ab 3 Teams in der K.-o.-Runde bleibt der Turnierbaum unverändert.
- Aktionen wie überall: „+“ offen, Stift entschieden, derselbe Ergebnis-Dialog aus Teil 1.
- Der TV-Kiosk zeigt K.-o.-Spiele schon als Karten und bleibt unverändert.

### Turnier-Tab auflösen

Der Tab „Turniere“ in der Match-Leiste entfällt; die Turnierseite bleibt eine eigene Route.

1. **Match ohne Tab-Leiste.** In `server/public/js/viewManifest.js` verliert `tournaments` seine
   `section`. In `server/public/js/sectionNav.js` kommt `tournaments → matchmaking` in
   `NAV_PARENT_BY_VIEW` (wie `myStats → profile`); am Desktop steht das schon in
   `DESKTOP_PARENT_BY_VIEW` (`server/public/js/bottomNav.js`). Unten bleibt „Match“ markiert.
2. **Karte „Laufende Turniere“** ganz oben auf der Match-Seite, nur wenn mindestens ein Turnier
   läuft. Eine Zeile je Turnier: Name, Format, Fortschritt „X/Y Partien“, Badge „Läuft“, Pfeil; ein
   Tipp öffnet die Turnierseite. Die Daten liefert die Turnierliste (`aktuellStatus.js` lädt sie
   bereits).
3. **Beendete Turniere** findet man in der Historie (Filter „Turniere“) und über die Suche. Keine
   eigene Archivkarte.
4. **Turnierseite** (`#tournaments/<id>`) bleibt mit Deep Links und Push-Links erreichbar, bekommt
   oben den Rückweg „‹ Match“ und behält Titel, „Löschen“, Meta-Zeile, „Aktive Lobbys“, Turnierbaum
   bzw. Tabellen und die Teams-Karte.
5. **Liste `#tournaments`** ohne ID leitet auf `#matchmaking` um. „Turnier anlegen“ entfällt dort,
   denn Turniere entstehen weiter nur aus einer Auslosung.
6. **Home „Aktuell“** öffnet ein laufendes Turnier direkt (Ziel mit Turnier-ID in
   `server/public/js/aktuellStatus.js`) statt der Liste.
7. **Suche:** Der statische Eintrag „Turniere“ in `viewManifest.js` entfällt oder führt zu Match;
   einzelne Turniere bleiben in der Suche.
8. Kommentare, die den Tab erwähnen (`app.js`, `sectionNav.js`), anpassen.

## Teil 4: Dokumentation und Prüfungen

- Produktregeln im selben PR nachziehen, vor allem `docs/product/competition-and-game-rules.md`
  (Team formation, „Historie“, Ergebnis-Dialog, „Tournament overview“) und
  `docs/product/navigation-and-account-rules.md` (Bereich-Tabs „Teams+Turniere“).
- Betroffene Komponentenverträge in `server/frontend-contracts/` und die Registry aktualisieren;
  neue Bausteine nach `_contract-template.md` ergänzen.
- Vorhandene Tests zuerst prüfen, dann risikobasiert ergänzen (`server/TESTING.md`): Platz aus
  Punkten inkl. Gleichstand und „umdrehen“, Sieger-/Punkte-Validierung, K.-o. ohne Unentschieden,
  Historie-Filter und Gruppierung, Finale-Zeile bei 2 Teams, Navigation ohne Turnier-Tab inkl.
  Umleitung von `#tournaments`.
- Pflichtprüfungen aus `server/public/AGENTS.md`: `npm run lint`, `npm run build`, `npm test`,
  `npm run check:tokens`, `npm run test:e2e`. Geänderte visuelle Referenzen wie in PR #662 über die
  CI-Ist-Stände übernehmen.

## Bewusst nicht Teil dieses PRs

- Rangfolge per Drag & Drop oder ein Feld „Platz“.
- „Weniger ist besser“ als gespeicherte Einstellung am Spiel.
- Verwerfen nicht genutzter Auslosungen auf dem Server.
- Änderungen am TV-Kiosk.

## Abnahme

- Match und Turnier nutzen denselben Ergebnis-Dialog; jede Eingabe speichert erst mit „Speichern“.
- Bei 2 bis 6 Teams sieht der Punktestand gleich aus, Plätze erscheinen live und stimmen nach dem
  Speichern mit der Historie überein.
- Die Historie ist einklappbar, zeigt das Ergebnis im Kopf, Rematch und Stift im Kopf, nur
  Team-Skill, „Ohne Ergebnis (n)“ und den Filter „Alle | Matches | Turniere“.
- Eine K.-o.-Runde mit einem Spiel erscheint als Spielzeile „Finale“.
- Es gibt keinen Turnier-Tab mehr; laufende Turniere stehen oben auf der Match-Seite, die
  Turnierseite hat „‹ Match“, alte Links funktionieren.
- Es kommen keine neuen Farben hinzu; alle Pflichtprüfungen laufen grün.
