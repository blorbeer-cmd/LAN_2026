# Konzept: Feature-Nutzungsanalyse

Stand: 2026-08-17 · Status: **Konzept, noch nicht umgesetzt**

Zweck: Nach der ersten LAN belastbar entscheiden können, welche Funktionen **ausgebaut**, welche
**umgebaut/verbessert** und welche **entfernt** werden. Dieses Dokument beschreibt, welche Daten
dafür nötig sind, wie sie erhoben werden und wie daraus Entscheidungen abgeleitet werden. Es
enthält bewusst noch keine Implementierung.

---

## 1. Die eigentliche Frage

„Wie oft wird Funktion X genutzt?“ reicht für die Entscheidung nicht. Null Nutzung hat drei sehr
verschiedene Ursachen:

1. **Kein Bedarf** → entfernen.
2. **Bedarf, aber nicht gefunden** (Entdeckbarkeit) → umbauen, nicht entfernen.
3. **Bedarf und gefunden, aber Nutzung abgebrochen** (umständlich, fehlerhaft, langsam)
   → verbessern.

Unterscheidbar werden die drei Fälle nur, wenn zu jeder Nutzung auch die **Gelegenheit zur
Nutzung** und der **Ausgang des Versuchs** erfasst werden. Deshalb misst dieses Konzept nicht
Klicks, sondern **Trichter je Funktion**:

```
Sichtbar (Impression)  →  Berührt (Interaktion)  →  Ergebnis (ok / leer / Fehler / Abbruch)
```

Ohne den ersten Schritt fehlt der Nenner, ohne den letzten die Aussage über Qualität.

---

## 2. Vier Bausteine statt nur Telemetrie

Bei rund 15 Teilnehmenden ist reine Telemetrie kein guter Alleingang. Sie kann Verhalten messen,
aber keine Begründung liefern, und für Feinabstufungen fehlt jede statistische Aussagekraft
(„3 vs. 5 Nutzende“ ist Rauschen). Umgekehrt kann eine Umfrage keine Mikro-Interaktionen erfassen:
Niemand erinnert sich, ob er einen Genre-Filter angefasst hat.

Die Bausteine beantworten deshalb bewusst verschiedene Fragen:

| Baustein | Beantwortet | Aufwand |
| --- | --- | --- |
| **A — Bestandsdaten** | Welche Fachfunktionen überhaupt Ergebnisse erzeugt haben | klein |
| **B — Direktes Feedback in der App** | Das „Warum“, während die Erinnerung frisch ist | klein |
| **C — Minimal-Telemetrie** | Mikro-Interaktionen, die niemand selbst berichten kann | klein–mittel |
| **D — Kurzumfrage nach dem Event** | Bedarf, Vermisstes, Prioritäten | kein Code |

Wichtig bleibt: **Für die Frage „ist das komplett tot?“ braucht es keine statistische Power.** Wurde
ein Bedienelement über drei Tage von null Personen berührt, ist das ein harter Fakt, unabhängig von
der Nutzerzahl. Genau diese Ja/Nein-Frage steht nach dem ersten Event an — nicht Feinabstimmung.

---

## 3. Leitplanken

Abgeleitet aus `DEVELOPMENT_GUIDELINES.md` (Produktziele in dieser Reihenfolge):

- **Zuverlässigkeit zuerst.** Die Messung darf die Anwendung nie beeinträchtigen. Jeder
  Instrumentierungsaufruf ist fehlertolerant (`try/catch`, niemals `await` im UI-Pfad), der Versand
  läuft gepuffert und asynchron. Ein ausgefallener Analytics-Endpunkt darf keine View blockieren,
  keinen Toast erzeugen und keinen Realtime-Kanal belasten.
- **Kein Realtime-Kanal.** Nutzungsdaten laufen über einen eigenen, ratenbegrenzten HTTP-Endpunkt,
  nie über Socket.IO.
- **Keine externen Dienste.** Kein Google Analytics, Matomo, Sentry. Die LAN läuft potenziell ohne
  stabiles Internet, und Nutzungsdaten von 15 namentlich bekannten Personen gehören nicht auf fremde
  Server. Alles bleibt in der bestehenden SQLite-Instanz.
- **Keine neue Produktionsabhängigkeit**, insbesondere keine Diagrammbibliothek für die Auswertung.
  Einfache Tabellen genügen.
- **Arcade-Grenzen bleiben.** Arcade-Module nutzen dieselbe generische Schnittstelle mit
  `arcade.*`-Schlüsseln. Keine arcade-spezifischen Tabellen, keine Analytics-Logik in Shared-Modulen
  außer dem einen gemeinsamen Client-Modul.
