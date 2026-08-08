# Konzept: Event-Sichtbarkeit nur für Eingeladene

Stand: 2026-08-07 · Status: **Konzept, noch nicht umgesetzt**

Auftrag: Ein Event soll nur sehen, wer dazu eingeladen wurde. Die Gesamtrangliste bleibt dabei
vollständig; gefiltert werden darf nur auf Events, bei denen man selbst dabei war.

Zwei Umstände machen das Vorhaben deutlich kleiner, als es zunächst aussah:

1. **Es gibt noch keine echten Statistik- oder Eventdaten, nur Testdaten.** Damit entfällt die
   Kompatibilitätsmigration für gewachsene Historie — ursprünglich der teuerste und riskanteste
   Teil (Abschnitt 4.3).
2. **Die Aggregate bleiben unangetastet.** Weil die Gesamtrangliste bewusst alle Daten enthält,
   entfällt der Umbau von rund 20 Auswertungsendpunkten auf eine Sichtbarkeits-Allowlist —
   ursprünglich der größte Arbeitsblock (Abschnitt 2.3).

Kurzantwort auf „wäre das aufwändig?“: **Überschaubar, aber nicht nur mechanisch.** Der
Zugriffsmechanismus existiert bereits fast vollständig — `visibility_scope`, Einladungsstatus,
REST-Guard und Realtime-Prüfung sind da und getestet. Neben den Routenguards braucht vor allem das
gemischt eventübergreifende Live-Board eine betrachterabhängige Auslieferung. Realistische
Gesamtgröße: **mittel, sinnvoll in zwei bis drei PRs.** Jetzt umgesetzt ist es deutlich billiger
als nach der ersten echten LAN.

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

Der Guard wird heute in neun Routendateien konsequent verwendet: `push`, `seating`,
`infoBoard`, `arrivals`, `pings`, `arcade`, `broadcasts`, `foodOrders`, `checklist` und in Teilen
`players`, `analytics` und `votes`. Nur auf diesen tatsächlich geguardeten Pfaden funktioniert
das gewünschte Verhalten bereits.

### 1.2 Die Lücken

**Lücke A — die Eventliste selbst ist ungefiltert.**
`GET /api/events` liefert jedem aktiven Gruppenmitglied *alle* Events der Gruppe, inklusive
Name, Zeitraum, Ort, Beschreibung **und der vollständigen Teilnehmerliste mit
Einladungsstatus** (`server/src/routes/events.ts:108-113`, Serialisierung in Zeile 80-99).
`GET /api/events/:id` und `GET /api/events/active` prüfen ebenfalls nur Gruppen-, nicht
Eventzugehörigkeit. Das ist heute die direkteste Offenlegung — und gleichzeitig die
Voraussetzung dafür, dass die bestehende Einladungs-UI in `server/public/js/views/games.js:82`
überhaupt funktioniert (sie filtert die offenen Einladungen clientseitig aus der Gesamtliste).

**Lücke B — der Eventzugriff wird in vier verschiedenen Scope-Klassen umgangen.**

Entscheidend ist, **woher** ein Endpunkt seinen Event-Scope bezieht. Nach dieser Quelle ist die
Inventur gegliedert, nicht nach dem Query-Parameter — eine frühere Fassung dieses Dokuments
inventarisierte nur `?eventId=` und übersah dadurch die übrigen Klassen vollständig.

**B1 — expliziter `?eventId=`-Parameter, ungeprüft übernommen.**

| Endpunkt | Verhalten heute | Ort |
|---|---|---|
| `GET /api/stats/playtime` | `?eventId=` wird ungeprüft übernommen; ohne Filter Summe über alle Events | `routes/stats.ts:32-48` |
| `GET /api/analytics/{overview,sessions,awards,games,games-tournaments}` | `?eventId=` ungeprüft; `/analytics/concurrency` nimmt keinen Eventfilter an, nur `/analytics/arcade` guardet korrekt | `routes/analytics.ts:111-193, 230-373` vs. `:479-490` |
| `GET /api/matches` | `?eventId=` ungeprüft, ohne Filter alle Events | `routes/matches.ts:121-133` |
| `GET /api/tournaments` | `?eventId=` ungeprüft, Default `getTrackingEventId()` (global, nicht gruppengeprüft) | `routes/tournaments.ts:272-285` |
| `GET /api/matchmaking/history`, `GET /api/draft/history` | `?eventId=` ungeprüft | `routes/matchmaking.ts:406`, `routes/draft.ts:131` |
| `GET /api/export/*` (CSV/PDF) | `?eventId=` ungeprüft, Default `getTrackingEventId()` | `routes/export.ts:368-385` |

