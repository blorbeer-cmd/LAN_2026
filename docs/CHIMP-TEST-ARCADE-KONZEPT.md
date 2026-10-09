# Konzept: Chimp Test im Arcade-Bereich

Stand: 9. Oktober 2026

**Implementierungsstand:** Nur Konzept. Es gibt noch keinen Code für dieses Spiel.

## 1. Kurzfazit

Der Chimp Test passt gut in den Arcade-Bereich. Die Regeln sind in wenigen Sekunden erklärt, eine
Runde dauert meist nur ein bis drei Minuten, und am Handy funktioniert das Spiel ebenso gut wie am
Laptop. Weil jede Person für sich spielt, blockiert ein langsamer oder getrennter Client niemanden.

Empfohlen wird ein **Parallelrennen für 1–15 Personen**:

- Alle starten gleichzeitig nach dem gemeinsamen Arcade-Countdown.
- Jede Person spielt ihr eigenes Raster mit den bekannten Regeln: Start mit 4 Zahlen, pro
  geschafftem Level eine Zahl mehr, nach drei Fehlversuchen („Strikes“) ist der Lauf vorbei.
- Alle sehen live, welches Level die anderen erreicht haben und wie viele Strikes sie haben, aber
  nie deren Raster.
- Es gewinnt, wer die meisten Zahlen geschafft hat. Bei Gleichstand gewinnt, wer weniger Strikes
  hat, danach wer weniger aktive Spielzeit gebraucht hat.

Als Name wird **„Chimp Test“** vorgeschlagen, weil das Spiel unter diesem Namen bekannt ist. Der
interne Schlüssel ist `chimp`. Wir übernehmen weder Grafiken noch Texte noch die Marke von
Human Benchmark; Raster, Kacheln und Effekte entstehen im vorhandenen Respawn-Designsystem.

Das Spiel braucht kein neues Framework und keine neue Produktionsabhängigkeit. Lobby, Ready-Status,
Scope, Countdown, Live-Tracking, Ergebnisse, Zuschauer und Kiosk lassen sich aus den bestehenden
Arcade-Bausteinen übernehmen. Ein Mini-Ableger als zusätzliche Challenge-Rush-Aufgabe ist danach
mit wenig Aufwand möglich.

---

## 2. Recherche

### 2.1 Herkunft: die Kyoto-Studie von 2007

Der Test geht auf eine Studie von Sana Inoue und Tetsuro Matsuzawa am Primate Research Institute
der Universität Kyoto zurück (*Current Biology* 17(23), 2007). Getestet wurden sechs Schimpansen,
drei Mutter-Kind-Paare, auf einem Touchscreen:

- **Maskierungsaufgabe:** Die Ziffern 1–9 erscheinen an zufälligen Stellen. Sobald die erste Zahl
  berührt wird, werden alle übrigen zu weißen Quadraten. Diese müssen in aufsteigender
  Reihenfolge angetippt werden. Die Ratewahrscheinlichkeit sinkt schnell: 1/24 bei vier Zahlen,
  1/120 bei fünf, 1/362.880 bei neun.
- **Limited-Hold-Aufgabe:** Die Zahlen sind nur eine feste, kurze Zeit sichtbar (etwa 650, 430 oder
  210 ms) und werden dann automatisch verdeckt.

Der junge Schimpanse Ayumu blieb auch bei der kürzesten Anzeige bei rund 80 Prozent Trefferquote.
Untrainierte Studierende fielen dort auf etwa 40 Prozent.

Bekannt wurde der Test durch Videos von Ayumu. Eines davon stammt aus der britischen TV-Sendung
„Extraordinary Animals“, in der Ayumu gegen den Gedächtnismeister Ben Pridmore antrat. Später
wurde der Vergleich kritisiert: Ayumu hatte sehr viel trainiert, die Menschen gar nicht. In
Folgestudien erreichten trainierte Menschen Ayumus Niveau oder übertrafen es (Silberberg & Kearns
2009, Cook & Wilson 2010). Für ein Partyspiel ist das unerheblich. Der Vergleich „Bist du besser
als ein Schimpanse?“ ist aber genau der Reiz, der den Test bekannt gemacht hat.

