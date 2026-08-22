# Konzept: User-, Rollen- und Event-Management

Stand: 20. Juli 2026 · Status: **verbindliches Zielkonzept** (Rev. 5 – Ein-Gruppen-Modell)

**Ergänzung vom 2026-08-11:** Das fachliche Eventmodell wurde durch
[`KONZEPT-EVENT-SICHTBARKEIT.md`](KONZEPT-EVENT-SICHTBARKEIT.md) präzisiert. Es gibt keinen
fachlichen Gruppenraum und keine Daten „außerhalb von Events“ mehr. Jede aktive Person nimmt an
einem dauerhaften Basis-Event teil und wählt genau ein persönliches Arbeits-Event. Bei
Detailabweichungen zum Eventkontext ist das neuere Eventkonzept maßgeblich.

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
- Alle beanspruchten Konten gehören derselben, einzigen Instanzgruppe und mindestens dem
  dauerhaften Basis-Event an.
- Events sind die verbindlichen fachlichen Arbeitsräume: Teilnehmerliste, eigene
  Tracking-Einwilligung und eventgescopte Zustellung (Realtime, Push, Kiosk, Arcade). Jede Person
  wählt ihr eigenes aktuelles Arbeits-Event.
- Rollen `owner`, `admin` und `member` regeln die Rechte innerhalb der Instanz. Das Rollenmodell ist
  eingefroren: Es wird nicht mehr als Mehrgruppen-Berechtigungssystem weiterentwickelt, sondern als
  einfaches, stabiles Instanz-Rechtemodell behandelt.
- Tracking und Auswertungen sind immer eventgebunden. Persönliche Gesamtansichten verwenden nur
  Events, an denen die betrachtende Person teilgenommen hat.
- Admins/Owner verwalten Mitglieder, Events und Fachdaten der Instanz, aber nicht das globale Konto
  einer Person.

Was sich gegenüber Rev. 4 ändert: Jeder Absatz, der von mehreren Gruppen, Gruppenwechsel,
Gruppen-Einladungslinks für neue Gruppen oder gruppenübergreifenden Mitgliedschaften handelte,
entfällt ersatzlos. Was bleibt, ist bewusst das, was in PR #238 bereits gehärtet und getestet wurde:
Events als Scoping-Dimension. Das ergänzende Eventkonzept führt diese Richtung konsequent zu einem
verpflichtenden Event-Scope ohne Gruppenraum fort.

---

## 2. Ziele und Nicht-Ziele

### 2.1 Ziele

- Ein Konto pro Mensch.
- Ein dauerhaftes Basis-Event für instanzweite Spiele, Live-Status, Abstimmungen, Matches und
  Organisation, ergänzt durch weitere persönliche Event-Arbeitsräume.
- Ein jederzeit erreichbarer persönlicher Eventwechsel; parallele Personen dürfen in
  unterschiedlichen Events arbeiten.
- Transparente, von der Person selbst steuerbare Tracking-Einwilligung pro Event sowie ein
  kontoweiter Tracking-Notschalter.
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
- Claim und Passwort-Reset laufen nur über atomar einmal nutzbare, ablaufende und widerrufbare
  Codes. Registrierungslinks sind mehrfach nutzbar, aber immer zeitlich begrenzt: Die Gültigkeit
  wird bei der Erstellung zwischen 24 Stunden und 90 Tagen gewählt (Standard in der Oberfläche:
  7 Tage) und kann zusätzlich jederzeit widerrufen werden (siehe KONZEPT-EVENT-SICHTBARKEIT.md,
  Abschnitt 3.3). Passwortänderung und Reset invalidieren alte Sessions und Sockets.
- Konto- und globales Auth-Rate-Limit, konstante Passwortprüfung auch für unbekannte Konten,
  `Retry-After` bei Sperren.
- Fünf Minuten gültige, sessiongebundene Step-up-Reauthentifizierung für kritische Admin-Aktionen.
- REST- und Socket-Akteure sind immer an die verifizierte Session gebunden.

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

### 3.4 Events als verbindliche Scoping-Dimension

Jede fachliche Datenzeile gehört zu genau einem realen Event. Einen fachlichen Instanzraum
„außerhalb von Events“ gibt es nicht mehr. Globale technische Daten wie Konto, Rolle,
Spielekatalog und Konfiguration bleiben davon unberührt.

