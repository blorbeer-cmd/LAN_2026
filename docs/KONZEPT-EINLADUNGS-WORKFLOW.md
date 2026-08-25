# Konzept: Einladungs- und Zusage-Workflow

Stand: August 2026 · Status: **Entwurf** (Rev. 2 – noch nicht umgesetzt)

Dieses Dokument beschreibt, wie aus der heutigen einmaligen Ja/Nein-Frage eine änderbare Antwort
wird. Der Kern in einem Satz: **Eine Zusage darf jederzeit zurückgenommen werden, und eine Absage
sperrt niemanden aus dem Event aus** – das abgesagte Event bleibt im Event-Bereich sichtbar, nur
eben nicht mehr als Arbeitsraum auswählbar. Endgültig entfernt wird eine Person weiterhin
ausschließlich von der Orga.

Rev. 1 enthielt zusätzlich den Antwortzustand „unter Vorbehalt“, eine Antwortfrist je Event, eine
Antwortnotiz und mehrere Erinnerungsstufen. Rev. 2 nimmt diese Teile bewusst heraus und sammelt sie
in Abschnitt 10 („Bewusst zurückgestellt“). Der verbleibende Umfang kommt **ohne Schemaänderung**
aus.

Ergänzt [`KONZEPT-EVENT-SICHTBARKEIT.md`](KONZEPT-EVENT-SICHTBARKEIT.md) (Abschnitt 3.2 legt die
Teilnahmezustände fest) und lässt die Terminabstimmung aus
[`plans/event-date-poll-concept.md`](plans/event-date-poll-concept.md) unberührt (siehe
Abschnitt 6.3).

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
  [`server/public/js/views/profile.js`](../server/public/js/views/profile.js)) und bietet genau
  zwei Knöpfe: **Annehmen** und **Ablehnen**.
- Zusätzlich erscheint ein Hinweis in der Home-Liste „Aktuell“
  ([`server/public/js/aktuellStatus.js`](../server/public/js/aktuellStatus.js)).
- Serverseitig antworten `POST /api/events/:id/invitation/accept` und `.../decline` über
  `respondToEventInvitation` ([`server/src/events.ts`](../server/src/events.ts)).

### 1.3 Was daran hakt

- **Keine Absage im Nachgang.** `respondToEventInvitation` verriegelt die Antwort, sobald
  `confirmed_schedule_revision` der aktuellen `schedule_revision` entspricht. Ein Wechsel von
  `accepted` auf `declined` endet mit `409 „Die Einladung ist nicht mehr offen.“` Sich selbst
  austragen kann ebenfalls niemand: `DELETE /api/events/:id/participants/:playerId` verlangt
  `requireGroupRole('admin')`. Wer nach der Zusage doch nicht kann, muss die Orga persönlich
  anschreiben – das System weiß davon nichts.
- **Antwort weggeklickt = weg.** Die Push-Nachricht wird genau einmal zugestellt. Die Karte bleibt
  zwar in „Mein Profil“ stehen, aber dieser Ort liegt zwei Ebenen tief (Mehr → Mein Profil), und
  auf dem Events-Bereich, wo die Person das Event vermutet, ist eine offene Einladung bewusst gar
  nicht sichtbar.
- **Nach einer Absage ist das Event vollständig weg.** `eventAccessLevel`
  ([`server/src/eventContext.ts`](../server/src/eventContext.ts)) liefert für `declined` den Wert
  `'none'`, `GET /api/events/:id` antwortet mit 404, und die Einladungsliste in `GET /api/events`
  filtert auf `ep.status = 'invited'`. Es gibt danach keinerlei Zugriff mehr – auch nicht, um es
  sich anders zu überlegen. Nur die Orga kann über „Erneut einladen“ eine neue Runde eröffnen.

Zusammengefasst: Der Workflow behandelt die Einladung als **einmaliges Ereignis mit einer
endgültigen Antwort**. Für eine LAN, die Monate im Voraus geplant wird, ist die Teilnahme aber ein
**Zustand, der sich ändert**.

---