- **Datensparsamkeit.** Erhoben wird, welche Bedienelemente benutzt wurden — nicht, was Menschen
  eingegeben haben. Siehe Abschnitt 10.

---

## 4. Baustein A — Bestandsdaten

Ein großer Teil der Fragen ist **ohne jede neue Erhebung** beantwortbar, weil die fachlichen
Tabellen bereits alles Nötige enthalten: `votes`/`vote_rounds`, `preferences` (Bock-Ratings),
`play_sessions`, `event_tracking_consents`/`group_tracking_consents`/`tracking_live_contexts`,
`checklist_tasks`, `food_orders`/`food_order_items`, `arcade_results`, `matches`, `tournaments`,
`music_requests`, `arrivals`/`carpools`, `push_subscriptions`/`push_log`, `seating_layouts`,
`admin_log`.

Daraus folgt direkt, welche **Fachfunktionen** überhaupt Ergebnisse produziert haben und wie viele
verschiedene Personen sie erzeugt haben. Die **Tracking-Adoption** ist damit vollständig
beantwortbar, ohne eine Zeile Instrumentierung: Consent erteilt/widerrufen → Agent-Meldungen →
erfasste Sessions.

Blind ist diese Quelle für alles rein Clientseitige — Filter, Tabs, Suchfelder, Abbrüche. Genau
dafür existiert Baustein C.

**Umsetzung:** Auswertungsabfragen für den Adminbereich (Abschnitt 8), keine Schemaänderung.

---

## 5. Baustein B — Direktes Feedback in der App

Ein schlanker Feedback-Weg, erreichbar aus jeder Ansicht (Topbar oder Profil), der automatisch
mitschickt, **aus welcher Ansicht** das Feedback kam. Damit wird Freitext halb-quantitativ
auswertbar: „7 von 11 Rückmeldungen kamen aus der Abstimmung“ ist bereits ein Befund.

- Ein kurzes Freitextfeld plus optionale Stimmung (👍 / 👎 / Idee).
- Kontext automatisch: Ansicht, Zeitpunkt, Event, Gerät. Kein Screenshot, kein DOM-Dump.
- Speicherung in einer eigenen Tabelle, Anzeige im Adminbereich (Abschnitt 8).
- Freitext ist hier **gewollt** — er ist ausdrücklich vom Nutzer verfasst, anders als die
  Telemetrie in Baustein C.

Feedback *während* des Events schlägt jede Nacherhebung, weil die Erinnerung frisch ist und auch
die erreicht werden, die später keine Umfrage ausfüllen.

---

## 6. Baustein C — Minimal-Telemetrie

### 6.1 Das Nutzungsereignis

Ein generischer Satzaufbau trägt alle Fälle. Felder mit `*` sind Pflicht.

| Feld | Typ | Zweck |
| --- | --- | --- |
| `id`* | text | nanoid, Idempotenz bei Wiederholversand |
| `occurred_at`* | int (ms) | Clientzeit des Ereignisses |
| `received_at`* | int (ms) | Serverzeit des Eingangs (Uhrabweichungen erkennbar) |
| `player_id` | text | Pseudonym; `NULL` bei Kiosk |
| `session_id`* | text | pro App-Ladevorgang erzeugt |
| `event_id`* | text | LAN-Event (bestehender Event-Kontext) |
| `role`* | text | `member` \| `admin` \| `kiosk` |
| `device`* | text | `mobile` \| `tablet` \| `desktop` \| `kiosk` (nur Bucket, kein User-Agent) |
| `app_version`* | text | Build-Kennung, trennt Auswertungen über Deployments hinweg |
| `view`* | text | Route zum Zeitpunkt des Ereignisses |
| `key`* | text | Messpunkt-Schlüssel aus der Allow-List |
| `action`* | text | `impression` \| `use` \| `result` \| `abort` |
| `result` | text | `ok` \| `empty` \| `error` \| `cancel` |
| `value` | text | **nur Allow-List-Werte** (Genre-Name, `on`/`off`, Tab-Name), nie Freitext |
| `count` | int | zusammengefasste Mehrfachvorgänge |
| `duration_ms` | int | Verweildauer, Zeit bis Ergebnis |
| `context` | json | kleines, feldbegrenztes Objekt (z. B. `{"hits":0,"len":"3-5"}`) |