Die Instanz besitzt ein dauerhaft offenes Basis-Event. Jede aktive Person ist dort angenommen;
Inhalte für alle Mitglieder werden diesem Event zugeordnet. Weitere Events besitzen Zeitraum,
Status und persönliche Teilnehmerliste. Tracking bleibt auf den jeweiligen Eventzeitraum
begrenzt, organisatorische Arbeit darf bei einem veröffentlichten Event bereits vor dem Start
stattfinden.

Jede Person wählt genau ein persönliches Arbeits-Event. Dieses bestimmt den normalen Kontext für
Checkliste, Abstimmungen, Sitzplan, Mitfahrgelegenheiten, Bestellungen, Matches, Turniere, Arcade
und vergleichbare Funktionen. Die Auswahl ersetzt keine Autorisierung; der Server prüft die
Teilnahme bei jedem Zugriff erneut.

Überlappende veröffentlichte Events sind zulässig, weil es kein instanzweit exklusives aktives
Event mehr gibt. Realtime, Push und Kiosk tragen immer einen konkreten Event-Scope.

### 3.5 Event-Teilnahme

Admins/Owner laden aktive Instanzmitglieder zu einem Event ein und können Event-Teilnahmen
administrativ widerrufen. `event_participants.status` bildet den persönlichen Ablauf ab:

- `invited`: Einladung ist offen; sichtbar ist nur der Einladungsteaser.
- `accepted`: aktive Teilnahme; nur dieser Zustand zählt für teilnehmergebundene Eventdaten,
  Arbeits-Event, Realtime-, Tracking- und Arcade-Prüfungen.
- `declined`: Einladung wurde abgelehnt; kein normaler Event-Zugriff.
- `removed`: operative Teilnahme wurde widerrufen; rechtmäßig entstandene persönliche Historie
  bleibt nachvollziehbar.

Nur die betroffene Person selbst kann `invited` nach `accepted` oder `declined` überführen.
Wiederholte identische Antworten sind idempotent; konkurrierende, widersprüchliche Antworten werden
atomar auf genau einen Zustand festgelegt. Ein angenommenes Event darf als persönliches
Arbeits-Event gewählt werden. Kiosk-Token besitzen unabhängig davon genau einen festen Event-Scope.

Konto-Einladungen sind mindestens mit dem Basis-Event und optional einem zusätzlichen Ziel-Event
gekoppelt. Claim, Instanzmitgliedschaft, Eventteilnahme und initiales Arbeits-Event werden atomar
gesetzt; ein aktives Konto ohne Event ist dadurch unmöglich.

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

Da es keinen Gruppenkontext und keinen fachlichen Instanzraum mehr zu wählen gibt, lautet die
Kontextfrage ausschließlich: **Welches meiner angenommenen Events ist mein aktueller
Arbeitsraum?** Die UI zeigt dieses Event dauerhaft an und bietet einen zentralen Wechsel. Die
Auswahl wird kontoweit serverseitig gespeichert; offene Tabs und Geräte werden über den Wechsel
informiert. Die Autorisierung läuft weiterhin pro Request:

- `requireGroupRole('admin')` bzw. `requireGroupRole('owner')` – verlangt Admin- bzw.
  Owner-Rechte. Die Namen der Helfer bleiben aus historischen Gründen an `group` angelehnt, prüfen
  aber gegen die eine feste Instanzgruppe.
- `resolveGroupResource` (in den Event-Routen als `resolveEvent` eingesetzt) lädt ein Event
  zusammen mit seinem Gruppenbezug und kombiniert das mit `requireGroupRole('admin')`, um
  Admin-/Ownerrechte für ein konkretes Event zu verlangen.
- Ressourcen werden immer zusammen mit ihrem Event geladen und mutiert, nie erst global per ID und
  danach ungeprüft.
- Kontextgebundene Endpunkte verwenden das persönliche Arbeits-Event. Explizite Eventfilter und
  Ressourcen-IDs werden gegen die eigene aktuelle oder historische Teilnahme geprüft.
- Fehlende Eventangaben fallen niemals auf `NULL`, `OUTSIDE_EVENTS_ID` oder ein globales
  Tracking-Event zurück.
- Event-Einladungen verwenden `POST /api/events/:id/invitations`; persönliche Antworten laufen über
  `POST /api/events/:id/invitation/accept` bzw. `.../decline`. Der ältere Pfad
  `POST /api/events/:id/accept` bleibt ausschließlich der Tracking-Zustimmung vorbehalten.