Quellen:

- [Inoue & Matsuzawa 2007, *Current Biology* (PDF-Archiv)](https://www.gwern.net/docs/www/www.cell.com/566764ff1ec0be394841f7c1ef51d8604468abe4.pdf)
- [ScienceNews: Chimp Champ – Ape aces memory test](https://www.sciencenews.org/?p=2432)
- [Scientific American: Champ Chimp](https://www.scientificamerican.com/article/champ-chimp/)
- [Silberberg & Kearns 2009 (PDF)](https://Www.Gwern.net/doc/algernon/2009-silberberg.pdf)
- [Cook 2010 (PDF)](https://www.Gwern.net/doc/algernon/2010-cook.pdf)
- [Jason Collins: Humans 1, Chimps 0 – Correcting the Record](https://jasoncollins.blog/posts/humans-1-chimps-0-correcting-the-record)

### 2.2 Die virale Online-Variante (Human Benchmark)

Bekannt ist der Test heute vor allem durch den „Chimp Test“ auf Human Benchmark und seine vielen
Nachbauten. Dort gilt:

1. Das Level beginnt mit **4 Zahlen** auf zufälligen Feldern eines Rasters.
2. Die Zahlen bleiben sichtbar, **bis das erste Feld angeklickt wird**. Die Zeit zum Einprägen ist
   also frei. Das ist der wichtigste Unterschied zur Limited-Hold-Aufgabe.
3. Ab dem ersten Klick sind alle übrigen Felder verdeckt und werden in aufsteigender Reihenfolge
   angeklickt.
4. Ist das Level geschafft, folgt eins mit **einer Zahl mehr**.
5. Ein falscher Klick bricht das Level ab und kostet einen **Strike**. Danach wird dieselbe Anzahl
   mit neuer Anordnung wiederholt.
6. Nach **drei Strikes** ist der Test vorbei. Ergebnis ist die höchste geschaffte Zahlenanzahl.
7. Zwischen zwei Levels zeigt ein Zwischenbildschirm Zahlenanzahl und Strikes mit einem
   „Weiter“-Button.

Nachbauten nennen meist ein Raster mit **8 Spalten und 5 Zeilen**, also höchstens 40 Zahlen. Die
offizielle Seite war aus dieser Umgebung nicht erreichbar. Rastergröße und Obergrenze sind deshalb
nur über Nachbauten belegt und werden für Respawn als eigene Festlegung behandelt (siehe 3.1).
Angaben zu Durchschnittswerten gehen je nach Seite weit auseinander. Sie sind nicht verlässlich und
werden im Spiel nicht als Vergleich angezeigt.

Quellen:

- [Human Benchmark – Chimp Test (Originalseite)](https://humanbenchmark.com/tests/chimp)
- [BenchMyBrain – Chimp Test (Raster mit 8 Spalten, bis zu 40 Feldern)](https://benchmybrain.com/chimp)
- [Rulergame – abweichende Variante mit 6×6-Raster und fünf Sekunden Merkzeit](https://www.rulergame.net/chimp-test.php)

### 2.3 Was den Test ausmacht

| Merkmal | Bedeutung für Respawn |
| --- | --- |
| Eine einzige Regel: „Klick die Zahlen der Reihe nach“ | Kein Tutorial nötig; ein Satz im Hilfe-Popover genügt. |
| Selbstbestimmte Merkzeit bis zum ersten Klick | Abwägung zwischen Tempo und Sicherheit; kein Zeitdruck für Einsteiger. |
| Schnell steigender Schwierigkeitsgrad | Kurze Runden, typischerweise wenige Minuten pro Person. |
| Drei Strikes statt sofortigem Aus | Ein einzelner Fehlklick beendet den Spaß nicht. |
| Eindeutige Zahl als Ergebnis („Ich habe 12 geschafft“) | Leicht vergleichbar, sorgt für Gesprächsstoff im LAN-Raum. |
| Vergleich mit dem Schimpansen | Ein Gag, den das Ergebnis aufgreifen kann. |

### 2.4 Bewertete Integrationsoptionen

| Kriterium | A: eigenes Spiel, Parallelrennen | B: nur Challenge-Rush-Aufgabe | C: rundenbasiertes Duell |
| --- | --- | --- | --- |
| Nähe zum bekannten Test | sehr hoch | gering, da 30-Sekunden-Fenster | mittel |
| Wartezeit für andere | keine während des eigenen Laufs | keine | hoch, weil immer nur eine Person spielt |
| Spielerzahl | 1–15 | wie Challenge Rush | genau 2 |
| Aufwand | mittel | gering | mittel |
| Eigene Rangliste | ja | nein, geht in Challenge Rush auf | ja |

Empfehlung: **Option A** als neues Spiel. Option B ist eine sinnvolle, günstige Ergänzung, sobald
die Logik aus A existiert (Etappe 2). Option C bietet gegenüber A keinen Vorteil.

---

## 3. Spielregeln für Respawn

### 3.1 Grundregeln

- Raster: **40 Felder**. Am Laptop 8 Spalten × 5 Zeilen, im Hochformat am Handy 5 Spalten × 8
  Zeilen. Die Spielregeln hängen nicht von der Rasterausrichtung ab: Der Server vergibt Feldindizes
  0–39, der Client ordnet sie je nach Viewport nur unterschiedlich an.
- Start mit **4 Zahlen**. Nach jedem geschafften Level kommt eine Zahl dazu, bis höchstens 40.
- Die Zahlen bleiben sichtbar, bis das Feld mit der **1** angeklickt wird. Ein Klick auf ein anderes
  Feld vor der 1 ist ein Fehlklick.
- Nach dem ersten richtigen Klick sind alle übrigen Zahlen verdeckt. Bereits richtig geklickte
  Felder verschwinden.
- Ein Fehlklick kostet einen Strike, deckt kurz die richtige Lösung auf und wiederholt dasselbe
  Level mit neuer Anordnung.
- Nach **3 Strikes** ist der Lauf beendet. Ein Klick auf ein leeres Feld zählt nicht als Fehlklick.
  So kostet ein Fehltipp neben einer Kachel am Handy keinen Strike.
- Ergebnis eines Laufs ist das **höchste geschaffte Level**, also die Zahlenanzahl. Wer schon an
  4 Zahlen scheitert, hat Ergebnis 0.

### 3.2 Parallelrennen mit mehreren Personen

- Nach dem gemeinsamen Countdown „3 · 2 · 1 · Los!“ spielen alle gleichzeitig und unabhängig
  voneinander.
- **Eigene Anordnung pro Person.** Im LAN-Raum sitzen Leute nebeneinander. Bei gleichen Rastern
  könnte jemand, der hinterherhängt, das Level am Nachbarbildschirm schon einmal sehen. Jede Person
  erhält deshalb eine eigene, aus Match-Seed und Spieler-ID abgeleitete Zufallsfolge. Gleich viele
  zufällig verteilte Zahlen sind praktisch gleich schwer.
- Zwischen zwei Levels erscheint wie im Original ein kurzer Zwischenbildschirm mit „Weiter“. Jede
  Person bestimmt ihr Tempo selbst und wartet nie auf andere.
- Wer ausgeschieden ist, sieht die Live-Rangliste der übrigen Personen bis zum Matchende.
- Das Match endet, wenn alle Läufe beendet sind oder das Zeitlimit erreicht ist (siehe 3.3).
- Platzierung: höchstes Level, dann weniger Strikes, dann weniger aktive Spielzeit. Als aktive Zeit
  zählt die Zeit vom Anzeigen eines Levels bis zu dessen Abschluss. Zwischenbildschirme und Pausen
  zählen nicht.
- Sieg: Platz 1 ohne Gleichstand nach allen drei Kriterien. Ist auch die Zeit gleich, ist das Match
  unentschieden, wie bei Challenge Rush.

### 3.3 Zeitgrenzen und Sonderfälle

- **Kein Merkzeit-Limit** im Classic-Modus. Das ist der Kern des viralen Tests.
- **Inaktivität:** 60 Sekunden ohne Klick innerhalb eines Levels zählen als Strike. Der Server
  prüft das, damit kein liegengelassenes Handy das Match endlos offenhält. Am Zwischenbildschirm
  geht es nach 30 Sekunden automatisch weiter.
- **Match-Zeitlimit:** 10 Minuten. Danach endet das Match, und offene Läufe werden mit dem bis dahin
  geschafften Level gewertet. Bei 40 Zahlen wird diese Grenze praktisch nie erreicht. Sie dient nur
  als Schutz für die Serverressourcen.
- **Disconnect:** Der Lauf pausiert für diese Person. Kommt sie innerhalb von 15 Sekunden zurück,
  geht es mit einer neuen Anordnung desselben Levels weiter, ohne Strike, damit niemand die
  Merkzeit über einen Reconnect verlängert. Ohne Rückkehr endet ihr Lauf mit dem bis dahin
  geschafften Level. Für alle anderen läuft das Match unverändert weiter.
- **Pause durch den Host:** Wie bei den bestehenden Spielen pausiert sie alle Läufe. Ein laufendes
  Level wird danach mit neuer Anordnung ohne Strike neu gestartet.
- **Serverneustart:** Der flüchtige Match-State verfällt wie bei allen Arcade-Spielen. Es wird
  kein unvollständiges Ergebnis gespeichert.

### 3.4 Spätere Variante „Blitz“ (nicht im MVP)

Als Anlehnung an die Limited-Hold-Aufgabe der Originalstudie: Die Zahlen verschwinden nach einer
festen Zeit automatisch, zum Beispiel 1.000 ms und mit steigendem Level immer weniger. Der Modus
wird beim Öffnen der Lobby gewählt und gesondert in der Rangliste geführt. Er kommt erst, wenn sich
der Classic-Modus auf der LAN bewährt hat.

---

## 4. Lobby- und UI/UX-Konzept

### 4.1 Einstieg im Arcade-Launcher

- Neue Spielkarte „Chimp Test“ mit einem lokalen Lucide-Icon (Vorschlag: `banana`, sonst
  `grid-3x3`) und dem üblichen Badge „… offen“.
- Hilfe-Popover neben dem Titel mit genau drei Zeilen: „Merke dir die Zahlen. Klick die 1 – dann
  werden alle anderen verdeckt. Klick den Rest in der richtigen Reihenfolge. Drei Fehler und du bist
  raus.“
- Keine Moduswahl im MVP. Der Button „Lobby öffnen“ öffnet direkt eine Lobby. `modes: null` in
  `arcadeGames.js`, wie bei Challenge Rush.

### 4.2 Lobbykarte

- Lineare Spielerliste mit den vorhandenen Lobby-Primitiven und Belegung `n/15`.
- Bereitschaft über den bestehenden „Bereit? / Bereit“-Schalter. Der Host gilt als bereit.
- Start ist ab 1 Person möglich, wenn alle bereit sind. Neben einem deaktivierten Start nennt der
  Warn-Hilfe-Trigger den Grund, zum Beispiel „Alex ist noch nicht bereit“.

### 4.3 Spielansicht

#### Raster

- Semantisches CSS-Grid aus `<button>`-Elementen, kein Canvas. Das bringt sichtbaren
  Tastaturfokus und saubere Touch-Ziele.
- Handy (Hochformat, ab 360 px Breite): 5 Spalten, Kacheln mindestens 52×52 CSS-Pixel, das
  vollständige Raster passt ohne Scrollen auf den Bildschirm.
- Laptop: 8 Spalten, Kacheln quadratisch und auf eine gut lesbare Maximalgröße begrenzt.
- **Sichtbare Zahl:** große, kontrastreiche Ziffer auf neutraler Fläche.
- **Verdeckt:** einheitlich gefüllte Kachel in der Akzentfarbe aus den Design-Tokens, ohne jeden
  Hinweis auf die Zahl.
- **Erledigt oder leer:** unsichtbar, aber das Rasterfeld bleibt bestehen, damit nichts verrutscht.
- **Fehlklick:** Die angeklickte Kachel wird markiert, die richtige Lösung wird für etwa
  1,5 Sekunden mit Zahlen aufgedeckt, zusätzlich zur Farbe auch mit Text („Falsch – die 5 war
  hier“).
- Animationen sind kurz und respektieren `prefers-reduced-motion`.

#### Statusleiste über dem Raster

- Links: „Level 9 · 9 Zahlen“. Rechts: Strikes als drei Symbole mit Textalternative („1 von 3
  Strikes“).
- Darunter eine kompakte Live-Liste der anderen Personen mit Level, Strikes und Status
  („spielt“, „raus“, „getrennt“). Am Handy einklappbar, am Laptop als schmale Seitenspalte.

#### Zwischenbildschirm

- „9 Zahlen geschafft“ oder „Strike 2 von 3“ in großer Schrift, darunter der primäre Button
  „Weiter“, auch per Enter oder Leertaste. Der Button sitzt dort, wo vorher das Raster war, damit
  der Daumen nicht weit wandern muss.

#### Tastatur

- Pfeiltasten bewegen den Fokus im Raster, Enter oder Leertaste klicken. Der Fokus verrät keine
  verdeckte Zahl, weil Fokusreihenfolge und `aria-label` nur Zeile und Spalte nennen.
- Zugänglichkeit mit Augenmaß: Der Test prüft visuelles Gedächtnis und ist deshalb nicht ohne
  Sehvermögen spielbar. Alle Bedienelemente rundherum (Lobby, Status, Ergebnis) bleiben aber voll
  zugänglich.

### 4.4 Ergebnisansicht

- Die vorhandene Ergebnisstruktur mit Platzierung, Level, Strikes und aktiver Zeit.
- Ein kleiner Gag als Untertitel, angelehnt an den viralen Ursprung, zum Beispiel ab 9 Zahlen:
  „Ayumu wäre beeindruckt“. Rein kosmetisch und ohne Bewertungsanspruch.
- „Nochmal“ nutzt den vorhandenen Rematch-Baustein (`rematch.js`).

### 4.5 Zuschauer und Kiosk

Zuschauer könnten im LAN-Raum Positionen zurufen. Watch- und Kiosk-Ansicht zeigen deshalb **nie
das Raster eines laufenden Levels**, sondern nur:

- die Rangliste mit Level, Strikes, Status und gegebenenfalls Fortschritt im aktuellen Level
  („6/11 geklickt“),
- ein großes „Level 14!“ als Hervorhebung, wenn jemand einen neuen Matchbestwert erreicht.

Der Server erzeugt dafür einen eigenen, bereinigten Zuschauer-State. Positionen und Zahlen gelangen
nie in diesen Payload.

---

## 5. Technisches Konzept

### 5.1 Wiederverwendbare Bausteine

| Bestehender Baustein | Nutzung |
| --- | --- |
| `lobbyMembership.ts` | Verhindert, dass jemand gleichzeitig in mehreren Arcade-Lobbys ist. |
| `lobbyReady.ts`, `public/js/arcade/lobbyReady.js` | Bereitschaft in der linearen Lobby. |
| `lobbyPush.ts` | Push-Hinweis „Lobby offen“. |
| `scope.ts` | Gruppen- und Event-Isolation, Identitätsprüfung aller Socket-Aktionen. |
| `arcadeData.ts` | Ergebnis-Snapshot und Teilnehmerpersistenz. |
| `arcadeTracking.ts` | Live-Status „spielt Chimp Test“ und Spielzeit. |
| `countdown.js`, Pause/Ende, `rematch.js`, Watch-Liste | Gleiches Verhalten wie bei den bestehenden Spielen. |
| `seededRandom`/`shuffled` aus `challengeRushLogic.ts` | Deterministische Anordnungen. Bei Bedarf in ein kleines gemeinsames Arcade-Hilfsmodul verschieben statt kopieren. |
| Challenge-Rush-Server (`challengeRush.ts`) | Vorlage für parallele, voneinander unabhängige Läufe mit Fortschritt pro Person, Reconnect-Frist und serverseitigem Phasentimer. |

### 5.2 Neue Module und Integrationspunkte

Neu:

- `server/src/arcade/chimpLogic.ts`: reine Logik für Anordnung pro Level und Versuch, Prüfung von
  Klicks, Level- und Strike-Fortschritt, Platzierung und Siegerermittlung.
- `server/src/arcade/chimpLogic.test.ts`: schnelle Unit-Tests der Spiellogik.
- `server/src/arcade/chimp.ts`: Lobby-, Match-, Timer-, Disconnect- und Socket-State.
- `server/public/js/arcade/views/chimp.js`: Lobbykarte, Raster, Zwischenbildschirm und Ergebnis.

Gezielt erweitern:

- `server/src/index.ts`: Socket-Modul registrieren.
- `server/src/routes/arcade.ts`: Lobbyaggregation, Spieltitel und Statistik für `chimp`.
- `server/public/js/arcade/arcadeGames.js`: Eintrag `{ id: 'chimp', name: 'Chimp Test', … }`.
- `server/public/js/arcade/views/arcade.js` und `server/public/js/app.js`: Spielkarte, Lobby- und
  Engaged-Game-Zuordnung, Matchansicht registrieren.
- `server/public/js/icons.js`: lokales Icon ergänzen.
- `server/public/css/arcade.css`: tokenisierte Raster- und Kachelregeln, responsive Spaltenzahl.
- Watch- und Kiosk-Renderer: nur der bereinigte Zuschauer-State.

Die Arcade-Grenzen bleiben gewahrt. Es gibt keine neue Kopplung an DB-, Realtime-, App-Shell- oder
Basis-CSS-Module außer den üblichen Registrierungspunkten, über die auch die anderen Spiele
eingebunden sind.

### 5.3 Zustandsmodell

```text
Lobby
  -> Countdown
  -> Lauf pro Person (parallel):
       Merken (Zahlen sichtbar)
         -> erster richtiger Klick -> Eingabe (verdeckt)
              -> alle richtig -> Zwischenbildschirm (Level +1) -> Merken
              -> Fehlklick    -> Aufdecken -> Zwischenbildschirm (Strike) -> Merken | Aus
  -> Ergebnis (alle aus oder Zeitlimit)
```

Server-State pro Person:

- Level (aktuelle Zahlenanzahl), Strikes, höchstes geschafftes Level,
- aktuelle Anordnung: Feldindex je Zahl, Anzahl geklickter Zahlen und Phase
  (`memorize | input | interstitial | out`),
- Versuchszähler pro Level für die deterministische Anordnung,
- aktive Zeit (Summe abgeschlossener Levels plus laufendes Level) und Zeitpunkt der letzten Eingabe,
- Socket, Verbindungsstatus und Reconnect-Timer.

### 5.4 Socket-Vertrag

| Event | Richtung | Zweck |
| --- | --- | --- |
| `chimp:lobbies` | S→C | Für den Scope sichtbare Lobbys mit Belegung und Ready-State. |
| `chimp:lobby:create` / `join` / `leave` / `ready` / `start` | C→S | Lobbyverwaltung wie bei Challenge Rush. |
| `chimp:state` | S→C | Personalisierter Zustand: eigenes Level, Phase und Raster sowie die öffentliche Rangliste. |
| `chimp:click` | C→S | `{ matchId, playerId, levelToken, cell }` – ein Klick auf Feldindex 0–39. |
| `chimp:continue` | C→S | Zwischenbildschirm bestätigen und nächstes Level anfordern. |
| `chimp:standings` | S→C | Öffentliche Rangliste bei jeder Änderung von Level, Strike oder Status. |
| `chimp:match:*` | beide | Pause, Fortsetzen, Verlassen, Beenden und Abschluss. |

Details:

- **Zahlen nur in der Merkphase.** `chimp:state` enthält die Zahlen nur, solange die Person das
  aktuelle Level noch nicht begonnen hat. Ab dem ersten richtigen Klick sendet der Server nur noch
  die verdeckten Feldindizes ohne Zuordnung. Der Client verwirft seine Zahlen-Zuordnung beim
  Übergang, damit sie nicht im DOM bleibt.
- **Optimistisches UI.** Der Client blendet eine angeklickte Kachel sofort aus und wartet nicht auf
  das Ack, damit sich schnelle Klickfolgen im LAN flüssig anfühlen. Der Server entscheidet über
  richtig, falsch und das Levelende. Bei einer Abweichung überschreibt der nächste `chimp:state`
  die Ansicht.
- **`levelToken`** ist eine zufällige ID pro Level-Versuch. Verspätete oder doppelte Klicks aus
  einem bereits beendeten Versuch werden ignoriert und nie als Strike gewertet.
- Jede Mutation hat ein Ack mit `ok` und einer deutschen Fehlermeldung. Der Server prüft Identität,
  Scope, Mitgliedschaft, Phase, Token und Feldindex (Ganzzahl zwischen 0 und 39) jedes Mal neu.

### 5.5 Manipulationsschutz – ehrliche Einordnung

Die Zahlen müssen zum Einprägen beim Client angezeigt werden. Ein manipulierter Client könnte sie
also behalten. Vollständig verhindern lässt sich das nicht. Für eine LAN unter Freunden reicht die
gleiche Schutzstufe wie bei den übrigen Arcade-Spielen: Der Server ist für Ablauf und Wertung
maßgeblich, Klicks werden einzeln geprüft, und Zuschauer- und Kiosk-Payloads enthalten keine
Positionen. Eine Plausibilitätsgrenze erkennt offensichtliche Automatisierung, etwa ein ganzes
Level mit 20 Zahlen in unter 0,5 Sekunden ab dem ersten Klick. Solche Läufe werden als
„ungültig“ gewertet und nicht in die Rangliste übernommen.

### 5.6 Ergebnisse und Statistiken

- `recordArcadeResult({ gameType: 'chimp', … })` mit Score-Snapshots pro Person:
  `{ playerId, name, mode: 'arena', placement, level, strikes, activeMs, outcome }`.
- In der Statistik läuft das Spiel als Arena-Modus. Die vorhandene Sortierung nach Siegen, Top-3,
  durchschnittlicher Platzierung usw. passt ohne Schemaänderung. Statt Knockouts ist das höchste
  Level der sinnvollere letzte Gleichstandsbrecher. Das wäre eine kleine, spielspezifische
  Ergänzung in `routes/arcade.ts`.
- **Solo-Läufe** (1 Person) würden nach heutiger Logik als Sieg zählen und die Siegquote verzerren.
  Das betrifft heute schon Challenge Rush. Vorschlag: Solo-Läufe zwar speichern, aber nicht in
  Siege, Niederlagen oder Platzierungen einrechnen. Persönliche Bestwerte zeigt nur die
  Chimp-Ansicht an. Siehe offene Entscheidung 2.

---

## 6. Umsetzung in Etappen

### Etappe 1 – Classic-Parallelrennen (empfohlenes MVP)

- `chimpLogic.ts` mit Unit-Tests.
- Lobby (1–15 Personen), Countdown, parallele Läufe, Inaktivitäts- und Match-Zeitlimit,
  Disconnect- und Reconnect-Behandlung, Pause und Ende.
- Responsive Spielansicht für Handy und Laptop, Zwischenbildschirm, Ergebnis und Rematch.
- Arcade-Karte, Lobbyübersicht, Live-Tracking, Statistik, bereinigter Watch- und Kiosk-State.

### Etappe 2 – Ergänzungen nach LAN-Feedback

- **Challenge-Rush-Aufgabe „Affentest“**: ein 30-Sekunden-Trial mit fester, kurzer Merkzeit auf
  einem kleinen Raster. Es nutzt `chimpLogic.ts` und das vorhandene `preview`/`input`-Trial-Modell
  wie `memory-matrix`.
- **Blitz-Modus** nach 3.4 mit eigener Ranglistenzeile.

### Bewusst nicht geplant

- KI-Gegner: Bei einem Gedächtnistest nicht sinnvoll.
- Globale Online-Vergleiche oder Prozentränge: Das widerspricht dem LAN-only-Betrieb und bringt
  keinen Mehrwert.

---

## 7. Testkonzept

### Unit-Tests (`chimpLogic.test.ts`)

- Anordnung: genau n verschiedene Felder in 0–39, deterministisch für Seed, Spieler, Level und
  Versuch, unterschiedlich für verschiedene Spieler und Versuche.
- Klickfolge: richtige Reihenfolge schließt das Level ab; ein falsches Feld führt zum Strike;
  ein leeres oder bereits erledigtes Feld ist kein Fehlklick; ein Klick vor der 1 auf eine andere
  Zahl ist ein Fehlklick.
- Level +1 nach Erfolg, Wiederholung bei Strike, Aus nach 3 Strikes, Obergrenze 40.
- Platzierung und Sieg: Level, dann Strikes, dann aktive Zeit; vollständiger Gleichstand ergibt
  kein Siegerergebnis.
- Inaktivität wird als Strike gewertet; Plausibilitätsgrenze greift.

### Socket- und Integrationstests

- Start nur durch den Host und nur, wenn alle bereit sind.
- Fremde Identität, fremder Scope, Nicht-Mitglied, falsche Phase, ungültiger Feldindex und
  veralteter `levelToken` werden abgelehnt, ohne den Zustand zu verändern.
- Zwei gleichzeitige Klickpakete auf dieselbe Zahl werden genau einmal gewertet.
- Ein Disconnect beeinflusst die Läufe anderer nicht; ein Reconnect innerhalb der Frist führt
  weiter, danach endet der Lauf mit dem bis dahin geschafften Level.
- Watch-, Kiosk- und Lobby-Payloads enthalten weder Zahlen noch Positionen; `chimp:state`
  enthält die Zahlen nach dem ersten richtigen Klick nicht mehr.
- Das Ergebnis wird genau einmal gespeichert und erscheint in der Arcade-Statistik.

### E2E und UI

- Vollständiges Match mit zwei Browserkontexten: Lobby, Ready, Countdown, Level geschafft, Strike,
  Aus, Ergebnis und Statistik.
- Handy-Viewport: 5×8-Raster ohne Scrollen, Kacheln mindestens 44×44 CSS-Pixel. Laptop: 8×5.
- Tastatur: Fokusnavigation und Klick per Enter, sichtbarer Fokus.
- Lange Spielernamen, leere Lobbyliste, Fehler-Ack, Pause und `prefers-reduced-motion`.

---

## 8. Abnahmekriterien

- „Chimp Test“ ist im Arcade-Launcher ohne Erklärung auffindbar; das Hilfe-Popover erklärt die
  Regeln in drei Sätzen.
- Ein Match startet mit 1 bis 15 bereiten Personen; alle spielen gleichzeitig ohne gegenseitiges
  Warten.
- Regeln wie in Abschnitt 3: Start mit 4 Zahlen, pro Level eine mehr, 3 Strikes, Zahlen sichtbar
  bis zum ersten Klick.
- Kein Zuschauer-, Kiosk- oder Lobby-Payload enthält Zahlen oder Positionen eines laufenden Levels.
- Ein getrennter oder inaktiver Client blockiert das Match für niemanden länger als die
  festgelegten Fristen.
- Ergebnisse, Live-Tracking, Lobbyübersicht, Watch/Kiosk und Arcade-Statistik funktionieren.
- Keine neue Produktionsabhängigkeit; Lint, Build, Unit- und Integrationstests, Tokenprüfung und
  die relevanten Arcade-E2E-Tests sind grün.

---

## 9. Offene Entscheidungen

1. **Name:** „Chimp Test“ (bekannt, empfohlen) oder deutsch „Affentest“?
2. **Solo-Läufe in der Statistik:** nicht in Siege und Niederlagen einrechnen (empfohlen) oder wie
   bei Challenge Rush als Sieg zählen?
3. **Anordnung:** eigene Zufallsfolge pro Person (empfohlen, verhindert Abschauen) oder für alle
   gleich (maximale Vergleichbarkeit)?
4. **Umfang des MVP:** nur Classic (empfohlen) oder Blitz-Modus direkt mit?