## 2. Zielbild und Leitentscheidungen

> Jede eingeladene Person kann ihre Antwort jederzeit ändern und findet das Event danach weiterhin
> dort, wo sie es erwartet.

Vier Leitentscheidungen:

1. **Die Antwort ist änderbar, nicht endgültig.** Zusage → Absage und Absage → Zusage sind normale
   Vorgänge, keine Fehler. Gesperrt wird nur, wo es einen harten Grund gibt (Abschnitt 3.3).
2. **Eine Absage ist keine Ausladung.** Das Event bleibt im Event-Bereich sichtbar – als Karte im
   Teaser-Umfang mit dem Zustand „Abgesagt“ und einem Knopf „Doch zusagen“.
3. **Abgesagt heißt kein Arbeitsraum.** Das Event verschwindet aus dem Auswahl-Dropdown oben und
   kann nicht mehr als aktives Event gesetzt werden. Wer sein aktuelles Arbeits-Event absagt,
   landet sofort im Basis-Event.
4. **Entfernen bleibt Sache der Orga.** Erst wenn Ersteller oder Admin die Person aus dem Event
   löschen, verschwindet es vollständig aus deren App. Genau dieser Schritt löst eine Nachricht aus
   (Abschnitt 5).

Nicht Teil dieser Revision: „unter Vorbehalt“, Antwortfristen, Antwortnotizen, mehrstufige
Erinnerungen (siehe Abschnitt 10). Ebenfalls nicht: Warteliste, Begleitpersonen, Teilnahme ohne
Konto.

---

## 3. Domänenmodell

### 3.1 Keine neuen Zustände, keine Schemaänderung

`event_participants.status` behält exakt seinen heutigen Wertebereich
(`invited | accepted | declined`), und `ACCEPTED_EVENT_PARTICIPANT_SQL`
([`server/src/eventParticipation.ts`](../server/src/eventParticipation.ts)) bleibt unverändert die
eine Zugriffsbedingung für Arbeitsraum, Live-Status, Realtime, Kiosk, Push-Empfänger und
Auswertungen. Der gesamte Umfang dieser Revision besteht aus **gelockerten Regeln auf bestehenden
Daten**:

| Zustand | Datenlage | Sichtbarkeit | Im Dropdown wählbar |
|---|---|---|---|
| Offen | `status = 'invited'` | Teaser-Karte mit Zusagen/Absagen | nein |
| Zugesagt | `status = 'accepted'` | voller Arbeitsraum | ja |
| Abgesagt | `status = 'declined'` | Teaser-Karte mit „Doch zusagen“ (**neu**) | nein |
| Entfernt | kein Datensatz | keine | nein |

Zeitstempel für die Orga-Anzeige („abgesagt am …“) liefert die bereits vorhandene Tabelle
`event_participation_history` mit `accepted_at`, `declined_at` und `removed_at`; ihre Trigger
schreiben bei jedem Statuswechsel mit. Es braucht dafür keine zusätzliche Spalte.

### 3.2 Erlaubte Übergänge

| von → nach | Zusagen | Absagen |
|---|---|---|
| Offen | ja | ja |
| Zugesagt | idempotent | ja (Regeln 3.3) |
| Abgesagt | ja | idempotent |
| Entfernt | nur über eine neue Einladung der Orga | – |

Jeder Wechsel stempelt `confirmed_schedule_revision` auf die aktuelle `schedule_revision`, schreibt
einen Admin-Audit-Eintrag und löst über `resolvePushTopic` ein offenes Einladungs-Topic auf. Die
bisherige Verriegelung „bereits für diese Revision bestätigt“ entfällt als Sperre; das Feld bleibt
als Anzeigewert für „Zusage zum alten Termin“ erhalten.

### 3.3 Wann eine Absage gesperrt ist

Selbstbedienung ist der Normalfall. Gesperrt wird nur dort, wo eine Änderung nachweislich mehr
kaputt macht, als sie hilft:

| Situation | Absage selbst möglich | Begründung |
|---|---|---|
| Regelfall vor Eventbeginn | ja | darum geht es |
| Zahlung erfasst (`paid = 1`) | nein | spiegelt die bestehende Sperre beim Entfernen ([`server/src/routes/events.ts`](../server/src/routes/events.ts)); Geld zurück ist eine Orga-Entscheidung |
| Event läuft oder ist beendet | nein | die Teilnahme ist Tatsache, keine Absicht mehr |
| Event abgesagt (`status = 'cancelled'`) | nein | es gibt nichts mehr zu beantworten |
| Basis-Event | nein | bestehender 409-Pfad, Invariante 2 aus `KONZEPT-EVENT-SICHTBARKEIT.md` |

In jedem gesperrten Fall zeigt die Oberfläche den Grund im Klartext und verweist auf die Orga,
statt den Knopf kommentarlos verschwinden zu lassen.

### 3.4 Was eine Absage mit vorhandenen Daten macht

Eine Absage ist eine Absichtserklärung, keine Datenlöschung:

- Checklisten-Einträge, Essensbestellungen, Statistiken und Historie bleiben unverändert liegen.
  Sagt die Person wieder zu, ist alles wie vorher da.
- Ein aktiver Live-Status im abgesagten Event wird beendet – analog zum bestehenden Entfernen-Pfad
  (`clearPlayerLiveStatus` plus `liveStatusChanged`-Broadcast, wenn `tracking_enabled` gesetzt
  ist). Sonst steht jemand als „spielt“ in einem Event, das er gerade abgesagt hat.
- Verbindliche Zahlen (Teilnehmerzahl, Kostenaufteilung, Zahlungserinnerungen, Sitzplan) rechnen
  wie bisher ausschließlich mit `accepted`. Da abgesagte Personen diesen Status verlassen, fallen
  sie automatisch heraus – ohne eine einzige geänderte Abfrage.

---

## 4. Sichtbarkeit nach einer Absage

### 4.1 Genau eine Änderung im Zugriffsmodell

`eventAccessLevel` ändert sich an einer Stelle:

```
if (participation?.status === 'declined') return 'teaser';   // vorher: 'none'
```

Damit erfüllt der Code die in `KONZEPT-EVENT-SICHTBARKEIT.md` Abschnitt 3.2 bereits beschriebene
Zeile „nur in der persönlichen Einladungshistorie sichtbar“. Der Teaser gibt weiterhin
ausschließlich Name, Zeitraum, Ort, Beschreibung, Kostenangabe und den eigenen Status heraus –
keine Teilnehmerlisten, keine fremden Antwortzustände, keine Fachdaten.

### 4.2 Sichtbar, aber nicht auswählbar

Diese Trennung ist der Kern von Leitentscheidung 3 und ergibt sich fast vollständig aus dem
bestehenden Code:

- **Dropdown oben**: gespeist aus `state.availableEvents` über `selectableEventWorkspaces()`
  ([`server/public/js/state.js`](../server/public/js/state.js)). Die Serverabfrage dahinter filtert
  auf `ACCEPTED_EVENT_PARTICIPANT_SQL` – ein abgesagtes Event taucht dort also gar nicht erst auf.
- **Aktiv setzen**: `setActiveEventForPlayer` prüft dieselbe Bedingung; ein direkter Versuch über
  die API läuft ins Leere. Invariante 7 („ein abgelehntes Event ist nicht als Arbeits-Event
  wählbar“) bleibt damit unangetastet.
- **Aktuelles Arbeits-Event abgesagt**: Die Absage ruft `switchPlayerEventScope(playerId, groupId,
  BASE_EVENT_ID)` – genau wie der Entfernen-Pfad heute – und sendet `eventsChanged`, damit offene
  Clients sofort ins Basis-Event wechseln. Ohne diesen Schritt würde `getOrRepairActiveEvent` den
  Kontext zwar beim nächsten Aufruf reparieren, die laufende Oberfläche bliebe aber bis zum Reload
  in einem Event stehen, das gerade abgesagt wurde.

### 4.3 Wo die Karte erscheint

