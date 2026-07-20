# Konzept: Geo-basiertes Mitfahr-Matching

Stand: Juli 2026 · Status: **Konzeptentwurf zur Abstimmung**

Dieses Dokument beschreibt, wie das bestehende Fahrgemeinschafts-Feature so erweitert wird, dass das
Tool anhand von **geografischer Lage** und **Wunschzeit** passende Mitfahrer und Fahrten vorschlägt
und einen **Treffpunkt** empfiehlt. Entfernungen und Umwege werden über **echte Routen** (Straßennetz)
berechnet, nicht über Luftlinie.

Entschiedene Rahmenbedingungen (Nutzerentscheidung):

- **Geocoding auf PLZ-Ebene** – Nutzer geben eine Postleitzahl an, keine Hausadresse.
- **Echtes Routing über OpenRouteService (ORS)** – externer Dienst, kostenloser API-Key.
- **Luftlinie als Notlösung** – ist ORS nicht erreichbar und nichts im Cache, rechnet das Matching
  mit einer als „geschätzt" markierten Luftlinien-Näherung weiter, statt hart abzubrechen.

---

## 1. Zusammenfassung und Urteil

Das Feature ist mit **akzeptablem Aufwand** umsetzbar (grob 3–3,5 Personentage voll, ~2 Tage für ein
MVP), ohne neues Framework und ohne Frontend-Build-Step. Es fügt sich additiv in die vorhandene
An-/Abreise-Ansicht ein.

Kernaussagen:

- Der **einzige echte Zukauf** ist ein externer Routing-Dienst (ORS) und eine statische, gemeinfreie
  PLZ→Koordinaten-Tabelle. Kein selbst gehosteter Routing-Server (OSRM/Valhalla mit
  Deutschland-Extrakt) – das widerspräche „schlanke Wartbarkeit".
- **PLZ-Granularität genügt** fürs Matching (auf ~5–10 km genau) und ist zugleich datenschutzfreundlich.
- **Echte Fahrzeiten** bilden das Nutzermodell „Umweg in Minuten" exakt ab.
- Ein **DB-Cache** für berechnete Fahrzeiten macht das Feature nach der ersten Berechnung unabhängig
  vom Dienst und schnell; der **Luftlinien-Fallback** sichert Zuverlässigkeit (Produktziel 1).
- Alles Neue ist **additiv**: bestehende Fahrgemeinschaften ohne Koordinaten funktionieren
  unverändert weiter und nehmen nur nicht am Matching teil.

---

## 2. Ist-Zustand

Das Feature „An-/Abreise + Fahrgemeinschaften" existiert bereits (`server/src/routes/arrivals.ts`,
`server/public/js/views/arrivals.js`).

| Baustein | Heute | Für Matching relevant |
| --- | --- | --- |
| `arrivals` (Tabelle) | Pro Spieler/Event: `arrival_at`, `departure_at`, `note` | Wunschzeit ist vorhanden; **es fehlt Startort + „suche Mitfahrgelegenheit"** |
| `carpools` (Tabelle) | Fahrer-Gruppe: `direction`, `label`, `start_at`, `start_location` (**Freitext**), `eta_at`, `seats_total` | Startort nur als Text „Hamburg"; **keine Koordinaten, kein Umweg-Budget** |
| `carpool_members` | Beitreten/Verlassen, Fahrer = `created_by` | bleibt unverändert |
| `events` | `location` als Freitext | **keine Venue-Koordinaten** als gemeinsames Ziel |

Es fehlen also vier Dinge: **Koordinaten für den Zielort**, **Koordinaten + Umweg-Budget beim
Fahrer**, ein **Mitfahr-Gesuch mit Startort/Umkreis** und die **Matching-Logik** mit
Treffpunkt-Vorschlag.

---

## 3. Zielbild: Nutzerfluss

**Als Mitfahrer:**

1. In „Meine An-/Abreise" den Schalter „Ich suche eine Mitfahrgelegenheit" aktivieren (getrennt für
   Anreise/Abreise möglich).