Zusätzlich ein **View-Visit-Satz** je Ansichtsbesuch (`key = 'view.<name>'`, `action = 'impression'`,
`duration_ms` beim Verlassen). Er liefert den Nenner für praktisch alle Quoten: „von 41 Besuchen der
Spieleliste wurde in 3 der Genre-Filter angefasst“.

**Namenskonvention:** `<bereich>.<element>.<detail>`, kleingeschrieben, stabil über Releases. Die
Schlüsselliste ist eine **zentrale Allow-List im Code** (analog `gameGenres.js`), damit Tippfehler
nicht stillschweigend neue Metriken erzeugen und der Server unbekannte Schlüssel ablehnen kann.

### 6.2 Der deklarative Messpunkt

Viele der interessanten Bedienelemente sind Einzelbuttons, die über die Views verstreut liegen
(Auswahl-Werkzeuge, Bezahllink, Bezahlt-Schalter). Sie einzeln in ihren Handlern zu instrumentieren
erzeugt viel Diff an vielen Stellen.

Stattdessen: **ein delegierter Click-Listener in `app.js` auf `[data-usage]`.** Ein Bedienelement
messbar zu machen heißt dann, ein Attribut zu ergänzen:

```html
<button ... data-usage="votes.select_all">…</button>
```

Für Checkboxen liefert ein `change`-Listener zusätzlich `value = on|off`. Das hält den Eingriff pro
Bedienelement bei genau einer Zeile und macht später weitere Messpunkte trivial.

Das Attribut heißt bewusst `data-usage` und nicht `data-track` — „Tracking“ bezeichnet in diesem
Repository bereits die Spielzeiterfassung des Agents.

### 6.3 Zentrale Einbaupunkte

Die relevanten Bedienelemente sind bereits zentralisiert. Wenige Stellen decken große Teile ab:

| Einbaupunkt | Abdeckung |
| --- | --- |
| `switchView()` in `server/public/js/app.js:341` | jeder Ansichtswechsel, Verweildauer, View-Visit-Nenner |
| Nav-Verdrahtung `app.js:410`, `[data-navigate]`-Delegation `app.js:452` | Navigationsquelle |
| `sectionNav.js` (`data-section-tab`) | Tab-Wechsel in allen Bereichen |
| `searchPalette.js` | globale Suche |
| `searchSelect.js` | **alle** Auswahl-Suchfelder (Rangliste, Statistiken, Matchmaking, Turnier, Hall of Fame, Meine Statistiken, Event-Umschalter) |
| `selectionSearch.js` | **alle** Listen-Suchfelder (Abstimmung, Spielekatalog, Matchmaking, Turnier) |
| `modal.js:23` / `modal.js:103` | jeder Dialog bzw. jede Bestätigungsabfrage |
| `emptyState.js:6` | jeder leere Zustand |
| `toast.js:7` | jeder sichtbare Fehler |
| `connectionRefresh.js` (`onRecovered`/`onFailure`) | Verbindungsabbrüche und Erholung |
| `[data-usage]`-Delegation | alle verstreuten Einzelbuttons aus 6.4 |

### 6.4 Messpunkte mit vorab festgelegter Entscheidung

Jeder Messpunkt trägt die Entscheidung, die er auslösen soll. Was ohne solchen Satz dasteht, wird
nach dem Event angeschaut, interessant gefunden — und nichts passiert.

#### Navigation und Erreichbarkeit

| Messpunkt | Einbaustelle | Vorab festgelegte Entscheidung |
| --- | --- | --- |
| Ansichtsbesuch + Verweildauer + Quelle (Nav, Tab, Deep-Link, Push, Suche, `data-navigate`) | `app.js:341`, `app.js:452` | Ansicht mit < 3 Personen über 3 Tage → Streichkandidat, sofern nicht Orga-Werkzeug |
| Tab-Wechsel in den Bereichen | `sectionNav.js` | Tab, der fast nie erreicht wird, obwohl der Bereich oft geöffnet wird → Reihenfolge ändern oder Inhalt in Tab 1 ziehen, **nicht** löschen |
| Einträge im „Mehr“-Hub | `views/more.js` (`data-navigate`) | Meistgenutzter Eintrag → Aufstieg in die Bottom-Nav; nie geöffneter Eintrag → Streichkandidat |

Die Tab-Messung ist kein Detail: `sectionEntryView()` öffnet einen Bereich immer auf `tabs[0]`.
Hall of Fame und Statistiken liegen hinter Rangliste, Packliste und An-/Abreise hinter To-Dos. Ohne
diese Zahl würde ein vergrabenes Feature fälschlich als unerwünscht gelöscht.

