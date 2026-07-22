# Konzept: User-, Rollen- und Event-Management

Stand: 20. Juli 2026 · Status: **verbindliches Zielkonzept** (Rev. 5 – Ein-Gruppen-Modell)

**Revisionsvermerk:** Rev. 5 ersetzt Rev. 4 (Mehrgruppenmodell) vollständig. Produktentscheidung vom
2026-07-20: **Eine Instanz bedient genau eine Freundesgruppe.** Events bleiben die einzige
Scoping-Dimension unterhalb der Instanz. Begründung, Finding-Mapping der bisherigen Review-Phasen
und der vollständige Umsetzungsplan (Phasen R0–R5) stehen in
[`docs/plans/reset-single-group.md`](plans/reset-single-group.md); dieses Dokument beschreibt nur
das Zielkonzept selbst, nicht den Migrationsweg dorthin.

Die Authentifizierungsgrundlage aus PR #197 (Phasen 1–4) bleibt von diesem Wechsel unberührt und
wird hier nicht neu bewertet. Der Realtime-/Push-/Kiosk-Zustellungscode mit Event-Scoping aus
PR #238 bleibt vollständig gültig und ist die technische Basis von Abschnitt 7.

---

## 1. Zusammenfassung und Urteil

Das Modell ist bewusst klein gehalten: Eine Instanz ist der digitale Raum genau eines
Freundeskreises von ungefähr 15 Personen. Es gibt keine zweite Gruppe, keinen Gruppenumschalter und
keine Mandantentrennung zu verteidigen.

- Eine Person hat genau ein globales Konto.
- Alle beanspruchten Konten gehören derselben, einzigen Instanzgruppe an.
- Events sind zeitlich begrenzte Unterräume innerhalb dieser einen Gruppe: Zeitraum,
  Teilnehmerliste, eigene Tracking-Einwilligung und eventgescopte Zustellung (Realtime, Push,
  Kiosk, Arcade).
- Rollen `owner`, `admin` und `member` regeln die Rechte innerhalb der Instanz. Das Rollenmodell ist
  eingefroren: Es wird nicht mehr als Mehrgruppen-Berechtigungssystem weiterentwickelt, sondern als
  einfaches, stabiles Instanz-Rechtemodell behandelt.
- Tracking kann außerhalb von Events durch die Person selbst deaktiviert werden; Event-Auswertungen
  verwenden zusätzlich die Event-Tracking-Zustimmung und den Eventzeitraum.
- Admins/Owner verwalten Mitglieder, Events und Fachdaten der Instanz, aber nicht das globale Konto
  einer Person.

Was sich gegenüber Rev. 4 ändert: Jeder Absatz, der von mehreren Gruppen, Gruppenwechsel,
Gruppen-Einladungslinks für neue Gruppen oder gruppenübergreifenden Mitgliedschaften handelte,
entfällt ersatzlos. Was bleibt, ist bewusst das, was in PR #238 bereits gehärtet und getestet wurde:
Events als Scoping-Dimension.

---

## 2. Ziele und Nicht-Ziele

### 2.1 Ziele

- Ein Konto pro Mensch.
- Ein dauerhafter Instanzraum für Spiele, Live-Status, Abstimmungen, Matches und Organisation –
  unabhängig davon, ob gerade ein Event läuft.
- Events als zeitlich begrenzte, optionale Unterräume mit eigener Teilnehmerliste und eigenem
  Tracking-Zeitfenster.
- Transparente, von der Person selbst steuerbare Tracking-Einwilligung, sowohl außerhalb von Events
  als auch pro Event.
- Administration durch die bestehenden Rollen `owner`/`admin`/`member`, ohne zusätzliche
  Mehrgruppen-Verwaltungsebene.
- Einfache Bedienung für ungefähr 15 Personen; keine Bedienkonzepte, die nur bei mehreren Gruppen
  einen Unterschied machen würden (Gruppenumschalter, Gruppenliste, Gruppen-Einladungslinks).

### 2.2 Nicht-Ziele