| Ort | Heute | Künftig |
|---|---|---|
| Event-Bereich (Orga → Events) | offene Einladungen und abgesagte Events unsichtbar | eigene Sektionen **„Einladungen“** und **„Abgesagt“** über bzw. unter den Arbeitsraum-Karten, jeweils als Teaser-Karte mit Antwortknöpfen |
| Mein Profil → „Einladungen“ | Karte mit Annehmen/Ablehnen | bleibt; Abschnitt heißt **„Meine Einladungen & Zusagen“** und zeigt zusätzlich abgesagte Events |
| Event-Karte des eigenen, zugesagten Events | keine Rücknahme möglich | Knopf **„Teilnahme absagen“** in den Kartenaktionen, mit Rückfrage |
| Home → „Aktuell“ | Hinweis „Annehmen oder ablehnen im Profil“ | unverändert, solange die Antwort offen ist |
| Benachrichtigungszentrale | Deep-Link `/#profile` | unverändert |

Die ursprüngliche Begründung, offene Einladungen nicht zwischen die Arbeitsraum-Karten zu mischen
(sie gingen dort unter), bleibt gültig – deshalb eigene, klar beschriftete Sektionen statt
Vermischung.

Die Absage-Rückfrage bindet den vorhandenen Ausreden-Generator
([`server/public/js/eventExcuses.js`](../server/public/js/eventExcuses.js)) als optionalen Knopf
ein, ohne dass die Ausrede irgendwo gespeichert wird – das Speichern gehört zur zurückgestellten
Antwortnotiz (Abschnitt 10).

---

## 5. Entfernen durch die Orga – und die Frage nach der Nachricht

Das Entfernen (`DELETE /api/events/:id/participants/:playerId`, Owner/Admin) bleibt technisch, wie
es ist: Der Datensatz verschwindet, `eventAccessLevel` liefert wieder `'none'`, das Event ist aus
der App der Person vollständig weg. Es ist damit **der einzige** Weg, jemanden aus einem Event zu
entfernen. Für die Sprache in der Oberfläche folgt daraus eine klare Trennung:

- **„Einladung zurückziehen“ / „Aus Event entfernen“** (Orga): Datensatz weg, Zugriff endet.
- **„Absagen“** (Person selbst): Datensatz bleibt, Teaser bleibt, Rückkehr jederzeit möglich.

**Empfehlung zur Nachricht: ja, aber nur, wenn die Person nicht selbst abgesagt hatte.**

| Vorheriger Zustand | Nachricht an die entfernte Person | Begründung |
|---|---|---|
| `accepted` (zugesagt) | **ja** | Das Event verschwindet sonst kommentarlos aus der App, obwohl die Person fest damit geplant hat. Das ist die eine Situation, in der Schweigen echten Schaden anrichtet. |
| `invited` (offen) | **ja** | Die Einladungskarte verschwindet, ohne dass die Person geantwortet hat. Ohne Nachricht wirkt das wie ein Fehler der App. |
| `declined` (selbst abgesagt) | **nein** | Das Entfernen ist hier nur Aufräumen einer Entscheidung, die die Person selbst getroffen hat. Eine Push „Du wurdest entfernt“ wäre irritierend und liest sich wie eine Strafe. Die Teaser-Karte verschwindet still. |

Technische Form: eine Push über `notifyPlayers` im **Basis-Event-Scope** – dieselbe Begründung wie
bei der Einladungs-Push (`notifyPlayers` stellt nur an akzeptierte Teilnehmende seines Scope-Events
zu, und die entfernte Person ist genau das nicht mehr). Text neutral halten, zum Beispiel
„<Event>: Du bist nicht mehr als Teilnehmer eingetragen.“ Kein Topic-Key, weil daraus keine offene
Aufgabe entsteht; das offene Einladungs-Topic wird wie heute über `resolvePushTopic` aufgelöst.

**Gegenrichtung:** Sagt jemand eine bereits erteilte Zusage ab, bekommen Owner und Admins eine
Push. Das ist der Grund, warum die Absage überhaupt eingebaut wird – die Orga soll es erfahren,
ohne die Teilnehmerliste zu beobachten. Eine Absage auf eine noch offene Einladung erzeugt dagegen
keine Nachricht: Das ist die normale Antwort auf eine Frage, kein Planungsereignis.