**B2 — Scope aus dem aktuell getrackten Event, ohne jede Prüfung.**

Der gesamte aktive Abstimmungsfluss arbeitet auf der gruppenweit aktuellen Runde und prüft deren
`meta.eventId` nirgends:

| Endpunkt | Verhalten heute | Ort |
|---|---|---|
| `GET /api/votes` | gibt `buildPayload()` direkt aus — inklusive `eventId`, Titel, Info und Auswahl | `routes/votes.ts:337-340`, Payload `:101-127` |
| `GET /api/votes/mine` | dieselbe Runde, kein Guard | `routes/votes.ts:402-415` |
| `POST /api/votes`, `POST /api/votes/points` | **Schreibzugriff** auf die Runde eines fremden Events | `routes/votes.ts:516-646` |
| `POST /api/matches`, Matchmaking-Erzeugung/Rematch, aktueller Draft | Scope aus `trackingEventIdForGroup()` oder dem gruppenweit neuesten Zustand, kein Teilnehmer-Guard | `routes/matches.ts:144-178`, `routes/matchmaking.ts:150-335`, `routes/draft.ts:152-155` |

Nur Broadcast und Push werden beim Rundenstart mit `eventId` gescopt (`votes.ts:470-509`); der
REST-Pfad nutzt dieses Metadatum nicht. Und `loadAll()` ruft `api.votes.get()` für **jedes**
Mitglied automatisch auf (`server/public/js/data.js:14-27`) — die Offenlegung passiert also ohne
jedes Zutun.

**B3 — Scope aus einer geladenen Ressource, über bekannte IDs erreichbar.**

| Endpunkt | Verhalten heute | Ort |
|---|---|---|
| `GET /api/tournaments/:id` | liefert das vollständige Board **einschließlich `lobbyPassword`**, geprüft wird nur die Gruppe | `routes/tournaments.ts:294-298`, Serialisierung `:248-263` |
| `POST`/`PUT /api/tournaments/:id/matches/:matchId/result` | **verändert** das Board ohne Eventguard | `routes/tournaments.ts:540-550`, Registrierung `:917-918` |
| `PATCH /api/matches/:id`, `PATCH /api/matchmaking/draws/:id/move` | verändert die über ihre ID geladene Ressource ohne Prüfung ihres Events | `routes/matches.ts:254-318`, `routes/matchmaking.ts:440-521` |
| `POST /api/draft/pick` | lädt den aktiven Draft und prüft die Identität des Captains, aber nicht dessen aktuellen Eventzugriff | `routes/draft.ts:275-365` |
| `GET /api/votes/history/:round` | guardet den optionalen Query-Scope, lädt die Antwort aber allein über die Rundennummer und gibt `eventId`/`eventName` der Zeile aus | `routes/votes.ts:796-835` |

Diese Klasse ist die gefährlichste: Sie ist nicht nur eine Benennungslücke, sondern erlaubt einem
Außenstehenden mit einer geratenen oder anderswo aufgeschnappten ID das **Verändern** fremder
Eventdaten. Negativtests, die nur `?eventId=` abklopfen, können davon nichts entdecken.

**B4 — der Live-Status ist gar nicht eventgefiltert.**

`GET /api/live` liefert unverändert `getLiveBoard(groupId)` (`routes/live.ts:14-15`).
`getLiveBoard` fasst `tracking_live_contexts` pro Spieler über **alle** Events zusammen und lädt
sämtliche `tracking_live_games` der Gruppe ohne Eventfilter (`liveStatus.ts:107-122`). Auch der
Realtime-Payload enthält dieses vollständige Board; die Zustellmetadaten tragen nur `{ groupId }`
und kein `eventId` (`routes/agent.ts:78`), weshalb die Eventprüfung in `broadcast()` nicht greift
(`realtime.ts:359-412`).