2. **PLZ** des Startorts eingeben (Ortsname wird automatisch ergänzt) und den **Umkreis** wählen, in
   dem man dem Fahrer entgegenkommen kann (z. B. 10 km).
3. Wunsch-Ankunftszeit (bzw. Abreisezeit) ist bereits über `arrival_at`/`departure_at` gepflegt.
4. Das Tool zeigt eine gerankte Liste **passender Fahrten** mit realem Umweg in Minuten und
   vorgeschlagenem Treffpunkt.

**Als Fahrer:**

1. Fahrgemeinschaft anlegen wie heute, zusätzlich **PLZ des Startorts** und **„Umweg (Minuten)"**,
   den man bereit ist zu fahren.
2. Das Tool zeigt eine gerankte Liste **passender Mitfahrer** – jeweils mit Umweg-Zeit und
   Treffpunkt – und einen Button „Platz anbieten / einladen".

Der Zielort ist für alle derselbe: die **Venue-Koordinaten des laufenden Events**.

---

## 4. Geocoding: PLZ-Tabelle

- Eine statische Datei (z. B. `server/src/data/plz-de.json`) bildet **deutsche PLZ → { lat, lon,
  ort }** ab (~8.200 Einträge, ~300 KB; gemeinfreie Quelle wie OpenGeoDB/OSM, Herkunft im Repo
  dokumentiert).