---

## 6. Technischer Vertrag

### 6.1 API

Kein neuer Endpunkt. Die beiden bestehenden Routen bleiben und werden entriegelt:

- `POST /api/events/:id/invitation/accept`
- `POST /api/events/:id/invitation/decline`

Vertrag danach:

- Ein Wechsel in den jeweils anderen Zustand ist erlaubt, solange keine Sperre aus Abschnitt 3.3
  greift; die Antwort ist `200` mit dem neuen Zustand.
- Eine identische Antwort bleibt idempotent (`200`, `changed: false`).
- Gesperrte Fälle antworten `409` mit maschinenlesbarem `reason`: `locked_paid`, `locked_started`,
  `locked_cancelled`, `locked_base_event`.
- Kein Teilnahmedatensatz vorhanden → `404`. Damit bleibt ausgeschlossen, dass sich jemand selbst
  in ein Event einlädt.
- `respondToEventInvitation` bleibt die einzige Schreibstelle und behält seinen bedingten
  `UPDATE` als Rennschutz; die Bedingung wandert von „noch nicht für diese Revision bestätigt“ auf
  „aktueller Status ist nicht bereits der Zielstatus“.

`GET /api/events` liefert zusätzlich zur bestehenden Sammlung `invitations` eine Sammlung
`declinedEvents` im Teaser-Umfang, jeweils mit `participationStatus` und den Feldern `canAnswer`
und `lockReason`. `GET /api/events/:id` gibt für `declined` denselben Teaser zurück wie für
`invited`, statt 404.

### 6.2 Realtime und Push

| Anlass | Wirkung |
|---|---|
| Antwort (zusagen/absagen) | `eventsChanged`-Broadcast, Auflösung des Einladungs-Topics, bei Bedarf `liveStatusChanged` |
| Absage einer bestehenden Zusage | zusätzlich Push an Owner/Admins |
| Entfernen durch die Orga | wie heute, plus Push an die entfernte Person nach den Regeln aus Abschnitt 5 |

### 6.3 Terminabstimmung

Unverändert: Eine Abstimmung entwertet keine Zusage. Nach einer Terminverschiebung bleibt die
letzte Antwort stehen und wird in der Oberfläche als „Zusage zum alten Termin“ markiert. Die
bisherige Sonderlogik, die eine Antwort nur bei Revisionswechsel wieder öffnete, wird
gegenstandslos, weil Antworten künftig ohnehin änderbar sind.

---

## 7. Teststrategie

Serverseitig (`server/src/events.test.ts`):

- Zusage → Absage → Zusage funktioniert und ist in jedem Schritt idempotent.
- Jede Sperre aus Abschnitt 3.3 mit ihrem `reason`, insbesondere `paid = 1` und laufendes Event.
- `declined` sieht den Teaser, aber keine Teilnehmerliste und keine Fachdaten.
- `declined` erscheint nicht in `availableEvents` und kann nicht aktiv gesetzt werden.
- Absage des aktuellen Arbeits-Events setzt den Kontext auf das Basis-Event und beendet einen
  laufenden Live-Status.
- Entfernen: Push nur bei vorherigem Status `invited` oder `accepted`, keine Push nach eigener
  Absage; bezahlte Teilnahme bleibt gesperrt.
- Absage einer bestehenden Zusage benachrichtigt Owner/Admins, eine Absage auf eine offene
  Einladung nicht.
- Nebenläufigkeit: zwei gleichzeitige Antworten führen zu genau einem Endzustand und zu einem
  Audit-Eintrag je tatsächlicher Änderung.

Frontend (`server/public/js/events.test.js`):

- Sektionen „Einladungen“ und „Abgesagt“ rendern die richtigen Events samt Antwortknöpfen.
- „Teilnahme absagen“ erscheint nur bei zugesagten, noch nicht gesperrten Events; gesperrte Fälle
  zeigen den Grund.
