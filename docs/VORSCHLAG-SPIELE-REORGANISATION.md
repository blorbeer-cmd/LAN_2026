# Vorschlag: Spiele-Funktionen zusammenführen

Konzept zur Neuordnung aller Spiele-Funktionen. Ziel: **ein Ort pro Frage** statt fünf Orte pro
Spiel – und die wichtigen Zahlen (mein Bock, mein Skill, Gruppen-Schnitt, Skill-Vorschlag aus
Ergebnissen) direkt sichtbar in der Spiele-Liste.

## 1. Ist-Zustand: fünf Orte, zwei Datenwelten

| Ort | Was man dort macht | Code |
| --- | --- | --- |
| ⚙️ Einstellungen → „Spiele verwalten" | Getrackte Spiele anlegen: Name, Icon, Teamgröße, **Prozessnamen** für den Agent | `views/games.js`, Tabelle `games` |
| 👤 Mein Profil | **Skill-Ratings** (1–10) und **Bock-Level** (1–10) als zwei getrennte, lange Slider-Listen | `views/profile.js`, Tabellen `skills`, `preferences` |
| 🗳️ Vote | Abstimmung „Was zocken wir als Nächstes?", sortiert nach Ø-Bock | `views/votes.js` |
| ☰ Mehr → „Spiele-Liste" | Fundus „Was könnten wir zocken?": Plattform, Trailer, **eigenes Bock-Rating (1–5!)**, Vorschläge einreichen | `views/gameCatalog.js`, Tabellen `game_catalog`, `game_catalog_ratings` |
| ☰ Mehr → „Spiele & Turniere" + „Spielzeit-Auswertungen" | Match-/Turnier-Statistiken bzw. Spielzeiten | `views/gameStats.js`, `views/analytics.js` |

### Die Kernprobleme

1. **Zwei getrennte Datenwelten für „ein Spiel".** `games` (getrackt, mit Prozessnamen, Skill/Bock
   1–10) und `game_catalog` (Fundus, mit Plattform/Trailer, eigenem Bock 1–5) wissen nichts
   voneinander. CS2 existiert doppelt: einmal als getracktes Spiel mit Skill-Slider im Profil,
   einmal als Katalog-Eintrag mit 5er-Bock-Skala. Zwei Bock-Skalen (1–10 und 1–5) für dieselbe
   Frage.
2. **Meine Wertungen sind weit weg vom Spiel.** Bock und Skill pflegt man im Profil in zwei
   langen Listen – dort sieht man weder den Gruppen-Schnitt noch sonst irgendetwas zum Spiel.
   Umgekehrt zeigt die Spiele-Liste zwar Ø-Bock, aber weder meinen Skill noch den Ø-Skill.
3. **Es gibt keine Antwort auf „Wie steht das Spiel gerade da?"** – dafür muss man heute Profil,
   Spiele-Liste, Vote und zwei Auswertungs-Seiten abklappern.
4. **Skill ist reine Selbsteinschätzung.** In `matches` liegen echte Ergebnisse, aber sie fließen
   nirgends als Vorschlag in die Skill-Wertung zurück.
5. **Admin-Pflege (Prozessnamen) klemmt in den Einstellungen** zwischen Events und Einladungslink,
   obwohl sie inhaltlich zum jeweiligen Spiel gehört.

## 2. Zielbild: ein „Spiele"-Hub mit Detailseite

### 2.1 Datenmodell: `game_catalog` in `games` aufgehen lassen

Eine Tabelle `games` für alle Spiele, mit Lebenszyklus statt Parallelwelt:

```
games
  + platform      TEXT      (aus game_catalog übernommen)
  + platform_url  TEXT
  + trailer_url   TEXT
  + status        TEXT      'suggestion' | 'catalog' | 'tracked'
  + created_by    TEXT      (wer hat's vorgeschlagen)
```