#### Filter, Suche und Auswahl

| Messpunkt | Einbaustelle | Vorab festgelegte Entscheidung |
| --- | --- | --- |
| Genre-Filter Spieleliste: Chipleiste sichtbar, Toggle mit Genre-Wert, Anzahl aktiver Genres, Trefferzahl | `views/gameCatalog.js:817` | < 2 Personen → Filter in dieser Ansicht entfernen. Nie benutzte Genres → aus `GAME_GENRES` streichen |
| Genre-Filter Abstimmung: dieselben Signale, **getrennt** ausgewiesen | `views/votes.js:814` | Getrennte Entscheidung je Oberfläche — der Filter kann in einer nützlich und in der anderen überflüssig sein |
| Globale Suchpalette: Öffnen, Trefferzahl, Auswahl, Abbruch | `searchPalette.js` | Hohe Öffnungsrate ohne Auswahl → Suchlogik verbessern; kaum Öffnungen → Einstieg sichtbarer machen |
| Auswahl-Suchfelder je Feldname (`lb-filter`, `mm-game`, `tourn-game`, `an-event`, `my-stats-event`, `hall-event-select`, `event-context-switcher`, …) | `searchSelect.js` | Feld nie benutzt, obwohl die Liste kurz ist → Suchfeld entfernen und einfaches Auswahlfeld belassen |
| Listen-Suchfelder je Feldname (`votes-game-search`, `mm-player-search`, `draft-player-search`, `captain-player-search`, `tourn-player-search`, Spielekatalog) | `selectionSearch.js` | Feld nie benutzt → entfernen; hohe Null-Treffer-Rate → Suchlogik (Umlaute, Teilwörter) verbessern statt Feld entfernen |
| Null-Treffer-Rate und Eingabelänge (Bucket 1–2 / 3–5 / 6+), **nie der Suchbegriff** | beide Suchmodule | Null-Treffer > 25 % → Normalisierung in `searchText.js` prüfen |
| „Sichtbare markieren“ / „Sichtbare abwählen“ | `views/votes.js:639/640`, `views/matchmaking.js:663/664` und `:707/708`, `views/tournament.js:372/373` | Beide Icons zusammen < 5 Nutzungen → Symbolleiste entfernen. Sichtbar, aber nie benutzt → zuerst Beschriftung statt Icon testen, dann entscheiden |
| „Alle auswählen“ / „Alle abwählen“ bei To-Dos | `views/checklist.js:328/329` | Wie oben; die Textvariante dient zugleich als Vergleich, ob die Icon-Variante ein reines Entdeckbarkeitsproblem hat |

Der Vergleich der Icon-Werkzeuge (`selection-toolbar-icon`, nur Tooltip) mit der beschrifteten
Variante in den To-Dos ist ein kostenloser natürlicher Test: Werden die Textbuttons deutlich öfter
benutzt, liegt es an der Beschriftung und nicht am Bedarf.

#### Essensbestellung

| Messpunkt | Einbaustelle | Vorab festgelegte Entscheidung |
| --- | --- | --- |
| Sammelbestellung angelegt; welche **optionalen Felder** dabei gefüllt wurden (Versand, Info, Link, PayPal, Trinkgeld) — nur „gefüllt ja/nein“, nie der Inhalt | `views/foodOrders.js` Formular „Neue Sammelbestellung“ | Optionales Feld nie gefüllt → aus dem Formular entfernen. Das Formular ist heute sechsfeldrig; jedes gestrichene Feld verkürzt den häufigsten Schreibvorgang der Ansicht |
| Anlegen abgebrochen (Dialog geschlossen ohne Absenden) | `modal.js` `confirmClose` | Abbruchquote > 30 % → Formular kürzen oder Pflichtfelder reduzieren |
| „Sammelzahlung“ pro Position an-/abgewählt | `data-select-pay` | < 2 Personen → Sammelzahlung entfernen und nur die Gesamtsumme anbieten |
| Bezahllink geöffnet („PayPal öffnen“ / „Bezahlen“), getrennt nach PayPal.me-Link und E-Mail-Variante | Anker in `renderPaymentSelector`, `data-copy-paypal-email` | Wird die E-Mail-Variante kaum genutzt, entfällt die aufwendige Kopier-Hilfslogik; wird der Link gar nicht genutzt, entfällt das PayPal-Feld |
| „Bezahlt“-Schalter gesetzt/zurückgenommen | `data-toggle-paid` | Kaum genutzt → Bezahlstatus entfernen und Abrechnung ganz außerhalb der App lassen. Häufig **zurückgenommen** → Bedienfehler, Schalter braucht Bestätigung oder klarere Beschriftung |
| „Summe kopieren“ | `data-copy-food-total` | Häufig genutzt → Zeichen dafür, dass der Bezahlweg außerhalb der App stattfindet; dann Bezahllink-Logik zurückbauen statt ausbauen |
| Bestellung geschlossen / wieder geöffnet / gelöscht | `data-finalize-order`, `data-close-order`, `data-reopen-order`, `data-delete-order` | Häufiges Wiederöffnen → Schließen passiert zu früh oder zu leicht |