Serverantwort bei Grenzverletzungen bleibt unverändert:

- Nicht angemeldet: `401`
- Angemeldet, aber unzureichende Rolle: `403`
- Fremdes/unbekanntes Event oder fremde Ressource: `404`
- Nicht mehr aktives Konto: bestehende Sessions verlieren sofort den Zugriff

Admins/Owner dürfen Events und Einladungen administrativ verwalten. Ihre normale persönliche
Auswertung bleibt dennoch auf Events ihrer eigenen Teilnahmehistorie begrenzt; weitergehende
administrative Einsicht muss als eigener Adminpfad kenntlich und autorisiert sein.

---

## 5. Tracking und Privatsphäre

### 5.1 Grundregel

Der Agent authentifiziert das globale Konto und ordnet neue Aktivität ausschließlich dem
persönlichen Arbeits-Event zu. Ein Report wird fachlich verarbeitet, wenn:

- das Konto aktiv (nicht deaktiviert) ist,
- die Person im Arbeits-Event `accepted` ist,
- ihre Event-Tracking-Zustimmung aktiv ist,
- der Zeitpunkt innerhalb des Trackingzeitraums dieses Events liegt,
- der kontoweite Tracking-Notschalter nicht gesetzt ist.

Owner-/Adminrechte gewähren administrativen Event-Zugriff, aber keine persönliche
Tracking-Einwilligung und keinen Tracking-Teilnahmestatus.

Es gibt weiterhin keine dauerhaft gespeicherte globale Rohaktivität ohne Einwilligung. Ist kein
Tracking erlaubt, wird der Report nur als technischer Heartbeat verarbeitet. Es entsteht keine
ersatzweise globale, gruppenweite oder eventlose Aktivität.

### 5.2 Einwilligungen

- Beim Annehmen eines Events wird transparent erklärt, dass Tracking während des Eventzeitraums
  für Event-Auswertungen verwendet wird; die Zustimmung ist separat widerrufbar.
- `POST /api/events/:id/tracking-consent` setzt den Event-Consent mit
  `{ "granted": true|false }`. Historische Gruppenraum-Endpunkte und der mehrdeutige Alias
  `POST /api/events/:id/accept` werden nach einer Übergangsphase entfernt.
- Zustimmung, wiederholte Zustimmung, Widerruf und wiederholter Widerruf sind idempotent. Eine
  erneute Zustimmung nach Widerruf erzeugt ein neues Historienintervall; alte Consent-Zeilen werden
  weder überschrieben noch gelöscht.
- Event-Consent darf nur bei `accepted` erteilt werden. Vorhandene
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

Bei einem persönlichen Eventwechsel wird der bisherige Live-Kontext vor Verarbeitung des nächsten
Reports geschlossen. Ein Report wird nie proportional auf mehrere Events verteilt. Ein zukünftiges
Event darf für organisatorische Arbeit ausgewählt sein; außerhalb seines Trackingzeitraums bleibt
der Agentreport dabei ein technischer Heartbeat.

---

## 6. Realtime, Push, Kiosk und Arcade

Die Härtung aus PR #238 bleibt technische Grundlage, wird aber auf den nun verpflichtenden
Event-Scope verschärft. Fachliche Zustellung ohne konkrete Event-ID entfällt.

### 6.1 Socket.IO

Ein normaler Socket tritt nach Authentifizierung dem Room des persönlichen Arbeits-Events bei.
Der Server validiert Event-Teilnahme bei jedem Subscribe und bei jeder Auslieferung. Der persönliche
Eventwechsel, Rollenänderung, Kontodeaktivierung oder Ende eines Events lösen sofortiges Re-Rooming
bzw. Trennen aus. Personenbezogene Einladungs- und Kontextsignale dürfen über einen privaten
User-/Session-Kanal laufen, enthalten aber keine fremden Eventdaten.

### 6.2 Push

Push-Nachrichten tragen verpflichtend `event_id`. Die Empfängerliste wird bei jedem Versand aus
Event-Teilnahme und individuellen Push-Einstellungen berechnet. Entfernte Mitglieder, Test-User und
deaktivierte Konten werden ausgeschlossen. Eine Person kann Push pro Event stummschalten und
erhält erlaubte Nachrichten unabhängig vom gerade gewählten Arbeits-Event. Instanzweite Hinweise
laufen über das Basis-Event.

