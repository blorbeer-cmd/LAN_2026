# Konzept: Einladungs- und Zusage-Workflow

Stand: August 2026 · Status: **Entwurf** (Rev. 1 – noch nicht umgesetzt)

Dieses Dokument beschreibt, wie aus der heutigen einmaligen Ja/Nein-Frage eine dauerhaft änderbare
Teilnahme-Antwort wird: mit „unter Vorbehalt“ als drittem Zustand, mit einem festen Ort, an dem die
eigene Antwort jederzeit auffindbar ist, und mit einer Absage, die die Person nicht aus dem Event
aussperrt.

Ergänzt [`KONZEPT-EVENT-SICHTBARKEIT.md`](KONZEPT-EVENT-SICHTBARKEIT.md) (Abschnitt 3.2 legt die
Teilnahmezustände fest) und berührt die Terminabstimmung aus
[`plans/event-date-poll-concept.md`](plans/event-date-poll-concept.md) nur an einer Stelle
(Abschnitt 5.4).

---

## 1. Ausgangslage (Ist-Zustand)

### 1.1 Die zwei Einladungswege

1. **Einladung an ein bestehendes Konto** – `POST /api/events/:id/invitations`
   ([`server/src/routes/events.ts`](../server/src/routes/events.ts)). Legt eine Zeile in
   `event_participants` mit `status = 'invited'` an und schickt genau **eine** Push-Nachricht mit
   dem Topic-Key `eventInvitationTopicKey(eventId, playerId)` und dem Ziel `/#profile`.
2. **Einladungslink zum Tool inklusive Event** – ein `register`-Invite mit `event_id`
   ([`server/src/invites.ts`](../server/src/invites.ts), Einlösung in
   [`server/src/routes/auth.ts`](../server/src/routes/auth.ts)). Die Registrierung ruft
   `ensureAccountEventContext(...)` auf, das die Person über `acceptEventParticipation` sofort auf
   `accepted` setzt. Hier gibt es **keine** Einladungsfrage: Wer den Link einlöst, ist zugesagt.

### 1.2 Wie heute geantwortet wird

- Die Einladungskarte lebt in **Mein Profil → „Einladungen“** (`renderInvitationCard` in
  [`server/public/js/views/events.js`](../server/public/js/views/events.js), eingebunden in
  [`server/public/js/views/profile.js`](../server/public/js/views/profile.js)). Sie bietet genau
  zwei Knöpfe: **Annehmen** und **Ablehnen**.
- Zusätzlich erscheint ein Hinweis in der Home-Liste „Aktuell“
  ([`server/public/js/aktuellStatus.js`](../server/public/js/aktuellStatus.js)) mit dem Text
  „Annehmen oder ablehnen im Profil“.
- Serverseitig antworten `POST /api/events/:id/invitation/accept` und `.../decline` über
  `respondToEventInvitation` ([`server/src/events.ts`](../server/src/events.ts)).

### 1.3 Was daran hakt

Die drei gemeldeten Lücken, jeweils mit ihrer technischen Ursache:

- **Keine Absage im Nachgang.** `respondToEventInvitation` verriegelt die Antwort, sobald
  `confirmed_schedule_revision` der aktuellen `schedule_revision` entspricht. Ein Wechsel von
  `accepted` auf `declined` endet mit `409 „Die Einladung ist nicht mehr offen.“` Sich selbst
  austragen kann ebenfalls niemand: `DELETE /api/events/:id/participants/:playerId` verlangt
  `requireGroupRole('admin')`. Wer nach der Zusage doch nicht kann, muss die Orga persönlich
  anschreiben – das System weiß davon nichts.
- **Kein „unter Vorbehalt“.** `event_participants.status` kennt nur
  `invited | accepted | declined` (CHECK-Constraint in [`server/src/db.ts`](../server/src/db.ts)).
  Wer noch nicht sicher weiß, ob er kann, muss zwischen einer unehrlichen Zusage und einer zu
  harten Absage wählen. In der Praxis wird dann gar nicht geantwortet – und der Orga fehlt die
  Zahl komplett.
