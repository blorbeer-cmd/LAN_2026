# Konzept: Event-Sichtbarkeit nur für Eingeladene

Stand: 2026-08-07 · Status: **Konzept, noch nicht umgesetzt**

Auftrag: Ein Event soll nur sehen, wer dazu eingeladen wurde — einschließlich aller
Auswertungen, Statistiken und Ranglisten.

Kurzantwort auf „wäre das aufwändig?“: **Der Zugriffsmechanismus existiert bereits fast
vollständig; der Aufwand liegt fast ausschließlich in den Auswertungsflächen.** Die reine
Event-Sichtbarkeit (Listen, Detailseiten, eventgebundene Fachdaten) ist ein kleiner Eingriff.
Statistiken, Ranglisten und Hall of Fame sind der teure Teil, weil sie heute bewusst
eventübergreifend aggregieren und dabei jede Sichtbarkeitsgrenze umgehen. Realistische
Gesamtgröße: **mittel bis groß, sinnvoll in vier Phasen mit je einem eigenen PR.**

---

## 1. Ist-Zustand

Die Grundlagen sind vorhanden und getestet — es fehlt nicht das Fundament, sondern die
flächendeckende Anwendung.

### 1.1 Was es schon gibt

| Baustein | Ort | Zustand |
|---|---|---|
| Sichtbarkeitsstufe pro Event | `events.visibility_scope` (`group`/`participants`/`public`), DB-Default `participants` | `server/src/db.ts:2551` |
| Einladungsstatus pro Person | `event_participants.status` (`invited`/`accepted`/`declined`) | `server/src/eventParticipation.ts` |
| Einladen / Annehmen / Ablehnen / Entfernen | `POST /api/events/:id/invitations`, `.../invitation/accept`, `.../invitation/decline`, `DELETE .../participants/:playerId` | `server/src/routes/events.ts:163-244` |
| REST-Zugriffsguard | `requestCanAccessGroupEvent` / `requireGroupEventAccess` | `server/src/groupEventScope.ts:43-58` |
| Realtime-Guard (default-deny, pro Auslieferung neu geprüft) | `activeEventAccess` in `broadcast()` | `server/src/realtime.ts:45-89, 359-414` |
| Tracking respektiert Sichtbarkeit bereits | `activeTrackingContexts` filtert nach `visibility_scope` und Einwilligung | `server/src/trackingContexts.ts:26-46` |
| Kiosk-Token mit Event-Scope | `kioskTokens.ts`, Zustellmatrix in `realtime.ts` | vorhanden |

Der Guard wird heute in zehn Routendateien konsequent verwendet: `push`, `seating`,
`infoBoard`, `arrivals`, `votes`, `pings`, `arcade`, `broadcasts`, `foodOrders`, `checklist`
und in Teilen `players` und `analytics`. Dort funktioniert das gewünschte Verhalten bereits.

### 1.2 Die Lücken

**Lücke A — die Eventliste selbst ist ungefiltert.**
`GET /api/events` liefert jedem aktiven Gruppenmitglied *alle* Events der Gruppe, inklusive
Name, Zeitraum, Ort, Beschreibung **und der vollständigen Teilnehmerliste mit
Einladungsstatus** (`server/src/routes/events.ts:108-113`, Serialisierung in Zeile 80-99).
`GET /api/events/:id` und `GET /api/events/active` prüfen ebenfalls nur Gruppen-, nicht
Eventzugehörigkeit. Das ist heute die direkteste Offenlegung — und gleichzeitig die
Voraussetzung dafür, dass die bestehende Einladungs-UI in `server/public/js/views/games.js:82`
überhaupt funktioniert (sie filtert die offenen Einladungen clientseitig aus der Gesamtliste).

**Lücke B — Auswertungen ignorieren die Sichtbarkeit vollständig.**

