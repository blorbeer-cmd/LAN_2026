# Konzept: Feature-Nutzungsanalyse

Stand: 2026-08-17 · Status: **Konzept, noch nicht umgesetzt**

Zweck: Nach der ersten LAN belastbar entscheiden können, welche Funktionen **ausgebaut**, welche
**umgebaut/verbessert** und welche **entfernt** werden. Dieses Dokument beschreibt, welche Daten
dafür nötig sind, wie sie erhoben werden und wie daraus Entscheidungen abgeleitet werden. Es
enthält bewusst noch keine Implementierung.

---

## 1. Die eigentliche Frage

„Wie oft wird Funktion X genutzt?“ ist für die Entscheidung nicht ausreichend. Eine Funktion mit
null Nutzung kann drei sehr verschiedene Ursachen haben:

1. **Kein Bedarf** → entfernen.
2. **Bedarf, aber nicht gefunden** (Entdeckbarkeit) → umbauen, nicht entfernen.
3. **Bedarf und gefunden, aber Nutzung abgebrochen** (zu umständlich, fehlerhaft, zu langsam)
   → verbessern.

Diese drei Fälle unterscheiden sich messtechnisch nur dann, wenn zu jeder Nutzung auch die
**Gelegenheit zur Nutzung** und der **Ausgang des Versuchs** erfasst werden. Das ist die zentrale
Designentscheidung dieses Konzepts: nicht Klicks zählen, sondern **Trichter je Funktion** messen.

```
Sichtbar (Impression)  →  Berührt (Interaktion)  →  Ergebnis (ok / leer / Fehler / Abbruch)
```

Ohne den ersten Schritt gibt es keinen Nenner, und ohne den letzten keine Aussage über Qualität.

---

## 2. Leitplanken

Abgeleitet aus `DEVELOPMENT_GUIDELINES.md` (Produktziele in dieser Reihenfolge):

- **Zuverlässigkeit zuerst.** Die Messung darf die Anwendung nie beeinträchtigen. Jeder
  Instrumentierungsaufruf ist fehlertolerant (`try/catch`, niemals `await` im UI-Pfad), der
  Versand läuft gepuffert und asynchron. Ein ausgefallener oder langsamer Analytics-Endpunkt darf
  keine View blockieren, keinen Toast erzeugen und keinen Realtime-Kanal belasten.
- **Kein Realtime-Kanal.** Nutzungsdaten laufen nie über Socket.IO, sondern über einen eigenen,
  ratenbegrenzten HTTP-Endpunkt. Der Realtime-Weg bleibt für fachliche Ereignisse reserviert.
- **Keine externen Dienste.** Kein Google Analytics, Matomo, Sentry o. ä. Die LAN läuft
  potenziell ohne stabiles Internet, und Nutzungsdaten von 15 namentlich bekannten Personen
  gehören nicht auf fremde Server. Alles bleibt in der bestehenden SQLite-Instanz.
- **Schlanke Wartbarkeit.** Eine generische Ereignistabelle plus ein dünnes Frontend-Modul, keine
  Analytics-Abstraktionsschicht, keine neue Produktionsabhängigkeit.
- **Arcade-Grenzen bleiben.** Arcade-Module nutzen dieselbe generische Schnittstelle mit
  `arcade.*`-Schlüsseln. Keine arcade-spezifischen Tabellen, keine Analytics-Logik in Shared-
  Modulen außer dem einen gemeinsamen Client-Modul.
- **Datensparsamkeit.** Erhoben wird, welche Bedienelemente benutzt wurden — nicht, was Menschen
  eingegeben haben. Siehe Abschnitt 9.

---

## 3. Datenmodell: das Nutzungsereignis

Ein einziger, generischer Satzaufbau trägt alle Fälle. Felder mit `*` sind Pflicht.