- **`suggestion`** – von irgendwem vorgeschlagen, noch nicht bestätigt.
- **`catalog`** – im Fundus („könnten wir zocken"), taucht in Bock-Wertung und Voting auf.
- **`tracked`** – zusätzlich mit Prozessnamen hinterlegt, Agent erkennt es. Der Status ist
  faktisch ableitbar (`processNames.length > 0`), wird aber explizit gehalten, damit ein Spiel
  auch bewusst „Katalog-only" bleiben kann (z. B. Brettspiel, Konsole).

**Eine Bock-Skala:** `preferences` (1–10) gilt für alle Spiele; `game_catalog_ratings` (1–5)
wird migriert (`1→2, 2→4, 3→6, 4→8, 5→10`) und entfernt. Skills bleiben wie sie sind – auch für
Katalog-Spiele erlaubt, aber optional. Migration matcht bestehende Katalog-Einträge per
Titel-Vergleich auf vorhandene `games` (Rest wird als `status='catalog'` neu angelegt).

Damit verschwinden: `game_catalog`, `game_catalog_ratings`, `game_catalog_interest`, der
komplette `gameCatalogRouter` und `views/gameCatalog.js` als eigenes Silo.

### 2.2 Neue Ansicht „🎮 Spiele" (ersetzt „Spiele-Liste" im Mehr-Hub)

Eine Liste aller Spiele, **mit den Zahlen direkt in der Zeile**:

```
[Icon] Counter-Strike 2                    Steam · getrackt
       🔥 Bock  ich: 8  Ø 7,2 (11)        💪 Skill  ich: 6  Ø 5,8 (9)   🧠 7
```

- **Mein Bock** ist direkt in der Zeile antippbar (Stepper/kompakter Slider) – kein Umweg mehr
  übers Profil. Gleicher Fire-and-forget-Save wie heute die Profil-Slider.
- **Ø Bock / Ø Skill** mit Anzahl der Wertungen in Klammern – man sieht sofort, worauf die
  Gruppe gerade Lust hat und wie das Feld einzuschätzen ist.
- **🧠 = Skill-Vorschlag aus Ergebnissen** (siehe 2.4), dezent neben dem eigenen Skill; weicht
  er deutlich ab, wird er hervorgehoben.
- **Sortierung:** Ø Bock (Default – „worauf haben alle Bock?"), Name, mein Bock, Ø Skill.
- **Filter/Tabs:** „Alle" / „Vorschläge" (wie heute), plus Badge `getrackt`/`Katalog` je Zeile.
- **„+ Spiel vorschlagen"** bleibt für alle offen (Titel, Plattform, Trailer). Admins können
  Vorschläge per Knopf in den Katalog übernehmen oder direkt Prozessnamen ergänzen → getrackt.

Wichtig fürs Layout: `.list-row`-Muster wiederverwenden, die Kennzahlen-Zeile hat feste Höhe
(fehlende Werte als „–"), damit Zeilen nicht springen (siehe Design-System in CLAUDE.md).

### 2.3 Spiel-Detailseite (Antwort auf „Wie steht das Spiel da?")

Tippen auf eine Zeile öffnet die Detail-Ansicht mit allem zu diesem Spiel:

1. **Info:** Icon/Artwork, Plattform (+ Link), Trailer, Teamgröße, Status-Badge.
2. **Meine Wertung:** Bock-Slider und Skill-Slider nebeneinander – dieselben Komponenten wie
   heute im Profil, nur eben beim Spiel.
3. **Gruppe:** Ø Bock und Ø Skill mit Anzahl, optional kleine Verteilung (wer hat wie viel Bock –
   hilft bei „kriegen wir ein 5er-Team voll?").
4. **🧠 Skill-Vorschlag:** „Aus 12 Ergebnissen: **7** (58 % Siege) · [Übernehmen]" – siehe 2.4.
5. **Statistik-Kurzblock:** Anzahl Ergebnisse, Spielzeit gesamt, Top 3 in diesem Spiel – mit
   Link „Alle Auswertungen" in die bestehende Auswertungs-Ansicht (vorgefiltert auf das Spiel).
6. **Aktionen:** „🗳️ In laufende Abstimmung springen", „📣 Jetzt zocken?-Ping" für dieses Spiel.
7. **Verwaltung** (eingeklappt, ganz unten): Name/Icon/Teamgröße bearbeiten, **Prozessnamen**
   pflegen (inkl. bestehender Vorschlags-Logik aus `gameProcessSuggestions.js`), Spiel löschen.
   → Das ist der heutige `openGameDetail`-Modal aus den Einstellungen, nur an den richtigen Ort
   gezogen.

### 2.4 Skill-Vorschlag aus Spiel-Ergebnissen

Neuer read-only Endpoint, z. B. `GET /api/skills/suggestions?playerId=…`:

- Datenbasis: `matches` (Team-Zusammensetzung + Sieger liegen im `result`-JSON) je Spiel.
- **Berechnung bewusst simpel (Elo-lite):** pro Spiel und Spieler ein Rating, Start 1500,
  K-Faktor 32, Team-Rating = Mittel der Spieler-Ratings; am Ende linear auf 1–10 gemappt
  (1200→1, 1800→10, geklemmt). Reine Funktion, gut unit-testbar, deterministisch aus der
  Match-Historie berechenbar – kein zusätzlicher Persistenz-Zustand nötig.
- **Anzeige erst ab 3 Ergebnissen** in dem Spiel, sonst „–" (zu wenig Daten wirkt sonst albern).
- **Niemals automatisch überschreiben.** Die Selbsteinschätzung bleibt führend (sie deckt auch
  Spiele ohne erfasste Ergebnisse ab und bleibt für die Team-Auslosung die Quelle). Der Vorschlag
  ist ein Hinweis mit Ein-Klick-„Übernehmen" (setzt `skills.rating` auf den Vorschlag).
- In der Liste (2.2) erscheint 🧠 nur, wenn ein Vorschlag existiert; weicht er ≥2 Punkte von der
  Selbsteinschätzung ab, wird er farblich markiert – sanfter Anstoß, die eigene Wertung zu
  aktualisieren, ohne zu nerven.

### 2.5 Was aus den bisherigen Orten wird

| Heute | Nachher |
| --- | --- |
| Einstellungen → „Spiele verwalten" | **Entfällt dort.** „+ Spiel" und Pflege (Prozessnamen etc.) leben in der Spiele-Ansicht / Detailseite. Einstellungen behalten Events, Einladungslink, Kiosk. |
| Profil → Skill-Ratings + Bock-Level (2 Listen) | **Entfällt dort.** Stattdessen eine Karte „🎮 Meine Spiele-Wertungen → Bearbeiten" die in die Spiele-Ansicht führt. Fürs Onboarding neuer Spieler: nach Profil-Anlage direkt in die Spiele-Ansicht mit Hinweis-Banner „Trag kurz Bock & Skill ein". Das Profil wird deutlich kürzer: Identität, Agent, Push, Sitznachbarn. |
| Mehr → „Spiele-Liste" (Katalog) | Wird zur neuen **„🎮 Spiele"**-Ansicht (2.2). |
| Vote | Bleibt eigenständig (eigener Ablauf mit Runden). Jede Spiel-Zeile zeigt zusätzlich zum Ø-Bock **meinen** Bock und verlinkt auf die Detailseite. |
| Mehr → „Spielzeit-Auswertungen" + „Spiele & Turniere" | Zu **einer** Ansicht „📊 Auswertungen" mit zwei Tabs (Spielzeit / Matches & Turniere) zusammenlegen – ein Eintrag weniger im Mehr-Hub, und die Spiel-Detailseite kann gezielt vorgefiltert hineinlinken. |

### 2.6 Navigation

Bottom-Nav bleibt unverändert (Live, Turniere, Teams, Vote, Rang, Mehr) – sie ist voll, und die
Spiele-Pflege ist kein Dauer-Nutzungsfall während der Party. Im Mehr-Hub rückt „🎮 Spiele" nach
oben (unter Info-Board), Beschreibung: *„Alle Spiele: Bock & Skill eintragen, vorschlagen,
verwalten."* Der Hub wird netto um einen Eintrag kürzer (zwei Auswertungen → eine).

## 3. Umsetzung in Phasen (jeweils in sich abgeschlossen)

1. **Schema & API:** `games` um Katalog-Felder + Status erweitern, Migration von `game_catalog`
   (Titel-Matching, Bock-Skala 1–5 → 1–10), `gameCatalogRouter` durch erweiterten `gamesRouter`
   ersetzen. Concurrency-Guard + Test für „Vorschlag übernehmen" (zwei Admins gleichzeitig → 409).
2. **Spiele-Ansicht + Detailseite:** neue View mit Kennzahlen-Zeilen, Inline-Bock, Detailseite
   inkl. Verwaltungs-Teil; Einstellungen- und Katalog-View entsprechend zurückbauen.
3. **Profil entschlacken + Onboarding-Weiche** in die Spiele-Ansicht.
4. **Skill-Vorschlag:** Elo-lite-Modul (Unit-Tests!), Endpoint, Anzeige in Liste + Detail +
   „Übernehmen"-Knopf.
5. **Auswertungen zusammenlegen** (zwei Views → eine mit Tabs) + Deep-Link aus der Detailseite.

Jede Phase hält `npm test` grün; Phase 2/3/5 brauchen E2E-Anpassungen (Onboarding-Pfad,
Spiele-Klickpfade).