- Sie wird beim Serverstart einmal in eine `Map` geladen (Lookup + Reverse-Lookup „nächste PLZ zu
  Koordinate"). Kein externer Call fürs Geocoding.
- Eingaben werden validiert (5-stellige PLZ, muss in der Tabelle existieren). Unbekannte/ausländische
  Orte bleiben als Freitext möglich, nehmen aber nicht am Matching teil (klar gekennzeichnet).

---

## 5. Routing: OpenRouteService + Cache + Fallback

### 5.1 Dienst

- **OpenRouteService**, angesprochen per `fetch` (keine schwere Client-Library).
- Genutzt wird primär der **Matrix-Endpoint** (`/v2/matrix/driving-car`): Fahrzeiten zwischen mehreren
  Startpunkten und dem Ziel in **einem** Request. Bei ~15 Teilnehmenden ist das eine kleine Matrix.
- **API-Key** kommt aus einer Umgebungsvariable (z. B. `ORS_API_KEY`), niemals aus dem Repo
  (NFR-13). Fehlt der Key, ist das Matching-Feature inaktiv (die Basis-Fahrgemeinschaften bleiben
  nutzbar).
- Timeouts und Fehlercodes werden abgefangen; ein Dienstfehler bringt nie den Serverprozess oder das
  Rendern der Seite in Gefahr (NFR-02/03).

### 5.2 Cache (`route_durations`)

PLZ→PLZ-Fahrzeiten sind praktisch konstant. Eine kleine DB-Tabelle speichert einmal berechnete
Werte dauerhaft:

```
route_durations(
  origin_plz TEXT, dest_plz TEXT,
  duration_s INTEGER, distance_m INTEGER,
  source TEXT,        -- 'ors' | 'haversine'
  computed_at INTEGER,
  PRIMARY KEY (origin_plz, dest_plz)
)
```

Nach dem ersten Lauf ist das Matching komplett aus dem Cache bedienbar – schnell und unabhängig von
kurzen ORS-Ausfällen. Ein `source='haversine'`-Eintrag wird bei nächster Gelegenheit durch einen
echten ORS-Wert ersetzt.

### 5.3 Fallback (Zuverlässigkeit zuerst)

Ist ORS nicht erreichbar und für ein Paar nichts (oder nur Luftlinie) im Cache, rechnet das Matching
mit **Haversine + Durchschnittsgeschwindigkeit** (z. B. 70 km/h) weiter. Solche Werte werden in der
UI klar als **„geschätzt (Luftlinie)"** markiert. Das Matching liefert also immer ein Ergebnis und
bricht nie hart ab.

---

## 6. Datenmodell-Erweiterung

Alle Änderungen sind **additive Spalten/Tabellen** per Migration – im selben Stil wie die
bestehenden `ALTER TABLE carpools ADD COLUMN …` in `server/src/db.ts`.

**Venue-Koordinaten (gemeinsames Ziel):**

```
events: + venue_plz TEXT, + venue_lat REAL, + venue_lon REAL
```
Einmal vom Admin je Event gesetzt (idealerweise über die PLZ des Veranstaltungsorts).

**Mitfahr-Gesuch (Erweiterung `arrivals`):**

```
arrivals: + needs_ride_arrival INTEGER NOT NULL DEFAULT 0
          + needs_ride_departure INTEGER NOT NULL DEFAULT 0
          + origin_plz TEXT
          + reach_radius_km INTEGER   -- wie weit ich entgegenkomme
```
Die Wunschzeit steckt bereits in `arrival_at`/`departure_at`. Koordinaten werden aus `origin_plz`
über die PLZ-Tabelle aufgelöst (nicht redundant gespeichert).

**Fahrer-Angebot (Erweiterung `carpools`):**

```
carpools: + origin_plz TEXT
          + detour_minutes INTEGER   -- Umweg, den ich bereit bin zu fahren
```
`start_location` (Freitext) bleibt für Rückwärtskompatibilität erhalten; neue Anlagen setzen
zusätzlich `origin_plz`.

---

## 7. Matching-Algorithmus

Server-seitig, für ein Fahrer-Angebot mit freien Plätzen und alle Mitfahr-Gesuche **derselben
Richtung** (Anreise/Abreise):

1. **Koordinaten** aller Startpunkte + Venue aus PLZ auflösen.
2. **Fahrzeitmatrix** holen (ORS Matrix, sonst Cache, sonst Luftlinien-Fallback). Benötigt werden je
   Paar: `dur(Fahrer→Venue)`, `dur(Fahrer→Mitfahrer)`, `dur(Mitfahrer→Venue)`.
3. **Umweg** je Mitfahrer:
   `Umweg = dur(Fahrer→Mitfahrer) + dur(Mitfahrer→Venue) − dur(Fahrer→Venue)`.
4. **Filter:** `Umweg ≤ detour_minutes` (Fahrer) **und** Mitfahrer erreichbar innerhalb seines
   `reach_radius_km` **und** `seatsFree > 0`.
5. **Zeit-Fit:** Wunsch-Ankunft des Mitfahrers ≈ `eta_at` des Fahrers innerhalb eines Toleranzfensters
   (z. B. ±60 min).
6. **Score & Ranking:** gewichtete Summe aus kleinem Umweg und kleiner Zeitabweichung, absteigend
   sortiert.

Bei ~15 Personen ist das eine winzige Rechnung (<1 ms nach Matrixabruf). Testbar mit Fixtures analog
`server/src/matchmaking.test.ts`: Happy Path, kein Match, Sitze voll, Zeit außerhalb Fenster, ORS
nicht verfügbar → Fallback.

---

## 8. Treffpunkt-Vorschlag

- Standard-Treffpunkt ist die **PLZ-Ortsmitte des Mitfahrers** – angezeigt mit Ortsname und realem
  Umweg in Minuten, z. B. *„Treffpunkt 21522 Hohnstorf · +7 Min. Umweg für den Fahrer"*.
- Optional (Ausbaustufe): statt des Mitfahrer-Orts eine **PLZ entlang der Route** innerhalb des
  Umkreises des Mitfahrers wählen, die den Fahrer-Umweg minimiert.
- Koordinaten werden mitgeliefert, sodass jeder den Punkt in einer beliebigen Karten-App
  (Google/Apple Maps) öffnen kann – **kein eingebauter Kartenzwang**.

---

## 9. API-Endpunkte (Skizze)

Additiv zum bestehenden `arrivalsRouter`:

- `PUT /api/arrivals/mine` – erweitert um `needsRideArrival`, `needsRideDeparture`, `originPlz`,
  `reachRadiusKm`.
- `POST` / `PATCH /api/arrivals/carpools` – erweitert um `originPlz`, `detourMinutes`.
- `GET /api/arrivals/carpools/:id/matches` – gerankte Mitfahrer-Vorschläge für ein Angebot (Fahrer-Sicht).
- `GET /api/arrivals/ride-matches` – gerankte Fahrten für den anfragenden Mitfahrer (Mitfahrer-Sicht).
- Admin: Venue-Koordinaten je Event setzen (in der bestehenden Event-Verwaltung).

Alle Eingaben werden nach Typ, Länge und erlaubten Werten validiert; Realtime-Updates laufen über das
vorhandene `arrivalsChanged`-Event.

---

## 10. Frontend / UI

In `server/public/js/views/arrivals.js`, im bestehenden Designsystem (Tokens/Komponenten aus
`DESIGN_SYSTEM.md`), ohne Build-Step:

- **„Meine An-/Abreise":** Schalter „Ich suche eine Mitfahrgelegenheit" + PLZ-Feld (mit
  Ort-Autovervollständigung aus der Tabelle) + Umkreis-Auswahl.
- **Fahrgemeinschaft-Formular:** PLZ-Feld zusätzlich zum Bezeichnungs-Text, plus „Umweg (Min.)".
- **Neuer Abschnitt „Passende Fahrten / Mitfahrer":** gerankte Liste mit Umweg-Zeit, Treffpunkt und
  Aktion; „geschätzt"-Werte klar gekennzeichnet.

---

## 11. Datenschutz und Sicherheit

- **PLZ statt Adresse** ist bewusst gewählt: genügt fürs Matching und vermeidet Hausgenauigkeit.
- Angabe ist **opt-in** – ohne PLZ nimmt man nicht am Matching teil, alles andere bleibt nutzbar.
- **API-Key** ausschließlich über Umgebungsvariable; kein Secret im Repo (NFR-13).
- Gruppen-/Event-Scoping bleibt unangetastet: Matching sieht nur Daten des eigenen Events/der Gruppe.

---

## 12. Aufwand und Phasen

| Phase | Inhalt | Aufwand |
| --- | --- | --- |
| 1 | PLZ-Tabelle einbinden + Geocoding-/Geo-Utility (Lookup, Reverse-Lookup, Haversine) + Tests | ~0,5 Tag |
| 2 | ORS-Routing-Client + `route_durations`-Cache + Luftlinien-Fallback + Tests | ~1 Tag |
| 3 | Migration + API: Venue-Koordinaten, Mitfahr-Gesuch, Fahrer-Geo/Umweg-Felder | ~0,5 Tag |
| 4 | Matching-Endpoints (Matrix → Umwege → Ranking) + Treffpunkt + Tests | ~0,5–1 Tag |
| 5 | Frontend: PLZ-Felder, Vorschlagslisten, Umweg-/Treffpunkt-Anzeige | ~1 Tag |

**Voll:** ~3–3,5 Tage. **MVP** (Phasen 1–4 + minimale UI): ~2 Tage. Neue Produktions-Abhängigkeit:
der Routing-Dienst (nur Netzwerk-Call) und die statische PLZ-Tabelle.

---

## 13. Bewusste Grenzen

- **PLZ-genau, nicht adressgenau** – Feature (Datenschutz), kein Bug; die genaue Absprache treffen die
  Leute selbst.
- **Deutschland-fokussiert** – ausländische Startorte bleiben Freitext ohne Matching.
- **Fahrzeit-Näherung im Fallback** – bei ORS-Ausfall ohne Cache nur Luftlinie, klar gekennzeichnet.
- **Kein dynamisches Live-Routing** – geplant wird vorab, nicht während der Fahrt.

---

## 14. Offene Punkte

- Zielort: Venue-Koordinaten je Event manuell durch Admin, oder aus `events.location` per PLZ ableiten?
- Toleranzfenster für den Zeit-Fit (Vorschlag ±60 min) und Fallback-Geschwindigkeit (Vorschlag 70 km/h)
  final festlegen.
- Bezugsquelle/Lizenz der PLZ-Tabelle final wählen und im Repo dokumentieren.