Ein Außenstehender sieht damit weiterhin, wer im privaten Event gerade aktiv ist und was gespielt
wird. Das Umstellen von `activeEventAccess` in Phase 4 behebt diesen Pfad **nicht** — der Scope ist
in den Trackingtabellen vorhanden, wird aber beim Bau des ausgelieferten Boards verworfen.

**Lücke C — eventbenennende Ausgaben in Auswertungen.**
Zu unterscheiden von den reinen Summen: Manche Auswertungen geben einzelne Events preis, nicht
nur Zahlen. Die Hall of Fame listet jedes Event namentlich mit Zeitraum, Gesamtsieger und
Endstand (`routes/hallOfFame.ts:29-95`); `GET /api/matches` und `GET /api/tournaments` liefern
pro Zeile eine `eventId` mit (`routes/matches.ts:57`), und
`GET /api/votes/history/:round` gibt `eventId` und `eventName` der über die Rundennummer geladenen
Zeile aus (`routes/votes.ts:832-835`). Diese vier sind echte Lücken und werden geschlossen.

Die *Summen* dagegen — Gesamt-Rangliste, Gesamt-Spielzeit, Profilstatistiken,
All-Time-Zähler — bleiben bewusst vollständig. Das ist keine Lücke, sondern die
Produktentscheidung aus Abschnitt 2.3.

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
- `group` — bewusst geöffnetes Event, für alle aktiven Mitglieder auf Stufe 2. Für „das
  Sommer-LAN sieht jeder", nicht mehr als Kompatibilitätskrücke für Bestandsdaten (siehe 4.3).
- `public` — heute nirgends von `group` unterschieden. Empfehlung: **im Rahmen dieses Umbaus
  entfernen** (Migration auf `group`), statt eine dritte Semantik mitzuschleppen, die kein
  Bedienkonzept hat.

### 2.3 Auswertungen — entschieden

**Produktentscheidung (2026-08-07): Die Gesamtrangliste enthält alle Daten. Gefiltert werden
darf nur auf Events, bei denen man selbst dabei war.**

Damit ist die Trennlinie nicht „welche Zahlen fließen ein", sondern **„wird ein einzelnes Event
benannt oder identifizierbar"**:

| Art der Ausgabe | Regel | Beispiele |
|---|---|---|
| **Summe ohne Eventbezug** | vollständig, gruppenweit — kein Filter | Gesamtrangliste, Gesamt-Spielzeit pro Person/Spiel, All-Time-Zähler der Hall of Fame, Analytics-Kennzahlen ohne Eventauswahl |
| **Eventauswahl** (`?eventId=`) | nur sichtbare Events; fremde ID → `404` | jeder Filter in Statistiken, Analytics, Export, Seating |
| **Ausgabe, die ein Event benennt** | nur sichtbare Events | Eventliste und -filter, Hall-of-Fame-Abschnitte pro Event, `GET /api/matches` und `GET /api/tournaments` (jede Zeile trägt `eventId`, `routes/matches.ts:57`) |

Das ist die konsistente Ausformulierung der Entscheidung: Die Gruppe hat **eine** gemeinsame
Bestenliste über ihre gesamte Geschichte — aber wer bei einem Event nicht dabei war, erfährt
nicht, dass es stattgefunden hat, wer dort war und was dort passiert ist.

Praktisch heißt das für die UI: Das Event-Auswahlfeld enthält nur die eigenen Events, die
unfilterte Gesamtansicht bleibt für alle identisch. Kein „Basis: 3 von 5 Events"-Hinweis nötig —
die Gesamtzahlen sind vollständig und für jeden gleich.

**Bewusst in Kauf genommener Restschluss:** Wer seine eigenen Eventsummen von der Gesamtsumme
abzieht, kann auf die Existenz und den Umfang weiterer Events schließen — nicht aber auf deren
Namen, Zeitraum, Teilnehmer oder Ergebnisse. Das ist die direkte Folge einer vollständigen
Gesamtrangliste und ausdrücklich akzeptiert; es ist kein Fehler, der später „behoben" werden
muss.

Weil es bislang **keine echten Statistikdaten gibt, nur Testdaten**, ist das eine reine
Vorwärtsentscheidung: es zerfällt keine gewachsene Historie, und niemand verliert Zahlen, die
er schon kannte.

---

## 3. Umsetzung

### 3.1 Phase 1 — zentraler Sichtbarkeits-Resolver

