# Konzept: Verbindlicher Event-Kontext

Stand: 2026-08-12 · Status: **auf Feature-Branch umgesetzt, technische Abnahme ausstehend**

## 1. Entscheidung und Urteil

Die Anwendung kennt fachlich keinen Raum mehr „außerhalb von Events“. Jede operative Information
und jede fachliche Aktion gehört genau zu einem Event. Das gilt insbesondere für Checklisten,
Abstimmungen, Sitzplan, Mitfahrgelegenheiten, Bestellungen, Matches, Turniere, Arcade, Tracking,
Live-Status, Durchsagen, Push-Nachrichten und Exporte.

Jede aktive Person hat deshalb immer genau ein **persönlich ausgewähltes Arbeits-Event**. Dieses
Event bestimmt, welchen Event-Arbeitsraum die normale Oberfläche gerade liest und verändert. Die
Auswahl ist persönlich; es gibt kein instanzweit „aktives Event“, das allen Personen denselben
Kontext aufzwingt.

Ein zusätzliches, dauerhaft offenes **Basis-Event** ersetzt den bisherigen Gruppenraum und den
Produktbegriff „Außerhalb von Events“. Jede aktive Person nimmt daran teil. Instanzweite Inhalte,
die alle erreichen sollen, werden diesem Basis-Event zugeordnet.

Das Zielmodell wird dadurch deutlich einfacher:

- Sichtbarkeit ergibt sich allein aus der Event-Einladung und -Teilnahme; `group` und `public`
  entfallen als fachliche Sichtbarkeitsstufen.
- Es gibt keine optionalen Event-Scopes und keine fachlichen `NULL`-Eventdaten mehr.
- Es gibt keine Auswertung über alle Events der Instanz. Persönliche Gesamtansichten aggregieren
  nur Events, an denen die betrachtende Person teilgenommen hat.
- Realtime, Push und Kiosk tragen immer einen Event-Scope.
- Überlappende Events sind unproblematisch, weil jede Person ihren Arbeitskontext selbst wählt.

**Bewertung:** Das entfernt langfristig mehr Komplexität als das bisherige Sichtbarkeitsmodell mit
Gruppenraum, Sentinel, drei Sichtbarkeitswerten und implizitem globalem Tracking-Event. Die
Umstellung ist dennoch kein kleiner Patch: Der heutige Code verwendet `NULL`,
`OUTSIDE_EVENTS_ID` und `getTrackingEventId()` an vielen Stellen. Weil bislang nur Testdaten
existieren, ist jetzt der richtige Zeitpunkt für diesen Schnitt. Realistische Größe: **mittel bis
groß, in mehreren deployment-sicheren PRs**.

---

## 2. Verbindliche Invarianten

1. Jede fachliche Datenzeile gehört zu genau einem realen Event.
2. Jede aktive Person ist mindestens im Basis-Event `accepted`.
3. Jede aktive Person hat genau ein nutzbares, angenommenes Arbeits-Event.
4. Die Wahl des Arbeits-Events ist kein Berechtigungsnachweis. Der Server prüft die Teilnahme bei
   jedem Zugriff erneut.
5. Ein normales Mitglied sieht ein Event vollständig nur, wenn seine Teilnahme angenommen wurde.
6. Eine offene Einladung macht nur einen kleinen Einladungsteaser sichtbar.
7. Ein abgelehntes oder widerrufenes Event ist nicht mehr als Arbeits-Event wählbar.
8. Normale Event-Abfragen, Push-Nachrichten, Realtime-Ereignisse und Kiosk-Daten besitzen immer
   eine konkrete `event_id`.
9. Persönliche eventübergreifende Auswertungen verwenden ausschließlich Events, an denen die
   betroffene Person nachweislich teilgenommen hat.
10. Das Basis-Event kann nicht beendet, abgesagt oder der letzten aktiven Person entzogen werden,
    solange kein anderes Basis-Event atomar an seine Stelle gesetzt wurde.

Globale technische Daten bleiben zulässig: Konto, Session, Rollen, Spielekatalog, unveränderliche
Arcade-Titeldefinitionen und administrative Konfiguration sind keine Event-Inhalte. Sobald daraus
eine nutzerbezogene Aktivität, Nachricht oder Auswertung entsteht, ist sie eventgebunden.

---

## 3. Domänenmodell

### 3.1 Das Basis-Event