- **Mehrgruppenbetrieb.** Eine Instanz bedient genau eine Freundesgruppe. Ein zweiter
  Freundeskreis bekommt ein eigenes Deployment, kein zweites Gruppenobjekt in derselben Instanz.
  Es gibt keine Roadmap, dies später wieder einzuführen; siehe die Begründung in
  `docs/plans/reset-single-group.md` Abschnitt 8 ("Ausdrücklich verworfen").
- **Vollständige OWASP-ASVS-Level-2-Konformität.** Die Sicherheitsbaseline ist ASVS Level 1
  vollständig, ergänzt um sinnvolle Level-2-Härtungen dort, wo sie mit vertretbarem Aufwand
  erreichbar sind (siehe Abschnitt 10). Eine formale oder vollständige L2-Zertifizierung wird nicht
  angestrebt und nicht behauptet.
- **MFA als Merge-Voraussetzung.** Mehrfaktor-Authentifizierung ist ein mögliches späteres
  Backlog-Härtungsfeature (Abschnitt 11), aber keine Bedingung, um Code in diesem Projekt zu mergen.
  Für einen privaten LAN-Freundeskreis von ~15 Personen ist das im Verhältnis zum Aufwand keine
  angemessene Eintrittshürde.
- Enterprise-Mandantenverwaltung, Abrechnung oder Quoten.
- Öffentliche Registrierung oder eine durchsuchbare Mitgliederliste außerhalb der Instanz.
- Gäste ohne eigenes Konto.

### 2.3 Bereits umgesetztes Auth-Fundament (unverändert)

Das Auth-Fundament aus PR #197 (Phasen 1–4) ist von der Mehrgruppen-Frage unabhängig und wird durch
Rev. 5 nicht neu bewertet:

- Name + Passwort mit persönlichem, serverseitig gehashtem Session-Token im HTTP-only-Cookie.
- Passwortlänge 1–200 Zeichen (bewusste Lockerung für den privaten Freundeskreis: keine
  Mindestlänge über „nicht leer" hinaus, keine Komplexitätsregeln, keine erzwungene Rotation); UI mit
  Sichtbar-Toggle und Passwortmanager-kompatiblem `autocomplete`. Die Obergrenze bleibt, damit
  scrypt-Hashing nicht zum DoS-Vektor wird.
- scrypt-Hashing für Passwörter.
- 90 Tage gleitende Session-Laufzeit, hart begrenzt auf 180 Tage.
- Cookie `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, im HTTPS-Modus mit `__Host-`-Präfix;
  Session-Tokens erscheinen nie in URLs oder Logs.
- Registrierung, Claim und Passwort-Reset nur über atomar einmal nutzbare, ablaufende und
  widerrufbare Codes. Passwortänderung und Reset invalidieren alte Sessions und Sockets.
- Konto- und globales Auth-Rate-Limit, konstante Passwortprüfung auch für unbekannte Konten,
  `Retry-After` bei Sperren.
- Fünf Minuten gültige, sessiongebundene Step-up-Reauthentifizierung für kritische Admin-Aktionen.
- `AUTH_MODE=required` bindet REST- und Socket-Akteure an die Session.

Diese Punkte sind Bestand, kein neuer Auftrag dieses Dokuments.

---

## 3. Domänenmodell

### 3.1 Globale Konten

Der bestehende `players`-Datensatz ist das globale Konto: ID, Login-Name, Passwort-Hash, Sessions,
Avatar, Agent-API-Key, Kontostatus und Instanzrolle für technische Wiederherstellung. Ein Login
gewährt noch keinen Zugriff; Zugriff entsteht durch eine aktive Instanzmitgliedschaft (siehe 3.3).

### 3.2 Die eine Gruppe

Die bei der ursprünglichen Migration erzeugte Startgruppe (`DEFAULT_GROUP_ID`) bleibt intern im
Schema bestehen (`groups`, `group_memberships`, `group_id`-Spalten). Das ist bewusst
"Stilllegen statt Rückbau" (siehe `docs/plans/reset-single-group.md` Abschnitt 2): ein struktureller
Rückbau dieser Tabellen wäre eine riskante XL-Migration ohne Nutzerwert.

Nach außen – für Bedienkonzept, UI und API – gibt es aber **keine Gruppe als sichtbares Konzept
mehr**, sondern nur die Instanz selbst:

- Kein Gruppenumschalter, keine Gruppenliste, keine Möglichkeit, eine weitere Gruppe anzulegen,
  ihr beizutreten oder sie zu verlassen.
- Kein Gruppen-Einladungslink für neue Gruppen. Die einzige Einladung, die es gibt, ist die
  bestehende Konto-Einladung aus dem Auth-Fundament (Registrierung/Claim), die direkt in die
  Instanz führt.
- Keine Gruppenarchivierung oder -löschung als Nutzerfluss. Die Startgruppe existiert für die
  Lebensdauer der Instanz.

### 3.3 Rollen: `owner`, `admin`, `member` (eingefroren)

Die Rollen sind identisch zu Rev. 4, aber ohne Mehrgruppen-Kontext zu verstehen: Es ist das
Rechtemodell der gesamten Instanz, nicht einer von mehreren Gruppen.

| Rolle | Bedeutung |
|---|---|
| `owner` | mindestens eine Person je Instanz; kann Rollen bis `admin` vergeben/entziehen und weitere Owner ernennen |
| `admin` | verwaltet Mitglieder, Events und Fachdaten der Instanz |
| `member` | normale Teilnahme, eigene Einstellungen, eigene Tracking-Einwilligung |

Diese Rolle ist in rund einem Drittel der Routen-Dateien über `requireGroupRole` verdrahtet und
getestet. Diese Verdrahtung bleibt unverändert bestehen; sie wird nicht auf `is_admin`
zurückgebaut und nicht durch ein neues Berechtigungsmodell ersetzt. "Eingefroren" bedeutet konkret:

- Kein Rollenwechsel-Feature über Gruppen hinweg, weil es nur eine Gruppe gibt.
- Der letzte Owner bleibt geschützt (kann nicht austreten, entfernt oder degradiert werden).
- Rollenänderungen wirken sofort auf offenen Requests und Socket-Verbindungen.
- Kritische Rollenaktionen verwenden Step-up-Reauthentifizierung.
- Test-User werden nicht Owner oder Admin und impersonieren weiterhin mit sichtbarem Banner und
  jederzeit erreichbarem Rückweg zur eigenen Identität.

### 3.4 Events als einzige Scoping-Dimension

Ein Event ist ein zeitlich begrenzter Unterraum der Instanz:

| Feld | Bedeutung |
|---|---|
| `starts_at`, `ends_at` | verpflichtender, begrenzter Zeitraum |
| `status` | `draft`, `published`, `cancelled`, `ended` |
| übrige Felder | Name, Ort, Beschreibung |

Der Instanzraum ("außerhalb von Events") existiert unabhängig von Events dauerhaft. Events regeln:

- **Zeitraum:** Tracking und Live-Auswertung sind auf `[starts_at, ends_at)` begrenzt.
- **Teilnehmerliste:** `event_participants` legt fest, wer an einem Event teilnimmt und
  Event-Nachrichten erhält.
- **Tracking-Consent:** Die Event-Tracking-Zustimmung ist eine eigene, vom Instanz-Tracking
  getrennte Einwilligung pro Person und Event.
- **Eventgescopte Zustellung:** Realtime (Socket-Rooms), Push und Kiosk-Zugriffe werden, wenn sie
  einem Event zugeordnet sind, ausschließlich an dessen Teilnehmende bzw. Kiosk-Token ausgeliefert.
  Das ist bereits durch PR #238 gehärtet und getestet (Default-Deny, keine ungescopten Broadcasts,
  Arcade-Lobbys/-Ergebnisse mit unveränderlichem Event-Scope).

Überlappende veröffentlichte Events sind weiterhin nicht vorgesehen; Entwürfe dürfen sich
überschneiden.

### 3.5 Event-Teilnahme

Admins/Owner laden aktive Instanzmitglieder zu einem Event ein und können Event-Teilnahmen weiterhin
administrativ entfernen. `event_participants.status` bildet den persönlichen Ablauf ab:

- `invited`: Einladung ist offen; noch kein normaler Event-Zugriff.
- `accepted`: aktive Teilnahme; nur dieser Zustand zählt für teilnehmergebundene Eventdaten,
  Realtime-, Push-, Tracking- und Arcade-Prüfungen.
- `declined`: Einladung wurde abgelehnt; erneutes Einladen setzt sie wieder auf `invited`.

Nur die betroffene Person selbst kann `invited` nach `accepted` oder `declined` überführen.
Wiederholte identische Antworten sind idempotent; konkurrierende, widersprüchliche Antworten werden
atomar auf genau einen Zustand festgelegt. Owner/Admins behalten ihre bestehenden administrativen
Event-Sonderrechte. Kiosk-Token und Event-Allowlist bleiben davon unabhängig und unverändert.

### 3.6 Spielerreferenzen

Da es nur eine Instanz mit einer festen Mitgliedermenge gibt, vereinfacht sich die frühere
Mehrgruppen-Invariante: Jede Spielerreferenz in Fachdaten (Teams, Matches, Turniere, Votes,
Sitzbeziehungen, Bestellungen, Anreisen, Tracking-Sessions, Leaderboards, Arcade-Lobbys/-Ergebnisse)
verweist entweder auf ein aktives Konto oder – bei abgeschlossenen historischen Daten – auf einen
unveränderlichen Snapshot (mindestens Anzeigename und stabile Spieler-ID). Nach Deaktivierung eines
Kontos entstehen keine neuen Referenzen; bestehende historische Einträge bleiben über ihren Snapshot
vollständig nachvollziehbar.

---

## 4. Event-Kontext und Autorisierung

Da es keinen Gruppenkontext mehr zu wählen gibt, reduziert sich die Kontextfrage auf: **Instanzraum
oder ein bestimmtes Event?** Die UI zeigt diesen Kontext an ("Instanzraum" bzw. Eventname); die
Autorisierung läuft serverseitig:

- `requireGroupRole('admin')` bzw. `requireGroupRole('owner')` – verlangt Admin- bzw.
  Owner-Rechte. Die Namen der Helfer bleiben aus historischen Gründen an `group` angelehnt, prüfen
  aber gegen die eine feste Instanzgruppe.
- `resolveGroupResource` (in den Event-Routen als `resolveEvent` eingesetzt) lädt ein Event
  zusammen mit seinem Gruppenbezug und kombiniert das mit `requireGroupRole('admin')`, um
  Admin-/Ownerrechte für ein konkretes Event zu verlangen.
- Ressourcen werden immer zusammen mit ihrem Event geladen und mutiert, nie erst global per ID und
  danach ungeprüft.
- Event-Einladungen verwenden `POST /api/events/:id/invitations`; persönliche Antworten laufen über
  `POST /api/events/:id/invitation/accept` bzw. `.../decline`. Der ältere Pfad
  `POST /api/events/:id/accept` bleibt ausschließlich der Tracking-Zustimmung vorbehalten.

Serverantwort bei Grenzverletzungen bleibt unverändert:

- Nicht angemeldet: `401`
- Angemeldet, aber unzureichende Rolle: `403`
- Fremdes/unbekanntes Event oder fremde Ressource: `404`
- Nicht mehr aktives Konto: bestehende Sessions verlieren sofort den Zugriff

---

## 5. Tracking und Privatsphäre

### 5.1 Grundregel

Der Agent authentifiziert das globale Konto. Ein Report wird verarbeitet, wenn:

- das Konto aktiv (nicht deaktiviert) ist,
- außerhalb eines Events: das Instanz-Tracking durch die Person aktiviert ist,
- innerhalb eines teilnehmerprivaten Events: die Person den Teilnahmestatus `accepted` hat und ihre
  Event-Tracking-Zustimmung aktiv ist,
- innerhalb eines gruppenweit oder öffentlich sichtbaren Events: das Instanz-Tracking aktiv ist;
  diese bestehenden Sichtbarkeitsverträge werden nicht in teilnehmerprivates Event-Consent
  umgedeutet.

Instanz- und Event-Consent sind eigenständige Freigaben: Ein deaktiviertes Instanz-Tracking
blockiert keinen ausdrücklich freigegebenen teilnehmerprivaten Event-Kontext. Umgekehrt ersetzt
Instanz-Tracking niemals den Event-Consent. Owner-/Adminrechte gewähren administrativen
Event-Zugriff, aber keine persönliche Tracking-Einwilligung und keinen Tracking-Teilnahmestatus.
Im Legacy-Modus bleibt ausschließlich für bereits `accepted`-Teilnehmende die bisherige
rosterbasierte Event-Kompatibilität erhalten.

Es gibt weiterhin keine dauerhaft gespeicherte globale Rohaktivität ohne Einwilligung. Ist kein
Tracking erlaubt, wird der Report nur als technischer Heartbeat verarbeitet.

### 5.2 Einwilligungen

- Außerhalb von Events gilt eine persönliche Einstellung, standardmäßig aus.
- Beim Zuordnen zu einem Event wird transparent erklärt, dass Tracking während des Eventzeitraums
  für Event-Auswertungen verwendet wird; die Zustimmung ist separat widerrufbar.
- `POST /api/groups/:groupId/tracking-consent` setzt den Gruppenraum-Consent mit
  `{ "granted": true|false }`. `POST /api/events/:id/tracking-consent` setzt entsprechend den
  Event-Consent. Ein leerer Event-Request und der historische Alias `POST /api/events/:id/accept`
  bleiben aus Kompatibilitätsgründen eine Zustimmung; nur der kanonische Consent-Endpunkt nimmt
  mit `{ "granted": false }` einen Widerruf entgegen.
- Zustimmung, wiederholte Zustimmung, Widerruf und wiederholter Widerruf sind idempotent. Eine
  erneute Zustimmung nach Widerruf erzeugt ein neues Historienintervall; alte Consent-Zeilen werden
  weder überschrieben noch gelöscht.
- Für ein teilnehmerprivates Event darf Zustimmung nur bei `accepted` erteilt werden. Vorhandene
  Consent-Historie für `invited` oder `declined` gewährt keinen Tracking-Kontext und ändert den
  Teilnahmestatus nicht. Widerrufen darf die Person eine alte Freigabe unabhängig vom aktuellen
  Teilnahmestatus.
- Ein globaler „Tracking pausieren“-Notschalter bleibt bestehen und gewinnt immer.
- Admins/Owner können Einwilligungen sehen, aber niemals für andere aktivieren.
- Widerruf stoppt neue Erfassung sofort, beendet offene Sessions und entfernt Live-Status.
  Die aktualisierte Live-Projektion wird unmittelbar per Realtime verteilt. Rechtmäßig erfasste
  Historie bleibt, bis die Person sie separat löschen lässt.

### 5.3 Zeitgrenzen

Event-Tracking beginnt frühestens bei `starts_at` und endet spätestens bei `ends_at`. Offene
Sessions werden bei Ende des Zeitraums, Widerruf oder Kontodeaktivierung sauber und idempotent
geschlossen, damit verspätete Agent-Reports keine beendete Session wieder öffnen.

Bei einem Eventwechsel werden nicht mehr berechtigte Live-Kontexte vor Verarbeitung des nächsten
Reports geschlossen. Falls technische Bestandsdaten mehrere zeitlich aktive Events enthalten,
wird ein Report nur auf die jeweils zulässigen Kontexte verteilt und proportional gewichtet; ein
Widerruf schließt dabei ausschließlich den betroffenen Event-Kontext.

---

## 6. Realtime, Push, Kiosk und Arcade

Dieser Abschnitt beschreibt den bereits durch PR #238 gehärteten und getesteten Zustand; er bleibt
im Ein-Gruppen-Modell unverändert gültig, weil Events unabhängig vom Mehrgruppen-Wegfall
weiterbestehen.

### 6.1 Socket.IO

Ein Socket tritt nach Authentifizierung dem Instanzraum und optional einem `event:<id>`-Room bei.
Der Server validiert Event-Teilnahme bei jedem Subscribe. Rollenänderung, Kontodeaktivierung oder
Ende eines Events lösen sofortiges Re-Rooming bzw. Trennen aus.

### 6.2 Push

Push-Nachrichten tragen optional `event_id`. Die Empfängerliste wird bei jedem Versand aus
Event-Teilnahme und individuellen Push-Einstellungen berechnet. Entfernte Mitglieder, Test-User und
deaktivierte Konten werden ausgeschlossen. Eine Person kann Push pro Event stummschalten.

### 6.3 Kiosk

Kiosk-Links gehören entweder zum Instanzraum oder einem Event. Tokens sind zufällig, widerrufbar,
rotierbar und read-only. Ein Event-Kiosk sieht ausschließlich Daten seines Events.

### 6.4 Arcade

Arcade-Lobbys und laufende Matches tragen optional `event_id` mit unveränderlichem Scope.
Lobbylisten, Zuschauer-Räume, Ergebnisse und Kiosk-Streams werden gleich gescoped. Nur die
unveränderliche technische Definition eingebauter Arcade-Titel ist global und enthält keine
Spieler- oder Ergebnisdaten.

---

## 7. Administration und Audit

Admins/Owner dürfen innerhalb der Instanz:

- Mitglieder verwalten (Rollen bis `admin`, Deaktivierung),
- Events anlegen, bearbeiten, absagen,
- fehlerhafte Matches, Vote-Runden, Auslosungen, Play-Sessions und Durchsagen löschen.

Sie dürfen nicht:

- globale Kontopasswörter zurücksetzen (das bleibt eine Instanz-Admin- bzw.
  Self-Service-Funktion aus dem Auth-Fundament),
- Tracking für andere aktivieren,
- fremde private Kontodaten oder Sessions sehen.

`admin_log` protokolliert Rollen-, Mitgliedschafts-, Event- und Löschaktionen. Codes, Passwörter,
API-Keys und vollständige Push-Inhalte werden nie geloggt.

---

## 8. Was in diesem Dokument nicht mehr vorkommt

Gegenüber Rev. 4 wurden folgende Konzepte ersatzlos gestrichen, weil sie ausschließlich bei
mehreren Gruppen einen Unterschied gemacht hätten (Details und Code-Referenzen siehe
`docs/plans/reset-single-group.md` Abschnitt 3):

- Gruppenanlage, Gruppen-Einladungslinks für neue Gruppen, Gruppenbeitritt/-austritt als Feature.
- Gruppenwechsel/-umschalter und parallele Gruppenkontexte in mehreren Tabs.
- Gruppenübergreifende Mitgliedschaften einer Person.
- Gruppenarchivierung/-löschung als Nutzerfluss.
- Cross-Group-Autorisierungs- und Testmatrix (Alice/Bob/Carol über zwei Gruppen).
- Die gestufte 5a–6-Phasenplanung für den Mehrgruppen-Rollout inklusive
  `MULTI_GROUPS_ENABLED`-Freigabe-Gate.

---

## 9. Sicherheitsbewertung

Verbindliche Sicherheitsbaseline ist weiterhin der [OWASP Application Security Verification
Standard 5.0.0](https://github.com/OWASP/ASVS/tree/v5.0.0): **Level 1 vollständig**, ergänzt um
**sinnvolle Level-2-Härtungen, wo sie mit vertretbarem Aufwand erreichbar sind**. Das ist der
zurückgesetzte Anspruch gegenüber Rev. 4: Für einen privaten Freundeskreis von ~15 Personen im LAN
ist eine vollständige, formal behauptete L2-Konformität (die insbesondere verbindliches MFA nach
`v5.0.0-6.3.3` verlangen würde) nicht angemessen und keine Merge-Voraussetzung. Referenzen und
spätere Teilabnahmen verwenden weiterhin ausschließlich versionierte IDs im Format `v5.0.0-x.y.z`.

Was das konkret bedeutet:

| Bereich | Stand nach Rev. 5 |
|---|---|
| Passwortregeln, Session-Token, Cookie-Attribute, Logout, Rate-Limits | ✅ aus PR #197; Passwort-Mindestlänge bewusst auf 1 Zeichen gelockert (privater Freundeskreis), Mechanik unverändert |
| Step-up für kritische Aktionen | ✅ als Mechanismus vorhanden |
| Event-Scoping für REST/Realtime/Push/Kiosk/Arcade | ✅ aus PR #238, bleibt gültig |
| Mehrfaktor-Authentifizierung (`v5.0.0-6.3.3`, L2) | ⚪ optionales Backlog-Feature, keine Bedingung |
| Breach-Passwort-Prüfung (`v5.0.0-6.2.12`, L2) | ⚪ optionales Backlog-Feature, keine Bedingung |
| Mandanten-/Gruppen-Isolation | entfällt als Anforderung; es gibt keinen zweiten Mandanten |

Die frühere Aussage, wonach Phasen "nur gemeinsam produktiv freigeschaltet werden dürfen", entfällt
mit dem Mehrgruppen-Rollout-Gate ersatzlos: Es gibt kein Feature-Flag, hinter dem eine zweite Gruppe
wartet.

---

## 10. Getroffene Entscheidungen

1. Konto und Spieler bleiben eine Entität.
2. Es existiert genau eine Instanzgruppe; ein zweiter Freundeskreis erhält ein eigenes Deployment.
3. Events bleiben die einzige Scoping-Dimension unterhalb der Instanz: Zeitraum, Teilnehmerliste,
   Tracking-Consent, eventgescopte Zustellung.
4. Rollen `owner`/`admin`/`member` bleiben unverändert das Instanz-Rechtemodell; kein Rückbau auf
   `is_admin`.
5. Event-Selbstbeitritt (`invited`/`accepted`-Zustände) ist ein Backlog-UX-Feature, keine
   Sicherheitspriorität.
6. Die interne Startgruppe (`groups`/`group_memberships`/`group_id`) bleibt im Schema bestehen
   ("Stilllegen statt Rückbau"); sie ist kein Bedienkonzept.
7. Tracking-Widerruf stoppt zukünftige Erfassung; rechtmäßig erfasste Historie bleibt erhalten und
   wird nur durch eine separate bewusste Löschaktion entfernt.
8. Sicherheitsbaseline ist OWASP ASVS 5.0.0 Level 1 vollständig plus sinnvolle Level-2-Härtungen
   mit vertretbarem Aufwand; MFA und vollständige L2-Konformität sind explizit keine
   Merge-Voraussetzung.
9. Mehrgruppenbetrieb, vollständige ASVS-L2-Konformität und MFA als Merge-Voraussetzung sind
   Nicht-Ziele dieses Konzepts (Abschnitt 2.2).
10. Gruppenraum- und teilnehmerprivater Event-Tracking-Consent sind unabhängig. Privates
    Event-Tracking verlangt `accepted` plus aktiven Event-Consent; Owner/Admins erhalten keinen
    Einwilligungs-Bypass. Widerrufe wirken sofort auf Live-Daten, löschen aber keine rechtmäßig
    erfasste Historie.

## 11. Offene, unverbindliche Backlog-Ideen

Diese Punkte sind bewusst keine Anforderungen und blockieren keinen Merge:

1. **Event-Selbstbeitritt:** „Event-Einladung annehmen/ablehnen“ als kleines UX-Feature.
2. **MFA:** Passkeys oder ein anderer zweiter Faktor, falls der Freundeskreis das je für nötig hält.
3. **Breach-Passwort-Prüfung:** HIBP per k-Anonymity oder eine lokal aktualisierte Liste.
4. **Aufbewahrungsfrist/Export:** Bei rein privater Nutzung weiterhin nicht nötig; nur relevant,
   falls die Instanz je über den privaten Freundeskreis hinauswachsen sollte – was laut Abschnitt
   2.2 kein verfolgtes Ziel ist.