| Endpunkt | Verhalten heute | Ort |
|---|---|---|
| `GET /api/hall-of-fame` | listet **alle** Events der Gruppe namentlich, mit Endstand und Turniersiegern | `routes/hallOfFame.ts:29-95` |
| `GET /api/leaderboard` | aggregiert **alle** `matches` der Gruppe über alle Events hinweg, ohne Eventfilter | `routes/leaderboard.ts:16-24` |
| `GET /api/stats/playtime` | `?eventId=` wird ungeprüft übernommen; ohne Filter Summe über alle Events | `routes/stats.ts:32-48` |
| `GET /api/analytics/{overview,sessions,concurrency,awards,games,games-tournaments}` | `?eventId=` ungeprüft; nur `/analytics/arcade` guardet korrekt | `routes/analytics.ts:111-373` vs. `:479-490` |
| `GET /api/matches` | `?eventId=` ungeprüft, ohne Filter alle Events | `routes/matches.ts:121-133` |
| `GET /api/tournaments` | `?eventId=` ungeprüft, Default `getTrackingEventId()` (global, nicht gruppengeprüft) | `routes/tournaments.ts:272-285` |
| `GET /api/matchmaking/history`, `GET /api/draft/history` | `?eventId=` ungeprüft | `routes/matchmaking.ts:406`, `routes/draft.ts:131` |
| `GET /api/export/*` (CSV/PDF) | `?eventId=` ungeprüft, Default `getTrackingEventId()` | `routes/export.ts:368-385` |

**Lücke C — Aggregate über mehrere Events.**
Selbst mit perfekten Einzelguards bleibt eine strukturelle Lücke: Gesamt-Rangliste,
Gesamt-Spielzeit, Profilstatistiken und Hall of Fame fassen bewusst *alle* Events zusammen.
Wer nicht eingeladen war, sieht die Ergebnisse dieses Events dann zwar nicht mehr namentlich,
aber weiterhin in jeder Summe. Das ist keine Randnotiz, sondern der eigentliche Kern des
Aufwands: **jede Aggregation braucht eine Sichtbarkeits-Allowlist statt eines Eventfilters.**

**Lücke D — „eingeladen“ ist heute nicht sichtbarkeitsrelevant.**
`isParticipant()` und `ACCEPTED_EVENT_PARTICIPANT_SQL` bedeuten ausschließlich
`status = 'accepted'` (`server/src/eventParticipation.ts:6`). Ein frisch Eingeladener wäre nach
dem Guard also *nicht* zugriffsberechtigt — er könnte seine eigene Einladung nicht sehen und
nicht annehmen. Der Auftrag „sichtbar, wenn eingeladen“ braucht deshalb zwingend eine
zusätzliche, schwächere Sichtbarkeitsstufe (siehe 2.2).

**Lücke E — keine Bedienoberfläche für die Sichtbarkeit.**
`visibilityScope` wird von der API akzeptiert (`routes/events.ts:304, 374`), kommt im Frontend
aber an keiner Stelle vor. Neue Events landen dadurch immer auf dem DB-Default `participants`,
ohne dass ein Admin das sieht oder ändern kann.

---

## 2. Zielmodell

### 2.1 Grundregel

> Ein Event existiert für eine Person nur dann, wenn sie eingeladen ist, es angenommen hat oder
> Admin/Owner der Gruppe ist. Alles andere — Detailseite, eventgebundene Fachdaten, Statistiken,
> Ranglisten, Exporte, Realtime-Signale — folgt derselben Menge sichtbarer Events.

Das Sentinel-Event „Außerhalb von Events" (`OUTSIDE_EVENTS_ID`) ist davon ausgenommen: es ist
der permanente Gruppenraum und bleibt für alle aktiven Mitglieder sichtbar.

### 2.2 Drei Sichtbarkeitsstufen statt einer

| Stufe | Wer | Sieht |
|---|---|---|
| **0 — unsichtbar** | weder eingeladen noch Admin | nichts. Das Event taucht in keiner Liste, keinem Filter, keiner Statistik auf; `GET /api/events/:id` antwortet `404` (nicht `403` — sonst ist die Existenz ableitbar) |
| **1 — Teaser** | `status = 'invited'` oder `'declined'` | Name, Zeitraum, Ort, Beschreibung, Annehmen/Ablehnen-Aktion. **Keine** Teilnehmerliste, keine Fachdaten, keine Statistiken |
| **2 — voll** | `status = 'accepted'` | alles wie heute |
| **2 — voll** | Gruppen-Admin/Owner | alles; sie verwalten die Events |

Stufe 1 ist die minimal nötige Erweiterung, damit eine Einladung überhaupt angenommen werden
kann. Sie schließt die Teilnehmerliste bewusst aus: wer ein Event ablehnt, soll nicht erfahren,
wer sonst noch eingeladen war.

`visibility_scope` bleibt erhalten und behält seine Bedeutung:

- `participants` — Zielzustand und Default für neue Events (Stufenmodell oben).
- `group` — bewusst geöffnetes Event, für alle aktiven Mitglieder auf Stufe 2. Nötig für
  Bestandsdaten (siehe 4.3) und für „das Sommer-LAN sieht jeder".