| Feld | Typ | Zweck |
| --- | --- | --- |
| `id`* | text | nanoid, Idempotenz bei Wiederholversand |
| `occurred_at`* | int (ms) | Clientzeit des Ereignisses |
| `received_at`* | int (ms) | Serverzeit des Eingangs (Uhrabweichungen erkennbar) |
| `player_id` | text | Pseudonym; `NULL` bei Kiosk/anonym |
| `session_id`* | text | pro App-Ladevorgang erzeugt; erlaubt Sitzungs- und Pfadanalysen |
| `event_id`* | text | LAN-Event (bestehender Event-Kontext) |
| `role`* | text | `member` \| `admin` \| `kiosk` — Orga-Nutzung von Teilnehmenden trennen |
| `device`* | text | `mobile` \| `tablet` \| `desktop` \| `kiosk` (nur Bucket, kein User-Agent) |
| `app_version`* | text | Build-Kennung, um Auswertungen über Deployments hinweg zu trennen |
| `view`* | text | Route zum Zeitpunkt des Ereignisses (`votes`, `gameCatalog`, …) |
| `key`* | text | Feature-Schlüssel, siehe Abschnitt 4 |
| `action`* | text | `impression` \| `use` \| `result` \| `abort` |
| `result` | text | `ok` \| `empty` \| `error` \| `cancel` (nur bei `action = result`) |
| `value` | text | **nur Allow-List-Werte** (z. B. Genre-Name, `asc`/`desc`), niemals Freitext |
| `count` | int | Mehrfachvorgänge zusammengefasst (z. B. 5 Filterklicks in einer Visite) |
| `duration_ms` | int | Verweildauer, Zeit bis Ergebnis |
| `context` | json | kleines, feldbegrenztes Zusatzobjekt (z. B. `{"hits":0,"len":4}`) |

Zusätzlich ein **View-Visit-Satz** je Ansichtsbesuch (`key = 'view.<name>'`, `action = 'impression'`,
`duration_ms` beim Verlassen). Er liefert den Nenner für praktisch alle Quoten: „von 41 Besuchen der
Spieleliste wurde in 3 der Genre-Filter angefasst“.

### Namenskonvention für `key`

`<bereich>.<element>.<detail>`, kleingeschrieben, stabil über Releases:

```
games.genre_filter          votes.genre_filter
search.global               search.select.<feldname>
search.selection.<feldname> tracking.consent
checklist.task.toggle       foodorders.order.create
```

Die Schlüsselliste wird als **zentrale Allow-List im Code** geführt (analog `gameGenres.js`), damit
Tippfehler nicht stillschweigend neue Metriken erzeugen und der Server unbekannte Schlüssel
ablehnen kann.

---

## 4. Was konkret gemessen wird

### 4.1 Navigation und Reichweite (Basis für alles)

- Jeder Ansichtswechsel mit **Quelle**: Bottom-Nav, Tab-Leiste, Deep-Link, Push-Benachrichtigung,
  globale Suche, `data-navigate`-Button. Damit wird sichtbar, ob eine Ansicht überhaupt gefunden
  wird und über welchen Weg.
- Verweildauer je Besuch und Rückkehrrate je Tag (Tag 1/2/3 der LAN).
- Ansichten hinter dem „Mehr“-Hub gesondert betrachten: ein Feature, das nur dort erreichbar ist,
  hat systematisch weniger Impressionen — das ist ein Layout-Befund, kein Bedarfsbefund.

### 4.2 Die drei ausdrücklich genannten Beispielfragen

| Frage | Erhobene Signale | Ableitbare Aussage |
| --- | --- | --- |
| **Genre-Filter in Spieleliste / Abstimmung** | Impression der Chip-Leiste je Besuch (getrennt nach Oberfläche `gameCatalog` / `votes`); Toggle-Ereignisse mit Genre-Wert; Anzahl gleichzeitig aktiver Genres; Trefferzahl nach Filterung; ob nach dem Filtern eine Auswahl/Stimme folgte | Reichweite (wie viele Personen überhaupt), Häufigkeit, welche Genres tatsächlich benutzt werden (unbenutzte Genres kürzen), ob der Filter in einer der beiden Oberflächen überflüssig ist — die beiden Vorkommen werden getrennt bewertet |
| **Die verschiedenen Suchfelder** | Je Feld: Fokus, erste Eingabe, Trefferzahl, Null-Treffer-Rate, ob ein Treffer ausgewählt wurde, Abbruch ohne Auswahl; getrennt für globale Suchpalette, `searchSelect` (Auswahlfelder) und `selectionSearch` (Listenfilter), jeweils mit Feldnamen | Welche der drei Suchmechaniken getragen wird, welche Felder nie angefasst werden, ob Suchen scheitern (hohe Null-Treffer-Rate → Suchlogik verbessern statt Feld entfernen) |
| **Tracking-Funktion** | Bestehende Daten (Consent erteilt/widerrufen, Agent-Meldungen, erfasste Sessions) plus Nutzungsdaten der Auswertungsansichten (`analytics`, `myStats`, `leaderboard`) | Vollständiger Trichter: eingeladen → Agent installiert → Consent erteilt → Daten geflossen → Auswertung angeschaut. Ein Abbruch früh im Trichter ist ein Installationsproblem, ein Abbruch am Ende heißt: Daten werden erhoben, aber niemanden interessiert das Ergebnis |