Jede sichtbare Push-Darstellung nennt das zugehörige Event als Text. Payload, persistierter Eintrag,
Notification-Tag, Topic-, Deduplizierungs- und Ersetzungsschlüssel tragen `event_id`, damit
gleichartige Nachrichten verschiedener Events einander weder überschreiben noch gemeinsam als
gelesen markieren. Die Nachrichtenzentrale kennzeichnet und filtert nach Event; Event-Mutes und
Gelesen-/Ausgeblendet-Zustände bleiben eventgescoped. Ein Klick wechselt erst nach erneuter
Autorisierung in das Ziel-Event.

### 6.3 Kiosk

Jeder Kiosk-Link gehört genau zu einem Event. Tokens sind zufällig, widerrufbar, rotierbar und
read-only. Gruppen-/Instanz-Kiosk-Tokens ohne Eventbindung entfallen.

### 6.4 Arcade

Arcade-Lobbys und laufende Matches tragen verpflichtend `event_id` mit unveränderlichem Scope.
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
| Event-Scoping für REST/Realtime/Push/Kiosk/Arcade | verpflichtender Scope und persönliche Eventwahl auf dem Feature-Branch umgesetzt; technische Abnahme vor Livegang ausstehend |
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
3. Events sind die verpflichtende fachliche Scoping-Dimension unterhalb der Instanz. Jede aktive
   Person nimmt am Basis-Event teil und wählt genau ein persönliches Arbeits-Event.
4. Rollen `owner`/`admin`/`member` bleiben unverändert das Instanz-Rechtemodell; kein Rückbau auf
   `is_admin`.
5. Konto-Claim, Basis-Event-Teilnahme, optionale Ziel-Event-Teilnahme und initialer Arbeitskontext
   werden atomar gesetzt. Weitere Event-Einladungen können angenommen oder abgelehnt werden.
6. Die interne Startgruppe (`groups`/`group_memberships`/`group_id`) bleibt im Schema bestehen
   ("Stilllegen statt Rückbau"); sie ist kein Bedienkonzept.
7. Tracking-Widerruf stoppt zukünftige Erfassung; rechtmäßig erfasste Historie bleibt erhalten und
   wird nur durch eine separate bewusste Löschaktion entfernt.
8. Sicherheitsbaseline ist OWASP ASVS 5.0.0 Level 1 vollständig plus sinnvolle Level-2-Härtungen
   mit vertretbarem Aufwand; MFA und vollständige L2-Konformität sind explizit keine
   Merge-Voraussetzung.
9. Mehrgruppenbetrieb, vollständige ASVS-L2-Konformität und MFA als Merge-Voraussetzung sind
   Nicht-Ziele dieses Konzepts (Abschnitt 2.2).
10. Tracking ist immer eventgebunden und verlangt `accepted` plus aktiven Event-Consent;
    Owner/Admins erhalten keinen Einwilligungs-Bypass. Widerrufe wirken sofort auf Live-Daten,
    löschen aber keine rechtmäßig erfasste Historie. Ein kontoweiter Notschalter gewinnt immer.
11. Normale persönliche Gesamtstatistiken verwenden ausschließlich Events der eigenen
    Teilnahmehistorie; eine instanzweite All-Events-Auswertung entfällt.
12. Push, fachliches Realtime und Kiosk besitzen immer eine konkrete Eventbindung. Push zeigt den
    Eventnamen sichtbar und trennt Gruppierung, Deduplizierung, Gelesen-Status, Filter und Mutes
    zwischen Events.

## 11. Offene, unverbindliche Backlog-Ideen

Diese Punkte sind bewusst keine Anforderungen und blockieren keinen Merge:

1. **MFA:** Passkeys oder ein anderer zweiter Faktor, falls der Freundeskreis das je für nötig hält.
2. **Breach-Passwort-Prüfung:** HIBP per k-Anonymity oder eine lokal aktualisierte Liste.
3. **Aufbewahrungsfrist/Export:** Bei rein privater Nutzung weiterhin nicht nötig; nur relevant,
   falls die Instanz je über den privaten Freundeskreis hinauswachsen sollte – was laut Abschnitt
   2.2 kein verfolgtes Ziel ist.