Die Bezahlkette ist der Fall, in dem der Trichter am meisten trägt: Positionen ausgewählt →
Bezahllink geöffnet → als bezahlt markiert. Bricht sie in der Mitte ab, ist der Bezahlweg das
Problem, nicht die Bestellfunktion.

#### Abläufe und Reibung

| Messpunkt | Einbaustelle | Vorab festgelegte Entscheidung |
| --- | --- | --- |
| Dialog geöffnet / geschlossen; Bestätigungsabfrage bestätigt/abgebrochen | `modal.js:23`, `modal.js:103` | Öffnungen ohne fachliches Ergebnis > 30 % → Formular überarbeiten |
| Onboarding-Trichter (Name, Avatar, Skills, Agent-Key, Bock-Ratings) | `onboarding.js:388/412`, `onboardingRatingProgress()` | Abbruchstufe mit dem größten Verlust wird als Erstes überarbeitet. Bricht die Hälfte beim Agent-Key ab, ist die niedrige Tracking-Adoption ein Installations-, kein Akzeptanzproblem |
| Leerer Zustand gerendert, entprellt auf einmal je Ansichtsbesuch | `emptyState.js:6` | Ansicht überwiegend leer → Inhalt anstoßen (Vorlagen, Beispiel, Push), nicht die Ansicht löschen |
| Sichtbarer Fehler-Toast je Ansicht | `toast.js:7` | Ansicht mit auffällig vielen Fehlern → vor jeder Feature-Entscheidung erst stabilisieren |
| Push: Erlaubnis erteilt/abgelehnt, Klick auf Benachrichtigung | `push.js:41`, `sw.js:35` (per `postMessage` an die offene App, Beacon nur ohne offenes Fenster) | Klickrate nahe null → Push abschaffen. Hohe Ablehnungsrate → Zeitpunkt und Erklärung der Abfrage ändern |
| Arcade je Titel: gestartet vs. beendet vs. abgebrochen (`arcade.*`-Schlüssel) | Arcade-Views, innerhalb der Arcade-Grenzen | Titel mit sehr niedriger Abschlussquote → kürzen oder entfernen; `arcade_results` kennt nur die Abschlüsse |
| Info-Tooltips geöffnet | `infoTooltip.js` (optional) | Häufig geöffneter Tooltip → die betreffende Stelle erklärt sich nicht selbst und wird umformuliert |

#### Zuverlässigkeit (kein Feature-Signal, aber der wertvollste Datenpunkt)

| Messpunkt | Einbaustelle | Vorab festgelegte Entscheidung |
| --- | --- | --- |
| Verbindungsabbrüche, Dauer bis Erholung, gescheiterte Refreshs | `connectionRefresh.js` (`onRecovered`/`onFailure`), `connectionStatus.js:12` | Jeder wiederkehrende Abbruch wird vor jeder Feature-Arbeit untersucht — Produktziel 1 |

Das beantwortet keine Feature-Frage, sondern die einzige Behauptung im Repo, die man hinterher
belegen oder widerlegen kann: „läuft die gesamte LAN ohne manuellen Neustart“. Die Hooks existieren
bereits.

#### Kostenlos mitgeliefert

Der **Gerätemix je Ansicht** ist kein eigener Messpunkt — `device` steckt im Envelope. Entscheidung:
Läuft eine Ansicht zu über 90 % mobil, wird Layoutarbeit für Desktop dort nicht mehr priorisiert.

### 6.5 Was bewusst nicht gemessen wird

Suchbegriffe, Scrolltiefe, Hover, Mausbewegungen, Zeit-auf-Element, einzelne Sortier-Toggles in
einzelnen Views, Tastatureingaben. Diese Daten würden das Volumen vervielfachen, ohne eine
Entscheidung zu ändern.