### 4.3 Weitere Kandidaten (nach Aufwand geordnet, gleiches Muster)

Filter, Sortierungen, Tabs, Modals und Optionen in: Abstimmung, Spielekatalog, Matchmaking/Draft,
Turniere, Rangliste/Statistiken/Hall of Fame, To-Dos/Packliste/An- & Abreise, Essensbestellungen,
Durchsagen/Infoboard, Sitzplan, Musikwünsche, Push-Einstellungen, Kiosk, Arcade-Spiele (Start,
Abschluss, Abbruch je Titel).

### 4.4 Qualitätssignale (für „umbauen statt entfernen“)

- **Fehlerquote je Aktion** (fachliche 4xx-Antworten, fehlgeschlagene Speichervorgänge).
- **Zeit bis Ergebnis** bei mehrschrittigen Abläufen (Draft, Turnier anlegen, Bestellung).
- **Abbruchquote**: Dialog/Formular geöffnet, aber ohne Ergebnis geschlossen.
- **Wiederholte identische Aktion** kurz hintereinander (Hinweis auf unklares Feedback im UI).

---

## 5. Wie die Daten erhoben werden

Drei Quellen, unterschiedlich teuer und unterschiedlich aussagekräftig. Sie ergänzen sich.

### Quelle A — Bestandsdaten (Aufwand: sehr gering, sofort nutzbar)

Ein großer Teil der Fragen ist **ohne jede neue Erhebung** beantwortbar, weil die fachlichen
Tabellen bereits alles Nötige enthalten: `votes`/`vote_rounds`, `preferences` (Bock-Ratings),
`play_sessions`, `event_tracking_consents`/`group_tracking_consents`/`tracking_live_contexts`,
`checklist_tasks`, `food_orders`, `arcade_results`, `matches`, `tournaments`, `music_requests`,
`arrivals`/`carpools`, `push_subscriptions`/`push_log`, `seating_layouts`, `admin_log`.

Daraus folgt direkt, welche **Fachfunktionen** überhaupt Ergebnisse produziert haben und wie viele
verschiedene Personen sie erzeugt haben. Blind ist diese Quelle für alles rein Clientseitige —
also genau für Filter, Tabs und Suchfelder.

**Umsetzung:** ein Auswertungsskript (`scripts/`) oder ein Admin-Export, keine Schemaänderung.

### Quelle B — Serverseitige Endpunktzählung (Aufwand: gering)

Eine schmale Express-Middleware zählt je Zeitfenster (z. B. Stunde) `Routenschablone × Methode ×
Statusklasse × Rolle` in eine Aggregattabelle — **keine Zeile pro Request**. Das ergibt robuste
Nutzungs- und Fehlerprofile pro API-Feature, unabhängig vom Frontend, und ist auch für den
Windows-Agent aussagekräftig.

Grenzen: keine Unterscheidung zwischen „Ansicht geöffnet“ und „Filter benutzt“, wenn beides
dieselben Daten lädt; keine Impressionen; keine Abbrüche.

### Quelle C — Client-Instrumentierung (Aufwand: mittel, beantwortet die eigentlichen Fragen)

Ein einziges neues Frontend-Modul, z. B. `server/public/js/usage.js`:

- `trackUsage(key, { action, value, count, durationMs, context })` — synchron, nicht blockierend,
  in `try/catch` gekapselt.
- Ereignisse werden im Speicher gepuffert und gebündelt gesendet: alle ~15 s, bei Ansichtswechsel,
  spätestens bei `pagehide`/`visibilitychange` per `navigator.sendBeacon`.
