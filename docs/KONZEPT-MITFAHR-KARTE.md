# Konzept: Mitfahr-Karte

Stand: Juli 2026 · Status: **Konzeptentwurf zur Abstimmung** (Rev. 2 – ersetzt den früheren
Matching-Ansatz)

Dieses Dokument ersetzt den ursprünglichen Plan eines automatischen Matching-Algorithmus
(`route_durations`-Cache, externer Routing-Dienst, Umweg-Berechnung in Minuten, gebündelte
PLZ-Datenbank). Dieser Ansatz war für den tatsächlichen Bedarf zu viel Maschinerie: eine
Routing-Engine, ein Fahrzeit-Cache und ein Ranking-Algorithmus lohnen sich für ~15 Personen nicht,
und die Suche nach einer sauber lizenzierten PLZ-Koordinaten-Tabelle war selbst schon aufwändiger
als der Rest des Features.

Stattdessen: **eine Karte statt eines Algorithmus.** Fahrer und Mitfahrer tragen sich mit Ort und
ungefährer Zeit ein, das Tool zeigt alle offenen Fahrten und Gesuche auf einer gemeinsamen Karte –
das Zusammenfinden übernehmen die Leute selbst, so wie sie es beim LAN-Vorbereiten ohnehin per
Zuruf/Chat tun würden, nur mit einer besseren Übersicht.

---

## 1. Zusammenfassung

- Kein Matching-Algorithmus, keine Umweg-Berechnung, keine externe Routing-API, kein
  Fahrzeit-Cache.
- **Ein Ort wird durch Klick/Suche auf einer Karte gesetzt**, nicht durch eine PLZ-Datenbank.
  Dadurch entfällt das Datenbeschaffungsproblem komplett.
- Drei Orte werden sichtbar: **Ziel** (Event-Adresse), **Fahrer-Startpunkte** (aus bestehenden
  Fahrgemeinschaften) und **noch unverplante Mitfahrer** (die ein Gesuch hinterlegt haben, aber in
  keiner Fahrgemeinschaft sind).
- Deutlich kleinerer Umfang als der vorherige Plan: additive Spalten statt neuer Tabellen für
  Fahrzeiten, keine neue Server-Abhängigkeit außer einer Kartenbibliothek fürs Frontend.
- **Eine neue Abhängigkeit ist trotzdem nötig:** eine Kartenbibliothek (empfohlen: Leaflet) plus ein
  Kartenkachel-Dienst (OpenStreetMap). Das ist laut Entwicklungsrichtlinien zustimmungspflichtig –
  siehe Abschnitt 6.

---

## 2. Ist-Zustand (unverändert gegenüber vorher)

Das Feature „An-/Abreise + Fahrgemeinschaften" existiert bereits
(`server/src/routes/arrivals.ts`, `server/public/js/views/arrivals.js`):

| Baustein | Heute |
| --- | --- |
| `arrivals` | Pro Spieler/Event: `arrival_at`, `departure_at`, `note`. **Kein** „ich brauche eine Mitfahrgelegenheit"-Feld, kein Startort. |
| `carpools` | Fahrer-Gruppe: `direction`, `label`, `start_at`, `start_location` (Freitext), `eta_at`, `seats_total`. **Keine Koordinaten.** |
| `carpool_members` | Beitreten/Verlassen, Fahrer = `created_by`. |
| `events` | `location` als Freitext. **Keine Adresse/Koordinaten.** |

---

## 3. Zielbild: Nutzerfluss

**Admin (einmalig pro Event):**

Im Event-Formular eine Adresse für den Veranstaltungsort hinterlegen – per Adresssuche oder direkt
per Klick auf die Karte. Das ist das gemeinsame Ziel, das auf der Mitfahr-Karte immer angezeigt
wird.

**Als Mitfahrer:**