---

## 7. Baustein D — Kurzumfrage nach dem Event

5–8 Fragen am letzten Tag oder unmittelbar danach, **gespeist aus den auffälligsten Befunden** aus
A–C. Telemetrie liefert die Fragen, die Umfrage die Begründung:

- „Genre-Filter in der Abstimmung: gekannt? benutzt? vermisst?“
- „Was hat gefehlt?“
- „Was war überflüssig?“

Braucht keinen Code — Zettel, Messenger oder Formular genügen. Wichtig ist nur, die Fragen erst
**nach** dem ersten Blick in die Daten zu formulieren.

Grenze im Blick behalten: Von 15 Personen antworten erfahrungsgemäß nicht alle, und wer die App
kaum genutzt hat, antwortet am seltensten — ausgerechnet der interessante Fall. Deshalb ersetzt die
Umfrage Baustein A und C nicht.

---

## 8. Auswertung im Adminbereich

Alle Auswertungen sind über die bestehende Admin-Ansicht erreichbar (`server/public/js/views/admin.js`),
als weitere `grouped-page-section`-Karten im vorhandenen Muster. Serverseitig analog zum bereits
vorhandenen `adminRouter.get('/audit', requireAdmin, …)` in `server/src/routes/admin.ts:136`, also
`GET /api/admin/usage` mit `requireAdmin`.

**Aufbau der Ansicht:**

1. **Filter:** Event und Zeitraum, optional Rolle (Teilnehmende / Orga getrennt).
2. **Messpunkt-Tabelle**, gruppiert nach Bereich (Navigation, Filter & Auswahl, Essen, Abläufe,
   Zuverlässigkeit): Messpunkt · Personen · Nutzungen · Nutzungsrate (Interaktion ÷ Impression) ·
   Erfolgsquote · Bewertung gegen die hinterlegte Schwelle aus Abschnitt 9 (getragen / Nische /
   unentdeckt / gescheitert / tot).
3. **Trichter-Ansicht** für die mehrstufigen Abläufe (Onboarding, Bezahlkette, Dialoge).
4. **Fachlicher Block aus Baustein A:** wie viele Personen je Fachfunktion tatsächlich etwas erzeugt
   haben.
5. **Feedback-Eingänge** aus Baustein B als Liste mit Ansichtskontext und Zeitpunkt.
6. **Zuverlässigkeitsblock:** Verbindungsabbrüche, Erholungsdauer, Fehler-Toasts je Ansicht.
7. **Instrumentierungs-Selbsttest:** Liste aller registrierten Schlüssel, die **nie** ausgelöst
   haben. Ohne diese Liste besteht die Gefahr, einen kaputten Messpunkt als totes Feature zu lesen.
   Das ist die wichtigste Absicherung der ganzen Auswertung.
8. **Export** als CSV und JSON für die Auswertung nach dem Event.

**Bewusste Einschränkungen der Ansicht:**

- Nur Aggregate, keine Einzelpersonen-Ansicht; Zellen mit weniger als 3 Personen werden unterdrückt
  (Abschnitt 10).
- Keine Diagrammbibliothek, keine Live-Aktualisierung über Realtime. Die Auswertung wird nach dem
  Event gelesen, nicht während. Ein einfacher Neuladen-Button genügt.
- Testnutzende und Kiosk sind ausgeschlossen bzw. getrennt ausgewiesen, Admin-Aktionen separat.

---

## 9. Entscheidungsregeln und Schwellen

**Kennzahlen je Messpunkt:** Reichweite (verschiedene Personen — bei N≈15 die wichtigste Zahl),
Nutzungsrate (Interaktionen ÷ Impressionen), Häufigkeit je nutzender Person, Haltbarkeit (Tag 2/3
gegenüber Tag 1, filtert den Neugier-Effekt), Erfolgsquote, Reibung (Abbruch, Wiederholung, Dauer).

Weil es die **erste** LAN ist, gibt es keinen Vergleichsmaßstab. Damit die Zahlen hinterher nicht
passend interpretiert werden, stehen die Schwellen **vor** dem Event fest:

| Befund | Schwelle (N≈15, 3 Tage) | Entscheidung |
| --- | --- | --- |
| Tot | < 2 Personen **und** < 5 Nutzungen gesamt | **Ausbau/Entfernen** |
| Nische | 2–3 Personen, regelmäßig genutzt | **Behalten**, nicht weiter investieren |
| Getragen | ≥ 5 Personen oder Nutzung an ≥ 2 Tagen | **Behalten/ausbauen** |
| Unentdeckt | Impressionen hoch, Nutzungsrate < 5 % | **Umbauen** (Platzierung, Beschriftung) |
| Gescheitert | Nutzungsrate ok, Erfolgsquote < 70 % oder Abbruch > 30 % | **Verbessern** (Logik, Feedback) |