- Puffergrenze (z. B. 200 Ereignisse) mit Verwurf der ältesten Einträge; Zähler für verworfene
  Ereignisse mitsenden, damit Lücken erkennbar bleiben.
- Ein Fehler beim Senden wird verworfen, nicht wiederholt eskaliert.

Der entscheidende Punkt für den Umsetzungsaufwand: **die relevanten Bedienelemente sind bereits
zentralisiert.** Wenige Einbaupunkte decken fast die gesamte Oberfläche ab:

| Einbaupunkt | Abdeckung |
| --- | --- |
| `switchView()` in `server/public/js/app.js:341` | jeder Ansichtswechsel, Verweildauer, View-Visit-Nenner |
| Nav-Verdrahtung `app.js:410` und `[data-navigate]`-Delegation `app.js:452` | Navigationsquelle |
| `server/public/js/sectionNav.js` | Tab-Wechsel innerhalb der Bereiche |
| `server/public/js/searchPalette.js` | globale Suche (Öffnen, Trefferzahl, Auswahl, Abbruch) |
| `server/public/js/searchSelect.js` | **alle** Auswahl-Suchfelder in Rangliste, Statistiken, Matchmaking, Turnier, Hall of Fame, Meine Statistiken, Event-Umschalter |
| `server/public/js/selectionSearch.js` | **alle** Listen-Suchfelder in Abstimmung, Spielekatalog, Matchmaking, Turnier |
| `server/public/js/modal.js` | Dialog geöffnet / bestätigt / abgebrochen |
| Genre-Chip-Handler `views/gameCatalog.js:817` und `views/votes.js:814` | beide Genre-Filter, getrennt nach Oberfläche |
| `apiFetch()` in `server/public/js/api.js:42` (optional) | Fehlerquote und Latenz clientseitig |

Für Impressionen genügt in der Regel ein Ereignis beim Rendern der jeweiligen Leiste bzw. des
Feldes — keine Scroll- oder Sichtbarkeitsbeobachtung, das wäre für 15 Personen überzogen.

**Empfehlung:** flache Einzelsätze statt vorverdichteter Visiten-Objekte. Das ist einfacher, macht
spätere, heute noch nicht bekannte Auswertungen möglich, und das Datenvolumen ist unkritisch (siehe
Abschnitt 7).

---

## 6. Auswertung und Entscheidungsregeln

### Kennzahlen je Feature-Schlüssel

- **Reichweite:** wie viele verschiedene Personen (nicht: wie viele Klicks) — bei N≈15 die
  wichtigste Zahl.
- **Nutzungsrate:** Interaktionen ÷ Impressionen.
- **Häufigkeit:** Nutzungen je nutzender Person.
- **Haltbarkeit:** Nutzung an Tag 2/3 im Verhältnis zu Tag 1 (filtert den Neugier-Effekt).
- **Erfolgsquote:** `result = ok` ÷ alle Versuche; **Null-Treffer-Rate** bei Suchen.
- **Reibung:** Zeit bis Ergebnis, Abbruchquote, Wiederholungen.

### Vorab festgelegte Schwellen (wichtig!)

Weil es die **erste** LAN ist, gibt es keinen Vergleichsmaßstab. Damit die Zahlen hinterher nicht
passend interpretiert werden, werden die Schwellen **vor** dem Event festgeschrieben:

| Befund | Schwelle (Vorschlag, N≈15, 3 Tage) | Entscheidung |
| --- | --- | --- |
| Tot | < 2 Personen **und** < 5 Nutzungen gesamt | Kandidat für **Ausbau/Entfernen** |
| Nische | 2–3 Personen, regelmäßig genutzt | **Behalten**, nicht weiter investieren |
| Getragen | ≥ 5 Personen oder Nutzung an ≥ 2 Tagen | **Behalten/ausbauen** |
| Unentdeckt | Impressionen hoch, Nutzungsrate < 5 % | **Umbauen** (Platzierung, Beschriftung) |
| Gescheitert | Nutzungsrate ok, Erfolgsquote < 70 % oder Abbruch > 30 % | **Verbessern** (Logik, Feedback) |

Kein Feature wird allein auf Basis dieser Zahlen entfernt, wenn es zu einem Produktziel gehört, das
bewusst „nur für den Notfall“ existiert (z. B. Kiosk, Backup, Admin-Werkzeuge). Solche Funktionen
werden vorab als **nicht messgesteuert** markiert.