Die Instanz besitzt genau ein konfiguriertes Basis-Event. Es ist ein normales Event mit den
folgenden zusätzlichen Garantien:

- dauerhaft nutzbar und ohne fachliches Enddatum,
- jede aktive Person ist `accepted`,
- Standardkontext nach Kontoaktivierung und sicherer Fallback,
- Ziel für Inhalte, die früher dem Gruppenraum oder „Außerhalb von Events“ gehörten,
- nicht stillschweigend lösch-, beend- oder absagbar.

Die Referenz wird serverseitig als `base_event_id` gespeichert. Ein Wechsel auf ein anderes
Basis-Event ist nur als atomare Admin-Aktion zulässig: neues Event validieren, fehlende aktive
Mitglieder hinzufügen, ungültige persönliche Kontexte umstellen und erst danach die Referenz
wechseln.

Das Basis-Event ist kein Sichtbarkeits-Bypass. Alle Personen sehen es, weil sie daran teilnehmen,
nicht weil es einen besonderen öffentlichen Scope besitzt.

### 3.2 Event-Teilnahme und Sichtbarkeit

`event_participants` bleibt die Quelle der Zugriffsentscheidung. Der fachliche Zustand wird wie
folgt verwendet:

| Zustand | Sichtbarkeit | Erlaubte Aktionen |
|---|---|---|
| kein Datensatz | keine | keine |
| `invited` | Einladungsteaser | annehmen oder ablehnen |
| `accepted` | vollständiger Event-Arbeitsraum | lesen, im Rahmen der normalen Rollen schreiben, als Arbeits-Event auswählen |
| `declined` | keine normale Sichtbarkeit | nur in der persönlichen Einladungshistorie sichtbar |
| `removed` | keine operative Sichtbarkeit | eigene rechtmäßig entstandene Historie bleibt in persönlichen Auswertungen erhalten |

Für eine belastbare Historie werden Annahme und Entfernung nicht mehr durch Löschen des einzigen
Datensatzes vernichtet. Mindestens `accepted_at`, `declined_at` und `removed_at` beziehungsweise
eine gleichwertige append-only Historie halten fest, ob eine Person tatsächlich teilgenommen hat.

Einladungsteaser enthalten ausschließlich:

- Event-ID, Name, Zeitraum, Ort und Beschreibung,
- eigenen Einladungsstatus,
- Aktionen zum Annehmen oder Ablehnen.

Teilnehmerlisten, fremde Einladungsstatus, Trackingzustand, interne Scope-Felder und Fachdaten sind
kein Teil des Teasers. Normale Teilnehmende sehen nur die für die Fachfunktion nötige
Teilnehmeransicht; vollständige Einladungs- und Ablehnungsstatus bleiben Admin/Owner vorbehalten.

### 3.3 Konto-Einladung

Eine Konto-Einladung ist nie eventlos. Sie trägt mindestens das Basis-Event und optional ein
zusätzliches Ziel-Event. Ein Registrierungslink für neue Personen ist standardmäßig unbegrenzt
gültig, mehrfach nutzbar und bleibt bis zum ausdrücklichen Widerruf aktiv. Claim-, Reset- und
Test-Sitzungslinks bleiben dagegen einmalig und zeitlich begrenzt. Jede Registrierung über den
Registrierungslink erfolgt in einer eigenen Transaktion:

1. Konto beanspruchen beziehungsweise aktivieren,
2. Instanzmitgliedschaft aktivieren,
3. Teilnahme am Basis-Event auf `accepted` setzen,
4. optional die Teilnahme am Ziel-Event auf `accepted` setzen; ist das Ziel-Event inzwischen
   beendet oder abgesagt, bleibt der Registrierungslink gültig und es wird nur das Basis-Event
   verwendet,
5. persönliches Arbeits-Event auf das Ziel-Event, sonst auf das Basis-Event setzen,
6. Registrierungslink weiter offen halten beziehungsweise den einmaligen Claim-Link verbrauchen.

Damit existiert auch während des Onboardings kein aktives Konto ohne Event-Kontext. Scheitert ein
Schritt außerhalb dieses erwartbaren Event-Fallbacks, wird die gesamte Transaktion zurückgerollt.

Bestehende Mitglieder erhalten weitere Events über persönliche Event-Einladungen. Erst die
Annahme macht ein solches Event als Arbeitskontext wählbar.

### 3.4 Persönliches Arbeits-Event