1. In „Meine An-/Abreise" den Schalter „Ich suche eine Mitfahrgelegenheit" aktivieren (getrennt für
   Anreise/Abreise).
2. Startort setzen: Adresssuche (z. B. „Hamburg Hauptbahnhof") oder direkt auf der Karte einen Pin
   setzen/verschieben.
3. Die schon vorhandene Wunschzeit (`arrival_at`/`departure_at`) wird mitverwendet – keine
   zusätzliche Zeitangabe nötig.
4. Solange man keiner Fahrgemeinschaft beigetreten ist, erscheint man auf der Mitfahr-Karte als
   „sucht noch" markiert.

**Als Fahrer:**

1. Fahrgemeinschaft anlegen wie heute (Label, Zeit, Sitzplätze), zusätzlich den Startort per
   Adresssuche oder Karten-Pin setzen.
2. Die Fahrgemeinschaft erscheint auf der Karte mit Startpunkt, Zeit und den bereits
   beigetretenen Mitfahrern.

**Alle:**

Ein neuer Button „🗺️ Karte" im Bereich „Fahrgemeinschaften" öffnet eine Kartenansicht mit:

- einem Marker für das **Ziel** (Event-Adresse),
- einem Marker je **Fahrgemeinschaft** (Startpunkt, Label, Fahrer, Uhrzeit, freie Plätze,
  bereits eingeplante Mitfahrer als Popup-Liste),
- einem Marker je **unverplantem Mitfahr-Gesuch** (Startpunkt, Wunschzeit, Name), visuell klar
  von den Fahrer-Markern unterschieden (andere Farbe/Icon).
- Ein Umschalter Anreise/Abreise, da beide Richtungen unterschiedliche Marker-Sets sind und
  gemeinsam auf einer Karte unübersichtlich wären.

Aus der Karte heraus wieder zu den bestehenden Karten/Buttons (Details, Mitfahren) verlinken statt
das Beitreten selbst auf der Karte nachzubauen.

---

## 4. Ortsbestimmung: Karte statt Datenbank

Kein bundled Geocoding-Datensatz mehr. Stattdessen zwei kombinierte Bausteine:

1. **Direkte Pin-Platzierung** (immer verfügbar, kein externer Aufruf): Nutzer klickt auf die
   eingebettete Karte oder zieht einen Marker – das liefert direkt `lat`/`lon`. Funktioniert auch,
   wenn die Adresssuche gerade nichts findet oder nicht erreichbar ist.
2. **Adresssuche als Komfort** (optional, Server-Proxy zu OpenStreetMap **Nominatim**): Ein Suchfeld
   über der Karte schlägt beim Tippen Orte vor; Auswahl setzt den Pin. Der Server ruft Nominatim
   *für* den Client auf (nicht der Browser direkt), damit:
   - ein aussagekräftiger `User-Agent` gesetzt werden kann (von Nominatims Nutzungsrichtlinie
     verlangt),
   - Anfragen serverseitig gedrosselt werden (Nominatim erlaubt max. 1 Anfrage/Sekunde),
   - identische Suchanfragen aus einem einfachen Cache beantwortet werden, statt Nominatim erneut
     zu belasten.

Damit entfällt das Problem der Vorwoche komplett: keine Lizenzfrage für eine gebündelte
PLZ-Tabelle, keine Deutschland-Beschränkung, beliebige Genauigkeit (Straße statt nur PLZ), und der
Nutzer sieht sofort auf der Karte, wo der Pin tatsächlich landet.

---

## 5. Datenmodell-Erweiterung

Deutlich schlanker als der vorherige Plan – nur Koordinatenspalten, keine Cache-/Ergebnistabelle,
kein Umweg-Budget:

```
events:   + venue_address TEXT, + venue_lat REAL, + venue_lon REAL

arrivals: + needs_ride_arrival INTEGER NOT NULL DEFAULT 0
          + needs_ride_departure INTEGER NOT NULL DEFAULT 0
          + origin_label TEXT       -- was der Nutzer eingegeben/ausgewählt hat, nur zur Anzeige
          + origin_lat REAL
          + origin_lon REAL

carpools: + start_lat REAL, + start_lon REAL   -- start_location (Freitext) bleibt als Label bestehen
```

Alles additiv per Migration, im selben Stil wie die bestehenden `ALTER TABLE carpools ADD COLUMN …`
in `server/src/db.ts`. Rückwärtskompatibel: bestehende Einträge ohne Koordinaten erscheinen weiter
in den Listen, nur eben nicht auf der Karte.

Optionaler, kleiner Cache für Adresssuchen (spart wiederholte Nominatim-Aufrufe, kein Zwang für
MVP):

```
geocode_cache(query TEXT PRIMARY KEY, label TEXT, lat REAL, lon REAL, cached_at INTEGER)
```

---

## 6. Neue Abhängigkeit: Kartenbibliothek (zustimmungspflichtig)

Eine Karte lässt sich nicht ohne Kartenbibliothek und Kartenkachel-Dienst darstellen. Das ist eine
neue Produktionsabhängigkeit im Sinne der Entwicklungsrichtlinien und braucht explizite Zustimmung,
bevor implementiert wird.

| Baustein | Empfehlung | Warum |
| --- | --- | --- |
| Kartenbibliothek | **Leaflet** (MIT-Lizenz, ~40 KB), selbst gehostet unter `server/public/vendor/leaflet/` | Kein Build-Step nötig (reines UMD-Script + CSS, passt zu NFR-17), kein CDN-Aufruf zur Laufzeit nötig, funktioniert offline bis auf die Kartenkacheln selbst. |
| Kartenkacheln | Öffentliche **OpenStreetMap**-Tiles, direkt vom Browser geladen (nicht über unseren Server) | Kostenlos für den geringen Umfang einer 15-Personen-LAN, keine Serverlast. Erfordert Internet im Client beim Öffnen der Kartenansicht – der Rest des Tools bleibt davon unberührt. |
| Adresssuche | **Nominatim** (OpenStreetMap), server-seitig proxied + gecached | Siehe Abschnitt 4. |

Bewusster Kompromiss: Die Kartenansicht selbst braucht eine Internetverbindung (Kacheln laden vom
OSM-Server). Das ist ein neuer, klar abgegrenzter Unterschied zum Rest des Tools, der auch bei
kurzen WLAN-Ausfällen weiterläuft. Falls das nicht gewünscht ist, wäre die Alternative ein
selbstgehosteter Tile-Server – deutlich mehr Betriebsaufwand (Kartendaten, Speicherplatz), dagegen
spricht „schlanke Wartbarkeit".

---

## 7. API-Endpunkte (Skizze)

Additiv zum bestehenden `arrivalsRouter` bzw. `eventsRouter`:

- `PATCH /api/events/:id` – erweitert um `venueAddress`, `venueLat`, `venueLon`.
- `PUT /api/arrivals/mine` – erweitert um `needsRideArrival`, `needsRideDeparture`, `originLabel`,
  `originLat`, `originLon`.
- `POST` / `PATCH /api/arrivals/carpools` – erweitert um `startLat`, `startLon`.
- `GET /api/arrivals/map?direction=arrival|departure` – liefert das fertige Kartenbild als Daten:
  Ziel-Koordinate, alle Fahrgemeinschaften mit Koordinaten der gewählten Richtung (inkl. Mitglieder),
  alle unverplanten Mitfahr-Gesuche mit Koordinaten. Reine Leseabfrage auf vorhandenen Tabellen,
  keine Berechnung.
- `GET /api/geocode?q=…` – dünner, gecachter Proxy zu Nominatim für die Adresssuche.

Alle Eingaben werden nach Typ, Länge und Wertebereich validiert (u. a. Koordinaten auf plausible
Lat/Lon-Grenzen); Realtime-Updates laufen über das vorhandene `arrivalsChanged`-Event.

---

## 8. Frontend

In `server/public/js/views/arrivals.js`, im bestehenden Designsystem, ohne Build-Step:

- **„Meine An-/Abreise":** Schalter „Ich suche eine Mitfahrgelegenheit" (getrennt Anreise/Abreise) +
  ein Orts-Feld mit Suchvorschlägen und eingebetteter Mini-Karte zum Pin-Setzen.
- **Fahrgemeinschaft-Formular:** dasselbe Orts-Feld für den Startpunkt.
- **Event-Formular** (`views/games.js`, dort liegt die Event-Verwaltung bereits): dasselbe Orts-Feld
  für die Venue-Adresse.
- **Neuer Button „🗺️ Karte"** im Fahrgemeinschaften-Bereich öffnet eine große Kartenansicht (Modal
  oder eigener Abschnitt) mit Anreise/Abreise-Umschalter und den drei Marker-Typen aus Abschnitt 3.