Ausgenommen sind Funktionen, die bewusst „nur für den Notfall“ existieren (Kiosk, Backup,
Admin-Werkzeuge). Sie werden vorab als **nicht messgesteuert** markiert. Ebenso Funktionen, die
naturgemäß eine Person stellvertretend für alle bedient (Sitzplan, Durchsagen, Musik) — dort ist
niedrige Reichweite kein Streichgrund.

---

## 10. Datenschutz und Governance

- **Keine Freitexte in der Telemetrie.** Von einer Sucheingabe nur Längen-Bucket, Trefferzahl und ob
  eine Auswahl folgte. Von einem Bestellformular nur „Feld gefüllt ja/nein“, nie Titel, Link,
  PayPal-Adresse oder Notiz. `value` akzeptiert ausschließlich Allow-List-Werte. Freitext gibt es
  nur dort, wo die Person ihn bewusst schreibt: im Feedback aus Baustein B.
- **Keine Netzwerk- oder Gerätekennungen.** Keine IP-Adressen, kein roher User-Agent, nur ein
  Geräte-Bucket.
- **Personenbezug bewusst gewählt.** Bei 15 Teilnehmenden ist auch ein Pseudonym praktisch
  re-identifizierbar. Deshalb: `player_id` wird gespeichert (nötig für „wie viele *verschiedene*
  Personen“), aber der Adminbereich zeigt ausschließlich Aggregate und unterdrückt Zellen mit
  weniger als 3 Personen. Rohdaten nur per Export.
- **Einwilligung.** Es gibt bereits ein Consent-Modell für die Spielzeiterfassung
  (`event_tracking_consents`). Nutzungsdaten sind ein anderer Zweck und brauchen eine eigene, klar
  benannte Entscheidung — die bestehende Zustimmung darf nicht mitbenutzt werden. **Empfehlung:**
  sichtbarer Hinweis beim Onboarding plus jederzeit erreichbarer Opt-out im Profil, weil ein
  striktes Opt-in bei N≈15 die Daten praktisch wertlos macht. Die Entscheidung liegt beim Nutzer
  (Abschnitt 13).
- **Ausschlüsse.** Testnutzende (`testUsers`) und Kiosk-Geräte getrennt gekennzeichnet und aus allen
  Personenkennzahlen ausgeschlossen; Admin-Aktionen separat ausgewiesen, damit die Orga-Nutzung die
  Teilnehmerzahlen nicht verfälscht.
- **Aufbewahrung.** Rohsätze bis 90 Tage nach Eventende, danach nur Aggregate. Kontolöschung löscht
  auch die zugehörigen Nutzungssätze und Feedback-Einträge.
- **Transparenz.** Die erhobenen Schlüssel sind aus der Allow-List im Code ablesbar; ein kurzer
  Abschnitt im Profil erklärt in einfachen Worten, was erfasst wird.

---

## 11. Technische Skizze

**Tabellen** über den bestehenden `schema_migrations`-Mechanismus in `server/src/db.ts`:

- `usage_events` mit den Feldern aus 6.1, Indizes auf `(event_id, key, occurred_at)` und
  `(event_id, player_id, occurred_at)`.
- `feedback_entries` für Baustein B (Text, Stimmung, Ansicht, Event, Person, Zeitpunkt).

**Endpunkte:**

- `POST /api/usage/events` — Batch, max. ~50 Ereignisse, `requireUser`, eigene Ratenbegrenzung,
  strenge Validierung gegen die Schlüssel-Allow-List; unbekannte Schlüssel und überlange Werte
  werden verworfen statt gespeichert. Antwort immer `204`, auch bei teilweisem Verwurf — der Client
  soll nichts nachbessern müssen.
- `POST /api/feedback` — ein Eintrag, `requireUser`, Längenbegrenzung.
- `GET /api/admin/usage` — `requireAdmin`, liefert die Aggregate für Abschnitt 8.