Neu: `server/src/eventVisibility.ts` als einzige Wahrheit.

```
export type EventVisibilityLevel = 'none' | 'teaser' | 'full';

eventVisibilityLevel(groupId, eventId, playerId, role): EventVisibilityLevel
visibleEventIds(groupId, playerId, role, level = 'full'): string[]
VISIBLE_EVENT_IDS_SQL  // wiederverwendbares EXISTS-Fragment für eventbenennende Queries
```

Analog zu `ACCEPTED_EVENT_PARTICIPANT_SQL` wird ein einziges SQL-Fragment exportiert, das alle
Queries mit einzelnen Eventbezügen einbinden — damit kann die Regel nicht an vielen Stellen
leicht unterschiedlich implementiert werden. Gruppenweite Summen ohne Eventbezug verwenden es
gemäß Abschnitt 2.3 ausdrücklich nicht. Bestehende Aufrufer (`requestCanAccessGroupEvent`,
`activeEventAccess`) werden auf den Resolver umgestellt, ihre öffentliche Signatur bleibt.

Aufwand: klein. 1 neue Datei, 2 angepasste, Unit-Tests für die Stufenmatrix.

### 3.2 Phase 2 — Eventlisten und Detailrouten

- `GET /api/events`: nur sichtbare Events; Stufe-1-Events werden als Teaser serialisiert
  (`participants`/`participantIds` weggelassen, neues Feld `visibilityLevel`).
- `GET /api/events/:id`: Stufenprüfung, `404` bei Stufe 0.
- `GET /api/events/active`: Ist das tatsächlich getrackte Event für den Betrachter unsichtbar,
  liefert der Endpunkt den neutralen Gruppenraum statt eines verräterischen `404`. In der
  gefilterten Eventliste wird derselbe Gruppenraum für diesen Betrachter als aktiv markiert; sonst
  wäre das versteckte Event über das fehlende `isActive` weiterhin ableitbar.
- `serializeEvent()` bekommt einen Stufenparameter — die Teaser-Variante ist damit die einzige
  Stelle, an der entschieden wird, welche Felder eine Stufe-1-Person sieht.
- `resolveEvent` (`resolveGroupResource`) bleibt für die Adminrouten unverändert; die
  Mitgliederrouten (`invitation/accept`, `decline`, `tracking-consent`) prüfen zusätzlich die
  Stufe.

Aufwand: klein-mittel. Eine Datei, klar abgegrenzt.

### 3.3 Phase 3 — Auswertungsflächen

Durch die Entscheidung aus 2.3 bleiben die Aggregate, wie sie sind: `leaderboard.ts` und die
unfilterten Pfade von `stats.ts`, `analytics.ts` und `players.ts` sollen weiterhin alles
zusammenfassen. Die Zugriffslücken teilen sich aber in fünf klar abgegrenzte Blöcke; nur die
expliziten Query-Guards sind rein mechanisch.

**(a) Jedes explizit übergebene `?eventId=` validieren.** Zwölf Endpunkte übernehmen den Parameter
heute ungeprüft (Tabelle in 1.2). Nur wenn der Parameter tatsächlich gesetzt ist, bekommen sie
dasselbe Guard-Muster:

```
if (req.query.eventId !== undefined) {
  const scope = resolveGroupEventScope(req.group!.id, req.query.eventId);
  if (!scope.ok) return res.status(scope.status).json({ error: scope.error });
  if (!requireGroupEventAccess(req, res, scope.eventId)) return;
}
```

Das Muster existiert bereits und ist in `analytics.ts:484-487` vorgemacht — es wird nur auf die
übrigen Endpunkte gezogen. Betroffen: `stats.ts`, `analytics.ts` (5 Endpunkte), `matches.ts`,
`tournaments.ts`, `matchmaking.ts`, `draft.ts`, `export.ts`.

Bei **fehlendem** Parameter darf dieser Guard nicht stillschweigend das gruppenweit getrackte,
für den Betrachter aber unsichtbare Event auflösen und mit `404` verraten. Endpunkte mit einer
echten Gesamtansicht liefern dann weiterhin die vollständige Summe; Endpunkte, deren Default der
aktuelle Eventzustand ist, liefern bei einem unsichtbaren Tracking-Event einen neutralen
Leerzustand. Nur ein ausdrücklich angefragtes fremdes Event beantwortet der Server mit `404`.