### Ergänzung durch eine Kurzumfrage

Bei 15 Personen ist eine Frage direkt an die Teilnehmenden statistisch mindestens so wertvoll wie
Telemetrie und trennt die Fälle „nicht gebraucht“ vs. „nicht gefunden“ zuverlässig. Vorschlag: am
letzten Tag eine In-App-Umfrage mit 5–8 Fragen, gespeist aus den auffälligsten Telemetriebefunden
(„Genre-Filter in der Abstimmung: gekannt? benutzt? vermisst?“). Telemetrie liefert die Fragen, die
Umfrage die Begründung.

---

## 7. Technische Skizze

**Tabelle** `usage_events` mit den Feldern aus Abschnitt 3, Indizes auf `(event_id, key, occurred_at)`
und `(event_id, player_id, occurred_at)`. Migration über den bestehenden `schema_migrations`-
Mechanismus in `server/src/db.ts`.

**Optionale Aggregattabelle** `usage_rollups` (Feature × Tag × Rolle) für die Anzeige; wird aus den
Rohsätzen berechnet und kann jederzeit neu erzeugt werden. Für das erste Event vermutlich
verzichtbar.

**Endpunkt** `POST /api/usage/events` (Batch, max. ~50 Ereignisse, `requireUser`, eigene
Ratenbegrenzung, strenge Validierung gegen die Schlüssel-Allow-List, unbekannte Schlüssel und
überlange Werte werden verworfen statt gespeichert). Antwort immer `204`, auch bei teilweise
verworfenen Sätzen — der Client soll nichts nachbessern müssen.

**Volumen:** großzügig gerechnet 1.500 Ereignisse pro Person und Tag × 15 Personen × 3 Tage ≈
70.000 Zeilen à ~200 Byte ≈ 15 MB. Für SQLite mit WAL unkritisch; Schreibvorgänge kommen gebündelt
alle 15 Sekunden, nicht pro Klick. Auswirkungen auf die Backup-Größe sind vernachlässigbar, sollten
aber in `OPERATIONS.md` erwähnt werden.

**Auswertung:** ein Admin-Bereich mit Tabelle „Feature × Personen × Nutzungen × Nutzungsrate ×
Erfolgsquote“ plus CSV/JSON-Export. Bewusst schlicht — die Interpretation passiert nach dem Event,
nicht live.

**Tests** (gemäß Definition of Done): Puffer-/Flush-/Verwurf-Logik des Client-Moduls, Redaktion von
Freitext, Validierung und Ratenbegrenzung des Endpunkts, sowie ein Test, der belegt, dass ein
fehlschlagender Usage-Endpunkt die Oberfläche nicht beeinträchtigt.

---

## 8. Stufenplan

| Stufe | Inhalt | Nutzen | Aufwand |
| --- | --- | --- | --- |
| 0 | Auswertungsskript über Bestandsdaten (Quelle A) | sofortige Aussage über alle Fachfunktionen, kein Schema, kein Risiko | klein |
| 1 | `usage.js`, Endpunkt, Tabelle, Einbau in `switchView`, Nav/Tabs, die drei Suchmodule, beide Genre-Filter | beantwortet die gestellten Beispielfragen vollständig | mittel |
| 2 | Serverseitige Endpunktzählung (Quelle B), Admin-Auswertung, Export | Fehler- und Lastprofil, bequeme Auswertung | klein–mittel |
| 3 | Instrumentierung der weiteren Bereiche aus 4.3, Kurzumfrage, Entscheidungsreport | flächendeckendes Bild, dokumentierte Entscheidungen | mittel |

Stufe 1 sollte **spätestens zwei Wochen vor dem Event** stehen, damit die Erhebung im Testbetrieb
einmal verifiziert werden kann. Eine Instrumentierung, die erst am Eventtag scharf geschaltet wird,
liefert im Zweifel Lücken genau dort, wo es interessant wird.

---

## 9. Datenschutz und Governance

- **Keine Freitexte.** Suchbegriffe, Nachrichten, Namen und Wünsche werden nie gespeichert. Von
  einer Sucheingabe werden nur Länge (gebündelt: 1–2, 3–5, 6+), Trefferzahl und ob eine Auswahl
  folgte erfasst. `value` akzeptiert ausschließlich Werte aus einer Allow-List (Genres,
  Sortierrichtungen, Tab-Namen).