Pro Person speichert der Server genau eine Referenz `active_event_id` in einer eigenen kleinen
Kontexttabelle oder einer gleichwertigen Kontoeinstellung. Wählbar ist ein Event, wenn:

- die Person aktiv ist,
- ihre Teilnahme `accepted` ist,
- das Event weder abgesagt noch für operative Nutzung gesperrt ist.

Ein zukünftiges veröffentlichtes Event darf bereits gewählt werden, damit Checkliste,
Mitfahrgelegenheiten und Organisation vor dem Start funktionieren. Trackingdaten werden trotzdem
nur innerhalb des zulässigen Eventzeitraums erfasst.

Wechsel erfolgt über einen kanonischen Endpunkt, beispielsweise:

```http
PUT /api/me/active-event
Content-Type: application/json

{ "eventId": "..." }
```

Der Wechsel prüft die Teilnahme, speichert die Auswahl und sendet ein personenbezogenes
`event-context:changed`-Signal. Alle offenen Tabs und Geräte desselben Kontos wechseln damit
bewusst gemeinsam. Unterschiedliche Event-Kontexte in parallelen Tabs sind kein Ziel dieses
einfachen Modells.

Das Arbeits-Event steuert den normalen Workspace, nicht den Nachrichtenempfang: Eine Person kann
Push-Nachrichten aus allen angenommenen Events erhalten. Ein Klick auf eine Nachricht wechselt
nach erneuter Berechtigungsprüfung in deren Event und öffnet anschließend das Ziel.

Nachrichten aus unterschiedlichen Events müssen bereits vor dem Öffnen eindeutig unterscheidbar
sein. Eventname und fachlicher Nachrichtentitel werden deshalb immer gemeinsam angezeigt; Farbe
oder Icon dürfen nur ergänzen und sind kein Ersatz für den sichtbaren Text.

### 3.5 Automatischer Fallback

Wird das aktive Event beendet, abgesagt, entfernt oder verliert die Person ihre Berechtigung,
stellt der Server den persönlichen Kontext atomar auf das Basis-Event um. Dabei werden offene
Live-/Tracking-Kontexte des alten Events geschlossen und die Clients unmittelbar informiert.

Ein fehlender oder ungültiger Kontext ist kein normaler Produktzustand. Beim Login repariert der
Server ihn deterministisch auf das Basis-Event; schlägt auch das fehl, ist dies ein serverseitiger
Integritätsfehler und kein stiller Gruppenraum-Fallback.

---

## 4. Autorisierungs- und Datenvertrag

### 4.1 Zentraler Resolver

Neu beziehungsweise weiterentwickelt wird ein zentraler Resolver als einzige Wahrheit:

```ts
type EventAccessLevel = 'none' | 'teaser' | 'participant' | 'admin';

eventAccessLevel(eventId, playerId, instanceRole): EventAccessLevel
requireEventParticipation(req, res, eventId): boolean
activeEventForPlayer(playerId): EventRow
historicallyParticipatedEventIds(playerId): string[]
```

Admin/Owner dürfen Events administrativ konfigurieren und Einladungen verwalten. Ihre normale
persönliche Auswertung bleibt dennoch auf ihre eigene Teilnahmehistorie begrenzt. Administrative
Eventauswertungen sind ein ausdrücklich gekennzeichneter Adminpfad und kein stiller Rollen-Bypass
in „Meine Auswertung“.

### 4.2 Kontextgebundene Endpunkte

Checkliste, Abstimmung, Sitzplan, Mitfahrgelegenheiten, Essen, Infoboard, Matches, Turniere,
Matchmaking, Drafts, Arcade und vergleichbare Arbeitsflächen verwenden standardmäßig das
serverseitig gespeicherte Arbeits-Event.

- Ein Client darf den Eventkontext nicht nur durch einen freien Query-Parameter behaupten.
- Lädt ein Endpunkt eine Ressource per ID, muss deren `event_id` mit dem autorisierten Kontext
  übereinstimmen oder über einen ausdrücklich eventbezogenen Lesepfad autorisiert sein.
- Fehlende oder fremde Ressourcen antworten mit `404`.
- Erwartet ein technischer Endpunkt ausdrücklich eine `eventId`, ist sie verpflichtend; ein
  fehlender Wert fällt niemals auf `NULL`, `OUTSIDE_EVENTS_ID` oder ein globales Tracking-Event
  zurück.
- Schreibprüfungen und Mutation erfolgen, wo Konkurrenz relevant ist, in derselben Transaktion.