Wichtig dabei: Der heutige Default `getTrackingEventId()` in `tournaments.ts:276`,
`matchmaking.ts:407` und `export.ts:371, 385` ist ein **globaler** Griff ohne Gruppenprüfung. Er
wird durch `resolveGroupEventScope(...)` ersetzt, das den Trackingstand innerhalb der eigenen
Gruppe auflöst — das repariert nebenbei eine bestehende Unsauberkeit.

**(a2) Endpunkte mit serverseitig aufgelöstem aktuellem Scope absichern (B2).** Der aktive
Abstimmungsfluss (`GET /api/votes`, `/mine`, `POST /api/votes`, `POST /api/votes/points`),
Match-Erstellung, Matchmaking-Erzeugung/Rematch und `GET /api/draft` lösen ihr Event oder ihren
aktuellen Zustand serverseitig auf und prüfen ihn nie. Sie brauchen dieselbe Prüfung gegen
`meta.eventId`, das aufgelöste Tracking-Event beziehungsweise `draft.event_id`.

Für Leseendpunkte, die einen aktuellen Zustand ausliefern — insbesondere Vote-Reads und
`GET /api/draft` — gilt dabei eine Besonderheit: Ein `404` würde dessen Existenz verraten. Sie
liefern stattdessen einen **neutralen Leerzustand**; Schreibzugriffe antworten weiterhin mit
`404`.

**(a3) Ressourcenrouten absichern (B3).** Turnierdetail und -ergebnisse, Matchkorrektur,
Draw-Move, Draft-Pick und `GET /api/votes/history/:round` leiten ihr Event aus der geladenen Zeile
ab. Sie erhalten nach dem Laden eine Prüfung genau dieser `event_id` gegen die Sichtbarkeit des
Aufrufers — nie nur gegen einen optionalen Query-Parameter. Beim Turnierdetail schützt das auch
das `lobbyPassword`; bei der Abstimmungshistorie verhindert es das Durchzählen der globalen
Rundennummern.

**(a4) Live-Status pro Betrachter filtern (B4).** `getLiveBoard` bekommt den Betrachterkontext und
lässt Kontexte fremder Events weg. Ein einzelnes `eventId` am heutigen Broadcast reicht dafür
nicht: Ein Board kann Gruppenraum- und Eventkontexte mehrerer Personen mischen und dieselbe
Person kann mehr als einen erlaubten Kontext haben. `live:changed` wird deshalb zum payloadlosen
Invalidierungssignal; Browser und Kiosk laden danach ihr jeweils autorisiertes Board über
`GET /api/live` neu. Wegen der häufigen Agent-Updates bündelt der Client dicht aufeinanderfolgende
Invalidierungen, damit nicht jeder Report sofort einen eigenen Refetch pro Browser auslöst.

**(b) Eventbenennende Ausgaben filtern.** Vier Stellen geben einzelne Events preis und brauchen
die Sichtbarkeits-Allowlist:

- **Hall of Fame** (`hallOfFame.ts:29-95`): Die Abschnitte pro Event (`eventSummaries` — Name,
  Zeitraum, Gesamtsieger, Endstand, Turniersieger) werden auf sichtbare Events gefiltert. Der
  All-Time-Block (`mostOverallWins`, `mostTournamentWins`) bleibt **vollständig** — er ist eine
  Summe ohne Eventbezug und fällt damit unter die Regel „Gesamtrangliste enthält alle Daten".
- **`GET /api/matches`** (`matches.ts:57`) und **`GET /api/tournaments`**: Jede Zeile trägt eine
  `eventId`. Ohne Filter würden fremde Event-IDs mitgeliefert. Beide Listen laufen deshalb ohne
  explizites `?eventId=` über die sichtbaren Events.
- **`GET /api/votes/history/:round`**: Die über die Rundennummer geladene Zeile wird gegen ihre
  eigene `event_id` geprüft; ein beliebiger oder fehlender `?eventId=`-Parameter ist dafür kein
  Berechtigungsnachweis.