- **Antwort weggeklickt = weg.** Die Push-Nachricht wird genau einmal zugestellt; wird sie
  weggewischt, kommt keine zweite. Die Karte selbst bleibt zwar in „Mein Profil“ stehen, aber
  dieser Ort liegt zwei Ebenen tief (Mehr → Mein Profil) und heißt nirgends „hier antwortest du“.
  Auf dem Events-Tab, wo die Person das Event vermutet, ist eine offene Einladung bewusst gar
  nicht sichtbar. Nach einer Absage verschwindet auch die Karte: `eventAccessLevel`
  ([`server/src/eventContext.ts`](../server/src/eventContext.ts)) liefert für `declined` den Wert
  `'none'`, `GET /api/events/:id` antwortet mit 404, und die Einladungsliste in `GET /api/events`
  filtert auf `ep.status = 'invited'`. Danach gibt es keinerlei Zugriff mehr auf das Event – auch
  nicht, um es sich anders zu überlegen. Nur die Orga kann über „Erneut einladen“ eine neue Runde
  eröffnen.

Zusammengefasst: Der Workflow behandelt die Einladung als **einmaliges Ereignis mit einer
endgültigen Antwort**. Für eine dreitägige LAN, die Monate im Voraus geplant wird, ist die
Teilnahme aber ein **Zustand, der sich ändert**.

---

## 2. Zielbild und Leitentscheidungen

> Jede eingeladene Person hat zu jedem Zeitpunkt genau eine sichtbare, änderbare Antwort auf die
> Frage „Bist du dabei?“ – und findet sie immer am selben Ort.

Fünf Leitentscheidungen, aus denen sich der Rest ergibt:

1. **Antwort statt Einladung.** Die fachliche Einheit ist die eigene Teilnahme-Antwort, nicht die
   verschickte Einladung. Sie ist bis zur Antwortfrist frei änderbar, in beide Richtungen.
2. **Drei Antworten: Zusage, Vorbehalt, Absage.** „Unter Vorbehalt“ ist eine vollwertige, sichtbare
   Antwort und kein halb ausgefüllter Zustand.
3. **Vorbehalt ist ein Ja mit Sternchen, kein halbes Nein.** Wer unter Vorbehalt zusagt, sieht das
   Event vollständig und kann mitplanen. Er zählt in der Orga-Übersicht getrennt und nicht in die
   verbindlichen Zahlen (Kosten, Zahlungen, Sitzplan).
4. **Eine Absage ist keine Ausladung.** Nach einer Absage bleibt der Einladungsteaser sichtbar,
   inklusive Knopf „Doch zusagen“. Nur die Orga kann jemanden per „Einladung zurückziehen“
   endgültig entfernen.
5. **Ein Ort für die Antwort.** Der Antwortblock „Meine Teilnahme“ hängt an der Event-Karte selbst
   und sieht überall gleich aus – im Profil, auf dem Events-Tab und aus jeder Benachrichtigung
   heraus verlinkt.

Nicht-Ziele: keine Warteliste, keine Begleitpersonen („+1“), keine Teilnahme ohne Konto, keine
Änderung an der Terminabstimmung.

---

## 3. Domänenmodell

### 3.1 Antwortzustände

Der Wertebereich von `status` bleibt **unverändert** (`invited | accepted | declined`). Der
Vorbehalt kommt als eigene Spalte dazu, nicht als vierter Status. Das ist die entscheidende
Sparmaßnahme dieses Konzepts: `ACCEPTED_EVENT_PARTICIPANT_SQL`
([`server/src/eventParticipation.ts`](../server/src/eventParticipation.ts)) ist die zentrale
Zugriffsbedingung und wird von Arbeitsraum, Live-Status, Realtime, Kiosk, Push-Empfängern,
Auswertungen und Turnieren geteilt. Ein vierter Statuswert zwingt jede dieser Abfragen zu einer
eigenen Entscheidung; eine Zusatzspalte lässt sie alle unangetastet.

| Antwort | `status` | `commitment` | Sichtbarkeit | Zählt verbindlich |
|---|---|---|---|---|
| Offen | `invited` | `NULL` | Einladungsteaser | nein |
| Zusage | `accepted` | `firm` | voller Arbeitsraum | ja |
| Unter Vorbehalt | `accepted` | `tentative` | voller Arbeitsraum | nein |
| Absage | `declined` | `NULL` | Einladungsteaser (neu) | nein |
| Zurückgezogen (Orga) | kein Datensatz | – | keine | nein |

Neue Spalten auf `event_participants`:

| Spalte | Typ | Bedeutung |
|---|---|---|
| `commitment` | `TEXT NULL CHECK (commitment IN ('firm','tentative'))` | nur bei `status = 'accepted'` gesetzt |
| `answered_at` | `INTEGER NULL` | Zeitpunkt der letzten eigenen Antwort |
| `answer_note` | `TEXT NULL` | freie Kurznotiz zur Antwort, höchstens 280 Zeichen |
| `answer_count` | `INTEGER NOT NULL DEFAULT 0` | Zahl der Antwortwechsel, für den Orga-Hinweis „mehrfach geändert“ |

Neue Spalte auf `events`:

| Spalte | Typ | Bedeutung |
|---|---|---|
| `response_deadline` | `INTEGER NULL` | Antwortfrist; danach ist die Selbstbedienung eingeschränkt (Abschnitt 3.3) |

Invariante 2 aus `KONZEPT-EVENT-SICHTBARKEIT.md` bleibt gewahrt: Im Basis-Event sind alle aktiven
Konten `accepted`/`firm`, Antworten sind dort weiterhin nicht möglich (der bestehende 409-Pfad
bleibt).

### 3.2 Erlaubte Übergänge

Aus Sicht der eingeladenen Person:

| von → nach | Zusage | Vorbehalt | Absage |
|---|---|---|---|
| Offen | ja | ja | ja |
| Zusage | idempotent | ja | ja (Regeln 3.3) |
| Vorbehalt | ja | idempotent | ja |
| Absage | ja | ja | idempotent |

Jeder Wechsel setzt `answered_at`, erhöht `answer_count`, stempelt `confirmed_schedule_revision`
auf die aktuelle `schedule_revision` und schreibt einen Admin-Audit-Eintrag. Die bestehende
Tabelle `event_participation_history` führt `accepted_at`/`declined_at` unverändert weiter: Ein
einmal erreichter Zusage-Zeitstempel bleibt für persönliche Auswertungen erhalten, auch wenn
später abgesagt wird.

Aus Sicht der Orga bleibt alles wie heute, mit einer Klarstellung in der Sprache:
**„Einladung zurückziehen“** (Datensatz löschen, Zugriff endet) ist etwas anderes als die
**Absage** der Person (Datensatz bleibt, Teaser bleibt).

### 3.3 Antwortfrist und Sperren

Selbstbedienung ist der Normalfall. Sie wird nur in klar begründeten Fällen zugunsten des
Hinweises „Bitte melde dich bei der Orga“ geschlossen:

| Situation | Selbst änderbar | Begründung |
|---|---|---|
| Vor `response_deadline` oder ohne Frist | ja | Regelfall |
| Nach `response_deadline` | Zusage → Vorbehalt/Absage nur mit Warnhinweis; Absage → Zusage, solange die Orga das Event nicht geschlossen hat | Planungssicherheit ohne Bevormundung |
| Zahlung erfasst (`paid = 1`) | nein | spiegelt die bestehende Sperre beim Entfernen; Geld zurück ist eine Orga-Entscheidung |
| Event läuft oder ist beendet | nein | die Teilnahme ist Tatsache, keine Absicht mehr |
| Event abgesagt (`status = 'cancelled'`) | nein | es gibt nichts mehr zu beantworten |

Die Frist ist optional. Ohne gepflegte Frist gilt der Beginn des Events als natürliche Grenze.

### 3.4 Der Einladungslink bleibt eine Zusage

Wer einen Einladungslink mit Event einlöst, ist danach wie heute `accepted`/`firm` – der
Arbeitskontext braucht eine angenommene Teilnahme, und die Registrierung über einen Eventlink
**ist** die Zusage. Neu ist nur: Direkt nach dem ersten Login zeigt die Event-Karte einen
einmaligen Hinweis „Du bist als Teilnehmer eingetragen“ mit demselben Antwortblock. Damit gilt
Leitentscheidung 1 auch für diesen Weg, ohne den Registrierungsfluss zu verkomplizieren.

---

## 4. Bedienung

### 4.1 Der Antwortblock „Meine Teilnahme“

Ein einziges Bauteil, gerendert in `views/events.js` und von allen Orten wiederverwendet:

- Drei Auswahlknöpfe in fester Reihenfolge: **Zusagen · Unter Vorbehalt · Absagen**. Die aktuelle
  Antwort ist als gedrückter Zustand markiert (`aria-pressed`), nicht nur farblich.
- Darunter eine Zeile Klartext, was der Zustand bedeutet, zum Beispiel: „Unter Vorbehalt – du
  zählst noch nicht in den Kosten, wir fragen 14 Tage vorher noch einmal nach.“
- Optionales Notizfeld „Kurz dazusagen (optional)“, 280 Zeichen, sichtbar in der Orga-Übersicht und
  auf der Teilnehmerliste. Vor der HTML-Ausgabe escapen.
- Bei **Absagen** öffnet die Bestätigung den bereits vorhandenen Ausreden-Generator
  ([`server/public/js/eventExcuses.js`](../server/public/js/eventExcuses.js)); „Als Notiz
  übernehmen“ füllt `answer_note`. Das ist Spaß mit Nutzen: Die Orga bekommt überhaupt eine
  Rückmeldung.
- Ist die Selbstbedienung gesperrt (Abschnitt 3.3), stehen die Knöpfe deaktiviert mit dem Grund
  darunter und einem Weg zur Orga.

### 4.2 Wo der Block auftaucht

| Ort | Heute | Künftig |
|---|---|---|
| Mein Profil → „Einladungen“ | Karte mit Annehmen/Ablehnen | Abschnitt heißt **„Meine Einladungen & Zusagen“** und listet offene Einladungen, Vorbehalte und Absagen mit Antwortblock |
| Orga → Events (eigene Event-Karte) | kein Antwortelement | Antwortblock als fester Teil jeder Event-Karte, auch nach der Zusage |
| Home → „Aktuell“ | Hinweis „Annehmen oder ablehnen im Profil“ | Hinweis bleibt, solange die Antwort offen ist; bei Vorbehalt erscheint er erneut ab 14 Tagen vor Beginn |
| Benachrichtigungszentrale | Eintrag mit Deep-Link `/#profile` | Deep-Link auf das Event mit geöffnetem Antwortblock |

Der Events-Tab zeigt eingeladene und abgesagte Events künftig als eigene, klar abgesetzte
Teaser-Karten. Die ursprüngliche Begründung, offene Einladungen dort herauszuhalten – sie gingen
zwischen den Arbeitsraum-Karten unter –, bleibt gültig; deshalb eigene Sektionen „Einladungen“ und
„Abgesagt“ statt Vermischung.

### 4.3 Orga-Sicht

Die Teilnehmerverwaltung in [`server/public/js/views/events.js`](../server/public/js/views/events.js)
bekommt vier Gruppen statt einer gemischten Liste: **Zugesagt · Unter Vorbehalt · Offen ·
Abgesagt**, jeweils mit Anzahl, Notiz und Antwortzeitpunkt. Die Kostenübersicht formuliert
entsprechend: „8 Zusagen · 2 unter Vorbehalt · 47 € offen“. Verbindliche Zahlen (Kosten je Person,
Zahlungserinnerungen, Sitzplan) rechnen ausschließlich mit `firm`.

Zusätzlich:

- Eine **späte Absage** – nach `response_deadline` oder innerhalb von 14 Tagen vor Beginn – löst
  eine Push-Nachricht an Owner und Admins aus. Alle anderen Antwortwechsel bleiben still.
- „Erneut einladen“ bleibt für zurückgezogene Personen. Für Abgesagte heißt der Knopf
  **„Nachfragen“** und schickt eine erneute Einladungs-Push ohne Statusänderung.

---

## 5. Technischer Vertrag

### 5.1 API

Neuer, einziger Schreibpfad:

```
PUT /api/events/:id/participation
Body: { "response": "accepted" | "tentative" | "declined", "note": string | null }
```

- Validierung: `response` aus der Allow-List, `note` optional, String, nach `trim` höchstens 280
  Zeichen, leerer String wird zu `NULL`.
- Idempotent: identische Antwort ohne Notizänderung liefert `200` mit `changed: false`.
- Ein Antwortwechsel liefert `200` mit dem neuen Zustand. Gesperrte Fälle aus Abschnitt 3.3 liefern
  `409` mit maschinenlesbarem `reason` (`response_locked_paid`, `response_locked_started`,
  `response_locked_cancelled`, `response_locked_deadline`).