### 4.3 Eventlisten

`GET /api/events` liefert vier klar getrennte Mengen:

- `activeEvent`: das persönliche Arbeits-Event,
- `availableEvents`: angenommene und als Arbeitskontext nutzbare Events,
- `historicalEvents`: die persönliche Teilnahmehistorie einschließlich beendeter Events,
- `invitations`: offene Einladungsteaser.

Abgelehnte, entfernte und nie eingeladene Events erscheinen nicht in der normalen Liste.

`availableEvents` und `historicalEvents` beantworten zwei verschiedene Fragen und dürfen nicht
gegeneinander ausgetauscht werden. `availableEvents` beantwortet „worin kann ich gerade arbeiten“
und verliert ein Event, sobald es beendet ist; nur diese Menge speist den Event-Umschalter.
`historicalEvents` beantwortet „woran habe ich teilgenommen“, behält beendete Events und ist exakt
die Allowlist, die die Auswertungsendpunkte serverseitig akzeptieren. Eventfilter werden deshalb
immer aus `historicalEvents` gebaut — sonst könnte ein Filter genau die abgeschlossene LAN nicht
mehr benennen, für die er gedacht ist.

### 4.4 Auswertungen

Es gibt keine instanzweite oder gruppenweite All-Events-Auswertung für normale Mitglieder.

Die persönliche Gesamtansicht einer Person aggregiert ausschließlich Daten aus Events, an denen
diese Person nachweislich teilgenommen hat. Dafür wird die historische Teilnahme-Allowlist
serverseitig in jede relevante Abfrage eingebunden. Das gilt auch dann, wenn die Auswertung andere
Spieler miteinander vergleicht: Die Datenbasis sind nur Events, die der betrachtenden Person
sichtbar sind.

Beispiele:

- „Meine gesamte Spielzeit“: eigene Sessions aus den eigenen teilgenommenen Events.
- Rangliste: Ergebnisse aller Personen, aber nur aus Events, an denen der Betrachter teilgenommen
  hat.
- Hall of Fame: nur Abschnitte und Summen aus den Events des Betrachters.
- Skill-Vorschläge: abgeleitet aus denselben Matches und deshalb aus derselben Allowlist. Sie
  nennen Siege und Partien pro Person und wären ungescopt ein Bericht über fremde Events.
- Eventfilter: nur historisch oder aktuell teilgenommene Events, gebaut aus `historicalEvents`.
- Export: genau ein erlaubtes Event oder dieselbe persönliche Teilnahme-Allowlist.

Damit entfallen die bisherigen bewusst akzeptierten Rückschlüsse aus vollständigen globalen
Aggregaten. Zwei Personen können unterschiedliche Gesamtwerte sehen; die UI nennt deshalb knapp
die Datenbasis, zum Beispiel „Aus deinen 4 Events“.

### 4.5 Vollständige Endpoint-Inventur

Die Umsetzung inventarisiert Pfade nach der Quelle ihres Eventkontexts:

1. explizite `eventId` in Query, Body oder Pfad,
2. persönliches Arbeits-Event,
3. Event-ID aus einer geladenen Ressource,
4. Hintergrund-/Realtime-/Push-Zustellung,
5. gemischte oder eventübergreifende Auswertung.

Die Inventur umfasst ausdrücklich auch Arcade. Insbesondere Galerie, Result-/History-Listen,
Result-Details, Stats, Lobbys und laufende Matches dürfen weder Inhalte noch IDs fremder Events
liefern. Dass ein Endpunkt optional korrekt guardet, reicht nicht, wenn sein ungefilterter Pfad
weiterhin alle Events liest.

---

## 5. Tracking, Live, Realtime, Push und Kiosk

### 5.1 Tracking und Live-Status

Der Agent authentifiziert das Konto und ordnet neue Aktivität ausschließlich dem persönlichen
Arbeits-Event zu. Erfassung findet nur statt, wenn:

- die Person dort `accepted` ist,
- das Event Tracking zulässt,
- der Zeitpunkt innerhalb des Eventzeitraums liegt,
- die persönliche Event-Einwilligung aktiv ist,
- kein globaler persönlicher Tracking-Notschalter gesetzt ist.

Außerhalb dieser Bedingungen bleibt der Report ein technischer Heartbeat. Es entsteht keine
ersatzweise globale oder eventlose Aktivität.