Aufwand: mittel. Die Query-Guards sind Fleißarbeit; Ressourcenrouten, neutrale Defaultzustände und
das betrachterabhängige Live-Board brauchen eigene Datenfluss- und Regressionstests.

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
- **Die Kiosk-Grenze liegt im REST-Pfad, nicht im Realtime-Pfad.** `requestCanAccessGroupEvent`
  lässt heute jede Kiosk-Anfrage pauschal passieren (`groupEventScope.ts:44`), und ein
  Gruppen-Kiosk erhält `kioskScope.eventId = null` (`routes/index.ts:79-104`). Er lädt damit
  `/api/votes/kiosk`, `/api/tournaments` und `/api/tournaments/:id` (`public/js/kiosk.js:583-606`)
  im gruppenweit aktuellen Eventzustand — beim Turnier bis hin zu den Lobby-Zugangsdaten. Realtime
  schickt dem Kiosk bewusst nur Refetch-Signale (`realtime.ts:378-405`), die eigentliche
  Autorisierung passiert also beim Refetch. Ein Gruppen-Token muss dort einen neutralen Zustand
  bekommen, ein exakt eventgebundenes Token weiterhin seine Daten.

Aufwand: klein-mittel.

### 3.5 Phase 5 — Frontend

- Sichtbarkeitsauswahl im Event-Formular: Markup bei `server/public/js/views/games.js:180-183`,
  Feldwert bei `:207-212` auslesen und bei `:214-220` in das Payload übernehmen; zwei Optionen:
  „Nur Eingeladene" (Default) / „Alle Mitglieder".
- Teaser-Darstellung für Stufe-1-Events: eigene Karte mit Annehmen/Ablehnen, ohne
  Teilnehmerliste. Die vorhandene Logik in `games.js:82` filtert dann nicht mehr clientseitig,
  sondern rendert, was der Server liefert.
- Alle Event-Auswahlfelder (Statistiken, Analytics, Seating, Hall of Fame) und die Suchpalette
  (`server/public/js/searchPalette.js:85`) speisen sich aus `state.events`, also aus der dann
  bereits gefilterten Liste — hier ist nichts zusätzlich zu tun, sobald Phase 2 steht.
- **Kein** Hinweis auf eine „Auswertungsbasis" — die Gesamtzahlen sind vollständig und für alle
  identisch. Nur das Eventauswahlfeld ist personalisiert, und das erklärt sich selbst.

Aufwand: klein.

### 3.6 Phase 6 — Tests und Dokumentation

- Erweiterung von `src/test/api.eventInvitations.required.test.ts` um die vollständige
  Stufenmatrix (nicht eingeladen / eingeladen / angenommen / abgelehnt / entfernt × Admin,
  Member) gegen Liste, Detail und je einen Vertreter pro Auswertungsfläche.
- Neue Required-Suite `api.eventVisibility.required.test.ts`: Negativtests je Scope-Quelle und
  sowohl für Reads als auch Writes. Dazu gehören explizite `?eventId=`-Filter, implizite
  Tracking-Defaults, IDs geladener Ressourcen und insbesondere
  `GET /api/votes/history/:round` ohne passenden Query-Parameter. Abgewiesene Mutationen müssen
  zusätzlich einen unveränderten Datenbankzustand nachweisen.
- Neutrale Defaultzustände separat testen: Ein unsichtbares aktives Event darf weder durch
  `GET /api/events/active`, ein fehlendes `isActive`, Vote-Reads noch andere implizite
  Tracking-Defaults ableitbar sein.
- E2E: zwei Clients, einer eingeladen, einer nicht — das Event ist beim zweiten in keiner Ansicht
  auffindbar, auch nicht über die Suchpalette.
- `realtime.delivery.required.test.ts` um die Teaser-Stufe und das payloadlose, anschließend per
  REST personalisierte `live:changed` ergänzen; die Client-Bündelung erhält einen eigenen Test.
- Dokumentation: dieses Konzept auf „umgesetzt" setzen, `server/OPERATIONS.md` um das geänderte
  Kiosk-Verhalten ergänzen.

Aufwand: mittel. Nicht optional — ohne die Negativsuite verrottet die Regel.

---

## 4. Risiken und Entscheidungen vor der Umsetzung

### 4.1 Auswertungen — entschieden, keine offene Frage mehr

Siehe 2.3: Gesamtzahlen vollständig, Eventbezüge gefiltert. Damit gibt es keine blockierende
Vorentscheidung mehr; alle Phasen sind startbar.

Zwei Punkte, die aus dieser Entscheidung folgen und im Review bewusst bestätigt werden sollten:

- **Die Hall of Fame wird zweigeteilt** (3.3 b): Eventabschnitte gefiltert, All-Time-Zähler
  vollständig. Ein Mitglied sieht dort also möglicherweise, dass jemand „4 Gesamtsiege" hat,
  ohne alle vier Events benennen zu können. Das ist gewollt und konsistent, wirkt beim ersten
  Hinsehen aber wie ein Fehler — ein kurzer erklärender Satz in der UI ist sinnvoll.
- **Der Restschluss per Subtraktion** (2.3) ist akzeptiert und wird nicht nachträglich als Bug
  behandelt.

### 4.2 „Abgelehnt" ist heute eine Sackgasse

`respondToEventInvitation` erlaubt eine Antwort nur aus dem Status `invited`
(`server/src/events.ts:303`). Wer ablehnt, kann nicht selbst zurück — nur ein Admin kann erneut
einladen. Mit der Teaser-Stufe sieht die Person das Event weiterhin, kann aber nichts tun.
Empfehlung: Ablehnen zurücknehmen erlauben (`declined → accepted` direkt), solange das Event
weder beendet noch abgesagt ist. Kleiner Zusatz, verhindert eine offensichtlich unfertige
Bedienung.

### 4.3 Bestandsdaten — entschärft, weil es nur Testdaten gibt

Ursprünglich war das der teuerste Punkt des Konzepts: eine Kompatibilitätsmigration, die alle
Altevents auf `visibility_scope = 'group'` setzt, damit nach dem Deploy nicht die gesamte
Historie inklusive Hall of Fame und Gesamt-Rangliste verschwindet.

**Das entfällt.** Es existieren keine echten Statistik- oder Eventdaten, nur Testdaten. Damit
gilt:

- **Keine Kompatibilitätsmigration.** Alle Events — bestehende wie neue — laufen auf dem
  DB-Default `participants`. Kein Backfill, kein Legacy-Fixture-Test, keine
  Rückwärtskompatibilitätsschulden.
- **Testdaten sind unkritisch und regenerierbar.** `testData.ts:36` löscht sie über
  `is_test = 1` vollständig, und `testData.ts:99` trägt alle Testspieler als Teilnehmer jedes
  Testevents ein (Spaltendefault `status = 'accepted'`, `db.ts:75`). Testevents bleiben für
  Testspieler also vollständig sichtbar. Ein echtes Nicht-Admin-Konto verliert sie — genau
  richtig, es sind keine echten Events.
- **Die einzige verbleibende Migration** ist die Vereinheitlichung von `public` auf `group`
  (Abschnitt 2.2), und auch die betrifft nach heutigem Stand null Zeilen. Sie bleibt trotzdem
  sinnvoll, um die dritte Semantik dauerhaft loszuwerden.

Zusätzliche Chance aus derselben Lage: `PUT /api/events/:id/participants`
(`setParticipants`, `server/src/events.ts:342`) schreibt heute alle übergebenen Personen direkt
auf `accepted` und umgeht damit den Einladungsablauf komplett. Der Endpunkt ist in `api.js:307`
zwar exponiert, wird im Frontend aber **nirgends aufgerufen**. Solange keine echten Daten
daranhängen, lässt er sich kostenlos bereinigen: entweder auf `invited` umstellen oder
ersatzlos entfernen. Danach ist die Einladung der einzige Weg in ein Event — was die
Sichtbarkeitsregel überhaupt erst konsistent macht.

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
| 3a | `?eventId=` an 12 Endpunkten validieren, implizite Defaults neutralisieren (B1) | S–M | 1 |
| 3a2 | Aktuellen Vote-/Match-/Matchmaking-/Draft-Scope bei Reads und Writes absichern (B2) | **M** | 1 |
| 3a3 | Ressourcenrouten und `votes/history/:round` gegen die geladene Zeile prüfen (B3) | M | 1 |
| 3a4 | Live-Board pro Betrachter filtern, Realtime auf gebündelten Refetch umstellen (B4) | **M** | 1 |
| 3b | Hall of Fame, Matches, Turnierliste und Abstimmungsrunde filtern | S–M | 1 |
| 4 | Realtime/Push angleichen **plus Kiosk-REST-Matrix** | S–M | 1 |
| 5 | Frontend: Sichtbarkeitsauswahl, Teaser | S | 2 |
| 6 | Negativ-Testsuite (Lesen **und** Schreiben, je Scope-Klasse), E2E, Doku | **M–L** | alle |
| — | `setParticipants` bereinigen, `public` → `group` (4.3) | XS | — |