---

## 9. Aufwand und Phasen

| Phase | Inhalt | Aufwand |
| --- | --- | --- |
| 1 | Leaflet vendoren + wiederverwendbare Orts-Feld-Komponente (Suche + Klick-Pin) | ~0,5 Tag |
| 2 | Migration (Koordinatenspalten) + API-Erweiterungen (Events, Arrivals, Carpools) + Geocode-Proxy mit Cache | ~0,5 Tag |
| 3 | `GET /api/arrivals/map` + Kartenansicht im Frontend (Marker, Popups, Anreise/Abreise-Umschalter) | ~0,5–1 Tag |
| 4 | Event-Formular um Venue-Adresse erweitern; Tests (Happy Path, Validierung, fehlende Venue) | ~0,5 Tag |

**Gesamt: ~2–2,5 Tage** – spürbar weniger als der vorherige Plan (3–3,5 Tage), weil Routing-Client,
Fahrzeit-Cache und Matching-Algorithmus vollständig entfallen.

---

## 10. Bewusst nicht gebaut (Abgrenzung zum verworfenen Konzept)

- **Kein automatisches Ranking/Matching** – die Karte zeigt alle Daten, Menschen entscheiden selbst.
- **Keine Umweg-Berechnung in Minuten**, keine Fahrzeit-Matrix, kein Routing-Dienst, kein API-Key.
- **Keine gebündelte PLZ-Koordinaten-Tabelle** – Orte kommen aus direkter Nutzereingabe (Klick/Suche),
  nicht aus einer mitgelieferten Datenbank.
- **Keine Treffpunkt-Optimierung** – wer sich wo trifft, sprechen Fahrer und Mitfahrer nach Blick auf
  die Karte selbst ab.

## 11. Offene Punkte

- Zustimmung zur neuen Abhängigkeit (Leaflet + OSM-Tiles + Nominatim-Proxy), siehe Abschnitt 6.
- Sollen bereits einer Fahrgemeinschaft beigetretene Mitfahrer zusätzlich mit einem **eigenen**
  Abholort markiert werden (statt nur am Fahrer-Startpunkt zu erscheinen)? Für den ersten Wurf reicht
  ein Marker pro Fahrgemeinschaft am Fahrer-Startpunkt mit einer Mitglieder-Liste im Popup; einzelne
  Abholpunkte pro Mitfahrer wären eine spätere Ausbaustufe mit einer zusätzlichen Spalte an
  `carpool_members`.
- Datenschutz: Ortsangaben sind jetzt potenziell genauer als die vorherige PLZ-Idee (echte Adresse
  statt Postleitzahl). Sichtbarkeit bleibt wie gehabt auf die eigene Gruppe beschränkt; im UI sollte
  ein Hinweis stehen, dass eine ungefähre Angabe (z. B. Stadtteil statt Hausnummer) genügt.