Ein Eventwechsel schließt den bisherigen Live-Kontext idempotent, bevor ein neuer geöffnet wird.
Das Live-Board liest nur das ausgewählte Event des Betrachters. Es mischt keine Gruppenraum- und
Eventkontexte mehr.

### 5.2 Realtime

Fachliche Realtime-Nachrichten tragen immer `eventId`. Ein normaler Browser abonniert den Room
seines Arbeits-Events; beim Wechsel verlässt er den alten Room und tritt nach erneuter Prüfung dem
neuen bei. Personenbezogene Einladungs- und Kontextsignale dürfen über einen privaten User-/Session-
Kanal laufen, enthalten aber keine fremden Eventdaten.

Payloadlose Invalidierungssignale sind zulässig, wenn der anschließende REST-Refetch denselben
Eventguard verwendet. Ein instanzweiter Broadcast mit fachlichem Payload ist nicht zulässig.

### 5.3 Push

Jede Push-Nachricht besitzt eine konkrete `event_id`. Empfänger werden bei jedem Versand aus
angenommener Eventteilnahme, Kontostatus und eventbezogenen Push-Einstellungen berechnet. Die
aktuelle Workspace-Auswahl beschränkt den Empfang nicht.

Instanzweite Hinweise werden über das Basis-Event versendet. Einladungspushes sind
personenbezogen und enthalten nur den Teaser. Ein Klick auf Event-Push wechselt den Workspace
erst nach erfolgreicher Zugriffsprüfung.

Für Darstellung und Speicherung gilt ein verbindlicher Event-Herkunftsvertrag:

- Betriebssystem-Push, In-App-Banner und Nachrichtenzentrale zeigen den Eventnamen als sichtbare
  Textzeile beziehungsweise Präfix, zum Beispiel „Sommer-LAN · Abstimmung gestartet“.
- Payload und gespeicherter Eintrag tragen mindestens `eventId`, einen Eventnamen-Snapshot,
  Nachrichtentyp, Ziel und Erstellungszeitpunkt.
- Notification-`tag`, Deduplizierungs-, Topic- und Ersetzungsschlüssel enthalten `eventId`.
  Gleichartige Nachrichten aus zwei Events dürfen einander weder überschreiben noch als gelesen
  markieren.
- Nachrichtenzentrale, Ungelesen-Zähler, „alle gelesen“ und Ausblenden arbeiten eventgescoped und
  bieten mindestens einen Filter nach Event. Eine zusammengefasste Ansicht kennzeichnet jede Zeile
  weiterhin sichtbar mit ihrem Event.
- Stummschaltung bleibt pro Event möglich; zusätzlich kann es einen kontoweiten Push-Notschalter
  geben.
- Beim Öffnen wird `eventId` serverseitig erneut autorisiert. Ist der Zugriff inzwischen entfallen,
  werden weder Eventname noch Zielinhalt nachgeladen; die UI erklärt neutral, dass die Nachricht
  nicht mehr verfügbar ist.
- Event-Umbenennungen ändern ältere Notification-Snapshots nicht rückwirkend. Nach dem Öffnen zeigt
  der Workspace den aktuellen Eventnamen.

### 5.4 Kiosk

Jeder Kiosk-Token gehört genau zu einem Event. Gruppen- oder instanzweite Kiosk-Tokens entfallen.
Der Token ist read-only, widerrufbar und rotierbar. REST und Realtime prüfen beide exakt dieselbe
Eventbindung; ein Kiosk kann weder auf das persönliche Arbeits-Event eines Nutzers noch auf ein
globales Tracking-Event zurückfallen.

---

## 6. Auswirkungen auf den heutigen Code

Das Zielmodell entfernt fachliche Sonderfälle, muss aber folgende bestehende Mechanismen ablösen:

- `OUTSIDE_EVENTS_ID` als sichtbarer oder schreibbarer Ersatzkontext,
- `NULL event_id` als Gruppenraum in fachlichen Tabellen,
- `getTrackingEventId()` und andere instanzweit implizite Defaults,
- `visibility_scope = group|participants|public`,
- ungefilterte Eventlisten und clientseitige Einladungsfilterung,
- globale All-Events-Aggregate,
- Gruppen-Kiosk ohne Eventbindung,
- Realtime-Signale mit fachlichem Payload nur auf `{ groupId }`,
- Ressourcenrouten, die nur `group_id`, aber nicht die zugehörige Eventteilnahme prüfen.