Zwei Posten sind gegenüber der ersten Fassung entfallen: die Migration der Bestandsdaten (es
gibt keine, 4.3) und der Umbau aller Aggregate auf eine Allowlist (nicht gewollt, 2.3).

Dafür sind vier hinzugekommen — 3a2, 3a3, 3a4 und die Kiosk-REST-Matrix. Sie stammen aus dem
Review des Konzepts und korrigieren einen Strukturfehler der ersten Fassung: Diese
inventarisierte nach Query-Parameter statt nach Scope-Quelle und übersah dadurch alles, was sein
Event serverseitig auflöst oder aus einer Ressource liest. Das betrifft ausgerechnet die
schreibenden Pfade, also den einzigen Teil, bei dem ein Außenstehender nicht nur mitlesen, sondern
fremde Eventdaten **verändern** kann.

Gesamtgröße damit **mittel**, nicht mehr „klein bis mittel". Sinnvoll sind zwei bis drei PRs:
**(1+2+4+5)** liefert die sichtbare Funktion, **(3a+3a2+3a3+3b+6)** schließt die REST-Umgehungen
und sichert sie ab. **3a4** kann wegen seines abweichenden Realtime-/Tracking-Datenflusses in einen
dritten PR ausgelagert werden; bleibt der zweite PR gut reviewbar, kann es dort mitlaufen.

---

## 6. Definition of Done

- Ein nicht eingeladenes Mitglied findet ein `participants`-Event **nirgends benannt**: nicht in
  der Eventliste, keinem Auswahlfeld, keinem Hall-of-Fame-Abschnitt, keiner Match- oder
  Turnierzeile, keinem Export, keiner Suchpalette und über kein Realtime-Signal.
- Die Gesamtrangliste und alle Summen ohne Eventbezug sind **vollständig und für jedes Mitglied
  identisch** — sie werden nicht gefiltert.
- Direktzugriff auf eine bekannte Event-ID liefert `404`, nicht `403`.
- Implizite „aktuelles Event"-Reads liefern bei einem unsichtbaren Tracking-Event einen neutralen
  Zustand; insbesondere verraten weder `GET /api/events/active` noch die `isActive`-Markierung,
  dass ein fremdes Event läuft.
- Ein eingeladenes, noch nicht beigetretenes Mitglied sieht genau den Teaser und kann annehmen
  oder ablehnen — nicht mehr.
- Gruppen-Admin und Owner sehen und verwalten weiterhin alles.
- Ein Event wird ausschließlich über eine Einladung betretbar; es gibt keinen Weg mehr, jemanden
  ohne Einladung auf `accepted` zu setzen.
- **Ein Außenstehender kann fremde Eventdaten nicht verändern.** Ergebnis-Mutationen,
  Stimmabgaben, Matchkorrekturen und Draw-Moves antworten mit `404`, und der Datenbankzustand
  bleibt danach nachweislich unverändert.
- `GET /api/votes/history/:round` prüft den Eventzugriff gegen die geladene Abstimmungsrunde und
  gibt für eine fremde Runde weder Eventname noch Ergebnis aus — unabhängig davon, ob ein
  `?eventId=` fehlt oder auf einen anderen erlaubten Scope zeigt.
- Der Live-Status eines privaten Events ist für Außenstehende weder per REST noch per Socket
  sichtbar — weder das gespielte Spiel noch ein daraus abgeleiteter `playing`-Status.
- Ein Gruppen-Kiosk zeigt keine Abstimmung und kein Turnier eines `participants`-Events; ein exakt
  eventgebundenes Kiosk-Token sieht seine Daten weiterhin.
- Negativtests existieren **je Scope-Klasse** (expliziter `?eventId=`, Tracking-Event, Event aus
  der Ressource, gemischtes Live-Board) und **für Lesen wie Schreiben** — nicht nur für den
  Query-Parameter. Genau diese Verengung war der Fehler der ersten Konzeptfassung.
- `npm run lint`, `npm run build`, `npm test` und `npm run test:e2e` sind grün.
