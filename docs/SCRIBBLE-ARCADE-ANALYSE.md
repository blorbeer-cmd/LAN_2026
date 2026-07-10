# Analyse: skribbl.io-Nachbau für den Arcade-Bereich

Prüfung des Spiels **skribbl.io** (Montagsmaler / Draw & Guess) mit Blick darauf, es als zweites
Arcade-Spiel neben dem Gaming-Quiz nachzubauen. Arbeitstitel: **„Scribble"**.

**Fazit vorab: Sehr gut machbar und ein idealer Kandidat für den Arcade-Bereich.** Die komplette
Lobby-, Match-, Ergebnis- und Statistik-Infrastruktur aus dem Quiz lässt sich wiederverwenden.
Neu sind im Kern drei Dinge: eine Canvas-Zeichenfläche mit Strich-Streaming über Socket.IO, ein
Rate-Chat mit Antwort-Matching (Logik existiert schon in `quizLogic.ts`) und eine Rundenschleife
mit Zeichner-Rotation, Wortwahl und Zeit-/Punktelogik. Kein Build-Step, kein Framework nötig –
alles passt in die bestehende Vanilla-JS-Architektur.

---

## 1. So funktioniert skribbl.io (Original)

- **Prinzip:** Multiplayer-Zeichnen-und-Raten. Pro Zug ist genau ein Spieler der **Zeichner**,
  alle anderen raten über den Chat.