- Kein Teilnahmedatensatz vorhanden → `404`; das verhindert die Selbsteinladung.
- `POST .../invitation/accept` und `.../invitation/decline` bleiben als dünne Aliasse für ältere
  Clients und rufen denselben Kern auf.

`GET /api/events` liefert je Event einen `myParticipation`-Block mit `status`, `commitment`,
`note`, `answeredAt`, `canChange` und `lockReason` und listet abgesagte Events in einer eigenen
Sammlung `declinedEvents` im Teaser-Umfang. `GET /api/events/:id` gibt für `declined` denselben
Teaser zurück wie für `invited`, statt 404.

### 5.2 Sichtbarkeit

`eventAccessLevel` ändert sich an genau einer Stelle:

```
if (participation?.status === 'declined') return 'teaser';   // vorher: 'none'
```

Damit erfüllt der Code die in `KONZEPT-EVENT-SICHTBARKEIT.md` Abschnitt 3.2 bereits beschriebene
Zeile „nur in der persönlichen Einladungshistorie sichtbar“. Alles Weitere bleibt: `teaser` gibt
ausschließlich Name, Zeitraum, Ort, Beschreibung, Kostenangabe und den eigenen Status heraus –
keine Teilnehmerlisten, keine Fachdaten. Invariante 7 (ein abgelehntes Event ist nicht als
Arbeits-Event wählbar) bleibt unangetastet, weil `setActiveEventForPlayer` weiterhin gegen
`ACCEPTED_EVENT_PARTICIPANT_SQL` prüft.

`ACCEPTED_EVENT_PARTICIPANT_SQL` selbst wird **nicht** geändert. Wo verbindlich gezählt wird, kommt
eine zweite, ebenso zentrale Konstante dazu:

```
export const FIRM_EVENT_PARTICIPANT_SQL = "ep.status = 'accepted' AND ep.commitment = 'firm'";
```

Sie gilt für Kostenaufteilung, Zahlungserinnerungen und Sitzplan. Push-Empfänger, Realtime,
Live-Status und Arbeitsraum bleiben bei `ACCEPTED_EVENT_PARTICIPANT_SQL` – wer unter Vorbehalt
dabei ist, soll mitreden können.

### 5.3 Benachrichtigungen

| Anlass | Zeitpunkt | Topic-Key |
|---|---|---|
| Einladung | sofort | `event-invitation:<eventId>:<playerId>` (bestehend) |
| Erinnerung an offene Antwort | 3 Tage nach der Einladung, danach alle 7 Tage, letztmalig 48 h vor `response_deadline` | `event-invitation-reminder:<eventId>:<playerId>:<n>` |
| Vorbehalt-Nachfrage | 14 Tage vor `starts_at`, einmalig | `event-tentative-followup:<eventId>:<playerId>:<scheduleKey>` |
| Späte Absage an die Orga | sofort | `event-late-decline:<eventId>:<playerId>` |

Umgesetzt als Sweep im Muster von [`server/src/eventReminders.ts`](../server/src/eventReminders.ts):
30-Minuten-Intervall, Topic-Auflösung über `resolvePushTopic`, Abbruch bei beendetem oder
abgesagtem Event. Jede Antwort löst offene Erinnerungs-Topics derselben Person auf. Höchstens eine
Erinnerung je Person, Event und Fälligkeit; die Sweeps sind idempotent, ein Neustart wiederholt
nichts.

Damit ist die dritte Lücke aus Abschnitt 1.3 geschlossen: Wer die Push wegwischt, bekommt sie
erneut, findet den Eintrag weiterhin in der Benachrichtigungszentrale, sieht ihn in „Aktuell“ und
kann jederzeit über die Event-Karte antworten.

### 5.4 Zusammenspiel mit der Terminabstimmung

Unverändert gilt: Eine Abstimmung entwertet keine Zusage. Nach einer Terminverschiebung – die
`schedule_revision` steigt – bleibt die letzte Antwort stehen, wird in der Oberfläche aber als
„Zusage zum alten Termin“ markiert und aktiv zur Bestätigung angeboten. Da Antworten künftig
ohnehin änderbar sind, entfällt die bisherige Sonderlogik, die eine Antwort nur bei
Revisionswechsel wieder öffnete; `confirmed_schedule_revision` bleibt als Anzeigewert erhalten.

