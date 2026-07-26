# Konzept: Mehrspieler-Varianten für Snake, Blobby Volley, Tetris und Pong

Stand: 26. Juli 2026

## 1. Kurzfazit

Mehrspieler-Varianten mit mehr als zwei gleichzeitig Spielenden sind für **Snake, Tetris und
Pong** gut belegt. Für **Blobby Volley** ist menschliches Netzwerkspiel etabliert, das offizielle
Grundspiel bleibt jedoch ein Duell mit einem Blob pro Seite. Ein Blobby-2v2 wäre deshalb keine
Übernahme eines etablierten offiziellen Modus, sondern eine eigene, gut nachvollziehbare
Respawn-Variante.

Für diese Anwendung wird folgende Auswahl empfohlen:

| Spiel | Empfohlener neuer Modus | Zulässige Spielerzahl | Teams | Einordnung |
|---|---|---:|---|---|
| Snake | Arena | 2–8 | Jeder gegen jeden | klare Mehrspielerform, hoher LAN-Nutzen |
| Tetris | Sprint-Rennen | 2–8 | Jeder gegen jeden | einfacher und fairer Einstieg ohne Angriffszielwahl |
| Tetris | Battle Royale, später | 3–8 | Jeder gegen jeden | baut auf dem vorhandenen Battle auf, benötigt aber neue Garbage-Verteilung |
| Pong | Doppel | genau 4 | 2 gegen 2 | historisch belegte Pong-Variante |
| Blobby Volley | Respawn-Doppel | genau 4 | 2 gegen 2 | eigene experimentelle Erweiterung |

Die Zahl acht ist eine Produktentscheidung für eine LAN mit ungefähr 15 Teilnehmenden: Sie
ermöglicht zwei parallele Gruppen, bleibt auf Laptop und Kiosk noch lesbar und begrenzt die
serverseitige Realtime-Last. Sie ist keine allgemeine technische Grenze der Spielideen.

## 2. Recherche

### 2.1 Snake

Multiplayer-Snake wird üblicherweise als gemeinsame Arena umgesetzt: Mehrere Schlangen sammeln
Futter, wachsen und versuchen, andere Schlangen in Körper oder Hindernisse zu lenken. Snakeling
beschreibt genau dieses Arena-Prinzip mit Futter, Kollisionen und einer gemeinsamen Rangliste.
Scales of Silence nennt darüber hinaus freie Kämpfe für bis zu acht Spielende sowie Team- und
Royale-Modi. Damit ist eine gemeinsame Snake-Arena mit 2–8 Personen keine ungewöhnliche
Neuerfindung, auch wenn die konkrete Regelwahl in Respawn eigenständig bleibt.

Quellen:

- [Snakeling – Multiplayer Arcade Snake](https://www.snakeling.com/)
- [Scales of Silence – Multiplayer Snake Party Game](https://scalesofsilence.com/)

### 2.2 Blobby Volley

Die offizielle Blobby-Volley-2-Seite belegt LAN-/Online-Multiplayer für die PC-Fassung indirekt
auch dadurch, dass dieser bei der Xbox-Fassung ausdrücklich als fehlende PC-Funktion genannt wird.
Das bekannte Spielfeld und die offizielle Spielidee bestehen aber aus genau einem Blob je Seite.
Es wurde keine belastbare offizielle Blobby-Variante mit vier gleichzeitig aktiven Blobs gefunden.

Folgerung: 2v2 ist spielmechanisch plausibel und für eine LAN attraktiv, muss in der Oberfläche
aber als **„Respawn-Doppel (experimentell)“** und nicht als bestehender offizieller Blobby-Modus
bezeichnet werden.

Quelle:

- [Blobby Volley 2 – offizielle Website](https://www.blobbyvolley.de/)

### 2.3 Tetris

Tetris besitzt mehrere belegte Mehrspielerformen. Tetris 99 setzt auf „viele Boards, eine letzte
überlebende Person“ und nennt für die lokale Arena bis zu acht Freunde. Puyo Puyo Tetris 2 erlaubt
lokal und online bis zu vier Personen. Tetris Effect: Connected zeigt außerdem, dass Tetris nicht
nur gegeneinander funktionieren muss: Dort verbinden bis zu drei Personen ihre Spielfelder in
einem kooperativen Modus.

Für Respawn ist ein paralleles Sprint-Rennen der risikoärmste erste Schritt. Alle bekommen dieselbe
Steinfolge, niemand muss auf einem kleinen Bildschirm Angriffsziele wählen, und das bestehende
serverautoritativ berechnete Board kann weiterverwendet werden. Ein Battle Royale kann danach als
zweiter Modus folgen.

Quellen:

- [Tetris 99 – offizielle Produktseite](https://tetris.com/products/video-game/tetris-99)
- [Tetris Effect: Connected – offizielle Produktseite](https://tetris.com/products/video-game/tetris-effect-connected)
- [Puyo Puyo Tetris 2 – offizielle SEGA-Produktseite](https://www.sega.jp/game/detail/puyopuyotetris2/)

### 2.4 Pong

Vier-Personen-Pong ist historisch ausdrücklich belegt. Das offizielle Atari-Handbuch zu Video
Olympics beschreibt „PONG 4“ als Doppel mit zwei Personen pro Team: Eine Person deckt die obere,
die andere die untere Spielfeldhälfte. Es beschreibt daneben „PONG 4-I“ mit Netz- und
Hinterfeldposition sowie Quadrapong mit vier Paddles an einem rechteckigen Feld.

Für Respawn passt PONG 4 am besten zum bestehenden linken und rechten Tor. Quadrapong wäre ein
interessanter späterer Modus, verlangt aber vier Tore und ein neues Wertungssystem.

Quellen:

- [Atari – Video Olympics](https://atari.com/pages/videoolympics)
- [Video-Olympics-Handbuch als HTML](https://atariage.com/manual_html_page.php?SoftwareID=1434)

## 3. Ist-Zustand im Repository

Die vier Spiele sind bereits sauber serverautoritativ und nach Spiel getrennt:

- `server/src/arcade/snake.ts` und `snakeLogic.ts`
- `server/src/arcade/tetris.ts` und `tetrisLogic.ts`
- `server/src/arcade/blobby.ts` und `blobbyLogic.ts`
- `server/src/arcade/pong.ts` und `pongLogic.ts`
- je eine zugehörige View unter `server/public/js/views/`

Alle vier Lobby-Handler lehnen aktuell den dritten Beitritt ab und der Start-Handler verlangt
exakt zwei Personen. Auch die Kernmodelle sind teilweise fest auf Tupel mit zwei Einträgen
zugeschnitten, beispielsweise `SnakeWorld.snakes`, `PongWorld.paddles`, `BlobbyWorld.blobs` und
die jeweiligen Input-Tupel.

Bereits gut wiederverwendbar sind:

- Socket.IO-Räume und serverautoritatives Ticking,
- Gruppen-/Event-Scope und serverseitige Zugriffsprüfung,
- genau eine Arcade-Lobby je Person über `lobbyMembership.ts`,
- Ready-Status, Countdown, Pause und Kiosk-/Zuschauerübertragung,
- Arcade-Tracking und grundsätzliche Speicherung beliebig vieler Teilnehmer-Snapshots.

Die wichtigste strukturelle Lücke liegt nicht in der Physik, sondern in einem gemeinsamen
**Spielmodus- und Besetzungsvertrag**. Zurzeit entscheidet jedes Spiel separat und meist nur über
`players.length`, ob Beitritt und Start erlaubt sind. Für flexible Arenen und feste Teams reicht
das nicht mehr.

## 4. Gemeinsames Zielmodell für Lobby und Spielmodus

Jeder auswählbare Modus erhält eine serverseitige Definition. Die Oberfläche darf diese Daten
anzeigen, aber niemals selbst die Startberechtigung festlegen.

```ts
interface ArcadeModeDefinition {
  gameType: 'snake' | 'tetris' | 'pong' | 'blobby';
  mode: string;
  label: string;
  minPlayers: number;
  maxPlayers: number;
  allowedPlayerCounts: number[];
  teamCount: number | null;
  playersPerTeam: number | null;
  experimental: boolean;
}

interface ArcadeLobbySeat {
  player: PlayerRef;
  teamId: string | null;
  slot: number;
  ready: boolean;
}
```

Empfohlene Definitionen für die erste Ausbaustufe:

| Schlüssel | Erlaubte Anzahl | Teamregel |
|---|---:|---|
| `snake:arena` | 2, 3, 4, 5, 6, 7, 8 | keine Teams |
| `tetris:sprint` | 2, 3, 4, 5, 6, 7, 8 | keine Teams |
| `pong:doubles` | 4 | 2 Teams mit je 2 Personen |
| `blobby:doubles` | 4 | 2 Teams mit je 2 Personen |

Serverseitig werden daraus drei getrennte Prüfungen abgeleitet:

1. **Beitritt:** Ist noch ein gültiger freier Platz vorhanden und ist die Person nicht schon in
   einer anderen Arcade-Lobby?
2. **Änderung:** Darf Modus, Einstellung oder Team noch geändert werden und müssen Ready-Zustände
   zurückgesetzt werden?
3. **Start:** Ist die Spielerzahl erlaubt, sind feste Teams vollständig und sind alle Gäste bereit?

`validateLobbyForStart(lobby)` sollte nicht nur `true/false`, sondern maschinenlesbare Gründe
liefern, etwa `missing_players`, `teams_unbalanced` und `players_not_ready`. Frontend und Tests
können daraus verständliche Hinweise erzeugen, während die Sicherheitsentscheidung beim Server
bleibt.

Weitere Regeln:

- Der Modus ist nach Beitritt des ersten Gasts gesperrt. So wird niemand unbemerkt von „2–8 frei“
  in „genau 4, 2v2“ verschoben.
- Änderungen an spielrelevanten Einstellungen setzen die Ready-Zustände aller Gäste zurück.
- Team- und Slotzuordnung sind Teil des Lobbyzustands und werden vom Server validiert.
- Jede Mutation bekommt eine monotone `revision`; verspätete Acks oder Broadcasts dürfen keinen
  neueren Zustand überschreiben.
- Der vorhandene globale Membership-Guard bleibt bestehen.
- Ein Host-Verbindungsabbruch in der offenen Lobby überträgt den Host nach kurzer Schonfrist an die
  am längsten anwesende Person, statt die ganze Lobby sofort zu löschen.

## 5. Lobby-UI/UX

### 5.0 Textprinzip

Die Lobby erklärt sich über Aufbau und Zustände, nicht über Fließtext. Sichtbar bleiben nur kurze
Modusnamen, Spielerzahlen, Teamstände, Statuswörter und Aktionen. Regeln, Sonderfälle und
Begründungen stehen ausschließlich im vorhandenen kontextuellen Info-Tooltip direkt neben der
betroffenen Überschrift oder Aktion. Auch Leer-, Lade- und Fehlerzustände verwenden höchstens
einen kurzen Satz.

### 5.1 Modus vor der Lobby wählen

Nach Auswahl einer Spielkachel erscheint oberhalb von „Lobby öffnen“ eine kleine Modusauswahl.
Jede Moduskarte zeigt direkt:

- Modusname,
- Anzahl als prägnantes Badge, z. B. **„2–8 Spieler“** oder **„genau 4 · 2 gegen 2“**,
- bei Blobby zusätzlich **„Experimentell“**.

Spielziel, Regeln und die Bedeutung von „Experimentell“ stehen im Info-Tooltip neben dem
Modusnamen. Unter der Modusauswahl erscheint kein zusätzlicher Erklärungstext.

Es gibt keinen freien Zahlen-Stepper für die Lobbygröße. Die spielbaren Kombinationen werden als
kuratierte Modi definiert; dadurch kann keine unstartbare Lobby wie „Pong 3 Spieler“ entstehen.
Die empfohlene Variante ist vorgewählt. Bei Spielen mit nur einem neuen Modus bleibt der Ablauf
ein Klick auf „Lobby öffnen“.

### 5.2 Offene Lobby in der Übersicht

Die kompakte Lobbyzeile zeigt bereits vor dem Beitritt:

`Snake · Arena` — `5/8` — `Start ab 2` — Hostname

Bei festen Teams lautet die Information beispielsweise:

`Pong · Doppel` — `3/4` — `Team Blau 2/2 · Team Pink 1/2`

„Beitreten“ ist nur deaktiviert, wenn wirklich kein gültiger Slot frei ist. Der Grund steht als
Text am Status und nicht ausschließlich in Farbe oder in einem nativen `title`.

### 5.3 Flexible Lobby für 2–8 Personen

Snake und Tetris zeigen eine fortlaufende Liste realer Mitglieder, danach genau **eine** kompakte
Zeile „Noch 3 Plätze frei“. Acht leere Einzelzeilen würden die mobile Ansicht unnötig aufblähen.
In der Kopfzeile stehen `5/8` und „Start möglich“.

Der Host sieht neben dem deaktivierten Startknopf einen live aktualisierten Warn-Tooltip:

- „Noch mindestens 1 Person erforderlich“ oder
- „2 Personen sind noch nicht bereit“.

Sobald die Mindestzahl erreicht und alle Gäste bereit sind, wird „Start“ aktiv. Der Host zählt wie
bisher automatisch als bereit.

### 5.4 Feste 2v2-Lobby

Pong und Blobby zeigen zwei klar benannte Teamflächen nebeneinander; auf schmalen Displays stehen
sie untereinander:

```text
Team Blau  2/2                 Team Pink  1/2
[Host] [Mitspieler bereit]     [Mitspieler] [Freier Platz]
```

Beim Beitritt gibt es zwei Aktionen:

- **„Automatisch zuordnen“** als primäre, schnellste Aktion; der Server wählt das kleinere Team.
- **„Team wählen“** als sekundäre Aktion; danach werden nur Teams mit freiem Platz angeboten.

Ein Wechsel ist bis zum eigenen Ready-Klick möglich. Ein Host darf „Teams ausgleichen“ auslösen,
aber keine bereits bereite Person still verschieben. Nach jeder Zuordnungsänderung wird die
betroffene Person wieder auf „nicht bereit“ gesetzt.

Der Startknopf bleibt deaktiviert, bis beide Teams exakt 2/2 und alle drei Gäste bereit sind. Ein
Warn-Tooltip direkt am Knopf nennt den knappen Grund, beispielsweise „Team Pink: 1 Platz frei“.

### 5.5 Fehler-, Verbindungs- und Barrierefreiheitszustände

- Join- und Ready-Aktionen werden während ihres Acks lokal gegen Doppelklick gesperrt.
- Ein abgelehnter Beitritt aktualisiert zuerst die Lobby und meldet knapp „Platz gerade vergeben“
  statt „Unbekannter Fehler“.
- Statusänderungen laufen über eine `aria-live`-Region; Fokus bleibt nach Realtime-Rerender auf
  der logisch gleichen Aktion.
- Spielerzahl und Teamzuordnung werden immer als Text vermittelt, nicht nur über Farbe.
- Die vorhandenen Avatar-/Namenszeilen bleiben erhalten; lange Namen dürfen die Teamaktionen nicht
  aus der Karte drücken.
- Im laufenden Match erhält ein kurz getrenntes Gerät eine Schonfrist von zehn Sekunden. Flexible
  FFA-Modi markieren die Person danach als ausgeschieden und laufen weiter; in einem 2v2 wird das
  Team erst nach Ablauf der Frist als Verlierer gewertet.

## 6. Spielkonzepte

### 6.1 Snake: Arena für 2–8

**Regeln**

- Alle Schlangen bewegen sich gleichzeitig in einem gemeinsamen Feld.
- Eine Kollision mit Wand, eigenem Körper oder einem beliebigen fremden Körper scheidet die
  Schlange für die Runde aus.
- Treffen mehrere Köpfe im selben Tick dieselbe Zelle, scheiden alle beteiligten Schlangen aus.
- Es gibt `ceil(aktive Spieler / 2)` Futterobjekte, damit größere Lobbys nicht um ein einziges
  zufälliges Ziel kreisen.
- Gespielt wird „Best of 3“: Wer zuerst zwei Runden gewinnt, gewinnt das Match. Sterben alle
  verbliebenen Schlangen im selben Tick, entscheidet zunächst die Zahl gesammelter Futterobjekte;
  bei weiterem Gleichstand wird die Runde ohne Punkt wiederholt.

**Spielfeld und Darstellung**

- 2–4 Personen: 32×20 Zellen, 5–6: 40×24, 7–8: 48×28.
- Spawnpunkte werden aus getesteten, symmetrischen Randpositionen gewählt und pro Runde rotiert.
- Farbe plus Initialen/Legende identifizieren jede Schlange; Farbe allein reicht nicht.
- Ausgeschiedene Personen bleiben in derselben Matchansicht, sehen „Ausgeschieden – nächste Runde
  startet gleich“ und können weiter zuschauen.

**Technische Änderung**

`SnakeWorld.snakes` wird vom Zweier-Tupel zur Liste. Kollisionen müssen auf einem gemeinsamen
Snapshot aller neuen Köpfe berechnet werden; die heutige Abkürzung `next[1 - index]` entfällt.
Food wird zu einer Liste. Matchende und Disconnect dürfen nicht mehr beim ersten ausgeschiedenen
Teilnehmer pauschal das gesamte Match beenden.

### 6.2 Tetris: Sprint-Rennen für 2–8

**Regeln**

- Alle Personen erhalten dieselbe serverseitig erzeugte Steinfolge.
- Standardziel sind 20 Linien; wählbar sind 10, 20 oder 40.
- Die erste Person am Linienziel gewinnt. Top-out bedeutet „ausgeschieden“, beendet das Rennen für
  andere aber nicht.
- Es wird kein Garbage versendet. Damit ist der Modus leicht verständlich, fair und unabhängig von
  einer Zielauswahl.

**Darstellung**

- Das eigene Board bleibt groß und bedienbar.
- Gegner erscheinen als kleine Boards mit Name, Linienfortschritt und Status. Auf dem Telefon sind
  sie horizontal scrollbar oder als 2-spaltige Miniaturübersicht angeordnet, ohne das eigene Board
  zu verkleinern.
- Kiosk und Zuschaueransicht zeigen alle Boards in einem responsiven Raster; bei acht Personen
  maximal vier Spalten.

**Technische Änderung**

Die vorhandene `Map<string, PlayerState>` ist bereits mehrspielerfreundlich. Angepasst werden vor
allem die Zweierannahmen beim Lobbylimit, bei `opponentState`, Garbage, Matchende und Rendering.
Der Sprint-Modus deaktiviert Garbage vollständig und beendet bei Erreichen von `targetLines`.

**Später: Battle Royale**

Für 3–8 Personen bleibt das heutige Prinzip „Linien erzeugen Garbage“ erhalten. Ein Angriff wird
aber jeweils vollständig an genau ein lebendes Ziel geschickt, das serverseitig nach jedem Angriff
deterministisch rotiert. Garbage darf nicht an alle Gegner vervielfacht werden. Letzte lebende
Person gewinnt. Manuelle Zielauswahl wird zunächst bewusst weggelassen, weil sie auf Telefonen viel
UI und einen erheblichen Balancevorteil für Absprachen erzeugt.

### 6.3 Pong: Doppel, genau 2 gegen 2

**Regeln**

- Zwei Teams verteidigen weiterhin linkes und rechtes Tor.
- Pro Team deckt eine Person die obere und eine die untere Hälfte. Eine kleine Überlappungszone in
  der Mitte erlaubt Übergaben, ohne dass beide Paddles gemeinsam das ganze Tor abdecken können.
- Jeder Treffer zählt für das Team; Punkteziel bleibt 5, 7, 10 oder 15.
- Nach jedem Punkt bleibt die obere/untere Rolle stabil. Seiten wechseln optional nach der Hälfte
  nur als späteres Komfortmerkmal.

**Darstellung und Technik**

- Vier Paddles tragen Teamfarbe plus kleines Namenskürzel.
- Eine dezente Mittellinie markiert die Zuständigkeitsbereiche.
- `PongWorld.paddles` und Input werden auf vier Einträge erweitert; jedes Paddle erhält `teamId`
  und `lane`. Die Tor- und Punktelogik bleibt teambezogen links/rechts.
- Die Bot-Funktion wird für den ersten Schritt in Doppel-Lobbys deaktiviert. Zwei sinnvoll
  kooperierende Bots wären ein eigenes Balancing-Thema.

### 6.4 Blobby Volley: Respawn-Doppel, genau 2 gegen 2

**Regeln**

- Zwei Blobs je Spielfeldhälfte, alle vier werden unabhängig gesteuert.
- Teampartner dürfen sich überlappen; Blob-zu-Blob-Kollisionen werden im ersten Prototyp bewusst
  nicht eingeführt. Das verhindert Blockieren und hält die heutige Ballphysik stabil.
- Bodenberührung vergibt wie bisher einen Punkt an die Gegenseite. Es gibt zunächst weder Rotation
  noch eine Drei-Kontakte-Regel.
- Punkteziel bleibt 5, 7, 10 oder 15.

**Darstellung und Technik**

- Teamfarbe wird durch unterschiedliche Kontur/Initiale pro Person ergänzt.
- Startpositionen liegen etwa bei 18 % und 36 % beziehungsweise 64 % und 82 % der Feldbreite.
- `BlobbyWorld.blobs` und Inputs werden auf vier Einträge erweitert; die Ballkollision iteriert
  über alle Blobs. Punktestand und Sieger werden teambezogen.
- Vor einer endgültigen Freigabe ist ein Spieltest mit vier Menschen nötig. Zu prüfen sind vor
  allem Feldbreite, Blobradius, maximale Ballgeschwindigkeit und ungewolltes Dauerjonglieren.

## 7. Ergebnisse und Statistiken

`arcade_results` besitzt derzeit nur eine einzelne `winner_id`; in
`arcade_result_participants` wird daraus genau ein `is_winner` abgeleitet. Das genügt für FFA mit
einer Siegerperson, aber nicht für 2v2.

Vor Pong- oder Blobby-Doppel wird deshalb das Teilnehmerergebnis erweitert um:

- `team_id` nullable,
- `placement` nullable,
- `is_winner` unabhängig für mehrere Personen,
- Score-Snapshot mit persönlichem und Teamwert.

`winner_id` kann für bestehende Auswertungen erhalten bleiben und bei Teams `NULL` sein. Neue
Auswertungen lesen die Teilnehmerergebnisse. Siege werden beiden Teammitgliedern gutgeschrieben;
ein Disconnect-Forfeit wird als Grund gespeichert, nicht als normal erspielter Endstand getarnt.

## 8. Tests und Abnahmekriterien

### Gemeinsame Lobby

- Jede erlaubte Spielerzahl kann beitreten und starten; jede nicht erlaubte Zahl wird serverseitig
  abgelehnt.
- Parallele Join-Versuche auf den letzten Platz lassen exakt eine Person zu.
- Eine Person kann weiterhin nur in einer Arcade-Lobby sein.
- Modus-/Settings-/Teamwechsel setzen die richtigen Ready-Zustände zurück.
- 2v2 startet nur mit 2/2, niemals mit 3+1 oder vier Personen ohne Teamzuordnung.
- Hostmigration, Reconnect-Schonfrist und Verlassen funktionieren ohne verwaiste Memberships.
- Gruppen-/Event-Scope gilt unverändert für Lobby, Match, Zuschauer und Kiosk.

### Spielregeln

- Snake: 2, 3 und 8 Schlangen; Mehrfach-Head-on; gleichzeitiger Tod; Spawn ohne Überlappung;
  Disconnect einer Person beendet FFA nicht.
- Tetris: 2, 3 und 8 Boards mit identischer Folge; korrektes Sprintende; Top-out eines Gegners;
  später Garbage niemals vervielfacht.
- Pong: jede der vier Lanes, Übergabezone, Teamtor, Eigentreffer und Teamwertung.
- Blobby: vier unabhängige Inputs, alle Ballkollisionen, Teamwertung und stabile Physik bei 30–60
  Sekunden Rally.
- Ergebnisse: FFA-Platzierung und zwei Teamgewinner werden korrekt gespeichert und ausgewertet.

### Browser/E2E

- Lobby erstellen, Modi erkennen, als 2–8 Personen beziehungsweise 2v2 beitreten, Team wählen,
  ready setzen und starten.
- 390×844 sowie 1280×720: keine horizontale Seitenüberbreite, Startgrund sichtbar, eigener
  Spielbereich bedienbar.
- Kein erklärender Fließtext in Lobby oder Match; Regeln und Startblocker sind über den direkt
  zugeordneten Info-Tooltip erreichbar.
- Tastatur, Touch-Ziele, Fokus nach Realtime-Rerender und `aria-live`-Meldungen.
- Zuschauer- und Kioskansicht für 3, 4 und 8 Personen.

## 9. Empfohlene Umsetzungsschritte

1. **Gemeinsames Modus-/Lobby-Fundament:** Definitionen, Sitze/Teams, Startvalidator,
   revisionssichere Mutationen und wiederverwendbare Lobby-UI.
2. **Snake Arena 2–8:** größter sozialer Gewinn bei überschaubarer Oberfläche; validiert das
   flexible Lobbyfundament.
3. **Tetris Sprint 2–8:** nutzt das flexible Fundament erneut und validiert Mehrfachboards in
   Spieler-, Zuschauer- und Kioskansicht.
4. **Ergebnisdaten für Teams erweitern.**
5. **Pong Doppel 2v2:** historisch klar, mechanisch näher am bestehenden Pong als Quadrapong.
6. **Blobby Respawn-Doppel als Beta:** erst nach echtem Vier-Personen-Spieltest als normaler Modus
   freigeben.
7. **Optional Tetris Battle Royale und Quadrapong:** erst nach Telemetrie und Feedback zu den
   einfacheren Varianten.

Nicht empfohlen wird ein einzelner generischer „Spielerzahl“-Regler für alle Spiele. Die Regeln
unterscheiden sich zu stark: Snake und Tetris vertragen einen Bereich, Pong und Blobby brauchen
vollständige Teams. Modusdefinitionen mit klaren erlaubten Besetzungen verhindern Sackgassen und
halten Lobby, Servervalidierung und Spielanzeige konsistent.