- **Ablauf eines Zuges:**
  1. Der Zeichner bekommt **3 Wörter zur Auswahl** und wählt eines.
  2. Er hat **80 Sekunden** (einstellbar), das Wort zu zeichnen. Buchstaben/Zahlen zeichnen ist
     tabu.
  3. Die Rater tippen beliebig viele Versuche in den Chat – falsche Versuche sind für alle
     sichtbar, ein richtiger Versuch wird verdeckt („X hat das Wort erraten!") und der Spieler
     wechselt in den „hat's"-Zustand.
  4. Oben steht die **Wortlänge als Unterstriche**; mit ablaufender Zeit werden **einzelne
     Buchstaben automatisch aufgedeckt** (Hints).
  5. Der Zug endet, wenn **alle** erraten haben oder die Zeit abläuft. Danach wird das Wort
     aufgelöst und der nächste Spieler ist Zeichner.
- **Runden:** Eine Runde = jeder war einmal Zeichner. Standard sind 3 Runden, dann gewinnt die
  höchste Gesamtpunktzahl.
- **Punkte:**
  - **Rater:** je schneller erraten, desto mehr Punkte (relativ zu den anderen).
  - **Zeichner:** bekommt Punkte abhängig davon, wie viele (und wie schnell) richtig geraten
    haben – Anreiz, verständlich statt kryptisch zu zeichnen.
- **Werkzeuge:** Stiftfarben, Stiftgröße, Radierer, Füllen, Rückgängig, Alles-löschen.

Quellen: [skribbl.io](https://skribbl.io/), diverse Spielanalysen
([mechanicsofmagic.com](https://mechanicsofmagic.com/2023/04/28/critical-play-skribbl-io-17/)).

---

## 2. Passung in die bestehende Arcade-Architektur

Der Arcade-Bereich (`server/src/arcade/arcade.ts`, `server/public/js/views/arcade.js`) ist
bereits generisch genug aufgebaut:

| Baustein | Status | Anmerkung |
| --- | --- | --- |
| Lobby-System (`arcade:lobby:*`) | ✅ wiederverwendbar | `gameType`-Feld existiert schon; nur `'scribble'` zusätzlich zu `'quiz'` erlauben. Push-Benachrichtigung „Neue Lobby" gibt es schon. |
| Match-Raum via Socket.IO-Room | ✅ wiederverwendbar | Gleiches Muster: `arcade:<nanoid>`-Room, alle Lobby-Sockets joinen. |
| Ergebnis-Persistenz `arcade_results` | ✅ wiederverwendbar | Schema ist generisch (`game_type`, `winner_id`, `players`, `scores`, `reason`). Scribble-Ergebnisse landen ohne Schemaänderung darin. |
| Statistik `/api/arcade/stats` + Frontend-Tabs | ✅ fast fertig | Aggregiert bereits pro `game_type`; nur Titel-Mapping `'scribble' → 'Scribble'` ergänzen. Tabs im Frontend erscheinen automatisch, sobald ein zweiter `gameType` Ergebnisse hat. |
| Antwort-Matching (`matchesAnswer`/`normalizeAnswer`) | ✅ wiederverwendbar | Diakritika-/Groß-/Sonderzeichen-tolerant – exakt das, was der Rate-Chat braucht. |
| Pause/Fortsetzen/Beenden durch Host | ✅ Muster übernehmen | Gleiches Timer-Einfrieren wie beim Quiz (`questionRemainingMs`). |
| Quiz-Rundenschleife | ⚠️ Muster, nicht Code | `sendQuestion`/Timeout/1,4-s-Zwischenscreen ist die Blaupause für die Zug-Schleife, aber Scribble braucht mehr Phasen (Wortwahl → Zeichnen → Auflösung). |
| Disconnect-Handling | ❌ anpassen | Aktuell beendet **jeder** Disconnect das ganze Match (`player-left`). Bei 2 Quiz-Spielern okay, bei 6+ Scribble-Spielern inakzeptabel – siehe §4.5. |

**Wichtig fürs Produktziel „Zuverlässigkeit":** Der gesamte Match-State lebt wie beim Quiz im
Speicher eines einzelnen Node-Prozesses. Socket-Handler laufen single-threaded – zwei „gleichzeitige"
richtige Antworten serialisieren sich von selbst; der Erste gewinnt den Zeitstempel, der Zweite
wird normal als weiterer Rater gewertet. Ein 409-artiger Guard wie bei REST-Handlern ist hier
nicht nötig, ein `guessedAt`-Check pro Spieler (nur einmal werten) reicht.

---

## 3. Konzept für den Nachbau

### 3.1 Spielablauf (LAN-tauglich vereinfacht)

- **2–15 Spieler** pro Match (ab 3 macht es richtig Spaß, 2 als Minimum zulassen).
- Host stellt beim Start ein: **Rundenzahl** (1/2/3, Default 2) und **Zeichenzeit**
  (40/60/80 s, Default 60 – auf einer LAN sitzt man beisammen, kürzere Züge halten das Tempo hoch).
- Zeichner-Reihenfolge = Lobby-Reihenfolge, rotierend. Phasen pro Zug:
  1. **Wortwahl** (max. 15 s): Zeichner sieht 3 Wörter, alle anderen sehen „X wählt ein Wort…".
     Timeout ⇒ Zufallswort.
  2. **Zeichnen:** Countdown läuft, Rater tippen, Hints decken Buchstaben auf.
  3. **Auflösung** (~3 s): Wort + Zugpunkte für alle sichtbar, dann nächster Zug.
- Zug endet vorzeitig, sobald alle Rater richtig lagen.

### 3.2 Punktesystem (konkret)

Einfach und nachvollziehbar, keine versteckte Magie:

- **Rater:** `Punkte = ceil(300 × Restzeit / Zeichenzeit)` zum Zeitpunkt des richtigen Tipps
  (erster Tipp zählt, weitere Eingaben desselben Spielers werden ignoriert).
- **Zeichner:** `Punkte = 100 × (Anzahl richtiger Rater / Anzahl Rater)` – niemand rät ⇒ 0.
- Match-Sieger = höchste Gesamtsumme nach der letzten Runde; bei Gleichstand teilen sich die
  Spieler den Sieg (im `arcade_results`-Datensatz: `winner_id` des punktgleich Ersten, Scores
  zeigen den Gleichstand – oder `winner_id = null` und Anzeige „Unentschieden", zu entscheiden).

### 3.3 Wörter

- Analog zu `quizQuestions.ts`: eine Seed-Datei `scribbleWords.ts` mit **deutschen, LAN-/Gaming-
  affinen Wörtern** in drei Schwierigkeitsgraden (leicht: „Maus", „Pizza", „Headset"; mittel:
  „Respawn", „Lootbox"; schwer: „Tellerrand", „Lagspike"). Ziel: ≥ 200 Wörter.
- Tabelle `scribble_words` (id, word, difficulty) + `scribble_seen` (word_id, player_id, seen_at)
  nach dem Muster von `quiz_seen`, damit über 3 LAN-Tage keine Wiederholungen kommen. Die
  3er-Auswahl bevorzugt ungesehene Wörter (Wiederverwendung von `pickQuestion`-Logik, auf n=3
  verallgemeinert).
- Hints: nach 50 % der Zeit 1 Buchstabe, nach 75 % ein zweiter (bei Wörtern ≥ 6 Buchstaben).
  Aufgedeckte Positionen serverseitig würfeln und per Event pushen – nie das ganze Wort an
  Rater-Clients senden, sonst steht es in den DevTools.

### 3.4 Zeichnen über Socket.IO (der eigentliche neue Kern)

- **Frontend:** `<canvas>` mit Pointer Events (deckt Maus + Touch ab – wichtig, weil das Tool
  „Handy raus, loslegen" verspricht). Feste logische Auflösung (z. B. 800×600), per CSS skaliert,
  Koordinaten normalisiert (0–1) übertragen ⇒ jede Bildschirmgröße zeichnet dasselbe Bild.
- **Streaming:** Punkte pro Strich sammeln und **gebatcht ~30×/s** senden
  (`arcade:scribble:stroke` mit `{ color, size, points: [[x,y],…] }`), nicht pro `pointermove`.
  Im LAN völlig unkritisch (wenige KB/s), aber es hält die Event-Rate niedrig.
- **Server als Relay + Gedächtnis:** Server validiert (nur der aktuelle Zeichner darf senden,
  Werte-Ranges prüfen), broadcastet an den Room und hängt den Strich an eine `strokes[]`-Liste
  im Match-State. Damit funktionieren **Reconnect/Late-Join** (kompletter Redraw aus der Liste)
  und Rückgängig/Alles-löschen serverseitig konsistent.
- **Werkzeuge fürs MVP:** 8 Farben, 3 Stiftgrößen, Radierer (= Strich in Hintergrundfarbe),
  Alles-löschen. Füllen/Undo erst im Ausbau (Undo ist mit der Strich-Liste trivial: letzten
  Strich entfernen + Redraw-Event).
- Zeichnungen werden **nicht persistiert** – nach dem Zug ist die Strich-Liste weg. Kein
  DB-Wachstum, keine Datenschutzfragen.

### 3.5 Rate-Chat & Disconnects

- **Chat:** eigenes leichtes Match-Chat-Panel (kein globales Chat-System nötig). Falscher Tipp ⇒
  Broadcast als normale Zeile. Richtiger Tipp ⇒ nur „✅ X hat's erraten!" an alle, das Wort selbst
  wird nie gebroadcastet. Wer erraten hat, kann weiter chatten – diese Zeilen sehen nur Zeichner +
  bereits-Erratene (sonst Spoiler-Gefahr). „Knapp dran"-Feedback (Levenshtein-Distanz 1) nur an
  den Tippenden selbst.
- **Disconnects (Abweichung vom Quiz-Verhalten, wichtig):**
  - Rater weg ⇒ Match läuft weiter, Spieler wird als „offline" markiert; kommt er zurück
    (Socket-Reconnect mit gleicher `playerId`), Redraw + Scores syncen.
  - Zeichner weg ⇒ Zug wird abgebrochen („Zeichner weg, Wort war: …", niemand verliert Punkte),
    nächster Zeichner.
  - Weniger als 2 aktive Spieler ⇒ Match endet (`reason: 'player-left'`), wie bisher.
  - Das erfüllt die CLAUDE.md-Leitplanke „Fehler eines Clients dürfen nie andere beeinträchtigen"
    deutlich besser als das aktuelle Sofort-Ende und sollte perspektivisch auch fürs Quiz mit
    3+ Spielern übernommen werden.

### 3.6 Neue Socket-Events (Namensschema wie bisher)

| Event | Richtung | Zweck |
| --- | --- | --- |
| `arcade:scribble:turn` | S→C | Neuer Zug: Zeichner, Rundenzähler, Wortlänge (Unterstriche) |
| `arcade:scribble:choose` | S→Zeichner | Die 3 Wortoptionen (nur an den Zeichner-Socket) |
| `arcade:scribble:word` | C→S | Zeichner wählt Wort |
| `arcade:scribble:stroke` | C→S→C | Strich-Batch (nur Zeichner darf senden) |
| `arcade:scribble:clear` | C→S→C | Alles löschen / Undo |
| `arcade:scribble:guess` | C→S | Tipp; Server antwortet per Ack (`correct`/`close`) |
| `arcade:scribble:chat` | S→C | Chat-Zeile / „X hat's erraten" |
| `arcade:scribble:hint` | S→C | Buchstabe an Position i aufgedeckt |
| `arcade:scribble:turn-end` | S→C | Auflösung: Wort, Zugpunkte, Zwischenstand |
| `arcade:scribble:sync` | S→C | Voller State für Reconnect/Late-Join |

`arcade:match:start/end/pause/resume/paused/resumed` werden unverändert mitbenutzt.

---

## 4. Umsetzungsplan

**Phase 1 – MVP (der eigentliche Nachbau):**
Lobby-`gameType: 'scribble'`, Rundenschleife mit Wortwahl/Hints/Timer, Canvas + Strich-Streaming,
Rate-Chat, Punktesystem, Ergebnis in `arcade_results`, Stats-Titel, Wortliste (~200 Wörter),
Disconnect-Handling nach §3.5. Neue Dateien: `server/src/arcade/scribble.ts`,
`server/src/arcade/scribbleLogic.ts` (pure Logik: Punkte, Hint-Plan, Wortauswahl, Rotation –
unit-testbar), `server/src/arcade/scribbleWords.ts`, `server/public/js/views/arcade/scribble.js`
(bzw. Aufteilung von `arcade.js` pro Spiel). Geschätzt die mit Abstand größte Einzelfläche ist
das Canvas-Frontend.

**Phase 2 – Ausbau:** Undo/Füllen-Werkzeug, „Knapp dran"-Feedback, Kiosk-Ansicht (Zuschauermodus
auf dem Beamer wäre auf einer LAN ein Highlight), eigene Wörter über die Admin-UI pflegen,
Award-Anbindung („Picasso der LAN").

**Tests (gemäß CLAUDE.md):**
- Unit (`node:test`): Punktformeln, Hint-Aufdeckplan, Wortauswahl ohne Wiederholung,
  Zeichner-Rotation inkl. Spieler-Ausstieg mitten in der Runde.
- Integration: Socket-Handler-Validierung (Nicht-Zeichner sendet Stroke ⇒ abgelehnt; doppelter
  richtiger Tipp desselben Spielers wird nur einmal gewertet; Zug endet, wenn alle geraten haben).
- E2E (Playwright): ein kompletter Zug mit 2 Browsern – zeichnen, raten, Auflösung, Endstand.
- Race-Test nach dem Muster von `api.concurrency.test.ts`: zwei parallele richtige Tipps ⇒ beide
  gewertet, aber jeder nur einmal; zwei parallele `lobby:start` ⇒ genau ein Match.

**Risiken / Stolpersteine:**
- **Touch-Zeichnen:** `touch-action: none` auf dem Canvas, sonst scrollt das Handy beim Malen.
- **prefers-reduced-motion** gilt fürs UI (Countdown-Pulse etc.), nicht fürs Zeichnen selbst.
- **Wortgeheimnis:** Wort nie an Rater-Clients senden (auch nicht „versteckt" im Payload).
- **Timer-Hygiene:** pro Match mehrere Timer (Wortwahl, Zug, Hints, Auflösung) – alle in einer
  Struktur halten und bei `finishMatch`/Disconnect zentral räumen, sonst Leaks über 3 LAN-Tage.
