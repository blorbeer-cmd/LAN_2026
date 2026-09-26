# Übergabe: Match und Turnier angleichen — Umsetzung

Diese Datei ist die vollständige, eigenständige Arbeitsanweisung für die Umsetzung. Sie ist aus
mehreren Abstimmungsrunden mit dem Nutzer und einer Konzeptprüfung durch Codex entstanden
(PR-Kommentar vom 26.09.2026 an #684). Wo sie und das Mockup voneinander abweichen, gilt diese Datei.

## Ausgangslage

- **Bisher gibt es keine Zeile Implementierung.** Der Branch `claude/trusting-cerf-2rq1ip` und sein
  Draft-PR #684 enthalten nur diese Übergabe und das Mockup.
- **Die Umsetzung erfolgt vollständig in genau diesem einen PR** auf demselben Branch. Das hat der
  Nutzer ausdrücklich so festgelegt.
- **Verbindlich ist das Mockup** `docs/mockups/match-turnier-angleichen.html` (Version 8). Im Browser
  öffnen. Die App-Ansichten darin nutzen die Tokens aus `server/public/css/style.css`, bauen die
  Komponenten aber nach. Es zeigt Aufbau, Reihenfolge, Texte und Farbbedeutungen, ist aber keine
  Pixelvorlage. Maßgeblich für Maße, Abstände und Komponenten bleiben `server/DESIGN_SYSTEM.md`, die
  Komponentenverträge in `server/frontend-contracts/` und die Produktregeln in `docs/product/`.

## Entscheidungen des Nutzers

- Ergebnis-Dialog mit genau zwei Modi „Sieger | Punktestand“. **Keine** Rangfolge per Drag & Drop,
  **kein** Feld „Platz“. Eine Rangfolge entsteht nur aus dem Punktestand.
- Immer ausdrücklich „Speichern“, auch bei 2 Teams. Kein Satz „Wer hat gewonnen?“.
- Mehr Punkte = besser, wie heute. **„Weniger ist besser“ gehört nicht zu diesem PR**, weder als
  Schalter noch als Einstellung am Spiel.
- Historie: nur die **Skill-Summe des Teams**, keine Skill-Level einzelner Spieler.
- **Captain Draft speichert künftig die Skill-Werte** beim Abschluss. Ältere Draft-Einträge ohne
  gespeicherte Werte zeigen keinen Skill statt einer falschen Zahl.
- Nie gespielte Auslosungen bleiben erhalten und stehen gesammelt unter „Ohne Ergebnis (n)“.
- K.-o.-Runde mit nur einem Spiel als 1:1-Spielzeile „Finale“ statt Turnierbaum.
- Der Turnier-Tab entfällt. **Kein Zurück-Knopf „‹ Match“** auf der Turnierseite (Designregel
  „No back buttons“); zurück geht es über „Match“ in der Navigation und die Zurück-Geste.
- Filter „Alle | Matches | Turniere“ in der Historie.

## Grundregeln für alle Teile

- **Nur Farben, die die App schon nutzt**, mit ihrer heutigen Bedeutung:
  - Grün (`--state-playing`) = gewonnen: „Win“-Chip, grüne Siegerzahl, heutiger `.is-selected`-Rahmen
    im Ergebnis-Dialog.
  - Gold (`--rank-1-gold`) = nur die Zahl von Platz 1, wie `.lb-rank` in der Rangliste und die
    Turniertabelle. Keine goldenen Rahmen, Kreise oder Flächen.
  - Verlauf (`--accent-gradient`) = aktiver Modus-Knopf und „Speichern“.
  - Blau umrandet (`.chip.is-active`) = aktiver Filter.
  - Grau = neutral, Verlierer in grauer Schrift.
- **Wortwahl:** „Punktestand“ statt „Wert“, „Unentschieden“ statt „Kein Sieger“. Die kurze Anzeige
  „Remis“ bleibt.
- **Designregeln 10 und 11** in `server/DESIGN_SYSTEM.md` gelten: „Speichern“ steht kompakt und
  rechtsbündig am Ende des Dialogs, nicht über die volle Breite. Regel 11 beschreibt heute noch
  „ein Knopf je Ergebnis, der sofort speichert“; sie wird im selben PR auf „Auswahl, dann
  Speichern“ angepasst.
- Die Ranglisten-Wertung bleibt unverändert: Jeder Teilnehmer erhält 1 Punkt, der Sieger zusätzlich
  3. `score` und `rank` bestimmen die Ranglisten-Punkte nicht (`server/src/leaderboard.ts`).

## Teil 1: Gemeinsamer Ergebnis-Dialog

Heute bauen `openDrawResultDialog` in `server/public/js/views/matchmaking.js` und `openResultDialog`
in `server/public/js/views/tournament.js` ihren Dialog getrennt; nur die CSS-Klassen
(`.tournament-result-*` in `server/public/css/domains.css`) sind geteilt. Daraus wird **ein
gemeinsamer Formularbaustein** (z. B. `server/public/js/resultDialog.js`) mit getrennten
Speicherfunktionen je Bereich. Keine neue Dialogarchitektur: der bestehende `openModal` bleibt.
Die Datenformate bleiben getrennt: im Turnier `scoreA`/`scoreB`, `winnerTeamId` und der
Konfliktschutz über `expectedPlayedAt`; im Match `teams[]` mit `score`/`rank` und
`winnerTeamIndex`.

1. **Zwei Modi „Sieger | Punktestand“** wie der Match-Umschalter „Auslosung | Captain Draft“
   (`btn btn-sm`, aktiver Knopf `btn-primary`, `aria-pressed`). Das ersetzt „Mit Werten eintragen“ /
   „Nur Sieger wählen“.
2. **Im Turnier keine Modus-Knöpfe.** `trackScore` legt den Modus fest.
3. **Modus „Sieger“:** eine Auswahl je Team (Teamname, darunter Spielernamen), dazu
   „Unentschieden“, wenn erlaubt. Kein einleitender Satz. Es ist eine echte Einfachauswahl
   (native Radios oder `role="radio"` mit `aria-checked` in einer benannten Gruppe); der grüne
   `.is-selected`-Rahmen ist nur die sichtbare Markierung. Nichts ist vorausgewählt, außer beim
   Bearbeiten das gespeicherte Ergebnis. Die übrigen Teams erhalten keinen Platz (`rank: null`).
4. **Modus „Punktestand“:** eine Liste, bei 2 Teams genauso wie bei 6. Jede Zeile: Platzzahl links,
   Teamname mit Spielernamen darunter, rechts das Zahlenfeld mit eindeutiger Beschriftung
   (z. B. „Punktestand Team 2“). Keine Tafel „A : B“ mehr im Dialog.
   - Die Platzzahl rechnet beim Tippen live mit; gleiche Punkte teilen sich den Platz. Platz 1 als
     goldene Zahl, sonst grau (Stil wie `.lb-rank`). Die Zeilen springen beim Tippen nicht um.
   - Leere Felder zählen als ihr Platzhalter „0“; nur ein komplett leerer Dialog wird abgelehnt
     (bestehende Regel in `server/public/js/resultScores.js`).
   - Sieger = eindeutig höchster Punktestand, sonst Unentschieden.
   - Im Match sind Kommazahlen erlaubt, im Turnier nur ganze Zahlen ab 0; im K.-o.-Modus kein
     Gleichstand.
5. **Immer ausdrücklich „Speichern“**, in beiden Modi und auch bei 2 Teams; kompakt und
   rechtsbündig. Während die Anfrage läuft, ist „Speichern“ gesperrt; bei einem Fehler bleiben
   Auswahl, Eingaben und Fokus erhalten.
6. **„Unentschieden“** nur, wenn erlaubt: nicht im K.-o.-Modus (Finale, Turnierbaum, K.-o.-Runde
   von „Gruppenphase + K.O.“).
7. **Titel „Ergebnis“** mit Unterzeile: im Match „Spiel · N Teams“ (z. B. „Mario Kart · 4 Teams“),
   im Turnier „Turniername · Phase“ (z. B. „Rocket League Cup · Halbfinale“).
8. **Gleiche Rückmeldung:** „Ergebnis gespeichert.“ in beiden Bereichen. Beendet das Ergebnis ein
   Turnier, ersetzt der bestehende Hinweis „Turnier beendet – Sieger: …“ diesen.
9. **Gleiche Fehlertexte**, z. B. einheitlich „Bitte mindestens einen Punktestand eintragen.“.
10. **Beim Bearbeiten** öffnet der Dialog im passenden Modus: mit gespeicherten Punkten im Modus
    „Punktestand“, sonst „Sieger“, jeweils vorbefüllt.
11. **Admin-Dialog „Ergebnis eintragen“** in der Auswertung (`openMatchForm` in
    `server/public/js/views/leaderboard.js`): Spielwahl, Teamzuordnung und „Frei-für-alle“ bleiben.
    Der Ergebnis-Teil nutzt dieselben Modi und Zeilen statt Radio-Chips und der Felder
    „Wert“/„Platz“. Das Feld „Platz“ entfällt. Bei Frei-für-alle heißt die Option „Unentschieden“
    statt „Kein Sieger“; mehr als sechs Personen müssen gut bedienbar bleiben. Den ungenutzten Pfad
    für `presetTeams`/`presetDrawId` samt veraltetem Kommentar entfernen.

## Teil 2: Match-Historie neu

Betroffen: `renderHistory` und `renderDrawCard` in `server/public/js/views/matchmaking.js`, CSS um
`.matchmaking-draw-*` in `server/public/css/style.css`. Vorbild ist das Muster der Umfragen-Karten
(`event-poll-card` in `server/public/js/views/eventPolls.js`).

1. **Jeder Eintrag ist eine einklappbare Kachel.** Links ein Pfeil (`chevronRight`, zeigt aufgeklappt
   nach unten). Der Umschalter ist ein eigener Button mit `aria-expanded` und `aria-controls` neben
   den Aktionsknöpfen, keine verschachtelten Buttons. Alle Einträge starten zugeklappt; der Zustand
   bleibt beim Neuzeichnen erhalten. Ein gerade eingetragenes oder bearbeitetes Ergebnis klappt auf.
   „Neue Auslosung“ über der Historie bleibt eine offene, volle Karte wie heute.
2. **Kopfzeile (zugeklappt sichtbar):**
   - Zeile 1: Spielname (einzeilig, mit Auslassungspunkten).
   - Zeile 2: Zeit und das Ergebnis. **Immer das Siegerteam mit „Win“-Chip**, dazu dessen Punkte
     (z. B. „Team 2 · 45“) oder bei 2 Teams mit Punkten der Chip „3 : 1“ zusätzlich. Bei
     Unentschieden der Chip „Remis“. Dazu die Teamanzahl. Das Badge „Captain Draft“ bleibt.
   - Rechts: bei eingetragenem Ergebnis „Rematch“ und der Stift; bei offener Auslosung „+“ und
     „Turnier erstellen“; bei einem Turnier der Knopf mit dem Turniernamen. Auf dem Handy darf die
     Aktionsgruppe bei langen Namen vollständig in die nächste Zeile rücken.
3. **Aufgeklappt:** Teams nach Platz sortiert, je Zeile Platzzahl (wie `.lb-rank`, Platz 1 gold),
   Teamname, dahinter **nur die Skill-Summe des Teams** mit dem bisherigen Skill-Symbol
   (`teamSkillHtml`, `activity`-Icon, grau, „8 (1)“ = davon 1 Spieler ohne eigene Bewertung),
   darunter die Spielernamen **ohne** einzelne Skill-Level, rechts die Punkte. Verlierer grau.
   Ohne gespeicherte Plätze (Modus „Sieger“) steht das Siegerteam zuerst mit „Win“-Chip, die
   übrigen ohne Platzzahl in Losreihenfolge. **Die Sortierung ist nur Anzeige:** Bearbeiten und
   Rematch arbeiten weiter mit der ursprünglichen Teamreihenfolge und den Indizes. Der Hinweis zu
   Sitznachbarn erscheint aufgeklappt.
4. **Skill-Werte:** gezogene Auslosungen nutzen die gespeicherten Werte (`stored: true`). **Captain
   Draft** speichert beim Abschluss künftig die damaligen Skill-Werte je Spieler und die Summe
   (`server/src/routes/draft.ts`, heute `rating: null`, `totalRating: 0`) mit einer eindeutigen
   Kennung, dass ein Snapshot vorliegt. Draft-Einträge ohne diese Kennung (alte Drafts) zeigen keinen
   Skill. Die Draft-Wahl selbst bleibt unabhängig vom Skill.
5. **Offene Auslosungen** stehen gesammelt in einer eigenen, eingeklappten Gruppe
   **„Ohne Ergebnis (n)“** am Ende der Historie (Stil wie „Frühere Runden (n)“ bei Umfragen). Der
   Server verwirft nichts. Aufgeklappt bleiben sie so bearbeitbar wie heute (Spieler verschieben,
   Team-Auswahl auf Touch-Geräten, „+“, „Turnier erstellen“).
6. **Filter „Alle | Matches | Turniere“** oben in der Historie, als Filterchips wie im
   Spielekatalog (`.chip`, aktiv `.chip.is-active`, `aria-pressed`), genau einer aktiv, Standard
   „Alle“, Auswahl bleibt beim Neuzeichnen erhalten. Die Historie bleibt auf das gewählte Spiel
   beschränkt.
   - **„Alle“ und „Matches“** kommen aus `GET /api/matchmaking/history`. Heute lädt die App ohne
     Limit die neuesten 20 Auslosungen (Server-Maximum 50), ältere sind unerreichbar. Neu: Der
     Filter wird **serverseitig vor der Begrenzung** angewendet (z. B. Parameter `kind`) und die
     Historie lädt ältere Einträge über „Ältere laden“ nach (z. B. Cursor über `generatedAt`).
   - **„Turniere“** kommt aus der vollständigen Turnierliste (`GET /api/tournaments`, liefert
     `gameId`, `status`, `championName`), gefiltert auf das gewählte Spiel. So erscheinen auch
     ältere Turniere ohne Auslosungsverknüpfung. Kopfzeile: Badge „Turnier“ und „Sieger: …“ bzw.
     „Läuft“; der Knopf öffnet die Turnierseite.
   - Leere Filter zeigen einen passenden leeren Zustand.

## Teil 3: Turniere

### K.-o.-Runde mit nur einem Spiel

Besteht eine K.-o.-Runde aus genau einem Spiel, wird kein Turnierbaum gezeichnet, sondern eine
normale 1:1-Spielzeile wie im Spielplan (`fixtureRowHtml` in
`server/public/js/tournamentPresentation.js`), in einer Karte mit der Überschrift „Finale“.

- Gilt für „Gruppenphase + K.O.“, wenn insgesamt nur 2 Teams aufsteigen, und für ein reines
  K.-o.-Turnier mit 2 Teams.
- Kein Siegerfeld neben der Zeile; den Sieger zeigt die bestehende Karte „Turnier beendet“.
- Ab 3 Teams in der K.-o.-Runde (auch mit Freilos) bleibt der Turnierbaum unverändert. Solange die
  K.-o.-Phase noch nicht erzeugt ist, bleibt der heutige leere Zustand.
- Aktionen wie überall: „+“ offen, Stift entschieden, derselbe Ergebnis-Dialog aus Teil 1.
- Der TV-Kiosk bleibt unverändert.

### Turnier-Tab auflösen

1. **Match ohne Tab-Leiste.** In `server/public/js/viewManifest.js` verliert `tournaments` seine
   `section`, und Match verliert damit seinen einzelnen Tab „Teams“. `server/public/js/viewRegistry.js`
   zeichnet die Turnierseite dann ohne `inSection(...)`, sonst wirft `renderSectionShell` „Kein
   Bereich für Ansicht tournaments“. Match und Turnierseite bekommen passende Seitenüberschriften.
   In `server/public/js/sectionNav.js` kommt `tournaments → matchmaking` in `NAV_PARENT_BY_VIEW`
   (wie `myStats → profile`); am Desktop steht es schon in `DESKTOP_PARENT_BY_VIEW`
   (`server/public/js/bottomNav.js`).
2. **Karte „Laufende Turniere“** ganz oben auf der Match-Seite, nur wenn mindestens ein Turnier
   läuft. Eine Zeile je Turnier: Name, Format, Fortschritt „X/Y Partien“, Badge „Läuft“, Pfeil; ein
   Tipp öffnet die Turnierseite. Die Karte steht **außerhalb** der frühen Abbrüche in
   `renderMatchmaking`: Sie bleibt über der Ansicht eines laufenden Captain Drafts sichtbar und wird
   auch beim Leerzustand ohne Katalogspiele gezeigt.
3. **Verlässliche Turnierdaten.** Heute lädt `server/public/js/aktuellStatus.js` Turniere, Essen und
   Arcade mit einem gemeinsamen `Promise.all`; scheitert eine Anfrage, werden alle drei Listen leer.
   Turnierdaten werden unabhängig davon bereitgestellt. Match lädt sie bei `tournaments:changed`,
   Wiederverbinden und Eventwechsel neu (eigener Eintrag im View-Lifecycle, `app.js` zeichnet Match
   bei diesem Ereignis neu). Ein Ladefehler wird von „keine Turniere“ unterschieden und lässt ein
   bereits angezeigtes Turnier nicht verschwinden. Zu prüfen: Erstellen, Ergebnis, Korrektur,
   Abschließen, Löschen, Wiederverbinden, Eventwechsel. Beim Löschen wird die Verknüpfung der
   Auslosung auf null gesetzt; der Eintrag erscheint dann wieder als normales Match ohne Ergebnis.
   Ein Link auf ein gelöschtes Turnier zeigt einen verständlichen Hinweis.
4. **Turnierseite** (`#tournaments/<id>`) bleibt mit Deep Links, Push- und Suchlinks sowie
   Browser-Zurück/Vorwärts erreichbar. **Kein Zurück-Knopf.** Titel, „Löschen“, Meta-Zeile,
   „Aktive Lobbys“, Turnierbaum bzw. Tabellen und die Teams-Karte bleiben.
5. **`#tournaments` und `#tournaments/new`** ohne ID leiten auf `#matchmaking` um (mit `replace`,
   damit keine Zurück-Schleife entsteht). „Turnier anlegen“ entfällt; Turniere entstehen weiter nur
   aus einer Auslosung.
6. **Home „Aktuell“** öffnet ein laufendes Turnier direkt. Dafür reicht eine ID nicht: Home übergibt
   Ziele heute als `searchTarget`, die Turnierseite braucht eine `localRoute` (Handler in
   `server/public/js/app.js`). Beides ausdrücklich verdrahten.
7. **Suche:** Der statische Eintrag „Turniere“ in `viewManifest.js` entfällt oder führt zu Match;
   einzelne Turniere bleiben in der Suche.
8. Kommentare, die den Tab erwähnen (`app.js`, `sectionNav.js`), anpassen.

## Teil 4: Dokumentation und Prüfungen

- **Dokumentation im selben PR:** `server/DESIGN_SYSTEM.md` (Regel 11: Auswahl, dann Speichern),
  `docs/product/competition-and-game-rules.md` (Team formation, „Historie“, Ergebnis-Dialog,
  „Tournament overview“), `docs/product/navigation-and-account-rules.md` (Bereich-Tabs
  „Teams+Turniere“), betroffene Komponentenverträge und `component-registry.mjs`; neue Bausteine
  nach `_contract-template.md`.
- **Tests** zuerst an vorhandener Abdeckung ausrichten, dann risikobasiert ergänzen
  (`server/TESTING.md`). Bestehende API-Tests zu Freilosen, Gleichständen und Korrekturen
  (`server/src/test/api.tournaments.test.ts`) weiterverwenden. Zusätzlich abdecken:
  - Platz aus Punkten inkl. Gleichstand; Sieger-/Punkte-Validierung; K.-o. ohne Unentschieden
  - Siegerwahl ohne Punkte bei mehreren Teams; Frei-für-alle mit mehr als sechs Personen
  - Historie: Filter serverseitig vor der Begrenzung, „Ältere laden“, „Ohne Ergebnis (n)“,
    Sortierung ohne Änderung der Indizes für Bearbeiten/Rematch
  - Draft-Snapshot der Skill-Werte; alte Drafts ohne Snapshot
  - Finale-Zeile bei einem K.-o.-Spiel; 3 K.-o.-Teams mit Freilos; noch nicht erzeugte K.-o.-Phase;
    Korrektur eines Halbfinals mit zurückgesetztem Finale
  - Navigation ohne Turnier-Tab, Umleitung von `#tournaments` und `#tournaments/new`,
    Detail-/Push-/Suchlinks, Home „Aktuell“, laufender Draft und laufendes Turnier gleichzeitig,
    gelöschtes Turnier
  - Tastatur, Touch und Screenreader für Auswahl, Punktefelder, Aufklappen und Filter
- **Visuelle Prüfung:** Die Szene mit den Match-Tabs in
  `server/src/test/e2e/visualCore.e2e.test.ts` fachlich ersetzen, nicht nur neue Bilder übernehmen.
  Geänderte Referenzen wie in PR #662 über die CI-Ist-Stände übernehmen.
- **Pflichtprüfungen** aus `server/public/AGENTS.md`: `npm run lint`, `npm run build`, `npm test`,
  `npm run check:tokens`, `npm run test:e2e`. Änderungen an gemeinsamen Shell-/CSS-Dateien brauchen
  zusätzlich den bestehenden Arcade-Smoke-Test.

## Bewusst nicht Teil dieses PRs

- Rangfolge per Drag & Drop oder ein Feld „Platz“.
- „Weniger ist besser“ in jeder Form.
- Verwerfen nicht genutzter Auslosungen auf dem Server.
- Ein eigenes Turnierarchiv außerhalb der Historie.
- Änderungen am TV-Kiosk und an der Ranglisten-Wertung.

## Abnahme

- Match, Turnier und Admin-Auswertung nutzen denselben Formularbaustein; jede Eingabe speichert erst
  mit „Speichern“, das kompakt rechts steht.
- Bei 2 bis 6 Teams sieht der Punktestand gleich aus; Plätze erscheinen live und stimmen nach dem
  Speichern mit der Historie überein.
- Die Historie ist einklappbar, nennt im Kopf immer das Siegerteam, zeigt Rematch und Stift im Kopf,
  nur Team-Skill, „Ohne Ergebnis (n)“, den Filter „Alle | Matches | Turniere“ und „Ältere laden“.
  Alle Turniere eines Spiels sind über den Filter erreichbar.
- Neue Captain Drafts zeigen ihren damaligen Team-Skill; alte zeigen keinen.
- Eine K.-o.-Runde mit einem Spiel erscheint als Spielzeile „Finale“.
- Es gibt keinen Turnier-Tab und keinen Zurück-Knopf; laufende Turniere stehen oben auf der
  Match-Seite, auch während eines Drafts; alte Links und Home „Aktuell“ führen direkt zum Turnier.
- Es kommen keine neuen Farben hinzu; alle Pflichtprüfungen und der Arcade-Smoke-Test laufen grün.