- **Keine Netzwerk- oder Gerätekennungen.** Keine IP-Adressen, kein roher User-Agent, nur ein
  Geräte-Bucket.
- **Personenbezug bewusst gewählt.** Bei 15 Teilnehmenden ist auch ein Pseudonym praktisch
  re-identifizierbar. Deshalb: `player_id` wird gespeichert (nötig für „wie viele *verschiedene*
  Personen“), aber die Oberfläche zeigt ausschließlich Aggregate, und personenbezogene
  Auswertungen werden bei weniger als 3 Personen je Zelle unterdrückt. Rohdaten nur per
  Admin-Export.
- **Einwilligung.** Es gibt bereits ein Consent-Modell für das Spiel-Tracking
  (`event_tracking_consents`). Nutzungsdaten sind ein anderer Zweck und brauchen eine eigene,
  klar benannte Entscheidung — die bestehende Zustimmung darf nicht mitbenutzt werden.
  **Empfehlung:** deutlich sichtbarer Hinweis beim Onboarding plus jederzeit erreichbarer
  Opt-out im Profil, weil ein Opt-in bei N≈15 die Daten praktisch wertlos macht. Ob stattdessen
  ein striktes Opt-in gewünscht ist, ist eine Nutzerentscheidung (Abschnitt 11).
- **Ausschlüsse.** Testnutzende (`testUsers`) und Kiosk-Geräte werden getrennt gekennzeichnet und
  aus allen Personenkennzahlen ausgeschlossen; Admin-Aktionen werden separat ausgewiesen, damit
  die Orga-Nutzung die Teilnehmerzahlen nicht verfälscht.
- **Aufbewahrung.** Rohsätze bis 90 Tage nach Eventende, danach nur Aggregate. Löschung eines
  Kontos löscht auch dessen Nutzungssätze.
- **Transparenz.** Die erhobenen Schlüssel sind aus der Allow-List im Code jederzeit ablesbar; ein
  kurzer Abschnitt im Profil erklärt in einfachen Worten, was erfasst wird.

---

## 10. Risiken und Grenzen

- **Ein Event = ein Datenpunkt.** Alle Zahlen sind Momentaufnahmen einer einzelnen Gruppe. Sie
  eignen sich für „offensichtlich tot“ und „offensichtlich getragen“, nicht für Feinabstimmung.
- **Neugier-Effekt.** Am ersten Tag wird alles einmal angetippt. Deshalb die Tag-2/3-Betrachtung.
- **Gruppendynamik.** Manche Funktionen benutzt genau eine Person stellvertretend für alle
  (Sitzplan, Durchsagen, Musik). Niedrige Reichweite ist dort kein Streichgrund — solche Features
  vorab als „Orga-Funktion“ markieren.
- **Zeitversatz und Lücken.** Clientuhren, Tabschließungen und Verbindungsabbrüche verursachen
  fehlende Ereignisse. `received_at` und der Verwurfszähler machen das sichtbar; Quoten immer
  gegen Impressionen rechnen, nie gegen erwartete Absolutwerte.
- **Beobachtereffekt bei Ankündigung.** Wird die Messung groß angekündigt, verändert das kurzzeitig
  das Verhalten. Sachlicher Hinweis genügt.
- **Instrumentierungslücke = Feature erscheint tot.** Vor der Auswertung prüfen, ob jeder bewertete
  Schlüssel überhaupt mindestens einmal gefeuert hat (Selbsttest der Instrumentierung).

---

## 11. Offene Entscheidungen

1. **Einwilligung:** Hinweis + Opt-out (Empfehlung) oder striktes Opt-in?
2. **Umfang Stufe 1:** nur die drei genannten Beispielbereiche oder direkt die Liste aus 4.3?
3. **Auswertung:** Admin-Ansicht in der App oder nur Export plus Skript nach dem Event?
4. **Schwellenwerte** aus Abschnitt 6 so übernehmen oder anpassen?
5. **Kurzumfrage** am letzten Eventtag: gewünscht?

Nach Klärung dieser Punkte kann Stufe 0 unmittelbar und Stufe 1 als eigener Änderungsauftrag
umgesetzt werden.
