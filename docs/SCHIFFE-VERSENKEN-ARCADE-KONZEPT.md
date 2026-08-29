# Konzept: Schiffe versenken im Arcade-Bereich

Stand: 26. Juli 2026

**Implementierungsstand:** Etappe 1 (Duell) ist begonnen: serverautoritatives Raster, Lobby,
Flottenplatzierung, Zugwechsel, Ergebnis und responsive Matchansicht sind integriert. Der
Teammodus bleibt bis zur parallelen Teamzug- und Mehrfachsieger-Implementierung bewusst nicht
freigeschaltet.
Die aktuelle Etappe beendet ein Duell bei einem Disconnect sofort zugunsten der verbundenen
Person. Das entspricht dem Verhalten der bestehenden Duellspiele im Arcade-Bereich.

## Fazit

Schiffe versenken passt gut in den Arcade-Bereich. Das klassische Spiel ist offiziell ein Duell
für genau zwei Personen. Mehrspieler-Adaptionen existieren und funktionieren technisch, sind aber
keine einheitliche Standardregel. Für Respawn wird deshalb folgende Kombination empfohlen:

- **Duell:** genau 2 Spieler, klassische und sofort verständliche Variante.
- **Teamgefecht:** genau 4 Spieler in zwei Zweierteams. Beide Teammitglieder bleiben während des
  gesamten Matches beteiligt und wählen ihre Schüsse innerhalb eines Teamzugs parallel.
- **Kein Free-for-all im ersten Release:** Ein freies Spiel mit 3 oder 4 Personen ist möglich,
  bringt aber Fokusfeuer, frühes Ausscheiden, mehrere gegnerische Zielraster und schwer
  nachvollziehbare Siegstatistiken mit sich.

Der Mehrspielermodus ist damit möglich, ohne die einfache Bedienung des Duells zu opfern. Eine
Lobby muss je nach gewähltem Modus exakt 2 oder exakt 4 belegte und bereite Plätze haben.

Als sichtbarer Name eignet sich **„Schiffe versenken“** und als interner Schlüssel
`battleship`. Es werden weder Hasbro-Grafiken noch geschützte Produktgestaltung übernommen;
Spielfeld, Schiffe und Effekte entstehen im vorhandenen Respawn-Designsystem.

---

## 1. Recherche zu Spielvarianten

### 1.1 Klassisches Spiel

Hasbro beschreibt Battleship als Kopf-an-Kopf-Spiel für **2 Spieler**. Gespielt wird mit einem
10×10-Raster und fünf Schiffen der Längen 5, 4, 3, 3 und 2. Abwechselnd wird eine Koordinate
beschossen; wer zuerst alle fünf gegnerischen Schiffe versenkt, gewinnt.

Das offizielle Regelheft enthält außerdem **Salvo** als Variante: Zu Beginn darf ein Spieler fünf
Schüsse pro Zug abgeben. Mit jedem versenkten eigenen Schiff sinkt die Zahl der verfügbaren
Schüsse um eins. „Advanced Salvo“ verrät nur die Zahl der Treffer, nicht deren genaue Lage.

Quellen:

- [Hasbro-Produktseite und Anleitung – 2 Spieler](https://instructions.hasbro.com/en-in/instruction/battleship)
- [Hasbro-Regelheft – Grundspiel und Salvo-Regeln](https://assets-us-01.kc-usercontent.com/500e0a65-283d-00ef-33b2-7f1f20488fe2/7b9b16c7-2343-4b0a-aea6-093314e11deb/B77441020_Retro_Battleship_INST_FFR.pdf)

### 1.2 Varianten mit mehr als zwei Personen

Es gibt mehrere erprobte, aber nicht einheitlich standardisierte Ansätze:

| Variante | Spieler | Prinzip | Eignung für Respawn |
| --- | ---: | --- | --- |
| Digitales Salvo-Free-for-all | 2–4 | Jeder besitzt eine Flotte und schießt auf auswählbare Gegner; die letzte Flotte gewinnt. | Technisch gut machbar, aber Fokusfeuer und frühes Ausscheiden sind problematisch. |
| Gemeinsames Papier-Salvo | bis 6 | Eine aufgerufene Koordinate trifft bei allen Personen, die dort ein Schiff haben; die Zahl der Schüsse sinkt mit verlorenen Schiffen. | Alle verfolgen dasselbe Raster, die Trefferzuordnung ist jedoch erklärungsbedürftiger als das bekannte Duell. |
| Digitaler Teammodus | 4 oder mehr | Teams teilen Ziele oder Bretter und koordinieren ihre Schüsse. | Gute soziale LAN-Variante; bei exakt 2 gegen 2 bleibt die Oberfläche überschaubar. |

Beispiele:

- [Open-Source-Salvo für bis zu vier Personen](https://memesstubs.github.io/battleships/README.html)
- [Papier-Variante für bis zu sechs Personen](https://www.melskitchencafe.com/paper-battleship-game/)
- [Browser-Adaption mit 2–4 Personen, Free-for-all und Teams](https://arcadeum.games/en/games/sea-battle)

Diese Quellen belegen, dass Mehrspieler funktioniert. Sie begründen aber keine „offizielle“
Mehrspielerregel. Der Respawn-Teammodus ist daher bewusst eine eigene, klar dokumentierte
LAN-Adaption.

### 1.3 Bewertete Optionen

| Kriterium | Duell | Free-for-all 3–4 | Teamgefecht 2 gegen 2 |
| --- | --- | --- | --- |
| Sofort verständlich | sehr gut | mittel | gut |
| Wartezeit | gering | mittel bis hoch | gering bei paralleler Teamwahl |
| Mobile UI | ein Zielraster | bis zu drei Zielraster | zwei Zielraster als Tabs |
| Fairness | hoch | Fokusfeuer/Absprachen möglich | klare gemeinsame Interessen |
| Frühes Ausscheiden | nein | ja | nein, ausgeschiedene Flotte spielt als Taktiker weiter |
| Lobby-Komplexität | exakt 2 | 2–4 | exakt 4 und 2 Plätze je Team |

Empfehlung: Duell und Teamgefecht umsetzen; Free-for-all erst nach echtem LAN-Feedback neu
bewerten.

---

## 2. Spielregeln für Respawn

### 2.1 Gemeinsame Basis

- Raster: **10×10**, Spalten A–J, Zeilen 1–10.
- Flotte pro Spieler: Schiffe mit **5, 4, 3, 3 und 2 Feldern**.
- Schiffe liegen waagerecht oder senkrecht, dürfen sich nicht überschneiden und dürfen sich
  berühren. Das entspricht dem klassischen Spiel und vermeidet eine zusätzliche Hausregel.
- Ein Schuss ergibt „Wasser“, „Treffer“ oder „versenkt“. Die Position anderer ungetroffener
  Schiffssegmente bleibt geheim.
- Bereits beschossene Felder sind nicht erneut auswählbar.
- Der Server hält Flotten und Trefferzustand autoritativ. Clients senden nur Platzierungsvorschläge
  und Schusskoordinaten.
- Vor dem ersten Zug läuft der gemeinsame Arcade-Countdown „3 · 2 · 1 · Los!“.

### 2.2 Duell – genau 2 Spieler

1. Beide platzieren ihre Flotte und bestätigen „Flotte bereit“.
2. Der Startspieler wird zufällig bestimmt und sichtbar angekündigt.
3. Pro Zug wird genau ein noch nicht beschossenes Feld gewählt und mit „Feuern“ bestätigt.
4. Nach der serverseitigen Auflösung wechselt der Zug unabhängig von Treffer oder Fehlschuss.
5. Wer zuerst alle 17 gegnerischen Schiffssegmente trifft, gewinnt.

Ein Treffer gewährt keinen Extrazug. Dadurch bleibt der Ablauf vorhersehbar und der aktuelle Zug
kann jederzeit eindeutig dargestellt werden.

### 2.3 Teamgefecht – genau 4 Spieler

- Zwei Teams mit je zwei Personen; jede Person besitzt eine eigene vollständige Flotte.
- Ein Teamzug enthält **zwei Schüsse**, je einen pro Teammitglied. Beide wählen gleichzeitig ein
  Feld auf einem der beiden gegnerischen Raster.
- Die Auswahl des Teamkollegen ist als reserviertes Ziel sichtbar. Doppelte Schüsse auf dasselbe
  Feld werden verhindert. Erst wenn beide bestätigt haben, löst der Server beide Schüsse gemeinsam
  auf und das andere Team ist an der Reihe.
- Ein Team gewinnt, sobald beide gegnerischen Flotten versenkt sind.
- Wurde die eigene Flotte bereits versenkt, bleibt die Person als **Taktiker** aktiv und gibt
  weiterhin ihren Team-Schuss ab. So muss niemand den Rest des Matches zuschauen und ein Teamzug
  bleibt immer gleich lang.
- Welches Team beginnt, wird zufällig bestimmt. Die Reihenfolge hat wegen der gemeinsamen
  Auflösung innerhalb eines Teamzugs keinen Vorteil zwischen Teammitgliedern.

Der Taktiker-Schuss ist eine bewusste LAN-Regel und wird in der Spielhilfe ausdrücklich erklärt.
Die Alternative, ausgeschiedene Personen vollständig zu sperren, wäre näher an einem
Free-for-all, aber deutlich schlechter für die Arcade-UX.

### 2.4 Zeit und Sonderfälle

- Kein harter Zugtimer im MVP. Eine dezente Laufzeitanzeige darf später ergänzt werden, ohne einen
  langsamen Touch- oder Tastaturspieler zu bestrafen.
- Verlässt jemand das Duell oder bricht die Verbindung ab, gewinnt die verbundene Person sofort
  (`player-left`). Dieses Verhalten ist bewusst konsistent mit Pong, Tetris und Blobby.
- Im Teamgefecht übernimmt nach 15 Sekunden Verbindungsunterbrechung der verbundene Teamkollege
  den fehlenden zweiten Schuss. Kehrt die Person zurück, erhält sie ihren Schuss ab dem nächsten
  Teamzug wieder.
- Sind beide Personen eines Teams länger als 60 Sekunden getrennt, gewinnt das andere Team
  (`team-left`).
- Der Host kann pausieren oder beenden. Ist der Host getrennt, wechselt die Kontrollrolle auf die
  erste verbundene Person. Eine einzelne instabile Verbindung darf das Match nicht blockieren.
- Bei Serverneustart endet der flüchtige Match-State wie bei den bestehenden Arcade-Spielen. Es
  wird kein unvollständiges Ergebnis als regulärer Sieg gespeichert.

---

## 3. Lobby- und UI/UX-Konzept

### 3.1 Einstieg im Arcade-Launcher

- Neue Spielkarte „Schiffe versenken“ mit lokalem Lucide-`ship`-Icon, Spielname und dem bereits
  verwendeten Badge „… offen“.
- Nach Auswahl erscheint die vorhandene Hauptgruppe für das gewählte Spiel.
- Im Hilfe-Popover neben dem Titel stehen nur Ziel, Flottengröße, Zugprinzip und die
  Team-Taktikerregel. Dauerhafte Anleitungstexte in der Lobby werden vermieden.

### 3.2 Modus vor dem Öffnen festlegen

Unter den vorhandenen Lobbykarten steht ein kompakter, direkt beschrifteter Modus-Selektor:

- `Duell · 2 Spieler` – vorausgewählt.
- `Teamgefecht · 4 Spieler`.

Danach folgt der volle Button „Lobby öffnen“. Der Modus wird beim Erstellen gespeichert und ist
für diese Lobby unveränderlich. Wer wechseln möchte, schließt die leere Lobby und öffnet eine neue.
Das ist besser, als nachträglich Plätze oder Teams umzudeuten und bereits beigetretene Personen
ungefragt zu entfernen.

### 3.3 Lobbykarte für das Duell

- Kopf: „<Host>s Lobby“, Modus „Duell“ und Belegung `1/2`.
- Zwei stabile Spielerzeilen. Der freie Platz trägt direkt „Beitreten“.
- Host gilt wie bisher automatisch als bereit; der Gast verwendet den bestehenden
  „Bereit? / Bereit“-Schalter.
- „Start“ wird erst aktiv, wenn der zweite Platz belegt und der Gast bereit ist.
- Neben einem deaktivierten Start erscheint der vorhandene Warn-Hilfe-Trigger mit dem konkreten
  Grund, beispielsweise „1 Spieler fehlt“ oder „Alex ist noch nicht bereit“.

### 3.4 Lobbykarte für das Teamgefecht

Die Lobby zeigt zwei klar getrennte Untergruppen „Team Blau“ und „Team Pink“ mit jeweils zwei
stabilen Spielerzeilen:

- Der Host belegt zunächst Team Blau.
- Jeder freie Platz enthält eine direkte Aktion „Blau beitreten“ oder „Pink beitreten“.
- Ein Mitglied darf über „Team wechseln“ auf einen freien Platz der Gegenseite wechseln. Dabei
  wird sein Bereitschaftsstatus zurückgesetzt.
- Startbedingung: genau 4 Personen, genau 2 pro Team und alle drei Gäste bereit.
- Der Startbutton bleibt bis dahin deaktiviert; der Warn-Hilfe-Trigger nennt fehlende Plätze,
  unausgeglichene Teams und nicht bereite Personen konkret.

Der bisherige allgemeine Lobby-Renderer unterstützt nur eine lineare Mitgliederliste und eine
freie Zeile. Für Teamgefechte sollte er nicht mit Sonderfällen überladen werden. Ein kleiner
Battleship-spezifischer Renderer darf die vorhandenen Zeilen-, Avatar-, Bereitschafts- und
Footer-Primitiven zusammensetzen.

### 3.5 Platzierungsphase

Die Platzierung ist eine eigene Matchphase nach dem Lobbystart, nicht Teil der Lobbybereitschaft.
Damit bedeuten „Bereit“ und „Flotte bereit“ jeweils genau eine Sache.

- Primärfläche ist das eigene 10×10-Raster als semantisches CSS-Grid aus Buttons, nicht Canvas.
  Das ermöglicht sichtbaren Tastaturfokus, Koordinatenansagen und mindestens 44×44 CSS-Pixel große
  Touchziele bei lokalem Scrollen auf sehr schmalen Geräten.
- Zusammengehörige Schiffssegmente sind sichtbar verbunden und tragen im Raster dasselbe kurze
  Schiffskennzeichen. Die Verbindung endet an der Schiffskante, sodass auch direkt aneinanderliegende
  Schiffe beim Platzieren, auf dem eigenen Raster und in der Endaufdeckung eindeutig getrennt bleiben.
- Über dem Raster stehen die fünf Schiffe als auswählbare Zeilen mit Name, Länge und Status.
- Ablauf: Schiff wählen, Orientierung über „Drehen“ setzen, Startfeld antippen. Drag-and-drop darf
  später als Komfortfunktion hinzukommen, ist aber nie der einzige Eingabeweg.
- Aktionen: „Drehen“, „Zufällig platzieren“, „Zurücksetzen“ und als primäre Aktion
  „Flotte bereit“.
- Ungültige Positionen werden nicht nur farblich, sondern mit kurzem Text erklärt. Die letzte
  gültige Platzierung bleibt erhalten.
- Nach Bestätigung ist das Raster gesperrt. „Platzierung ändern“ entsperrt es, solange noch nicht
  alle Personen bestätigt haben.
- Eine kompakte Teilnehmerliste zeigt ausschließlich „Platziert“ oder „Platziert noch“, niemals
  fremde Schiffspositionen.

### 3.6 Gefechtsphase

#### Handy

- Oben: Zugstatus, Gegnerauswahl und Flottenfortschritt.
- Darunter: genau ein großes gegnerisches Zielraster. Im Teammodus wechseln zwei gut beschriftete
  Tabs zwischen den gegnerischen Personen; versenkte Flotten sind weiterhin einsehbar, aber nicht
  mehr auswählbar.
- Ein Antippen markiert zunächst nur das Ziel. Ein separater primärer Button „Feuern“ bestätigt und
  verhindert Fehleingaben.
- Das eigene Raster folgt als standardmäßig kompakte, aufklappbare Sektion. Treffer bleiben auch
  durch Zeichen/Form und zugänglichen Text unterscheidbar, nicht nur durch Rot und Blau.

#### Laptop

- Zielraster und eigenes Raster stehen nebeneinander; das Zielraster bleibt visuell dominant.
- Im Teammodus ergänzt eine schmale Teamspalte den Status des Partners, dessen reservierten Schuss
  und beide gegnerischen Flotten. Fremde geheime Schiffsfelder werden nie dargestellt.

#### Gemeinsame Zustände

- Feldzustände: unbekannt, ausgewählt, vom Teamkollegen reserviert, Wasser, Treffer, versenkt.
- Zugstatus als Klartext: „Du bist am Zug“, „Warte auf Sam“, „Team Pink feuert“ oder „Pause“.
- Nach jedem Schuss eine kurze Ergebnisanzeige; Animationen respektieren
  `prefers-reduced-motion` und sind nie nötig, um das Ergebnis zu verstehen.
- Nach Matchende werden alle Bretter aufgedeckt. Siegerteam beziehungsweise Siegerperson,
  Restschiffe und Dauer erscheinen in der vorhandenen Ergebnisstruktur.

### 3.7 Zuschauer und Kiosk

Zuschauer dürfen keine geheimen Flottenpositionen erhalten, weil sie im LAN-Raum Hinweise zurufen
könnten. Die Watch-/Kiosk-Ansicht zeigt nur öffentlich bekannte Informationen:

- Spieler und Teams, aktueller Zug, verbleibende Schiffe und bereits aufgelöste Schüsse.
- Zielraster mit Wasser/Treffern, aber ohne ungetroffene Schiffssegmente.
- Vollständige Aufdeckung erst nach Matchende.

Der Server erzeugt dafür einen eigenen bereinigten Watch-State. Ein Client darf nicht erst
vollständige Flotten empfangen und sie lediglich per CSS verstecken.

---

## 4. Technisches Konzept

### 4.1 Wiederverwendbare Bausteine

| Bestehender Baustein | Nutzung |
| --- | --- |
| `lobbyMembership.ts` | Verhindert parallele Mitgliedschaft in mehreren Arcade-Lobbys. |
| `lobbyReady.ts` und `public/js/arcade/lobbyReady.js` | Bereitschaft für lineares Duell und einzelne Spielerzeilen im Teammodus. |
| `scope.ts` | Gruppen-/Event-Isolation und Identitätsprüfung aller Socket-Aktionen. |
| `arcadeData.ts` | Ergebnis-Snapshot und Teilnehmerpersistenz. |
| `arcadeTracking.ts` | Sichtbarer Live-Status und Spielzeit. |
| Arcade-Countdown, Pause/Ende, Watch-Liste | Gleiches Verhalten wie bei bestehenden Spielen. |
| `/api/arcade/lobbies` und `/api/arcade/stats` | Lobbyübersicht und Rangliste nach Ergänzung des Spieltyps. |

### 4.2 Neue Module und Integrationspunkte

Voraussichtlich neu:

- `server/src/arcade/battleshipLogic.ts`: reine Regeln für Platzierung, Raster, Schüsse,
  Rundenauswertung, Teams und Siegerermittlung.
- `server/src/arcade/battleship.ts`: Lobby-, Match-, Disconnect- und Socket-State.
- `server/src/arcade/battleshipLogic.test.ts`: schnelle Unit-Tests der vollständigen Spiellogik.
- `server/public/js/arcade/views/battleship.js`: Lobbykarte, Platzierung und Gefechtsansicht.

Gezielt zu erweitern:

- `server/src/index.ts`: Socket-Modul registrieren.
- `server/src/routes/arcade.ts`: Lobbyaggregation und Titel `battleship`.
- `server/public/js/arcade/views/arcade.js`: Spielkarte, Lobby-Zuordnung und Engaged-Game-Handling.
- `server/public/js/app.js`: eigene Matchansicht registrieren und Lobbyevents für „Aktuell“
  berücksichtigen.
- `server/public/js/icons.js`: lokales `ship`-Icon ergänzen, sofern noch nicht vorhanden.
- `server/public/css/arcade.css`: tokenisierte Raster-, Flotten- und Responsive-Regeln.
- Watch-/Kiosk-State und Renderer: ausschließlich bereinigten öffentlichen Zustand anzeigen.

Es sind keine neue Laufzeitabhängigkeit und kein Framework nötig.

### 4.3 Zustandsmodell

```text
Lobby
  -> Platzierung
  -> Countdown
  -> Gefecht
       -> Ziel gewählt
       -> Schuss/Team-Salve gesperrt
       -> Auflösung
       -> nächster Zug
  -> Ergebnis
```

Minimaler Match-State im Server:

- Scope: `groupId`, `eventId`, `matchId`, Room und Startzeit.
- Modus: `duel | team`.
- Spieler: Snapshot, Team, Socket, Verbindungsstatus und Platzierungsstatus.
- Pro Spieler: fünf Schiffe mit Zellen und Treffern; öffentlich getrennt davon nur
  Restschiffe/Restsegmente.
- Zug: aktives Team beziehungsweise aktiver Spieler, ausgewählte Schüsse und fortlaufende
  Zugnummer.
- Steuerung: Host, Pause, Timer/Grace-Fristen und zentral räumbare Timeouts.

Geheimer und öffentlicher State werden nicht in einem gemeinsamen Payload gemischt. Eine Funktion
erzeugt den personalisierten State für genau einen Teilnehmer; eine zweite den bereinigten
Zuschauer-State.

### 4.4 Socket-Vertrag

| Event | Richtung | Zweck |
| --- | --- | --- |
| `battleship:lobbies` | S→C | Für den Scope sichtbare Lobbys mit Modus, Teams und Ready-State. |
| `battleship:lobby:create` | C→S | Lobby mit unveränderlichem Modus öffnen. |
| `battleship:lobby:join` | C→S | Freiem Duell- oder Teamplatz beitreten. |
| `battleship:lobby:team` | C→S | Auf einen freien Platz des anderen Teams wechseln. |
| `battleship:lobby:ready` | C→S | Eigenen Bereitschaftsstatus setzen. |
| `battleship:lobby:start` | C→S | Exakte Belegung und Bereitschaft atomar prüfen und Match starten. |
| `battleship:setup:submit` | C→S | Komplette Flotte übermitteln; Server validiert jede Zelle. |
| `battleship:setup:unlock` | C→S | Eigene Platzierung vor Gefechtsbeginn wieder öffnen. |
| `battleship:shot:select` | C→S | Ziel vormerken oder ändern. |
| `battleship:shot:commit` | C→S | Eigenen Schuss sperren; bei vollständiger Salve serverseitig auflösen. |
| `battleship:state` | S→C | Personalisierter Vollzustand für das Rendern. |
| `battleship:round:resolved` | S→C | Öffentliche Ergebnisse der gerade aufgelösten Schüsse. |
| `battleship:match:*` | beide | Pause, Fortsetzen, Verlassen, Beenden und Abschluss. |

Jede Mutation verwendet einen Ack mit `ok` und einem konkreten deutschen Fehler. Der Server prüft
Identität, Scope, Lobby-/Match-Mitgliedschaft, Phase, Zugrecht, Team, Koordinate, Wiederholung und
Zielzustand bei jeder Aktion erneut.

### 4.5 Ergebnisse und Statistiken

Das bestehende Feld `arcade_results.winner_id` kann nur eine Person abbilden. Die bereits
vorhandene Tabelle `arcade_result_participants` besitzt dagegen `is_winner` pro Teilnehmer und kann
damit beide Personen eines Siegerteams ohne Schemaänderung markieren.

Empfohlene Anpassung:

- `recordArcadeResult` akzeptiert zusätzlich `winnerIds: string[]` und setzt `is_winner` für alle
  enthaltenen Teilnehmer.
- Beim Duell bleibt `winner_id` für Kompatibilität auf die einzelne Sieger-ID gesetzt.
- Beim Teamgefecht bleibt `winner_id` `NULL`; die kanonischen Sieger stehen in den
  Teilnehmerzeilen. History/API ergänzen `winnerIds`.
- Die Arcade-Statistik zählt Siege künftig aus `arcade_result_participants.is_winner` statt nur aus
  `arcade_results.winner_id`. Das behebt zugleich die generelle Mehrfachsieger-/Gleichstandslücke.
- Score-Snapshots enthalten `team`, `shipsRemaining`, `segmentsRemaining` und `outcome`; die
  sichtbare Standardrangliste bleibt bei Matches, Siegen, Niederlagen und Siegquote.

### 4.6 Datenschutz und Manipulationsschutz

- Flottenpositionen erscheinen weder in Logs noch in Lobby-, Watch-, Kiosk- oder Push-Payloads.
- Nur der jeweilige Spieler erhält die eigene vollständige Flotte. Teamkollegen sehen ausschließlich
  öffentlich bekannte Treffer und Restschiffe.
- Platzierungen werden serverseitig auf Zahl, Länge, Orientierung, Grenzen, Eindeutigkeit und
  Überschneidung geprüft.
- Schüsse werden erst nach erfolgreicher serverseitiger Prüfung und atomarer Zustandsänderung
  bestätigt. Doppelklicks und wiederholte Socket-Pakete lösen keinen zweiten Schuss aus.
- Alle Timer werden beim Matchende zentral beendet; abgelaufene Callbacks prüfen zusätzlich, ob
  Match und Phase noch aktuell sind.

---

## 5. Umsetzung in Etappen

### Etappe 1 – Spiellogik und Duell

- Reine Raster-, Flotten- und Schusslogik mit Unit-Tests.
- Duell-Lobby, Platzierung, Gefecht, Ergebnis, Disconnect-Abschluss und Live-Tracking.
- Arcade-Karte, Statistiktitel und Home-Lobbyübersicht.
- Bereinigter Zuschauer-/Kiosk-State.

### Etappe 2 – Teamgefecht

- Unveränderliche Moduswahl, vier Plätze und Teamwechsel in der Lobby.
- Parallele Zielreservierung und gemeinsame Auflösung pro Teamzug.
- Taktikerregel, Disconnect-Übernahme und zwei Gewinner im Ergebnis.
- Responsive Teamansicht und teamfähige Watch-/Kiosk-Darstellung.

Beide Etappen bilden gemeinsam den empfohlenen Release. Die Trennung hält Review und Tests
überschaubar; das Duell liefert die Referenz für die komplexere Teamlogik.

### Später, nur nach Bedarf

- Free-for-all für 3–4 Personen.
- Salvo-Regel mit Schüssen nach verbleibenden Schiffen.
- KI-Gegner; entsprechend der bestehenden Arcade-Regel nur für berechtigte Admins.
- Optionale Zugzeit oder Rematch mit getauschten Teams.

---

## 6. Testkonzept

### Unit-Tests

- Alle gültigen horizontalen und vertikalen Platzierungen einschließlich Randfeldern.
- Falsche Schiffslänge, Überlappung, doppelte Zelle, außerhalb des Rasters und fehlendes Schiff.
- Wasser, Treffer, Versenken und Matchende; derselbe Schuss wird nur einmal gewertet.
- Zufällige Startseite und vollständige Zufallsplatzierung ohne Kollision.
- Team-Salve mit zwei verschiedenen Zielen, reservierter Doppelkoordinate und gleichzeitiger
  Versenkung beider letzter Flotten.
- Taktikerregel und Übernahme eines Schusses bei Disconnect.

### Socket-/Integrationstests

- Exakte Lobbygrößen 2 beziehungsweise 4 und genau 2 Personen pro Team.
- Start scheitert bei freiem Platz, falscher Teamverteilung oder nicht bereitem Gast.
- Lobby-Modus ist nach Erstellung unveränderlich.
- Fremde Identität, fremder Scope, Nichtmitglied, falsche Phase und falscher Zug werden abgelehnt.
- Zwei parallele `start`- oder `commit`-Pakete erzeugen genau einen Zustandsübergang.
- Disconnect beendet das Duell genau einmal; Watch-State enthält keine ungetroffenen
  Schiffspositionen.
- Teamresultat markiert beide Sieger und zählt beiden einen Sieg zu.

### E2E und UI

- Vollständiges Duell mit zwei Browserkontexten: Lobby, Ready, Platzierung, Schüsse, Sieg und
  Statistik.
- Vollständiger Teamstart mit vier Kontexten: Teamauswahl, alle Ready, parallele Salve und
  Taktikerstatus.
- Handy-Viewport: Raster ohne Seiten-Scrollen, lokal scrollbare Ausnahme auf sehr schmalen
  Geräten, 44×44-Touchziele und bestätigungspflichtiger Schuss.
- Tastatur: vollständige Platzierung und Zielwahl mit sichtbarem Fokus.
- Lange Spielernamen, Loading, leere Lobbyliste, voller Modus, Fehler-Ack, Pause und Disconnect.
- Zuschauer und Kiosk sehen während des Matches keine geheime Flottenzelle.

---

## 7. Abnahmekriterien

- „Schiffe versenken“ ist im Arcade-Launcher ohne Erklärung auffindbar.
- Eine Lobby zeigt Modus, Soll-/Ist-Belegung, Teamzuordnung und Bereitschaft eindeutig.
- Duell startet ausschließlich mit genau 2, Teamgefecht ausschließlich mit genau 4 Personen und
  zwei vollständigen Teams.
- Jede Flotte kann mit Touch, Maus und Tastatur gültig platziert oder automatisch erzeugt werden.
- Kein Client erhält fremde ungetroffene Schiffspositionen, auch nicht als verstecktes Feld.
- Reconnect und ein einzelner Disconnect blockieren ein Teamgefecht nicht dauerhaft.
- Ergebnisse, Live-Tracking, Lobbyübersicht, Watch/Kiosk und Arcade-Statistik funktionieren für
  beide Modi.
- Beide Mitglieder des Siegerteams erhalten einen Sieg; Duellergebnisse bleiben kompatibel.
- Keine neue Produktionsabhängigkeit wird eingeführt; Lint, Build, Unit-/Integrationstests,
  Tokenprüfung und relevante Arcade-E2E-Tests sind grün.