**Client:** ein Modul `server/public/js/usage.js` mit `trackUsage(key, { action, value, count,
durationMs, context })`. Ereignisse werden im Speicher gepuffert und gebündelt gesendet: alle ~15 s,
bei Ansichtswechsel, spätestens bei `pagehide`/`visibilitychange` per `navigator.sendBeacon`.
Puffergrenze (z. B. 200 Ereignisse) mit Verwurf der ältesten Einträge; ein Zähler für verworfene
Ereignisse wird mitgesendet, damit Lücken erkennbar bleiben. Sendefehler werden verworfen, nicht
eskaliert.

**Volumen:** großzügig gerechnet 1.500 Ereignisse pro Person und Tag × 15 Personen × 3 Tage ≈ 70.000
Zeilen à ~200 Byte ≈ 15 MB. Für SQLite mit WAL unkritisch; Schreibvorgänge kommen gebündelt alle 15
Sekunden, nicht pro Klick. Auswirkung auf die Backup-Größe vernachlässigbar, gehört aber in
`OPERATIONS.md`.

**Tests** (gemäß Definition of Done): Puffer-, Flush- und Verwurf-Logik des Client-Moduls, Redaktion
von Freitext, Validierung und Ratenbegrenzung der Endpunkte, Admin-Berechtigung auf
`GET /api/admin/usage`, Unterdrückung kleiner Zellen — sowie ein Test, der belegt, dass ein
fehlschlagender Usage-Endpunkt die Oberfläche nicht beeinträchtigt.

---

## 12. Stufenplan

| Stufe | Inhalt | Nutzen | Aufwand |
| --- | --- | --- | --- |
| 0 | Auswertung der Bestandsdaten (Baustein A) im Adminbereich | sofortige Aussage über alle Fachfunktionen, kein neues Schema | klein |
| 1 | Feedback-Button und `feedback_entries` (Baustein B) | Begründungen ab dem ersten Eventtag | klein |
| 2 | `usage.js`, `usage_events`, Endpunkt, `data-usage`-Delegation, zentrale Einbaupunkte aus 6.3 und die Messpunkte aus 6.4 | beantwortet Filter-, Such-, Auswahl- und Bezahlfragen | klein–mittel |
| 3 | Admin-Auswertung nach Abschnitt 8 inklusive Selbsttest und Export | Auswertung ohne Datenbankzugriff | klein–mittel |
| 4 | Kurzumfrage (Baustein D) und Entscheidungsreport je Messpunkt | dokumentierte Entscheidungen | kein Code |

Stufen 0–3 sollten **spätestens zwei Wochen vor dem Event** stehen, damit die Erhebung im
Testbetrieb einmal verifiziert werden kann — insbesondere der Selbsttest aus Abschnitt 8.7. Eine
Instrumentierung, die erst am Eventtag scharf geschaltet wird, liefert Lücken genau dort, wo es
interessant wird.

---

## 13. Risiken, Grenzen und offene Entscheidungen

**Risiken und Grenzen**

- **Ein Event = ein Datenpunkt.** Die Zahlen eignen sich für „offensichtlich tot“ und „offensichtlich
  getragen“, nicht für Feinabstimmung.
- **Neugier-Effekt.** Am ersten Tag wird alles einmal angetippt — daher die Tag-2/3-Betrachtung.
- **Nonresponse.** Wer die App kaum nutzt, gibt auch kein Feedback und füllt keine Umfrage aus.
- **Instrumentierungslücke = Feature erscheint tot.** Der Selbsttest aus 8.7 ist Pflicht vor jeder
  Auswertung.
- **Zeitversatz und Lücken.** Clientuhren, geschlossene Tabs und Verbindungsabbrüche verursachen
  fehlende Ereignisse. `received_at` und der Verwurfszähler machen das sichtbar; Quoten immer gegen
  Impressionen rechnen, nie gegen erwartete Absolutwerte.
- **Direkte Beobachtung schlägt beides.** Bei 15 Personen in einem Raum ersetzt fünf Minuten
  Zuschauen viel Instrumentierung. Das ist keine Ausrede, es wegzulassen — aber die Auswertung
  sollte nicht so tun, als sei sie die einzige Erkenntnisquelle.

**Offene Entscheidungen**

1. **Einwilligung:** Hinweis + Opt-out (Empfehlung) oder striktes Opt-in?
2. **Schwellenwerte** aus Abschnitt 9 so übernehmen oder anpassen?
3. **Feedback-Einstieg:** Topbar (immer sichtbar) oder Profil (unauffälliger)?
4. **Kurzumfrage** am letzten Eventtag: gewünscht, und in welcher Form?

Nach Klärung dieser Punkte können die Stufen 0–3 als eigene Änderungsaufträge umgesetzt werden.