- `public` — heute nirgends von `group` unterschieden. Empfehlung: **im Rahmen dieses Umbaus
  entfernen** (Migration auf `group`), statt eine dritte Semantik mitzuschleppen, die kein
  Bedienkonzept hat.

### 2.3 Konsequenz für Auswertungen — die eigentliche Produktentscheidung

Mit der Grundregel wird jede Statistik **personalisiert**: zwei Personen sehen unterschiedliche
Gesamt-Ranglisten, weil ihre Menge sichtbarer Events unterschiedlich ist. Das ist die
unvermeidliche Folge des Auftrags, aber sie sollte bewusst getroffen und in der UI erklärt
werden („Basis: 3 von 5 Events").

Zwei Umsetzungsvarianten stehen zur Wahl:

| Variante | Regel | Aufwand | Bewertung |
|---|---|---|---|
| **V1 — vollständig** (empfohlen) | jede Aggregation läuft über `event_id IN (sichtbare Events)` | mittel-groß | erfüllt den Auftrag wörtlich, keine Restleaks |
| **V2 — nur Flächen** | Listen/Detail/Fachdaten werden gefiltert; Gesamt-Rangliste, Gesamt-Spielzeit und Hall of Fame bleiben gruppenweit | klein | deutlich billiger, aber die Existenz und die Ergebnisse fremder Events bleiben in jeder Summe ablesbar — der Auftrag ist damit nicht erfüllt |

Empfehlung: **V1**. V2 ist nur sinnvoll, wenn Statistiken bewusst als „gemeinsame
Gruppenhistorie" verstanden werden sollen und nur die operative Eventplanung privat ist. Das
wäre eine andere Produktaussage und sollte dann auch so benannt werden.

---

## 3. Umsetzung

### 3.1 Phase 1 — zentraler Sichtbarkeits-Resolver

Neu: `server/src/eventVisibility.ts` als einzige Wahrheit.

```
export type EventVisibilityLevel = 'none' | 'teaser' | 'full';

eventVisibilityLevel(groupId, eventId, playerId, role): EventVisibilityLevel
visibleEventIds(groupId, playerId, role, level = 'full'): string[]
VISIBLE_EVENT_IDS_SQL  // wiederverwendbares EXISTS-Fragment für Aggregat-Queries
```

Analog zu `ACCEPTED_EVENT_PARTICIPANT_SQL` wird ein einziges SQL-Fragment exportiert, das alle
Aggregat-Queries einbinden — damit kann die Regel nicht an 20 Stellen leicht unterschiedlich
implementiert werden. Bestehende Aufrufer (`requestCanAccessGroupEvent`, `activeEventAccess`)
werden auf den Resolver umgestellt, ihre öffentliche Signatur bleibt.

Aufwand: klein. 1 neue Datei, 2 angepasste, Unit-Tests für die Stufenmatrix.

### 3.2 Phase 2 — Eventlisten und Detailrouten

- `GET /api/events`: nur sichtbare Events; Stufe-1-Events werden als Teaser serialisiert
  (`participants`/`participantIds` weggelassen, neues Feld `visibilityLevel`).
- `GET /api/events/:id`, `GET /api/events/active`: Stufenprüfung, `404` bei Stufe 0.
- `serializeEvent()` bekommt einen Stufenparameter — die Teaser-Variante ist damit die einzige
  Stelle, an der entschieden wird, welche Felder eine Stufe-1-Person sieht.
- `resolveEvent` (`resolveGroupResource`) bleibt für die Adminrouten unverändert; die
  Mitgliederrouten (`invitation/accept`, `decline`, `tracking-consent`) prüfen zusätzlich die
  Stufe.

Aufwand: klein-mittel. Eine Datei, klar abgegrenzt.

### 3.3 Phase 3 — Auswertungsflächen (der Hauptteil)

Jeder Endpunkt aus der Tabelle in 1.2 bekommt dieselbe Behandlung:

1. Ein übergebenes `?eventId=` wird über `requireGroupEventAccess` geprüft (→ `404` statt leerer
   Antwort, damit die Existenz nicht ableitbar ist).
2. Ohne `?eventId=` wird nicht mehr „alles" aggregiert, sondern `event_id IN (sichtbare
   Events)`.
3. Die Antwort nennt die Auswertungsbasis (`consideredEventIds` bzw. `eventCount`), damit die UI
   „Basis: 3 von 5 Events" anzeigen kann.

Betroffen: `stats.ts`, `analytics.ts` (6 Endpunkte), `leaderboard.ts`, `hallOfFame.ts`,
`matches.ts`, `tournaments.ts`, `matchmaking.ts`, `draft.ts`, `export.ts` sowie die
Profilstatistik in `players.ts`. Rund 20 Endpunkte, jeder für sich mechanisch, in Summe der
größte Block.

Zwei Sonderfälle brauchen eine bewusste Entscheidung:

- **Hall of Fame** wird pro Person gefiltert. Ein Event, bei dem man nicht dabei war,
  verschwindet inklusive seines Gesamtsiegers.
- **Export (CSV/PDF)** ist heute faktisch ein Vollzugriff auf die gefilterten Daten. Entweder
  ebenfalls filtern oder — einfacher und ehrlicher — auf Admin/Owner beschränken.

Aufwand: mittel-groß. Der Löwenanteil des Projekts.

### 3.4 Phase 4 — Realtime, Push, Kiosk

Hier ist die Arbeit weitgehend erledigt: `broadcast()` prüft Mitgliedschaft und Eventzugriff
unmittelbar vor jeder Auslieferung (`realtime.ts:408-412`), Kiosk-Tokens tragen ihren eigenen
Scope. Zu tun bleibt:

- `activeEventAccess` auf den neuen Resolver umstellen (Stufe ≥ `full` für Fachdaten,
  Stufe ≥ `teaser` nur für das Einladungssignal).
- `Events.eventsChanged` wird heute als `{ groupId }`-Signal ohne Payload gesendet und ist damit
  unkritisch — der Client lädt selbst gefiltert nach. Das bleibt so.
- Kiosk ohne Personenbezug kann keine Teilnehmerprüfung machen: ein Kiosk-Token bleibt an
  seinen expliziten Event- oder Gruppenscope gebunden. Ein Gruppen-Kiosk darf danach **keine**
  `participants`-Events mehr anzeigen — das ist eine Verhaltensänderung und gehört in die
  Betriebsdokumentation.

Aufwand: klein.

### 3.5 Phase 5 — Frontend

- Sichtbarkeitsauswahl im Event-Formular (`server/public/js/views/games.js:224-229`), zwei
  Optionen: „Nur Eingeladene" (Default) / „Alle Mitglieder".
- Teaser-Darstellung für Stufe-1-Events: eigene Karte mit Annehmen/Ablehnen, ohne
  Teilnehmerliste. Die vorhandene Logik in `games.js:82` filtert dann nicht mehr clientseitig,
  sondern rendert, was der Server liefert.
- Alle Event-Auswahlfelder (Statistiken, Analytics, Seating, Hall of Fame) und die Suchpalette
  (`server/public/js/searchPalette.js:85`) speisen sich aus `state.events`, also aus der dann
  bereits gefilterten Liste — hier ist nichts zusätzlich zu tun, sobald Phase 2 steht.
- Hinweiszeile zur Auswertungsbasis, wo Aggregate personalisiert sind.

Aufwand: klein-mittel.

### 3.6 Phase 6 — Tests und Dokumentation

- Erweiterung von `src/test/api.eventInvitations.required.test.ts` um die vollständige
  Stufenmatrix (nicht eingeladen / eingeladen / angenommen / abgelehnt / entfernt × Admin,
  Member) gegen Liste, Detail und je einen Vertreter pro Auswertungsfläche.
- Neue Required-Suite `api.eventVisibility.required.test.ts`: für **jeden** Endpunkt mit
  `?eventId=` ein Negativtest auf `404` bei fremdem Event. Das ist die Regression, die verhindert,
  dass ein später ergänzter Endpunkt die Regel wieder unterläuft.
- E2E: zwei Clients, einer eingeladen, einer nicht — das Event ist beim zweiten in keiner Ansicht
  auffindbar, auch nicht über die Suchpalette.
- `realtime.delivery.required.test.ts` um die Teaser-Stufe ergänzen.
- Dokumentation: dieses Konzept auf „umgesetzt" setzen, `server/OPERATIONS.md` um das geänderte
  Kiosk-Verhalten ergänzen.

Aufwand: mittel. Nicht optional — ohne die Negativsuite verrottet die Regel.

---

## 4. Risiken und Entscheidungen vor der Umsetzung

### 4.1 Personalisierte Statistiken (Entscheidung nötig)

Siehe 2.3. Ohne Festlegung auf V1 oder V2 ist Phase 3 nicht startbar. Alles andere hängt nicht
daran und könnte auch vorher laufen.

### 4.2 „Abgelehnt" ist heute eine Sackgasse

`respondToEventInvitation` erlaubt eine Antwort nur aus dem Status `invited`
(`server/src/events.ts:303`). Wer ablehnt, kann nicht selbst zurück — nur ein Admin kann erneut
einladen. Mit der Teaser-Stufe sieht die Person das Event weiterhin, kann aber nichts tun.
Empfehlung: Ablehnen zurücknehmen erlauben (`declined → accepted` direkt), solange das Event
weder beendet noch abgesagt ist. Kleiner Zusatz, verhindert eine offensichtlich unfertige
Bedienung.

### 4.3 Bestandsdaten — das größte Betriebsrisiko

Der DB-Default ist bereits `participants`, und Rosters wurden je nach Weg als `accepted`
(`setParticipants`) oder gar nicht gesetzt. Ohne Migration würde nach dem Deploy **die gesamte
Historie für alle verschwinden**, deren Teilnahme nie explizit eingetragen wurde — inklusive
Hall of Fame und Gesamt-Rangliste.

Verbindlich: Eine Migration setzt **alle vor diesem Umbau existierenden Events** explizit auf
`visibility_scope = 'group'`. Erst neu angelegte Events starten auf `participants`. Damit ist der
Umbau rückwärtskompatibel und ein Admin kann Altevents bewusst einzeln schließen. Die Migration
ist idempotent und braucht einen Legacy-Fixture-Test nach `server/TESTING.md`.

### 4.4 Kiosk

Siehe 3.4: Ein Gruppen-Kiosk verliert den Blick auf teilnehmerprivate Events. Das ist korrekt,
aber sichtbar — vor dem Rollout ansagen.

### 4.5 Test-User und Backup

`testUsers.ts` und `backupService.ts` greifen an der Sichtbarkeit vorbei auf Events zu. Das ist
für Backups richtig (vollständiger Datenbestand) und für Test-User unkritisch, sollte aber im
Review ausdrücklich bestätigt statt übersehen werden.

### 4.6 Was ausdrücklich kein Risiko ist

Performance. Bei ~15 Personen und einer Handvoll Events kostet ein zusätzliches `EXISTS` auf
`event_participants` nichts messbar. Keine Indizes, kein Caching nötig.

---

## 5. Aufwandsschätzung

| Phase | Inhalt | Größe | Abhängig von |
|---|---|---|---|
| 1 | Sichtbarkeits-Resolver + Stufenmodell | S | — |
| 2 | Eventliste, Detail, Teaser-Serialisierung | S–M | 1 |
| 3 | ~20 Auswertungsendpunkte auf Allowlist umstellen | **L** | 1, Entscheidung 4.1 |
| 4 | Realtime/Push/Kiosk angleichen | S | 1 |
| 5 | Frontend: Auswahl, Teaser, Auswertungsbasis | S–M | 2, 3 |
| 6 | Negativ-Testsuite, E2E, Doku | M | alle |
| — | Migration Bestandsdaten (4.3) | S | — |

Ohne Phase 3 (also Variante V2): **klein**, gut in einem PR machbar. Mit Phase 3 (Variante V1,
Auftrag wörtlich erfüllt): **mittel bis groß**, sinnvoll auf vier PRs verteilt —
(1+2), (3), (4+5), (6+Migration) — damit jeder PR für sich reviewbar und grün bleibt.

---

## 6. Definition of Done

- Ein nicht eingeladenes Mitglied findet ein `participants`-Event in **keiner** Ansicht: nicht in
  der Eventliste, keinem Filter, keiner Statistik, keiner Rangliste, keinem Export, keiner
  Suchpalette und über kein Realtime-Signal.
- Direktzugriff auf eine bekannte Event-ID liefert `404`, nicht `403`.
- Ein eingeladenes, noch nicht beigetretenes Mitglied sieht genau den Teaser und kann annehmen
  oder ablehnen — nicht mehr.
- Gruppen-Admin und Owner sehen und verwalten weiterhin alles.
- Bestandsevents sind nach der Migration unverändert für alle sichtbar.
- Jeder Endpunkt mit `?eventId=` hat einen Negativtest gegen ein fremdes Event.
- `npm run lint`, `npm run build`, `npm test` und `npm run test:e2e` sind grün.