---

## 6. Migration

1. Schema-Migration: neue Spalten anlegen, `commitment = 'firm'` für alle bestehenden
   `accepted`-Zeilen setzen, `answered_at` aus `event_participation_history` nachziehen
   (`accepted_at`/`declined_at`), `answer_count` für bereits beantwortete Zeilen auf `1` setzen.
2. CHECK-Constraint ergänzen: `commitment IS NULL OR status = 'accepted'`.
3. `response_deadline` bleibt für Bestandsevents `NULL`; rückwirkend ändert sich kein Verhalten.
4. Keine Datenlöschung, keine Umbenennung bestehender Statuswerte. Ältere Clients funktionieren
   über die beibehaltenen Alias-Routen weiter.

---

## 7. Teststrategie

Serverseitig (`server/src/events.test.ts` beziehungsweise eine neue `eventParticipation.test.ts`):

- Happy Path je Antwort und je Übergang aus Tabelle 3.2, inklusive Idempotenz.
- Jede Sperre aus Abschnitt 3.3 mit ihrem `reason`, insbesondere `paid = 1` und laufendes Event.
- `declined` sieht den Teaser, aber keine Teilnehmerliste und keine Fachdaten, und kann das Event
  nicht als Arbeits-Event wählen.
- Vorbehalt: erscheint im Arbeitsraum und bei den Push-Empfängern, fehlt in Kostenaufteilung,
  Zahlungserinnerung und Sitzplan.
- Nebenläufigkeit: Zwei gleichzeitige Antworten führen zu genau einem Endzustand und zu einem
  Audit-Eintrag je tatsächlicher Änderung.
- Sweeps: Fälligkeit, Einmaligkeit je Topic, Auflösung nach der Antwort, kein Versand für beendete
  oder abgesagte Events.
- Notiz: Längenprüfung, Trim, leerer String wird `NULL`, HTML im Text bleibt escaped.

Frontend (`server/public/js/events.test.js`):

- Der Antwortblock rendert den aktuellen Zustand und gegebenenfalls die Sperrbegründung.
- Der Absage-Dialog übernimmt eine generierte Ausrede in die Notiz.
- Das Profil listet offene, vorbehaltliche und abgesagte Events in den richtigen Sektionen.

---

## 8. Umsetzung in Blöcken

Jeder Block ist für sich lauffähig und einzeln reviewbar.

| Block | Inhalt | Für Nutzer sichtbar |
|---|---|---|
| 1 | Schema, Migration, `PUT .../participation`, Alias-Routen, Tests | nein |
| 2 | `declined` → Teaser, `myParticipation` und `declinedEvents` im Payload | nein |
| 3 | Antwortblock im Frontend, Profil- und Events-Tab-Sektionen, Anbindung der Ausreden | ja |
| 4 | Orga-Sicht mit vier Gruppen, `FIRM_EVENT_PARTICIPANT_SQL` in Kosten, Zahlung und Sitzplan | ja |
| 5 | Erinnerungs- und Nachfrage-Sweeps, Orga-Meldung bei später Absage | ja |
| 6 | `response_deadline` im Event-Formular inklusive Sperrlogik | ja |

Die Blöcke 1 bis 3 schließen die drei Lücken aus Abschnitt 1.3 vollständig; 4 bis 6 sind Ausbau.

---

## 9. Offene Entscheidungen

1. **Antwortfrist je Event oder global?** Vorschlag: je Event, optional, Vorbelegung leer.
   Alternative wäre eine Instanz-Voreinstellung „X Tage vor Beginn“.
2. **Sind Notizen für alle Teilnehmenden sichtbar oder nur für die Orga?** Vorschlag: für alle
   Teilnehmenden – in einer Freundesgruppe ist „komme erst Samstag“ eine Information für alle,
   keine Personalakte.
3. **Soll ein Vorbehalt automatisch verfallen?** Vorschlag: nein, kein stiller Statuswechsel. Die
   Nachfrage 14 Tage vorher reicht; eine automatische Absage würde jemanden aus einem Event
   werfen, das er gerade plant.
4. **Zählt „unter Vorbehalt“ beim Essen mit?** Vorschlag: ja, bis zur Bestellfrist, danach nur
   `firm` – hier entscheidet die reale Bestellung, nicht der Teilnahmestatus.