Die internen Tabellen `groups`, `group_memberships` und `group_id` bleiben für Rollen und die
risikoarme Ein-Gruppen-Migration bestehen. Sie sind weiterhin kein sichtbares Bedienkonzept.

Weil nur Testdaten existieren, werden vorhandene Testinhalte entweder dem neuen Basis-Event
zugeordnet oder regeneriert. Eine Kompatibilitätsmigration für echte historische Eventdaten ist
nicht erforderlich. Schema-Nullability und der alte Sentinel dürfen zunächst als technische
Legacy-Struktur bestehen bleiben, solange API, Services und Tests keine neuen eventlosen Daten
mehr erzeugen. Ein späterer Tabellen-Rebuild ist optionale Härtung, keine Voraussetzung für die
fachliche Umstellung.

---

## 7. Umsetzung im gemeinsamen Feature-Branch

Die vollständige Umstellung wird vor dem Livegang gemeinsam auf einem Feature-Branch umgesetzt und
getestet. Die folgenden Blöcke bleiben als technische Prüfpunkte erhalten, werden aber in einem
Draft-PR zusammengeführt. Die Sicherheitsgrenze darf nicht zuerst in der UI versprochen und erst in
einem späteren Stand im Backend geschlossen werden.

### Block 1 — Fundament ohne sichtbare Aktivierung

- Basis-Event und `base_event_id` anlegen,
- alle aktiven Konten dem Basis-Event zuordnen,
- persönlichen Eventkontext speichern und reparieren,
- zentralen Resolver und Teilnahmehistorie ergänzen,
- Konto-Einladung atomar mit Eventteilnahme verbinden,
- Vertrags- und Migrationstests hinzufügen.

Dieser Block kann bestehendes UI-Verhalten kompatibel halten, darf aber keine unvollständige
Privatsphäre-Zusage anzeigen.

### Block 2 — Serverseitige Eventgrenze vollständig schließen

- alle fünf Scope-Quellen aus Abschnitt 4.5 inventarisieren und guard-en,
- jede fachliche Neuschreibung an ein reales Event binden,
- Ressourcen-Reads und -Writes gegen ihr gespeichertes Event prüfen,
- persönliche All-Events-Auswertungen auf die Teilnahme-Allowlist umstellen,
- Live, Realtime, Push und Kiosk vollständig eventbinden,
- Arcade-Galerie, Results, History, Details, Stats und Lobbys einschließen,
- Negativtests je Scope-Quelle und für Lesen wie Schreiben ergänzen.

Am Ende dieses Blocks ist die Backend-Grenze vollständig, auch wenn die Oberfläche den neuen Wechsel
noch nicht anbietet.

### Block 3 — Event-Wechsel und sichtbares Produktmodell

- global erreichbaren Event-Umschalter ergänzen,
- Arbeits-Event in Kopfzeile und Seitentiteln eindeutig anzeigen,
- offene Einladungen als Teaser darstellen,
- Push-Deep-Links mit geprüftem Kontextwechsel umsetzen,
- Eventfilter und persönliche Auswertungsbasis erklären,
- alle bisherigen „Gruppenraum“-/„Außerhalb von Events“-Texte entfernen,
- Adminoberfläche für Basis-Event und gekoppelte Konto-Einladungen ergänzen.

### Block 4 — Aufräumen und optionale Schemahärtung

- nicht mehr verwendete `group`-/`public`-API-Werte entfernen,
- ungenutzte Bulk-Pfade wie direktes Setzen von `accepted` entfernen oder auf echte Einladungen
  umstellen,
- globale Tracking-Defaults und Sentinel-Aufrufer löschen,
- sofern der Nutzen den SQLite-Migrationsaufwand rechtfertigt, `event_id NOT NULL` tabellenweise
  physisch erzwingen,
- Betriebs- und Zielkonzepte synchronisieren.

Der gemeinsame Branch wird erst nach vollständigen Unit-, Required-, Integrations- und E2E-Tests
als Draft-PR zur Abnahme bereitgestellt. Der formale Review erfolgt einmal auf dem finalen grünen
und konfliktfreien Head-SHA; neue Commits danach erfordern erneut CI und Review. Ein Merge oder
Livegang erfolgt ausschließlich nach der Abnahme. Block 4 darf keine Voraussetzung für die
fachliche Sicherheitsgrenze sein.

---

## 8. Teststrategie

Eine Required-Suite prüft mindestens:

- Konto-Claim erzeugt atomar Basis- und optionale Zielteilnahme plus gültigen Kontext.
- Ein aktives Konto kann nie ohne Basis-Teilnahme und Arbeits-Event bestehen.
- Nur `accepted` ist als Arbeits-Event wählbar; fremde IDs ergeben `404`.
- Eventwechsel aktualisiert REST, Socket-Rooms, offene Tabs und Agent-Kontext konsistent.
- Beenden, Absagen, Entfernen und Kontodeaktivierung schließen Livezustand und fallen sicher auf
  das Basis-Event zurück.
- Offene Einladung zeigt nur den Teaser; Ablehnung entfernt sie aus der normalen Eventliste.
- Jede fachliche Mutation speichert die erwartete konkrete `event_id`.
- Es entstehen keine neuen fachlichen `NULL`- oder Sentinel-Datensätze.
- Persönliche Gesamtstatistik enthält alle eigenen teilgenommenen Events und kein fremdes Event.
- Zwei Personen mit unterschiedlicher Teilnahme sehen entsprechend unterschiedliche Ranglisten,
  Hall-of-Fame-Blöcke und Eventfilter.
- Direktzugriffe auf fremde Ressourcen und bekannte IDs liefern `404` und verändern nichts.
- Arcade-Galerie, Results, History und Result-Details geben keine fremden Inhalte aus.
- Push erreicht angenommene Teilnehmende unabhängig von deren aktuellem Arbeits-Event, aber keine
  Außenstehenden.
- Zwei gleichartige Push-Nachrichten aus unterschiedlichen Events bleiben getrennt, zeigen jeweils
  ihren Eventnamen und öffnen nach Prüfung den richtigen Eventkontext.
- Eventfilter, Ungelesen-Zähler, Mutes, Deduplizierung und „gelesen/ausgeblendet“ verändern niemals
  versehentlich den Zustand eines anderen Events.
- Jeder Kiosk sieht ausschließlich sein fest gebundenes Event.
- Gemischte Live-Daten aus zwei persönlichen Eventkontexten werden pro Betrachter korrekt getrennt.

E2E verwendet mindestens zwei normale Konten, zwei private Events plus Basis-Event und zwei
Browserkontexte. Neben der Sichtbarkeit wird der Wechsel während Checkliste, Abstimmung,
Mitfahrgelegenheit und Push-Deep-Link geprüft.

---

## 9. Definition of Done

- Jede aktive Person nimmt am Basis-Event teil und besitzt immer ein gültiges Arbeits-Event.
- Konto- und Eventeinladung sind atomar gekoppelt; ein eventlos aktiviertes Konto ist unmöglich.
- Jede normale Fachseite zeigt klar, in welchem Event sie arbeitet, und verwendet genau diesen
  Scope für Lesen und Schreiben.
- Ein Eventwechsel ist zentral erreichbar, serverseitig validiert und auf allen Geräten des Kontos
  konsistent.
- Nicht eingeladene Personen finden ein Event weder in Listen, Daten, Statistiken, Suche, Export,
  REST, Realtime noch Push.
- Eingeladene Personen sehen nur den Teaser; angenommene Personen den Arbeitsraum.
- Es gibt keine normale instanzweite All-Events-Auswertung. Persönliche Gesamtansichten verwenden
  ausschließlich die eigene Teilnahmehistorie.
- Jede fachliche Push-, Realtime- und Kiosk-Nachricht ist konkret eventgebunden.
- Push-Nachrichten nennen ihr Event sichtbar und bleiben bei Gruppierung, Deduplizierung,
  Gelesen-Status, Filtern und Stummschaltung zwischen Events getrennt.
- Neue fachliche Daten werden nie mit `NULL`, Gruppenraum- oder Sentinel-Scope angelegt.
- Direkte Ressourcen-IDs umgehen die Eventprüfung nicht; abgewiesene Schreibzugriffe lassen die
  Datenbank unverändert.
- Live-Status und Tracking wechseln sauber mit dem persönlichen Eventkontext und erzeugen außerhalb
  des zulässigen Zeitraums nur einen technischen Heartbeat.
- Required-, Unit- und E2E-Tests decken jede Scope-Quelle sowie Fallback- und Konkurrenzpfade ab.
- `KONZEPT-USER-MANAGEMENT.md`, Betriebsdokumentation und sichtbare UI-Texte beschreiben dasselbe
  Modell.
