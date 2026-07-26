# Implementierungskonzept: Curve Fever im Arcade-Bereich

Stand: 26. Juli 2026

## 1. Kurzfazit

Empfohlen wird eine bewusst reduzierte **Classic-Survival-Variante für 2–8 Personen**:

- Jede Figur bewegt sich ständig vorwärts und wird nur nach links oder rechts gelenkt.
- Jede Figur hinterlässt eine kollidierbare Spur mit zufälligen, passierbaren Lücken.
- Eine Kollision mit Wand, eigener Spur oder fremder Spur scheidet für die laufende Runde aus.
- Überlebt man das Ausscheiden anderer Personen, erhält man Punkte.
- Nach mehreren kurzen Runden gewinnt die erste eindeutig führende Person am Punkteziel.

Powers, Pickups, Teams, Angriffe, Turrets, frei konfigurierbare Regeln und KI gehören nicht in das
MVP. So bleibt das Spiel leicht verständlich, technisch beherrschbar und für eine LAN mit ungefähr
15 Teilnehmenden robust.

Die Umsetzung benötigt kein neues Framework und keine neue Produktionsabhängigkeit. Sie kann die
vorhandenen Arcade-Bausteine für Lobby, Ready-Status, Scope, Countdown, Live-Tracking, Ergebnisse,
Zuschauer und Kiosk wiederverwenden.

## 2. Recherche und Regelgrundlage

### 2.1 Gemeinsamer Kern der bekannten Varianten

Das ursprüngliche „Achtung, die Kurve!“ und das heutige Curve Fever Pro teilen folgende
charakteristische Regeln:

- Die Figur bewegt sich kontinuierlich und hinterlässt eine Spur.
- Gesteuert wird mit zwei Aktionen: links und rechts.
- Wand- und Spurkontakt führen zum Ausscheiden.
- In den Spuren entstehen zeitweise Lücken, durch die gefahren werden kann.
- Mehrere Personen spielen gleichzeitig in derselben Arena.
- Überleben und das Abschneiden von Wegen sind der taktische Kern.

Das ursprüngliche Spiel ist für zwei bis acht gleichzeitig Spielende dokumentiert. Curve Fever Pro
erweitert diesen Kern unter anderem um bis zu zehn Personen, Powers, Pickups, Teams und verschiedene
Wertungssysteme. Die moderne FFA-Wertung belohnt das Überleben: Wenn eine Person ausscheidet,
erhalten noch lebende Gegner Punkte.

Quellen:

- [Curve Fever Pro – offizielle Historie](https://info.curvefever.pro/home)
- [Curve Fever Pro auf Steam – Steuerung und aktuelle Modi](https://store.steampowered.com/app/1133700/Curve_Fever/)
- [Curve Fever Pro Wiki – Survival, Kollisionen, Lücken und Steuerung](https://wiki.curvefever.pro/survival)
- [Curve Fever Pro Wiki – Classic FFA und Spielerzahl](https://wiki.curvefever.pro/gamemodes)
- [Achtung, die Kurve! – ursprüngliche Regeln und Spielerzahl](https://en.wikipedia.org/wiki/Achtung%2C_die_Kurve%21)

### 2.2 Bewusste Respawn-Vereinfachung

Die Umsetzung übernimmt nicht das vollständige Curve Fever Pro. Insbesondere das aktuelle
Attack-Scoring setzt Powers und weitere Metasysteme voraus und würde den gewünschten einfachen
Arcade-Charakter verfehlen.

Stattdessen wird die bekannte Survival-Wertung auf kleine, sichtbare Werte normalisiert:

- Scheidet eine Person aus, erhält jede nach diesem Simulationstick noch lebende Person einen
  Punkt.
- Scheiden mehrere Personen gleichzeitig aus, erhalten die Überlebenden entsprechend mehrere
  Punkte.
- Sterben alle verbliebenen Personen im selben Tick, gibt es für diese letzten Ausscheidungen
  keinen Punkt.
- Das Punkteziel ist `5 × (Spielerzahl − 1)`: 5 Punkte im Duell, 15 bei vier und 35 bei acht
  Personen.

Diese Formel entspricht in ihrer Matchlänge der modernen Grundidee, bei der pro überlebtem Gegner
10 Punkte und als Ziel 50 Punkte je weiterem Startplatz verwendet werden, ist aber in der
Oberfläche schneller lesbar.

## 3. Abgrenzung zu Snake

Curve Fever und Snake teilen auf hoher Ebene das Vermeiden von Kollisionen. Sie erfüllen im
aktuellen Arcade-Angebot dennoch unterschiedliche Rollen:

| Merkmal | Bestehendes Snake | Curve Fever |
| --- | --- | --- |
| Bewegung | Raster, vier Richtungen | kontinuierlich, freie Winkel |
| Steuerung | absolute Richtung | nur links/rechts relativ zur Fahrtrichtung |
| Hauptziel | Futter sammeln und wachsen | andere in kurzen Runden überleben |
| Spur/Körper | begrenzter, wachsender Körper | dauerhaft gefüllte Arena |
| Öffnungen | keine | zufällige passierbare Lücken |
| Besetzung | aktuell genau 1 gegen 1 | 2–8, jeder gegen jeden |
| Spielgefühl | Positions- und Wachstumsduell | Reaktion, Kurvenkontrolle und Einkesseln |

Die Lücken sind ein unverzichtbares MVP-Merkmal. Ohne Lücken wäre die neue Variante sowohl
spielerisch als auch optisch deutlich zu nah an „Snake ohne Futter“.

Eine zusätzliche Snake-Arena für 2–8 Personen sollte nicht parallel als nächster Ausbau umgesetzt
werden. Sie würde dieselbe Mehrspielerrolle besetzen und den Unterschied verwässern. Solange Snake
das kompakte Futter-Duell bleibt, ergänzt Curve Fever den Arcade-Bereich sinnvoll. Falls später
doch eine Snake-Arena gewünscht ist, muss sie vor Umsetzung gegen Curve Fever neu bewertet oder
über ein klar anderes Ziel wie kooperatives Futter-Sammeln differenziert werden.

## 4. Produktumfang

### 4.1 MVP

- Ein Modus: „Classic“, jeder gegen jeden.
- Zwei bis acht reale Personen.
- Eine feste Arena und eine feste Spielgeschwindigkeit.
- Kontinuierliche Bewegung, Links-/Rechts-Steuerung und zufällige Lücken.
- Mehrere Runden mit Survival-Punkten und fest berechnetem Punkteziel.
- Lobby, Ready-Status und Host-Start.
- Gemeinsamer Arcade-Countdown vor jeder Runde.
- Host kann pausieren, fortsetzen und das Match beenden.
- Mitglieder können ein laufendes Match verlassen, ohne alle übrigen Personen aus dem Spiel zu
  werfen.
- Ergebnis, Arcade-Statistik, Live-Status und Spielzeit.
- Zuschaueransicht und Kiosk-Livebild.
- Tastatur-, Maus-/Touch- und responsive Darstellung.

### 4.2 Bewusst nicht im MVP

- Powers, Pickups, Geschütztürme oder Angriffs-Scoring.
- Teams, Ranglisten-Matchmaking oder öffentliche Internet-Lobbys.
- Wählbare Geschwindigkeit, Arena, Lückendichte oder Punktegrenze.
- KI-Gegner.
- Mehrere lokale Personen an einer Tastatur.
- Replays.

Ein einziger kuratierter Modus vermeidet unstartbare oder schlecht balancierte Kombinationen und
hält Lobby sowie Hilfe kurz.

## 5. Detaillierte Spielregeln

### 5.1 Rundenstart

- Eine Runde verwendet alle noch am Match teilnehmenden Personen.
- Spawnpunkte und Startrichtungen stammen aus getesteten, symmetrisch verteilten Sets für
  zwei bis acht Personen.
- Die Zuordnung der Spawnpunkte rotiert zwischen den Runden, damit niemand dauerhaft dieselbe
  Position erhält.
- Während des Countdowns wird keine Eingabe simuliert. Bei „Los!“ fahren alle gleichzeitig an.
- Die erste kurze Strecke jeder Spur ist geschlossen. Lücken beginnen erst, wenn jede Person
  genügend Abstand zum Spawnpunkt aufgebaut hat.

### 5.2 Bewegung und Lücken

- Die Geschwindigkeit ist für alle identisch und konstant.
- Gedrücktes Links beziehungsweise Rechts ändert den Winkel mit einer festen Drehgeschwindigkeit.
- Werden beide Richtungen gleichzeitig gehalten, gilt neutral; dies ist deterministisch und
  verhindert einen geräteabhängigen Vorrang.
- Jede Spur wechselt anhand eines serverseitig erzeugten Zufallsplans zwischen „massiv“ und
  „Lücke“.
- Lücken sind sichtbar, erzeugen aber keine Kollisionsfläche.
- Der Zufallsplan wird aus einem pro Runde gespeicherten Seed erzeugt. Dadurch bleiben Tests
  reproduzierbar und ein Zustand kann bei Reconnect konsistent aufgebaut werden.

### 5.3 Kollisionen

Eine aktive Person scheidet aus, wenn ihr Kopf:

- die Arenagrenze berührt,
- eine eigene ältere Spur berührt,
- eine fremde Spur berührt oder
- im selben Tick den Fahrweg einer anderen aktiven Person kreuzt.

Alle Bewegungen eines Ticks werden zunächst aus demselben alten Weltzustand berechnet und danach
gemeinsam aufgelöst. Bei einem Kopf-an-Kopf-Treffen scheiden deshalb alle beteiligten Personen aus;
Socket-Reihenfolge oder Array-Position dürfen das Ergebnis nicht beeinflussen.

Die unmittelbar hinter dem eigenen Kopf liegende Spur wird erst nach einer kurzen Sicherheitsdistanz
in das Kollisionsraster übernommen. Damit kollidiert eine Figur nicht technisch mit dem Segment,
das sie gerade selbst zeichnet.

### 5.4 Runden- und Matchende

- Eine Runde endet, sobald höchstens eine Person lebt.
- Nach der Auflösung werden die in diesem Tick verdienten Punkte addiert.
- Eine kurze Rundentafel zeigt Platzierung, erhaltene Punkte und Gesamtstand.
- Die nächste Runde startet automatisch nach einer kurzen Pause und dem gemeinsamen Countdown.
- Erreicht nach einer Runde genau eine führende Person das Punkteziel, gewinnt sie das Match.
- Liegen mehrere Führende am oder über dem Ziel gleichauf, folgen Entscheidungsrunden, bis es eine
  eindeutige Führung gibt.
- Nur das abgeschlossene Match wird in `arcade_results` gespeichert, nicht jede einzelne Runde.

## 6. Lobby- und UI/UX-Konzept

### 6.1 Arcade-Launcher

- Neue Spielkarte „Curve Fever“ mit einem vorhandenen passenden Lucide-Icon, beispielsweise
  `route`.
- Der Hilfe-Tooltip neben dem Spieltitel enthält knapp:
  „Lenke mit links/rechts, nutze Lücken und berühre weder Wand noch Spur. Überlebe bis zum
  Punkteziel.“
- Das Badge zeigt wie bei bestehenden Spielen die Anzahl offener Lobbys.
- Es gibt keine Modusauswahl und keine Einstellungszeile.

Vor einer öffentlichen Veröffentlichung sollte der sichtbare Name markenrechtlich geprüft werden.
Die Implementierung verwendet weder Originalcode noch Originalgrafiken. Falls eine neutrale
Bezeichnung nötig ist, kann ausschließlich das Label in „Kurvenfieber“ oder „Curve Arena“ geändert
werden; der interne Schlüssel bleibt stabil.

### 6.2 Lobby

- Jede Lobby zeigt bis zu acht stabile Spielerzeilen beziehungsweise eine zusammengefasste Zeile
  mit den noch freien Plätzen.
- Im Kopf stehen Belegung und Startminimum, zum Beispiel `4/8 · Start ab 2`.
- Der Host gilt wie bisher automatisch als bereit.
- Gäste verwenden den vorhandenen Ready-Schalter.
- „Start“ ist aktiv, sobald mindestens zwei Personen beigetreten und alle Gäste bereit sind.
- Ein Warn-Tooltip neben einem deaktivierten Start nennt konkret die fehlende Personenzahl oder
  nicht bereite Namen.
- Parallel eintreffende Join-Anfragen auf den letzten Platz werden serverseitig atomar
  entschieden.

### 6.3 Matchansicht

- Die Arena verwendet das vorhandene Canvas-Muster und das Seitenverhältnis 8:5.
- Oberhalb stehen Punkteziel, Rundennummer und die vorhandenen kompakten Spieler-/Scorezeilen.
- Farbe wird durch Name und Status ergänzt; ausgeschiedene Personen sind nicht nur über Farbe oder
  Transparenz erkennbar.
- Das eigene Fahrzeug erhält eine gut erkennbare Kontur. Die Arena selbst bleibt frei von
  dauerhaftem Erklärungstext.
- Nach dem Ausscheiden bleibt die Person in derselben Ansicht und schaut die Runde zu.
- Die vorhandene Expand-Funktion vergrößert die Arena unter Beibehaltung des Seitenverhältnisses.

### 6.4 Eingabe

Laptop:

- `A` oder Pfeil links: links lenken.
- `D` oder Pfeil rechts: rechts lenken.
- `keydown` setzt und `keyup` löst den Richtungszustand.
- Bei Fenster-Fokusverlust, View-Wechsel oder Verbindungsabbruch wird neutral gesendet, damit keine
  Taste hängen bleibt.

Touch:

- Die linke und rechte Hälfte der Arena dienen als zwei große, unsichtbar beschriftete
  Touchflächen.
- `pointerdown` beginnt und `pointerup`/`pointercancel` beendet das Lenken.
- Ein kurzer sichtbarer Hinweis „Links“/„Rechts“ erscheint nur beim ersten Match oder im
  Hilfezustand.
- Mehrfinger-Eingaben werden auf einen aktiven Steuerpointer begrenzt.

Die Bedienung funktioniert auf dem Telefon, für präzises Spielen wird entsprechend dem Vorbild
Querformat empfohlen. Hochformat bleibt funktionsfähig und zeigt keinen blockierenden
Orientierungsdialog.

## 7. Technisches Konzept

### 7.1 Architekturentscheidung

Der Server bleibt autoritativ:

- Clients senden nur den aktuellen Lenkwunsch `-1`, `0` oder `1`.
- Der Server berechnet Positionen, Winkel, Lücken, Kollisionen, Punkte und Phasen.
- Client-Zeit, Client-Positionen und vom Client gemeldete Kollisionen werden nie vertraut.

Die Spiellogik wird als reine, unabhängig testbare Funktion vom Socket-Lifecycle getrennt. Dieses
Muster entspricht den vorhandenen Modulen `snakeLogic.ts`, `pongLogic.ts` und ihren Socket-Dateien.

### 7.2 Welt- und Kollisionsmodell

Die Arena besitzt logische Fließkomma-Koordinaten, unabhängig von Canvas- oder Gerätegröße.

Minimaler Weltzustand:

```ts
interface CurveWorld {
  tick: number;
  round: number;
  seed: number;
  players: CurvePlayerState[];
}

interface CurvePlayerState {
  playerId: string;
  x: number;
  y: number;
  angle: number;
  turn: -1 | 0 | 1;
  alive: boolean;
  drawing: boolean;
  score: number;
}
```

Für Kollisionen wird serverseitig ein kompaktes Belegungsraster als `Uint8Array` geführt. Neue
massive Spursegmente werden als dicke Linie in dieses Raster geschrieben; Lücken werden nur
gerendert. Diese Lösung ist für höchstens acht Personen einfacher und robuster als allgemeine
Polygon- oder Physikbibliotheken.

Pro Tick:

1. Eingaben übernehmen und alle neuen Winkel/Positionen berechnen.
2. Wand- und Kollisionstests für alle Personen gegen denselben alten Rasterstand durchführen.
3. Gleichzeitige neue Fahrwege paarweise auf Kreuzung prüfen.
4. Ausscheidungen gemeinsam festlegen und Punkte vergeben.
5. Massive Segmente außerhalb der Kopfsicherheitsdistanz in das Raster schreiben.
6. Zustandsänderungen als Delta veröffentlichen.

Feste Werte für Tickrate, Geschwindigkeit, Drehung, Spurbreite, Lückenlänge und Rasterauflösung
liegen zentral in `curveFeverLogic.ts`. Sie werden nicht über mehrere Server- und Clientdateien
dupliziert.

### 7.3 Netzwerk und Rendering

Der gesamte Trail darf nicht bei jedem Tick erneut als JSON gesendet werden. Seine Größe wächst
über die Runde und würde bei acht Personen unnötig Bandbreite und Garbage Collection erzeugen.

Empfohlener Vertrag:

- Der Server simuliert mit fester Tickrate.
- Teilnehmer erhalten in geringerer, fester Sendefrequenz `curve:state` mit aktuellen Köpfen,
  Phasen und ausschließlich den seit der letzten Sendung entstandenen Segmenten.
- Jedes Delta trägt eine monotone Sequenznummer.
- `curve:sync` liefert bei Einstieg oder erkannter Sequenzlücke einen vollständigen,
  kompakt codierten Rundensnapshot.
- Der Client interpoliert nur die Darstellung zwischen zwei bestätigten Zuständen; er entscheidet
  keine Kollision.
- Zuschauer und Kiosk erhalten einen gröber getakteten, vereinfachten Vollsnapshot. Damit kann das
  vorhandene Watch-Replay des zuletzt bekannten Zustands neue Zuschauer sofort versorgen.

Segmente werden als Zahlenarrays statt als Objekte pro Punkt übertragen. Ein Segment enthält
Spielerindex, Start, Ende und die Information, ob es massiv ist. Der Server begrenzt Rundendauer
und Snapshotgröße defensiv; ein Client kann keine Trail-Daten einspeisen.

### 7.4 Socket-Vertrag

| Event | Richtung | Zweck |
| --- | --- | --- |
| `curve:lobbies` | S→C | Sichtbare Lobbys mit Belegung und Ready-State. |
| `curve:lobby:create` | C→S | Lobby für 2–8 Personen öffnen. |
| `curve:lobby:join` | C→S | Freiem Platz beitreten. |
| `curve:lobby:leave` | C→S | Lobby verlassen beziehungsweise als Host schließen. |
| `curve:lobby:ready` | C→S | Eigenen Ready-State setzen. |
| `curve:lobby:start` | C→S | Mindestzahl und Ready-Zustände erneut prüfen und Match starten. |
| `curve:input` | C→S | Lenkwunsch mit fortlaufender clientseitiger Sequenznummer. |
| `curve:state` | S→C | Phasen-, Kopf-, Score- und Trail-Delta. |
| `curve:sync` | beide | Vollsnapshot nach Join, Reconnect oder Sequenzlücke anfordern/liefern. |
| `curve:round:end` | S→C | Rundenergebnis und nächster Startzeitpunkt. |
| `curve:match:*` | beide | Pause, Fortsetzen, Verlassen, Beenden und Abschluss. |

Jede Mutation mit Ack validiert Identität, Gruppen-/Event-Scope, Lobby-/Match-Mitgliedschaft,
Phase, Typ und erlaubte Werte. Veraltete Input-Sequenzen werden ignoriert. Unbekannte oder zu
häufige Inputs verändern den Zustand nicht.

### 7.5 Disconnect und Reconnect

- Ein Verbindungsabbruch setzt die Steuerung sofort auf neutral.
- Die Person erhält zehn Sekunden Reconnect-Frist und kann über dieselbe Identität und denselben
  Scope wieder in das Match aufgenommen werden.
- Nach Ablauf scheidet sie aus der aktuellen Runde aus und nimmt an folgenden Runden nicht mehr
  teil. Die übrigen Personen spielen weiter.
- Bleibt dadurch nur eine aktive Matchperson, gewinnt diese das Match.
- Verlässt der Host dauerhaft, geht Pause/Beenden an die am längsten verbundene aktive Person über.
- Timer und Schleifen werden bei Matchende zentral beendet; verspätete Callbacks prüfen zusätzlich,
  ob Match und Phase noch aktuell sind.
- Ein Serverneustart beendet wie bei den vorhandenen Arcade-Spielen den flüchtigen Matchzustand,
  speichert aber kein unvollständiges Match als regulären Sieg.

### 7.6 Ergebnisse, Tracking und Statistiken

Curve Fever hat genau eine Siegerperson und passt ohne Schemaänderung in die vorhandene
Ergebnisstruktur:

- `gameType: 'curve'`
- `winnerId`: eindeutige Matchsieger-ID
- `players`: unveränderliche Teilnehmer-Snapshots
- `scores`: Gesamtpunkte, Rundenplatzierungen und Status je Person
- `reason`: `completed`, `aborted`, `player-left` oder `draw`

`startArcadeSession` beginnt beim Matchstart für alle realen Personen; `endArcadeSession` läuft in
jedem Endpfad. Nur `completed` fließt wie bisher in die sichtbare Sieg-/Niederlagenstatistik ein.

## 8. Repository-Integration

Voraussichtlich neu:

- `server/src/arcade/curveFeverLogic.ts`
- `server/src/arcade/curveFeverLogic.test.ts`
- `server/src/arcade/curveFever.ts`
- `server/public/js/views/curveFever.js`

Gezielt zu erweitern:

- `server/src/index.ts`: Socket-Modul registrieren.
- `server/src/db.ts`: eingebautes Arcade-Spiel in `ARCADE_GAME_DEFS` ergänzen.
- `server/src/routes/arcade.ts`: Titel und offene Lobbys aggregieren.
- `server/public/js/app.js`: Matchview und Lobby-Refresh registrieren.
- `server/public/js/views/arcade.js`: Spielkarte, Lobbyrenderer, Wechsel zwischen Spielen und
  Engaged-Game-Erkennung ergänzen.
- `server/public/js/arcadeStreamRenderer.js`: Curve-Trails für Watch darstellen.
- `server/public/js/views/arcadeWatch.js` und `server/public/js/kiosk.js`: Anzeigename und
  Curve-State berücksichtigen.
- `server/public/css/style.css`: tokenisierte Arena-, Steuerflächen-, Score- und
  Responsive-Regeln; vorhandene `.arcade-game-shell`- und Expand-Regeln wiederverwenden.
- vorhandene Arcade-API-, Realtime-, Leave-, Tracking-, Renderer- und E2E-Tests.

Die mehrfach gepflegten Listen aus Spielschlüssel und Anzeigename sind bereits ein
Integrationsrisiko. Für dieses einzelne Spiel ist ein begrenztes Ergänzen aller bestehenden
Listen risikoärmer als ein nebenläufiges Arcade-Registry-Refactoring. Eine Zentralisierung sollte
ein eigenes Arbeitspaket bleiben.

## 9. Umsetzung in Etappen

### Etappe 1 – reine Spiellogik

- Deterministische Welt, Spawnsets und Lückenplan.
- Kontinuierliche Bewegung und Kollisionsraster.
- Gleichzeitige Kollisionen, Survival-Wertung und Matchziel.
- Vollständige Unit-Tests ohne Socket oder Canvas.

### Etappe 2 – Lobby und serverautoritatives Match

- 2–8-Personen-Lobby mit bestehendem Membership-, Ready- und Scope-Modell.
- Matchphasen, Eingabevalidierung, Delta-/Sync-Protokoll, Pause und Cleanup.
- Reconnect-Frist, Hostübergabe, Tracking und Ergebnis.
- Socket-/Integrationstests.

### Etappe 3 – Spieloberfläche

- Arcade-Karte, Lobby und Matchview.
- Canvas-Renderer, Tastatur und zwei Touchflächen.
- Rundentafel, Matchende, Expand- und Responsive-Verhalten.
- Lange Namen, Fokusverlust, Reduced Motion, Hoch-/Querformat und Zoom prüfen.

### Etappe 4 – Zuschauer, Kiosk und Abnahme

- Vereinfachter Watch-Snapshot und Renderer.
- Kiosk-Livebild und Watch-Liste.
- Mehrbrowser-E2E sowie Belastungs- und LAN-Spieltest mit möglichst vielen realen Personen.
- Erst nach dem Spieltest Werte für Drehgeschwindigkeit, Spurbreite und Lückendichte feinjustieren.

## 10. Testkonzept

### Unit-Tests

- Bewegung ohne und mit linker/rechter Eingabe bei fester Zeit.
- Gleiche Ergebnisse bei unterschiedlicher Aufteilung derselben verstrichenen Zeit.
- Wand-, Eigen- und Fremdspurkollision.
- Lücken sind sichtbar, aber nicht kollidierbar.
- Die eigene neue Spur löst innerhalb der Sicherheitsdistanz keine Selbstkollision aus.
- Kopf-an-Kopf und sich kreuzende Wege scheiden unabhängig von Iterationsreihenfolge beide aus.
- Mehrere gleichzeitige Ausscheidungen vergeben die korrekte Punktzahl.
- All-dead-Tick, eindeutiger Rundensieger, Zielerreichung und Entscheidungsrunde.
- Spawnsets für jede Spielerzahl 2–8 sind kollisionsfrei und symmetrisch verteilt.
- Gleicher Seed erzeugt denselben Lückenplan.

### Socket- und Integrationstests

- Beitritt und Start funktionieren für jede Zahl 2–8; ein neunter Platz wird abgelehnt.
- Start scheitert mit einer Person oder nicht bereiten Gästen.
- Parallele Join-Versuche auf den letzten Platz lassen exakt eine Person zu.
- Fremde Identität, fremder Scope, Nichtmitglied und falsche Phase werden abgelehnt.
- Inputs akzeptieren nur `-1`, `0`, `1`; veraltete Sequenzen ändern den Zustand nicht.
- Eine Person kann weiterhin nur einer Arcade-Lobby angehören.
- Pause stoppt Simulation und Lückenplan; Fortsetzen erzeugt keinen Zeitsprung.
- Reconnect liefert einen vollständigen konsistenten Snapshot.
- Disconnect/Verlassen einer Person beendet ein Match mit drei oder mehr Personen nicht.
- Jeder Abschlussweg beendet Loop, Timer, Live-Status und offene Spielzeit genau einmal.
- Ergebnis und Statistik enthalten alle realen Personen und genau einen Sieger.
- Watch-State respektiert Gruppen-/Event-Scope und lässt sich nicht als Eingabekanal verwenden.

### E2E und visuelle Prüfung

- Vollständiges Duell mit zwei Browserkontexten von Lobby bis Ergebnis.
- Mehrspielerstart mit mindestens drei Kontexten einschließlich früher Ausscheidung.
- Zuschauer steigt während einer laufenden Runde ein und erhält den vollständigen Trail.
- Handy-Touchsteuerung beendet das Lenken zuverlässig bei `pointercancel` und View-Wechsel.
- Tastatursteuerung verhindert Seitenscrollen nur in der aktiven Matchansicht.
- Arena behält im normalen und expandierten Zustand das Seitenverhältnis.
- Lange Spielernamen, acht Personen, Pause, Rundentafel, Fehler-Ack und Reconnect bleiben lesbar.
- Kiosk und Zuschauer zeigen denselben Score- und Rundenstand wie die Teilnehmenden.

### Belastungsprüfung

Ein automatisierter Simulationslauf mit acht Personen muss mehrere aufeinanderfolgende Matches
ohne wachsende Timerzahl oder unbeschränkt wachsende Match-Maps beenden. Zusätzlich werden
Payloadgröße und Sendefrequenz gemessen. Das Ziel ist nicht Internet-Skalierung, sondern ein
stabiler dreitägiger LAN-Betrieb auf dem vorhandenen Server.

## 11. Abnahmekriterien

- Curve Fever ist im Arcade-Launcher auffindbar und als 2–8-Personen-Spiel erkennbar.
- Das Spiel unterscheidet sich durch freie Kurvensteuerung, dauerhafte Spuren, Lücken und
  Survival-Runden klar vom bestehenden Snake.
- Eine Lobby startet nur mit mindestens zwei, höchstens acht und vollständig bereiten Gästen.
- Serverzustand entscheidet jede Bewegung, Kollision, Wertung und Matchphase.
- Gleichzeitige Kollisionen sind unabhängig von Socket- und Iterationsreihenfolge fair.
- Tastatur und Touch können links, rechts und neutral zuverlässig ausdrücken; hängen gebliebene
  Eingaben werden abgefangen.
- Ein Disconnect oder Verlassen beendet ein Mehrpersonenspiel nicht für alle übrigen Personen.
- Reconnect, Zuschauer und Kiosk erhalten einen konsistenten Trail ohne Vollübertragung bei jedem
  Simulationstick.
- Ergebnis, Statistik, Live-Status und Spielzeit funktionieren mit allen realen Teilnehmenden.
- Es gibt keine neue Produktionsabhängigkeit.
- Lint, Build, Unit-/Integrationstests, Tokenprüfung und relevante Arcade-E2E-Tests sind grün.

## 12. Empfehlung

Das MVP sollte genau in diesem Umfang umgesetzt werden. Der wesentliche Erfolgsfaktor ist nicht
eine Vielzahl von Curve-Fever-Pro-Features, sondern eine saubere kontinuierliche Steuerung bei
stabiler Netzwerksynchronisation. Nach dem ersten LAN-Spieltest kann höchstens ein einzelnes,
klar begründetes Zusatzmerkmal priorisiert werden.

Snake sollte bis dahin das bestehende 1v1-Futterspiel bleiben. Damit besetzt Curve Fever die
Mehrspieler-FFA-Rolle, ohne im Arcade-Angebot ein nahezu gleiches zweites Snake-Spiel zu werden.