- Das Dropdown enthält abgesagte Events nicht.

---

## 8. Umsetzung in Blöcken

| Block | Inhalt | Für Nutzer sichtbar |
|---|---|---|
| 1 | `respondToEventInvitation` entriegeln, Sperrregeln samt `reason`, Kontext- und Live-Status-Aufräumen bei Absage, Tests | nein |
| 2 | `declined` → Teaser, `declinedEvents`/`canAnswer`/`lockReason` im Payload | nein |
| 3 | Sektionen „Einladungen“ und „Abgesagt“ im Event-Bereich, „Teilnahme absagen“ auf der Event-Karte, Profilabschnitt | ja |
| 4 | Nachrichten: Push an die entfernte Person, Push an die Orga bei zurückgezogener Zusage | ja |

Blöcke 1 bis 3 erfüllen den beauftragten Kern. Block 4 hängt an der Entscheidung aus Abschnitt 5
und lässt sich unabhängig nachziehen.

---

## 9. Auswirkungen auf bestehende Dokumentation

`KONZEPT-EVENT-SICHTBARKEIT.md` Abschnitt 3.2 beschreibt für `declined` bereits „nur in der
persönlichen Einladungshistorie sichtbar“. Die Umsetzung bringt den Code mit dieser Zeile in
Einklang; die Tabelle dort wird bei der Umsetzung um die ausdrückliche Aussage ergänzt, dass ein
abgesagtes Event als Teaser sichtbar bleibt und jederzeit erneut zugesagt werden kann.

---

## 10. Bewusst zurückgestellt

Diese Punkte stammen aus Rev. 1 und sind fachlich weiterhin sinnvoll, aber nicht Teil dieser
Umsetzung. Sie sind hier festgehalten, damit die jetzige Lösung sie später nicht blockiert:

- **„Unter Vorbehalt“.** Andockpunkt wäre eine zusätzliche Spalte `commitment` auf
  `event_participants` (`firm | tentative`) statt eines vierten Statuswerts, damit
  `ACCEPTED_EVENT_PARTICIPANT_SQL` unangetastet bleibt und nur verbindliche Zahlen (Kosten,
  Zahlung, Sitzplan) eine eigene Bedingung bekommen. Solange es den Zustand nicht gibt, ist die
  ehrlichste Antwort auf „weiß ich noch nicht“ die Absage mit späterer Rückkehr – genau das macht
  Leitentscheidung 2 möglich.
- **Antwortfrist je Event** (`events.response_deadline`) samt Sperrlogik nach Fristablauf.
- **Antwortnotiz** (`event_participants.answer_note`, max. 280 Zeichen) mit Übernahme aus dem
  Ausreden-Generator und Anzeige in der Teilnehmerliste.
- **Erinnerungen an offene Einladungen** (3 Tage, danach wöchentlich) als Sweep im Muster von
  [`server/src/eventReminders.ts`](../server/src/eventReminders.ts).
- **Orga-Übersicht nach Antwortgruppen** mit Antwortzeitpunkt und Hinweis auf mehrfach geänderte
  Antworten.

---

## 11. Offene Entscheidungen

1. **Nachricht beim Entfernen** – Vorschlag steht in Abschnitt 5: Push nur bei vorherigem Status
   `invited` oder `accepted`, nicht nach eigener Absage. Alternative wäre „immer“ (einfacher zu
   erklären, aber irritierend für Leute, die selbst abgesagt haben) oder „nie“ (spart Code, lässt
   aber eine Ausladung kommentarlos passieren).
2. **Push an die Orga bei jeder Absage oder nur bei zurückgezogener Zusage?** Vorschlag: nur bei
   zurückgezogener Zusage, sonst wird die Orga bei jeder Einladungsrunde zugespamt.
3. **Sichtbarkeit abgesagter Events im Event-Bereich: dauerhaft oder einklappbar?** Vorschlag: eine
   eigene, standardmäßig eingeklappte Sektion „Abgesagt“ – sichtbar genug für die Rückkehr, ruhig
   genug, um nicht zu stören.
